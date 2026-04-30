// CLIENT-FACING
import type { ReactNode } from 'react';
import { Shield, Users, MousePointerClick, Target } from 'lucide-react';
import { SectionCard, StatCard, MetricRing, Skeleton } from '../../ui';
import { fmtNum } from '../../../utils/formatNumbers';

export interface PulseStripData {
  siteHealth: {
    score: number | null;
    /** Points vs previous score (e.g., -2). */
    delta: number | null;
  };
  visitors: {
    current: number | null;
    /** Already a percentage, e.g. 6.8 for +6.8%. Do NOT multiply by 100. */
    deltaPercent: number | null;
  };
  clicks: {
    current: number | null;
    /** Already a percentage. Do NOT multiply by 100. */
    deltaPercent: number | null;
  };
  impressions: {
    current: number | null;
    /** Already a percentage. Do NOT multiply by 100. */
    deltaPercent: number | null;
  };
  avgPosition: {
    /** e.g., 15.1 */
    current: number | null;
    /** Positions improved: positive = lower number = better. */
    delta: number | null;
  };
}

interface PulseStripProps {
  data: PulseStripData | null;
  isLoading?: boolean;
}

/** Fallback skeleton cell rendered when isLoading=true */
function PulseSkeletonCell() {
  return (
    <div className="flex flex-col gap-2 p-3 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)]">
      <Skeleton className="w-16 h-2.5" />
      <Skeleton className="w-20 h-6" />
      <Skeleton className="w-12 h-2" />
    </div>
  );
}

/**
 * PulseStrip — 4-cell horizontal strip of live vital signs.
 * Sits between the Action Queue and Hero Story Card in the weekly briefing.
 *
 * Cells: Site Health (MetricRing), Visitors, Clicks/Impressions, Avg Position.
 * Mobile: 1-col stack. sm: 2-col. md+: 4-col.
 */
export function PulseStrip({ data, isLoading }: PulseStripProps): ReactNode {
  // Loading state: render 4 skeleton cells
  if (data === null && isLoading) {
    return (
      <SectionCard
        title="THE PULSE"
        variant="subtle"
        titleExtra={
          <span className="t-caption-sm text-[var(--brand-text-muted)]">vs prev 28d</span>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <PulseSkeletonCell />
          <PulseSkeletonCell />
          <PulseSkeletonCell />
          <PulseSkeletonCell />
        </div>
      </SectionCard>
    );
  }

  // No data, not loading — parent decides whether to show or omit
  if (data === null) return null;

  const { siteHealth, visitors, clicks, impressions, avgPosition } = data;

  // Format helpers
  const fmtVal = (n: number | null) => (n !== null ? fmtNum(n) : '—');
  const fmtDeltaPct = (d: number | null) =>
    d !== null ? parseFloat(d.toFixed(1)) : undefined;

  // Clicks / Impressions cell: show impressions as sub text
  const clicksValue = clicks.current !== null ? fmtNum(clicks.current) : '—';
  const impressionsSub =
    impressions.current !== null ? `${fmtNum(impressions.current)} impr` : undefined;

  // Avg position: only show delta if data is available
  const avgPosValue =
    avgPosition.current !== null ? `#${avgPosition.current.toFixed(1)}` : '—';
  const avgPosDelta =
    avgPosition.delta !== null ? Math.round(avgPosition.delta) : undefined;

  return (
    <SectionCard
      title="THE PULSE"
      variant="subtle"
      titleExtra={
        <span className="t-caption-sm text-[var(--brand-text-muted)]">vs prev 28d</span>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">

        {/* Cell 1 — Site Health */}
        <div
          className="flex items-center gap-3 bg-[var(--surface-2)] border border-[var(--brand-border)] p-4 rounded-[var(--radius-lg)]"
          aria-label="Site health score"
        >
          {siteHealth.score !== null ? (
            <>
              <MetricRing score={siteHealth.score} size={56} noAnimation />
              <div className="flex flex-col min-w-0">
                <span className="t-label text-[var(--brand-text-muted)]">SITE HEALTH</span>
                {siteHealth.delta !== null && siteHealth.delta !== 0 && (
                  <span
                    className={`t-caption-sm font-medium ${
                      siteHealth.delta > 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {siteHealth.delta > 0 ? '+' : ''}
                    {siteHealth.delta} pts
                  </span>
                )}
                {siteHealth.delta === 0 && (
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">No change</span>
                )}
              </div>
            </>
          ) : (
            <>
              <div
                className="flex items-center justify-center rounded-full bg-[var(--surface-3)]/40"
                style={{ width: 56, height: 56 }}
              >
                <Shield className="w-5 h-5 text-[var(--brand-text-muted)]" aria-hidden="true" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="t-label text-[var(--brand-text-muted)]">SITE HEALTH</span>
                <span className="text-2xl font-bold leading-none text-[var(--brand-text-muted)]">—</span>
              </div>
            </>
          )}
        </div>

        {/* Cell 2 — Visitors */}
        <StatCard
          size="hero"
          label="VISITORS"
          value={fmtVal(visitors.current)}
          valueColor="text-blue-400"
          delta={fmtDeltaPct(visitors.deltaPercent)}
          deltaLabel="%"
          icon={Users}
          iconColor="var(--brand-text-muted)"
        />

        {/* Cell 3 — Clicks / Impressions */}
        <StatCard
          size="hero"
          label="CLICKS"
          value={clicksValue}
          valueColor="text-blue-400"
          delta={fmtDeltaPct(clicks.deltaPercent)}
          deltaLabel="%"
          sub={impressionsSub}
          icon={MousePointerClick}
          iconColor="var(--brand-text-muted)"
        />

        {/* Cell 4 — Avg Position */}
        <StatCard
          size="hero"
          label="AVG POSITION"
          value={avgPosValue}
          valueColor="text-blue-400"
          delta={avgPosDelta}
          deltaLabel="Δ"
          invertDelta
          icon={Target}
          iconColor="var(--brand-text-muted)"
        />

      </div>
    </SectionCard>
  );
}
