import { createAdminClient } from "@/lib/supabase/server";
import type { JobType, JobStatus } from "@/lib/types";

// ============================================
// Types
// ============================================

export type Period = "day" | "week" | "month";

export interface UploadMetrics {
  total: number;
  successRate: number;
  avgDuration: number;
  failureRate: number;
}

export interface ProcessingMetrics {
  totalJobs: number;
  successRate: number;
  avgProcessingTime: number;
  byJobType: Record<string, { total: number; successRate: number; avgTime: number }>;
}

export interface CaptureMetrics {
  totalSessions: number;
  avgImagesPerSession: number;
  completionRate: number;
}

export interface ViewerMetrics {
  totalViews: number;
  avgEngagementTime: number;
  byDevice: Record<string, number>;
  byCountry: Record<string, number>;
}

export interface SystemHealth {
  stuckJobs: number;
  orphanSessions: number;
  failedUploads: number;
  pendingRecovery: number;
}

function getPeriodStart(period: Period): Date {
  const now = new Date();
  switch (period) {
    case "day":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "week": {
      const dayOfWeek = now.getDay();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
    }
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

// ============================================
// MetricsCalculator utility functions
// ============================================

export const MetricsCalculator = {
  /**
   * Calculate rate as percentage with 1 decimal
   */
  calculateRate(numerator: number, denominator: number): number {
    if (denominator === 0) return 0;
    return Math.round((numerator / denominator) * 1000) / 10;
  },

  /**
   * Calculate mean with 1 decimal
   */
  calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, v) => acc + v, 0);
    return Math.round((sum / values.length) * 10) / 10;
  },

  /**
   * Calculate p-th percentile
   */
  calculatePercentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const weight = index - lower;
    return Math.round((sorted[lower] * (1 - weight) + sorted[upper] * weight) * 10) / 10;
  },

  /**
   * Format duration in seconds → "2m 30s" or "1h 15m"
   */
  formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  },

  /**
   * Format rate as percentage string "95.3%"
   */
  formatRate(rate: number): string {
    return `${rate.toFixed(1)}%`;
  },
};

// ============================================
// MetricsAggregator
// ============================================

export class MetricsAggregator {
  /**
   * Get upload metrics for an organization
   */
  async getUploadMetrics(orgId: string, period: Period = "month"): Promise<UploadMetrics> {
    const supabase = createAdminClient();
    const defaults: UploadMetrics = { total: 0, successRate: 0, avgDuration: 0, failureRate: 0 };
    if (!supabase) return defaults;

    const periodStart = getPeriodStart(period).toISOString();

    const { data: uploads } = await supabase
      .from("upload_operations")
      .select("status, created_at, updated_at")
      .eq("org_id", orgId)
      .gte("created_at", periodStart);

    if (!uploads || uploads.length === 0) return defaults;

    const total = uploads.length;
    const successful = uploads.filter((u) => u.status === "uploaded").length;
    const failed = uploads.filter((u) => u.status === "failed").length;

    // Calculate average duration from created_at to updated_at for completed uploads
    const completedUploads = uploads.filter(
      (u) => u.status === "uploaded" && u.created_at && u.updated_at
    );
    const durations = completedUploads.map((u) =>
      (new Date(u.updated_at).getTime() - new Date(u.created_at).getTime()) / 1000
    );

    return {
      total,
      successRate: MetricsCalculator.calculateRate(successful, total),
      avgDuration: MetricsCalculator.calculateAverage(durations),
      failureRate: MetricsCalculator.calculateRate(failed, total),
    };
  }

