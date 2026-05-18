// ============================================
// Stage 1: Image Validation
// ============================================
// Validates captured images by checking HTTP
// accessibility, content type, and file size.
// ============================================

import type { PipelineContext, PipelineStageResult } from "./stages";

function isSupabaseHost(url: string, supabaseUrl: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const parsedSupabase = new URL(supabaseUrl);
    return parsedUrl.hostname === parsedSupabase.hostname;
  } catch {
    return false;
  }
}

const CONCURRENCY = 5;

async function validateSingleImage(
  url: string,
  index: number,
  ctx: PipelineContext,
  validatedUrls: string[],
  rejectedReasons: string[]
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const headers: Record<string, string> = {};
    // Only attach Authorization header for recognized Supabase storage URLs
    if (isSupabaseHost(url, ctx.supabaseUrl)) {
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
      rejectedReasons.push(`Image ${index + 1}: HTTP ${response.status}`);
      return;
    }

    if (
      !contentType.startsWith("image/") &&
      !contentType.startsWith("application/octet-stream")
    ) {
      rejectedReasons.push(
        `Image ${index + 1}: Invalid content type "${contentType}"`
      );
      return;
    }

    // Treat content-length of 0 or missing as invalid
    if (!contentLengthStr || contentLength <= 0) {
      rejectedReasons.push(
        `Image ${index + 1}: Missing or empty content-length`
      );
      return;
    }

    if (contentLength < 10240) {
      rejectedReasons.push(
        `Image ${index + 1}: Too small (${contentLength} bytes)`
      );
      return;
    }

    validatedUrls.push(url);
  } catch (err) {
    rejectedReasons.push(
      `Image ${index + 1}: ${err instanceof Error ? err.message : "Fetch failed"}`
    );
  }
}

export async function runImageValidation(
  ctx: PipelineContext
): Promise<PipelineStageResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  logs.push(`[${new Date().toISOString()}] Starting image validation`);
  logs.push(
    `[${new Date().toISOString()}] Total images: ${ctx.imageUrls.length}`
  );

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

  // Process images with concurrency limit of 5
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < ctx.imageUrls.length) {
      const i = nextIndex++;
      await validateSingleImage(
        ctx.imageUrls[i],
        i,
        ctx,
        validatedUrls,
        rejectedReasons
      );
    }
  }

  const workerCount = Math.min(CONCURRENCY, ctx.imageUrls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  logs.push(
    `[${new Date().toISOString()}] Valid images: ${validatedUrls.length}/${ctx.imageUrls.length}` +
      (rejectedReasons.length > 0
        ? `\n  Rejected: ${rejectedReasons.join("; ")}`
        : "")
  );

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
