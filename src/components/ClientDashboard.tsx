import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { get, post, getOptional, getSafe } from '../api/client';
import { ApiError } from '../api/client';
import { useNavigate } from 'react-router-dom';
import { clientPath } from '../routes';
import {
  Loader2,
  Sparkles, Send, AlertTriangle,
  Target, Zap, Shield, MessageSquare, X,
  CheckCircle2, LineChart, Lock, Trophy, Check, Layers,
  Sun, Moon, Plus, FileText, Calendar, Clock, CreditCard, Mail,
} from 'lucide-react';
const LazyStripePaymentModal = lazy(() => import('./StripePaymentForm').then(m => ({ default: m.StripePaymentModal })));
import { type Tier, Skeleton, OverviewSkeleton } from './ui';
import { RenderMarkdown } from './client/helpers';
import { STUDIO_NAME } from '../constants';
import { HealthTab } from './client/HealthTab';
import { InsightsEngine } from './client/InsightsEngine';
import { CartProvider } from './client/useCart';
import { SeoCartButton, SeoCartDrawer } from './client/SeoCart';
import { OnboardingWizard } from './client/OnboardingWizard';
import { ClientOnboardingQuestionnaire, type OnboardingData } from './client/ClientOnboardingQuestionnaire';
import { ROIDashboard } from './client/ROIDashboard';
import { FeedbackWidget } from './client/FeedbackWidget';
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
import TurnstileWidget from './TurnstileWidget';
import { useClientData } from '../hooks/useClientData';
import { useChat } from '../hooks/useChat';
import { usePayments } from '../hooks/usePayments';
import { useToast } from '../hooks/useToast';
import {
  QUICK_QUESTIONS, LEARN_SEO_QUESTIONS,
  type WorkspaceInfo,
  type ClientTab,
} from './client/types';

