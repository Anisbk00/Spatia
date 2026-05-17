"""
LingBot-Map Worker — Storage Client
=====================================
Handles Supabase Storage uploads/downloads for all worker assets.
"""

from __future__ import annotations

import io
import logging
import os
from pathlib import Path
from typing import Optional

from supabase import Client

from config import config
from db_client import get_client

logger = logging.getLogger(__name__)


# ── Bucket Management ────────────────────────────────────────────────────


def ensure_bucket_exists(bucket_name: str) -> bool:
    """Ensure a storage bucket exists, creating it if necessary."""
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
            client.storage.create_bucket(
                bucket_name,
                options={"public": False},
            )
            logger.info(f"Created storage bucket: {bucket_name}")
            return True
        except Exception as create_err:
            # Bucket may already exist (race condition)
            logger.warning(f"Bucket creation race for {bucket_name}: {create_err}")
            try:
                client.storage.get_bucket(bucket_name)
                return True
            except Exception:
                return False

    except Exception as e:
        logger.error(f"Failed to ensure bucket {bucket_name}: {e}")
        return False


# ── Upload Operations ────────────────────────────────────────────────────


def upload_bytes(
    bucket_name: str,
    path: str,
    data: bytes,
    content_type: str = "application/octet-stream",
) -> Optional[str]:
    """Upload raw bytes to Supabase Storage.

    Returns the public URL if successful, None otherwise.
    """
    try:
        client = get_client()

        # Ensure bucket exists
        ensure_bucket_exists(bucket_name)

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

        # Get public URL
        public_url = storage.get_public_url(path)
        logger.info(f"Uploaded {path} to {bucket_name} ({len(data)} bytes)")
        return public_url

    except Exception as e:
        logger.error(f"Failed to upload {path} to {bucket_name}: {e}")
        return None


def upload_file(
    bucket_name: str,
    path: str,
    file_path: str,
    content_type: str = "application/octet-stream",
) -> Optional[str]:
    """Upload a local file to Supabase Storage.

    Returns the public URL if successful, None otherwise.
    """
    try:
        with open(file_path, "rb") as f:
            data = f.read()
        return upload_bytes(bucket_name, path, data, content_type)
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
) -> Optional[str]:
    """Upload a JSON string to Supabase Storage."""
    return upload_bytes(bucket_name, path, json_str.encode("utf-8"), "application/json")


def upload_text(
    bucket_name: str,
    path: str,
    text: str,
    content_type: str = "text/plain",
) -> Optional[str]:
    """Upload a text string to Supabase Storage."""
    return upload_bytes(bucket_name, path, text.encode("utf-8"), content_type)


# ── Download Operations ──────────────────────────────────────────────────


def download_bytes(bucket_name: str, path: str) -> Optional[bytes]:
    """Download raw bytes from Supabase Storage.

    Returns the file bytes if successful, None otherwise.
    """
    try:
        client = get_client()
        storage = client.storage.from_(bucket_name)
        data = storage.download(path)
        logger.info(f"Downloaded {path} from {bucket_name} ({len(data)} bytes)")
        return data

    except Exception as e:
        logger.error(f"Failed to download {path} from {bucket_name}: {e}")
        return None


def download_to_file(bucket_name: str, path: str, local_path: str) -> bool:
    """Download a file from Supabase Storage to the local filesystem."""
    try:
        data = download_bytes(bucket_name, path)
        if data is None:
            return False

        # Ensure parent directory exists
        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        with open(local_path, "wb") as f:
            f.write(data)

        logger.info(f"Downloaded {path} → {local_path}")
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

    Returns a list of uploaded frame paths.
    """
    uploaded = []

    if not os.path.isdir(frames_dir):
        logger.error(f"Frames directory not found: {frames_dir}")
        return uploaded

    # Sort frames to maintain order
    frame_files = sorted(
        f for f in os.listdir(frames_dir)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    )

    for frame_file in frame_files:
        local_path = os.path.join(frames_dir, frame_file)
        remote_path = f"{session_id}/{frame_file}"
        result = upload_file(
            config.bucket_video_frames,
            remote_path,
            local_path,
            "image/jpeg",
        )
        if result:
            uploaded.append(remote_path)
        else:
            logger.warning(f"Failed to upload frame: {frame_file}")

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
    """Upload the .splat file to scenes bucket."""
    path = f"{scene_id}/model.splat"
    return upload_file(
        config.bucket_scenes,
        path,
        splat_path,
        "application/octet-stream",
    )


def upload_thumbnail(scene_id: str, thumbnail_path: str) -> Optional[str]:
    """Upload a thumbnail image to scenes bucket."""
    path = f"{scene_id}/thumbnail.jpg"
    return upload_file(
        config.bucket_scenes,
        path,
        thumbnail_path,
        "image/jpeg",
    )


def upload_trajectory(scene_id: str, trajectory_json: str) -> Optional[str]:
    """Upload camera trajectory JSON to scenes bucket."""
    path = f"{scene_id}/trajectory.json"
    return upload_json(config.bucket_scenes, path, trajectory_json)


def upload_scene_metadata(scene_id: str, metadata_json: str) -> Optional[str]:
    """Upload scene metadata JSON to scenes bucket."""
    path = f"{scene_id}/metadata.json"
    return upload_json(config.bucket_scenes, path, metadata_json)
