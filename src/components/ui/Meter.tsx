// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import { cn } from '../../lib/utils';

/**
 * Horizontal progress / value bar (the app's `.oppbar`). `value` over `max`
 * (default 100). Teal fill by default; `gradient` uses the teal→emerald run.
 * Optional label + percentage readout above the track. role="meter" semantics.
 */
export interface MeterProps {
  value: number;
  max?: number;
  color?: string;
  gradient?: boolean;
  height?: number;
  label?: string;
  showValue?: boolean;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function Meter({
  value,
  max = 100,
  color,
  gradient = false,
  height = 6,
  label,
  showValue = false,
  className,
  id,
  style,
}: MeterProps): ReactElement {
  const clamped = Math.max(0, Math.min(max, value));
  const pct = max > 0 ? (clamped / max) * 100 : 0;
  const fill = gradient ? 'linear-gradient(90deg, var(--teal), var(--emerald))' : color || 'var(--teal)';

  return (
    <div id={id} className={cn('flex flex-col gap-1 min-w-0', className)} style={style}>
      {(label || showValue) && (
        <div className="flex items-baseline gap-2">
          {label && <span className="t-caption text-[var(--brand-text-dim)]">{label}</span>}
          {showValue && (
            <span className="ml-auto t-stat-sm tabular-nums text-[var(--brand-text-bright)]">
              {Math.round(pct)}%
            </span>
          )}
        </div>
      )}
      <div
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={max}
        className="w-full rounded-[var(--radius-pill)] overflow-hidden bg-[var(--surface-1)]"
        style={{ height }}
      >
        <div
          className="h-full rounded-[var(--radius-pill)] transition-[width]"
          style={{ width: `${pct}%`, background: fill, transitionDuration: 'var(--dur-slow)' }}
        />
      </div>
    </div>
  );
}
