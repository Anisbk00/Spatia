"""
LingBot-Map Worker — LingBot Adapter
======================================
Wraps LingBot-Map inference with proper configuration for indoor property scanning.

Supports two modes:
1. **Real mode**: Loads the actual LingBot-Map model and runs GPU inference.
2. **Simulation mode**: Generates synthetic predictions for development/testing
   when LingBot-Map is not installed or GPU is unavailable.

LingBot-Map Python API:
    from lingbot_map.models.gct_stream import GCTStream

    model = GCTStream(img_size=518, patch_size=14, enable_3d_rope=True)
    state_dict = torch.load("model.pt", weights_only=False)
    model.load_state_dict(state_dict["model"], strict=False)
    model.eval().cuda()

    predictions = model.inference_streaming(
        images,  # [S, 3, H, W] in [0, 1]
        num_scale_frames=8,
        keyframe_interval=2,
        output_device=torch.device("cpu"),
    )
"""

from __future__ import annotations

import glob
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

import numpy as np

from config import config
from schemas import LingBotPredictions

logger = logging.getLogger(__name__)

# ── LingBot-Map Availability Check ───────────────────────────────────────

_lingbot_available: Optional[bool] = None
_torch_available: Optional[bool] = None


def is_torch_available() -> bool:
    """Check if PyTorch is installed."""
    global _torch_available
    if _torch_available is None:
        try:
            import torch  # noqa: F401
            _torch_available = True
        except ImportError:
            _torch_available = False
    return _torch_available


def is_lingbot_available() -> bool:
    """Check if LingBot-Map is installed and the model weights exist."""
    global _lingbot_available
    if _lingbot_available is None:
        try:
            from lingbot_map.models.gct_stream import GCTStream  # noqa: F401
            model_exists = os.path.isfile(config.lingbot_model_path)
            _lingbot_available = model_exists
            if not model_exists:
                logger.warning(
                    f"LingBot-Map module found but model weights not at: "
                    f"{config.lingbot_model_path}"
                )
        except ImportError:
            _lingbot_available = False
            logger.info("LingBot-Map module not installed — using simulation mode")
    return _lingbot_available


def is_gpu_available() -> bool:
    """Check if CUDA GPU is available."""
    if not is_torch_available():
        return False
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


# ── Model Singleton ──────────────────────────────────────────────────────

_model = None


def _get_model() -> Any:
    """Get or load the LingBot-Map model singleton."""
    global _model

    if _model is not None:
        return _model

    if not is_lingbot_available():
        raise RuntimeError("LingBot-Map is not available — cannot load model")

    import torch
    from lingbot_map.models.gct_stream import GCTStream

    logger.info(f"Loading LingBot-Map model from {config.lingbot_model_path}...")

    model = GCTStream(
        img_size=config.lingbot_image_size,
        patch_size=config.lingbot_patch_size,
        enable_3d_rope=True,
    )

    state_dict = torch.load(config.lingbot_model_path, weights_only=False)
    model.load_state_dict(state_dict["model"], strict=False)
    model.eval()

    if is_gpu_available():
        model = model.cuda()
        logger.info("LingBot-Map model loaded on GPU")
    else:
        logger.warning("No GPU available — running on CPU (will be very slow)")

    _model = model
    return _model


def unload_model() -> None:
    """Unload the model from memory to free GPU VRAM."""
    global _model
    if _model is not None and is_torch_available():
        import torch
        del _model
        _model = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        logger.info("LingBot-Map model unloaded, GPU cache cleared")


# ── Public API ───────────────────────────────────────────────────────────


