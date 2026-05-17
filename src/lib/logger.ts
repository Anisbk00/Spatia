// ============================================
// Lightweight Structured Logger
// ============================================
// Production-safe logging that replaces console.log throughout the codebase.
// Uses console.info for operational logs and console.error for errors.
// All messages are prefixed with [Module] for easy filtering.
// ============================================

type LogContext = string;

function formatMessage(context: LogContext, message: string): string {
  return `[${context}] ${message}`;
}

export const logger = {
  info(context: LogContext, message: string, ...args: unknown[]): void {
    console.info(formatMessage(context, message), ...args);
  },

  warn(context: LogContext, message: string, ...args: unknown[]): void {
    console.warn(formatMessage(context, message), ...args);
  },

  error(context: LogContext, message: string, ...args: unknown[]): void {
    console.error(formatMessage(context, message), ...args);
  },

  debug(context: LogContext, message: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV === "development") {
      console.debug(formatMessage(context, message), ...args);
    }
  },
};
