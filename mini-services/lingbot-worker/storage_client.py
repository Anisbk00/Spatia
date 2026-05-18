"""
LingBot-Map Worker — Storage Client
=====================================
Handles Supabase Storage uploads/downloads for all worker assets.

Features:
- Retry with exponential backoff for all operations (3 attempts)
- Concurrent frame uploads via ThreadPoolExecutor (max 5 workers)
- Download integrity verification (file size check)
- Automatic bucket creation with proper error handling
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import io
import logging
import os
import time
from pathlib import Path
from typing import Optional

from supabase import Client

from config import config
from db_client import get_client

logger = logging.getLogger(__name__)

# ── Retry Configuration ──────────────────────────────────────────────────

MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # seconds

# ── Bucket Management ────────────────────────────────────────────────────


def ensure_bucket_exists(bucket_name: str, public: bool = False) -> bool:
    """Ensure a storage bucket exists, creating it if necessary.

    Args:
        bucket_name: Name of the storage bucket.
        public: Whether the bucket should be publicly accessible.

    Returns:
        True if the bucket exists or was created, False otherwise.
    """
    try:
        client = get_client()

        # Check if bucket exists
        try:
            client.storage.get_bucket(bucket_name)
            return True
        except Exception:
            pass

        # Create bucket
        try:
            result = client.storage.create_bucket(
                bucket_name,
                options={"public": public},
            )
            if result is None:
                logger.error(
                    f"create_bucket returned None for {bucket_name} — "
                    f"bucket may not have been created"
                )
                return False
            logger.info(f"Created storage bucket: {bucket_name} (public={public})")
            return True
        except Exception as create_err:
            # Bucket may already exist (race condition)
            logger.warning(f"Bucket creation race for {bucket_name}: {create_err}")
            try:
                client.storage.get_bucket(bucket_name)
                return True
            except Exception:
                logger.error(
                    f"Bucket {bucket_name} does not exist and could not be created"
                )
                return False

    except Exception as e:
        logger.error(f"Failed to ensure bucket {bucket_name}: {e}")
        return False


# ── Retry Helper ─────────────────────────────────────────────────────────


def _retry_operation(operation, description: str = "storage operation"):
    """Execute an operation with exponential backoff retry.

    Args:
        operation: Callable that returns a result.
        description: Human-readable description for logging.

    Returns:
        The result of the operation.

    Raises:
        The last exception if all retries are exhausted.
    """
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            return operation()
        except Exception as e:
            last_err = e
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(
                    f"{description} failed (attempt {attempt + 1}/{MAX_RETRIES}): "
                    f"{e}. Retrying in {delay:.1f}s..."
                )
                time.sleep(delay)
            else:
                logger.error(
                    f"{description} failed after {MAX_RETRIES} attempts: {e}"
                )
    raise last_err  # type: ignore[misc]


# ── Upload Operations ────────────────────────────────────────────────────


def upload_bytes(
    bucket_name: str,
    path: str,
    data: bytes,
    content_type: str = "application/octet-stream",
    public: bool = False,
) -> Optional[str]:
    """Upload raw bytes to Supabase Storage.

    Returns the public URL if the bucket is public, otherwise returns the
    storage path (caller should generate a signed URL for private buckets).

    Args:
        bucket_name: Target bucket.
        path: Destination path within the bucket.
        data: Raw bytes to upload.
        content_type: MIME type.
        public: Whether the bucket should be treated as public.

    Returns:
        Public URL if successful, None otherwise.
    """
    def _do_upload():
        client = get_client()

        # Ensure bucket exists
        ensure_bucket_exists(bucket_name, public=public)

        # Upload with upsert to handle re-uploads
        storage = client.storage.from_(bucket_name)
        storage.upload(
            path=path,
            data=data,
            file_options={
                "content-type": content_type,
                "upsert": "true",
            },
        )

        # Get public URL (only valid for public buckets)
        url = storage.get_public_url(path)
        logger.info(f"Uploaded {path} to {bucket_name} ({len(data)} bytes)")
        return url

    try:
        return _retry_operation(_do_upload, f"upload_bytes({bucket_name}/{path})")
    except Exception as e:
        logger.error(f"Failed to upload {path} to {bucket_name}: {e}")
        return None


def upload_file(
    bucket_name: str,
    path: str,
    file_path: str,
    content_type: str = "application/octet-stream",
    public: bool = False,
) -> Optional[str]:
    """Upload a local file to Supabase Storage.

    Returns the public URL if successful, None otherwise.
    """
    try:
        with open(file_path, "rb") as f:
            data = f.read()
        return upload_bytes(bucket_name, path, data, content_type, public=public)
    except FileNotFoundError:
        logger.error(f"File not found: {file_path}")
        return None
    except Exception as e:
        logger.error(f"Failed to upload file {file_path}: {e}")
        return None


def upload_json(
    bucket_name: str,
    path: str,
    json_str: str,
    public: bool = False,
) -> Optional[str]:
    """Upload a JSON string to Supabase Storage."""
    return upload_bytes(
        bucket_name, path, json_str.encode("utf-8"), "application/json",
        public=public,
    )


def upload_text(
    bucket_name: str,
    path: str,
    text: str,
    content_type: str = "text/plain",
    public: bool = False,
) -> Optional[str]:
    """Upload a text string to Supabase Storage."""
    return upload_bytes(
        bucket_name, path, text.encode("utf-8"), content_type,
        public=public,
    )


# ── Download Operations ──────────────────────────────────────────────────


def download_bytes(bucket_name: str, path: str) -> Optional[bytes]:
    """Download raw bytes from Supabase Storage.

    Returns the file bytes if successful, None otherwise.
    """
    def _do_download():
        client = get_client()
        storage = client.storage.from_(bucket_name)
        data = storage.download(path)
        logger.info(f"Downloaded {path} from {bucket_name} ({len(data)} bytes)")
        return data

    try:
        return _retry_operation(_do_download, f"download_bytes({bucket_name}/{path})")
    except Exception as e:
        logger.error(f"Failed to download {path} from {bucket_name}: {e}")
        return None


def download_to_file(
    bucket_name: str,
    path: str,
    local_path: str,
    expected_size: int = 0,
) -> bool:
    """Download a file from Supabase Storage to the local filesystem.

    Args:
        bucket_name: Source bucket.
        path: Source path within the bucket.
        local_path: Destination path on local filesystem.
        expected_size: If > 0, verify downloaded file size matches.

    Returns:
        True if download succeeded and integrity check passed, False otherwise.
    """
    try:
        data = download_bytes(bucket_name, path)
        if data is None:
            return False

        # Integrity verification: check size if expected_size is provided
        if expected_size > 0 and len(data) != expected_size:
            logger.error(
                f"Download integrity check failed for {path}: "
                f"expected {expected_size} bytes, got {len(data)} bytes"
            )
            return False

        # Ensure parent directory exists
        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        with open(local_path, "wb") as f:
            f.write(data)

        # Post-write verification
        actual_size = os.path.getsize(local_path)
        if len(data) != actual_size:
            logger.error(
                f"Write verification failed for {local_path}: "
                f"expected {len(data)} bytes, wrote {actual_size} bytes"
            )
            os.remove(local_path)
            return False

        logger.info(f"Downloaded {path} → {local_path} ({actual_size} bytes)")
        return True

    except Exception as e:
        logger.error(f"Failed to download {path} to {local_path}: {e}")
        return False


# ── Convenience Wrappers ─────────────────────────────────────────────────


def upload_video_capture(video_id: str, session_id: str, file_path: str) -> Optional[str]:
    """Upload a video file to the video-captures bucket."""
    path = f"{session_id}/{video_id}.mp4"
    return upload_file(config.bucket_video_captures, path, file_path, "video/mp4")


def upload_frames(session_id: str, frames_dir: str) -> list[str]:
    """Upload all extracted frames to the video-frames bucket.

    Uses concurrent uploads (max 5 workers) for better throughput.

    Returns a list of uploaded frame paths.
    """
    uploaded: list[str] = []

    if not os.path.isdir(frames_dir):
        logger.error(f"Frames directory not found: {frames_dir}")
        return uploaded

    # Sort frames to maintain order
    frame_files = sorted(
        f for f in os.listdir(frames_dir)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    )

    if not frame_files:
        logger.warning(f"No frame files found in {frames_dir}")
        return uploaded

    def _upload_single(frame_file: str) -> Optional[str]:
        local_path = os.path.join(frames_dir, frame_file)
        remote_path = f"{session_id}/{frame_file}"
        result = upload_file(
            config.bucket_video_frames,
            remote_path,
            local_path,
            "image/jpeg",
        )
        if result:
            return remote_path
        else:
            logger.warning(f"Failed to upload frame: {frame_file}")
            return None

    # Use ThreadPoolExecutor for concurrent uploads
    max_workers = min(5, len(frame_files))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_file = {
            executor.submit(_upload_single, f): f for f in frame_files
        }

        for future in concurrent.futures.as_completed(future_to_file):
            frame_file = future_to_file[future]
            try:
                result = future.result()
                if result:
                    uploaded.append(result)
            except Exception as e:
                logger.warning(f"Frame upload exception for {frame_file}: {e}")

    logger.info(f"Uploaded {len(uploaded)}/{len(frame_files)} frames for session {session_id}")
    return uploaded


def download_video_capture(video_id: str, session_id: str, local_dir: str) -> Optional[str]:
    """Download a video capture to a local directory.

    Returns the local file path if successful, None otherwise.
    """
    path = f"{session_id}/{video_id}.mp4"
    local_path = os.path.join(local_dir, f"{video_id}.mp4")

    if download_to_file(config.bucket_video_captures, path, local_path):
        return local_path
    return None


def download_video_from_storage_path(storage_path: str, local_dir: str) -> Optional[str]:
    """Download a video using its full storage path.

    Returns the local file path if successful, None otherwise.
    """
    # Extract filename from storage path
    filename = os.path.basename(storage_path)
    local_path = os.path.join(local_dir, filename)

    if download_to_file(config.bucket_video_captures, storage_path, local_path):
        return local_path
    return None


def upload_predictions(scene_id: str, npz_path: str) -> Optional[str]:
    """Upload LingBot predictions (.npz) to reconstruction-outputs bucket."""
    path = f"{scene_id}/predictions.npz"
    return upload_file(
        config.bucket_reconstruction,
        path,
        npz_path,
        "application/octet-stream",
    )


def download_predictions(scene_id: str, local_dir: str) -> Optional[str]:
    """Download LingBot predictions for a scene."""
    path = f"{scene_id}/predictions.npz"
    local_path = os.path.join(local_dir, "predictions.npz")

    if download_to_file(config.bucket_reconstruction, path, local_path):
        return local_path
    return None


def upload_splat(scene_id: str, splat_path: str) -> Optional[str]:
    """Upload the .splat file to scenes bucket (public)."""
    path = f"{scene_id}/model.splat"
    return upload_file(
        config.bucket_scenes,
        path,
        splat_path,
        "application/octet-stream",
        public=True,
    )


def upload_thumbnail(scene_id: str, thumbnail_path: str) -> Optional[str]:
    """Upload a thumbnail image to scenes bucket (public)."""
    path = f"{scene_id}/thumbnail.jpg"
    return upload_file(
        config.bucket_scenes,
        path,
        thumbnail_path,
        "image/jpeg",
        public=True,
    )


def upload_trajectory(scene_id: str, trajectory_json: str) -> Optional[str]:
    """Upload camera trajectory JSON to scenes bucket (public)."""
    path = f"{scene_id}/trajectory.json"
    return upload_json(config.bucket_scenes, path, trajectory_json, public=True)


def upload_scene_metadata(scene_id: str, metadata_json: str) -> Optional[str]:
    """Upload scene metadata JSON to scenes bucket (public)."""
    path = f"{scene_id}/metadata.json"
    return upload_json(config.bucket_scenes, path, metadata_json, public=True)
