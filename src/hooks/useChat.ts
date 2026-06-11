import { useState, useRef, useCallback, useEffect } from 'react';
import { post, getOptional, ApiError } from '../api/client';
import type {
  SearchOverview, PerformanceTrend, AuditSummary, AuditDetail,
  GA4Overview, GA4ConversionSummary,
  ClientKeywordStrategy, ClientRequest, ApprovalBatch, ChatMessage,
  SearchComparison, GA4Comparison, GA4NewVsReturning, GA4OrganicOverview,
} from '../components/client/types';
import type { Tier } from '../components/ui';
import type { ClientTab } from '../routes';

/**
 * Tab values the server chat endpoint accepts as the `currentTab` hint — a
 * mirror of `CLIENT_CHAT_TAB_HINTS` in server/routes/public-analytics.ts. The
 * server validates with `z.enum(...).optional()`, so a PRESENT-but-unknown
 * value rejects the WHOLE request with a 400. This set is the two-halves
 * contract's receiving guard: send `currentTab` only when it's a known hint,
 * so a future ClientTab value not yet accepted by the server degrades to an
 * omitted hint instead of breaking chat. Keep in sync with the server enum.
 */
const CHAT_TAB_HINTS = new Set<ClientTab>([
  'overview', 'performance', 'search', 'health', 'strategy', 'analytics',
  'inbox', 'approvals', 'requests', 'content', 'plans', 'roi', 'content-plan', 'brand',
]);

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
  /** Which client dashboard tab the user is on — sent to the chat endpoint as a
   *  size-capped hint (see CHAT_TAB_HINTS). Optional: omitted when unknown. */
  currentTab?: ClientTab;
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

  const askAi = useCallback(async (question: string) => {
    const { ws, overview, ga4Overview, betaMode, days, currentTab } = deps;
    if (!question.trim() || !ws) return;
    if (!overview && !ga4Overview) return;
    setChatMessages(prev => [...prev, { role: 'user', content: question.trim() }]);
    setChatInput('');
    setChatLoading(true);
    try {
      // E4 (audit #17): grounding is assembled SERVER-SIDE. The frontend sends only
      // size-capped hints — the date-range (`days`) and the current tab (only when
      // it's a known server hint; an unknown value would 400 the request). The old
      // verbatim `context` blob was a prompt-injection surface and is gone.
      const payload: { question: string; days: number; sessionId: string; betaMode: boolean; currentTab?: ClientTab } = {
        question: question.trim(), days, sessionId: chatSessionId, betaMode,
      };
      if (currentTab && CHAT_TAB_HINTS.has(currentTab)) payload.currentTab = currentTab;
      let data: { answer?: string; error?: string; detectedIntent?: 'content_interest' | 'service_interest' | null };
      try {
        data = await post<{ answer?: string; error?: string; detectedIntent?: 'content_interest' | 'service_interest' | null }>(`/api/public/search-chat/${ws.id}`, payload);
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
  }, [deps, chatSessionId, roiValue]);

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
  };
}
