import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { postForm } from './api/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { type Page, adminPath, clientPath, GLOBAL_TABS, resolveClientInboxRouteAlias } from './routes';
import { StatusBar } from './components/StatusBar';
import { LoginScreen } from './components/LoginScreen';
import { MobileGuard } from './components/MobileGuard';
import { useAuth } from './hooks/useAuth';
import { useGlobalAdminEvents } from './hooks/useGlobalAdminEvents';
import { useWsInvalidation } from './hooks/useWsInvalidation';
import { ADMIN_EVENTS } from './lib/wsEvents';
import { useWorkspaces, useCreateWorkspace, useDeleteWorkspace, useLinkSite, useUnlinkSite, WORKSPACES_KEY, useHealthCheck, useQueue, QUEUE_KEY, useWorkspaceBadges } from './hooks/admin';
import { useQueryClient } from '@tanstack/react-query';
import { ToastProvider } from './components/Toast';
import { BackgroundTaskProvider } from './hooks/useBackgroundTasks';
import { AdminChat } from './components/AdminChat';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CommandPalette } from './components/CommandPalette';
import { Sidebar } from './components/layout/Sidebar';
import { Breadcrumbs } from './components/layout/Breadcrumbs';
import { RebuiltAppChrome, useRebuildShellEnabled } from './components/layout/RebuiltAppChrome';
import { REBUILT_SURFACES } from './components/layout/rebuiltSurfaces';
import { ScannerReveal } from './components/ui/ScannerReveal';
import { TabBar } from './components/ui/TabBar';
import { Clipboard, Globe } from 'lucide-react';
import type { FixContext } from './types/fix-context';

// ── Lazy-loaded route-level chunks ──
const ClientDashboard = lazyWithRetry(() => import('./components/ClientDashboard').then(m => ({ default: m.ClientDashboard })));
const LandingPage = lazyWithRetry(() => import('./components/LandingPage').then(m => ({ default: m.LandingPage })));
const PageRewriteChat = lazyWithRetry(() => import('./components/PageRewriteChat').then(m => ({ default: m.PageRewriteChat })));
// DEV-only design-system harness (F3.2) — mounted only under import.meta.env.DEV
// (see the /__ds-harness route). Never shipped to production; exempt from nav/registry.
const DsHarness = lazyWithRetry(() => import('./components/dev/DsHarness'));

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
const KeywordHub = lazyWithRetry(() => import('./components/KeywordHub').then(m => ({ default: m.KeywordHub })));
const LocalPresencePage = lazyWithRetry(() => import('./components/local-seo/LocalPresencePage').then(m => ({ default: m.LocalPresencePage })));
const CompetitorsPage = lazyWithRetry(() => import('./components/competitors/CompetitorsPage').then(m => ({ default: m.CompetitorsPage })));
const PageIntelligence = lazyWithRetry(() => import('./components/PageIntelligence').then(m => ({ default: m.PageIntelligence })));
const SchemaSuggester = lazyWithRetry(() => import('./components/SchemaSuggester').then(m => ({ default: m.SchemaSuggester })));
const ContentPerformance = lazyWithRetry(() => import('./components/ContentPerformance').then(m => ({ default: m.ContentPerformance })));
const LinksPanel = lazyWithRetry(() => import('./components/LinksPanel').then(m => ({ default: m.LinksPanel })));
const ContentSubscriptions = lazyWithRetry(() => import('./components/ContentSubscriptions').then(m => ({ default: m.ContentSubscriptions })));
const ContentPipeline = lazyWithRetry(() => import('./components/ContentPipeline').then(m => ({ default: m.ContentPipeline })));
const BrandHub = lazyWithRetry(() => import('./components/BrandHub').then(m => ({ default: m.BrandHub })));
const RevenueDashboard = lazyWithRetry(() => import('./components/RevenueDashboard').then(m => ({ default: m.RevenueDashboard })));
const FeatureLibrary = lazyWithRetry(() => import('./components/FeatureLibrary'));
const OutcomeDashboard = lazyWithRetry(() => import('./components/admin/outcomes/OutcomeDashboard'));
const OutcomesOverview = lazyWithRetry(() => import('./components/admin/outcomes/OutcomesOverview'));
const AdminInbox = lazyWithRetry(() => import('./components/admin/AdminInbox').then(m => ({ default: m.AdminInbox })));
const ClientActionsTab = lazyWithRetry(() => import('./components/admin/ClientActionsTab').then(m => ({ default: m.ClientActionsTab })));
const ClientDeliverablesPane = lazyWithRetry(() => import('./components/admin/ClientDeliverablesPane').then(m => ({ default: m.ClientDeliverablesPane })));
const DiagnosticReportPage = lazyWithRetry(() => import('./components/admin/DiagnosticReport/DiagnosticReportPage').then(m => ({ default: m.DiagnosticReportPage })));

