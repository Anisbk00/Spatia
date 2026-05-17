// ============================================
// Auto-Scaler Service — Main Entry Point
// ============================================
// Continuous background service that:
//   - Monitors queue depth and worker utilization
//   - Makes scaling decisions based on thresholds
//   - Prioritizes paid users in the processing queue
//   - Delays free-tier jobs when system is overloaded
//   - Logs all decisions to the system_logs table
//   - Handles graceful degradation without Supabase
//
// Architecture:
//   Startup → Validate Config → Evaluation Loop
//   Each Cycle:
//     1. Get current system state
//     2. Evaluate scaling thresholds
//     3. Scale up/down if needed (SIMULATED)
//     4. Prioritize paid users in queue
//     5. Delay free-tier jobs if overloaded
//     6. Log decision to system_logs
//   Shutdown → Log exit
// ============================================

import { createClient } from "@supabase/supabase-js";

// ============================================
// Row type helpers (for untyped Supabase client)
// ============================================

interface WorkerRow {
  id: string;
  status: string;
  [key: string]: unknown;
}

interface ProcessingJobRow {
  id: string;
  scene_id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface SceneRow {
  id: string;
  property_id: string;
  [key: string]: unknown;
}

interface PropertyRow {
  id: string;
  org_id: string | null;
  [key: string]: unknown;
}

interface OrgRow {
  id: string;
  plan: string | null;
  [key: string]: unknown;
}

// ============================================
// Configuration
// ============================================

interface ScalerConfig {
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  minWorkers: number;
  maxWorkers: number;
  cooldownSeconds: number;
  freeTierDelayThreshold: number;
  evaluationIntervalMs: number;
  supabaseUrl: string;
  supabaseServiceKey: string;
}

function loadConfig(): ScalerConfig {
  return {
    scaleUpThreshold: parseInt(process.env.SCALE_UP_THRESHOLD || "10", 10),
    scaleDownThreshold: parseInt(process.env.SCALE_DOWN_THRESHOLD || "2", 10),
    minWorkers: parseInt(process.env.MIN_WORKERS || "1", 10),
    maxWorkers: parseInt(process.env.MAX_WORKERS || "10", 10),
    cooldownSeconds: parseInt(process.env.COOLDOWN_SECONDS || "300", 10),
    freeTierDelayThreshold: parseInt(process.env.FREE_TIER_DELAY_THRESHOLD || "15", 10),
    evaluationIntervalMs: parseInt(process.env.EVALUATION_INTERVAL_MS || "60000", 10),
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || "",
  };
}

// ============================================
// Types
// ============================================

interface SystemState {
  queueDepth: number;
  activeWorkers: number;
  idleWorkers: number;
  drainingWorkers: number;
  totalWorkers: number;
  avgProcessingTimeSeconds: number;
  freeTierJobsInQueue: number;
  proJobsInQueue: number;
  businessJobsInQueue: number;
  paidJobsInQueue: number;
}

interface ScalingDecision {
  action: "scale_up" | "scale_down" | "hold";
  currentWorkers: number;
  targetWorkers: number;
  reason: string;
  queueDepth: number;
  idleWorkers: number;
  timestamp: string;
}

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  totalEvaluations: number;
  lastEvaluationAt: string | null;
  lastDecision: ScalingDecision | null;
  supabaseConnected: boolean;
  errors: string[];
}

// ============================================
// Supabase Client
// ============================================

let supabaseInstance: ReturnType<typeof createClient> | null = null;

function getSupabase(): ReturnType<typeof createClient> | null {
  if (supabaseInstance) return supabaseInstance;

  const config = loadConfig();
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    return null;
  }

  try {
    supabaseInstance = createClient(config.supabaseUrl, config.supabaseServiceKey);
    return supabaseInstance;
  } catch (err) {
    console.error("[AutoScaler] Failed to create Supabase client:", err);
    return null;
  }
}

// ============================================
// System State Queries
// ============================================

