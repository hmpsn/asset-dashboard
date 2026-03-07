import { useState, useEffect, useRef } from 'react';
import {
  Loader2, Search, TrendingDown, TrendingUp, Eye, MousePointerClick,
  BarChart3, ArrowUpDown, Sparkles, Send, AlertTriangle,
  Target, Zap, Shield, MessageSquare, X, ChevronDown, ChevronUp,
  CheckCircle2, LineChart, Lock, Trophy, Users,
  Activity, Filter, ClipboardCheck, Check, Edit3,
  Sun, Moon, Plus, Paperclip, FileText, Download, ExternalLink, Calendar,
} from 'lucide-react';
import SearchableSelect from './SearchableSelect';
import { StatCard, CompactStatBar, EmptyState } from './ui';
import { DualTrendChart, RenderMarkdown, InsightCard } from './client/helpers';
import { HealthTab } from './client/HealthTab';
import { OrganicInsight } from './client/DataSnapshots';
import { InsightsDigest } from './client/InsightsDigest';
import {
  QUICK_QUESTIONS,
  type SearchOverview, type PerformanceTrend, type WorkspaceInfo, type AuditSummary,
  type AuditDetail, type ChatMessage, type GA4Overview, type GA4DailyTrend, type GA4TopPage,
  type GA4TopSource, type GA4DeviceBreakdown, type GA4CountryBreakdown, type GA4Event,
  type GA4EventTrend, type GA4ConversionSummary, type GA4EventPageBreakdown,
  type ClientContentRequest, type ClientBriefPreview, type ClientKeywordStrategy,
  type ClientRequest, type ApprovalBatch,
  type SearchComparison, type GA4Comparison, type GA4NewVsReturning, type GA4OrganicOverview, type GA4LandingPage,
  type SortKey, type ClientTab, type RequestCategory,
} from './client/types';

