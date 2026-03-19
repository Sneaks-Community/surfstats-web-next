import 'server-only';
import pino from 'pino';

/**
 * Pino logger configuration for the application
 *
 * Environment variables:
 * - LOG_LEVEL: Minimum log level (trace, debug, info, warn, error, fatal, silent). Defaults to 'info'.
 *
 * Note: In development, pipe logs through `pino-pretty` CLI for human-readable output:
 *   npm run dev 2>&1 | npx pino-pretty
 */

// Determine log level from environment (default to 'info')
const logLevel = process.env.LOG_LEVEL ?? 'warn';

/**
 * Base logger instance for the application
 * Outputs structured JSON logs - use pino-pretty CLI for human-readable output in development
 */
export const logger = pino({
  name: 'surfstats-web',
  level: logLevel,
  base: {
    // Include pid and hostname in production for traceability
    ...(process.env.NODE_ENV === 'production' && {
      pid: process.pid,
      hostname: process.env.HOSTNAME ?? 'unknown',
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Child logger factory for creating context-specific loggers
 * Use this to add request-specific or module-specific context
 *
 * @param bindings - Key-value pairs to include in all child logger messages
 * @returns A child logger instance
 *
 * @example
 * const requestLogger = logger.child({ requestId: '123' });
 * requestLogger.info('Processing request');
 */
export const createChildLogger = (bindings: Record<string, unknown>) => {
  return logger.child(bindings);
};

export default logger;
