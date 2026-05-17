// ============================================
// IndexedDB Wrapper — Offline Capture Storage
// ============================================

const DB_NAME = "property-captures-offline";
const DB_VERSION = 1;
const STORE_NAME = "pending-captures";

// -------------------------------------------
// Types
// -------------------------------------------

export type PendingCaptureStatus = "pending" | "syncing" | "synced" | "failed";

export interface PendingCapture {
  id: string;
  sessionId: string;
  propertyId: string;
  file: Blob;
  fileName: string;
  fileSize: number;
  contentType: string;
  orderIndex: number;
  capturedAt: string;
  syncedAt: string | null;
  status: PendingCaptureStatus;
  error: string | null;
}

/** Metadata for a pending capture without the Blob */
export type PendingCaptureMeta = Omit<PendingCapture, "file">;

// -------------------------------------------
// Database initialization
// -------------------------------------------

let dbInstance: IDBDatabase | null = null;

/**
 * Open / create the IndexedDB database.
 * Creates the object store if it doesn't exist.
 */
export function initOfflineDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (_event) => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("sessionId", "sessionId", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("capturedAt", "capturedAt", { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;

      // Handle connection closing
      dbInstance.onclose = () => {
        dbInstance = null;
      };

      // Handle version change
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };

    request.onblocked = () => {
      console.warn("IndexedDB open blocked — close other tabs using this database");
    };
  });
}

// -------------------------------------------
// CRUD Operations
// -------------------------------------------

/**
 * Get a transaction and object store for the pending-captures store.
 */
function getStore(
  db: IDBDatabase,
  mode: IDBTransactionMode = "readonly"
): IDBObjectStore {
  const tx = db.transaction(STORE_NAME, mode);
  return tx.objectStore(STORE_NAME);
}

/**
 * Wrap an IDBRequest in a promise.
 */
function wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Add a new pending capture to IndexedDB.
 */
export async function addPendingCapture(
  capture: PendingCapture
): Promise<string> {
  const db = await initOfflineDB();
  const store = getStore(db, "readwrite");
  await wrapRequest(store.add(capture));
  return capture.id;
}

/**
 * Get a single pending capture by ID.
 */
export async function getPendingCapture(
  id: string
): Promise<PendingCapture | null> {
  const db = await initOfflineDB();
  const store = getStore(db, "readonly");
  const result = await wrapRequest<PendingCapture | undefined>(
    store.get(id)
  );
  return result ?? null;
}

/**
 * Get all pending captures, optionally filtered by sessionId.
 */
export async function getPendingCaptures(
  sessionId?: string
): Promise<PendingCapture[]> {
  const db = await initOfflineDB();

  if (sessionId) {
    const store = getStore(db, "readonly");
    const index = store.index("sessionId");
    return wrapRequest<PendingCapture[]>(index.getAll(sessionId));
  }

  const store = getStore(db, "readonly");
  return wrapRequest<PendingCapture[]>(store.getAll());
}

/**
 * Get all captures with a specific status.
 */
export async function getCapturesByStatus(
  status: PendingCaptureStatus
): Promise<PendingCapture[]> {
  const db = await initOfflineDB();
  const store = getStore(db, "readonly");
  const index = store.index("status");
  return wrapRequest<PendingCapture[]>(index.getAll(status));
}

/**
 * Update a pending capture record.
 */
export async function updatePendingCapture(
  id: string,
  updates: Partial<PendingCapture>
): Promise<void> {
  const db = await initOfflineDB();

  const store = getStore(db, "readwrite");
  const existing = await wrapRequest<PendingCapture | undefined>(store.get(id));

  if (!existing) {
    throw new Error(`Pending capture ${id} not found`);
  }

  const updated: PendingCapture = { ...existing, ...updates };
  await wrapRequest(store.put(updated));
}

/**
 * Mark a capture as synced.
 */
export async function markCaptureSynced(id: string): Promise<void> {
  await updatePendingCapture(id, {
    status: "synced",
    syncedAt: new Date().toISOString(),
    error: null,
  });
}

/**
 * Mark a capture as failed.
 */
export async function markCaptureFailed(
  id: string,
  error: string
): Promise<void> {
  const db = await initOfflineDB();
  const store = getStore(db, "readwrite");
  const existing = await wrapRequest<PendingCapture | undefined>(store.get(id));

  if (!existing) return;

  const updated: PendingCapture = {
    ...existing,
    status: "failed",
    error,
  };
  await wrapRequest(store.put(updated));
}

/**
 * Delete a single pending capture.
 */
export async function deletePendingCapture(id: string): Promise<void> {
  const db = await initOfflineDB();
  const store = getStore(db, "readwrite");
  await wrapRequest(store.delete(id));
}

/**
 * Clear all synced captures older than 24 hours.
 */
export async function clearOldSyncedCaptures(): Promise<number> {
  const db = await initOfflineDB();
  const store = getStore(db, "readwrite");

  const all = await wrapRequest<PendingCapture[]>(store.getAll());
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

  let deleted = 0;
  for (const capture of all) {
    if (
      capture.status === "synced" &&
      capture.syncedAt &&
      new Date(capture.syncedAt).getTime() < twentyFourHoursAgo
    ) {
      await wrapRequest(store.delete(capture.id));
      deleted++;
    }
  }

  return deleted;
}

/**
 * Get approximate storage usage in bytes.
 * Uses the Blob sizes stored in each record.
 */
export async function getStorageUsage(): Promise<number> {
  const db = await initOfflineDB();
  const store = getStore(db, "readonly");
  const all = await wrapRequest<PendingCapture[]>(store.getAll());

  return all.reduce((total, capture) => total + (capture.fileSize || 0), 0);
}

/**
 * Get count of captures by status.
 */
export async function getCaptureCounts(): Promise<
  Record<PendingCaptureStatus, number>
> {
  const db = await initOfflineDB();
  const store = getStore(db, "readonly");
  const all = await wrapRequest<PendingCapture[]>(store.getAll());

  const counts: Record<PendingCaptureStatus, number> = {
    pending: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
  };

  for (const capture of all) {
    counts[capture.status]++;
  }

  return counts;
}
