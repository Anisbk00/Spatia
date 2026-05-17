// ============================================
// Supabase Storage operations for scene output
// ============================================

import { getSupabase } from "./db";

const SCENES_BUCKET = "scene-outputs";

/**
 * Upload a file to Supabase Storage.
 * Creates the bucket if it doesn't exist.
 */
export async function uploadToStorage(
  path: string,
  data: Blob | Buffer | string,
  contentType: string = "application/json"
): Promise<string> {
  const supabase = getSupabase();

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
 * MVP: Returns a simple SVG-based image.
 */
export function generateThumbnail(): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect fill="#059669" width="400" height="300" rx="12"/>
  <text x="200" y="140" text-anchor="middle" fill="white" font-family="system-ui" font-size="48" font-weight="bold">3D</text>
  <text x="200" y="180" text-anchor="middle" fill="white" font-family="system-ui" font-size="18" opacity="0.8">Walkthrough Ready</text>
</svg>`;
  return Buffer.from(svg);
}
