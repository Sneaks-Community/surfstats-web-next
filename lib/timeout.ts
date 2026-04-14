/**
 * Timeout wrapper utility
 * 
 * Provides a proper timeout implementation that:
 * - Prevents memory leaks by clearing timeouts
 * - Handles race conditions correctly
 * - Provides consistent error messages
 */

/**
 * Wraps a promise with a timeout
 * 
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds
 * @param message - Error message if timeout occurs
 * @returns The result of the promise or throws on timeout
 * 
 * @example
 * const result = await withTimeout(
 *   expensiveOperation(),
 *   30000,
 *   'Operation timed out'
 * );
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string = 'Operation timed out'
): Promise<T> {
  // Create a deferred promise for the timeout
  let timeoutId: NodeJS.Timeout | null = null;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
  
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    // Cleanup: clear timeout if it hasn't fired yet
    // This prevents memory leaks when the promise resolves before timeout
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Creates a timeout promise that can be used with Promise.race
 * 
 * @param ms - Timeout in milliseconds
 * @param message - Error message if timeout occurs
 * @returns A promise that rejects after the specified time
 * 
 * @deprecated Use `withTimeout` instead for better cleanup
 */
