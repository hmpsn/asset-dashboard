// @ds-rebuilt
import { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import {
  useAdminBriefsList,
  useAdminPostsList,
  useAdminRequestsList,
  useAiSuggestedBriefs,
  useContentPipeline,
  useWorkspaces,
  useWorkspaceIntelligence,
} from '../../hooks/admin';
import { useAdminWorkOrders } from '../../hooks/admin/useWorkOrders';
import { adminContentPerformanceKeys } from '../../hooks/admin/useAdminContentPerformance';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import type { FixContext } from '../../types/fix-context';
import { ContentPipelineGuide } from '../ContentPipelineGuide';
import { ErrorBoundary } from '../ErrorBoundary';
import { RebuiltTopbarActions } from '../layout/RebuiltAppChrome';
import { useToast } from '../Toast';
import {
  Button,
  Drawer,
  Icon,
  LensSwitcher,
  Menu,
  PageHeader,
  ToolbarSpacer,
  type MenuItem,
  type Tier,
} from '../ui';
import { ContentLifecycleBoard, deriveLifecycleBoardItems } from './ContentLifecycleBoard';
import { ContentPipelineIntake, deriveContentIntake } from './ContentPipelineIntake';
import { ContentPipelineLenses } from './ContentPipelineLenses';
import type { ContentPipelineData } from './ContentPipelineLenses';
import { ContentPipelineWorkspaces } from './ContentPipelineWorkspaces';
import { PublishedContentLens } from './PublishedContentLens';
import {
  type ContentPipelineTab,
  useContentPipelineSurfaceState,
} from './useContentPipelineSurfaceState';
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

function readBriefFixContext(routerState: unknown): FixContext | null {
  const fixContext = (routerState as { fixContext?: FixContext } | null)?.fixContext;
  return fixContext?.targetRoute === 'content-pipeline' ? fixContext : null;
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
  const location = useLocation();
  const state = useContentPipelineSurfaceState();
  const shellFlagEnabled = useFeatureFlag('ui-rebuild-shell');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const pipelineQuery = useContentPipeline(workspaceId);
  const workspaces = useWorkspaces();
  const intelligence = useWorkspaceIntelligence(workspaceId, ['contentPipeline']);
  const briefsQuery = useAdminBriefsList(workspaceId);
  const requestsQuery = useAdminRequestsList(workspaceId);
  const postsQuery = useAdminPostsList(workspaceId);
  const suggestionsQuery = useAiSuggestedBriefs(workspaceId);
  const workOrdersQuery = useAdminWorkOrders(workspaceId);
  const [guideOpen, setGuideOpen] = useState(false);
  const [capacityDrawerOpen, setCapacityDrawerOpen] = useState(false);
  const [focusedBriefId, setFocusedBriefId] = useState<string | null>(null);
  const [briefFixContext, setBriefFixContext] = useState<FixContext | null>(() => readBriefFixContext(location.state));
  const [prefillNonce, setPrefillNonce] = useState(0);
  const [blankBriefOpen, setBlankBriefOpen] = useState(() => readBriefFixContext(location.state) !== null);

  const workspace = useMemo(
    () => workspaces.data?.find((item) => item.id === workspaceId),
    [workspaceId, workspaces.data],
  );
  const workspaceTier = (workspace?.tier ?? 'free') as Tier;
  const siteLabel = workspace?.gscPropertyUrl ?? workspace?.webflowSiteName ?? null;
  const contentPipeline = intelligence.data?.contentPipeline;
  const pipelineData = pipelineQuery.data as ContentPipelineData | undefined;
  const mode = modeForTab(state.tab);
  const boardFocus = state.tab === 'intake' ? 'intake' : 'brief';
  const lifecycleItems = useMemo(() => deriveLifecycleBoardItems({
    briefs: briefsQuery.data,
    requests: requestsQuery.data,
    posts: postsQuery.data,
  }), [briefsQuery.data, postsQuery.data, requestsQuery.data]);
  const intakeSnapshot = useMemo(() => deriveContentIntake({
    briefs: briefsQuery.data,
    requests: requestsQuery.data,
    posts: postsQuery.data,
    suggestions: suggestionsQuery.data,
    workOrders: workOrdersQuery.data,
  }), [briefsQuery.data, postsQuery.data, requestsQuery.data, suggestionsQuery.data, workOrdersQuery.data]);
  const focusedBrief = useMemo(
    () => briefsQuery.data?.find((brief) => brief.id === focusedBriefId) ?? null,
    [briefsQuery.data, focusedBriefId],
  );
  const focusedPost = useMemo(
    () => postsQuery.data?.find((post) => post.id === state.postId) ?? null,
    [postsQuery.data, state.postId],
  );
  const subscriptionSummary = contentPipeline?.subscriptions;
  const activePlanCount = subscriptionSummary?.active ?? 0;
  const capacityOpen = capacityDrawerOpen || state.tab === 'publish';
  const capacityHeadline = activePlanCount > 0
    ? `${activePlanCount} active plan${activePlanCount === 1 ? '' : 's'}`
    : 'No content plan';
  const capacityDetail = activePlanCount > 0
    ? `${subscriptionSummary?.totalPages ?? 0} pages covered`
    : 'Set up plan';

  const invalidateContentPipeline = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.contentPipeline(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.intelligence(workspaceId, ['contentPipeline']) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.briefs(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.requests(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.posts(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.aiSuggestedBriefs(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.workOrders(workspaceId) });
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
        briefsQuery.refetch(),
        requestsQuery.refetch(),
        postsQuery.refetch(),
        suggestionsQuery.refetch(),
        workOrdersQuery.refetch(),
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
    count: option.value === 'board' ? lifecycleItems.length : option.count?.(pipelineData),
  }));

  const openMode = (nextMode: ContentPipelineMode) => {
    setCapacityDrawerOpen(false);
    setFocusedBriefId(null);
    setBlankBriefOpen(false);
    clearBriefFixContext();
    state.setTab(nextMode === 'board' ? 'briefs' : nextMode);
  };

  const openBriefs = () => {
    setFocusedBriefId(null);
    setBlankBriefOpen(true);
    state.setTab('briefs');
  };

  const openNewPiece = () => {
    clearBriefFixContext();
    openBriefs();
  };

  const openIntake = () => {
    setBlankBriefOpen(false);
    state.setTab('intake');
  };

  const openDrafts = () => {
    setBlankBriefOpen(false);
    state.setTab('posts');
  };

  const openBrief = (briefId: string) => {
    setBlankBriefOpen(false);
    setFocusedBriefId(briefId);
  };

  const openPost = (postId: string) => {
    setFocusedBriefId(null);
    setBlankBriefOpen(false);
    state.openPost(postId);
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
    setBlankBriefOpen(false);
    state.setTab(tab);
  };

  const handleCreateBrief = (keyword: string, pageUrl?: string, _suggestedBriefId?: string) => {
    setBriefFixContext(buildSignalPrefill(keyword, pageUrl));
    setPrefillNonce((current) => current + 1);
    openBriefs();
  };

  const closeCapacity = () => {
    setCapacityDrawerOpen(false);
    if (state.tab === 'publish') state.setTab('briefs');
  };

  const closeBriefWorkspace = () => {
    setFocusedBriefId(null);
    setBlankBriefOpen(false);
    clearBriefFixContext();
  };

  const topbarActions = (
    <div data-testid="content-pipeline-header-actions" className="flex max-w-full items-center justify-end gap-2 overflow-x-auto">
      <Button size="sm" onClick={openNewPiece}>
        <Icon name="plus" size="sm" />
        New piece
      </Button>
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
  );

  return (
    <ErrorBoundary label="Content Pipeline">
      <div className="mr-auto flex min-h-full w-full max-w-[var(--page-max)] flex-col gap-4" data-rebuild-flag={shellFlagEnabled ? 'on' : 'default'}>
        <RebuiltTopbarActions fallback={<div data-testid="content-pipeline-topbar-actions-fallback">{topbarActions}</div>}>
          {topbarActions}
        </RebuiltTopbarActions>

        <div className="flex flex-wrap items-end gap-4" aria-label="Content Pipeline overview and view controls">
          <PageHeader
            title="Content Pipeline"
            subtitle={(
              <>
                Active work for <strong className="font-semibold text-[var(--brand-text-bright)]">{workspace?.name ?? 'this workspace'}</strong> — idea to approved, one card at a time. Scheduled pieces live in <strong className="font-semibold text-[var(--brand-text-bright)]">Calendar</strong>; live pieces and their results in <strong className="font-semibold text-[var(--brand-text-bright)]">Published</strong>.
              </>
            )}
            className="max-w-full flex-[0_1_44ch] [&_p]:mt-1 [&_p]:whitespace-normal [&_p]:overflow-visible [&_p]:text-clip [&_p]:leading-relaxed"
          />
          <ToolbarSpacer />
          <Button
            size="sm"
            variant="secondary"
            className="h-auto shrink-0 gap-2 px-2.5 py-1.5 text-left"
            onClick={() => setCapacityDrawerOpen(true)}
            aria-pressed={capacityOpen || state.tab === 'publish'}
          >
            <Icon name="layers" size="sm" className="text-[var(--teal)]" />
            <span className="flex flex-col items-start leading-tight">
              <span className="t-caption-sm font-semibold text-[var(--brand-text-bright)]">{capacityHeadline}</span>
              <span className="t-micro text-[var(--brand-text-dim)]">{capacityDetail}</span>
            </span>
          </Button>
          <div className="basis-full overflow-x-auto pb-px">
            <LensSwitcher
              id="content-pipeline-rebuilt-lens"
              options={lensOptions}
              value={mode}
              onChange={(value) => openMode(value as ContentPipelineMode)}
              size="sm"
            />
          </div>
        </div>

        {state.tab === 'published' ? (
          <PublishedContentLens
            workspaceId={workspaceId}
            siteLabel={siteLabel}
            selectedItemId={state.itemId}
            onOpenItem={state.openPublishedItem}
            onCloseItem={state.clearPublishedItem}
          />
        ) : (state.tab === 'briefs' || state.tab === 'intake' || state.tab === 'publish' || Boolean(state.postId)) ? (
          <ContentLifecycleBoard
            key={boardFocus}
            items={lifecycleItems}
            focus={boardFocus}
            intakeCount={intakeSnapshot.total}
            intakeSummary={intakeSnapshot.summary}
            intakeContent={(
              <ContentPipelineIntake
                workspaceId={workspaceId}
                snapshot={intakeSnapshot}
                onCreateBrief={handleCreateBrief}
              />
            )}
            onOpenBriefs={openBriefs}
            onOpenDrafts={openDrafts}
            onOpenBrief={openBrief}
            onOpenPost={openPost}
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

        <ContentPipelineWorkspaces
          workspaceId={workspaceId}
          focusedBrief={focusedBrief}
          blankBriefOpen={blankBriefOpen}
          focusedPost={focusedPost}
          postWorkspaceOpen={Boolean(state.postId)}
          capacityOpen={capacityOpen}
          briefFixContext={briefFixContext}
          onClearBriefFixContext={clearBriefFixContext}
          onCloseBrief={closeBriefWorkspace}
          onClosePost={state.clearPost}
          onCloseCapacity={closeCapacity}
        />

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
