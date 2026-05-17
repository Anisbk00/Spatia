// ============================================
// WorkerRegistry — Manages GPU workers in the
// distributed processing cluster via Supabase.
// ============================================
// Tracks worker registration, heartbeats,
// status transitions, and stale worker cleanup.
// ============================================

import { createClient } from "@/lib/supabase/server";
import type { Worker, WorkerRegistration, WorkerStatus } from "@/lib/types";

const HEARTBEAT_STALE_MS = 2 * 60 * 1000; // 2 minutes
const HEARTBEAT_OFFLINE_MS = 5 * 60 * 1000; // 5 minutes

export class WorkerRegistry {
  /**
   * Register a new worker in the workers table.
   * Returns the full Worker record after insertion.
   */
  async registerWorker(registration: WorkerRegistration): Promise<Worker> {
    const supabase = await createClient();
    if (!supabase) {
      throw new Error("Supabase client not available");
    }

    const { data, error } = await supabase
      .from("workers")
      .insert({
        worker_id: registration.worker_id,
        name: registration.name ?? null,
        region: registration.region ?? "us-east",
        status: "idle",
        capabilities: registration.capabilities ?? {},
        current_job_count: 0,
        max_concurrent_jobs: registration.max_concurrent_jobs ?? 1,
        gpu_type: registration.gpu_type ?? null,
        gpu_memory_gb: registration.gpu_memory_gb ?? null,
        last_heartbeat: new Date().toISOString(),
        started_at: new Date().toISOString(),
        total_jobs_completed: 0,
        total_jobs_failed: 0,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to register worker: ${error.message}`);
    }

    return data as Worker;
  }

  /**
   * Deregister a worker by setting its status to 'offline'.
   */
  async deregisterWorker(workerId: string): Promise<void> {
    const supabase = await createClient();
    if (!supabase) return;

    const { error } = await supabase
      .from("workers")
      .update({ status: "offline" })
      .eq("worker_id", workerId);

    if (error) {
      throw new Error(`Failed to deregister worker: ${error.message}`);
    }
  }

  /**
   * Update the worker's last_heartbeat timestamp.
   */
  async sendHeartbeat(workerId: string): Promise<void> {
    const supabase = await createClient();
    if (!supabase) return;

    const { error } = await supabase
      .from("workers")
      .update({ last_heartbeat: new Date().toISOString() })
      .eq("worker_id", workerId);

    if (error) {
      throw new Error(`Failed to send heartbeat: ${error.message}`);
    }
  }

  /**
   * Update a worker's status and optionally its current_job_count.
   */
  async updateWorkerStatus(
    workerId: string,
    status: WorkerStatus,
    jobCount?: number
  ): Promise<void> {
    const supabase = await createClient();
    if (!supabase) return;

    const updates: Record<string, unknown> = { status };
    if (jobCount !== undefined) {
      updates.current_job_count = jobCount;
    }

    const { error } = await supabase
      .from("workers")
      .update(updates)
      .eq("worker_id", workerId);

    if (error) {
      throw new Error(`Failed to update worker status: ${error.message}`);
    }
  }

  /**
   * Get workers that are available for job assignment.
   * Available = idle or busy with remaining capacity, heartbeat within 2 min.
   * Optional filters by region and GPU type.
   */
  async getAvailableWorkers(
    region?: string,
    gpuType?: string
  ): Promise<Worker[]> {
    const supabase = await createClient();
    if (!supabase) return [];

    const heartbeatCutoff = new Date(
      Date.now() - HEARTBEAT_STALE_MS
    ).toISOString();

    let query = supabase
      .from("workers")
      .select("*")
      .in("status", ["idle", "busy"])
      .gt("last_heartbeat", heartbeatCutoff);

    if (region) {
      query = query.eq("region", region);
    }
    if (gpuType) {
      query = query.eq("gpu_type", gpuType);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Failed to get available workers:", error);
      return [];
    }

    // Filter to only workers with remaining capacity
    const workers = (data as Worker[]).filter(
      (w) => w.current_job_count < w.max_concurrent_jobs
    );

    return workers;
  }

  /**
   * Get a worker by its unique worker_id field.
   */
  async getWorkerByWorkerId(workerId: string): Promise<Worker | null> {
    const supabase = await createClient();
    if (!supabase) return null;

    const { data, error } = await supabase
      .from("workers")
      .select("*")
      .eq("worker_id", workerId)
      .single();

    if (error || !data) return null;
    return data as Worker;
  }

  /**
   * Get all workers (for monitoring dashboards).
   */
  async getAllWorkers(): Promise<Worker[]> {
    const supabase = await createClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("workers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to get all workers:", error);
      return [];
    }

    return (data as Worker[]) ?? [];
  }

  /**
   * Mark workers with heartbeats older than 5 minutes as 'offline'.
   * Returns the count of workers marked as stale.
   */
  async markStaleWorkers(): Promise<number> {
    const supabase = await createClient();
    if (!supabase) return 0;

    const offlineCutoff = new Date(
      Date.now() - HEARTBEAT_OFFLINE_MS
    ).toISOString();

    // First get the count of stale workers
    const { count, error: countError } = await supabase
      .from("workers")
      .select("*", { count: "exact", head: true })
      .in("status", ["idle", "busy", "draining"])
      .lt("last_heartbeat", offlineCutoff);

    if (countError || !count) {
      return 0;
    }

    // Update them to offline
    const { error } = await supabase
      .from("workers")
      .update({ status: "offline" })
      .in("status", ["idle", "busy", "draining"])
      .lt("last_heartbeat", offlineCutoff);

    if (error) {
      console.error("Failed to mark stale workers:", error);
      return 0;
    }

    return count;
  }
}
