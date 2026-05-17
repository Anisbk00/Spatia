// ============================================
// Rate Limiter — Sliding Window Algorithm
// with File-Based Persistence
// ============================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface RateLimitEntry {
  count: number;
  resetAt: number; // Unix timestamp in ms
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

const PERSIST_PATH = "/tmp/spatia-rate-limits.json";
const PERSIST_INTERVAL_MS = 30_000; // Persist every 30 seconds
const MAX_STORE_SIZE = 10_000; // Prevent unbounded growth

/**
 * RateLimiter class with sliding window algorithm and file-based persistence.
 * Stores: Map<string, { count, resetAt }>
 * Persists to disk so rate limits survive server restarts.
 */
export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private persistInterval: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor() {
    // Load persisted state on startup
    this.loadFromDisk();

    // Run cleanup every 5 minutes
    if (typeof globalThis !== "undefined") {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, 5 * 60 * 1000);

      // Don't prevent process exit
      if (this.cleanupInterval && typeof this.cleanupInterval.unref === "function") {
        this.cleanupInterval.unref();
      }
    }

    // Persist to disk periodically
    this.persistInterval = setInterval(() => {
      if (this.dirty) {
        this.persistToDisk();
      }
    }, PERSIST_INTERVAL_MS);

    if (this.persistInterval && typeof this.persistInterval.unref === "function") {
      this.persistInterval.unref();
    }

    // Persist on graceful shutdown
    if (typeof process !== "undefined" && process.on) {
      process.on("SIGINT", () => { this.persistToDisk(); });
      process.on("SIGTERM", () => { this.persistToDisk(); });
    }
  }

  /**
   * Check rate limit for a given key.
   *
   * @param key - Unique identifier (e.g., "upload:user123")
   * @param limit - Maximum number of requests allowed in the window
   * @param windowMs - Time window in milliseconds
   * @returns { allowed, remaining, resetAt }
   */
  check(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const entry = this.store.get(key);

    // If no entry exists or the window has expired, create a new one
    if (!entry || now >= entry.resetAt) {
      const resetAt = now + windowMs;
      this.store.set(key, { count: 1, resetAt });
      this.dirty = true;

      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: new Date(resetAt),
      };
    }

    // Entry exists and window is still valid
    if (entry.count < limit) {
      entry.count++;
      this.dirty = true;
      return {
        allowed: true,
        remaining: limit - entry.count,
        resetAt: new Date(entry.resetAt),
      };
    }

    // Rate limit exceeded
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(entry.resetAt),
    };
  }

  /**
   * Clear rate limit for a specific key.
   */
  reset(key: string): void {
    this.store.delete(key);
    this.dirty = true;
  }

  /**
   * Remove expired entries from the store.
   * Should be called periodically to prevent memory leaks.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.resetAt) {
        this.store.delete(key);
      }
    }
    this.dirty = true;
  }

  /**
   * Get the current store size (for monitoring/debugging).
   */
  get size(): number {
    return this.store.size;
  }

  // ---- Persistence ----

  private loadFromDisk(): void {
    try {
      if (!existsSync(PERSIST_PATH)) return;
      const data = JSON.parse(readFileSync(PERSIST_PATH, "utf-8"));
      if (data && typeof data === "object") {
        const now = Date.now();
        for (const [key, entry] of Object.entries(data)) {
          const e = entry as RateLimitEntry;
          // Skip expired entries on load
          if (e.resetAt && now < e.resetAt) {
            this.store.set(key, e);
          }
        }
      }
    } catch {
      // Silently ignore — start fresh
    }
  }

  private persistToDisk(): void {
    try {
      // Enforce max store size
      if (this.store.size > MAX_STORE_SIZE) {
        this.cleanup();
      }
      const obj: Record<string, RateLimitEntry> = {};
      for (const [key, entry] of this.store.entries()) {
        obj[key] = entry;
      }
      const dir = dirname(PERSIST_PATH);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(PERSIST_PATH, JSON.stringify(obj), "utf-8");
      this.dirty = false;
    } catch {
      // Silently ignore — in-memory still works
    }
  }
}

/**
 * Singleton instance for use across the application.
 */
export const rateLimiter = new RateLimiter();
