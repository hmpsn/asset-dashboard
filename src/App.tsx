import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { get, postForm } from './api/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { type Page, adminPath, clientPath, GLOBAL_TABS } from './routes';
import { StatusBar } from './components/StatusBar';
import { LoginScreen } from './components/LoginScreen';
import { MobileGuard } from './components/MobileGuard';
import { useAuth } from './hooks/useAuth';
import { useGlobalAdminEvents } from './hooks/useGlobalAdminEvents';
import { useWsInvalidation } from './hooks/useWsInvalidation';
import { ADMIN_EVENTS } from './lib/wsEvents';
import { useWorkspaces, useCreateWorkspace, useDeleteWorkspace, useLinkSite, useUnlinkSite, WORKSPACES_KEY, useHealthCheck, useQueue, QUEUE_KEY } from './hooks/admin';
import { useQueryClient } from '@tanstack/react-query';
import { ToastProvider } from './components/Toast';
import { BackgroundTaskProvider } from './hooks/useBackgroundTasks';
import { TaskPanel } from './components/TaskPanel';
import { AdminChat } from './components/AdminChat';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CommandPalette } from './components/CommandPalette';
import { Sidebar } from './components/layout/Sidebar';
import { Breadcrumbs } from './components/layout/Breadcrumbs';
import { ScannerReveal } from './components/ui/ScannerReveal';
import { FeatureFlag } from './components/ui/FeatureFlag';
import { EmptyState } from './components/ui/EmptyState';
import { TabBar } from './components/ui/TabBar';
import { Activity, Clipboard, Globe, Sparkles } from 'lucide-react';

// ── Lazy-loaded route-level chunks ──
const ClientDashboard = lazyWithRetry(() => import('./components/ClientDashboard').then(m => ({ default: m.ClientDashboard })));
const Styleguide = lazyWithRetry(() => import('./components/Styleguide').then(m => ({ default: m.Styleguide })));
const LandingPage = lazyWithRetry(() => import('./components/LandingPage').then(m => ({ default: m.LandingPage })));
const PageRewriteChat = lazyWithRetry(() => import('./components/PageRewriteChat').then(m => ({ default: m.PageRewriteChat })));

