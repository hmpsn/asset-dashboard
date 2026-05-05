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
      className={`bg-[var(--surface-2)] border border-[var(--brand-border)] transition-colors duration-200 ${className ?? ''}`}
      // pr-check-disable-next-line -- ChartCard is a UI primitive sharing SectionCard's brand card radius.
      style={{ borderRadius: 'var(--radius-signature-lg)' }}
    >
      {hasHeader && (
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            {titleIcon}
            {title && <span className="t-ui font-semibold text-[var(--brand-text-bright)]">{title}</span>}
            {trend !== undefined && <TrendBadge value={trend} {...trendProps} />}
          </div>
          {action}
        </div>
      )}
      <div className={hasHeader ? 'px-4 pb-3' : 'px-4 py-3'}>{children}</div>
    </div>
  );
}
