import { Bot, Globe, RefreshCw, Users } from 'lucide-react';

import type {
  AiVisibilityCompetitor,
  AiVisibilitySourceDomain,
  AiVisibilityTrendPoint,
} from '../../api/seo';
import { useAiVisibility, useAiVisibilityRefresh } from '../../hooks/admin/useAiVisibility';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { FeatureFlag } from '../ui/FeatureFlag';
import { Badge, Button, EmptyState, Icon, MetricRing, SectionCard, StatCard } from '../ui';
import { CHART_SERIES_COLORS, scoreColorClass } from '../ui/constants';

/**
 * Admin AI-visibility (LLM-mention) KPI readout (SEO Decision Engine P8 / ai-visibility).
 * Aggregates ONLY — own share-of-voice in AI answers (a 0–100 SCORE → scoreColorClass,
 * emerald/amber/red, Law 03), the mention volume + the dated mention-volume trend (read-only
 * DATA → blue, Law 02 — the before/after AEO proof), the co-mentioned competitor breakdown,
 * and the cited source-domain AEO targets. NO purple/violet/indigo anywhere.
 *
 * The server read endpoint returns an empty payload (`latest: null`) when the `ai-visibility`
 * flag is off, so the panel simply renders nothing in that case. The "Refresh AI visibility"
 * trigger is itself flag-gated (mirrors P6/P7) and wired to useAiVisibilityRefresh.
 */

/** Compact mentions-over-time sparkline — the before/after AEO proof. Blue DATA line (Law 02).
 *  Returns null with <2 points (a trend needs two snapshots). */
function MentionsTrendSparkline({ trend }: { trend: AiVisibilityTrendPoint[] }) {
  if (trend.length < 2) return null;

  const W = 220;
  const H = 44;
  const P = 4;
  const mentions = trend.map(point => point.mentions);
  const min = Math.min(...mentions);
  const max = Math.max(...mentions);
  const range = max - min || 1;

  const pts = trend.map((point, i) => ({
    x: P + (i / (trend.length - 1)) * (W - P * 2),
    // Higher mentions = higher on chart (invert y).
    y: P + (1 - (point.mentions - min) / range) * (H - P * 2),
  }));
  const pathD = pts.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const first = trend[0];
  const latest = trend[trend.length - 1];
  const delta = latest.mentions - first.mentions;
  const deltaTone = delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-[var(--brand-text-muted)]';

  return (
    <div className="flex items-center gap-4">
      <svg width={W} height={H} className="flex-shrink-0" aria-label="Mention volume over time">
        <path d={pathD} fill="none" stroke={CHART_SERIES_COLORS.blue} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last.x} cy={last.y} r="2.5" fill={CHART_SERIES_COLORS.blue} />
      </svg>
      <div className="t-caption-sm text-[var(--brand-text-muted)] space-y-0.5">
        <div>{trend.length} snapshots</div>
        <div className={deltaTone}>
          {delta > 0 ? '+' : ''}{delta.toLocaleString()} mentions since first snapshot
        </div>
      </div>
    </div>
  );
}

function CompetitorRow({ competitor }: { competitor: AiVisibilityCompetitor }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="t-caption font-medium text-[var(--brand-text-bright)] truncate min-w-0">{competitor.name}</p>
      {/* Mention counts are read-only DATA → blue (Law 02). */}
      <p className="t-caption font-semibold text-blue-400 tabular-nums shrink-0">
        {competitor.mentions.toLocaleString()}
      </p>
    </div>
  );
}

function SourceDomainRow({ source }: { source: AiVisibilitySourceDomain }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="t-caption text-[var(--brand-text-bright)] truncate min-w-0">{source.domain}</p>
      <p className="t-caption font-semibold text-blue-400 tabular-nums shrink-0">
        {source.mentions.toLocaleString()}
      </p>
    </div>
  );
}

