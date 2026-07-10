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
  Button,
  Drawer,
  Icon,
  LensSwitcher,
  Menu,
  MetricTile,
  PageHeader,
  Skeleton,
  Toolbar,
  type MenuItem,
  type Tier,
} from '../ui';
import { ContentLifecycleBoard } from './ContentLifecycleBoard';
import { ContentPipelineLenses } from './ContentPipelineLenses';
import type { ContentPipelineData } from './ContentPipelineLenses';
import {
  type ContentPipelineTab,
  useContentPipelineSurfaceState,
} from './useContentPipelineSurfaceState';
import { formatContentDate } from './contentPipelineFormatters';
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

function buildSignalPrefill(keyword: string, pageUrl?: string): FixContext {
  return {
    targetRoute: 'content-pipeline',
    primaryKeyword: keyword || undefined,
    pageSlug: pageUrl || undefined,
  };
}

type ContentPipelineMode = 'board' | 'calendar' | 'published' | 'content-health' | 'planner';

const MODE_OPTIONS: Array<{ value: ContentPipelineMode; label: string; count?: (data: ContentPipelineData | undefined) => number | undefined }> = [
  { value: 'board', label: 'Board' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'published', label: 'Published', count: (data) => data?.summary?.published },
  { value: 'content-health', label: 'Content Health', count: (data) => data?.decay?.totalDecaying },
  { value: 'planner', label: 'Matrix', count: (data) => data?.summary?.matrices },
];

function modeForTab(tab: ContentPipelineTab): ContentPipelineMode | undefined {
  if (tab === 'briefs' || tab === 'intake' || tab === 'posts') return 'board';
  if (tab === 'publish') return undefined;
  return tab;
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
  const [boardBriefsOpen, setBoardBriefsOpen] = useState(false);

  const workspace = useMemo(
    () => workspaces.data?.find((item) => item.id === workspaceId),
    [workspaceId, workspaces.data],
  );
  const workspaceTier = (workspace?.tier ?? 'free') as Tier;
  const siteLabel = workspace?.gscPropertyUrl ?? workspace?.webflowSiteName ?? null;
  const contentPipeline = intelligence.data?.contentPipeline;
  const pipelineData = pipelineQuery.data as ContentPipelineData | undefined;
  const dataAsOf = formatContentDate(workspace?.createdAt);
  const mode = modeForTab(state.tab);
  const boardFocus = state.tab === 'intake' ? 'intake' : 'brief';

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

  const clearBriefFixContext = () => setBriefFixContext(null);
  const lensOptions = MODE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    count: option.count?.(pipelineData),
  }));

  const openMode = (nextMode: ContentPipelineMode) => {
    setBoardBriefsOpen(false);
    state.setTab(nextMode === 'board' ? 'briefs' : nextMode);
  };

  const openBriefs = () => {
    setBoardBriefsOpen(true);
    state.setTab('briefs');
  };

  const openIntake = () => {
    setBoardBriefsOpen(false);
    state.setTab('intake');
  };

  const openDrafts = () => {
    setBoardBriefsOpen(false);
    state.setTab('posts');
  };

  const openWorkflowTab = (tab: ContentPipelineTab) => {
    if (tab === 'briefs') {
      openBriefs();
      return;
    }
    if (tab === 'intake') {
      openIntake();
      return;
    }
    if (tab === 'posts') {
      openDrafts();
      return;
    }
    setBoardBriefsOpen(false);
    state.setTab(tab);
  };

  const handleCreateBrief = (keyword: string, pageUrl?: string, _suggestedBriefId?: string) => {
    setBriefFixContext(buildSignalPrefill(keyword, pageUrl));
    setPrefillNonce((current) => current + 1);
    openBriefs();
  };

  return (
    <ErrorBoundary label="Content Pipeline rebuilt surface">
      <div className="flex min-h-full flex-col gap-5" data-rebuild-flag={shellFlagEnabled ? 'on' : 'default'}>
        <PageHeader
          title="Content Pipeline"
          subtitle="Move content from opportunity to published proof without losing the next action."
          className="flex-col items-start gap-3 sm:flex-row sm:items-center [&_p]:whitespace-normal [&_p]:overflow-visible [&>div:last-child]:w-full sm:[&>div:last-child]:w-auto"
          actions={(
            <div data-testid="content-pipeline-header-actions" className="flex w-full max-w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              {dataAsOf !== '—' && <span className="block w-full t-caption-sm text-[var(--brand-text-muted)] sm:w-auto">Workspace since {dataAsOf}</span>}
              <Menu
                align="end"
                trigger={(
                  <Button size="sm" variant="secondary" className="w-full sm:w-auto">
                    <Icon name="download" size="sm" />
                    Export
                  </Button>
                )}
                items={exportMenuItems}
              />
              <Button size="sm" variant="secondary" className="w-full sm:w-auto" onClick={() => void handleRefresh()} disabled={pipelineQuery.isFetching || intelligence.isFetching}>
                <Icon name="refresh" size="sm" />
                Refresh
              </Button>
              <Button size="sm" variant="secondary" className="w-full sm:w-auto" onClick={() => setGuideOpen(true)}>
                <Icon name="info" size="sm" />
                Guide
              </Button>
              <Button size="sm" variant="secondary" className="w-full sm:w-auto" onClick={() => state.setTab('publish')} aria-pressed={state.tab === 'publish'}>
                <Icon name="chart" size="sm" />
                Content capacity
              </Button>
            </div>
          )}
        />

        <Toolbar label="Content Pipeline view controls" className="w-full">
          <LensSwitcher
            id="content-pipeline-rebuilt-lens"
            options={lensOptions}
            value={mode}
            onChange={(value) => openMode(value as ContentPipelineMode)}
            size="sm"
          />
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

        {(state.tab === 'briefs' || state.tab === 'intake') ? (
          <ContentLifecycleBoard
            key={boardFocus}
            pipelineData={pipelineData}
            contentPipeline={contentPipeline}
            focus={boardFocus}
            intakeContent={(
              <ContentPipelineLenses
                workspaceId={workspaceId}
                tab="intake"
                pipelineData={pipelineData}
                contentPipeline={contentPipeline}
                workspaceTier={workspaceTier}
                siteLabel={siteLabel}
                briefFixContext={briefFixContext}
                prefillNonce={prefillNonce}
                clearBriefFixContext={clearBriefFixContext}
                onCreateBrief={handleCreateBrief}
                onOpenTab={openWorkflowTab}
              />
            )}
            onOpenIntake={openIntake}
            onOpenBriefs={openBriefs}
            onOpenDrafts={openDrafts}
          />
        ) : (
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
            onOpenTab={openWorkflowTab}
          />
        )}

        {boardBriefsOpen && state.tab === 'briefs' && (
          <ContentPipelineLenses
            workspaceId={workspaceId}
            tab="briefs"
            pipelineData={pipelineData}
            contentPipeline={contentPipeline}
            workspaceTier={workspaceTier}
            siteLabel={siteLabel}
            briefFixContext={briefFixContext}
            prefillNonce={prefillNonce}
            clearBriefFixContext={clearBriefFixContext}
            onCreateBrief={handleCreateBrief}
            onOpenTab={openWorkflowTab}
          />
        )}

        <Drawer
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          title="Content Pipeline Guide"
          subtitle="Workflow guide for planning, briefs, drafts, subscriptions, and exports."
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