async function getSystemState(): Promise<SystemState> {
  const supabase = getSupabase();
  const emptyState: SystemState = {
    queueDepth: 0,
    activeWorkers: 0,
    idleWorkers: 0,
    drainingWorkers: 0,
    totalWorkers: 0,
    avgProcessingTimeSeconds: 0,
    freeTierJobsInQueue: 0,
    proJobsInQueue: 0,
    businessJobsInQueue: 0,
    paidJobsInQueue: 0,
  };

  if (!supabase) return emptyState;

  try {
    // 1. Queue depth from processing_jobs
    const { count: queueDepth } = await supabase
      .from("processing_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "queued");

    // 2. Worker stats from workers table
    const { data: workers } = await supabase
      .from("workers")
      .select("status")
      .neq("status", "offline");

    const allWorkers: WorkerRow[] = (workers as WorkerRow[]) || [];
    const idleWorkers = allWorkers.filter((w) => w.status === "idle").length;
    const busyWorkers = allWorkers.filter((w) => w.status === "busy").length;
    const drainingWorkers = allWorkers.filter((w) => w.status === "draining").length;
    const activeWorkers = idleWorkers + busyWorkers; // active = not offline/failed
    const totalWorkers = allWorkers.length;

    // 3. Average processing time (recent completed jobs)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentJobs } = await supabase
      .from("processing_jobs")
      .select("started_at, finished_at")
      .eq("status", "completed")
      .gte("finished_at", oneHourAgo)
      .not("started_at", "is", null)
      .not("finished_at", "is", null)
      .limit(500);

    let avgProcessingTimeSeconds = 0;
    if (recentJobs && recentJobs.length > 0) {
      const typedJobs = recentJobs as ProcessingJobRow[];
      const times = typedJobs
        .map((j) => {
          const start = new Date(j.started_at!).getTime();
          const end = new Date(j.finished_at!).getTime();
          return (end - start) / 1000;
        })
        .filter((t) => t > 0 && t < 86400); // filter outliers

      if (times.length > 0) {
        avgProcessingTimeSeconds = times.reduce((a, b) => a + b, 0) / times.length;
      }
    }

    // 4. Count jobs by tier (free / pro / business)
    const { data: queuedJobs } = await supabase
      .from("processing_jobs")
      .select("id, scene_id")
      .eq("status", "queued")
      .limit(1000);

    let freeTierJobsInQueue = 0;
    let proJobsInQueue = 0;
    let businessJobsInQueue = 0;
    let paidJobsInQueue = 0;

    if (queuedJobs && queuedJobs.length > 0) {
      const typedQueuedJobs = queuedJobs as ProcessingJobRow[];
      // Resolve scene → property → org → plan
      const sceneIds = typedQueuedJobs.map((j) => j.scene_id);

      const { data: scenes } = await supabase
        .from("scenes")
        .select("id, property_id")
        .in("id", sceneIds);

      if (scenes && scenes.length > 0) {
        const typedScenes = scenes as SceneRow[];
        const sceneToProperty = new Map(
          typedScenes.map((s) => [s.id, s.property_id])
        );

        const propertyIds = Array.from(new Set(typedScenes.map((s) => s.property_id)));

        const { data: properties } = await supabase
          .from("properties")
          .select("id, org_id")
          .in("id", propertyIds);

        const typedProperties = (properties as PropertyRow[]) || [];
        const propertyToOrg = new Map(
          typedProperties.map((p) => [p.id, p.org_id as string])
        );

        const orgIds = Array.from(
          new Set(
            typedProperties
              .map((p) => p.org_id)
              .filter(Boolean) as string[]
          )
        );

        if (orgIds.length > 0) {
          const { data: orgs } = await supabase
            .from("organizations")
            .select("id, plan")
            .in("id", orgIds);

          const orgPlanMap = new Map(
            ((orgs as OrgRow[]) || []).map((o) => [o.id, o.plan || "free"])
          );

          for (const job of typedQueuedJobs) {
            const propertyId = sceneToProperty.get(job.scene_id);
            const orgId = propertyId ? propertyToOrg.get(propertyId) : null;
            const plan = orgId ? orgPlanMap.get(orgId) || "free" : "free";

            if (plan === "business") {
              businessJobsInQueue++;
              paidJobsInQueue++;
            } else if (plan === "pro") {
              proJobsInQueue++;
              paidJobsInQueue++;
            } else {
              freeTierJobsInQueue++;
            }
          }
        } else {
          // No org info — treat all as free
          freeTierJobsInQueue = typedQueuedJobs.length;
        }
      } else {
        // No scene info — treat all as free
        freeTierJobsInQueue = typedQueuedJobs.length;
      }
    }

    return {
      queueDepth: queueDepth || 0,
      activeWorkers,
      idleWorkers,
      drainingWorkers,
      totalWorkers,
      avgProcessingTimeSeconds: Math.round(avgProcessingTimeSeconds * 100) / 100,
      freeTierJobsInQueue,
      proJobsInQueue,
      businessJobsInQueue,
      paidJobsInQueue,
    };
  } catch (err) {
    console.error("[AutoScaler] Error getting system state:", err);
    return emptyState;
  }
}

// ============================================
// System Log
// ============================================

async function logToSystem(
  level: "debug" | "info" | "warn" | "error" | "fatal",
  source: string,
  message: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  // Always log to console
  const timestamp = new Date().toISOString();
  const levelTag = level.toUpperCase().padEnd(5);

  console.log(`[${timestamp}] [${levelTag}] [${source}] ${message}`);

  // Also log to Supabase system_logs table if available
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    await supabase.from("system_logs").insert({
      level,
      source,
      message,
      metadata,
    });
  } catch (err) {
    // Don't recursively error — just log to console
    console.error("[AutoScaler] Failed to write system_log:", err);
  }
}

