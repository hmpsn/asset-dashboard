import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Globe2, MapPin, Plus, RefreshCw, Search, Settings2, Swords, XCircle } from 'lucide-react';
import type { LocalSeoKeywordVisibility, LocalSeoReadResponse, LocalSeoRepeatCompetitor, LocalSeoReportSummary, LocalSeoVisibilityPosture } from '../../../shared/types/local-seo';
import { LOCAL_SEO_VISIBILITY_POSTURE } from '../../../shared/types/local-seo';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';
import { useLocalSeo, useLocalSeoRefresh } from '../../hooks/admin';
import { useRankTrackingAddKeyword } from '../../hooks/admin/useKeywordCommandCenter';
import { useBackgroundTasks } from '../../hooks/useBackgroundTasks';
import { Badge, Button, ErrorState, Icon, IconButton, SectionCard, StatCard, cn } from '../ui';
import { CHART_SERIES_COLORS } from '../ui/constants';
import { GbpReviewsPanel } from './GbpReviewsPanel';
import { LocalSeoMarketSetupDrawer } from './LocalSeoMarketSetupDrawer';
import { LocalSeoVisibilityTrend } from './LocalSeoVisibilityTrend';

type LocalSeoVisibilityPanelMode = 'strategy' | 'keywords' | 'page';

interface LocalSeoVisibilityPanelProps {
  workspaceId: string;
  mode?: LocalSeoVisibilityPanelMode;
  onOpenKeywords?: () => void;
  showGbpReviews?: boolean;
}

const POSTURE_TONE: Record<LocalSeoVisibilityPosture, 'blue' | 'emerald' | 'amber' | 'red' | 'zinc'> = {
  [LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE]: 'emerald',
  [LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH]: 'amber',
  [LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE]: 'red',
  [LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT]: 'blue',
  [LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED]: 'amber',
};

