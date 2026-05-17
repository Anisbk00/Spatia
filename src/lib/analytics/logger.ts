import { createClient } from "@/lib/supabase/server";

// ============================================
// Types
// ============================================

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface LogMetadata {
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  source: string;
  message: string;
  metadata?: LogMetadata;
  org_id?: string;
  user_id?: string;
  session_id?: string;
  property_id?: string;
  job_id?: string;
}

// ============================================
// Buffer for client-side batch inserts
// ============================================

let logBuffer: LogEntry[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL = 5000; // 5 seconds
const FLUSH_SIZE = 50;

function scheduleClientFlush() {
  if (flushTimeout) return;
  flushTimeout = setTimeout(async () => {
    flushTimeout = null;
    await flushClientBuffer();
  }, FLUSH_INTERVAL);
}

async function flushClientBuffer() {
  if (logBuffer.length === 0) return;

  const entries = [...logBuffer];
  logBuffer = [];

  try {
    const { createClient: createBrowserClient } = await import("@/lib/supabase/client");
    const client = createBrowserClient();
    if (!client) return;

    const rows = entries.map(formatLogEntry);
    await client.from("system_logs").insert(rows);
  } catch (err) {
    console.error("[SystemLogger] Client buffer flush failed:", err);
    // Re-add failed entries back to buffer (limit to prevent unbounded growth)
    if (logBuffer.length < FLUSH_SIZE * 2) {
      logBuffer.unshift(...entries);
    }
  }
}

// ============================================
// SystemLogger class
// ============================================

export class SystemLogger {
  private context: {
    org_id?: string;
    user_id?: string;
  };

  constructor(context?: { org_id?: string; user_id?: string }) {
    this.context = context || {};
  }

  /**
   * Log at debug level
   */
  async debug(source: string, message: string, metadata?: LogMetadata): Promise<void> {
    await this.log("debug", source, message, metadata);
  }

  /**
   * Log at info level
   */
  async info(source: string, message: string, metadata?: LogMetadata): Promise<void> {
    await this.log("info", source, message, metadata);
  }

  /**
   * Log at warn level
   */
  async warn(source: string, message: string, metadata?: LogMetadata): Promise<void> {
    await this.log("warn", source, message, metadata);
  }

  /**
   * Log at error level
   */
  async error(source: string, message: string, metadata?: LogMetadata): Promise<void> {
    await this.log("error", source, message, metadata);
  }

  /**
   * Log at fatal level
   */
  async fatal(source: string, message: string, metadata?: LogMetadata): Promise<void> {
    await this.log("fatal", source, message, metadata);
  }

  /**
   * Internal log method — server-side inserts directly, client-side buffers
   */
  private async log(
    level: LogLevel,
    source: string,
    message: string,
    metadata?: LogMetadata
  ): Promise<void> {
    const entry: LogEntry = {
      level,
      source,
      message,
      metadata,
      ...this.context,
    };

    // Check if we're on the server side
    if (typeof window === "undefined") {
      // Server-side: insert directly
      try {
        const supabase = await createClient();
        if (!supabase) return;

        await supabase.from("system_logs").insert(formatLogEntry(entry));
      } catch (err) {
        console.error("[SystemLogger] Server log insert failed:", err);
      }
    } else {
      // Client-side: buffer and batch-insert
      logBuffer.push(entry);

      if (logBuffer.length >= FLUSH_SIZE) {
        await flushClientBuffer();
      } else {
        scheduleClientFlush();
      }
    }
  }
}

// ============================================
// createRequestLogger helper
// ============================================

interface RequestInfo {
  user_id?: string;
  org_id?: string;
  ip_address?: string;
}

/**
 * Creates a logger scoped to an API request.
 * Auto-captures: user_id, org_id, ip_address
 *
 * Usage:
 * ```
 * const log = createRequestLogger({ user_id: '...', org_id: '...', ip_address: '...' });
 * log.info('api', 'Processing request');
 * ```
 */
export function createRequestLogger(requestInfo: RequestInfo): SystemLogger {
  const logger = new SystemLogger({
    org_id: requestInfo.org_id,
    user_id: requestInfo.user_id,
  });

  // Enhance: attach IP to metadata on each call
  const ip = requestInfo.ip_address;
  const origInfo = logger.info.bind(logger);
  const origWarn = logger.warn.bind(logger);
  const origError = logger.error.bind(logger);
  const origDebug = logger.debug.bind(logger);
  const origFatal = logger.fatal.bind(logger);

  const withIp = (meta?: LogMetadata) => ({
    ...meta,
    ip_address: ip,
  });

  // Override methods to include IP in metadata
  logger.info = (source: string, message: string, metadata?: LogMetadata) =>
    origInfo(source, message, withIp(metadata));
  logger.warn = (source: string, message: string, metadata?: LogMetadata) =>
    origWarn(source, message, withIp(metadata));
  logger.error = (source: string, message: string, metadata?: LogMetadata) =>
    origError(source, message, withIp(metadata));
  logger.debug = (source: string, message: string, metadata?: LogMetadata) =>
    origDebug(source, message, withIp(metadata));
  logger.fatal = (source: string, message: string, metadata?: LogMetadata) =>
    origFatal(source, message, withIp(metadata));

  return logger;
}

// ============================================
// Helpers
// ============================================

function formatLogEntry(entry: LogEntry): Record<string, unknown> {
  return {
    level: entry.level,
    source: entry.source,
    message: entry.message,
    metadata: entry.metadata || {},
    org_id: entry.org_id || null,
    user_id: entry.user_id || null,
    session_id: entry.session_id || null,
    property_id: entry.property_id || null,
    job_id: entry.job_id || null,
    created_at: new Date().toISOString(),
  };
}
