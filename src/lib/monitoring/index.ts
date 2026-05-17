// ============================================
// Advanced Monitoring System
// ============================================
// System-wide monitoring for GPU workers, job queues,
// processing pipelines, storage, and health checks.
// ============================================

import { createClient } from "@/lib/supabase/server";
import type { SystemMonitoring, GPUMetric } from "@/lib/types";

// Supabase join result types
interface WorkerJoinResult {
  gpu_type: string | null;
}

type GPUMetricRow = GPUMetric;

// ============================================
// MonitoringSystem
// ============================================

/**
 * Advanced system monitoring for the 3D processing platform.
 *
 * Provides real-time dashboards, GPU metrics, queue analytics,
 * failure rate tracking, and storage growth projections.
 */
export class MonitoringSystem {
  /**
   * Get full system monitoring dashboard data.
   *
   * Uses the `get_system_monitoring` RPC function for
   * comprehensive system health overview.
   *
   * @returns System monitoring data or null on error
   */
  async getSystemMonitoring(): Promise<SystemMonitoring | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      // Try the RPC function first
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "get_system_monitoring",
      );

      if (!rpcError && rpcData) {
        return rpcData as SystemMonitoring;
      }

      // Fallback: compute from individual queries
      return await this.computeSystemMonitoring();
    } catch (err) {
      console.error("[MonitoringSystem] Error getting system monitoring:", err);
      return null;
    }
  }

  /**
   * Compute system monitoring data from individual table queries.
   * Used as fallback when the RPC function is not available.
   */
  private async computeSystemMonitoring(): Promise<SystemMonitoring | null> {
    try {
      const supabase = await createClient();
      if (!supabase) return null;

      const twentyFourHoursAgo = new Date(
        Date.now() - 24 * 60 * 60 * 1000,
      ).toISOString();

      // Worker stats
      const { data: workers } = await supabase
        .from("workers")
        .select("status, region");

      const allWorkers = workers || [];
      const activeWorkers = allWorkers.filter(
        (w) => w.status !== "offline" && w.status !== "failed",
      ).length;
      const idleWorkers = allWorkers.filter((w) => w.status === "idle").length;
      const busyWorkers = allWorkers.filter((w) => w.status === "busy").length;
      const offlineWorkers = allWorkers.filter(
        (w) => w.status === "offline" || w.status === "failed",
      ).length;

      // Workers by region
      const workersByRegion: Record<string, number> = {};
      for (const w of allWorkers) {
        const region = (w.region as string) || "unknown";
        workersByRegion[region] = (workersByRegion[region] || 0) + 1;
      }

      // Job stats
      const { count: queuedJobs } = await supabase
        .from("processing_jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", "queued");

      const { count: runningJobs } = await supabase
        .from("processing_jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", "running");

      const { count: failedJobs24h } = await supabase
        .from("processing_jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", "failed")
        .gte("finished_at", twentyFourHoursAgo);

      const { count: completedJobs24h } = await supabase
        .from("processing_jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("finished_at", twentyFourHoursAgo);

      // Average processing time (last 24h)
      const { data: completedJobsData } = await supabase
        .from("processing_jobs")
        .select("started_at, finished_at")
        .eq("status", "completed")
        .gte("finished_at", twentyFourHoursAgo)
        .not("started_at", "is", null)
        .not("finished_at", "is", null)
        .limit(1000);

      let avgProcessingTime: number | null = null;
      if (completedJobsData && completedJobsData.length > 0) {
        const times = completedJobsData.map((j) => {
          const start = new Date(j.started_at as string).getTime();
          const end = new Date(j.finished_at as string).getTime();
          return (end - start) / 1000; // seconds
        });
        avgProcessingTime = times.reduce((a, b) => a + b, 0) / times.length;
      }

      // AI Enhancement stats
      const { count: queuedAI } = await supabase
        .from("ai_enhancements")
        .select("*", { count: "exact", head: true })
        .eq("status", "queued");

      const { count: processingAI } = await supabase
        .from("ai_enhancements")
        .select("*", { count: "exact", head: true })
        .eq("status", "processing");

      // Scene stats
      const { count: scenesReady } = await supabase
        .from("scenes")
        .select("*", { count: "exact", head: true })
        .eq("status", "ready");

      // Cost stats
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const { data: todayCosts } = await supabase
        .from("cost_records")
        .select("amount_usd")
        .gte("recorded_at", todayStart.toISOString());

      const { data: monthCosts } = await supabase
        .from("cost_records")
        .select("amount_usd")
        .gte("recorded_at", monthStart.toISOString());

      const costToday =
        todayCosts?.reduce((sum, c) => sum + (c.amount_usd || 0), 0) || 0;
      const costThisMonth =
        monthCosts?.reduce((sum, c) => sum + (c.amount_usd || 0), 0) || 0;

      // Storage estimate (from usage metrics)
      const { data: storageMetric } = await supabase
        .from("usage_metrics")
        .select("value")
        .eq("metric_type", "storage_used_mb")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      return {
        active_workers: activeWorkers,
        total_workers: allWorkers.length,
        idle_workers: idleWorkers,
        busy_workers: busyWorkers,
        offline_workers: offlineWorkers,
        queued_jobs: queuedJobs || 0,
        running_jobs: runningJobs || 0,
        failed_jobs_24h: failedJobs24h || 0,
        completed_jobs_24h: completedJobs24h || 0,
        avg_processing_time_24h: avgProcessingTime,
        queued_ai_enhancements: queuedAI || 0,
        processing_ai_enhancements: processingAI || 0,
        total_scenes_ready: scenesReady || 0,
        total_storage_mb: storageMetric?.value || 0,
        cost_today: costToday,
        cost_this_month: costThisMonth,
        workers_by_region: workersByRegion,
      };
    } catch (err) {
      console.error("[MonitoringSystem] Error computing system monitoring:", err);
      return null;
    }
  }

  /**
   * Get GPU usage statistics per region.
   *
   * @returns Map of region to GPU usage stats
   */
  async getGPUUsageByRegion(): Promise<
    Record<
      string,
      {
        workerCount: number;
        avgUtilization: number;
        totalMemoryGb: number;
        usedMemoryGb: number;
      }
    >
  > {
    try {
      const supabase = await createClient();
      if (!supabase) return {};

      const { data: workers, error } = await supabase
        .from("workers")
        .select("region, gpu_memory_gb, current_job_count, max_concurrent_jobs, status")
        .neq("status", "offline");

      if (error || !workers) return {};

      const byRegion: Record<
        string,
        {
          workerCount: number;
          totalMemoryGb: number;
          usedMemoryGb: number;
          totalUtilization: number;
        }
      > = {};

      for (const w of workers) {
        const region = (w.region as string) || "unknown";
        if (!byRegion[region]) {
          byRegion[region] = {
            workerCount: 0,
            totalMemoryGb: 0,
            usedMemoryGb: 0,
            totalUtilization: 0,
          };
        }

        byRegion[region].workerCount++;
        const totalMem = (w.gpu_memory_gb as number) || 0;
        byRegion[region].totalMemoryGb += totalMem;

        // Estimate used memory based on job utilization
        const maxJobs = (w.max_concurrent_jobs as number) || 1;
        const currentJobs = (w.current_job_count as number) || 0;
        const utilizationFraction = maxJobs > 0 ? currentJobs / maxJobs : 0;
        byRegion[region].usedMemoryGb += totalMem * utilizationFraction;
        byRegion[region].totalUtilization += utilizationFraction * 100;
      }

      // Calculate averages
      const result: Record<
        string,
        {
          workerCount: number;
          avgUtilization: number;
          totalMemoryGb: number;
          usedMemoryGb: number;
        }
      > = {};

      for (const [region, stats] of Object.entries(byRegion)) {
        result[region] = {
          workerCount: stats.workerCount,
          avgUtilization:
            stats.workerCount > 0
              ? Math.round(stats.totalUtilization / stats.workerCount)
              : 0,
          totalMemoryGb: Math.round(stats.totalMemoryGb * 10) / 10,
          usedMemoryGb: Math.round(stats.usedMemoryGb * 10) / 10,
        };
      }

      return result;
    } catch (err) {
      console.error("[MonitoringSystem] Error getting GPU usage by region:", err);
      return {};
    }
  }

  /**
   * Get queue latency statistics.
   *
   * Analyzes how long jobs spend waiting in the queue before
   * being picked up by a worker.
   *
   * @returns Latency statistics with percentile breakdowns
   */
  async getQueueLatency(): Promise<{
    avgWaitTimeMinutes: number;
    p50WaitTimeMinutes: number;
    p95WaitTimeMinutes: number;
    p99WaitTimeMinutes: number;
    currentQueueDepth: number;
  }> {
    try {
      const supabase = await createClient();
      if (!supabase) {
        return {
          avgWaitTimeMinutes: 0,
          p50WaitTimeMinutes: 0,
          p95WaitTimeMinutes: 0,
          p99WaitTimeMinutes: 0,
          currentQueueDepth: 0,
        };
      }

      const emptyResult = {
        avgWaitTimeMinutes: 0,
        p50WaitTimeMinutes: 0,
        p95WaitTimeMinutes: 0,
        p99WaitTimeMinutes: 0,
        currentQueueDepth: 0,
      };

      // Get current queue depth
      const { count: currentQueueDepth } = await supabase
        .from("processing_jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", "queued");

      // Get recent completed jobs to calculate wait times
      const sevenDaysAgo = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data: recentJobs } = await supabase
        .from("processing_jobs")
        .select("created_at, started_at")
        .eq("status", "completed")
        .gte("started_at", sevenDaysAgo)
        .not("started_at", "is", null)
        .limit(1000);

      if (!recentJobs || recentJobs.length === 0) {
        return {
          ...emptyResult,
          currentQueueDepth: currentQueueDepth || 0,
        };
      }

      // Calculate wait times (started_at - created_at)
      const waitTimesMinutes = recentJobs
        .map((j) => {
          const created = new Date(j.created_at as string).getTime();
          const started = new Date(j.started_at as string).getTime();
          return (started - created) / (1000 * 60); // minutes
        })
        .filter((t) => t >= 0)
        .sort((a, b) => a - b);

      if (waitTimesMinutes.length === 0) {
        return {
          ...emptyResult,
          currentQueueDepth: currentQueueDepth || 0,
        };
      }

      const avg = waitTimesMinutes.reduce((a, b) => a + b, 0) / waitTimesMinutes.length;
      const p50 = percentile(waitTimesMinutes, 50);
      const p95 = percentile(waitTimesMinutes, 95);
      const p99 = percentile(waitTimesMinutes, 99);

      return {
        avgWaitTimeMinutes: Math.round(avg * 100) / 100,
        p50WaitTimeMinutes: Math.round(p50 * 100) / 100,
        p95WaitTimeMinutes: Math.round(p95 * 100) / 100,
        p99WaitTimeMinutes: Math.round(p99 * 100) / 100,
        currentQueueDepth: currentQueueDepth || 0,
      };
    } catch (err) {
      console.error("[MonitoringSystem] Error getting queue latency:", err);
      return {
        avgWaitTimeMinutes: 0,
        p50WaitTimeMinutes: 0,
        p95WaitTimeMinutes: 0,
        p99WaitTimeMinutes: 0,
        currentQueueDepth: 0,
      };
    }
  }

  /**
   * Get job failure rate per worker.
   *
   * Identifies workers with high failure rates for diagnostics.
   *
   * @returns Array of worker failure statistics
   */
  async getFailureRatePerWorker(): Promise<
    Array<{
      workerId: string;
      workerName: string | null;
      region: string;
      totalJobs: number;
      failedJobs: number;
      failureRate: number;
    }>
  > {
    try {
      const supabase = await createClient();
      if (!supabase) return [];

      const { data: workers, error } = await supabase
        .from("workers")
        .select(
          "id, worker_id, name, region, total_jobs_completed, total_jobs_failed",
        );

      if (error || !workers) return [];

      return workers
        .map((w) => {
          const totalJobs =
            (w.total_jobs_completed as number) + (w.total_jobs_failed as number);
          const failedJobs = w.total_jobs_failed as number;
          const failureRate = totalJobs > 0 ? failedJobs / totalJobs : 0;

          return {
            workerId: w.worker_id as string,
            workerName: w.name as string | null,
            region: (w.region as string) || "unknown",
            totalJobs,
            failedJobs,
            failureRate: Math.round(failureRate * 10000) / 10000,
          };
        })
        .filter((w) => w.totalJobs > 0); // Only show workers with jobs
    } catch (err) {
      console.error("[MonitoringSystem] Error getting failure rate per worker:", err);
      return [];
    }
  }

  /**
   * Get processing time distribution.
   *
   * Provides statistical distribution of scene processing times
   * with breakdowns by GPU type.
   *
   * @returns Processing time distribution stats
   */
  async getProcessingTimeDistribution(): Promise<{
    avg: number;
    median: number;
    p90: number;
    p95: number;
    p99: number;
    byGpuType: Record<string, { avg: number; median: number }>;
  }> {
    try {
      const supabase = await createClient();
      if (!supabase) {
        return {
          avg: 0,
          median: 0,
          p90: 0,
          p95: 0,
          p99: 0,
          byGpuType: {},
        };
      }

      // Get recent completed scenes with processing times
      const { data: scenes } = await supabase
        .from("scenes")
        .select("processing_time_seconds")
        .eq("status", "ready")
        .not("processing_time_seconds", "is", null)
        .limit(5000);

      if (!scenes || scenes.length === 0) {
        return {
          avg: 0,
          median: 0,
          p90: 0,
          p95: 0,
          p99: 0,
          byGpuType: {},
        };
      }

      const times = scenes
        .map((s) => s.processing_time_seconds as number)
        .filter((t) => t > 0)
        .sort((a, b) => a - b);

      if (times.length === 0) {
        return {
          avg: 0,
          median: 0,
          p90: 0,
          p95: 0,
          p99: 0,
          byGpuType: {},
        };
      }

      // Get processing times by GPU type via jobs -> workers
      const { data: jobData } = await supabase
        .from("processing_jobs")
        .select(
          "started_at, finished_at, scenes!inner(id), workers!inner(gpu_type)",
        )
        .eq("status", "completed")
        .not("started_at", "is", null)
        .not("finished_at", "is", null)
        .limit(2000);

      const byGpuType: Record<string, number[]> = {};

      if (jobData) {
        for (const job of jobData) {
          const worker = job.workers as unknown as WorkerJoinResult;
          const gpuType = worker?.gpu_type || "unknown";

          const start = new Date(job.started_at as string).getTime();
          const end = new Date(job.finished_at as string).getTime();
          const duration = (end - start) / 1000;

          if (duration > 0) {
            if (!byGpuType[gpuType]) byGpuType[gpuType] = [];
            byGpuType[gpuType].push(duration);
          }
        }
      }

      const byGpuStats: Record<string, { avg: number; median: number }> = {};
      for (const [gpuType, gpuTimes] of Object.entries(byGpuType)) {
        gpuTimes.sort((a, b) => a - b);
        byGpuStats[gpuType] = {
          avg: Math.round((gpuTimes.reduce((a, b) => a + b, 0) / gpuTimes.length) * 100) / 100,
          median: Math.round(percentile(gpuTimes, 50) * 100) / 100,
        };
      }

      return {
        avg: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100,
        median: Math.round(percentile(times, 50) * 100) / 100,
        p90: Math.round(percentile(times, 90) * 100) / 100,
        p95: Math.round(percentile(times, 95) * 100) / 100,
        p99: Math.round(percentile(times, 99) * 100) / 100,
        byGpuType: byGpuStats,
      };
    } catch (err) {
      console.error(
        "[MonitoringSystem] Error getting processing time distribution:",
        err,
      );
      return {
        avg: 0,
        median: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        byGpuType: {},
      };
    }
  }

  /**
   * Get storage growth rate and projections.
   *
   * Analyzes storage usage trends and projects future growth.
   *
   * @returns Storage growth statistics with 30-day projection
   */
  async getStorageGrowthRate(): Promise<{
    currentTotalMb: number;
    dailyGrowthMb: number;
    weeklyGrowthMb: number;
    projected30DaysMb: number;
    byOrg: Array<{ orgId: string; totalMb: number; growthMb: number }>;
  }> {
    try {
      const supabase = await createClient();
      if (!supabase) {
        return {
          currentTotalMb: 0,
          dailyGrowthMb: 0,
          weeklyGrowthMb: 0,
          projected30DaysMb: 0,
          byOrg: [],
        };
      }

      // Get current storage from usage metrics
      const { data: currentStorage } = await supabase
        .from("usage_metrics")
        .select("org_id, value, created_at")
        .eq("metric_type", "storage_used_mb")
        .order("created_at", { ascending: false })
        .limit(100);

      if (!currentStorage || currentStorage.length === 0) {
        return {
          currentTotalMb: 0,
          dailyGrowthMb: 0,
          weeklyGrowthMb: 0,
          projected30DaysMb: 0,
          byOrg: [],
        };
      }

      // Current total
      const currentTotalMb = currentStorage.reduce(
        (sum, m) => sum + (m.value || 0),
        0,
      );

      // Get storage from 1 day ago for daily growth
      const oneDayAgo = new Date(
        Date.now() - 24 * 60 * 60 * 1000,
      ).toISOString();
      const sevenDaysAgo = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { data: dayAgoStorage } = await supabase
        .from("usage_metrics")
        .select("value")
        .eq("metric_type", "storage_used_mb")
        .lt("created_at", oneDayAgo)
        .order("created_at", { ascending: false })
        .limit(100);

      const { data: weekAgoStorage } = await supabase
        .from("usage_metrics")
        .select("value")
        .eq("metric_type", "storage_used_mb")
        .lt("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(100);

      const dayAgoTotal = dayAgoStorage?.reduce((s, m) => s + (m.value || 0), 0) || 0;
      const weekAgoTotal = weekAgoStorage?.reduce((s, m) => s + (m.value || 0), 0) || 0;

      const dailyGrowthMb = Math.max(0, currentTotalMb - dayAgoTotal);
      const weeklyGrowthMb = Math.max(0, currentTotalMb - weekAgoTotal);
      const projected30DaysMb = currentTotalMb + dailyGrowthMb * 30;

      // Per-org breakdown
      const orgMap: Record<string, { totalMb: number; recentMb: number }> = {};
      for (const m of currentStorage) {
        const orgId = m.org_id as string;
        if (!orgMap[orgId]) {
          orgMap[orgId] = { totalMb: 0, recentMb: 0 };
        }
        orgMap[orgId].totalMb += m.value || 0;
      }

      const byOrg = Object.entries(orgMap).map(([orgId, stats]) => ({
        orgId,
        totalMb: Math.round(stats.totalMb),
        growthMb: Math.round(stats.totalMb * (dailyGrowthMb / Math.max(currentTotalMb, 1))),
      }));

      return {
        currentTotalMb: Math.round(currentTotalMb),
        dailyGrowthMb: Math.round(dailyGrowthMb),
        weeklyGrowthMb: Math.round(weeklyGrowthMb),
        projected30DaysMb: Math.round(projected30DaysMb),
        byOrg,
      };
    } catch (err) {
      console.error("[MonitoringSystem] Error getting storage growth rate:", err);
      return {
        currentTotalMb: 0,
        dailyGrowthMb: 0,
        weeklyGrowthMb: 0,
        projected30DaysMb: 0,
        byOrg: [],
      };
    }
  }

  /**
   * Record GPU metrics from a worker.
   *
   * Stores periodic GPU utilization data for monitoring and
   * auto-scaling decisions.
   *
   * @param metrics - GPU metrics to record (without id and recorded_at)
   */
  async recordGPUMetrics(
    metrics: Omit<GPUMetric, "id" | "recorded_at">,
  ): Promise<void> {
    try {
      const supabase = await createClient();
      if (!supabase) return;

      const { error } = await supabase.from("gpu_metrics").insert({
        worker_id: metrics.worker_id,
        gpu_utilization_percent: metrics.gpu_utilization_percent,
        gpu_memory_used_gb: metrics.gpu_memory_used_gb,
        gpu_memory_total_gb: metrics.gpu_memory_total_gb,
        gpu_temperature_c: metrics.gpu_temperature_c,
        job_queue_length: metrics.job_queue_length,
        active_job_count: metrics.active_job_count,
        avg_processing_time_seconds: metrics.avg_processing_time_seconds,
        jobs_completed_last_hour: metrics.jobs_completed_last_hour,
        jobs_failed_last_hour: metrics.jobs_failed_last_hour,
      });

      if (error) {
        console.error("[MonitoringSystem] Error recording GPU metrics:", error);
      }
    } catch (err) {
      console.error("[MonitoringSystem] Error recording GPU metrics:", err);
    }
  }

  /**
   * Get recent GPU metrics for a specific worker.
   *
   * @param workerId - The worker ID
   * @param limit - Maximum number of metric entries to return
   * @returns Array of GPU metrics, most recent first
   */
  async getWorkerGPUMetrics(
    workerId: string,
    limit: number = 100,
  ): Promise<GPUMetric[]> {
    try {
      const supabase = await createClient();
      if (!supabase) return [];

      const { data, error } = await supabase
        .from("gpu_metrics")
        .select("*")
        .eq("worker_id", workerId)
        .order("recorded_at", { ascending: false })
        .limit(limit);

      if (error || !data) return [];

      return data as GPUMetricRow[];
    } catch (err) {
      console.error("[MonitoringSystem] Error getting worker GPU metrics:", err);
      return [];
    }
  }

  /**
   * Health check for the monitoring system.
   *
   * Verifies connectivity to the database and key services,
   * and returns a status assessment.
   *
   * @returns Health check result with individual check statuses
   */
  async healthCheck(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    checks: Array<{
      name: string;
      status: "ok" | "warn" | "error";
      message?: string;
    }>;
  }> {
    const checks: Array<{
      name: string;
      status: "ok" | "warn" | "error";
      message?: string;
    }> = [];

    try {
      const supabase = await createClient();

      // Check 1: Database connectivity
      if (!supabase) {
        checks.push({
          name: "database",
          status: "error",
          message: "Supabase client not configured",
        });
      } else {
        const { error: dbError } = await supabase
          .from("workers")
          .select("id")
          .limit(1);

        if (dbError) {
          checks.push({
            name: "database",
            status: "error",
            message: `Database query failed: ${dbError.message}`,
          });
        } else {
          checks.push({ name: "database", status: "ok" });
        }
      }

      // Check 2: Worker availability
      if (supabase) {
        const { count: activeWorkers } = await supabase
          .from("workers")
          .select("*", { count: "exact", head: true })
          .in("status", ["idle", "busy"]);

        if (activeWorkers === 0) {
          checks.push({
            name: "workers",
            status: "error",
            message: "No active workers available",
          });
        } else if (activeWorkers !== null && activeWorkers < 2) {
          checks.push({
            name: "workers",
            status: "warn",
            message: `Only ${activeWorkers} active worker(s)`,
          });
        } else {
          checks.push({ name: "workers", status: "ok" });
        }
      }

      // Check 3: Queue depth
      if (supabase) {
        const { count: queueDepth } = await supabase
          .from("processing_jobs")
          .select("*", { count: "exact", head: true })
          .eq("status", "queued");

        if (queueDepth !== null && queueDepth > 50) {
          checks.push({
            name: "queue",
            status: "warn",
            message: `Queue depth is ${queueDepth} (high)`,
          });
        } else {
          checks.push({ name: "queue", status: "ok" });
        }
      }

      // Check 4: Recent failure rate
      if (supabase) {
        const oneHourAgo = new Date(
          Date.now() - 60 * 60 * 1000,
        ).toISOString();

        const { count: recentFailed } = await supabase
          .from("processing_jobs")
          .select("*", { count: "exact", head: true })
          .eq("status", "failed")
          .gte("finished_at", oneHourAgo);

        const { count: recentCompleted } = await supabase
          .from("processing_jobs")
          .select("*", { count: "exact", head: true })
          .eq("status", "completed")
          .gte("finished_at", oneHourAgo);

        const totalRecent = (recentFailed || 0) + (recentCompleted || 0);
        const failureRate = totalRecent > 0 ? (recentFailed || 0) / totalRecent : 0;

        if (failureRate > 0.2) {
          checks.push({
            name: "failure_rate",
            status: "error",
            message: `Failure rate ${(failureRate * 100).toFixed(1)}% in last hour`,
          });
        } else if (failureRate > 0.1) {
          checks.push({
            name: "failure_rate",
            status: "warn",
            message: `Failure rate ${(failureRate * 100).toFixed(1)}% in last hour`,
          });
        } else {
          checks.push({ name: "failure_rate", status: "ok" });
        }
      }
    } catch (err) {
      checks.push({
        name: "system",
        status: "error",
        message: `Health check failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Determine overall status
    const hasErrors = checks.some((c) => c.status === "error");
    const hasWarnings = checks.some((c) => c.status === "warn");

    const status: "healthy" | "degraded" | "unhealthy" = hasErrors
      ? "unhealthy"
      : hasWarnings
        ? "degraded"
        : "healthy";

    return { status, checks };
  }
}

// ============================================
// Helpers
// ============================================

/**
 * Calculate the percentile value from a sorted array.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;

  if (lower === upper) return sorted[lower];

  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

// ============================================
// Singleton
// ============================================

let monitoringInstance: MonitoringSystem | null = null;

/**
 * Get the global MonitoringSystem singleton.
 *
 * @returns The MonitoringSystem instance
 */
export function getMonitoringSystem(): MonitoringSystem {
  if (!monitoringInstance) {
    monitoringInstance = new MonitoringSystem();
  }
  return monitoringInstance;
}