def run_inference(
    frames_dir: str,
    output_dir: Optional[str] = None,
) -> LingBotPredictions:
    """Run LingBot-Map inference on a directory of frames.

    Automatically selects real or simulation mode based on availability.

    Args:
        frames_dir: Directory containing extracted frames (JPEG/PNG).
        output_dir: Directory to save raw predictions. If None, uses temp dir.

    Returns:
        LingBotPredictions with all output tensors.

    Raises:
        RuntimeError: If inference fails in real mode.
        FileNotFoundError: If no frames are found.
    """
    # Validate frames
    frame_paths = _discover_frames(frames_dir)
    if len(frame_paths) == 0:
        raise FileNotFoundError(f"No frames found in {frames_dir}")

    logger.info(f"Running LingBot-Map inference on {len(frame_paths)} frames")

    # Create output directory
    if output_dir is None:
        output_dir = tempfile.mkdtemp(prefix="lingbot-output-")
    os.makedirs(output_dir, exist_ok=True)

    # Determine mode
    use_real = is_lingbot_available() and (is_gpu_available() or not config.simulation_mode)

    if use_real:
        logger.info("Running in REAL inference mode")
        predictions = _run_real_inference(frame_paths, output_dir)
    else:
        logger.info("Running in SIMULATION mode (LingBot-Map not available)")
        predictions = _run_simulated_inference(frame_paths, output_dir)

    # Save predictions to disk
    _save_predictions(predictions, output_dir)

    return predictions


def run_inference_from_images(
    images: Any,  # torch.Tensor [S, 3, H, W] in [0, 1]
    output_dir: Optional[str] = None,
) -> LingBotPredictions:
    """Run LingBot-Map inference from pre-loaded image tensors.

    This is the direct Python API — frames are already loaded and preprocessed.

    Args:
        images: Image tensor [S, 3, H, W] in range [0, 1].
        output_dir: Directory to save raw predictions.

    Returns:
        LingBotPredictions with all output tensors.
    """
    if output_dir is None:
        output_dir = tempfile.mkdtemp(prefix="lingbot-output-")
    os.makedirs(output_dir, exist_ok=True)

    use_real = is_lingbot_available() and (is_gpu_available() or not config.simulation_mode)

    if use_real:
        logger.info("Running REAL inference from pre-loaded images")
        predictions = _run_real_inference_from_images(images, output_dir)
    else:
        logger.info("Running SIMULATION from pre-loaded images")
        predictions = _run_simulated_inference_from_tensors(images, output_dir)

    _save_predictions(predictions, output_dir)
    return predictions


# ── Real Inference ───────────────────────────────────────────────────────


def _run_real_inference(frame_paths: list[str], output_dir: str) -> LingBotPredictions:
    """Run actual LingBot-Map inference on frames."""
    import torch

    # Load and preprocess images
    images = _load_frames_as_tensors(frame_paths)

    return _run_real_inference_from_images(images, output_dir)


def _run_real_inference_from_images(
    images: Any,  # torch.Tensor [S, 3, H, W]
    output_dir: str,
) -> LingBotPredictions:
    """Run actual LingBot-Map inference from image tensors."""
    import torch

    model = _get_model()

    # Add batch dimension if needed: [S, 3, H, W] → [1, S, 3, H, W]
    if images.dim() == 4:
        images = images.unsqueeze(0)

    # Move to GPU
    if torch.cuda.is_available():
        images = images.cuda()

    logger.info(
        f"Starting LingBot-Map streaming inference: "
        f"batch={images.shape[0]}, frames={images.shape[1]}, "
        f"size={images.shape[3]}x{images.shape[2]}"
    )

    start_time = time.time()

    with torch.no_grad():
        predictions = model.inference_streaming(
            images,
            num_scale_frames=config.lingbot_num_scale_frames,
            keyframe_interval=config.lingbot_keyframe_interval,
            output_device=torch.device("cpu"),
        )

    elapsed = time.time() - start_time
    logger.info(f"LingBot-Map inference completed in {elapsed:.1f}s")

    # Wrap in typed container
    return LingBotPredictions(
        pose_enc=predictions["pose_enc"],
        depth=predictions["depth"],
        depth_conf=predictions["depth_conf"],
        world_points=predictions["world_points"],
        world_points_conf=predictions["world_points_conf"],
        extrinsic=predictions["extrinsic"],
        intrinsic=predictions["intrinsic"],
    )


# ── Simulation Mode ──────────────────────────────────────────────────────


