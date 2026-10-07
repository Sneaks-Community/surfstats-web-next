/** Bare spinner element; callers supply any surrounding layout or label. */
export function LoadingSpinner({
  size = 'md',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizeClass = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' }[size];
  return (
    <div
      className={`animate-spin rounded-full border-2 border-primary-500 border-t-transparent ${sizeClass} ${className}`}
    />
  );
}
