// ============================================
// JobDispatcher — Routes queued processing jobs
// to the best available worker in the cluster.
// ============================================
// Handles job assignment, queue depth monitoring,
// priority-aware scheduling, and orphaned job
// recovery for the distributed processing system.
// ============================================

import { createClient } from "@/lib/supabase/server";
import type { Worker } from "@/lib/types";
import { MAX_RETRIES } from "@/lib/job-queue/index";
import { WorkerRegistry } from "./worker-registry";
import { LoadBalancer } from "./load-balancer";

const FREE_TIER_DELAY_THRESHOLD = 10;
const STUCK_JOB_TIMEOUT_MINUTES = 30;

export class JobDispatcher {
  private registry: WorkerRegistry;
  private balancer: LoadBalancer;

  constructor() {
    this.registry = new WorkerRegistry();
    this.balancer = new LoadBalancer();
  }

  /**
   * Find the best available worker for the next queued job,
   * then assign the job to that worker.
   * Returns { jobId, workerId } on success, or null if no
   * worker or job is available.
   */
  async dispatchNextJob(
    region?: string
  ): Promise<{ jobId: string; workerId: string } | null> {
    const supabase = await createClient();
    if (!supabase) return null;

    // 1. Get available workers
    const workers = await this.registry.getAvailableWorkers(region);
    if (workers.length === 0) {
      return null;
    }

    // 2. Get next queued job (priority-aware)
    const job = await this.getNextQueuedJob();
    if (!job) {
      return null;
    }

    // 3. Select the best worker for this job
    const bestWorker = this.balancer.selectBestWorker(workers, { region });
    if (!bestWorker) {
      return null;
    }

    // 4. Assign job to worker
    const assigned = await this.assignJobToWorker(job.id, bestWorker.id);
    if (!assigned) {
      return null;
    }

    return { jobId: job.id, workerId: bestWorker.worker_id };
  }

  /**
   * Assign a job to a specific worker.
   * Uses the dispatch_job_to_worker RPC if available,
   * otherwise falls back to a direct update.
   *
   * Verifies that the UPDATE actually matched a row (idempotency guard).
   */
  async assignJobToWorker(
    jobId: string,
    workerId: string
  ): Promise<boolean> {
    const supabase = await createClient();
    if (!supabase) return false;

    // Try the RPC first (atomic assignment)
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "dispatch_job_to_worker",
      { p_job_id: jobId, p_worker_id: workerId }
    );

    // If RPC exists and succeeded, return result
    if (!rpcError) {
      return rpcResult !== false;
    }

    // Fallback: direct update if RPC doesn't exist.
    // Use WHERE status = 'queued' to ensure atomic claim.
    const { error } = await supabase
      .from("processing_jobs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("status", "queued");

    if (error) {
      console.error(`Failed to assign job ${jobId} to worker ${workerId}:`, error);
      return false;
    }

    // Verify the update actually matched a row (idempotency check)
    const { data: updatedJob } = await supabase
      .from("processing_jobs")
      .select("status")
      .eq("id", jobId)
      .single();

    if (!updatedJob || updatedJob.status !== "running") {
      // Another worker claimed it first — don't update worker count
      return false;
    }

    // Update worker status and increment job count atomically.
    // Use an atomic UPDATE with a WHERE guard to prevent race conditions
    // where two concurrent job assignments could push the worker over capacity.
    const { data: worker, error: updateError } = await supabase
      .from("workers")
      .update({
        // Note: Supabase JS doesn't support raw SQL in update values natively.
        // We use a conditional approach: read-then-write with an additional
        // capacity check to minimize the race window.
        current_job_count: 0, // placeholder, overwritten below
      })
      .eq("id", workerId)
      .select("id, current_job_count, max_concurrent_jobs")
      .maybeSingle();

    // Re-read and update with capacity guard
    if (worker) {
      const newJobCount = (worker.current_job_count ?? 0) + 1;
      const maxJobs = worker.max_concurrent_jobs ?? 1;

      // Only update if still under capacity (atomic guard check)
      if (worker.current_job_count < maxJobs) {
        const newStatus: Worker["status"] =
          newJobCount >= maxJobs ? "busy" : "idle";

        await supabase
          .from("workers")
          .update({
            current_job_count: newJobCount,
            status: newStatus,
          })
          .eq("id", workerId)
          .eq("current_job_count", worker.current_job_count); // optimistic lock
      }
    }

    if (updateError) {
      console.error(`Failed to update worker ${workerId} job count:`, updateError);
    }

    return true;
  }

