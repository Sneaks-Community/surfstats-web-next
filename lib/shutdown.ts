import 'server-only';
import logger from './logger';
import { getErrorMessage } from './errors';

type ShutdownHandler = () => void;

const handlers: ShutdownHandler[] = [];
let listenerRegistered = false;

/**
 * Register a cleanup callback to run once on process shutdown (SIGTERM).
 *
 * All callbacks share a single `process.on('SIGTERM')` listener, so adding new
 * subsystems doesn't accumulate listeners (avoiding Node's
 * MaxListenersExceededWarning). A throwing handler is logged and skipped so one
 * failure doesn't prevent the rest from running. No-op outside the server.
 */
export function onShutdown(handler: ShutdownHandler): void {
  if (typeof window !== 'undefined') return;

  handlers.push(handler);

  if (!listenerRegistered) {
    listenerRegistered = true;
    process.on('SIGTERM', () => {
      for (const h of handlers) {
        try {
          h();
        } catch (error) {
          logger.error(`[Shutdown] Cleanup handler failed: ${getErrorMessage(error)}`);
        }
      }
    });
  }
}
