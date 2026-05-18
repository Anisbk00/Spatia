"""
LingBot-Map Worker — Frame Extractor
======================================
Extracts frames from uploaded videos using OpenCV (cv2) with adaptive sampling.

Features:
- Adaptive frame sampling based on video duration and target FPS
- Frame quality validation (blur detection)
- Subprocess FFmpeg fallback if OpenCV fails
- Metadata extraction (resolution, FPS, duration, frame count)
- Early error when blur filtering removes all frames
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from typing import Optional

import cv2
import numpy as np

from config import config
from schemas import FrameExtractionResult

logger = logging.getLogger(__name__)


# ── Public API ───────────────────────────────────────────────────────────


def extract_frames(
    video_path: str,
    output_dir: Optional[str] = None,
    target_fps: Optional[float] = None,
    max_frames: Optional[int] = None,
    quality: Optional[int] = None,
) -> FrameExtractionResult:
    """Extract frames from a video file with adaptive sampling.

    Args:
        video_path: Path to the input video file.
        output_dir: Directory to save extracted frames. If None, uses temp dir.
        target_fps: Target frames per second for sampling. Uses config default if None.
        max_frames: Maximum number of frames to extract. Uses config default if None.
        quality: JPEG quality (1-100). Uses config default if None.

    Returns:
        FrameExtractionResult with paths and metadata.
    """
    target_fps = target_fps or config.target_fps
    max_frames = max_frames or config.max_frames_per_video
    quality = quality or config.frame_quality

    # Create output directory
    if output_dir is None:
        output_dir = tempfile.mkdtemp(prefix="lingbot-frames-")
    os.makedirs(output_dir, exist_ok=True)

    logger.info(
        f"Extracting frames from {video_path} "
        f"(target_fps={target_fps}, max_frames={max_frames})"
    )

    # Try OpenCV first, fall back to FFmpeg
    result = _extract_with_opencv(video_path, output_dir, target_fps, max_frames, quality)

    if result is None:
        logger.warning("OpenCV extraction failed, trying FFmpeg fallback...")
        result = _extract_with_ffmpeg(video_path, output_dir, target_fps, max_frames, quality)

    if result is None:
        return FrameExtractionResult(
            frames_dir=output_dir,
            frame_count=0,
            log="Failed to extract frames with both OpenCV and FFmpeg",
        )

    # Filter blurry frames
    result = _filter_blurry_frames(result, blur_threshold=100.0)

    # Early error if blur filtering removed all frames
    if result.frame_count == 0:
        logger.error(
            "All frames were filtered out as blurry — "
            "cannot proceed with zero frames"
        )
        result.log += (
            "\nERROR: All frames filtered as blurry (Laplacian variance below threshold). "
            "Consider lowering the blur threshold or using a video with sharper frames."
        )
        return result

    logger.info(
        f"Extracted {result.frame_count} frames "
        f"({result.width}x{result.height}, {result.fps:.1f} FPS, "
        f"{result.duration_seconds:.1f}s)"
    )

    return result


def get_video_metadata(video_path: str) -> dict:
    """Extract video metadata without full frame extraction.

    Returns dict with: width, height, fps, frame_count, duration_seconds, codec
    """
    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        return {}

    try:
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0.0
        fourcc_code = int(cap.get(cv2.CAP_PROP_FOURCC))
        codec = "".join(chr((fourcc_code >> 8 * i) & 0xFF) for i in range(4))

        return {
            "width": width,
            "height": height,
            "fps": round(fps, 2),
            "frame_count": total_frames,
            "duration_seconds": round(duration, 2),
            "codec": codec.strip(),
        }
    finally:
        cap.release()


# ── OpenCV Extraction ────────────────────────────────────────────────────


def _extract_with_opencv(
    video_path: str,
    output_dir: str,
    target_fps: float,
    max_frames: int,
    quality: int,
) -> Optional[FrameExtractionResult]:
    """Extract frames using OpenCV VideoCapture with adaptive sampling."""
    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        logger.error(f"Cannot open video with OpenCV: {video_path}")
        return None

    try:
        # Get video properties
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        if fps <= 0:
            logger.error(f"Invalid FPS detected: {fps}")
            return None

        duration = total_frames / fps

        # Calculate frame sampling interval
        frame_interval = _calculate_frame_interval(fps, target_fps, total_frames, max_frames)

        # Calculate expected frame count
        expected_frames = min(total_frames // frame_interval, max_frames)

        logger.info(
            f"Video: {width}x{height}, {fps:.1f} FPS, "
            f"{total_frames} total frames, {duration:.1f}s, "
            f"sampling every {frame_interval} frames → ~{expected_frames} output frames"
        )

        # Extract frames
        frame_paths: list[str] = []
        frame_index = 0
        saved_index = 0

        # JPEG encoding parameters
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, quality]

        while saved_index < max_frames:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_index % frame_interval == 0:
                # Resize if needed (LingBot-Map expects images divisible by patch_size)
                resized = _resize_for_model(frame, config.lingbot_image_size)

                # Save frame
                frame_filename = f"frame_{saved_index:04d}.jpg"
                frame_path = os.path.join(output_dir, frame_filename)
                cv2.imwrite(frame_path, resized, encode_params)

                frame_paths.append(frame_path)
                saved_index += 1

            frame_index += 1

        actual_fps = min(target_fps, fps)

        return FrameExtractionResult(
            frames_dir=output_dir,
            frame_count=len(frame_paths),
            frame_paths=frame_paths,
            width=width,
            height=height,
            fps=actual_fps,
            duration_seconds=duration,
            log=f"Extracted {len(frame_paths)} frames using OpenCV "
                f"(interval={frame_interval}, quality={quality})",
        )

    except Exception as e:
        logger.error(f"OpenCV extraction error: {e}")
        return None
    finally:
        cap.release()


# ── FFmpeg Fallback ──────────────────────────────────────────────────────


def _extract_with_ffmpeg(
    video_path: str,
    output_dir: str,
    target_fps: float,
    max_frames: int,
    quality: int,
) -> Optional[FrameExtractionResult]:
    """Extract frames using FFmpeg subprocess as a fallback."""
    try:
        # Check FFmpeg availability
        subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        logger.error("FFmpeg not available for fallback extraction")
        return None

    try:
        # First, get video info
        probe_cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            video_path,
        ]
        probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)

        # Parse basic info from ffprobe
        import json
        probe_data = json.loads(probe_result.stdout) if probe_result.returncode == 0 else {}

        video_stream = None
        for stream in probe_data.get("streams", []):
            if stream.get("codec_type") == "video":
                video_stream = stream
                break

        width = int(video_stream["width"]) if video_stream else 0
        height = int(video_stream["height"]) if video_stream else 0
        fps = 30.0  # Default assumption
        if video_stream:
            # Parse FPS from r_frame_rate
            r_frame_rate = video_stream.get("r_frame_rate", "30/1")
            parts = r_frame_rate.split("/")
            if len(parts) == 2 and int(parts[1]) > 0:
                fps = int(parts[0]) / int(parts[1])

        duration = 0.0
        format_info = probe_data.get("format", {})
        if "duration" in format_info:
            duration = float(format_info["duration"])

        # Calculate actual FPS for extraction
        extract_fps = min(target_fps, fps)

        # FFmpeg extraction command
        output_pattern = os.path.join(output_dir, "frame_%04d.jpg")
        cmd = [
            "ffmpeg",
            "-i", video_path,
            "-vf", f"fps={extract_fps:.2f}",
            "-q:v", str(max(1, min(31, int((100 - quality) / 3.1)))),
            "-frames:v", str(max_frames),
            "-y",  # Overwrite output
            output_pattern,
        ]

        logger.info(f"Running FFmpeg: {' '.join(cmd)}")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
        )

        if result.returncode != 0:
            logger.error(f"FFmpeg error: {result.stderr}")
            return None

        # Count extracted frames
        frame_paths = sorted([
            os.path.join(output_dir, f)
            for f in os.listdir(output_dir)
            if f.startswith("frame_") and f.endswith(".jpg")
        ])

        return FrameExtractionResult(
            frames_dir=output_dir,
            frame_count=len(frame_paths),
            frame_paths=frame_paths,
            width=width,
            height=height,
            fps=extract_fps,
            duration_seconds=duration,
            log=f"Extracted {len(frame_paths)} frames using FFmpeg fallback "
                f"(fps={extract_fps:.2f}, quality={quality})",
        )

    except Exception as e:
        logger.error(f"FFmpeg extraction error: {e}")
        return None


# ── Blur Detection ───────────────────────────────────────────────────────


def _filter_blurry_frames(
    result: FrameExtractionResult,
    blur_threshold: float = 100.0,
) -> FrameExtractionResult:
    """Remove blurry frames from the extraction result.

    Uses Laplacian variance to detect blur. Returns the result with
    zero frame_count if all frames are filtered out (caller should
    handle this as an error condition).
    """
    if result.frame_count == 0:
        return result

    kept_paths: list[str] = []
    blur_count = 0

    for frame_path in result.frame_paths:
        img = cv2.imread(frame_path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            continue

        # Compute Laplacian variance as blur measure
        variance = cv2.Laplacian(img, cv2.CV_64F).var()

        if variance >= blur_threshold:
            kept_paths.append(frame_path)
        else:
            blur_count += 1
            # Remove blurry frame file
            try:
                os.remove(frame_path)
            except OSError:
                pass

    if blur_count > 0:
        logger.info(f"Filtered {blur_count} blurry frames (threshold={blur_threshold})")

    result.frame_paths = kept_paths
    result.frame_count = len(kept_paths)
    result.log += f"\nFiltered {blur_count} blurry frames (Laplacian var < {blur_threshold})"

    return result


# ── Helpers ──────────────────────────────────────────────────────────────


def _calculate_frame_interval(
    video_fps: float,
    target_fps: float,
    total_frames: int,
    max_frames: int,
) -> int:
    """Calculate the frame sampling interval for adaptive extraction.

    The interval is chosen to:
    1. Achieve approximately target_fps
    2. Not exceed max_frames
    3. Be at least 1 (every frame)

    Args:
        video_fps: Source video FPS.
        target_fps: Desired output FPS.
        total_frames: Total number of frames in the video.
        max_frames: Maximum number of output frames.

    Returns:
        Integer frame interval (sample every N-th frame).
    """
    # Interval to achieve target FPS
    fps_interval = max(1, round(video_fps / target_fps))

    # Interval to stay within max_frames
    max_interval = max(1, total_frames // max_frames) if max_frames > 0 else 1

    # Use the larger interval (less frames, but both constraints satisfied)
    return max(fps_interval, max_interval)


def _resize_for_model(frame: np.ndarray, target_size: int) -> np.ndarray:
    """Resize a frame to be compatible with LingBot-Map input requirements.

    - Preserves aspect ratio
    - Ensures dimensions are divisible by patch_size
    - Caps at target_size on the longest side
    """
    h, w = frame.shape[:2]
    patch_size = config.lingbot_patch_size

    # Calculate scale to fit within target_size while maintaining aspect ratio
    scale = min(target_size / max(h, w), 1.0)

    new_h = int(h * scale)
    new_w = int(w * scale)

    # Make dimensions divisible by patch_size
    new_h = (new_h // patch_size) * patch_size
    new_w = (new_w // patch_size) * patch_size

    # Ensure minimum size
    new_h = max(new_h, patch_size)
    new_w = max(new_w, patch_size)

    if new_h != h or new_w != w:
        frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

    return frame
