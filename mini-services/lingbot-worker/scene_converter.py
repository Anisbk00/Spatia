"""
LingBot-Map Worker — Scene Converter
======================================
Converts LingBot-Map output (point clouds + poses + depth) into
Gaussian Splat format (.splat binary) for real-time 3D viewing.

.splat Binary Format (32 bytes per Gaussian):
    position:   3×float32 (12 bytes) — x, y, z
    scale:      3×float32 (12 bytes) — log scale for x, y, z
    rotation:   4×uint8   (4 bytes)  — normalized quaternion as bytes
    color:      3×uint8   (3 bytes)  — RGB
    opacity:    1×uint8   (1 byte)   — alpha
"""

from __future__ import annotations

import datetime
import json
import logging
import os
import tempfile
from typing import Any, Optional

import numpy as np

from config import config
from schemas import SplatConversionResult

logger = logging.getLogger(__name__)


# ── Constants ────────────────────────────────────────────────────────────

BYTES_PER_GAUSSIAN = 32  # 3*f32 + 3*f32 + 4*u8 + 3*u8 + 1*u8
SPLAT_MAGIC = b"SPLAT"
SPLAT_VERSION = 1


# ── Public API ───────────────────────────────────────────────────────────


def convert_to_splat(
    predictions_path: str,
    frames_dir: Optional[str] = None,
    output_path: Optional[str] = None,
    confidence_threshold: Optional[float] = None,
    max_gaussians: Optional[int] = None,
) -> SplatConversionResult:
    """Convert LingBot-Map predictions to .splat format.

    Args:
        predictions_path: Path to the predictions.npz file.
        frames_dir: Directory containing source frames (for color extraction).
            If None, uses depth-based pseudo-coloring.
        output_path: Path for the output .splat file. If None, uses temp dir.
        confidence_threshold: Minimum confidence to include a point.
            If None, uses config value.
        max_gaussians: Maximum number of Gaussians in output.
            If None, uses config value.

    Returns:
        SplatConversionResult with output file info.
    """
    confidence_threshold = confidence_threshold or config.confidence_threshold
    max_gaussians = max_gaussians or config.max_gaussians

    if output_path is None:
        output_dir = tempfile.mkdtemp(prefix="lingbot-splat-")
        output_path = os.path.join(output_dir, "model.splat")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    logger.info(
        f"Converting predictions to .splat: "
        f"confidence_threshold={confidence_threshold}, "
        f"max_gaussians={max_gaussians}"
    )

    # Deterministic seed from predictions_path for reproducible subsampling
    predictions_seed = abs(hash(predictions_path)) % (2**32)

    # Load predictions
    predictions = _load_predictions(predictions_path)
    if predictions is None:
        return SplatConversionResult(
            splat_path=output_path,
            gaussian_count=0,
            log="Failed to load predictions",
        )

    # Extract world points and confidence
    world_points = predictions["world_points"]  # [B, S, H, W, 3]
    world_points_conf = predictions["world_points_conf"]  # [B, S, H, W]

    logger.info(f"Predictions shape: world_points={world_points.shape}")

    # Flatten to point cloud
    positions, confidences = _flatten_point_cloud(world_points, world_points_conf)

    logger.info(f"Total points before filtering: {len(positions)}")

    # Filter by confidence
    mask = confidences >= confidence_threshold
    positions = positions[mask]
    confidences = confidences[mask]

    logger.info(f"Points after confidence filter (≥{confidence_threshold}): {len(positions)}")

    if len(positions) == 0:
        return SplatConversionResult(
            splat_path=output_path,
            gaussian_count=0,
            log="No points passed confidence threshold",
        )

    # Extract colors from frames or generate pseudo-colors
    colors = _extract_colors(predictions, frames_dir, mask)

    # Estimate scales from point density (deterministic)
    scales = _estimate_scales(positions, seed=predictions_seed)

    # Estimate rotations (aligned to surface normals)
    rotations = _estimate_rotations(predictions, mask)

    # Estimate opacity from confidence
    opacities = _estimate_opacities(confidences)

    # Subsample if exceeding max_gaussians (deterministic)
    if len(positions) > max_gaussians:
        logger.info(f"Subsampling from {len(positions)} to {max_gaussians} gaussians")
        indices = _smart_subsample(positions, max_gaussians, seed=predictions_seed)
        positions = positions[indices]
        scales = scales[indices]
        rotations = rotations[indices]
        colors = colors[indices]
        opacities = opacities[indices]

    # Write .splat file
    _write_splat_file(
        output_path=output_path,
        positions=positions,
        scales=scales,
        rotations=rotations,
        colors=colors,
        opacities=opacities,
    )

    file_size = os.path.getsize(output_path)
    file_size_mb = file_size / (1024 * 1024)

    logger.info(
        f"Wrote .splat file: {output_path} "
        f"({len(positions)} gaussians, {file_size_mb:.1f} MB)"
    )

    return SplatConversionResult(
        splat_path=output_path,
        gaussian_count=len(positions),
        file_size_bytes=file_size,
        file_size_mb=file_size_mb,
        log=f"Converted {len(positions)} gaussians to .splat format "
            f"({file_size_mb:.1f} MB, confidence≥{confidence_threshold})",
    )


