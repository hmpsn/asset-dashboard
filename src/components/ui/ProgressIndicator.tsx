import { useState, useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';

interface ProgressIndicatorProps {
  status: 'idle' | 'running' | 'complete' | 'error';
  step?: string;
  detail?: string;
  percent?: number;
  onCancel?: () => void;
  className?: string;
}

export function ProgressIndicator({
  status,
  step,
  detail,
  percent,
  onCancel,
  className = '',
}: ProgressIndicatorProps) {
  const [visible, setVisible] = useState(true);

  // Fade out after 3s when complete — opacity transition only, not layout
  useEffect(() => { // effect-layout-ok
    if (status === 'complete') {
      const timer = setTimeout(() => setVisible(false), 3000);
      return () => clearTimeout(timer);
    }
    setVisible(true);
  }, [status]);

  // idle and error render nothing
  if (status === 'idle' || status === 'error') return null;

  if (status === 'complete') {
    return (
      <div
        className={`flex items-center gap-2 px-4 py-2.5 transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'} ${className}`}
      >
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <span className="text-xs font-medium text-emerald-400">Complete</span>
      </div>
    );
  }

  // status === 'running'
  const isIndeterminate = percent === undefined;

  return (
    <div className={`space-y-2 px-4 py-3 bg-[var(--surface-2)] border border-blue-500/20 rounded-[var(--radius-xl)] ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {step && <span className="text-xs font-medium text-[var(--brand-text)]">{step}</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isIndeterminate && (
            <span className="text-xs text-[var(--brand-text-dim)] font-mono">{Math.round(percent)}%</span>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              className="p-0.5 rounded-[var(--radius-sm)] text-[var(--brand-text-dim)] hover:text-red-400 transition-colors"
              aria-label="Cancel"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar - BLUE (data color, not teal) */}
      <div
        className="w-full bg-[var(--surface-3)] rounded-full h-1.5 overflow-hidden"
        role="progressbar"
        aria-valuenow={isIndeterminate ? undefined : Math.round(percent!)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {isIndeterminate ? (
          <div className="h-full bg-blue-500 rounded-full animate-pulse w-2/3" />
        ) : (
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        )}
      </div>

      {detail && <p className="text-xs text-[var(--brand-text-dim)]">{detail}</p>}
    </div>
  );
}
