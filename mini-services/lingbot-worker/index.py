"""
LingBot-Map Worker — Main Entry Point
=======================================
Polls Supabase for queued jobs, claims them atomically, processes through
the LingBot-Map pipeline, and updates status.

Worker Flow:
  1. Poll processing_jobs every POLL_INTERVAL_MS for queued jobs
  2. Atomically claim job: UPDATE status='running' WHERE id=? AND status='queued'
  3. Based on job_type, run the appropriate pipeline stage:
     - frame_extraction: Download video → Extract frames → Upload → Create video_reconstruction job
     - video_reconstruction: Download frames → Run LingBot-Map → Upload raw outputs → Create splat_generation job
     - splat_generation: Download outputs → Convert to .splat → Upload → Update scene status
  4. On success: UPDATE status='completed', finished_at=now()
  5. On failure: UPDATE status='failed', increment retry_count, logs=error

HTTP Endpoints:
  GET /health — Health check with worker status
  GET /status — Detailed worker status
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import shutil
import signal
import sys
import tempfile
import threading
import time
import traceback
import uuid
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread
from typing import Optional

from config import config
from schemas import (
    HealthStatus,
    JobType,
    PipelineContext,
    SceneStatus,
    VideoCaptureStatus,
)
from db_client import (
    append_job_log,
    claim_job,
    complete_job,
    complete_scene,
    create_job,
    fail_job,
    fail_scene,
    get_next_queued_job,
    get_property_org_id,
    get_scene_by_id,
    get_video_capture,
    is_connected as db_is_connected,
    update_scene_status,
    update_video_capture_status,
)
from storage_client import (
    download_predictions,
    download_to_file,
    upload_frames,
    upload_predictions,
    upload_scene_metadata,
    upload_splat,
    upload_thumbnail,
    upload_trajectory,
)
from frame_extractor import extract_frames, get_video_metadata
from lingbot_adapter import (
    is_gpu_available,
    is_lingbot_available,
    run_inference,
    unload_model,
)
from scene_converter import (
    convert_to_splat,
    generate_scene_metadata,
    generate_thumbnail,
    generate_trajectory_json,
)

# ── Logging Setup ────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("lingbot-worker")

# ── Global State ─────────────────────────────────────────────────────────

_worker_id: str = f"{config.hostname}-{uuid.uuid4().hex[:8]}"
_start_time: float = time.time()
_active_jobs: int = 0
_total_completed: int = 0
_total_failed: int = 0
_is_shutting_down: bool = False
_current_job_id: Optional[str] = None

# Thread-safe lock for all counter mutations (health server reads from another thread)
_state_lock = threading.Lock()

# Minimum free disk space required to claim a job (5 GB)
MIN_FREE_DISK_BYTES = 5 * 1024 * 1024 * 1024


# ── Helper to safely update counters ────────────────────────────────────


def _increment_active() -> int:
    """Atomically increment active job count and return new value."""
    global _active_jobs
    with _state_lock:
        _active_jobs += 1
        return _active_jobs


def _decrement_active() -> int:
    """Atomically decrement active job count and return new value."""
    global _active_jobs
    with _state_lock:
        _active_jobs -= 1
        return _active_jobs


def _increment_completed() -> int:
    """Atomically increment completed counter and return new value."""
    global _total_completed
    with _state_lock:
        _total_completed += 1
        return _total_completed


def _increment_failed() -> int:
    """Atomically increment failed counter and return new value."""
    global _total_failed
    with _state_lock:
        _total_failed += 1
        return _total_failed


def _get_counters() -> tuple[int, int, int]:
    """Thread-safe snapshot of (active, completed, failed)."""
    with _state_lock:
        return _active_jobs, _total_completed, _total_failed


# ── Health Check HTTP Server ─────────────────────────────────────────────


class HealthCheckHandler(BaseHTTPRequestHandler):
    """HTTP handler for health check and status endpoints."""

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json(200, _get_health_status().to_dict() if hasattr(_get_health_status(), 'to_dict') else _build_health_dict())
        elif self.path == "/status":
            self._send_json(200, _build_status_dict())
        else:
            self._send_json(404, {"error": "Not found"})

    def _send_json(self, status_code: int, data: dict) -> None:
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode("utf-8"))

    def log_message(self, format: str, *args: object) -> None:
        # Suppress default HTTP logging
        pass


def _build_health_dict() -> dict:
    """Build health check response dictionary."""
    active, completed, failed = _get_counters()
    return {
        "status": "healthy" if not _is_shutting_down else "shutting_down",
        "version": "1.0.0",
        "worker_id": _worker_id,
        "gpu_type": config.gpu_type,
        "simulation_mode": config.simulation_mode or not is_lingbot_available(),
        "supabase_connected": db_is_connected(),
        "active_jobs": active,
        "total_jobs_completed": completed,
        "total_jobs_failed": failed,
        "uptime_seconds": round(time.time() - _start_time, 1),
    }


def _build_status_dict() -> dict:
    """Build detailed status response (internal paths redacted)."""
    health = _build_health_dict()
    health.update({
        "config": {
            "poll_interval_ms": config.poll_interval_ms,
            "max_concurrent_jobs": config.max_concurrent_jobs,
            "max_retry_count": config.max_retry_count,
            "confidence_threshold": config.confidence_threshold,
            "max_gaussians": config.max_gaussians,
            "lingbot_image_size": config.lingbot_image_size,
            # Redact internal model path for security
            "lingbot_model_path": "<configured>",
        },
        "capabilities": {
            "frame_extraction": True,
            "lingbot_inference": is_lingbot_available(),
            "splat_generation": True,
            "gpu_available": is_gpu_available(),
        },
        "started_at": datetime.fromtimestamp(_start_time, tz=timezone.utc).isoformat(),
    })
    return health


def _get_health_status():
    """Get HealthStatus object (for type compatibility)."""
    active, completed, failed = _get_counters()
    return HealthStatus(
        status="healthy" if not _is_shutting_down else "shutting_down",
        version="1.0.0",
        worker_id=_worker_id,
        gpu_type=config.gpu_type,
        simulation_mode=config.simulation_mode or not is_lingbot_available(),
        supabase_connected=db_is_connected(),
        active_jobs=active,
        total_jobs_completed=completed,
        total_jobs_failed=failed,
        uptime_seconds=round(time.time() - _start_time, 1),
    )


def start_health_server(port: int) -> HTTPServer:
    """Start the health check HTTP server in a background thread."""
    server = HTTPServer(("0.0.0.0", port), HealthCheckHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    logger.info(f"Health check server started on port {port}")
    return server


# ── Main Poll Loop ───────────────────────────────────────────────────────


async def main() -> None:
    """Main entry point — starts the worker poll loop."""
    global _is_shutting_down

    logger.info("=" * 60)
    logger.info("LingBot-Map Worker v1.0.0")
    logger.info("=" * 60)
    logger.info(f"  Worker ID:      {_worker_id}")
    logger.info(f"  Region:         {config.worker_region}")
    logger.info(f"  GPU:            {config.gpu_type}")
    logger.info(f"  LingBot-Map:    {'available' if is_lingbot_available() else 'NOT available (simulation mode)'}")
    logger.info(f"  GPU Available:  {is_gpu_available()}")
    logger.info(f"  Simulation:     {config.simulation_mode}")
    logger.info(f"  Supabase:       {'connected' if db_is_connected() else 'NOT configured'}")
    logger.info(f"  Max Concurrent: {config.max_concurrent_jobs}")
    logger.info(f"  Poll Interval:  {config.poll_interval_ms}ms")
    logger.info(f"  Service Port:   {config.service_port}")
    logger.info("=" * 60)

    # Validate configuration — raises RuntimeError if fundamentally misconfigured
    try:
        warnings = config.validate()
    except RuntimeError as e:
        logger.error(f"Configuration error: {e}")
        logger.error("Worker cannot start. Set SUPABASE_URL + SUPABASE_SERVICE_KEY, or enable SIMULATION_MODE=true")
        sys.exit(1)

    for w in warnings:
        logger.warning(f"  ⚠ {w}")

    # Ensure temp directories exist
    os.makedirs(config.temp_dir, exist_ok=True)
    os.makedirs(config.frames_dir, exist_ok=True)
    os.makedirs(config.output_dir, exist_ok=True)

    # Start health check server
    health_server = start_health_server(config.service_port)

    # Register shutdown signals
    signal.signal(signal.SIGINT, _handle_shutdown)
    signal.signal(signal.SIGTERM, _handle_shutdown)

    # Main poll loop
    logger.info("Starting poll loop...")

    while not _is_shutting_down:
        try:
            active, _, _ = _get_counters()
            if active < config.max_concurrent_jobs:
                await _poll_for_jobs()
        except Exception as e:
            logger.error(f"Poll loop error: {e}")
            logger.debug(traceback.format_exc())

        await asyncio.sleep(config.poll_interval_ms / 1000.0)

    # ── Shutdown: handle in-progress job ──
    if _current_job_id:
        logger.info(f"[SHUTDOWN] Re-queuing in-progress job: {_current_job_id}")
        try:
            fail_job(
                _current_job_id,
                "Worker shutdown — job will be retried automatically"
            )
        except Exception as e:
            logger.error(f"[SHUTDOWN] Failed to re-queue job {_current_job_id}: {e}")

    logger.info("Shutting down health server...")
    health_server.shutdown()

    # Unload model
    try:
        unload_model()
    except Exception:
        pass

    logger.info("LingBot-Map Worker shut down")


async def _poll_for_jobs() -> None:
    """Poll for the next queued job and process it."""
    # Check disk space before claiming
    try:
        free_space = shutil.disk_usage(config.temp_dir).free
        if free_space < MIN_FREE_DISK_BYTES:
            free_gb = free_space / (1024 ** 3)
            needed_gb = MIN_FREE_DISK_BYTES / (1024 ** 3)
            logger.warning(
                f"Low disk space: {free_gb:.1f} GB free "
                f"(need {needed_gb:.0f} GB minimum) — skipping poll"
            )
            return
    except OSError as e:
        logger.error(f"Failed to check disk space: {e}")
        return

    job = get_next_queued_job()
    if job is None:
        return

    logger.info(f"\n[QUEUE] Found queued job: {job.id} (type: {job.job_type.value})")

    # Try to claim the job atomically (with worker_id for tracking)
    claimed = claim_job(job.id, worker_id=_worker_id)
    if not claimed:
        logger.info(f"[SKIP] Job {job.id} already claimed by another worker")
        return

    logger.info(f"[CLAIM] Claimed job {job.id}")

    # Update active job count
    _increment_active()

    try:
        await _process_job(job)
    except Exception as e:
        logger.error(f"[ERROR] Job {job.id} unhandled error: {e}")
        logger.debug(traceback.format_exc())
    finally:
        _decrement_active()


# ── Job Processing ───────────────────────────────────────────────────────


async def _process_job(job) -> None:
    """Process a claimed job based on its type."""
    global _current_job_id

    start_time = time.time()
    all_logs: list[str] = []

    _current_job_id = job.id

    try:
        # Fetch scene context
        scene = get_scene_by_id(job.scene_id)
        if scene is None:
            await _fail(job, f"Scene {job.scene_id} not found")
            return

        # Update scene status to processing
        update_scene_status(scene.id, SceneStatus.PROCESSING)

        # Build pipeline context
        ctx = PipelineContext(
            job_id=job.id,
            scene_id=scene.id,
            session_id=scene.session_id or "",
            property_id=scene.property_id,
            org_id=get_property_org_id(scene.property_id),
        )

        # Get video capture ID from job metadata
        video_capture_id = job.metadata.get("video_capture_id")
        ctx.video_capture_id = video_capture_id

        # Dispatch based on job type
        if job.job_type == JobType.FRAME_EXTRACTION:
            log = await _process_frame_extraction(ctx, job)
        elif job.job_type == JobType.VIDEO_RECONSTRUCTION:
            log = await _process_video_reconstruction(ctx, job)
        elif job.job_type == JobType.SPLAT_GENERATION:
            log = await _process_splat_generation(ctx, job)
        else:
            log = f"Unknown job type: {job.job_type}"

        all_logs.append(log)

        # Mark job as completed (with retry on failure)
        success = complete_job(job.id, "\n".join(all_logs))
        if not success:
            logger.error(f"Failed to mark job {job.id} as completed, retrying...")
            for attempt in range(3):
                time.sleep(1.0 * (attempt + 1))
                success = complete_job(job.id, "\n".join(all_logs))
                if success:
                    break
            if not success:
                logger.error(f"Giving up on marking job {job.id} as completed after retries")

        _increment_completed()

        elapsed = time.time() - start_time
        logger.info(f"[COMPLETE] Job {job.id} completed in {elapsed:.1f}s\n")

    except Exception as e:
        error_msg = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
        logger.error(f"[FAIL] Job {job.id} failed: {e}")
        fail_job(job.id, error_msg)
        _increment_failed()

    finally:
        _current_job_id = None


async def _fail(job, message: str) -> None:
    """Helper to fail a job and increment failure counter."""
    fail_job(job.id, message)
    _increment_failed()


# ── Pipeline Stages ──────────────────────────────────────────────────────


async def _process_frame_extraction(ctx: PipelineContext, job) -> str:
    """Stage 1: Extract frames from uploaded video.

    Downloads video from Supabase Storage, extracts frames using
    OpenCV/FFmpeg, uploads frames, and creates a video_reconstruction job.
    """
    logger.info(f"[STAGE] Frame extraction for scene {ctx.scene_id}")

    video_capture_id = ctx.video_capture_id
    if not video_capture_id:
        raise ValueError("video_capture_id not found in job metadata")

    # Get video capture record
    video_capture = get_video_capture(video_capture_id)
    if video_capture is None:
        raise ValueError(f"Video capture {video_capture_id} not found")

    # Update video capture status
    update_video_capture_status(video_capture_id, VideoCaptureStatus.EXTRACTING)

    # Download video from Supabase Storage
    video_dir = tempfile.mkdtemp(prefix="lingbot-video-")
    video_path = None
    frames_dir = None

    try:
        video_path = download_to_file(
            config.bucket_video_captures,
            video_capture.storage_path,
            os.path.join(video_dir, "video.mp4"),
        )

        if not video_path:
            update_video_capture_status(video_capture_id, VideoCaptureStatus.FAILED)
            raise FileNotFoundError(
                f"Failed to download video from storage: {video_capture.storage_path}"
            )

        ctx.video_path = video_path
        append_job_log(ctx.job_id, f"Downloaded video: {video_capture.storage_path}")

        # Extract video metadata
        metadata = get_video_metadata(video_path)
        logger.info(f"Video metadata: {metadata}")

        # Update video capture with metadata
        update_video_capture_status(
            video_capture_id,
            VideoCaptureStatus.EXTRACTING,
            extra={
                "width": metadata.get("width"),
                "height": metadata.get("height"),
                "fps": metadata.get("fps"),
                "duration_seconds": metadata.get("duration_seconds"),
            },
        )

        # Extract frames
        frames_dir = os.path.join(config.frames_dir, ctx.session_id)
        result = extract_frames(
            video_path=video_path,
            output_dir=frames_dir,
        )

        if result.frame_count == 0:
            update_video_capture_status(video_capture_id, VideoCaptureStatus.FAILED)
            raise RuntimeError(
                f"No frames extracted from video (result: {result.log})"
            )

        ctx.frames_dir = result.frames_dir
        ctx.frame_count = result.frame_count

        # Update video capture with frame count
        update_video_capture_status(
            video_capture_id,
            VideoCaptureStatus.EXTRACTED,
            extra={"frame_count": result.frame_count},
        )

        # Upload frames to Supabase Storage
        uploaded = upload_frames(ctx.session_id, result.frames_dir)
        append_job_log(ctx.job_id, f"Uploaded {len(uploaded)} frames to storage")

        # Create video_reconstruction job
        new_job_id = create_job(
            scene_id=ctx.scene_id,
            job_type=JobType.VIDEO_RECONSTRUCTION,
            metadata={
                "video_capture_id": video_capture_id,
                "session_id": ctx.session_id,
                "frame_count": result.frame_count,
            },
        )

        if new_job_id:
            append_job_log(ctx.job_id, f"Created video_reconstruction job: {new_job_id}")
        else:
            logger.warning("Failed to create video_reconstruction job")

    finally:
        # Clean up video temp directory
        if video_dir and os.path.isdir(video_dir):
            shutil.rmtree(video_dir, ignore_errors=True)

    return (
        f"Frame extraction complete: {result.frame_count} frames, "
        f"{result.width}x{result.height}, {result.fps:.1f} FPS, "
        f"{result.duration_seconds:.1f}s | {result.log}"
    )


async def _process_video_reconstruction(ctx: PipelineContext, job) -> str:
    """Stage 2: Run LingBot-Map inference on extracted frames.

    Downloads frames (if not already local), runs LingBot-Map,
    uploads raw predictions, and creates a splat_generation job.

    Note: Model is intentionally kept loaded between jobs for efficiency.
    It is only unloaded on graceful shutdown.
    """
    logger.info(f"[STAGE] Video reconstruction for scene {ctx.scene_id}")

    # Determine frames directory
    frame_count = job.metadata.get("frame_count", 0)
    session_id = job.metadata.get("session_id", ctx.session_id)

    frames_dir = os.path.join(config.frames_dir, session_id)

    if not os.path.isdir(frames_dir) or len(os.listdir(frames_dir)) == 0:
        # Frames not available locally — download from Supabase Storage
        logger.info(f"Frames not found locally, downloading from storage for session {session_id}")
        os.makedirs(frames_dir, exist_ok=True)

        try:
            from db_client import get_client as get_db_client
            client = get_db_client()

            # List files in the video-frames bucket for this session
            files = client.storage.from_(config.bucket_video_frames).list(
                path=session_id,
            )
            downloaded_count = 0
            for f in files:
                fname = f.get("name", "") if isinstance(f, dict) else str(f)
                if not fname.lower().endswith((".jpg", ".jpeg", ".png")):
                    continue
                remote_path = f"{session_id}/{fname}"
                local_path = os.path.join(frames_dir, fname)
                success = download_to_file(
                    config.bucket_video_frames,
                    remote_path,
                    local_path,
                )
                if success:
                    downloaded_count += 1
                else:
                    logger.error(f"Failed to download frame: {remote_path}")
                    raise FileNotFoundError(
                        f"Frame download failed for {remote_path} — "
                        f"cannot continue without all frames"
                    )
            logger.info(f"Downloaded {downloaded_count} frames from storage")
        except Exception as e:
            logger.error(f"Failed to download frames from storage: {e}")
            raise  # Re-raise instead of silently continuing

        # Check if we got any frames
        if not os.path.isdir(frames_dir) or len(os.listdir(frames_dir)) == 0:
            raise FileNotFoundError(
                f"Frames not found locally at {frames_dir} and could not download from storage. "
                f"Frame extraction must run first."
            )

    ctx.frames_dir = frames_dir
    ctx.frame_count = frame_count or len([
        f for f in os.listdir(frames_dir)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    ])

    append_job_log(ctx.job_id, f"Running LingBot-Map on {ctx.frame_count} frames")

    # Run LingBot-Map inference
    output_dir = os.path.join(config.output_dir, ctx.scene_id)
    os.makedirs(output_dir, exist_ok=True)

    predictions = run_inference(
        frames_dir=frames_dir,
        output_dir=output_dir,
    )

    ctx.predictions_path = os.path.join(output_dir, "predictions.npz")
    append_job_log(ctx.job_id, "LingBot-Map inference complete")

    # Upload predictions to Supabase Storage
    predictions_url = upload_predictions(ctx.scene_id, ctx.predictions_path)
    if predictions_url:
        append_job_log(ctx.job_id, f"Uploaded predictions: {predictions_url}")
    else:
        logger.warning("Failed to upload predictions to storage")

    # Create splat_generation job
    new_job_id = create_job(
        scene_id=ctx.scene_id,
        job_type=JobType.SPLAT_GENERATION,
        metadata={
            "session_id": session_id,
            "predictions_path": ctx.predictions_path,
            "frame_count": ctx.frame_count,
        },
    )

    if new_job_id:
        append_job_log(ctx.job_id, f"Created splat_generation job: {new_job_id}")

    # Model is intentionally kept loaded between jobs for efficiency.
    # It is only unloaded on graceful shutdown (in main()).

    return (
        f"Video reconstruction complete: {ctx.frame_count} frames processed, "
        f"predictions saved to {ctx.predictions_path}"
    )


async def _process_splat_generation(ctx: PipelineContext, job) -> str:
    """Stage 3: Convert LingBot-Map output to Gaussian Splat format.

    Downloads predictions, converts to .splat binary, uploads all
    scene outputs, and marks the scene as ready.
    """
    logger.info(f"[STAGE] Splat generation for scene {ctx.scene_id}")

    start_time = time.time()

    # Determine predictions path
    predictions_path = job.metadata.get("predictions_path")
    session_id = job.metadata.get("session_id", ctx.session_id)

    # Frames directory for color extraction (used later, tracked for cleanup)
    frames_dir = os.path.join(config.frames_dir, session_id)

    try:
        # Try local path first
        if predictions_path and not os.path.isfile(predictions_path):
            # Download from storage
            local_dir = os.path.join(config.output_dir, ctx.scene_id)
            os.makedirs(local_dir, exist_ok=True)
            downloaded = download_predictions(ctx.scene_id, local_dir)
            if downloaded:
                predictions_path = downloaded
            else:
                raise FileNotFoundError(
                    f"Predictions not found locally or in storage for scene {ctx.scene_id}"
                )

        if not predictions_path or not os.path.isfile(predictions_path):
            raise FileNotFoundError(f"Predictions file not found: {predictions_path}")

        ctx.predictions_path = predictions_path

        # Frames directory for color extraction
        if not os.path.isdir(frames_dir):
            frames_dir = None

        # Convert to .splat format
        splat_dir = os.path.join(config.output_dir, ctx.scene_id)
        os.makedirs(splat_dir, exist_ok=True)
        splat_path = os.path.join(splat_dir, "model.splat")

        result = convert_to_splat(
            predictions_path=predictions_path,
            frames_dir=frames_dir,
            output_path=splat_path,
        )

        if result.gaussian_count == 0:
            raise RuntimeError("No Gaussians generated from point cloud")

        ctx.splat_path = result.splat_path
        ctx.gaussian_count = result.gaussian_count
        ctx.file_size_mb = result.file_size_mb

        append_job_log(ctx.job_id, f"Generated {result.gaussian_count} gaussians ({result.file_size_mb:.1f} MB)")

        # Generate thumbnail
        thumbnail_path = os.path.join(splat_dir, "thumbnail.jpg")
        thumb_result = generate_thumbnail(
            predictions_path=predictions_path,
            frames_dir=frames_dir,
            output_path=thumbnail_path,
        )
        ctx.thumbnail_path = thumb_result

        # Generate trajectory JSON
        trajectory_json = generate_trajectory_json(predictions_path)
        ctx.trajectory_path = os.path.join(splat_dir, "trajectory.json")
        with open(ctx.trajectory_path, "w") as f:
            f.write(trajectory_json)

        # Generate scene metadata
        processing_time = int(time.time() - start_time)
        ctx.processing_time_seconds = processing_time

        metadata_json = generate_scene_metadata(
            scene_id=ctx.scene_id,
            property_id=ctx.property_id,
            gaussian_count=ctx.gaussian_count,
            file_size_mb=ctx.file_size_mb,
            predictions_path=predictions_path,
            processing_time_seconds=processing_time,
        )
        ctx.metadata_path = os.path.join(splat_dir, "metadata.json")
        with open(ctx.metadata_path, "w") as f:
            f.write(metadata_json)

        # ── Upload all outputs to Supabase Storage ──

        # Upload .splat file
        model_url = upload_splat(ctx.scene_id, ctx.splat_path)
        if model_url:
            ctx.model_url = model_url
            append_job_log(ctx.job_id, f"Uploaded .splat: {model_url}")

        # Upload thumbnail
        thumbnail_url = None
        if ctx.thumbnail_path:
            thumbnail_url = upload_thumbnail(ctx.scene_id, ctx.thumbnail_path)
            if thumbnail_url:
                ctx.thumbnail_url = thumbnail_url
                append_job_log(ctx.job_id, f"Uploaded thumbnail: {thumbnail_url}")

        # Upload trajectory
        trajectory_url = upload_trajectory(ctx.scene_id, trajectory_json)
        if trajectory_url:
            ctx.trajectory_url = trajectory_url
            append_job_log(ctx.job_id, f"Uploaded trajectory: {trajectory_url}")

        # Upload metadata
        upload_scene_metadata(ctx.scene_id, metadata_json)

        # ── Update scene status ──

        # Critical: Check that model upload succeeded before marking scene ready
        if not ctx.model_url:
            logger.error(
                f"[SCENE] Scene {ctx.scene_id} model upload failed — marking scene as failed"
            )
            fail_scene(ctx.scene_id)
            raise RuntimeError(
                f"Splat file upload failed for scene {ctx.scene_id} — "
                f"scene marked as failed"
            )

        # Compute quality score
        quality_score = _compute_quality_score(ctx)

        # Complete scene with retry
        success = complete_scene(
            scene_id=ctx.scene_id,
            model_url=ctx.model_url or "",
            thumbnail_url=ctx.thumbnail_url or "",
            quality_score=quality_score,
            processing_time_seconds=ctx.processing_time_seconds,
        )
        if not success:
            logger.error(f"Failed to mark scene {ctx.scene_id} as ready, retrying...")
            for attempt in range(3):
                time.sleep(1.0 * (attempt + 1))
                success = complete_scene(
                    scene_id=ctx.scene_id,
                    model_url=ctx.model_url or "",
                    thumbnail_url=ctx.thumbnail_url or "",
                    quality_score=quality_score,
                    processing_time_seconds=ctx.processing_time_seconds,
                )
                if success:
                    break
            if not success:
                logger.error(
                    f"Giving up on marking scene {ctx.scene_id} as ready after retries "
                    f"— marking as failed"
                )
                fail_scene(ctx.scene_id)
                raise RuntimeError(
                    f"Failed to update scene {ctx.scene_id} status after retries"
                )

        logger.info(f"[SCENE] Scene {ctx.scene_id} marked as ready")

        # Update video capture status
        if ctx.video_capture_id:
            update_video_capture_status(ctx.video_capture_id, VideoCaptureStatus.COMPLETED)

        return (
            f"Splat generation complete: {ctx.gaussian_count} gaussians, "
            f"{ctx.file_size_mb:.1f} MB, quality={quality_score:.2f}, "
            f"time={ctx.processing_time_seconds}s"
        )

    finally:
        # ── Cleanup frames directory after splat generation ──
        if frames_dir and os.path.isdir(frames_dir):
            try:
                shutil.rmtree(frames_dir, ignore_errors=True)
                logger.info(f"Cleaned up frames directory: {frames_dir}")
            except OSError as e:
                logger.warning(f"Failed to clean up frames directory {frames_dir}: {e}")


# ── Quality Score Computation ────────────────────────────────────────────


def _compute_quality_score(ctx: PipelineContext) -> float:
    """Compute a quality score for the reconstruction.

    Factors:
    - Number of Gaussians (more is generally better, up to a point)
    - File size (reasonable size indicates good coverage)
    - Frame count (more frames = better coverage)

    Returns:
        float between 0.0 and 1.0
    """
    score = 0.5  # Base score

    # Gaussian count factor
    if ctx.gaussian_count > 0:
        # Logarithmic scaling: 100K gaussians → 0.2, 1M → 0.3, 2M → 0.35
        gauss_factor = min(0.35, 0.05 * (1 + math.log10(max(ctx.gaussian_count, 1) / 10000)))
        score += gauss_factor

    # File size factor (reasonable size: 10-500 MB)
    if ctx.file_size_mb > 0:
        size_factor = min(0.15, ctx.file_size_mb / 1000)
        score += size_factor

    # Frame count factor
    if ctx.frame_count > 0:
        frame_factor = min(0.1, ctx.frame_count / 500)
        score += frame_factor

    # Clamp to [0.0, 1.0]
    return round(min(1.0, max(0.0, score)), 2)


# ── Shutdown Handling ────────────────────────────────────────────────────


def _handle_shutdown(signum: int, frame) -> None:
    """Handle SIGINT/SIGTERM for graceful shutdown.

    Sets the shutdown flag so the main loop exits. Any in-progress job
    will be re-queued or failed by the shutdown section in main().
    """
    global _is_shutting_down
    if _is_shutting_down:
        return

    _is_shutting_down = True
    active, _, _ = _get_counters()
    logger.info(f"\n[SHUTDOWN] Shutdown signal received (signal {signum})...")
    logger.info(f"[SHUTDOWN] Active jobs: {active}")


# ── Entry Point ──────────────────────────────────────────────────────────


def run() -> None:
    """Synchronous entry point that runs the async main."""
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        logger.debug(traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    run()
