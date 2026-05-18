// ============================================
// Progressive Scene Streaming System
// ============================================
// Utility helpers for future progressive scene streaming implementation.
//
// NOTE(MI4): The exported functions below (calculateChunkLayout,
// getOptimalLoadOrder, estimateBandwidthRequirements) and their
// supporting types (SceneChunk, ViewerPosition) are not yet consumed
// by any runtime code path. They are intentionally kept here as
// reference implementations that will be wired into the streaming
// pipeline once the Web Worker / chunk-fetch layer is in place.
// ============================================

import type { SceneStreamingConfig } from "@/lib/types";

// ============================================
// Types
// ============================================

/**
 * Scene chunk definition for streaming.
 * Each chunk represents a portion of the scene at a specific LOD level.
 */
export interface SceneChunk {
  level: number;        // LOD level (0=lowest)
  offset: number;       // byte offset in file
  size: number;         // chunk size in bytes
  priority: number;     // load priority (0=highest)
}

/**
 * Viewer position in spherical coordinates for view-dependent loading.
 */
export interface ViewerPosition {
  theta: number;   // horizontal angle in radians
  phi: number;     // vertical angle in radians
  distance: number; // distance from center
}

// ============================================
// Chunk layout calculation
// ============================================

/**
 * Calculate chunk layout for progressive streaming.
 *
 * Divides the scene file into chunks organized by LOD levels.
 * Lower LOD levels (smaller, coarser) are loaded first with higher priority,
 * while higher LOD levels are loaded progressively as bandwidth allows.
 *
 * @param fileSizeBytes - Total size of the scene file in bytes
 * @param config - Streaming configuration specifying LOD levels and chunk sizes
 * @returns Array of SceneChunks organized for progressive loading
 */
export function calculateChunkLayout(
  fileSizeBytes: number,
  config: SceneStreamingConfig,
): SceneChunk[] {
  if (fileSizeBytes <= 0) return [];

  const chunks: SceneChunk[] = [];
  const chunkSizeBytes = config.chunk_size_kb * 1024;

  // LOD size distribution — lower LODs are smaller fractions of the total
  // LOD 0: 10%, LOD 1: 25%, LOD 2: 65% (for 3 levels)
  const lodSizeFractions = getLODSizeFractions(config.lod_levels);

  let currentOffset = 0;

  for (let level = 0; level < config.lod_levels; level++) {
    const levelSizeBytes = Math.round(fileSizeBytes * lodSizeFractions[level]);
    const numChunks = Math.max(1, Math.ceil(levelSizeBytes / chunkSizeBytes));

    for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
      const chunkOffset = currentOffset + chunkIndex * chunkSizeBytes;
      const isLastChunk = chunkIndex === numChunks - 1;
      const chunkSize = isLastChunk
        ? levelSizeBytes - chunkIndex * chunkSizeBytes
        : chunkSizeBytes;

      if (chunkSize <= 0) continue;

      chunks.push({
        level,
        offset: chunkOffset,
        size: chunkSize,
        // Priority: lower LOD levels load first, within a level earlier chunks first
        priority: level * 100 + chunkIndex,
      });
    }

    currentOffset += levelSizeBytes;
  }

  return chunks;
}

/**
 * Get size fractions for each LOD level.
 *
 * Distributes the total file size across LOD levels with
 * increasing allocation for higher detail levels.
 *
 * @param levels - Number of LOD levels
 * @returns Array of fractions (sums to ~1.0)
 */
function getLODSizeFractions(levels: number): number[] {
  if (levels <= 0) return [1.0];
  if (levels === 1) return [1.0];
  if (levels === 2) return [0.2, 0.8];
  if (levels === 3) return [0.1, 0.25, 0.65];
  if (levels === 4) return [0.05, 0.15, 0.3, 0.5];

  // For 5+ levels, use exponential distribution
  const fractions: number[] = [];
  let totalWeight = 0;

  for (let i = 0; i < levels; i++) {
    const weight = Math.pow(2, i); // 1, 2, 4, 8, 16...
    fractions.push(weight);
    totalWeight += weight;
  }

  return fractions.map((f) => f / totalWeight);
}

// ============================================
// View-dependent load ordering
// ============================================

