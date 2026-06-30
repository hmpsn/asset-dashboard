import { MetricRing, CompactStatBar, TrendBadge, SectionCard } from '../ui';
import type { OrientMetrics } from '../../../shared/types/keyword-strategy-ux';

interface OrientZoneProps {
  /** Server-computed Orient metrics (admin GET). When absent the zone renders nothing. */
  orient?: OrientMetrics;
}

const compact = (n: number) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** Signed delta string, e.g. "+1.2k" / "−3". Uses a real minus sign for display. */
function signed(n: number, fmt: (x: number) => string = compact): string {
  if (n === 0) return '0';
  return (n > 0 ? '+' : '−') + fmt(Math.abs(n));
}

/** Deterministic verdict from the score band + trend direction (no AI). */
function verdict(score: number, delta: number | null): string {
  const trend = delta == null || delta === 0 ? '' : delta > 0 ? ' and climbing' : ' and slipping';
  if (score >= 80) return `Strong search visibility${trend}.`;
  if (score >= 60) return `Building visibility — room to grow${trend}.`;
  return `Low visibility — needs attention${trend}.`;
}

// Emerald when the metric moved the good way, red the bad way, undefined when flat/unknown.
const upGood = (d: number | null): string | undefined =>
  d == null || d === 0 ? undefined : d > 0 ? 'text-emerald-400' : 'text-red-400';
const downGood = (d: number | null): string | undefined =>
  d == null || d === 0 ? undefined : d < 0 ? 'text-emerald-400' : 'text-red-400';
const subText = (d: number | null, fmt: (x: number) => string = compact): string | undefined =>
  d == null || d === 0 ? undefined : `${signed(d, fmt)} vs last`;

// Avg-position delta reads as a direction, not a signed number (a smaller position is better),
// so the lone inverted metric isn't a cognitive trap.
const positionSub = (d: number | null): string | undefined =>
  d == null || d === 0 ? undefined : `${d < 0 ? 'improved' : 'slipped'} ${Math.abs(d).toFixed(1)}`;

/**
 * Strategy v2 Orient zone — the "where the site sits" glance: a visibility-score
 * ring + a one-line verdict, above a 4-stat strip (clicks / impressions / ranked
 * keywords / avg position) with deltas vs the previous strategy generation.
 * Rendered in place of the legacy stat grid (the command-center layout is the baseline post-cutover).
 */
export function OrientZone({ orient }: OrientZoneProps) {
  if (!orient) return null;
  const { visibilityScore: score, visibilityScoreDelta: scoreDelta } = orient;
  const oneDp = (x: number) => x.toFixed(1);

  return (
    <div className="space-y-3">
      <SectionCard>
        <div className="flex items-center gap-5">
          <MetricRing score={score} size={120} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="t-label text-[var(--brand-text-muted)]">Visibility score</span>
              {scoreDelta != null && scoreDelta !== 0 && (
                <TrendBadge value={scoreDelta} suffix="" showSign label="vs last gen" />
              )}
            </div>
            <p className="t-body text-[var(--brand-text)] mt-1">{verdict(score, scoreDelta)}</p>
          </div>
        </div>
      </SectionCard>
      <CompactStatBar
        items={[
          { label: 'Clicks', value: compact(orient.clicks), valueColor: 'text-blue-400', sub: subText(orient.clicksDelta), subColor: upGood(orient.clicksDelta) },
          { label: 'Impressions', value: compact(orient.impressions), valueColor: 'text-blue-400', sub: subText(orient.impressionsDelta), subColor: upGood(orient.impressionsDelta) },
          { label: 'Ranked keywords', value: compact(orient.rankedKeywords), valueColor: 'text-blue-400', sub: subText(orient.rankedKeywordsDelta), subColor: upGood(orient.rankedKeywordsDelta) },
          { label: 'Avg position', value: orient.rankedKeywords > 0 ? `#${oneDp(orient.avgPosition)}` : '—', valueColor: 'text-blue-400', sub: positionSub(orient.avgPositionDelta), subColor: downGood(orient.avgPositionDelta) },
        ]}
      />
    </div>
  );
}
