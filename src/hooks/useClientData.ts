import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import type {
  WorkspaceInfo, AuditSummary, AuditDetail,
  ClientContentRequest, ClientKeywordStrategy, ClientRequest, ApprovalBatch,
  SearchOverview, PerformanceTrend, SearchComparison,
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource, GA4DeviceBreakdown,
  GA4CountryBreakdown, GA4Event, GA4ConversionSummary,
  GA4Comparison, GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage,
} from '../components/client/types';
import type { PricingData } from './usePayments';
import { useClientSearch } from './client/useClientSearch';
import { useClientGA4 } from './client/useClientGA4';
import {
  useClientActivity, useClientRankHistory, useClientLatestRanks,
  useClientAnnotations, useClientAnomalies, useClientApprovals,
  useClientRequests as useClientRequestsQuery, useClientContentRequests,
  useClientAuditSummary, useClientAuditDetail,
  useClientStrategy, useClientPricing, useClientContentPlan,
  useClientPageKeywords,
} from './client/useClientQueries';
export type { ApprovalPageKeyword } from './client/useClientQueries';

// ── Exported type interfaces (consumed by other modules) ──────────
export interface ActivityLogItem { id: string; workspaceId?: string; type: string; title: string; description?: string; metadata?: Record<string, unknown>; actorId?: string; actorName?: string; createdAt: string }
export interface RankHistoryEntry { date: string; positions: Record<string, number> }
export interface LatestRank { query: string; position: number; clicks: number; impressions: number; ctr: number; change?: number }
export interface AnnotationItem { id: string; date: string; label: string; description?: string; color?: string; createdAt: string }
export interface AnomalyItem { id: string; workspaceId?: string; workspaceName?: string; type: string; severity: string; title: string; description: string; metric: string; currentValue: number; previousValue: number; changePct: number; aiSummary?: string; detectedAt: string; dismissedAt?: string; acknowledgedAt?: string; source: string }

export interface ContentPlanReviewCell {
  cellId: string;
  matrixId: string;
  matrixName: string;
  targetKeyword: string;
  plannedUrl?: string;
  status: string;
  variableValues?: Record<string, string>;
}

/**
 * Client dashboard data hook — React Query facade.
 *
 * Internally composes individual React Query hooks for each data domain.
 * Returns the same interface as the previous manual useState/useEffect version
 * so that ClientDashboard.tsx (and downstream consumers) need minimal changes.
 *
 * Benefits over the old approach:
 * - Automatic caching (60s stale time, 5min gc)
 * - Stale-while-revalidate on tab focus
 * - Independent per-section loading/error states
 * - Date range changes trigger automatic refetch (query key changes)
 * - WebSocket invalidation via queryClient.invalidateQueries
 */
