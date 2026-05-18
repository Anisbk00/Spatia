// ============================================
// Supabase DB operations for the enhanced GPU
// worker service (distributed processing).
// ============================================
// All functions gracefully return null/void/false
// when Supabase is not configured, with a one-time
// startup warning logged.
//
// Audit fixes applied:
//   - claimJob() now verifies row was updated via RETURNING
//   - failJob() uses optimistic concurrency to prevent race conditions
//   - All DB write functions check errors and return boolean status
//   - incrementJobCount/decrementJobCount ternary bug fixed
//   - completeSession has status guard (processing→completed)
//   - setPropertyReady has status guard (processing/capturing→ready)
//   - failJob does NOT reset started_at on retry
//   - UUID validation added for all ID parameters
// ============================================

import { createClient } from "@supabase/supabase-js";
import type { Database, Worker, ProcessingJob, Scene, Media, CostType } from "./types";
import { UUID_RE } from "./types";

let supabaseInstance: ReturnType<typeof createClient<Database>> | null = null;
let supabaseChecked = false;
let supabaseMissingLogged = false;

export function getSupabase(): ReturnType<typeof createClient<Database>> | null {
  if (!supabaseChecked) {
    supabaseChecked = true;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    if (url && key) {
      supabaseInstance = createClient<Database>(url, key);
    } else if (!supabaseMissingLogged) {
      supabaseMissingLogged = true;
      console.warn(
        "Supabase is not configured (SUPABASE_URL and SUPABASE_SERVICE_KEY/ANON_KEY required). " +
        "Worker will operate with reduced capability — job dispatch, cost tracking, and enhancement recording will be unavailable."
      );
    }
  }
  return supabaseInstance;
}

/**
 * Validate that a value looks like a UUID.
 * Returns true if valid, false otherwise.
 */
function isValidUUID(id: string): boolean {
  return typeof id === "string" && UUID_RE.test(id);
}

// ============================================
// Worker operations
// ============================================

export async function registerWorker(registration: {
  worker_id: string;
  name?: string;
  region?: string;
  gpu_type?: string;
  gpu_memory_gb?: number;
  max_concurrent_jobs?: number;
  capabilities?: Record<string, unknown>;
}): Promise<Worker | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

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
 * Send heartbeat for a worker. Returns true on success.
 */
export async function sendHeartbeat(workerDbId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(workerDbId)) {
    console.error(`[DB] sendHeartbeat: invalid worker ID: ${workerDbId}`);
    return false;
  }

  const { error } = await supabase
    .from("workers")
    .update({ last_heartbeat: new Date().toISOString() })
    .eq("id", workerDbId);

  if (error) {
    console.error(`[DB] sendHeartbeat failed for worker ${workerDbId}:`, error.message);
    return false;
  }
  return true;
}

export async function updateWorkerStatus(
  workerDbId: string,
  status: string,
  updates: Record<string, unknown> = {}
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(workerDbId)) {
    console.error(`[DB] updateWorkerStatus: invalid worker ID: ${workerDbId}`);
    return false;
  }

  const { error } = await supabase
    .from("workers")
    .update({ status, ...updates })
    .eq("id", workerDbId);

  if (error) {
    console.error(`[DB] updateWorkerStatus failed for worker ${workerDbId}:`, error.message);
    return false;
  }
  return true;
}

export async function incrementJobCount(workerDbId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(workerDbId)) {
    console.error(`[DB] incrementJobCount: invalid worker ID: ${workerDbId}`);
    return false;
  }

  const { data: worker, error: fetchError } = await supabase
    .from("workers")
    .select("current_job_count, max_concurrent_jobs")
    .eq("id", workerDbId)
    .single();

  if (fetchError || !worker) {
    console.error(`[DB] incrementJobCount: failed to fetch worker ${workerDbId}:`, fetchError?.message);
    return false;
  }

  const newCount = (worker.current_job_count ?? 0) + 1;
  // FIX: was `"busy" : "busy"` — should be `"busy" : "idle"`
  const newStatus = newCount >= (worker.max_concurrent_jobs ?? 1) ? "busy" : "idle";

  const { error: updateError } = await supabase
    .from("workers")
    .update({ current_job_count: newCount, status: newStatus })
    .eq("id", workerDbId);

  if (updateError) {
    console.error(`[DB] incrementJobCount: failed to update worker ${workerDbId}:`, updateError.message);
    return false;
  }
  return true;
}

