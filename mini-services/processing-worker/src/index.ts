// ============================================
// Processing Worker — Main Entry Point
// ============================================
// Polls Supabase for queued processing_jobs,
// runs them through the pipeline, and updates
// the database with results.
//
// Architecture:
//   Poll Loop -> Claim Job -> Run Pipeline -> Update DB
//
// The pipeline stages perform real data-driven
// processing and can be extended with full
// ML pipelines (COLMAP, 3DGS) when GPU is available.
// ============================================

import {
  getNextQueuedJob,
  claimJob,
  completeJob,
  failJob,
  getSceneById,
  completeScene,
  completeSession,
  setPropertyReady,
  updateSceneStatus,
  getSessionMedia,
} from "./db";
import {
  uploadToStorage,
  generateThumbnail,
  initializeStorage,
} from "./storage";
import { runImageValidation } from "./pipeline/sfm";
import { runSfMReconstruction } from "./pipeline/splat";
import { runSplatGeneration } from "./pipeline/optimizer";
import { runSceneOptimization } from "./pipeline/packager";
import type { PipelineContext, PipelineStageResult } from "./pipeline/stages";
import { PIPELINE_STAGES } from "./pipeline/stages";

const POLL_INTERVAL_MS = 5000; // 5 seconds
const MAX_CONCURRENT_JOBS = 1; // MVP: one at a time

let isProcessing = false;
let currentJob: { id: string; sceneId: string } | null = null;

function structuredLog(jobId: string, level: string, message: string, data?: Record<string, unknown>) {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    jobId,
    message,
    ...(data && { ...data }),
  };
  console.log(JSON.stringify(entry));
}

function getStageTimeout(stageName: string): number {
  const stageMeta = PIPELINE_STAGES.find((s) => s.name === stageName);
  return stageMeta?.timeoutMs ?? 60_000;
}

async function runStageWithTimeout(
  stageName: string,
  fn: (ctx: PipelineContext) => Promise<PipelineStageResult>,
  ctx: PipelineContext
): Promise<PipelineStageResult> {
  const timeoutMs = getStageTimeout(stageName);

  return Promise.race([
    fn(ctx),
    new Promise<PipelineStageResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            status: "failed",
            durationMs: timeoutMs,
            artifacts: {},
            error: `Stage "${stageName}" timed out after ${timeoutMs}ms`,
          }),
        timeoutMs
      )
    ),
  ]);
}