export function useClientData(workspaceId: string) {
  const queryClient = useQueryClient();

  // ── Workspace + global UI state (not fetch-driven) ──────────────
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestedTopics, setRequestedTopics] = useState<Set<string>>(new Set());
  const [requestingTopic, setRequestingTopic] = useState<string | null>(null);
  const [days, setDays] = useState(28);
  const [customDateRange, setCustomDateRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // ── Data-fetching gate (enabled after auth + workspace load) ────
  const [dataEnabled, setDataEnabled] = useState(false);

  // ── React Query hooks ───────────────────────────────────────────
  const dateRange = customDateRange ?? undefined;

  const search = useClientSearch(workspaceId, days, dateRange, dataEnabled && !!ws?.gscPropertyUrl);
  const ga4Data = useClientGA4(workspaceId, days, dateRange, dataEnabled && !!ws?.ga4PropertyId);

  const activityQ = useClientActivity(workspaceId, dataEnabled);
  const rankHistoryQ = useClientRankHistory(workspaceId, dataEnabled);
  const latestRanksQ = useClientLatestRanks(workspaceId, dataEnabled);
  const annotationsQ = useClientAnnotations(workspaceId, dataEnabled);
  const anomaliesQ = useClientAnomalies(workspaceId, dataEnabled);
  const approvalsQ = useClientApprovals(workspaceId, dataEnabled);
  const requestsQ = useClientRequestsQuery(workspaceId, dataEnabled);
  const contentReqQ = useClientContentRequests(workspaceId, dataEnabled);
  const auditSummaryQ = useClientAuditSummary(workspaceId, dataEnabled);
  const auditDetailQ = useClientAuditDetail(workspaceId, dataEnabled);
  // seoClientView gates the Strategy tab in the UI — not this fetch.
  // strategyData powers Overview insights, InsightsDigest, and AI chat regardless of tab visibility.
  const strategyQ = useClientStrategy(workspaceId, dataEnabled);
  const pageKeywordsQ = useClientPageKeywords(workspaceId, dataEnabled);
  useClientPricing(workspaceId, dataEnabled); // fires query; data consumed via queryClient.getQueryData in loadDashboardData
  const contentPlanQ = useClientContentPlan(workspaceId, dataEnabled);

  // ── Derived: content request topics ─────────────────────────────
  const contentRequests = useMemo(() => contentReqQ.data ?? [], [contentReqQ.data]);
  const derivedTopics = useMemo(() => {
    if (contentRequests.length === 0) return requestedTopics;
    return new Set(contentRequests.map(r => r.targetKeyword));
  }, [contentRequests, requestedTopics]);

  // ── Section errors (aggregated from React Query error states) ───
  const sectionErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (activityQ.error) errs.activity = 'Unable to load activity';
    if (latestRanksQ.error) errs.ranks = 'Unable to load ranking data';
    if (auditSummaryQ.error) errs.audit = 'Unable to load site health data';
    if (approvalsQ.error) errs.approvals = 'Unable to load approvals';
    if (requestsQ.error) errs.requests = 'Unable to load requests';
    if (contentReqQ.error) errs.content = 'Unable to load content requests';
    if (strategyQ.error) errs.strategy = 'Unable to load SEO strategy';
    if (ga4Data.sectionError) errs.analytics = ga4Data.sectionError;
    return errs;
  }, [activityQ.error, latestRanksQ.error, auditSummaryQ.error, approvalsQ.error,
      requestsQ.error, contentReqQ.error, strategyQ.error, ga4Data.sectionError]);

  // ── Compatibility setters (update React Query cache directly) ───
  const setAudit = useCallback((val: AuditSummary | null | ((prev: AuditSummary | null) => AuditSummary | null)) => {
    queryClient.setQueryData(queryKeys.client.auditSummary(workspaceId), (prev: AuditSummary | null | undefined) => {
      return typeof val === 'function' ? val(prev ?? null) : val;
    });
  }, [queryClient, workspaceId]);

  const setApprovalBatches = useCallback((val: ApprovalBatch[] | ((prev: ApprovalBatch[]) => ApprovalBatch[])) => {
    queryClient.setQueryData(queryKeys.client.approvals(workspaceId), (prev: ApprovalBatch[] | undefined) => {
      return typeof val === 'function' ? val(prev ?? []) : val;
    });
  }, [queryClient, workspaceId]);

  const setContentRequests = useCallback((val: ClientContentRequest[] | ((prev: ClientContentRequest[]) => ClientContentRequest[])) => {
    queryClient.setQueryData(queryKeys.client.contentRequests(workspaceId), (prev: ClientContentRequest[] | undefined) => {
      return typeof val === 'function' ? val(prev ?? []) : val;
    });
  }, [queryClient, workspaceId]);

  // ── Compatibility: section error setters (mostly no-ops now) ────
  const setSectionErrors = useState<Record<string, string>>({})[1]; // placeholder for backward compat
  const setSectionError = useCallback((_key: string, _msg: string) => { /* errors now derived from React Query */ }, []);
  const clearSectionError = useCallback((_key: string) => { /* errors now derived from React Query */ }, []);

  // ── loadDashboardData: enables React Query hooks + sets pricing ─
  const loadDashboardData = useCallback((data: WorkspaceInfo, setPricingData?: (p: PricingData | null) => void) => {
    setWs(data);
    setDataEnabled(true);
    // Pricing callback for usePayments integration
    if (setPricingData) {
      // When pricing query resolves, pass to the payments hook
      const checkPricing = () => {
        const cached = queryClient.getQueryData<PricingData | null>(queryKeys.client.pricing(data.id));
        if (cached) setPricingData(cached);
      };
      // Check once after a short delay (query will have fired), then observe
      setTimeout(checkPricing, 500);
      const unsub = queryClient.getQueryCache().subscribe((event) => {
        if (event.type === 'updated' && event.query.queryKey[0] === 'client-pricing') {
          const d = event.query.state.data as PricingData | null;
          if (d) setPricingData(d);
          unsub();
        }
      });
    }
  }, [queryClient]);

  // ── loadSearchData / loadGA4Data: now just change date params ───
  const loadSearchData = useCallback((_wsId: string, numDays: number, dateRange?: { startDate: string; endDate: string }) => {
    setDays(numDays);
    if (dateRange) setCustomDateRange(dateRange);
    // React Query auto-refetches when query key (days/dateRange) changes
  }, []);

  const loadGA4Data = useCallback((_wsId: string, numDays: number, dateRange?: { startDate: string; endDate: string }) => {
    setDays(numDays);
    if (dateRange) setCustomDateRange(dateRange);
  }, []);

  // ── loadRequests / loadApprovals: invalidate queries ────────────
  const loadRequests = useCallback((_wsId: string) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.client.requests(workspaceId) });
  }, [queryClient, workspaceId]);

  const loadApprovals = useCallback((_wsId: string) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.client.approvals(workspaceId) });
  }, [queryClient, workspaceId]);

  // ── changeDays / applyCustomRange ───────────────────────────────
  const changeDays = useCallback((d: number, _currentWs: WorkspaceInfo | null) => {
    setDays(d);
    setCustomDateRange(null);
    setShowDatePicker(false);
    // React Query auto-refetches — query keys include days + dateRange
  }, []);

  const applyCustomRange = useCallback((startDate: string, endDate: string, _currentWs: WorkspaceInfo | null) => {
    const dr = { startDate, endDate };
    const spanDays = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
    setCustomDateRange(dr);
    setDays(spanDays);
    setShowDatePicker(false);
  }, []);

  // ── refetchClient: invalidate the appropriate query ─────────────
  const refetchClient = useCallback((key: string, _url: string) => {
    const keyFns: Record<string, readonly unknown[]> = {
      activity: queryKeys.client.activity(workspaceId),
      approvals: queryKeys.client.approvals(workspaceId),
      requests: queryKeys.client.requests(workspaceId),
      content: queryKeys.client.contentRequests(workspaceId),
      audit: queryKeys.client.auditSummary(workspaceId),
      'audit-detail': queryKeys.client.auditDetail(workspaceId),
    };
    const qk = keyFns[key];
    if (qk) queryClient.invalidateQueries({ queryKey: qk });
  }, [queryClient, workspaceId]);

  // ── Content plan derived data ───────────────────────────────────
  const planResult = contentPlanQ.data;

  // ── No-op setters for backward compat (data is React Query driven) ──
  const noop = useCallback(() => {}, []);

  return {
    ws, setWs,
    overview: search.overview, setOverview: noop as unknown as React.Dispatch<React.SetStateAction<SearchOverview | null>>,
    trend: search.trend, setTrend: noop as unknown as React.Dispatch<React.SetStateAction<PerformanceTrend[]>>,
    audit: auditSummaryQ.data ?? null, setAudit,
    auditDetail: auditDetailQ.data ?? null, setAuditDetail: noop as unknown as React.Dispatch<React.SetStateAction<AuditDetail | null>>,
    loading, setLoading,
    error, setError,
    strategyData: strategyQ.data ?? null, setStrategyData: noop as unknown as React.Dispatch<React.SetStateAction<ClientKeywordStrategy | null>>,
    requestedTopics: derivedTopics, setRequestedTopics,
    requestingTopic, setRequestingTopic,
    days, setDays,
    customDateRange, setCustomDateRange,
    showDatePicker, setShowDatePicker,
    ga4Overview: ga4Data.ga4Overview, setGa4Overview: noop as unknown as React.Dispatch<React.SetStateAction<GA4Overview | null>>,
    ga4Trend: ga4Data.ga4Trend, setGa4Trend: noop as unknown as React.Dispatch<React.SetStateAction<GA4DailyTrend[]>>,
    ga4Pages: ga4Data.ga4Pages, setGa4Pages: noop as unknown as React.Dispatch<React.SetStateAction<GA4TopPage[]>>,
    ga4Sources: ga4Data.ga4Sources, setGa4Sources: noop as unknown as React.Dispatch<React.SetStateAction<GA4TopSource[]>>,
    ga4Devices: ga4Data.ga4Devices, setGa4Devices: noop as unknown as React.Dispatch<React.SetStateAction<GA4DeviceBreakdown[]>>,
    ga4Countries: ga4Data.ga4Countries, setGa4Countries: noop as unknown as React.Dispatch<React.SetStateAction<GA4CountryBreakdown[]>>,
    ga4Events: ga4Data.ga4Events, setGa4Events: noop as unknown as React.Dispatch<React.SetStateAction<GA4Event[]>>,
    ga4Conversions: ga4Data.ga4Conversions, setGa4Conversions: noop as unknown as React.Dispatch<React.SetStateAction<GA4ConversionSummary[]>>,
    searchComparison: search.comparison, setSearchComparison: noop as unknown as React.Dispatch<React.SetStateAction<SearchComparison | null>>,
    ga4Comparison: ga4Data.ga4Comparison, setGa4Comparison: noop as unknown as React.Dispatch<React.SetStateAction<GA4Comparison | null>>,
    ga4NewVsReturning: ga4Data.ga4NewVsReturning, setGa4NewVsReturning: noop as unknown as React.Dispatch<React.SetStateAction<GA4NewVsReturning[]>>,
    ga4Organic: ga4Data.ga4Organic, setGa4Organic: noop as unknown as React.Dispatch<React.SetStateAction<GA4OrganicOverview | null>>,
    ga4LandingPages: ga4Data.ga4LandingPages, setGa4LandingPages: noop as unknown as React.Dispatch<React.SetStateAction<GA4LandingPage[]>>,
    anomalies: anomaliesQ.data ?? [], setAnomalies: noop as unknown as React.Dispatch<React.SetStateAction<AnomalyItem[]>>,
    approvalBatches: approvalsQ.data ?? [], setApprovalBatches,
    approvalsLoading: approvalsQ.isLoading, setApprovalsLoading: noop as unknown as React.Dispatch<React.SetStateAction<boolean>>,
    approvalPageKeywords: pageKeywordsQ.data ?? null,
    activityLog: activityQ.data ?? [], setActivityLog: noop as unknown as React.Dispatch<React.SetStateAction<ActivityLogItem[]>>,
    rankHistory: rankHistoryQ.data ?? [], setRankHistory: noop as unknown as React.Dispatch<React.SetStateAction<RankHistoryEntry[]>>,
    latestRanks: latestRanksQ.data ?? [], setLatestRanks: noop as unknown as React.Dispatch<React.SetStateAction<LatestRank[]>>,
    annotations: annotationsQ.data ?? [], setAnnotations: noop as unknown as React.Dispatch<React.SetStateAction<AnnotationItem[]>>,
    requests: requestsQ.data ?? [], setRequests: noop as unknown as React.Dispatch<React.SetStateAction<ClientRequest[]>>,
    requestsLoading: requestsQ.isLoading, setRequestsLoading: noop as unknown as React.Dispatch<React.SetStateAction<boolean>>,
    contentRequests, setContentRequests,
    sectionErrors, setSectionErrors,
    contentPlanSummary: planResult?.summary ?? null, setContentPlanSummary: noop as unknown as React.Dispatch<React.SetStateAction<{ totalCells: number; publishedCells: number; reviewCells: number; approvedCells: number; inProgressCells: number; matrixCount: number } | null>>,
    contentPlanKeywords: planResult?.keywords ?? new Map<string, string>(), setContentPlanKeywords: noop as unknown as React.Dispatch<React.SetStateAction<Map<string, string>>>,
    contentPlanReviewCells: planResult?.reviewCells ?? [], setContentPlanReviewCells: noop as unknown as React.Dispatch<React.SetStateAction<ContentPlanReviewCell[]>>,
    setSectionError,
    clearSectionError,
    loadDashboardData,
    loadSearchData,
    loadGA4Data,
    loadRequests,
    loadApprovals,
    changeDays,
    applyCustomRange,
    refetchClient,
  };
}
