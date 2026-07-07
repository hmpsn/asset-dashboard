// @ds-rebuilt
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { workspaces } from '../../api';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { queryKeys } from '../../lib/queryKeys';
import { formatDate } from '../../utils/formatDates';
import type { AudiencePersona, TargetGeo } from '../../../shared/types/workspace';
import { useToast } from '../Toast';
import { ErrorBoundary } from '../ErrorBoundary';
import { BrandHub } from '../BrandHub';
import { BrandOverviewTab } from '../brand/BrandOverviewTab';
import { BrandscriptTab } from '../brand/BrandscriptTab';
import { DiscoveryTab } from '../brand/DiscoveryTab';
import { VoiceTab } from '../brand/VoiceTab';
import { IdentityTab } from '../brand/IdentityTab';
import { BusinessFootprintTab } from '../settings/BusinessFootprintTab';
import { EeatAssetsTab } from '../settings/EeatAssetsTab';
import { IntelligenceProfileTab } from '../settings/IntelligenceProfileTab';
import {
  Badge,
  Button,
  ClickableRow,
  ErrorState,
  GroupBlock,
  Icon,
  InlineBanner,
  KeyValueRow,
  LensSwitcher,
  MetricTile,
  PageHeader,
  SectionCard,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import { mutationErrorMessage } from './brandAiMutationFeedback';
import {
  BRAND_AI_TABS,
  type BrandAiTab,
  useBrandAiSurfaceState,
} from './useBrandAiSurfaceState';

interface BrandAiSurfaceProps {
  workspaceId: string;
}

interface WorkspaceData {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  webflowSiteId?: string;
  liveDomain?: string;
  brandLogoUrl?: string;
  siteHasSearch?: boolean;
  knowledgeBase?: string;
  brandVoice?: string;
  personas?: AudiencePersona[];
  targetGeo?: TargetGeo | null;
  businessProfile?: {
    email?: string;
    phone?: string;
    address?: { street?: string; city?: string; state?: string; zip?: string; country?: string };
    socialProfiles?: string[];
    openingHours?: string;
    foundedDate?: string;
    numberOfEmployees?: string;
  } | null;
  keywordStrategy?: {
    businessContext?: string;
  } | null;
  intelligenceProfile?: {
    industry?: string;
    goals?: string[];
    targetAudience?: string;
  } | null;
}

type Readiness = 'Ready' | 'Partial' | 'Needs setup';
type DrillInId = 'context' | 'brandscript' | 'discovery' | 'voice' | 'identity' | 'business-footprint' | 'eeat-assets' | 'intelligence-profile';

const TAB_ACCENTS: Record<BrandAiTab, string> = {
  overview: 'var(--blue)',
  context: 'var(--teal)',
  brandscript: 'var(--teal)',
  discovery: 'var(--blue)',
  voice: 'var(--teal)',
  identity: 'var(--emerald)',
  'business-footprint': 'var(--blue)',
  'eeat-assets': 'var(--amber)',
  'intelligence-profile': 'var(--teal)',
};

const TAB_ICON: Record<BrandAiTab, 'sparkle' | 'message' | 'doc' | 'download' | 'key' | 'trophy' | 'home' | 'clipboard' | 'chart'> = {
  overview: 'sparkle',
  context: 'message',
  brandscript: 'doc',
  discovery: 'download',
  voice: 'key',
  identity: 'trophy',
  'business-footprint': 'home',
  'eeat-assets': 'clipboard',
  'intelligence-profile': 'chart',
};

const TAB_SUMMARY: Record<BrandAiTab, string> = {
  overview: 'Readiness snapshot across brand context, trust data, and identity work.',
  context: 'Brand voice, knowledge base, personas, and Page Strategy carry-over.',
  brandscript: 'Multi-script framework, templates, imports, section editing, and AI fill.',
  discovery: 'Source ingestion, process queue, extraction review, and routing decisions.',
  voice: 'Samples, DNA, guardrails, and calibration loop for prompt authority.',
  identity: 'Seventeen brand deliverables with generate, refine, approve, and export-all flow.',
  'business-footprint': 'Business profile, local markets, locations, and GBP gated mapping.',
  'eeat-assets': 'Typed trust asset CRUD and autofill, plus a read-only pillar view.',
  'intelligence-profile': 'Industry, goals, audience, and strategy intelligence profile.',
};

const DRILL_INS: Array<{ id: DrillInId; tab: BrandAiTab; label: string; description: string }> = [
  { id: 'context', tab: 'context', label: 'Context Editors', description: 'Carry-over rich text editors, job recovery, personas, and Page Strategy.' },
  { id: 'brandscript', tab: 'brandscript', label: 'Brandscripts', description: 'Create, import, delete, and edit all template sections.' },
  { id: 'discovery', tab: 'discovery', label: 'Discovery Loop', description: 'Upload or paste existing sources, process, and review extractions.' },
  { id: 'voice', tab: 'voice', label: 'Voice Calibration', description: 'Samples, voice DNA, guardrails, and calibration sessions.' },
  { id: 'identity', tab: 'identity', label: 'Brand Identity', description: 'Generate, refine, approve, edit, and export all deliverables.' },
  { id: 'business-footprint', tab: 'business-footprint', label: 'Business Facts', description: 'Schema authority, locations, and local-market inputs.' },
  { id: 'eeat-assets', tab: 'eeat-assets', label: 'E-E-A-T Assets', description: 'Typed trust assets with autofill and manual editing.' },
  { id: 'intelligence-profile', tab: 'intelligence-profile', label: 'Intelligence Profile', description: 'Strategy profile fields used by intelligence consumers.' },
];

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function readinessFromCount(configured: number, total: number): Readiness {
  if (configured >= total) return 'Ready';
  if (configured > 0) return 'Partial';
  return 'Needs setup';
}

function contextReadiness(ws: WorkspaceData | undefined): Readiness {
  if (!ws) return 'Needs setup';
  const configured = [
    hasText(ws.brandVoice),
    hasText(ws.knowledgeBase),
    (ws.personas?.length ?? 0) > 0,
  ].filter(Boolean).length;
  return readinessFromCount(configured, 3);
}

function trustReadiness(ws: WorkspaceData | undefined): Readiness {
  if (!ws) return 'Needs setup';
  const profile = ws.businessProfile;
  const configured = [
    hasText(profile?.email),
    hasText(profile?.phone),
    hasText(profile?.address?.city) || hasText(profile?.address?.street),
    hasText(ws.keywordStrategy?.businessContext),
  ].filter(Boolean).length;
  return readinessFromCount(configured, 4);
}

function intelligenceReadiness(ws: WorkspaceData | undefined): Readiness {
  if (!ws) return 'Needs setup';
  const profile = ws.intelligenceProfile;
  const configured = [
    hasText(profile?.industry),
    (profile?.goals?.length ?? 0) > 0,
    hasText(profile?.targetAudience),
  ].filter(Boolean).length;
  return readinessFromCount(configured, 3);
}

function TabIcon({ tab }: { tab: BrandAiTab }) {
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)]"
      style={{ color: TAB_ACCENTS[tab] }}
      aria-hidden="true"
    >
      <Icon name={TAB_ICON[tab]} size="sm" />
    </span>
  );
}

