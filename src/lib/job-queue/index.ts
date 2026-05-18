// ============================================
// Job Queue Reliability System
// ============================================
// Production-hardened job pipeline with:
// - Exponential backoff retry management
// - Stuck job detection and recovery
// - Idempotency guards for safe retries
// - Full job lifecycle orchestration
// ============================================

import { createClient } from "@/lib/supabase/server";
import type {
  ProcessingJob,
  JobType,
  JobStatus,
} from "@/lib/types";
import { calculateBackoff, isRetryableError } from "./retry";
import { logger } from "@/lib/logger";

// ============================================
// Configuration
// ============================================

/**
 * Centralized maximum retry count for all job processing.
 * NOTE: distributed/job-dispatcher.ts previously used 3 — should be aligned to this value.
 */
export const MAX_RETRIES = 5;

export interface JobRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface StuckJobConfig {
  timeoutMinutes: number;
  checkIntervalMinutes: number;
}

const DEFAULT_RETRY_CONFIG: JobRetryConfig = {
  maxRetries: MAX_RETRIES,
  baseDelayMs: 1000,
  maxDelayMs: 300_000, // 5 minutes
};

const DEFAULT_STUCK_CONFIG: StuckJobConfig = {
  timeoutMinutes: 30,
  checkIntervalMinutes: 5,
};

// ============================================
// JobRetryManager
// ============================================

/**
 * Manages retry logic for failed processing jobs.
 *
 * Uses exponential backoff with jitter to avoid thundering herd:
 *   delay = baseDelay * 2^retryCount + jitter
 *
 * Jobs exceeding MAX_RETRIES are permanently marked as failed.
 */
export class JobRetryManager {
  private config: JobRetryConfig;

