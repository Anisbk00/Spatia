// ============================================
// Supabase Storage operations for scene output
// ============================================

import { getSupabase } from "./db";

const SCENES_BUCKET = "scene-outputs";
let storageInitialized = false;

export async function initializeStorage(): Promise<void> {
  if (storageInitialized) return;

  const supabase = getSupabase();

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(`Failed to list storage buckets: ${listError.message}`);
  }

  const bucketExists = buckets?.some((b) => b.id === SCENES_BUCKET);

  if (!bucketExists) {
    const { error: createError } = await supabase.storage.createBucket(SCENES_BUCKET, {
      public: true,
      fileSizeLimit: 500 * 1024 * 1024, // 500MB
    });
    if (createError) {
      throw new Error(`Failed to create bucket "${SCENES_BUCKET}": ${createError.message}`);
    }
  }

  storageInitialized = true;
}

/**
 * Upload a file to Supabase Storage with retry logic.
 * Retries up to 3 times with exponential backoff on transient failures.
 */
export async function uploadToStorage(
  path: string,
  data: Blob | Buffer | string,
  contentType: string = "application/json"
): Promise<string> {
  await initializeStorage();

  const supabase = getSupabase();
  const MAX_RETRIES = 3;
  const INITIAL_BACKOFF_MS = 1000;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { error } = await supabase.storage
      .from(SCENES_BUCKET)
      .upload(path, data, {
        contentType,
        upsert: true,
      });

    if (!error) {
      const { data: urlData } = supabase.storage
        .from(SCENES_BUCKET)
        .getPublicUrl(path);

      return urlData.publicUrl;
    }

    lastError = error instanceof Error ? error : new Error(String(error));

    const isTransient =
      (error.message?.toLowerCase().includes("network") ||
        error.message?.toLowerCase().includes("timeout") ||
        error.message?.toLowerCase().includes("econnrefused") ||
        error.message?.toLowerCase().includes("socket hang up") ||
        (error.statusCode !== undefined && error.statusCode >= 500));

    if (!isTransient || attempt >= MAX_RETRIES - 1) {
      break;
    }

    const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }

  throw new Error(`Failed to upload ${path} after ${MAX_RETRIES} attempts: ${lastError?.message}`);
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
