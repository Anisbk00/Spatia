// ============================================
// Standalone Retry Utility Functions
// ============================================
// Provides reusable retry logic with exponential
// backoff + jitter for any async operation.
// ============================================

/**
 * Calculate exponential backoff delay with jitter.
 *
 * Formula: baseMs * 2^retryCount + random jitter (0–baseMs)
 * Result is capped at maxMs.
 *
 * @param retryCount - Current retry attempt number (0-based)
 * @param baseMs - Base delay in milliseconds (default 1000)
 * @param maxMs - Maximum delay cap in milliseconds (default 300000 / 5 min)
 * @returns Delay in milliseconds before the next retry
 */
export function calculateBackoff(
  retryCount: number,
  baseMs: number = 1000,
  maxMs: number = 300_000,
): number {
  const exponentialDelay = baseMs * Math.pow(2, retryCount);
  // Full jitter strategy: random value between 0 and the exponential delay
  // This prevents thundering herd on retries
  const jitter = Math.random() * baseMs;
  const totalDelay = exponentialDelay + jitter;
  return Math.min(totalDelay, maxMs);
}

/**
 * Determines whether an error should be retried.
 *
 * Retryable conditions:
 * - Network errors (fetch failed, ECONNREFUSED, ECONNRESET, ETIMEDOUT)
 * - Timeout errors
 * - HTTP 5xx server errors
 * - HTTP 429 rate limiting
 * - Supabase-specific transient errors
 *
 * Non-retryable:
 * - HTTP 4xx client errors (except 429)
 * - Validation errors
 * - Authentication/authorization errors
 *
 * @param error - The error to evaluate
 * @returns True if the error is considered transient and retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Handle standard Error instances
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network-level errors
    const networkKeywords = [
      "econnrefused",
      "econnreset",
      "etimedout",
      "enotfound",
      "enetwork",
      "fetch failed",
      "network error",
      "networkerror",
      "socket hang up",
      "premature close",
      "und_err_connect_timeout",
    ];
    if (networkKeywords.some((kw) => message.includes(kw))) {
      return true;
    }

    // Timeout errors
    if (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("deadline exceeded")
    ) {
      return true;
    }

    // Abort / cancellation — not retryable
    if (message.includes("abort") || message.includes("cancel")) {
      return false;
    }
  }

  // Handle Supabase / PostgREST error objects
  if (typeof error === "object" && error !== null) {
    const err = error as Record<string, unknown>;

    // Supabase error with status code
    if (typeof err.status === "number") {
      const status = err.status as number;
      // 5xx server errors — retryable
      if (status >= 500 && status < 600) return true;
      // 429 Too Many Requests — retryable (with backoff)
      if (status === 429) return true;
      // 4xx client errors — not retryable
      if (status >= 400 && status < 500) return false;
    }

    // Supabase error code
    if (typeof err.code === "string") {
      const code = (err.code as string).toUpperCase();
      // Connection pool / transient DB errors
      const retryableCodes = [
        "CONNECTION_ERROR",
        "CONN_TIMEOUT",
        "POOL_ERROR",
        "OVERLOADED",
        "TOO_MANY_CONNECTIONS",
        "57014", // query_canceled
        "08006", // connection_failure
        "08001", // sqlclient_unable_to_establish_sqlconnection
        "08004", // sqlserver_rejected_establishment_of_sqlconnection
        "40001", // serialization_failure
        "40P01", // deadlock_detected
      ];
      if (retryableCodes.includes(code)) return true;
    }

    // Supabase PostgREST error hints
    if (typeof err.message === "string") {
      const msg = (err.message as string).toLowerCase();
      if (msg.includes("rate limit") || msg.includes("too many requests")) {
        return true;
      }
      if (msg.includes("overloaded") || msg.includes("connection pool")) {
        return true;
      }
    }

    // Supabase specific: hint field
    if (typeof err.hint === "string") {
      const hint = (err.hint as string).toLowerCase();
      if (hint.includes("retry") || hint.includes("try again")) {
        return true;
      }
    }
  }

  // String errors
  if (typeof error === "string") {
    const lower = error.toLowerCase();
    if (lower.includes("timeout") || lower.includes("network")) return true;
    if (lower.includes("abort") || lower.includes("cancel")) return false;
  }

  // Default: don't retry unknown errors
  return false;
}

/**
 * Wraps an async function with automatic retry logic.
 *
 * Retries the function up to `maxRetries` times with exponential backoff.
 * Only retries on errors that pass the `isRetryableError` check.
 *
 * @param fn - The async function to execute
 * @param maxRetries - Maximum number of retry attempts (default 3)
 * @param backoffFn - Custom backoff function (retryCount) => delayMs. Defaults to calculateBackoff.
 * @returns The result of the function on success
 * @throws The last error if all retries are exhausted or error is non-retryable
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => fetch('/api/data').then(r => r.json()),
 *   3,
 *   (n) => calculateBackoff(n, 500, 10000)
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  backoffFn: (retryCount: number) => number = (n) => calculateBackoff(n),
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // If this was the last attempt, or the error isn't retryable, throw immediately
      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error;
      }

      // Calculate backoff and wait before retrying
      const delayMs = backoffFn(attempt);
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Simple promise-based sleep utility.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
