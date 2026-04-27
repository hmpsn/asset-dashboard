import type { ReactNode } from 'react';
import { TrendBadge, type TrendBadgeProps } from './TrendBadge';

export interface ChartCardProps {
  title?: string;
  titleIcon?: ReactNode;
  /** Trend delta to display inline next to title. Rendered via `<TrendBadge>`. */
  trend?: number;
  /** Props forwarded to the inline `<TrendBadge>` (suffix, label, invert, etc.). */
  trendProps?: Omit<TrendBadgeProps, 'value'>;
  /** Right-aligned slot (e.g. a "View details" link). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function ChartCard({ title, titleIcon, trend, trendProps, action, children, className }: ChartCardProps) {
  const hasHeader = title || titleIcon || trend !== undefined || action;

  return (
    <div
      className={`bg-[var(--surface-2)] border border-zinc-800 transition-colors duration-200 ${className ?? ''}`}
      style={{ borderRadius: '10px 24px 10px 24px' }}
    >
      {hasHeader && (
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            {titleIcon}
            {title && <span className="text-sm font-semibold text-zinc-200">{title}</span>}
            {trend !== undefined && <TrendBadge value={trend} {...trendProps} />}
          </div>
          {action}
        </div>
      )}
      <div className={hasHeader ? 'px-4 pb-3' : 'px-4 py-3'}>{children}</div>
    </div>
  );
}