export function ClientDashboard({ workspaceId }: { workspaceId: string }) {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('dashboard-theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; }
  });
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('dashboard-theme', next); } catch { /* skip */ }
  };
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [overview, setOverview] = useState<SearchOverview | null>(null);
  const [trend, setTrend] = useState<PerformanceTrend[]>([]);
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [auditDetail, setAuditDetail] = useState<AuditDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTabRaw] = useState<ClientTab>(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    if (t && ['overview','search','health','strategy','analytics','approvals','requests','content'].includes(t)) return t as ClientTab;
    return 'overview';
  });
  const setTab = (t: ClientTab) => {
    setTabRaw(t);
    const url = new URL(window.location.href);
    if (t === 'overview') url.searchParams.delete('tab'); else url.searchParams.set('tab', t);
    window.history.replaceState({}, '', url.toString());
  };
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [strategyData, setStrategyData] = useState<ClientKeywordStrategy | null>(null);
  const [requestedTopics, setRequestedTopics] = useState<Set<string>>(new Set());
  const [requestingTopic, setRequestingTopic] = useState<string | null>(null); // used by confirmPricingAndSubmit
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [mapSearch, setMapSearch] = useState('');
  const [mapSort, setMapSort] = useState<'default' | 'position' | 'impressions' | 'clicks'>('default');
  const [mapIntent, setMapIntent] = useState<string>('all');
  const [days, setDays] = useState(28);
  const [customDateRange, setCustomDateRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('clicks');
  const [sortAsc, setSortAsc] = useState(false);
  const [searchSubTab, setSearchSubTab] = useState<'queries' | 'pages'>('queries');
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const proactiveInsightSent = useRef(false);
  const [chatSessionId, setChatSessionId] = useState<string>(() => `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string; messageCount: number; updatedAt: string }>>([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [ga4Overview, setGa4Overview] = useState<GA4Overview | null>(null);
  const [ga4Trend, setGa4Trend] = useState<GA4DailyTrend[]>([]);
  const [ga4Pages, setGa4Pages] = useState<GA4TopPage[]>([]);
  const [ga4Sources, setGa4Sources] = useState<GA4TopSource[]>([]);
  const [ga4Devices, setGa4Devices] = useState<GA4DeviceBreakdown[]>([]);
  const [ga4Countries, setGa4Countries] = useState<GA4CountryBreakdown[]>([]);
  const [ga4Events, setGa4Events] = useState<GA4Event[]>([]);
  const [ga4Conversions, setGa4Conversions] = useState<GA4ConversionSummary[]>([]);
  const [ga4SelectedEvent, setGa4SelectedEvent] = useState<string | null>(null);
  const [ga4EventTrend, setGa4EventTrend] = useState<GA4EventTrend[]>([]);
  const [explorerData, setExplorerData] = useState<GA4EventPageBreakdown[]>([]);
  const [explorerEvent, setExplorerEvent] = useState('');
  const [explorerPage, setExplorerPage] = useState('');
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [showExplorer, setShowExplorer] = useState(false);
  const [modulePageFilters, setModulePageFilters] = useState<Record<string, string>>({});
  const [modulePageData, setModulePageData] = useState<Record<string, GA4ConversionSummary[]>>({});
  const [modulePageLoading, setModulePageLoading] = useState<Record<string, boolean>>({});
  const [searchComparison, setSearchComparison] = useState<SearchComparison | null>(null);
  const [searchDevices, setSearchDevices] = useState<{ device: string; clicks: number; impressions: number; ctr: number; position: number }[]>([]);
  const [ga4Comparison, setGa4Comparison] = useState<GA4Comparison | null>(null);
  const [ga4NewVsReturning, setGa4NewVsReturning] = useState<GA4NewVsReturning[]>([]);
  const [ga4Organic, setGa4Organic] = useState<GA4OrganicOverview | null>(null);
  const [ga4LandingPages, setGa4LandingPages] = useState<GA4LandingPage[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [approvalBatches, setApprovalBatches] = useState<ApprovalBatch[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [applyingBatch, setApplyingBatch] = useState<string | null>(null);
  const [editingApproval, setEditingApproval] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // Activity log
  const [activityLog, setActivityLog] = useState<{ id: string; type: string; title: string; description?: string; createdAt: string }[]>([]);
  // Rank tracking
  const [rankHistory, setRankHistory] = useState<{ date: string; positions: Record<string, number> }[]>([]);
  const [latestRanks, setLatestRanks] = useState<{ query: string; position: number; clicks: number; impressions: number; ctr: number; change?: number }[]>([]);
  // Annotations (read-only, managed from admin)
  const [annotations, setAnnotations] = useState<{ id: string; date: string; label: string; description?: string; color?: string }[]>([]);
  // Requests state
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [newReqTitle, setNewReqTitle] = useState('');
  const [newReqDesc, setNewReqDesc] = useState('');
  const [newReqCategory, setNewReqCategory] = useState<RequestCategory>('other');
  const [newReqPage, setNewReqPage] = useState('');
  const [newReqName, setNewReqName] = useState('');
  const [submittingReq, setSubmittingReq] = useState(false);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [reqNoteInput, setReqNoteInput] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const noteFileRef = useRef<HTMLInputElement>(null);
  const [newReqFiles, setNewReqFiles] = useState<File[]>([]);
  const newReqFileRef = useRef<HTMLInputElement>(null);
  // Content hub state
  const [contentRequests, setContentRequests] = useState<ClientContentRequest[]>([]);
  const [briefPreviews, setBriefPreviews] = useState<Record<string, ClientBriefPreview>>({});
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [newTopicKeyword, setNewTopicKeyword] = useState('');
  const [newTopicNotes, setNewTopicNotes] = useState('');
  const [newTopicServiceType, setNewTopicServiceType] = useState<'brief_only' | 'full_post'>('brief_only');
  const [upgradingReqId, setUpgradingReqId] = useState<string | null>(null);
  // Pricing confirmation modal state
  const [pricingModal, setPricingModal] = useState<{
    serviceType: 'brief_only' | 'full_post';
    topic: string;
    targetKeyword: string;
    intent?: string;
    priority?: string;
    rationale?: string;
    notes?: string;
    source: 'strategy' | 'client' | 'upgrade';
    upgradeReqId?: string;
  } | null>(null);
  const [pricingConfirming, setPricingConfirming] = useState(false);
  const [expandedContentReq, setExpandedContentReq] = useState<string | null>(null);
  const [contentComment, setContentComment] = useState('');
  const [sendingContentComment, setSendingContentComment] = useState(false);
  const [declineReqId, setDeclineReqId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [feedbackReqId, setFeedbackReqId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState('');

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // Load workspace info first (includes requiresPassword flag)
  useEffect(() => {
    setLoading(true);
    fetch(`/api/public/workspace/${workspaceId}`)
      .then(r => {
        if (r.status === 403) { setError('This dashboard is currently unavailable. Please contact your web team for access.'); setLoading(false); throw new Error('portal_disabled'); }
        return r.json();
      })
      .then((data: WorkspaceInfo) => {
        if (!data.id) { setError('Workspace not found'); setLoading(false); return; }
        setWs(data);
        document.title = `${data.name} — Insights Engine`;
        // Check if already authenticated via sessionStorage
        if (data.requiresPassword) {
          const stored = sessionStorage.getItem(`dash_auth_${workspaceId}`);
          if (stored === 'true') {
            setAuthenticated(true);
            loadDashboardData(data);
          }
        } else {
          setAuthenticated(true);
          loadDashboardData(data);
        }
        setLoading(false);
      })
      .catch(() => { setError('Failed to load dashboard'); setLoading(false); });
  }, [workspaceId]);

  // Initialize per-module page filters from group defaults
  useEffect(() => {
    if (!ws || ga4Pages.length === 0) return;
    const groups = ws.eventGroups || [];
    const defaults: Record<string, string> = {};
    for (const g of groups) {
      if (g.defaultPageFilter) defaults[g.id] = g.defaultPageFilter;
    }
    if (Object.keys(defaults).length > 0) {
      setModulePageFilters(prev => ({ ...defaults, ...prev }));
      for (const [moduleId, pagePath] of Object.entries(defaults)) {
        if (!modulePageData[moduleId]) fetchEventsForModule(moduleId, pagePath);
      }
    }
  }, [ws?.eventGroups, ga4Pages.length]);

  const loadRequests = async (wsId: string) => {
    setRequestsLoading(true);
    try {
      const res = await fetch(`/api/public/requests/${wsId}`);
      const data = await res.json();
      if (Array.isArray(data)) setRequests(data);
    } catch { /* skip */ }
    finally { setRequestsLoading(false); }
  };

  const submitRequest = async () => {
    if (!newReqTitle.trim() || !newReqDesc.trim()) return;
    setSubmittingReq(true);
    try {
      const res = await fetch(`/api/public/requests/${workspaceId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newReqTitle.trim(), description: newReqDesc.trim(), category: newReqCategory, pageUrl: newReqPage.trim() || undefined, submittedBy: newReqName.trim() || undefined }),
      });
      if (res.ok) {
        const created = await res.json();
        // Upload attachments if any
        if (newReqFiles.length > 0) {
          const fd = new FormData();
          newReqFiles.forEach(f => fd.append('files', f));
          await fetch(`/api/public/requests/${workspaceId}/${created.id}/attachments`, { method: 'POST', body: fd });
        }
        setNewReqTitle(''); setNewReqDesc(''); setNewReqCategory('other'); setNewReqPage(''); setNewReqName(''); setNewReqFiles([]); setShowNewRequest(false);
        loadRequests(workspaceId);
      }
    } catch { /* skip */ }
    finally { setSubmittingReq(false); }
  };

  const sendReqNote = async (requestId: string) => {
    if (!reqNoteInput.trim() && noteFiles.length === 0) return;
    setSendingNote(true);
    try {
      if (noteFiles.length > 0) {
        const fd = new FormData();
        fd.append('content', reqNoteInput.trim());
        noteFiles.forEach(f => fd.append('files', f));
        await fetch(`/api/public/requests/${workspaceId}/${requestId}/notes-with-files`, { method: 'POST', body: fd });
      } else {
        await fetch(`/api/public/requests/${workspaceId}/${requestId}/notes`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: reqNoteInput.trim() }),
        });
      }
      setReqNoteInput(''); setNoteFiles([]);
      loadRequests(workspaceId);
    } catch { /* skip */ }
    finally { setSendingNote(false); }
  };

  const loadApprovals = async (wsId: string) => {
    setApprovalsLoading(true);
    try {
      const res = await fetch(`/api/public/approvals/${wsId}`);
      const data = await res.json();
      if (Array.isArray(data)) setApprovalBatches(data);
    } catch { /* skip */ }
    setApprovalsLoading(false);
  };

  const loadDashboardData = (data: WorkspaceInfo) => {
    if (data.gscPropertyUrl) loadSearchData(data.id, 28);
    fetch(`/api/public/audit-summary/${data.id}`).then(r => r.json()).then(a => { if (a?.id) setAudit(a); }).catch(() => {});
    fetch(`/api/public/audit-detail/${data.id}`).then(r => r.json()).then(d => { if (d?.id) setAuditDetail(d); }).catch(() => {});
    if (data.ga4PropertyId) loadGA4Data(data.id, 28);
    loadApprovals(data.id);
    loadRequests(data.id);
    fetch(`/api/public/activity/${data.id}?limit=20`).then(r => r.json()).then(a => { if (Array.isArray(a)) setActivityLog(a); }).catch(() => {});
    fetch(`/api/public/rank-tracking/${data.id}/history`).then(r => r.json()).then(h => { if (Array.isArray(h)) setRankHistory(h); }).catch(() => {});
    fetch(`/api/public/rank-tracking/${data.id}/latest`).then(r => r.json()).then(l => { if (Array.isArray(l)) setLatestRanks(l); }).catch(() => {});
    fetch(`/api/public/annotations/${data.id}`).then(r => r.json()).then(a => { if (Array.isArray(a)) setAnnotations(a); }).catch(() => {});
    // Load strategy if SEO view is enabled
    if (data.seoClientView) {
      fetch(`/api/public/seo-strategy/${data.id}`).then(r => r.ok ? r.json() : null).then(s => { if (s) setStrategyData(s); }).catch(() => {});
    }
    // Always load content requests (powers the Content tab independently)
    fetch(`/api/public/content-requests/${data.id}`).then(r => r.ok ? r.json() : []).then((reqs: ClientContentRequest[]) => {
      if (Array.isArray(reqs) && reqs.length > 0) {
        setContentRequests(reqs);
        setRequestedTopics(new Set(reqs.map(r => r.targetKeyword)));
      }
    }).catch(() => {});
  };

  const loadGA4Data = async (wsId: string, numDays: number, dateRange?: { startDate: string; endDate: string }) => {
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
    }
  };

  const eventDisplayName = (eventName: string): string => {
    const cfg = ws?.eventConfig?.find(c => c.eventName === eventName);
    return cfg?.displayName && cfg.displayName !== eventName ? cfg.displayName : eventName.replace(/_/g, ' ');
  };

  const isEventPinned = (eventName: string): boolean => {
    return ws?.eventConfig?.find(c => c.eventName === eventName)?.pinned || false;
  };

  const sortedConversions = [...ga4Conversions].sort((a, b) => {
    const ap = isEventPinned(a.eventName) ? 1 : 0;
    const bp = isEventPinned(b.eventName) ? 1 : 0;
    return bp - ap;
  });

  const fetchEventsForModule = async (moduleId: string, pagePath: string) => {
    if (!ws) return;
    if (!pagePath) {
      setModulePageData(prev => { const n = { ...prev }; delete n[moduleId]; return n; });
      return;
    }
    setModulePageLoading(prev => ({ ...prev, [moduleId]: true }));
    try {
      const params = new URLSearchParams({ days: String(days), page: pagePath });
      const res = await fetch(`/api/public/analytics-event-explorer/${ws.id}?${params}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const byEvent: Record<string, { conversions: number; users: number }> = {};
        for (const row of data) {
          if (!byEvent[row.eventName]) byEvent[row.eventName] = { conversions: 0, users: 0 };
          byEvent[row.eventName].conversions += row.eventCount;
          byEvent[row.eventName].users += row.users;
        }
        const totalUsers = Object.values(byEvent).reduce((s, v) => s + v.users, 0) || 1;
        setModulePageData(prev => ({
          ...prev,
          [moduleId]: Object.entries(byEvent).map(([eventName, v]) => ({
            eventName, conversions: v.conversions, users: v.users,
            rate: Math.round((v.conversions / totalUsers) * 100 * 10) / 10,
          })).sort((a, b) => b.conversions - a.conversions),
        }));
      }
    } catch {
      setModulePageData(prev => { const n = { ...prev }; delete n[moduleId]; return n; });
    } finally {
      setModulePageLoading(prev => ({ ...prev, [moduleId]: false }));
    }
  };

  const runExplorer = async (event?: string, page?: string) => {
    if (!ws) return;
    setExplorerLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (event) params.set('event', event);
      if (page) params.set('page', page);
      const res = await fetch(`/api/public/analytics-event-explorer/${ws.id}?${params}`);
      const data = await res.json();
      if (Array.isArray(data)) setExplorerData(data);
    } catch { setExplorerData([]); }
    finally { setExplorerLoading(false); }
  };

  const loadEventTrend = async (eventName: string) => {
    if (!ws) return;
    setGa4SelectedEvent(eventName);
    try {
      const res = await fetch(`/api/public/analytics-event-trend/${ws.id}?days=${days}&event=${encodeURIComponent(eventName)}`);
      const data = await res.json();
      if (Array.isArray(data)) setGa4EventTrend(data);
    } catch { setGa4EventTrend([]); }
  };

  const declineTopic = async (reqId: string) => {
    try {
      const res = await fetch(`/api/public/content-request/${workspaceId}/${reqId}/decline`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: declineReason.trim() || undefined }),
      });
      if (res.ok) {
        const updated = await res.json();
        setContentRequests(prev => prev.map(r => r.id === reqId ? updated : r));
        setDeclineReqId(null); setDeclineReason('');
      }
    } catch { /* skip */ }
  };

  const approveBrief = async (reqId: string) => {
    try {
      const res = await fetch(`/api/public/content-request/${workspaceId}/${reqId}/approve`, { method: 'POST' });
      if (res.ok) {
        const updated = await res.json();
        setContentRequests(prev => prev.map(r => r.id === reqId ? updated : r));
        setToast({ message: 'Brief approved! Your team will begin content production.', type: 'success' });
        setTimeout(() => setToast(null), 5000);
      }
    } catch { /* skip */ }
  };

  const upgradeToFullPost = async (reqId: string) => {
    setUpgradingReqId(reqId);
    try {
      const res = await fetch(`/api/public/content-request/${workspaceId}/${reqId}/upgrade`, { method: 'POST' });
      if (res.ok) {
        const updated = await res.json();
        setContentRequests(prev => prev.map(r => r.id === reqId ? updated : r));
        setToast({ message: 'Upgraded to full blog post! Your team will begin writing.', type: 'success' });
        setTimeout(() => setToast(null), 5000);
      }
    } catch { /* skip */ }
    setUpgradingReqId(null);
  };

  // Confirm pricing and execute the actual request
  const confirmPricingAndSubmit = async () => {
    if (!pricingModal) return;
    setPricingConfirming(true);
    try {
      if (pricingModal.source === 'upgrade' && pricingModal.upgradeReqId) {
        // Upgrade flow
        await upgradeToFullPost(pricingModal.upgradeReqId);
      } else if (pricingModal.source === 'strategy') {
        // Strategy-based request
        setRequestingTopic(pricingModal.targetKeyword);
        const res = await fetch(`/api/public/content-request/${workspaceId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, intent: pricingModal.intent, priority: pricingModal.priority, rationale: pricingModal.rationale, serviceType: pricingModal.serviceType }),
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        setRequestedTopics(prev => new Set(prev).add(pricingModal.targetKeyword));
        fetch(`/api/public/content-requests/${workspaceId}`).then(r => r.ok ? r.json() : []).then((reqs: ClientContentRequest[]) => {
          if (Array.isArray(reqs) && reqs.length > 0) setContentRequests(reqs);
        }).catch(() => {});
        const label = pricingModal.serviceType === 'full_post' ? 'Full blog post' : 'Brief';
        setToast({ message: `${label} requested for "${pricingModal.topic}"! Check the Content tab.`, type: 'success' });
        setTimeout(() => setToast(null), 5000);
        setRequestingTopic(null);
      } else {
        // Client topic submission
        const res = await fetch(`/api/public/content-request/${workspaceId}/submit`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, notes: pricingModal.notes || undefined, serviceType: pricingModal.serviceType }),
        });
        if (res.ok) {
          const created = await res.json();
          setContentRequests(prev => [created, ...prev]);
          setRequestedTopics(prev => new Set(prev).add(created.targetKeyword));
          setNewTopicName(''); setNewTopicKeyword(''); setNewTopicNotes(''); setNewTopicServiceType('brief_only'); setShowTopicForm(false);
          setToast({ message: 'Topic submitted! Your team will review it.', type: 'success' });
          setTimeout(() => setToast(null), 5000);
        }
      }
    } catch (err) {
      console.error('Content request failed:', err);
      setToast({ message: 'Failed to submit request. Please try again.', type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
    setPricingConfirming(false);
    setPricingModal(null);
  };

  const requestChanges = async (reqId: string) => {
    try {
      const res = await fetch(`/api/public/content-request/${workspaceId}/${reqId}/request-changes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedbackText.trim() }),
      });
      if (res.ok) {
        const updated = await res.json();
        setContentRequests(prev => prev.map(r => r.id === reqId ? updated : r));
        setFeedbackReqId(null); setFeedbackText('');
      }
    } catch { /* skip */ }
  };

  const addContentComment = async (reqId: string) => {
    if (!contentComment.trim()) return;
    setSendingContentComment(true);
    try {
      const res = await fetch(`/api/public/content-request/${workspaceId}/${reqId}/comment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contentComment.trim(), author: 'client' }),
      });
      if (res.ok) {
        const updated = await res.json();
        setContentRequests(prev => prev.map(r => r.id === reqId ? updated : r));
        setContentComment('');
      }
    } catch { /* skip */ }
    setSendingContentComment(false);
  };

  const loadBriefPreview = async (briefId: string) => {
    if (briefPreviews[briefId]) return;
    try {
      const res = await fetch(`/api/public/content-brief/${workspaceId}/${briefId}`);
      if (res.ok) {
        const brief = await res.json();
        setBriefPreviews(prev => ({ ...prev, [briefId]: brief }));
      }
    } catch { /* skip */ }
  };

  const handlePasswordSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!passwordInput.trim()) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch(`/api/public/auth/${workspaceId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      if (res.ok) {
        setAuthenticated(true);
        sessionStorage.setItem(`dash_auth_${workspaceId}`, 'true');
        if (ws) loadDashboardData(ws);
      } else {
        setAuthError('Incorrect password');
      }
    } catch {
      setAuthError('Authentication failed');
    } finally { setAuthLoading(false); }
  };

  const loadSearchData = async (wsId: string, numDays: number, dateRange?: { startDate: string; endDate: string }) => {
    try {
      const drParams = dateRange ? `&startDate=${dateRange.startDate}&endDate=${dateRange.endDate}` : '';
      const [ovRes, trRes, cmpRes, devRes] = await Promise.all([
        fetch(`/api/public/search-overview/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/performance-trend/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/search-comparison/${wsId}?days=${numDays}${drParams}`),
        fetch(`/api/public/search-devices/${wsId}?days=${numDays}${drParams}`),
      ]);
      const [ovData, trData, cmpData, devData] = await Promise.all([ovRes.json(), trRes.json(), cmpRes.json(), devRes.json()]);
      if (ovData.error) throw new Error(ovData.error);
      setOverview(ovData);
      setTrend(Array.isArray(trData) ? trData : []);
      if (cmpData && !cmpData.error) setSearchComparison(cmpData);
      if (Array.isArray(devData)) setSearchDevices(devData);
    } catch (err) {
      console.error('Search data load error:', err);
    }
  };

  const changeDays = (d: number) => {
    setDays(d);
    setCustomDateRange(null);
    setShowDatePicker(false);
    if (ws) {
      loadSearchData(ws.id, d);
      if (ws.ga4PropertyId) loadGA4Data(ws.id, d);
    }
  };

  const applyCustomRange = (startDate: string, endDate: string) => {
    const dr = { startDate, endDate };
    const spanDays = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
    setCustomDateRange(dr);
    setDays(spanDays);
    setShowDatePicker(false);
    if (ws) {
      loadSearchData(ws.id, spanDays, dr);
      if (ws.ga4PropertyId) loadGA4Data(ws.id, spanDays, dr);
    }
  };

  const buildChatContext = () => {
    const context: Record<string, unknown> = { days };
    if (overview) {
      context.search = {
        dateRange: overview.dateRange, totalClicks: overview.totalClicks,
        totalImpressions: overview.totalImpressions, avgCtr: overview.avgCtr,
        avgPosition: overview.avgPosition, topQueries: overview.topQueries.slice(0, 15), topPages: overview.topPages.slice(0, 10),
      };
    }
    if (trend.length > 1) {
      context.searchTrend = { firstDay: trend[0], lastDay: trend[trend.length - 1], totalDays: trend.length };
    }
    if (ga4Overview) {
      context.ga4 = {
        overview: ga4Overview,
        topPages: ga4Pages.slice(0, 10),
        sources: ga4Sources.slice(0, 8),
        devices: ga4Devices,
        events: ga4Events.slice(0, 15),
        conversions: ga4Conversions.slice(0, 10),
        countries: ga4Countries.slice(0, 8),
      };
    }
    if (searchComparison) context.searchComparison = searchComparison;
    if (ga4Comparison) context.ga4Comparison = ga4Comparison;
    if (ga4Organic) context.ga4Organic = ga4Organic;
    if (ga4NewVsReturning && ga4NewVsReturning.length > 0) context.ga4NewVsReturning = ga4NewVsReturning;
    if (audit) {
      context.siteHealth = {
        score: audit.siteScore, totalPages: audit.totalPages,
        errors: audit.errors, warnings: audit.warnings,
        previousScore: audit.previousScore,
      };
    }
    if (auditDetail) {
      context.siteHealthDetail = {
        siteWideIssues: auditDetail.audit.siteWideIssues.slice(0, 10),
        scoreHistory: auditDetail.scoreHistory?.slice(0, 5),
        topIssuePages: auditDetail.audit.pages
          .filter(p => p.issues.length > 0)
          .sort((a, b) => b.issues.length - a.issues.length)
          .slice(0, 5)
          .map(p => ({ page: p.page, score: p.score, issueCount: p.issues.length, topIssues: p.issues.slice(0, 3).map(i => ({ check: i.check, severity: i.severity, message: i.message })) })),
      };
    }
    if (strategyData) {
      context.seoStrategy = {
        pageMap: strategyData.pageMap?.slice(0, 10),
        opportunities: strategyData.opportunities?.slice(0, 5),
        contentGaps: strategyData.contentGaps?.slice(0, 5),
        quickWins: strategyData.quickWins?.slice(0, 5),
      };
    }
    if (latestRanks.length > 0) context.rankings = latestRanks.slice(0, 15);
    if (activityLog.length > 0) context.recentActivity = activityLog.slice(0, 10);
    if (annotations.length > 0) context.annotations = annotations.slice(0, 10);
    if (approvalBatches.length > 0) {
      const pending = approvalBatches.filter(b => b.status === 'pending');
      if (pending.length > 0) context.pendingApprovals = pending.length;
    }
    if (requests.length > 0) {
      const active = requests.filter(r => r.status !== 'closed');
      if (active.length > 0) context.activeRequests = active.slice(0, 5).map(r => ({ title: r.title, category: r.category, status: r.status }));
    }
    return context;
  };

  const askAi = async (question: string) => {
    if (!question.trim() || !ws) return;
    if (!overview && !ga4Overview) return;
    setChatMessages(prev => [...prev, { role: 'user', content: question.trim() }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const context = buildChatContext();
      const res = await fetch(`/api/public/search-chat/${ws.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), context, sessionId: chatSessionId }),
      });
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.error ? `Error: ${data.error}` : data.answer }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }]);
    } finally { setChatLoading(false); }
  };

  const fetchProactiveInsight = async () => {
    if (!ws || (!overview && !ga4Overview)) return;
    setChatLoading(true);
    try {
      const context = buildChatContext();
      const proactivePrompt = 'You are proactively greeting me as I open the Insights Engine. In 2-3 concise bullet points, tell me the most important things happening with my site data right now. Be specific with numbers. Highlight anything that needs attention first, then wins, then opportunities. Keep it brief and actionable. Do not ask me questions.';
      const res = await fetch(`/api/public/search-chat/${ws.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: proactivePrompt, context, sessionId: chatSessionId }),
      });
      const data = await res.json();
      if (!data.error) {
        setChatMessages([{ role: 'assistant', content: data.answer }]);
      }
    } catch { /* silent fail — user can still ask manually */ }
    finally { setChatLoading(false); }
  };

  // Auto-fire proactive insight when chat opens for first time
  useEffect(() => {
    if (chatOpen && chatMessages.length === 0 && !proactiveInsightSent.current && (overview || ga4Overview) && ws) {
      proactiveInsightSent.current = true;
      fetchProactiveInsight();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen]);

  const handleSort = (key: SortKey) => { if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(false); } };
  const sortedQueries = () => {
    if (!overview) return [];
    return [...overview.topQueries].sort((a, b) => sortAsc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]);
  };
  const sortedPages = () => {
    if (!overview) return [];
    return [...overview.topPages].sort((a, b) => sortAsc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]);
  };

  const getInsights = () => {
    if (!overview) return null;
    const q = overview.topQueries;
    return {
      lowHanging: q.filter(x => x.position > 5 && x.position <= 20 && x.impressions > 30),
      topPerformers: q.filter(x => x.position <= 3 && x.clicks > 5),
      ctrOpps: q.filter(x => x.position <= 10 && x.ctr < 3 && x.impressions > 50),
      highImpLowClick: q.filter(x => x.impressions > 100 && x.clicks < 5),
      page1: q.filter(x => x.position <= 10).length,
      top3: q.filter(x => x.position <= 3).length,
    };
  };

  if (loading) return (
    <div className="min-h-screen bg-[#0f1219] text-zinc-200">
      <header className="border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <div className="h-6 w-24 bg-zinc-800 rounded animate-pulse" />
          <div className="w-px h-8 bg-zinc-800" />
          <div><div className="h-5 w-40 bg-zinc-800 rounded animate-pulse" /><div className="h-3 w-28 bg-zinc-800/50 rounded animate-pulse mt-1.5" /></div>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-3 flex gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-4 w-20 bg-zinc-800/50 rounded animate-pulse" />)}
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[1,2,3,4,5].map(i => <div key={i} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800"><div className="h-4 w-4 bg-zinc-800 rounded mb-2 animate-pulse" /><div className="h-7 w-16 bg-zinc-800 rounded animate-pulse" /><div className="h-3 w-20 bg-zinc-800/50 rounded animate-pulse mt-2" /></div>)}
        </div>
      </main>
    </div>
  );
  if (error || !ws) return (
    <div className="min-h-screen bg-[#0f1219] flex items-center justify-center">
      <div className="text-center">
        <p className="text-red-400 text-sm mb-3">{error || 'Dashboard not found'}</p>
        <button onClick={() => window.location.reload()} className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-600 transition-colors">Try Again</button>
      </div>
    </div>
  );

  // Password gate
  if (ws.requiresPassword && !authenticated) return (
    <div className="min-h-screen bg-[#0f1219] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-8 shadow-2xl shadow-black/40">
          <div className="flex flex-col items-center mb-6">
            <img src="/logo.svg" alt="hmpsn studio" className="h-7 opacity-60 mb-4" />
            <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-teal-400" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-200">{ws.name}</h2>
            <p className="text-xs text-zinc-500 mt-1">Enter the password to access this dashboard</p>
          </div>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                value={passwordInput}
                onChange={e => { setPasswordInput(e.target.value); setAuthError(''); }}
                placeholder="Dashboard password"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                autoFocus
              />
              {authError && <p className="text-xs text-red-400 mt-2">{authError}</p>}
            </div>
            <button
              type="submit"
              disabled={authLoading || !passwordInput.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
            >
              {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Access Dashboard'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  const insights = getInsights();

  const updateApprovalItem = async (batchId: string, itemId: string, update: { status?: string; clientValue?: string; clientNote?: string }) => {
    try {
      const res = await fetch(`/api/public/approvals/${workspaceId}/${batchId}/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      const updated = await res.json();
      if (updated.id) {
        setApprovalBatches(prev => prev.map(b => b.id === batchId ? updated : b));
      }
    } catch { /* skip */ }
    setEditingApproval(null);
    setEditDraft('');
  };

  const applyApprovedBatch = async (batchId: string) => {
    setApplyingBatch(batchId);
    try {
      const res = await fetch(`/api/public/approvals/${workspaceId}/${batchId}/apply`, { method: 'POST' });
      const data = await res.json();
      if (data.applied > 0) {
        loadApprovals(workspaceId);
      }
    } catch { /* skip */ }
    setApplyingBatch(null);
  };

  const pendingApprovals = approvalBatches.reduce((sum, b) => sum + b.items.filter(i => i.status === 'pending').length, 0);
  const unreadTeamNotes = requests.filter(r => r.notes.length > 0 && r.notes[r.notes.length - 1].author === 'team' && r.status !== 'completed' && r.status !== 'closed').length;

  const strategyLocked = !ws?.seoClientView;
  const NAV = [
    { id: 'overview' as ClientTab, label: 'Insights', icon: Sparkles, locked: false },
    { id: 'strategy' as ClientTab, label: 'SEO Strategy', icon: Target, locked: strategyLocked },
    { id: 'health' as ClientTab, label: 'Site Health', icon: Shield, locked: false },
    ...(ws?.analyticsClientView !== false ? [
      { id: 'analytics' as ClientTab, label: 'Analytics', icon: LineChart, locked: false },
      { id: 'search' as ClientTab, label: 'Search', icon: Search, locked: false },
    ] : []),
    ...(contentRequests.length > 0 || strategyData ? [{ id: 'content' as ClientTab, label: 'Content', icon: FileText, locked: false }] : []),
    { id: 'requests' as ClientTab, label: 'Requests', icon: MessageSquare, locked: false },
    ...(approvalBatches.length > 0 ? [{ id: 'approvals' as ClientTab, label: 'Approvals', icon: ClipboardCheck, locked: false }] : []),
  ];

  return (
    <div className={`min-h-screen bg-[#0f1219] text-zinc-200 ${theme === 'light' ? 'dashboard-light' : ''}`}>
      {/* Header */}
      <header className="border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/logo.svg" alt="hmpsn studio" className="h-8 opacity-80" style={theme === 'light' ? { filter: 'invert(1) brightness(0.3)' } : undefined} />
            <div className="w-px h-8 bg-zinc-800" />
            <div>
              <h1 className="text-lg font-semibold">{ws.name}</h1>
              <p className="text-xs text-zinc-500 mt-0.5">Insights Engine{(overview || audit || ga4Overview) && <span className="ml-2 text-zinc-500">· Updated {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
              {theme === 'dark' ? <Sun className="w-4 h-4 text-zinc-400" /> : <Moon className="w-4 h-4 text-zinc-400" />}
            </button>
            {(overview || ga4Overview) && (
              <div className="relative flex items-center gap-1 bg-zinc-900 rounded-lg border border-zinc-800 p-0.5">
                {[7, 28, 90, 180, 365].map(d => (
                  <button key={d} onClick={() => changeDays(d)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${!customDateRange && days === d ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >{d >= 365 ? '1y' : d >= 180 ? '6mo' : `${d}d`}</button>
                ))}
                <button onClick={() => setShowDatePicker(p => !p)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${customDateRange ? 'bg-teal-600/20 text-teal-300 border border-teal-500/30' : 'text-zinc-500 hover:text-zinc-300'}`}
                  title="Custom date range"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  {customDateRange ? (
                    <span className="text-[10px]">
                      {new Date(customDateRange.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {' – '}
                      {new Date(customDateRange.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  ) : (
                    <span className="hidden sm:inline">Custom</span>
                  )}
                </button>
                {showDatePicker && (<>
                  <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
                  <div className="absolute right-0 top-full mt-2 z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4 w-72"
                    onClick={e => e.stopPropagation()}>
                    <p className="text-xs font-medium text-zinc-400 mb-3">Custom date range</p>
                    <div className="space-y-2">
                      <label className="block">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Start date</span>
                        <input type="date" id="custom-start"
                          defaultValue={customDateRange?.startDate || new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0]}
                          max={new Date().toISOString().split('T')[0]}
                          className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">End date</span>
                        <input type="date" id="custom-end"
                          defaultValue={customDateRange?.endDate || new Date().toISOString().split('T')[0]}
                          max={new Date().toISOString().split('T')[0]}
                          className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
                        />
                      </label>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button onClick={() => setShowDatePicker(false)}
                        className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
                        Cancel
                      </button>
                      <button onClick={() => {
                        const s = (document.getElementById('custom-start') as HTMLInputElement)?.value;
                        const e = (document.getElementById('custom-end') as HTMLInputElement)?.value;
                        if (s && e && s <= e) applyCustomRange(s, e);
                      }}
                        className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-medium transition-colors">
                        Apply
                      </button>
                    </div>
                  </div>
                </>)}
              </div>
            )}
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6">
          <nav className="flex items-center gap-1 -mb-px overflow-x-auto scrollbar-none">
            {NAV.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              const hasData = (t.id === 'overview') ||
                (t.id === 'search' && !!overview) ||
                (t.id === 'health' && !!audit) ||
                (t.id === 'analytics' && !!ga4Overview) ||
                (t.id === 'content' && (contentRequests.length > 0 || !!strategyData)) ||
                (t.id === 'approvals' && approvalBatches.length > 0);
              const pendingReviews = contentRequests.filter(r => r.status === 'client_review').length;
              return (
                <button key={t.id} onClick={() => t.locked ? setShowUpgradeModal(true) : setTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                    t.locked ? 'border-transparent text-zinc-500 cursor-default' :
                    active ? 'border-teal-500 text-teal-300' :
                    'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                  }`}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                  {t.locked && <Lock className="w-3 h-3 ml-0.5 text-zinc-500" />}
                  {t.id === 'approvals' && pendingApprovals > 0 && <span className="ml-1 px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-teal-500 text-white">{pendingApprovals}</span>}
                  {t.id === 'requests' && unreadTeamNotes > 0 && <span className="ml-1 px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-teal-500 text-white">{unreadTeamNotes}</span>}
                  {t.id === 'content' && pendingReviews > 0 && <span className="ml-1 px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-blue-500 text-white">{pendingReviews}</span>}
                  {!t.locked && hasData && !active && t.id !== 'approvals' && t.id !== 'requests' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-5">

        {/* ════════════ OVERVIEW TAB ════════════ */}
        {tab === 'overview' && (<>
          {/* Welcome header */}
          <div className="mb-1">
            <h2 className="text-base font-semibold text-zinc-100">Welcome back</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Here are your latest insights</p>
          </div>

          {/* Action-needed banner */}
          {(() => {
            const actions: { label: string; count: number; tab: ClientTab; color: string }[] = [];
            if (pendingApprovals > 0) actions.push({ label: `${pendingApprovals} SEO change${pendingApprovals > 1 ? 's' : ''} to review`, count: pendingApprovals, tab: 'approvals', color: 'text-amber-400' });
            const contentReviews = contentRequests.filter(r => r.status === 'client_review').length;
            if (contentReviews > 0) actions.push({ label: `${contentReviews} content brief${contentReviews > 1 ? 's' : ''} ready for review`, count: contentReviews, tab: 'content', color: 'text-blue-400' });
            if (unreadTeamNotes > 0) actions.push({ label: `${unreadTeamNotes} request${unreadTeamNotes > 1 ? 's' : ''} with new team replies`, count: unreadTeamNotes, tab: 'requests', color: 'text-teal-400' });
            if (actions.length === 0) return null;
            const total = actions.reduce((s, a) => s + a.count, 0);
            return (
              <div className="bg-gradient-to-r from-amber-600/10 via-zinc-900 to-teal-600/10 border border-amber-500/20 rounded-xl px-5 py-3.5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-md bg-amber-500/15 flex items-center justify-center"><AlertTriangle className="w-3 h-3 text-amber-400" /></div>
                  <span className="text-xs font-medium text-zinc-200">{total} item{total > 1 ? 's' : ''} need{total === 1 ? 's' : ''} your attention</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {actions.map((a, i) => (
                    <button key={i} onClick={() => setTab(a.tab)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/50 transition-colors text-left">
                      <span className={`text-[11px] font-semibold ${a.color}`}>{a.count}</span>
                      <span className="text-[11px] text-zinc-400">{a.label.replace(/^\d+\s*/, '')}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Key metrics — full-span StatCards */}
          {(() => {
            const cards: { label: string; value: string; icon?: typeof Users; color: string; sub?: string; sparkline?: number[]; delta?: number }[] = [];
            if (ga4Overview) {
              cards.push({ label: 'Visitors', value: ga4Overview.totalUsers.toLocaleString(), icon: Users, color: '#2dd4bf', sub: ga4Overview.dateRange ? `${ga4Overview.dateRange.start} — ${ga4Overview.dateRange.end}` : undefined, sparkline: ga4Trend.map(d => d.users), delta: ga4Comparison?.changePercent.users });
            }
            if (overview) {
              cards.push({ label: 'Search Clicks', value: overview.totalClicks.toLocaleString(), icon: MousePointerClick, color: '#60a5fa', sub: overview.totalImpressions > 0 ? `${((overview.totalClicks / overview.totalImpressions) * 100).toFixed(1)}% CTR` : undefined, sparkline: trend.map(t => t.clicks), delta: searchComparison?.changePercent.clicks });
              cards.push({ label: 'Impressions', value: overview.totalImpressions.toLocaleString(), icon: Eye, color: '#a78bfa', sub: 'Google searches', sparkline: trend.map(t => t.impressions), delta: searchComparison?.changePercent.impressions });
            } else if (ga4Overview) {
              cards.push({ label: 'Sessions', value: ga4Overview.totalSessions.toLocaleString(), icon: BarChart3, color: '#60a5fa', sub: 'last period', sparkline: ga4Trend.map(d => d.sessions), delta: ga4Comparison?.changePercent.sessions });
            }
            if (audit) {
              cards.push({ label: 'Site Health', value: `${audit.siteScore}/100`, icon: Shield, color: audit.siteScore >= 80 ? '#34d399' : audit.siteScore >= 60 ? '#fbbf24' : '#f87171', sub: `${audit.totalPages} pages`, delta: audit.previousScore != null ? audit.siteScore - audit.previousScore : undefined });
            }
            if (strategyData) {
              const ranked = strategyData.pageMap.filter(p => p.currentPosition);
              if (ranked.length > 0) {
                const avgP = ranked.reduce((s, p) => s + (p.currentPosition || 0), 0) / ranked.length;
                cards.push({ label: 'Avg Position', value: `#${avgP.toFixed(1)}`, icon: Target, color: avgP <= 10 ? '#34d399' : avgP <= 20 ? '#fbbf24' : '#60a5fa', sub: `${ranked.length} pages ranking` });
              }
            }
            if (cards.length === 0) return null;
            return (
              <div className={`grid gap-3 ${cards.length <= 3 ? 'grid-cols-' + cards.length : cards.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'}`}>
                {cards.map((card, i) => (
                  <StatCard
                    key={i}
                    label={card.label}
                    value={card.value}
                    icon={card.icon}
                    iconColor={card.color}
                    valueColor={card.color}
                    sub={card.sub}
                    sparklineData={card.sparkline && card.sparkline.length > 2 ? card.sparkline : undefined}
                    sparklineColor={card.color}
                    delta={card.delta}
                    deltaLabel="%"
                  />
                ))}
              </div>
            );
          })()}

          {/* Main content: insights + sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            {/* Left column (3/5) — Insights feed */}
            <div className="lg:col-span-3 space-y-5">
              {/* AI-generated insights digest */}
              <InsightsDigest
                overview={overview}
                searchComparison={searchComparison}
                ga4Overview={ga4Overview}
                ga4Comparison={ga4Comparison}
                ga4Organic={ga4Organic}
                ga4Conversions={ga4Conversions}
                ga4NewVsReturning={ga4NewVsReturning}
                audit={audit}
                auditDetail={auditDetail}
                strategyData={strategyData}
                searchInsights={insights ? { lowHanging: insights.lowHanging, topPerformers: insights.topPerformers } : null}
                eventDisplayName={eventDisplayName}
                isEventPinned={isEventPinned}
                onNavigate={setTab}
              />

              {/* Empty state */}
              {!overview && !audit && !ga4Overview && (
                <div className="bg-gradient-to-br from-teal-500/10 via-zinc-900 to-emerald-500/10 rounded-xl border border-zinc-800 p-8 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center mx-auto mb-4"><BarChart3 className="w-6 h-6 text-teal-400" /></div>
                  <h2 className="text-lg font-semibold text-zinc-200 mb-2">{ws.name}</h2>
                  <p className="text-sm text-zinc-400">We're getting everything set up for you. Your performance data and insights will start appearing here shortly.</p>
                </div>
              )}
            </div>

            {/* Right sidebar (2/5) */}
            <div className="lg:col-span-2 space-y-4">
              {/* Ask the Insights Engine */}
              <div className="bg-gradient-to-br from-teal-500/5 via-zinc-900 to-zinc-900 rounded-xl border border-teal-500/15 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-lg bg-teal-500/15 flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                  </div>
                  <span className="text-xs font-medium text-zinc-300">Ask the Insights Engine</span>
                </div>
                <p className="text-[11px] text-zinc-500 mb-3">Get instant answers about your site's performance, SEO opportunities, and next steps.</p>
                <div className="space-y-1.5">
                  {QUICK_QUESTIONS.slice(0, 4).map((q, i) => (
                    <button
                      key={i}
                      onClick={() => { setChatOpen(true); setTimeout(() => askAi(q), 100); }}
                      className="w-full text-left px-3 py-2 rounded-lg bg-zinc-800/40 hover:bg-zinc-800/70 border border-zinc-700/30 hover:border-teal-500/20 transition-colors text-[11px] text-zinc-400 hover:text-zinc-300"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Site health compact */}
              {audit && (
                <button onClick={() => setTab('health')} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 text-left hover:border-zinc-700 transition-colors w-full">
                  <div className="flex items-center gap-2 mb-2"><Shield className="w-4 h-4" style={{ color: audit.siteScore >= 80 ? '#34d399' : audit.siteScore >= 60 ? '#fbbf24' : '#f87171' }} /><span className="text-xs font-medium text-zinc-300">Site Health</span></div>
                  <div className="flex items-center gap-3">
                    <div className={`text-2xl font-bold ${audit.siteScore >= 80 ? 'text-green-400' : audit.siteScore >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{audit.siteScore}/100</div>
                    <div className="flex-1">
                      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${audit.siteScore}%`, backgroundColor: audit.siteScore >= 80 ? '#34d399' : audit.siteScore >= 60 ? '#fbbf24' : '#f87171' }} />
                      </div>
                    </div>
                  </div>
                  {auditDetail && auditDetail.audit.errors > 0 && (
                    <div className="mt-2 text-[11px] text-red-400">{auditDetail.audit.errors} issue{auditDetail.audit.errors !== 1 ? 's' : ''} to fix</div>
                  )}
                  {audit.siteScore >= 80 && <div className="mt-2 text-[11px] text-emerald-400">Looking good — your site is healthy</div>}
                </button>
              )}

              {/* Activity timeline */}
              {activityLog.length > 0 && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-4 h-4 text-teal-400" />
                    <span className="text-xs font-medium text-zinc-300">Recent Work</span>
                  </div>
                  <div className="relative">
                    <div className="absolute left-[5px] top-1 bottom-1 w-px bg-zinc-800" />
                    <div className="space-y-2.5">
                      {activityLog.slice(0, 5).map(entry => {
                        const icons: Record<string, { color: string; label: string }> = {
                          audit_completed: { color: '#60a5fa', label: 'Audit' },
                          request_resolved: { color: '#34d399', label: 'Done' },
                          approval_applied: { color: '#a78bfa', label: 'Applied' },
                          seo_updated: { color: '#fbbf24', label: 'SEO' },
                          images_optimized: { color: '#f472b6', label: 'Media' },
                          links_fixed: { color: '#fb923c', label: 'Links' },
                          content_updated: { color: '#2dd4bf', label: 'Content' },
                          note: { color: '#94a3b8', label: 'Note' },
                        };
                        const cfg = icons[entry.type] || icons.note;
                        return (
                          <div key={entry.id} className="flex items-start gap-2.5 pl-0">
                            <div className="w-[11px] h-[11px] rounded-full border-2 flex-shrink-0 mt-1 z-10" style={{ borderColor: cfg.color, backgroundColor: '#0f1219' }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-medium px-1 py-0.5 rounded" style={{ backgroundColor: `${cfg.color}15`, color: cfg.color }}>{cfg.label}</span>
                                <span className="text-[11px] text-zinc-500">{new Date(entry.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              </div>
                              <div className="text-[11px] text-zinc-400 mt-0.5 line-clamp-1">{entry.title}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>)}

        {/* ════════════ SEARCH TAB ════════════ */}
        {tab === 'search' && (<>
          {overview ? (<>
            {/* Compact metrics bar */}
            <CompactStatBar items={[
              { label: 'Clicks', value: overview.totalClicks.toLocaleString(), valueColor: 'text-blue-400', sub: searchComparison ? `${searchComparison.changePercent.clicks > 0 ? '+' : ''}${searchComparison.changePercent.clicks}%` : undefined, subColor: searchComparison ? (searchComparison.changePercent.clicks >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined },
              { label: 'Impressions', value: overview.totalImpressions.toLocaleString(), valueColor: 'text-teal-400', sub: searchComparison ? `${searchComparison.changePercent.impressions > 0 ? '+' : ''}${searchComparison.changePercent.impressions}%` : undefined, subColor: searchComparison ? (searchComparison.changePercent.impressions >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined },
              { label: 'CTR', value: `${overview.avgCtr}%`, valueColor: 'text-emerald-400', sub: searchComparison ? `${searchComparison.change.ctr > 0 ? '+' : ''}${searchComparison.change.ctr}pp` : undefined, subColor: searchComparison ? (searchComparison.change.ctr >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined },
              { label: 'Avg Position', value: String(overview.avgPosition), valueColor: 'text-amber-400', sub: searchComparison ? `${searchComparison.change.position < 0 ? '↑' : searchComparison.change.position > 0 ? '↓' : ''}${Math.abs(searchComparison.change.position)}` : undefined, subColor: searchComparison ? (searchComparison.change.position <= 0 ? 'text-emerald-400' : 'text-red-400') : undefined },
            ]} />

            {trend.length > 2 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-zinc-400">Performance Trend</span>
                  <span className="text-[11px] text-zinc-500">{overview.dateRange.start} — {overview.dateRange.end}</span>
                </div>
                <DualTrendChart data={trend} annotations={annotations} />
              </div>
            )}

            {insights && (
              <div className="space-y-3">
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="text-xs font-medium text-zinc-300 mb-3">Search Health Summary</div>
                  <div className="grid grid-cols-4 gap-3">
                    <div className="text-center"><div className={`text-lg font-bold ${insights.page1 > 5 ? 'text-green-400' : 'text-amber-400'}`}>{insights.page1}</div><div className="text-[11px] text-zinc-500">Page 1 Rankings</div></div>
                    <div className="text-center"><div className={`text-lg font-bold ${insights.top3 > 2 ? 'text-green-400' : 'text-amber-400'}`}>{insights.top3}</div><div className="text-[11px] text-zinc-500">Top 3 Rankings</div></div>
                    <div className="text-center"><div className={`text-lg font-bold ${overview.avgCtr > 3 ? 'text-green-400' : overview.avgCtr > 1.5 ? 'text-amber-400' : 'text-red-400'}`}>{overview.avgCtr}%</div><div className="text-[11px] text-zinc-500">Avg CTR</div></div>
                    <div className="text-center"><div className={`text-lg font-bold ${insights.lowHanging.length > 0 ? 'text-amber-400' : 'text-green-400'}`}>{insights.lowHanging.length}</div><div className="text-[11px] text-zinc-500">Opportunities</div></div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {insights.lowHanging.length > 0 && <InsightCard icon={Target} color="amber" title="Low-Hanging Fruit" count={insights.lowHanging.length} desc="Ranking 5-20 with impressions — push to page 1" items={insights.lowHanging.slice(0, 8).map(q => ({ label: q.query, value: `#${q.position}`, sub: `${q.impressions} imp` }))} />}
                  {insights.topPerformers.length > 0 && <InsightCard icon={Shield} color="green" title="Top Performers" count={insights.topPerformers.length} desc="Top 3 with real clicks — protect these" items={insights.topPerformers.slice(0, 8).map(q => ({ label: q.query, value: `#${q.position}`, sub: `${q.clicks} clicks` }))} />}
                  {insights.ctrOpps.length > 0 && <InsightCard icon={TrendingDown} color="red" title="CTR Opportunities" count={insights.ctrOpps.length} desc="Page 1 but CTR under 3%" items={insights.ctrOpps.slice(0, 8).map(q => ({ label: q.query, value: `${q.ctr}% CTR`, sub: `#${q.position}` }))} />}
                  {insights.highImpLowClick.length > 0 && <InsightCard icon={AlertTriangle} color="orange" title="Visibility Without Clicks" count={insights.highImpLowClick.length} desc="100+ impressions, under 5 clicks" items={insights.highImpLowClick.slice(0, 8).map(q => ({ label: q.query, value: `${q.clicks} clicks`, sub: `${q.impressions} imp` }))} />}
                </div>
              </div>
            )}

            {/* Rank Tracking */}
            {(rankHistory.length > 1 || latestRanks.length > 0) && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-teal-400" />
                  <span className="text-xs font-semibold text-zinc-200">Keyword Rank Tracking</span>
                  <span className="text-[11px] text-zinc-500 ml-auto">{rankHistory.length} snapshots</span>
                </div>
                {/* Rank history chart */}
                {rankHistory.length > 1 && (() => {
                  const allKws = Object.keys(rankHistory[rankHistory.length - 1]?.positions || {}).slice(0, 5);
                  if (allKws.length === 0) return null;
                  const colors = ['#2dd4bf', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa'];
                  const maxPos = Math.max(...rankHistory.flatMap(s => allKws.map(k => s.positions[k] || 0)), 20);
                  const W = 400, H = 120, PAD = 8;
                  return (
                    <div className="mb-3">
                      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" preserveAspectRatio="none">
                        {allKws.map((kw, ki) => {
                          const pts = rankHistory.map((s, i) => {
                            const x = PAD + (i / Math.max(rankHistory.length - 1, 1)) * (W - PAD * 2);
                            const pos = s.positions[kw];
                            if (pos === undefined) return null;
                            const y = PAD + ((pos - 1) / Math.max(maxPos - 1, 1)) * (H - PAD * 2);
                            return `${x},${y}`;
                          }).filter(Boolean);
                          if (pts.length < 2) return null;
                          return <path key={kw} d={`M${pts.join(' L')}`} fill="none" stroke={colors[ki % colors.length]} strokeWidth="2" opacity="0.8" />;
                        })}
                      </svg>
                      <div className="flex flex-wrap gap-3 mt-1">
                        {allKws.map((kw, ki) => (
                          <span key={kw} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                            <span className="w-3 h-0.5 rounded inline-block" style={{ backgroundColor: colors[ki % colors.length] }} />
                            <span className="truncate max-w-[120px]">{kw}</span>
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-zinc-500 mt-1">
                        <span>Position 1 (top)</span>
                        <span>Position {maxPos} (bottom)</span>
                      </div>
                    </div>
                  );
                })()}
                {/* Latest ranks table */}
                {latestRanks.length > 0 && (
                  <div className="overflow-hidden rounded-lg border border-zinc-800">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-zinc-950/50">
                        <th className="text-left py-2 px-3 text-zinc-500 font-medium">Keyword</th>
                        <th className="text-right py-2 px-3 text-zinc-500 font-medium">Position</th>
                        <th className="text-right py-2 px-3 text-zinc-500 font-medium">Change</th>
                        <th className="text-right py-2 px-3 text-zinc-500 font-medium">Clicks</th>
                      </tr></thead>
                      <tbody>
                        {latestRanks.slice(0, 10).map((r, i) => (
                          <tr key={i} className="border-t border-zinc-800/50">
                            <td className="py-1.5 px-3 text-zinc-300 truncate max-w-[200px]">{r.query}</td>
                            <td className="py-1.5 px-3 text-right">
                              <span className={r.position <= 3 ? 'text-green-400 font-semibold' : r.position <= 10 ? 'text-green-400' : r.position <= 20 ? 'text-amber-400' : 'text-red-400'}>
                                #{r.position}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 text-right">
                              {r.change !== undefined && r.change !== 0 && (
                                <span className={r.change > 0 ? 'text-green-400' : 'text-red-400'}>
                                  {r.change > 0 ? '↑' : '↓'}{Math.abs(r.change)}
                                </span>
                              )}
                              {r.change === 0 && <span className="text-zinc-500">—</span>}
                            </td>
                            <td className="py-1.5 px-3 text-right text-blue-400">{r.clicks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <div className="flex items-center gap-1 px-4 pt-3 pb-1">
                {(['queries', 'pages'] as const).map(st => (
                  <button key={st} onClick={() => setSearchSubTab(st)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${searchSubTab === st ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >{st === 'queries' ? 'Queries' : 'Pages'}</button>
                ))}
              </div>
              <table className="w-full text-xs">
                <thead><tr className="border-b border-zinc-800">
                  <th className="text-left py-3 px-4 text-zinc-500 font-medium">{searchSubTab === 'queries' ? 'Query' : 'Page'}</th>
                  {(['clicks', 'impressions', 'ctr', 'position'] as SortKey[]).map(key => (
                    <th key={key} className="text-right py-3 px-3 text-zinc-500 font-medium">
                      <button onClick={() => handleSort(key)} className="flex items-center gap-1 ml-auto hover:text-zinc-300">
                        {key === 'ctr' ? 'CTR' : key.charAt(0).toUpperCase() + key.slice(1)}
                        {sortKey === key && <ArrowUpDown className="w-3 h-3" />}
                      </button>
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {searchSubTab === 'queries' && sortedQueries().map((q, i) => (
                    <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="py-2.5 px-4 text-zinc-300 font-medium">{q.query}</td>
                      <td className="py-2.5 px-3 text-right text-blue-400 font-semibold">{q.clicks}</td>
                      <td className="py-2.5 px-3 text-right text-zinc-400">{q.impressions.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right text-emerald-400">{q.ctr}%</td>
                      <td className="py-2.5 px-3 text-right"><span className={q.position <= 10 ? 'text-green-400' : q.position <= 20 ? 'text-amber-400' : 'text-red-400'}>{q.position}</span></td>
                    </tr>
                  ))}
                  {searchSubTab === 'pages' && sortedPages().map((p, i) => {
                    let pagePath: string;
                    try { pagePath = new URL(p.page).pathname; } catch { pagePath = p.page; }
                    return (
                      <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="py-2.5 px-4 text-zinc-300 font-medium max-w-xs truncate">{pagePath}</td>
                        <td className="py-2.5 px-3 text-right text-blue-400 font-semibold">{p.clicks}</td>
                        <td className="py-2.5 px-3 text-right text-zinc-400">{p.impressions.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-400">{p.ctr}%</td>
                        <td className="py-2.5 px-3 text-right"><span className={p.position <= 10 ? 'text-green-400' : p.position <= 20 ? 'text-amber-400' : 'text-red-400'}>{p.position}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Annotations (read-only, managed from admin) */}
            {annotations.length > 0 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-zinc-400" />
                  <span className="text-xs font-semibold text-zinc-200">Timeline Annotations</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{annotations.length}</span>
                </div>
                <div className="space-y-1.5">
                  {annotations.map(ann => (
                    <div key={ann.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-zinc-950/50">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ann.color || '#2dd4bf' }} />
                      <span className="text-[11px] text-zinc-500 flex-shrink-0">{ann.date}</span>
                      <span className="text-xs text-zinc-300 flex-1 truncate">{ann.label}</span>
                      {ann.description && <span className="text-[11px] text-zinc-500 truncate max-w-[120px]">{ann.description}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>) : (
            <EmptyState icon={Search} title="Search data coming soon" description="Once Google Search Console is connected, you'll see how people find your site through Google — keywords, clicks, and ranking positions." />
          )}
        </>)}

        {/* ════════════ SITE HEALTH TAB ════════════ */}
        {tab === 'health' && <HealthTab audit={audit} auditDetail={auditDetail} liveDomain={ws.liveDomain} initialSeverity={(() => { const s = new URLSearchParams(window.location.search).get('severity'); return s && ['error','warning','info'].includes(s) ? s as 'error' | 'warning' | 'info' : 'all'; })()} />}

        {/* ════════════ SEO STRATEGY TAB ════════════ */}
        {tab === 'strategy' && (<>
          {strategyData ? (
            <div className="space-y-5">
              {/* Header + Generated date */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-200">SEO Keyword Strategy</h2>
                  <p className="text-[11px] text-zinc-500 mt-0.5">Generated {new Date(strategyData.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                </div>
              </div>

              {/* Summary Cards */}
              {(() => {
                const ranked = strategyData.pageMap.filter(p => p.currentPosition);
                const avgPos = ranked.length > 0 ? ranked.reduce((s, p) => s + (p.currentPosition || 0), 0) / ranked.length : 0;
                const totalImp = strategyData.pageMap.reduce((s, p) => s + (p.impressions || 0), 0);
                const totalClk = strategyData.pageMap.reduce((s, p) => s + (p.clicks || 0), 0);
                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
                      <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Pages Mapped</div>
                      <div className="text-xl font-bold text-zinc-100">{strategyData.pageMap.length}</div>
                      <div className="text-[11px] text-zinc-500">{strategyData.siteKeywords.length} target keywords</div>
                    </div>
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
                      <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1"><Eye className="w-3 h-3" /> Impressions</div>
                      <div className="text-xl font-bold text-zinc-100">{totalImp > 0 ? totalImp.toLocaleString() : '—'}</div>
                      <div className="text-[11px] text-zinc-500">{totalImp > 0 ? 'last 90 days' : 'no search data yet'}</div>
                    </div>
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
                      <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1"><MousePointerClick className="w-3 h-3" /> Clicks</div>
                      <div className="text-xl font-bold text-zinc-100">{totalClk > 0 ? totalClk.toLocaleString() : '—'}</div>
                      <div className="text-[11px] text-zinc-500">{totalImp > 0 ? `${((totalClk / totalImp) * 100).toFixed(1)}% CTR` : 'no search data yet'}</div>
                    </div>
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
                      <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1"><Trophy className="w-3 h-3" /> Avg Position</div>
                      <div className={`text-xl font-bold ${ranked.length > 0 ? (avgPos <= 3 ? 'text-emerald-400' : avgPos <= 10 ? 'text-green-400' : avgPos <= 20 ? 'text-amber-400' : 'text-red-400') : 'text-zinc-500'}`}>{ranked.length > 0 ? `#${avgPos.toFixed(1)}` : '—'}</div>
                      <div className="text-[11px] text-zinc-500">{ranked.length} pages ranking</div>
                    </div>
                  </div>
                );
              })()}

              {/* ── QUICK WINS (urgency builder) ── */}
              {strategyData.quickWins && strategyData.quickWins.length > 0 && (
                <div className="bg-gradient-to-br from-amber-950/30 to-zinc-900 rounded-xl border border-amber-500/30 p-5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center">
                        <Zap className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-amber-200">Quick Wins</div>
                        <div className="text-[11px] text-amber-400/60">Low-effort changes that can improve rankings fast</div>
                      </div>
                    </div>
                    <div className="space-y-2 mt-3">
                      {strategyData.quickWins.map((qw, i) => {
                        const impactColor = qw.estimatedImpact === 'high' ? 'text-green-400 bg-green-500/15 border-green-500/30' : qw.estimatedImpact === 'medium' ? 'text-amber-400 bg-amber-500/15 border-amber-500/30' : 'text-zinc-400 bg-zinc-700/30 border-zinc-600/20';
                        return (
                          <div key={i} className="px-3.5 py-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 hover:border-amber-500/20 transition-colors">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-mono text-zinc-500">{qw.pagePath}</span>
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${impactColor}`}>{qw.estimatedImpact} impact</span>
                            </div>
                            <div className="text-[11px] text-zinc-200 mt-1.5 font-medium">{qw.action}</div>
                            <div className="text-[11px] text-zinc-500 mt-1">{qw.rationale}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ── CONTENT OPPORTUNITIES (conversion moment) ── */}
              {strategyData.contentGaps && strategyData.contentGaps.length > 0 && (
                <div className="bg-gradient-to-br from-teal-950/40 to-zinc-900 rounded-xl border border-teal-500/30 p-5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-40 h-40 bg-teal-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
                  <div className="relative">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-teal-500/20 flex items-center justify-center">
                          <FileText className="w-4 h-4 text-teal-400" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-teal-200">Content Opportunities</div>
                          <div className="text-[11px] text-teal-400/60">New pages that could drive significant organic traffic</div>
                        </div>
                      </div>
                      <span className="text-[11px] text-zinc-500">{strategyData.contentGaps.length} topics identified</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-2 mb-4 leading-relaxed">
                      Based on your keyword strategy and competitor analysis, these topics represent untapped search traffic. Click <strong className="text-teal-300">Request This Topic</strong> to have our team create a full content brief.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {strategyData.contentGaps.map((gap, i) => {
                        const prioColor = gap.priority === 'high' ? 'text-red-400 bg-red-500/15 border-red-500/30' : gap.priority === 'medium' ? 'text-amber-400 bg-amber-500/15 border-amber-500/30' : 'text-zinc-400 bg-zinc-700/30 border-zinc-600/20';
                        const alreadyRequested = requestedTopics.has(gap.targetKeyword);
                        return (
                          <div key={i} className="px-4 py-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 hover:border-teal-500/30 transition-all group flex flex-col">
                            <div className="flex items-center gap-2 flex-wrap mb-1.5">
                              <span className="text-[11px] text-zinc-500 uppercase tracking-wider">{gap.intent}</span>
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${prioColor}`}>{gap.priority}</span>
                            </div>
                            <div className="text-xs font-semibold text-zinc-100 mb-1">{gap.topic}</div>
                            <div className="text-[11px] text-teal-400 font-medium mb-1">&ldquo;{gap.targetKeyword}&rdquo;</div>
                            <div className="text-[11px] text-zinc-500 leading-relaxed flex-1 mb-3">{gap.rationale}</div>
                            <div className="mt-auto">
                              {alreadyRequested ? (
                                <span className="flex items-center gap-1 text-[11px] text-teal-400 bg-teal-500/10 px-2.5 py-1.5 rounded-lg border border-teal-500/20 w-fit"><CheckCircle2 className="w-3.5 h-3.5" /> Requested</span>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setPricingModal({ serviceType: 'brief_only', topic: gap.topic, targetKeyword: gap.targetKeyword, intent: gap.intent, priority: gap.priority, rationale: gap.rationale, source: 'strategy' })}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 font-medium hover:bg-teal-600/40 transition-all"
                                  >
                                    <FileText className="w-3 h-3" /> Get a Brief
                                    {ws?.contentPricing && <span className="text-[11px] opacity-70 ml-0.5">{new Intl.NumberFormat('en-US', { style: 'currency', currency: ws.contentPricing.currency || 'USD', minimumFractionDigits: 0 }).format(ws.contentPricing.briefPrice)}</span>}
                                  </button>
                                  <button
                                    onClick={() => setPricingModal({ serviceType: 'full_post', topic: gap.topic, targetKeyword: gap.targetKeyword, intent: gap.intent, priority: gap.priority, rationale: gap.rationale, source: 'strategy' })}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600/30 to-teal-600/30 border border-blue-500/30 text-[11px] text-blue-200 font-medium hover:from-blue-600/50 hover:to-teal-600/50 transition-all"
                                  >
                                    <Sparkles className="w-3 h-3" /> Get Full Post
                                    {ws?.contentPricing && <span className="text-[11px] opacity-70 ml-0.5">{new Intl.NumberFormat('en-US', { style: 'currency', currency: ws.contentPricing.currency || 'USD', minimumFractionDigits: 0 }).format(ws.contentPricing.fullPostPrice)}</span>}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ── KEYWORD OPPORTUNITIES + TARGET KEYWORDS (side by side) ── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {strategyData.opportunities.length > 0 && (
                  <div className="bg-gradient-to-br from-teal-950/30 to-zinc-900 rounded-xl border border-teal-500/20 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-lg bg-teal-500/20 flex items-center justify-center">
                        <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                      </div>
                      <div className="text-xs font-semibold text-teal-200">Keyword Opportunities</div>
                    </div>
                    <div className="space-y-2">
                      {strategyData.opportunities.map((opp, i) => (
                        <div key={i} className="flex items-start gap-2.5 text-[11px] text-zinc-300 px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/50">
                          <span className="w-5 h-5 rounded-full bg-teal-500/15 border border-teal-500/25 flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] text-teal-400 font-bold">{i + 1}</span>
                          {opp}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-lg bg-teal-500/20 flex items-center justify-center">
                      <Target className="w-3.5 h-3.5 text-teal-400" />
                    </div>
                    <div className="text-xs font-semibold text-zinc-200">Target Keywords</div>
                    <span className="text-[11px] text-zinc-500 ml-auto">{strategyData.siteKeywords.length} keywords</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {strategyData.siteKeywords.map(kw => {
                      const metrics = strategyData.siteKeywordMetrics?.find(m => m.keyword.toLowerCase() === kw.toLowerCase());
                      return (
                        <span key={kw} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20 text-[11px] text-teal-300">
                          {kw}
                          {metrics && metrics.volume > 0 && (
                            <span className="text-[11px] text-zinc-500 font-mono">{metrics.volume.toLocaleString()}/mo</span>
                          )}
                          {metrics && metrics.difficulty > 0 && (
                            <span className={`text-[11px] font-mono ${metrics.difficulty <= 30 ? 'text-green-400' : metrics.difficulty <= 60 ? 'text-amber-400' : 'text-red-400'}`}>KD {metrics.difficulty}%</span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* ── COMPETITOR KEYWORD GAPS ── */}
              {strategyData.keywordGaps && strategyData.keywordGaps.length > 0 && (
                <div className="bg-gradient-to-br from-orange-950/20 to-zinc-900 rounded-xl border border-orange-500/20 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-lg bg-orange-500/20 flex items-center justify-center">
                      <Target className="w-3.5 h-3.5 text-orange-400" />
                    </div>
                    <div className="text-xs font-semibold text-orange-200">Competitor Keyword Gaps</div>
                    <span className="text-[11px] text-zinc-500">Keywords your competitors rank for that you don't</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {strategyData.keywordGaps.map((gap, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/50">
                        <span className="text-[11px] text-zinc-300 font-medium truncate mr-2">{gap.keyword}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {gap.volume != null && gap.volume > 0 && <span className="text-[11px] text-zinc-500">{gap.volume.toLocaleString()}</span>}
                          {gap.difficulty != null && gap.difficulty > 0 && (
                            <span className={`text-[11px] font-medium ${gap.difficulty <= 30 ? 'text-green-400' : gap.difficulty <= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                              KD {gap.difficulty}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── PAGE KEYWORD MAP (detailed reference with search/sort/filter) ── */}
              {(() => {
                const intents = Array.from(new Set(strategyData.pageMap.map(p => p.searchIntent).filter(Boolean)));
                let filtered = strategyData.pageMap.filter(p => {
                  if (mapSearch) {
                    const q = mapSearch.toLowerCase();
                    if (!(p.pagePath.toLowerCase().includes(q) || (p.pageTitle || '').toLowerCase().includes(q) || p.primaryKeyword.toLowerCase().includes(q))) return false;
                  }
                  if (mapIntent !== 'all' && p.searchIntent !== mapIntent) return false;
                  return true;
                });
                if (mapSort === 'position') filtered = [...filtered].sort((a, b) => (a.currentPosition || 999) - (b.currentPosition || 999));
                else if (mapSort === 'impressions') filtered = [...filtered].sort((a, b) => (b.impressions || 0) - (a.impressions || 0));
                else if (mapSort === 'clicks') filtered = [...filtered].sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
                return (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                    <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-3 flex-wrap">
                      <span className="text-xs font-medium text-zinc-300">Page Keyword Map</span>
                      <span className="text-[11px] text-zinc-500">{filtered.length} of {strategyData.pageMap.length} pages</span>
                      <div className="flex items-center gap-2 ml-auto flex-wrap">
                        <div className="relative">
                          <Search className="w-3 h-3 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            placeholder="Search pages or keywords..."
                            value={mapSearch}
                            onChange={e => setMapSearch(e.target.value)}
                            className="bg-zinc-800 border border-zinc-700 rounded-lg pl-7 pr-3 py-1.5 text-[11px] text-zinc-300 w-48 focus:outline-none focus:border-teal-500/50 placeholder-zinc-600"
                          />
                        </div>
                        <select value={mapSort} onChange={e => setMapSort(e.target.value as typeof mapSort)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-teal-500/50 appearance-none cursor-pointer">
                          <option value="default">Default order</option>
                          <option value="position">By position</option>
                          <option value="impressions">By impressions</option>
                          <option value="clicks">By clicks</option>
                        </select>
                        {intents.length > 1 && (
                          <select value={mapIntent} onChange={e => setMapIntent(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-teal-500/50 appearance-none cursor-pointer">
                            <option value="all">All intents</option>
                            {intents.map(intent => <option key={intent} value={intent}>{intent}</option>)}
                          </select>
                        )}
                      </div>
                    </div>
                    <div className="divide-y divide-zinc-800/50 max-h-[600px] overflow-y-auto">
                      {filtered.map(page => (
                        <div key={page.pagePath} className="px-5 py-3 hover:bg-zinc-800/30 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              {page.pageTitle && <div className="text-xs text-zinc-300 truncate">{page.pageTitle}</div>}
                              <div className="text-[11px] text-zinc-500 font-mono truncate">{page.pagePath}</div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                              {page.searchIntent && (
                                <span className={`text-[11px] px-1.5 py-0.5 rounded-full border font-medium ${
                                  page.searchIntent === 'commercial' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                                  page.searchIntent === 'transactional' ? 'text-green-400 bg-green-500/10 border-green-500/20' :
                                  page.searchIntent === 'informational' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' :
                                  'text-zinc-400 bg-zinc-700/30 border-zinc-600/20'
                                }`}>{page.searchIntent}</span>
                              )}
                              {page.currentPosition ? (
                                <span className={`text-[11px] font-mono font-medium px-1.5 py-0.5 rounded bg-zinc-800 ${page.currentPosition <= 3 ? 'text-emerald-400' : page.currentPosition <= 10 ? 'text-green-400' : page.currentPosition <= 20 ? 'text-amber-400' : 'text-red-400'}`}>#{page.currentPosition.toFixed(0)}</span>
                              ) : (
                                <span className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded font-mono">—</span>
                              )}
                              {page.impressions != null && page.impressions > 0 && (
                                <span className="text-[11px] text-zinc-500 font-mono">{page.impressions.toLocaleString()} imp</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[11px] text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded">{page.primaryKeyword}</span>
                            {page.volume != null && page.volume > 0 && <span className="text-[11px] text-zinc-500 font-mono">{page.volume.toLocaleString()}/mo</span>}
                            {page.difficulty != null && page.difficulty > 0 && (
                              <span className={`text-[11px] font-mono ${page.difficulty <= 30 ? 'text-green-400' : page.difficulty <= 60 ? 'text-amber-400' : 'text-red-400'}`}>KD {page.difficulty}%</span>
                            )}
                            {page.secondaryKeywords && page.secondaryKeywords.length > 0 && (
                              <span className="text-[11px] text-zinc-500">+{page.secondaryKeywords.length} secondary</span>
                            )}
                          </div>
                        </div>
                      ))}
                      {filtered.length === 0 && (
                        <div className="px-5 py-8 text-center text-xs text-zinc-500">No pages match your filters</div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="text-center py-16">
              <Target className="w-8 h-8 text-zinc-500 mx-auto mb-2" />
              <p className="text-sm text-zinc-500">SEO strategy is being prepared</p>
              <p className="text-xs text-zinc-500 mt-1">Your web team is building a keyword strategy for your site. Check back soon!</p>
            </div>
          )}
        </>)}

        {/* ════════════ CONTENT TAB ════════════ */}
        {tab === 'content' && (<>
          {/* Alert banner for items needing review */}
          {(() => {
            const reviewCount = contentRequests.filter(r => r.status === 'client_review').length;
            const newComments = contentRequests.filter(r => r.comments && r.comments.length > 0 && r.comments[r.comments.length - 1].author === 'team' && r.status !== 'declined').length;
            if (reviewCount > 0 || newComments > 0) return (
              <div className="bg-gradient-to-r from-blue-600/20 to-teal-600/10 border border-blue-500/30 rounded-xl px-5 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-semibold text-blue-200">
                    {reviewCount > 0 && <>{reviewCount} brief{reviewCount > 1 ? 's' : ''} ready for your review</>}
                    {reviewCount > 0 && newComments > 0 && ' · '}
                    {newComments > 0 && <>{newComments} item{newComments > 1 ? 's' : ''} with new team responses</>}
                  </div>
                  <div className="text-[11px] text-blue-400/60 mt-0.5">Your team has updates waiting for you below</div>
                </div>
              </div>
            );
            return null;
          })()}

          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-base font-semibold text-zinc-100">Content Pipeline</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Track and manage your content requests</p>
            </div>
            <button onClick={() => setShowTopicForm(!showTopicForm)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/30 text-xs text-blue-300 hover:bg-blue-600/30 transition-colors font-medium">
              <Plus className="w-3.5 h-3.5" /> Suggest a Topic
            </button>
          </div>

          {/* Topic submission form */}
          {showTopicForm && (
            <div className="bg-zinc-900 rounded-xl border border-blue-500/20 p-5 space-y-3">
              <div className="text-xs font-medium text-zinc-300">Suggest a Content Topic</div>
              <input type="text" value={newTopicName} onChange={e => setNewTopicName(e.target.value)} placeholder="Topic name (e.g. 'Benefits of sedation dentistry')" className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600" />
              <input type="text" value={newTopicKeyword} onChange={e => setNewTopicKeyword(e.target.value)} placeholder="Target keyword (e.g. 'sedation dentistry benefits')" className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600" />
              <textarea value={newTopicNotes} onChange={e => setNewTopicNotes(e.target.value)} placeholder="Any notes or context for this topic... (optional)" rows={2} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 resize-none" />
              <div>
                <div className="text-[11px] text-zinc-500 mb-1.5">What would you like?</div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setNewTopicServiceType('brief_only')} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-medium transition-all ${newTopicServiceType === 'brief_only' ? 'bg-teal-600/20 border-teal-500/40 text-teal-300' : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
                    <FileText className="w-3.5 h-3.5" /> Content Brief
                  </button>
                  <button onClick={() => setNewTopicServiceType('full_post')} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-medium transition-all ${newTopicServiceType === 'full_post' ? 'bg-gradient-to-r from-blue-600/20 to-teal-600/20 border-blue-500/40 text-blue-300' : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
                    <Sparkles className="w-3.5 h-3.5" /> Full Blog Post
                  </button>
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">{newTopicServiceType === 'brief_only' ? 'A detailed content strategy document for this topic' : 'Brief + professionally written article delivered ready to publish'}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => {
                  if (!newTopicName.trim() || !newTopicKeyword.trim()) return;
                  setPricingModal({ serviceType: newTopicServiceType, topic: newTopicName.trim(), targetKeyword: newTopicKeyword.trim(), notes: newTopicNotes.trim() || undefined, source: 'client' });
                }} disabled={!newTopicName.trim() || !newTopicKeyword.trim() || pricingConfirming} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-xs text-white font-medium hover:bg-blue-500 transition-colors disabled:opacity-50">
                  <Send className="w-3.5 h-3.5" /> Submit Topic
                </button>
                <button onClick={() => setShowTopicForm(false)} className="px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
              </div>
            </div>
          )}

          {/* Empty state when no requests yet */}
          {contentRequests.length === 0 && (
            <div className="text-center py-16">
              <FileText className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
              <p className="text-sm font-medium text-zinc-400">Your content pipeline is empty</p>
              <p className="text-xs text-zinc-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
                Ready to grow your traffic? Browse content ideas on the <button onClick={() => setTab('strategy')} className="text-teal-400 hover:text-teal-300 underline underline-offset-2 transition-colors">SEO Strategy</button> tab, or click <strong className="text-zinc-400">Suggest a Topic</strong> above to kick things off.
              </p>
            </div>
          )}

          {/* Pipeline items — review-needed first */}
          <div className="space-y-3">
            {contentRequests.filter(r => r.status !== 'declined').sort((a, b) => {
              const priority = (s: string) => s === 'client_review' ? 0 : s === 'changes_requested' ? 1 : 2;
              const diff = priority(a.status) - priority(b.status);
              return diff !== 0 ? diff : b.updatedAt.localeCompare(a.updatedAt);
            }).map(req => {
              const isBriefOnly = (req.serviceType || 'brief_only') === 'brief_only' && !req.upgradedAt;
              const steps = isBriefOnly
                ? ['requested', 'brief_generated', 'client_review', 'approved', 'delivered'] as const
                : ['requested', 'brief_generated', 'client_review', 'approved', 'in_progress', 'delivered'] as const;
              const stepLabels = isBriefOnly
                ? ['Requested', 'Brief Ready', 'Your Review', 'Approved', 'Brief Delivered']
                : ['Requested', 'Brief Ready', 'Your Review', 'Approved', 'In Production', 'Delivered'];
              // Map changes_requested back to client_review step for timeline display
              const displayStatus = req.status === 'changes_requested' ? 'client_review' : req.status;
              const currentIdx = (steps as readonly string[]).indexOf(displayStatus);
              const isExpanded = expandedContentReq === req.id;
              const brief = req.briefId ? briefPreviews[req.briefId] : null;
              const canUpgrade = isBriefOnly && ['approved', 'delivered'].includes(req.status);

              return (
                <div key={req.id} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                  <button onClick={() => {
                    const next = isExpanded ? null : req.id;
                    setExpandedContentReq(next);
                    if (next && req.briefId) loadBriefPreview(req.briefId);
                  }} className="w-full px-5 py-4 text-left hover:bg-zinc-800/30 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-200">{req.topic}</span>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded border font-medium ${(req.serviceType || 'brief_only') === 'full_post' ? 'bg-gradient-to-r from-blue-500/10 to-teal-500/10 text-blue-300 border-blue-500/20' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
                            {(req.serviceType || 'brief_only') === 'full_post' ? '✦ Full Post' : 'Brief'}
                          </span>
                          {req.upgradedAt && <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-medium">Upgraded</span>}
                        </div>
                        <div className="text-xs text-teal-400 mt-0.5">&ldquo;{req.targetKeyword}&rdquo;</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {req.source === 'client' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">You submitted</span>}
                        {req.status === 'changes_requested' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">Changes Requested</span>}
                        {req.status === 'client_review' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse">Needs Your Review</span>}
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
                      </div>
                    </div>
                    {/* Progress timeline */}
                    <div className="flex items-center gap-0.5">
                      {steps.map((step, i) => {
                        const isComplete = currentIdx >= i;
                        const isCurrent = currentIdx === i;
                        return (
                          <div key={step} className="flex items-center flex-1">
                            <div className="flex flex-col items-center flex-1">
                              <div className={`w-full h-1.5 rounded-full ${isComplete ? (isCurrent ? (req.status === 'changes_requested' ? 'bg-orange-400' : 'bg-teal-400') : 'bg-teal-500/40') : 'bg-zinc-800'}`} />
                              <span className={`text-[11px] mt-1 ${isCurrent ? (req.status === 'changes_requested' ? 'text-orange-400 font-medium' : 'text-teal-400 font-medium') : isComplete ? 'text-zinc-500' : 'text-zinc-700'}`}>{stepLabels[i]}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-5 pb-5 space-y-4 border-t border-zinc-800">
                      {/* Full brief */}
                      {brief && (
                        <div className="mt-4 space-y-5">
                          {/* — Strategic Overview — */}
                          {brief.executiveSummary && (
                            <div className="bg-teal-500/5 border border-teal-500/20 rounded-lg px-4 py-3">
                              <div className="text-[11px] text-teal-400 font-medium uppercase tracking-wider mb-1.5">Strategic Overview</div>
                              <div className="text-xs text-zinc-300 leading-relaxed">{brief.executiveSummary}</div>
                            </div>
                          )}

                          {/* Key Metrics */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                              <div className="text-[11px] text-zinc-500 mb-0.5">Word Count</div>
                              <div className="text-sm font-bold text-blue-400">{brief.wordCountTarget?.toLocaleString()}</div>
                            </div>
                            <div className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                              <div className="text-[11px] text-zinc-500 mb-0.5">Search Intent</div>
                              <div className="text-xs text-zinc-300 capitalize font-medium">{brief.intent}</div>
                            </div>
                            {brief.contentFormat && (
                              <div className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                                <div className="text-[11px] text-zinc-500 mb-0.5">Format</div>
                                <div className="text-xs text-amber-400 capitalize font-medium">{brief.contentFormat}</div>
                              </div>
                            )}
                            {brief.difficultyScore != null && (
                              <div className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                                <div className="text-[11px] text-zinc-500 mb-0.5">Difficulty</div>
                                <div className={`text-sm font-bold ${brief.difficultyScore <= 30 ? 'text-green-400' : brief.difficultyScore <= 60 ? 'text-amber-400' : 'text-red-400'}`}>{brief.difficultyScore}/100</div>
                              </div>
                            )}
                          </div>

                          {/* Traffic Potential */}
                          {brief.trafficPotential && (
                            <div className="bg-zinc-950 rounded-lg px-4 py-2.5 border border-zinc-800 flex items-start gap-2">
                              <TrendingUp className="w-3.5 h-3.5 text-green-400 mt-0.5 flex-shrink-0" />
                              <div><div className="text-[11px] text-zinc-500 mb-0.5">Traffic Potential</div><div className="text-xs text-zinc-300">{brief.trafficPotential}</div></div>
                            </div>
                          )}

                          {/* — Content Direction — */}
                          <div className="space-y-3">
                            <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-2 after:content-[''] after:flex-1 after:h-px after:bg-zinc-800">Content Direction</div>
                            <div className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                              <div className="text-[11px] text-zinc-500 mb-1">Suggested Title</div>
                              <div className="text-sm text-teal-400 font-medium">{brief.suggestedTitle}</div>
                            </div>
                            <div className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                              <div className="text-[11px] text-zinc-500 mb-1">Meta Description</div>
                              <div className="text-xs text-zinc-300">{brief.suggestedMetaDesc}</div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {brief.audience && (
                                <div className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                                  <div className="text-[11px] text-zinc-500 mb-1">Target Audience</div>
                                  <div className="text-xs text-zinc-400 leading-relaxed">{brief.audience}</div>
                                </div>
                              )}
                              {brief.toneAndStyle && (
                                <div className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                                  <div className="text-[11px] text-zinc-500 mb-1">Tone & Style</div>
                                  <div className="text-xs text-zinc-400 leading-relaxed">{brief.toneAndStyle}</div>
                                </div>
                              )}
                            </div>
                            {brief.ctaRecommendations && brief.ctaRecommendations.length > 0 && (
                              <div>
                                <div className="text-[11px] text-zinc-500 mb-1.5">Calls to Action</div>
                                <div className="space-y-1">{brief.ctaRecommendations.map((cta: string, i: number) => (
                                  <div key={i} className="text-xs text-zinc-300 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800 flex items-start gap-2">
                                    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${i === 0 ? 'bg-teal-500/20 text-teal-400' : 'bg-zinc-800 text-zinc-500'}`}>{i === 0 ? 'Primary' : 'Secondary'}</span>{cta}
                                  </div>
                                ))}</div>
                              </div>
                            )}
                          </div>

                          {/* — Detailed Outline — */}
                          {brief.outline?.length > 0 && (
                            <div className="space-y-3">
                              <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-2 after:content-[''] after:flex-1 after:h-px after:bg-zinc-800">Content Outline</div>
                              <div className="space-y-2">
                                {brief.outline.map((s: { heading: string; notes: string; wordCount?: number; keywords?: string[] }, i: number) => (
                                  <div key={i} className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                                    <div className="flex items-center justify-between">
                                      <div className="text-xs font-medium text-zinc-200">H2: {s.heading}</div>
                                      {s.wordCount && <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{s.wordCount} words</span>}
                                    </div>
                                    <div className="text-[11px] text-zinc-500 mt-1.5 leading-relaxed">{s.notes}</div>
                                    {s.keywords && s.keywords.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-2">{s.keywords.map((kw: string, j: number) => <span key={j} className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400/80">{kw}</span>)}</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* — SEO Intelligence — */}
                          <div className="space-y-3">
                            <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-2 after:content-[''] after:flex-1 after:h-px after:bg-zinc-800">SEO Intelligence</div>
                            {brief.secondaryKeywords && brief.secondaryKeywords.length > 0 && (
                              <div>
                                <div className="text-[11px] text-zinc-500 mb-1.5">Keywords to Include</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {brief.secondaryKeywords.map((kw: string, i: number) => (
                                    <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{kw}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {brief.topicalEntities && brief.topicalEntities.length > 0 && (
                              <div>
                                <div className="text-[11px] text-zinc-500 mb-1.5">Topics to Reference</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {brief.topicalEntities.map((entity: string, i: number) => (
                                    <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-300">{entity}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {brief.peopleAlsoAsk && brief.peopleAlsoAsk.length > 0 && (
                              <div>
                                <div className="text-[11px] text-zinc-500 mb-1.5">Questions to Address</div>
                                <div className="space-y-1">
                                  {brief.peopleAlsoAsk.map((q: string, i: number) => (
                                    <div key={i} className="flex items-start gap-2 text-xs text-zinc-300 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                                      <span className="text-amber-400 flex-shrink-0 font-medium">Q{i + 1}.</span> {q}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {brief.serpAnalysis?.gaps && brief.serpAnalysis.gaps.length > 0 && (
                              <div>
                                <div className="text-[11px] text-zinc-500 mb-1.5">Your Competitive Edge</div>
                                <div className="space-y-1">
                                  {brief.serpAnalysis.gaps.map((g: string, i: number) => (
                                    <div key={i} className="text-[11px] text-green-300/80 flex items-start gap-1.5 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                                      <span className="text-green-400 mt-0.5 flex-shrink-0">→</span>{g}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {brief.internalLinkSuggestions && brief.internalLinkSuggestions.length > 0 && (
                              <div>
                                <div className="text-[11px] text-zinc-500 mb-1.5">Internal Links to Include</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {brief.internalLinkSuggestions.map((link: string, i: number) => (
                                    <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-blue-400">/{link}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* — E-E-A-T Guidance — */}
                          {brief.eeatGuidance && (
                            <div className="space-y-3">
                              <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-2 after:content-[''] after:flex-1 after:h-px after:bg-zinc-800">E-E-A-T Signals</div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {[
                                  { label: 'Experience', value: brief.eeatGuidance.experience, color: 'text-blue-400' },
                                  { label: 'Expertise', value: brief.eeatGuidance.expertise, color: 'text-teal-400' },
                                  { label: 'Authority', value: brief.eeatGuidance.authority, color: 'text-teal-400' },
                                  { label: 'Trust', value: brief.eeatGuidance.trust, color: 'text-amber-400' },
                                ].filter(e => e.value).map((e, i) => (
                                  <div key={i} className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                                    <div className={`text-[11px] ${e.color} font-medium uppercase tracking-wider mb-1`}>{e.label}</div>
                                    <div className="text-[11px] text-zinc-400 leading-relaxed">{e.value}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* — Content Checklist — */}
                          {brief.contentChecklist && brief.contentChecklist.length > 0 && (
                            <div className="space-y-3">
                              <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-2 after:content-[''] after:flex-1 after:h-px after:bg-zinc-800">Content Checklist</div>
                              <div className="bg-zinc-950 rounded-lg border border-zinc-800 divide-y divide-zinc-800/50">
                                {brief.contentChecklist.map((item: string, i: number) => (
                                  <div key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                                    <div className="w-4 h-4 mt-0.5 rounded border border-zinc-700 flex-shrink-0" />
                                    <span className="text-[11px] text-zinc-400 leading-relaxed">{item}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* — Schema Markup — */}
                          {brief.schemaRecommendations && brief.schemaRecommendations.length > 0 && (
                            <div className="space-y-3">
                              <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-2 after:content-[''] after:flex-1 after:h-px after:bg-zinc-800">Schema Markup</div>
                              <div className="space-y-2">
                                {brief.schemaRecommendations.map((schema: { type: string; notes: string }, i: number) => (
                                  <div key={i} className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-[11px] px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-medium">{schema.type}</span>
                                    </div>
                                    <div className="text-[11px] text-zinc-400 leading-relaxed">{schema.notes}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Export */}
                          <div className="flex items-center gap-2 pt-1">
                            <button onClick={() => window.open(`/api/content-briefs/${workspaceId}/${brief.id}/export`, '_blank')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
                              <Download className="w-3 h-3" /> Download PDF
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Action buttons for client_review */}
                      {req.status === 'client_review' && (
                        <div className="flex items-center gap-2 pt-1">
                          <button onClick={() => approveBrief(req.id)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600/20 border border-green-500/30 text-xs text-green-300 font-medium hover:bg-green-600/30 transition-colors">
                            <Check className="w-3.5 h-3.5" /> Approve Brief
                          </button>
                          <button onClick={() => { setFeedbackReqId(req.id); setFeedbackText(''); }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600/20 border border-orange-500/30 text-xs text-orange-300 font-medium hover:bg-orange-600/30 transition-colors">
                            <Edit3 className="w-3.5 h-3.5" /> Request Changes
                          </button>
                          <button onClick={() => { setDeclineReqId(req.id); setDeclineReason(''); }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-800 text-xs text-zinc-500 hover:text-red-400 transition-colors">
                            <X className="w-3.5 h-3.5" /> Decline
                          </button>
                        </div>
                      )}

                      {/* Delivery link */}
                      {req.status === 'delivered' && req.deliveryUrl && (
                        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
                            <ExternalLink className="w-4 h-4 text-green-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-green-300 mb-0.5">Your content is ready</div>
                            <a href={req.deliveryUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-green-400 hover:text-green-300 underline underline-offset-2 truncate block">{req.deliveryUrl}</a>
                            {req.deliveryNotes && <div className="text-[11px] text-zinc-400 mt-1">{req.deliveryNotes}</div>}
                          </div>
                        </div>
                      )}

                      {/* Upgrade CTA for brief_only items after approval */}
                      {canUpgrade && (
                        <div className="bg-gradient-to-r from-blue-600/10 via-teal-600/10 to-blue-600/10 border border-blue-500/20 rounded-xl p-4 flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-teal-500/20 flex items-center justify-center flex-shrink-0">
                            <Sparkles className="w-5 h-5 text-blue-400" />
                          </div>
                          <div className="flex-1">
                            <div className="text-xs font-semibold text-blue-200">Want the full article written?</div>
                            <div className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">Love the brief? Upgrade to a professionally written blog post delivered ready to publish.</div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setPricingModal({ serviceType: 'full_post', topic: req.topic, targetKeyword: req.targetKeyword, source: 'upgrade', upgradeReqId: req.id }); }}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-teal-600 text-xs text-white font-medium hover:from-blue-500 hover:to-teal-500 transition-all flex-shrink-0 shadow-lg shadow-blue-900/20"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            Upgrade to Full Post
                            {ws?.contentPricing && <span className="text-[11px] opacity-70 ml-0.5">+{new Intl.NumberFormat('en-US', { style: 'currency', currency: ws.contentPricing.currency || 'USD', minimumFractionDigits: 0 }).format(Math.max(0, ws.contentPricing.fullPostPrice - ws.contentPricing.briefPrice))}</span>}
                          </button>
                        </div>
                      )}

                      {/* Feedback modal */}
                      {feedbackReqId === req.id && (
                        <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-4 space-y-3">
                          <div className="text-xs text-orange-300 font-medium">What changes would you like?</div>
                          <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)} placeholder="Describe what you'd like changed..." rows={3} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 resize-none" />
                          <div className="flex items-center gap-2">
                            <button onClick={() => requestChanges(req.id)} disabled={!feedbackText.trim()} className="px-4 py-2 rounded-lg bg-orange-600 text-xs text-white font-medium hover:bg-orange-500 transition-colors disabled:opacity-50">Submit Feedback</button>
                            <button onClick={() => setFeedbackReqId(null)} className="px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* Decline modal (works for both requested topics and client_review briefs) */}
                      {declineReqId === req.id && (
                        <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 space-y-3">
                          <div className="text-xs text-red-300 font-medium">Why are you declining? (optional)</div>
                          <input type="text" value={declineReason} onChange={e => setDeclineReason(e.target.value)} placeholder="e.g. Not relevant to our current goals" className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600" />
                          <div className="flex items-center gap-2">
                            <button onClick={() => declineTopic(req.id)} className="px-4 py-2 rounded-lg bg-red-600/80 text-xs text-white font-medium hover:bg-red-600 transition-colors">Confirm Decline</button>
                            <button onClick={() => setDeclineReqId(null)} className="px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* Decline option for requested topics (not in review) */}
                      {req.status === 'requested' && declineReqId !== req.id && (
                        <button onClick={() => { setDeclineReqId(req.id); setDeclineReason(''); }} className="text-xs text-zinc-500 hover:text-red-400 transition-colors">Not interested in this topic</button>
                      )}

                      {/* Comments thread */}
                      {req.comments && req.comments.length > 0 && (
                        <div>
                          <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Comments</div>
                          <div className="space-y-1.5">
                            {req.comments.map(c => (
                              <div key={c.id} className={`text-xs px-3 py-2 rounded-lg ${c.author === 'client' ? 'bg-blue-500/10 border border-blue-500/15 text-blue-300 ml-6' : 'bg-zinc-800/60 border border-zinc-800 text-zinc-400 mr-6'}`}>
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="font-medium text-[11px]">{c.author === 'client' ? 'You' : 'Team'}</span>
                                  <span className="text-[11px] text-zinc-500">{new Date(c.createdAt).toLocaleDateString()}</span>
                                </div>
                                {c.content}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Add comment */}
                      {!['delivered', 'declined'].includes(req.status) && (
                        <div className="flex items-center gap-2">
                          <input type="text" value={expandedContentReq === req.id ? contentComment : ''} onChange={e => setContentComment(e.target.value)} placeholder="Add a comment..." className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600" onKeyDown={e => { if (e.key === 'Enter') addContentComment(req.id); }} />
                          <button onClick={() => addContentComment(req.id)} disabled={!contentComment.trim() || sendingContentComment} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50">
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Declined items (collapsed) */}
          {contentRequests.filter(r => r.status === 'declined').length > 0 && (
            <details className="mt-4">
              <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 transition-colors">
                {contentRequests.filter(r => r.status === 'declined').length} declined topic{contentRequests.filter(r => r.status === 'declined').length > 1 ? 's' : ''}
              </summary>
              <div className="mt-2 space-y-2">
                {contentRequests.filter(r => r.status === 'declined').map(req => (
                  <div key={req.id} className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 px-4 py-3 opacity-60">
                    <div className="text-xs text-zinc-400">{req.topic}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">&ldquo;{req.targetKeyword}&rdquo;</div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>)}

        {/* ════════════ ANALYTICS TAB ════════════ */}
        {tab === 'analytics' && (<>
          {!ga4Overview ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4"><LineChart className="w-8 h-8 text-zinc-700" /></div>
              <h3 className="text-sm font-medium text-zinc-400">Analytics Coming Soon</h3>
              <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">Once Google Analytics is connected, you'll see visitor trends, traffic sources, top pages, and conversion events — all in one place.</p>
            </div>
          ) : (<>
            {/* GA4 Overview Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              {[
                { label: 'Users', value: ga4Overview.totalUsers.toLocaleString(), color: 'text-teal-400', changePct: ga4Comparison?.changePercent.users },
                { label: 'Sessions', value: ga4Overview.totalSessions.toLocaleString(), color: 'text-blue-400', changePct: ga4Comparison?.changePercent.sessions },
                { label: 'Page Views', value: ga4Overview.totalPageviews.toLocaleString(), color: 'text-teal-400', changePct: ga4Comparison?.changePercent.pageviews },
                { label: 'Avg Duration', value: `${Math.floor(ga4Overview.avgSessionDuration / 60)}m ${Math.floor(ga4Overview.avgSessionDuration % 60)}s`, color: 'text-amber-400' },
                { label: 'Bounce Rate', value: `${ga4Overview.bounceRate}%`, color: ga4Overview.bounceRate > 60 ? 'text-red-400' : 'text-emerald-400', changeAbs: ga4Comparison?.change.bounceRate, invert: true },
                { label: 'New Users', value: `${ga4Overview.newUserPercentage}%`, color: 'text-teal-400' },
              ].map(c => (
                <div key={c.label} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">{c.label}</div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xl font-bold ${c.color}`}>{c.value}</span>
                    {c.changePct !== undefined && c.changePct !== 0 && (
                      <span className={`text-[11px] font-medium ${c.changePct > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {c.changePct > 0 ? '+' : ''}{c.changePct}%
                      </span>
                    )}
                    {c.changeAbs !== undefined && c.changeAbs !== 0 && (
                      <span className={`text-[11px] font-medium ${(c.invert ? c.changeAbs < 0 : c.changeAbs > 0) ? 'text-emerald-400' : 'text-red-400'}`}>
                        {c.changeAbs > 0 ? '+' : ''}{c.changeAbs}pp
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Traffic Trend + Devices row */}
            {ga4Trend.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                {/* Traffic Trend (2/3) */}
                <div className="lg:col-span-2 bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                  <h3 className="text-sm font-semibold text-zinc-300 mb-4">Traffic Trend</h3>
                  <svg viewBox={`0 0 800 200`} className="w-full h-48">
                    {(() => {
                      const maxV = Math.max(...ga4Trend.map(d => d.users), 1);
                      const maxS = Math.max(...ga4Trend.map(d => d.sessions), 1);
                      const maxP = Math.max(...ga4Trend.map(d => d.pageviews), 1);
                      const xStep = 800 / Math.max(ga4Trend.length - 1, 1);
                      const mkPath = (vals: number[], max: number) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * xStep},${190 - (v / max) * 170}`).join(' ');
                      return (<>
                        <path d={mkPath(ga4Trend.map(d => d.pageviews), maxP)} fill="none" stroke="rgba(45,212,191,0.3)" strokeWidth="1.5" />
                        <path d={mkPath(ga4Trend.map(d => d.sessions), maxS)} fill="none" stroke="rgba(96,165,250,0.5)" strokeWidth="1.5" />
                        <path d={mkPath(ga4Trend.map(d => d.users), maxV)} fill="none" stroke="rgba(45,212,191,0.9)" strokeWidth="2" />
                        <path d={`${mkPath(ga4Trend.map(d => d.users), maxV)} L${(ga4Trend.length - 1) * xStep},190 L0,190 Z`} fill="url(#ga4grad)" opacity="0.15" />
                        <defs><linearGradient id="ga4grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2dd4bf" /><stop offset="100%" stopColor="transparent" /></linearGradient></defs>
                      </>);
                    })()}
                  </svg>
                  <div className="flex items-center justify-center gap-6 mt-2">
                    <span className="flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-teal-400 inline-block" /> Users</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-blue-400 inline-block" /> Sessions</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="w-3 h-0.5 rounded bg-teal-400/40 inline-block" /> Pageviews</span>
                  </div>
                </div>

                {/* Devices Pie Chart (1/3) */}
                {ga4Devices.length > 0 && (
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 flex flex-col">
                    <h3 className="text-sm font-semibold text-zinc-300 mb-4">Devices</h3>
                    <div className="flex-1 flex flex-col items-center justify-center">
                      {(() => {
                        const PIE_COLORS = ['#14b8a6', '#60a5fa', '#34d399', '#fbbf24'];
                        const total = ga4Devices.reduce((s, d) => s + d.sessions, 0) || 1;
                        let cumAngle = -90;
                        const slices = ga4Devices.map((d, i) => {
                          const pct = d.sessions / total;
                          const angle = pct * 360;
                          const startAngle = cumAngle;
                          cumAngle += angle;
                          const r = 60, cx = 70, cy = 70;
                          const startRad = (startAngle * Math.PI) / 180;
                          const endRad = ((startAngle + angle) * Math.PI) / 180;
                          const x1 = cx + r * Math.cos(startRad), y1 = cy + r * Math.sin(startRad);
                          const x2 = cx + r * Math.cos(endRad), y2 = cy + r * Math.sin(endRad);
                          const largeArc = angle > 180 ? 1 : 0;
                          const path = `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`;
                          return <path key={i} d={path} fill={PIE_COLORS[i % PIE_COLORS.length]} opacity="0.85" />;
                        });
                        return (
                          <>
                            <svg viewBox="0 0 140 140" className="w-32 h-32">{slices}</svg>
                            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-3">
                              {ga4Devices.map((d, i) => (
                                <span key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                                  <span className="capitalize">{d.device}</span>
                                  <span className="text-zinc-500">{d.percentage}%</span>
                                </span>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Top Pages */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">Top Pages</h3>
                <div className="space-y-1 max-h-[350px] overflow-y-auto">
                  {ga4Pages.slice(0, 15).map((p, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-zinc-800/50">
                      <span className="text-[11px] text-zinc-500 w-5 text-right">{i + 1}</span>
                      <span className="text-xs text-zinc-300 flex-1 truncate font-mono">{p.path}</span>
                      <span className="text-xs text-teal-400 font-medium tabular-nums">{p.pageviews.toLocaleString()}</span>
                      <span className="text-[11px] text-zinc-500 w-14 text-right">{p.users.toLocaleString()} u</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Traffic Sources */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">Traffic Sources</h3>
                <div className="space-y-2">
                  {ga4Sources.slice(0, 10).map((s, i) => {
                    const totalSessions = ga4Sources.reduce((sum, x) => sum + x.sessions, 0);
                    const pct = totalSessions > 0 ? (s.sessions / totalSessions) * 100 : 0;
                    return (
                      <div key={i} className="relative">
                        <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg relative z-10">
                          <span className="text-xs text-zinc-300 flex-1 truncate">{s.source}{s.medium !== '(none)' ? ` / ${s.medium}` : ''}</span>
                          <span className="text-xs text-blue-400 font-medium tabular-nums">{s.sessions.toLocaleString()}</span>
                          <span className="text-[11px] text-zinc-500 w-12 text-right">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="absolute inset-0 rounded-lg bg-blue-500/5" style={{ width: `${pct}%` }} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Organic Search + New vs Returning + Landing Pages */}
            {ga4Organic && (
              <div className="mb-6">
                <OrganicInsight organic={ga4Organic} landingPages={ga4LandingPages} newVsReturning={ga4NewVsReturning} />
              </div>
            )}

            {/* ── Event Modules (Grouped) ── */}
            {(ga4Conversions.length > 0 || ga4Events.length > 0) && (() => {
              const groups = (ws.eventGroups || []).slice().sort((a, b) => a.order - b.order);
              const getEventsForModule = (moduleId: string) => {
                const source = modulePageData[moduleId] || sortedConversions;
                if (moduleId === '__ungrouped__') {
                  return source.filter((c: GA4ConversionSummary) => {
                    const cfg = ws.eventConfig?.find(ec => ec.eventName === c.eventName);
                    return !cfg?.group || !groups.find(g => g.id === cfg.group);
                  });
                }
                return source.filter((c: GA4ConversionSummary) => {
                  const cfg = ws.eventConfig?.find(ec => ec.eventName === c.eventName);
                  return cfg?.group === moduleId;
                });
              };
              const renderEventCard = (c: GA4ConversionSummary, i: number) => {
                const isSelected = ga4SelectedEvent === c.eventName;
                const pinned = isEventPinned(c.eventName);
                return (
                  <button key={i} onClick={() => loadEventTrend(c.eventName)}
                    className={`text-left rounded-xl border p-4 transition-colors ${isSelected ? 'bg-teal-500/10 border-teal-500/30' : pinned ? 'bg-teal-500/5 border-teal-500/15 hover:border-teal-500/30' : 'bg-zinc-800/30 border-zinc-800 hover:border-zinc-700'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] text-zinc-400 truncate max-w-[140px]">{eventDisplayName(c.eventName)}</span>
                      <div className="flex items-center gap-1.5">
                        {pinned && <span className="w-1.5 h-1.5 rounded-full bg-teal-400" title="Pinned" />}
                        {c.rate > 0 && <span className="text-[11px] font-medium text-emerald-400">{c.rate}%</span>}
                      </div>
                    </div>
                    <div className="text-xl font-bold text-zinc-200">{c.conversions.toLocaleString()}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">{c.users.toLocaleString()} users</div>
                  </button>
                );
              };
              const renderPageFilter = (moduleId: string, allowedPages?: string[]) => {
                const pages = allowedPages && allowedPages.length > 0
                  ? ga4Pages.filter(p => allowedPages.some(ap => p.path.includes(ap)))
                  : ga4Pages;
                const pageOptions = pages.map(p => ({ value: p.path, label: p.path }));
                return (
                  <div className="flex items-center gap-2 mb-4">
                    <SearchableSelect
                      options={pageOptions}
                      value={modulePageFilters[moduleId] || ''}
                      onChange={val => {
                        setModulePageFilters(prev => val ? { ...prev, [moduleId]: val } : (() => { const n = { ...prev }; delete n[moduleId]; return n; })());
                        if (val) fetchEventsForModule(moduleId, val);
                        else setModulePageData(prev => { const n = { ...prev }; delete n[moduleId]; return n; });
                      }}
                      placeholder="Search pages..."
                      emptyLabel="All Pages"
                      className="max-w-[240px]"
                    />
                    {modulePageLoading[moduleId] && <Loader2 className="w-3 h-3 animate-spin text-teal-400" />}
                  </div>
                );
              };
              const ungroupedEvents = getEventsForModule('__ungrouped__');
              return (
                <div className="space-y-6 mt-6">
                  {/* Render each group as a module */}
                  {groups.map(group => {
                    const groupEvents = getEventsForModule(group.id);
                    const noResults = modulePageFilters[group.id] && groupEvents.length === 0 && !modulePageLoading[group.id];
                    return (
                      <div key={group.id} className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: group.color }} />
                          <h3 className="text-sm font-semibold text-zinc-300">{group.name}</h3>
                          <span className="text-[11px] text-zinc-500 ml-auto">{groupEvents.length} events</span>
                        </div>
                        {renderPageFilter(group.id, group.allowedPages)}
                        {noResults ? (
                          <div className="text-center py-4 text-[11px] text-zinc-500">No events found for this page</div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {groupEvents.map(renderEventCard)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Ungrouped events */}
                  {(ungroupedEvents.length > 0 || modulePageFilters['__ungrouped__']) && (
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                      <h3 className="text-sm font-semibold text-zinc-300 mb-1">{groups.length > 0 ? 'Other Events' : 'Key Events'}</h3>
                      <p className="text-[11px] text-zinc-500 mb-2">{groups.length > 0 ? 'Events not assigned to a group' : 'Custom and conversion events tracked on your site'}</p>
                      {renderPageFilter('__ungrouped__')}
                      {modulePageFilters['__ungrouped__'] && ungroupedEvents.length === 0 && !modulePageLoading['__ungrouped__'] ? (
                        <div className="text-center py-4 text-[11px] text-zinc-500">No events found for this page</div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {ungroupedEvents.slice(0, 12).map(renderEventCard)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Event Trend (shown when an event is selected) */}
                  {ga4SelectedEvent && ga4EventTrend.length > 2 && (
                    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-300">{eventDisplayName(ga4SelectedEvent)}</h3>
                          <p className="text-[11px] text-zinc-500">Daily event count over the selected period</p>
                        </div>
                        <button onClick={() => { setGa4SelectedEvent(null); setGa4EventTrend([]); }} className="text-[11px] text-zinc-500 hover:text-zinc-300">Clear</button>
                      </div>
                      <svg viewBox="0 0 800 120" className="w-full h-28" preserveAspectRatio="none">
                        {(() => {
                          const maxV = Math.max(...ga4EventTrend.map(d => d.eventCount), 1);
                          const xStep = 800 / Math.max(ga4EventTrend.length - 1, 1);
                          const points = ga4EventTrend.map((d, i) => `${i * xStep},${110 - (d.eventCount / maxV) * 100}`);
                          const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' ');
                          return (<>
                            <path d={linePath} fill="none" stroke="#2dd4bf" strokeWidth="2" />
                            <path d={`${linePath} L${(ga4EventTrend.length - 1) * xStep},110 L0,110 Z`} fill="url(#evtGrad)" opacity="0.15" />
                            {ga4EventTrend.map((d, i) => (
                              <circle key={i} cx={i * xStep} cy={110 - (d.eventCount / maxV) * 100} r="2.5" fill="#2dd4bf" opacity="0.6" />
                            ))}
                            <defs><linearGradient id="evtGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2dd4bf" /><stop offset="100%" stopColor="transparent" /></linearGradient></defs>
                          </>);
                        })()}
                      </svg>
                      <div className="flex items-center justify-between mt-2 text-[11px] text-zinc-500">
                        <span>{ga4EventTrend[0]?.date}</span>
                        <span>Total: {ga4EventTrend.reduce((s, d) => s + d.eventCount, 0).toLocaleString()}</span>
                        <span>{ga4EventTrend[ga4EventTrend.length - 1]?.date}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Collapsible Event Explorer ── */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden mt-6">
              <button onClick={() => setShowExplorer(!showExplorer)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-zinc-800/30 transition-colors">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-teal-400" />
                  <span className="text-sm font-medium text-zinc-400">Event Explorer</span>
                </div>
                {showExplorer ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
              </button>
              {showExplorer && (
                <div className="px-5 pb-5">
                  <p className="text-[11px] text-zinc-500 mb-4">Break down events by page, or see which events fire on a specific page.</p>
                  <div className="flex flex-wrap items-end gap-3 mb-4">
                    <div className="flex-1 min-w-[180px]">
                      <label className="text-[11px] text-zinc-500 mb-1 block">Event Name</label>
                      <SearchableSelect
                        options={ga4Events.map(ev => ({ value: ev.eventName, label: eventDisplayName(ev.eventName) }))}
                        value={explorerEvent}
                        onChange={setExplorerEvent}
                        placeholder="Search events..."
                        emptyLabel="All events"
                        size="md"
                      />
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <label className="text-[11px] text-zinc-500 mb-1 block">Page Path (contains)</label>
                      <input value={explorerPage} onChange={e => setExplorerPage(e.target.value)}
                        placeholder="/contact, /blog, etc."
                        onKeyDown={e => e.key === 'Enter' && runExplorer(explorerEvent || undefined, explorerPage || undefined)}
                        className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500 placeholder:text-zinc-500" />
                    </div>
                    <button onClick={() => runExplorer(explorerEvent || undefined, explorerPage || undefined)}
                      className="px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium transition-colors flex items-center gap-1.5">
                      {explorerLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Explore
                    </button>
                    {explorerData.length > 0 && (
                      <button onClick={() => { setExplorerData([]); setExplorerEvent(''); setExplorerPage(''); }}
                        className="px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Clear</button>
                    )}
                  </div>
                  {explorerData.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-zinc-800">
                            <th className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider py-2 pr-3">Event</th>
                            <th className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider py-2 pr-3">Page</th>
                            <th className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider py-2 pr-3 text-right">Count</th>
                            <th className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider py-2 text-right">Users</th>
                          </tr>
                        </thead>
                        <tbody>
                          {explorerData.map((row, i) => {
                            const maxCount = explorerData[0]?.eventCount || 1;
                            const pct = (row.eventCount / maxCount) * 100;
                            return (
                              <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                                <td className="py-2 pr-3">
                                  <button onClick={() => { setExplorerEvent(row.eventName); runExplorer(row.eventName, explorerPage || undefined); }}
                                    className="text-xs text-teal-400 hover:text-teal-300">{eventDisplayName(row.eventName)}</button>
                                </td>
                                <td className="py-2 pr-3">
                                  <button onClick={() => { setExplorerPage(row.pagePath); runExplorer(explorerEvent || undefined, row.pagePath); }}
                                    className="text-xs text-zinc-300 hover:text-zinc-100 font-mono truncate max-w-[250px] block">{row.pagePath}</button>
                                </td>
                                <td className="py-2 pr-3 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <div className="w-16 h-1 rounded-full bg-zinc-800 overflow-hidden">
                                      <div className="h-full rounded-full bg-teal-500/40" style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className="text-xs text-zinc-200 tabular-nums font-medium">{row.eventCount.toLocaleString()}</span>
                                  </div>
                                </td>
                                <td className="py-2 text-right text-xs text-zinc-500 tabular-nums">{row.users.toLocaleString()}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="text-[11px] text-zinc-500 mt-2 text-right">{explorerData.length} results</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>)}
        </>)}

      {/* Floating AI Chat */}
      {(overview || audit || ga4Overview) && (<>
        {!chatOpen && (
          <button onClick={() => setChatOpen(true)}
            className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium shadow-lg shadow-teal-900/30 transition-all z-50">
            <Sparkles className="w-4 h-4" /> Insights Engine
          </button>
        )}
        {chatOpen && (
          <div className="fixed bottom-6 right-6 w-96 bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl shadow-black/40 overflow-hidden z-50 flex flex-col max-h-[500px]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
              <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-teal-400" /><span className="text-sm font-medium text-zinc-200">Insights Engine</span><span className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">by hmpsn studio</span></div>
              <div className="flex items-center gap-1">
                {chatMessages.length > 0 && (
                  <button onClick={() => { setChatSessionId(`cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`); setChatMessages([]); setShowChatHistory(false); }}
                    title="New conversation" className="text-zinc-500 hover:text-zinc-300 p-1"><Plus className="w-3.5 h-3.5" /></button>
                )}
                <button onClick={() => { setShowChatHistory(!showChatHistory); if (!showChatHistory && ws) { fetch(`/api/public/chat-sessions/${ws.id}?channel=client`).then(r => r.json()).then(d => { if (Array.isArray(d)) setChatSessions(d); }).catch(() => {}); } }}
                  title="Chat history" className={`p-1 ${showChatHistory ? 'text-teal-400' : 'text-zinc-500 hover:text-zinc-300'}`}><MessageSquare className="w-3.5 h-3.5" /></button>
                <button onClick={() => setChatOpen(false)} className="text-zinc-500 hover:text-zinc-300 p-1"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {showChatHistory ? (
                <div className="p-3 space-y-1">
                  <p className="text-[11px] text-zinc-500 mb-2">Previous conversations</p>
                  {chatSessions.length === 0 && <p className="text-[11px] text-zinc-600 italic">No past conversations yet.</p>}
                  {chatSessions.map(s => (
                    <button key={s.id} onClick={() => {
                      setChatSessionId(s.id); setShowChatHistory(false);
                      if (ws) fetch(`/api/public/chat-sessions/${ws.id}/${s.id}`).then(r => r.json()).then(d => {
                        if (d?.messages) setChatMessages(d.messages.map((m: { role: string; content: string }) => ({ role: m.role as 'user' | 'assistant', content: m.content })));
                      }).catch(() => {});
                    }} className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${s.id === chatSessionId ? 'bg-teal-500/10 border-teal-500/30 text-teal-300' : 'bg-zinc-800/50 border-zinc-800 text-zinc-300 hover:bg-zinc-800'}`}>
                      <div className="text-[11px] font-medium truncate">{s.title}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{s.messageCount} messages · {new Date(s.updatedAt).toLocaleDateString()}</div>
                    </button>
                  ))}
                </div>
              ) : (<>
              {chatMessages.length === 0 && (
                <div className="p-4 space-y-3">
                  <p className="text-xs text-zinc-500">Ask anything about your site performance:</p>
                  <div className="grid grid-cols-1 gap-2">
                    {QUICK_QUESTIONS.map((q, i) => (
                      <button key={i} onClick={() => askAi(q)} className="text-left px-3 py-2.5 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 transition-colors">
                        <MessageSquare className="w-3 h-3 text-teal-400 mb-1" />{q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chatMessages.length > 0 && (
                <div className="p-4 space-y-4">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                      {msg.role === 'assistant' && <div className="w-6 h-6 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0 mt-0.5"><Sparkles className="w-3 h-3 text-teal-400" /></div>}
                      <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${msg.role === 'user' ? 'bg-teal-600/20 border border-teal-500/20 text-xs text-zinc-200' : 'bg-zinc-800/50 border border-zinc-800'}`}>
                        {msg.role === 'assistant' ? <RenderMarkdown text={msg.content} /> : msg.content}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex gap-3"><div className="w-6 h-6 rounded-lg bg-teal-500/10 flex items-center justify-center"><Loader2 className="w-3 h-3 text-teal-400 animate-spin" /></div>
                      <div className="bg-zinc-800/50 border border-zinc-800 rounded-xl px-3.5 py-2.5"><div className="flex gap-1"><div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" /><div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} /><div className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} /></div></div>
                    </div>
                  )}
                  {/* Show quick questions as follow-ups after proactive greeting */}
                  {chatMessages.length === 1 && chatMessages[0].role === 'assistant' && !chatLoading && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Ask a follow-up</p>
                      {QUICK_QUESTIONS.slice(0, 3).map((q, i) => (
                        <button key={i} onClick={() => askAi(q)} className="w-full text-left px-3 py-2 rounded-lg bg-zinc-800/30 hover:bg-zinc-800/60 border border-zinc-800/50 text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors">
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
              </>)}
            </div>
            <div className="px-4 py-3 border-t border-zinc-800 flex gap-2 flex-shrink-0">
              <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && askAi(chatInput)}
                placeholder="Ask about your site data..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" disabled={chatLoading} />
              <button onClick={() => askAi(chatInput)} disabled={chatLoading || !chatInput.trim()} className="px-3 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg transition-colors"><Send className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}
      </>)}

        {/* ════════════ APPROVALS TAB ════════════ */}
        {tab === 'approvals' && (<>
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <ClipboardCheck className="w-5 h-5 text-teal-400" />
              <div>
                <h2 className="text-sm font-semibold text-zinc-200">SEO Change Approvals</h2>
                <p className="text-[11px] text-zinc-500 mt-0.5">Review proposed SEO changes, make edits if needed, then approve to push live.</p>
              </div>
              {pendingApprovals > 0 && (
                <span className="ml-auto px-2 py-0.5 text-[11px] font-medium rounded-full bg-teal-500/20 border border-teal-500/30 text-teal-300">
                  {pendingApprovals} pending
                </span>
              )}
            </div>

            {approvalsLoading && (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-teal-400" /></div>
            )}

            {!approvalsLoading && approvalBatches.length === 0 && (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4">
                  <ClipboardCheck className="w-8 h-8 text-zinc-700" />
                </div>
                <h3 className="text-sm font-medium text-zinc-400 mb-1">No pending approvals</h3>
                <p className="text-[11px] text-zinc-500">Your agency will send SEO changes here for your review.</p>
              </div>
            )}

            {approvalBatches.map(batch => {
              const batchPending = batch.items.filter(i => i.status === 'pending').length;
              const batchApproved = batch.items.filter(i => i.status === 'approved').length;
              const batchApplied = batch.items.filter(i => i.status === 'applied').length;
              const batchRejected = batch.items.filter(i => i.status === 'rejected').length;
              const isApplying = applyingBatch === batch.id;

              return (
                <div key={batch.id} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                  {/* Batch header */}
                  <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-zinc-200">{batch.name}</h3>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        {new Date(batch.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' · '}{batch.items.length} change{batch.items.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {batchPending > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">{batchPending} pending</span>}
                      {batchApproved > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-400">{batchApproved} approved</span>}
                      {batchApplied > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400">{batchApplied} applied</span>}
                      {batchRejected > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400">{batchRejected} rejected</span>}
                    </div>
                  </div>

                  {/* Items */}
                  <div className="divide-y divide-zinc-800/50">
                    {batch.items.map(item => {
                      const isEditing = editingApproval === item.id;
                      const displayValue = item.clientValue || item.proposedValue;
                      const isSchema = item.field === 'schema';
                      const fieldLabel = isSchema ? 'Structured Data (JSON-LD)' : item.field === 'seoTitle' ? 'SEO Title' : 'Meta Description';
                      const statusColors = {
                        pending: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
                        approved: 'bg-green-500/10 border-green-500/30 text-green-400',
                        rejected: 'bg-red-500/10 border-red-500/30 text-red-400',
                        applied: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
                      };

                      // Parse schema types for preview
                      let schemaTypes: string[] = [];
                      if (isSchema) {
                        try {
                          const parsed = JSON.parse(displayValue);
                          const graph = parsed?.['@graph'] as Array<{ '@type'?: string }> | undefined;
                          schemaTypes = graph?.map(n => String(n['@type'])).filter(Boolean) || [];
                        } catch { /* ignore */ }
                      }

                      return (
                        <div key={item.id} className="px-5 py-4">
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-medium text-zinc-300 truncate">{item.pageTitle}</span>
                                <span className={`text-[11px] px-1.5 py-0.5 rounded border ${statusColors[item.status]}`}>{item.status}</span>
                              </div>
                              <span className="text-[11px] text-zinc-500">/{item.pageSlug} · {fieldLabel}</span>
                              {isSchema && schemaTypes.length > 0 && (
                                <div className="flex items-center gap-1 mt-1">
                                  {schemaTypes.map(t => (
                                    <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-300">{t}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Schema preview or Current vs proposed */}
                          {isSchema ? (
                            <div className="mt-3">
                              <div className="text-[11px] text-zinc-500 mb-1">Proposed Schema</div>
                              <pre className="text-[11px] text-zinc-300 bg-zinc-800/50 rounded-lg px-3 py-2 overflow-x-auto max-h-[200px] overflow-y-auto border border-zinc-800 font-mono leading-relaxed">
                                {displayValue}
                              </pre>
                              {item.currentValue && (
                                <div className="mt-2">
                                  <div className="text-[11px] text-zinc-500 mb-1">Existing on page: {item.currentValue}</div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                              <div>
                                <div className="text-[11px] text-zinc-500 mb-1">Current</div>
                                <div className="text-[11px] text-zinc-400 bg-zinc-800/30 rounded-lg px-3 py-2 min-h-[2rem]">
                                  {item.currentValue || <span className="italic text-zinc-500">Empty</span>}
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] text-zinc-500 mb-1 flex items-center gap-1">
                                  Proposed
                                  {item.clientValue && <span className="text-teal-400">(edited by you)</span>}
                                </div>
                                {isEditing ? (
                                  <div className="space-y-2">
                                    {item.field === 'seoTitle' ? (
                                      <input
                                        type="text"
                                        value={editDraft}
                                        onChange={e => setEditDraft(e.target.value)}
                                        className="w-full px-3 py-1.5 bg-zinc-800 border border-teal-500/50 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-400"
                                      />
                                    ) : (
                                      <textarea
                                        value={editDraft}
                                        onChange={e => setEditDraft(e.target.value)}
                                        rows={2}
                                        className="w-full px-3 py-1.5 bg-zinc-800 border border-teal-500/50 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-400 resize-none"
                                      />
                                    )}
                                    <div className="flex gap-1.5">
                                      <button
                                        onClick={() => updateApprovalItem(batch.id, item.id, { clientValue: editDraft })}
                                        className="px-2.5 py-1 bg-teal-600 hover:bg-teal-500 rounded text-[11px] font-medium transition-colors"
                                      >Save Edit</button>
                                      <button
                                        onClick={() => { setEditingApproval(null); setEditDraft(''); }}
                                        className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] text-zinc-400 transition-colors"
                                      >Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-zinc-200 bg-zinc-800/30 rounded-lg px-3 py-2 min-h-[2rem]">
                                    {displayValue}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Actions */}
                          {item.status === 'pending' && !isEditing && (
                            <div className="flex items-center gap-2 mt-3">
                              <button
                                onClick={() => updateApprovalItem(batch.id, item.id, { status: 'approved' })}
                                className="flex items-center gap-1 px-3 py-1.5 bg-green-600/80 hover:bg-green-500 rounded-lg text-[11px] font-medium transition-colors"
                              >
                                <Check className="w-3 h-3" /> Approve
                              </button>
                              {!isSchema && (
                                <button
                                  onClick={() => { setEditingApproval(item.id); setEditDraft(displayValue); }}
                                  className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-[11px] font-medium text-zinc-300 transition-colors"
                                >
                                  <Edit3 className="w-3 h-3" /> Edit
                                </button>
                              )}
                              <button
                                onClick={() => updateApprovalItem(batch.id, item.id, { status: 'rejected' })}
                                className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-[11px] font-medium text-red-400 transition-colors"
                              >
                                <X className="w-3 h-3" /> Reject
                              </button>
                            </div>
                          )}
                          {item.status === 'approved' && (
                            <div className="flex items-center gap-2 mt-3 text-[11px] text-green-400">
                              <Check className="w-3 h-3" /> Approved — will be applied when you push changes live
                            </div>
                          )}
                          {item.status === 'applied' && (
                            <div className="flex items-center gap-2 mt-3 text-[11px] text-blue-400">
                              <CheckCircle2 className="w-3 h-3" /> Applied to live site
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Batch actions */}
                  {batchApproved > 0 && (
                    <div className="px-5 py-4 border-t border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
                      <span className="text-[11px] text-zinc-400">
                        {batchApproved} approved change{batchApproved !== 1 ? 's' : ''} ready to push
                      </span>
                      <button
                        onClick={() => applyApprovedBatch(batch.id)}
                        disabled={isApplying}
                        className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
                      >
                        {isApplying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        {isApplying ? 'Applying...' : 'Push Approved Changes Live'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>)}

        {/* ════════════ REQUESTS TAB ════════════ */}
        {tab === 'requests' && (<>
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MessageSquare className="w-5 h-5 text-teal-400" />
                <div>
                  <h2 className="text-sm font-semibold text-zinc-200">Requests</h2>
                  <p className="text-[11px] text-zinc-500 mt-0.5">Submit requests for your web team to action on.</p>
                </div>
              </div>
              <button onClick={() => setShowNewRequest(!showNewRequest)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-xs font-medium transition-colors">
                <Plus className="w-3.5 h-3.5" /> New Request
              </button>
            </div>

            {/* New request form */}
            {showNewRequest && (
              <div className="bg-zinc-900 rounded-xl border border-teal-500/20 p-5 space-y-4">
                <h3 className="text-xs font-semibold text-zinc-200">Submit a Request</h3>
                <div>
                  <label className="text-[11px] text-zinc-500 mb-1.5 block">Quick Templates</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Content Update', cat: 'content' as RequestCategory, title: 'Content update needed', desc: 'Page/section to update:\n\nCurrent text:\n\nNew text:' },
                      { label: 'Bug Report', cat: 'bug' as RequestCategory, title: 'Bug: ', desc: 'What happened:\n\nExpected behavior:\n\nDevice/browser:' },
                      { label: 'Design Change', cat: 'design' as RequestCategory, title: 'Design change request', desc: 'What needs to change:\n\nWhy:\n\nReference/example (if any):' },
                      { label: 'New Page', cat: 'feature' as RequestCategory, title: 'New page request', desc: 'Page purpose:\n\nTarget URL/slug:\n\nContent outline:' },
                      { label: 'SEO Update', cat: 'seo' as RequestCategory, title: 'SEO update request', desc: 'Pages affected:\n\nKeywords to target:\n\nDetails:' },
                    ].map(t => (
                      <button key={t.label} onClick={() => { setNewReqCategory(t.cat); setNewReqTitle(t.title); setNewReqDesc(t.desc); }}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 bg-zinc-800/50 transition-colors">
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-zinc-500 mb-1 block">Your Name</label>
                  <input value={newReqName} onChange={e => setNewReqName(e.target.value)}
                    placeholder="So we know who to follow up with..."
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" />
                </div>
                <div>
                  <label className="text-[11px] text-zinc-500 mb-1 block">Title</label>
                  <input value={newReqTitle} onChange={e => setNewReqTitle(e.target.value)}
                    placeholder="Brief summary of your request..."
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" />
                </div>
                <div>
                  <label className="text-[11px] text-zinc-500 mb-1 block">Description</label>
                  <textarea value={newReqDesc} onChange={e => setNewReqDesc(e.target.value)} rows={3}
                    placeholder="Describe what you need in detail..."
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[11px] text-zinc-500 mb-1 block">Category</label>
                    <select value={newReqCategory} onChange={e => setNewReqCategory(e.target.value as RequestCategory)}
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500">
                      <option value="content">Content Update</option>
                      <option value="design">Design Change</option>
                      <option value="bug">Bug Report</option>
                      <option value="seo">SEO</option>
                      <option value="feature">New Feature</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-zinc-500 mb-1 block">Related Page URL <span className="text-zinc-500">(optional)</span></label>
                    <input value={newReqPage} onChange={e => setNewReqPage(e.target.value)}
                      placeholder="/about or full URL..."
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-zinc-500 mb-1 block">Attachments <span className="text-zinc-500">(optional — screenshots, docs)</span></label>
                  <input type="file" ref={newReqFileRef} className="hidden" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv"
                    onChange={e => { if (e.target.files) setNewReqFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
                  <button onClick={() => newReqFileRef.current?.click()} type="button"
                    className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors">
                    <Paperclip className="w-3.5 h-3.5" /> Attach Files
                  </button>
                  {newReqFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {newReqFiles.map((f, i) => (
                        <span key={i} className="flex items-center gap-1 text-[11px] bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300">
                          <Paperclip className="w-2.5 h-2.5" />{f.name}
                          <button onClick={() => setNewReqFiles(prev => prev.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-zinc-300"><X className="w-2.5 h-2.5" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={submitRequest} disabled={submittingReq || !newReqTitle.trim() || !newReqDesc.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors">
                    {submittingReq ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    {submittingReq ? 'Submitting...' : 'Submit Request'}
                  </button>
                  <button onClick={() => setShowNewRequest(false)}
                    className="px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
                </div>
              </div>
            )}

            {/* Loading */}
            {requestsLoading && (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
            )}

            {/* Empty state */}
            {!requestsLoading && requests.length === 0 && !showNewRequest && (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4">
                  <MessageSquare className="w-8 h-8 text-zinc-700" />
                </div>
                <h3 className="text-sm font-medium text-zinc-400 mb-1">Need something? We're here to help</h3>
                <p className="text-[11px] text-zinc-500 mb-4">Report a bug, request a design change, or suggest an improvement — your team will get right on it.</p>
                <button onClick={() => setShowNewRequest(true)}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-500 rounded-lg text-xs font-medium transition-colors">
                  <Plus className="w-3.5 h-3.5 inline mr-1" /> Create Your First Request
                </button>
              </div>
            )}

            {/* Request list */}
            {!requestsLoading && requests.length > 0 && (
              <div className="space-y-3">
                {requests.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).map(req => {
                  const isExpanded = expandedRequest === req.id;
                  const statusColors: Record<string, string> = {
                    new: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
                    in_review: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
                    in_progress: 'bg-teal-500/10 border-teal-500/30 text-teal-400',
                    on_hold: 'bg-zinc-500/10 border-zinc-600 text-zinc-400',
                    completed: 'bg-green-500/10 border-green-500/30 text-green-400',
                    closed: 'bg-zinc-500/10 border-zinc-600 text-zinc-500',
                  };
                  const statusLabels: Record<string, string> = {
                    new: 'New', in_review: 'In Review', in_progress: 'In Progress',
                    on_hold: 'On Hold', completed: 'Completed', closed: 'Closed',
                  };
                  const catLabels: Record<string, string> = {
                    bug: 'Bug', content: 'Content', design: 'Design',
                    seo: 'SEO', feature: 'Feature', other: 'Other',
                  };
                  const teamNotes = req.notes.filter(n => n.author === 'team').length;
                  return (
                    <div key={req.id} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                      <button onClick={() => { setExpandedRequest(isExpanded ? null : req.id); setReqNoteInput(''); }}
                        className="w-full px-5 py-4 text-left hover:bg-zinc-800/30 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-zinc-200 truncate">{req.title}</span>
                              <span className={`text-[11px] px-1.5 py-0.5 rounded border shrink-0 ${statusColors[req.status] || statusColors.new}`}>
                                {statusLabels[req.status] || req.status}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                              <span className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">{catLabels[req.category] || req.category}</span>
                              {req.submittedBy && <span className="text-zinc-400">by {req.submittedBy}</span>}
                              <span>{new Date(req.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              {teamNotes > 0 && <span className="text-teal-400">{teamNotes} team note{teamNotes !== 1 ? 's' : ''}</span>}
                              {req.pageUrl && <span className="text-zinc-500 truncate max-w-[150px]">{req.pageUrl}</span>}
                            </div>
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-zinc-800">
                          {/* Description */}
                          <div className="px-5 py-4">
                            <div className="text-[11px] text-zinc-500 mb-1">Description</div>
                            <p className="text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap">{req.description}</p>
                          </div>

                          {/* Notes / conversation */}
                          {req.notes.length > 0 && (
                            <div className="px-5 pb-3">
                              <div className="text-[11px] text-zinc-500 mb-2">Conversation</div>
                              <div className="space-y-2">
                                {req.notes.map(note => (
                                  <div key={note.id} className={`flex gap-2 ${note.author === 'client' ? 'justify-end' : ''}`}>
                                    <div className={`max-w-[80%] rounded-lg px-3 py-2 ${
                                      note.author === 'team'
                                        ? 'bg-teal-500/10 border border-teal-500/20'
                                        : 'bg-zinc-800/50 border border-zinc-700'
                                    }`}>
                                      <div className="flex items-center gap-1.5 mb-0.5">
                                        <span className={`text-[11px] font-medium ${note.author === 'team' ? 'text-teal-400' : 'text-zinc-400'}`}>
                                          {note.author === 'team' ? 'Web Team' : 'You'}
                                        </span>
                                        <span className="text-[11px] text-zinc-500">
                                          {new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                        </span>
                                      </div>
                                      {note.content && <p className="text-[11px] text-zinc-300 whitespace-pre-wrap">{note.content}</p>}
                                      {note.attachments && note.attachments.length > 0 && (
                                        <div className="mt-1.5 space-y-1">
                                          {note.attachments.map(att => (
                                            att.mimeType.startsWith('image/') ? (
                                              <a key={att.id} href={`/api/request-attachments/${att.filename}`} target="_blank" rel="noreferrer" className="block">
                                                <img src={`/api/request-attachments/${att.filename}`} alt={att.originalName} className="max-w-[240px] max-h-[180px] rounded-md border border-zinc-700" />
                                              </a>
                                            ) : (
                                              <a key={att.id} href={`/api/request-attachments/${att.filename}`} target="_blank" rel="noreferrer"
                                                className="flex items-center gap-1.5 text-[11px] text-teal-400 hover:text-teal-300">
                                                <FileText className="w-3 h-3" />{att.originalName} <span className="text-zinc-500">({(att.size / 1024).toFixed(0)}KB)</span>
                                              </a>
                                            )
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Reply input */}
                          {req.status !== 'closed' && req.status !== 'completed' && (
                            <div className="px-5 py-3 border-t border-zinc-800/50 space-y-2">
                              {noteFiles.length > 0 && expandedRequest === req.id && (
                                <div className="flex flex-wrap gap-1.5">
                                  {noteFiles.map((f, i) => (
                                    <span key={i} className="flex items-center gap-1 text-[11px] bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300">
                                      <Paperclip className="w-2.5 h-2.5" />{f.name}
                                      <button onClick={() => setNoteFiles(prev => prev.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-zinc-300"><X className="w-2.5 h-2.5" /></button>
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-2">
                                <input value={expandedRequest === req.id ? reqNoteInput : ''} onChange={e => setReqNoteInput(e.target.value)}
                                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendReqNote(req.id)}
                                  placeholder="Add a note or reply..."
                                  className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" disabled={sendingNote} />
                                <input type="file" ref={noteFileRef} className="hidden" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv"
                                  onChange={e => { if (e.target.files) setNoteFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
                                <button onClick={() => noteFileRef.current?.click()} className="px-2 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors" title="Attach file">
                                  <Paperclip className="w-3.5 h-3.5 text-zinc-400" />
                                </button>
                                <button onClick={() => sendReqNote(req.id)} disabled={sendingNote || (!reqNoteInput.trim() && noteFiles.length === 0)}
                                  className="px-3 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg transition-colors">
                                  <Send className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          )}
                          {(req.status === 'completed' || req.status === 'closed') && (
                            <div className="px-5 py-3 border-t border-zinc-800/50">
                              <div className="flex items-center gap-1.5 text-[11px] text-green-400">
                                <CheckCircle2 className="w-3 h-3" /> This request has been {req.status}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>)}

      </main>

      {/* ── SEO Upgrade Modal ── */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowUpgradeModal(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 max-w-md w-full mx-4 text-center shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-7 h-7 text-teal-400" />
            </div>
            <h3 className="text-lg font-semibold text-zinc-100 mb-2">SEO Strategy — Premium Feature</h3>
            <p className="text-sm text-zinc-400 leading-relaxed mb-6">
              Unlock your full keyword strategy with page-level keyword targets, competitor gap analysis, and growth opportunities tailored to your business.
            </p>
            <div className="space-y-2 text-left mb-6">
              {['Target keywords mapped to every page', 'Competitor keyword gap analysis', 'Content opportunity recommendations', 'Ongoing strategy refinement by your web team'].map(f => (
                <div key={f} className="flex items-center gap-2 text-xs text-zinc-300">
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
                  {f}
                </div>
              ))}
            </div>
            <a href="mailto:josh@hmpsn.studio?subject=SEO%20Insights%20Upgrade&body=I'm%20interested%20in%20enabling%20SEO%20insights%20for%20my%20dashboard."
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium transition-colors">
              <Sparkles className="w-4 h-4" /> Connect With Our Team
            </a>
            <button onClick={() => setShowUpgradeModal(false)} className="block mx-auto mt-3 text-xs text-zinc-500 hover:text-zinc-400 transition-colors">
              Maybe later
            </button>
          </div>
        </div>
      )}

      {/* Pricing confirmation modal */}
      {pricingModal && (() => {
        const pricing = ws?.contentPricing;
        const isUpgrade = pricingModal.source === 'upgrade';
        const isFull = pricingModal.serviceType === 'full_post';
        const price = pricing ? (isFull ? pricing.fullPostPrice : pricing.briefPrice) : null;
        const upgradePrice = isUpgrade && pricing ? Math.max(0, pricing.fullPostPrice - pricing.briefPrice) : null;
        const displayPrice = isUpgrade ? upgradePrice : price;
        const currency = pricing?.currency || 'USD';
        const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(n);

        const briefIncludes = [
          'SEO-optimized content strategy',
          'Target keyword analysis & SERP research',
          'Detailed content outline with headings',
          'E-E-A-T guidance & content checklist',
          'Schema markup recommendations',
        ];
        const fullPostIncludes = [
          'Everything in the Content Brief',
          'Professionally written article',
          'SEO-optimized for target keywords',
          'Ready to publish on your site',
          'One round of revisions included',
        ];

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4" onClick={() => !pricingConfirming && setPricingModal(null)}>
            <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl shadow-black/40 w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className={`px-6 pt-6 pb-4 ${isFull ? 'bg-gradient-to-br from-blue-600/10 via-teal-600/10 to-transparent' : 'bg-gradient-to-br from-teal-600/10 to-transparent'}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isFull ? 'bg-gradient-to-br from-blue-500/20 to-teal-500/20' : 'bg-teal-500/20'}`}>
                    {isFull ? <Sparkles className="w-5 h-5 text-blue-400" /> : <FileText className="w-5 h-5 text-teal-400" />}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">
                      {isUpgrade ? 'Upgrade to Full Blog Post' : isFull ? (pricing?.fullPostLabel || 'Full Blog Post') : (pricing?.briefLabel || 'Content Brief')}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {isUpgrade ? 'Continue from your approved brief' : 'Confirm your content request'}
                    </div>
                  </div>
                </div>

                {/* Topic info */}
                <div className="bg-zinc-950/50 rounded-lg px-3 py-2.5 border border-zinc-800">
                  <div className="text-xs text-zinc-300 font-medium">{pricingModal.topic}</div>
                  <div className="text-[11px] text-teal-400 mt-0.5">&ldquo;{pricingModal.targetKeyword}&rdquo;</div>
                </div>
              </div>

              {/* What's included */}
              <div className="px-6 py-4 border-t border-zinc-800/50">
                <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mb-2.5">What&apos;s included</div>
                <div className="space-y-1.5">
                  {(isFull ? fullPostIncludes : briefIncludes).map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Check className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${isFull ? 'text-blue-400' : 'text-teal-400'}`} />
                      <span className="text-[11px] text-zinc-400">{item}</span>
                    </div>
                  ))}
                </div>
                {pricing && (isFull ? pricing.fullPostDescription : pricing.briefDescription) && (
                  <div className="text-[11px] text-zinc-500 mt-3 leading-relaxed">{isFull ? pricing.fullPostDescription : pricing.briefDescription}</div>
                )}
              </div>

              {/* Pricing + Actions */}
              <div className="px-6 pb-6 pt-2">
                {displayPrice != null && (
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className={`text-2xl font-bold ${isFull ? 'text-blue-300' : 'text-teal-300'}`}>{fmt(displayPrice)}</span>
                    {isUpgrade && <span className="text-[11px] text-zinc-500">upgrade difference</span>}
                    {!isUpgrade && <span className="text-[11px] text-zinc-500">one-time</span>}
                  </div>
                )}
                {displayPrice == null && (
                  <div className="text-[11px] text-zinc-500 mb-4 bg-zinc-800/50 rounded-lg px-3 py-2 border border-zinc-700/50">
                    Pricing will be confirmed by your team after submission.
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    disabled={pricingConfirming}
                    onClick={confirmPricingAndSubmit}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 shadow-lg ${isFull ? 'bg-gradient-to-r from-blue-600 to-teal-600 text-white hover:from-blue-500 hover:to-teal-500 shadow-blue-900/30' : 'bg-teal-600 text-white hover:bg-teal-500 shadow-teal-900/30'}`}
                  >
                    {pricingConfirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {pricingConfirming ? 'Submitting...' : displayPrice != null ? `Confirm & Pay ${fmt(displayPrice)}` : 'Confirm Request'}
                  </button>
                  <button
                    disabled={pricingConfirming}
                    onClick={() => setPricingModal(null)}
                    className="px-4 py-2.5 rounded-xl text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                <div className="text-center mt-3">
                  <span className="text-[11px] text-zinc-500">
                    {displayPrice != null ? 'Payment will be processed securely. You can review your invoice anytime.' : 'No charge until pricing is confirmed by your team.'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-xl border shadow-lg backdrop-blur-sm flex items-center gap-2.5 animate-[slideUp_0.3s_ease] ${toast.type === 'success' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-red-500/15 border-red-500/30 text-red-300'}`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          <span className="text-xs font-medium">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 text-zinc-400 hover:text-zinc-200"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Powered by footer */}
      <footer className="border-t border-zinc-800/50 mt-12">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-[11px] text-zinc-700">Powered by hmpsn studio</span>
          <a href="https://hmpsn.studio" target="_blank" rel="noopener noreferrer" className="text-[11px] text-zinc-700 hover:text-zinc-500 transition-colors">hmpsn.studio</a>
        </div>
      </footer>
    </div>
  );
}
