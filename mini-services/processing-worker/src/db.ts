// ============================================
// Supabase DB operations for the worker
// ============================================

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

let supabaseInstance: ReturnType<typeof createClient<Database>> | null = null;

export function getSupabase(): ReturnType<typeof createClient<Database>> {
  if (!supabaseInstance) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY/ANON_KEY must be set");
    }
    supabaseInstance = createClient<Database>(url, key);
  }
  return supabaseInstance;
}

// ---- Job operations ----

export async function getNextQueuedJob() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("processing_jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data;
}

export async function claimJob(jobId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("processing_jobs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "queued"); // Only claim if still queued

  return !error;
}

export async function completeJob(jobId: string, logs: string) {
  const supabase = getSupabase();
  await supabase
    .from("processing_jobs")
    .update({
      status: "completed",
      finished_at: new Date().toISOString(),
      logs,
    })
    .eq("id", jobId);
}

export async function failJob(jobId: string, logs: string) {
  const supabase = getSupabase();
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

// ---- Scene operations ----

export async function getSceneById(sceneId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("scenes")
    .select("*")
    .eq("id", sceneId)
    .single();

  if (error) return null;
  return data;
}

export async function updateSceneStatus(
  sceneId: string,
  status: string,
  updates: Record<string, unknown> = {}
) {
  const supabase = getSupabase();
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
) {
  const supabase = getSupabase();
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

// ---- Session operations ----

export async function completeSession(sessionId: string) {
  const supabase = getSupabase();
  await supabase
    .from("capture_sessions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}

// ---- Property operations ----

export async function setPropertyReady(propertyId: string) {
  const supabase = getSupabase();
  await supabase
    .from("properties")
    .update({ status: "ready" })
    .eq("id", propertyId);
}

// ---- Media operations ----

export async function getSessionMedia(sessionId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("media")
    .select("url, order_index, metadata")
    .eq("session_id", sessionId)
    .order("order_index", { ascending: true });

  if (error) return [];
  return data || [];
}
