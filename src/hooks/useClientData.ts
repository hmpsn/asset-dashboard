import { useState, useCallback } from 'react';
import type {
  SearchOverview, PerformanceTrend, WorkspaceInfo, AuditSummary, AuditDetail,
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4TopSource, GA4DeviceBreakdown,
  GA4CountryBreakdown, GA4Event, GA4ConversionSummary,
  ClientContentRequest, ClientKeywordStrategy, ClientRequest, ApprovalBatch,
  SearchComparison, GA4Comparison, GA4NewVsReturning, GA4OrganicOverview, GA4LandingPage,
} from '../components/client/types';

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
  const [anomalies, setAnomalies] = useState<Array<{ type: string; severity: string; title: string; description: string; source: string; changePct: number }>>([]);
  const [approvalBatches, setApprovalBatches] = useState<ApprovalBatch[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [activityLog, setActivityLog] = useState<{ id: string; type: string; title: string; description?: string; actorName?: string; createdAt: string }[]>([]);
  const [rankHistory, setRankHistory] = useState<{ date: string; positions: Record<string, number> }[]>([]);
  const [latestRanks, setLatestRanks] = useState<{ query: string; position: number; clicks: number; impressions: number; ctr: number; change?: number }[]>([]);
  const [annotations, setAnnotations] = useState<{ id: string; date: string; label: string; description?: string; color?: string }[]>([]);
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [contentRequests, setContentRequests] = useState<ClientContentRequest[]>([]);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});

  const setSectionError = useCallback((key: string, msg: string) => {
    setSectionErrors(prev => ({ ...prev, [key]: msg }));
  }, []);

  const clearSectionError = useCallback((key: string) => {
    setSectionErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  const loadRequests = useCallback(async (wsId: string) => {
    setRequestsLoading(true);
    try {
      const res = await fetch(`/api/public/requests/${wsId}`);
      const data = await res.json();
      if (Array.isArray(data)) setRequests(data);
    } catch { setSectionError('requests', 'Unable to load requests'); }
    finally { setRequestsLoading(false); }
  }, [setSectionError]);

  const loadApprovals = useCallback(async (wsId: string) => {
    setApprovalsLoading(true);
    try {
      const res = await fetch(`/api/public/approvals/${wsId}`);
      const data = await res.json();
      if (Array.isArray(data)) setApprovalBatches(data);
    } catch { setSectionError('approvals', 'Unable to load approvals'); }
    setApprovalsLoading(false);
  }, [setSectionError]);

  const loadSearchData = useCallback(async (wsId: string, numDays: number, dateRange?: { startDate: string; endDate: string }) => {
    try {
      const drParams = dateRange ? `&startDate=${dateRange.startDate}&endDate=${dateRange.endDate}` : '';
      const [ovRes, trRes, cmpRes, devRes] = await Promise.all([
        fetch(`/api/public/search-overview/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/performance-trend/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/search-comparison/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/search-devices/${wsId}?days=${numDays}${drParams}`),
      ]);
      const [ovData, trData, cmpData] = await Promise.all([ovRes.json(), trRes.json(), cmpRes.json(), devRes.json()]);
      if (ovData.error) throw new Error(ovData.error);
      setOverview(ovData);
      setTrend(Array.isArray(trData) ? trData : []);
      if (cmpData && !cmpData.error) setSearchComparison(cmpData);
    } catch (err) {
      console.error('Search data load error:', err);
    }
  }, []);

  const loadGA4Data = useCallback(async (wsId: string, numDays: number, dateRange?: { startDate: string; endDate: string }) => {
    try {
      const drParams = dateRange ? `&startDate=${dateRange.startDate}&endDate=${dateRange.endDate}` : '';
      const [ovRes, trRes, pgRes, srcRes, devRes, ctryRes, evtRes, convRes, cmpRes, nvrRes, orgRes, lpRes] = await Promise.all([
        fetch(`/api/public/analytics-overview/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/analytics-trend/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/analytics-top-pages/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/analytics-sources/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/analytics-devices/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/analytics-countries/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/analytics-events/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/analytics-conversions/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/analytics-comparison/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/analytics-new-vs-returning/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/analytics-organic/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/analytics-landing-pages/${wsId}?days=${numDays}${drParams}&organic=true&limit=15`),
      ]);
      const [ov, tr, pg, src, dev, ctry, evt, conv, cmp, nvr, org, lp] = await Promise.all([ovRes.json(), trRes.json(), pgRes.json(), srcRes.json(), devRes.json(), ctryRes.json(), evtRes.json(), convRes.json(), cmpRes.json(), nvrRes.json(), orgRes.json(), lpRes.json()]);
      if (!ov.error) setGa4Overview(ov);
      if (Array.isArray(tr)) setGa4Trend(tr);
      if (Array.isArray(pg)) setGa4Pages(pg);
      if (Array.isArray(src)) setGa4Sources(src);
      if (Array.isArray(dev)) setGa4Devices(dev);
      if (Array.isArray(ctry)) setGa4Countries(ctry);
      if (Array.isArray(evt)) setGa4Events(evt);
      if (Array.isArray(conv)) setGa4Conversions(conv);
      if (cmp && !cmp.error) setGa4Comparison(cmp);
      if (Array.isArray(nvr)) setGa4NewVsReturning(nvr);
      if (org && !org.error) setGa4Organic(org);
      if (Array.isArray(lp)) setGa4LandingPages(lp);
    } catch (err) {
      console.error('GA4 data load error:', err);
      setSectionError('analytics', 'Unable to load analytics data');
    }
  }, [setSectionError]);

  /** Load all dashboard data for a workspace. Accepts optional setPricingData callback for payment hook integration. */
  const loadDashboardData = useCallback((data: WorkspaceInfo, setPricingData?: (p: unknown) => void) => {
    if (data.gscPropertyUrl) loadSearchData(data.id, 28);
    fetch(`/api/public/audit-summary/${data.id}`).then(r => r.json()).then(a => { if (a?.id) { setAudit(a); clearSectionError('audit'); } }).catch(() => setSectionError('audit', 'Unable to load site health data'));
    fetch(`/api/public/audit-detail/${data.id}`).then(r => r.json()).then(d => { if (d?.id) setAuditDetail(d); }).catch(() => {});
    if (data.ga4PropertyId) loadGA4Data(data.id, 28);
    loadApprovals(data.id);
    loadRequests(data.id);
    fetch(`/api/public/activity/${data.id}?limit=20`).then(r => r.json()).then(a => { if (Array.isArray(a)) setActivityLog(a); }).catch(() => setSectionError('activity', 'Unable to load activity'));
    fetch(`/api/public/rank-tracking/${data.id}/history`).then(r => r.json()).then(h => { if (Array.isArray(h)) setRankHistory(h); }).catch(() => {});
    fetch(`/api/public/rank-tracking/${data.id}/latest`).then(r => r.json()).then(l => { if (Array.isArray(l)) setLatestRanks(l); }).catch(() => setSectionError('ranks', 'Unable to load ranking data'));
    fetch(`/api/public/annotations/${data.id}`).then(r => r.json()).then(a => { if (Array.isArray(a)) setAnnotations(a); }).catch(() => {});
    if (data.seoClientView) {
      fetch(`/api/public/seo-strategy/${data.id}`).then(r => r.ok ? r.json() : null).then(s => { if (s) setStrategyData(s); }).catch(() => setSectionError('strategy', 'Unable to load SEO strategy'));
    }
    fetch(`/api/public/pricing/${data.id}`).then(r => r.ok ? r.json() : null).then(p => { if (p && setPricingData) setPricingData(p); }).catch(() => {});
    fetch(`/api/public/anomalies/${data.id}`).then(r => r.ok ? r.json() : []).then(a => { if (Array.isArray(a)) setAnomalies(a); }).catch(() => {});
    fetch(`/api/public/content-requests/${data.id}`).then(r => r.ok ? r.json() : []).then((reqs: ClientContentRequest[]) => {
      if (Array.isArray(reqs) && reqs.length > 0) {
        setContentRequests(reqs);
        setRequestedTopics(new Set(reqs.map(r => r.targetKeyword)));
      }
    }).catch(() => setSectionError('content', 'Unable to load content requests'));
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
      const r = await fetch(url);
      if (!r.ok) return;
      const d = await r.json();
      if (key === 'activity' && Array.isArray(d)) setActivityLog(d);
      if (key === 'approvals' && Array.isArray(d)) setApprovalBatches(d);
      if (key === 'requests' && Array.isArray(d)) setRequests(d);
      if (key === 'content' && Array.isArray(d)) { setContentRequests(d); setRequestedTopics(new Set(d.map((r: ClientContentRequest) => r.targetKeyword))); }
    } catch { /* ignore */ }
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
