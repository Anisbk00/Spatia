// ============================================
// LoadBalancer — Selects the optimal worker
// for job assignment based on multi-factor scoring.
// ============================================
// Scoring weights:
//   - Available capacity:  40%
//   - Reliability:         30%
//   - Speed:               20%
//   - Region match:        10%
// ============================================

import { createClient } from "@/lib/supabase/server";
import type { Worker } from "@/lib/types";

// Scoring weights
const WEIGHT_CAPACITY = 0.4;
const WEIGHT_RELIABILITY = 0.3;
const WEIGHT_SPEED = 0.2;
const WEIGHT_REGION = 0.1;

export class LoadBalancer {
  /**
   * Select the best worker from a pool of candidates.
   * Considers current load, reliability, speed, and
   * region/GPU type matching.
   * Returns null if no workers are available.
   */
  selectBestWorker(
    workers: Worker[],
    requirements?: { region?: string; gpuType?: string }
  ): Worker | null {
    if (workers.length === 0) return null;

    // Filter to only workers with remaining capacity
    const available = workers.filter(
      (w) => w.current_job_count < w.max_concurrent_jobs
    );

    if (available.length === 0) return null;

    // Score each worker and pick the highest
    let bestWorker = available[0];
    let bestScore = -1;

    for (const worker of available) {
      const score = this.calculateWorkerScore(worker, requirements?.region);

      // Apply GPU type filter — skip workers that don't match required GPU
      if (requirements?.gpuType && worker.gpu_type !== requirements.gpuType) {
        continue;
      }

      if (score > bestScore) {
        bestScore = score;
        bestWorker = worker;
      }
    }

    return bestWorker;
  }

  /**
   * Calculate a score from 0-100 for a worker based on:
   * - Available capacity (40%): how many more jobs it can take
   * - Reliability (30%): low failure rate
   * - Speed (20%): low average job duration
   * - Region match (10%): worker is in the preferred region for the job
   *
   * @param worker - The worker to score
   * @param preferredRegion - The job's preferred region, if available
   */
  calculateWorkerScore(worker: Worker, preferredRegion?: string): number {
    // ---- Capacity Score (0-100) ----
    const remainingCapacity =
      worker.max_concurrent_jobs - worker.current_job_count;
    const capacityRatio =
      worker.max_concurrent_jobs > 0
        ? remainingCapacity / worker.max_concurrent_jobs
        : 0;
    const capacityScore = capacityRatio * 100;

    // ---- Reliability Score (0-100) ----
    const totalJobs = worker.total_jobs_completed + worker.total_jobs_failed;
    let reliabilityScore = 100; // default if no jobs yet
    if (totalJobs > 0) {
      const successRate = worker.total_jobs_completed / totalJobs;
      reliabilityScore = successRate * 100;
    }

    // ---- Speed Score (0-100) ----
    let speedScore = 50; // default if no avg duration yet
    if (worker.avg_job_duration_seconds !== null) {
      // Lower duration = higher score
      // Assume 60s is excellent, 600s is poor
      const avgDuration = worker.avg_job_duration_seconds;
      if (avgDuration <= 60) {
        speedScore = 100;
      } else if (avgDuration >= 600) {
        speedScore = 0;
      } else {
        speedScore = 100 - ((avgDuration - 60) / (600 - 60)) * 100;
      }
    }

    // ---- Region Score (0-100) ----
    // If a preferred region is provided and matches the worker's region,
    // give a full score (100). If the regions don't match, give a lower
    // score (25) to still prefer closer workers but not disqualify distant ones.
    // When no preferred region is specified, return a neutral score (50).
    let regionScore: number;
    if (preferredRegion) {
      regionScore = worker.region === preferredRegion ? 100 : 25;
    } else {
      // No region preference available — return a neutral default
      regionScore = 50;
    }

    // ---- Weighted total ----
    const totalScore =
      WEIGHT_CAPACITY * capacityScore +
      WEIGHT_RELIABILITY * reliabilityScore +
      WEIGHT_SPEED * speedScore +
      WEIGHT_REGION * regionScore;

    return Math.round(Math.max(0, Math.min(100, totalScore)));
  }

  /**
   * Get worker distribution statistics grouped by region.
   * Returns a map of region → { total, busy, idle }.
   */
  async getWorkerDistribution(): Promise<
    Record<string, { total: number; busy: number; idle: number }>
  > {
    const supabase = await createClient();
    if (!supabase) return {};

    const { data, error } = await supabase
      .from("workers")
      .select("region, status");

    if (error || !data) {
      return {};
    }

    const distribution: Record<string, { total: number; busy: number; idle: number }> = {};

    for (const worker of data) {
      const region = (worker as Record<string, unknown>).region as string;
      const status = (worker as Record<string, unknown>).status as string;

      if (!distribution[region]) {
        distribution[region] = { total: 0, busy: 0, idle: 0 };
      }

      distribution[region].total++;

      if (status === "busy" || status === "draining") {
        distribution[region].busy++;
      } else if (status === "idle") {
        distribution[region].idle++;
      }
    }

    return distribution;
  }
}
