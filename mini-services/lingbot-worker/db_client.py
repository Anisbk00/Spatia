"""
LingBot-Map Worker — Database Client
======================================
Supabase database operations for job polling, claiming, and status updates.

Required Postgres RPC Functions
--------------------------------
The following functions should be created on the Supabase database to ensure
atomic operations (avoiding read-modify-write race conditions):

1. fail_job_atomic — Atomically increments retry_count and sets status:

    CREATE OR REPLACE FUNCTION fail_job_atomic(
        p_job_id UUID,
        p_max_retries INTEGER,
        p_error_message TEXT
    )
    RETURNS VOID AS $$
    BEGIN
        UPDATE processing_jobs
        SET retry_count = retry_count + 1,
            status = CASE
                WHEN retry_count + 1 >= p_max_retries THEN 'failed'
                ELSE 'queued'
            END,
            finished_at = NOW(),
            logs = LEFT(p_error_message, 5000)
        WHERE id = p_job_id;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;

2. append_job_log — Atomically appends to the logs column:

    CREATE OR REPLACE FUNCTION append_job_log(
        p_job_id UUID,
        p_log_line TEXT
    )
    RETURNS VOID AS $$
    BEGIN
        UPDATE processing_jobs
        SET logs = CASE
            WHEN length(COALESCE(logs, '')) > 4500 THEN logs
            ELSE COALESCE(logs, '') || chr(10) || p_log_line
        END
        WHERE id = p_job_id;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from supabase import Client, create_client

from config import config
from schemas import (
    CaptureSession,
    JobStatus,
    JobType,
    Media,
    ProcessingJob,
    Scene,
    SceneStatus,
    VideoCapture,
    VideoCaptureStatus,
)

logger = logging.getLogger(__name__)

# ── Client singleton ─────────────────────────────────────────────────────

_client: Optional[Client] = None


def get_client() -> Client:
    """Get or create the Supabase client singleton."""
    global _client
    if _client is None:
        if not config.supabase_configured:
            raise RuntimeError(
                "Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_KEY"
            )
        _client = create_client(config.supabase_url, config.supabase_service_key)
        logger.info("Supabase client initialized")
    return _client


def is_connected() -> bool:
    """Check if Supabase client can be initialized."""
    try:
        get_client()
        return True
    except Exception:
        return False


# ── Job Operations ───────────────────────────────────────────────────────


def get_next_queued_job() -> Optional[ProcessingJob]:
    """Poll for the next queued job of the types this worker handles.

    Returns the oldest queued job matching our job types, or None.
    """
    try:
        client = get_client()

        job_types = [
            JobType.FRAME_EXTRACTION.value,
            JobType.VIDEO_RECONSTRUCTION.value,
            JobType.SPLAT_GENERATION.value,
        ]

        response = (
            client.table("processing_jobs")
            .select("*")
            .eq("status", JobStatus.QUEUED.value)
            .in_("job_type", job_types)
            .order("created_at", desc=False)
            .limit(1)
            .execute()
        )

        if not response.data:
            return None

        row = response.data[0]
        return _row_to_job(row)

    except Exception as e:
        logger.error(f"Failed to poll for jobs: {e}")
        return None


def claim_job(job_id: str, worker_id: str = "") -> bool:
    """Atomically claim a job by setting status to 'running'.

    Uses conditional UPDATE to avoid race conditions:
    only claims if the job is still 'queued'.

    Args:
        job_id: The job to claim.
        worker_id: Identifier of the worker claiming the job.

    Returns:
        True if the job was successfully claimed, False otherwise.
    """
    try:
        client = get_client()

        update_data: dict[str, Any] = {
            "status": JobStatus.RUNNING.value,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        if worker_id:
            update_data["claimed_by"] = worker_id

        response = (
            client.table("processing_jobs")
            .update(update_data)
            .eq("id", job_id)
            .eq("status", JobStatus.QUEUED.value)  # atomic guard
            .execute()
        )

        if response.data and len(response.data) > 0:
            logger.info(f"Claimed job {job_id} (worker: {worker_id})")
            return True
        else:
            logger.info(f"Job {job_id} already claimed by another worker")
            return False

    except Exception as e:
        logger.error(f"Failed to claim job {job_id}: {e}")
        return False


def complete_job(job_id: str, logs: str = "") -> bool:
    """Mark a job as completed.

    Returns:
        True if the job was successfully marked completed, False otherwise.
    """
    try:
        client = get_client()

        update_data: dict[str, Any] = {
            "status": JobStatus.COMPLETED.value,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }
        if logs:
            update_data["logs"] = logs

        response = (
            client.table("processing_jobs")
            .update(update_data)
            .eq("id", job_id)
            .execute()
        )

        success = bool(response.data and len(response.data) > 0)
        if success:
            logger.info(f"Job {job_id} marked as completed")
        else:
            logger.warning(f"Job {job_id} complete update affected 0 rows")
        return success

    except Exception as e:
        logger.error(f"Failed to complete job {job_id}: {e}")
        return False


def fail_job(job_id: str, error_message: str) -> bool:
    """Mark a job as failed and increment retry_count.

    Uses the atomic ``fail_job_atomic`` Postgres RPC function when available,
    falling back to a read-modify-write approach if the function has not been
    deployed yet.

    If retry_count + 1 >= max_retries, the job is set to 'failed';
    otherwise it is re-queued ('queued').

    Returns:
        True if the operation succeeded, False otherwise.
    """
    try:
        client = get_client()

        # ── Preferred path: atomic RPC ──
        try:
            client.rpc("fail_job_atomic", {
                "p_job_id": job_id,
                "p_max_retries": config.max_retry_count,
                "p_error_message": error_message[:5000],
            }).execute()
            logger.info(f"Job {job_id} failed via atomic RPC")
            return True
        except Exception as rpc_err:
            # RPC function may not be deployed yet — fall back gracefully
            logger.debug(f"RPC fail_job_atomic not available ({rpc_err}), using fallback")

        # ── Fallback: read-modify-write (not race-safe) ──
        response = (
            client.table("processing_jobs")
            .select("retry_count, max_retries")
            .eq("id", job_id)
            .execute()
        )

        current_retries = 0
        max_retries = config.max_retry_count
        if response.data and len(response.data) > 0:
            row = response.data[0]
            current_retries = row.get("retry_count", 0)
            max_retries = row.get("max_retries", config.max_retry_count)

        new_retry_count = current_retries + 1
        new_status = (
            JobStatus.FAILED.value
            if new_retry_count >= max_retries
            else JobStatus.QUEUED.value
        )

        update_data: dict[str, Any] = {
            "status": new_status,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "retry_count": new_retry_count,
            "logs": error_message[:5000],
        }

        client.table("processing_jobs").update(update_data).eq("id", job_id).execute()
        logger.info(f"Job {job_id} marked as {new_status} (retry #{new_retry_count})")
        return True

    except Exception as e:
        logger.error(f"Failed to fail job {job_id}: {e}")
        return False


def create_job(
    scene_id: str,
    job_type: JobType,
    metadata: Optional[dict[str, Any]] = None,
) -> Optional[str]:
    """Create a new processing job and return its ID."""
    try:
        client = get_client()

        insert_data: dict[str, Any] = {
            "scene_id": scene_id,
            "job_type": job_type.value,
            "status": JobStatus.QUEUED.value,
        }
        if metadata:
            insert_data["metadata"] = metadata

        response = client.table("processing_jobs").insert(insert_data).execute()

        if response.data and len(response.data) > 0:
            job_id = response.data[0]["id"]
            logger.info(f"Created {job_type.value} job {job_id} for scene {scene_id}")
            return job_id
        return None

    except Exception as e:
        logger.error(f"Failed to create job: {e}")
        return None


def append_job_log(job_id: str, log_line: str) -> bool:
    """Append a log line to a job's existing logs.

    Uses the atomic ``append_job_log`` Postgres RPC function when available,
    falling back to a read-modify-write approach if the function has not been
    deployed yet.

    Returns:
        True if the append succeeded, False otherwise.
    """
    try:
        client = get_client()

        # ── Preferred path: atomic RPC ──
        try:
            client.rpc("append_job_log", {
                "p_job_id": job_id,
                "p_log_line": log_line,
            }).execute()
            return True
        except Exception as rpc_err:
            # RPC function may not be deployed yet — fall back gracefully
            logger.debug(f"RPC append_job_log not available ({rpc_err}), using fallback")

        # ── Fallback: read-modify-write (not race-safe) ──
        response = (
            client.table("processing_jobs")
            .select("logs")
            .eq("id", job_id)
            .execute()
        )

        current_logs = ""
        if response.data and len(response.data) > 0:
            current_logs = response.data[0].get("logs", "") or ""

        updated_logs = current_logs + "\n" + log_line if current_logs else log_line

        # Truncate if too long
        if len(updated_logs) > 5000:
            updated_logs = "...\n" + updated_logs[-4900:]

        result = (
            client.table("processing_jobs")
            .update({"logs": updated_logs})
            .eq("id", job_id)
            .execute()
        )

        success = bool(result.data and len(result.data) > 0)
        if not success:
            logger.warning(f"append_job_log update affected 0 rows for job {job_id}")
        return success

    except Exception as e:
        logger.error(f"Failed to append log to job {job_id}: {e}")
        return False


# ── Scene Operations ─────────────────────────────────────────────────────


def get_scene_by_id(scene_id: str) -> Optional[Scene]:
    """Fetch a scene by ID."""
    try:
        client = get_client()

        response = (
            client.table("scenes")
            .select("*")
            .eq("id", scene_id)
            .execute()
        )

        if not response.data:
            return None

        row = response.data[0]
        return Scene(
            id=row["id"],
            property_id=row["property_id"],
            session_id=row.get("session_id"),
            status=SceneStatus(row.get("status", "queued")),
            model_url=row.get("model_url"),
            thumbnail_url=row.get("thumbnail_url"),
            quality_score=row.get("quality_score"),
            processing_time_seconds=row.get("processing_time_seconds"),
        )

    except Exception as e:
        logger.error(f"Failed to get scene {scene_id}: {e}")
        return None


def update_scene_status(scene_id: str, status: SceneStatus) -> bool:
    """Update a scene's status."""
    try:
        client = get_client()

        response = (
            client.table("scenes")
            .update({"status": status.value})
            .eq("id", scene_id)
            .execute()
        )

        success = bool(response.data and len(response.data) > 0)
        if success:
            logger.info(f"Scene {scene_id} status → {status.value}")
        else:
            logger.warning(f"update_scene_status affected 0 rows for scene {scene_id}")
        return success

    except Exception as e:
        logger.error(f"Failed to update scene status: {e}")
        return False