function ChunkFallback() {
  return <div className="flex items-center justify-center py-24"><div className="w-6 h-6 border-2 rounded-[var(--radius-pill)] animate-spin border-[var(--surface-3)] border-t-teal-400" /></div>;
}

// Not lazy-loaded — the redirect fires immediately so a lazy chunk would add
// pointless network overhead before navigation.
function StyleguideRedirect() {
  useEffect(() => { window.location.replace('/styleguide.html'); }, []);
  return null;
}

/** Client routes with backward-compat redirect: /client/:id?tab=X → /client/:id/X */
function ClientRoutes({ betaMode = false }: { betaMode?: boolean }) {
  const params = useParams<{ workspaceId: string; '*': string }>();
  const [searchParams] = useSearchParams();
  const workspaceId = params.workspaceId!;
  const splatTab = params['*'] || undefined;
  const splatTabId = splatTab?.split('/')[0];
  const legacyInboxFilter = resolveClientInboxRouteAlias(splatTabId);
  if (legacyInboxFilter && workspaceId) {
    const remaining = new URLSearchParams(searchParams);
    remaining.delete('tab');
    const qs = remaining.toString();
    const target = clientPath(workspaceId, splatTabId, betaMode);
    return <Navigate to={target + (qs ? `${target.includes('?') ? '&' : '?'}${qs}` : '')} replace />;
  }
  // Backward-compat: redirect old `/client/:id?tab=X` URLs to path-based
  // `/client/:id/X`. ONLY fires when the splat is empty — when a tab path is
  // already present (e.g. `/client/:id/inbox?tab=reviews`), `?tab=X` is a
  // filter param for the inner page (e.g. <InboxTab>'s useSearchParams
  // reader), NOT the tab name.
  const queryTab = searchParams.get('tab');
  if (queryTab && workspaceId && !splatTab) {
    const remaining = new URLSearchParams(searchParams);
    remaining.delete('tab');
    const qs = remaining.toString();
    const target = clientPath(workspaceId, queryTab, betaMode);
    return <Navigate to={target + (qs ? `${target.includes('?') ? '&' : '?'}${qs}` : '')} replace />;
  }
  return <ClientDashboard workspaceId={workspaceId} initialTab={splatTab} betaMode={betaMode} />;
}

function ClientRouteShell({ betaMode = false }: { betaMode?: boolean }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return (
    <ToastProvider durationMs={5000} placement="bottom-center" mode="single" variant="client">
      <BackgroundTaskProvider workspaceId={workspaceId} publicMode>
        <MobileGuard>
          <Suspense fallback={<ChunkFallback />}>
            <ClientRoutes betaMode={betaMode} />
          </Suspense>
        </MobileGuard>
      </BackgroundTaskProvider>
    </ToastProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/welcome" element={<Suspense fallback={<ChunkFallback />}><LandingPage /></Suspense>} />
        <Route path="/styleguide" element={<StyleguideRedirect />} />
        {/* DEV-only DS harness — the F3.3 keyboard-walk target. Excluded from
            production builds; import.meta.env.DEV is statically false in prod so
            this Route (and its lazy chunk) is tree-shaken away. */}
        {import.meta.env.DEV && (
          <Route
            path="/__ds-harness"
            element={
              <ToastProvider>
                <Suspense fallback={<ChunkFallback />}><DsHarness /></Suspense>
              </ToastProvider>
            }
          />
        )}
        <Route path="/client/beta/:workspaceId/*" element={<ClientRouteShell betaMode />} />
        <Route path="/client/:workspaceId/*" element={<ClientRouteShell />} />
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
    return <div className={`flex items-center justify-center h-screen bg-[var(--surface-1)] ${theme === 'light' ? 'dashboard-light' : ''}`}><div className="w-6 h-6 border-2 rounded-[var(--radius-pill)] animate-spin border-[var(--surface-3)] border-t-teal-400" /></div>;
  }
  if (auth.required && !auth.authenticated) {
    return <div className={theme === 'light' ? 'dashboard-light' : ''}><LoginScreen onLogin={auth.login} /></div>;
  }

  return <div className={theme === 'light' ? 'dashboard-light' : ''}><Dashboard onLogout={auth.logout} theme={theme} toggleTheme={toggleTheme} /></div>;
}

