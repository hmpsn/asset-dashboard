import { useState, useEffect, useMemo, useRef } from 'react';
import { get, post, patch, getOptional } from '../api/client';
import { ApiError } from '../api/client';
import { useNavigate } from 'react-router-dom';
import { clientPath } from '../routes';
import {
  AlertTriangle,
  Target, Zap, Shield, X,
  CheckCircle2, LineChart, Trophy, Layers,
  Clock, CreditCard, Building2, Sparkles,
} from 'lucide-react';
import { type Tier, Skeleton, OverviewSkeleton, ScannerReveal } from './ui';
import { STUDIO_NAME, STUDIO_URL } from '../constants';
import { HealthTab } from './client/HealthTab';
import { InsightsEngine } from './client/InsightsEngine';
import { CartProvider } from './client/useCart';
import { SeoCartDrawer } from './client/SeoCart';
import { OnboardingWizard } from './client/OnboardingWizard';
import { ClientOnboardingQuestionnaire, type OnboardingData } from './client/ClientOnboardingQuestionnaire';
import { ROIDashboard } from './client/ROIDashboard';
import { FeedbackWidget } from './client/FeedbackWidget';
import { SchemaReviewTab } from './client/SchemaReviewTab';
import { PlansTab } from './client/PlansTab';
import { ContentPlanTab } from './client/ContentPlanTab';
import { StrategyTab } from './client/StrategyTab';
import { PerformanceTab } from './client/PerformanceTab';
import { InboxTab } from './client/InboxTab';
import { OverviewTab } from './client/OverviewTab';
import { SeoEducationTip } from './client/SeoEducationTip';
import { ErrorBoundary } from './ErrorBoundary';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
// AnomalyAlerts removed from overview — insights digest covers trend signals
import { BetaProvider } from './client/BetaContext';
import { useClientAuth } from '../hooks/useClientAuth';
import { useClientData } from '../hooks/useClientData';
import { usePayments } from '../hooks/usePayments';
import { useToast } from '../hooks/useToast';
import { useFeatureFlag } from '../hooks/useFeatureFlag';
import { BrandTab } from './client/BrandTab';
import { ClientAuthGate } from './client/ClientAuthGate';
import { EmailCaptureGate } from './client/EmailCaptureGate';
import { ClientChatWidget, type ClientChatWidgetApi } from './client/ClientChatWidget';
import { ClientHeader } from './client/ClientHeader';
import { UpgradeModal } from './client/UpgradeModal';
import { PricingConfirmationModal } from './client/PricingConfirmationModal';
import {
  type BusinessProfile,
  type WorkspaceInfo,
  type ClientTab,
} from './client/types';