  /**
   * Get processing metrics for an organization
   */
  async getProcessingMetrics(orgId: string, period: Period = "month"): Promise<ProcessingMetrics> {
    const supabase = createAdminClient();
    const defaults: ProcessingMetrics = {
      totalJobs: 0,
      successRate: 0,
      avgProcessingTime: 0,
      byJobType: {},
    };
    if (!supabase) return defaults;

    const periodStart = getPeriodStart(period).toISOString();

    // Get org property IDs
    const { data: orgProperties } = await supabase
      .from("properties")
      .select("id")
      .eq("org_id", orgId);

    const propertyIds = orgProperties?.map((p) => p.id) || [];
    if (propertyIds.length === 0) return defaults;

    // Get scene IDs
    const { data: orgScenes } = await supabase
      .from("scenes")
      .select("id")
      .in("property_id", propertyIds);

    const sceneIds = orgScenes?.map((s) => s.id) || [];
    if (sceneIds.length === 0) return defaults;

    // Get processing jobs
    const { data: jobs } = await supabase
      .from("processing_jobs")
      .select("*")
      .in("scene_id", sceneIds)
      .gte("started_at", periodStart);

    if (!jobs || jobs.length === 0) return defaults;

    const totalJobs = jobs.length;
    const completedJobs = jobs.filter((j) => j.status === "completed");
    const failedJobs = jobs.filter((j) => j.status === "failed");

    // Calculate average processing time for completed jobs
    const processingTimes = completedJobs
      .filter((j) => j.started_at && j.finished_at)
      .map((j) =>
        (new Date(j.finished_at!).getTime() - new Date(j.started_at!).getTime()) / 1000
      );

    // Group by job type
    const jobTypeGroups = new Map<string, typeof jobs>();
    for (const job of jobs) {
      const group = jobTypeGroups.get(job.job_type) || [];
      group.push(job);
      jobTypeGroups.set(job.job_type, group);
    }

    const byJobType: Record<string, { total: number; successRate: number; avgTime: number }> = {};
    for (const [jobType, groupJobs] of jobTypeGroups.entries()) {
      const groupCompleted = groupJobs.filter((j) => j.status === "completed");
      const groupTimes = groupCompleted
        .filter((j) => j.started_at && j.finished_at)
        .map((j) =>
          (new Date(j.finished_at!).getTime() - new Date(j.started_at!).getTime()) / 1000
        );

      byJobType[jobType] = {
        total: groupJobs.length,
        successRate: MetricsCalculator.calculateRate(groupCompleted.length, groupJobs.length),
        avgTime: MetricsCalculator.calculateAverage(groupTimes),
      };
    }

    return {
      totalJobs,
      successRate: MetricsCalculator.calculateRate(
        completedJobs.length,
        totalJobs - jobs.filter((j) => j.status === "queued" || j.status === "running").length
      ),
      avgProcessingTime: MetricsCalculator.calculateAverage(processingTimes),
      byJobType,
    };
  }

  /**
   * Get capture metrics for an organization
   */
  async getCaptureMetrics(orgId: string, period: Period = "month"): Promise<CaptureMetrics> {
    const supabase = createAdminClient();
    const defaults: CaptureMetrics = {
      totalSessions: 0,
      avgImagesPerSession: 0,
      completionRate: 0,
    };
    if (!supabase) return defaults;

    const periodStart = getPeriodStart(period).toISOString();

    // Get org property IDs
    const { data: orgProperties } = await supabase
      .from("properties")
      .select("id")
      .eq("org_id", orgId);

    const propertyIds = orgProperties?.map((p) => p.id) || [];
    if (propertyIds.length === 0) return defaults;

    // Get capture sessions
    const { data: sessions } = await supabase
      .from("capture_sessions")
      .select("id, total_images, status, started_at")
      .in("property_id", propertyIds)
      .gte("started_at", periodStart);

    if (!sessions || sessions.length === 0) return defaults;

    const totalSessions = sessions.length;
    const completedSessions = sessions.filter((s) => s.status === "completed");
    const imagesPerSession = sessions.map((s) => s.total_images);

    return {
      totalSessions,
      avgImagesPerSession: MetricsCalculator.calculateAverage(imagesPerSession),
      completionRate: MetricsCalculator.calculateRate(completedSessions.length, totalSessions),
    };
  }