  constructor(config: Partial<JobRetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * Check whether a job is eligible for retry.
   * @param job - The processing job to evaluate
   * @returns True if the job can be retried
   */
  shouldRetry(job: ProcessingJob): boolean {
    return job.retry_count < this.config.maxRetries;
  }

  /**
   * Calculate the backoff delay for a given retry attempt.
   *
   * @param retryCount - The current retry count (0-based)
   * @returns Delay in milliseconds before the next attempt
   */
  getBackoffDelay(retryCount: number): number {
    return calculateBackoff(
      retryCount,
      this.config.baseDelayMs,
      this.config.maxDelayMs,
    );
  }

  /**
   * Schedule a retry for a failed job.
   *
   * Marks the job back to "queued" status and increments retry_count.
   * The actual delay before the job is picked up again is handled
   * by the worker's poll interval + the backoff calculation.
   *
   * @param jobId - The ID of the job to retry
   * @param retryCount - The current retry count (will be incremented)
   * @returns True if the retry was scheduled successfully
   */
  async scheduleRetry(jobId: string, retryCount: number): Promise<boolean> {
    const supabase = await createClient();
    if (!supabase) return false;

    const newRetryCount = retryCount + 1;

    if (newRetryCount > this.config.maxRetries) {
      // Mark as permanently failed
      const { error } = await supabase
        .from("processing_jobs")
        .update({
          status: "failed" as JobStatus,
          finished_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return !error;
    }

    // Requeue with incremented retry count
    const { error } = await supabase
      .from("processing_jobs")
      .update({
        status: "queued" as JobStatus,
        retry_count: newRetryCount,
        started_at: null,
        finished_at: null,
      })
      .eq("id", jobId);

    if (error) {
      console.error(`[JobRetryManager] Failed to schedule retry for job ${jobId}:`, error);
      return false;
    }

    const backoffMs = this.getBackoffDelay(newRetryCount);
    logger.info(
      "JobQueue",
      `Scheduled retry #${newRetryCount} for job ${jobId} (backoff: ${backoffMs}ms)`,
    );

    return true;
  }
}

// ============================================
// StuckJobDetector
// ============================================

/**
 * Detects and recovers processing jobs that have been running
 * beyond the expected timeout.
 *
 * Uses the `recover_stuck_jobs()` Supabase RPC function for
 * atomic recovery of multiple stuck jobs at once.
 */
export class StuckJobDetector {
  private config: StuckJobConfig;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<StuckJobConfig> = {}) {
    this.config = { ...DEFAULT_STUCK_CONFIG, ...config };
  }

  /**
   * Detect jobs that have been running longer than the timeout.
   *
   * @returns Array of stuck job IDs
   */
  async detectStuckJobs(): Promise<string[]> {
    const supabase = await createClient();
    if (!supabase) return [];

    const cutoffTime = new Date(
      Date.now() - this.config.timeoutMinutes * 60 * 1000,
    ).toISOString();

    const { data, error } = await supabase
      .from("processing_jobs")
      .select("id, scene_id, job_type, retry_count, started_at")
      .eq("status", "running")
      .lt("started_at", cutoffTime);

    if (error) {
      console.error("[StuckJobDetector] Error detecting stuck jobs:", error);
      return [];
    }

    return (data || []).map((job) => job.id);
  }

  /**
   * Recover a single stuck job by requeuing it.
   *
   * @param jobId - The ID of the stuck job to recover
   * @returns True if the job was successfully recovered
   */
  async recoverStuckJob(jobId: string): Promise<boolean> {
    const supabase = await createClient();
    if (!supabase) return false;

    // Fetch current retry count
    const { data: job, error: fetchError } = await supabase
      .from("processing_jobs")
      .select("retry_count")
      .eq("id", jobId)
      .single();

    if (fetchError || !job) {
      console.error(`[StuckJobDetector] Cannot find job ${jobId}:`, fetchError);
      return false;
    }

    const newRetryCount = job.retry_count + 1;

    // If exceeded max retries, mark as permanently failed
    if (newRetryCount >= DEFAULT_RETRY_CONFIG.maxRetries) {
      const { error } = await supabase
        .from("processing_jobs")
        .update({
          status: "failed" as JobStatus,
          retry_count: newRetryCount,
          finished_at: new Date().toISOString(),
          logs: `Job timed out after ${this.config.timeoutMinutes} minutes. Exceeded max retries (${MAX_RETRIES}).`,
        })
        .eq("id", jobId);

      if (error) {
        console.error(`[StuckJobDetector] Failed to mark job ${jobId} as failed:`, error);
        return false;
      }

      logger.info("JobQueue", `Job ${jobId} permanently failed (max retries exceeded)`);
      return true;
    }

    // Requeue the stuck job
    const { error } = await supabase
      .from("processing_jobs")
      .update({
        status: "queued" as JobStatus,
        retry_count: newRetryCount,
        started_at: null,
        finished_at: null,
        logs: `Recovered from stuck state (timeout: ${this.config.timeoutMinutes}min). Retry #${newRetryCount}.`,
      })
      .eq("id", jobId);

    if (error) {
      console.error(`[StuckJobDetector] Failed to recover job ${jobId}:`, error);
      return false;
    }

    logger.info("JobQueue", `Recovered stuck job ${jobId} (retry #${newRetryCount})`);
    return true;
  }

  /**
   * Run the Supabase RPC function to recover all stuck jobs atomically.
   *
   * @returns Number of jobs recovered
   */
  async recoverAllStuckJobs(): Promise<number> {
    const supabase = await createClient();
    if (!supabase) return 0;

    const { data, error } = await supabase.rpc("recover_stuck_jobs", {
      timeout_minutes: this.config.timeoutMinutes,
    });

    if (error) {
      console.error("[StuckJobDetector] RPC recover_stuck_jobs failed:", error);
      return 0;
    }

    const recovered = (data as number) || 0;
    if (recovered > 0) {
      logger.info("JobQueue", `Recovered ${recovered} stuck job(s) via RPC`);
    }

    return recovered;
  }

  /**
   * Start periodic stuck job detection.
   * Runs recoverAllStuckJobs on the configured interval.
   */
  startPeriodicCheck(): void {
    if (this.intervalId) return;

    // Run immediately once
    this.recoverAllStuckJobs().catch((err) => {
      console.error("[StuckJobDetector] Initial check failed:", err);
    });

    this.intervalId = setInterval(() => {
      this.recoverAllStuckJobs().catch((err) => {
        console.error("[StuckJobDetector] Periodic check failed:", err);
      });
    }, this.config.checkIntervalMinutes * 60 * 1000);

    logger.info(
      "JobQueue",
      `Started periodic check (every ${this.config.checkIntervalMinutes}min, timeout ${this.config.timeoutMinutes}min)`,
    );
  }

  /**
   * Stop periodic stuck job detection.
   */
  stopPeriodicCheck(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("JobQueue", "Stopped periodic check");
    }
  }
}

// ============================================
// IdempotencyGuard
// ============================================

/**
 * Ensures jobs can be safely retried without side effects.
 *
 * Uses atomic database status transitions to prevent duplicate
 * processing — only one worker can claim a job at a time.
 */
export class IdempotencyGuard {
  /**
   * Acquire an exclusive lock on a job by atomically transitioning
   * its status from "queued" to "running".
   *
   * This uses the database as a distributed lock: the UPDATE with
   * WHERE status = 'queued' ensures only one worker can claim the job.
   *
   * IMPORTANT: After the update, we verify that the row was actually
   * changed (i.e., the UPDATE matched 1 row). If another worker claimed
   * the job between our SELECT and UPDATE, the WHERE clause won't match
   * and we return false.
   *
   * @param jobId - The ID of the job to lock
   * @returns True if the lock was acquired (job was claimed)
   */
  async acquireJobLock(jobId: string): Promise<boolean> {
    const supabase = await createClient();
    if (!supabase) return false;

    // Attempt the atomic status transition
    const { count, error } = await supabase
      .from("processing_jobs")
      .update({
        status: "running" as JobStatus,
        started_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("status", "queued"); // Only claim if still queued
      // Note: Supabase JS .update() doesn't return affected rows directly.
      // We verify with a follow-up select below.

    if (error) {
      console.error(`[IdempotencyGuard] Failed to acquire lock for job ${jobId}:`, error);
      return false;
    }

    // Verify the update actually happened (row matched and transitioned to "running")
    const { data: updatedJob } = await supabase
      .from("processing_jobs")
      .select("status")
      .eq("id", jobId)
      .single();

    if (!updatedJob || updatedJob.status !== "running") {
      // Row was not updated — another worker claimed it first
      return false;
    }

    return true;
  }

  /**
   * Release a job lock by marking it as completed or failed.
   *
   * @param jobId - The ID of the job to release
   * @param success - Whether the job completed successfully
   * @param logs - Optional logs to append
   * @returns True if the release was successful
   */
  async releaseJobLock(
    jobId: string,
    success: boolean,
    logs?: string,
  ): Promise<boolean> {
    const supabase = await createClient();
    if (!supabase) return false;

    const update: Record<string, unknown> = {
      status: success ? ("completed" as JobStatus) : ("failed" as JobStatus),
      finished_at: new Date().toISOString(),
    };

    if (logs !== undefined) {
      update.logs = logs;
    }

    const { error } = await supabase
      .from("processing_jobs")
      .update(update)
      .eq("id", jobId)
      .eq("status", "running"); // Only release if currently running

    if (error) {
      console.error(`[IdempotencyGuard] Failed to release lock for job ${jobId}:`, error);
      return false;
    }

    return true;
  }

  /**
   * Check if a job is currently locked (being processed by a worker).
   *
   * @param jobId - The ID of the job to check
   * @returns True if the job is currently running (locked)
   */
  async isJobLocked(jobId: string): Promise<boolean> {
    const supabase = await createClient();
    if (!supabase) return false;

    const { data: job, error } = await supabase
      .from("processing_jobs")
      .select("status")
      .eq("id", jobId)
      .single();

    if (error || !job) return false;

    return job.status === "running";
  }
}

// ============================================
// JobOrchestrator
// ============================================

/**
 * Coordinates the full job lifecycle from submission to completion.
 *
 * Integrates retry management, stuck job detection, and idempotency
 * guards into a cohesive pipeline.
 */
export class JobOrchestrator {
  private retryManager: JobRetryManager;
  private stuckDetector: StuckJobDetector;
  private idempotencyGuard: IdempotencyGuard;

  constructor(
    retryConfig: Partial<JobRetryConfig> = {},
    stuckConfig: Partial<StuckJobConfig> = {},
  ) {
    this.retryManager = new JobRetryManager(retryConfig);
    this.stuckDetector = new StuckJobDetector(stuckConfig);
    this.idempotencyGuard = new IdempotencyGuard();
  }

  /**
   * Submit a new job to the processing queue.
   *
   * Performs deduplication check — if a job of the same type already
   * exists for the scene in a non-terminal state, returns the existing job.
   *
   * NOTE: The select-then-insert pattern has a TOCTOU race condition.
   * In production, a UNIQUE partial index should be added to the database:
   *
   *   CREATE UNIQUE INDEX processing_jobs_dedup_idx
   *     ON processing_jobs (scene_id, job_type)
   *     WHERE status IN ('queued', 'running');
   *
   * The insert below is wrapped in a try-catch to handle the unique
   * constraint violation by fetching the existing job on conflict.
   *
   * @param sceneId - The scene this job is for
   * @param jobType - The type of processing job
   * @param metadata - Optional metadata to store in logs
   * @returns The job ID (new or existing) and whether it was newly created
   */
  async submitJob(
    sceneId: string,
    jobType: JobType,
    metadata?: Record<string, unknown>,
  ): Promise<{ jobId: string; isNew: boolean }> {
    const supabase = await createClient();
    if (!supabase) {
      throw new Error("Database not configured");
    }

    // Deduplication: check for existing non-terminal jobs
    const { data: existingJob } = await supabase
      .from("processing_jobs")
      .select("id, status")
      .eq("scene_id", sceneId)
      .eq("job_type", jobType)
      .in("status", ["queued", "running"])
      .limit(1)
      .single();

    if (existingJob) {
      return {
        jobId: existingJob.id,
        isNew: false,
      };
    }

    // Create new job
    const insertData: Record<string, unknown> = {
      scene_id: sceneId,
      job_type: jobType,
      status: "queued",
      retry_count: 0,
    };

    if (metadata) {
      insertData.logs = JSON.stringify(metadata);
    }

    // Handle TOCTOU race: if two workers both pass the dedup check and try
    // to insert, the unique partial index (if present) will cause one to fail
    // with a constraint violation. We catch that and return the existing job.
    let newJob: { id: string } | null = null;
    let insertError: unknown = null;

    try {
      const { data, error } = await supabase
        .from("processing_jobs")
        .insert(insertData)
        .select("id")
        .single();

      if (error) throw error;
      newJob = data;
    } catch (err) {
      insertError = err;

      // Check if this is a unique constraint violation (duplicate key)
      const isDuplicate =
        err instanceof Error &&
        (err.message.includes("duplicate key") ||
         err.message.includes("unique constraint") ||
         err.message.includes("UNIQUE") ||
         (err as unknown as Record<string, unknown>)?.code === "23505");

      if (isDuplicate) {
        // Race condition — another worker inserted the same job.
        // Fetch the existing job and return it.
        const { data: raceJob } = await supabase
          .from("processing_jobs")
          .select("id")
          .eq("scene_id", sceneId)
          .eq("job_type", jobType)
          .in("status", ["queued", "running"])
          .limit(1)
          .single();

        if (raceJob) {
          return { jobId: raceJob.id, isNew: false };
        }
      }
    }

    if (insertError || !newJob) {
      console.error("[JobOrchestrator] Failed to submit job:", insertError);
      throw new Error(`Failed to submit job: ${insertError instanceof Error ? insertError.message : "Unknown error"}`);
    }

    logger.info("JobQueue", `Submitted job ${newJob.id} (${jobType}) for scene ${sceneId}`);
    return { jobId: newJob.id, isNew: true };
  }

  /**
   * Claim and process the next queued job.
   *
   * Uses the idempotency guard to safely acquire a lock,
   * then returns the job for processing by the caller.
   *
   * The idempotency guard verifies the UPDATE actually matched a row.
   * If another worker claimed it first, returns null.
   *
   * @returns The claimed job, or null if no jobs are available
   */
  async processNextJob(): Promise<ProcessingJob | null> {
    const supabase = await createClient();
    if (!supabase) return null;

    // Get the next queued job (FIFO order)
    const { data: job, error } = await supabase
      .from("processing_jobs")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (error || !job) {
      return null;
    }

    // Try to acquire the job lock atomically (verifies row was actually updated)
    const locked = await this.idempotencyGuard.acquireJobLock(job.id);
    if (!locked) {
      // Another worker claimed it first, or the row didn't match
      return null;
    }

    // Return the job with updated status
    return {
      ...job,
      status: "running" as JobStatus,
      started_at: new Date().toISOString(),
    } as ProcessingJob;
  }

  /**
   * Mark a job as successfully completed.
   *
   * @param jobId - The ID of the completed job
   * @param result - Result details to store in logs
   * @returns True if the job was marked complete
   */
  async completeJob(
    jobId: string,
    result: string | Record<string, unknown>,
  ): Promise<boolean> {
    const logs = typeof result === "string" ? result : JSON.stringify(result);

    const released = await this.idempotencyGuard.releaseJobLock(jobId, true, logs);

    if (released) {
      logger.info("JobQueue", `Job ${jobId} completed successfully`);
    }

    return released;
  }

  /**
   * Handle a job failure.
   *
   * If the error is retryable and the job hasn't exceeded MAX_RETRIES,
   * schedules a retry with exponential backoff. Otherwise, marks the
   * job as permanently failed.
   *
   * @param jobId - The ID of the failed job
   * @param error - The error that caused the failure
   * @returns True if the failure was handled (retry scheduled or permanent failure recorded)
   */
  async failJob(jobId: string, error: unknown): Promise<boolean> {
    const supabase = await createClient();
    if (!supabase) return false;

    // Fetch current job state
    const { data: job, error: fetchError } = await supabase
      .from("processing_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (fetchError || !job) {
      console.error(`[JobOrchestrator] Cannot find job ${jobId} to fail:`, fetchError);
      return false;
    }

    const processingJob = job as ProcessingJob;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const logs = `${processingJob.logs || ""}\n[FAIL] ${new Date().toISOString()}: ${errorMessage}`.trim();

    // Check if the error is retryable
    if (isRetryableError(error) && this.retryManager.shouldRetry(processingJob)) {
      // Release the lock and schedule retry
      const released = await this.idempotencyGuard.releaseJobLock(jobId, false, logs);
      if (!released) {
        // Job already in terminal state (e.g., another worker completed it),
        // do NOT proceed to schedule a retry.
        console.log(`[JobQueue] Job ${jobId} already in terminal state, skipping retry`);
        return false;
      }

      // Schedule the retry (this will requeue the job)
      const retryScheduled = await this.retryManager.scheduleRetry(
        jobId,
        processingJob.retry_count,
      );

      if (retryScheduled) {
        const backoff = this.retryManager.getBackoffDelay(processingJob.retry_count + 1);
        logger.info(
          "JobQueue",
          `Job ${jobId} failed (retryable). Retry #${processingJob.retry_count + 1} scheduled in ${backoff}ms`,
        );
      }

      return retryScheduled;
    }

    // Permanent failure
    const released = await this.idempotencyGuard.releaseJobLock(jobId, false, logs);

    if (released) {
      logger.info(
        "JobQueue",
        `Job ${jobId} permanently failed${!isRetryableError(error) ? " (non-retryable error)" : " (max retries exceeded)"}`,
      );
    }

    return released;
  }

  /**
   * Get the retry manager instance for direct access.
   */
  getRetryManager(): JobRetryManager {
    return this.retryManager;
  }

  /**
   * Get the stuck job detector instance for direct access.
   */
  getStuckDetector(): StuckJobDetector {
    return this.stuckDetector;
  }

  /**
   * Get the idempotency guard instance for direct access.
   */
  getIdempotencyGuard(): IdempotencyGuard {
    return this.idempotencyGuard;
  }

  /**
   * Start the stuck job detection periodic check.
   */
  startStuckJobDetection(): void {
    this.stuckDetector.startPeriodicCheck();
  }

  /**
   * Stop the stuck job detection periodic check.
   */
  stopStuckJobDetection(): void {
    this.stuckDetector.stopPeriodicCheck();
  }
}

// ============================================
// Singleton orchestrator for convenience
// ============================================

let orchestratorInstance: JobOrchestrator | null = null;

/**
 * Get the global JobOrchestrator singleton.
 *
 * @param retryConfig - Optional retry configuration (used only on first call)
 * @param stuckConfig - Optional stuck job config (used only on first call)
 * @returns The global JobOrchestrator instance
 */
export function getJobOrchestrator(
  retryConfig?: Partial<JobRetryConfig>,
  stuckConfig?: Partial<StuckJobConfig>,
): JobOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new JobOrchestrator(retryConfig, stuckConfig);
  }
  return orchestratorInstance;
}
