import { createClient } from 'redis';
import logger from './logger';
import { onShutdown } from './shutdown';

const valkeyUrl = process.env.VALKEY_URL || 'redis://localhost:6379';
const valkeyUsername = process.env.VALKEY_USERNAME;
const valkeyPassword = process.env.VALKEY_PASSWORD;
const valkeyTls = process.env.VALKEY_TLS === 'true';
const valkeyTlsRejectUnauthorized = process.env.VALKEY_TLS_REJECT_UNAUTHORIZED !== 'false';
const valkeyConnectTimeout = parseInt(process.env.VALKEY_CONNECT_TIMEOUT || '5000');

// Build socket options conditionally to satisfy TypeScript types
const socketOptions: { tls?: true; rejectUnauthorized?: boolean; connectTimeout?: number } =
  valkeyTls
    ? { tls: true, rejectUnauthorized: valkeyTlsRejectUnauthorized, connectTimeout: valkeyConnectTimeout }
    : { connectTimeout: valkeyConnectTimeout };

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

client.on('close', () => {
  logger.warn('[Valkey] Connection closed');
});

// Force connection on import. Kept as a module-level promise so callers can
// await the initial attempt instead of racing it — otherwise the very first
// request after startup sees isReady === false and gets a 503 before the
// handshake has had a chance to complete.
const initialConnect: Promise<void> = (async () => {
  if (!client.isOpen) {
    try {
      await client.connect();
    } catch (err) {
      const error = err as { message?: string };
      logger.error(`[Valkey] Failed to connect: ${error.message || 'Unknown error'}`);
    }
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

/** Whether the Valkey client is connected and ready to serve commands. */
export function isCacheReady(): boolean {
  return client.isReady;
}

/**
 * Await the initial connection attempt, then report readiness. Use this on
 * request paths that would otherwise reject before startup finishes; the
 * attempt is bounded by VALKEY_CONNECT_TIMEOUT. Steady-state reconnects are
 * handled internally by node-redis, so this only matters for the first hit.
 */
export async function waitForCacheReady(): Promise<boolean> {
  if (!client.isReady) {
    await initialConnect;
  }
  return client.isReady;
}

export default client;