/**
 * Get the optimal load order for a scene based on viewer position.
 *
 * Reorders chunks to prioritize loading the portion of the scene
 * that the viewer is currently looking at. Chunks near the viewer's
 * gaze direction get higher priority (lower priority number).
 *
 * @param chunks - The pre-calculated scene chunks
 * @param viewerPosition - The current viewer position in spherical coordinates
 * @returns Reordered chunks optimized for the viewer's perspective
 */
export function getOptimalLoadOrder(
  chunks: SceneChunk[],
  viewerPosition: ViewerPosition,
): SceneChunk[] {
  if (chunks.length === 0) return [];

  // Create a copy to avoid mutating the original
  const sortedChunks = [...chunks];

  // Priority calculation based on viewer position:
  // 1. Always load lowest LOD first (level 0) — needed for immediate visual
  // 2. For higher LODs, bias toward chunks that correspond to the viewer's direction
  // 3. Distance affects detail level — closer viewer needs higher LOD sooner

  const { theta, phi, distance } = viewerPosition;

  // Normalize distance to a 0-1 scale (closer = 1, far = 0)
  const distanceFactor = Math.max(0, Math.min(1, 1 - (distance - 2) / 20));

  sortedChunks.sort((a, b) => {
    // Rule 1: Lowest LOD always first
    if (a.level !== b.level) {
      return a.level - b.level;
    }

    // Rule 2: Within the same LOD, use spatial locality
    // Chunks whose offset aligns with the viewer's direction get priority
    const maxOffset = chunks.reduce((max, c) => Math.max(max, c.offset + c.size), 0);
    if (maxOffset === 0) return a.priority - b.priority;

    // Estimate which angular sector each chunk belongs to
    const aAngularPos = (a.offset / maxOffset) * 2 * Math.PI;
    const bAngularPos = (b.offset / maxOffset) * 2 * Math.PI;

    // Distance from viewer's horizontal angle
    const aAngleDist = Math.abs(normalizeAngle(aAngularPos - theta));
    const bAngleDist = Math.abs(normalizeAngle(bAngularPos - theta));

    // Closer angular distance = higher priority (lower sort value)
    // Weight by distance factor — closer viewers benefit more from spatial ordering
    const aScore = aAngleDist * (1 - distanceFactor * 0.5);
    const bScore = bAngleDist * (1 - distanceFactor * 0.5);

    if (Math.abs(aScore - bScore) > 0.01) {
      return aScore - bScore;
    }

    // Rule 3: Fall back to original priority
    return a.priority - b.priority;
  });

  return sortedChunks;
}

/**
 * Normalize an angle to [-PI, PI] range.
 */
function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

// ============================================
// Bandwidth estimation
// ============================================

/**
 * Estimate bandwidth requirements for streaming.
 *
 * Calculates minimum and recommended bandwidth needed to
 * achieve a target load time for a scene with multiple LOD levels.
 *
 * @param sceneSizeBytes - Total size of the scene in bytes
 * @param targetLoadTimeMs - Desired total load time in milliseconds
 * @param lodLevels - Number of LOD levels for progressive loading
 * @returns Bandwidth requirements with minimum and recommended speeds
 */
export function estimateBandwidthRequirements(
  sceneSizeBytes: number,
  targetLoadTimeMs: number,
  lodLevels: number,
): { minBps: number; recommendedBps: number } {
  if (sceneSizeBytes <= 0 || targetLoadTimeMs <= 0) {
    return { minBps: 0, recommendedBps: 0 };
  }

  // For progressive loading, we only need to load the initial LOD
  // within the target time for a usable experience
  const lodSizeFractions = getLODSizeFractions(lodLevels);
  const initialLODBytes = sceneSizeBytes * lodSizeFractions[0];

  // Minimum bandwidth: load initial LOD within target time
  const targetTimeSeconds = targetLoadTimeMs / 1000;
  const minBps = Math.ceil((initialLODBytes * 8) / targetTimeSeconds);

  // Recommended bandwidth: load ALL LOD levels within target time
  // with 30% overhead for retransmissions and protocol overhead
  const totalBits = sceneSizeBytes * 8 * 1.3;
  const recommendedBps = Math.ceil(totalBits / targetTimeSeconds);

  return {
    minBps,
    recommendedBps,
  };
}