export function ClientDashboard({ workspaceId, betaMode = false, initialTab }: { workspaceId: string; betaMode?: boolean; initialTab?: string }) {
  const brandTabEnabled = useFeatureFlag('client-brand-section');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('dashboard-theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; }
  });
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('dashboard-theme', next); } catch (err) { console.error('ClientDashboard operation failed:', err); }
  };
  // ── Date picker refs (replaces document.getElementById) ──
  const customStartRef = useRef<HTMLInputElement>(null);
  const customEndRef = useRef<HTMLInputElement>(null);

  // ── Data hook (dashboard state + data loading) ──
  const {
    ws, setWs,
    overview, trend, audit, auditDetail,
    loading, setLoading, error, setError,
    strategyData, requestedTopics, setRequestedTopics,
    requestingTopic: _requestingTopic, setRequestingTopic,
    days, customDateRange, showDatePicker, setShowDatePicker,
    ga4Overview, ga4Trend, ga4Pages, ga4Sources, ga4Devices,
    ga4Countries, ga4Events, ga4Conversions,
    searchComparison, ga4Comparison, ga4NewVsReturning,
    ga4Organic, ga4LandingPages, anomalies,
    approvalBatches, setApprovalBatches, approvalsLoading, approvalPageKeywords,
    activityLog, rankHistory, latestRanks, annotations,
    requests, requestsLoading, contentRequests, setContentRequests,
    sectionErrors, contentPlanSummary, contentPlanKeywords, contentPlanReviewCells,
    hasCopyEntries,
    loadDashboardData, loadRequests, loadApprovals,
    changeDays, applyCustomRange, refetchClient,
  } = useClientData(workspaceId);

  // ── UI-only state (declared early — needed by hooks below) ──
  const { toast, setToast, clearToast } = useToast();

  // ── Payments hook ──
  const {
    pricingModal, setPricingModal,
    pricingConfirming, pricingData, setPricingData,
    stripePayment, setStripePayment,
    confirmPricingAndSubmit,
  } = usePayments(workspaceId, ws, setToast, setContentRequests, setRequestedTopics, setRequestingTopic);

  // ── Turnstile state (declared before useClientAuth which references them) ──
  const turnstileTokenRef = useRef<string | undefined>(undefined);
  const [turnstileReset, setTurnstileReset] = useState(0);

  // ── Auth hook ──
  const {
    authenticated, setAuthenticated,
    authLoading, setAuthLoading, authError, setAuthError,
    authMode, setAuthMode,
    clientUser, setClientUser,
    loginTab, setLoginTab,
    loginEmail, setLoginEmail,
    loginPassword, setLoginPassword,
    loginView, setLoginView,
    forgotEmail, setForgotEmail, forgotSent, setForgotSent,
    resetToken, setResetToken,
    resetPassword, setResetPassword,
    resetConfirm, setResetConfirm, resetDone, setResetDone,
    passwordInput, setPasswordInput,
    handlePasswordSubmit, handleClientUserLogin, handleClientLogout,
  } = useClientAuth(workspaceId, ws, (data: WorkspaceInfo) => loadDashboardData(data, setPricingData), () => turnstileTokenRef.current, () => setTurnstileReset((r: number) => r + 1));

  // ── Chat deps (passed to ClientChatWidget which owns the useChat call) ──
  const chatDeps = useMemo(() => ({
    ws, overview, trend, ga4Overview, ga4Pages, ga4Sources, ga4Devices,
    ga4Countries, ga4Events, ga4Conversions, searchComparison, ga4Comparison,
    ga4NewVsReturning, ga4Organic, audit, auditDetail, strategyData,
    latestRanks, activityLog, annotations, approvalBatches, requests,
    anomalies, days, betaMode,
    effectiveTier: (betaMode ? 'premium' : ((ws?.tier as import('./ui').Tier) || 'free')) as import('./ui').Tier,
  }), [ws, overview, trend, ga4Overview, ga4Pages, ga4Sources, ga4Devices,
    ga4Countries, ga4Events, ga4Conversions, searchComparison, ga4Comparison,
    ga4NewVsReturning, ga4Organic, audit, auditDetail, strategyData,
    latestRanks, activityLog, annotations, approvalBatches, requests,
    anomalies, days, betaMode]);

  // API surface bubbled up from ClientChatWidget for cross-component usage
  const [chatApi, setChatApi] = useState<ClientChatWidgetApi | null>(null);
  const [chatExpanded, setChatExpanded] = useState(false);

  // ── UI-only state ──
  const clientNavigate = useNavigate();
  const tab: ClientTab = (() => {
    const t = initialTab;
    if (t === 'search' || t === 'analytics') return 'performance' as ClientTab;
    if (t === 'brand') return brandTabEnabled ? 'brand' as ClientTab : 'overview';
    if (t && ['overview','performance','health','strategy','inbox','approvals','requests','content','plans','roi','content-plan','schema-review'].includes(t)) return t as ClientTab;
    return 'overview';
  })();
  const setTab = (t: ClientTab) => {
    clientNavigate(clientPath(workspaceId, t, betaMode));
  };
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingSaving, setOnboardingSaving] = useState(false);

  // ── Email capture gate (shared-password visitors on free tier) ──
  const [emailGateOpen, setEmailGateOpen] = useState(false);
  const emailGateChecked = useRef(false);

  // Check if email gate is needed after shared-password auth
  useEffect(() => {
    if (!authenticated || clientUser || emailGateChecked.current) return;
    emailGateChecked.current = true;
    // Only gate shared-password visitors who haven't provided email
    if (ws?.requiresPassword) {
      try {
        const stored = localStorage.getItem(`portal_email_${workspaceId}`);
        if (!stored) queueMicrotask(() => setEmailGateOpen(true));
      } catch (err) { console.error('ClientDashboard operation failed:', err); }
    }
  }, [authenticated, clientUser, ws, workspaceId]);

  // ── Real-time workspace events ──
  const wsIdentity = useMemo(() => clientUser ? {
    userId: clientUser.id,
    email: clientUser.email,
    name: clientUser.name,
    role: 'client' as const,
  } : undefined, [clientUser]);

  useWorkspaceEvents(authenticated ? workspaceId : undefined, {
    'activity:new': () => refetchClient('activity', `/api/public/activity/${workspaceId}?limit=20`),
    'approval:update': () => refetchClient('approvals', `/api/public/approvals/${workspaceId}`),
    'approval:applied': () => refetchClient('approvals', `/api/public/approvals/${workspaceId}`),
    'request:created': () => refetchClient('requests', `/api/public/requests/${workspaceId}`),
    'request:update': () => refetchClient('requests', `/api/public/requests/${workspaceId}`),
    'content-request:created': () => refetchClient('content', `/api/public/content-requests/${workspaceId}`),
    'content-request:update': () => refetchClient('content', `/api/public/content-requests/${workspaceId}`),
    'copy:section_updated': () => refetchClient('copy', `/api/public/copy/${workspaceId}/entries`),
    'audit:complete': () => {
      refetchClient('audit', '');
      refetchClient('activity', '');
    },
    'workspace:updated': () => {
      getOptional<WorkspaceInfo>(`/api/public/workspace/${workspaceId}`).then(data => { if (data?.id) setWs(data); }).catch((err) => { console.error('ClientDashboard operation failed:', err); });
    },
    'recommendations:updated': () => refetchClient('recommendations', ''),
  }, wsIdentity);

  // ── Load workspace info first (includes requiresPassword flag) ──
  useEffect(() => {
    setLoading(true);
    get<WorkspaceInfo>(`/api/public/workspace/${workspaceId}`)
      .then(async (data: WorkspaceInfo) => {
        if (!data.id) { setError('Workspace not found'); setLoading(false); return; }
        setWs(data);
        // Update document head: title, OG meta, Twitter cards, favicon
        const portalTitle = `${data.name} — Insights Engine`;
        const portalDesc = `Performance insights, SEO opportunities, and growth recommendations for ${data.name}.`;
        document.title = portalTitle;
        const setMeta = (attr: string, key: string, content: string) => {
          let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
          if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
          el.setAttribute('content', content);
        };
        setMeta('property', 'og:title', portalTitle);
        setMeta('property', 'og:description', portalDesc);
        setMeta('property', 'og:type', 'website');
        setMeta('property', 'og:url', window.location.href);
        setMeta('name', 'twitter:title', portalTitle);
        setMeta('name', 'twitter:description', portalDesc);
        setMeta('name', 'twitter:card', 'summary');
        setMeta('name', 'description', portalDesc);
        if (data.brandLogoUrl) {
          setMeta('property', 'og:image', data.brandLogoUrl);
          setMeta('name', 'twitter:image', data.brandLogoUrl);
        }
        // Dynamic favicon — use workspace logo if available, else keep default
        if (data.brandLogoUrl) {
          let faviconEl = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
          if (!faviconEl) { faviconEl = document.createElement('link'); faviconEl.rel = 'icon'; document.head.appendChild(faviconEl); }
          faviconEl.href = data.brandLogoUrl;
          faviconEl.type = data.brandLogoUrl.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
        }

        // Fetch auth mode (shared password vs individual accounts)
        try {
          const am = await getOptional<{ hasSharedPassword?: boolean; hasClientUsers?: boolean }>(`/api/public/auth-mode/${workspaceId}`);
          if (am) {
            setAuthMode({ hasSharedPassword: am.hasSharedPassword ?? !!data.requiresPassword, hasClientUsers: am.hasClientUsers ?? false });
            setLoginTab(am.hasClientUsers ? 'user' : 'password');
          }
        } catch (err) { console.error('ClientDashboard operation failed:', err); }

        // Check if already authenticated via client user JWT cookie
        let autoAuthed = false;
        let resolvedUserId: string | undefined;
        try {
          const meData = await getOptional<{ user?: { id: string; email: string; name: string; role?: string } }>(`/api/public/client-me/${workspaceId}`);
          if (meData?.user) {
            setClientUser({ ...meData.user, role: meData.user.role || 'client' });
            resolvedUserId = meData.user.id;
            setAuthenticated(true);
            autoAuthed = true;
            loadDashboardData(data, setPricingData);
          }
        } catch (err) { console.error('ClientDashboard operation failed:', err); }

        // Fall back to legacy session check
        if (!autoAuthed) {
          if (data.requiresPassword) {
            const stored = sessionStorage.getItem(`dash_auth_${workspaceId}`);
            if (stored === 'true') {
              setAuthenticated(true);
              loadDashboardData(data, setPricingData);
            }
          } else {
            setAuthenticated(true);
            loadDashboardData(data, setPricingData);
          }
        }
        setLoading(false);

        // Show onboarding questionnaire if enabled and not yet completed
        if (data.onboardingEnabled && !data.onboardingCompleted) {
          setShowOnboarding(true);
        }

        // Show welcome modal on first visit (user-aware key when logged in)
        const welcomeUserId = resolvedUserId;
        const welcomeKey = welcomeUserId ? `welcome_seen_${workspaceId}_${welcomeUserId}` : `welcome_seen_${workspaceId}`;
        if (!localStorage.getItem(welcomeKey) && !data.onboardingEnabled) {
          setShowWelcome(true);
        }

        // Detect password reset token in URL
        const params = new URLSearchParams(window.location.search);
        const urlResetToken = params.get('reset_token');
        if (urlResetToken) {
          setResetToken(urlResetToken);
          setLoginView('reset');
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('reset_token');
          window.history.replaceState({}, '', cleanUrl.toString());
        }

        // Detect Stripe payment redirect
        const paymentStatus = params.get('payment');
        if (paymentStatus === 'success') {
          setToast({ message: 'Payment successful! Your content request is being processed.', type: 'success' });
          const url = new URL(window.location.href);
          url.searchParams.delete('payment');
          url.searchParams.delete('session_id');
          window.history.replaceState({}, '', url.toString());
        } else if (paymentStatus === 'cancelled') {
          setToast({ message: 'Payment was cancelled. You can try again anytime.', type: 'error' });
          const url = new URL(window.location.href);
          url.searchParams.delete('payment');
          window.history.replaceState({}, '', url.toString());
        }
      })
      .catch((err) => { setError(err instanceof ApiError && err.status === 403 ? `This dashboard is currently unavailable. Please contact ${STUDIO_NAME} for access.` : 'Failed to load dashboard'); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]); // large init effect — only re-runs on workspace change; missing deps are stable useState setters


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
          <Skeleton className="h-6 w-24" />
          <div className="w-px h-8 bg-zinc-800" />
          <div><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-28 mt-1.5" /></div>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-3 flex gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-4 w-20" />)}
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-6">
        <OverviewSkeleton />
      </main>
    </div>
  );
  if (error || !ws) return (
    <div className="min-h-screen bg-[#0f1219] flex items-center justify-center">
      <div className="text-center">
        <p className="text-red-400/80 text-sm mb-3">{error || 'Dashboard not found'}</p>
        <button onClick={() => window.location.reload()} className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-600 transition-colors">Try Again</button>
      </div>
    </div>
  );

  // Password gate — smart login with auth mode detection
  if ((ws.requiresPassword || authMode?.hasClientUsers) && !authenticated) return (
    <ClientAuthGate
      workspaceId={workspaceId}
      ws={ws}
      authLoading={authLoading}
      authError={authError}
      authMode={authMode}
      loginTab={loginTab}
      loginEmail={loginEmail}
      loginPassword={loginPassword}
      loginView={loginView}
      forgotEmail={forgotEmail}
      forgotSent={forgotSent}
      resetToken={resetToken}
      resetPassword={resetPassword}
      resetConfirm={resetConfirm}
      resetDone={resetDone}
      passwordInput={passwordInput}
      turnstileReset={turnstileReset}
      tokenRef={turnstileTokenRef}
      setLoginTab={setLoginTab}
      setLoginEmail={setLoginEmail}
      setLoginPassword={setLoginPassword}
      setLoginView={setLoginView}
      setForgotEmail={setForgotEmail}
      setForgotSent={setForgotSent}
      setResetPassword={setResetPassword}
      setResetConfirm={setResetConfirm}
      setResetDone={setResetDone}
      setPasswordInput={setPasswordInput}
      setAuthError={setAuthError}
      setAuthLoading={setAuthLoading}
      setTurnstileReset={setTurnstileReset}
      handlePasswordSubmit={handlePasswordSubmit}
      handleClientUserLogin={handleClientUserLogin}
    />
  );

  const insights = getInsights();

  // Email capture gate UI — shown after password auth, before dashboard
  if (emailGateOpen && authenticated && !clientUser) return (
    <EmailCaptureGate
      workspaceId={workspaceId}
      ws={ws}
      onComplete={() => setEmailGateOpen(false)}
      onSkip={() => setEmailGateOpen(false)}
    />
  );

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
    ...(ws?.analyticsClientView !== false ? [
      { id: 'performance' as ClientTab, label: 'Performance', icon: LineChart, locked: false },
    ] : []),
    { id: 'health' as ClientTab, label: 'Site Health', icon: Shield, locked: false },
    ...(isPaid ? [{ id: 'strategy' as ClientTab, label: 'SEO Strategy', icon: Target, locked: strategyLocked }] : []),
    ...(isPaid && contentPlanSummary && contentPlanSummary.totalCells > 0 ? [{ id: 'content-plan' as ClientTab, label: 'Content Plan', icon: Layers, locked: false }] : []),
    ...(isPaid ? [{ id: 'inbox' as ClientTab, label: 'Inbox', icon: Zap, locked: false }] : []),
    ...(isPaid ? [{ id: 'schema-review' as ClientTab, label: 'Schema', icon: Shield, locked: false }] : []),
    ...(!betaMode ? [{ id: 'plans' as ClientTab, label: 'Plans', icon: CreditCard, locked: false }] : []),
    ...(isPaid && !betaMode && strategyData ? [{ id: 'roi' as ClientTab, label: 'ROI', icon: Trophy, locked: false }] : []),
    ...(brandTabEnabled ? [{ id: 'brand' as ClientTab, label: 'Brand', icon: Building2, locked: false }] : []),
  ];

  // hasData function passed to ClientHeader for tab indicator dots
  const hasData = (tabId: ClientTab): boolean =>
    tabId === 'overview' ||
    (tabId === 'performance' && !!(overview || ga4Overview)) ||
    (tabId === 'health' && !!audit) ||
    tabId === 'inbox' ||
    (tabId === 'content-plan' && !!contentPlanSummary && contentPlanSummary.totalCells > 0);

  return (
    <ErrorBoundary label="Client Dashboard">
    <BetaProvider value={betaMode}>
    <CartProvider>
    <div className={`min-h-screen bg-[#0f1219] text-zinc-200 ${theme === 'light' ? 'dashboard-light' : ''}`}>
      {!betaMode && <SeoCartDrawer workspaceId={workspaceId} tier={effectiveTier} />}

      <ClientHeader
        ws={ws}
        betaMode={betaMode}
        theme={theme}
        toggleTheme={toggleTheme}
        tab={tab}
        setTab={setTab}
        NAV={NAV}
        days={days}
        customDateRange={customDateRange}
        showDatePicker={showDatePicker}
        setShowDatePicker={setShowDatePicker}
        changeDays={changeDays}
        applyCustomRange={applyCustomRange}
        customStartRef={customStartRef}
        customEndRef={customEndRef}
        clientUser={clientUser}
        handleClientLogout={handleClientLogout}
        setShowUpgradeModal={setShowUpgradeModal}
        pendingApprovals={pendingApprovals}
        unreadTeamNotes={unreadTeamNotes}
        contentPlanSummary={contentPlanSummary}
        hasData={hasData}
        contentRequests={contentRequests}
        hasAnalytics={!!(overview || ga4Overview)}
        hasAnyData={!!(overview || audit || ga4Overview)}
        effectiveTier={effectiveTier}
      />

      <main className="max-w-6xl mx-auto px-6 py-6">
        <ScannerReveal>
        <div className="space-y-8">

        {/* Trial countdown banner — shows at day 10 and under */}
        {!betaMode && ws.isTrial && (ws.trialDaysRemaining ?? 0) <= 10 && (ws.trialDaysRemaining ?? 0) > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/8 border border-amber-500/20" style={{ borderRadius: '6px 12px 6px 12px' }}>
            <Clock className="w-4 h-4 text-amber-400/80 flex-shrink-0" />
            <p className="text-sm text-amber-300">
              <strong>{ws.trialDaysRemaining} day{ws.trialDaysRemaining === 1 ? '' : 's'}</strong> left on your Growth trial.
              {' '}Upgrade to keep access to all features.
            </p>
          </div>
        )}
        {!betaMode && ws.isTrial && (ws.trialDaysRemaining ?? 0) === 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-500/8 border border-red-500/20" style={{ borderRadius: '6px 12px 6px 12px' }}>
            <Clock className="w-4 h-4 text-red-400/80 flex-shrink-0" />
            <p className="text-sm text-red-300">
              Your Growth trial has ended. Some features are now limited.
              {' '}Upgrade to restore full access.
            </p>
          </div>
        )}

        {/* Section loading errors */}
        {Object.keys(sectionErrors).length > 0 && (
          <div className="flex items-start gap-3 px-4 py-3 bg-red-500/8 border border-red-500/15" style={{ borderRadius: '6px 12px 6px 12px' }}>
            <AlertTriangle className="w-4 h-4 text-red-400/80 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-300 space-y-0.5">
              {Object.values(sectionErrors).map((msg, i) => <p key={i}>{msg} — try refreshing the page.</p>)}
            </div>
          </div>
        )}

        {/* SEO Education Tips — per-tab first-visit contextual tips */}
        <SeoEducationTip tab={tab} workspaceId={workspaceId} />

        {/* ════════════ OVERVIEW TAB ════════════ */}
        {tab === 'overview' && (
          <OverviewTab ws={ws!} overview={overview} searchComparison={searchComparison} trend={trend} ga4Overview={ga4Overview} ga4Trend={ga4Trend} ga4Comparison={ga4Comparison} ga4Organic={ga4Organic} ga4Conversions={ga4Conversions} ga4NewVsReturning={ga4NewVsReturning} audit={audit} auditDetail={auditDetail} strategyData={strategyData} insights={insights} contentRequests={contentRequests} requests={requests} approvalBatches={approvalBatches} activityLog={activityLog} pendingApprovals={pendingApprovals} unreadTeamNotes={unreadTeamNotes} eventDisplayName={eventDisplayName} isEventPinned={isEventPinned} workspaceId={workspaceId} onAskAi={chatApi?.askAi ?? (() => Promise.resolve())} onOpenChat={() => chatApi?.openChat()} clientUser={clientUser} contentPlanSummary={contentPlanSummary} />
        )}

        {/* ════════════ PERFORMANCE TAB (Search + Analytics) ════════════ */}
        {tab === 'performance' && (
          <PerformanceTab overview={overview} searchComparison={searchComparison} trend={trend} annotations={annotations} rankHistory={rankHistory} latestRanks={latestRanks} insights={insights} ga4Overview={ga4Overview} ga4Comparison={ga4Comparison} ga4Trend={ga4Trend} ga4Devices={ga4Devices} ga4Pages={ga4Pages} ga4Sources={ga4Sources} ga4Organic={ga4Organic} ga4LandingPages={ga4LandingPages} ga4NewVsReturning={ga4NewVsReturning} ga4Conversions={ga4Conversions} ga4Events={ga4Events} ws={ws!} days={days} />
        )}

        {/* ════════════ SITE HEALTH TAB ════════════ */}
        {tab === 'health' && (
          <ErrorBoundary label="Site Health">
            <HealthTab audit={audit} auditDetail={auditDetail} liveDomain={ws.liveDomain} workspaceId={workspaceId} initialSeverity={(() => { const s = new URLSearchParams(window.location.search).get('severity'); return s && ['error','warning','info'].includes(s) ? s as 'error' | 'warning' | 'info' : 'all'; })()} onContentRequested={() => setToast({ message: 'Content improvement request created! Check the Content tab to track progress.', type: 'success' })} actionPlanSlot={workspaceId && auditDetail ? (
              <ErrorBoundary label="Action Plan">
                <InsightsEngine workspaceId={workspaceId} tier={effectiveTier} />
              </ErrorBoundary>
            ) : undefined} />
          </ErrorBoundary>
        )}

        {/* ════════════ SEO STRATEGY TAB ════════════ */}
        {tab === 'strategy' && (
          <StrategyTab strategyData={strategyData} requestedTopics={requestedTopics} contentRequests={contentRequests} effectiveTier={effectiveTier} briefPrice={briefPrice} fullPostPrice={fullPostPrice} fmtPrice={fmtPrice} setPricingModal={setPricingModal} contentPlanKeywords={contentPlanKeywords} onTabChange={(t) => setTab(t as ClientTab)} workspaceId={workspaceId} setToast={(msg: string) => setToast({ message: msg, type: 'success' })} />
        )}


        {/* ════════════ INBOX TAB (Approvals + Requests + Content) ════════════ */}
        {tab === 'inbox' && (
          <InboxTab workspaceId={workspaceId} effectiveTier={effectiveTier} approvalBatches={approvalBatches} approvalsLoading={approvalsLoading} pendingApprovals={pendingApprovals} setApprovalBatches={setApprovalBatches} loadApprovals={loadApprovals} requests={requests} requestsLoading={requestsLoading} clientUser={clientUser} loadRequests={loadRequests} contentRequests={contentRequests} setContentRequests={setContentRequests} briefPrice={briefPrice} fullPostPrice={fullPostPrice} fmtPrice={fmtPrice} setPricingModal={setPricingModal} pricingConfirming={pricingConfirming} setToast={setToast} contentPlanReviewCells={contentPlanReviewCells} pageMap={approvalPageKeywords ?? strategyData?.pageMap} hasCopyEntries={hasCopyEntries} />
        )}


      {/* Floating AI Chat */}
      <ClientChatWidget
        chatDeps={chatDeps}
        betaMode={betaMode}
        workspaceId={workspaceId}
        ws={ws}
        onApiChange={api => setChatApi(api)}
        onExpandedChange={expanded => setChatExpanded(expanded)}
      />



        {/* ════════════ CONTENT PLAN TAB ════════════ */}
        {tab === 'content-plan' && (
          <ErrorBoundary label="Content Plan">
            <ContentPlanTab workspaceId={workspaceId} setToast={setToast} />
          </ErrorBoundary>
        )}

        {/* ════════════ PLANS TAB ════════════ */}
        {tab === 'plans' && (
          <PlansTab workspaceId={workspaceId} ws={ws} effectiveTier={effectiveTier} briefPrice={briefPrice} fullPostPrice={fullPostPrice} fmtPrice={fmtPrice} setToast={setToast} onOpenChat={() => chatApi?.openChat()} pricingData={pricingData} />
        )}

        {/* ════════════ ROI TAB ════════════ */}
        {tab === 'roi' && (
          <ErrorBoundary label="ROI Dashboard">
            <ROIDashboard workspaceId={workspaceId} tier={effectiveTier} />
          </ErrorBoundary>
        )}

        {/* ════════════ SCHEMA REVIEW TAB ════════════ */}
        {tab === 'schema-review' && (
          <ErrorBoundary label="Schema Review">
            <SchemaReviewTab workspaceId={workspaceId} setToast={setToast} />
          </ErrorBoundary>
        )}

        {/* ════════════ BRAND TAB ════════════ */}
        {tab === 'brand' && brandTabEnabled && (
          <ErrorBoundary label="Brand">
            <BrandTab
              businessProfile={ws?.businessProfile ?? undefined}
              onSaveBusinessProfile={async (profile) => {
                const res = await patch<{ businessProfile: BusinessProfile }>(`/api/public/workspaces/${workspaceId}/business-profile`, profile);
                if (res?.businessProfile) {
                  setWs(prev => prev ? { ...prev, businessProfile: res.businessProfile } : prev);
                }
              }}
            />
          </ErrorBoundary>
        )}

        </div>
        </ScannerReveal>
      </main>

      {/* ── SEO Upgrade Modal ── */}
      {!betaMode && showUpgradeModal && (
        <UpgradeModal
          workspaceId={workspaceId}
          onClose={() => setShowUpgradeModal(false)}
          onError={(msg) => setToast({ message: msg, type: 'error' })}
        />
      )}

      {/* Pricing confirmation modal + Stripe Elements modal */}
      <PricingConfirmationModal
        betaMode={betaMode}
        billingMode={ws?.billingMode}
        pricingModal={pricingModal}
        setPricingModal={setPricingModal}
        pricingConfirming={pricingConfirming}
        confirmPricingAndSubmit={confirmPricingAndSubmit}
        briefPrice={briefPrice}
        fullPostPrice={fullPostPrice}
        fmtPrice={fmtPrice}
        contentPricing={ws?.contentPricing}
        stripePayment={stripePayment}
        setStripePayment={setStripePayment}
        workspaceId={workspaceId}
        setContentRequests={setContentRequests}
        setToast={setToast}
      />

      {/* Client onboarding questionnaire */}
      {showOnboarding && ws && (
        <ClientOnboardingQuestionnaire
          workspaceName={ws.name}
          saving={onboardingSaving}
          onComplete={async (data: OnboardingData) => {
            setOnboardingSaving(true);
            try {
              await post(`/api/public/onboarding/${workspaceId}`, data);
              setShowOnboarding(false);
              setWs(prev => prev ? { ...prev, onboardingCompleted: true } : prev);
              setToast({ message: 'Thanks! Your responses will help us create better content.', type: 'success' });
              // Show welcome wizard after onboarding
              const welcomeKey = clientUser ? `welcome_seen_${workspaceId}_${clientUser.id}` : `welcome_seen_${workspaceId}`;
              if (!localStorage.getItem(welcomeKey)) setShowWelcome(true);
            } catch (err) {
      console.error('ClientDashboard operation failed:', err);
              setToast({ message: 'Failed to save responses. Please try again.', type: 'error' });
            }
            setOnboardingSaving(false);
          }}
          onSkip={() => {
            setShowOnboarding(false);
            // Show welcome wizard after skipping onboarding
            const welcomeKey = clientUser ? `welcome_seen_${workspaceId}_${clientUser.id}` : `welcome_seen_${workspaceId}`;
            if (!localStorage.getItem(welcomeKey)) setShowWelcome(true);
          }}
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
          workspaceId={workspaceId}
        />
      )}

      {/* Beta Feedback Widget */}
      {ws && <FeedbackWidget workspaceId={workspaceId} currentTab={tab} submittedBy={undefined} chatExpanded={chatExpanded} />}

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-5 py-3 rounded-xl border shadow-lg backdrop-blur-sm flex items-center gap-2.5 animate-[slideUp_0.3s_ease] ${toast.type === 'success' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-red-500/15 border-red-500/30 text-red-300'}`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          <span className="text-xs font-medium">{toast.message}</span>
          <button onClick={clearToast} className="ml-2 text-zinc-400 hover:text-zinc-200"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Powered by footer */}
      <footer className="border-t border-zinc-800/50 mt-12">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-[11px] text-zinc-700">Powered by {STUDIO_NAME}</span>
          <a href={STUDIO_URL} target="_blank" rel="noopener noreferrer" className="text-[11px] text-zinc-700 hover:text-zinc-500 transition-colors">{STUDIO_NAME}</a>
        </div>
      </footer>
    </div>
    </CartProvider>
    </BetaProvider>
    </ErrorBoundary>
  );
}
