import { useState, useRef, useCallback, useEffect } from 'react';
import { post, getOptional, ApiError } from '../api/client';
import type {
  SearchOverview, PerformanceTrend, AuditSummary, AuditDetail,
  GA4Overview, GA4ConversionSummary,
  ClientKeywordStrategy, ClientRequest, ApprovalBatch, ChatMessage,
  SearchComparison, GA4Comparison, GA4NewVsReturning, GA4OrganicOverview,
} from '../components/client/types';
import type { Tier } from '../components/ui';

export interface ChatDeps {
  ws: { id: string; eventConfig?: Array<{ eventName: string; displayName: string; pinned: boolean; group?: string }> } | null;
  overview: SearchOverview | null;
  trend: PerformanceTrend[];
  ga4Overview: GA4Overview | null;
  ga4Pages: Array<{ path: string; pageviews: number; users: number; avgEngagementTime: number }>;
  ga4Sources: Array<{ source: string; medium: string; users: number; sessions: number }>;
  ga4Devices: Array<{ device: string; users: number; sessions: number; percentage: number }>;
  ga4Countries: Array<{ country: string; users: number; sessions: number }>;
  ga4Events: Array<{ eventName: string; eventCount: number; users: number }>;
  ga4Conversions: GA4ConversionSummary[];
  searchComparison: SearchComparison | null;
  ga4Comparison: GA4Comparison | null;
  ga4NewVsReturning: GA4NewVsReturning[];
  ga4Organic: GA4OrganicOverview | null;
  audit: AuditSummary | null;
  auditDetail: AuditDetail | null;
  strategyData: ClientKeywordStrategy | null;
  latestRanks: { query: string; position: number; clicks: number; impressions: number; ctr: number; change?: number }[];
  activityLog: { id: string; type: string; title: string; description?: string; actorName?: string; createdAt: string }[];
  annotations: { id: string; date: string; label: string; description?: string; color?: string }[];
  approvalBatches: ApprovalBatch[];
  requests: ClientRequest[];
  anomalies: Array<{ type: string; severity: string; title: string; description: string; source: string; changePct: number }>;
  days: number;
  betaMode: boolean;
  effectiveTier: Tier;
}

export interface ChatState {
  chatOpen: boolean;
  chatExpanded: boolean;
  chatMessages: ChatMessage[];
  chatInput: string;
  chatLoading: boolean;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  chatSessionId: string;
  chatSessions: Array<{ id: string; title: string; messageCount: number; updatedAt: string }>;
  showChatHistory: boolean;
  chatUsage: { allowed: boolean; used: number; limit: number; remaining: number; tier: string } | null;
  roiValue: number | null;
  proactiveInsight: string | null;
  proactiveInsightLoading: boolean;
}

export interface ChatActions {
  setChatOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setChatExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setChatInput: React.Dispatch<React.SetStateAction<string>>;
  setChatLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setChatSessionId: React.Dispatch<React.SetStateAction<string>>;
  setChatSessions: React.Dispatch<React.SetStateAction<Array<{ id: string; title: string; messageCount: number; updatedAt: string }>>>;
  setShowChatHistory: React.Dispatch<React.SetStateAction<boolean>>;
  setChatUsage: React.Dispatch<React.SetStateAction<{ allowed: boolean; used: number; limit: number; remaining: number; tier: string } | null>>;
  setProactiveInsight: React.Dispatch<React.SetStateAction<string | null>>;
  setProactiveInsightLoading: React.Dispatch<React.SetStateAction<boolean>>;
  askAi: (question: string) => Promise<void>;
  buildChatContext: () => Record<string, unknown>;
}

