// ============================================
// Enhanced GPU Worker — Main Entry Point
// ============================================
// Distributed processing worker that:
//   - Registers with the workers table on startup
//   - Sends periodic heartbeats
//   - Polls for queued jobs (priority-aware)
//   - Supports concurrent job processing
//   - Runs full 9-stage pipeline with AI enhancement
//   - Records costs after each job
//   - Deregisters on shutdown
//   - Supports batch processing
//
// Architecture:
//   Startup -> Register -> Heartbeat Loop
//   Poll Loop -> Claim Job -> Run Pipeline -> Record Cost -> Update DB
//   Shutdown -> Deregister
// ============================================

import {
  registerWorker,
  sendHeartbeat,
  updateWorkerStatus,
  incrementJobCount,
  decrementJobCount,
  recordJobCompletion,
  recordJobFailure,
  getNextQueuedJob,
  claimJob,
  completeJob,
  failJob,
  getSceneById,
  updateSceneStatus,
  completeScene,
  completeSession,
  setPropertyReady,
  getPropertyOrgId,
  getSessionMedia,
  recordCost,
  createEnhancementJob,
  completeEnhancement,
} from "./db";
import { uploadToStorage, generateThumbnail } from "./storage";
import { runImageValidation } from "./pipeline/sfm";
import { runSfMReconstruction } from "./pipeline/splat";
import { runSplatGeneration } from "./pipeline/optimizer";
import { runSceneOptimization } from "./pipeline/packager";
import { runAISceneCleanup } from "./pipeline/ai-cleanup";
import { runRoomDetection } from "./pipeline/room-detection";
import { runLightingEnhancement } from "./pipeline/lighting";
import { runAutoThumbnail } from "./pipeline/auto-thumbnail";
import type { PipelineContext, PipelineStageResult } from "./pipeline/stages";
import type { Worker, ProcessingJob } from "./types";

// ---- Configuration ----

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || "1", 10);
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || "30000", 10);
const WORKER_REGION = process.env.WORKER_REGION || "us-east";
const WORKER_GPU_TYPE = process.env.WORKER_GPU_TYPE || "cpu-only";
const WORKER_GPU_MEMORY_GB = parseFloat(process.env.WORKER_GPU_MEMORY_GB || "0");
const WORKER_NAME = process.env.WORKER_NAME || undefined;

// ---- State ----

let workerDbId: string | null = null;
let workerRecord: Worker | null = null;
let activeJobs = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let isShuttingDown = false;

// ---- Main ----

