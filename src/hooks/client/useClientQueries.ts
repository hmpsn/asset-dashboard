import { useQuery } from '@tanstack/react-query';
import { ApiError, get, getSafe, getOptional } from '../../api/client';
import { publicCopyReview } from '../../api/content';
import { queryKeys } from '../../lib/queryKeys';
import type { AnalyticsInsight } from '../../../shared/types/analytics';
import type { ClientAction } from '../../../shared/types/client-actions';
import type {
  AuditSummary, AuditDetail,
  ClientContentRequest, ClientKeywordStrategy, ClientRequest, ApprovalBatch,
  ActivityLogItem, RankHistoryEntry, LatestRank,
  AnnotationItem, AnomalyItem, ContentPlanReviewCell,
} from '../../components/client/types';
import type { PricingData } from '../usePayments';
import { keywordComparisonKey } from '../../../shared/keyword-normalization';
import type { ROIData } from '../../../shared/types/roi';

// ── Activity ──────────────────────────────────────────────────────
export function useClientActivity(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.activity(wsId),
    queryFn: () => getSafe<ActivityLogItem[]>(`/api/public/activity/${wsId}?limit=20`, []),
    enabled,
    select: (d) => (Array.isArray(d) ? d : []),
  });
}

// ── Rank Tracking ─────────────────────────────────────────────────
export function useClientRankHistory(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.rankHistory(wsId),
    queryFn: () => getSafe<RankHistoryEntry[]>(`/api/public/rank-tracking/${wsId}/history`, []),
    enabled,
    select: (d) => (Array.isArray(d) ? d : []),
  });
}

export function useClientLatestRanks(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.latestRanks(wsId),
    queryFn: () => getSafe<LatestRank[]>(`/api/public/rank-tracking/${wsId}/latest`, []),
    enabled,
    select: (d) => (Array.isArray(d) ? d : []),
  });
}

// ── Annotations ───────────────────────────────────────────────────
export function useClientAnnotations(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.annotations(wsId),
    queryFn: () => getSafe<AnnotationItem[]>(`/api/public/annotations/${wsId}`, []),
    enabled,
    select: (d) => (Array.isArray(d) ? d : []),
  });
}

// ── Anomalies ─────────────────────────────────────────────────────
export function useClientAnomalies(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.anomalies(wsId),
    queryFn: () => getSafe<AnomalyItem[]>(`/api/public/anomalies/${wsId}`, []),
    enabled,
    select: (d) => (Array.isArray(d) ? d : []),
  });
}

// ── Approvals ─────────────────────────────────────────────────────
export function useClientApprovals(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.approvals(wsId),
    queryFn: () => get<ApprovalBatch[]>(`/api/public/approvals/${wsId}`),
    enabled,
    select: (d) => (Array.isArray(d) ? d : []),
  });
}

export function useClientActions(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.clientActions(wsId),
    queryFn: () => get<ClientAction[]>(`/api/public/client-actions/${wsId}`),
    enabled,
    select: (d) => (Array.isArray(d) ? d : []),
  });
}

// ── Client Requests ───────────────────────────────────────────────
export function useClientRequests(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.requests(wsId),
    queryFn: () => get<ClientRequest[]>(`/api/public/requests/${wsId}`),
    enabled,
    select: (d) => (Array.isArray(d) ? d : []),
  });
}

// ── Content Requests ──────────────────────────────────────────────
export function useClientContentRequests(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.contentRequests(wsId),
    queryFn: () => get<ClientContentRequest[]>(`/api/public/content-requests/${wsId}`),
    enabled,
    select: (d) => (Array.isArray(d) ? d : []),
  });
}

// ── Audit ─────────────────────────────────────────────────────────
export function useClientAuditSummary(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.auditSummary(wsId),
    queryFn: () => getOptional<AuditSummary>(`/api/public/audit-summary/${wsId}`),
    enabled,
    select: (d) => (d?.id ? d : null),
  });
}

export function useClientAuditDetail(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.auditDetail(wsId),
    queryFn: () => getOptional<AuditDetail>(`/api/public/audit-detail/${wsId}`),
    enabled,
    select: (d) => (d?.id ? d : null),
  });
}

// ── Strategy ──────────────────────────────────────────────────────
export function useClientStrategy(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.strategy(wsId),
    queryFn: () => getOptional<ClientKeywordStrategy>(`/api/public/seo-strategy/${wsId}`),
    enabled,
  });
}

