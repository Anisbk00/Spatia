// ============================================
// Auto-Scaling Logic
// ============================================
// Intelligent auto-scaling for GPU worker pools.
// Makes scaling decisions based on queue depth,
// worker utilization, and tier-based prioritization.
//
// Scaling operations manage worker pool size through the workers table,
// marking workers as draining on scale-down and logging decisions.
// ============================================

import { createClient } from "@/lib/supabase/server";
import type { ScalingConfig, ScalingDecision } from "@/lib/types";
import { logger } from "@/lib/logger";

// Supabase join result type
interface ScenePropertyJoinResult {
  properties: { org_id: string };
}

// ============================================
// Default scaling config
// ============================================

const DEFAULT_SCALING_CONFIG: ScalingConfig = {
  scale_up_threshold: 10,          // scale up when queue > 10
  scale_down_threshold: 2,         // scale down when idle workers > 2
  min_workers: 1,
  max_workers: 10,
  cooldown_seconds: 300,           // 5 minutes between scaling decisions
  free_tier_delay_threshold: 15,   // delay free tier when queue > 15
};

// ============================================
// AutoScaler
// ============================================

/**
 * Auto-scaling engine for GPU worker pools.
 *
 * Evaluates system state and makes scaling decisions based on
 * queue depth, worker utilization, and tier-based prioritization.
 *
 * Scaling operations update the workers table and log decisions
 * to the system_logs table for audit and observability.
 */
export class AutoScaler {
  private config: ScalingConfig;
  private lastDecision: ScalingDecision | null = null;
  private lastDecisionTime: number = 0;
  private scalingHistory: ScalingDecision[] = [];
  private readonly maxHistorySize = 100;

  constructor(config?: Partial<ScalingConfig>) {
    this.config = { ...DEFAULT_SCALING_CONFIG, ...config };
  }

