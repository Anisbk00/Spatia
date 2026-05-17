import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const session_id = searchParams.get("session_id");

  if (!session_id) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  // Use admin client for data operations (bypasses RLS)
  const adminClient = createAdminClient();
  const dataClient = adminClient || supabase;

  // Get capture session
  const { data: session, error: sessionError } = await dataClient
    .from("capture_sessions")
    .select("id, property_id, status, capture_type")
    .eq("id", session_id)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Get video capture info
  const { data: videoCaptures } = await dataClient
    .from("video_captures")
    .select("id, status, duration_seconds, extracted_frame_count, metadata")
    .eq("session_id", session_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const videoCapture = videoCaptures?.[0];

  // Get scene
  const { data: scenes } = await dataClient
    .from("scenes")
    .select("id, status, quality_score, model_url, thumbnail_url")
    .eq("session_id", session_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const scene = scenes?.[0];

  // Get processing jobs
  let jobs: Array<{ id: string; job_type: string; status: string; logs: string | null }> = [];
  if (scene) {
    const { data: jobData } = await dataClient
      .from("processing_jobs")
      .select("id, job_type, status, logs")
      .eq("scene_id", scene.id)
      .order("created_at", { ascending: true });
    jobs = jobData ?? [];
  }

  // Compute pipeline stage and progress
  const stage = computePipelineStage(session.status, videoCapture?.status, scene?.status, jobs);
  const progress = computeProgress(stage, jobs);
  const estimatedTimeRemaining = estimateTimeRemaining(stage, videoCapture?.duration_seconds);

  // Find error if any
  const failedJob = jobs.find(j => j.status === "failed");
  const errorMessage = failedJob?.logs ?? null;

  return NextResponse.json({
    session_id,
    property_id: session.property_id,
    scene_id: scene?.id ?? null,
    stage,
    progress,
    estimated_time_remaining: estimatedTimeRemaining,
    capture_type: session.capture_type ?? "video",
    video_status: videoCapture?.status ?? null,
    scene_status: scene?.status ?? null,
    jobs: jobs.map(j => ({ type: j.job_type, status: j.status })),
    error: errorMessage,
  });
}

type PipelineStage = "uploaded" | "extracting" | "reconstructing" | "generating" | "optimizing" | "completed" | "failed";

function computePipelineStage(
  sessionStatus: string,
  videoCaptureStatus?: string,
  sceneStatus?: string,
  jobs?: Array<{ job_type: string; status: string }>,
): PipelineStage {
  // Check for failure
  const hasFailed = jobs?.some(j => j.status === "failed");
  if (hasFailed || sessionStatus === "failed" || sceneStatus === "failed") {
    return "failed";
  }

  // Scene is ready
  if (sceneStatus === "ready") {
    return "completed";
  }

  // Video just uploaded
  if (!videoCaptureStatus || videoCaptureStatus === "uploaded") {
    return "uploaded";
  }

  // Frame extraction phase
  if (videoCaptureStatus === "extracting") {
    return "extracting";
  }

  // Check job progression
  const jobTypes = jobs?.map(j => j.job_type) ?? [];
  const runningJob = jobs?.find(j => j.status === "running");

  if (videoCaptureStatus === "extracted" || jobTypes.includes("frame_extraction")) {
    const frameExtraction = jobs?.find(j => j.job_type === "frame_extraction");
    if (frameExtraction?.status === "running" || frameExtraction?.status === "queued") {
      return "extracting";
    }
  }

  if (runningJob?.job_type === "video_reconstruction" || jobTypes.includes("video_reconstruction")) {
    const recon = jobs?.find(j => j.job_type === "video_reconstruction");
    if (recon?.status === "running" || recon?.status === "queued") {
      return "reconstructing";
    }
  }

  if (runningJob?.job_type === "splat_generation" || jobTypes.includes("splat_generation")) {
    const splat = jobs?.find(j => j.job_type === "splat_generation");
    if (splat?.status === "running" || splat?.status === "queued") {
      return "generating";
    }
  }

  if (runningJob?.job_type === "gaussian_splat_generation" || runningJob?.job_type === "optimization") {
    return "optimizing";
  }

  // Default: reconstructing (LingBot-Map is the main processing step)
  if (videoCaptureStatus === "processing" || sceneStatus === "processing") {
    return "reconstructing";
  }

  if (sceneStatus === "queued") {
    return "extracting";
  }

  return "uploaded";
}

function computeProgress(stage: PipelineStage, jobs: Array<{ job_type: string; status: string }>): number {
  const stageProgress: Record<PipelineStage, number> = {
    uploaded: 5,
    extracting: 20,
    reconstructing: 55,
    generating: 80,
    optimizing: 95,
    completed: 100,
    failed: 0,
  };

  let base = stageProgress[stage] ?? 0;

  // Add granularity within the reconstruction stage
  if (stage === "reconstructing" && jobs.length > 0) {
    const completed = jobs.filter(j => j.status === "completed").length;
    const total = jobs.length;
    const withinStage = total > 0 ? (completed / total) * 35 : 0;
    base = 20 + withinStage;
  }

  return Math.min(Math.round(base), 100);
}

function estimateTimeRemaining(stage: PipelineStage, durationSeconds?: number): number {
  const videoDuration = durationSeconds ?? 120; // default 2 minutes
  const stageTimeWeights: Record<PipelineStage, number> = {
    uploaded: 0,
    extracting: 15,      // ~15 seconds for frame extraction
    reconstructing: videoDuration * 2, // ~2x video duration for LingBot-Map
    generating: 30,      // ~30 seconds for splat generation
    optimizing: 20,      // ~20 seconds for optimization
    completed: 0,
    failed: 0,
  };

  return Math.round(stageTimeWeights[stage] ?? 0);
}
