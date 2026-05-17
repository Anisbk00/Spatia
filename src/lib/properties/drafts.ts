import type { PropertyCreateInput } from "./validation";

export const DRAFT_KEY = "spatia_property_draft";

const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

interface StoredDraft {
  data: Partial<PropertyCreateInput>;
  savedAt: number;
}

/**
 * Save a property draft to localStorage.
 * Auto-expires after 24 hours.
 */
export function savePropertyDraft(draft: Partial<PropertyCreateInput>): void {
  if (typeof window === "undefined") return;

  try {
    const stored: StoredDraft = {
      data: draft,
      savedAt: Date.now(),
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(stored));
  } catch {
    // localStorage may be unavailable (quota exceeded, private browsing, etc.)
  }
}

/**
 * Load the most recent property draft from localStorage.
 * Returns null if no draft exists or if it has expired (24 hours).
 */
export function loadPropertyDraft(): Partial<PropertyCreateInput> | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;

    const stored: StoredDraft = JSON.parse(raw);

    // Check expiry
    if (Date.now() - stored.savedAt > DRAFT_EXPIRY_MS) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }

    return stored.data;
  } catch {
    // Corrupted data — clear and return null
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Ignore cleanup failure
    }
    return null;
  }
}

/**
 * Remove the property draft from localStorage.
 */
export function clearPropertyDraft(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore localStorage errors
  }
}