def generate_trajectory_json(predictions_path: str) -> str:
    """Generate camera trajectory JSON from LingBot-Map predictions.

    Returns a JSON string with camera poses suitable for 3D viewer navigation.
    """
    predictions = _load_predictions(predictions_path)
    if predictions is None:
        return json.dumps({"cameras": [], "error": "Failed to load predictions"})

    pose_enc = predictions["pose_enc"]  # [B, S, 9]
    extrinsic = predictions["extrinsic"]  # [B, S, 3, 4]
    intrinsic = predictions["intrinsic"]  # [B, S, 3, 3]

    # Take batch 0
    B = 0
    S = pose_enc.shape[1]

    cameras = []
    for i in range(S):
        # Extract pose encoding
        px, py, pz = pose_enc[B, i, :3]
        qx, qy, qz, qw = pose_enc[B, i, 3:7]
        fov_h, fov_v = pose_enc[B, i, 7:9]

        # Extract extrinsic
        R = extrinsic[B, i, :3, :3]
        t = extrinsic[B, i, :3, 3]

        # Extract intrinsic
        fx = intrinsic[B, i, 0, 0]
        fy = intrinsic[B, i, 1, 1]
        cx = intrinsic[B, i, 0, 2]
        cy = intrinsic[B, i, 1, 2]

        cameras.append({
            "index": i,
            "position": {
                "x": float(px),
                "y": float(py),
                "z": float(pz),
            },
            "rotation": {
                "x": float(qx),
                "y": float(qy),
                "z": float(qz),
                "w": float(qw),
            },
            "fov_horizontal": float(fov_h),
            "fov_vertical": float(fov_v),
            "extrinsic": {
                "R": R.tolist(),
                "t": t.tolist(),
            },
            "intrinsic": {
                "fx": float(fx),
                "fy": float(fy),
                "cx": float(cx),
                "cy": float(cy),
            },
        })

    trajectory = {
        "version": "1.0",
        "frame_count": S,
        "cameras": cameras,
        "metadata": {
            "source": "lingbot-map",
            "coordinate_system": "right-handed-y-up",
        },
    }

    return json.dumps(trajectory, indent=2)


def generate_scene_metadata(
    scene_id: str,
    property_id: str,
    gaussian_count: int,
    file_size_mb: float,
    predictions_path: str,
    processing_time_seconds: int,
) -> str:
    """Generate scene metadata JSON."""
    predictions = _load_predictions(predictions_path)

    bounds = {"min": [-5, -0.5, -5], "max": [5, 3, 5]}
    frame_count = 0

    if predictions is not None:
        world_points = predictions["world_points"]
        # Compute actual bounds from the point cloud
        flat_points = world_points.reshape(-1, 3)

        # Use deterministic seeded RNG for reproducibility
        scene_id_hash = abs(hash(scene_id)) % (2**32)
        rng = np.random.RandomState(scene_id_hash)

        # Sample to avoid memory issues
        if len(flat_points) > 100000:
            sample_idx = rng.choice(len(flat_points), 100000, replace=False)
            flat_points = flat_points[sample_idx]

        bounds = {
            "min": flat_points.min(axis=0).tolist(),
            "max": flat_points.max(axis=0).tolist(),
        }
        frame_count = world_points.shape[1]

    metadata = {
        "version": "1.0",
        "sceneId": scene_id,
        "propertyId": property_id,
        "source": "lingbot-map",
        "splatCount": gaussian_count,
        "fileSizeMB": round(file_size_mb, 2),
        "frameCount": frame_count,
        "bounds": bounds,
        "coordinateSystem": "right-handed-y-up",
        "processingTimeSeconds": processing_time_seconds,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "pipelineVersion": "lingbot-v1.0",
    }

    return json.dumps(metadata, indent=2)