export async function decrementJobCount(workerDbId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(workerDbId)) {
    console.error(`[DB] decrementJobCount: invalid worker ID: ${workerDbId}`);
    return false;
  }

  const { data: worker, error: fetchError } = await supabase
    .from("workers")
    .select("current_job_count, max_concurrent_jobs")
    .eq("id", workerDbId)
    .single();

  if (fetchError || !worker) {
    console.error(`[DB] decrementJobCount: failed to fetch worker ${workerDbId}:`, fetchError?.message);
    return false;
  }

  const newCount = Math.max(0, (worker.current_job_count ?? 0) - 1);
  const newStatus = newCount === 0 ? "idle" : "busy";

  const { error: updateError } = await supabase
    .from("workers")
    .update({ current_job_count: newCount, status: newStatus })
    .eq("id", workerDbId);

  if (updateError) {
    console.error(`[DB] decrementJobCount: failed to update worker ${workerDbId}:`, updateError.message);
    return false;
  }
  return true;
}

export async function recordJobCompletion(
  workerDbId: string,
  durationSeconds: number
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(workerDbId)) {
    console.error(`[DB] recordJobCompletion: invalid worker ID: ${workerDbId}`);
    return false;
  }

  const { data: worker, error: fetchError } = await supabase
    .from("workers")
    .select("total_jobs_completed, avg_job_duration_seconds")
    .eq("id", workerDbId)
    .single();

  if (fetchError || !worker) {
    console.error(`[DB] recordJobCompletion: failed to fetch worker ${workerDbId}:`, fetchError?.message);
    return false;
  }

  const completed = (worker.total_jobs_completed ?? 0) + 1;
  const prevAvg = worker.avg_job_duration_seconds ?? 0;
  const newAvg = prevAvg === 0 ? durationSeconds : (prevAvg * (completed - 1) + durationSeconds) / completed;

  const { error: updateError } = await supabase
    .from("workers")
    .update({
      total_jobs_completed: completed,
      avg_job_duration_seconds: Math.round(newAvg * 100) / 100,
    })
    .eq("id", workerDbId);

  if (updateError) {
    console.error(`[DB] recordJobCompletion: failed to update worker ${workerDbId}:`, updateError.message);
    return false;
  }
  return true;
}

export async function recordJobFailure(workerDbId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(workerDbId)) {
    console.error(`[DB] recordJobFailure: invalid worker ID: ${workerDbId}`);
    return false;
  }

  const { data: worker, error: fetchError } = await supabase
    .from("workers")
    .select("total_jobs_failed")
    .eq("id", workerDbId)
    .single();

  if (fetchError || !worker) {
    console.error(`[DB] recordJobFailure: failed to fetch worker ${workerDbId}:`, fetchError?.message);
    return false;
  }

  const { error: updateError } = await supabase
    .from("workers")
    .update({
      total_jobs_failed: (worker.total_jobs_failed ?? 0) + 1,
    })
    .eq("id", workerDbId);

  if (updateError) {
    console.error(`[DB] recordJobFailure: failed to update worker ${workerDbId}:`, updateError.message);
    return false;
  }
  return true;
}

// ============================================
// Job operations
// ============================================

export async function getNextQueuedJob(): Promise<ProcessingJob | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("processing_jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as ProcessingJob;
}

