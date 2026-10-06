import 'server-only';
import pino from 'pino';

// Structured JSON; in development pipe it through `npx pino-pretty` to read it.
// LOG_LEVEL sets the minimum level; silent during `next build` to keep build output clean.
const isNextBuild = process.env.NEXT_PHASE === 'phase-production-build';
const logLevel = isNextBuild ? 'silent' : (process.env.LOG_LEVEL ?? 'info');

export const logger = pino({
  name: 'surfstats-web',
  level: logLevel,
  base: {
    // pid and hostname in production only, for traceability.
    ...(process.env.NODE_ENV === 'production' && {
      pid: process.pid,
      hostname: process.env.HOSTNAME ?? 'unknown',
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
