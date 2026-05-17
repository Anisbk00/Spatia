// ============================================
// Stage 1: Image Validation
// ============================================
// Validates captured images by checking HTTP
// accessibility, content type, and file size.
// ============================================

import type { PipelineContext, PipelineStageResult } from "./stages";

export async function runImageValidation(
  ctx: PipelineContext
): Promise<PipelineStageResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  logs.push(`[${new Date().toISOString()}] Starting image validation`);
  logs.push(`[${new Date().toISOString()}] Total images: ${ctx.imageUrls.length}`);

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

  await Promise.all(
    ctx.imageUrls.map(async (url, i) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(url, {
          method: "HEAD",
          signal: controller.signal,
          headers: { Authorization: `Bearer ${ctx.supabaseKey}` },
        });
        clearTimeout(timeout);

        const contentType = response.headers.get("content-type") || "";
        const contentLength = parseInt(response.headers.get("content-length") || "0", 10);

        if (!response.ok) {
          rejectedReasons.push(`Image ${i + 1}: HTTP ${response.status}`);
          return;
        }

        if (!contentType.startsWith("image/") && !contentType.startsWith("application/octet-stream")) {
          rejectedReasons.push(`Image ${i + 1}: Invalid content type "${contentType}"`);
          return;
        }

        if (contentLength > 0 && contentLength < 10240) {
          rejectedReasons.push(`Image ${i + 1}: Too small (${contentLength} bytes)`);
          return;
        }

        validatedUrls.push(url);
      } catch (err) {
        rejectedReasons.push(`Image ${i + 1}: ${err instanceof Error ? err.message : "Fetch failed"}`);
      }
    })
  );

  logs.push(
    `[${new Date().toISOString()}] Valid images: ${validatedUrls.length}/${ctx.imageUrls.length}` +
    (rejectedReasons.length > 0 ? `\n  Rejected: ${rejectedReasons.join("; ")}` : "")
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