export function AiVisibilityPanel({ workspaceId }: { workspaceId: string }) {
  const { data } = useAiVisibility(workspaceId);
  const refresh = useAiVisibilityRefresh(workspaceId);

  const flagOn = useFeatureFlag('ai-visibility');
  const latest = data?.latest ?? null;
  const trend = data?.trend ?? [];
  const competitors = data?.competitors ?? [];
  const sourceDomains = data?.sourceDomains ?? [];

  const refreshButton = (
    <FeatureFlag flag="ai-visibility">
      <Button
        variant="secondary"
        size="sm"
        icon={refresh.isPending ? undefined : RefreshCw}
        loading={refresh.isPending}
        disabled={refresh.isPending}
        onClick={() => refresh.mutate()}
      >
        {refresh.isPending ? 'Refreshing...' : 'Refresh AI visibility'}
      </Button>
    </FeatureFlag>
  );

  // Surface a failed refresh (mirrors P6's actionErrorMessage band). The route throws an
  // ApiError on 403 (tier) / 404 (flag) / 409 (already-running) — without this band every
  // failure was swallowed and the click looked dead.
  const refreshError = refresh.error instanceof Error ? refresh.error.message : null;
  const errorBand = refreshError ? (
    <div role="alert" className="rounded-[var(--radius-xl)] border border-red-500/40 bg-red-500/10 px-4 py-3">
      <p className="t-caption font-semibold text-red-400">{refreshError}</p>
    </div>
  ) : null;

  // No snapshot yet. With the flag OFF the panel stays hidden (the server also returns an
  // empty payload then). With the flag ON, render the card with JUST the refresh trigger +
  // an empty state — otherwise the bootstrap button lives below this return and the feature
  // could never be kicked off from the UI (chicken-and-egg: no data hides the button that
  // fetches the first data).
  if (!latest) {
    if (!flagOn) return null;
    return (
      <SectionCard
        title="AI visibility"
        titleExtra={<Badge label="Admin only" tone="zinc" variant="soft" shape="pill" />}
        action={refreshButton}
        variant="subtle"
      >
        <div className="space-y-4">
          {errorBand}
          <EmptyState
            icon={Bot}
            title="No AI-visibility data yet"
            description="Connect a live domain first, then run a refresh to capture how often your brand is cited in AI answers."
          />
        </div>
      </SectionCard>
    );
  }

  // shareOfVoice is 0..1 in the store; the headline is a 0–100 SCORE. UNDEFINED/null = "not
  // measured" (the client's brand wasn't identifiable among co-mentioned brands) — show that
  // distinctly, NOT a red 0% that reads as broken next to a high mention count (P8 review).
  const sovMeasured = latest.shareOfVoice != null;
  const sovScore = Math.round((latest.shareOfVoice ?? 0) * 100);
  const mentions = latest.mentions ?? 0;

  return (
    <SectionCard
      title="AI visibility"
      titleExtra={<Badge label="Admin only" tone="zinc" variant="soft" shape="pill" />}
      action={refreshButton}
      variant="subtle"
    >
      <div className="space-y-4">
        {errorBand}
        {/* Headline: share-of-voice score ring + mention-volume StatCard + trend. */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            {sovMeasured ? (
              <>
                {/* Share of voice is a SCORE → emerald/amber/red via the ring's scoreColor (Law 03). */}
                <MetricRing score={sovScore} size={96} noAnimation />
                <div>
                  <p className={`t-h2 font-semibold tabular-nums ${scoreColorClass(sovScore)}`}>{sovScore}%</p>
                  {/* Clarify the two axes: share is measured among co-mentioned BRANDS, not citations. */}
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">share of voice vs co-mentioned brands</p>
                </div>
              </>
            ) : (
              <div>
                <p className="t-h2 font-semibold tabular-nums text-[var(--brand-text-muted)]">—</p>
                <p className="t-caption-sm text-[var(--brand-text-muted)]">
                  share of voice not measured yet (brand not identified among AI-co-mentioned brands)
                </p>
              </div>
            )}
          </div>
          <div className="sm:ml-auto">
            {/* Mention volume is read-only DATA → blue (Law 02). */}
            <StatCard
              label="Mentions in AI answers"
              value={mentions.toLocaleString()}
              icon={Bot}
              iconColor={CHART_SERIES_COLORS.blue}
              valueColor="text-blue-400"
            />
          </div>
        </div>

        {trend.length >= 2 && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-3">
            <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">Mention volume over time</p>
            <MentionsTrendSparkline trend={trend} />
          </div>
        )}

        {competitors.length > 0 && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Icon as={Users} size="xs" className="text-[var(--brand-text-muted)]" />
              <p className="t-caption-sm text-[var(--brand-text-muted)]">Co-mentioned competitors</p>
            </div>
            <div className="space-y-2">
              {competitors.slice(0, 5).map(competitor => (
                <CompetitorRow key={competitor.name} competitor={competitor} />
              ))}
            </div>
          </div>
        )}

        {sourceDomains.length > 0 && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Icon as={Globe} size="xs" className="text-[var(--brand-text-muted)]" />
              <p className="t-caption-sm text-[var(--brand-text-muted)]">Cited source domains (AEO targets)</p>
            </div>
            <div className="space-y-2">
              {sourceDomains.slice(0, 5).map(source => (
                <SourceDomainRow key={source.domain} source={source} />
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
