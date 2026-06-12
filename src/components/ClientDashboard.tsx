import { Suspense, useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { post, patch, getOptional } from '../api/client';
import { useNavigate } from 'react-router-dom';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { clientPath } from '../routes';
import { resolveClientTab, type ResolvedClientTab } from '../lib/client-dashboard-tab';
import { useRecommendations } from '../hooks/useRecommendations';
import { buildImpactBandsByCheck } from './client/client-dashboard/buildImpactBandsByCheck';
import {
  AlertTriangle,
  X,
  CheckCircle2,
  Clock, Sparkles,
} from 'lucide-react';
import { type Tier, Skeleton, OverviewSkeleton, ScannerReveal, Icon, Button, IconButton, PageHeader } from './ui';
import { STUDIO_NAME, STUDIO_URL } from '../constants';
import { CartProvider } from './client/useCart';
import { SeoCartDrawer } from './client/SeoCart';
import { OnboardingWizard } from './client/OnboardingWizard';
import { ClientOnboardingQuestionnaire, type OnboardingData } from './client/ClientOnboardingQuestionnaire';
import { SeoEducationTip } from './client/SeoEducationTip';
import { ErrorBoundary } from './ErrorBoundary';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import { queryKeys } from '../lib/queryKeys';
import { WS_EVENTS } from '../lib/wsEvents';
import { invalidateWorkspaceEventQueries } from '../lib/wsInvalidation';
// AnomalyAlerts removed from overview — insights digest covers trend signals
import { BetaProvider } from './client/BetaContext';
import { useClientAuth } from '../hooks/useClientAuth';
import { useClientSearch } from '../hooks/client/useClientSearch';
import { useClientGA4 } from '../hooks/client/useClientGA4';
import {
  useClientActivity,
  useClientRankHistory,
  useClientLatestRanks,
  useClientAnnotations,
  useClientAnomalies,
  useClientApprovals,
  useClientRequests,
  useClientContentRequests,
  useClientAuditSummary,
  useClientAuditDetail,
  useClientStrategy,
  useClientPricing,
  useClientContentPlan,
  useClientCopyEntries,
} from '../hooks/client/useClientQueries';
import { usePayments } from '../hooks/usePayments';
import { useToast } from '../hooks/useToast';
import { ClientAuthGate } from './client/ClientAuthGate';
import { EmailCaptureGate } from './client/EmailCaptureGate';
import { ClientChatWidget, type ClientChatWidgetApi } from './client/ClientChatWidget';
import { ClientHeader } from './client/ClientHeader';
import { UpgradeModal } from './client/UpgradeModal';
import { PricingConfirmationModal } from './client/PricingConfirmationModal';
import { ClientDashboardTabContent } from './client/client-dashboard/ClientDashboardTabContent';
import { buildClientDashboardNav, hasClientTabData } from './client/client-dashboard/clientDashboardNav';
import { useClientWorkspaceBootstrap } from './client/client-dashboard/useClientWorkspaceBootstrap';
import {
  type BusinessProfile,
  type WorkspaceInfo,
  type ClientTab,
  type ClientContentRequest,
} from './client/types';
import type { AnalyticsDateRange } from '../../shared/types/analytics-contract.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization';

const HealthTab = lazyWithRetry(() => import('./client/HealthTab').then(m => ({ default: m.HealthTab })));
const InsightsEngine = lazyWithRetry(() => import('./client/InsightsEngine').then(m => ({ default: m.InsightsEngine })));
const ROIDashboard = lazyWithRetry(() => import('./client/ROIDashboard').then(m => ({ default: m.ROIDashboard })));
const PlansTab = lazyWithRetry(() => import('./client/PlansTab').then(m => ({ default: m.PlansTab })));
const ContentPlanTab = lazyWithRetry(() => import('./client/ContentPlanTab').then(m => ({ default: m.ContentPlanTab })));
const StrategyTab = lazyWithRetry(() => import('./client/StrategyTab').then(m => ({ default: m.StrategyTab })));
const PerformanceTab = lazyWithRetry(() => import('./client/PerformanceTab').then(m => ({ default: m.PerformanceTab })));
const InboxTab = lazyWithRetry(() => import('./client/InboxTab').then(m => ({ default: m.InboxTab })));
const OverviewTab = lazyWithRetry(() => import('./client/OverviewTab').then(m => ({ default: m.OverviewTab })));
const BrandTab = lazyWithRetry(() => import('./client/BrandTab').then(m => ({ default: m.BrandTab })));

function ClientTabFallback() {
  return <OverviewSkeleton />;
}

function LazyClientTabPanel({ children }: { children: ReactNode }) {
  return <Suspense fallback={<ClientTabFallback />}>{children}</Suspense>;
}

export function ClientDashboard({ workspaceId, betaMode = false, initialTab }: { workspaceId: string; betaMode?: boolean; initialTab?: string }) {
  const queryClient = useQueryClient();
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

  // ── Dashboard data state + React Query hooks ──
  const [ws, setWs] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestedTopicsSeed, setRequestedTopics] = useState<Set<string>>(new Set());
  const [, setRequestingTopic] = useState<string | null>(null);
  const [days, setDays] = useState(28);
  const [customDateRange, setCustomDateRange] = useState<AnalyticsDateRange | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dataEnabled, setDataEnabled] = useState(false);
  const [dismissedTrialBannerKey, setDismissedTrialBannerKey] = useState<string | null>(null);

  const dateRange = customDateRange ?? undefined;
  const search = useClientSearch(workspaceId, days, dateRange, dataEnabled && !!ws?.gscPropertyUrl);
  const ga4Data = useClientGA4(workspaceId, days, dateRange, dataEnabled && !!ws?.ga4PropertyId);
  const activityQ = useClientActivity(workspaceId, dataEnabled);
  const rankHistoryQ = useClientRankHistory(workspaceId, dataEnabled);
  const latestRanksQ = useClientLatestRanks(workspaceId, dataEnabled);
  const annotationsQ = useClientAnnotations(workspaceId, dataEnabled);
  const anomaliesQ = useClientAnomalies(workspaceId, dataEnabled);
  const approvalsQ = useClientApprovals(workspaceId, dataEnabled);
  const requestsQ = useClientRequests(workspaceId, dataEnabled);
  const contentReqQ = useClientContentRequests(workspaceId, dataEnabled);
  const auditSummaryQ = useClientAuditSummary(workspaceId, dataEnabled);
  const auditDetailQ = useClientAuditDetail(workspaceId, dataEnabled);
  const strategyQ = useClientStrategy(workspaceId, dataEnabled);
  const pricingQ = useClientPricing(workspaceId, dataEnabled);
  const contentPlanQ = useClientContentPlan(workspaceId, dataEnabled);
  const copyEntriesQ = useClientCopyEntries(workspaceId, dataEnabled);

  // ── Recommendations → impact-bands-by-check adapter (R1-A → R1-B seam) ──
  // Shares the React Query cache with InsightsEngine / OverviewTab — no extra
  // network request when those components are already mounted on the same page.
  // gated on dataEnabled so it doesn't fire before workspace auth completes.
  const { recs: clientRecs } = useRecommendations(dataEnabled ? workspaceId : undefined);
  const impactBandsByCheck = useMemo(
    () => buildImpactBandsByCheck(clientRecs),
    [clientRecs],
  );

  const contentRequests = useMemo(() => contentReqQ.data ?? [], [contentReqQ.data]);
  const requestedTopics = useMemo(() => {
    if (contentRequests.length === 0) return requestedTopicsSeed;
    return new Set(contentRequests.map(r => keywordComparisonKey(r.targetKeyword)).filter(Boolean));
  }, [contentRequests, requestedTopicsSeed]);

  const sectionErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (activityQ.error) errs.activity = 'Unable to load activity';
    if (latestRanksQ.error) errs.ranks = 'Unable to load ranking data';
    if (auditSummaryQ.error) errs.audit = 'Unable to load site health data';
    if (approvalsQ.error) errs.approvals = 'Unable to load approvals';
    if (requestsQ.error) errs.requests = 'Unable to load requests';
    if (contentReqQ.error) errs.content = 'Unable to load content requests';
    if (strategyQ.error) errs.strategy = 'Unable to load SEO strategy';
    if (search.error) errs.search = 'Unable to load search performance data';
    if (ga4Data.sectionError) errs.analytics = ga4Data.sectionError;
    return errs;
  }, [
    activityQ.error,
    latestRanksQ.error,
    auditSummaryQ.error,
    approvalsQ.error,
    requestsQ.error,
    contentReqQ.error,
    strategyQ.error,
    search.error,
    ga4Data.sectionError,
  ]);

  const setContentRequests = useCallback((val: ClientContentRequest[] | ((prev: ClientContentRequest[]) => ClientContentRequest[])) => {
    queryClient.setQueryData(queryKeys.client.contentRequests(workspaceId), (prev: ClientContentRequest[] | undefined) => {
      return typeof val === 'function' ? val(prev ?? []) : val;
    });
  }, [queryClient, workspaceId]);

  const loadDashboardData = useCallback((data: WorkspaceInfo) => {
    setWs(data);
    setDataEnabled(true);
  }, []);

  const loadRequests = useCallback((_wsId: string) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.client.requests(workspaceId) });
  }, [queryClient, workspaceId]);

  const changeDays = useCallback((d: number, _currentWs: WorkspaceInfo | null) => {
    setDays(d);
    setCustomDateRange(null);
    setShowDatePicker(false);
  }, []);

  const applyCustomRange = useCallback((startDate: string, endDate: string, _currentWs: WorkspaceInfo | null) => {
    const spanDays = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
    setCustomDateRange({ startDate, endDate });
    setDays(spanDays);
    setShowDatePicker(false);
  }, []);

  const invalidateClientEvent = useCallback((eventName: typeof WS_EVENTS[keyof typeof WS_EVENTS], data?: unknown) => {
    invalidateWorkspaceEventQueries(queryClient, eventName, workspaceId, data, 'client-dashboard');
  }, [queryClient, workspaceId]);

  const overview = search.overview;
  const trend = search.trend;
  const searchComparison = search.comparison;
  const audit = auditSummaryQ.data ?? null;
  const auditDetail = auditDetailQ.data ?? null;
  const strategyData = strategyQ.data ?? null;
  const ga4Overview = ga4Data.ga4Overview;
  const ga4Trend = ga4Data.ga4Trend;
  const ga4Pages = ga4Data.ga4Pages;
  const ga4Sources = ga4Data.ga4Sources;
  const ga4Devices = ga4Data.ga4Devices;
  const ga4Countries = ga4Data.ga4Countries;
  const ga4Events = ga4Data.ga4Events;
  const ga4Conversions = ga4Data.ga4Conversions;
  const ga4Comparison = ga4Data.ga4Comparison;
  const ga4NewVsReturning = ga4Data.ga4NewVsReturning;
  const ga4Organic = ga4Data.ga4Organic;
  const ga4LandingPages = ga4Data.ga4LandingPages;
  const searchDataUpdatedAt = search.dataUpdatedAt;
  const ga4DataUpdatedAt = ga4Data.dataUpdatedAt;
  const anomalies = anomaliesQ.data ?? [];
  const approvalBatches = approvalsQ.data ?? [];
  const activityLog = activityQ.data ?? [];
  const rankHistory = rankHistoryQ.data ?? [];
  const latestRanks = latestRanksQ.data ?? [];
  const annotations = annotationsQ.data ?? [];
  const requests = requestsQ.data ?? [];
  const requestsLoading = requestsQ.isLoading;
  const contentPlanSummary = contentPlanQ.data?.summary ?? null;
  const contentPlanKeywords = contentPlanQ.data?.keywords ?? new Map<string, string>();
  const hasCopyEntries = (copyEntriesQ.data ?? 0) > 0;

  // ── UI-only state (declared early — needed by hooks below) ──
  const { toast, setToast, clearToast } = useToast();

  // ── Payments hook ──
  const {
    pricingModal, setPricingModal,
    pricingConfirming, pricingData, setPricingData,
    stripePayment, setStripePayment,
    confirmPricingAndSubmit,
  } = usePayments(workspaceId, ws, setToast, setContentRequests, setRequestedTopics, setRequestingTopic);

  useEffect(() => {
    if (pricingQ.data) {
      setPricingData(pricingQ.data);
    }
  }, [pricingQ.data, setPricingData]);

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
  } = useClientAuth(workspaceId, ws, loadDashboardData, () => turnstileTokenRef.current, () => setTurnstileReset((r: number) => r + 1));

  // Active tab — resolved from the route. Lifted above chatDeps so the chat
  // widget can send it as the `currentTab` hint (E4 server-side grounding).
  const initialTabId = initialTab?.split('/')[0];
  const tab: ResolvedClientTab = resolveClientTab(initialTabId);

  // ── Chat deps (passed to ClientChatWidget which owns the useChat call) ──
  const chatDeps = useMemo(() => ({
    ws, overview, trend, ga4Overview, ga4Pages, ga4Sources, ga4Devices,
    ga4Countries, ga4Events, ga4Conversions, searchComparison, ga4Comparison,
    ga4NewVsReturning, ga4Organic, audit, auditDetail, strategyData,
    latestRanks, activityLog, annotations, approvalBatches, requests,
    anomalies, days, betaMode, currentTab: tab,
    effectiveTier: (betaMode ? 'premium' : ((ws?.tier as import('./ui').Tier) || 'free')) as import('./ui').Tier,
  }), [ws, overview, trend, ga4Overview, ga4Pages, ga4Sources, ga4Devices,
    ga4Countries, ga4Events, ga4Conversions, searchComparison, ga4Comparison,
    ga4NewVsReturning, ga4Organic, audit, auditDetail, strategyData,
    latestRanks, activityLog, annotations, approvalBatches, requests,
    anomalies, days, betaMode, tab]);

  // API surface bubbled up from ClientChatWidget for cross-component usage
  const [chatApi, setChatApi] = useState<ClientChatWidgetApi | null>(null);

  // ── UI-only state ──
  const clientNavigate = useNavigate();
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
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.ACTIVITY_NEW]: () => invalidateClientEvent(WS_EVENTS.ACTIVITY_NEW),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.APPROVAL_UPDATE]: () => invalidateClientEvent(WS_EVENTS.APPROVAL_UPDATE),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.APPROVAL_APPLIED]: () => invalidateClientEvent(WS_EVENTS.APPROVAL_APPLIED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.CLIENT_ACTION_UPDATE]: () => invalidateClientEvent(WS_EVENTS.CLIENT_ACTION_UPDATE),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.WORK_ORDER_UPDATE]: () => invalidateClientEvent(WS_EVENTS.WORK_ORDER_UPDATE),
    // ws-invalidation-ok — client dashboard keeps work-order comments fresh even when Inbox is not mounted
    [WS_EVENTS.WORK_ORDER_COMMENT]: (data: unknown) => invalidateClientEvent(WS_EVENTS.WORK_ORDER_COMMENT, data),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.REQUEST_CREATED]: () => invalidateClientEvent(WS_EVENTS.REQUEST_CREATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.REQUEST_UPDATE]: () => invalidateClientEvent(WS_EVENTS.REQUEST_UPDATE),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.CONTENT_REQUEST_CREATED]: () => invalidateClientEvent(WS_EVENTS.CONTENT_REQUEST_CREATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.CONTENT_REQUEST_UPDATE]: () => invalidateClientEvent(WS_EVENTS.CONTENT_REQUEST_UPDATE),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.BRIEF_UPDATED]: () => invalidateClientEvent(WS_EVENTS.BRIEF_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.CONTENT_UPDATED]: () => invalidateClientEvent(WS_EVENTS.CONTENT_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED]: () => invalidateClientEvent(WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED]: () => invalidateClientEvent(WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.CONTENT_SUBSCRIPTION_RENEWED]: () => invalidateClientEvent(WS_EVENTS.CONTENT_SUBSCRIPTION_RENEWED),
    // ws-invalidation-ok — client dashboard keeps unified-inbox cache fresh even when the inbox tab is not mounted
    [WS_EVENTS.DELIVERABLE_SENT]: () => invalidateClientEvent(WS_EVENTS.DELIVERABLE_SENT),
    // ws-invalidation-ok — client dashboard keeps unified-inbox cache fresh even when the inbox tab is not mounted
    [WS_EVENTS.DELIVERABLE_UPDATED]: () => invalidateClientEvent(WS_EVENTS.DELIVERABLE_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.COPY_SECTION_UPDATED]: () => invalidateClientEvent(WS_EVENTS.COPY_SECTION_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.POST_UPDATED]: () => invalidateClientEvent(WS_EVENTS.POST_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.AUDIT_COMPLETE]: () => invalidateClientEvent(WS_EVENTS.AUDIT_COMPLETE),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.WORKSPACE_UPDATED]: () => {
      getOptional<WorkspaceInfo>(`/api/public/workspace/${workspaceId}`).then(data => { if (data?.id) setWs(data); }).catch((err) => { console.error('ClientDashboard operation failed:', err); });
      invalidateClientEvent(WS_EVENTS.WORKSPACE_UPDATED);
    },
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.PAGE_STATE_UPDATED]: () => invalidateClientEvent(WS_EVENTS.PAGE_STATE_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.RECOMMENDATIONS_UPDATED]: () => invalidateClientEvent(WS_EVENTS.RECOMMENDATIONS_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.BRIEFING_PUBLISHED]: () => invalidateClientEvent(WS_EVENTS.BRIEFING_PUBLISHED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.STRATEGY_UPDATED]: () => invalidateClientEvent(WS_EVENTS.STRATEGY_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.RANK_TRACKING_UPDATED]: () => invalidateClientEvent(WS_EVENTS.RANK_TRACKING_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.OUTCOME_SCORED]: () => invalidateClientEvent(WS_EVENTS.OUTCOME_SCORED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.OUTCOME_EXTERNAL_DETECTED]: () => invalidateClientEvent(WS_EVENTS.OUTCOME_EXTERNAL_DETECTED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.OUTCOME_LEARNINGS_UPDATED]: () => invalidateClientEvent(WS_EVENTS.OUTCOME_LEARNINGS_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.OUTCOME_ACTION_RECORDED]: () => invalidateClientEvent(WS_EVENTS.OUTCOME_ACTION_RECORDED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED]: () => invalidateClientEvent(WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.INSIGHT_BRIDGE_UPDATED]: () => invalidateClientEvent(WS_EVENTS.INSIGHT_BRIDGE_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.INSIGHT_RESOLVED]: () => invalidateClientEvent(WS_EVENTS.INSIGHT_RESOLVED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.CONTENT_PUBLISHED]: () => invalidateClientEvent(WS_EVENTS.CONTENT_PUBLISHED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.INTELLIGENCE_CACHE_UPDATED]: () => invalidateClientEvent(WS_EVENTS.INTELLIGENCE_CACHE_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED]: () => invalidateClientEvent(WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.ANNOTATION_BRIDGE_CREATED]: () => invalidateClientEvent(WS_EVENTS.ANNOTATION_BRIDGE_CREATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.ANOMALIES_UPDATE]: () => invalidateClientEvent(WS_EVENTS.ANOMALIES_UPDATE),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.SCHEMA_PLAN_SENT]: () => invalidateClientEvent(WS_EVENTS.SCHEMA_PLAN_SENT),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.SCHEMA_PLAN_UPDATED]: () => invalidateClientEvent(WS_EVENTS.SCHEMA_PLAN_UPDATED),
    // ws-invalidation-ok — client dashboard owns client-side cache invalidation; admin hook is not mounted on /client routes
    [WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED]: () => invalidateClientEvent(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED),
    // ws-invalidation-ok — R2-B agency work feed: job events refresh the live-now jobs section
    [WS_EVENTS.JOB_CREATED]: () => invalidateClientEvent(WS_EVENTS.JOB_CREATED),
    // ws-invalidation-ok — R2-B agency work feed: job events refresh the live-now jobs section
    [WS_EVENTS.JOB_UPDATED]: () => invalidateClientEvent(WS_EVENTS.JOB_UPDATED),
  }, wsIdentity);

  // ── Load workspace info first (includes requiresPassword flag) ──
  useClientWorkspaceBootstrap({
    workspaceId,
    loadDashboardData,
    setWs,
    setLoading,
    setError,
    setShowOnboarding,
    setShowWelcome,
    setResetToken,
    setLoginView,
    setToast,
    setAuthMode,
    setLoginTab,
    setClientUser,
    setAuthenticated,
  });


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
    <div className="client-typography min-h-screen bg-[var(--surface-1)] text-[var(--brand-text)]">
      <header className="border-b border-[var(--brand-border)]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <Skeleton className="h-6 w-24" />
          <div className="w-px h-8 bg-[var(--brand-border)]" />
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
    <div className="client-typography min-h-screen bg-[var(--surface-1)] flex items-center justify-center">
      <div className="text-center">
        <p className="text-accent-danger t-body mb-3">{error || 'Dashboard not found'}</p>
        <Button onClick={() => window.location.reload()} variant="secondary" size="sm">Try Again</Button>
      </div>
    </div>
  );

  // Password gate — smart login with auth mode detection
  if ((ws.requiresPassword || authMode?.hasClientUsers) && !authenticated) return (
    <div className="client-typography">
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
    </div>
  );

  const insights = getInsights();

  // Email capture gate UI — shown after password auth, before dashboard
  if (emailGateOpen && authenticated && !clientUser) return (
    <div className="client-typography">
      <EmailCaptureGate
        workspaceId={workspaceId}
        ws={ws}
        onComplete={() => setEmailGateOpen(false)}
        onSkip={() => setEmailGateOpen(false)}
      />
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
  // External-billing workspaces don't see Stripe-managed UI (Plans, Trial banners,
  // Upgrade modal, SEO services cart). Per-request actions still work via the
  // bypass path in usePayments + PricingConfirmationModal.
  const isExternalBilling = ws?.billingMode === 'external';
  const trialCountdownDays = ws.trialDaysRemaining ?? 0;
  const trialBannerDismissKey = `client-trial-banner-dismissed:${workspaceId}:${ws.trialEndsAt ?? 'unknown'}`;
  const isTrialBannerDismissed = dismissedTrialBannerKey === trialBannerDismissKey || (() => {
    try { return localStorage.getItem(trialBannerDismissKey) === '1'; } catch { return false; }
  })();
  const showTrialCountdownBanner = !betaMode
    && !isExternalBilling
    && ws.isTrial
    && trialCountdownDays <= 5
    && trialCountdownDays > 0
    && !isTrialBannerDismissed;
  const NAV = buildClientDashboardNav({
    ws,
    effectiveTier,
    betaMode,
    contentPlanSummary,
    strategyData,
  });

  const hasData = (tabId: ClientTab): boolean => hasClientTabData({
    tabId,
    overview,
    ga4Overview,
    audit,
    contentPlanSummary,
  });
  const activeNavItem = NAV.find(item => item.id === tab);
  const activeTabLabel = activeNavItem?.label ?? 'Dashboard';
  const ActiveTabIcon = activeNavItem?.icon ?? Sparkles;
  const activeTabSubtitle = tab === 'health' && auditDetail
    ? `${auditDetail.audit.totalPages} pages · Last scanned ${new Date(auditDetail.createdAt).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })}`
    : ws.name;

  return (
    <ErrorBoundary label="Client Dashboard">
    <BetaProvider value={betaMode}>
    <CartProvider>
    <div className={`client-typography min-h-screen overflow-x-hidden bg-[var(--surface-1)] text-[var(--brand-text)] ${theme === 'light' ? 'dashboard-light' : ''}`}>
      {!betaMode && !isExternalBilling && <SeoCartDrawer workspaceId={workspaceId} tier={effectiveTier} />}

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
        onShowTour={() => setShowWelcome(true)}
        setShowUpgradeModal={setShowUpgradeModal}
        pendingApprovals={pendingApprovals}
        unreadTeamNotes={unreadTeamNotes}
        hasCopyEntries={hasCopyEntries}
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
        <PageHeader
          title={activeTabLabel}
          subtitle={activeTabSubtitle}
          icon={<Icon as={ActiveTabIcon} size="lg" className="text-accent-brand" />}
        />

        {/* Trial countdown banner — shows at five days and under */}
        {showTrialCountdownBanner && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/8 border border-amber-500/20" style={{ borderRadius: 'var(--radius-signature)' }}>
            <Icon as={Clock} size="md" className="text-accent-warning flex-shrink-0" />
            <p className="t-body text-accent-warning flex-1">
              <strong>{trialCountdownDays} day{trialCountdownDays === 1 ? '' : 's'}</strong> left on your Growth trial.
              {' '}Choose a plan to keep access to all features.
            </p>
            <Button size="sm" onClick={() => setTab('plans')}>View Plans</Button>
            <IconButton
              icon={X}
              label="Dismiss trial reminder"
              size="sm"
              variant="ghost"
              onClick={() => {
                try { localStorage.setItem(trialBannerDismissKey, '1'); } catch (err) { console.error('ClientDashboard operation failed:', err); }
                setDismissedTrialBannerKey(trialBannerDismissKey);
              }}
            />
          </div>
        )}
        {!betaMode && !isExternalBilling && ws.isTrial && (ws.trialDaysRemaining ?? 0) === 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-500/8 border border-red-500/20" style={{ borderRadius: 'var(--radius-signature)' }}>
            <Icon as={Clock} size="md" className="text-accent-danger flex-shrink-0" />
            <p className="t-body text-accent-danger">
              Your Growth trial has ended. Some features are now limited.
              {' '}Upgrade to restore full access.
            </p>
          </div>
        )}

        {/* Section loading errors */}
        {Object.keys(sectionErrors).length > 0 && (
          <div className="flex items-start gap-3 px-4 py-3 bg-red-500/8 border border-red-500/15" style={{ borderRadius: 'var(--radius-signature)' }}>
            <Icon as={AlertTriangle} size="md" className="text-accent-danger flex-shrink-0 mt-0.5" />
            <div className="t-body text-accent-danger space-y-0.5">
              {Object.values(sectionErrors).map((msg, i) => <p key={i}>{msg} — try refreshing the page.</p>)}
            </div>
          </div>
        )}

        {/* SEO Education Tips — per-tab first-visit contextual tips */}
        <SeoEducationTip tab={tab} workspaceId={workspaceId} />

        <ClientDashboardTabContent
          tab={tab}
          chatWidget={(
            <ClientChatWidget
              chatDeps={chatDeps}
              betaMode={betaMode}
              workspaceId={workspaceId}
              ws={ws}
              onApiChange={api => setChatApi(api)}
            />
          )}
          panels={{
            overview: (
              <LazyClientTabPanel>
                <OverviewTab ws={ws!} overview={overview} searchComparison={searchComparison} trend={trend} ga4Overview={ga4Overview} ga4Trend={ga4Trend} ga4Comparison={ga4Comparison} ga4Organic={ga4Organic} ga4Conversions={ga4Conversions} ga4NewVsReturning={ga4NewVsReturning} searchDataUpdatedAt={searchDataUpdatedAt} ga4DataUpdatedAt={ga4DataUpdatedAt} audit={audit} auditDetail={auditDetail} strategyData={strategyData} insights={insights} contentRequests={contentRequests} requests={requests} approvalBatches={approvalBatches} activityLog={activityLog} pendingApprovals={pendingApprovals} unreadTeamNotes={unreadTeamNotes} eventDisplayName={eventDisplayName} isEventPinned={isEventPinned} workspaceId={workspaceId} onAskAi={chatApi?.askAi ?? (() => Promise.resolve())} onOpenChat={() => chatApi?.openChat()} clientUser={clientUser} contentPlanSummary={contentPlanSummary} />
              </LazyClientTabPanel>
            ),
            performance: (
              <LazyClientTabPanel>
                <PerformanceTab overview={overview} searchComparison={searchComparison} trend={trend} annotations={annotations} rankHistory={rankHistory} latestRanks={latestRanks} insights={insights} searchDataUpdatedAt={searchDataUpdatedAt} ga4Overview={ga4Overview} ga4Comparison={ga4Comparison} ga4Trend={ga4Trend} ga4Devices={ga4Devices} ga4Pages={ga4Pages} ga4Sources={ga4Sources} ga4Organic={ga4Organic} ga4LandingPages={ga4LandingPages} ga4NewVsReturning={ga4NewVsReturning} ga4Conversions={ga4Conversions} ga4Events={ga4Events} ga4DataUpdatedAt={ga4DataUpdatedAt} ws={ws!} tier={effectiveTier} days={days} dateRange={dateRange} initialSubTab={initialTabId === 'analytics' || initialTabId === 'search' ? initialTabId : undefined} />
              </LazyClientTabPanel>
            ),
            health: (
              <LazyClientTabPanel>
                <ErrorBoundary label="Site Health">
                  <HealthTab audit={audit} auditDetail={auditDetail} liveDomain={ws.liveDomain} workspaceId={workspaceId} initialSeverity={(() => { const s = new URLSearchParams(window.location.search).get('severity'); return s && ['error', 'warning', 'info'].includes(s) ? s as 'error' | 'warning' | 'info' : 'all'; })()} onContentRequested={() => setToast({ message: 'Content improvement request created! Check the Content tab to track progress.', type: 'success' })} tier={effectiveTier} hidePrices={isExternalBilling} impactBandsByCheck={impactBandsByCheck} actionPlanSlot={workspaceId && auditDetail ? (
                    <ErrorBoundary label="Action Plan">
                      <LazyClientTabPanel>
                        <InsightsEngine workspaceId={workspaceId} tier={effectiveTier} onNotify={(msg, type) => setToast({ message: msg, type: type === 'info' ? 'success' : type })} />
                      </LazyClientTabPanel>
                    </ErrorBoundary>
                  ) : undefined}
                  />
                </ErrorBoundary>
              </LazyClientTabPanel>
            ),
            strategy: (
              <LazyClientTabPanel>
                <StrategyTab strategyData={strategyData} requestedTopics={requestedTopics} contentRequests={contentRequests} effectiveTier={effectiveTier} briefPrice={briefPrice} fullPostPrice={fullPostPrice} fmtPrice={fmtPrice} setPricingModal={setPricingModal} contentPlanKeywords={contentPlanKeywords} onTabChange={(nextTab) => setTab(nextTab as ClientTab)} workspaceId={workspaceId} setToast={(msg: string) => setToast({ message: msg, type: 'success' })} hidePrices={isExternalBilling} />
              </LazyClientTabPanel>
            ),
            inbox: (
              <LazyClientTabPanel>
                <InboxTab workspaceId={workspaceId} effectiveTier={effectiveTier} requests={requests} requestsLoading={requestsLoading} clientUser={clientUser} loadRequests={loadRequests} contentRequests={contentRequests} setContentRequests={setContentRequests} briefPrice={briefPrice} fullPostPrice={fullPostPrice} fmtPrice={fmtPrice} setPricingModal={setPricingModal} pricingConfirming={pricingConfirming} setToast={setToast} hidePrices={isExternalBilling} />
              </LazyClientTabPanel>
            ),
            'content-plan': (
              <LazyClientTabPanel>
                <ErrorBoundary label="Content Plan">
                  <ContentPlanTab workspaceId={workspaceId} setToast={setToast} />
                </ErrorBoundary>
              </LazyClientTabPanel>
            ),
            plans: (
              <LazyClientTabPanel>
                <PlansTab workspaceId={workspaceId} ws={ws} effectiveTier={effectiveTier} briefPrice={briefPrice} fullPostPrice={fullPostPrice} fmtPrice={fmtPrice} setToast={setToast} onOpenChat={() => chatApi?.openChat()} pricingData={pricingData} hidePrices={isExternalBilling} />
              </LazyClientTabPanel>
            ),
            roi: (
              <LazyClientTabPanel>
                <ErrorBoundary label="ROI Dashboard">
                  <ROIDashboard workspaceId={workspaceId} tier={effectiveTier} />
                </ErrorBoundary>
              </LazyClientTabPanel>
            ),
            brand: (
              <LazyClientTabPanel>
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
              </LazyClientTabPanel>
            ),
          }}
        />

        </div>
        </ScannerReveal>
      </main>

      {/* ── SEO Upgrade Modal ── */}
      {!betaMode && !isExternalBilling && showUpgradeModal && (
        <UpgradeModal
          workspaceId={workspaceId}
          onClose={() => setShowUpgradeModal(false)}
          onError={(msg) => setToast({ message: msg, type: 'error' })}
        />
      )}

      {/* Pricing confirmation modal */}
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

      {/* Toast notification */}
      {/* z-index-ok — client toast must float above modal-backdrop but below cart */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-5 py-3 rounded-[var(--radius-xl)] border shadow-lg backdrop-blur-sm flex items-center gap-2.5 animate-[slideUp_0.3s_ease] ${toast.type === 'success' ? 'bg-emerald-500/15 border-emerald-500/30 text-accent-success' : 'bg-red-500/15 border-red-500/30 text-accent-danger'}`}>
          {toast.type === 'success' ? <Icon as={CheckCircle2} size="md" className="flex-shrink-0" /> : <Icon as={AlertTriangle} size="md" className="flex-shrink-0" />}
          <span className="t-caption font-medium">{toast.message}</span>
          <IconButton icon={X} label="Dismiss notification" size="sm" onClick={clearToast} className="ml-1" />
        </div>
      )}

      {/* Powered by footer */}
      <footer className="border-t border-[var(--brand-border)] mt-12">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="t-caption-sm text-[var(--brand-text-faint)]">Powered by {STUDIO_NAME}</span>
          <a href={STUDIO_URL} target="_blank" rel="noopener noreferrer" className="t-caption-sm text-[var(--brand-text-faint)] hover:text-[var(--brand-text-muted)] transition-colors">{STUDIO_NAME}</a>
        </div>
      </footer>
    </div>
    </CartProvider>
    </BetaProvider>
    </ErrorBoundary>
  );
}
