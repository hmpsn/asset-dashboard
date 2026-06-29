import { useNavigate, useSearchParams } from 'react-router-dom';
import { BarChart3, ClipboardList, MapPin, Settings2, Star } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { adminPath } from '../../routes';
import { useGbpReviews, useLocalSeo } from '../../hooks/admin';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { Badge, Button, EmptyState, Icon, PageHeader, SectionCard, StatCard, TabBar } from '../ui';
import { GbpReviewsPanel } from './GbpReviewsPanel';
import { LocalSeoVisibilityPanel } from './LocalSeoVisibilityPanel';
import { FeatureFlag } from '../ui/FeatureFlag';
import { GbpMappingStatusBlock } from '../google-business-profile/GbpMappingStatusBlock';

type LocalPresenceTab = 'overview' | 'visibility' | 'reviews' | 'setup';

const LOCAL_PRESENCE_TABS: Array<{ id: LocalPresenceTab; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: MapPin },
  { id: 'visibility', label: 'Visibility', icon: BarChart3 },
  { id: 'reviews', label: 'Reviews', icon: Star },
  { id: 'setup', label: 'Setup', icon: Settings2 },
];

function resolveTab(value: string | null): LocalPresenceTab {
  return LOCAL_PRESENCE_TABS.some(tab => tab.id === value) ? value as LocalPresenceTab : 'overview';
}

