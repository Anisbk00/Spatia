// ============================================
// Supabase DB operations for the enhanced GPU
// worker service (distributed processing).
// ============================================
// All functions gracefully return null/void/false
// when Supabase is not configured, with a one-time
// startup warning logged.
// ============================================

import { createClient } from "@supabase/supabase-js";
import type { Database, Worker, ProcessingJob, Scene, Media, CostType } from "./types";

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

export async function sendHeartbeat(workerDbId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase
    .from("workers")
    .update({ last_heartbeat: new Date().toISOString() })
    .eq("id", workerDbId);
}

export async function updateWorkerStatus(
  workerDbId: string,
  status: string,
  updates: Record<string, unknown> = {}
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase
    .from("workers")
    .update({ status, ...updates })
    .eq("id", workerDbId);
}

export async function incrementJobCount(workerDbId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data: worker } = await supabase
    .from("workers")
    .select("current_job_count, max_concurrent_jobs")
    .eq("id", workerDbId)
    .single();

  if (!worker) return;

  const newCount = (worker.current_job_count ?? 0) + 1;
  const newStatus = newCount >= (worker.max_concurrent_jobs ?? 1) ? "busy" : "busy";

  await supabase
    .from("workers")
    .update({ current_job_count: newCount, status: newStatus })
    .eq("id", workerDbId);
}

export async function decrementJobCount(workerDbId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data: worker } = await supabase
    .from("workers")
    .select("current_job_count, max_concurrent_jobs")
    .eq("id", workerDbId)
    .single();

  if (!worker) return;

  const newCount = Math.max(0, (worker.current_job_count ?? 0) - 1);
  const newStatus = newCount === 0 ? "idle" : "busy";

  await supabase
    .from("workers")
    .update({ current_job_count: newCount, status: newStatus })
    .eq("id", workerDbId);
}

export async function recordJobCompletion(
  workerDbId: string,
  durationSeconds: number
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data: worker } = await supabase
    .from("workers")
    .select("total_jobs_completed, avg_job_duration_seconds")
    .eq("id", workerDbId)
    .single();

  if (!worker) return;

  const completed = (worker.total_jobs_completed ?? 0) + 1;
  const prevAvg = worker.avg_job_duration_seconds ?? 0;
  const newAvg = prevAvg === 0 ? durationSeconds : (prevAvg * (completed - 1) + durationSeconds) / completed;

  await supabase
    .from("workers")
    .update({
      total_jobs_completed: completed,
      avg_job_duration_seconds: Math.round(newAvg * 100) / 100,
    })
    .eq("id", workerDbId);
}

export async function recordJobFailure(workerDbId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data: worker } = await supabase
    .from("workers")
    .select("total_jobs_failed")
    .eq("id", workerDbId)
    .single();

  if (!worker) return;

  await supabase
    .from("workers")
    .update({
      total_jobs_failed: (worker.total_jobs_failed ?? 0) + 1,
    })
    .eq("id", workerDbId);
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

export async function claimJob(jobId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { error } = await supabase
    .from("processing_jobs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "queued");

  return !error;
}

export async function completeJob(jobId: string, logs: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  await supabase
    .from("processing_jobs")
    .update({
      status: "completed",
      finished_at: new Date().toISOString(),
      logs,
    })
    .eq("id", jobId);
}

export async function failJob(jobId: string, logs: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data: job } = await supabase
    .from("processing_jobs")
    .select("retry_count")
    .eq("id", jobId)
    .single();

  const retryCount = (job?.retry_count || 0) + 1;

  await supabase
    .from("processing_jobs")
    .update({
      status: retryCount >= 3 ? "failed" : "queued",
      retry_count: retryCount,
      logs,
      finished_at: retryCount >= 3 ? new Date().toISOString() : null,
      started_at: null,
    })
    .eq("id", jobId);
}

// ============================================
// Scene operations
// ============================================

export async function getSceneById(sceneId: string): Promise<Scene | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("scenes")
    .select("*")
    .eq("id", sceneId)
    .single();

  if (error) return null;
  return data as Scene;
}

export async function updateSceneStatus(
  sceneId: string,
  status: string,
  updates: Record<string, unknown> = {}
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  await supabase
    .from("scenes")
    .update({ status, ...updates })
    .eq("id", sceneId);
}

export async function completeScene(
  sceneId: string,
  modelUrl: string,
  thumbnailUrl: string,
  qualityScore: number,
  processingTimeSec: number
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  await supabase
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
}

// ============================================
// Session operations
// ============================================

export async function completeSession(sessionId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  await supabase
    .from("capture_sessions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}

// ============================================
// Property operations
// ============================================

export async function setPropertyReady(propertyId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  await supabase
    .from("properties")
    .update({ status: "ready" })
    .eq("id", propertyId);
}

export async function getPropertyOrgId(propertyId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

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
}): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

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
    console.error("Failed to record cost:", error);
  }
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
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  await supabase
    .from("ai_enhancements")
    .update({ status, ...updates })
    .eq("id", enhancementId);
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
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  await supabase
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
}
