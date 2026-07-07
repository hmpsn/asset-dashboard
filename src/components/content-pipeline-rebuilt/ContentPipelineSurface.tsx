// @ds-rebuilt
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { useContentPipeline, useWorkspaces, useWorkspaceIntelligence } from '../../hooks/admin';
import { adminContentPerformanceKeys } from '../../hooks/admin/useAdminContentPerformance';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import type { FixContext } from '../../types/fix-context';
import { ContentPipelineGuide } from '../ContentPipelineGuide';
import { ErrorBoundary } from '../ErrorBoundary';
import { useToast } from '../Toast';
import {
  Badge,
  Button,
  ClickableRow,
  Drawer,
  GroupBlock,
  Icon,
  KeyValueRow,
  LensSwitcher,
  Menu,
  MetricTile,
  PageHeader,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
  WorkflowStepper,
  type MenuItem,
  type Tier,
} from '../ui';
import { ContentPipelineLenses } from './ContentPipelineLenses';
import type { ContentPipelineData } from './ContentPipelineLenses';
import {
  CONTENT_PIPELINE_TABS,
  type ContentPipelineTab,
  useContentPipelineSurfaceState,
} from './useContentPipelineSurfaceState';
import { formatContentDate, formatInteger } from './contentPipelineFormatters';
import { mutationErrorMessage } from './contentPipelineMutationFeedback';

interface ContentPipelineSurfaceProps {
  workspaceId: string;
}

const EXPORTS = [
  { key: 'briefs', label: 'Content Briefs' },
  { key: 'requests', label: 'Content Requests' },
  { key: 'matrices', label: 'Content Matrices' },
  { key: 'templates', label: 'Content Templates' },
  { key: 'strategy', label: 'Keyword Strategy' },
] as const;

const TAB_ACCENT: Record<ContentPipelineTab, string> = {
  planner: 'var(--teal)',
  calendar: 'var(--amber)',
  intake: 'var(--teal)',
  briefs: 'var(--blue)',
  posts: 'var(--teal)',
  publish: 'var(--emerald)',
  'content-health': 'var(--amber)',
  published: 'var(--blue)',
};

const TAB_DESCRIPTION: Record<ContentPipelineTab, string> = {
  planner: 'Matrix and template planning',
  calendar: 'Scheduling and item deep-links',
  intake: 'AI-suggested opportunities',
  briefs: 'Briefs and client requests',
  posts: 'Drafting, review, and publish actions',
  publish: 'Recurring content capacity',
  'content-health': 'Decay and cannibalization acting home',
  published: 'Performance readback',
};

function buildSignalPrefill(keyword: string, pageUrl?: string): FixContext {
  return {
    targetRoute: 'content-pipeline',
    primaryKeyword: keyword || undefined,
    pageSlug: pageUrl || undefined,
  };
}

function tabCount(tab: ContentPipelineTab, data: ContentPipelineData | undefined, suggestedBriefs: number | undefined): number | undefined {
  const summary = data?.summary;
  if (tab === 'planner') return summary?.matrices;
  if (tab === 'briefs') return summary?.briefs;
  if (tab === 'posts') return summary?.posts;
  if (tab === 'intake') return suggestedBriefs;
  if (tab === 'content-health') return (data?.decay?.totalDecaying ?? 0);
  if (tab === 'published') return summary?.published;
  return undefined;
}

function CapabilityRow({
  tab,
  active,
  count,
  onClick,
}: {
  tab: ContentPipelineTab;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  const label = CONTENT_PIPELINE_TABS.find((item) => item.id === tab)?.label ?? tab;
  return (
    <ClickableRow
      active={active}
      onClick={onClick}
      className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-3 transition-colors duration-[var(--dur-fast)] hover:border-[var(--brand-border-hover)]"
    >
      <span className="flex items-start gap-3">
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)]"
          style={{ color: TAB_ACCENT[tab] }}
          aria-hidden="true"
        >
          <Icon name={tab === 'published' ? 'chart' : tab === 'content-health' ? 'gauge' : tab === 'calendar' ? 'clock' : tab === 'posts' ? 'doc' : tab === 'briefs' ? 'clipboard' : 'layers'} size="sm" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block t-caption font-semibold text-[var(--brand-text-bright)]">{label}</span>
          <span className="mt-1 block t-caption-sm text-[var(--brand-text-muted)]">{TAB_DESCRIPTION[tab]}</span>
        </span>
        {count !== undefined && <Badge label={formatInteger(count)} tone="zinc" variant="soft" size="sm" />}
      </span>
    </ClickableRow>
  );
}