// ============================================
// Scaling Functions
// ============================================

/**
 * Scale up: in production this would provision new GPU instances.
 * In simulation: log the decision and update the target worker count.
 */
async function scaleUp(
  targetCount: number,
  state: SystemState,
  config: ScalerConfig
): Promise<{
  scaled: boolean;
  newCount: number;
  reason: string;
}> {
  const actualTarget = Math.min(
    Math.max(targetCount, config.minWorkers),
    config.maxWorkers
  );

  if (actualTarget <= state.activeWorkers) {
    return {
      scaled: false,
      newCount: state.activeWorkers,
      reason: "Already at or above target worker count",
    };
  }

  const workersToAdd = actualTarget - state.activeWorkers;

  // SIMULATED: In production, this would call a cloud API
  // e.g., AWS ECS task count, GKE node pool resize, Azure Container Instances, etc.
  console.log(
    `[AutoScaler] SCALE UP: ${state.activeWorkers} -> ${actualTarget} workers ` +
    `(+${workersToAdd} new instances) | Queue: ${state.queueDepth}, Idle: ${state.idleWorkers}`
  );

  await logToSystem("info", "auto-scaler", "SCALE UP decision", {
    action: "scale_up",
    currentWorkers: state.activeWorkers,
    targetWorkers: actualTarget,
    workersToAdd,
    queueDepth: state.queueDepth,
    idleWorkers: state.idleWorkers,
    paidJobsInQueue: state.paidJobsInQueue,
    freeTierJobsInQueue: state.freeTierJobsInQueue,
    avgProcessingTimeSeconds: state.avgProcessingTimeSeconds,
    simulated: true,
  });

  return {
    scaled: true,
    newCount: actualTarget,
    reason: `Scaled up from ${state.activeWorkers} to ${actualTarget} workers (+${workersToAdd} instances)`,
  };
}

/**
 * Scale down: in production this would drain and terminate instances.
 * In simulation: mark workers as 'draining'.
 */
async function scaleDown(
  targetCount: number,
  state: SystemState,
  config: ScalerConfig
): Promise<{
  scaled: boolean;
  newCount: number;
  reason: string;
}> {
  const actualTarget = Math.min(
    Math.max(targetCount, config.minWorkers),
    state.activeWorkers
  );

  if (actualTarget >= state.activeWorkers) {
    return {
      scaled: false,
      newCount: state.activeWorkers,
      reason: "Already at or below target worker count",
    };
  }

  if (actualTarget < config.minWorkers) {
    return {
      scaled: false,
      newCount: state.activeWorkers,
      reason: `Cannot scale below minimum (${config.minWorkers} workers)`,
    };
  }

  const workersToRemove = state.activeWorkers - actualTarget;

  // SIMULATED: In production, this would:
  // 1. Mark workers as "draining"
  // 2. Wait for current jobs to finish
  // 3. Terminate instances
  // Here we simulate by marking idle workers as 'draining' in the database
  console.log(
    `[AutoScaler] SCALE DOWN: ${state.activeWorkers} -> ${actualTarget} workers ` +
    `(-${workersToRemove} instances) | Queue: ${state.queueDepth}, Idle: ${state.idleWorkers}`
  );

  // Attempt to mark idle workers as draining in the database
  const supabase = getSupabase();
  if (supabase && workersToRemove > 0) {
    try {
      // Find idle workers to drain (up to workersToRemove)
      const { data: idleWorkers } = await supabase
        .from("workers")
        .select("id")
        .eq("status", "idle")
        .limit(workersToRemove);

      if (idleWorkers && idleWorkers.length > 0) {
        const workerIds = (idleWorkers as WorkerRow[]).map((w) => w.id);
        await supabase
          .from("workers")
          .update({ status: "draining" })
          .in("id", workerIds);

        console.log(
          `[AutoScaler] Marked ${workerIds.length} idle workers as 'draining'`
        );
      }
    } catch (err) {
      console.error("[AutoScaler] Error marking workers as draining:", err);
    }
  }

  await logToSystem("info", "auto-scaler", "SCALE DOWN decision", {
    action: "scale_down",
    currentWorkers: state.activeWorkers,
    targetWorkers: actualTarget,
    workersToRemove,
    queueDepth: state.queueDepth,
    idleWorkers: state.idleWorkers,
    drainingWorkers: state.drainingWorkers,
    simulated: true,
  });

  return {
    scaled: true,
    newCount: actualTarget,
    reason: `Scaled down from ${state.activeWorkers} to ${actualTarget} workers (-${workersToRemove} instances)`,
  };
}