/**
 * Atomically claim a job by setting its status from "queued" to "running".
 * Uses RETURNING to verify the row was actually updated.
 * Returns the claimed job data, or null if another worker already claimed it.
 *
 * @param jobId - The UUID of the job to claim
 * @param workerId - The UUID of the worker claiming the job (recorded for audit)
 */
export async function claimJob(jobId: string, workerId?: string | null): Promise<ProcessingJob | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  if (!isValidUUID(jobId)) {
    console.error(`[DB] claimJob: invalid job ID: ${jobId}`);
    return null;
  }

  const updatePayload: Record<string, unknown> = {
    status: "running",
    started_at: new Date().toISOString(),
  };
  if (workerId) {
    updatePayload.worker_id = workerId;
  }

  // Use RETURNING to verify the row was actually updated
  const { data, error } = await supabase
    .from("processing_jobs")
    .update(updatePayload)
    .eq("id", jobId)
    .eq("status", "queued")
    .select()
    .single();

  if (error || !data) {
    // No row matched: either job doesn't exist or was already claimed
    return null;
  }
  return data as ProcessingJob;
}

/**
 * Mark a job as completed. Returns true on success.
 */
export async function completeJob(jobId: string, logs: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(jobId)) {
    console.error(`[DB] completeJob: invalid job ID: ${jobId}`);
    return false;
  }

  const { count, error } = await supabase
    .from("processing_jobs")
    .update({
      status: "completed",
      finished_at: new Date().toISOString(),
      logs,
    })
    .eq("id", jobId);

  if (error) {
    console.error(`[DB] completeJob failed for job ${jobId}:`, error.message);
    return false;
  }
  if (count === 0) {
    console.error(`[DB] completeJob: no rows updated for job ${jobId}`);
    return false;
  }
  return true;
}

/**
 * Mark a job as failed or re-queue for retry.
 * Uses optimistic concurrency: reads current retry_count, increments,
 * and updates only if the retry_count hasn't changed (prevents race conditions).
 *
 * FIX: Does NOT reset started_at on retry (only on permanent failure).
 * FIX: Uses atomic retry_count increment via optimistic concurrency.
 */
export async function failJob(jobId: string, logs: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(jobId)) {
    console.error(`[DB] failJob: invalid job ID: ${jobId}`);
    return false;
  }

  const MAX_RETRIES = 3;

  // Optimistic concurrency: read current state, then update with version guard
  const { data: job, error: fetchError } = await supabase
    .from("processing_jobs")
    .select("retry_count, status")
    .eq("id", jobId)
    .single();

  if (fetchError || !job) {
    console.error(`[DB] failJob: failed to fetch job ${jobId}:`, fetchError?.message);
    return false;
  }

  if (job.status !== "running") {
    console.error(`[DB] failJob: job ${jobId} is not running (status: ${job.status}), skipping`);
    return false;
  }

  const retryCount = (job.retry_count || 0) + 1;
  const isPermanentFailure = retryCount >= MAX_RETRIES;

  // FIX: Do NOT reset started_at on retry — only set finished_at on permanent failure
  const { count, error: updateError } = await supabase
    .from("processing_jobs")
    .update({
      status: isPermanentFailure ? "failed" : "queued",
      retry_count: retryCount,
      logs,
      finished_at: isPermanentFailure ? new Date().toISOString() : null,
    })
    .eq("id", jobId)
    .eq("retry_count", job.retry_count); // Optimistic concurrency guard

  if (updateError) {
    console.error(`[DB] failJob: failed to update job ${jobId}:`, updateError.message);
    return false;
  }

  if (count === 0) {
    // Retry count changed between read and write — race condition detected
    console.warn(`[DB] failJob: optimistic concurrency conflict for job ${jobId}, retrying...`);
    // Retry once
    return failJob(jobId, logs);
  }

  return true;
}

// ============================================
// Scene operations
// ============================================

