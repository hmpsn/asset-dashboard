import type { ReactElement } from 'react';

import type { LocalSeoVisibilityTrendSeries } from '../../../shared/types/local-seo';
import { CHART_SERIES_COLORS } from '../ui/constants';
import { TrendBadge } from '../ui/TrendBadge';
import { formatDateShort } from '../../utils/formatDates';

/**
 * Compact visible-count sparkline for a single market's local-pack trend.
 *
 * Four Laws: blue data line + endpoint dot (`CHART_SERIES_COLORS.blue`) — this is a
 * read-only data metric (count of verified local-pack matches over time), never an
 * action, so blue is correct (Law 2 — blue for data). Higher = better (more visible),
 * so the Y-axis is NOT inverted (unlike the rank-position sparkline).
 *
 * Returns null when fewer than 2 points exist (a trend needs two captures).
 */
function VisibleCountSparkline({
  points,
  width = 180,
  height = 36,
}: {
  points: Array<{ date: string; visibleCount: number }>;
  width?: number;
  height?: number;
}): ReactElement | null {
  if (points.length < 2) return null;

  const W = width, H = height, P = 4;
  const counts = points.map(p => p.visibleCount);
  const min = Math.min(...counts), max = Math.max(...counts);
  const range = max - min || 1;

  const pts = points.map((p, i) => ({
    x: P + (i / (points.length - 1)) * (W - P * 2),
    // Higher count = higher on chart → invert the normalized value against H.
    y: P + (1 - (p.visibleCount - min) / range) * (H - P * 2),
  }));
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];

  return (
    <svg width={W} height={H} className="flex-shrink-0" aria-hidden="true">
      <path d={pathD} fill="none" stroke={CHART_SERIES_COLORS.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="2.5" fill={CHART_SERIES_COLORS.blue} />
    </svg>
  );
}

export interface LocalSeoVisibilityTrendProps {
  series: LocalSeoVisibilityTrendSeries[];
}

/**
 * Per-market visible-count trend over the retained snapshot window (W5.3).
 *
 * Surfaces the otherwise write-only local_visibility_snapshots time series as a small
 * read-only trend: one row per market with a count sparkline + a TrendBadge showing the
 * change in visible count from the first to the most recent capture in the window.
 *
 * Renders nothing when no market has at least two data points (no trend to show).
 */
export function LocalSeoVisibilityTrend({ series }: LocalSeoVisibilityTrendProps): ReactElement | null {
  const renderable = series.filter(s => s.points.length >= 2);
  if (renderable.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="t-caption font-semibold text-[var(--brand-text-bright)]">Visibility trend</p>
        <p className="t-caption-sm text-[var(--brand-text-muted)]">Verified local-pack matches over time</p>
      </div>
      <div className="space-y-2">
        {renderable.map(s => {
          const first = s.points[0];
          const latest = s.points[s.points.length - 1];
          const delta = latest.visibleCount - first.visibleCount;
          return (
            <div
              key={s.marketId}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--surface-3)] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="t-caption font-medium text-[var(--brand-text-bright)] truncate">{s.marketLabel}</p>
                <p className="t-caption-sm text-[var(--brand-text-muted)]">
                  {formatDateShort(first.date)} – {formatDateShort(latest.date)} · {latest.visibleCount}/{latest.checkedCount} visible
                </p>
              </div>
              <div className="flex items-center gap-3">
                <VisibleCountSparkline points={s.points} />
                <TrendBadge value={delta} suffix="" showSign label="vs start" hideOnZero={false} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
