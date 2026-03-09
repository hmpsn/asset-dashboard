import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Loader2,
  Sparkles, Send, AlertTriangle,
  Target, Zap, Shield, MessageSquare, X,
  CheckCircle2, LineChart, Lock, Trophy, Check,
  Sun, Moon, Plus, FileText, Calendar, Clock, CreditCard,
} from 'lucide-react';
import { StripePaymentModal } from './StripePaymentForm';
import { type Tier } from './ui';
import { RenderMarkdown } from './client/helpers';
import { HealthTab } from './client/HealthTab';
import { InsightsEngine } from './client/InsightsEngine';
import { CartProvider } from './client/useCart';
import { SeoCartButton, SeoCartDrawer } from './client/SeoCart';
import { OnboardingWizard } from './client/OnboardingWizard';
import { ROIDashboard } from './client/ROIDashboard';
import { PlansTab } from './client/PlansTab';
import { StrategyTab } from './client/StrategyTab';
import { PerformanceTab } from './client/PerformanceTab';
import { InboxTab } from './client/InboxTab';
import { OverviewTab } from './client/OverviewTab';
import { ErrorBoundary } from './ErrorBoundary';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
// AnomalyAlerts removed from overview — insights digest covers trend signals
import { BetaProvider } from './client/BetaContext';
import {
  QUICK_QUESTIONS,
  type SearchOverview, type PerformanceTrend, type WorkspaceInfo, type AuditSummary,
  type AuditDetail, type ChatMessage, type GA4Overview, type GA4DailyTrend, type GA4TopPage,
  type GA4TopSource, type GA4DeviceBreakdown, type GA4CountryBreakdown, type GA4Event,
  type GA4ConversionSummary,
  type ClientContentRequest, type ClientKeywordStrategy,
  type ClientRequest, type ApprovalBatch,
  type SearchComparison, type GA4Comparison, type GA4NewVsReturning, type GA4OrganicOverview, type GA4LandingPage,
  type ClientTab,
} from './client/types';

