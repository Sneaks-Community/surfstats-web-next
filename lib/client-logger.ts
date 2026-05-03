/**
 * Client-side logging utility
 * 
 * This module provides logging for client-side code where Pino (server-only) cannot be used.
 * In production, logs are suppressed. In development, they use console.error.
 */

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Log an error message in development mode only
 * @param message - The error message to log
 * @param error - Optional error object for additional context
 */
export function clientError(message: string, error?: unknown): void {
  if (isDevelopment) {
    console.error(`[Client] ${message}`, error || '');
  }
}

/**
 * Log a debug message in development mode only
 * @param message - The debug message to log
 */
export function clientDebug(message: string): void {
  if (isDevelopment) {
    console.debug(`[Client] ${message}`);
  }
}

/**
 * Log an info message in development mode only
 * @param message - The info message to log
 */
export function clientInfo(message: string): void {
  if (isDevelopment) {
    // eslint-disable-next-line no-console
    console.info(`[Client] ${message}`);
  }
}