def complete_scene(
    scene_id: str,
    model_url: str,
    thumbnail_url: str,
    quality_score: float,
    processing_time_seconds: int,
) -> bool:
    """Mark a scene as ready with all outputs.

    Returns:
        True if the scene was successfully marked ready, False otherwise.
    """
    try:
        client = get_client()

        response = (
            client.table("scenes")
            .update({
                "status": SceneStatus.READY.value,
                "model_url": model_url,
                "thumbnail_url": thumbnail_url,
                "quality_score": quality_score,
                "processing_time_seconds": processing_time_seconds,
            })
            .eq("id", scene_id)
            .execute()
        )

        success = bool(response.data and len(response.data) > 0)
        if success:
            logger.info(f"Scene {scene_id} marked as ready")
        else:
            logger.warning(f"complete_scene affected 0 rows for scene {scene_id}")
        return success

    except Exception as e:
        logger.error(f"Failed to complete scene: {e}")
        return False


def fail_scene(scene_id: str) -> bool:
    """Mark a scene as failed.

    Returns:
        True if the scene was successfully marked failed, False otherwise.
    """
    try:
        client = get_client()

        response = (
            client.table("scenes")
            .update({"status": SceneStatus.FAILED.value})
            .eq("id", scene_id)
            .execute()
        )

        success = bool(response.data and len(response.data) > 0)
        if success:
            logger.info(f"Scene {scene_id} marked as failed")
        else:
            logger.warning(f"fail_scene affected 0 rows for scene {scene_id}")
        return success

    except Exception as e:
        logger.error(f"Failed to fail scene: {e}")
        return False


