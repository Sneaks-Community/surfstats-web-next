'use client';

export default function PlayerProfileLoading() {
  return (
    <div
      className="flex flex-col items-center justify-center py-20"
      role="status"
      aria-live="polite"
    >
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mb-4"></div>
      <p className="text-text-muted">Loading player profile...</p>
    </div>
  );
}