def generate_thumbnail(
    predictions_path: str,
    frames_dir: Optional[str] = None,
    output_path: Optional[str] = None,
) -> Optional[str]:
    """Generate a thumbnail image from the reconstruction.

    Creates a top-down view render of the point cloud, or uses
    the first source frame as a fallback.

    Returns the path to the thumbnail image.
    """
    if output_path is None:
        output_dir = tempfile.mkdtemp(prefix="lingbot-thumb-")
        output_path = os.path.join(output_dir, "thumbnail.jpg")

    # Try to use a source frame as thumbnail
    if frames_dir and os.path.isdir(frames_dir):
        # Use os.listdir() with case-insensitive matching instead of glob
        frames = sorted([
            os.path.join(frames_dir, f)
            for f in os.listdir(frames_dir)
            if f.lower().startswith("frame_") and f.lower().endswith(".jpg")
        ])
        if frames:
            # Use a frame from the middle of the sequence
            mid_idx = len(frames) // 2
            try:
                import cv2
                img = cv2.imread(frames[mid_idx])
                if img is not None:
                    # Resize to thumbnail size
                    img = cv2.resize(img, (512, 512), interpolation=cv2.INTER_AREA)
                    cv2.imwrite(output_path, img)
                    logger.info(f"Generated thumbnail from frame {mid_idx}")
                    return output_path
            except ImportError:
                pass

            # Fallback: just copy the frame
            import shutil
            shutil.copy2(frames[mid_idx], output_path)
            logger.info(f"Used frame {mid_idx} as thumbnail")
            return output_path

    # Generate a simple point cloud visualization
    try:
        return _generate_point_cloud_thumbnail(predictions_path, output_path)
    except Exception as e:
        logger.warning(f"Failed to generate thumbnail: {e}")
        return None


# ── Internal Helpers ─────────────────────────────────────────────────────


def _load_predictions(npz_path: str) -> Optional[dict[str, np.ndarray]]:
    """Load predictions from .npz file."""
    try:
        data = np.load(npz_path, allow_pickle=False)
        return dict(data)
    except Exception as e:
        logger.error(f"Failed to load predictions from {npz_path}: {e}")
        return None


def _flatten_point_cloud(
    world_points: np.ndarray,  # [B, S, H, W, 3]
    world_points_conf: np.ndarray,  # [B, S, H, W]
) -> tuple[np.ndarray, np.ndarray]:
    """Flatten the 5D world points tensor into an Nx3 point cloud.

    Returns:
        positions: [N, 3] float32
        confidences: [N] float32
    """
    # Take batch 0
    points = world_points[0]  # [S, H, W, 3]
    conf = world_points_conf[0]  # [S, H, W]

    S, H, W, _ = points.shape

    # Reshape to [S*H*W, 3]
    positions = points.reshape(-1, 3).astype(np.float32)
    confidences = conf.reshape(-1).astype(np.float32)

    # Remove NaN and Inf
    valid = np.isfinite(positions).all(axis=1)
    positions = positions[valid]
    confidences = confidences[valid]

    return positions, confidences


def _extract_colors(
    predictions: dict[str, np.ndarray],
    frames_dir: Optional[str],
    mask: np.ndarray,
) -> np.ndarray:
    """Extract RGB colors for each Gaussian.

    Priority:
    1. Colors from source frames (if frames_dir is provided)
    2. Depth-based pseudo-coloring (fallback)

    Returns:
        colors: [N, 3] uint8 RGB
    """
    # Try reading colors from source frames
    if frames_dir and os.path.isdir(frames_dir):
        try:
            colors = _extract_colors_from_frames(predictions, frames_dir, mask)
            if colors is not None:
                return colors
        except Exception as e:
            logger.warning(f"Failed to extract colors from frames: {e}")

    # Fallback: depth-based pseudo-coloring
    logger.info("Using depth-based pseudo-coloring")
    return _pseudo_color_from_depth(predictions, mask)