# ── Video Capture Operations ─────────────────────────────────────────────


def get_video_capture(video_capture_id: str) -> Optional[VideoCapture]:
    """Fetch a video capture record by ID."""
    try:
        client = get_client()

        response = (
            client.table("video_captures")
            .select("*")
            .eq("id", video_capture_id)
            .execute()
        )

        if not response.data:
            return None

        row = response.data[0]
        return VideoCapture(
            id=row["id"],
            session_id=row["session_id"],
            property_id=row["property_id"],
            org_id=row.get("org_id"),
            storage_path=row.get("storage_path", ""),
            file_size=row.get("file_size", 0),
            content_type=row.get("content_type", "video/mp4"),
            duration_seconds=row.get("duration_seconds"),
            width=row.get("width"),
            height=row.get("height"),
            fps=row.get("fps"),
            frame_count=row.get("frame_count"),
            status=VideoCaptureStatus(row.get("status", "uploaded")),
            metadata=row.get("metadata", {}),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )

    except Exception as e:
        logger.error(f"Failed to get video capture {video_capture_id}: {e}")
        return None


def update_video_capture_status(
    video_capture_id: str,
    status: VideoCaptureStatus,
    extra: Optional[dict[str, Any]] = None,
) -> bool:
    """Update a video capture's status and optional fields."""
    try:
        client = get_client()

        update_data: dict[str, Any] = {
            "status": status.value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if extra:
            update_data.update(extra)

        client.table("video_captures").update(update_data).eq("id", video_capture_id).execute()
        logger.info(f"Video capture {video_capture_id} status → {status.value}")
        return True

    except Exception as e:
        logger.error(f"Failed to update video capture status: {e}")
        return False


# ── Capture Session Operations ───────────────────────────────────────────


def complete_session(session_id: str) -> bool:
    """Mark a capture session as completed."""
    try:
        client = get_client()

        client.table("capture_sessions").update({
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", session_id).execute()

        logger.info(f"Session {session_id} marked as completed")
        return True

    except Exception as e:
        logger.error(f"Failed to complete session: {e}")
        return False


# ── Media Operations ─────────────────────────────────────────────────────


def get_session_media(session_id: str) -> list[Media]:
    """Fetch all media for a capture session, ordered by order_index."""
    try:
        client = get_client()

        response = (
            client.table("media")
            .select("*")
            .eq("session_id", session_id)
            .order("order_index", desc=False)
            .execute()
        )

        return [
            Media(
                id=row["id"],
                session_id=row["session_id"],
                property_id=row["property_id"],
                url=row["url"],
                type=row.get("type", "image"),
                order_index=row.get("order_index", 0),
                metadata=row.get("metadata", {}),
            )
            for row in (response.data or [])
        ]

    except Exception as e:
        logger.error(f"Failed to get session media: {e}")
        return []


# ── Property Operations ──────────────────────────────────────────────────


def set_property_ready(property_id: str) -> bool:
    """Mark a property as ready for viewing."""
    try:
        client = get_client()

        client.table("properties").update({
            "status": "ready",
        }).eq("id", property_id).execute()

        logger.info(f"Property {property_id} marked as ready")
        return True

    except Exception as e:
        logger.error(f"Failed to set property ready: {e}")
        return False


def get_property_org_id(property_id: str) -> Optional[str]:
    """Get the organization ID for a property."""
    try:
        client = get_client()

        response = (
            client.table("properties")
            .select("org_id")
            .eq("id", property_id)
            .execute()
        )

        if response.data and len(response.data) > 0:
            return response.data[0].get("org_id")
        return None

    except Exception as e:
        logger.error(f"Failed to get property org ID: {e}")
        return None


# ── Helpers ──────────────────────────────────────────────────────────────


def _row_to_job(row: dict[str, Any]) -> ProcessingJob:
    """Convert a database row to a ProcessingJob."""
    return ProcessingJob(
        id=row["id"],
        scene_id=row["scene_id"],
        job_type=JobType(row["job_type"]),
        status=JobStatus(row["status"]),
        logs=row.get("logs"),
        retry_count=row.get("retry_count", 0),
        started_at=row.get("started_at"),
        finished_at=row.get("finished_at"),
        created_at=row.get("created_at"),
        metadata=row.get("metadata", {}),
    )
