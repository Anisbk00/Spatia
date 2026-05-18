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
//     4. Prioritize paid users in queue (metadata.priority_order)
//     5. Delay free-tier jobs if overloaded (metadata.priority_order)
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

/**
 * Load configuration from environment variables with validation.
 * Throws if validation fails — the service should not start with bad config.
 */
function loadConfig(): ScalerConfig {
  const scaleUpThreshold = parseInt(process.env.SCALE_UP_THRESHOLD || "10", 10);
  const scaleDownThreshold = parseInt(process.env.SCALE_DOWN_THRESHOLD || "2", 10);
  const minWorkers = parseInt(process.env.MIN_WORKERS || "1", 10);
  const maxWorkers = parseInt(process.env.MAX_WORKERS || "10", 10);
  const cooldownSeconds = parseInt(process.env.COOLDOWN_SECONDS || "300", 10);
  const freeTierDelayThreshold = parseInt(process.env.FREE_TIER_DELAY_THRESHOLD || "15", 10);
  const evaluationIntervalMs = parseInt(process.env.EVALUATION_INTERVAL_MS || "60000", 10);
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || "";

  // --- Validation ---
  const numericFields: Record<string, number> = {
    SCALE_UP_THRESHOLD: scaleUpThreshold,
    SCALE_DOWN_THRESHOLD: scaleDownThreshold,
    MIN_WORKERS: minWorkers,
    MAX_WORKERS: maxWorkers,
    COOLDOWN_SECONDS: cooldownSeconds,
    FREE_TIER_DELAY_THRESHOLD: freeTierDelayThreshold,
    EVALUATION_INTERVAL_MS: evaluationIntervalMs,
  };

  for (const [name, value] of Object.entries(numericFields)) {
    if (isNaN(value) || !isFinite(value) || value < 0) {
      throw new Error(
        `Invalid configuration: ${name} must be a positive number, got ${process.env[name] || "undefined"}`
      );
    }
  }

  if (scaleUpThreshold <= scaleDownThreshold) {
    throw new Error(
      `Invalid configuration: SCALE_UP_THRESHOLD (${scaleUpThreshold}) must be greater than SCALE_DOWN_THRESHOLD (${scaleDownThreshold})`
    );
  }

  if (minWorkers > maxWorkers) {
    throw new Error(
      `Invalid configuration: MIN_WORKERS (${minWorkers}) must be less than or equal to MAX_WORKERS (${maxWorkers})`
    );
  }

  return {
    scaleUpThreshold,
    scaleDownThreshold,
    minWorkers,
    maxWorkers,
    cooldownSeconds,
    freeTierDelayThreshold,
    evaluationIntervalMs,
    supabaseUrl,
    supabaseServiceKey,
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
// Structured Logging
// ============================================

/**
 * Emit a structured JSON log line to stdout.
 * All fields are included: timestamp, level, source, message, context.
 */
function structuredLog(
  level: "debug" | "info" | "warn" | "error" | "fatal",
  source: string,
  message: string,
  context: Record<string, unknown> = {}
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    source,
    message,
    ...context,
  };

  const jsonLine = JSON.stringify(entry);

  switch (level) {
    case "error":
    case "fatal":
      console.error(jsonLine);
      break;
    case "warn":
      console.warn(jsonLine);
      break;
    default:
      console.log(jsonLine);
  }
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
    structuredLog("error", "auto-scaler", "Failed to create Supabase client", {
      error: err instanceof Error ? err.message : String(err),
    });
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

        let orgPlanMap = new Map<string, string>();

        if (orgIds.length > 0) {
          const { data: orgs } = await supabase
            .from("organizations")
            .select("id, plan")
            .in("id", orgIds);

          orgPlanMap = new Map(
            ((orgs as OrgRow[]) || []).map((o) => [o.id, o.plan || "free"])
          );
        }

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
    structuredLog("error", "auto-scaler", "Error getting system state", {
      error: err instanceof Error ? err.message : String(err),
    });
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
  // Always emit structured JSON log to console
  structuredLog(level, source, message, metadata);

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
    structuredLog("error", "auto-scaler", "Failed to write system_log entry", {
      error: err instanceof Error ? err.message : String(err),
      originalMessage: message,
    });
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
  structuredLog("info", "auto-scaler", "SCALE UP decision", {
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
  structuredLog("info", "auto-scaler", "SCALE DOWN decision", {
    action: "scale_down",
    currentWorkers: state.activeWorkers,
    targetWorkers: actualTarget,
    workersToRemove,
    queueDepth: state.queueDepth,
    idleWorkers: state.idleWorkers,
    drainingWorkers: state.drainingWorkers,
    simulated: true,
  });

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

        structuredLog("info", "auto-scaler", "Marked idle workers as draining", {
          count: workerIds.length,
        });
      }
    } catch (err) {
      structuredLog("error", "auto-scaler", "Error marking workers as draining", {
        error: err instanceof Error ? err.message : String(err),
      });
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

// ============================================
// Priority Queue — uses metadata.priority_order
// ============================================

/**
 * High priority_order value used to push free-tier delayed jobs to the
 * back of the queue. Consumers should order ASC by priority_order,
 * so larger values are processed last.
 */
const FREE_TIER_DELAY_PRIORITY_OFFSET = 100_000;

/**
 * Resolve job → scene → property → org → plan for a set of queued jobs.
 * Returns a Map<jobId, tier> and the fetched org plan map.
 */
async function resolveJobTiers(
  typedQueuedJobs: ProcessingJobRow[]
): Promise<{
  jobTierMap: Map<string, string>;
  freeOrgIds: Set<string>;
}> {
  const supabase = getSupabase();
  if (!supabase) {
    // Treat all as free tier
    return {
      jobTierMap: new Map(typedQueuedJobs.map((j) => [j.id, "free"])),
      freeOrgIds: new Set(),
    };
  }

  const jobTierMap = new Map<string, string>();
  const freeOrgIds = new Set<string>();

  // Default: all jobs are free tier
  for (const job of typedQueuedJobs) {
    jobTierMap.set(job.id, "free");
  }

  // Resolve scene → property → org → plan
  const sceneIds = typedQueuedJobs.map((j) => j.scene_id);

  const { data: scenes } = await supabase
    .from("scenes")
    .select("id, property_id")
    .in("id", sceneIds);

  if (!scenes || scenes.length === 0) {
    return { jobTierMap, freeOrgIds };
  }

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

  let orgPlanMap = new Map<string, string>();

  if (orgIds.length > 0) {
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, plan")
      .in("id", orgIds);

    const allOrgs = ((orgs as OrgRow[]) || []).map((o) => ({
      id: o.id,
      plan: o.plan || "free",
    }));

    orgPlanMap = new Map(allOrgs.map((o) => [o.id, o.plan]));

    for (const org of allOrgs) {
      if (org.plan === "free") {
        freeOrgIds.add(org.id);
      }
    }
  }

  // Assign tiers
  for (const job of typedQueuedJobs) {
    const propertyId = sceneToProperty.get(job.scene_id);
    const orgId = propertyId ? propertyToOrg.get(propertyId) : null;
    const plan = orgId ? orgPlanMap.get(orgId) || "free" : "free";
    jobTierMap.set(job.id, plan);
  }

  return { jobTierMap, freeOrgIds };
}

/**
 * Prioritize paid users in the queue using metadata.priority_order.
 *
 * Reorders queued jobs so that business tier jobs are processed first,
 * then pro tier jobs, then free tier jobs.
 *
 * Uses metadata.priority_order for ordering. The created_at column is
 * NEVER mutated — the original creation timestamp is preserved as the
 * audit trail. original_created_at is also stored in metadata for
 * redundancy (in case a prior version of this service mutated created_at).
 *
 * @returns Number of jobs that were reordered
 */
async function prioritizePaidUsers(
  state: SystemState,
  config: ScalerConfig
): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;

  try {
    // Get all queued jobs ordered by creation time
    const { data: queuedJobs, error } = await supabase
      .from("processing_jobs")
      .select("id, scene_id, created_at, metadata")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(500);

    if (error || !queuedJobs || queuedJobs.length === 0) return 0;
    const typedQueuedJobs = queuedJobs as ProcessingJobRow[];

    // Resolve tiers for all jobs
    const { jobTierMap } = await resolveJobTiers(typedQueuedJobs);

    // Categorize jobs by tier
    type TieredJob = {
      id: string;
      created_at: string;
      metadata: Record<string, unknown> | null;
      tier: string;
    };
    const businessJobs: TieredJob[] = [];
    const proJobs: TieredJob[] = [];
    const freeJobs: TieredJob[] = [];

    for (const job of typedQueuedJobs) {
      const tier = jobTierMap.get(job.id) || "free";

      const tieredJob: TieredJob = {
        id: job.id,
        created_at: job.created_at,
        metadata: job.metadata,
        tier,
      };

      if (tier === "business") {
        businessJobs.push(tieredJob);
      } else if (tier === "pro") {
        proJobs.push(tieredJob);
      } else {
        freeJobs.push(tieredJob);
      }
    }

    // Build the desired order: business → pro → free (preserving FIFO within each tier)
    const desiredOrder: TieredJob[] = [
      ...businessJobs.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
      ...proJobs.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
      ...freeJobs.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    ];

    // Check if current order matches desired order
    const currentOrder = typedQueuedJobs.map((j) => j.id);
    const desiredIdOrder = desiredOrder.map((j) => j.id);
    const needsReorder = currentOrder.some((id, idx) => id !== desiredIdOrder[idx]);

    if (!needsReorder) return 0;

    // Assign priority_order values (lower = higher priority)
    let reorderedCount = 0;

    for (let i = 0; i < desiredOrder.length; i++) {
      const job = desiredOrder[i];
      const existingMeta = (job.metadata as Record<string, unknown>) || {};

      // Skip if this job was already assigned this exact priority_order
      if (existingMeta.priority_order === i && existingMeta.original_created_at) {
        reorderedCount++;
        continue;
      }

      const { error: updateError } = await supabase
        .from("processing_jobs")
        .update({
          metadata: {
            ...existingMeta,
            priority_order: i,
            original_created_at:
              existingMeta.original_created_at || job.created_at,
            tier: job.tier,
          },
        })
        .eq("id", job.id);

      if (!updateError) {
        reorderedCount++;
      }
    }

    if (reorderedCount > 0) {
      structuredLog("info", "auto-scaler", "Queue prioritization applied", {
        reorderedCount,
        businessJobs: businessJobs.length,
        proJobs: proJobs.length,
        freeJobs: freeJobs.length,
        queueDepth: state.queueDepth,
      });

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
    structuredLog("error", "auto-scaler", "Error prioritizing paid users", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/**
 * Delay free-tier jobs when the queue is overloaded.
 *
 * When queue depth exceeds the free tier delay threshold, this function
 * pushes free-tier jobs to the back of the queue by setting a high
 * metadata.priority_order value. Uses a single batched update for
 * all free-tier jobs.
 *
 * Jobs without an org association are treated as free tier and delayed.
 *
 * @returns Number of free-tier jobs that were delayed
 */
async function delayFreeTierJobs(
  state: SystemState,
  config: ScalerConfig
): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;

  try {
    // Only delay when queue exceeds the threshold
    if (state.queueDepth <= config.freeTierDelayThreshold) {
      return 0;
    }

    // Get free-tier queued jobs (fetch metadata + created_at for preservation)
    const { data: queuedJobs } = await supabase
      .from("processing_jobs")
      .select("id, scene_id, created_at, metadata")
      .eq("status", "queued")
      .limit(500);

    if (!queuedJobs || queuedJobs.length === 0) return 0;
    const typedQueuedJobs = queuedJobs as ProcessingJobRow[];

    // Resolve tiers
    const { jobTierMap, freeOrgIds } = await resolveJobTiers(typedQueuedJobs);

    // Identify free-tier jobs that haven't been delayed yet
    // Jobs without an org association (orgId is null/undefined) are also free tier
    const freeJobIds: string[] = [];
    for (const job of typedQueuedJobs) {
      const tier = jobTierMap.get(job.id) || "free";

      if (tier === "free") {
        // Check if already delayed (avoid re-delaying)
        const metadata = (job.metadata as Record<string, unknown>) || {};
        if (!metadata.delayed) {
          freeJobIds.push(job.id);
        }
      }
    }

    if (freeJobIds.length === 0) return 0;

    // Calculate delay duration
    const delayDurationMs = Math.min(
      (state.queueDepth - config.freeTierDelayThreshold) * 5000, // 5s extra per job over threshold
      120000 // Max 2 minutes additional delay
    );

    // Compute a single high priority_order for all free-tier delayed jobs
    // This pushes them to the back of the queue. Among free-tier delayed
    // jobs, relative ordering is determined by created_at (fallback).
    const delayedPriorityOrder = state.queueDepth + FREE_TIER_DELAY_PRIORITY_OFFSET;

    // Batch update: all free-tier delayed jobs get the same metadata
    const { error: updateError } = await supabase
      .from("processing_jobs")
      .update({
        metadata: {
          priority_order: delayedPriorityOrder,
          delayed: true,
          delay_until: new Date(Date.now() + delayDurationMs).toISOString(),
          delay_reason: `Queue overloaded (${state.queueDepth} jobs, threshold: ${config.freeTierDelayThreshold})`,
          delay_duration_ms: delayDurationMs,
        },
      })
      .in("id", freeJobIds);

    const delayedCount = updateError ? 0 : freeJobIds.length;

    if (delayedCount > 0) {
      structuredLog("info", "auto-scaler", "Free-tier jobs delayed", {
        delayedCount,
        delayDurationMs,
        queueDepth: state.queueDepth,
        threshold: config.freeTierDelayThreshold,
        freeTierJobsInQueue: state.freeTierJobsInQueue,
        paidJobsInQueue: state.paidJobsInQueue,
      });

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
    structuredLog("error", "auto-scaler", "Error delaying free-tier jobs", {
      error: err instanceof Error ? err.message : String(err),
    });
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

/**
 * Perform a health check that actually verifies database connectivity
 * by executing a real query (SELECT count on processing_jobs).
 */
async function healthCheck(): Promise<HealthStatus> {
  const uptime = Date.now() - startTime;
  const errors = [...recentErrors];

  let supabaseConnected = false;
  const supabase = getSupabase();
  if (supabase) {
    try {
      // Execute a real query to verify connectivity
      const { error } = await supabase
        .from("processing_jobs")
        .select("id", { count: "exact", head: true })
        .limit(1);

      supabaseConnected = !error;

      if (error) {
        structuredLog("warn", "auto-scaler", "Health check database query failed", {
          error: error.message,
        });
      }
    } catch (err) {
      supabaseConnected = false;
      structuredLog("warn", "auto-scaler", "Health check database connectivity error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
    const cooldownActive =
      lastDecisionTime > 0 && elapsedSinceLastDecision < config.cooldownSeconds;

    let action: ScalingDecision["action"] = "hold";
    let targetWorkers = state.activeWorkers;
    let reason = "System is within normal parameters";

    // 3. SCALE UP: queue > scaleUpThreshold AND workers < maxWorkers
    if (
      state.queueDepth > config.scaleUpThreshold &&
      state.activeWorkers < config.maxWorkers
    ) {
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

    // 6. Prioritize paid user jobs in queue (sets metadata.priority_order for all jobs)
    //    Always run so that previously-delayed jobs get restored to normal priority
    //    when the system is no longer overloaded.
    await prioritizePaidUsers(state, config);

    // 7. If queue > freeTierDelayThreshold: delay free-tier jobs
    //    Runs AFTER prioritize so it can push free-tier jobs even further back.
    if (state.queueDepth > config.freeTierDelayThreshold) {
      await delayFreeTierJobs(state, config);
    }

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

    // Console summary (human-readable)
    const actionTag =
      action === "scale_up"
        ? "UP  "
        : action === "scale_down"
          ? "DOWN"
          : "HOLD";

    structuredLog("info", "auto-scaler", "Evaluation cycle complete", {
      action,
      workers: `${state.activeWorkers}→${targetWorkers}`,
      queue: state.queueDepth,
      idle: state.idleWorkers,
      paid: state.paidJobsInQueue,
      free: state.freeTierJobsInQueue,
      avgTimeSeconds: Math.round(state.avgProcessingTimeSeconds),
    });

    return decision;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    recentErrors.push(`[${lastEvaluationAt}] ${errorMsg}`);
    if (recentErrors.length > MAX_ERRORS) {
      recentErrors.shift();
    }

    structuredLog("error", "auto-scaler", "Evaluation error", {
      error: errorMsg,
    });

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
let evaluationTimer: ReturnType<typeof setTimeout> | null = null;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Schedule the next evaluation using setTimeout.
 * After each evaluation completes, the next one is scheduled.
 * This prevents overlap when an evaluation takes longer than the interval.
 */
function scheduleEvaluation(config: ScalerConfig): void {
  if (isShuttingDown) return;

  evaluationTimer = setTimeout(async () => {
    if (isShuttingDown) return;

    try {
      await evaluateAndScale(config);
    } catch (err) {
      structuredLog("error", "auto-scaler", "Evaluation cycle failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Schedule next evaluation after this one completes
    scheduleEvaluation(config);
  }, config.evaluationIntervalMs);
}

async function main() {
  let config: ScalerConfig;
  try {
    config = loadConfig();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    structuredLog("fatal", "auto-scaler", "Configuration validation failed — service cannot start", {
      error: errorMsg,
    });
    process.exit(1);
    return; // TypeScript unreachable, but good practice
  }

  structuredLog("info", "auto-scaler", "Auto-Scaler service starting", {
    version: "1.0.0",
    pid: process.pid,
    config: {
      scaleUpThreshold: config.scaleUpThreshold,
      scaleDownThreshold: config.scaleDownThreshold,
      minWorkers: config.minWorkers,
      maxWorkers: config.maxWorkers,
      cooldownSeconds: config.cooldownSeconds,
      freeTierDelayThreshold: config.freeTierDelayThreshold,
      evaluationIntervalMs: config.evaluationIntervalMs,
      supabaseConfigured: !!(config.supabaseUrl && config.supabaseServiceKey),
    },
  });

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
    console.warn(
      "   The auto-scaler will run with reduced capability — database operations will be unavailable."
    );
    console.warn("   Set the following environment variables to enable full functionality:");
    console.warn("   - SUPABASE_URL");
    console.warn("   - SUPABASE_SERVICE_KEY");
    console.warn("");
  } else {
    // Test connection — verify the system_logs table is accessible
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { error } = await supabase
          .from("system_logs")
          .select("id", { count: "exact", head: true })
          .limit(1);

        if (error) {
          structuredLog("warn", "auto-scaler", "Startup validation failed — system_logs table may not exist or service key lacks permission", {
            error: error.message,
            code: error.code,
            hint: "Verify that (1) the 'system_logs' table exists in Supabase, (2) the service key has SELECT/INSERT permissions on it, and (3) Row Level Security policies allow the service role to access it. The auto-scaler will continue but logging to the database will fail.",
          });
          console.warn(
            `[WARN] Startup validation failed: system_logs table returned error: "${error.message}" (code: ${error.code})`
          );
          console.warn(
            "   This usually means the 'system_logs' table does not exist, or the service key lacks permission."
          );
          console.warn(
            "   The auto-scaler will continue running, but database logging will be unavailable."
          );
        } else {
          structuredLog("info", "auto-scaler", "Supabase connection verified", {
            table: "system_logs",
          });
          console.log("[OK] Supabase connection verified");
        }
      } catch (err) {
        structuredLog("warn", "auto-scaler", "Startup validation — Supabase connection test threw an exception", {
          error: err instanceof Error ? err.message : String(err),
          hint: "Check network connectivity and Supabase URL. The auto-scaler will continue with reduced capability.",
        });
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
    structuredLog("error", "auto-scaler", "Initial evaluation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Start evaluation loop using self-scheduling setTimeout (prevents drift/overlap)
  console.log(
    `\nRunning evaluation every ${config.evaluationIntervalMs / 1000}s...`
  );

  scheduleEvaluation(config);

  // Periodic health check (every 5 minutes)
  healthCheckTimer = setInterval(async () => {
    if (isShuttingDown) return;

    const health = await healthCheck();
    if (health.status !== "healthy") {
      structuredLog("warn", "auto-scaler", "Periodic health check", {
        status: health.status,
        evaluations: health.totalEvaluations,
        supabaseConnected: health.supabaseConnected,
        errorCount: health.errors.length,
      });
    }
  }, 5 * 60 * 1000);

  // Keep the process alive
  await new Promise<void>(() => {});
}

async function handleShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  structuredLog("info", "auto-scaler", "Shutdown signal received");

  if (evaluationTimer) {
    clearTimeout(evaluationTimer);
    evaluationTimer = null;
  }

  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }

  await logToSystem("info", "auto-scaler", "Auto-Scaler service shutting down", {
    totalEvaluations,
    uptime: Date.now() - startTime,
    lastDecision,
  });

  structuredLog("info", "auto-scaler", "Auto-Scaler service stopped", {
    totalEvaluations,
    uptime: Date.now() - startTime,
  });

  process.exit(0);
}

// ---- Start ----

main().catch((err) => {
  structuredLog("fatal", "auto-scaler", "Fatal error on startup", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
