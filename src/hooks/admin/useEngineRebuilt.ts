import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isCuratedForClient } from '../../../shared/recommendation-predicates';
import type { WorkQueueClassification, WorkQueueItem, WorkQueueSourceType } from '../../../shared/types/work-queue';
import type { Recommendation } from '../../../shared/types/recommendations';
import { useFeatureFlag } from '../useFeatureFlag';
import { useWorkspaceEvents } from '../useWorkspaceEvents';
import { useToggleSet, UNBOUNDED_TOGGLE_SET_OPTIONS } from '../useToggleSet';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import { useKeywordStrategy } from './useKeywordStrategy';
import { useAdminRecommendationSet } from './useAdminRecommendations';
import { useRecommendationLifecycle } from './useRecommendationLifecycle';
import { useRecBulkMutation } from './useRecBulkMutation';
import { useStrategyPov } from './useStrategyPov';
import { useOperatorSteering } from './useOperatorSteering';
import { useConversionTrackingStatus } from './useConversionTrackingStatus';
import { useAdminLeads } from './useAdminLeads';
import { useContentDecay } from './useContentDecay';
import { useLocalSeo } from './useLocalSeo';
import { useWorkspaceHomeData } from './useWorkspaceHome';
import { useWorkspaces } from './useWorkspaces';
import { useKeywordFeedback } from '../../components/strategy/hooks/useKeywordFeedback';
import {
  useStrategyGeneration,
  useStrategyMetrics,
  useStrategySettings,
} from '../../components/strategy';
import { isThrottledOpen } from '../../components/strategy/cockpitRowModel';

export const EMPTY_ENGINE_WORK_QUEUE: WorkQueueClassification = {
  streams: { opt: 0, send: 0, money: 0, unclassified: 0 },
  items: [],
};

export const ENGINE_LEADS_PAGE = 50;
export const ENGINE_LEADS_MAX = 200;

function sourceTypeCount(items: WorkQueueItem[], sourceType: WorkQueueSourceType): number {
  return items.filter((item) => item.sourceType === sourceType).length;
}

export function countEngineWorkQueueSourceTypes(items: WorkQueueItem[]): Partial<Record<WorkQueueSourceType, number>> {
  const sourceTypes = Array.from(new Set(items.map((item) => item.sourceType)));
  return Object.fromEntries(sourceTypes.map((sourceType) => [sourceType, sourceTypeCount(items, sourceType)]));
}

function recommendationStream(rec: Recommendation): WorkQueueItem['stream'] {
  if (rec.clientStatus === 'sent' || rec.clientStatus === 'approved' || rec.clientStatus === 'discussing') return 'send';
  if ((rec.opportunity?.value ?? 0) >= 1000) return 'money';
  if (rec.priority === 'fix_now' || rec.priority === 'fix_soon') return 'opt';
  return 'unclassified';
}

function recommendationSourceType(rec: Recommendation): WorkQueueSourceType {
  switch (rec.type) {
    case 'content':
    case 'content_refresh':
    case 'topic_cluster':
      return 'content_pipeline';
    case 'keyword_gap':
    case 'cannibalization':
    case 'strategy':
      return 'rank_drop';
    case 'technical':
    case 'metadata':
    case 'schema':
    case 'performance':
    case 'accessibility':
    case 'aeo':
      return 'audit_error';
    case 'local_visibility':
    case 'local_service_gap':
      return 'setup_gap';
    case 'competitor':
      return 'churn_signal';
  }
}

function recommendationImpact(rec: Recommendation): string | undefined {
  const value = rec.opportunity?.value;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return `$${Math.round(value).toLocaleString()}`;
  }
  if (typeof rec.impactScore === 'number' && Number.isFinite(rec.impactScore)) {
    return `${Math.round(rec.impactScore)} impact`;
  }
  return undefined;
}

