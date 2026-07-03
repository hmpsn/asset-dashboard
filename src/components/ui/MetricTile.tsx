// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';

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

export function MetricTile(_props: MetricTileProps): ReactElement {
  throw new Error('F3 stub — MetricTile not yet implemented (Lane B)');
}
