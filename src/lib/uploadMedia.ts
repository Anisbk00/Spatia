// ============================================
// Upload Media — Supabase Storage + DB insert
// ============================================

import { createClient } from "@/lib/supabase/client";

const STORAGE_BUCKET = "property-captures";

export interface UploadResult {
  url: string;
  path: string;
  mediaId: string;
}

export interface QueuedUpload {
  file: File;
  sessionId: string;
  propertyId: string;
  orderIndex: number;
  status: "pending" | "uploading" | "done" | "failed";
  result?: UploadResult;
  retryCount: number;
}

/**
 * Upload a single image to Supabase Storage and insert a media record.
 * This is called per-photo, non-blocking.
 */
export async function uploadMedia(params: {
  file: File;
  sessionId: string;
  propertyId: string;
  orderIndex: number;
}): Promise<UploadResult> {
  const supabase = createClient();
  if (!supabase) {
    throw new Error("Supabase not configured");
  }

  const { file, sessionId, propertyId, orderIndex } = params;
  const timestamp = Date.now();
  const ext = file.name.split(".").pop() || "jpg";
  const filePath = `${sessionId}/${timestamp}-${orderIndex}.${ext}`;

  // 1. Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    console.error("Storage upload error:", uploadError);
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  // 2. Get public URL
  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filePath);

  const url = urlData.publicUrl;

  // 3. Insert media record
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
      },
    })
    .select("id")
    .single();

  if (insertError || !mediaRow) {
    console.error("Media insert error:", insertError);
    // Try to clean up uploaded file
    await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
    throw new Error(`Media record failed: ${insertError?.message}`);
  }

  // 4. Update capture session total_images (atomic increment)
  await supabase.rpc("increment_session_images", {
    session_id_input: sessionId,
  }).then(undefined, async () => {
    // Fallback: read current count and increment
    const { data: currentSession } = await supabase
      .from("capture_sessions")
      .select("total_images")
      .eq("id", sessionId)
      .single();

    if (currentSession) {
      await supabase
        .from("capture_sessions")
        .update({
          total_images: (currentSession.total_images || 0) + 1,
          status: "uploading",
        })
        .eq("id", sessionId);
    }
  });

  return {
    url,
    path: filePath,
    mediaId: mediaRow.id,
  };
}

/**
 * Delete the last uploaded image for a session.
 * Removes from storage + media table.
 */
export async function deleteLastMedia(params: {
  sessionId: string;
  mediaId: string;
  storagePath: string;
}): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;

  // 1. Delete from storage
  await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([params.storagePath]);

  // 2. Delete from media table
  await supabase.from("media").delete().eq("id", params.mediaId);

  // 3. Decrement session total_images
  const { data: session } = await supabase
    .from("capture_sessions")
    .select("total_images")
    .eq("id", params.sessionId)
    .single();

  if (session && session.total_images > 0) {
    await supabase
      .from("capture_sessions")
      .update({ total_images: session.total_images - 1 })
      .eq("id", params.sessionId);
  }
}

/**
 * Upload queue manager — handles background uploads with retry.
 * Ensures UI never blocks while images upload.
 */
export class UploadQueue {
  private queue: QueuedUpload[] = [];
  private processing = false;
  private sessionId: string;
  private propertyId: string;
  private onQueueUpdate: (queue: QueuedUpload[]) => void;

  constructor(
    sessionId: string,
    propertyId: string,
    onQueueUpdate: (queue: QueuedUpload[]) => void
  ) {
    this.sessionId = sessionId;
    this.propertyId = propertyId;
    this.onQueueUpdate = onQueueUpdate;
  }

  add(file: File, orderIndex: number) {
    const item: QueuedUpload = {
      file,
      sessionId: this.sessionId,
      propertyId: this.propertyId,
      orderIndex,
      status: "pending",
      retryCount: 0,
    };
    this.queue.push(item);
    this.notify();
    this.process();
  }

  private notify() {
    this.onQueueUpdate([...this.queue]);
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.some((i) => i.status === "pending" || i.status === "failed")) {
      const item = this.queue.find(
        (i) => i.status === "pending" || (i.status === "failed" && i.retryCount < 3)
      );

      if (!item) break;

      item.status = "uploading";
      this.notify();

      try {
        const result = await uploadMedia({
          file: item.file,
          sessionId: item.sessionId,
          propertyId: item.propertyId,
          orderIndex: item.orderIndex,
        });
        item.status = "done";
        item.result = result;
      } catch (err) {
        console.error("[UploadQueue] Upload failed:", err);
        item.retryCount++;
        item.status = item.retryCount >= 3 ? "failed" : "pending";
      }

      this.notify();
    }

    this.processing = false;
  }

  get pendingCount(): number {
    return this.queue.filter((i) => i.status === "pending" || i.status === "uploading").length;
  }

  get failedCount(): number {
    return this.queue.filter((i) => i.status === "failed").length;
  }

  get completedResults(): UploadResult[] {
    return this.queue
      .filter((i) => i.status === "done" && i.result)
      .map((i) => i.result!);
  }

  get allDone(): boolean {
    return this.queue.length > 0 && this.queue.every((i) => i.status === "done" || i.status === "failed");
  }
}