function CapabilityRow({
  tab,
  label,
  description,
  active,
  onClick,
}: {
  tab: BrandAiTab;
  label: string;
  description: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <ClickableRow
      active={active}
      onClick={onClick}
      className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-3 transition-colors duration-[var(--dur-fast)] hover:border-[var(--brand-border-hover)]"
    >
      <span className="flex items-start gap-3">
        <TabIcon tab={tab} />
        <span className="min-w-0 flex-1">
          <span className="block t-caption font-semibold text-[var(--brand-text-bright)]">{label}</span>
          <span className="mt-1 block t-caption-sm text-[var(--brand-text-muted)]">{description}</span>
        </span>
        <Icon name="arrowRight" size="sm" className="mt-2 shrink-0 text-[var(--brand-text-dim)]" aria-hidden="true" />
      </span>
    </ClickableRow>
  );
}

function BrandAiLoadingState() {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading Brand AI surface">
      <Skeleton className="h-[44px] w-full" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-[92px] w-full" />
        ))}
      </div>
      <Skeleton className="h-[360px] w-full" />
    </div>
  );
}

function BrandAiReadinessTiles({ ws }: { ws: WorkspaceData | undefined }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <MetricTile
        label="Context"
        value={contextReadiness(ws)}
        sub={`${ws?.personas?.length ?? 0} persona${(ws?.personas?.length ?? 0) === 1 ? '' : 's'}`}
        accent="var(--teal)"
      />
      <MetricTile
        label="Trust Inputs"
        value={trustReadiness(ws)}
        sub={ws?.liveDomain || 'No live domain on file'}
        accent="var(--blue)"
      />
      <MetricTile
        label="Identity"
        value="Carry-over"
        sub="17 deliverable types"
        accent="var(--emerald)"
      />
      <MetricTile
        label="Strategy + Copy"
        value="T1"
        sub="Blueprints and copy pipeline stay here"
        accent="var(--amber)"
      />
      <MetricTile
        label="Intelligence"
        value={intelligenceReadiness(ws)}
        sub={ws?.intelligenceProfile?.industry || 'No industry profile'}
        accent="var(--teal)"
      />
    </div>
  );
}