/**
 * Prioritize paid users in the queue.
 *
 * Reorders queued jobs so that business tier jobs are processed first,
 * then pro tier jobs, then free tier jobs.
 *
 * This is done by updating created_at timestamps to control FIFO order.
 *
 * @returns Number of jobs that were reordered
 */
async function prioritizePaidUsers(config: ScalerConfig): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;

  try {
    // Only reorder when queue is under pressure
    const state = await getSystemState();
    if (state.queueDepth <= config.freeTierDelayThreshold) return 0;

    // Get all queued jobs ordered by creation time
    const { data: queuedJobs, error } = await supabase
      .from("processing_jobs")
      .select("id, scene_id, created_at")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(500);

    if (error || !queuedJobs || queuedJobs.length === 0) return 0;
    const typedQueuedJobs = queuedJobs as ProcessingJobRow[];

    // Resolve job → scene → property → org → plan
    const sceneIds = typedQueuedJobs.map((j) => j.scene_id);

    const { data: scenes } = await supabase
      .from("scenes")
      .select("id, property_id")
      .in("id", sceneIds);

    if (!scenes || scenes.length === 0) return 0;
    const typedScenes = scenes as SceneRow[];

    const sceneToProperty = new Map(
      typedScenes.map((s) => [s.id, s.property_id])
    );

    const propertyIds = Array.from(new Set(typedScenes.map((s) => s.property_id)));

    const { data: properties } = await supabase
      .from("properties")
      .select("id, org_id")
      .in("id", propertyIds);

    const typedProperties = (properties as PropertyRow[]) || [];
    const propertyToOrg = new Map(
      typedProperties.map((p) => [p.id, p.org_id as string])
    );

    const orgIds = Array.from(
      new Set(
        typedProperties
          .map((p) => p.org_id)
          .filter(Boolean) as string[]
      )
    );

    if (orgIds.length === 0) return 0;

    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, plan")
      .in("id", orgIds);

    const orgPlanMap = new Map(
      ((orgs as OrgRow[]) || []).map((o) => [o.id, o.plan || "free"])
    );

    // Categorize jobs by tier
    type TieredJob = { id: string; created_at: string; tier: "business" | "pro" | "free" };
    const businessJobs: TieredJob[] = [];
    const proJobs: TieredJob[] = [];
    const freeJobs: TieredJob[] = [];

    for (const job of typedQueuedJobs) {
      const propertyId = sceneToProperty.get(job.scene_id);
      const orgId = propertyId ? propertyToOrg.get(propertyId) : null;
      const plan = orgId ? orgPlanMap.get(orgId) || "free" : "free";

      const tieredJob: TieredJob = {
        id: job.id,
        created_at: job.created_at,
        tier: plan as "business" | "pro" | "free",
      };

      if (plan === "business") {
        businessJobs.push(tieredJob);
      } else if (plan === "pro") {
        proJobs.push(tieredJob);
      } else {
        freeJobs.push(tieredJob);
      }
    }

    // Check if reordering is needed (any paid job is behind a free job)
    // Build the desired order: business → pro → free (preserving FIFO within each tier)
    const desiredOrder: TieredJob[] = [
      ...businessJobs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
      ...proJobs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
      ...freeJobs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    ];

    // Check if current order matches desired order
    const currentOrder = typedQueuedJobs.map((j) => j.id);
    const desiredIdOrder = desiredOrder.map((j) => j.id);
    const needsReorder = currentOrder.some((id, idx) => id !== desiredIdOrder[idx]);

    if (!needsReorder) return 0;

    // Re-assign created_at timestamps to enforce priority order
    const earliestTime = new Date(typedQueuedJobs[0].created_at).getTime();
    let reorderedCount = 0;

    for (let i = 0; i < desiredOrder.length; i++) {
      const job = desiredOrder[i];
      const newCreatedAt = new Date(earliestTime + i * 1000).toISOString(); // 1 second apart

      const { error: updateError } = await supabase
        .from("processing_jobs")
        .update({ created_at: newCreatedAt })
        .eq("id", job.id);

      if (!updateError) {
        reorderedCount++;
      }
    }

    if (reorderedCount > 0) {
      console.log(
        `[AutoScaler] Reordered ${reorderedCount} jobs: ` +
        `${businessJobs.length} business → ${proJobs.length} pro → ${freeJobs.length} free`
      );

      await logToSystem("info", "auto-scaler", "Queue prioritization applied", {
        reorderedCount,
        businessJobs: businessJobs.length,
        proJobs: proJobs.length,
        freeJobs: freeJobs.length,
        queueDepth: state.queueDepth,
      });
    }

    return reorderedCount;
  } catch (err) {
    console.error("[AutoScaler] Error prioritizing paid users:", err);
    return 0;
  }
}

