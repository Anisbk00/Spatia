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
  getSessionMedia,
} from "./db";
import { uploadToStorage, generateThumbnail } from "./storage";
import { runImageValidation } from "./pipeline/sfm";
import { runSfMReconstruction } from "./pipeline/splat";
import { runSplatGeneration } from "./pipeline/optimizer";
import { runSceneOptimization } from "./pipeline/packager";
import type { PipelineContext, PipelineStageResult } from "./pipeline/stages";

const POLL_INTERVAL_MS = 5000; // 5 seconds
const MAX_CONCURRENT_JOBS = 1; // MVP: one at a time

let isProcessing = false;

async function main() {
  console.log("Processing Worker started");
  console.log(`   Polling every ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`   Max concurrent jobs: ${MAX_CONCURRENT_JOBS}`);

  // Check Supabase configuration
  if (!process.env.SUPABASE_URL) {
    console.error("SUPABASE_URL not set. Worker cannot start.");
    console.error("   Set these environment variables:");
    console.error("   - SUPABASE_URL");
    console.error("   - SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY");
    process.exit(1);
  }

  // Main poll loop
  while (true) {
    try {
      if (!isProcessing) {
        await pollForJobs();
      }
    } catch (err) {
      console.error("Poll error:", err);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function pollForJobs() {
  const job = await getNextQueuedJob();
  if (!job) return;

  console.log(`\n[QUEUE] Found queued job: ${job.id} (type: ${job.job_type})`);

  // Try to claim the job (atomic: only one worker claims it)
  const claimed = await claimJob(job.id);
  if (!claimed) {
    console.log(`[SKIP] Job ${job.id} already claimed by another worker`);
    return;
  }

  console.log(`[CLAIM] Claimed job ${job.id}`);
  isProcessing = true;

  try {
    await processJob(job);
  } catch (err) {
    console.error(`[ERROR] Job ${job.id} failed with error:`, err);
    await failJob(job.id, `Unhandled error: ${err}`);
  } finally {
    isProcessing = false;
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
  const { updateSceneStatus } = await import("./db");
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
    supabaseKey: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "",
    artifacts: {},
  };

  console.log(`[PROCESS] Processing ${imageUrls.length} images for scene ${scene.id}`);

  // Run pipeline stages sequentially
  const stages = [
    { name: "Image Validation", fn: runImageValidation },
    { name: "SfM Reconstruction", fn: runSfMReconstruction },
    { name: "Gaussian Splat Generation", fn: runSplatGeneration },
    { name: "Scene Optimization", fn: runSceneOptimization },
  ];

  for (const stage of stages) {
    console.log(`[STAGE] Running: ${stage.name}...`);

    let result: PipelineStageResult;
    try {
      result = await stage.fn(ctx);
    } catch (err) {
      console.error(`[ERROR] Stage "${stage.name}" threw error:`, err);
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
      console.error(`[FAIL] Stage "${stage.name}" failed: ${result.error}`);
      await failJob(job.id, allLogs.join("\n\n"));
      await updateSceneStatus(scene.id, "failed");
      return;
    }

    // Merge artifacts into context for next stage
    ctx.artifacts = { ...ctx.artifacts, ...result.artifacts };
    console.log(`[DONE] ${stage.name} complete (${result.durationMs}ms)`);
  }

  // Stage 5: Package and upload scene
  console.log("[PACK] Packaging scene...");

  const modelData = {
    version: "1.0",
    sceneId: scene.id,
    propertyId: scene.property_id,
    splatCount: Number(ctx.artifacts.splat_count || 0),
    shDegree: Number(ctx.artifacts.sh_degree || 2),
    sizeMB: Number(ctx.artifacts.scene_size_mb || 0),
    compressionRatio: Number(ctx.artifacts.compression_ratio || 1),
    lodLevels: Number(ctx.artifacts.lod_levels || 1),
    bounds: JSON.parse(ctx.artifacts.gaussian_splat || "{}").bounds || {
      min: [-5, -0.5, -5],
      max: [5, 3, 5],
    },
    cameraPoses: JSON.parse(ctx.artifacts.camera_poses || "[]"),
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
  console.log(`[UPLOAD] Uploaded model: ${modelUrl}`);

  // Upload thumbnail
  const thumbnailBuffer = generateThumbnail();
  const thumbnailPath = `scenes/${scene.id}/thumbnail.jpg`;
  const thumbnailUrl = await uploadToStorage(
    thumbnailPath,
    thumbnailBuffer,
    "image/svg+xml"
  );
  console.log(`[UPLOAD] Uploaded thumbnail: ${thumbnailUrl}`);

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
  console.log(`[SCENE] Scene ${scene.id} marked as ready`);

  // Update session -> completed
  if (scene.session_id) {
    await completeSession(scene.session_id);
    console.log(`[SESSION] Session ${scene.session_id} marked as completed`);
  }

  // Update property -> ready
  await setPropertyReady(scene.property_id);
  console.log(`[PROPERTY] Property ${scene.property_id} marked as ready`);

  // Update job -> completed
  await completeJob(job.id, allLogs.join("\n\n"));
  console.log(`[COMPLETE] Job ${job.id} completed in ${totalTimeSec}s\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Start the worker
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