function ActiveTabSummary({
  tab,
}: {
  tab: BrandAiTab;
}) {
  const relatedDrillIns = DRILL_INS.filter((item) => item.tab === tab || (tab === 'context' && item.id === 'context'));
  return (
    <GroupBlock
      title={BRAND_AI_TABS.find((item) => item.id === tab)?.label ?? 'Brand AI'}
      meta={TAB_SUMMARY[tab]}
      stats={[
        { label: 'Route tab', value: tab, color: TAB_ACCENTS[tab] },
        { label: 'URL state', value: '?tab=', color: 'var(--blue)' },
      ]}
      defaultOpen
    >
      {tab === 'overview' ? (
        <p className="t-caption text-[var(--brand-text-muted)]">
          Use the cockpit lenses to open the existing Brand AI work areas. The sections below are carry-over panels; no endpoint or prompt contract changes are introduced by this shell.
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {relatedDrillIns.map((item) => (
            <div
              key={item.id}
              className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-3"
            >
              <span className="flex items-start gap-3">
                <TabIcon tab={item.tab} />
                <span className="min-w-0 flex-1">
                  <span className="block t-caption font-semibold text-[var(--brand-text-bright)]">{item.label}</span>
                  <span className="mt-1 block t-caption-sm text-[var(--brand-text-muted)]">{item.description}</span>
                </span>
                <Badge label="Mounted below" tone="zinc" variant="soft" size="sm" />
              </span>
            </div>
          ))}
        </div>
      )}
    </GroupBlock>
  );
}

function BrandAiPanel({
  tab,
  workspaceId,
  ws,
  refetchWorkspace,
}: {
  tab: BrandAiTab;
  workspaceId: string;
  ws: WorkspaceData | undefined;
  refetchWorkspace: () => void;
}) {
  const { toast } = useToast();

  if (tab === 'overview') {
    return (
      <BrandOverviewTab
        workspaceId={workspaceId}
        brandVoice={ws?.brandVoice}
        knowledgeBase={ws?.knowledgeBase}
        personasCount={ws?.personas?.length ?? 0}
        businessContext={ws?.keywordStrategy?.businessContext}
        intelligenceProfile={ws?.intelligenceProfile}
        businessProfile={ws?.businessProfile}
      />
    );
  }

  if (tab === 'context') {
    return (
      <BrandHub workspaceId={workspaceId} webflowSiteId={ws?.webflowSiteId} chromeless activeTab="context" />
    );
  }

  if (tab === 'brandscript') return <BrandscriptTab workspaceId={workspaceId} />;
  if (tab === 'discovery') return <DiscoveryTab workspaceId={workspaceId} />;
  if (tab === 'voice') return <VoiceTab workspaceId={workspaceId} />;
  if (tab === 'identity') return <IdentityTab workspaceId={workspaceId} />;
  if (tab === 'business-footprint') {
    return (
      <BusinessFootprintTab
        workspaceId={workspaceId}
        workspaceName={ws?.name || 'Workspace'}
        liveDomain={ws?.liveDomain}
        businessProfile={ws?.businessProfile}
        targetGeo={ws?.targetGeo}
        businessContext={ws?.keywordStrategy?.businessContext}
        brandLogoUrl={ws?.brandLogoUrl}
        siteHasSearch={ws?.siteHasSearch}
        legacySection={null}
        toast={toast}
        onBusinessProfileSave={refetchWorkspace}
      />
    );
  }
  if (tab === 'eeat-assets') return <EeatAssetsTab workspaceId={workspaceId} toast={toast} />;
  if (tab === 'intelligence-profile') {
    return (
      <IntelligenceProfileTab
        workspaceId={workspaceId}
        intelligenceProfile={ws?.intelligenceProfile}
        toast={toast}
        onSave={refetchWorkspace}
      />
    );
  }

  return null;
}

