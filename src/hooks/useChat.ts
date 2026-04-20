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
  /** Intent detected from the most recent AI response — drives CTA rendering */
  lastIntent: 'content_interest' | 'service_interest' | null;
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

  /** Clear lastIntent — call after CTA is actioned so it doesn't re-appear on next render */
  clearIntent: () => void;
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
  const [chatSessionId, setChatSessionId] = useState<string>(() => `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string; messageCount: number; updatedAt: string }>>([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [chatUsage, setChatUsage] = useState<{ allowed: boolean; used: number; limit: number; remaining: number; tier: string } | null>(null);
  const [roiValue, setRoiValue] = useState<number | null>(null);
  const [lastIntent, setLastIntent] = useState<'content_interest' | 'service_interest' | null>(null);

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
        cwvSummary: auditDetail.audit.cwvSummary,
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
      let data: { answer?: string; error?: string; detectedIntent?: 'content_interest' | 'service_interest' | null };
      try {
        data = await post<{ answer?: string; error?: string; detectedIntent?: 'content_interest' | 'service_interest' | null }>(`/api/public/search-chat/${ws.id}`, { question: question.trim(), context, sessionId: chatSessionId, betaMode });
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
      setLastIntent(data.detectedIntent || null);
      if (ws) getOptional<{ allowed: boolean; used: number; limit: number; remaining: number; tier: string }>(`/api/public/chat-usage/${ws.id}`).then(d => { if (d) setChatUsage(d); }).catch((err) => { console.error('useChat operation failed:', err); });
    } catch (err) {
      console.error('useChat operation failed:', err);
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }]);
    } finally { setChatLoading(false); }
  }, [deps, buildChatContext, chatSessionId, roiValue]);

  // Build a proactive greeting from already-loaded data (zero AI cost)
  const buildProactiveGreeting = useCallback((): string => {
    const { overview, audit, ga4Overview, anomalies, strategyData, searchComparison, ga4Comparison } = deps;
    const bullets: string[] = [];

    // Anomalies first (needs attention)
    if (anomalies.length > 0) {
      const critical = anomalies.filter(a => a.severity === 'high' || a.severity === 'critical');
      if (critical.length > 0) {
        bullets.push(`⚠️ **${critical.length} alert${critical.length > 1 ? 's' : ''} need attention** — ${critical[0].title}${critical.length > 1 ? ` and ${critical.length - 1} more` : ''}.`);
      }
    }

    // Search performance with comparison
    if (overview) {
      const clicks = overview.totalClicks?.toLocaleString() ?? '—';
      const imps = overview.totalImpressions?.toLocaleString() ?? '—';
      const pos = overview.avgPosition != null ? overview.avgPosition.toFixed(1) : null;
      let searchLine = `📊 **Search:** ${clicks} clicks, ${imps} impressions`;
      if (pos) searchLine += `, avg position ${pos}`;
      if (searchComparison?.change) {
        const prev = searchComparison.previous?.clicks;
        if (prev && prev > 0) {
          const pctChange = ((searchComparison.change.clicks / prev) * 100);
          if (Math.abs(pctChange) >= 1) {
            const dir = pctChange > 0 ? '↑' : '↓';
            searchLine += ` (${dir}${Math.abs(pctChange).toFixed(0)}% vs prior period)`;
          }
        }
      }
      searchLine += '.';
      bullets.push(searchLine);
    }

    // GA4 traffic
    if (ga4Overview) {
      let ga4Line = `👥 **Traffic:** ${ga4Overview.totalUsers?.toLocaleString() ?? '—'} users, ${ga4Overview.totalSessions?.toLocaleString() ?? '—'} sessions`;
      if (ga4Comparison?.change && ga4Comparison.previous?.totalUsers && ga4Comparison.previous.totalUsers > 0) {
        const pctChange = ((ga4Comparison.change.users / ga4Comparison.previous.totalUsers) * 100);
        if (Math.abs(pctChange) >= 1) {
          const dir = pctChange > 0 ? '↑' : '↓';
          ga4Line += ` (${dir}${Math.abs(pctChange).toFixed(0)}%)`;
        }
      }
      ga4Line += '.';
      bullets.push(ga4Line);
    }

    // Site health
    if (audit) {
      const score = audit.siteScore;
      const emoji = score >= 80 ? '✅' : score >= 50 ? '⚡' : '🔴';
      let healthLine = `${emoji} **Site health:** ${score}/100`;
      if (audit.previousScore != null && audit.previousScore !== score) {
        const diff = score - audit.previousScore;
        healthLine += ` (${diff > 0 ? '+' : ''}${diff} since last audit)`;
      }
      if (audit.errors > 0) healthLine += ` — ${audit.errors} error${audit.errors > 1 ? 's' : ''} to fix`;
      healthLine += '.';
      bullets.push(healthLine);
    }

    // Strategy opportunities
    if (strategyData) {
      const gaps = strategyData.contentGaps?.length ?? 0;
      const wins = strategyData.quickWins?.length ?? 0;
      if (gaps > 0 || wins > 0) {
        const parts: string[] = [];
        if (wins > 0) parts.push(`${wins} quick win${wins > 1 ? 's' : ''}`);
        if (gaps > 0) parts.push(`${gaps} content gap${gaps > 1 ? 's' : ''}`);
        bullets.push(`💡 **Opportunities:** ${parts.join(' and ')} identified in your strategy.`);
      }
    }

    if (bullets.length === 0) {
      return "Here's your Insights Engine — ask me anything about your site performance, SEO strategy, or analytics data.";
    }

    return `Here's what's happening with your site right now:\n\n${bullets.join('\n\n')}`;
  }, [deps]);

  // Fetch chat usage and ROI data when chat opens
  useEffect(() => {
    if (chatOpen && deps.ws) {
      getOptional<{ allowed: boolean; used: number; limit: number; remaining: number; tier: string }>(`/api/public/chat-usage/${deps.ws.id}`).then(d => { if (d) setChatUsage(d); }).catch((err) => { console.error('useChat operation failed:', err); });
      // Fetch ROI for upgrade prompts (best-effort, silent fail)
      if (roiValue === null) {
        getOptional<{ organicTrafficValue?: number }>(`/api/public/roi/${deps.ws.id}`).then(d => {
          if (d?.organicTrafficValue) setRoiValue(d.organicTrafficValue);
        }).catch((err) => { console.error('useChat operation failed:', err); });
      }
    }
  }, [chatOpen, deps.ws, roiValue]);

  // Show proactive greeting when chat opens for first time (zero AI cost)
  useEffect(() => {
    const { overview, ga4Overview, ws, effectiveTier } = deps;
    if (chatOpen && chatMessages.length === 0 && !proactiveInsightSent.current && (overview || ga4Overview) && ws && effectiveTier !== 'free') {
      proactiveInsightSent.current = true;
      const greeting = buildProactiveGreeting();
      setChatMessages([{ role: 'assistant', content: greeting }]);
    }
  }, [chatOpen, deps.overview, deps.ga4Overview, deps.ws, deps.effectiveTier, chatMessages.length, buildProactiveGreeting]);

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
    lastIntent,
    clearIntent: () => setLastIntent(null),
    askAi,
    buildChatContext,
  };
}
