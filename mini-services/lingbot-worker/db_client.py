"""
LingBot-Map Worker — Database Client
======================================
Supabase database operations for job polling, claiming, and status updates.
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


def claim_job(job_id: str) -> bool:
    """Atomically claim a job by setting status to 'running'.

    Uses conditional UPDATE to avoid race conditions:
    only claims if the job is still 'queued'.
    """
    try:
        client = get_client()

        response = (
            client.table("processing_jobs")
            .update({
                "status": JobStatus.RUNNING.value,
                "started_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", job_id)
            .eq("status", JobStatus.QUEUED.value)  # atomic guard
            .execute()
        )

        if response.data and len(response.data) > 0:
            logger.info(f"Claimed job {job_id}")
            return True
        else:
            logger.info(f"Job {job_id} already claimed by another worker")
            return False

    except Exception as e:
        logger.error(f"Failed to claim job {job_id}: {e}")
        return False


def complete_job(job_id: str, logs: str = "") -> bool:
    """Mark a job as completed."""
    try:
        client = get_client()

        update_data: dict[str, Any] = {
            "status": JobStatus.COMPLETED.value,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }
        if logs:
            update_data["logs"] = logs

        client.table("processing_jobs").update(update_data).eq("id", job_id).execute()
        logger.info(f"Job {job_id} marked as completed")
        return True

    except Exception as e:
        logger.error(f"Failed to complete job {job_id}: {e}")
        return False


def fail_job(job_id: str, error_message: str) -> bool:
    """Mark a job as failed and increment retry_count.

    If retry_count < max, the job will be re-queued by a separate scheduler.
    """
    try:
        client = get_client()

        # First, get current retry_count
        response = (
            client.table("processing_jobs")
            .select("retry_count")
            .eq("id", job_id)
            .execute()
        )

        current_retries = 0
        if response.data and len(response.data) > 0:
            current_retries = response.data[0].get("retry_count", 0)

        update_data: dict[str, Any] = {
            "status": JobStatus.FAILED.value,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "retry_count": current_retries + 1,
            "logs": error_message[:5000],  # Truncate very long error messages
        }

        client.table("processing_jobs").update(update_data).eq("id", job_id).execute()
        logger.info(f"Job {job_id} marked as failed (retry #{current_retries + 1})")
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


def append_job_log(job_id: str, log_line: str) -> None:
    """Append a log line to a job's existing logs."""
    try:
        client = get_client()

        # Get current logs
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

        client.table("processing_jobs").update({"logs": updated_logs}).eq("id", job_id).execute()

    except Exception as e:
        logger.error(f"Failed to append log to job {job_id}: {e}")


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

        client.table("scenes").update({
            "status": status.value,
        }).eq("id", scene_id).execute()

        logger.info(f"Scene {scene_id} status → {status.value}")
        return True

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
    """Mark a scene as ready with all outputs."""
    try:
        client = get_client()

        client.table("scenes").update({
            "status": SceneStatus.READY.value,
            "model_url": model_url,
            "thumbnail_url": thumbnail_url,
            "quality_score": quality_score,
            "processing_time_seconds": processing_time_seconds,
        }).eq("id", scene_id).execute()

        logger.info(f"Scene {scene_id} marked as ready")
        return True

    except Exception as e:
        logger.error(f"Failed to complete scene: {e}")
        return False


def fail_scene(scene_id: str) -> bool:
    """Mark a scene as failed."""
    try:
        client = get_client()

        client.table("scenes").update({
            "status": SceneStatus.FAILED.value,
        }).eq("id", scene_id).execute()

        logger.info(f"Scene {scene_id} marked as failed")
        return True

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