export function ClientDashboard({ workspaceId, betaMode = false }: { workspaceId: string; betaMode?: boolean }) {
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
    if (t === 'search' || t === 'analytics') return 'performance' as ClientTab;
    if (t && ['overview','performance','health','strategy','inbox','approvals','requests','content','plans','roi'].includes(t)) return t as ClientTab;
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
  const [days, setDays] = useState(28);
  const [customDateRange, setCustomDateRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
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
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  // Individual client user auth
  const [authMode, setAuthMode] = useState<{ hasSharedPassword: boolean; hasClientUsers: boolean } | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [clientUser, setClientUser] = useState<{ id: string; name: string; email: string; role: string } | null>(null);
  const [loginTab, setLoginTab] = useState<'password' | 'user'>('user');
  const [loginView, setLoginView] = useState<'login' | 'forgot' | 'reset'>('login');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetDone, setResetDone] = useState(false);
  const [approvalBatches, setApprovalBatches] = useState<ApprovalBatch[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  // Activity log
  const [activityLog, setActivityLog] = useState<{ id: string; type: string; title: string; description?: string; actorName?: string; createdAt: string }[]>([]);
  // Rank tracking
  const [rankHistory, setRankHistory] = useState<{ date: string; positions: Record<string, number> }[]>([]);
  const [latestRanks, setLatestRanks] = useState<{ query: string; position: number; clicks: number; impressions: number; ctr: number; change?: number }[]>([]);
  // Annotations (read-only, managed from admin)
  const [annotations, setAnnotations] = useState<{ id: string; date: string; label: string; description?: string; color?: string }[]>([]);
  // Requests state
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  // Content hub state
  const [contentRequests, setContentRequests] = useState<ClientContentRequest[]>([]);
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
    pageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
    targetPageId?: string;
    targetPageSlug?: string;
  } | null>(null);
  const [pricingConfirming, setPricingConfirming] = useState(false);
  // Inline pricing data from server
  const [pricingData, setPricingData] = useState<{
    products: Record<string, { displayName: string; price: number; category: string; enabled: boolean }>;
    bundles: { id: string; name: string; monthlyPrice: number; includes: string[]; savings: string }[];
    currency: string;
    stripeEnabled: boolean;
  } | null>(null);
  // Stripe Elements inline payment modal state
  const [stripePayment, setStripePayment] = useState<{
    clientSecret: string;
    publishableKey: string;
    amount: number;
    productName: string;
    topic: string;
    targetKeyword: string;
    isFull: boolean;
  } | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  // Track data-loading errors per section for inline error indicators
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // Real-time workspace events — auto-refresh relevant sections
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

  useWorkspaceEvents(authenticated ? workspaceId : undefined, {
    'activity:new': () => refetchClient('activity', `/api/public/activity/${workspaceId}?limit=20`),
    'approval:update': () => refetchClient('approvals', `/api/public/approvals/${workspaceId}`),
    'approval:applied': () => refetchClient('approvals', `/api/public/approvals/${workspaceId}`),
    'request:created': () => refetchClient('requests', `/api/public/requests/${workspaceId}`),
    'request:update': () => refetchClient('requests', `/api/public/requests/${workspaceId}`),
    'content-request:created': () => refetchClient('content', `/api/public/content-requests/${workspaceId}`),
    'content-request:update': () => refetchClient('content', `/api/public/content-requests/${workspaceId}`),
    'audit:complete': () => {
      fetch(`/api/public/audit-summary/${workspaceId}`).then(r => r.json()).then(a => { if (a?.id) setAudit(a); }).catch(() => {});
      refetchClient('activity', `/api/public/activity/${workspaceId}?limit=20`);
    },
    'workspace:updated': () => {
      fetch(`/api/public/workspace/${workspaceId}`).then(r => r.ok ? r.json() : null).then(data => { if (data?.id) setWs(data); }).catch(() => {});
    },
  });

  // Load workspace info first (includes requiresPassword flag)
  useEffect(() => {
    setLoading(true);
    fetch(`/api/public/workspace/${workspaceId}`)
      .then(r => {
        if (r.status === 403) { setError('This dashboard is currently unavailable. Please contact your web team for access.'); setLoading(false); throw new Error('portal_disabled'); }
        return r.json();
      })
      .then(async (data: WorkspaceInfo) => {
        if (!data.id) { setError('Workspace not found'); setLoading(false); return; }
        setWs(data);
        document.title = `${data.name} — Insights Engine`;

        // Fetch auth mode (shared password vs individual accounts)
        try {
          const amRes = await fetch(`/api/public/auth-mode/${workspaceId}`);
          if (amRes.ok) {
            const am = await amRes.json();
            setAuthMode(am);
            // Default login tab: if individual accounts exist, show user login; otherwise shared password
            setLoginTab(am.hasClientUsers ? 'user' : 'password');
          }
        } catch { /* ignore */ }

        // Check if already authenticated via client user JWT cookie
        let autoAuthed = false;
        let resolvedUserId: string | undefined;
        try {
          const meRes = await fetch(`/api/public/client-me/${workspaceId}`);
          if (meRes.ok) {
            const meData = await meRes.json();
            if (meData.user) {
              setClientUser(meData.user);
              resolvedUserId = meData.user.id;
              setAuthenticated(true);
              autoAuthed = true;
              loadDashboardData(data);
            }
          }
        } catch { /* ignore */ }

        // Fall back to legacy session check
        if (!autoAuthed) {
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
        }
        setLoading(false);

        // Show welcome modal on first visit (user-aware key when logged in)
        const welcomeUserId = resolvedUserId;
        const welcomeKey = welcomeUserId ? `welcome_seen_${workspaceId}_${welcomeUserId}` : `welcome_seen_${workspaceId}`;
        if (!localStorage.getItem(welcomeKey)) {
          setShowWelcome(true);
        }

        // Detect password reset token in URL
        const params = new URLSearchParams(window.location.search);
        const urlResetToken = params.get('reset_token');
        if (urlResetToken) {
          setResetToken(urlResetToken);
          setLoginView('reset');
          // Clean up URL
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('reset_token');
          window.history.replaceState({}, '', cleanUrl.toString());
        }

        // Detect Stripe payment redirect
        const paymentStatus = params.get('payment');
        if (paymentStatus === 'success') {
          setToast({ message: 'Payment successful! Your content request is being processed.', type: 'success' });
          setTimeout(() => setToast(null), 8000);
          // Clean up URL params without reload
          const url = new URL(window.location.href);
          url.searchParams.delete('payment');
          url.searchParams.delete('session_id');
          window.history.replaceState({}, '', url.toString());
        } else if (paymentStatus === 'cancelled') {
          setToast({ message: 'Payment was cancelled. You can try again anytime.', type: 'error' });
          setTimeout(() => setToast(null), 6000);
          const url = new URL(window.location.href);
          url.searchParams.delete('payment');
          window.history.replaceState({}, '', url.toString());
        }
      })
      .catch(() => { setError('Failed to load dashboard'); setLoading(false); });
  }, [workspaceId]);


  const loadRequests = async (wsId: string) => {
    setRequestsLoading(true);
    try {
      const res = await fetch(`/api/public/requests/${wsId}`);
      const data = await res.json();
      if (Array.isArray(data)) setRequests(data);
    } catch { setSectionError('requests', 'Unable to load requests'); }
    finally { setRequestsLoading(false); }
  };


  const loadApprovals = async (wsId: string) => {
    setApprovalsLoading(true);
    try {
      const res = await fetch(`/api/public/approvals/${wsId}`);
      const data = await res.json();
      if (Array.isArray(data)) setApprovalBatches(data);
    } catch { setSectionError('approvals', 'Unable to load approvals'); }
    setApprovalsLoading(false);
  };

  const setSectionError = (key: string, msg: string) => setSectionErrors(prev => ({ ...prev, [key]: msg }));
  const clearSectionError = (key: string) => setSectionErrors(prev => { const n = { ...prev }; delete n[key]; return n; });

  const loadDashboardData = (data: WorkspaceInfo) => {
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
    // Load strategy if SEO view is enabled
    if (data.seoClientView) {
      fetch(`/api/public/seo-strategy/${data.id}`).then(r => r.ok ? r.json() : null).then(s => { if (s) setStrategyData(s); }).catch(() => setSectionError('strategy', 'Unable to load SEO strategy'));
    }
    // Load product pricing for inline price display
    fetch(`/api/public/pricing/${data.id}`).then(r => r.ok ? r.json() : null).then(p => { if (p) setPricingData(p); }).catch(() => {});
    // Load anomalies for chat context
    fetch(`/api/public/anomalies/${data.id}`).then(r => r.ok ? r.json() : []).then(a => { if (Array.isArray(a)) setAnomalies(a); }).catch(() => {});
    // Always load content requests (powers the Content tab independently)
    fetch(`/api/public/content-requests/${data.id}`).then(r => r.ok ? r.json() : []).then((reqs: ClientContentRequest[]) => {
      if (Array.isArray(reqs) && reqs.length > 0) {
        setContentRequests(reqs);
        setRequestedTopics(new Set(reqs.map(r => r.targetKeyword)));
      }
    }).catch(() => setSectionError('content', 'Unable to load content requests'));
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
      setSectionError('analytics', 'Unable to load analytics data');
    }
  };



  // Confirm pricing and execute the actual request
  const confirmPricingAndSubmit = async () => {
    if (!pricingModal) return;
    setPricingConfirming(true);
    try {
      // --- Stripe Elements inline payment (when configured) ---
      if (ws?.stripeEnabled) {
        // First, create the content request so we have an ID to link the payment to
        let contentRequestId: string | undefined;
        if (pricingModal.source === 'upgrade' && pricingModal.upgradeReqId) {
          contentRequestId = pricingModal.upgradeReqId;
        } else if (pricingModal.source === 'strategy') {
          const res = await fetch(`/api/public/content-request/${workspaceId}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, intent: pricingModal.intent, priority: pricingModal.priority, rationale: pricingModal.rationale, serviceType: pricingModal.serviceType, pageType: pricingModal.pageType || 'blog', initialStatus: 'pending_payment', targetPageId: pricingModal.targetPageId, targetPageSlug: pricingModal.targetPageSlug }),
          });
          if (!res.ok) throw new Error(`Server returned ${res.status}`);
          const created = await res.json();
          contentRequestId = created.id;
        } else {
          const res = await fetch(`/api/public/content-request/${workspaceId}/submit`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, notes: pricingModal.notes || undefined, serviceType: pricingModal.serviceType, pageType: pricingModal.pageType || 'blog', initialStatus: 'pending_payment', targetPageId: pricingModal.targetPageId, targetPageSlug: pricingModal.targetPageSlug }),
          });
          if (!res.ok) throw new Error(`Server returned ${res.status}`);
          const created = await res.json();
          contentRequestId = created.id;
        }

        // Map serviceType to Stripe product type
        const productType = pricingModal.serviceType === 'full_post' ? 'post_polished' : 'brief_blog';

        // Fetch publishable key
        const pkRes = await fetch('/api/stripe/publishable-key');
        const { publishableKey } = await pkRes.json();

        if (publishableKey) {
          // Use Stripe Elements inline payment form
          const piRes = await fetch('/api/stripe/create-payment-intent', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId, productType, contentRequestId, topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword }),
          });
          if (!piRes.ok) {
            const err = await piRes.json().catch(() => ({ error: 'Payment failed' }));
            throw new Error(err.error || 'Failed to create payment');
          }
          const { clientSecret, amount } = await piRes.json();
          const isFull = pricingModal.serviceType === 'full_post';
          const productName = isFull ? (ws?.contentPricing?.fullPostLabel || 'Full Blog Post') : (ws?.contentPricing?.briefLabel || 'Content Brief');

          // Close pricing modal and open Stripe payment modal
          setPricingModal(null);
          setPricingConfirming(false);
          setStripePayment({ clientSecret, publishableKey, amount, productName, topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, isFull });
          return;
        }

        // Fallback to Stripe Checkout redirect if no publishable key
        const checkoutRes = await fetch('/api/stripe/create-checkout', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, productType, contentRequestId, topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword }),
        });
        if (!checkoutRes.ok) {
          const err = await checkoutRes.json().catch(() => ({ error: 'Checkout failed' }));
          throw new Error(err.error || 'Failed to create checkout session');
        }
        const { url } = await checkoutRes.json();
        if (url) {
          window.location.href = url;
          return;
        }
      }

      // --- Fallback: direct submit (no Stripe) ---
      if (pricingModal.source === 'upgrade' && pricingModal.upgradeReqId) {
        const upRes = await fetch(`/api/public/content-request/${workspaceId}/${pricingModal.upgradeReqId}/upgrade`, { method: 'POST' });
        if (upRes.ok) {
          const updated = await upRes.json();
          setContentRequests(prev => prev.map(r => r.id === pricingModal.upgradeReqId ? updated : r));
          setToast({ message: 'Upgraded to full blog post! Your team will begin writing.', type: 'success' });
          setTimeout(() => setToast(null), 5000);
        }
      } else if (pricingModal.source === 'strategy') {
        setRequestingTopic(pricingModal.targetKeyword);
        const res = await fetch(`/api/public/content-request/${workspaceId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, intent: pricingModal.intent, priority: pricingModal.priority, rationale: pricingModal.rationale, serviceType: pricingModal.serviceType, pageType: pricingModal.pageType || 'blog', targetPageId: pricingModal.targetPageId, targetPageSlug: pricingModal.targetPageSlug }),
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
        const res = await fetch(`/api/public/content-request/${workspaceId}/submit`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: pricingModal.topic, targetKeyword: pricingModal.targetKeyword, notes: pricingModal.notes || undefined, serviceType: pricingModal.serviceType, pageType: pricingModal.pageType || 'blog', targetPageId: pricingModal.targetPageId, targetPageSlug: pricingModal.targetPageSlug }),
        });
        if (res.ok) {
          const created = await res.json();
          setContentRequests(prev => [created, ...prev]);
          setRequestedTopics(prev => new Set(prev).add(created.targetKeyword));
          setToast({ message: 'Topic submitted! Your team will review it.', type: 'success' });
          setTimeout(() => setToast(null), 5000);
        }
      }
    } catch (err) {
      console.error('Content request failed:', err);
      setToast({ message: err instanceof Error ? err.message : 'Failed to submit request. Please try again.', type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
    setPricingConfirming(false);
    setPricingModal(null);
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

  const handleClientUserLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!loginEmail.trim() || !loginPassword.trim()) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch(`/api/public/client-login/${workspaceId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setClientUser(data.user);
        setAuthenticated(true);
        sessionStorage.setItem(`dash_auth_${workspaceId}`, 'true');
        if (ws) loadDashboardData(ws);
      } else {
        const err = await res.json();
        setAuthError(err.error || 'Invalid email or password');
      }
    } catch {
      setAuthError('Authentication failed');
    } finally { setAuthLoading(false); }
  };

  const handleClientLogout = async () => {
    try {
      await fetch(`/api/public/client-logout/${workspaceId}`, { method: 'POST' });
    } catch { /* ignore */ }
    setClientUser(null);
    setAuthenticated(false);
    sessionStorage.removeItem(`dash_auth_${workspaceId}`);
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
      const [ovData, trData, cmpData] = await Promise.all([ovRes.json(), trRes.json(), cmpRes.json(), devRes.json()]);
      if (ovData.error) throw new Error(ovData.error);
      setOverview(ovData);
      setTrend(Array.isArray(trData) ? trData : []);
      if (cmpData && !cmpData.error) setSearchComparison(cmpData);
      // searchDevices handled by SearchTab
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
    if (anomalies.length > 0) {
      context.detectedAnomalies = anomalies.map(a => ({ type: a.type, severity: a.severity, title: a.title, description: a.description, source: a.source, changePct: a.changePct }));
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
        body: JSON.stringify({ question: question.trim(), context, sessionId: chatSessionId, betaMode }),
      });
      const data = await res.json();
      if (res.status === 429) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: `You've used all your free conversations this month. Upgrade to Growth for unlimited chat access.` }]);
        setChatUsage(u => u ? { ...u, allowed: false, remaining: 0 } : u);
      } else {
        setChatMessages(prev => [...prev, { role: 'assistant', content: data.error ? `Error: ${data.error}` : data.answer }]);
      }
      // Refresh usage counter
      if (ws) fetch(`/api/public/chat-usage/${ws.id}`).then(r => r.json()).then(d => setChatUsage(d)).catch(() => {});
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
        body: JSON.stringify({ question: proactivePrompt, context, sessionId: chatSessionId, betaMode }),
      });
      const data = await res.json();
      if (!data.error) {
        setChatMessages([{ role: 'assistant', content: data.answer }]);
      }
    } catch { /* silent fail — user can still ask manually */ }
    finally { setChatLoading(false); }
  };

  // Fetch inline AI insight for the Overview tab hero card (separate from chat greeting)
  const fetchInlineInsight = async () => {
    if (!ws || (!overview && !ga4Overview) || inlineInsightFetched.current) return;
    inlineInsightFetched.current = true;
    setProactiveInsightLoading(true);
    try {
      const context = buildChatContext();
      const prompt = 'Give me a 2-3 sentence executive summary of my site\'s current performance. Lead with the single most important trend (positive or negative), then one actionable next step. Be specific with numbers. Do not use bullet points or headers — write it as a short paragraph. Do not ask me questions.';
      const res = await fetch(`/api/public/search-chat/${ws.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: prompt, context, sessionId: `inline-${ws.id}`, betaMode }),
      });
      const data = await res.json();
      if (!data.error && data.answer) setProactiveInsight(data.answer);
    } catch { /* silent fail */ }
    finally { setProactiveInsightLoading(false); }
  };

  // Fire inline insight after dashboard data loads (paid tiers only)
  useEffect(() => {
    if (ws && (overview || ga4Overview) && effectiveTier !== 'free' && !inlineInsightFetched.current) {
      fetchInlineInsight();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview, ga4Overview, ws]);

  // Fetch chat usage when chat opens
  useEffect(() => {
    if (chatOpen && ws) {
      fetch(`/api/public/chat-usage/${ws.id}`).then(r => r.json()).then(d => setChatUsage(d)).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen]);

  // Auto-fire proactive insight when chat opens for first time (skip on free tier — saves tokens + creates upgrade incentive)
  useEffect(() => {
    if (chatOpen && chatMessages.length === 0 && !proactiveInsightSent.current && (overview || ga4Overview) && ws && effectiveTier !== 'free') {
      proactiveInsightSent.current = true;
      fetchProactiveInsight();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen]);


  const eventDisplayName = (eventName: string): string => {
    const cfg = ws?.eventConfig?.find(c => c.eventName === eventName);
    return cfg?.displayName && cfg.displayName !== eventName ? cfg.displayName : eventName.replace(/_/g, ' ');
  };
  const isEventPinned = (eventName: string): boolean => {
    return ws?.eventConfig?.find(c => c.eventName === eventName)?.pinned || false;
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

  // Password gate — smart login with auth mode detection
  const showsUserLogin = authMode?.hasClientUsers;
  const showsPasswordLogin = authMode?.hasSharedPassword && !authMode?.hasClientUsers;
  const showsBothModes = authMode?.hasSharedPassword && authMode?.hasClientUsers;

  if ((ws.requiresPassword || showsUserLogin) && !authenticated) return (
    <div className="min-h-screen bg-[#0f1219] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-8 shadow-2xl shadow-black/40">
          <div className="flex flex-col items-center mb-6">
            <img src="/logo.svg" alt="hmpsn studio" className="h-7 opacity-60 mb-4" />
            <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-teal-400" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-200">{ws.name}</h2>
            <p className="text-xs text-zinc-500 mt-1">
              {loginTab === 'user' ? 'Sign in with your account' : 'Enter the password to access this dashboard'}
            </p>
          </div>

          {/* Tab toggle when both modes are available */}
          {showsBothModes && (
            <div className="flex items-center gap-1 mb-5 bg-zinc-800 rounded-xl p-1">
              <button onClick={() => { setLoginTab('user'); setAuthError(''); }}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${loginTab === 'user' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-400'}`}>
                Email Login
              </button>
              <button onClick={() => { setLoginTab('password'); setAuthError(''); }}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${loginTab === 'password' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-400'}`}>
                Shared Password
              </button>
            </div>
          )}

          {/* Individual user login / forgot / reset form */}
          {(loginTab === 'user' && (showsUserLogin || showsBothModes)) ? (
            loginView === 'forgot' ? (
              // Forgot password form
              <div className="space-y-3">
                {forgotSent ? (
                  <>
                    <div className="bg-teal-500/10 border border-teal-500/20 rounded-xl p-4 text-center">
                      <p className="text-sm text-teal-400 font-medium">Check your email</p>
                      <p className="text-xs text-zinc-400 mt-1">If an account exists with that email, we've sent a password reset link.</p>
                    </div>
                    <button onClick={() => { setLoginView('login'); setForgotSent(false); setForgotEmail(''); setAuthError(''); }}
                      className="w-full py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-all">
                      Back to Sign In
                    </button>
                  </>
                ) : (
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    if (!forgotEmail.trim()) return;
                    setAuthLoading(true); setAuthError('');
                    try {
                      const res = await fetch(`/api/public/forgot-password/${workspaceId}`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: forgotEmail.trim() }),
                      });
                      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
                      setForgotSent(true);
                    } catch (err) { setAuthError(err instanceof Error ? err.message : 'Something went wrong'); }
                    setAuthLoading(false);
                  }} className="space-y-3">
                    <p className="text-xs text-zinc-400 text-center">Enter your email and we'll send you a link to reset your password.</p>
                    <input type="email" value={forgotEmail} onChange={e => { setForgotEmail(e.target.value); setAuthError(''); }}
                      placeholder="Email address" autoFocus
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors" />
                    {authError && <p className="text-xs text-red-400">{authError}</p>}
                    <button type="submit" disabled={authLoading || !forgotEmail.trim()}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2">
                      {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send Reset Link'}
                    </button>
                    <button type="button" onClick={() => { setLoginView('login'); setAuthError(''); }}
                      className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-400 transition-colors">
                      Back to Sign In
                    </button>
                  </form>
                )}
              </div>
            ) : loginView === 'reset' ? (
              // Reset password form (arrived via email link)
              <div className="space-y-3">
                {resetDone ? (
                  <>
                    <div className="bg-teal-500/10 border border-teal-500/20 rounded-xl p-4 text-center">
                      <p className="text-sm text-teal-400 font-medium">Password updated!</p>
                      <p className="text-xs text-zinc-400 mt-1">You can now sign in with your new password.</p>
                    </div>
                    <button onClick={() => { setLoginView('login'); setResetDone(false); setResetPassword(''); setResetConfirm(''); setAuthError(''); }}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium transition-all">
                      Sign In
                    </button>
                  </>
                ) : (
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    if (resetPassword !== resetConfirm) { setAuthError('Passwords do not match'); return; }
                    if (resetPassword.length < 8) { setAuthError('Password must be at least 8 characters'); return; }
                    setAuthLoading(true); setAuthError('');
                    try {
                      const res = await fetch('/api/public/reset-password', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: resetToken, newPassword: resetPassword }),
                      });
                      const d = await res.json();
                      if (!res.ok) throw new Error(d.error || 'Failed');
                      setResetDone(true);
                    } catch (err) { setAuthError(err instanceof Error ? err.message : 'Something went wrong'); }
                    setAuthLoading(false);
                  }} className="space-y-3">
                    <p className="text-xs text-zinc-400 text-center">Choose a new password for your account.</p>
                    <input type="password" value={resetPassword} onChange={e => { setResetPassword(e.target.value); setAuthError(''); }}
                      placeholder="New password" autoFocus
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors" />
                    <input type="password" value={resetConfirm} onChange={e => { setResetConfirm(e.target.value); setAuthError(''); }}
                      placeholder="Confirm new password"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors" />
                    {authError && <p className="text-xs text-red-400">{authError}</p>}
                    <button type="submit" disabled={authLoading || !resetPassword || !resetConfirm}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2">
                      {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Set New Password'}
                    </button>
                  </form>
                )}
              </div>
            ) : (
            // Normal login form
            <form onSubmit={handleClientUserLogin} className="space-y-3">
              <div>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={e => { setLoginEmail(e.target.value); setAuthError(''); }}
                  placeholder="Email address"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                  autoFocus
                />
              </div>
              <div>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={e => { setLoginPassword(e.target.value); setAuthError(''); }}
                  placeholder="Password"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                />
              </div>
              {authError && <p className="text-xs text-red-400">{authError}</p>}
              <button
                type="submit"
                disabled={authLoading || !loginEmail.trim() || !loginPassword.trim()}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
              >
                {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sign In'}
              </button>
              <button type="button" onClick={() => { setLoginView('forgot'); setAuthError(''); }}
                className="w-full py-1 text-xs text-zinc-500 hover:text-zinc-400 transition-colors">
                Forgot your password?
              </button>
            </form>
            )
          ) : (
            /* Shared password form */
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={e => { setPasswordInput(e.target.value); setAuthError(''); }}
                  placeholder="Dashboard password"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                  autoFocus={loginTab === 'password' || showsPasswordLogin}
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
          )}
        </div>
      </div>
    </div>
  );

  const insights = getInsights();


  const pendingApprovals = approvalBatches.reduce((sum, b) => sum + b.items.filter(i => i.status === 'pending').length, 0);
  const unreadTeamNotes = requests.filter(r => r.notes.length > 0 && r.notes[r.notes.length - 1].author === 'team' && r.status !== 'completed' && r.status !== 'closed').length;

  const effectiveTier: Tier = betaMode ? 'premium' : ((ws?.tier as Tier) || 'free');
  // Inline price helpers — prefer pricingData (from Stripe config), fall back to ws.contentPricing
  const pCurrency = pricingData?.currency || ws?.contentPricing?.currency || 'USD';
  const fmtPrice = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: pCurrency, minimumFractionDigits: 0 }).format(n);
  const briefPrice = pricingData?.products?.brief_blog?.price ?? ws?.contentPricing?.briefPrice ?? null;
  const fullPostPrice = pricingData?.products?.post_polished?.price ?? ws?.contentPricing?.fullPostPrice ?? null;
  const strategyLocked = effectiveTier === 'free' || !ws?.seoClientView;
  const isPaid = effectiveTier !== 'free';
  const NAV = [
    { id: 'overview' as ClientTab, label: 'Insights', icon: Sparkles, locked: false },
    ...(isPaid ? [{ id: 'strategy' as ClientTab, label: 'SEO Strategy', icon: Target, locked: strategyLocked }] : []),
    { id: 'health' as ClientTab, label: 'Site Health', icon: Shield, locked: false },
    ...(ws?.analyticsClientView !== false ? [
      { id: 'performance' as ClientTab, label: 'Performance', icon: LineChart, locked: false },
    ] : []),
    ...(isPaid ? [{ id: 'inbox' as ClientTab, label: 'Inbox', icon: Zap, locked: false }] : []),
    ...(!betaMode ? [{ id: 'plans' as ClientTab, label: 'Plans', icon: CreditCard, locked: false }] : []),
    ...(isPaid && !betaMode ? [{ id: 'roi' as ClientTab, label: 'ROI', icon: Trophy, locked: false }] : []),
  ];

  return (
    <BetaProvider value={betaMode}>
    <CartProvider>
    <div className={`min-h-screen bg-[#0f1219] text-zinc-200 ${theme === 'light' ? 'dashboard-light' : ''}`}>
      {!betaMode && <SeoCartDrawer workspaceId={workspaceId} tier={effectiveTier} />}
      {/* Header */}
      <header className="border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/logo.svg" alt="hmpsn studio" className="h-8 opacity-80" style={theme === 'light' ? { filter: 'invert(1) brightness(0.3)' } : undefined} />
            <div className="w-px h-8 bg-zinc-800" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold">{ws.name}</h1>
                {!betaMode && ws.isTrial && (
                  <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                    Growth Trial{ws.trialDaysRemaining ? ` · ${ws.trialDaysRemaining}d` : ''}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">Insights Engine{(overview || audit || ga4Overview) && <span className="ml-2 text-zinc-500">· Updated {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Client user menu */}
            {clientUser && (
              <div className="flex items-center gap-2 pr-2 border-r border-zinc-800">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center text-white text-[10px] font-bold">
                  {clientUser.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <span className="text-xs text-zinc-400 hidden sm:block">{clientUser.name}</span>
                <button onClick={handleClientLogout} title="Sign out"
                  className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                </button>
              </div>
            )}
            {!betaMode && <SeoCartButton />}
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
                <button onClick={() => effectiveTier !== 'free' && setShowDatePicker(p => !p)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${effectiveTier === 'free' ? 'text-zinc-600 cursor-not-allowed' : customDateRange ? 'bg-teal-600/20 text-teal-300 border border-teal-500/30' : 'text-zinc-500 hover:text-zinc-300'}`}
                  title={effectiveTier === 'free' ? 'Upgrade to Growth for custom date ranges' : 'Custom date range'}
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
                (t.id === 'performance' && !!(overview || ga4Overview)) ||
                (t.id === 'health' && !!audit) ||
                (t.id === 'inbox');
              const pendingReviews = contentRequests.filter(r => r.status === 'client_review').length;
              return (
                <button key={t.id} onClick={() => t.locked ? setShowUpgradeModal(true) : setTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                    t.locked ? 'border-transparent text-zinc-500 cursor-default' :
                    active ? 'border-teal-500 text-teal-300' :
                    'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                  }`}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                  {t.locked && <Lock className="w-3 h-3 ml-0.5 text-zinc-500" />}
                  {t.id === 'inbox' && (pendingApprovals + pendingReviews + unreadTeamNotes) > 0 && <span className="ml-1 px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-teal-500 text-white flex-shrink-0 min-w-[20px] text-center leading-tight">{pendingApprovals + pendingReviews + unreadTeamNotes}</span>}
                  {!t.locked && hasData && !active && t.id !== 'inbox' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-5">

        {/* Trial countdown banner — shows at day 10 and under */}
        {!betaMode && ws.isTrial && (ws.trialDaysRemaining ?? 0) <= 10 && (ws.trialDaysRemaining ?? 0) > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-sm text-amber-300">
              <strong>{ws.trialDaysRemaining} day{ws.trialDaysRemaining === 1 ? '' : 's'}</strong> left on your Growth trial.
              {' '}Upgrade to keep access to all features.
            </p>
          </div>
        )}
        {!betaMode && ws.isTrial && (ws.trialDaysRemaining ?? 0) === 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <Clock className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-300">
              Your Growth trial has ended. Some features are now limited.
              {' '}Upgrade to restore full access.
            </p>
          </div>
        )}

        {/* Section loading errors */}
        {Object.keys(sectionErrors).length > 0 && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/8 border border-red-500/15">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-300 space-y-0.5">
              {Object.values(sectionErrors).map((msg, i) => <p key={i}>{msg} — try refreshing the page.</p>)}
            </div>
          </div>
        )}

        {/* ════════════ OVERVIEW TAB ════════════ */}
        {tab === 'overview' && (
          <OverviewTab ws={ws!} overview={overview} searchComparison={searchComparison} trend={trend} ga4Overview={ga4Overview} ga4Trend={ga4Trend} ga4Comparison={ga4Comparison} ga4Organic={ga4Organic} ga4Conversions={ga4Conversions} ga4NewVsReturning={ga4NewVsReturning} audit={audit} auditDetail={auditDetail} strategyData={strategyData} insights={insights} contentRequests={contentRequests} requests={requests} approvalBatches={approvalBatches} activityLog={activityLog} pendingApprovals={pendingApprovals} unreadTeamNotes={unreadTeamNotes} eventDisplayName={eventDisplayName} isEventPinned={isEventPinned} setTab={setTab} onAskAi={askAi} onOpenChat={() => setChatOpen(true)} clientUser={clientUser} proactiveInsight={proactiveInsight} proactiveInsightLoading={proactiveInsightLoading} />
        )}

        {/* ════════════ PERFORMANCE TAB (Search + Analytics) ════════════ */}
        {tab === 'performance' && (
          <PerformanceTab overview={overview} searchComparison={searchComparison} trend={trend} annotations={annotations} rankHistory={rankHistory} latestRanks={latestRanks} insights={insights} ga4Overview={ga4Overview} ga4Comparison={ga4Comparison} ga4Trend={ga4Trend} ga4Devices={ga4Devices} ga4Pages={ga4Pages} ga4Sources={ga4Sources} ga4Organic={ga4Organic} ga4LandingPages={ga4LandingPages} ga4NewVsReturning={ga4NewVsReturning} ga4Conversions={ga4Conversions} ga4Events={ga4Events} ws={ws!} days={days} />
        )}

        {/* ════════════ SITE HEALTH TAB ════════════ */}
        {tab === 'health' && (<>
          <ErrorBoundary label="Site Health">
            <HealthTab audit={audit} auditDetail={auditDetail} liveDomain={ws.liveDomain} tier={effectiveTier} workspaceId={workspaceId} initialSeverity={(() => { const s = new URLSearchParams(window.location.search).get('severity'); return s && ['error','warning','info'].includes(s) ? s as 'error' | 'warning' | 'info' : 'all'; })()} />
          </ErrorBoundary>
          {workspaceId && auditDetail && (
            <div className="mt-5">
              <ErrorBoundary label="Action Plan">
                <InsightsEngine workspaceId={workspaceId} tier={effectiveTier} />
              </ErrorBoundary>
            </div>
          )}
        </>)}

        {/* ════════════ SEO STRATEGY TAB ════════════ */}
        {tab === 'strategy' && (
          <StrategyTab strategyData={strategyData} requestedTopics={requestedTopics} contentRequests={contentRequests} effectiveTier={effectiveTier} briefPrice={briefPrice} fullPostPrice={fullPostPrice} fmtPrice={fmtPrice} setPricingModal={setPricingModal} />
        )}


        {/* ════════════ INBOX TAB (Approvals + Requests + Content) ════════════ */}
        {tab === 'inbox' && (
          <InboxTab workspaceId={workspaceId} effectiveTier={effectiveTier} approvalBatches={approvalBatches} approvalsLoading={approvalsLoading} pendingApprovals={pendingApprovals} setApprovalBatches={setApprovalBatches} loadApprovals={loadApprovals} requests={requests} requestsLoading={requestsLoading} clientUser={clientUser} loadRequests={loadRequests} contentRequests={contentRequests} setContentRequests={setContentRequests} briefPrice={briefPrice} fullPostPrice={fullPostPrice} fmtPrice={fmtPrice} setPricingModal={setPricingModal} pricingConfirming={pricingConfirming} setTab={setTab} setToast={setToast} />
        )}


      {/* Floating AI Chat */}
      {(overview || audit || ga4Overview) && (<>
        {!chatOpen && (
          <button onClick={() => setChatOpen(true)}
            className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-sm font-medium shadow-lg shadow-teal-900/30 transition-all z-50">
            <Sparkles className="w-4 h-4" /> Insights Engine
          </button>
        )}
        {chatOpen && (
          <div className={`fixed bottom-6 right-6 bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl shadow-black/40 overflow-hidden z-50 flex flex-col transition-all duration-200 ${chatExpanded ? 'w-[600px] max-h-[700px]' : 'w-96 max-h-[500px]'}`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-400" /><span className="text-sm font-medium text-zinc-200">Insights Engine</span>
                {!betaMode && chatUsage && chatUsage.tier === 'free' ? (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${chatUsage.remaining > 0 ? 'text-zinc-400 bg-zinc-800' : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'}`}>
                    {chatUsage.remaining}/{chatUsage.limit} left
                  </span>
                ) : (
                  <span className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">by hmpsn studio</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {chatMessages.length > 0 && (
                  <button onClick={() => { setChatSessionId(`cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`); setChatMessages([]); setShowChatHistory(false); }}
                    title="New conversation" className="text-zinc-500 hover:text-zinc-300 p-1"><Plus className="w-3.5 h-3.5" /></button>
                )}
                <button onClick={() => { setShowChatHistory(!showChatHistory); if (!showChatHistory && ws) { fetch(`/api/public/chat-sessions/${ws.id}?channel=client`).then(r => r.json()).then(d => { if (Array.isArray(d)) setChatSessions(d); }).catch(() => {}); } }}
                  title="Chat history" className={`p-1 ${showChatHistory ? 'text-teal-400' : 'text-zinc-500 hover:text-zinc-300'}`}><MessageSquare className="w-3.5 h-3.5" /></button>
                <button onClick={() => setChatExpanded(!chatExpanded)} title={chatExpanded ? 'Minimize' : 'Maximize'} className="text-zinc-500 hover:text-zinc-300 p-1">
                  {chatExpanded ? <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>}
                </button>
                <button onClick={() => { setChatOpen(false); setChatExpanded(false); }} className="text-zinc-500 hover:text-zinc-300 p-1"><X className="w-4 h-4" /></button>
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
            {!betaMode && chatUsage && chatUsage.tier === 'free' && !chatUsage.allowed ? (
            <div className="px-4 py-3 border-t border-zinc-800 flex-shrink-0">
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <Lock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                <p className="text-[11px] text-amber-300/80 flex-1">You've used all {chatUsage.limit} free conversations this month.</p>
              </div>
            </div>
            ) : (
            <div className="px-4 py-3 border-t border-zinc-800 flex gap-2 flex-shrink-0">
              <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && askAi(chatInput)}
                placeholder="Ask about your site data..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" disabled={chatLoading} />
              <button onClick={() => askAi(chatInput)} disabled={chatLoading || !chatInput.trim()} className="px-3 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg transition-colors"><Send className="w-3.5 h-3.5" /></button>
            </div>
            )}
          </div>
        )}
      </>)}


        {/* ════════════ PLANS TAB ════════════ */}
        {tab === 'plans' && (
          <PlansTab workspaceId={workspaceId} ws={ws} effectiveTier={effectiveTier} briefPrice={briefPrice} fullPostPrice={fullPostPrice} fmtPrice={fmtPrice} setTab={setTab} setToast={setToast} onOpenChat={() => setChatOpen(true)} />
        )}

      </main>

      {/* ── SEO Upgrade Modal ── */}
      {!betaMode && showUpgradeModal && (
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
            <button onClick={async () => {
              try {
                const res = await fetch(`/api/public/upgrade-checkout/${workspaceId}`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ planId: 'premium' }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to start checkout');
                if (data.url) window.location.href = data.url;
              } catch (err) {
                setToast({ message: err instanceof Error ? err.message : 'Upgrade failed. Please try again.', type: 'error' });
                setTimeout(() => setToast(null), 6000);
              }
            }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium transition-colors cursor-pointer">
              <Sparkles className="w-4 h-4" /> Upgrade to Premium
            </button>
            <button onClick={() => setShowUpgradeModal(false)} className="block mx-auto mt-3 text-xs text-zinc-500 hover:text-zinc-400 transition-colors">
              Maybe later
            </button>
          </div>
        </div>
      )}

      {/* Pricing confirmation modal */}
      {!betaMode && pricingModal && (() => {
        const pricing = ws?.contentPricing;
        const isUpgrade = pricingModal.source === 'upgrade';
        const isFull = pricingModal.serviceType === 'full_post';
        const price = isFull ? fullPostPrice : briefPrice;
        const upgradePrice = isUpgrade && briefPrice != null && fullPostPrice != null ? Math.max(0, fullPostPrice - briefPrice) : null;
        const displayPrice = isUpgrade ? upgradePrice : price;
        const fmt = fmtPrice;
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[70] flex items-center justify-center p-4" onClick={() => !pricingConfirming && setPricingModal(null)}>
            <div className="relative bg-zinc-900 border border-zinc-700/50 rounded-2xl shadow-2xl shadow-black/50 w-full max-w-md overflow-hidden animate-[scaleIn_0.2s_ease-out]" onClick={e => e.stopPropagation()}>
              {/* Close button */}
              <button
                onClick={() => !pricingConfirming && setPricingModal(null)}
                className="absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors z-10"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Header with gradient */}
              <div className="relative px-6 pt-6 pb-5 overflow-hidden bg-gradient-to-br from-teal-600/15 via-emerald-600/10 to-transparent">
                {/* Decorative glow */}
                <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full blur-3xl opacity-20 bg-teal-500" />

                <div className="relative flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center ring-1 bg-gradient-to-br from-teal-500/25 to-emerald-500/25 ring-teal-500/20">
                      {isFull ? <Sparkles className="w-5 h-5 text-teal-400" /> : <FileText className="w-5 h-5 text-teal-400" />}
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
                </div>

                {/* Topic card */}
                <div className="rounded-xl px-3.5 py-3 border bg-teal-950/30 border-teal-500/10">
                  <div className="flex items-center gap-2 mb-1">
                    <Target className="w-3 h-3 text-teal-400/70" />
                    <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Topic</span>
                  </div>
                  <div className="text-xs text-zinc-200 font-medium leading-relaxed">{pricingModal.topic}</div>
                  <div className="text-[11px] mt-1 text-teal-400/80">Keyword: &ldquo;{pricingModal.targetKeyword}&rdquo;</div>
                </div>
              </div>

              {/* Price banner */}
              {displayPrice != null && (
                <div className="mx-6 flex items-center justify-between px-4 py-3 rounded-xl border bg-teal-500/5 border-teal-500/15">
                  <div>
                    <div className="text-2xl font-bold tracking-tight text-teal-300">{fmt(displayPrice)}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{isUpgrade ? 'Upgrade difference' : 'One-time payment'}</div>
                  </div>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-teal-500/10">
                    <Shield className="w-4 h-4 text-teal-400/60" />
                  </div>
                </div>
              )}
              {displayPrice == null && (
                <div className="mx-6 mt-0 mb-0 text-[11px] text-zinc-500 bg-zinc-800/40 rounded-xl px-4 py-3 border border-zinc-700/30">
                  <Lock className="w-3 h-3 inline mr-1.5 -mt-0.5" />
                  Pricing will be confirmed by your team after submission.
                </div>
              )}

              {/* Actions */}
              <div className="px-6 pb-5 space-y-3">
                <button
                  disabled={pricingConfirming}
                  onClick={confirmPricingAndSubmit}
                  className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 shadow-lg active:scale-[0.98] bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:from-teal-500 hover:to-emerald-500 shadow-teal-900/40"
                >
                  {pricingConfirming ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing…</span>
                    </>
                  ) : displayPrice != null ? (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      <span>Pay {fmt(displayPrice)} securely</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirm Request</span>
                    </>
                  )}
                </button>
                <button
                  disabled={pricingConfirming}
                  onClick={() => setPricingModal(null)}
                  className="w-full px-4 py-2 rounded-xl text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-all"
                >
                  Cancel
                </button>

                {/* Trust footer */}
                <div className="flex items-center justify-center gap-4 pt-1">
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-3 h-3 text-zinc-600" />
                    <span className="text-[10px] text-zinc-600">SSL Encrypted</span>
                  </div>
                  <div className="w-px h-3 bg-zinc-800" />
                  <div className="flex items-center gap-1.5">
                    <svg className="w-3 h-3 text-zinc-600" viewBox="0 0 24 24" fill="currentColor"><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/></svg>
                    <span className="text-[10px] text-zinc-600">Powered by Stripe</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ════════════ ROI TAB ════════════ */}
      {tab === 'roi' && (
        <ErrorBoundary label="ROI Dashboard">
          <ROIDashboard workspaceId={workspaceId} tier={effectiveTier} />
        </ErrorBoundary>
      )}

      {/* Stripe Elements inline payment modal */}
      {!betaMode && stripePayment && (
        <StripePaymentModal
          clientSecret={stripePayment.clientSecret}
          publishableKey={stripePayment.publishableKey}
          amount={stripePayment.amount}
          productName={stripePayment.productName}
          topic={stripePayment.topic}
          targetKeyword={stripePayment.targetKeyword}
          isFull={stripePayment.isFull}
          onSuccess={() => {
            setStripePayment(null);
            setToast({ message: `Payment successful! Your ${stripePayment.productName.toLowerCase()} is being prepared.`, type: 'success' });
            setTimeout(() => setToast(null), 6000);
            // Refresh content requests
            fetch(`/api/public/content-requests/${workspaceId}`).then(r => r.json()).then(setContentRequests).catch(() => {});
          }}
          onClose={() => setStripePayment(null)}
        />
      )}

      {/* Welcome onboarding wizard */}
      {showWelcome && ws && (
        <OnboardingWizard
          workspaceName={ws.name}
          tier={effectiveTier}
          isTrial={!!(ws.isTrial && ws.trialDaysRemaining != null && ws.trialDaysRemaining > 0)}
          trialDaysRemaining={ws.trialDaysRemaining ?? undefined}
          hasGSC={!!ws.gscPropertyUrl}
          hasGA4={!!ws.ga4PropertyId}
          hasStrategy={!!strategyData}
          hasAudit={!!audit}
          onDismiss={() => {
            const key = clientUser ? `welcome_seen_${workspaceId}_${clientUser.id}` : `welcome_seen_${workspaceId}`;
            localStorage.setItem(key, 'true');
            setShowWelcome(false);
          }}
          onNavigate={(t) => setTab(t as ClientTab)}
        />
      )}

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
    </CartProvider>
    </BetaProvider>
  );
}
