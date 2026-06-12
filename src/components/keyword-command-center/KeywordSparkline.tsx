import type { ReactElement } from 'react';

import { CHART_SERIES_COLORS } from '../ui/constants';
import { formatDateShort } from '../../utils/formatDates';

export interface KeywordSparklineProps {
  data: Array<{ date: string; position: number }>;
  width?: number;
  height?: number;
}

/**
 * Compact position-over-time sparkline for a single keyword.
 *
 * Originally extracted from the (now-retired) standalone Rank Tracker's
 * file-private `PositionSparkline` (the SVG math was copied verbatim). It is now
 * the canonical sparkline, consumed by the Keyword Hub detail drawer.
 *
 * Four Laws: blue data line + endpoint dot (`CHART_SERIES_COLORS.blue`);
 * improvement delta = emerald-400; regression delta = red-400.
 *
 * Returns `null` when fewer than 2 points exist (a trend needs two snapshots).
 * Y-axis is inverted: a lower position number sits higher on the chart.
 */
export function KeywordSparkline({
  data,
  width = 200,
  height = 40,
}: KeywordSparklineProps): ReactElement | null {
  if (data.length < 2) return null;

  const W = width, H = height, P = 4;
  const positions = data.map(d => d.position);
  const min = Math.min(...positions), max = Math.max(...positions);
  const range = max - min || 1;

  const pts = data.map((d, i) => ({
    x: P + (i / (data.length - 1)) * (W - P * 2),
    y: P + ((d.position - min) / range) * (H - P * 2), // lower position = higher on chart
  }));
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const first = data[0], latest = data[data.length - 1];
  const improved = latest.position < first.position;
  const dateRange = `${formatDateShort(first.date)} – ${formatDateShort(latest.date)}`;

  return (
    <div className="flex items-center gap-4">
      <svg width={W} height={H} className="flex-shrink-0">
        <path d={pathD} fill="none" stroke={CHART_SERIES_COLORS.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last.x} cy={last.y} r="2.5" fill={CHART_SERIES_COLORS.blue} />
      </svg>
      <div className="t-caption-sm text-[var(--brand-text-muted)] space-y-0.5">
        <div>Best: <span className="text-emerald-400 font-medium">#{min.toFixed(1)}</span> · Worst: <span className="text-red-400 font-medium">#{max.toFixed(1)}</span></div>
        <div className="flex items-center gap-1">
          <span>{data.length} snapshots</span>
          <span className="text-[var(--brand-border-hover)]">·</span>
          <span>{dateRange}</span>
        </div>
        <div className={improved ? 'text-emerald-400' : latest.position > first.position ? 'text-red-400' : 'text-[var(--brand-text-muted)]'}>
          {improved ? '↑' : latest.position > first.position ? '↓' : '—'} {Math.abs(latest.position - first.position).toFixed(1)} positions over period
        </div>
      </div>
    </div>
  );
}
