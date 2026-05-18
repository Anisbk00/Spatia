// ============================================
// Lightweight Structured Logger
// ============================================
// Production-safe logging with correlation ID support.
// - Development: human-readable prefixed format (legacy)
// - Production: JSON-structured output for log aggregation
//
// All messages are prefixed with [Module] for easy filtering
// and include correlation IDs when set.
// ============================================

type LogContext = string;

let _correlationId: string | null = null;

/**
 * Set a correlation ID that will be included in all subsequent log entries.
 * Useful for tracing a request across multiple services/logs.
 */
export function setCorrelationId(id: string): void {
  _correlationId = id;
}

/**
 * Get the current correlation ID (if any).
 */
export function getCorrelationId(): string | null {
  return _correlationId;
}

/**
 * Clear the correlation ID.
 *
 * IMPORTANT: Must be called in finally blocks or request lifecycle cleanup
 * to prevent correlation ID leaks across requests in serverless/edge
 * environments where the module-level variable persists between invocations.
 */
export function clearCorrelationId(): void {
  _correlationId = null;
}

/**
 * Build the structured log entry for production (JSON) output.
 */
function buildStructuredEntry(
  level: string,
  context: string,
  message: string,
  args: unknown[],
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    context,
    message,
  };

  if (_correlationId) {
    entry.correlation_id = _correlationId;
  }

  if (args.length > 0) {
    // If single arg is an Error, extract useful fields
    if (args.length === 1 && args[0] instanceof Error) {
      entry.error = {
        name: args[0].name,
        message: args[0].message,
        stack: args[0].stack,
      };
    } else {
      entry.data = args.length === 1 ? args[0] : args;
    }
  }

  return entry;
}

/**
 * Format log message for development (human-readable with prefix).
 */
function formatMessage(context: LogContext, message: string): string {
  const prefix = _correlationId ? `[${context}:${_correlationId}]` : `[${context}]`;
  return `${prefix} ${message}`;
}

export const logger = {
  info(context: LogContext, message: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV === "production") {
      console.info(JSON.stringify(buildStructuredEntry("info", context, message, args)));
    } else {
      console.info(formatMessage(context, message), ...args);
    }
  },

  warn(context: LogContext, message: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV === "production") {
      console.warn(JSON.stringify(buildStructuredEntry("warn", context, message, args)));
    } else {
      console.warn(formatMessage(context, message), ...args);
    }
  },

  error(context: LogContext, message: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV === "production") {
      console.error(JSON.stringify(buildStructuredEntry("error", context, message, args)));
    } else {
      console.error(formatMessage(context, message), ...args);
    }
  },

  debug(context: LogContext, message: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV === "production") {
      console.debug(JSON.stringify(buildStructuredEntry("debug", context, message, args)));
    } else {
      console.debug(formatMessage(context, message), ...args);
    }
  },
};