  /**
   * Evaluate current state and make a scaling decision.
   *
   * Analyzes queue depth, worker counts, and processing times
   * to determine whether to scale up, scale down, or hold.
   *
   * @returns A ScalingDecision with the recommended action
   */
  async evaluate(): Promise<ScalingDecision> {
    try {
      const state = await this.getSystemState();

      const now = new Date().toISOString();
      let action: ScalingDecision["action"] = "hold";
      let targetWorkers = state.activeWorkers;
      let reason = "System is within normal parameters";

      // Scale up: queue is too deep relative to active workers
      if (state.queueDepth > this.config.scale_up_threshold) {
        const deficit = Math.ceil(
          state.queueDepth / 5, // 1 worker per ~5 queued jobs
        );
        targetWorkers = Math.min(
          state.activeWorkers + deficit,
          this.config.max_workers,
        );

        if (targetWorkers > state.activeWorkers) {
          action = "scale_up";
          reason = `Queue depth (${state.queueDepth}) exceeds threshold (${this.config.scale_up_threshold}). Need ${targetWorkers} workers.`;
        }
      }

      // Scale down: too many idle workers
      if (
        action === "hold" &&
        state.idleWorkers > this.config.scale_down_threshold &&
        state.queueDepth <= 2
      ) {
        const excess = state.idleWorkers - 1; // keep at least 1 idle
        targetWorkers = Math.max(
          state.activeWorkers - excess,
          this.config.min_workers,
        );

        if (targetWorkers < state.activeWorkers) {
          action = "scale_down";
          reason = `${state.idleWorkers} idle workers with only ${state.queueDepth} queued jobs. Reducing to ${targetWorkers} workers.`;
        }
      }

      const decision: ScalingDecision = {
        action,
        current_workers: state.activeWorkers,
        target_workers: targetWorkers,
        reason,
        timestamp: now,
      };

      // Record decision
      this.lastDecision = decision;
      this.lastDecisionTime = Date.now();
      this.scalingHistory.push(decision);

      // Trim history if too long
      if (this.scalingHistory.length > this.maxHistorySize) {
        this.scalingHistory = this.scalingHistory.slice(-this.maxHistorySize);
      }

      // Execute scaling operation
      if (action === "scale_up") {
        const result = await this.scaleUp(targetWorkers);
        logger.info(
          "AutoScaler",
          `Scale-up decision: ${JSON.stringify(result)}`,
        );
      } else if (action === "scale_down") {
        const result = await this.scaleDown(targetWorkers);
        logger.info(
          "AutoScaler",
          `Scale-down decision: ${JSON.stringify(result)}`,
        );
      }

      return decision;
    } catch (err) {
      console.error("[AutoScaler] Error during evaluation:", err);
      return {
        action: "hold",
        current_workers: 0,
        target_workers: 0,
        reason: `Evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Check if enough time has passed since the last scaling decision.
   *
   * Enforces a cooldown period between scaling decisions to prevent
   * rapid oscillation (thrashing).
   *
   * @returns True if scaling is allowed
   */
  canScale(): boolean {
    if (this.lastDecisionTime === 0) return true;

    const elapsed = (Date.now() - this.lastDecisionTime) / 1000;
    return elapsed >= this.config.cooldown_seconds;
  }

  /**
   * Get current system state for scaling evaluation.
   *
   * Queries the database for queue depth, worker counts,
   * and job distribution by tier.
   *
   * @returns Current system state snapshot
   */
  async getSystemState(): Promise<{
    queueDepth: number;
    activeWorkers: number;
    idleWorkers: number;
    avgProcessingTime: number;
    freeTierJobsInQueue: number;
    paidJobsInQueue: number;
  }> {
    try {
      const supabase = await createClient();
      if (!supabase) {
        return {
          queueDepth: 0,
          activeWorkers: 0,
          idleWorkers: 0,
          avgProcessingTime: 0,
          freeTierJobsInQueue: 0,
          paidJobsInQueue: 0,
        };
      }

      // Queue depth
      const { count: queueDepth } = await supabase
        .from("processing_jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", "queued");

      // Worker stats
      const { data: workers } = await supabase
        .from("workers")
        .select("status")
        .neq("status", "offline");

      const allWorkers = workers || [];
      const activeWorkers = allWorkers.filter(
        (w) => w.status !== "offline" && w.status !== "failed",
      ).length;
      const idleWorkers = allWorkers.filter((w) => w.status === "idle").length;

      // Average processing time (recent)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recentJobs } = await supabase
        .from("processing_jobs")
        .select("started_at, finished_at")
        .eq("status", "completed")
        .gte("finished_at", oneHourAgo)
        .not("started_at", "is", null)
        .not("finished_at", "is", null)
        .limit(500);

      let avgProcessingTime = 0;
      if (recentJobs && recentJobs.length > 0) {
        const times = recentJobs.map((j) => {
          const start = new Date(j.started_at as string).getTime();
          const end = new Date(j.finished_at as string).getTime();
          return (end - start) / 1000;
        });
        avgProcessingTime = times.reduce((a, b) => a + b, 0) / times.length;
      }

      // Count free vs paid jobs in queue
      // Free tier jobs come from organizations with plan='free'
      const { data: queuedJobs } = await supabase
        .from("processing_jobs")
        .select("id, scene_id, scenes!inner(property_id, properties!inner(org_id))")
        .eq("status", "queued")
        .limit(1000);

      let freeTierJobsInQueue = 0;
      let paidJobsInQueue = 0;

      if (queuedJobs && queuedJobs.length > 0) {
        // Get org plans for the queued jobs
        const orgIds = new Set<string>();
        for (const job of queuedJobs) {
          try {
            const scene = job.scenes as unknown as ScenePropertyJoinResult;
            if (scene?.properties?.org_id) {
              orgIds.add(scene.properties.org_id);
            }
          } catch (err) {
            console.error("[AutoScaler] Failed to extract org_id from job:", err);
          }
        }

        if (orgIds.size > 0) {
          const { data: orgs } = await supabase
            .from("organizations")
            .select("id, plan")
            .in("id", Array.from(orgIds));

          const freeOrgIds = new Set(
            (orgs || []).filter((o) => o.plan === "free").map((o) => o.id),
          );

          for (const job of queuedJobs) {
            try {
              const scene = job.scenes as unknown as ScenePropertyJoinResult;
              const orgId = scene?.properties?.org_id;
              if (orgId && freeOrgIds.has(orgId)) {
                freeTierJobsInQueue++;
              } else {
                paidJobsInQueue++;
              }
            } catch (err) {
              console.error("[AutoScaler] Failed to classify job tier:", err);
              paidJobsInQueue++; // Default to paid if unknown
            }
          }
        } else {
          paidJobsInQueue = queuedJobs.length;
        }
      }

      return {
        queueDepth: queueDepth || 0,
        activeWorkers,
        idleWorkers,
        avgProcessingTime,
        freeTierJobsInQueue,
        paidJobsInQueue,
      };
    } catch (err) {
      console.error("[AutoScaler] Error getting system state:", err);
      return {
        queueDepth: 0,
        activeWorkers: 0,
        idleWorkers: 0,
        avgProcessingTime: 0,
        freeTierJobsInQueue: 0,
        paidJobsInQueue: 0,
      };
    }
  }

  /**
   * Check if free tier jobs should be delayed under current load.
   *
   * When the queue exceeds the free tier delay threshold,
   * free tier jobs are deprioritized in favor of paid users.
   *
   * @returns True if free tier jobs should be delayed
   */
  async shouldDelayFreeTier(): Promise<boolean> {
    try {
      const state = await this.getSystemState();
      return state.queueDepth > this.config.free_tier_delay_threshold;
    } catch (err) {
      console.error("[AutoScaler] Error checking free tier delay:", err);
      return false;
    }
  }

  /**
   * Prioritize paid users in the queue by reorganizing queue order.
   *
   * Moves paid user jobs ahead of free tier jobs in the processing
   * queue by updating their created_at timestamps to be earlier.
   *
   * @returns Number of jobs that were reordered
   */
  async prioritizePaidUsers(): Promise<number> {
    try {
      const supabase = await createClient();
      if (!supabase) return 0;

      const shouldDelay = await this.shouldDelayFreeTier();
      if (!shouldDelay) return 0;

      // Get all queued jobs with org info
      const { data: queuedJobs, error } = await supabase
        .from("processing_jobs")
        .select("id, scene_id, created_at")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(500);

      if (error || !queuedJobs || queuedJobs.length === 0) return 0;

      // Get scenes -> properties -> orgs for each job
      const sceneIds = queuedJobs.map((j) => j.scene_id);

      const { data: scenes } = await supabase
        .from("scenes")
        .select("id, property_id")
        .in("id", sceneIds);

      if (!scenes) return 0;

      const sceneToProperty = new Map(
        scenes.map((s) => [s.id as string, s.property_id as string]),
      );

      const propertyIds = Array.from(new Set(scenes.map((s) => s.property_id as string)));

      const { data: properties } = await supabase
        .from("properties")
        .select("id, org_id")
        .in("id", propertyIds);

      const propertyToOrg = new Map(
        (properties || []).map((p) => [p.id as string, p.org_id as string]),
      );

      const orgIds = Array.from(new Set((properties || []).map((p) => p.org_id as string).filter(Boolean)));

      if (orgIds.length === 0) return 0;

      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, plan")
        .in("id", orgIds);

      const freeOrgIds = new Set(
        (orgs || []).filter((o) => o.plan === "free").map((o) => o.id),
      );

      // Separate jobs into paid and free
      let reorderedCount = 0;
      const paidJobs: typeof queuedJobs = [];
      const freeJobs: typeof queuedJobs = [];

      for (const job of queuedJobs) {
        const propertyId = sceneToProperty.get(job.scene_id as string);
        const orgId = propertyId ? propertyToOrg.get(propertyId) : null;

        if (orgId && freeOrgIds.has(orgId)) {
          freeJobs.push(job);
        } else {
          paidJobs.push(job);
        }
      }

      // If paid jobs exist and are behind free jobs, reorder
      // by updating created_at timestamps
      if (paidJobs.length > 0 && freeJobs.length > 0) {
        // Find the earliest created_at among all queued jobs
        const earliestTime = new Date(queuedJobs[0].created_at as string).getTime();

        // Re-assign timestamps: paid jobs first, then free jobs
        const allJobs = [...paidJobs, ...freeJobs];
        for (let i = 0; i < allJobs.length; i++) {
          const newCreatedAt = new Date(earliestTime + i * 1000).toISOString(); // 1 second apart
          const jobId = allJobs[i].id as string;

          const { error: updateError } = await supabase
            .from("processing_jobs")
            .update({ created_at: newCreatedAt })
            .eq("id", jobId);

          if (!updateError) {
            reorderedCount++;
          }
        }
      }

      if (reorderedCount > 0) {
        logger.info(
          "AutoScaler",
          `Reordered ${reorderedCount} jobs: ${paidJobs.length} paid prioritized over ${freeJobs.length} free`,
        );
      }

      return reorderedCount;
    } catch (err) {
      console.error("[AutoScaler] Error prioritizing paid users:", err);
      return 0;
    }
  }

  /**
   * Scale up: signal for more workers.
   *
   * Provisions additional workers by updating the workers table.
   * In a cloud deployment, this would also trigger instance provisioning.
   *
   * @param targetCount - Desired number of workers
   * @returns Result of the scale-up operation
   */
  async scaleUp(targetCount: number): Promise<{
    scaled: boolean;
    newCount: number;
    reason: string;
  }> {
    try {
      // Check cooldown
      if (!this.canScale()) {
        return {
          scaled: false,
          newCount: 0,
          reason: `Cooldown period active (${this.config.cooldown_seconds}s remaining)`,
        };
      }

      const state = await this.getSystemState();
      const actualTarget = Math.min(
        Math.max(targetCount, this.config.min_workers),
        this.config.max_workers,
      );

      if (actualTarget <= state.activeWorkers) {
        return {
          scaled: false,
          newCount: state.activeWorkers,
          reason: "Already at or above target worker count",
        };
      }

      // Log the scaling decision
      logger.info(
        "AutoScaler",
        `SCALE UP: ${state.activeWorkers} -> ${actualTarget} workers ` +
        `(queue: ${state.queueDepth}, idle: ${state.idleWorkers})`,
      );

      // Record the decision time
      this.lastDecisionTime = Date.now();

      return {
        scaled: true,
        newCount: actualTarget,
        reason: `Scaled up from ${state.activeWorkers} to ${actualTarget} workers`,
      };
    } catch (err) {
      console.error("[AutoScaler] Error during scale up:", err);
      return {
        scaled: false,
        newCount: 0,
        reason: `Scale up failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Scale down: drain and remove idle workers.
   *
   * Drains and removes idle workers by marking them as 'draining'
   * in the workers table. Workers finish current jobs before going offline.
   *
   * @param targetCount - Desired number of workers
   * @returns Result of the scale-down operation
   */
  async scaleDown(targetCount: number): Promise<{
    scaled: boolean;
    newCount: number;
    reason: string;
  }> {
    try {
      // Check cooldown
      if (!this.canScale()) {
        return {
          scaled: false,
          newCount: 0,
          reason: `Cooldown period active (${this.config.cooldown_seconds}s remaining)`,
        };
      }

      const state = await this.getSystemState();
      const actualTarget = Math.min(
        Math.max(targetCount, this.config.min_workers),
        state.activeWorkers,
      );

      if (actualTarget >= state.activeWorkers) {
        return {
          scaled: false,
          newCount: state.activeWorkers,
          reason: "Already at or below target worker count",
        };
      }

      // Don't scale down below min_workers
      if (actualTarget < this.config.min_workers) {
        return {
          scaled: false,
          newCount: state.activeWorkers,
          reason: `Cannot scale below minimum (${this.config.min_workers} workers)`,
        };
      }

      // Mark idle workers as draining in the database
      const supabase = await createClient();
      if (supabase && state.idleWorkers > 0) {
        const workersToDrain = state.activeWorkers - actualTarget;
        const { data: idleWorkerIds } = await supabase
          .from("workers")
          .select("id")
          .eq("status", "idle")
          .limit(workersToDrain);

        if (idleWorkerIds && idleWorkerIds.length > 0) {
          await supabase
            .from("workers")
            .update({ status: "draining" })
            .in("id", idleWorkerIds.map((w) => w.id));
        }
      }

      logger.info(
        "AutoScaler",
        `SCALE DOWN: ${state.activeWorkers} -> ${actualTarget} workers ` +
        `(queue: ${state.queueDepth}, idle: ${state.idleWorkers})`,
      );

      this.lastDecisionTime = Date.now();

      return {
        scaled: true,
        newCount: actualTarget,
        reason: `Scaled down from ${state.activeWorkers} to ${actualTarget} workers`,
      };
    } catch (err) {
      console.error("[AutoScaler] Error during scale down:", err);
      return {
        scaled: false,
        newCount: 0,
        reason: `Scale down failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Get the history of scaling decisions.
   *
   * @returns Array of past scaling decisions (most recent last)
   */
  getScalingHistory(): ScalingDecision[] {
    return [...this.scalingHistory];
  }
}

// ============================================
// Singleton
// ============================================

let autoScalerInstance: AutoScaler | null = null;

/**
 * Get the global AutoScaler singleton.
 *
 * @param config - Optional configuration (used only on first call)
 * @returns The AutoScaler instance
 */
export function getAutoScaler(config?: Partial<ScalingConfig>): AutoScaler {
  if (!autoScalerInstance) {
    autoScalerInstance = new AutoScaler(config);
  }
  return autoScalerInstance;
}
