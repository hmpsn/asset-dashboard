import { AlertTriangle, CheckCircle2, Globe2, MapPin, RefreshCw, Search, XCircle } from 'lucide-react';
import type { LocalSeoKeywordVisibility, LocalSeoReadResponse, LocalSeoVisibilityPosture, LocalVisibilitySnapshot } from '../../../shared/types/local-seo';
import { LOCAL_SEO_VISIBILITY_POSTURE, localSeoKeywordVisibilityFromSnapshot } from '../../../shared/types/local-seo';
import { useLocalSeo, useLocalSeoRefresh } from '../../hooks/admin';
import { Badge, Button, EmptyState, Icon, SectionCard, StatCard, cn } from '../ui';

interface LocalSeoVisibilityPanelProps {
  workspaceId: string;
  compact?: boolean;
  onOpenKeywords?: () => void;
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

function SnapshotList({ snapshots }: { snapshots: LocalSeoKeywordVisibility[] }) {
  if (snapshots.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No local visibility snapshots yet"
        description="Run a refresh after markets are configured to see market-specific local-pack evidence."
      />
    );
  }

  return (
    <div className="space-y-2">
      {snapshots.slice(0, 6).map(snapshot => (
        <div
          key={`${snapshot.marketId}-${snapshot.normalizedKeyword}`}
          className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 px-3 py-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="t-caption font-semibold text-[var(--brand-text-bright)] truncate">{snapshot.keyword}</p>
              <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">
                {snapshot.marketLabel} · {snapshot.sourceEndpoint.replace(/_/g, ' ')}
              </p>
            </div>
            <LocalSeoVisibilityBadge visibility={snapshot} />
          </div>
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">{snapshot.detail}</p>
        </div>
      ))}
    </div>
  );
}

export function localSeoVisibilityFromSnapshot(snapshot: LocalVisibilitySnapshot): LocalSeoKeywordVisibility {
  return localSeoKeywordVisibilityFromSnapshot(snapshot);
}

function latestVisibility(data: LocalSeoReadResponse): LocalSeoKeywordVisibility[] {
  const seen = new Set<string>();
  const rows: LocalSeoKeywordVisibility[] = [];
  for (const snapshot of data.latestSnapshots) {
    const key = `${snapshot.marketId}:${snapshot.normalizedKeyword}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(localSeoVisibilityFromSnapshot(snapshot));
  }
  return rows;
}

export function LocalSeoVisibilityPanel({ workspaceId, compact = false, onOpenKeywords }: LocalSeoVisibilityPanelProps) {
  const { data, isLoading, error } = useLocalSeo(workspaceId);
  const refresh = useLocalSeoRefresh(workspaceId);

  if (isLoading) {
    return (
      <SectionCard title="Local SEO Visibility" variant="subtle">
        <div className="flex items-center gap-2 text-[var(--brand-text-muted)] t-caption">
          <Icon as={RefreshCw} size="sm" className="animate-spin text-blue-400" />
          Loading local visibility posture...
        </div>
      </SectionCard>
    );
  }

  if (!data?.featureEnabled) return null;

  const report = data.report;
  const snapshots = latestVisibility(data);
  const canRefresh = report.activeMarketCount > 0 && report.workspacePosture !== 'non_local';
  const setupTone = report.setupState === 'has_data'
    ? 'emerald'
    : report.setupState === 'ready_no_data'
      ? 'blue'
      : report.setupState === 'needs_market'
        ? 'amber'
        : 'zinc';

  return (
    <SectionCard
      title="Local SEO Visibility"
      titleExtra={
        <div className="flex items-center gap-2">
          <Badge label={postureLabel(report.workspacePosture)} tone={setupTone} variant="outline" shape="pill" />
          <Badge label="Admin only" tone="zinc" variant="soft" shape="pill" />
        </div>
      }
      action={
        <div className="flex items-center gap-2">
          {onOpenKeywords && (
            <Button variant="ghost" size="sm" icon={Search} onClick={onOpenKeywords}>
              Keywords
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={refresh.isPending ? undefined : RefreshCw}
            loading={refresh.isPending}
            disabled={!canRefresh || refresh.isPending}
            title={!canRefresh ? report.setupDetail : 'Refresh local-pack visibility through the background job system.'}
            onClick={() => refresh.mutate({})}
          >
            {refresh.isPending ? 'Starting...' : 'Refresh'}
          </Button>
        </div>
      }
      variant="subtle"
    >
      <div className="space-y-4">
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
            {refresh.error && (
              <p className="t-caption-sm text-red-400/80 mt-1">
                {refresh.error instanceof Error ? refresh.error.message : 'Local visibility refresh could not start.'}
              </p>
            )}
            {error && (
              <p className="t-caption-sm text-red-400/80 mt-1">
                Local visibility data could not load. Keyword and ranking data were not changed.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard label="Markets" value={report.activeMarketCount} icon={MapPin} iconColor="#60a5fa" valueColor="text-blue-400" sub={`${report.configuredMarketCount} configured`} />
          <StatCard label="Checked" value={report.checkedKeywordCount} icon={Search} iconColor="#60a5fa" valueColor="text-blue-400" sub={formatDate(report.lastCapturedAt)} />
          <StatCard label="Visible" value={report.visibleCount} icon={CheckCircle2} iconColor="#34d399" valueColor="text-emerald-400" sub="verified matches" />
          <StatCard label="Possible" value={report.possibleMatchCount} icon={AlertTriangle} iconColor="#fbbf24" valueColor="text-amber-400/80" sub="needs review" />
          <StatCard label="Not Found" value={report.notVisibleCount} icon={XCircle} iconColor="#f87171" valueColor="text-red-400/80" sub={`${report.localPackPresentCount} local packs`} />
        </div>

        {!compact && (
          <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
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
            <SnapshotList snapshots={snapshots} />
          </div>
        )}
      </div>
    </SectionCard>
  );
}