async function main() {
  structuredLog("system", "info", "Processing Worker started");
  structuredLog("system", "info", `Polling every ${POLL_INTERVAL_MS / 1000}s`);
  structuredLog("system", "info", `Max concurrent jobs: ${MAX_CONCURRENT_JOBS}`);

  // Check Supabase configuration
  if (!process.env.SUPABASE_URL) {
    structuredLog("system", "error", "SUPABASE_URL not set. Worker cannot start.");
    structuredLog("system", "error", "Required: SUPABASE_URL, SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY");
    process.exit(1);
  }

  // Initialize storage bucket once at startup
  try {
    await initializeStorage();
    structuredLog("system", "info", "Storage initialized successfully");
  } catch (err) {
    structuredLog("system", "error", `Storage initialization failed: ${err}`);
    process.exit(1);
  }

  // Register signal handlers for graceful shutdown
  const shutdownHandler = async () => {
    structuredLog("system", "info", "Shutdown signal received, cleaning up...");
    if (currentJob) {
      try {
        await failJob(currentJob.id, "Worker shutdown during processing");
        await updateSceneStatus(currentJob.sceneId, "failed");
        structuredLog(currentJob.id, "warn", "Re-queued/failed in-progress job due to shutdown");
      } catch (err) {
        structuredLog("system", "error", `Failed to clean up job on shutdown: ${err}`);
      }
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdownHandler);
  process.on("SIGTERM", shutdownHandler);

  // Main poll loop
  while (true) {
    try {
      if (!isProcessing) {
        await pollForJobs();
      }
    } catch (err) {
      structuredLog("system", "error", `Poll error: ${err}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function pollForJobs() {
  const job = await getNextQueuedJob();
  if (!job) return;

  structuredLog(job.id, "info", `Found queued job (type: ${job.job_type})`);

  // Try to claim the job (atomic: only one worker claims it)
  const claimed = await claimJob(job.id);
  if (!claimed) {
    structuredLog(job.id, "info", "Job already claimed by another worker");
    return;
  }

  structuredLog(job.id, "info", "Claimed job");
  isProcessing = true;
  currentJob = { id: job.id, sceneId: job.scene_id };

  try {
    await processJob(job);
  } catch (err) {
    structuredLog(job.id, "error", `Job failed with unhandled error`, {
      error: String(err),
    });
    try {
      await failJob(job.id, `Unhandled error: ${err}`);
    } catch (failErr) {
      structuredLog(job.id, "error", `Failed to record job failure: ${failErr}`);
    }
  } finally {
    isProcessing = false;
    currentJob = null;
  }
}

async function processJob(job: { id: string; scene_id: string }) {
  const startTime = Date.now();
  const allLogs: string[] = [];

  // Fetch scene + session context
  const scene = await getSceneById(job.scene_id);
  if (!scene) {
    await failJob(job.id, `Scene ${job.scene_id} not found`);
    return;
  }

  // Update scene status
  await updateSceneStatus(scene.id, "processing");

  // Fetch media URLs for this session
  const media = scene.session_id
    ? await getSessionMedia(scene.session_id)
    : [];
  const imageUrls = media.map((m) => m.url);

  if (imageUrls.length === 0) {
    await failJob(job.id, "No images found for this session");
    await updateSceneStatus(scene.id, "failed");
    return;
  }

  // Build pipeline context
  const ctx: PipelineContext = {
    jobId: job.id,
    sceneId: scene.id,
    sessionId: scene.session_id || "",
    propertyId: scene.property_id,
    imageUrls,
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseKey:
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "",
    artifacts: {},
  };

  structuredLog(job.id, "info", `Processing ${imageUrls.length} images for scene ${scene.id}`);

  // Run pipeline stages sequentially with timeouts
  const stages = [
    { name: "Image Validation", fn: runImageValidation },
    { name: "SfM Reconstruction", fn: runSfMReconstruction },
    { name: "Gaussian Splat Generation", fn: runSplatGeneration },
    { name: "Scene Optimization", fn: runSceneOptimization },
  ];

  for (const stage of stages) {
    structuredLog(job.id, "info", `Running stage: ${stage.name}`);

    let result: PipelineStageResult;
    try {
      result = await runStageWithTimeout(stage.name, stage.fn, ctx);
    } catch (err) {
      structuredLog(job.id, "error", `Stage "${stage.name}" threw unexpected error`, {
        error: String(err),
      });
      result = {
        status: "failed",
        durationMs: 0,
        artifacts: {},
        error: String(err),
      };
    }

    if (result.logs) {
      allLogs.push(result.logs);
    }

    if (result.status === "failed") {
      structuredLog(job.id, "error", `Stage "${stage.name}" failed`, {
        stageError: result.error,
      });
      const failureMessage = result.error
        ? `[${stage.name}] ${result.error}\n${allLogs.join("\n\n")}`
        : allLogs.join("\n\n");
      await failJob(job.id, failureMessage);
      await updateSceneStatus(scene.id, "failed");
      return;
    }

    // Merge artifacts into context for next stage
    ctx.artifacts = { ...ctx.artifacts, ...result.artifacts };
    structuredLog(job.id, "info", `${stage.name} complete (${result.durationMs}ms)`);
  }

  // Stage 5: Package and upload scene
  structuredLog(job.id, "info", "Packaging scene...");

  let bounds: { min: number[]; max: number[] };
  let cameraPoses: unknown[];
  try {
    const gaussianSplat = JSON.parse(ctx.artifacts.gaussian_splat || "{}");
    bounds = gaussianSplat.bounds || {
      min: [-5, -0.5, -5],
      max: [5, 3, 5],
    };
  } catch {
    bounds = { min: [-5, -0.5, -5], max: [5, 3, 5] };
  }

  try {
    cameraPoses = JSON.parse(ctx.artifacts.camera_poses || "[]");
  } catch {
    cameraPoses = [];
  }

  const modelData = {
    version: "1.0",
    sceneId: scene.id,
    propertyId: scene.property_id,
    splatCount: Number(ctx.artifacts.splat_count || 0),
    shDegree: Number(ctx.artifacts.sh_degree || 2),
    sizeMB: Number(ctx.artifacts.scene_size_mb || 0),
    compressionRatio: Number(ctx.artifacts.compression_ratio || 1),
    lodLevels: Number(ctx.artifacts.lod_levels || 1),
    bounds,
    cameraPoses,
    generatedAt: new Date().toISOString(),
    pipelineVersion: "mvp-v1",
  };

  // Upload model.json
  const modelPath = `scenes/${scene.id}/model.json`;
  const modelUrl = await uploadToStorage(
    modelPath,
    JSON.stringify(modelData, null, 2),
    "application/json"
  );
  structuredLog(job.id, "info", `Uploaded model: ${modelUrl}`);

  // Upload thumbnail (SVG content, use .svg extension)
  const thumbnailBuffer = generateThumbnail();
  const thumbnailPath = `scenes/${scene.id}/thumbnail.svg`;
  const thumbnailUrl = await uploadToStorage(
    thumbnailPath,
    thumbnailBuffer,
    "image/svg+xml"
  );
  structuredLog(job.id, "info", `Uploaded thumbnail: ${thumbnailUrl}`);

  const totalTimeSec = Math.round((Date.now() - startTime) / 1000);
  const qualityScore = Number(ctx.artifacts.sfm_quality_score || 0.85);

  // Update scene -> ready
  await completeScene(
    scene.id,
    modelUrl,
    thumbnailUrl,
    qualityScore,
    totalTimeSec
  );
  structuredLog(job.id, "info", `Scene ${scene.id} marked as ready`);

  // Update session -> completed (verify all scenes are done — handled inside completeSession)
  if (scene.session_id) {
    try {
      await completeSession(scene.session_id);
      structuredLog(job.id, "info", `Session ${scene.session_id} marked as completed`);
    } catch (err) {
      structuredLog(job.id, "warn", `Could not complete session: ${err}`);
    }
  }

  // Update property -> ready (verify all scenes are ready — handled inside setPropertyReady)
  try {
    await setPropertyReady(scene.property_id);
    structuredLog(job.id, "info", `Property ${scene.property_id} marked as ready`);
  } catch (err) {
    structuredLog(job.id, "warn", `Could not set property ready: ${err}`);
  }

  // Update job -> completed
  await completeJob(job.id, allLogs.join("\n\n"));
  structuredLog(job.id, "info", `Job completed in ${totalTimeSec}s`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Start the worker
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
