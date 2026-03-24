/**
 * Client-side utility functions
 * These functions are safe to use in both client and server components
 */

// Pre-created formatter for better performance
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Format a date string into localized format
 * @param date - Date string or Date object
 * @returns Formatted date string (e.g., "01/15/2024")
 */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return 'N/A';
  try {
    return dateFormatter.format(new Date(date));
  } catch {
    return 'N/A';
  }
}

/**
 * Format seconds into a time string (MM:SS.mmm format)
 * @param seconds - Time in seconds (can include milliseconds as decimal)
 * @returns Formatted time string (e.g., "1:23.456" or "10:05.789")
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(3);
  return `${mins}:${secs.padStart(6, '0')}`;
}

/**
 * Sanitize a player name (for display purposes)
 * Note: Player names are displayed, not used in queries, so this is for XSS prevention
 * @param name - The player name to sanitize
 * @returns Sanitized name safe for HTML display
 */
export function sanitizePlayerName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') {
    return 'Unknown';
  }
  
  // Remove HTML/script tags and special characters that could be used for XSS
  return name
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .slice(0, 64) // Limit length
    .trim() || 'Unknown';
}