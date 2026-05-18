// ============================================
// Offline Sync Engine — IndexedDB + Auto-Sync
// ============================================

import {
  initOfflineDB,
  addPendingCapture,
  getPendingCaptures,
  getCapturesByStatus,
  markCaptureSynced,
  markCaptureFailed,
  clearOldSyncedCaptures,
  getStorageUsage,
  getCaptureCounts,
  updatePendingCapture,
  deletePendingCapture,
} from "./db";
import type { PendingCapture, PendingCaptureStatus } from "./db";
import { uploadWithResume } from "@/lib/upload-resume";
import { createClient } from "@/lib/supabase/client";

// Re-export the init function and types for convenience
export { initOfflineDB } from "./db";
export type { PendingCapture, PendingCaptureStatus } from "./db";

// -------------------------------------------
// Sync backoff helpers
// -------------------------------------------

const SYNC_MAX_RETRIES = 5;

function getSyncBackoff(retryCount: number): number {
  // 1s, 4s, 16s, 64s, 256s
  return Math.pow(4, retryCount) * 250;
}

// -------------------------------------------
// OfflineStore — high-level IndexedDB operations
// -------------------------------------------

export class OfflineStore {
  /**
   * Save a captured image to IndexedDB for later sync.
   */
  async saveCapture(params: {
    file: Blob;
    sessionId: string;
    propertyId: string;
    orderIndex: number;
    fileName?: string;
    contentType?: string;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const {
      file,
      sessionId,
      propertyId,
      orderIndex,
      fileName = `capture-${orderIndex}.jpg`,
      contentType = file.type || "image/jpeg",
    } = params;

    const capture: PendingCapture = {
      id,
      sessionId,
      propertyId,
      file,
      fileName,
      fileSize: file.size,
      contentType,
      orderIndex,
      capturedAt: new Date().toISOString(),
      syncedAt: null,
      status: "pending",
      error: null,
    };

    await addPendingCapture(capture);
    return id;
  }

  /**
   * Get all pending (unsynced) captures, optionally filtered by session.
   */
  async getPendingCaptures(sessionId?: string): Promise<PendingCapture[]> {
    if (sessionId) {
      const all = await getPendingCaptures(sessionId);
      return all.filter((c) => c.status === "pending" || c.status === "failed");
    }

    const [pending, failed] = await Promise.all([
      getCapturesByStatus("pending"),
      getCapturesByStatus("failed"),
    ]);

    return [...pending, ...failed];
  }

  /**
   * Mark a capture as successfully synced.
   */
  async markSynced(id: string): Promise<void> {
    await markCaptureSynced(id);
  }

  /**
   * Mark a capture as failed with error message.
   */
  async markFailed(id: string, error: string): Promise<void> {
    await markCaptureFailed(id, error);
  }

  /**
   * Clear all synced items older than 24 hours.
   */
  async clearSynced(): Promise<number> {
    return clearOldSyncedCaptures();
  }

  /**
   * Get approximate storage usage in bytes.
   */
  async getStorageUsage(): Promise<number> {
    return getStorageUsage();
  }

  /**
   * Get counts of captures by status.
   */
  async getCounts(): Promise<Record<PendingCaptureStatus, number>> {
    return getCaptureCounts();
  }
}

// -------------------------------------------
// SyncEngine — monitors online status and auto-syncs
// -------------------------------------------

export type SyncProgressCallback = (
  pending: number,
  synced: number,
  failed: number
) => void;

export type OnlineStatusCallback = (isOnline: boolean) => void;

export class SyncEngine {
  private store: OfflineStore;
  private syncing = false;
  private stopped = true;
  private syncRetryCount = 0;
  private onlineHandler: (() => void) | null = null;
  private offlineHandler: (() => void) | null = null;

  // Callbacks
  public onSyncProgress: SyncProgressCallback | null = null;
  public onOnlineStatusChange: OnlineStatusCallback | null = null;

  // Abort controller for cancelling in-flight syncs
  private abortController: AbortController | null = null;

  constructor(store?: OfflineStore) {
    this.store = store ?? new OfflineStore();
  }

  /**
   * Start the sync engine — begins monitoring online status and auto-syncing.
   */
  startSync(): void {
    this.stopped = false;

    // Set up online/offline event listeners
    this.onlineHandler = () => {
      this.onOnlineStatusChange?.(true);
      // Auto-sync when coming back online
      this.syncPendingCaptures();
    };

    this.offlineHandler = () => {
      this.onOnlineStatusChange?.(false);
      // Cancel any in-flight sync
      this.abortController?.abort();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onlineHandler);
      window.addEventListener("offline", this.offlineHandler);
    }