/**
 * Delay free-tier jobs when the queue is overloaded.
 *
 * When queue depth exceeds the free tier delay threshold, this function
 * adds a delay marker to free-tier jobs by updating their metadata.
 * The delay causes free-tier jobs to be deprioritized in processing.
 *
 * @returns Number of free-tier jobs that were delayed
 */
async function delayFreeTierJobs(config: ScalerConfig): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;

  try {
    const state = await getSystemState();

    // Only delay when queue exceeds the threshold
    if (state.queueDepth <= config.freeTierDelayThreshold) {
      return 0;
    }

    // Get free-tier queued jobs
    const { data: queuedJobs } = await supabase
      .from("processing_jobs")
      .select("id, scene_id, metadata")
      .eq("status", "queued")
      .limit(500);

    if (!queuedJobs || queuedJobs.length === 0) return 0;
    const typedQueuedJobs = queuedJobs as ProcessingJobRow[];

    // Resolve org plans
    const sceneIds = typedQueuedJobs.map((j) => j.scene_id);

    const { data: scenes } = await supabase
      .from("scenes")
      .select("id, property_id")
      .in("id", sceneIds);

    if (!scenes || scenes.length === 0) return 0;
    const typedScenes = scenes as SceneRow[];

    const sceneToProperty = new Map(
      typedScenes.map((s) => [s.id, s.property_id])
    );

    const propertyIds = Array.from(new Set(typedScenes.map((s) => s.property_id)));

    const { data: properties } = await supabase
      .from("properties")
      .select("id, org_id")
      .in("id", propertyIds);

    const typedProperties = (properties as PropertyRow[]) || [];
    const propertyToOrg = new Map(
      typedProperties.map((p) => [p.id, p.org_id as string])
    );

    const orgIds = Array.from(
      new Set(
        typedProperties
          .map((p) => p.org_id)
          .filter(Boolean) as string[]
      )
    );

    if (orgIds.length === 0) return 0;

    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, plan")
      .in("id", orgIds);

    const freeOrgIds = new Set(
      ((orgs as OrgRow[]) || []).filter((o) => o.plan === "free").map((o) => o.id)
    );

    // Identify free-tier jobs that haven't been delayed yet
    const freeJobIds: string[] = [];
    for (const job of typedQueuedJobs) {
      const propertyId = sceneToProperty.get(job.scene_id);
      const orgId = propertyId ? propertyToOrg.get(propertyId) : null;

      if (orgId && freeOrgIds.has(orgId)) {
        // Check if already delayed
        const metadata = job.metadata || {};
        if (!metadata.delayed) {
          freeJobIds.push(job.id);
        }
      }
    }

    if (freeJobIds.length === 0) return 0;

    // Mark free-tier jobs as delayed with a delay timestamp
    const delayDurationMs = Math.min(
      (state.queueDepth - config.freeTierDelayThreshold) * 5000, // 5s extra per job over threshold
      120000 // Max 2 minutes additional delay
    );

    let delayedCount = 0;
    for (const jobId of freeJobIds) {
      const { error: updateError } = await supabase
        .from("processing_jobs")
        .update({
          metadata: {
            delayed: true,
            delay_until: new Date(Date.now() + delayDurationMs).toISOString(),
            delay_reason: `Queue overloaded (${state.queueDepth} jobs, threshold: ${config.freeTierDelayThreshold})`,
            delay_duration_ms: delayDurationMs,
          },
        })
        .eq("id", jobId);

      if (!updateError) {
        delayedCount++;
      }
    }

    if (delayedCount > 0) {
      console.log(
        `[AutoScaler] Delayed ${delayedCount} free-tier jobs ` +
        `(+${delayDurationMs / 1000}s delay) | Queue: ${state.queueDepth}, Threshold: ${config.freeTierDelayThreshold}`
      );

      await logToSystem("info", "auto-scaler", "Free-tier jobs delayed", {
        delayedCount,
        delayDurationMs,
        queueDepth: state.queueDepth,
        threshold: config.freeTierDelayThreshold,
        freeTierJobsInQueue: state.freeTierJobsInQueue,
        paidJobsInQueue: state.paidJobsInQueue,
      });
    }

    return delayedCount;
  } catch (err) {
    console.error("[AutoScaler] Error delaying free-tier jobs:", err);
    return 0;
  }
}