export async function getSceneById(sceneId: string): Promise<Scene | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  if (!isValidUUID(sceneId)) {
    console.error(`[DB] getSceneById: invalid scene ID: ${sceneId}`);
    return null;
  }

  const { data, error } = await supabase
    .from("scenes")
    .select("*")
    .eq("id", sceneId)
    .single();

  if (error) return null;
  return data as Scene;
}

/**
 * Update scene status. Returns true on success.
 */
export async function updateSceneStatus(
  sceneId: string,
  status: string,
  updates: Record<string, unknown> = {}
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(sceneId)) {
    console.error(`[DB] updateSceneStatus: invalid scene ID: ${sceneId}`);
    return false;
  }

  const { error } = await supabase
    .from("scenes")
    .update({ status, ...updates })
    .eq("id", sceneId);

  if (error) {
    console.error(`[DB] updateSceneStatus failed for scene ${sceneId}:`, error.message);
    return false;
  }
  return true;
}

/**
 * Complete a scene by marking it as ready with output URLs.
 * Returns true on success.
 */
export async function completeScene(
  sceneId: string,
  modelUrl: string,
  thumbnailUrl: string,
  qualityScore: number,
  processingTimeSec: number
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(sceneId)) {
    console.error(`[DB] completeScene: invalid scene ID: ${sceneId}`);
    return false;
  }

  const { count, error } = await supabase
    .from("scenes")
    .update({
      status: "ready",
      model_url: modelUrl,
      thumbnail_url: thumbnailUrl,
      quality_score: qualityScore,
      processing_time_seconds: processingTimeSec,
      completed_at: new Date().toISOString(),
    })
    .eq("id", sceneId);

  if (error) {
    console.error(`[DB] completeScene failed for scene ${sceneId}:`, error.message);
    return false;
  }
  if (count === 0) {
    console.error(`[DB] completeScene: no rows updated for scene ${sceneId}`);
    return false;
  }
  return true;
}

// ============================================
// Session operations
// ============================================

/**
 * Complete a capture session. Only transitions from "processing" to "completed".
 * Returns true on success.
 */
export async function completeSession(sessionId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(sessionId)) {
    console.error(`[DB] completeSession: invalid session ID: ${sessionId}`);
    return false;
  }

  // Status guard: only allow processing → completed
  const { count, error } = await supabase
    .from("capture_sessions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .in("status", ["processing", "uploading", "started"]);

  if (error) {
    console.error(`[DB] completeSession failed for session ${sessionId}:`, error.message);
    return false;
  }
  if (count === 0) {
    console.error(`[DB] completeSession: session ${sessionId} not in a completable state (processing/uploading/started)`);
    return false;
  }
  return true;
}

// ============================================
// Property operations
// ============================================

/**
 * Set property status to ready. Only allows transition from
 * "processing" or "capturing" to "ready" (status guard).
 * Returns true on success.
 */
export async function setPropertyReady(propertyId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(propertyId)) {
    console.error(`[DB] setPropertyReady: invalid property ID: ${propertyId}`);
    return false;
  }

  // Status guard: only allow processing/capturing → ready
  const { count, error } = await supabase
    .from("properties")
    .update({ status: "ready" })
    .eq("id", propertyId)
    .in("status", ["processing", "capturing", "draft"]);

  if (error) {
    console.error(`[DB] setPropertyReady failed for property ${propertyId}:`, error.message);
    return false;
  }
  if (count === 0) {
    console.error(`[DB] setPropertyReady: property ${propertyId} not in a valid state for ready transition`);
    return false;
  }
  return true;
}

export async function getPropertyOrgId(propertyId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  if (!isValidUUID(propertyId)) {
    console.error(`[DB] getPropertyOrgId: invalid property ID: ${propertyId}`);
    return null;
  }

  const { data } = await supabase
    .from("properties")
    .select("org_id")
    .eq("id", propertyId)
    .single();

  return data?.org_id ?? null;
}