  /**
   * Get viewer metrics for an organization
   */
  async getViewerMetrics(orgId: string, period: Period = "month"): Promise<ViewerMetrics> {
    const supabase = createAdminClient();
    const defaults: ViewerMetrics = {
      totalViews: 0,
      avgEngagementTime: 0,
      byDevice: {},
      byCountry: {},
    };
    if (!supabase) return defaults;

    const periodStart = getPeriodStart(period).toISOString();

    // Get org property IDs
    const { data: orgProperties } = await supabase
      .from("properties")
      .select("id")
      .eq("org_id", orgId);

    const propertyIds = orgProperties?.map((p) => p.id) || [];
    if (propertyIds.length === 0) return defaults;

    // Get property views
    const { data: views } = await supabase
      .from("property_views")
      .select("device_type, country, viewed_at, viewer_session_id")
      .in("property_id", propertyIds)
      .gte("viewed_at", periodStart);

    if (!views || views.length === 0) return defaults;

    const totalViews = views.length;

    // Device breakdown
    const byDevice: Record<string, number> = {};
    for (const view of views) {
      const device = view.device_type || "unknown";
      byDevice[device] = (byDevice[device] || 0) + 1;
    }

    // Country breakdown
    const byCountry: Record<string, number> = {};
    for (const view of views) {
      const country = view.country || "unknown";
      byCountry[country] = (byCountry[country] || 0) + 1;
    }

    // Estimate avg engagement time from events if available
    let avgEngagementTime = 0;
    const { data: engagementEvents } = await supabase
      .from("events")
      .select("metadata")
      .in("property_id", propertyIds)
      .eq("event_type", "viewer_session_end")
      .gte("created_at", periodStart);

    if (engagementEvents && engagementEvents.length > 0) {
      const durations = engagementEvents
        .map((e) => (e.metadata as Record<string, unknown>)?.duration_seconds as number)
        .filter((d): d is number => typeof d === "number" && d > 0);
      avgEngagementTime = MetricsCalculator.calculateAverage(durations);
    }

    return {
      totalViews,
      avgEngagementTime,
      byDevice,
      byCountry,
    };
  }

  /**
   * Get system health overview
   */
  async getSystemHealth(orgId: string): Promise<SystemHealth> {
    const supabase = createAdminClient();
    const defaults: SystemHealth = {
      stuckJobs: 0,
      orphanSessions: 0,
      failedUploads: 0,
      pendingRecovery: 0,
    };
    if (!supabase) return defaults;

    // Get org property IDs
    const { data: orgProperties } = await supabase
      .from("properties")
      .select("id")
      .eq("org_id", orgId);

    const propertyIds = orgProperties?.map((p) => p.id) || [];
    if (propertyIds.length === 0) return defaults;

    // Get scene IDs
    const { data: orgScenes } = await supabase
      .from("scenes")
      .select("id")
      .in("property_id", propertyIds);

    const sceneIds = orgScenes?.map((s) => s.id) || [];

    // Count stuck jobs (running > 30 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    let stuckJobs = 0;
    if (sceneIds.length > 0) {
      const { count } = await supabase
        .from("processing_jobs")
        .select("id", { count: "exact", head: true })
        .in("scene_id", sceneIds)
        .eq("status", "running")
        .lt("started_at", thirtyMinutesAgo);
      stuckJobs = count ?? 0;
    }

    // Count orphan sessions (started/uploading with no media)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: potentialOrphans } = await supabase
      .from("capture_sessions")
      .select("id")
      .in("property_id", propertyIds)
      .in("status", ["started", "uploading"])
      .lt("started_at", oneHourAgo);

    let orphanSessions = 0;
    if (potentialOrphans && potentialOrphans.length > 0) {
      for (const session of potentialOrphans) {
        const { count } = await supabase
          .from("media")
          .select("id", { count: "exact", head: true })
          .eq("session_id", session.id);
        if (count === 0) orphanSessions++;
      }
    }

    // Count failed uploads
    const { count: failedUploads } = await supabase
      .from("upload_operations")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "failed");

    // Count pending recovery items
    const pendingRecovery = stuckJobs + orphanSessions + (failedUploads ?? 0);

    return {
      stuckJobs,
      orphanSessions,
      failedUploads: failedUploads ?? 0,
      pendingRecovery,
    };
  }
}
