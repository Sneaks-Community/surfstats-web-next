import { createClient } from 'redis';
import logger from './logger';
import { onShutdown } from './shutdown';

const valkeyUrl = process.env.VALKEY_URL || 'redis://localhost:6379';
const valkeyUsername = process.env.VALKEY_USERNAME;
const valkeyPassword = process.env.VALKEY_PASSWORD;
const valkeyTls = process.env.VALKEY_TLS === 'true';
const valkeyTlsRejectUnauthorized = process.env.VALKEY_TLS_REJECT_UNAUTHORIZED !== 'false';
const valkeyConnectTimeout = parseInt(process.env.VALKEY_CONNECT_TIMEOUT || '5000', 10) || 5000;

// Exponential backoff (100ms, doubling) capped at 30s. node-redis calls this
// once per reconnect attempt with the retry counter and the failure cause, so
// it's the one place to emit an informative per-attempt log line. Returning a
// number (never false/Error) preserves the default behavior of retrying
// indefinitely.
function reconnectStrategy(retries: number, cause: Error): number {
  const delay = Math.min(2 ** retries * 100, 30_000);
  logger.warn(
    `[Valkey] Reconnect attempt #${retries + 1} failed: ${cause.message}. Next retry in ${delay}ms (backoff, capped at 30000ms).`
  );
  return delay;
}

// Build socket options conditionally to satisfy TypeScript types
const socketOptions: {
  tls?: true;
  rejectUnauthorized?: boolean;
  connectTimeout?: number;
  reconnectStrategy: (retries: number, cause: Error) => number;
} = valkeyTls
  ? { tls: true, rejectUnauthorized: valkeyTlsRejectUnauthorized, connectTimeout: valkeyConnectTimeout, reconnectStrategy }
  : { connectTimeout: valkeyConnectTimeout, reconnectStrategy };

const client = createClient({
  url: valkeyUrl,
  username: valkeyUsername,
  password: valkeyPassword,
  socket: socketOptions,
});

client.on('error', (err: Error) => {
  logger.error(`[Valkey] Client error: ${err.message}`);
});

client.on('connect', () => {
  logger.info('[Valkey] Connected');
});

client.on('reconnecting', () => {
  logger.warn('[Valkey] Reconnecting...');
});

// Force connection on import. Kept as a module-level promise so callers can
// await the initial attempt instead of racing it — otherwise the very first
// request after startup sees isReady === false and gets a 503 before the
// handshake has had a chance to complete.
//
// VALKEY_CONNECT_TIMEOUT caps one socket attempt, not connect(), which retries
// forever, so bound the whole wait or callers hang instead of failing closed.
const initialConnect: Promise<void> = (async () => {
  if (client.isOpen) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out after ${valkeyConnectTimeout}ms`)),
          valkeyConnectTimeout
        );
      }),
    ]);
  } catch (err) {
    const error = err as { message?: string };
    logger.error(`[Valkey] Failed to connect: ${error.message || 'Unknown error'}`);
  } finally {
    clearTimeout(timer);
  }
})();

// Graceful shutdown: quit the client so in-flight commands drain and the
// connection closes cleanly instead of being reset when the process exits.
onShutdown('valkey-client', async () => {
  if (client.isOpen) {
    await client.quit();
    logger.info('[Valkey] Connection closed gracefully');
  }
});

/**
 * Await the initial connection attempt, then report readiness. Use this on
 * request paths that would otherwise reject before startup finishes; the wait
 * is bounded (see initialConnect). Steady-state reconnects are handled
 * internally by node-redis, so this only matters for the first hit.
 */
export async function waitForCacheReady(): Promise<boolean> {
  if (!client.isReady) {
    await initialConnect;
  }
  return client.isReady;
}

export default client;