def _run_simulated_inference(
    frame_paths: list[str],
    output_dir: str,
) -> LingBotPredictions:
    """Generate synthetic predictions for development/testing.

    Creates plausible-looking camera trajectory and depth maps based on
    the number of frames and configured image size.
    """
    import torch

    num_frames = len(frame_paths)

    # Read first frame to get dimensions
    first_frame = _read_frame_for_size(frame_paths[0])
    h, w = first_frame[:2]

    logger.info(
        f"Simulating LingBot-Map output: {num_frames} frames, {w}x{h}"
    )

    return _generate_simulated_predictions(num_frames, h, w)


def _run_simulated_inference_from_tensors(
    images: Any,
    output_dir: str,
) -> LingBotPredictions:
    """Generate synthetic predictions from pre-loaded tensors."""
    # images shape: [S, 3, H, W] or [B, S, 3, H, W]
    if images.dim() == 5:
        _, num_frames, _, h, w = images.shape
    elif images.dim() == 4:
        num_frames, _, h, w = images.shape
    else:
        raise ValueError(f"Unexpected image tensor shape: {images.shape}")

    return _generate_simulated_predictions(num_frames, h, w)


def _generate_simulated_predictions(
    num_frames: int,
    height: int,
    width: int,
) -> LingBotPredictions:
    """Generate realistic-looking synthetic LingBot-Map predictions.

    Simulates an indoor scanning trajectory with:
    - Circular camera path (walking around a room)
    - Depth maps with wall/floor geometry
    - 3D world points derived from depth + camera poses
    """
    import torch

    B = 1
    S = num_frames
    H = height
    W = width

    logger.info(f"Generating simulated predictions: B={B}, S={S}, H={H}, W={W}")

    # ── Camera trajectory: circular path around a room center ──
    t = torch.linspace(0, 2 * np.pi, S)

    # Camera center positions (circular path, 2m radius, 1.5m height)
    cx = 2.0 * torch.cos(t)
    cy = 1.5 * torch.ones(S)  # Camera height
    cz = 2.0 * torch.sin(t)

    # Look-at direction (toward center)
    look_x = -cx
    look_y = -0.3 * torch.ones(S)  # Slight downward look
    look_z = -cz

    # FOV: typical indoor camera (~70 degrees horizontal)
    fov = torch.ones(S) * 1.22  # ~70 degrees in radians

    # Quaternion from look direction
    qw, qx, qy, qz = _look_direction_to_quaternion(look_x, look_y, look_z)

    pose_enc = torch.stack([cx, cy, cz, qx, qy, qz, qw, fov[:, 0] if fov.dim() > 1 else fov, fov[:, 0] if fov.dim() > 1 else fov], dim=-1)
    pose_enc = pose_enc.unsqueeze(0)  # [1, S, 9]

    # ── Depth maps: synthetic room geometry ──
    # Create a depth map with wall/floor/ceiling pattern
    depth = torch.ones(B, S, H, W, 1)
    depth_conf = torch.ones(B, S, H, W) * 0.9

    # Distance to walls varies with camera position
    for i in range(S):
        dist = torch.sqrt(cx[i] ** 2 + cz[i] ** 2)
        room_radius = 5.0  # 5m room
        wall_dist = room_radius - dist

        # Depth gradient: closer at edges, farther at center
        y_coords = torch.linspace(0, 1, H)
        x_coords = torch.linspace(0, 1, W)
        yy, xx = torch.meshgrid(y_coords, x_coords, indexing="ij")

        # Base distance to walls
        frame_depth = wall_dist * torch.ones(H, W)

        # Floor plane (bottom of image is closer)
        floor_mask = yy > 0.6
        frame_depth[floor_mask] = frame_depth[floor_mask] * 0.8

        # Ceiling plane (top of image)
        ceiling_mask = yy < 0.3
        frame_depth[ceiling_mask] = frame_depth[ceiling_mask] * 0.9

        # Add some noise for realism
        noise = torch.randn(H, W) * 0.05
        frame_depth = torch.clamp(frame_depth + noise, 0.5, 10.0)

        depth[0, i, :, :, 0] = frame_depth
        depth_conf[0, i, :, :] = 0.85 + 0.1 * torch.rand(H, W)

    # ── World points from depth + camera extrinsic ──
    # Create camera intrinsics (pinhole model)
    focal_length = W / (2 * torch.tan(fov[0] / 2))
    intrinsic = torch.zeros(B, S, 3, 3)
    for i in range(S):
        f = W / (2 * torch.tan(fov[i] / 2))
        intrinsic[0, i] = torch.tensor([
            [f, 0, W / 2],
            [0, f, H / 2],
            [0, 0, 1],
        ], dtype=torch.float32)

    # Build extrinsics from pose encoding
    extrinsic = torch.zeros(B, S, 3, 4)
    for i in range(S):
        R = _quaternion_to_rotation_matrix(qx[i], qy[i], qz[i], qw[i])
        t_vec = torch.tensor([cx[i], cy[i], cz[i]])
        extrinsic[0, i, :3, :3] = R
        extrinsic[0, i, :3, 3] = t_vec

    # Compute world points by unprojecting depth
    world_points = torch.zeros(B, S, H, W, 3)
    world_points_conf = depth_conf.clone()

    for i in range(S):
        # Unproject each pixel
        u_coords = torch.arange(W, dtype=torch.float32)
        v_coords = torch.arange(H, dtype=torch.float32)
        vv, uu = torch.meshgrid(v_coords, u_coords, indexing="ij")

        f = intrinsic[0, i, 0, 0]
        cu = intrinsic[0, i, 0, 2]
        cv = intrinsic[0, i, 1, 2]

        # Pixel to camera coordinates
        x_cam = (uu - cu) * depth[0, i, :, :, 0] / f
        y_cam = (vv - cv) * depth[0, i, :, :, 0] / f
        z_cam = depth[0, i, :, :, 0]

        # Camera to world
        R = extrinsic[0, i, :3, :3]
        t_vec = extrinsic[0, i, :3, 3]

        cam_coords = torch.stack([x_cam, y_cam, z_cam], dim=-1)  # [H, W, 3]
        world_coords = torch.einsum("ij,hwj->hwi", R, cam_coords) + t_vec

        world_points[0, i] = world_coords

    # Simulate processing time
    time.sleep(0.5)

    logger.info(f"Simulated predictions generated: {num_frames} frames")

    return LingBotPredictions(
        pose_enc=pose_enc,
        depth=depth,
        depth_conf=depth_conf,
        world_points=world_points,
        world_points_conf=world_points_conf,
        extrinsic=extrinsic,
        intrinsic=intrinsic,
    )