export function ClientDashboard({ workspaceId, betaMode = false, initialTab }: { workspaceId: string; betaMode?: boolean; initialTab?: string }) {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('dashboard-theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; }
  });
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('dashboard-theme', next); } catch { /* skip */ }
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
    requestingTopic, setRequestingTopic, // eslint-disable-line @typescript-eslint/no-unused-vars
    days, customDateRange, showDatePicker, setShowDatePicker,
    ga4Overview, ga4Trend, ga4Pages, ga4Sources, ga4Devices,
    ga4Countries, ga4Events, ga4Conversions,
    searchComparison, ga4Comparison, ga4NewVsReturning,
    ga4Organic, ga4LandingPages, anomalies,
    approvalBatches, setApprovalBatches, approvalsLoading,
    activityLog, rankHistory, latestRanks, annotations,
    requests, requestsLoading, contentRequests, setContentRequests,
    sectionErrors,
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
  } = useClientAuth(workspaceId, ws, (data: WorkspaceInfo) => loadDashboardData(data, setPricingData), () => turnstileTokenRef.current, () => setTurnstileReset(r => r + 1));
  const turnstileTokenRef = useRef<string | undefined>(undefined);
  const [turnstileReset, setTurnstileReset] = useState(0);

  // ── Chat hook ──
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
  const {
    chatOpen, setChatOpen, chatExpanded, setChatExpanded,
    chatMessages, setChatMessages, chatInput, setChatInput,
    chatLoading, chatEndRef,
    chatSessionId, setChatSessionId,
    chatSessions, setChatSessions,
    showChatHistory, setShowChatHistory,
    chatUsage,
    roiValue,
    proactiveInsight, proactiveInsightLoading,
    askAi,
  } = useChat(chatDeps);

  // ── UI-only state ──
  const clientNavigate = useNavigate();
  const tab: ClientTab = (() => {
    const t = initialTab;
    if (t === 'search' || t === 'analytics') return 'performance' as ClientTab;
    if (t && ['overview','performance','health','strategy','inbox','approvals','requests','content','plans','roi','content-plan'].includes(t)) return t as ClientTab;
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
  const [captureEmail, setCaptureEmail] = useState('');
  const [captureName, setCaptureName] = useState('');
  const [captureSubmitting, setCaptureSubmitting] = useState(false);
  const emailGateChecked = useRef(false);

  // Check if email gate is needed after shared-password auth
  useEffect(() => {
    if (!authenticated || clientUser || emailGateChecked.current) return;
    emailGateChecked.current = true;
    // Only gate shared-password visitors who haven't provided email
    if (ws?.requiresPassword) {
      try {
        const stored = localStorage.getItem(`portal_email_${workspaceId}`);
        if (!stored) setEmailGateOpen(true);
      } catch { /* skip */ }
    }
  }, [authenticated, clientUser, ws, workspaceId]);

  const submitEmailCapture = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!captureEmail.trim() || captureSubmitting) return;
    setCaptureSubmitting(true);
    try {
      await post(`/api/public/capture-email/${workspaceId}`, { email: captureEmail.trim(), name: captureName.trim() || undefined });
      localStorage.setItem(`portal_email_${workspaceId}`, captureEmail.trim());
    } catch { /* best-effort */ }
    setCaptureSubmitting(false);
    setEmailGateOpen(false);
  }, [captureEmail, captureName, captureSubmitting, workspaceId]);

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
    'audit:complete': () => {
      getOptional<{ id?: string }>(`/api/public/audit-summary/${workspaceId}`).then(a => { if (a?.id) setAudit(a); }).catch(() => {});
      refetchClient('activity', `/api/public/activity/${workspaceId}?limit=20`);
    },
    'workspace:updated': () => {
      getOptional<WorkspaceInfo>(`/api/public/workspace/${workspaceId}`).then(data => { if (data?.id) setWs(data); }).catch(() => {});
    },
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
          const am = await getOptional<{ hasClientUsers?: boolean }>(`/api/public/auth-mode/${workspaceId}`);
          if (am) {
            setAuthMode(am);
            setLoginTab(am.hasClientUsers ? 'user' : 'password');
          }
        } catch { /* ignore */ }

        // Check if already authenticated via client user JWT cookie
        let autoAuthed = false;
        let resolvedUserId: string | undefined;
        try {
          const meData = await getOptional<{ user?: { id: string; email: string; name: string } }>(`/api/public/client-me/${workspaceId}`);
          if (meData?.user) {
            setClientUser(meData.user);
            resolvedUserId = meData.user.id;
            setAuthenticated(true);
            autoAuthed = true;
            loadDashboardData(data, setPricingData);
          }
        } catch { /* ignore */ }

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
      .catch((err) => { setError(err instanceof ApiError && err.status === 403 ? 'This dashboard is currently unavailable. Please contact hmpsn studio for access.' : 'Failed to load dashboard'); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);


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

          {/* Mode switch link when both modes are available */}
          {showsBothModes && loginTab === 'password' && (
            <button onClick={() => { setLoginTab('user'); setAuthError(''); }}
              className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 mb-4 transition-colors">
              Sign in with your email instead
            </button>
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
                      await post(`/api/public/forgot-password/${workspaceId}`, { email: forgotEmail.trim(), turnstileToken: turnstileTokenRef.current });
                      setForgotSent(true);
                    } catch (err) { setAuthError(err instanceof Error ? err.message : 'Something went wrong'); setTurnstileReset(r => r + 1); }
                    setAuthLoading(false);
                  }} className="space-y-3">
                    <p className="text-xs text-zinc-400 text-center">Enter your email and we'll send you a link to reset your password.</p>
                    <input type="email" value={forgotEmail} onChange={e => { setForgotEmail(e.target.value); setAuthError(''); }}
                      placeholder="Email address" autoFocus
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors" />
                    <TurnstileWidget onToken={(t) => { turnstileTokenRef.current = t; }} resetTrigger={turnstileReset} />
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
                      await post('/api/public/reset-password', { token: resetToken, newPassword: resetPassword });
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
              <TurnstileWidget onToken={(t) => { turnstileTokenRef.current = t; }} resetTrigger={turnstileReset} />
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
              {showsBothModes && (
                <button type="button" onClick={() => { setLoginTab('password'); setAuthError(''); }}
                  className="w-full py-1 text-xs text-zinc-500 hover:text-zinc-400 transition-colors">
                  Have a shared password instead?
                </button>
              )}
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

  // Email capture gate UI — shown after password auth, before dashboard
  if (emailGateOpen && authenticated && !clientUser) return (
    <div className="min-h-screen bg-[#0f1219] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-8 shadow-2xl shadow-black/40">
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center mb-4">
              <Mail className="w-6 h-6 text-teal-400" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-200">Welcome to {ws?.name}</h2>
            <p className="text-xs text-zinc-500 mt-1 text-center">Enter your email to receive performance reports and important updates about your site.</p>
          </div>
          <form onSubmit={submitEmailCapture} className="space-y-3">
            <input
              type="text"
              value={captureName}
              onChange={e => setCaptureName(e.target.value)}
              placeholder="Your name (optional)"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
            />
            <input
              type="email"
              value={captureEmail}
              onChange={e => setCaptureEmail(e.target.value)}
              placeholder="Your email address"
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
              autoFocus
            />
            <button
              type="submit"
              disabled={captureSubmitting || !captureEmail.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
            >
              {captureSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Continue to Dashboard'}
            </button>
            <button
              type="button"
              onClick={() => { setEmailGateOpen(false); try { localStorage.setItem(`portal_email_${workspaceId}`, '__skipped__'); } catch {/* skip */} }}
              className="w-full text-center text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Skip for now
            </button>
          </form>
        </div>
      </div>
    </div>
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
    ...(isPaid ? [{ id: 'content-plan' as ClientTab, label: 'Content Plan', icon: Layers, locked: false }] : []),
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
                  <button key={d} onClick={() => changeDays(d, ws)}
                    className={`px-3 py-2 min-h-[44px] rounded-md text-xs font-medium transition-colors ${!customDateRange && days === d ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    {d >= 365 ? '1y' : d >= 180 ? '6mo' : `${d}d`}
                    {!customDateRange && days === d && <span className="block text-[9px] text-zinc-400 font-normal">vs prev {d >= 365 ? '1y' : d >= 180 ? '6mo' : `${d}d`}</span>}
                  </button>
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
                  <div className="fixed inset-0 z-40 sm:bg-transparent bg-black/50" onClick={() => setShowDatePicker(false)} />
                  <div className="fixed sm:absolute inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 z-50 bg-zinc-900 border-t sm:border border-zinc-700 rounded-t-2xl sm:rounded-xl shadow-2xl p-4 sm:w-72"
                    onClick={e => e.stopPropagation()}>
                    <div className="sm:hidden w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-3" />
                    <p className="text-xs font-medium text-zinc-400 mb-3">Custom date range</p>
                    <div className="space-y-2">
                      <label className="block">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Start date</span>
                        <input type="date" ref={customStartRef}
                          defaultValue={customDateRange?.startDate || new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0]}
                          max={new Date().toISOString().split('T')[0]}
                          className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm sm:text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">End date</span>
                        <input type="date" ref={customEndRef}
                          defaultValue={customDateRange?.endDate || new Date().toISOString().split('T')[0]}
                          max={new Date().toISOString().split('T')[0]}
                          className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm sm:text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
                        />
                      </label>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button onClick={() => setShowDatePicker(false)}
                        className="flex-1 px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
                        Cancel
                      </button>
                      <button onClick={() => {
                        const s = customStartRef.current?.value;
                        const e = customEndRef.current?.value;
                        if (s && e && s <= e) applyCustomRange(s, e, ws);
                      }}
                        className="flex-1 px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-medium transition-colors">
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
          <nav role="tablist" className="flex items-center gap-1 -mb-px overflow-x-auto scrollbar-none"
            onKeyDown={(e) => {
              const unlocked = NAV.filter(n => !n.locked);
              const idx = unlocked.findIndex(n => n.id === tab);
              if (e.key === 'ArrowRight' && idx < unlocked.length - 1) { setTab(unlocked[idx + 1].id); e.preventDefault(); }
              if (e.key === 'ArrowLeft' && idx > 0) { setTab(unlocked[idx - 1].id); e.preventDefault(); }
            }}>
            {NAV.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              const hasData = (t.id === 'overview') ||
                (t.id === 'performance' && !!(overview || ga4Overview)) ||
                (t.id === 'health' && !!audit) ||
                (t.id === 'inbox');
              const pendingReviews = contentRequests.filter(r => r.status === 'client_review').length;
              return (
                <button key={t.id} role="tab" aria-selected={active} tabIndex={active ? 0 : -1}
                  onClick={() => t.locked ? setShowUpgradeModal(true) : setTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                    t.locked ? 'border-transparent text-zinc-500 cursor-default' :
                    active ? 'border-teal-500 text-teal-300' :
                    'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                  }`}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                  {t.locked && <Lock className="w-3 h-3 ml-0.5 text-zinc-500" />}
                  {t.id === 'inbox' && (pendingApprovals + pendingReviews + unreadTeamNotes) > 0 && <span className="ml-1 px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-teal-500 text-white flex-shrink-0 min-w-[20px] text-center leading-tight">{pendingApprovals + pendingReviews + unreadTeamNotes}</span>}
                  {!t.locked && hasData && !active && t.id !== 'inbox' && <span className="w-2 h-2 rounded-full bg-emerald-400/60" title="Data available" />}
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

        {/* SEO Education Tips — per-tab first-visit contextual tips */}
        <SeoEducationTip tab={tab} workspaceId={workspaceId} />

        {/* ════════════ OVERVIEW TAB ════════════ */}
        {tab === 'overview' && (
          <OverviewTab ws={ws!} overview={overview} searchComparison={searchComparison} trend={trend} ga4Overview={ga4Overview} ga4Trend={ga4Trend} ga4Comparison={ga4Comparison} ga4Organic={ga4Organic} ga4Conversions={ga4Conversions} ga4NewVsReturning={ga4NewVsReturning} audit={audit} auditDetail={auditDetail} strategyData={strategyData} insights={insights} contentRequests={contentRequests} requests={requests} approvalBatches={approvalBatches} activityLog={activityLog} pendingApprovals={pendingApprovals} unreadTeamNotes={unreadTeamNotes} eventDisplayName={eventDisplayName} isEventPinned={isEventPinned} workspaceId={workspaceId} onAskAi={askAi} onOpenChat={() => setChatOpen(true)} clientUser={clientUser} proactiveInsight={proactiveInsight} proactiveInsightLoading={proactiveInsightLoading} />
        )}

        {/* ════════════ PERFORMANCE TAB (Search + Analytics) ════════════ */}
        {tab === 'performance' && (
          <PerformanceTab overview={overview} searchComparison={searchComparison} trend={trend} annotations={annotations} rankHistory={rankHistory} latestRanks={latestRanks} insights={insights} ga4Overview={ga4Overview} ga4Comparison={ga4Comparison} ga4Trend={ga4Trend} ga4Devices={ga4Devices} ga4Pages={ga4Pages} ga4Sources={ga4Sources} ga4Organic={ga4Organic} ga4LandingPages={ga4LandingPages} ga4NewVsReturning={ga4NewVsReturning} ga4Conversions={ga4Conversions} ga4Events={ga4Events} ws={ws!} days={days} />
        )}

        {/* ════════════ SITE HEALTH TAB ════════════ */}
        {tab === 'health' && (<>
          <ErrorBoundary label="Site Health">
            <HealthTab audit={audit} auditDetail={auditDetail} liveDomain={ws.liveDomain} tier={effectiveTier} workspaceId={workspaceId} initialSeverity={(() => { const s = new URLSearchParams(window.location.search).get('severity'); return s && ['error','warning','info'].includes(s) ? s as 'error' | 'warning' | 'info' : 'all'; })()} onContentRequested={() => setToast({ message: 'Content improvement request created! Check the Content tab to track progress.', type: 'success' })} />
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
          <InboxTab workspaceId={workspaceId} effectiveTier={effectiveTier} approvalBatches={approvalBatches} approvalsLoading={approvalsLoading} pendingApprovals={pendingApprovals} setApprovalBatches={setApprovalBatches} loadApprovals={loadApprovals} requests={requests} requestsLoading={requestsLoading} clientUser={clientUser} loadRequests={loadRequests} contentRequests={contentRequests} setContentRequests={setContentRequests} briefPrice={briefPrice} fullPostPrice={fullPostPrice} fmtPrice={fmtPrice} setPricingModal={setPricingModal} pricingConfirming={pricingConfirming} setToast={setToast} />
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
          <div className={`fixed bg-zinc-900 border-zinc-800 shadow-2xl shadow-black/40 overflow-hidden z-50 flex flex-col transition-all duration-200 ${chatExpanded ? 'inset-y-0 right-0 w-full sm:w-[480px] border-l rounded-none' : 'bottom-6 right-6 w-96 max-h-[500px] rounded-2xl border'}`}>
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
                <button onClick={() => { setShowChatHistory(!showChatHistory); if (!showChatHistory && ws) { getSafe<Array<{ id: string; title: string; messageCount: number; updatedAt: string }>>(`/api/public/chat-sessions/${ws.id}?channel=client`, []).then(d => { if (Array.isArray(d)) setChatSessions(d); }).catch(() => {}); } }}
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
                      if (ws) getOptional<{ messages?: Array<{ role: string; content: string }> }>(`/api/public/chat-sessions/${ws.id}/${s.id}`).then(d => {
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
                      <button key={i} onClick={() => askAi(q)} className="text-left px-3.5 py-3 min-h-[44px] rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 transition-colors">
                        <MessageSquare className="w-3 h-3 text-teal-400 mb-1" />{q}
                      </button>
                    ))}
                  </div>
                  <div className="pt-3 border-t border-zinc-800/50">
                    <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium mb-2">New to SEO? Ask the AI</p>
                    {LEARN_SEO_QUESTIONS.slice(0, 3).map((q, i) => (
                      <button key={`learn-${i}`} onClick={() => askAi(q)} className="w-full text-left px-3.5 py-2.5 min-h-[44px] rounded-lg hover:bg-emerald-500/5 border border-transparent hover:border-emerald-500/15 transition-colors text-[11px] text-emerald-400/70 hover:text-emerald-400">
                        💡 {q}
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
                        <button key={i} onClick={() => askAi(q)} className="w-full text-left px-3.5 py-2.5 min-h-[44px] rounded-lg bg-zinc-800/30 hover:bg-zinc-800/60 border border-zinc-800/50 text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors">
                          {q}
                        </button>
                      ))}
                      <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium mt-3">New to SEO?</p>
                      {LEARN_SEO_QUESTIONS.slice(0, 2).map((q, i) => (
                        <button key={`learn-${i}`} onClick={() => askAi(q)} className="w-full text-left px-3.5 py-2.5 min-h-[44px] rounded-lg hover:bg-emerald-500/5 border border-transparent hover:border-emerald-500/15 transition-colors text-[11px] text-emerald-400/70 hover:text-emerald-400">
                          💡 {q}
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
                <p className="text-[11px] text-amber-300/80 flex-1">
                  {roiValue && roiValue > 0
                    ? <>Your organic traffic is worth <span className="font-semibold text-emerald-400">${Math.round(roiValue).toLocaleString()}/mo</span> — unlock unlimited insights with Growth.</>
                    : <>You've used all {chatUsage.limit} free conversations this month. Upgrade to Growth for unlimited access.</>}
                </p>
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


        {/* ════════════ CONTENT PLAN TAB ════════════ */}
        {tab === 'content-plan' && (
          <ErrorBoundary label="Content Plan">
            <ContentPlanTab workspaceId={workspaceId} setToast={setToast} />
          </ErrorBoundary>
        )}

        {/* ════════════ PLANS TAB ════════════ */}
        {tab === 'plans' && (
          <PlansTab workspaceId={workspaceId} ws={ws} effectiveTier={effectiveTier} briefPrice={briefPrice} fullPostPrice={fullPostPrice} fmtPrice={fmtPrice} setToast={setToast} onOpenChat={() => setChatOpen(true)} pricingData={pricingData} />
        )}

        {/* ════════════ ROI TAB ════════════ */}
        {tab === 'roi' && (
          <ErrorBoundary label="ROI Dashboard">
            <ROIDashboard workspaceId={workspaceId} tier={effectiveTier} />
          </ErrorBoundary>
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
              {['Target keywords mapped to every page', 'Competitor keyword gap analysis', 'Content opportunity recommendations', `Ongoing strategy refinement by ${STUDIO_NAME}`].map(f => (
                <div key={f} className="flex items-center gap-2 text-xs text-zinc-300">
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
                  {f}
                </div>
              ))}
            </div>
            <button onClick={async () => {
              try {
                const data = await post<{ url?: string }>(`/api/public/upgrade-checkout/${workspaceId}`, { planId: 'premium' });
                if (data.url) window.location.href = data.url;
              } catch (err) {
                setToast({ message: err instanceof Error ? err.message : 'Upgrade failed. Please try again.', type: 'error' });
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
                  Pricing will be confirmed by {STUDIO_NAME} after submission.
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

      {/* Stripe Elements inline payment modal (lazy-loaded — Stripe SDK only fetched on payment) */}
      {!betaMode && stripePayment && (
        <Suspense fallback={<div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-teal-400" /></div>}>
          <LazyStripePaymentModal
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
              // Refresh content requests
              getSafe<unknown[]>(`/api/public/content-requests/${workspaceId}`, []).then(setContentRequests).catch(() => {});
            }}
            onClose={() => setStripePayment(null)}
          />
        </Suspense>
      )}

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
            } catch {
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
          <span className="text-[11px] text-zinc-700">Powered by hmpsn studio</span>
          <a href="https://hmpsn.studio" target="_blank" rel="noopener noreferrer" className="text-[11px] text-zinc-700 hover:text-zinc-500 transition-colors">hmpsn.studio</a>
        </div>
      </footer>
    </div>
    </CartProvider>
    </BetaProvider>
  );
}
