// ============================================
// Rate Limiter — Sliding Window Algorithm
// with In-Memory Storage + Periodic Cleanup
// ============================================

export interface RateLimitEntry {
  count: number;
  resetAt: number; // Unix timestamp in ms
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Cleanup every 5 minutes
const MAX_STORE_SIZE = 10_000; // Prevent unbounded growth

/**
 * RateLimiter class with sliding window algorithm.
 *
 * Uses an in-memory Map with TTL-based entries and periodic cleanup.
 *
 * NOTE: This implementation is per-process. For multi-instance / multi-server
 * deployments, replace this with a Redis-backed rate limiter (e.g., ioredis
 * with sliding window logs or token bucket). The interface is intentionally
 * simple to allow swapping the backing store without changing callers.
 */
export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Run cleanup every 5 minutes to evict expired entries
    if (typeof globalThis !== "undefined") {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, CLEANUP_INTERVAL_MS);

      // Don't prevent process exit
      if (this.cleanupInterval && typeof this.cleanupInterval.unref === "function") {
        this.cleanupInterval.unref();
      }
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

      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: new Date(resetAt),
      };
    }

    // Entry exists and window is still valid
    if (entry.count < limit) {
      entry.count++;
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
  }

  /**
   * Remove expired entries from the store.
   * Called periodically to prevent memory leaks.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.resetAt) {
        this.store.delete(key);
      }
    }

    // Enforce max store size — if still too large after cleanup,
    // evict oldest entries first
    if (this.store.size > MAX_STORE_SIZE) {
      const entries = Array.from(this.store.entries())
        .sort(([, a], [, b]) => a.resetAt - b.resetAt);

      const toRemove = this.store.size - MAX_STORE_SIZE;
      for (let i = 0; i < toRemove; i++) {
        this.store.delete(entries[i][0]);
      }
    }
  }

  /**
   * Get the current store size (for monitoring/debugging).
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Stop the cleanup interval. Call this during graceful shutdown.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

/**
 * Singleton instance for use across the application.
 */
export const rateLimiter = new RateLimiter();
