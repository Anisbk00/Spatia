import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/process/status?session_id=xxx
 * Returns the current processing status for a capture session.
 * Used by the frontend for polling.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  // Use admin client for data operations (bypasses RLS)
  const adminClient = createAdminClient();
  const dataClient = adminClient || supabase;

  // Fetch session status
  const { data: session } = await dataClient
    .from("capture_sessions")
    .select("id, status, total_images, property_id")
    .eq("id", sessionId)
    .single();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Fetch scene
  const { data: scene } = await dataClient
    .from("scenes")
    .select("id, status, model_url, thumbnail_url, quality_score, processing_time_seconds")
    .eq("session_id", sessionId)
    .limit(1)
    .single();

  // Fetch processing jobs for this scene
  let jobs: Array<{ id: string; job_type: string; status: string; started_at: string | null; finished_at: string | null; retry_count: number }> = [];
  if (scene) {
    const { data: jobData } = await dataClient
      .from("processing_jobs")
      .select("id, job_type, status, started_at, finished_at, retry_count")
      .eq("scene_id", scene.id)
      .order("created_at", { ascending: true });
    jobs = jobData || [];
  }

  // Compute pipeline progress
  const currentJob = jobs.find((j) => j.status === "running") || jobs[jobs.length - 1];
  const pipelineStage = getPipelineStage(session.status, currentJob?.status, currentJob?.job_type);

  return NextResponse.json({
    session: {
      id: session.id,
      status: session.status,
      totalImages: session.total_images,
      propertyId: session.property_id,
    },
    scene: scene
      ? {
          id: scene.id,
          status: scene.status,
          modelUrl: scene.model_url,
          thumbnailUrl: scene.thumbnail_url,
          qualityScore: scene.quality_score,
          processingTimeSec: scene.processing_time_seconds,
        }
      : null,
    jobs,
    pipeline: pipelineStage,
  });
}

function getPipelineStage(
  sessionStatus: string,
  jobStatus?: string,
  jobType?: string
) {
  if (sessionStatus === "completed") {
    return { stage: "completed", label: "3D Scene Ready", progress: 100 };
  }
  if (sessionStatus === "failed" || jobStatus === "failed") {
    return { stage: "failed", label: "Processing Failed", progress: 0 };
  }

  if (!jobStatus || jobStatus === "queued") {
    return { stage: "queued", label: "Queued for processing", progress: 5 };
  }

  // Map job type to pipeline progress
  switch (jobType) {
    case "sfm_reconstruction":
      if (jobStatus === "running") {
        return { stage: "sfm", label: "Analyzing images & building 3D structure", progress: 40 };
      }
      break;
    case "gaussian_splat_generation":
      if (jobStatus === "running") {
        return { stage: "splat", label: "Generating Gaussian Splat scene", progress: 65 };
      }
      break;
    case "optimization":
      if (jobStatus === "running") {
        return { stage: "optimization", label: "Optimizing for web delivery", progress: 80 };
      }
      break;
    case "thumbnail_generation":
      if (jobStatus === "running") {
        return { stage: "packaging", label: "Packaging final scene", progress: 90 };
      }
      break;
    default:
      // For MVP with single sfm_reconstruction job, infer progress from running state
      return { stage: "processing", label: "Processing 3D scene", progress: 50 };
  }

  if (jobStatus === "completed") {
    return { stage: "completed", label: "3D Scene Ready", progress: 100 };
  }

  return { stage: "unknown", label: "Processing", progress: 25 };
}