function formatDate(value?: string | null): string {
  if (!value) return 'No refresh yet';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function setupTone(setupState?: string): 'blue' | 'emerald' | 'amber' | 'zinc' {
  if (setupState === 'has_data') return 'emerald';
  if (setupState === 'ready_no_data') return 'blue';
  if (setupState === 'needs_market') return 'amber';
  return 'zinc';
}

function OverviewPanel({ workspaceId }: { workspaceId: string }) {
  const [, setSearchParams] = useSearchParams();
  const { data, isLoading } = useLocalSeo(workspaceId);
  const { data: gbp } = useGbpReviews(workspaceId);
  const gbpEnabled = useFeatureFlag('local-gbp');
  const report = data?.report;
  const owned = gbpEnabled ? gbp?.owned ?? null : null;
  const topCompetitor = gbpEnabled ? gbp?.competitors?.[0] : null;

  if (isLoading && !data) {
    return (
      <SectionCard title="Local presence snapshot" variant="subtle">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-[88px] rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-3)]/30 animate-pulse" />
          ))}
        </div>
      </SectionCard>
    );
  }

  if (!data?.featureEnabled || !report) {
    return (
      <SectionCard title="Local presence snapshot" variant="subtle">
        <EmptyState
          icon={MapPin}
          title="Local presence is not configured yet"
          description="Set local markets and locations before tracking local visibility."
          action={
            <Button size="sm" onClick={() => setSearchParams({ tab: 'setup' })}>
              Open setup
            </Button>
          }
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Markets" value={report.activeMarketCount} icon={MapPin} iconColor="#60a5fa" valueColor="text-blue-400" sub={`${report.configuredMarketCount} configured`} />
        <StatCard label="Checked" value={report.checkedKeywordCount} icon={BarChart3} iconColor="#60a5fa" valueColor="text-blue-400" sub={formatDate(report.lastCapturedAt)} />
        <StatCard label="Visible" value={report.visibleCount} icon={MapPin} iconColor="#34d399" valueColor="text-emerald-400" sub="verified local matches" />
        {gbpEnabled ? (
          <StatCard label="Review count" value={owned?.reviewCount ?? '-'} icon={Star} iconColor="#60a5fa" valueColor="text-blue-400" sub={owned?.rating ? `${owned.rating.toFixed(1)} star average` : 'GBP aggregate'} />
        ) : (
          <StatCard label="Local packs" value={report.localPackPresentCount} icon={MapPin} iconColor="#60a5fa" valueColor="text-blue-400" sub="packs detected" />
        )}
      </div>

      <SectionCard
        title="Local operating status"
        titleExtra={<Badge label={report.workspacePosture.replace(/_/g, ' ')} tone={setupTone(report.setupState)} variant="outline" shape="pill" />}
        variant="subtle"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-4">
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-4">
            <p className="t-caption font-semibold text-[var(--brand-text-bright)]">{report.setupLabel}</p>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">{report.setupDetail}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {data.markets.slice(0, 4).map(market => (
                <Badge
                  key={market.id}
                  label={market.label}
                  tone={market.status === 'active' ? 'teal' : market.status === 'needs_review' ? 'amber' : 'zinc'}
                  variant="soft"
                  shape="pill"
                />
              ))}
              {data.markets.length === 0 && <Badge label="No markets" tone="zinc" variant="soft" shape="pill" />}
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-blue-500/20 bg-blue-500/8 p-4">
            <p className="t-label text-blue-400 mb-2">{gbpEnabled ? 'Reviews vs competitors' : 'Local pack coverage'}</p>
            <p className="t-caption-sm text-[var(--brand-text-muted)]">
              {gbpEnabled ? owned
                ? `${owned.title ?? 'Your listing'} has ${owned.reviewCount ?? 'no'} reviews${topCompetitor?.reviewCount != null ? `; the local leader has ${topCompetitor.reviewCount}.` : '.'}`
                : 'Run a GBP + reviews refresh to capture your listing aggregate.'
                : `${report.localPackPresentCount} local packs appeared across ${report.checkedKeywordCount} checked local ${report.checkedKeywordCount === 1 ? 'keyword' : 'keywords'}.`}
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function SetupPanel({ workspaceId, onOpenVisibility }: { workspaceId: string; onOpenVisibility: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <SectionCard
        title="Setup"
        titleExtra={<Badge label="Phase 2A" tone="zinc" variant="soft" shape="pill" />}
        variant="subtle"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-4">
            <div className="flex items-start gap-3">
              <Icon as={Settings2} size="md" className="text-teal-400" />
              <div>
                <p className="t-caption font-semibold text-[var(--brand-text-bright)]">Markets and refresh settings</p>
                <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
                  Use the Visibility tab to configure local markets, refresh budgets, and local-pack checks.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={onOpenVisibility}
                >
                  Open visibility setup
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-4">
            <div className="flex items-start gap-3">
              <Icon as={ClipboardList} size="md" className="text-teal-400" />
              <div>
                <p className="t-caption font-semibold text-[var(--brand-text-bright)]">Client locations</p>
                <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
                  Location records remain in Brand & AI. Authenticated GBP locations map to those records for later review sync and intelligence.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => navigate(`${adminPath(workspaceId, 'brand')}?tab=business-footprint&focus=locations-section`)}
                >
                  Open location records
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>
      <FeatureFlag flag="gbp-auth-connection">
        <GbpMappingStatusBlock workspaceId={workspaceId} />
      </FeatureFlag>
    </div>
  );
}

export function LocalPresencePage({ workspaceId }: { workspaceId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveTab(searchParams.get('tab'));

  const setTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: false });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Local Presence"
        subtitle="Local markets, map-pack visibility, and Google Business Profile review aggregates."
        icon={<div className="w-9 h-9 rounded-[var(--radius-lg)] border border-teal-500/25 bg-teal-500/10 flex items-center justify-center"><MapPin className="w-4 h-4 text-teal-400" /></div>}
      />

      <TabBar
        tabs={LOCAL_PRESENCE_TABS}
        active={activeTab}
        onChange={setTab}
      />

      {activeTab === 'overview' && <OverviewPanel workspaceId={workspaceId} />}
      {activeTab === 'visibility' && <LocalSeoVisibilityPanel workspaceId={workspaceId} mode="keywords" showGbpReviews={false} />}
      {activeTab === 'reviews' && (
        <div className="space-y-4">
          <FeatureFlag flag="gbp-auth-connection">
            <GbpMappingStatusBlock workspaceId={workspaceId} />
          </FeatureFlag>
          <GbpReviewsPanel workspaceId={workspaceId} />
        </div>
      )}
      {activeTab === 'setup' && <SetupPanel workspaceId={workspaceId} onOpenVisibility={() => setTab('visibility')} />}
    </div>
  );
}