// ── Lazy-loaded admin tab chunks ──
const SettingsPanel = lazyWithRetry(() => import('./components/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const WorkspaceSettings = lazyWithRetry(() => import('./components/WorkspaceSettings').then(m => ({ default: m.WorkspaceSettings })));
const WorkspaceOverview = lazyWithRetry(() => import('./components/WorkspaceOverview').then(m => ({ default: m.WorkspaceOverview })));
const MediaTab = lazyWithRetry(() => import('./components/MediaTab').then(m => ({ default: m.MediaTab })));
const SeoAudit = lazyWithRetry(() => import('./components/SeoAudit').then(m => ({ default: m.SeoAudit })));
const AnalyticsHub = lazyWithRetry(() => import('./components/AnalyticsHub').then(m => ({ default: m.AnalyticsHub })));
const Performance = lazyWithRetry(() => import('./components/Performance').then(m => ({ default: m.Performance })));
const RequestManager = lazyWithRetry(() => import('./components/RequestManager').then(m => ({ default: m.RequestManager })));
const SalesReport = lazyWithRetry(() => import('./components/SalesReport').then(m => ({ default: m.SalesReport })));
const Roadmap = lazyWithRetry(() => import('./components/Roadmap').then(m => ({ default: m.Roadmap })));
const AIUsagePage = lazyWithRetry(() => import('./components/WorkspaceOverview').then(m => ({ default: m.AIUsageSection })));
const WorkspaceHome = lazyWithRetry(() => import('./components/WorkspaceHome').then(m => ({ default: m.WorkspaceHome })));

// ── Lazy-loaded SEO sub-tool chunks (split from SeoAudit #131) ──
const SeoEditorWrapper = lazyWithRetry(() => import('./components/SeoEditorWrapper').then(m => ({ default: m.SeoEditorWrapper })));
const KeywordStrategyPanel = lazyWithRetry(() => import('./components/KeywordStrategy').then(m => ({ default: m.KeywordStrategyPanel })));
const PageIntelligence = lazyWithRetry(() => import('./components/PageIntelligence').then(m => ({ default: m.PageIntelligence })));
const SchemaSuggester = lazyWithRetry(() => import('./components/SchemaSuggester').then(m => ({ default: m.SchemaSuggester })));
const ContentBriefs = lazyWithRetry(() => import('./components/ContentBriefs').then(m => ({ default: m.ContentBriefs })));
const ContentPerformance = lazyWithRetry(() => import('./components/ContentPerformance').then(m => ({ default: m.ContentPerformance })));
const LinksPanel = lazyWithRetry(() => import('./components/LinksPanel').then(m => ({ default: m.LinksPanel })));
const RankTracker = lazyWithRetry(() => import('./components/RankTracker').then(m => ({ default: m.RankTracker })));
const ContentManager = lazyWithRetry(() => import('./components/ContentManager').then(m => ({ default: m.ContentManager })));
const ContentSubscriptions = lazyWithRetry(() => import('./components/ContentSubscriptions').then(m => ({ default: m.ContentSubscriptions })));
const ContentPipeline = lazyWithRetry(() => import('./components/ContentPipeline').then(m => ({ default: m.ContentPipeline })));
const BrandHub = lazyWithRetry(() => import('./components/BrandHub').then(m => ({ default: m.BrandHub })));
const RevenueDashboard = lazyWithRetry(() => import('./components/RevenueDashboard').then(m => ({ default: m.RevenueDashboard })));
const FeatureLibrary = lazyWithRetry(() => import('./components/FeatureLibrary'));
const OutcomeDashboard = lazyWithRetry(() => import('./components/admin/outcomes/OutcomeDashboard'));
const OutcomesOverview = lazyWithRetry(() => import('./components/admin/outcomes/OutcomesOverview'));
const AdminInbox = lazyWithRetry(() => import('./components/admin/AdminInbox').then(m => ({ default: m.AdminInbox })));
const MeetingBriefPage = lazyWithRetry(() => import('./components/admin/MeetingBrief/MeetingBriefPage').then(m => ({ default: m.MeetingBriefPage })));
const DiagnosticReportPage = lazyWithRetry(() => import('./components/admin/DiagnosticReport/DiagnosticReportPage').then(m => ({ default: m.DiagnosticReportPage })));

function ChunkFallback() {
  return <div className="flex items-center justify-center py-24"><div className="w-6 h-6 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" /></div>;
}

export interface FixContext {
  /** Which admin route this fixContext is intended for (e.g. 'content-pipeline', 'seo-editor').
   *  REQUIRED — components check this before reacting. Without it, stale fixContext from one
   *  tab leaks into another. Making this required ensures TypeScript catches missing values
   *  at every navigation call site. */
  targetRoute: string;
  pageId?: string;
  pageSlug?: string;
  pageName?: string;
  issueCheck?: string;
  issueMessage?: string;
  // Brief generation context from Page Intelligence / Content Gaps
  primaryKeyword?: string;
  searchIntent?: string;
  optimizationScore?: number;
  optimizationIssues?: string[];
  recommendations?: string[];
  contentGaps?: string[];
  autoGenerate?: boolean;
  /** Suggested page type from content gaps (e.g. 'blog', 'service', 'landing'). */
  pageType?: string;
}

/** Client routes with backward-compat redirect: /client/:id?tab=X → /client/:id/X */
function ClientRoutes({ betaMode = false }: { betaMode?: boolean }) {
  const params = useParams<{ workspaceId: string; '*': string }>();
  const [searchParams] = useSearchParams();
  const workspaceId = params.workspaceId!;
  // Backward-compat: redirect old ?tab=X URLs to path-based
  const queryTab = searchParams.get('tab');
  if (queryTab && workspaceId) {
    const remaining = new URLSearchParams(searchParams);
    remaining.delete('tab');
    const qs = remaining.toString();
    return <Navigate to={clientPath(workspaceId, queryTab, betaMode) + (qs ? '?' + qs : '')} replace />;
  }
  const splatTab = params['*'] || undefined;
  return <ClientDashboard workspaceId={workspaceId} initialTab={splatTab} betaMode={betaMode} />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/welcome" element={<Suspense fallback={<ChunkFallback />}><LandingPage /></Suspense>} />
        <Route path="/styleguide" element={<Suspense fallback={<ChunkFallback />}><Styleguide /></Suspense>} />
        <Route path="/client/beta/:workspaceId/*" element={<MobileGuard><Suspense fallback={<ChunkFallback />}><ClientRoutes betaMode /></Suspense></MobileGuard>} />
        <Route path="/client/:workspaceId/*" element={<MobileGuard><Suspense fallback={<ChunkFallback />}><ClientRoutes /></Suspense></MobileGuard>} />
        <Route path="/*" element={<ToastProvider><BackgroundTaskProvider><AdminApp /></BackgroundTaskProvider></ToastProvider>} />
      </Routes>
    </BrowserRouter>
  );
}

function AdminApp() {
  const auth = useAuth();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('admin-theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; }
  });
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('admin-theme', next); } catch (err) { console.error('App operation failed:', err); }
  };

  if (auth.checking) {
    return <div className={`flex items-center justify-center h-screen bg-[#0f1219] ${theme === 'light' ? 'dashboard-light' : ''}`}><div className="w-6 h-6 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" /></div>;
  }
  if (auth.required && !auth.authenticated) {
    return <div className={theme === 'light' ? 'dashboard-light' : ''}><LoginScreen onLogin={auth.login} /></div>;
  }

  return <div className={theme === 'light' ? 'dashboard-light' : ''}><Dashboard onLogout={auth.logout} theme={theme} toggleTheme={toggleTheme} /><TaskPanel /></div>;
}