def _extract_colors_from_frames(
    predictions: dict[str, np.ndarray],
    frames_dir: str,
    mask: np.ndarray,
) -> Optional[np.ndarray]:
    """Extract per-pixel colors from the original video frames.

    Maps each world point back to its source frame pixel and reads the color.
    Uses os.listdir() with case-insensitive matching instead of glob.
    """
    # Use os.listdir() instead of glob.glob() for case-insensitive matching
    frame_paths = sorted([
        os.path.join(frames_dir, f)
        for f in os.listdir(frames_dir)
        if f.lower().startswith("frame_") and f.lower().endswith(".jpg")
    ])
    if not frame_paths:
        return None

    try:
        import cv2
    except ImportError:
        return None

    depth = predictions["depth"]  # [B, S, H, W, 1]
    S = depth.shape[1]
    H = depth.shape[2]
    W = depth.shape[3]

    # Total points = S * H * W
    total_points = S * H * W

    # Pre-allocate color array
    all_colors = np.zeros((total_points, 3), dtype=np.uint8)

    loaded = 0
    for i in range(min(S, len(frame_paths))):
        img = cv2.imread(frame_paths[i])
        if img is None:
            continue

        # Resize frame to match prediction dimensions
        img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
        # BGR → RGB
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        # Flatten to [H*W, 3]
        frame_colors = img.reshape(-1, 3)

        # Place in the correct position
        start = i * H * W
        end = start + H * W
        if end <= total_points:
            all_colors[start:end] = frame_colors
            loaded += 1

    if loaded == 0:
        return None

    logger.info(f"Extracted colors from {loaded}/{S} frames")

    # Apply confidence mask
    return all_colors[mask]


def _pseudo_color_from_depth(
    predictions: dict[str, np.ndarray],
    mask: np.ndarray,
) -> np.ndarray:
    """Generate pseudo-colors based on depth values.

    Uses a blue-near / green-mid / red-far color scheme.
    """
    depth = predictions["depth"]  # [B, S, H, W, 1]
    depth_flat = depth[0].reshape(-1).astype(np.float32)

    # Apply mask
    depth_masked = depth_flat[mask]

    # Normalize to [0, 1]
    d_min = depth_masked.min()
    d_max = depth_masked.max()
    if d_max - d_min < 1e-6:
        depth_norm = np.zeros_like(depth_masked)
    else:
        depth_norm = (depth_masked - d_min) / (d_max - d_min)

    # Apply colormap (blue → green → red)
    colors = np.zeros((len(depth_norm), 3), dtype=np.uint8)

    # Blue to green (0 → 0.5)
    half_mask = depth_norm <= 0.5
    t = depth_norm[half_mask] * 2  # 0 to 1
    colors[half_mask, 0] = 0
    colors[half_mask, 1] = (t * 255).astype(np.uint8)
    colors[half_mask, 2] = ((1 - t) * 255).astype(np.uint8)

    # Green to red (0.5 → 1.0)
    other_mask = ~half_mask
    t = (depth_norm[other_mask] - 0.5) * 2  # 0 to 1
    colors[other_mask, 0] = (t * 255).astype(np.uint8)
    colors[other_mask, 1] = ((1 - t) * 255).astype(np.uint8)
    colors[other_mask, 2] = 0

    return colors


def _estimate_scales(
    positions: np.ndarray,
    seed: int = 42,
) -> np.ndarray:
    """Estimate Gaussian scales from local point density.

    Uses K-nearest neighbor distances to estimate the spacing
    between points, which determines the Gaussian scale.

    Args:
        positions: [N, 3] point positions.
        seed: Random seed for deterministic subsampling.

    Returns:
        scales: [N, 3] float32 — log scale values
    """
    from scipy.spatial import cKDTree

    rng = np.random.RandomState(seed)
    n_points = len(positions)

    # Subsample for KNN if too many points
    if n_points > 50000:
        sample_idx = rng.choice(n_points, 50000, replace=False)
        sample_positions = positions[sample_idx]
    else:
        sample_positions = positions

    # Build KDTree
    tree = cKDTree(sample_positions)

    # Query 6 nearest neighbors (including self)
    k = min(6, n_points)
    distances, _ = tree.query(sample_positions, k=k)

    # Average distance to neighbors (excluding self)
    avg_dist = distances[:, 1:].mean(axis=1)

    if n_points > 50000:
        # Map back to full point cloud using nearest sample
        full_tree = cKDTree(sample_positions)
        _, nearest = full_tree.query(positions)
        avg_dist_full = avg_dist[nearest]
    else:
        avg_dist_full = avg_dist

    # Scale = average distance / 2 (Gaussian sigma)
    scale_val = avg_dist_full / 2.0

    # Clamp to reasonable range
    scale_val = np.clip(scale_val, 0.001, 0.5)

    # Isotropic scale (same in all directions)
    # Log scale for .splat format
    log_scale = np.log(scale_val + 1e-8).astype(np.float32)
    scales = np.stack([log_scale, log_scale, log_scale], axis=-1)  # [N, 3]

    logger.info(f"Estimated scales: mean={scale_val.mean():.4f}, std={scale_val.std():.4f}")

    return scales


