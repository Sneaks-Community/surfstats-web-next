import 'server-only';

/**
 * Utility functions shared across the application
 */

// Pre-created formatter for better performance (avoids creating new Intl.DateTimeFormat on each call)
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: 'numeric',
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
 * Format playtime duration in seconds to hours and minutes format
 * Used for displaying total time on server from player analytics
 * @param seconds - Total time in seconds
 * @returns Formatted string in "Xh Ym" format (e.g., "125h 30m", "0h 15m")
 */
export function formatPlaytime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  return `${hours}h ${minutes}m`;
}