function formatDate(value?: string): string {
  if (!value) return 'No refresh yet';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function postureLabel(posture: string): string {
  return posture.replace(/_/g, ' ');
}

function messageFromUnknown(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}

function setupToneFor(report: LocalSeoReportSummary): 'blue' | 'emerald' | 'amber' | 'zinc' {
  if (report.setupState === 'has_data') return 'emerald';
  if (report.setupState === 'ready_no_data') return 'blue';
  if (report.setupState === 'needs_market') return 'amber';
  return 'zinc';
}

export function localSeoVisibilityTone(visibility?: Pick<LocalSeoKeywordVisibility, 'posture'>): 'blue' | 'emerald' | 'amber' | 'red' | 'zinc' {
  if (!visibility) return 'zinc';
  return POSTURE_TONE[visibility.posture];
}

export function LocalSeoVisibilityBadge({ visibility, subtle = false }: { visibility?: LocalSeoKeywordVisibility; subtle?: boolean }) {
  if (!visibility) return null;
  return (
    <Badge
      label={visibility.label}
      tone={localSeoVisibilityTone(visibility)}
      variant={subtle ? 'soft' : 'outline'}
      shape="pill"
      ariaLabel={`Local SEO: ${visibility.label} in ${visibility.marketLabel}`}
    />
  );
}

function RepeatCompetitorList({
  competitors,
  onTrackKeyword,
  trackingPending,
  trackedKeywords,
  trackingErrors,
}: {
  competitors: LocalSeoRepeatCompetitor[];
  onTrackKeyword: (kw: string) => void;
  trackingPending: Set<string>;
  trackedKeywords: Set<string>;
  trackingErrors: Map<string, string>;
}) {
  if (competitors.length === 0) return null;
  return (
    <SectionCard title="Repeat Competitors">
      <div className="space-y-3">
        {competitors.map(competitor => (
          <div
            key={competitor.title}
            className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="t-caption font-semibold text-[var(--brand-text-bright)] truncate">{competitor.title}</p>
                {competitor.domain && (
                  <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">{competitor.domain}</p>
                )}
                <div className="flex items-center gap-3 mt-1">
                  <span className="t-caption-sm text-red-400/80 flex items-center gap-1">
                    <Icon as={Swords} size="xs" />
                    {competitor.winsAgainstClient} {competitor.winsAgainstClient === 1 ? 'loss' : 'losses'}
                  </span>
                  <span className="t-caption-sm text-blue-400">
                    {competitor.totalAppearances} appearances
                  </span>
                  {competitor.markets.length > 0 && (
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">
                      {competitor.markets.join(' · ')}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {competitor.suggestedTrackingKeywords.length > 0 && (
              <div className="flex flex-col gap-1 mt-2">
                {competitor.suggestedTrackingKeywords.map(kw => {
                  const isPending = trackingPending.has(kw);
                  const isTracked = trackedKeywords.has(kw);
                  const trackError = trackingErrors.get(kw);
                  return (
                    <div key={kw} className="flex flex-col gap-0.5">
                      <div className="inline-flex items-center gap-1.5">
                        <span className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-2 py-0.5 t-caption-sm text-[var(--brand-text-muted)]">
                          {kw}
                        </span>
                        {isTracked ? (
                          <span className="t-caption-sm text-accent-success font-medium">Tracked</span>
                        ) : (
                          <IconButton
                            onClick={() => onTrackKeyword(kw)}
                            title={isPending ? 'Adding...' : 'Track'}
                            label={isPending ? 'Adding...' : 'Track'}
                            icon={Plus}
                            size="sm"
                            variant="ghost"
                            disabled={isPending}
                            className={isPending ? 'text-[var(--brand-text-muted)] opacity-60' : 'text-[var(--brand-text-muted)] hover:text-accent-brand'}
                          />
                        )}
                      </div>
                      {trackError && (
                        <div role="alert" className="t-caption-sm text-accent-danger">{trackError}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function LocalSeoSetupCallout({
  report,
  error,
  refreshError,
}: {
  report: LocalSeoReportSummary;
  error: unknown;
  refreshError: unknown;
}) {
  return (
    <div className={cn(
      'rounded-[var(--radius-lg)] border px-4 py-3 flex items-start gap-3',
      report.setupState === 'has_data' || report.setupState === 'ready_no_data'
        ? 'border-blue-500/20 bg-blue-500/8'
        : report.setupState === 'needs_market'
          ? 'border-amber-500/20 bg-amber-500/8'
          : 'border-[var(--brand-border)] bg-[var(--surface-3)]/35',
    )}>
      <Icon
        as={report.setupState === 'has_data' ? CheckCircle2 : report.setupState === 'needs_market' ? AlertTriangle : Globe2}
        size="md"
        className={report.setupState === 'has_data' ? 'text-emerald-400/80' : report.setupState === 'needs_market' ? 'text-amber-400/80' : 'text-blue-400'}
      />
      <div>
        <p className="t-caption font-semibold text-[var(--brand-text-bright)]">{report.setupLabel}</p>
        <p className="t-caption-sm text-[var(--brand-text-muted)]">{report.setupDetail}</p>
        {Boolean(refreshError) && (
          <p className="t-caption-sm text-red-400/80 mt-1">
            {messageFromUnknown(refreshError, 'Local visibility refresh could not start.')}
          </p>
        )}
        {Boolean(error) && (
          <p className="t-caption-sm text-red-400/80 mt-1">
            Local visibility data could not load. Keyword and ranking data were not changed.
          </p>
        )}
      </div>
    </div>
  );
}

function LocalSeoStatGrid({ report, mode }: { report: LocalSeoReportSummary; mode: 'strategy' | 'keywords' }) {
  const hasDegradedResults = report.degradedCount > 0;
  const columns = hasDegradedResults
    ? mode === 'strategy' ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-2 lg:grid-cols-6'
    : mode === 'strategy' ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 lg:grid-cols-5';
  return (
    <div className={`grid ${columns} gap-3`}>
      <StatCard label="Markets" value={report.activeMarketCount} icon={MapPin} iconColor={CHART_SERIES_COLORS.blue} valueColor="text-blue-400" sub={`${report.configuredMarketCount} configured`} />
      <StatCard label="Checked" value={report.checkedKeywordCount} icon={Search} iconColor={CHART_SERIES_COLORS.blue} valueColor="text-blue-400" sub={formatDate(report.lastCapturedAt)} />
      <StatCard label="Visible" value={report.visibleCount} icon={CheckCircle2} iconColor={CHART_SERIES_COLORS.emerald} valueColor="text-emerald-400" sub="verified matches" />
      {mode === 'keywords' ? (
        <>
          <StatCard label="Possible" value={report.possibleMatchCount} icon={AlertTriangle} iconColor={CHART_SERIES_COLORS.amber} valueColor="text-amber-400/80" sub="needs review" />
          <StatCard label="Not Found" value={report.notVisibleCount} icon={XCircle} iconColor={CHART_SERIES_COLORS.red} valueColor="text-red-400/80" sub={`${report.localPackPresentCount} local packs`} />
        </>
      ) : (
        <StatCard label="Needs Review" value={report.possibleMatchCount + report.notVisibleCount} icon={AlertTriangle} iconColor={CHART_SERIES_COLORS.amber} valueColor="text-amber-400/80" sub={`${report.localPackPresentCount} local packs`} />
      )}
      {hasDegradedResults && (
        <StatCard label="Degraded" value={report.degradedCount} icon={AlertTriangle} iconColor={CHART_SERIES_COLORS.amber} valueColor="text-amber-400/80" sub="provider warnings" />
      )}
    </div>
  );
}

function LocalSeoMarketSummary({ data }: { data: LocalSeoReadResponse }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-3">
      <p className="t-label text-[var(--brand-text-muted)] mb-2">Markets</p>
      <div className="space-y-2">
        {data.markets.length === 0 ? (
          <p className="t-caption-sm text-[var(--brand-text-muted)]">No explicit markets configured yet.</p>
        ) : data.markets.map(market => (
          <div key={market.id} className="flex items-center justify-between gap-2">
            <span className="t-caption text-[var(--brand-text)] truncate">{market.label}</span>
            <Badge label={market.status.replace(/_/g, ' ')} tone={market.status === 'active' ? 'teal' : market.status === 'needs_review' ? 'amber' : 'zinc'} variant="outline" />
          </div>
        ))}
        {data.suggestedMarkets.length > 0 && (
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            Suggested: {data.suggestedMarkets.map(market => market.label).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}

function LocalSeoKeywordHandoff({ onOpenKeywords, compact = false }: { onOpenKeywords?: () => void; compact?: boolean }) {
  return (
    <div className={cn(
      'rounded-[var(--radius-lg)] border border-blue-500/20 bg-blue-500/8 p-3',
      compact && 'flex items-center justify-between gap-3',
    )}>
      <div>
        <p className="t-label text-blue-400 mb-2">Keyword visibility lives in Keywords</p>
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          Use the Keyword Command Center to inspect local candidates, visible keywords, possible matches, and not-visible opportunities.
        </p>
      </div>
      {onOpenKeywords && (
        <Button variant="secondary" size="sm" icon={Search} className={compact ? 'shrink-0' : 'mt-3'} onClick={onOpenKeywords}>
          View local keywords
        </Button>
      )}
    </div>
  );
}

function LocalSeoPageAnnotationPanel({
  report,
  onOpenKeywords,
}: {
  report: LocalSeoReportSummary;
  onOpenKeywords?: () => void;
}) {
  if (report.setupState !== 'needs_market' && report.checkedKeywordCount === 0) return null;

  const needsSetup = report.setupState === 'needs_market';
  return (
    <SectionCard
      title="Local visibility annotation"
      titleExtra={<Badge label="Page context" tone="blue" variant="soft" shape="pill" />}
      action={onOpenKeywords ? (
        <Button variant="secondary" size="sm" icon={Search} onClick={onOpenKeywords}>
          Open Keywords
        </Button>
      ) : undefined}
      variant="subtle"
    >
      <div className={cn(
        'rounded-[var(--radius-lg)] border px-4 py-3 flex items-start gap-3',
        needsSetup ? 'border-amber-500/20 bg-amber-500/8' : 'border-blue-500/20 bg-blue-500/8',
      )}>
        <Icon as={needsSetup ? AlertTriangle : MapPin} size="md" className={needsSetup ? 'text-amber-400/80' : 'text-blue-400'} />
        <div>
          <p className="t-caption font-semibold text-[var(--brand-text-bright)]">
            {needsSetup ? 'Local page annotations need a market' : 'Page rows show local evidence when it matches assigned keywords'}
          </p>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            {needsSetup
              ? 'Configure local markets from Strategy before Page Intelligence can annotate primary keywords with local visibility.'
              : `${report.checkedKeywordCount} local ${report.checkedKeywordCount === 1 ? 'keyword has' : 'keywords have'} market-specific evidence. Open Keywords for the full local lens.`}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

export function LocalSeoVisibilityPanel({ workspaceId, mode = 'keywords', onOpenKeywords, showGbpReviews = true }: LocalSeoVisibilityPanelProps) {
  const [setupOpen, setSetupOpen] = useState(false);
  const { data, isLoading, isError, error, refetch } = useLocalSeo(workspaceId);
  const refresh = useLocalSeoRefresh(workspaceId);
  const { findActiveJob } = useBackgroundTasks();
  const addKeywordMutation = useRankTrackingAddKeyword(workspaceId);
  const [trackingPending, setTrackingPending] = useState<Set<string>>(new Set());
  const [trackedKeywords, setTrackedKeywords] = useState<Set<string>>(new Set());
  const [trackingErrors, setTrackingErrors] = useState<Map<string, string>>(new Map());

  const handleTrackKeyword = async (kw: string) => {
    setTrackingPending(prev => new Set(prev).add(kw));
    setTrackingErrors(prev => { const m = new Map(prev); m.delete(kw); return m; });
    try {
      await addKeywordMutation.mutateAsync(kw);
      setTrackedKeywords(prev => new Set(prev).add(kw));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not add keyword. Try again.';
      setTrackingErrors(prev => new Map(prev).set(kw, msg));
    } finally {
      setTrackingPending(prev => { const s = new Set(prev); s.delete(kw); return s; });
    }
  };
  const activeRefreshJob = findActiveJob({
    type: BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH,
    workspaceId,
  });
  const refreshing = refresh.isPending || Boolean(activeRefreshJob);
  const title = mode === 'strategy'
    ? 'Local SEO Setup'
    : mode === 'page'
      ? 'Local visibility annotation'
      : 'Local Keyword Visibility';

  if (isLoading) {
    return (
      <SectionCard title={title} variant="subtle">
        <div className="flex items-center gap-2 text-[var(--brand-text-muted)] t-caption">
          <Icon as={RefreshCw} size="sm" className="animate-spin text-blue-400" />
          Loading local visibility posture...
        </div>
      </SectionCard>
    );
  }

  // First-load fetch failure: data is undefined and isError is true.
  // Must render an error state before the featureEnabled check so the panel
  // never silently vanishes on all three mount surfaces (Strategy, KCC, Page Intelligence).
  if (isError && !data) {
    return (
      <SectionCard title={title} variant="subtle">
        <ErrorState
          title="Local visibility unavailable"
          message="Local SEO data could not load. Keyword and ranking data were not changed."
          action={{ label: 'Try Again', onClick: () => { void refetch(); } }}
          type="network"
          className="py-4"
        />
      </SectionCard>
    );
  }

  if (!data?.featureEnabled) return null;

  const report = data.report;
  const canRefresh = report.activeMarketCount > 0 && report.workspacePosture !== 'non_local';
  const setupLabel = report.setupState === 'needs_market' ? 'Configure market' : data.markets.length > 0 ? 'Edit markets' : 'Configure market';
  const setupVariant = report.setupState === 'needs_market' ? 'primary' : 'ghost';
  const setupTone = setupToneFor(report);

  if (mode === 'page') {
    return <LocalSeoPageAnnotationPanel report={report} onOpenKeywords={onOpenKeywords} />;
  }

  return (
    <>
    <SectionCard
      title={title}
      titleExtra={
        <div className="flex items-center gap-2">
          <Badge label={postureLabel(report.workspacePosture)} tone={setupTone} variant="outline" shape="pill" />
          <Badge label="Admin only" tone="zinc" variant="soft" shape="pill" />
        </div>
      }
      action={
        <div className="flex items-center gap-2">
          <Button
            variant={setupVariant}
            size="sm"
            icon={Settings2}
            onClick={() => setSetupOpen(true)}
          >
            {setupLabel}
          </Button>
          {onOpenKeywords && (
            <Button variant="ghost" size="sm" icon={Search} onClick={onOpenKeywords}>
              View local keywords
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={refreshing ? undefined : RefreshCw}
            loading={refreshing}
            disabled={!canRefresh || refreshing}
            title={!canRefresh ? report.setupDetail : 'Refresh local-pack visibility through the background job system.'}
            onClick={() => refresh.mutate({})}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      }
      variant="subtle"
    >
      <div className="space-y-4">
        <LocalSeoSetupCallout report={report} error={error} refreshError={refresh.error} />
        <LocalSeoStatGrid report={report} mode={mode} />
        <LocalSeoVisibilityTrend series={data.visibilityTrend} />

        {mode === 'strategy' && (
          <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
            <LocalSeoMarketSummary data={data} />
            <LocalSeoKeywordHandoff compact />
          </div>
        )}

        {mode === 'keywords' && (
          <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
            <LocalSeoMarketSummary data={data} />
            <LocalSeoKeywordHandoff onOpenKeywords={onOpenKeywords} />
          </div>
        )}
      </div>
      <LocalSeoMarketSetupDrawer
        workspaceId={workspaceId}
        data={data}
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
      />
    </SectionCard>
    {mode === 'keywords' && (report.setupState === 'has_data' || report.setupState === 'ready_no_data') && data.competitorBrands.length > 0 && (
      <RepeatCompetitorList
        competitors={data.competitorBrands}
        onTrackKeyword={handleTrackKeyword}
        trackingPending={trackingPending}
        trackedKeywords={trackedKeywords}
        trackingErrors={trackingErrors}
      />
    )}
    {/* SEO Decision Engine P7 (local-gbp): GBP + reviews readout. Self-gates on data presence
        (server returns an empty payload when the flag is off), so this renders nothing until a
        GBP refresh has captured listings. */}
    {mode === 'keywords' && showGbpReviews && <GbpReviewsPanel workspaceId={workspaceId} />}
    </>
  );
}
