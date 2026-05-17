"""
LingBot-Map Worker — Type Definitions
=======================================
Strongly-typed data classes for all worker domain objects.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional


# ── Enums ────────────────────────────────────────────────────────────────


class JobType(str, Enum):
    """Types of processing jobs the worker handles."""
    FRAME_EXTRACTION = "frame_extraction"
    VIDEO_RECONSTRUCTION = "video_reconstruction"
    SPLAT_GENERATION = "splat_generation"


class JobStatus(str, Enum):
    """Processing job status values."""
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class VideoCaptureStatus(str, Enum):
    """Video capture record status values."""
    UPLOADED = "uploaded"
    EXTRACTING = "extracting"
    EXTRACTED = "extracted"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class SceneStatus(str, Enum):
    """Scene status values."""
    QUEUED = "queued"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class SessionStatus(str, Enum):
    """Capture session status values."""
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


# ── Domain Models ────────────────────────────────────────────────────────


@dataclass
class ProcessingJob:
    """Represents a processing_jobs row."""
    id: str
    scene_id: str
    job_type: JobType
    status: JobStatus
    logs: Optional[str] = None
    retry_count: int = 0
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class VideoCapture:
    """Represents a video_captures row."""
    id: str
    session_id: str
    property_id: str
    org_id: Optional[str] = None
    storage_path: str = ""
    file_size: int = 0
    content_type: str = "video/mp4"
    duration_seconds: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
    frame_count: Optional[int] = None
    status: VideoCaptureStatus = VideoCaptureStatus.UPLOADED
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


@dataclass
class Scene:
    """Represents a scenes row."""
    id: str
    property_id: str
    session_id: Optional[str] = None
    status: SceneStatus = SceneStatus.QUEUED
    model_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    quality_score: Optional[float] = None
    processing_time_seconds: Optional[int] = None


@dataclass
class CaptureSession:
    """Represents a capture_sessions row."""
    id: str
    property_id: str
    created_by: Optional[str] = None
    status: SessionStatus = SessionStatus.IN_PROGRESS
    device_type: Optional[str] = None
    total_images: int = 0
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


@dataclass
class Media:
    """Represents a media row."""
    id: str
    session_id: str
    property_id: str
    url: str
    type: str = "image"
    order_index: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


# ── LingBot-Map Output Types ─────────────────────────────────────────────


@dataclass
class LingBotPredictions:
    """Typed wrapper around LingBot-Map inference output."""
    pose_enc: Any  # [B, S, 9] tensor — 3 center + 4 quaternion + 2 fov
    depth: Any  # [B, S, H, W, 1] tensor
    depth_conf: Any  # [B, S, H, W] tensor
    world_points: Any  # [B, S, H, W, 3] tensor
    world_points_conf: Any  # [B, S, H, W] tensor
    extrinsic: Any  # [B, S, 3, 4] tensor
    intrinsic: Any  # [B, S, 3, 3] tensor

    def to_numpy(self) -> dict[str, Any]:
        """Convert all tensors to numpy arrays for serialization."""
        import numpy as np

        def _to_np(t: Any) -> Any:
            if hasattr(t, "cpu"):
                return t.detach().cpu().numpy()
            return np.asarray(t)

        return {
            "pose_enc": _to_np(self.pose_enc),
            "depth": _to_np(self.depth),
            "depth_conf": _to_np(self.depth_conf),
            "world_points": _to_np(self.world_points),
            "world_points_conf": _to_np(self.world_points_conf),
            "extrinsic": _to_np(self.extrinsic),
            "intrinsic": _to_np(self.intrinsic),
        }


# ── Pipeline Context ────────────────────────────────────────────────────


@dataclass
class PipelineContext:
    """Accumulated state passed between pipeline stages."""
    job_id: str
    scene_id: str
    session_id: str
    property_id: str
    org_id: Optional[str] = None
    video_capture_id: Optional[str] = None

    # Local filesystem paths (populated during processing)
    video_path: Optional[str] = None
    frames_dir: Optional[str] = None
    predictions_path: Optional[str] = None
    splat_path: Optional[str] = None
    thumbnail_path: Optional[str] = None
    trajectory_path: Optional[str] = None
    metadata_path: Optional[str] = None

    # Processing results
    frame_count: int = 0
    gaussian_count: int = 0
    file_size_mb: float = 0.0

    # Uploaded URLs
    model_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    trajectory_url: Optional[str] = None

    # Quality metrics
    quality_score: float = 0.0
    processing_time_seconds: int = 0

    # Logs accumulated from each stage
    logs: list[str] = field(default_factory=list)


# ── Frame Extraction Result ──────────────────────────────────────────────


@dataclass
class FrameExtractionResult:
    """Result of frame extraction from a video."""
    frames_dir: str
    frame_count: int
    frame_paths: list[str] = field(default_factory=list)
    width: int = 0
    height: int = 0
    fps: float = 0.0
    duration_seconds: float = 0.0
    log: str = ""


# ── Splat Conversion Result ──────────────────────────────────────────────


@dataclass
class SplatConversionResult:
    """Result of converting point cloud to .splat format."""
    splat_path: str
    gaussian_count: int
    file_size_bytes: int = 0
    file_size_mb: float = 0.0
    log: str = ""


# ── Health Check ─────────────────────────────────────────────────────────


@dataclass
class HealthStatus:
    """Worker health check response."""
    status: str = "healthy"
    version: str = "1.0.0"
    worker_id: str = ""
    gpu_type: str = "cpu-only"
    simulation_mode: bool = False
    supabase_connected: bool = False
    active_jobs: int = 0
    total_jobs_completed: int = 0
    total_jobs_failed: int = 0
    uptime_seconds: float = 0.0