// ============================================
// Health Check
// ============================================

const startTime = Date.now();
let totalEvaluations = 0;
let lastEvaluationAt: string | null = null;
let lastDecision: ScalingDecision | null = null;
const recentErrors: string[] = [];
const MAX_ERRORS = 20;

function healthCheck(): HealthStatus {
  const uptime = Date.now() - startTime;
  const errors = [...recentErrors];

  let supabaseConnected = false;
  const supabase = getSupabase();
  if (supabase) {
    supabaseConnected = true;
  }

  let status: "healthy" | "degraded" | "unhealthy";
  if (!supabaseConnected) {
    status = "degraded";
  } else if (errors.length > 5) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  return {
    status,
    uptime,
    totalEvaluations,
    lastEvaluationAt,
    lastDecision,
    supabaseConnected,
    errors,
  };
}

// ============================================
// Main Evaluation Loop
// ============================================

let lastDecisionTime = 0;

async function evaluateAndScale(config: ScalerConfig): Promise<ScalingDecision> {
  totalEvaluations++;
  lastEvaluationAt = new Date().toISOString();

  const holdDecision: ScalingDecision = {
    action: "hold",
    currentWorkers: 0,
    targetWorkers: 0,
    reason: "System is within normal parameters",
    queueDepth: 0,
    idleWorkers: 0,
    timestamp: lastEvaluationAt,
  };

  try {
    // 1. Get current system state
    const state = await getSystemState();

    holdDecision.currentWorkers = state.activeWorkers;
    holdDecision.targetWorkers = state.activeWorkers;
    holdDecision.queueDepth = state.queueDepth;
    holdDecision.idleWorkers = state.idleWorkers;

    // 2. Calculate if scale-up or scale-down needed

    // Check cooldown
    const nowMs = Date.now();
    const elapsedSinceLastDecision = (nowMs - lastDecisionTime) / 1000;
    const cooldownActive = lastDecisionTime > 0 && elapsedSinceLastDecision < config.cooldownSeconds;

    let action: ScalingDecision["action"] = "hold";
    let targetWorkers = state.activeWorkers;
    let reason = "System is within normal parameters";

    // 3. SCALE UP: queue > scaleUpThreshold AND workers < maxWorkers
    if (state.queueDepth > config.scaleUpThreshold && state.activeWorkers < config.maxWorkers) {
      if (!cooldownActive) {
        // Calculate how many workers we need (1 worker per ~5 queued jobs)
        const deficit = Math.ceil(state.queueDepth / 5);
        targetWorkers = Math.min(
          state.activeWorkers + deficit,
          config.maxWorkers
        );

        if (targetWorkers > state.activeWorkers) {
          action = "scale_up";
          reason =
            `Queue depth (${state.queueDepth}) exceeds scale-up threshold (${config.scaleUpThreshold}). ` +
            `Need ${targetWorkers} workers (currently ${state.activeWorkers}).`;
        }
      } else {
        reason =
          `Queue depth (${state.queueDepth}) exceeds threshold but cooldown is active ` +
          `(${Math.round(config.cooldownSeconds - elapsedSinceLastDecision)}s remaining).`;
      }
    }

    // 4. SCALE DOWN: idle workers > scaleDownThreshold AND workers > minWorkers
    if (
      action === "hold" &&
      state.idleWorkers > config.scaleDownThreshold &&
      state.activeWorkers > config.minWorkers
    ) {
      if (!cooldownActive) {
        // Keep at least 1 idle worker for readiness
        const excess = state.idleWorkers - 1;
        targetWorkers = Math.max(
          state.activeWorkers - excess,
          config.minWorkers
        );

        if (targetWorkers < state.activeWorkers) {
          action = "scale_down";
          reason =
            `${state.idleWorkers} idle workers exceed scale-down threshold (${config.scaleDownThreshold}). ` +
            `Reducing from ${state.activeWorkers} to ${targetWorkers} workers. Queue: ${state.queueDepth}.`;
        }
      } else {
        reason =
          `${state.idleWorkers} idle workers but cooldown is active ` +
          `(${Math.round(config.cooldownSeconds - elapsedSinceLastDecision)}s remaining).`;
      }
    }

    const decision: ScalingDecision = {
      action,
      currentWorkers: state.activeWorkers,
      targetWorkers,
      reason,
      queueDepth: state.queueDepth,
      idleWorkers: state.idleWorkers,
      timestamp: lastEvaluationAt,
    };

    lastDecision = decision;

    // 5. Execute scaling if needed
    if (action === "scale_up") {
      const result = await scaleUp(targetWorkers, state, config);
      decision.targetWorkers = result.newCount;
      lastDecisionTime = Date.now();
    } else if (action === "scale_down") {
      const result = await scaleDown(targetWorkers, state, config);
      decision.targetWorkers = result.newCount;
      lastDecisionTime = Date.now();
    }

    // 6. If queue > freeTierDelayThreshold: delay free-tier jobs
    if (state.queueDepth > config.freeTierDelayThreshold) {
      await delayFreeTierJobs(config);
    }

    // 7. Prioritize paid user jobs in queue
    await prioritizePaidUsers(config);

    // 8. Log decision to system_logs
    const logLevel: "debug" | "info" | "warn" =
      action === "hold" ? "debug" : "info";

    await logToSystem(logLevel, "auto-scaler", `Evaluation: ${action} — ${reason}`, {
      action,
      currentWorkers: state.activeWorkers,
      targetWorkers,
      queueDepth: state.queueDepth,
      idleWorkers: state.idleWorkers,
      avgProcessingTimeSeconds: state.avgProcessingTimeSeconds,
      freeTierJobsInQueue: state.freeTierJobsInQueue,
      proJobsInQueue: state.proJobsInQueue,
      businessJobsInQueue: state.businessJobsInQueue,
      paidJobsInQueue: state.paidJobsInQueue,
      cooldownActive,
    });

    // Console summary
    const actionTag =
      action === "scale_up" ? "UP  " :
      action === "scale_down" ? "DOWN" : "HOLD";

    console.log(
      `[${actionTag}] [${lastEvaluationAt}] ` +
      `${action.toUpperCase()} | Workers: ${state.activeWorkers}→${targetWorkers} | ` +
      `Queue: ${state.queueDepth} | Idle: ${state.idleWorkers} | ` +
      `Paid: ${state.paidJobsInQueue} | Free: ${state.freeTierJobsInQueue} | ` +
      `Avg Time: ${Math.round(state.avgProcessingTimeSeconds)}s`
    );

    return decision;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    recentErrors.push(`[${lastEvaluationAt}] ${errorMsg}`);
    if (recentErrors.length > MAX_ERRORS) {
      recentErrors.shift();
    }

    console.error("[AutoScaler] Evaluation error:", err);

    await logToSystem("error", "auto-scaler", `Evaluation failed: ${errorMsg}`, {
      error: errorMsg,
    });

    return holdDecision;
  }
}

