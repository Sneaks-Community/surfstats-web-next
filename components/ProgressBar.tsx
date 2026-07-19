interface ProgressBarProps {
  label: string;
  current: number;
  total: number;
  color: 'blue' | 'purple' | 'orange';
}

export default function ProgressBar({ label, current, total, color }: ProgressBarProps) {
  const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  
  const colorClasses = {
    blue: 'bg-blue-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500',
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium text-text-muted w-10 flex-shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-surface-active rounded overflow-hidden relative">
        <div
          className={`h-full ${colorClasses[color]} rounded animate-barber-pole`}
          style={{
            opacity: 0.85,
            width: `${percentage}%`,
            backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent)',
            backgroundSize: '40px 40px',
          }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow-md">
          {percentage}%
        </span>
      </div>
      <span className="text-sm text-text-muted w-20 text-right flex-shrink-0">{current.toLocaleString()} / {total.toLocaleString()}</span>
    </div>
  );
}