function FocusReceiverPanel({
  workspaceId,
  ws,
  legacySection,
  refetchWorkspace,
}: {
  workspaceId: string;
  ws: WorkspaceData | undefined;
  legacySection: 'business-profile' | 'locations' | null;
  refetchWorkspace: () => void;
}) {
  const { toast } = useToast();
  return (
    <BusinessFootprintTab
      workspaceId={workspaceId}
      workspaceName={ws?.name || 'Workspace'}
      liveDomain={ws?.liveDomain}
      businessProfile={ws?.businessProfile}
      targetGeo={ws?.targetGeo}
      businessContext={ws?.keywordStrategy?.businessContext}
      brandLogoUrl={ws?.brandLogoUrl}
      siteHasSearch={ws?.siteHasSearch}
      legacySection={legacySection}
      toast={toast}
      onBusinessProfileSave={refetchWorkspace}
    />
  );
}

export function BrandAiSurface({ workspaceId }: BrandAiSurfaceProps) {
  const state = useBrandAiSurfaceState();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const shellFlagEnabled = useFeatureFlag('ui-rebuild-shell');

  const workspaceQuery = useQuery({
    queryKey: queryKeys.admin.workspaceDetail(workspaceId),
    queryFn: () => workspaces.getById(workspaceId) as Promise<WorkspaceData>,
    enabled: !!workspaceId,
  });

  const ws = workspaceQuery.data;
  const lastUpdated = formatDate(ws?.updatedAt ?? ws?.createdAt);

  const refetchWorkspace = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceDetail(workspaceId) });
    void workspaceQuery.refetch();
  }, [queryClient, workspaceId, workspaceQuery]);

  const handleRefresh = useCallback(async () => {
    try {
      await workspaceQuery.refetch();
      toast('Brand AI data refreshed', 'success');
    } catch (error) {
      toast(mutationErrorMessage(error, 'Brand AI refresh failed'), 'error');
    }
  }, [toast, workspaceQuery]);

  const activeLensStats = useMemo(() => ([
    { label: 'Current lens', value: BRAND_AI_TABS.find((item) => item.id === state.tab)?.label ?? 'Overview', color: TAB_ACCENTS[state.tab] },
    { label: 'Legacy aliases', value: 'business-profile, locations', color: 'var(--blue)' },
  ]), [state.tab]);

  if (workspaceQuery.isError && !ws) {
    return (
      <ErrorBoundary label="Brand AI rebuilt surface">
        <div className="flex min-h-full flex-col gap-5">
          <PageHeader title="Brand & AI" subtitle="Brand context, discovery, voice, identity, and trust inputs for AI generation." />
          <ErrorState
            type="data"
            title="Brand AI data did not load"
            message="Retry the workspace read before editing brand context."
            action={{ label: 'Retry', onClick: () => void workspaceQuery.refetch() }}
            className="min-h-[420px]"
          />
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary label="Brand AI rebuilt surface">
      <div className="flex min-h-full flex-col gap-5" data-rebuild-flag={shellFlagEnabled ? 'on' : 'default'}>
        <PageHeader
          title="Brand & AI"
          subtitle="Brand context, discovery, voice, identity, and trust inputs for AI generation."
          actions={(
            <div className="flex flex-wrap items-center justify-end gap-2">
              {lastUpdated && <span className="t-caption-sm text-[var(--brand-text-muted)]">Data as of {lastUpdated}</span>}
              <Button size="sm" variant="secondary" onClick={() => void handleRefresh()} disabled={workspaceQuery.isFetching}>
                <Icon name="refresh" size="sm" />
                Re-scan
              </Button>
            </div>
          )}
        />

        <Toolbar label="Brand AI view controls" className="w-full">
          <LensSwitcher
            id="brand-ai-rebuilt-lens"
            options={BRAND_AI_TABS.map((tab) => ({ value: tab.id, label: tab.label }))}
            value={state.tab}
            onChange={(value) => state.setTab(value as BrandAiTab)}
            size="sm"
          />
          <ToolbarSpacer />
          <Badge label="Admin AI surface" tone="zinc" variant="soft" size="sm" />
        </Toolbar>

        {workspaceQuery.isLoading && !ws ? (
          <BrandAiLoadingState />
        ) : (
          <>
            {workspaceQuery.isError && ws && (
              <InlineBanner tone="warning" title="Brand AI data may be stale">
                The latest workspace read did not refresh, so the last loaded brand context is still shown.
              </InlineBanner>
            )}

            <BrandAiReadinessTiles ws={ws} />

            <GroupBlock
              title="Cockpit"
              meta="Nine legacy Brand & AI tabs grouped behind the existing route tab contract."
              stats={activeLensStats}
              defaultOpen
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {BRAND_AI_TABS.map((tab) => (
                  <CapabilityRow
                    key={tab.id}
                    tab={tab.id}
                    label={tab.label}
                    description={TAB_SUMMARY[tab.id]}
                    active={state.tab === tab.id}
                    onClick={() => state.setTab(tab.id)}
                  />
                ))}
              </div>
            </GroupBlock>

            <ActiveTabSummary tab={state.tab} />

            <section className="flex flex-col gap-3" aria-labelledby="brand-ai-active-panel-title">
              <div className="flex flex-wrap items-center gap-3 border-b border-[var(--brand-border)] pb-2">
                <TabIcon tab={state.tab} />
                <div className="min-w-0 flex-1">
                  <h2 id="brand-ai-active-panel-title" className="t-page font-semibold text-[var(--brand-text-bright)]">
                    {BRAND_AI_TABS.find((item) => item.id === state.tab)?.label ?? 'Overview'}
                  </h2>
                  <p className="t-caption-sm text-[var(--brand-text-muted)]">{TAB_SUMMARY[state.tab]}</p>
                </div>
                <Badge label="T1 carry-over" tone="zinc" variant="soft" size="sm" />
              </div>
              {state.legacyBusinessFootprintSection ? (
                <FocusReceiverPanel
                  workspaceId={workspaceId}
                  ws={ws}
                  legacySection={state.legacyBusinessFootprintSection}
                  refetchWorkspace={refetchWorkspace}
                />
              ) : (
                <BrandAiPanel
                  tab={state.tab}
                  workspaceId={workspaceId}
                  ws={ws}
                  refetchWorkspace={refetchWorkspace}
                />
              )}
            </section>

            <SectionCard title="Carry-over contract" titleIcon={<Icon name="info" size="sm" />}>
              <div className="grid gap-2 md:grid-cols-2">
                <KeyValueRow label="Brand docs ingestion" value=".txt/.md folder hints preserved; no speculative dropzone added." />
                <KeyValueRow label="Brandscript template" value="HEAD StoryBrand template carries 8 sections." />
                <KeyValueRow label="Page Strategy" value="Stays on Brand & AI with Copy Pipeline drill-ins." />
                <KeyValueRow label="Prompt layer" value="No duplicate voice-DNA injection path added." />
              </div>
            </SectionCard>
          </>
        )}

      </div>
    </ErrorBoundary>
  );
}

export default BrandAiSurface;