// ============================================
// Main Service
// ============================================

let isShuttingDown = false;
let evaluationTimer: ReturnType<typeof setInterval> | null = null;

async function main() {
  const config = loadConfig();

  console.log("============================================");
  console.log("  Auto-Scaler Service v1.0.0");
  console.log("============================================");
  console.log(`  Scale-up threshold:    ${config.scaleUpThreshold} queued jobs`);
  console.log(`  Scale-down threshold:  ${config.scaleDownThreshold} idle workers`);
  console.log(`  Min workers:           ${config.minWorkers}`);
  console.log(`  Max workers:           ${config.maxWorkers}`);
  console.log(`  Cooldown:              ${config.cooldownSeconds}s`);
  console.log(`  Free-tier delay at:    ${config.freeTierDelayThreshold} queued jobs`);
  console.log(`  Evaluation interval:   ${config.evaluationIntervalMs / 1000}s`);
  console.log(`  Supabase URL:          ${config.supabaseUrl ? "configured" : "missing"}`);
  console.log(`  Supabase Service Key:  ${config.supabaseServiceKey ? "configured" : "missing"}`);
  console.log("============================================");

  // Validate Supabase config
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    console.warn("");
    console.warn("WARNING: Supabase is not configured.");
    console.warn("   The auto-scaler will run with reduced capability — database operations will be unavailable.");
    console.warn("   Set the following environment variables to enable full functionality:");
    console.warn("   - SUPABASE_URL");
    console.warn("   - SUPABASE_SERVICE_KEY");
    console.warn("");
  } else {
    // Test connection
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { error } = await supabase
          .from("system_logs")
          .select("id", { count: "exact", head: true })
          .limit(1);

        if (error) {
          console.warn(`[WARN] Supabase connection test returned: ${error.message}`);
          console.warn("   Service will continue but some operations may fail.");
        } else {
          console.log("[OK] Supabase connection verified");
        }
      } catch (err) {
        console.warn("[WARN] Supabase connection test failed:", err);
      }
    }
  }

  // Log startup
  await logToSystem("info", "auto-scaler", "Auto-Scaler service started", {
    config: {
      scaleUpThreshold: config.scaleUpThreshold,
      scaleDownThreshold: config.scaleDownThreshold,
      minWorkers: config.minWorkers,
      maxWorkers: config.maxWorkers,
      cooldownSeconds: config.cooldownSeconds,
      freeTierDelayThreshold: config.freeTierDelayThreshold,
      evaluationIntervalMs: config.evaluationIntervalMs,
    },
    version: "1.0.0",
    pid: process.pid,
  });

  // Handle shutdown signals
  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  // Run initial evaluation immediately
  try {
    await evaluateAndScale(config);
  } catch (err) {
    console.error("[AutoScaler] Initial evaluation failed:", err);
  }

  // Start evaluation loop
  console.log(
    `\nRunning evaluation every ${config.evaluationIntervalMs / 1000}s...`
  );

  evaluationTimer = setInterval(async () => {
    if (isShuttingDown) return;

    try {
      await evaluateAndScale(config);
    } catch (err) {
      console.error("[AutoScaler] Evaluation cycle failed:", err);
    }
  }, config.evaluationIntervalMs);

  // Periodic health check (every 5 minutes)
  const healthCheckInterval = setInterval(() => {
    if (isShuttingDown) return;

    const health = healthCheck();
    if (health.status !== "healthy") {
      console.warn(
        `[HEALTH] ${health.status.toUpperCase()} | ` +
        `Evaluations: ${health.totalEvaluations} | ` +
        `Supabase: ${health.supabaseConnected ? "connected" : "disconnected"} | ` +
        `Errors: ${health.errors.length}`
      );
    }
  }, 5 * 60 * 1000);

  // Keep the process alive
  await new Promise<void>(() => {});
}

async function handleShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("\n[SHUTDOWN] Shutdown signal received...");

  if (evaluationTimer) {
    clearInterval(evaluationTimer);
    evaluationTimer = null;
  }

  await logToSystem("info", "auto-scaler", "Auto-Scaler service shutting down", {
    totalEvaluations,
    uptime: Date.now() - startTime,
    lastDecision,
  });

  console.log("[SHUTDOWN] Auto-Scaler service stopped");
  process.exit(0);
}

// ---- Start ----

main().catch((err) => {
  console.error("[AutoScaler] Fatal error:", err);
  process.exit(1);
});
