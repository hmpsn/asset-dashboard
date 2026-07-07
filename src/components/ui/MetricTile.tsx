// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { TrendBadge } from './TrendBadge';

/**
 * Calm metric tile — dense label/value/delta block on the symmetric
 * --radius-lg. The everyday KPI cell (a row of these forms a summary bar). For
 * the single spotlight figure use `StatCard`; for a one-line inline strip use
 * `CompactStatBar`. The delta composes <TrendBadge> (never a hand-rolled trend).
 */
export interface MetricTileProps {
  label: string;
  value: string | number;
  /** Numeric delta; positive is emerald, negative is red (flip with invertDelta). */
  delta?: number;
  deltaLabel?: string;
  sub?: string;
  /** Accent applied to icon + value (e.g. var(--emerald), var(--blue)). */
  accent?: string;
  invertDelta?: boolean;
  icon?: LucideIcon;
  onClick?: () => void;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function MetricTile({
  label,
  value,
  delta,
  deltaLabel,
  sub,
  accent,
  invertDelta = false,
  icon: Icon,
  onClick,
  className,
  id,
  style,
}: MetricTileProps): ReactElement {
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      id={id}
      onClick={onClick}
      className={cn(
        'flex-1 min-w-[130px] w-full text-left bg-[var(--surface-2)] border border-[var(--brand-border)]',
        'rounded-[var(--radius-signature)] px-[15px] py-[13px] transition-colors',
        onClick ? 'cursor-pointer hover:border-[var(--brand-border-hover)]' : 'cursor-default',
        className,
      )}
      style={{ transitionDuration: 'var(--dur-fast)', ...style }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && (
          <Icon
            className="w-[13px] h-[13px] flex-none"
            style={{ color: accent || 'var(--brand-text-dim)' }}
            aria-hidden="true"
          />
        )}
        <span className="t-caption text-[var(--brand-text-dim)]">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className="t-stat tabular-nums font-bold"
          style={{ color: accent || 'var(--brand-text-bright)' }}
        >
          {value}
        </span>
        {delta !== undefined && (
          <TrendBadge value={delta} invert={invertDelta} label={deltaLabel} suffix="" hideOnZero={false} />
        )}
      </div>
      {sub && <div className="t-caption-sm text-[var(--brand-text-dim)] mt-1">{sub}</div>}
    </Tag>
  );
}