    // If already online, start syncing immediately
    if (typeof navigator !== "undefined" && navigator.onLine) {
      this.syncPendingCaptures();
    }
  }

  /**
   * Stop the sync engine — pauses syncing and removes event listeners.
   */
  stopSync(): void {
    this.stopped = true;
    this.syncing = false;
    this.abortController?.abort();

    if (typeof window !== "undefined") {
      if (this.onlineHandler) {
        window.removeEventListener("online", this.onlineHandler);
      }
      if (this.offlineHandler) {
        window.removeEventListener("offline", this.offlineHandler);
      }
    }
  }

  /**
   * Check if currently syncing.
   */
  isSyncing(): boolean {
    return this.syncing;
  }

  /**
   * Check if online.
   */
  isOnline(): boolean {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  }

  // ---- Private ----

  /**
   * Sync all pending captures from IndexedDB → Supabase Storage.
   */
  private async syncPendingCaptures(): Promise<void> {
    if (this.syncing || this.stopped) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    this.syncing = true;
    this.abortController = new AbortController();

    try {
      // Initialize the DB if needed
      await initOfflineDB();

      const pendingCaptures = await this.store.getPendingCaptures();

      if (pendingCaptures.length === 0) {
        this.syncing = false;
        this.reportProgress();
        return;
      }

      let synced = 0;
      let failed = 0;

      for (const capture of pendingCaptures) {
        if (this.stopped || this.abortController.signal.aborted) break;
        if (typeof navigator !== "undefined" && !navigator.onLine) break;

        // Mark as syncing
        await updatePendingCapture(capture.id, { status: "syncing" });
        this.reportProgress(synced, failed);

        try {
          // Check if an upload operation already exists for this capture
          const existingOps = await fetch(
            `/api/uploads?sessionId=${encodeURIComponent(capture.sessionId)}`
          );
          if (existingOps.ok) {
            const { operations } = await existingOps.json();
            const existing = operations.find(
              (op: any) => op.file_name === capture.fileName && op.order_index === capture.orderIndex
            );
            if (existing && existing.status !== "failed") {
              // Already has an active upload operation, skip
              await this.store.markSynced(capture.id);
              continue;
            }
          }

          // Create upload operation via API
          const supabase = createClient();
          let orgId: string | null = null;

          if (supabase) {
            const {
              data: { user },
            } = await supabase.auth.getUser();

            if (user) {
              const { data: membership } = await supabase
                .from("organization_members")
                .select("org_id")
                .eq("user_id", user.id)
                .limit(1)
                .single();
              orgId = membership?.org_id ?? null;
            }
          }

          // Create upload operation record
          const opResponse = await fetch("/api/uploads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: capture.sessionId,
              propertyId: capture.propertyId,
              fileName: capture.fileName,
              fileSize: capture.fileSize,
              contentType: capture.contentType,
              orgId,
            }),
          });

          if (!opResponse.ok) {
            const errData = await opResponse.json();
            throw new Error(errData.error || "Failed to create upload operation");
          }

          const { operation } = await opResponse.json();

          // Upload the file
          const file = new File([capture.file], capture.fileName, {
            type: capture.contentType,
          });

          await uploadWithResume({
            file,
            sessionId: capture.sessionId,
            propertyId: capture.propertyId,
            orderIndex: capture.orderIndex,
            operationId: operation.id,
            signal: this.abortController.signal,
          });

          // Mark as synced in IndexedDB
          await this.store.markSynced(capture.id);
          synced++;
          this.syncRetryCount = 0;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Sync failed";

          await this.store.markFailed(capture.id, errorMessage);
          failed++;

          // Exponential backoff on sync failures
          this.syncRetryCount++;
          if (this.syncRetryCount < SYNC_MAX_RETRIES) {
            const delay = getSyncBackoff(this.syncRetryCount);
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            // Reset after max retries — don't block other items
            this.syncRetryCount = 0;
          }
        }

        this.reportProgress(synced, failed);
      }

      // Clean up old synced captures
      await this.store.clearSynced();
    } catch (error) {
      console.error("SyncEngine error:", error);
    } finally {
      this.syncing = false;
      this.reportProgress();
    }
  }

  /**
   * Report current sync progress via callback.
   */
  private async reportProgress(
    recentSynced: number = 0,
    recentFailed: number = 0
  ): Promise<void> {
    if (!this.onSyncProgress) return;

    try {
      const counts = await this.store.getCounts();
      this.onSyncProgress(
        counts.pending + counts.syncing,
        counts.synced + recentSynced,
        counts.failed
      );
    } catch (err) {
      console.error("[SyncEngine] Failed to report progress:", err);
    }
  }
}
