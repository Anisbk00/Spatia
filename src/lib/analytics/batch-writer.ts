import { createAdminClient } from "@/lib/supabase/server";

// ============================================
// Types
// ============================================

export interface BatchWriterOptions {
  /** Flush when buffer reaches this size (default: 50) */
  flushSize?: number;
  /** Flush on this interval in milliseconds (default: 5000) */
  flushIntervalMs?: number;
  /** Max retries on flush failure (default: 3) */
  maxRetries?: number;
}

interface BufferedRecord {
  table: string;
  record: Record<string, unknown>;
}

// ============================================
// BatchWriter class
// ============================================

/**
 * Buffers database inserts and flushes them in batches.
 * Used for: events, system_logs, usage_metrics
 */
export class BatchWriter {
  private buffer: BufferedRecord[] = [];
  private flushSize: number;
  private flushIntervalMs: number;
  private maxRetries: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastFlushAt: number = Date.now();

  constructor(options?: BatchWriterOptions) {
    this.flushSize = options?.flushSize ?? 50;
    this.flushIntervalMs = options?.flushIntervalMs ?? 5000;
    this.maxRetries = options?.maxRetries ?? 3;

    // Auto-flush on interval
    if (typeof globalThis !== "undefined") {
      this.flushTimer = setInterval(() => {
        this.flushIfNeeded().catch(() => {
          // Silently handle flush errors
        });
      }, this.flushIntervalMs);

      // Don't prevent process exit
      if (this.flushTimer && typeof this.flushTimer.unref === "function") {
        this.flushTimer.unref();
      }
    }
  }

  /**
   * Add a record to the buffer.
   */
  add(table: string, record: Record<string, unknown>): void {
    this.buffer.push({ table, record });
    this.flushIfNeeded().catch(() => {
      // Silently handle flush errors
    });
  }

  /**
   * Batch-insert all buffered records.
   */
  async flush(): Promise<{ inserted: number; failed: number }> {
    if (this.buffer.length === 0) return { inserted: 0, failed: 0 };

    // Take all records from buffer
    const records = [...this.buffer];
    this.buffer = [];
    this.lastFlushAt = Date.now();

    // Group records by table
    const byTable = new Map<string, Record<string, unknown>[]>();
    for (const { table, record } of records) {
      const group = byTable.get(table) || [];
      group.push(record);
      byTable.set(table, group);
    }

    let totalInserted = 0;
    let totalFailed = 0;

    for (const [table, rows] of byTable.entries()) {
      let retries = 0;
      let success = false;

      while (retries <= this.maxRetries && !success) {
        try {
          const supabase = createAdminClient();
          if (!supabase) {
            totalFailed += rows.length;
            break;
          }

          const { error } = await supabase.from(table).insert(rows);

          if (error) {
            // Classify errors: only retry on network/timeout/server errors
            const isRetryable =
              error.message?.includes('network') ||
              error.message?.includes('timeout') ||
              error.message?.includes('ECONNREFUSED') ||
              error.code === '5XX' ||
              (typeof error.status === 'number' && error.status >= 500);

            if (!isRetryable || retries >= this.maxRetries) {
              console.error('[BatchWriter] Non-retryable error:', error.message);
              totalFailed += rows.length;
              break;
            }

            retries++;
            // Exponential backoff
            await new Promise((resolve) =>
              setTimeout(resolve, Math.min(1000 * Math.pow(2, retries), 10000))
            );
          } else {
            totalInserted += rows.length;
            success = true;
          }
        } catch (err) {
          console.error('[BatchWriter] Insert batch failed:', err);
          retries++;
          if (retries > this.maxRetries) {
            totalFailed += rows.length;
            break;
          }
          // Exponential backoff for transient exceptions
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(1000 * Math.pow(2, retries), 10000))
          );
        }
      }
    }

    return { inserted: totalInserted, failed: totalFailed };
  }

  /**
   * Flushes if buffer size >= threshold or time elapsed.
   */
  async flushIfNeeded(): Promise<{ inserted: number; failed: number }> {
    const bufferSize = this.buffer.length;
    const timeSinceLastFlush = Date.now() - this.lastFlushAt;

    if (bufferSize >= this.flushSize || timeSinceLastFlush >= this.flushIntervalMs) {
      return this.flush();
    }

    return { inserted: 0, failed: 0 };
  }

  /**
   * Stop the auto-flush timer and flush remaining records.
   */
  async destroy(): Promise<{ inserted: number; failed: number }> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    return this.flush();
  }

  /**
   * Get current buffer size.
   */
  get size(): number {
    return this.buffer.length;
  }
}

// ============================================
// Table-scoped BatchWriter factory
// ============================================

const writerInstances = new Map<string, TableBatchWriter>();

/**
 * Returns a BatchWriter scoped to a specific table.
 * Configurable: flushSize, flushIntervalMs, maxRetries
 *
 * Usage:
 * ```
 * const eventWriter = createBatchWriter("events", { flushSize: 100 });
 * eventWriter.add({ event_type: "page_view", org_id: "..." });
 * ```
 */
export function createBatchWriter(
  table: string,
  options?: BatchWriterOptions
): TableBatchWriter {
  const existing = writerInstances.get(table);
  if (existing) return existing;

  const writer = new TableBatchWriter(table, options);
  writerInstances.set(table, writer);
  return writer;
}

/**
 * A BatchWriter scoped to a single table.
 */
export class TableBatchWriter {
  private writer: BatchWriter;
  private table: string;

  constructor(table: string, options?: BatchWriterOptions) {
    this.table = table;
    this.writer = new BatchWriter(options);
  }

  /**
   * Add a record to the buffer for this table.
   */
  add(record: Record<string, unknown>): void {
    this.writer.add(this.table, record);
  }

  /**
   * Flush all buffered records.
   */
  async flush(): Promise<{ inserted: number; failed: number }> {
    return this.writer.flush();
  }

  /**
   * Flush if buffer size >= threshold or time elapsed.
   */
  async flushIfNeeded(): Promise<{ inserted: number; failed: number }> {
    return this.writer.flushIfNeeded();
  }

  /**
   * Stop auto-flush timer and flush remaining records.
   */
  async destroy(): Promise<{ inserted: number; failed: number }> {
    return this.writer.destroy();
  }

  /**
   * Get current buffer size.
   */
  get size(): number {
    return this.writer.size;
  }
}