def _estimate_rotations(
    predictions: dict[str, np.ndarray],
    mask: np.ndarray,
) -> np.ndarray:
    """Estimate Gaussian rotations from surface normals.

    Currently uses identity rotation (aligned with axes) as a placeholder.
    TODO: Improve quality by computing surface normals from the point cloud
    and aligning each Gaussian's z-axis to the estimated normal direction.
    This requires estimating local tangent planes via PCA or similar methods
    on the point cloud neighborhood.

    Returns:
        rotations: [N, 4] uint8 — normalized quaternion as bytes
    """
    total_masked = mask.sum()

    # Identity quaternion: (0, 0, 0, 1) → normalized to bytes
    # quaternion w=1, x=0, y=0, z=0 → uint8 bytes
    rotations = np.zeros((total_masked, 4), dtype=np.uint8)
    rotations[:, 0] = 0   # x = 0
    rotations[:, 1] = 0   # y = 0
    rotations[:, 2] = 0   # z = 0
    rotations[:, 3] = 255  # w = 1.0 → 255

    return rotations


def _estimate_opacities(confidences: np.ndarray) -> np.ndarray:
    """Convert confidence values to opacity bytes.

    Higher confidence → higher opacity.

    Returns:
        opacities: [N] uint8 — opacity values [0, 255]
    """
    # Scale confidence [0, 1] → opacity [0, 255]
    # Apply a soft minimum opacity so points don't disappear entirely
    opacity_float = np.clip(confidences * 255, 30, 255)
    return opacity_float.astype(np.uint8)


def _smart_subsample(
    positions: np.ndarray,
    max_gaussians: int,
    seed: int = 42,
) -> np.ndarray:
    """Subsample points using voxel grid + random sampling.

    Uses a seeded RNG for deterministic, reproducible results.

    This preserves spatial coverage better than pure random sampling.

    Args:
        positions: [N, 3] point positions.
        max_gaussians: Maximum number of points to select.
        seed: Random seed for deterministic sampling.

    Returns:
        indices: [max_gaussians] int array of selected point indices
    """
    rng = np.random.RandomState(seed)
    n_points = len(positions)

    if n_points <= max_gaussians:
        return np.arange(n_points)

    # Step 1: Voxel grid subsampling for uniform coverage
    voxel_size = config.voxel_downsample_size

    # Compute voxel indices
    voxel_indices = np.floor(positions / voxel_size).astype(np.int32)

    # Create voxel keys
    voxel_keys = (
        voxel_indices[:, 0].astype(np.int64) * 1000000 ** 2
        + voxel_indices[:, 1].astype(np.int64) * 1000000
        + voxel_indices[:, 2].astype(np.int64)
    )

    # Select one point per voxel
    _, unique_indices = np.unique(voxel_keys, return_index=True)

    if len(unique_indices) <= max_gaussians:
        # Voxel subsampling is enough — fill remaining with random
        remaining = max_gaussians - len(unique_indices)
        if remaining > 0:
            pool = np.setdiff1d(np.arange(n_points), unique_indices)
            if len(pool) > 0:
                extra = rng.choice(pool, min(remaining, len(pool)), replace=False)
                return np.concatenate([unique_indices, extra])
        return unique_indices

    # Step 2: Too many voxels — randomly sample from voxel representatives
    return rng.choice(unique_indices, max_gaussians, replace=False)