# ── Frame Loading ────────────────────────────────────────────────────────


def _discover_frames(frames_dir: str) -> list[str]:
    """Find all frame images in a directory, sorted by filename."""
    extensions = ("*.jpg", "*.jpeg", "*.png", "*.bmp", "*.tif", "*.tiff")
    all_paths: list[str] = []

    for ext in extensions:
        all_paths.extend(glob.glob(os.path.join(frames_dir, ext)))
        # Also check uppercase
        all_paths.extend(glob.glob(os.path.join(frames_dir, ext.upper())))

    return sorted(set(all_paths))


def _read_frame_for_size(frame_path: str) -> tuple[int, int]:
    """Read a frame just to get its dimensions, using OpenCV or PIL."""
    try:
        import cv2
        img = cv2.imread(frame_path)
        if img is not None:
            return img.shape[0], img.shape[1]  # h, w
    except ImportError:
        pass

    try:
        from PIL import Image
        with Image.open(frame_path) as img:
            return img.height, img.width
    except ImportError:
        pass

    # Default to config image size
    return config.lingbot_image_size, config.lingbot_image_size


def _load_frames_as_tensors(frame_paths: list[str]) -> Any:
    """Load frames from disk into a tensor [S, 3, H, W] in [0, 1].

    Uses OpenCV for reading, then converts to torch tensor.
    """
    import torch

    tensors: list[torch.Tensor] = []

    for path in frame_paths:
        try:
            import cv2
            img = cv2.imread(path)
            if img is None:
                logger.warning(f"Could not read frame: {path}")
                continue

            # BGR → RGB
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

            # Resize for model
            from frame_extractor import _resize_for_model
            img = _resize_for_model(img, config.lingbot_image_size)

            # To float tensor [3, H, W] in [0, 1]
            tensor = torch.from_numpy(img).permute(2, 0, 1).float() / 255.0
            tensors.append(tensor)

        except Exception as e:
            logger.warning(f"Failed to load frame {path}: {e}")
            continue

    if len(tensors) == 0:
        raise RuntimeError("No frames could be loaded")

    # Stack into [S, 3, H, W]
    return torch.stack(tensors, dim=0)


