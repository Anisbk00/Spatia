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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireValidUUID(id: string, label: string): void {
  if (!UUID_RE.test(id)) {
    throw new Error(`Invalid ${label}: ${id}`);
  }
}

// ---- Job operations ----

export async function getNextQueuedJob(jobType?: string) {
  const supabase = getSupabase();
  let query = supabase
    .from("processing_jobs")
    .select("*")
    .eq("status", "queued");

  if (jobType) {
    query = query.eq("job_type", jobType);
  }

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data;
}

export async function claimJob(jobId: string): Promise<boolean> {
  requireValidUUID(jobId, "job ID");
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("processing_jobs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "queued");

  if (error) return false;
  return (count ?? 0) > 0;
}

export async function completeJob(jobId: string, logs: string) {
  requireValidUUID(jobId, "job ID");
  const supabase = getSupabase();
  const { error } = await supabase
    .from("processing_jobs")
    .update({
      status: "completed",
      finished_at: new Date().toISOString(),
      logs,
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to complete job ${jobId}: ${error.message}`);
  }
}

export async function failJob(jobId: string, logs: string) {
  requireValidUUID(jobId, "job ID");
  const supabase = getSupabase();

  // Optimistic locking: read current retry_count, then update with CAS guard
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: job, error: readError } = await supabase
      .from("processing_jobs")
      .select("retry_count")
      .eq("id", jobId)
      .single();

    if (readError || !job) {
      throw new Error(`Failed to read job ${jobId} for retry: ${readError?.message || "not found"}`);
    }

    const newRetryCount = job.retry_count + 1;
    const isFinalFailure = newRetryCount >= 3;

    const { count, error: updateError } = await supabase
      .from("processing_jobs")
      .update({
        status: isFinalFailure ? "failed" : "queued",
        retry_count: newRetryCount,
        logs,
        finished_at: isFinalFailure ? new Date().toISOString() : null,
        // Preserve started_at on retry for accurate duration tracking
      })
      .eq("id", jobId)
      .eq("retry_count", job.retry_count); // CAS guard

    if (updateError) {
      throw new Error(`Failed to update job ${jobId}: ${updateError.message}`);
    }

    if ((count ?? 0) > 0) {
      return; // Successfully updated
    }

    // CAS conflict — retry
  }

  throw new Error(`Failed to update job ${jobId} after ${MAX_ATTEMPTS} attempts (concurrent modification)`);
}

// ---- Scene operations ----

export async function getSceneById(sceneId: string) {
  requireValidUUID(sceneId, "scene ID");
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
  requireValidUUID(sceneId, "scene ID");
  const supabase = getSupabase();
  const { error } = await supabase
    .from("scenes")
    .update({ status, ...updates })
    .eq("id", sceneId);

  if (error) {
    throw new Error(`Failed to update scene ${sceneId} status to ${status}: ${error.message}`);
  }
}

export async function completeScene(
  sceneId: string,
  modelUrl: string,
  thumbnailUrl: string,
  qualityScore: number,
  processingTimeSec: number
) {
  requireValidUUID(sceneId, "scene ID");
  const supabase = getSupabase();
  const { error } = await supabase
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
    throw new Error(`Failed to complete scene ${sceneId}: ${error.message}`);
  }
}

// ---- Session operations ----

export async function completeSession(sessionId: string) {
  requireValidUUID(sessionId, "session ID");
  const supabase = getSupabase();

  // Verify all scenes in the session are done (ready or failed)
  const { data: scenes, error: scenesError } = await supabase
    .from("scenes")
    .select("status")
    .eq("session_id", sessionId);

  if (scenesError) {
    throw new Error(`Failed to check session ${sessionId} scenes: ${scenesError.message}`);
  }

  if (scenes && scenes.length > 0) {
    const allDone = scenes.every((s) => s.status === "ready" || s.status === "failed");
    if (!allDone) {
      throw new Error(
        `Cannot complete session ${sessionId}: not all scenes are done ` +
        `(statuses: ${scenes.map((s) => s.status).join(", ")})`
      );
    }
  }

  // Status guard: only allow transition from processing to completed
  const { data: session, error: sessionReadError } = await supabase
    .from("capture_sessions")
    .select("status")
    .eq("id", sessionId)
    .single();

  if (sessionReadError || !session) {
    throw new Error(`Failed to read session ${sessionId}: ${sessionReadError?.message || "not found"}`);
  }

  if (session.status !== "processing") {
    throw new Error(
      `Cannot complete session ${sessionId}: current status is "${session.status}", expected "processing"`
    );
  }

  const { error } = await supabase
    .from("capture_sessions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to complete session ${sessionId}: ${error.message}`);
  }
}

// ---- Property operations ----

export async function setPropertyReady(propertyId: string) {
  requireValidUUID(propertyId, "property ID");
  const supabase = getSupabase();

  // Check that ALL scenes for the property are ready
  const { data: scenes, error: scenesError } = await supabase
    .from("scenes")
    .select("status")
    .eq("property_id", propertyId);

  if (scenesError) {
    throw new Error(`Failed to check property ${propertyId} scenes: ${scenesError.message}`);
  }

  if (scenes && scenes.length > 0) {
    const allReady = scenes.every((s) => s.status === "ready");
    if (!allReady) {
      throw new Error(
        `Cannot set property ${propertyId} ready: not all scenes are ready ` +
        `(statuses: ${scenes.map((s) => s.status).join(", ")})`
      );
    }
  }

  // Status guard: only allow from processing or capturing
  const { data: property, error: propReadError } = await supabase
    .from("properties")
    .select("status")
    .eq("id", propertyId)
    .single();

  if (propReadError || !property) {
    throw new Error(`Failed to read property ${propertyId}: ${propReadError?.message || "not found"}`);
  }

  if (property.status !== "processing" && property.status !== "capturing") {
    throw new Error(
      `Cannot set property ${propertyId} ready: current status is "${property.status}", expected "processing" or "capturing"`
    );
  }

  const { error } = await supabase
    .from("properties")
    .update({ status: "ready" })
    .eq("id", propertyId);

  if (error) {
    throw new Error(`Failed to set property ${propertyId} ready: ${error.message}`);
  }
}

// ---- Media operations ----

export async function getSessionMedia(sessionId: string) {
  requireValidUUID(sessionId, "session ID");
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("media")
    .select("url, order_index, metadata")
    .eq("session_id", sessionId)
    .order("order_index", { ascending: true });

  if (error) return [];
  return data || [];
}