export function useClientROI(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.roi(wsId),
    queryFn: async () => {
      try {
        return await get<ROIData>(`/api/public/roi/${wsId}`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 2,
  });
}

// ── Pricing ───────────────────────────────────────────────────────
export function useClientPricing(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.pricing(wsId),
    queryFn: () => getOptional<PricingData>(`/api/public/pricing/${wsId}`),
    enabled,
  });
}

// ── Content Plan ──────────────────────────────────────────────────
interface ContentPlanMatrix {
  id: string;
  name: string;
  cells?: Array<{
    id: string;
    status: string;
    targetKeyword?: string;
    plannedUrl?: string;
    variableValues?: Record<string, string>;
  }>;
}

export interface ContentPlanSummary {
  totalCells: number;
  publishedCells: number;
  reviewCells: number;
  approvedCells: number;
  inProgressCells: number;
  matrixCount: number;
}

export interface ContentPlanResult {
  summary: ContentPlanSummary | null;
  keywords: Map<string, string>;
  reviewCells: ContentPlanReviewCell[];
}

export function processContentPlan(plans: ContentPlanMatrix[]): ContentPlanResult {
  if (!Array.isArray(plans) || plans.length === 0) {
    return { summary: null, keywords: new Map(), reviewCells: [] };
  }
  const allCells = plans.flatMap(p => p.cells || []);
  const summary: ContentPlanSummary = {
    totalCells: allCells.length,
    publishedCells: allCells.filter(c => c.status === 'published').length,
    reviewCells: allCells.filter(c => c.status === 'review' || c.status === 'flagged').length,
    approvedCells: allCells.filter(c => c.status === 'approved').length,
    inProgressCells: allCells.filter(c => c.status === 'brief_generated' || c.status === 'in_progress').length,
    matrixCount: plans.length,
  };
  const keywords = new Map<string, string>();
  for (const c of allCells) {
    const keywordKey = keywordComparisonKey(c.targetKeyword);
    if (keywordKey) keywords.set(keywordKey, c.status);
  }
  const reviewCells: ContentPlanReviewCell[] = [];
  for (const plan of plans) {
    for (const c of (plan.cells || [])) {
      if (c.status === 'review' || c.status === 'flagged') {
        reviewCells.push({
          cellId: c.id,
          matrixId: plan.id,
          matrixName: plan.name,
          targetKeyword: c.targetKeyword || '',
          plannedUrl: c.plannedUrl,
          status: c.status,
          variableValues: c.variableValues,
        });
      }
    }
  }
  return { summary, keywords, reviewCells };
}

export function useClientContentPlan(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.contentPlan(wsId),
    queryFn: () => getSafe<ContentPlanMatrix[]>(`/api/public/content-plan/${wsId}`, []),
    enabled,
    select: (d) => processContentPlan(Array.isArray(d) ? d : []),
  });
}


// ── Analytics Insights ────────────────────────────────────────────
// NOTE: Named useClientRawInsights to avoid collision with useClientInsights in
// ./useClientInsights.ts (which fetches from the /narrative endpoint and returns ClientInsight[]).
// This hook fetches raw AnalyticsInsight[] from /api/public/insights/{wsId}.
export function useClientRawInsights(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.insights(wsId),
    queryFn: () => getSafe<AnalyticsInsight[]>(`/api/public/insights/${wsId}`, []),
    enabled,
    select: (d) => (Array.isArray(d) ? d : []),
  });
}

// ── Copy Review ───────────────────────────────────────────────────
/**
 * Lightweight count-only probe used by InboxTab to decide whether to render
 * the Copy Review filter tab. Uses `copyEntriesCount` (a distinct key from
 * `copyEntries`) so its `getSafe` fallback does NOT dedupe with the full
 * ClientCopyReview query, which uses `get()` and needs its error UI path
 * to actually receive thrown errors.
 */
export function useClientCopyEntries(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.copyEntriesCount(wsId),
    queryFn: () => getSafe<{ entries: unknown[] }>(`/api/public/copy/${wsId}/entries`, { entries: [] }),
    enabled,
    select: (d) => (Array.isArray(d?.entries) ? d.entries.length : 0),
  });
}

export function useClientCopyEntryList(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.copyEntries(wsId),
    queryFn: () => publicCopyReview.entries(wsId),
    enabled,
  });
}

export function useClientCopySections(wsId: string, entryId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.client.copySections(wsId, entryId),
    queryFn: () => publicCopyReview.sections(wsId, entryId),
    enabled,
  });
}