export function recToEngineWorkQueueItem(rec: Recommendation): WorkQueueItem {
  const stream = recommendationStream(rec);
  const sourceType = recommendationSourceType(rec);
  const clientStatus = rec.clientStatus ?? 'system';
  const lifecycle = clientStatus === 'system' ? (rec.lifecycle ?? 'active') : clientStatus;
  return {
    stream,
    id: rec.id,
    title: rec.title,
    meta: `${rec.type.replace(/_/g, ' ')} · ${rec.priority.replace(/_/g, ' ')} · ${lifecycle.replace(/_/g, ' ')}`,
    impact: recommendationImpact(rec),
    direction: rec.priority === 'fix_now' ? 'negative' : 'positive',
    sourceType,
  };
}

export function useEngineRebuilt(workspaceId: string) {
  const queryClient = useQueryClient();
  const keywordQuery = useKeywordStrategy(workspaceId);
  const strategy = keywordQuery.data?.strategy ?? null;
  const isRealStrategy = strategy?.generatedAt != null;
  const localSync = strategy?.strategyUx?.localSync;
  const settings = useStrategySettings(keywordQuery.data, strategy, workspaceId, true);
  const generation = useStrategyGeneration({
    workspaceId,
    localSync,
    buildStrategyGenerationParams: settings.buildStrategyGenerationParams,
  });
  const feedback = useKeywordFeedback(workspaceId);
  const metrics = useStrategyMetrics(strategy, feedback.rows, isRealStrategy);
  const homeQuery = useWorkspaceHomeData(workspaceId);
  const workspaces = useWorkspaces();
  const recommendations = useAdminRecommendationSet(workspaceId);
  const lifecycleActions = useRecommendationLifecycle(workspaceId);
  const issueBulkSend = useRecBulkMutation(workspaceId);
  const strategyPov = useStrategyPov(workspaceId, true);
  const operatorSteering = useOperatorSteering(workspaceId, true);
  const measuredCapture = useFeatureFlag('the-issue-client-measured-capture');
  const conversionStatus = useConversionTrackingStatus(workspaceId, measuredCapture);
  const [leadsLimit, setLeadsLimit] = useState(ENGINE_LEADS_PAGE);
  const leads = useAdminLeads(workspaceId, { limit: leadsLimit }, measuredCapture);
  const contentDecay = useContentDecay(workspaceId);
  const localSeo = useLocalSeo(workspaceId);
  const [stagedRecIds, toggleStage, setStagedRecIds] = useToggleSet<string>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  const [struckRecIds, setStruckRecIds] = useState<string[]>([]);

  const cockpitRecs = recommendations.data?.recommendations ?? [];
  const sendableRecIds = useMemo(
    () => cockpitRecs
      .filter(
        (rec) =>
          rec.lifecycle !== 'struck' &&
          !isThrottledOpen(rec) &&
          rec.status !== 'completed' &&
          rec.status !== 'dismissed' &&
          rec.clientStatus !== 'sent' &&
          rec.clientStatus !== 'approved' &&
          rec.clientStatus !== 'declined' &&
          rec.clientStatus !== 'discussing',
      )
      .map((rec) => rec.id),
    [cockpitRecs],
  );
  const sendableSet = useMemo(() => new Set(sendableRecIds), [sendableRecIds]);
  const stagedSendableIds = useMemo(
    () => [...stagedRecIds].filter((id) => sendableSet.has(id)),
    [sendableSet, stagedRecIds],
  );
  const curatedCount = useMemo(() => cockpitRecs.filter(isCuratedForClient).length, [cockpitRecs]);
  const stageMany = useCallback((recIds: string[]) => {
    setStagedRecIds((prev) => new Set([...prev, ...recIds]));
  }, [setStagedRecIds]);
  const sendIssue = useCallback(() => {
    if (stagedSendableIds.length === 0) return;
    issueBulkSend.mutate(
      { recIds: stagedSendableIds, action: 'send' },
      { onSuccess: () => setStagedRecIds(new Set()) },
    );
  }, [issueBulkSend, setStagedRecIds, stagedSendableIds]);
  const markCut = useCallback((recId: string) => {
    setStruckRecIds((current) => current.includes(recId) ? current : [...current, recId]);
  }, []);

  const workspace = useMemo(
    () => workspaces.data?.find((item) => item.id === workspaceId) ?? null,
    [workspaceId, workspaces.data],
  );
  const primaryMarket = localSeo.data?.markets?.find((market) => market.status === 'active') ?? null;
  const workQueue = homeQuery.data?.workQueue ?? EMPTY_ENGINE_WORK_QUEUE;
  const workQueueSourceCounts = useMemo(
    () => countEngineWorkQueueSourceTypes(workQueue.items),
    [workQueue.items],
  );
  const moveQueueItems = useMemo(() => cockpitRecs.map(recToEngineWorkQueueItem), [cockpitRecs]);
  const moveQueueSourceCounts = useMemo(
    () => countEngineWorkQueueSourceTypes(moveQueueItems),
    [moveQueueItems],
  );

  const invalidateStrategy = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.strategyDiff(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
  }, [queryClient, workspaceId]);
  const invalidateRecommendations = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.recommendations(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.shared.recommendations(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.issueLenses(workspaceId) });
  }, [queryClient, workspaceId]);
  const invalidateWorkspaceHome = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
  }, [queryClient, workspaceId]);

  useWorkspaceEvents(workspaceId || undefined, {
    // ws-invalidation-ok — Engine owns its rebuilt-shell cache refresh because it can mount outside the legacy dashboard invalidator.
    [WS_EVENTS.STRATEGY_UPDATED]: invalidateStrategy,
    // ws-invalidation-ok — recommendation lifecycle mutations alter Engine moves, Issue lenses, and send counts.
    [WS_EVENTS.RECOMMENDATIONS_UPDATED]: invalidateRecommendations,
    // ws-invalidation-ok — workspace home carries the SB-004 shared work queue and cached money frame.
    [WS_EVENTS.REQUEST_UPDATE]: invalidateWorkspaceHome,
    // ws-invalidation-ok — workspace home carries the SB-004 shared work queue and cached money frame.
    [WS_EVENTS.CONTENT_REQUEST_UPDATE]: invalidateWorkspaceHome,
    // ws-invalidation-ok — workspace home carries the SB-004 shared work queue and cached money frame.
    [WS_EVENTS.WORK_ORDER_UPDATE]: invalidateWorkspaceHome,
    // ws-invalidation-ok — workspace home carries the SB-004 shared work queue and cached money frame.
    [WS_EVENTS.OUTCOME_ACTION_RECORDED]: invalidateWorkspaceHome,
    // ws-invalidation-ok — workspace home carries the SB-004 shared work queue and cached money frame.
    [WS_EVENTS.OUTCOME_SCORED]: invalidateWorkspaceHome,
    // ws-invalidation-ok — strategy and rank updates affect Engine signals and keyword hand-offs.
    [WS_EVENTS.RANK_TRACKING_UPDATED]: invalidateStrategy,
    // ws-invalidation-ok — strategy and rank updates affect Engine signals and keyword hand-offs.
    [WS_EVENTS.SERP_SNAPSHOTS_REFRESHED]: invalidateStrategy,
  });

  return {
    keywordQuery,
    strategy,
    isRealStrategy,
    displayedSeoDataMode: strategy?.seoDataMode,
    localSync,
    settings,
    generation,
    feedback,
    metrics,
    homeQuery,
    workspace,
    workspaces,
    recommendations,
    cockpitRecs,
    lifecycleActions,
    issueBulkSend,
    strategyPov,
    operatorSteering,
    measuredCapture,
    conversionStatus,
    leads,
    leadsLimit,
    setLeadsLimit,
    contentDecay,
    localSeo,
    primaryMarket,
    workQueue,
    workQueueSourceCounts,
    moveQueueItems,
    moveQueueSourceCounts,
    stagedRecIds,
    stagedSendableIds,
    stagedCount: stagedSendableIds.length,
    curatedCount,
    toggleStage,
    stageMany,
    sendIssue,
    struckRecIds,
    markCut,
  };
}
