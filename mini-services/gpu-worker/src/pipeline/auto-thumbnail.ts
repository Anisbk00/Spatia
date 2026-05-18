// ============================================
// Stage 9: Auto Thumbnail Generation
// ============================================
// Selects the optimal thumbnail viewpoint based
// on actual camera poses and detected rooms.
//
// Scores each candidate viewpoint using position
// heuristics (eye-level height, moderate FOV,
// facing the largest room) to pick the best angle.
//
// Audit fixes applied:
//   - SIMULATED mode support
// ============================================

import type { PipelineContext, PipelineStageResult } from "./stages";
import { SIMULATED } from "../types";

export async function runAutoThumbnail(
  ctx: PipelineContext
): Promise<PipelineStageResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  logs.push(`[${new Date().toISOString()}] Starting auto thumbnail generation`);
  logs.push(`[${new Date().toISOString()}] Mode: ${SIMULATED ? "simulated" : "real"}`);

  let cameraPoses: Array<{ position: number[]; fov: number }>;
  try {
    cameraPoses = JSON.parse(ctx.artifacts.camera_poses || "[]");
  } catch {
    cameraPoses = [];
  }

  let detectedRooms: Array<{ bounds: { min: number[]; max: number[] }; estimated_area_sqm?: number }>;
  try {
    detectedRooms = JSON.parse(ctx.artifacts.detected_rooms || "[]");
  } catch {
    detectedRooms = [];
  }

  // Select the best camera angle for the thumbnail
  // In production: render the scene from multiple viewpoints and score them
  const candidates = Math.min(6, cameraPoses.length);

  // Score each viewpoint based on:
  // 1. Center of scene (higher score)
  // 2. Height (eye level preferred: 1.2-1.7m)
  // 3. Looking at the largest room
  let bestAngle = 0;
  let bestScore = 0;

  for (let i = 0; i < candidates; i++) {
    const pose = cameraPoses[i];
    if (!pose) continue;

    let score = 0;

    // Prefer eye-level height
    const heightDiff = Math.abs(pose.position[1] - 1.5);
    score += Math.max(0, 1 - heightDiff);

    // Prefer moderate FOV (not too wide, not too narrow)
    if (pose.fov >= 60 && pose.fov <= 80) score += 0.5;

    // Prefer positions that face the center of the largest room
    if (detectedRooms.length > 0) {
      const largestRoom = detectedRooms.reduce(
        (max, r) => ((r.estimated_area_sqm ?? 0) > (max.estimated_area_sqm ?? 0) ? r : max),
        detectedRooms[0]
      );
      if (largestRoom) {
        const roomCenterX = (largestRoom.bounds.min[0] + largestRoom.bounds.max[0]) / 2;
        const roomCenterZ = (largestRoom.bounds.min[2] + largestRoom.bounds.max[2]) / 2;
        const dist = Math.sqrt(
          (pose.position[0] - roomCenterX) ** 2 +
          (pose.position[2] - roomCenterZ) ** 2
        );
        score += Math.max(0, 1 - dist / 10);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestAngle = i;
    }
  }

  const selectedPose = cameraPoses[bestAngle] || cameraPoses[0];
  const thumbnailAngle = bestAngle;

  logs.push(`[${new Date().toISOString()}] Evaluated ${candidates} candidate viewpoints`);
  logs.push(`[${new Date().toISOString()}] Selected viewpoint ${thumbnailAngle + 1} (score: ${bestScore.toFixed(2)})`);
  logs.push(`[${new Date().toISOString()}] Thumbnail position: [${selectedPose?.position?.map((v: number) => v.toFixed(1)).join(", ")}]`);
  logs.push(`[${new Date().toISOString()}] Auto thumbnail generation complete`);

  return {
    status: "completed",
    durationMs: Date.now() - startTime,
    artifacts: {
      auto_thumbnail_angle: String(thumbnailAngle),
      auto_thumbnail_score: bestScore.toFixed(2),
      auto_thumbnail_position: JSON.stringify(selectedPose?.position || [0, 1.5, 0]),
    },
    logs: logs.join("\n"),
  };
}