export function useChat(deps: ChatDeps): ChatState & ChatActions {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const proactiveInsightSent = useRef(false);
  const [proactiveInsight, setProactiveInsight] = useState<string | null>(null);
  const [proactiveInsightLoading, setProactiveInsightLoading] = useState(false);
  const inlineInsightFetched = useRef(false);
  const [chatSessionId, setChatSessionId] = useState<string>(() => `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string; messageCount: number; updatedAt: string }>>([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [chatUsage, setChatUsage] = useState<{ allowed: boolean; used: number; limit: number; remaining: number; tier: string } | null>(null);
  const [roiValue, setRoiValue] = useState<number | null>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  const buildChatContext = useCallback(() => {
    const { overview, trend, ga4Overview, ga4Pages, ga4Sources, ga4Devices, ga4Events, ga4Conversions,
      ga4Countries, searchComparison, ga4Comparison, ga4Organic, ga4NewVsReturning,
      audit, auditDetail, strategyData, latestRanks, activityLog, annotations,
      approvalBatches, requests, anomalies, days } = deps;

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
    if (anomalies.length > 0) {
      context.detectedAnomalies = anomalies.map(a => ({ type: a.type, severity: a.severity, title: a.title, description: a.description, source: a.source, changePct: a.changePct }));
    }
    return context;
  }, [deps]);

  const askAi = useCallback(async (question: string) => {
    const { ws, overview, ga4Overview, betaMode } = deps;
    if (!question.trim() || !ws) return;
    if (!overview && !ga4Overview) return;
    setChatMessages(prev => [...prev, { role: 'user', content: question.trim() }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const context = buildChatContext();
      let data: { answer?: string; error?: string };
      try {
        data = await post<{ answer?: string; error?: string }>(`/api/public/search-chat/${ws.id}`, { question: question.trim(), context, sessionId: chatSessionId, betaMode });
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) {
          const roiMsg = roiValue && roiValue > 0
            ? ` You've already identified **$${Math.round(roiValue).toLocaleString()}** in organic traffic value this month — Growth ($249/mo) pays for itself.`
            : ' Upgrade to Growth ($249/mo) for unlimited chat access.';
          setChatMessages(prev => [...prev, { role: 'assistant', content: `You've used all your free conversations this month.${roiMsg}` }]);
          setChatUsage(u => u ? { ...u, allowed: false, remaining: 0 } : u);
          setChatLoading(false);
          return;
        }
        throw err;
      }
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.error ? `Error: ${data.error}` : (data.answer ?? '') }]);
      if (ws) getOptional<{ allowed: boolean; used: number; limit: number; remaining: number; tier: string }>(`/api/public/chat-usage/${ws.id}`).then(d => { if (d) setChatUsage(d); }).catch(() => {});
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }]);
    } finally { setChatLoading(false); }
  }, [deps, buildChatContext, chatSessionId, roiValue]);

  const fetchProactiveInsight = useCallback(async () => {
    const { ws, overview, ga4Overview, betaMode } = deps;
    if (!ws || (!overview && !ga4Overview)) return;
    setChatLoading(true);
    try {
      const context = buildChatContext();
      const proactivePrompt = 'You are proactively greeting me as I open the Insights Engine. In 2-3 concise bullet points, tell me the most important things happening with my site data right now. Be specific with numbers. Highlight anything that needs attention first, then wins, then opportunities. Keep it brief and actionable. Do not ask me questions.';
      const data = await post<{ answer?: string; error?: string }>(`/api/public/search-chat/${ws.id}`, { question: proactivePrompt, context, sessionId: chatSessionId, betaMode });
      if (!data.error) {
        setChatMessages([{ role: 'assistant', content: data.answer }]);
      }
    } catch { /* silent fail — user can still ask manually */ }
    finally { setChatLoading(false); }
  }, [deps, buildChatContext, chatSessionId]);

  const fetchInlineInsight = useCallback(async () => {
    const { ws, overview, ga4Overview, betaMode } = deps;
    if (!ws || (!overview && !ga4Overview) || inlineInsightFetched.current) return;
    inlineInsightFetched.current = true;
    setProactiveInsightLoading(true);
    try {
      const context = buildChatContext();
      const prompt = 'Give me a 2-3 sentence executive summary of my site\'s current performance. Lead with the single most important trend (positive or negative), then one actionable next step. Be specific with numbers. Do not use bullet points or headers — write it as a short paragraph. Do not ask me questions.';
      const data = await post<{ answer?: string; error?: string }>(`/api/public/search-chat/${ws.id}`, { question: prompt, context, sessionId: `inline-${ws.id}`, betaMode });
      if (!data.error && data.answer) setProactiveInsight(data.answer);
    } catch { /* silent fail */ }
    finally { setProactiveInsightLoading(false); }
  }, [deps, buildChatContext]);

  // Fire inline insight after dashboard data loads (paid tiers only)
  useEffect(() => {
    const { ws, overview, ga4Overview, effectiveTier } = deps;
    if (ws && (overview || ga4Overview) && effectiveTier !== 'free' && !inlineInsightFetched.current) {
      fetchInlineInsight();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.overview, deps.ga4Overview, deps.ws]);

  // Fetch chat usage and ROI data when chat opens
  useEffect(() => {
    if (chatOpen && deps.ws) {
      getOptional<{ allowed: boolean; used: number; limit: number; remaining: number; tier: string }>(`/api/public/chat-usage/${deps.ws.id}`).then(d => { if (d) setChatUsage(d); }).catch(() => {});
      // Fetch ROI for upgrade prompts (best-effort, silent fail)
      if (roiValue === null) {
        getOptional<{ organicTrafficValue?: number }>(`/api/public/roi/${deps.ws.id}`).then(d => {
          if (d?.organicTrafficValue) setRoiValue(d.organicTrafficValue);
        }).catch(() => {});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen]);

  // Auto-fire proactive insight when chat opens for first time
  useEffect(() => {
    const { overview, ga4Overview, ws, effectiveTier } = deps;
    if (chatOpen && chatMessages.length === 0 && !proactiveInsightSent.current && (overview || ga4Overview) && ws && effectiveTier !== 'free') {
      proactiveInsightSent.current = true;
      fetchProactiveInsight();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen]);

  return {
    chatOpen, setChatOpen,
    chatExpanded, setChatExpanded,
    chatMessages, setChatMessages,
    chatInput, setChatInput,
    chatLoading, setChatLoading,
    chatEndRef,
    chatSessionId, setChatSessionId,
    chatSessions, setChatSessions,
    showChatHistory, setShowChatHistory,
    chatUsage, setChatUsage,
    roiValue,
    proactiveInsight, setProactiveInsight,
    proactiveInsightLoading, setProactiveInsightLoading,
    askAi,
    buildChatContext,
  };
}
