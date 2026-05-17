// ============================================
// Upload Resume System — Resumable Uploads with DB-backed state
// ============================================

import { createClient } from "@/lib/supabase/client";
import type { UploadOperation, UploadOperationStatus } from "@/lib/types";

const STORAGE_BUCKET = "property-captures";
const MAX_RETRIES = 5;

// Exponential backoff delays: 1s, 4s, 16s, 64s, 256s
function getBackoffDelay(retryCount: number): number {
  return Math.pow(4, retryCount) * 250; // 250ms, 1s, 4s, 16s, 64s
}

// -------------------------------------------
// Types
// -------------------------------------------

export interface UploadResult {
  url: string;
  path: string;
  mediaId: string;
  operationId: string;
}

export interface UploadStateChange {
  operationId: string;
  status: UploadOperationStatus;
  bytesUploaded: number;
  fileSize: number;
  retryCount: number;
  lastError: string | null;
}

export type OnUploadStateChange = (change: UploadStateChange) => void;

interface InMemoryUpload {
  operationId: string;
  file?: File;
  sessionId: string;
  propertyId: string;
  orderIndex: number;
  status: UploadOperationStatus;
  bytesUploaded: number;
  retryCount: number;
  abortController: AbortController | null;
}

export interface UploadStatusSummary {
  pending: number;
  uploading: number;
  uploaded: number;
  failed: number;
  cancelled: number;
  total: number;
}

// -------------------------------------------
// uploadWithResume — uploads a single file with progress tracking
// -------------------------------------------

