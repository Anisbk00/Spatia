// ============================================
// Supabase Storage operations for scene output
// Enhanced with auto-thumbnail generation.
// ============================================

import { getSupabase } from "./db";

const SCENES_BUCKET = "scene-outputs";

/**
 * Upload a file to Supabase Storage.
 * Creates the bucket if it doesn't exist.
 * Returns an empty string if Supabase is not configured.
 */
export async function uploadToStorage(
  path: string,
  data: Blob | Buffer | string,
  contentType: string = "application/json"
): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) {
    console.error(`Cannot upload ${path}: Supabase is not configured`);
    return "";
  }

  // Ensure bucket exists
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some((b) => b.id === SCENES_BUCKET);

  if (!bucketExists) {
    await supabase.storage.createBucket(SCENES_BUCKET, {
      public: true,
      fileSizeLimit: 500 * 1024 * 1024, // 500MB
    });
  }

  const { error } = await supabase.storage
    .from(SCENES_BUCKET)
    .upload(path, data, {
      contentType,
      upsert: true,
    });

  if (error) {
    console.error(`Storage upload error (${path}):`, error);
    throw new Error(`Failed to upload ${path}: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from(SCENES_BUCKET)
    .getPublicUrl(path);

  return urlData.publicUrl;
}

/**
 * Generate a placeholder thumbnail image.
 * Returns a simple SVG-based image.
 */
export function generateThumbnail(): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect fill="#059669" width="400" height="300" rx="12"/>
  <text x="200" y="140" text-anchor="middle" fill="white" font-family="system-ui" font-size="48" font-weight="bold">3D</text>
  <text x="200" y="180" text-anchor="middle" fill="white" font-family="system-ui" font-size="18" opacity="0.8">Walkthrough Ready</text>
</svg>`;
  return Buffer.from(svg);
}

// ---- View angle definitions for auto-thumbnail ----

interface ViewAngle {
  name: string;
  theta: number;   // horizontal angle in radians
  phi: number;     // vertical angle in radians
  distance: number;
  fov: number;
}

const CANDIDATE_VIEW_ANGLES: ViewAngle[] = [
  { name: "front", theta: 0, phi: 0.3, distance: 4, fov: 70 },
  { name: "front-left", theta: Math.PI / 4, phi: 0.3, distance: 4, fov: 70 },
  { name: "left", theta: Math.PI / 2, phi: 0.3, distance: 4, fov: 70 },
  { name: "back-left", theta: (3 * Math.PI) / 4, phi: 0.3, distance: 4, fov: 70 },
  { name: "back", theta: Math.PI, phi: 0.3, distance: 4, fov: 70 },
  { name: "back-right", theta: (5 * Math.PI) / 4, phi: 0.3, distance: 4, fov: 70 },
  { name: "right", theta: (3 * Math.PI) / 2, phi: 0.3, distance: 4, fov: 70 },
  { name: "front-right", theta: (7 * Math.PI) / 4, phi: 0.3, distance: 4, fov: 70 },
  { name: "top", theta: 0, phi: 1.2, distance: 6, fov: 60 },
  { name: "corner-high", theta: Math.PI / 4, phi: 0.8, distance: 5, fov: 65 },
];

/**
 * Generate multiple candidate thumbnails with different
 * view angles. Returns SVG thumbnails for each angle.
 *
 * In production, these would be rendered from the 3D scene
 * using the specified camera angles. Returns SVGs with
 * angle metadata.
 */
export function generateAutoThumbnail(): {
  candidates: {
    angle: ViewAngle;
    svg: Buffer;
    score: number;
  }[];
  best: {
    angle: ViewAngle;
    svg: Buffer;
    score: number;
  };
} {
  const candidates = CANDIDATE_VIEW_ANGLES.map((angle) => {
    const svg = generateThumbnailForAngle(angle);
    const score = scoreViewAngle(angle);
    return { angle, svg, score };
  });

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];

  return { candidates, best };
}

/**
 * Generate an SVG thumbnail for a specific view angle.
 * Returns a styled SVG with angle metadata.
 */
function generateThumbnailForAngle(angle: ViewAngle): Buffer {
  // Calculate a color based on the angle for visual variety
  const hue = Math.round((angle.theta / (2 * Math.PI)) * 360);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:hsl(${hue},70%,35%)"/>
      <stop offset="100%" style="stop-color:hsl(${hue + 30},70%,25%)"/>
    </linearGradient>
  </defs>
  <rect fill="url(#bg)" width="400" height="300" rx="12"/>
  <text x="200" y="120" text-anchor="middle" fill="white" font-family="system-ui" font-size="36" font-weight="bold">3D Tour</text>
  <text x="200" y="155" text-anchor="middle" fill="white" font-family="system-ui" font-size="14" opacity="0.9">${angle.name}</text>
  <text x="200" y="185" text-anchor="middle" fill="white" font-family="system-ui" font-size="12" opacity="0.6">theta=${angle.theta.toFixed(2)} phi=${angle.phi.toFixed(2)}</text>
</svg>`;
  return Buffer.from(svg);
}

/**
 * Score a view angle for aesthetic quality.
 * Higher scores = more likely to produce a good thumbnail.
 *
 * Heuristics:
 * - Slight upward angle (phi 0.2-0.6) is best
 * - Front-ish views (theta near 0 or PI/4) score higher
 * - Moderate distance is preferred
 * - Standard FOV is preferred
 */
function scoreViewAngle(angle: ViewAngle): number {
  let score = 50;

  // Phi (vertical angle) scoring
  if (angle.phi >= 0.2 && angle.phi <= 0.6) {
    score += 20;
  } else if (angle.phi > 0.6 && angle.phi <= 1.0) {
    score += 10;
  }

  // Theta (horizontal angle) scoring -- prefer front-ish views
  const normalizedTheta = Math.min(angle.theta, 2 * Math.PI - angle.theta);
  if (normalizedTheta < Math.PI / 6) {
    score += 15; // near front
  } else if (normalizedTheta < Math.PI / 3) {
    score += 10; // diagonal front
  }

  // Distance scoring
  if (angle.distance >= 3 && angle.distance <= 5) {
    score += 10;
  }

  // FOV scoring
  if (angle.fov >= 60 && angle.fov <= 75) {
    score += 5;
  }

  return Math.min(100, score);
}

/**
 * Select the optimal view angle from a set of candidates.
 * Returns the angle with the highest aesthetic score.
 */
export function getOptimalViewAngle(): ViewAngle {
  const { best } = generateAutoThumbnail();
  return best.angle;
}