// Exported for component tests that exercise the real admin routing logic.
export function Dashboard({ onLogout, theme, toggleTheme }: { onLogout?: () => void; theme: 'dark' | 'light'; toggleTheme: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rebuildShellEnabled = useRebuildShellEnabled();

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
  const rebuiltSurfaceActive = rebuildShellEnabled && REBUILT_SURFACES[tab] !== undefined;

  // Reset backing state when navigating away so returning to rewrite starts fresh
  useEffect(() => {
    if (tab !== 'rewrite') setFocusMode(false);
  }, [tab]);

  // Escape key exits focus mode (in addition to the sidebar strip click)
  useEffect(() => {
    if (!effectiveFocusMode || rebuiltSurfaceActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't exit if the user is actively typing in any editable element
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return;
      setFocusMode(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [effectiveFocusMode, rebuiltSurfaceActive]);

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

  const [searchParams] = useSearchParams();
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null);
  const [requestsSubTab, setRequestsSubTab] = useState<'signals' | 'requests' | 'actions' | 'deliverables'>('deliverables');

  // Reset requests sub-tab when workspace or tab changes so stale state doesn't persist.
  // On workspace change OR when navigating to the requests tab, honour ?tab= if it matches
  // a valid sub-tab; otherwise default to 'deliverables'. Adding `tab` as a dep ensures a
  // same-workspace deep-link (e.g. from WorkspaceHome "N new client requests" action) fires
  // the receiver when navigating from home → requests with ?tab=requests.
  const REQUESTS_SUB_TABS = ['signals', 'requests', 'actions', 'deliverables'] as const;
  useEffect(() => {
    if (tab !== 'requests') return;
    const deepTab = searchParams.get('tab') as 'signals' | 'requests' | 'actions' | 'deliverables' | null;
    setRequestsSubTab(deepTab && REQUESTS_SUB_TABS.includes(deepTab) ? deepTab : 'deliverables');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fire on tab/workspace switch only, not on every searchParams change
  }, [urlWorkspaceId, tab]); // effect-layout-ok — state reset on workspace or tab switch

  // Derive selected workspace from URL + React Query data
  const selected = useMemo(() => {
    if (!urlWorkspaceId) return null;
    return workspaces.find(w => w.id === urlWorkspaceId) || null;
  }, [urlWorkspaceId, workspaces]);
  const chromeWorkspace = useMemo(() => {
    if (selected) return selected;
    if (GLOBAL_TABS.has(tab)) return workspaces[0] ?? null;
    return null;
  }, [selected, tab, workspaces]);

  // Rewrite tab is always a full-height two-pane layout (independent scroll per pane).
  // Focus mode additionally hides the sidebar, but height containment is needed in both modes.
  const isFullHeightLayout = tab === 'rewrite' && !!selected;

  // Badge counts via React Query — invalidated by CONTENT_REQUEST_* WS events in useWsInvalidation.
  const { data: badgeData } = useWorkspaceBadges(selected?.id);
  const pendingContentRequests = badgeData?.pendingRequests ?? 0;

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
            const data = await postForm<{ fileName: string }>(`/api/upload/${selected.id}/clipboard`, formData);
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
  const SEO_TABS = new Set<Page>(['seo-audit', 'seo-editor', 'links', 'seo-strategy', 'seo-keywords', 'local-seo', 'seo-schema', 'seo-briefs', 'content-perf', 'content', 'subscriptions', 'brand', 'content-pipeline']);
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
          <div className="w-12 h-12 rounded-[var(--radius-xl)] flex items-center justify-center bg-[var(--surface-2)]">
            <Globe className="w-5 h-5 text-[var(--brand-text-muted)]" />
          </div>
          <p className="t-caption text-[var(--brand-text-muted)]">Link a Webflow site to use this tool</p>
          <button onClick={() => navigate('/settings')} className="mt-3 t-caption-sm font-medium px-3 py-1.5 rounded-[var(--radius-lg)] transition-colors bg-teal-500/10 text-accent-brand">Go to Settings</button>
        </div>
      );
    }

    if (tab === 'home') return <WorkspaceHome key={`home-${selected.id}`} workspaceId={selected.id} workspaceName={selected.webflowSiteName || selected.name} webflowSiteId={selected.webflowSiteId} webflowSiteName={selected.webflowSiteName} gscPropertyUrl={selected.gscPropertyUrl} ga4PropertyId={selected.ga4PropertyId} />;
    if (tab === 'diagnostics') return <DiagnosticReportPage key={`diagnostics-${selected.id}`} workspaceId={selected.id} />;
    if (tab === 'media') return <MediaTab key={selected.folder} siteId={selected.webflowSiteId} workspaceId={selected.id} workspaceFolder={selected.folder} queue={workspaceQueue} />;
    if (tab === 'seo-audit') return <SeoAudit key={`seo-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} workspaceId={selected.id} siteName={selected.webflowSiteName || selected.name} />;
    if (tab === 'seo-editor') return <SeoEditorWrapper key={`editor-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} workspaceId={selected.id} fixContext={fixContext} />;
    if (tab === 'seo-strategy') return <KeywordStrategyPanel key={`strategy-${selected.id}`} workspaceId={selected.id} siteId={selected.webflowSiteId!} />;
    if (tab === 'seo-keywords') return <KeywordHub key={`hub-${selected.id}`} workspaceId={selected.id} />;
    if (tab === 'local-seo') return <LocalPresencePage key={`local-presence-${selected.id}`} workspaceId={selected.id} />;
    // The Issue Phase 6 — dedicated Competitors page. NON_REGISTRY (no global nav); reachable by URL,
    // entered via a flag-ON deep-link from The Issue cockpit.
    if (tab === 'competitors') return <CompetitorsPage key={`competitors-${selected.id}`} workspaceId={selected.id} />;
    if (tab === 'page-intelligence') return <PageIntelligence key={`pageintel-${selected.id}`} workspaceId={selected.id} siteId={selected.webflowSiteId!} fixContext={fixContext} />;
    if (tab === 'links') return <LinksPanel key={`links-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} workspaceId={selected.id} />;
    if (tab === 'seo-schema') return <SchemaSuggester key={`schema-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} workspaceId={selected.id} fixContext={fixContext} businessProfile={selected.businessProfile} intelligenceProfile={selected.intelligenceProfile} />;
    if (tab === 'content-pipeline') return <ContentPipeline key={`pipeline-${selected.id}`} workspaceId={selected.id} fixContext={fixContext} clearFixContext={clearFixContext} />;
    // seo-briefs and content are zombie routes (removed from nav registry in W3.3).
    // Redirect bookmarks to the correct content-pipeline sub-tab.
    if (tab === 'seo-briefs') return <Navigate to={adminPath(selected.id, 'content-pipeline') + '?tab=briefs'} replace />;
    if (tab === 'content') return <Navigate to={adminPath(selected.id, 'content-pipeline') + '?tab=posts'} replace />;
    if (tab === 'calendar') return <Navigate to={adminPath(selected.id, 'content-pipeline') + '?tab=calendar'} replace />;
    if (tab === 'subscriptions') return <ContentSubscriptions key={`subs-${selected.id}`} workspaceId={selected.id} />;
    if (tab === 'brand') return <BrandHub key={`brand-${selected.id}`} workspaceId={selected.id} webflowSiteId={selected.webflowSiteId} />;
    if (tab === 'analytics-hub') return <AnalyticsHub key={`analytics-${selected.id}`} workspaceId={selected.id} siteId={selected.webflowSiteId} gscPropertyUrl={selected.gscPropertyUrl} ga4PropertyId={selected.ga4PropertyId} />;
    if (tab === 'performance') return <Performance key={`perf-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} workspaceId={selected.id} />;
    if (tab === 'content-perf') {
      if (rebuildShellEnabled) {
        const item = new URLSearchParams(location.search).get('item');
        const target = `${adminPath(selected.id, 'content-pipeline')}?tab=published${item ? `&item=${encodeURIComponent(item)}` : ''}`;
        return <Navigate to={target} replace />;
      }
      return <ContentPerformance key={`content-perf-${selected.id}`} workspaceId={selected.id} />;
    }
    if (tab === 'requests') return (
      <div className="flex flex-col">
        <TabBar
          tabs={[
            { id: 'deliverables', label: 'Client Deliverables' },
            { id: 'signals', label: 'Signals' },
            { id: 'requests', label: 'Requests' },
            { id: 'actions', label: 'Client Actions' },
          ]}
          active={requestsSubTab}
          onChange={(id) => setRequestsSubTab(id as 'signals' | 'requests' | 'actions' | 'deliverables')}
          className="mb-6"
        />
        {requestsSubTab === 'deliverables' && <ClientDeliverablesPane key={`deliverables-${selected.id}`} workspaceId={selected.id} />}
        {requestsSubTab === 'signals' && <AdminInbox key={`inbox-${selected.id}`} workspaceId={selected.id} />}
        {requestsSubTab === 'requests' && <RequestManager key={`requests-${selected.id}`} workspaceId={selected.id} />}
        {requestsSubTab === 'actions' && <ClientActionsTab key={`actions-${selected.id}`} workspaceId={selected.id} />}
      </div>
    );
    if (tab === 'rewrite') return <PageRewriteChat key={`rewrite-${selected.id}`} workspaceId={selected.id} initialPageUrl={rewritePageUrl || undefined} focusMode={effectiveFocusMode} onFocusModeToggle={() => setFocusMode(f => !f)} onBack={() => { setRewritePageUrl(null); navigate(adminPath(selected.id, 'seo-audit')); }} />;
    if (tab === 'outcomes') return <OutcomeDashboard key={`outcomes-${selected.id}`} workspaceId={selected.id} />;

    return <Navigate to={adminPath(selected.id, 'home')} replace />;
  };

  const canMountRebuiltSurface = chromeWorkspace !== null || GLOBAL_TABS.has(tab);
  const RebuiltSurface = rebuildShellEnabled && canMountRebuiltSurface ? REBUILT_SURFACES[tab] : undefined;
  if (RebuiltSurface && canMountRebuiltSurface) {
    const rebuiltWorkspaceId = selected?.id ?? chromeWorkspace?.id ?? '';
    return (
      <>
        <RebuiltAppChrome
          workspaces={workspaces}
          selected={chromeWorkspace}
          tab={tab}
          theme={theme}
          pendingContentRequests={pendingContentRequests}
          onCreate={handleCreate}
          onDelete={handleDelete}
          onLinkSite={handleLinkSite}
          onUnlinkSite={handleUnlinkSite}
          toggleTheme={toggleTheme}
          onLogout={onLogout}
          focusMode={effectiveFocusMode}
          onFocusModeChange={setFocusMode}
        >
          <ErrorBoundary label={tab}>
            <Suspense fallback={<ChunkFallback />}>
              <RebuiltSurface workspaceId={rebuiltWorkspaceId} />
            </Suspense>
          </ErrorBoundary>
        </RebuiltAppChrome>
        {/* Global chrome the legacy shell renders as siblings — restored for EVERY
            rebuilt surface (review PR #1480: the rebuilt branch dropped these, killing
            ⌘K + admin chat). StatusBar needs an AppShell footer slot → DEF-shell-005. */}
        <CommandPalette
          workspaces={workspaces}
          selectedWorkspace={chromeWorkspace}
          onSelectWorkspace={(ws) => navigate(adminPath(ws.id))}
        />
        {health.hasOpenAIKey && chromeWorkspace && (
          <ErrorBoundary label="Admin Chat">
            <AdminChat
              workspaceId={chromeWorkspace.id}
              workspaceName={chromeWorkspace.webflowSiteName || chromeWorkspace.name}
            />
          </ErrorBoundary>
        )}
      </>
    );
  }

  return (
    <div className="flex h-screen bg-[var(--surface-1)] text-[var(--brand-text)]">
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
          <div className="flex items-center gap-1.5 px-5 py-1.5 t-caption-sm font-medium bg-teal-500/10 text-accent-brand border-b border-[var(--brand-border)]">
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
                  className="w-full mb-4 flex items-center gap-3 px-4 py-3 rounded-[var(--radius-xl)] border transition-all hover:border-amber-400/40"
                  style={{ backgroundColor: 'rgba(245,158,11,0.06)', borderColor: 'rgba(245,158,11,0.2)' }}
                >
                  <div className="w-7 h-7 rounded-[var(--radius-lg)] bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                    <Clipboard className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="text-left flex-1">
                    <span className="t-caption-sm font-medium text-accent-warning">{pendingContentRequests} new content {pendingContentRequests === 1 ? 'request' : 'requests'}</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)] ml-2">from client portal</span>
                  </div>
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">View →</span>
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