function Dashboard({ onLogout, theme, toggleTheme }: { onLogout?: () => void; theme: 'dark' | 'light'; toggleTheme: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Server state via React Query ──
  const { data: workspaces = [] } = useWorkspaces();
  const { data: health = { hasOpenAIKey: false, hasWebflowToken: false }, isSuccess: connected } = useHealthCheck();
  const { data: queue = [] } = useQueue();

  // Derive tab and workspace ID from URL path
  const { tab, urlWorkspaceId } = useMemo(() => {
    const p = location.pathname;
    const wsTabMatch = p.match(/^\/ws\/([^/]+)\/(.+)$/);
    if (wsTabMatch) return { tab: wsTabMatch[2] as Page, urlWorkspaceId: wsTabMatch[1] };
    const wsMatch = p.match(/^\/ws\/([^/]+)\/?$/);
    if (wsMatch) return { tab: 'home' as Page, urlWorkspaceId: wsMatch[1] };
    const globalMatch = p.match(/^\/([^/]+)\/?$/);
    if (globalMatch && GLOBAL_TABS.has(globalMatch[1])) return { tab: globalMatch[1] as Page, urlWorkspaceId: undefined as string | undefined };
    return { tab: 'home' as Page, urlWorkspaceId: undefined as string | undefined };
  }, [location.pathname]);

  const [fixContext, setFixContext] = useState<FixContext | null>(null);
  const clearFixContext = useCallback(() => setFixContext(null), []);
  const [rewritePageUrl, setRewritePageUrl] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  // Derived synchronously — prevents layout flash when navigating away (useEffect runs after paint)
  const effectiveFocusMode = focusMode && tab === 'rewrite';

  // Reset backing state when navigating away so returning to rewrite starts fresh
  useEffect(() => {
    if (tab !== 'rewrite') setFocusMode(false);
  }, [tab]);

  // Escape key exits focus mode (in addition to the sidebar strip click)
  useEffect(() => {
    if (!effectiveFocusMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't exit if the user is actively typing in any editable element
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return;
      setFocusMode(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [effectiveFocusMode]);

  // Read fixContext from router state (set by SeoAudit / KeywordStrategy navigate calls)
  useEffect(() => {
    const state = location.state as { fixContext?: FixContext } | null;
    if (state?.fixContext) {
      // Use setTimeout to avoid synchronous setState
      setTimeout(() => {
        setFixContext(state.fixContext || null);
        // Clear the state so it doesn't re-trigger on back/forward
        navigate(location.pathname + location.search, { replace: true, state: {} });
      }, 0);
    }
  }, [location.state, location.pathname, location.search, navigate]);

  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null);
  const [pendingContentRequests, setPendingContentRequests] = useState(0);
  const [requestsSubTab, setRequestsSubTab] = useState<'signals' | 'requests'>('signals');

  // Reset requests sub-tab when workspace changes so stale state doesn't persist
  useEffect(() => { setRequestsSubTab('signals'); }, [urlWorkspaceId]); // effect-layout-ok — state reset on workspace switch, not layout derivation

  // Derive selected workspace from URL + React Query data
  const selected = useMemo(() => {
    if (!urlWorkspaceId) return null;
    return workspaces.find(w => w.id === urlWorkspaceId) || null;
  }, [urlWorkspaceId, workspaces]);

  // Rewrite tab is always a full-height two-pane layout (independent scroll per pane).
  // Focus mode additionally hides the sidebar, but height containment is needed in both modes.
  const isFullHeightLayout = tab === 'rewrite' && !!selected;

  // Fetch badge counts via dedicated lightweight endpoint
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    get<{ pendingRequests: number; hasContent: boolean }>(`/api/workspace-badges/${selected.id}`)
      .then(badges => {
        if (cancelled) return;
        setPendingContentRequests(badges.pendingRequests);
      })
      .catch((err) => { console.error('App operation failed:', err); });
    return () => { cancelled = true; };
  }, [selected]);

  // Keyboard shortcuts (⌘1-5 for tabs, ⌘, for settings)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target as HTMLElement).isContentEditable) return;
      const tabMap: Record<string, Page> = { '1': 'home', '2': 'seo-audit', '3': 'analytics-hub' };
      if (tabMap[e.key] && selected) { e.preventDefault(); navigate(adminPath(selected.id, tabMap[e.key])); }
      if (e.key === ',') { e.preventDefault(); navigate('/settings'); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, navigate]);

  // Global clipboard paste handler (⌘V)
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (!selected) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
          const fileName = `clipboard-${Date.now()}.${ext}`;

          setClipboardStatus('Uploading...');

          const formData = new FormData();
          formData.append('file', blob, fileName);
          formData.append('fileName', fileName);

          try {
            const data = await postForm<{ fileName: string }>(`/api/upload/${selected.folder}/clipboard`, formData);
            setClipboardStatus(`Pasted: ${data.fileName} (resized 2x for HDPI)`);
            setTimeout(() => setClipboardStatus(null), 3000);
          } catch (err) {
      console.error('App operation failed:', err);
            setClipboardStatus('Paste failed');
            setTimeout(() => setClipboardStatus(null), 3000);
          }
          break;
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [selected]);

  // WebSocket → React Query invalidation
  const handleQueueUpdate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
  }, [queryClient]);

  const handleWorkspaceCreated = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY });
  }, [queryClient]);

  const handleWorkspaceDeleted = useCallback((data: unknown) => {
    const { id } = data as { id: string };
    queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY });
    if (urlWorkspaceId === id) navigate('/');
  }, [queryClient, urlWorkspaceId, navigate]);

  useGlobalAdminEvents({
    [ADMIN_EVENTS.QUEUE_UPDATE]: handleQueueUpdate,
    [ADMIN_EVENTS.WORKSPACE_CREATED]: handleWorkspaceCreated,
    [ADMIN_EVENTS.WORKSPACE_DELETED]: handleWorkspaceDeleted,
  });

  // Workspace-scoped WS events → cache invalidation
  useWsInvalidation(urlWorkspaceId);

  // Actions via React Query mutations
  const createMutation = useCreateWorkspace();
  const deleteMutation = useDeleteWorkspace();
  const linkMutation = useLinkSite();
  const unlinkMutation = useUnlinkSite();

  const handleCreate = async (name: string, siteId?: string, siteName?: string) => {
    const ws = await createMutation.mutateAsync({ name, webflowSiteId: siteId, webflowSiteName: siteName });
    navigate(adminPath(ws.id));
  };

  const handleDelete = async (id: string) => {
    await deleteMutation.mutateAsync(id);
    if (urlWorkspaceId === id) navigate('/');
  };

  const handleLinkSite = async (workspaceId: string, siteId: string, siteName: string, token?: string) => {
    await linkMutation.mutateAsync({ workspaceId, siteId, siteName, token });
  };

  const handleUnlinkSite = async (workspaceId: string) => {
    await unlinkMutation.mutateAsync(workspaceId);
  };

  const workspaceQueue = selected
    ? queue.filter(q => q.workspace === selected.folder)
    : queue;

  // ── Content renderer ──
  const SEO_TABS = new Set<Page>(['seo-audit', 'seo-editor', 'links', 'seo-strategy', 'seo-schema', 'seo-briefs', 'seo-ranks', 'content-perf', 'content', 'subscriptions', 'brand', 'content-pipeline']);
  const needsSite = !!(SEO_TABS.has(tab) || tab === 'analytics-hub' || tab === 'performance');
  const renderContent = () => {
    if (tab === 'settings') return <SettingsPanel />;
    if (tab === 'roadmap') return <Roadmap />;
    if (tab === 'workspace-settings' && selected) return <WorkspaceSettings key={`ws-settings-${selected.id}`} workspaceId={selected.id} workspaceName={selected.name} webflowSiteId={selected.webflowSiteId} webflowSiteName={selected.webflowSiteName} onUpdate={() => {
      queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY });
    }} />;
    if (tab === 'prospect') return <SalesReport />;
    if (tab === 'ai-usage') return <AIUsagePage />;
    if (tab === 'revenue') return <RevenueDashboard />;
    if (tab === 'features') return <FeatureLibrary />;
    if (tab === 'outcomes-overview') return <OutcomesOverview />;

    if (!selected) {
      return <WorkspaceOverview onSelectWorkspace={(id) => {
        navigate(adminPath(id));
      }} />;
    }

    if (needsSite && !selected.webflowSiteId) {
      return (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-900">
            <Globe className="w-5 h-5 text-zinc-500" />
          </div>
          <p className="text-sm text-zinc-500">Link a Webflow site to use this tool</p>
          <button onClick={() => navigate('/settings')} className="mt-3 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors bg-teal-500/10 text-teal-400">Go to Settings</button>
        </div>
      );
    }

    if (tab === 'home') return <WorkspaceHome key={`home-${selected.id}`} workspaceId={selected.id} workspaceName={selected.webflowSiteName || selected.name} webflowSiteId={selected.webflowSiteId} webflowSiteName={selected.webflowSiteName} gscPropertyUrl={selected.gscPropertyUrl} ga4PropertyId={selected.ga4PropertyId} />;
    // 'brief' kept for backward compat — WorkspaceHome tab is the primary discovery path
    if (tab === 'brief') return <MeetingBriefPage key={`brief-${selected.id}`} workspaceId={selected.id} />;
    if (tab === 'diagnostics') return (
      <FeatureFlag
        flag="deep-diagnostics"
        fallback={
          <EmptyState
            icon={Activity}
            title="Deep Diagnostics is rolling out"
            description="This feature is not yet available for your workspace. Check back soon."
          />
        }
      >
        <DiagnosticReportPage key={`diagnostics-${selected.id}`} workspaceId={selected.id} />
      </FeatureFlag>
    );
    if (tab === 'media') return <MediaTab key={selected.folder} siteId={selected.webflowSiteId} workspaceId={selected.id} workspaceFolder={selected.folder} queue={workspaceQueue} />;
    if (tab === 'seo-audit') return <SeoAudit key={`seo-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} workspaceId={selected.id} siteName={selected.webflowSiteName || selected.name} />;
    if (tab === 'seo-editor') return <SeoEditorWrapper key={`editor-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} workspaceId={selected.id} fixContext={fixContext} />;
    if (tab === 'seo-strategy') return <KeywordStrategyPanel key={`strategy-${selected.id}`} workspaceId={selected.id} siteId={selected.webflowSiteId!} />;
    if (tab === 'page-intelligence') return <PageIntelligence key={`pageintel-${selected.id}`} workspaceId={selected.id} siteId={selected.webflowSiteId!} fixContext={fixContext} />;
    if (tab === 'links') return <LinksPanel key={`links-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} workspaceId={selected.id} />;
    if (tab === 'seo-schema') return <SchemaSuggester key={`schema-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} workspaceId={selected.id} fixContext={fixContext} />;
    if (tab === 'content-pipeline') return <ContentPipeline key={`pipeline-${selected.id}`} workspaceId={selected.id} onRequestCountChange={setPendingContentRequests} fixContext={fixContext} clearFixContext={clearFixContext} />;
    if (tab === 'seo-briefs') return <ContentBriefs key={`briefs-${selected.id}`} workspaceId={selected.id} onRequestCountChange={setPendingContentRequests} fixContext={fixContext} clearFixContext={clearFixContext} />;
    if (tab === 'content') return <ContentManager key={`content-${selected.id}`} workspaceId={selected.id} />;
    if (tab === 'calendar') return <Navigate to={adminPath(selected.id, 'content-pipeline') + '?tab=calendar'} replace />;
    if (tab === 'subscriptions') return <ContentSubscriptions key={`subs-${selected.id}`} workspaceId={selected.id} />;
    if (tab === 'brand') return (
      // Double-gated: Sidebar already hides the nav entry when the flag is
      // off, but a user who deep-links to /ws/:id/brand directly would hit
      // this route. Without a fallback, `<FeatureFlag>` renders null and the
      // content pane goes blank with no explanation. Ship an EmptyState so
      // the deep-link path degrades gracefully instead of looking broken.
      // (PR #168 scaled-review UX polish.)
      <FeatureFlag
        flag="copy-engine"
        fallback={
          <EmptyState
            icon={Sparkles}
            title="Brand Hub is rolling out"
            description="The Copy & Brand Engine is still rolling out to workspaces. Check back soon, or reach out if you'd like early access."
          />
        }
      >
        <BrandHub key={`brand-${selected.id}`} workspaceId={selected.id} webflowSiteId={selected.webflowSiteId} />
      </FeatureFlag>
    );
        if (tab === 'seo-ranks') return <RankTracker key={`ranks-${selected.id}`} workspaceId={selected.id} hasGsc={!!selected.gscPropertyUrl} />;
    if (tab === 'analytics-hub') return <AnalyticsHub key={`analytics-${selected.id}`} workspaceId={selected.id} siteId={selected.webflowSiteId} gscPropertyUrl={selected.gscPropertyUrl} ga4PropertyId={selected.ga4PropertyId} />;
    if (tab === 'performance') return <Performance key={`perf-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} />;
    if (tab === 'content-perf') return <ContentPerformance key={`content-perf-${selected.id}`} workspaceId={selected.id} />;
    if (tab === 'requests') return (
      <div className="flex flex-col">
        <TabBar
          tabs={[
            { id: 'signals', label: 'Signals' },
            { id: 'requests', label: 'Requests' },
          ]}
          active={requestsSubTab}
          onChange={(id) => setRequestsSubTab(id as 'signals' | 'requests')}
          className="mb-6"
        />
        {requestsSubTab === 'signals' && <AdminInbox key={`inbox-${selected.id}`} workspaceId={selected.id} />}
        {requestsSubTab === 'requests' && <RequestManager key={`requests-${selected.id}`} workspaceId={selected.id} />}
      </div>
    );
    if (tab === 'rewrite') return <PageRewriteChat key={`rewrite-${selected.id}`} workspaceId={selected.id} initialPageUrl={rewritePageUrl || undefined} focusMode={effectiveFocusMode} onFocusModeToggle={() => setFocusMode(f => !f)} onBack={() => { setRewritePageUrl(null); navigate(adminPath(selected.id, 'seo-audit')); }} />;
    if (tab === 'outcomes') return <OutcomeDashboard key={`outcomes-${selected.id}`} workspaceId={selected.id} />;

    return null;
  };

  return (
    <div className="flex h-screen bg-[#0f1219] text-zinc-200">
      <Sidebar
        workspaces={workspaces}
        selected={selected}
        tab={tab}
        theme={theme}
        pendingContentRequests={pendingContentRequests}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onLinkSite={handleLinkSite}
        onUnlinkSite={handleUnlinkSite}
        toggleTheme={toggleTheme}
        onLogout={onLogout}
        hidden={effectiveFocusMode}
        onExitHidden={() => setFocusMode(false)}
      />

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <Breadcrumbs
          workspaces={workspaces}
          selected={selected}
          tab={tab}
          pendingContentRequests={pendingContentRequests}
        />
        {clipboardStatus && (
          <div className="flex items-center gap-1.5 px-5 py-1.5 text-[11px] font-medium bg-teal-500/10 text-teal-400 border-b border-zinc-800">
            <Clipboard className="w-3 h-3" /> {clipboardStatus}
          </div>
        )}
        <main className={`flex-1 ${isFullHeightLayout ? 'overflow-hidden' : 'overflow-auto p-6'}`}>
          <ScannerReveal className={isFullHeightLayout ? 'h-full' : undefined}>
            {/* max-w-5xl for admin (sidebar present); rewrite tab fills full width with h-full for two-pane containment */}
            <div className={isFullHeightLayout ? 'h-full' : 'max-w-5xl mx-auto'}>
              {pendingContentRequests > 0 && selected && tab !== 'content-pipeline' && (
                <button
                  onClick={() => selected && navigate(adminPath(selected.id, 'content-pipeline'))}
                  className="w-full mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border transition-all hover:border-amber-400/40"
                  style={{ backgroundColor: 'rgba(245,158,11,0.06)', borderColor: 'rgba(245,158,11,0.2)' }}
                >
                  <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                    <Clipboard className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="text-left flex-1">
                    <span className="text-xs font-medium text-amber-300">{pendingContentRequests} new content {pendingContentRequests === 1 ? 'request' : 'requests'}</span>
                    <span className="text-[11px] text-zinc-500 ml-2">from client portal</span>
                  </div>
                  <span className="text-[11px] text-zinc-500">View →</span>
                </button>
              )}
              <ErrorBoundary label={tab}>
                <Suspense fallback={<ChunkFallback />}>
                  {renderContent()}
                </Suspense>
              </ErrorBoundary>
            </div>
          </ScannerReveal>
        </main>
        <StatusBar
          hasOpenAIKey={health.hasOpenAIKey}
          hasWebflowToken={health.hasWebflowToken}
          connected={connected}
          workspaceCount={workspaces.length}
        />
      </div>
      <CommandPalette
        workspaces={workspaces}
        selectedWorkspace={selected}
        onSelectWorkspace={(ws) => navigate(adminPath(ws.id))}
      />
      {selected && health.hasOpenAIKey && (
        <ErrorBoundary label="Admin Chat">
          <AdminChat
            workspaceId={selected.id}
            workspaceName={selected.webflowSiteName || selected.name}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

export default App;
