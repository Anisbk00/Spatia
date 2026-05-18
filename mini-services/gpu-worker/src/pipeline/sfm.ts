// ============================================
// Stage 1: Image Validation
// ============================================
// Validates captured images by checking HTTP
// accessibility, content type, and file size.
//
// Audit fixes applied:
//   - Authorization header only sent to recognized Supabase storage URLs
//   - Concurrency limit of 5 for image validation
//   - content-length: 0 now treated as invalid
//   - Uses seeded PRNG for deterministic behavior
// ============================================

import type { PipelineContext, PipelineStageResult } from "./stages";
import { createSeededRandom } from "../types";

const MAX_CONCURRENT_VALIDATIONS = 5;

/**
 * Check if a URL belongs to a recognized Supabase storage domain.
 * Only these URLs should receive the Authorization header.
 */
function isSupabaseStorageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Match *.supabase.co or *.supabase.in storage paths
    return (
      (parsed.hostname.endsWith(".supabase.co") ||
        parsed.hostname.endsWith(".supabase.in")) &&
      parsed.pathname.startsWith("/storage/v1/object/public/")
    );
  } catch {
    return false;
  }
}

/**
 * Simple concurrency limiter using a semaphore pattern.
 */
async function withConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrency, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export async function runImageValidation(
  ctx: PipelineContext
): Promise<PipelineStageResult> {
  const startTime = Date.now();
  const logs: string[] = [];
  const seededRandom = createSeededRandom(ctx.sceneId);

  logs.push(`[${new Date().toISOString()}] Starting image validation`);
  logs.push(`[${new Date().toISOString()}] Total images: ${ctx.imageUrls.length}`);
  logs.push(`[${new Date().toISOString()}] Concurrency limit: ${MAX_CONCURRENT_VALIDATIONS}`);

  if (ctx.imageUrls.length < 3) {
    return {
      status: "failed",
      durationMs: Date.now() - startTime,
      artifacts: {},
      error: `Not enough valid images: ${ctx.imageUrls.length}/3 minimum`,
      logs: logs.join("\n"),
    };
  }

  // Validate each image URL: check HTTP accessibility and content type
  const validatedUrls: string[] = [];
  const rejectedReasons: string[] = [];

  // Build validation tasks
  const tasks = ctx.imageUrls.map((url, i) => async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      // FIX: Only attach Authorization header for recognized Supabase storage URLs.
      // Never send the service key to arbitrary URLs.
      const headers: Record<string, string> = {};
      if (isSupabaseStorageUrl(url) && ctx.supabaseKey) {
        headers["Authorization"] = `Bearer ${ctx.supabaseKey}`;
      }

      const response = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        headers,
      });
      clearTimeout(timeout);

      const contentType = response.headers.get("content-type") || "";
      const contentLengthStr = response.headers.get("content-length") || "";
      const contentLength = parseInt(contentLengthStr, 10);

      if (!response.ok) {
        rejectedReasons.push(`Image ${i + 1}: HTTP ${response.status}`);
        return;
      }

      if (!contentType.startsWith("image/") && !contentType.startsWith("application/octet-stream")) {
        rejectedReasons.push(`Image ${i + 1}: Invalid content type "${contentType}"`);
        return;
      }

      // FIX: content-length: 0 is treated as invalid (header missing/zero means unknown or empty)
      if (contentLengthStr === "" || isNaN(contentLength) || contentLength <= 0) {
        rejectedReasons.push(`Image ${i + 1}: Invalid or missing content-length (${contentLengthStr || "empty"})`);
        return;
      }

      if (contentLength < 10240) {
        rejectedReasons.push(`Image ${i + 1}: Too small (${contentLength} bytes)`);
        return;
      }

      validatedUrls.push(url);
    } catch (err) {
      rejectedReasons.push(`Image ${i + 1}: ${err instanceof Error ? err.message : "Fetch failed"}`);
    }
  });

  await withConcurrencyLimit(tasks, MAX_CONCURRENT_VALIDATIONS);

  logs.push(
    `[${new Date().toISOString()}] Valid images: ${validatedUrls.length}/${ctx.imageUrls.length}` +
    (rejectedReasons.length > 0 ? `\n  Rejected: ${rejectedReasons.join("; ")}` : "")
  );

  // Consume one random value to keep PRNG state consistent across stages
  seededRandom();

  if (validatedUrls.length < 3) {
    return {
      status: "failed",
      durationMs: Date.now() - startTime,
      artifacts: {},
      error: `Not enough valid images after validation: ${validatedUrls.length}/3 minimum`,
      logs: logs.join("\n"),
    };
  }

  logs.push(`[${new Date().toISOString()}] Image validation complete`);

  return {
    status: "completed",
    durationMs: Date.now() - startTime,
    artifacts: {
      validated_image_urls: JSON.stringify(validatedUrls),
      valid_image_count: String(validatedUrls.length),
      rejected_count: String(rejectedReasons.length),
    },
    logs: logs.join("\n"),
  };
}
