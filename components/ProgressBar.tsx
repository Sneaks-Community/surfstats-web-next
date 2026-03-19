'use client';

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
    <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-800 min-w-[260px] flex-1 max-w-[400px] h-[72px] flex flex-col justify-center">
      <div className="relative h-6 bg-zinc-700 rounded overflow-hidden">
        <div 
          className={`absolute inset-y-0 left-0 ${colorClasses[color]} rounded transition-all duration-1000 ease-out`}
          style={{ width: `${percentage}%` }}
        >
          {/* Loading bar animation */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="h-full w-full bg-gradient-to-r from-transparent via-white/40 to-transparent animate-loading-bar" />
          </div>
        </div>
        <div className="absolute inset-0 flex items-center justify-between px-2">
          <span className="text-xs font-semibold text-white drop-shadow-md whitespace-nowrap">
            {label}
          </span>
          <span className="text-xs font-medium text-white drop-shadow-md whitespace-nowrap">
            {current.toLocaleString()} / {total.toLocaleString()} ({percentage}%)
          </span>
        </div>
      </div>
      <style jsx>{`
        @keyframes loading-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        .animate-loading-bar {
          animation: loading-bar 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}