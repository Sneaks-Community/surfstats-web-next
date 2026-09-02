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
// During Next.js production build, silence all logs to avoid build output noise
const isNextBuild = process.env.NEXT_PHASE === 'phase-production-build';
const logLevel = isNextBuild ? 'silent' : (process.env.LOG_LEVEL ?? 'info');

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

export default logger;