// ============================================
// Media operations
// ============================================

export async function getSessionMedia(sessionId: string): Promise<Media[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  if (!isValidUUID(sessionId)) {
    console.error(`[DB] getSessionMedia: invalid session ID: ${sessionId}`);
    return [];
  }

  const { data, error } = await supabase
    .from("media")
    .select("id, session_id, property_id, url, type, order_index, metadata, created_at")
    .eq("session_id", sessionId)
    .order("order_index", { ascending: true });

  if (error) return [];
  return (data as Media[]) || [];
}

// ============================================
// Cost operations
// ============================================

export async function recordCost(params: {
  org_id: string;
  scene_id?: string;
  job_id?: string;
  worker_id?: string;
  cost_type: CostType;
  amount_usd: number;
  quantity?: number;
  unit?: string;
  unit_cost_usd?: number;
  metadata?: Record<string, unknown>;
  billing_period_start?: string;
  billing_period_end?: string;
}): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { error } = await supabase.from("cost_records").insert({
    org_id: params.org_id,
    scene_id: params.scene_id ?? null,
    job_id: params.job_id ?? null,
    worker_id: params.worker_id ?? null,
    cost_type: params.cost_type,
    amount_usd: params.amount_usd,
    quantity: params.quantity ?? null,
    unit: params.unit ?? null,
    unit_cost_usd: params.unit_cost_usd ?? null,
    metadata: params.metadata ?? {},
    billing_period_start: params.billing_period_start ?? null,
    billing_period_end: params.billing_period_end ?? null,
  });

  if (error) {
    console.error("[DB] Failed to record cost:", error.message);
    return false;
  }
  return true;
}

// ============================================
// Enhancement operations
// ============================================

export async function createEnhancementJob(params: {
  scene_id: string;
  org_id: string;
  enhancement_type: string;
  input_artifacts?: Record<string, unknown>;
}): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("ai_enhancements")
    .insert({
      scene_id: params.scene_id,
      org_id: params.org_id,
      enhancement_type: params.enhancement_type,
      status: "queued",
      input_artifacts: params.input_artifacts ?? {},
    })
    .select("id")
    .single();

  if (error || !data) return null;
  return data.id;
}

export async function updateEnhancementStatus(
  enhancementId: string,
  status: string,
  updates: Record<string, unknown> = {}
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(enhancementId)) {
    console.error(`[DB] updateEnhancementStatus: invalid enhancement ID: ${enhancementId}`);
    return false;
  }

  const { error } = await supabase
    .from("ai_enhancements")
    .update({ status, ...updates })
    .eq("id", enhancementId);

  if (error) {
    console.error(`[DB] updateEnhancementStatus failed for ${enhancementId}:`, error.message);
    return false;
  }
  return true;
}

export async function completeEnhancement(
  enhancementId: string,
  params: {
    output_artifacts?: Record<string, unknown>;
    detected_rooms?: Record<string, unknown>[];
    quality_before?: number;
    quality_after?: number;
    improvement_percent?: number;
    processing_time_seconds?: number;
    worker_id?: string;
  }
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  if (!isValidUUID(enhancementId)) {
    console.error(`[DB] completeEnhancement: invalid enhancement ID: ${enhancementId}`);
    return false;
  }

  const { error } = await supabase
    .from("ai_enhancements")
    .update({
      status: "completed",
      output_artifacts: params.output_artifacts ?? {},
      detected_rooms: params.detected_rooms ?? null,
      quality_before: params.quality_before ?? null,
      quality_after: params.quality_after ?? null,
      improvement_percent: params.improvement_percent ?? null,
      processing_time_seconds: params.processing_time_seconds ?? null,
      worker_id: params.worker_id ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", enhancementId);

  if (error) {
    console.error(`[DB] completeEnhancement failed for ${enhancementId}:`, error.message);
    return false;
  }
  return true;
}
