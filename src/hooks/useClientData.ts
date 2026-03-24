import { useState, useCallback } from 'react';
import { get, getOptional, getSafe } from '../api/client';
import { gsc, ga4 } from '../api/analytics';
import type {
  SearchOverview, PerformanceTrend, WorkspaceInfo, AuditSummary, AuditDetail,
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource, GA4DeviceBreakdown,
  GA4CountryBreakdown, GA4Event, GA4ConversionSummary,
  ClientContentRequest, ClientKeywordStrategy, ClientRequest, ApprovalBatch,
  SearchComparison, GA4Comparison, GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage,
} from '../components/client/types';
import type { PricingData } from './usePayments';

export interface ActivityLogItem { id: string; type: string; title: string; description?: string; actorName?: string; createdAt: string }
export interface RankHistoryEntry { date: string; positions: Record<string, number> }
export interface LatestRank { query: string; position: number; clicks: number; impressions: number; ctr: number; change?: number }
export interface AnnotationItem { id: string; date: string; label: string; description?: string; color?: string }
export interface AnomalyItem { type: string; severity: string; title: string; description: string; source: string; changePct: number }

export interface ContentPlanReviewCell {
  cellId: string;
  matrixId: string;
  matrixName: string;
  targetKeyword: string;
  plannedUrl?: string;
  status: string;
  variableValues?: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useClientData(_workspaceId: string) {
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [overview, setOverview] = useState<SearchOverview | null>(null);
  const [trend, setTrend] = useState<PerformanceTrend[]>([]);
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [auditDetail, setAuditDetail] = useState<AuditDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [strategyData, setStrategyData] = useState<ClientKeywordStrategy | null>(null);
  const [requestedTopics, setRequestedTopics] = useState<Set<string>>(new Set());
  const [requestingTopic, setRequestingTopic] = useState<string | null>(null);
  const [days, setDays] = useState(28);
  const [customDateRange, setCustomDateRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [ga4Overview, setGa4Overview] = useState<GA4Overview | null>(null);
  const [ga4Trend, setGa4Trend] = useState<GA4DailyTrend[]>([]);
  const [ga4Pages, setGa4Pages] = useState<GA4TopPage[]>([]);
  const [ga4Sources, setGa4Sources] = useState<GA4TopSource[]>([]);
  const [ga4Devices, setGa4Devices] = useState<GA4DeviceBreakdown[]>([]);
  const [ga4Countries, setGa4Countries] = useState<GA4CountryBreakdown[]>([]);
  const [ga4Events, setGa4Events] = useState<GA4Event[]>([]);
  const [ga4Conversions, setGa4Conversions] = useState<GA4ConversionSummary[]>([]);
  const [searchComparison, setSearchComparison] = useState<SearchComparison | null>(null);
  const [ga4Comparison, setGa4Comparison] = useState<GA4Comparison | null>(null);
  const [ga4NewVsReturning, setGa4NewVsReturning] = useState<GA4NewVsReturning[]>([]);
  const [ga4Organic, setGa4Organic] = useState<GA4OrganicOverview | null>(null);
  const [ga4LandingPages, setGa4LandingPages] = useState<GA4LandingPage[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [approvalBatches, setApprovalBatches] = useState<ApprovalBatch[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityLogItem[]>([]);
  const [rankHistory, setRankHistory] = useState<RankHistoryEntry[]>([]);
  const [latestRanks, setLatestRanks] = useState<LatestRank[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [contentRequests, setContentRequests] = useState<ClientContentRequest[]>([]);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const [contentPlanSummary, setContentPlanSummary] = useState<{ totalCells: number; publishedCells: number; reviewCells: number; approvedCells: number; inProgressCells: number; matrixCount: number } | null>(null);
  const [contentPlanKeywords, setContentPlanKeywords] = useState<Map<string, string>>(new Map());
  const [contentPlanReviewCells, setContentPlanReviewCells] = useState<ContentPlanReviewCell[]>([]);

  const setSectionError = useCallback((key: string, msg: string) => {
    setSectionErrors(prev => ({ ...prev, [key]: msg }));
  }, []);

  const clearSectionError = useCallback((key: string) => {
    setSectionErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  const loadRequests = useCallback(async (wsId: string) => {
    setRequestsLoading(true);
    try {
      const data = await getSafe<ClientRequest[]>(`/api/public/requests/${wsId}`, []);
      if (Array.isArray(data)) setRequests(data);
    } catch { setSectionError('requests', 'Unable to load requests'); }
    finally { setRequestsLoading(false); }
  }, [setSectionError]);

  const loadApprovals = useCallback(async (wsId: string) => {
    setApprovalsLoading(true);
    try {
      const data = await getSafe<ApprovalBatch[]>(`/api/public/approvals/${wsId}`, []);
      if (Array.isArray(data)) setApprovalBatches(data);
    } catch { setSectionError('approvals', 'Unable to load approvals'); }
    setApprovalsLoading(false);
  }, [setSectionError]);

  const loadSearchData = useCallback(async (wsId: string, numDays: number, dateRange?: { startDate: string; endDate: string }) => {
    try {
      const [ovData, trData, cmpData] = await Promise.all([
        gsc.overview(wsId, numDays, dateRange),
        gsc.trend(wsId, numDays, dateRange),
        gsc.comparison(wsId, numDays, dateRange),
        gsc.devices(wsId, numDays, dateRange),
      ]);
      if (ovData) setOverview(ovData as SearchOverview);
      setTrend(Array.isArray(trData) ? trData : []);
      if (cmpData) setSearchComparison(cmpData);
    } catch (err) {
      console.error('Search data load error:', err);
    }
  }, []);

  const loadGA4Data = useCallback(async (wsId: string, numDays: number, dateRange?: { startDate: string; endDate: string }) => {
    clearSectionError('analytics');
    const dr = dateRange;

    const entries: Array<{ key: string; promise: Promise<unknown> }> = [
      { key: 'overview', promise: ga4.overview(wsId, numDays, dr) },
      { key: 'trend', promise: ga4.trend(wsId, numDays, dr) },
      { key: 'pages', promise: ga4.topPages(wsId, numDays, dr) },
      { key: 'sources', promise: ga4.sources(wsId, numDays, dr) },
      { key: 'devices', promise: ga4.devices(wsId, numDays, dr) },
      { key: 'countries', promise: ga4.countries(wsId, numDays, dr) },
      { key: 'events', promise: ga4.events(wsId, numDays, dr) },
      { key: 'conversions', promise: ga4.conversions(wsId, numDays, dr) },
      { key: 'comparison', promise: ga4.comparison(wsId, numDays, dr) },
      { key: 'nvr', promise: ga4.newVsReturning(wsId, numDays, dr) },
      { key: 'organic', promise: ga4.organic(wsId, numDays, dr) },
      { key: 'landing', promise: ga4.landingPages(wsId, numDays, { dateRange: dr, organic: true, limit: 15 }) },
    ];

    // Use Promise.allSettled for coordinated loading — partial failures don't block others
    const results = await Promise.allSettled(entries.map(e => e.promise));
    const failedSections: string[] = [];

    results.forEach((result, i) => {
      const key = entries[i].key;
      if (result.status === 'rejected') { failedSections.push(key); return; }
      const d = result.value;
      switch (key) {
        case 'overview': if (d) setGa4Overview(d as GA4Overview); else failedSections.push(key); break;
        case 'trend': if (Array.isArray(d)) setGa4Trend(d as GA4DailyTrend[]); break;
        case 'pages': if (Array.isArray(d)) setGa4Pages(d as GA4TopPage[]); break;
        case 'sources': if (Array.isArray(d)) setGa4Sources(d as GA4TopSource[]); break;
        case 'devices': if (Array.isArray(d)) setGa4Devices(d as GA4DeviceBreakdown[]); break;
        case 'countries': if (Array.isArray(d)) setGa4Countries(d as GA4CountryBreakdown[]); break;
        case 'events': if (Array.isArray(d)) setGa4Events(d as GA4Event[]); break;
        case 'conversions': if (Array.isArray(d)) setGa4Conversions(d as GA4ConversionSummary[]); break;
        case 'comparison': if (d) setGa4Comparison(d as GA4Comparison); break;
        case 'nvr': if (Array.isArray(d)) setGa4NewVsReturning(d as GA4NewVsReturning[]); break;
        case 'organic': if (d) setGa4Organic(d as GA4OrganicOverview); break;
        case 'landing': if (Array.isArray(d)) setGa4LandingPages(d as GA4LandingPage[]); break;
      }
    });

    if (failedSections.length > 0) {
      const msg = failedSections.length === entries.length
        ? 'Unable to load analytics data'
        : `Partial analytics load — failed: ${failedSections.join(', ')}`;
      setSectionError('analytics', msg);
    }
  }, [setSectionError, clearSectionError]);

  /** Load all dashboard data for a workspace. Accepts optional setPricingData callback for payment hook integration. */
  const loadDashboardData = useCallback((data: WorkspaceInfo, setPricingData?: (p: PricingData | null) => void) => {
    if (data.gscPropertyUrl) loadSearchData(data.id, 28);
    getOptional<AuditSummary>(`/api/public/audit-summary/${data.id}`).then(a => { if (a?.id) { setAudit(a); clearSectionError('audit'); } }).catch(() => setSectionError('audit', 'Unable to load site health data'));
    getOptional<AuditDetail>(`/api/public/audit-detail/${data.id}`).then(d => { if (d?.id) setAuditDetail(d); }).catch((err) => { console.error('useClientData operation failed:', err); });
    if (data.ga4PropertyId) loadGA4Data(data.id, 28);
    loadApprovals(data.id);
    loadRequests(data.id);
    getSafe<ActivityLogItem[]>(`/api/public/activity/${data.id}?limit=20`, []).then(a => { if (Array.isArray(a)) setActivityLog(a); }).catch(() => setSectionError('activity', 'Unable to load activity'));
    getSafe<RankHistoryEntry[]>(`/api/public/rank-tracking/${data.id}/history`, []).then(h => { if (Array.isArray(h)) setRankHistory(h); }).catch((err) => { console.error('useClientData operation failed:', err); });
    getSafe<LatestRank[]>(`/api/public/rank-tracking/${data.id}/latest`, []).then(l => { if (Array.isArray(l)) setLatestRanks(l); }).catch(() => setSectionError('ranks', 'Unable to load ranking data'));
    getSafe<AnnotationItem[]>(`/api/public/annotations/${data.id}`, []).then(a => { if (Array.isArray(a)) setAnnotations(a); }).catch((err) => { console.error('useClientData operation failed:', err); });
    if (data.seoClientView) {
      getOptional<ClientKeywordStrategy>(`/api/public/seo-strategy/${data.id}`).then(s => { if (s) setStrategyData(s); }).catch(() => setSectionError('strategy', 'Unable to load SEO strategy'));
    }
    getOptional<PricingData>(`/api/public/pricing/${data.id}`).then(p => { if (p && setPricingData) setPricingData(p); }).catch((err) => { console.error('useClientData operation failed:', err); });
    getSafe<AnomalyItem[]>(`/api/public/anomalies/${data.id}`, []).then(a => { if (Array.isArray(a)) setAnomalies(a); }).catch((err) => { console.error('useClientData operation failed:', err); });
    getSafe<ClientContentRequest[]>(`/api/public/content-requests/${data.id}`, []).then((reqs) => {
      if (Array.isArray(reqs) && reqs.length > 0) {
        setContentRequests(reqs);
        setRequestedTopics(new Set(reqs.map(r => r.targetKeyword)));
      }
    }).catch(() => setSectionError('content', 'Unable to load content requests'));
    getSafe<Array<{ id: string; name: string; cells?: Array<{ id: string; status: string; targetKeyword?: string; plannedUrl?: string; variableValues?: Record<string, string> }> }>>(`/api/public/content-plan/${data.id}`, []).then((plans) => {
      if (Array.isArray(plans)) {
        const allCells = plans.flatMap(p => p.cells || []);
        setContentPlanSummary({
          totalCells: allCells.length,
          publishedCells: allCells.filter(c => c.status === 'published').length,
          reviewCells: allCells.filter(c => c.status === 'review' || c.status === 'flagged').length,
          approvedCells: allCells.filter(c => c.status === 'approved').length,
          inProgressCells: allCells.filter(c => c.status === 'brief_generated' || c.status === 'in_progress').length,
          matrixCount: plans.length,
        });
        const kwMap = new Map<string, string>();
        for (const c of allCells) {
          if (c.targetKeyword) kwMap.set(c.targetKeyword.toLowerCase(), c.status);
        }
        setContentPlanKeywords(kwMap);
        // Store review/flagged cells for Inbox
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
        setContentPlanReviewCells(reviewCells);
      }
    }).catch((err) => { console.error('useClientData operation failed:', err); });
  }, [loadSearchData, loadGA4Data, loadApprovals, loadRequests, clearSectionError, setSectionError]);

  const changeDays = useCallback((d: number, currentWs: WorkspaceInfo | null) => {
    setDays(d);
    setCustomDateRange(null);
    setShowDatePicker(false);
    if (currentWs) {
      loadSearchData(currentWs.id, d);
      if (currentWs.ga4PropertyId) loadGA4Data(currentWs.id, d);
    }
  }, [loadSearchData, loadGA4Data]);

  const applyCustomRange = useCallback((startDate: string, endDate: string, currentWs: WorkspaceInfo | null) => {
    const dr = { startDate, endDate };
    const spanDays = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
    setCustomDateRange(dr);
    setDays(spanDays);
    setShowDatePicker(false);
    if (currentWs) {
      loadSearchData(currentWs.id, spanDays, dr);
      if (currentWs.ga4PropertyId) loadGA4Data(currentWs.id, spanDays, dr);
    }
  }, [loadSearchData, loadGA4Data]);

  const refetchClient = useCallback(async (key: string, url: string) => {
    try {
      const d = await getOptional<unknown[]>(url);
      if (!d || !Array.isArray(d)) return;
      if (key === 'activity') setActivityLog(d as ActivityLogItem[]);
      if (key === 'approvals') setApprovalBatches(d as ApprovalBatch[]);
      if (key === 'requests') setRequests(d as ClientRequest[]);
      if (key === 'content') { setContentRequests(d as ClientContentRequest[]); setRequestedTopics(new Set((d as ClientContentRequest[]).map(r => r.targetKeyword))); }
    } catch (err) { console.error('useClientData operation failed:', err); }
  }, []);

  return {
    ws, setWs,
    overview, setOverview,
    trend, setTrend,
    audit, setAudit,
    auditDetail, setAuditDetail,
    loading, setLoading,
    error, setError,
    strategyData, setStrategyData,
    requestedTopics, setRequestedTopics,
    requestingTopic, setRequestingTopic,
    days, setDays,
    customDateRange, setCustomDateRange,
    showDatePicker, setShowDatePicker,
    ga4Overview, setGa4Overview,
    ga4Trend, setGa4Trend,
    ga4Pages, setGa4Pages,
    ga4Sources, setGa4Sources,
    ga4Devices, setGa4Devices,
    ga4Countries, setGa4Countries,
    ga4Events, setGa4Events,
    ga4Conversions, setGa4Conversions,
    searchComparison, setSearchComparison,
    ga4Comparison, setGa4Comparison,
    ga4NewVsReturning, setGa4NewVsReturning,
    ga4Organic, setGa4Organic,
    ga4LandingPages, setGa4LandingPages,
    anomalies, setAnomalies,
    approvalBatches, setApprovalBatches,
    approvalsLoading, setApprovalsLoading,
    activityLog, setActivityLog,
    rankHistory, setRankHistory,
    latestRanks, setLatestRanks,
    annotations, setAnnotations,
    requests, setRequests,
    requestsLoading, setRequestsLoading,
    contentRequests, setContentRequests,
    sectionErrors, setSectionErrors,
    contentPlanSummary, setContentPlanSummary,
    contentPlanKeywords, setContentPlanKeywords,
    contentPlanReviewCells, setContentPlanReviewCells,
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