async function main() {
  console.log("Enhanced GPU Worker v2.0.0 started");
  console.log(`   Region: ${WORKER_REGION}`);
  console.log(`   GPU: ${WORKER_GPU_TYPE} (${WORKER_GPU_MEMORY_GB}GB)`);
  console.log(`   Max concurrent jobs: ${MAX_CONCURRENT_JOBS}`);
  console.log(`   Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`   Heartbeat interval: ${HEARTBEAT_INTERVAL_MS}ms`);

  // Check Supabase configuration
  const supabaseConfigured = !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY));
  if (!supabaseConfigured) {
    console.log("");
    console.warn(
      "Supabase is not configured (SUPABASE_URL and SUPABASE_SERVICE_KEY/ANON_KEY required). " +
      "Worker will operate with reduced capability — job dispatch, cost tracking, and worker registration will be unavailable."
    );
    console.log("");
    console.log("Running in standalone mode — polling for jobs every 5s...");
  }

  // Register worker
  try {
    workerRecord = await registerWorker({
      worker_id: generateWorkerId(),
      name: WORKER_NAME,
      region: WORKER_REGION,
      gpu_type: WORKER_GPU_TYPE,
      gpu_memory_gb: WORKER_GPU_MEMORY_GB || undefined,
      max_concurrent_jobs: MAX_CONCURRENT_JOBS,
      capabilities: {
        pipeline_version: "2.0.0",
        ai_enhancement: true,
        room_detection: true,
        lighting_enhancement: true,
        auto_thumbnail: true,
      },
    });

    if (workerRecord) {
      workerDbId = workerRecord.id;
      console.log(`[REGISTER] Registered worker: ${workerRecord.worker_id} (DB ID: ${workerDbId})`);
    }
  } catch (err) {
    console.error("[REGISTER] Failed to register worker:", err);
    console.error("   Continuing in standalone mode (no registration)");
  }

  // Start heartbeat
  startHeartbeat();

  // Handle shutdown signals
  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

  // Main poll loop
  while (!isShuttingDown) {
    try {
      if (activeJobs < MAX_CONCURRENT_JOBS) {
        await pollForJobs();
      }
    } catch (err) {
      console.error("[POLL] Poll error:", err);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// ---- Heartbeat ----

function startHeartbeat() {
  if (!workerDbId) return;

  heartbeatTimer = setInterval(async () => {
    try {
      await sendHeartbeat(workerDbId!);
    } catch (err) {
      console.error("[HEARTBEAT] Heartbeat failed:", err);
    }
  }, HEARTBEAT_INTERVAL_MS);

  console.log(`[HEARTBEAT] Heartbeat started (every ${HEARTBEAT_INTERVAL_MS / 1000}s)`);
}

// ---- Job Polling ----

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

  // Update worker state
  activeJobs++;
  if (workerDbId) {
    await incrementJobCount(workerDbId);
  }

  // Process job (with concurrency support)
  processJob(job).catch(async (err) => {
    console.error(`[ERROR] Job ${job.id} unhandled error:`, err);
  });
}

// ---- Job Processing ----

async function processJob(job: ProcessingJob) {
  const startTime = Date.now();
  const allLogs: string[] = [];

  try {
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

    // Get org ID for cost tracking
    const orgId = await getPropertyOrgId(scene.property_id);

    // Build pipeline context
    const ctx: PipelineContext = {
      jobId: job.id,
      sceneId: scene.id,
      sessionId: scene.session_id || "",
      propertyId: scene.property_id,
      orgId,
      workerId: workerDbId,
      imageUrls,
      supabaseUrl: process.env.SUPABASE_URL!,
      supabaseKey: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "",
      artifacts: {},
    };

    console.log(`[PROCESS] Processing ${imageUrls.length} images for scene ${scene.id}`);

    // ---- Run full 9-stage pipeline ----

    const stages = [
      { name: "Image Validation", fn: runImageValidation },
      { name: "SfM Reconstruction", fn: runSfMReconstruction },
      { name: "Gaussian Splat Generation", fn: runSplatGeneration },
      { name: "Scene Optimization", fn: runSceneOptimization },
      { name: "AI Scene Cleanup", fn: runAISceneCleanup },
      { name: "Room Detection", fn: runRoomDetection },
      { name: "Lighting Enhancement", fn: runLightingEnhancement },
      { name: "Auto Thumbnail Generation", fn: runAutoThumbnail },
    ];

    for (const stage of stages) {
      if (isShuttingDown) {
        console.log(`[SHUTDOWN] Shutdown requested, aborting pipeline at "${stage.name}"`);
        break;
      }

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
        if (workerDbId) await recordJobFailure(workerDbId);
        return;
      }

      // Merge artifacts into context for next stage
      ctx.artifacts = { ...ctx.artifacts, ...result.artifacts };
      console.log(`[DONE] ${stage.name} complete (${result.durationMs}ms)`);
    }

    // ---- Scene Packaging (Stage 5) ----

    console.log("[PACK] Packaging scene...");

    const modelData = {
      version: "2.0",
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
      // AI enhancement metadata
      noiseReductionPercent: Number(ctx.artifacts.noise_reduction_percent || 0),
      geometryStabilityScore: Number(ctx.artifacts.geometry_stability_score || 0),
      detectedRooms: JSON.parse(ctx.artifacts.detected_rooms || "[]"),
      roomCount: Number(ctx.artifacts.room_count || 0),
      lightingImprovementPercent: Number(ctx.artifacts.improvement_percent || 0),
      toneMapping: ctx.artifacts.tone_mapping || "none",
      colorConsistencyScore: Number(ctx.artifacts.color_consistency_score || 0),
      generatedAt: new Date().toISOString(),
      pipelineVersion: "v2.0-enhanced",
    };

    // Upload model.json
    const modelPath = `scenes/${scene.id}/model.json`;
    const modelUrl = await uploadToStorage(
      modelPath,
      JSON.stringify(modelData, null, 2),
      "application/json"
    );
    console.log(`[UPLOAD] Uploaded model: ${modelUrl}`);

    // Upload thumbnail — prefer auto-thumbnail if available, else standard
    let thumbnailUrl: string;
    if (ctx.artifacts.auto_thumbnail_url) {
      thumbnailUrl = ctx.artifacts.auto_thumbnail_url;
      console.log(`[THUMB] Using auto-generated thumbnail: ${thumbnailUrl}`);
    } else {
      const thumbnailBuffer = generateThumbnail();
      const thumbnailPath = `scenes/${scene.id}/thumbnail.jpg`;
      thumbnailUrl = await uploadToStorage(
        thumbnailPath,
        thumbnailBuffer,
        "image/svg+xml"
      );
      console.log(`[UPLOAD] Uploaded thumbnail: ${thumbnailUrl}`);
    }

    const totalTimeSec = Math.round((Date.now() - startTime) / 1000);
    const qualityScore = Number(ctx.artifacts.quality_after || ctx.artifacts.sfm_quality_score || 0.85);

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

    // ---- Record AI Enhancement results ----

    if (orgId && workerDbId) {
      try {
        // Create enhancement records for the AI stages
        const enhancementId = await createEnhancementJob({
          scene_id: scene.id,
          org_id: orgId,
          enhancement_type: "full_enhancement",
          input_artifacts: { quality_before: ctx.artifacts.quality_before || ctx.artifacts.sfm_quality_score },
        });

        if (enhancementId) {
          // Mark it as processing then completed
          const { updateEnhancementStatus } = await import("./db");
          await updateEnhancementStatus(enhancementId, "processing");

          await completeEnhancement(enhancementId, {
            output_artifacts: {
              noise_reduction: ctx.artifacts.noise_reduction_percent,
              geometry_stability: ctx.artifacts.geometry_stability_score,
              room_count: ctx.artifacts.room_count,
              room_types: ctx.artifacts.room_types,
              lighting_improvement: ctx.artifacts.improvement_percent,
              tone_mapping: ctx.artifacts.tone_mapping,
              color_consistency: ctx.artifacts.color_consistency_score,
              auto_thumbnail_angle: ctx.artifacts.auto_thumbnail_angle,
            },
            detected_rooms: JSON.parse(ctx.artifacts.detected_rooms || "[]"),
            quality_before: Number(ctx.artifacts.quality_before || ctx.artifacts.sfm_quality_score || 0.85),
            quality_after: qualityScore,
            improvement_percent: Number(ctx.artifacts.improvement_percent || 0),
            processing_time_seconds: totalTimeSec,
            worker_id: workerDbId,
          });
          console.log(`[ENHANCE] Enhancement record created: ${enhancementId}`);
        }
      } catch (err) {
        console.error("[ENHANCE] Failed to create enhancement record:", err);
      }
    }

    // ---- Record costs ----

    if (orgId) {
      try {
        // GPU compute cost
        await recordCost({
          org_id: orgId,
          scene_id: scene.id,
          job_id: job.id,
          worker_id: workerDbId ?? undefined,
          cost_type: "gpu_compute",
          amount_usd: calculateGPUComputeCost(totalTimeSec),
          quantity: totalTimeSec / 3600,
          unit: "hour",
          unit_cost_usd: 0.50,
          metadata: {
            gpu_type: WORKER_GPU_TYPE,
            processing_time_seconds: totalTimeSec,
            pipeline_version: "2.0",
          },
        });

        // Storage cost
        const storageMB = Number(ctx.artifacts.scene_size_mb || 0);
        if (storageMB > 0) {
          await recordCost({
            org_id: orgId,
            scene_id: scene.id,
            job_id: job.id,
            worker_id: workerDbId ?? undefined,
            cost_type: "storage",
            amount_usd: calculateStorageCost(storageMB),
            quantity: storageMB / 1024,
            unit: "gb",
            unit_cost_usd: 0.023,
            metadata: { storage_mb: storageMB },
          });
        }

        // AI enhancement cost
        await recordCost({
          org_id: orgId,
          scene_id: scene.id,
          job_id: job.id,
          worker_id: workerDbId ?? undefined,
          cost_type: "ai_enhancement",
          amount_usd: 0.10,
          quantity: 1,
          unit: "scene",
          unit_cost_usd: 0.10,
          metadata: {
            stages: ["ai_cleanup", "room_detection", "lighting_enhancement", "auto_thumbnail"],
          },
        });

        // Thumbnail generation cost
        await recordCost({
          org_id: orgId,
          scene_id: scene.id,
          job_id: job.id,
          worker_id: workerDbId ?? undefined,
          cost_type: "thumbnail_generation",
          amount_usd: 0.02,
          quantity: 1,
          unit: "thumbnail",
          unit_cost_usd: 0.02,
          metadata: { auto_thumbnail: true },
        });

        console.log(`[COST] Cost records created for org ${orgId}`);
      } catch (err) {
        console.error("[COST] Failed to record costs:", err);
      }
    }

    // Update worker stats
    if (workerDbId) {
      await recordJobCompletion(workerDbId, totalTimeSec);
    }
  } catch (err) {
    console.error(`[ERROR] Job ${job.id} failed with error:`, err);
    await failJob(job.id, `Unhandled error: ${err}`);
    if (workerDbId) await recordJobFailure(workerDbId);
  } finally {
    activeJobs--;
    if (workerDbId) {
      await decrementJobCount(workerDbId);
    }
  }
}

// ---- Cost calculation helpers ----

function calculateGPUComputeCost(totalTimeSec: number): number {
  // $0.50/hour for CPU-only, $2.00/hour for GPU
  const hourlyRate = WORKER_GPU_TYPE === "cpu-only" ? 0.50 : 2.00;
  return Math.round((hourlyRate * (totalTimeSec / 3600)) * 100) / 100;
}

function calculateStorageCost(storageMB: number): number {
  // $0.023/GB/month (S3 pricing)
  return Math.round((0.023 * (storageMB / 1024)) * 10000) / 10000;
}

// ---- Worker ID generation ----

function generateWorkerId(): string {
  const hostname = process.env.HOSTNAME || "local";
  const random = Math.random().toString(36).substring(2, 8);
  return `${hostname}-${random}`;
}

// ---- Shutdown handling ----

async function handleShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("\n[SHUTDOWN] Shutdown signal received...");

  // Stop heartbeat
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  // Wait for active jobs to finish (with timeout)
  const shutdownTimeout = 30000; // 30 seconds
  const shutdownStart = Date.now();
  while (activeJobs > 0 && Date.now() - shutdownStart < shutdownTimeout) {
    console.log(`[SHUTDOWN] Waiting for ${activeJobs} active jobs to complete...`);
    await sleep(2000);
  }

  if (activeJobs > 0) {
    console.log(`[SHUTDOWN] ${activeJobs} jobs still running after timeout, forcing shutdown`);
  }

  // Deregister worker
  if (workerDbId) {
    try {
      await updateWorkerStatus(workerDbId, "offline");
      console.log("[SHUTDOWN] Worker deregistered");
    } catch (err) {
      console.error("[SHUTDOWN] Failed to deregister worker:", err);
    }
  }

  console.log("[SHUTDOWN] GPU Worker shut down");
  process.exit(0);
}

// ---- Utilities ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Start ----

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