# ── Prediction Persistence ───────────────────────────────────────────────


def _save_predictions(predictions: LingBotPredictions, output_dir: str) -> str:
    """Save predictions to disk as .npz file.

    Returns the path to the saved file.
    """
    np_dict = predictions.to_numpy()
    output_path = os.path.join(output_dir, "predictions.npz")
    np.savez_compressed(output_path, **np_dict)
    logger.info(f"Saved predictions to {output_path}")
    return output_path


def load_predictions_from_npz(npz_path: str) -> dict[str, np.ndarray]:
    """Load predictions from a .npz file."""
    data = np.load(npz_path, allow_pickle=False)
    return dict(data)


# ── Geometry Helpers ─────────────────────────────────────────────────────


def _look_direction_to_quaternion(
    lx: Any,
    ly: Any,
    lz: Any,
) -> tuple:
    """Convert look direction vectors to quaternions (w, x, y, z).

    Assumes up vector is (0, 1, 0).
    """
    import torch

    # Normalize look direction
    look = torch.stack([lx, ly, lz], dim=-1)
    look = look / (look.norm(dim=-1, keepdim=True) + 1e-8)

    # Forward vector (negative Z in camera space)
    forward = -look

    # Right vector
    up = torch.tensor([0.0, 1.0, 0.0])
    right = torch.cross(forward, up.expand_as(forward), dim=-1)
    right = right / (right.norm(dim=-1, keepdim=True) + 1e-8)

    # Recalculate up
    up_corrected = torch.cross(right, forward, dim=-1)

    # Build rotation matrix
    R = torch.stack([right, up_corrected, -forward], dim=-1)

    # Rotation matrix to quaternion
    qw, qx, qy, qz = _rotation_matrix_to_quaternion(R)

    return qw, qx, qy, qz


def _rotation_matrix_to_quaternion(R: Any) -> tuple:
    """Convert rotation matrices to quaternions.

    R: [..., 3, 3] rotation matrices
    Returns: (qw, qx, qy, qz) each of shape [...]
    """
    import torch

    trace = R[..., 0, 0] + R[..., 1, 1] + R[..., 2, 2]

    qw = torch.sqrt(torch.clamp(1.0 + trace, min=1e-10)) / 2.0
    qx = (R[..., 2, 1] - R[..., 1, 2]) / (4.0 * qw + 1e-8)
    qy = (R[..., 0, 2] - R[..., 2, 0]) / (4.0 * qw + 1e-8)
    qz = (R[..., 1, 0] - R[..., 0, 1]) / (4.0 * qw + 1e-8)

    # Normalize
    norm = torch.sqrt(qw ** 2 + qx ** 2 + qy ** 2 + qz ** 2 + 1e-8)
    qw = qw / norm
    qx = qx / norm
    qy = qy / norm
    qz = qz / norm

    return qw, qx, qy, qz


def _quaternion_to_rotation_matrix(qx: Any, qy: Any, qz: Any, qw: Any) -> Any:
    """Convert quaternion to 3x3 rotation matrix.

    Args:
        qx, qy, qz, qw: Quaternion components (scalar last convention).

    Returns:
        3x3 rotation matrix.
    """
    import torch

    R = torch.zeros(3, 3)

    R[0, 0] = 1 - 2 * (qy ** 2 + qz ** 2)
    R[0, 1] = 2 * (qx * qy - qz * qw)
    R[0, 2] = 2 * (qx * qz + qy * qw)
    R[1, 0] = 2 * (qx * qy + qz * qw)
    R[1, 1] = 1 - 2 * (qx ** 2 + qz ** 2)
    R[1, 2] = 2 * (qy * qz - qx * qw)
    R[2, 0] = 2 * (qx * qz - qy * qw)
    R[2, 1] = 2 * (qy * qz + qx * qw)
    R[2, 2] = 1 - 2 * (qx ** 2 + qy ** 2)

    return R