export async function uploadWithResume(params: {
  file: File;
  sessionId: string;
  propertyId: string;
  orderIndex: number;
  operationId: string;
  onProgress?: (bytesUploaded: number, totalBytes: number) => void;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  const { file, sessionId, propertyId, orderIndex, operationId, onProgress, signal } =
    params;

  const supabase = createClient();
  if (!supabase) {
    throw new Error("Supabase not configured");
  }

  const timestamp = Date.now();
  const ext = file.name.split(".").pop() || "jpg";
  const filePath = `${sessionId}/${timestamp}-${orderIndex}.${ext}`;

  // Update operation → uploading
  await supabase
    .from("upload_operations")
    .update({
      status: "uploading",
      storage_path: filePath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", operationId);

  try {
    // Upload to Supabase Storage with progress tracking
    // Note: Supabase JS v2 doesn't natively support upload progress,
    // so we report progress after upload completes.
    // For real progress, a chunked upload approach would be needed.
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // Report full progress
    onProgress?.(file.size, file.size);

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    const url = urlData.publicUrl;

    // Insert media record
    const { data: mediaRow, error: insertError } = await supabase
      .from("media")
      .insert({
        session_id: sessionId,
        property_id: propertyId,
        url,
        type: "image",
        order_index: orderIndex,
        metadata: {
          timestamp: new Date().toISOString(),
          size: file.size,
          contentType: file.type,
          uploadOperationId: operationId,
        },
      })
      .select("id")
      .single();

    if (insertError || !mediaRow) {
      // Try to clean up uploaded file
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
      throw new Error(`Media record failed: ${insertError?.message}`);
    }

    // Update upload_operation → uploaded, link media_id
    await supabase
      .from("upload_operations")
      .update({
        status: "uploaded",
        bytes_uploaded: file.size,
        media_id: mediaRow.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", operationId);

    // Update capture session total_images
    await supabase.rpc("increment_session_images", {
      session_id_input: sessionId,
    }).then(undefined, () => {
      return supabase
        .from("capture_sessions")
        .update({
          total_images: orderIndex,
          status: "uploading",
        })
        .eq("id", sessionId);
    });

    return {
      url,
      path: filePath,
      mediaId: mediaRow.id,
      operationId,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown upload error";

    // Update upload_operation → failed
    await supabase
      .from("upload_operations")
      .update({
        status: "failed",
        last_error: errorMessage,
        retry_count: 0, // Will be incremented by queue
        updated_at: new Date().toISOString(),
      })
      .eq("id", operationId);

    throw error;
  }
}

// -------------------------------------------
// ResumableUploadQueue
// -------------------------------------------

export class ResumableUploadQueue {
  private uploads: Map<string, InMemoryUpload> = new Map();
  private processing = false;
  private onStateChange: OnUploadStateChange | null = null;
  private stopped = false;

  constructor(onStateChange?: OnUploadStateChange) {
    this.onStateChange = onStateChange ?? null;
  }

  // ---- Public API ----

  /**
   * Add a file to the upload queue.
   * Creates an upload_operation record in DB and starts the upload.
   */
  async add(
    file: File,
    sessionId: string,
    propertyId: string,
    orderIndex: number
  ): Promise<string> {
    const supabase = createClient();
    if (!supabase) {
      throw new Error("Supabase not configured");
    }

    // Get current user for org_id
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let orgId: string | null = null;
    if (user) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("org_id")
        .eq("user_id", user.id)
        .limit(1)
        .single();
      orgId = membership?.org_id ?? null;
    }

    // Create upload_operation record via API
    const response = await fetch("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        propertyId,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || "image/jpeg",
        orgId,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to create upload operation");
    }

    const { operation } = await response.json();

    // Store in memory
    const upload: InMemoryUpload = {
      operationId: operation.id,
      file,
      sessionId,
      propertyId,
      orderIndex,
      status: "pending",
      bytesUploaded: 0,
      retryCount: 0,
      abortController: null,
    };

    this.uploads.set(operation.id, upload);
    this.emitState(upload);

    // Start processing
    this.process();

    return operation.id;
  }

  /**
   * Retry all failed uploads.
   */
  async retryAll(): Promise<void> {
    for (const [id, upload] of this.uploads) {
      if (upload.status === "failed" && upload.retryCount < MAX_RETRIES) {
        upload.status = "pending";
        upload.abortController = null;
        this.emitState(upload);
      }
    }
    this.process();
  }

  /**
   * Recover all pending/failed uploads for a session from DB.
   * Note: Files must be re-added since we can't recover File objects from DB.
   * This returns the operations that need recovery so the caller can re-add files.
   */
  async recoverSession(sessionId: string): Promise<UploadOperation[]> {
    const response = await fetch(
      `/api/uploads?sessionId=${encodeURIComponent(sessionId)}`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch upload operations for recovery");
    }

    const { operations } = await response.json();

    // Filter to only pending/failed that aren't already in memory
    const recoverable = (operations as UploadOperation[]).filter(
      (op) =>
        (op.status === "pending" || op.status === "failed") &&
        !this.uploads.has(op.id) &&
        op.retry_count < MAX_RETRIES
    );

    // Mark them in memory as failed (they need files re-added)
    for (const op of recoverable) {
      const upload: InMemoryUpload = {
        operationId: op.id,
        file: undefined, // Will need to be re-provided by caller via addRecoveredFile()
        sessionId: op.session_id,
        propertyId: op.property_id,
        orderIndex: 0,
        status: "failed",
        bytesUploaded: op.bytes_uploaded,
        retryCount: op.retry_count,
        abortController: null,
      };
      this.uploads.set(op.id, upload);
      this.emitState(upload);
    }

    return recoverable;
  }

  /**
   * Add a file for a recovered operation.
   */
  addRecoveredFile(operationId: string, file: File, orderIndex: number): void {
    const upload = this.uploads.get(operationId);
    if (!upload) return;

    upload.file = file;
    upload.orderIndex = orderIndex;
    upload.status = "pending";
    upload.retryCount = 0;
    upload.bytesUploaded = 0;
    this.emitState(upload);

    this.process();
  }

  /**
   * Get status summary of all tracked uploads.
   */
  getStatus(): UploadStatusSummary {
    const summary: UploadStatusSummary = {
      pending: 0,
      uploading: 0,
      uploaded: 0,
      failed: 0,
      cancelled: 0,
      total: 0,
    };

    for (const upload of this.uploads.values()) {
      summary[upload.status]++;
      summary.total++;
    }

    return summary;
  }

  /**
   * Cancel a specific upload.
   */
  cancel(operationId: string): void {
    const upload = this.uploads.get(operationId);
    if (!upload) return;

    if (upload.abortController) {
      upload.abortController.abort();
    }

    upload.status = "cancelled";
    this.emitState(upload);

    // Update DB
    const supabase = createClient();
    if (supabase) {
      supabase
        .from("upload_operations")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", operationId);
    }
  }

  /**
   * Stop all processing.
   */
  stop(): void {
    this.stopped = true;
    for (const upload of this.uploads.values()) {
      if (upload.abortController) {
        upload.abortController.abort();
      }
    }
  }

  /**
   * Get all in-memory upload entries.
   */
  getUploads(): InMemoryUpload[] {
    return Array.from(this.uploads.values());
  }

  /**
   * Get completed upload results.
   */
  getCompletedResults(): UploadResult[] {
    return Array.from(this.uploads.values())
      .filter((u) => u.status === "uploaded")
      .map((u) => ({
        url: "", // URL is stored in DB; this is a summary
        path: "",
        mediaId: "",
        operationId: u.operationId,
      }));
  }

  // ---- Private ----

  private emitState(upload: InMemoryUpload): void {
    this.onStateChange?.({
      operationId: upload.operationId,
      status: upload.status,
      bytesUploaded: upload.bytesUploaded,
      fileSize: upload.file?.size ?? 0,
      retryCount: upload.retryCount,
      lastError: null,
    });
  }

  private async process(): Promise<void> {
    if (this.processing || this.stopped) return;
    this.processing = true;

    while (
      !this.stopped &&
      Array.from(this.uploads.values()).some(
        (u) =>
          u.status === "pending" ||
          (u.status === "failed" && u.retryCount < MAX_RETRIES)
      )
    ) {
      const upload = Array.from(this.uploads.values()).find(
        (u) =>
          u.status === "pending" ||
          (u.status === "failed" && u.retryCount < MAX_RETRIES)
      );

      if (!upload || !upload.file) break;

      // If retrying, apply exponential backoff
      if (upload.retryCount > 0 && upload.status === "failed") {
        const delay = getBackoffDelay(upload.retryCount);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      upload.abortController = new AbortController();
      upload.status = "uploading";
      this.emitState(upload);

      try {
        const result = await uploadWithResume({
          file: upload.file,
          sessionId: upload.sessionId,
          propertyId: upload.propertyId,
          orderIndex: upload.orderIndex,
          operationId: upload.operationId,
          signal: upload.abortController.signal,
          onProgress: (bytesUploaded) => {
            upload.bytesUploaded = bytesUploaded;
            this.emitState(upload);
          },
        });

        upload.status = "uploaded";
        upload.bytesUploaded = upload.file?.size ?? 0;
        this.emitState(upload);
      } catch (error) {
        upload.retryCount++;
        const isPermanent = upload.retryCount >= MAX_RETRIES;
        upload.status = isPermanent ? "failed" : "failed"; // Will be retried in next loop iteration

        // Update DB with retry count
        const supabase = createClient();
        if (supabase) {
          await supabase
            .from("upload_operations")
            .update({
              status: isPermanent ? "failed" : "pending",
              retry_count: upload.retryCount,
              last_error: error instanceof Error ? error.message : "Unknown error",
              updated_at: new Date().toISOString(),
            })
            .eq("id", upload.operationId);
        }

        this.emitState(upload);

        if (isPermanent) {
          console.error(
            `Upload ${upload.operationId} permanently failed after ${MAX_RETRIES} retries`
          );
        }
      }
    }

    this.processing = false;
  }
}
