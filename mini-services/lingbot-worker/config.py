"""
LingBot-Map Worker — Environment Configuration
================================================
Centralizes all environment variable access with defaults and validation.
"""

import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class WorkerConfig:
    """Immutable configuration loaded from environment variables."""

    # ── Supabase ──────────────────────────────────────────────────────
    supabase_url: str = ""
    supabase_service_key: str = ""

    # ── Worker tuning ─────────────────────────────────────────────────
    poll_interval_ms: int = 5000
    max_concurrent_jobs: int = 1
    max_retry_count: int = 3

    # ── GPU / Hardware ────────────────────────────────────────────────
    gpu_type: str = "cpu-only"
    gpu_memory_gb: float = 0.0

    # ── LingBot-Map ───────────────────────────────────────────────────
    lingbot_model_path: str = "/models/lingbot-map-long.pt"
    lingbot_image_size: int = 518
    lingbot_patch_size: int = 14
    lingbot_keyframe_interval: int = 2
    lingbot_num_scale_frames: int = 8
    lingbot_camera_num_iterations: int = 4
    lingbot_fps: int = 10
    lingbot_mask_sky: bool = True
    lingbot_mode: str = "streaming"

    # ── Frame extraction ──────────────────────────────────────────────
    max_frames_per_video: int = 500
    target_fps: float = 5.0
    frame_format: str = "jpg"
    frame_quality: int = 95

    # ── Splat conversion ──────────────────────────────────────────────
    confidence_threshold: float = 0.3
    voxel_downsample_size: float = 0.02
    max_gaussians: int = 2_000_000

    # ── Service ───────────────────────────────────────────────────────
    service_port: int = 3005
    worker_name: Optional[str] = None
    worker_region: str = "us-east"
    heartbeat_interval_ms: int = 30000

    # ── Paths ─────────────────────────────────────────────────────────
    temp_dir: str = "/tmp/lingbot-worker"
    frames_dir: str = "/tmp/lingbot-worker/frames"
    output_dir: str = "/tmp/lingbot-worker/output"

    # ── Simulation ────────────────────────────────────────────────────
    simulation_mode: bool = False

    # ── Storage buckets ───────────────────────────────────────────────
    # NOTE: Videos are uploaded via the Next.js API to the "property-captures"
    # bucket at path "video-captures/{session_id}/{videoId}.{ext}".
    # The worker must download from the SAME bucket.
    bucket_video_captures: str = "property-captures"
    bucket_video_frames: str = "video-frames"
    bucket_reconstruction: str = "reconstruction-outputs"
    bucket_scenes: str = "scenes"

    # ── Runtime (not from env) ────────────────────────────────────────
    hostname: str = field(default_factory=lambda: os.environ.get("HOSTNAME", "local"))

    @classmethod
    def from_env(cls) -> "WorkerConfig":
        """Load configuration from environment variables."""
        supabase_url = os.environ.get("SUPABASE_URL", "")
        supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", "")

        # Determine simulation mode: if no Supabase or LingBot not installed
        simulation = os.environ.get("SIMULATION_MODE", "").lower() in ("1", "true", "yes")

        return cls(
            supabase_url=supabase_url,
            supabase_service_key=supabase_key,
            poll_interval_ms=int(os.environ.get("POLL_INTERVAL_MS", "5000")),
            max_concurrent_jobs=int(os.environ.get("MAX_CONCURRENT_JOBS", "1")),
            max_retry_count=int(os.environ.get("MAX_RETRY_COUNT", "3")),
            gpu_type=os.environ.get("GPU_TYPE", "cpu-only"),
            gpu_memory_gb=float(os.environ.get("GPU_MEMORY_GB", "0")),
            lingbot_model_path=os.environ.get("LINGBOT_MODEL_PATH", "/models/lingbot-map-long.pt"),
            lingbot_image_size=int(os.environ.get("LINGBOT_IMAGE_SIZE", "518")),
            lingbot_patch_size=int(os.environ.get("LINGBOT_PATCH_SIZE", "14")),
            lingbot_keyframe_interval=int(os.environ.get("LINGBOT_KEYFRAME_INTERVAL", "2")),
            lingbot_num_scale_frames=int(os.environ.get("LINGBOT_NUM_SCALE_FRAMES", "8")),
            lingbot_camera_num_iterations=int(os.environ.get("LINGBOT_CAMERA_NUM_ITERATIONS", "4")),
            lingbot_fps=int(os.environ.get("LINGBOT_FPS", "10")),
            lingbot_mask_sky=os.environ.get("LINGBOT_MASK_SKY", "true").lower() in ("1", "true", "yes"),
            lingbot_mode=os.environ.get("LINGBOT_MODE", "streaming"),
            max_frames_per_video=int(os.environ.get("MAX_FRAMES_PER_VIDEO", "500")),
            target_fps=float(os.environ.get("TARGET_FPS", "5.0")),
            frame_format=os.environ.get("FRAME_FORMAT", "jpg"),
            frame_quality=int(os.environ.get("FRAME_QUALITY", "95")),
            confidence_threshold=float(os.environ.get("CONFIDENCE_THRESHOLD", "0.3")),
            voxel_downsample_size=float(os.environ.get("VOXEL_DOWNSAMPLE_SIZE", "0.02")),
            max_gaussians=int(os.environ.get("MAX_GAUSSIANS", "2000000")),
            service_port=int(os.environ.get("SERVICE_PORT", "3005")),
            worker_name=os.environ.get("WORKER_NAME"),
            worker_region=os.environ.get("WORKER_REGION", "us-east"),
            heartbeat_interval_ms=int(os.environ.get("HEARTBEAT_INTERVAL_MS", "30000")),
            temp_dir=os.environ.get("TEMP_DIR", "/tmp/lingbot-worker"),
            simulation_mode=simulation,
        )

    @property
    def supabase_configured(self) -> bool:
        """Check if Supabase connection is properly configured."""
        return bool(self.supabase_url and self.supabase_service_key)

    def validate(self) -> list[str]:
        """Validate configuration and return list of warnings."""
        warnings: list[str] = []
        if not self.supabase_configured:
            warnings.append(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY not set — "
                "worker will operate in standalone mode"
            )
        if self.gpu_type == "cpu-only" and not self.simulation_mode:
            warnings.append(
                "GPU_TYPE is cpu-only — LingBot-Map inference will be extremely slow"
            )
        if self.max_concurrent_jobs > 1 and self.gpu_type == "cpu-only":
            warnings.append(
                "MAX_CONCURRENT_JOBS > 1 with cpu-only GPU may cause OOM"
            )
        return warnings


# Singleton config instance
config = WorkerConfig.from_env()
