import { createClient } from 'redis';
import logger from './logger';

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

// Force connection on import
void (async () => {
  if (!client.isOpen) {
    try {
      await client.connect();
    } catch (err) {
      const error = err as { message?: string };
      logger.error(`[Valkey] Failed to connect: ${error.message || 'Unknown error'}`);
    }
  }
})();

/** Whether the Valkey client is connected and ready to serve commands. */
export function isCacheReady(): boolean {
  return client.isReady;
}

export default client;
