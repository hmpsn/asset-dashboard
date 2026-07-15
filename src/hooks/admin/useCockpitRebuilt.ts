import { useMemo } from 'react';
import { useAuditSummary } from '../useAuditSummary';
import { useAdminROI } from './useAdminROI';
import { useWorkspaceHomeData } from './useWorkspaceHome';
import { useWorkspaceIntelligence } from './useWorkspaceIntelligence';
import { useWorkspaces } from './useWorkspaces';
import type { Workspace } from '../../components/WorkspaceSelector';
import type { WorkspaceHomeData } from '../../api/platform';
import type { WorkQueueClassification, WorkQueueItem, WorkQueueSourceType } from '../../../shared/types/work-queue';
import type { AdminMoneyFrame, OutcomeProvenance } from '../../../shared/types/outcome-tracking';
import type { CockpitVerdict } from '../../../shared/types/cockpit';

export interface CockpitRankRow {
  id: string;
  query: string;
  position: number | null;
  previousPosition?: number;
  change?: number;
}

export interface CockpitRequestRow {
  id: string;
  title: string;
  status: string;
  category?: string;
  createdAt?: string;
}

export interface CockpitActivityEntry {
  id: string;
  type: string;
  title: string;
  description?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface CockpitKpiModel {
  siteHealth: {
    score: number | null;
    errors: number;
    warnings: number;
    delta: number | null;
  };
  search: {
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    avgPosition: number | null;
  };
  trafficValue: {
    organic: number | null;
    adSpendEquivalent: number | null;
    valueAtStake: number | null;
    recoveredSoFar: number | null;
    provenance: OutcomeProvenance | null;
  };
  ga4: {
    users: number | null;
    sessions: number | null;
    newUserPercentage: number | null;
    usersDelta: number | null;
  };
  ranks: {
    tracked: number;
    up: number;
    down: number;
    flat: number;
  };
  contentDecay: {
    critical: number;
    warning: number;
    total: number;
    avgDeclinePct: number | null;
  };
  contentPipeline: {
    total: number;
    published: number;
    review: number;
    approved: number;
    inProgress: number;
    percent: number | null;
  };
  contentVelocity: {
    monthly: number[];
    currentMonthPublished: number | null;
    trailingThreeMonthAvg: number | null;
    previousThreeMonthAvg: number | null;
    trendPct: number | null;
  };
  coverageGaps: number;
  overallHealth: {
    score: number | null;
    label: 'On track' | 'At risk' | 'Establishing';
  };
}

export interface UseCockpitRebuiltResult {
  workspace: Workspace | null;
  workspaceQuery: ReturnType<typeof useWorkspaces>;
  homeQuery: ReturnType<typeof useWorkspaceHomeData>;
  auditQuery: ReturnType<typeof useAuditSummary>;
  roiQuery: ReturnType<typeof useAdminROI>;
  intelligenceQuery: ReturnType<typeof useWorkspaceIntelligence>;
  homeData: WorkspaceHomeData | undefined;
  verdict: CockpitVerdict | null;
  moneyFrame: AdminMoneyFrame | null;
  workQueue: WorkQueueClassification | null;
  ranks: CockpitRankRow[];
  requests: CockpitRequestRow[];
  activity: CockpitActivityEntry[];
  kpis: CockpitKpiModel;
  lastFetched: Date | null;
}

const EMPTY_WORK_QUEUE: WorkQueueClassification = {
  streams: { opt: 0, send: 0, money: 0, unclassified: 0 },
  items: [],
};

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function asRankRows(value: unknown[] | undefined): CockpitRankRow[] {
  return (Array.isArray(value) ? value : []).slice(0, 10).map((row, index) => {
    const record = typeof row === 'object' && row !== null ? row as Record<string, unknown> : {};
    return {
      id: stringOrFallback(record.id, stringOrFallback(record.query, `rank-${index}`)),
      query: stringOrFallback(record.query, stringOrFallback(record.keyword, `Tracked keyword ${index + 1}`)),
      position: numberOrNull(record.position),
      previousPosition: numberOrNull(record.previousPosition) ?? undefined,
      change: numberOrNull(record.change) ?? undefined,
    };
  });
}

function asRequests(value: unknown[] | undefined): CockpitRequestRow[] {
  return (Array.isArray(value) ? value : []).map((row, index) => {
    const record = typeof row === 'object' && row !== null ? row as Record<string, unknown> : {};
    return {
      id: stringOrFallback(record.id, `request-${index}`),
      title: stringOrFallback(record.title, 'Client request'),
      status: stringOrFallback(record.status, 'open'),
      category: typeof record.category === 'string' ? record.category : undefined,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
    };
  });
}

function asActivity(value: unknown[] | undefined): CockpitActivityEntry[] {
  return (Array.isArray(value) ? value : []).map((row, index) => {
    const record = typeof row === 'object' && row !== null ? row as Record<string, unknown> : {};
    const metadata = typeof record.metadata === 'object' && record.metadata !== null
      ? record.metadata as Record<string, unknown>
      : undefined;
    return {
      id: stringOrFallback(record.id, `activity-${index}`),
      type: stringOrFallback(record.type, 'activity'),
      title: stringOrFallback(record.title, 'Workspace activity'),
      description: typeof record.description === 'string' ? record.description : undefined,
      createdAt: stringOrFallback(record.createdAt, new Date(0).toISOString()),
      metadata,
    };
  });
}

function countRanks(ranks: CockpitRankRow[]) {
  const up = ranks.filter((rank) => typeof rank.change === 'number' && rank.change > 0).length;
  const down = ranks.filter((rank) => typeof rank.change === 'number' && rank.change < 0).length;
  return { tracked: ranks.length, up, down, flat: ranks.length - up - down };
}

function sourceTypeCount(items: WorkQueueItem[], sourceType: WorkQueueSourceType): number {
  return items.filter((item) => item.sourceType === sourceType).length;
}

function buildKpis({
  data,
  audit,
  roiData,
  moneyFrame,
  ranks,
  coverageGaps,
  compositeHealthScore,
}: {
  data: WorkspaceHomeData | undefined;
  audit: ReturnType<typeof useAuditSummary>['audit'];
  roiData: ReturnType<typeof useAdminROI>['data'];
  moneyFrame: AdminMoneyFrame | null;
  ranks: CockpitRankRow[];
  coverageGaps: number;
  compositeHealthScore: number | null;
}): CockpitKpiModel {
  const rankCounts = countRanks(ranks);
  const contentPipeline = data?.contentPipeline ?? null;
  const totalCells = contentPipeline?.totalCells ?? 0;
  const publishedCells = contentPipeline?.publishedCells ?? 0;
  const usersCurrent = data?.comparison?.users?.current;
  const usersPrevious = data?.comparison?.users?.previous;
  const usersDelta = typeof usersCurrent === 'number' && typeof usersPrevious === 'number'
    ? Math.round(((usersCurrent - usersPrevious) / (usersPrevious || 1)) * 100)
    : null;
  const overallScore = compositeHealthScore == null ? null : Math.round(compositeHealthScore);

  return {
    siteHealth: {
      score: audit?.siteScore ?? null,
      errors: audit?.errors ?? 0,
      warnings: audit?.warnings ?? 0,
      delta: audit?.previousScore != null ? audit.siteScore - audit.previousScore : null,
    },
    search: {
      clicks: data?.searchData?.totalClicks ?? null,
      impressions: data?.searchData?.totalImpressions ?? null,
      ctr: data?.searchData?.avgCtr ?? null,
      avgPosition: data?.searchData?.avgPosition ?? null,
    },
    trafficValue: {
      organic: roiData?.organicTrafficValue ?? null,
      adSpendEquivalent: roiData?.adSpendEquivalent ?? null,
      valueAtStake: moneyFrame?.valueAtStake ?? null,
      recoveredSoFar: moneyFrame?.recoveredSoFar ?? null,
      provenance: moneyFrame?.provenance ?? null,
    },
    ga4: {
      users: data?.ga4Data?.totalUsers ?? null,
      sessions: data?.ga4Data?.totalSessions ?? null,
      newUserPercentage: data?.ga4Data?.newUserPercentage ?? null,
      usersDelta,
    },
    ranks: rankCounts,
    contentDecay: {
      critical: data?.contentDecay?.critical ?? 0,
      warning: data?.contentDecay?.warning ?? 0,
      total: data?.contentDecay?.totalDecaying ?? 0,
      avgDeclinePct: data?.contentDecay?.avgDeclinePct ?? null,
    },
    contentPipeline: {
      total: totalCells,
      published: publishedCells,
      review: contentPipeline?.reviewCells ?? 0,
      approved: contentPipeline?.approvedCells ?? 0,
      inProgress: contentPipeline?.inProgressCells ?? 0,
      percent: totalCells > 0 ? Math.round((publishedCells / totalCells) * 100) : null,
    },
    contentVelocity: {
      monthly: data?.contentVelocity?.monthly.map((point) => point.published).filter(Number.isFinite) ?? [],
      currentMonthPublished: data?.contentVelocity?.currentMonthPublished ?? null,
      trailingThreeMonthAvg: data?.contentVelocity?.trailingThreeMonthAvg ?? null,
      previousThreeMonthAvg: data?.contentVelocity?.previousThreeMonthAvg ?? null,
      trendPct: data?.contentVelocity?.trendPct ?? null,
    },
    coverageGaps,
    overallHealth: {
      score: overallScore,
      label: overallScore == null ? 'Establishing' : overallScore >= 80 ? 'On track' : 'At risk',
    },
  };
}

export function workQueueWithVisibleItems(workQueue: WorkQueueClassification | null, suppressSetup: boolean): WorkQueueClassification {
  const queue = workQueue ?? EMPTY_WORK_QUEUE;
  if (!suppressSetup) return queue;
  const items = queue.items.filter((item) => item.sourceType !== 'setup_gap');
  return {
    streams: {
      opt: items.filter((item) => item.stream === 'opt').length,
      send: items.filter((item) => item.stream === 'send').length,
      money: items.filter((item) => item.stream === 'money').length,
      unclassified: items.filter((item) => item.stream === 'unclassified').length,
    },
    items,
  };
}

export function countWorkQueueSourceTypes(items: WorkQueueItem[]): Partial<Record<WorkQueueSourceType, number>> {
  const sourceTypes = Array.from(new Set(items.map((item) => item.sourceType)));
  return Object.fromEntries(sourceTypes.map((sourceType) => [sourceType, sourceTypeCount(items, sourceType)]));
}

export function useCockpitRebuilt(workspaceId: string): UseCockpitRebuiltResult {
  const workspaceQuery = useWorkspaces();
  const homeQuery = useWorkspaceHomeData(workspaceId);
  const auditQuery = useAuditSummary(workspaceId);
  const roiQuery = useAdminROI(workspaceId);
  const intelligenceQuery = useWorkspaceIntelligence(workspaceId, ['contentPipeline', 'clientSignals']);

  const workspace = useMemo(
    () => workspaceQuery.data?.find((item) => item.id === workspaceId) ?? null,
    [workspaceId, workspaceQuery.data],
  );

  const ranks = useMemo(() => asRankRows(homeQuery.data?.ranks), [homeQuery.data?.ranks]);
  const requests = useMemo(() => asRequests(homeQuery.data?.requests), [homeQuery.data?.requests]);
  const activity = useMemo(() => asActivity(homeQuery.data?.activity), [homeQuery.data?.activity]);

  const coverageGaps = intelligenceQuery.data?.contentPipeline?.coverageGaps?.length ?? 0;
  const compositeHealthScore = numberOrNull(intelligenceQuery.data?.clientSignals?.compositeHealthScore);
  const moneyFrame = homeQuery.data?.moneyFrame ?? null;

  const kpis = useMemo(
    () => buildKpis({
      data: homeQuery.data,
      audit: auditQuery.audit,
      roiData: roiQuery.data,
      moneyFrame,
      ranks,
      coverageGaps,
      compositeHealthScore,
    }),
    [auditQuery.audit, compositeHealthScore, coverageGaps, homeQuery.data, moneyFrame, ranks, roiQuery.data],
  );

  return {
    workspace,
    workspaceQuery,
    homeQuery,
    auditQuery,
    roiQuery,
    intelligenceQuery,
    homeData: homeQuery.data,
    verdict: homeQuery.data?.cockpitVerdict ?? null,
    moneyFrame,
    workQueue: homeQuery.data?.workQueue ?? EMPTY_WORK_QUEUE,
    ranks,
    requests,
    activity,
    kpis,
    lastFetched: homeQuery.dataUpdatedAt ? new Date(homeQuery.dataUpdatedAt) : null,
  };
}