def _write_splat_file(
    output_path: str,
    positions: np.ndarray,  # [N, 3] float32
    scales: np.ndarray,  # [N, 3] float32
    rotations: np.ndarray,  # [N, 4] uint8
    colors: np.ndarray,  # [N, 3] uint8
    opacities: np.ndarray,  # [N] uint8
) -> None:
    """Write the .splat binary file using numpy for performance.

    Format per Gaussian (32 bytes):
        position:   3×float32 (12 bytes)
        scale:      3×float32 (12 bytes)
        rotation:   4×uint8   (4 bytes)
        color:      3×uint8   (3 bytes)
        opacity:    1×uint8   (1 byte)
    """
    n_gaussians = len(positions)

    # Validate input shapes
    assert positions.shape == (n_gaussians, 3), f"positions shape: {positions.shape}"
    assert scales.shape == (n_gaussians, 3), f"scales shape: {scales.shape}"
    assert rotations.shape == (n_gaussians, 4), f"rotations shape: {rotations.shape}"
    assert colors.shape == (n_gaussians, 3), f"colors shape: {colors.shape}"
    assert opacities.shape == (n_gaussians,), f"opacities shape: {opacities.shape}"

    # Ensure correct dtypes
    positions = np.ascontiguousarray(positions, dtype=np.float32)
    scales = np.ascontiguousarray(scales, dtype=np.float32)
    rotations = np.ascontiguousarray(rotations, dtype=np.uint8)
    colors = np.ascontiguousarray(colors, dtype=np.uint8)
    opacities = np.ascontiguousarray(opacities, dtype=np.uint8)

    # ── Build binary buffer using numpy (fast, no Python loop) ──
    # Pre-allocate output buffer: N gaussians × 32 bytes each
    output = np.empty((n_gaussians, BYTES_PER_GAUSSIAN), dtype=np.uint8)

    # Write float data into first 24 bytes of each row (6 × float32)
    # positions: [N, 3] float32 + scales: [N, 3] float32 → [N, 6] float32
    float_data = np.column_stack([positions, scales])  # [N, 6] float32
    output[:, :24].view(np.float32)[:, :6] = float_data

    # Write byte data into last 8 bytes of each row
    # rotations: [N, 4] uint8 + colors: [N, 3] uint8 + opacities: [N] uint8
    byte_data = np.column_stack([
        rotations, colors, opacities.reshape(-1, 1),
    ])  # [N, 8] uint8
    output[:, 24:32] = byte_data

    # Write to file
    with open(output_path, "wb") as f:
        f.write(output.tobytes())

    # Verify file size
    actual_size = os.path.getsize(output_path)
    expected_size = n_gaussians * BYTES_PER_GAUSSIAN
    assert actual_size == expected_size, (
        f"File size mismatch: {actual_size} != {expected_size}"
    )

    logger.info(
        f"Wrote .splat file: {n_gaussians} gaussians × {BYTES_PER_GAUSSIAN} bytes "
        f"= {actual_size:,} bytes"
    )


def _generate_point_cloud_thumbnail(
    predictions_path: str,
    output_path: str,
) -> Optional[str]:
    """Generate a simple thumbnail from the point cloud using OpenCV.

    Creates a top-down orthographic view of the point cloud.
    """
    predictions = _load_predictions(predictions_path)
    if predictions is None:
        return None

    try:
        import cv2
    except ImportError:
        return None

    world_points = predictions["world_points"]  # [B, S, H, W, 3]
    points = world_points[0].reshape(-1, 3).astype(np.float32)

    # Remove NaN/Inf
    valid = np.isfinite(points).all(axis=1)
    points = points[valid]

    if len(points) == 0:
        return None

    # Sample for performance (deterministic)
    rng = np.random.RandomState(abs(hash(predictions_path)) % (2**32))
    if len(points) > 100000:
        idx = rng.choice(len(points), 100000, replace=False)
        points = points[idx]

    # Top-down view (XZ plane)
    x = points[:, 0]
    z = points[:, 2]

    # Normalize to image coordinates
    x_min, x_max = x.min(), x.max()
    z_min, z_max = z.min(), z.max()

    img_size = 512
    margin = 20

    x_norm = (x - x_min) / (x_max - x_min + 1e-8)
    z_norm = (z - z_min) / (z_max - z_min + 1e-8)

    # Map to image (Z → Y axis, inverted for image coordinates)
    img_x = (x_norm * (img_size - 2 * margin) + margin).astype(int)
    img_y = ((1 - z_norm) * (img_size - 2 * margin) + margin).astype(int)

    # Create image
    img = np.ones((img_size, img_size, 3), dtype=np.uint8) * 240  # Light gray background

    # Draw points with height-based coloring
    y = points[:, 1]
    y_min, y_max = y.min(), y.max()
    y_norm = (y - y_min) / (y_max - y_min + 1e-8)

    for i in range(len(img_x)):
        if 0 <= img_x[i] < img_size and 0 <= img_y[i] < img_size:
            # Color: blue (low) → green (mid) → red (high)
            t = y_norm[i]
            if t < 0.5:
                r, g, b = 0, int(t * 2 * 255), int((1 - t * 2) * 255)
            else:
                r, g, b = int((t - 0.5) * 2 * 255), int((1 - (t - 0.5) * 2) * 255), 0
            img[img_y[i], img_x[i]] = [b, g, r]  # BGR

    # Add title text
    cv2.putText(
        img, "Top-Down View",
        (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (100, 100, 100), 2,
    )

    cv2.imwrite(output_path, img)
    return output_path