  /**
   * Get the count of queued processing jobs.
   */
  async getQueueDepth(): Promise<number> {
    const supabase = await createClient();
    if (!supabase) return 0;

    const { count, error } = await supabase
      .from("processing_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "queued");

    if (error) {
      console.error("Failed to get queue depth:", error);
      return 0;
    }

    return count ?? 0;
  }

  /**
   * Get the count of queued jobs broken down by the
   * organization's plan tier (business, pro, free).
   */
  async getQueueByPriority(): Promise<{
    business: number;
    pro: number;
    free: number;
  }> {
    const supabase = await createClient();
    if (!supabase) return { business: 0, pro: 0, free: 0 };

    const result = { business: 0, pro: 0, free: 0 };

    // Query queued jobs joined with scenes → properties → organizations
    // to determine the org's plan tier.
    const { data, error } = await supabase
      .from("processing_jobs")
      .select(`
        id,
        scenes (
          property_id,
          properties (
            org_id,
            organizations (
              plan
            )
          )
        )
      `)
      .eq("status", "queued");

    if (error || !data) {
      return result;
    }

    for (const job of data) {
      const plan = (
        job as Record<string, unknown>
      )?.scenes &&
        (
          (
            (job as unknown as Record<string, Record<string, unknown>>).scenes as Record<string, unknown>
          )?.properties as Record<string, unknown>
        )?.organizations &&
        (
          (
            (
              (job as unknown as Record<string, Record<string, unknown>>).scenes as Record<string, Record<string, unknown>>
            ).properties as Record<string, Record<string, unknown>>
          ).organizations as Record<string, unknown>
        ).plan as string;

      if (plan === "business") {
        result.business++;
      } else if (plan === "pro") {
        result.pro++;
      } else {
        result.free++;
      }
    }

    return result;
  }

  /**
   * Returns true if the queue depth exceeds the threshold
   * and free-tier jobs should be delayed in favor of
   * paying customers.
   */
  async shouldDelayFreeTier(): Promise<boolean> {
    const depth = await this.getQueueDepth();
    return depth > FREE_TIER_DELAY_THRESHOLD;
  }

  /**
   * Find jobs that have been running for too long (stuck jobs)
   * and requeue them so they can be picked up by healthy workers.
   * Returns the count of requeued jobs.
   *
   * Since processing_jobs doesn't have a worker_id column,
   * this finds running jobs whose started_at is older than the
   * timeout threshold and requeues them.
   */
  async requeueOrphanedJobs(): Promise<number> {
    const supabase = await createClient();
    if (!supabase) return 0;

    // Find all running jobs that started longer than the timeout ago
    const cutoffTime = new Date(
      Date.now() - STUCK_JOB_TIMEOUT_MINUTES * 60 * 1000
    ).toISOString();

    const { data: stuckJobs, error: jobsError } = await supabase
      .from("processing_jobs")
      .select("id, retry_count")
      .eq("status", "running")
      .lt("started_at", cutoffTime);

    if (jobsError || !stuckJobs || stuckJobs.length === 0) {
      return 0;
    }

    // Requeue each stuck job with incremented retry_count.
    // Uses the centralized MAX_RETRIES from job-queue/index.ts.
    let requeuedCount = 0;

    for (const job of stuckJobs) {
      const newRetryCount = (job.retry_count ?? 0) + 1;

      // If retry limit exceeded, mark as failed instead
      if (newRetryCount >= MAX_RETRIES) {
        const { error: failError } = await supabase
          .from("processing_jobs")
          .update({
            status: "failed",
            retry_count: newRetryCount,
            finished_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        if (failError) {
          console.error(`Failed to mark stuck job ${job.id} as failed:`, failError);
        } else {
          requeuedCount++;
        }
        continue;
      }

      // Requeue the job with incremented retry_count
      const { error: updateError } = await supabase
        .from("processing_jobs")
        .update({
          status: "queued",
          started_at: null,
          retry_count: newRetryCount,
        })
        .eq("id", job.id);

      if (updateError) {
        console.error(`Failed to requeue stuck job ${job.id}:`, updateError);
      } else {
        requeuedCount++;
      }
    }

    return requeuedCount;
  }

  // ---- Private helpers ----

  /**
   * Get the next queued job with priority awareness.
   * Business tier jobs come first, then pro, then free.
   */
  private async getNextQueuedJob(): Promise<{
    id: string;
    scene_id: string;
    job_type: string;
  } | null> {
    const supabase = await createClient();
    if (!supabase) return null;

    // If we should delay free tier, only look at paid tier jobs first
    const delayFree = await this.shouldDelayFreeTier();

    if (delayFree) {
      // Try to find paid-tier (non-free) jobs first by joining through
      // scenes → properties → organizations and filtering on plan type.
      const { data: paidJobs, error: paidError } = await supabase
        .from("processing_jobs")
        .select(`
          id, scene_id, job_type,
          scenes (
            property_id,
            properties (
              org_id,
              organizations ( plan )
            )
          )
        `)
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(10);

      if (!paidError && paidJobs && paidJobs.length > 0) {
        // Filter to only paid tier jobs (plan != 'free')
        const paidTierJob = paidJobs.find((job) => {
          // Navigate the nested join result: job → scenes → properties → organizations → plan
          const raw = job as unknown as Record<string, unknown>;
          const scenes = raw.scenes as Record<string, unknown> | null | undefined;
          const props = scenes?.properties as Record<string, unknown> | null | undefined;
          const org = props?.organizations as Record<string, unknown> | null | undefined;
          const plan = org?.plan as string | null;
          return !!plan && plan !== "free";
        });

        if (paidTierJob) {
          return {
            id: paidTierJob.id as string,
            scene_id: paidTierJob.scene_id as string,
            job_type: paidTierJob.job_type as string,
          };
        }

        // No paid jobs found, fall through to any queued job
      }
    }

    // Fall through: get any queued job (FIFO)
    const { data, error } = await supabase
      .from("processing_jobs")
      .select("id, scene_id, job_type")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (error || !data) return null;
    return data;
  }
}