export function ContentPipelineSurface({ workspaceId }: ContentPipelineSurfaceProps) {
  const state = useContentPipelineSurfaceState();
  const shellFlagEnabled = useFeatureFlag('ui-rebuild-shell');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const pipelineQuery = useContentPipeline(workspaceId);
  const workspaces = useWorkspaces();
  const intelligence = useWorkspaceIntelligence(workspaceId, ['contentPipeline']);
  const [guideOpen, setGuideOpen] = useState(false);
  const [briefFixContext, setBriefFixContext] = useState<FixContext | null>(null);
  const [prefillNonce, setPrefillNonce] = useState(0);

  const workspace = useMemo(
    () => workspaces.data?.find((item) => item.id === workspaceId),
    [workspaceId, workspaces.data],
  );
  const workspaceTier = (workspace?.tier ?? 'free') as Tier;
  const siteLabel = workspace?.gscPropertyUrl ?? workspace?.webflowSiteName ?? null;
  const contentPipeline = intelligence.data?.contentPipeline;
  const pipelineData = pipelineQuery.data as ContentPipelineData | undefined;
  const suggestedBriefs = contentPipeline?.suggestedBriefs;
  const dataAsOf = formatContentDate(workspace?.createdAt);

  const invalidateContentPipeline = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.contentPipeline(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.intelligence(workspaceId, ['contentPipeline']) });
    queryClient.invalidateQueries({ queryKey: adminContentPerformanceKeys.all(workspaceId) });
  }, [queryClient, workspaceId]);

  useWorkspaceEvents(workspaceId, {
    // ws-invalidation-ok — the rebuilt Content Pipeline summary and Published lens share content writes across briefs, posts, requests, and performance readbacks.
    [WS_EVENTS.CONTENT_UPDATED]: invalidateContentPipeline,
    // ws-invalidation-ok — brief edits and generation affect the cockpit counts and Briefs lens.
    [WS_EVENTS.BRIEF_UPDATED]: invalidateContentPipeline,
    // ws-invalidation-ok — request lifecycle changes affect Briefs/Requests and Published readback eligibility.
    [WS_EVENTS.CONTENT_REQUEST_UPDATE]: invalidateContentPipeline,
    // ws-invalidation-ok — post updates affect Drafts, Calendar, Publish status, and Published metrics.
    [WS_EVENTS.POST_UPDATED]: invalidateContentPipeline,
    // ws-invalidation-ok — publication changes can move rows into the Published readback lens.
    [WS_EVENTS.CONTENT_PUBLISHED]: invalidateContentPipeline,
    // ws-invalidation-ok — AI suggested brief queue is surfaced as the Intake lens.
    [WS_EVENTS.SUGGESTED_BRIEF_UPDATED]: invalidateContentPipeline,
    // ws-invalidation-ok — subscriptions are mounted under Publish and update cockpit capacity.
    [WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED]: invalidateContentPipeline,
    // ws-invalidation-ok — outcome readbacks drive Published verdict badges.
    [WS_EVENTS.OUTCOME_SCORED]: invalidateContentPipeline,
  });

  const exportMenuItems: MenuItem[] = EXPORTS.flatMap((exp) => [
    { label: `${exp.label} - CSV`, onSelect: () => window.open(`/api/export/${workspaceId}/${exp.key}?format=csv`, '_blank', 'noopener,noreferrer') },
    { label: `${exp.label} - JSON`, onSelect: () => window.open(`/api/export/${workspaceId}/${exp.key}?format=json`, '_blank', 'noopener,noreferrer') },
  ]);

  const handleRefresh = async () => {
    try {
      await Promise.all([
        pipelineQuery.refetch(),
        intelligence.refetch(),
        queryClient.invalidateQueries({ queryKey: adminContentPerformanceKeys.all(workspaceId) }),
      ]);
      toast('Content Pipeline data refreshed', 'success');
    } catch (error) {
      toast(mutationErrorMessage(error, 'Content Pipeline refresh failed'), 'error');
    }
  };

  const handleCreateBrief = (keyword: string, pageUrl?: string, _suggestedBriefId?: string) => {
    setBriefFixContext(buildSignalPrefill(keyword, pageUrl));
    setPrefillNonce((current) => current + 1);
    state.setTab('briefs');
  };

  const clearBriefFixContext = () => setBriefFixContext(null);

  const workflowSteps = [
    {
      number: 1,
      label: 'Strategy',
      completed: ['briefs', 'posts', 'publish', 'published'].includes(state.tab),
      current: state.tab === 'planner',
      onClick: () => state.setTab('planner'),
    },
    {
      number: 2,
      label: 'Briefs',
      completed: ['posts', 'publish', 'published'].includes(state.tab),
      current: state.tab === 'briefs' || state.tab === 'intake',
      onClick: () => state.setTab('briefs'),
    },
    {
      number: 3,
      label: 'Drafts',
      completed: ['publish', 'published'].includes(state.tab),
      current: state.tab === 'posts',
      onClick: () => state.setTab('posts'),
    },
    {
      number: 4,
      label: 'Publish',
      completed: state.tab === 'published',
      current: state.tab === 'publish' || state.tab === 'published',
      onClick: () => state.setTab('publish'),
    },
  ];

  const lensOptions = CONTENT_PIPELINE_TABS.map((tab) => ({
    value: tab.id,
    label: tab.label,
    count: tabCount(tab.id, pipelineData, suggestedBriefs),
  }));

  return (
    <ErrorBoundary label="Content Pipeline rebuilt surface">
      <div className="flex min-h-full flex-col gap-5" data-rebuild-flag={shellFlagEnabled ? 'on' : 'default'}>
        <PageHeader
          title="Content Pipeline"
          subtitle="Plan, brief, draft, publish, and read back content performance from one admin cockpit."
          actions={(
            <div className="flex flex-wrap items-center justify-end gap-2">
              {dataAsOf !== '—' && <span className="t-caption-sm text-[var(--brand-text-muted)]">Workspace since {dataAsOf}</span>}
              <Menu
                align="end"
                trigger={(
                  <Button size="sm" variant="secondary">
                    <Icon name="download" size="sm" />
                    Export
                  </Button>
                )}
                items={exportMenuItems}
              />
              <Button size="sm" variant="secondary" onClick={() => void handleRefresh()} disabled={pipelineQuery.isFetching || intelligence.isFetching}>
                <Icon name="refresh" size="sm" />
                Refresh
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setGuideOpen(true)}>
                <Icon name="info" size="sm" />
                Guide
              </Button>
            </div>
          )}
        />

        <Toolbar label="Content Pipeline view controls" className="w-full">
          <LensSwitcher
            id="content-pipeline-rebuilt-lens"
            options={lensOptions}
            value={state.tab}
            onChange={(value) => state.setTab(value as ContentPipelineTab)}
            size="sm"
          />
          <ToolbarSpacer />
          <Badge label={state.rawTab === 'subscriptions' ? 'subscriptions alias' : '?tab= receiver'} tone="zinc" variant="soft" size="sm" />
        </Toolbar>

        {pipelineQuery.isLoading && !pipelineData ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Loading Content Pipeline summary">
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricTile label="Briefs" value={pipelineData?.summary?.briefs ?? 0} accent="var(--blue)" />
            <MetricTile label="Posts" value={pipelineData?.summary?.posts ?? 0} accent="var(--teal)" />
            <MetricTile label="Matrices" value={pipelineData?.summary?.matrices ?? 0} accent="var(--teal)" />
            <MetricTile label="Published Cells" value={pipelineData?.summary?.published ?? 0} accent="var(--emerald)" />
            <MetricTile label="Health Signals" value={pipelineData?.decay?.totalDecaying ?? 0} accent={(pipelineData?.decay?.critical ?? 0) > 0 ? 'var(--red)' : 'var(--amber)'} />
          </div>
        )}

        <WorkflowStepper steps={workflowSteps} compact />

        <GroupBlock
          title="Cockpit"
          meta="Every current content subsystem is mounted below as a carried-over mode; the shell owns routing and summaries only."
          stats={[
            { label: 'Active tab', value: CONTENT_PIPELINE_TABS.find((tab) => tab.id === state.tab)?.label ?? state.tab, color: TAB_ACCENT[state.tab] },
            { label: 'Post receiver', value: state.postId ? 'armed' : 'idle', color: state.postId ? 'var(--teal)' : 'var(--blue)' },
          ]}
          collapsible
          defaultOpen={state.tab === 'briefs'}
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {CONTENT_PIPELINE_TABS.map((tab) => (
              <CapabilityRow
                key={tab.id}
                tab={tab.id}
                active={state.tab === tab.id}
                count={tabCount(tab.id, pipelineData, suggestedBriefs)}
                onClick={() => state.setTab(tab.id)}
              />
            ))}
          </div>
        </GroupBlock>

        {state.postId && state.tab === 'posts' && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2">
            <KeyValueRow label="Post deep-link receiver" value={state.postId} divider={false} mono />
          </div>
        )}

        <ContentPipelineLenses
          workspaceId={workspaceId}
          tab={state.tab}
          pipelineData={pipelineData}
          contentPipeline={contentPipeline}
          workspaceTier={workspaceTier}
          siteLabel={siteLabel}
          briefFixContext={briefFixContext}
          prefillNonce={prefillNonce}
          clearBriefFixContext={clearBriefFixContext}
          onCreateBrief={handleCreateBrief}
          onOpenTab={state.setTab}
        />

        <Drawer
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          title="Content Pipeline Guide"
          subtitle="Carry-over workflow guide for planner, briefs, posts, subscriptions, and exports."
          eyebrow="Workflow guide"
          width={560}
        >
          <ContentPipelineGuide />
        </Drawer>
      </div>
    </ErrorBoundary>
  );
}

export default ContentPipelineSurface;
