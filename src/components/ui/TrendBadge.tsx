import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface TrendBadgeProps {
  value: number;
  suffix?: string;
  /** Flip what's "good" — use for metrics where lower is better (e.g. rank position). */
  invert?: boolean;
  /** Show `+` prefix for positive values. */
  showSign?: boolean;
  /** Contextual text appended after the value (e.g. "vs last month"). */
  label?: string;
  /** `sm` = 11px / w-3 (default), `md` = 12px / w-3.5 */
  size?: 'sm' | 'md';
  /** Hide entirely when value is 0. Default true. Set false to render a neutral Minus icon. */
  hideOnZero?: boolean;
  className?: string;
}

export function TrendBadge({
  value,
  suffix = '%',
  invert = false,
  showSign = false,
  label,
  size = 'sm',
  hideOnZero = true,
  className,
}: TrendBadgeProps) {
  if (value === 0 && hideOnZero) return null;

  const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  if (value === 0) {
    return (
      <span className={`inline-flex items-center gap-0.5 ${textSize} font-medium text-zinc-400 ${className ?? ''}`}>
        <Minus className={iconSize} />
        0{suffix}
        {label ? ` ${label}` : null}
      </span>
    );
  }

  const positive = invert ? value < 0 : value > 0;
  const color = positive ? 'text-emerald-400' : 'text-red-400';
  const sign = showSign && value > 0 ? '+' : '';
  const displayValue = showSign ? value : Math.abs(value);

  return (
    <span className={`inline-flex items-center gap-0.5 ${textSize} font-medium ${color} ${className ?? ''}`}>
      {positive ? <TrendingUp className={iconSize} /> : <TrendingDown className={iconSize} />}
      {sign}{displayValue}{suffix}
      {label ? ` ${label}` : null}
    </span>
  );
}
