import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { WorkspaceSelector, type Workspace } from './components/WorkspaceSelector';
import { type QueueItem } from './components/ProcessingQueue';
import { StatusBar } from './components/StatusBar';
import { LoginScreen } from './components/LoginScreen';
import { MobileGuard } from './components/MobileGuard';
import { useAuth } from './hooks/useAuth';
import { useWebSocket } from './hooks/useWebSocket';
import { ToastProvider } from './components/Toast';
import { BackgroundTaskProvider } from './hooks/useBackgroundTasks';
import { TaskPanel } from './components/TaskPanel';
import { AdminChat } from './components/AdminChat';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  Settings, Clipboard, BarChart3, Globe, Image, Gauge, Search,
  Pencil, CornerDownRight, Share2, Target, Code2, LogOut, Swords, TrendingUp, Flag,
  Sun, Moon, LayoutDashboard,
} from 'lucide-react';

// ── Lazy-loaded route-level chunks ──
const ClientDashboard = lazy(() => import('./components/ClientDashboard').then(m => ({ default: m.ClientDashboard })));
const Styleguide = lazy(() => import('./components/Styleguide').then(m => ({ default: m.Styleguide })));
const LandingPage = lazy(() => import('./components/LandingPage').then(m => ({ default: m.LandingPage })));

// ── Lazy-loaded admin tab chunks ──
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const WorkspaceSettings = lazy(() => import('./components/WorkspaceSettings').then(m => ({ default: m.WorkspaceSettings })));
const WorkspaceOverview = lazy(() => import('./components/WorkspaceOverview').then(m => ({ default: m.WorkspaceOverview })));
const MediaTab = lazy(() => import('./components/MediaTab').then(m => ({ default: m.MediaTab })));
const SeoAudit = lazy(() => import('./components/SeoAudit').then(m => ({ default: m.SeoAudit })));
const SearchConsole = lazy(() => import('./components/SearchConsole').then(m => ({ default: m.SearchConsole })));
const Performance = lazy(() => import('./components/Performance').then(m => ({ default: m.Performance })));
const GoogleAnalytics = lazy(() => import('./components/GoogleAnalytics').then(m => ({ default: m.GoogleAnalytics })));
const Annotations = lazy(() => import('./components/Annotations').then(m => ({ default: m.Annotations })));
const RequestManager = lazy(() => import('./components/RequestManager').then(m => ({ default: m.RequestManager })));
const SalesReport = lazy(() => import('./components/SalesReport').then(m => ({ default: m.SalesReport })));
const Roadmap = lazy(() => import('./components/Roadmap').then(m => ({ default: m.Roadmap })));
const WorkspaceHome = lazy(() => import('./components/WorkspaceHome').then(m => ({ default: m.WorkspaceHome })));

function ChunkFallback() {
  return <div className="flex items-center justify-center py-24"><div className="w-6 h-6 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" /></div>;
}

type Page =
  | 'home'
  | 'media'
  | 'seo-audit' | 'seo-editor'
  | 'seo-redirects' | 'seo-internal'
  | 'seo-strategy' | 'seo-schema' | 'seo-briefs' | 'seo-competitors' | 'seo-ranks'
  | 'search' | 'analytics' | 'annotations'
  | 'performance'
  | 'workspace-settings'
  | 'prospect'
  | 'roadmap'
  | 'requests'
  | 'settings';

export interface FixContext {
  pageId?: string;
  pageSlug?: string;
  pageName?: string;
  issueCheck?: string;
  issueMessage?: string;
}

function App() {
  // Landing page route: /welcome (public, no auth)
  if (window.location.pathname === '/welcome') {
    return <Suspense fallback={<ChunkFallback />}><LandingPage /></Suspense>;
  }
  // Styleguide route: /styleguide (no auth)
  if (window.location.pathname === '/styleguide') {
    return <Suspense fallback={<ChunkFallback />}><Styleguide /></Suspense>;
  }
  // Client dashboard route: /client/:workspaceId (public, no auth)
  const clientMatch = window.location.pathname.match(/^\/client\/([\w_]+)/);
  if (clientMatch) {
    return <MobileGuard><Suspense fallback={<ChunkFallback />}><ClientDashboard workspaceId={clientMatch[1]} /></Suspense></MobileGuard>;
  }
  return <ToastProvider><BackgroundTaskProvider><AdminApp /></BackgroundTaskProvider></ToastProvider>;
}

function AdminApp() {
  const auth = useAuth();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('admin-theme') as 'dark' | 'light') || 'dark'; } catch { return 'dark'; }
  });
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('admin-theme', next); } catch { /* skip */ }
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
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [health, setHealth] = useState({ hasOpenAIKey: false, hasWebflowToken: false });
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState<Page>('home');
  const [fixContext, setFixContext] = useState<FixContext | null>(null);
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null);
  const [pendingContentRequests, setPendingContentRequests] = useState(0);

  const refreshHealth = useCallback(() => {
    fetch('/api/health').then(r => r.json()).then(h => {
      setHealth({ hasOpenAIKey: h.hasOpenAIKey, hasWebflowToken: h.hasWebflowToken });
      setConnected(true);
    }).catch(() => setConnected(false));
  }, []);

  // Fetch initial data
  useEffect(() => {
    fetch('/api/workspaces').then(r => r.json()).then(setWorkspaces).catch(() => {});
    fetch('/api/queue').then(r => r.json()).then(setQueue).catch(() => {});
    refreshHealth();
  }, [refreshHealth]);

  // Fetch pending content request count when workspace changes
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    fetch(`/api/content-requests/${selected.id}`)
      .then(r => r.ok ? r.json() : [])
      .then((reqs: Array<{ status: string }>) => {
        if (!cancelled) setPendingContentRequests(Array.isArray(reqs) ? reqs.filter(r => r.status === 'requested').length : 0);
      })
      .catch(() => { if (!cancelled) setPendingContentRequests(0); });
    return () => { cancelled = true; };
  }, [selected]);

  // Keyboard shortcuts (⌘1-5 for tabs, ⌘, for settings)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const tabMap: Record<string, Page> = { '1': 'home', '2': 'seo-audit', '3': 'search', '4': 'analytics' };
      if (tabMap[e.key] && selected) { e.preventDefault(); setTab(tabMap[e.key]); }
      if (e.key === ',') { e.preventDefault(); setTab('settings'); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected]);

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
            const res = await fetch(`/api/upload/${selected.folder}/clipboard`, {
              method: 'POST',
              body: formData,
            });
            const data = await res.json();
            setClipboardStatus(`Pasted: ${data.fileName} (resized 2x for HDPI)`);
            setTimeout(() => setClipboardStatus(null), 3000);
          } catch {
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

  // WebSocket handlers
  const handleQueueUpdate = useCallback((data: unknown) => {
    const item = data as QueueItem;
    setQueue(prev => {
      const idx = prev.findIndex(q => q.id === item.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = item;
        return next;
      }
      return [...prev, item];
    });
  }, []);

  const handleWorkspaceCreated = useCallback((data: unknown) => {
    setWorkspaces(prev => [...prev, data as Workspace]);
  }, []);

  const handleWorkspaceDeleted = useCallback((data: unknown) => {
    const { id } = data as { id: string };
    setWorkspaces(prev => prev.filter(w => w.id !== id));
    setSelected(prev => prev?.id === id ? null : prev);
  }, []);

  useWebSocket({
    'queue:update': handleQueueUpdate,
    'workspace:created': handleWorkspaceCreated,
    'workspace:deleted': handleWorkspaceDeleted,
  });

  // Actions
  const handleCreate = async (name: string, siteId?: string, siteName?: string) => {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, webflowSiteId: siteId, webflowSiteName: siteName }),
    });
    const ws = await res.json();
    // WebSocket 'workspace:created' handler adds it to state; just select it here
    setSelected(ws);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/workspaces/${id}`, { method: 'DELETE' });
    setWorkspaces(prev => prev.filter(w => w.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const handleLinkSite = async (workspaceId: string, siteId: string, siteName: string, token?: string) => {
    const res = await fetch(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webflowSiteId: siteId, webflowSiteName: siteName, webflowToken: token }),
    });
    const updated = await res.json();
    setWorkspaces(prev => prev.map(w => w.id === workspaceId ? updated : w));
    if (selected?.id === workspaceId) setSelected(updated);
  };

  const handleUnlinkSite = async (workspaceId: string) => {
    const res = await fetch(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webflowSiteId: '', webflowSiteName: '' }),
    });
    const updated = await res.json();
    setWorkspaces(prev => prev.map(w => w.id === workspaceId ? updated : w));
    if (selected?.id === workspaceId) setSelected(updated);
  };

  const workspaceQueue = selected
    ? queue.filter(q => q.workspace === selected.folder)
    : queue;

  // ── Sidebar navigation groups ──
  const navGroups: Array<{ label: string; items: Array<{ id: Page; label: string; icon: typeof Globe; needsSite?: boolean }> }> = [
    { label: '', items: [
      { id: 'home', label: 'Home', icon: LayoutDashboard },
    ]},
    { label: 'ANALYTICS', items: [
      { id: 'search', label: 'Search Console', icon: Search, needsSite: true },
      { id: 'analytics', label: 'Google Analytics', icon: BarChart3, needsSite: true },
      { id: 'seo-ranks', label: 'Rank Tracker', icon: TrendingUp, needsSite: true },
    ]},
    { label: 'SITE HEALTH', items: [
      { id: 'seo-audit', label: 'Site Audit', icon: Globe, needsSite: true },
      { id: 'performance', label: 'Performance', icon: Gauge, needsSite: true },
      { id: 'seo-redirects', label: 'Redirects', icon: CornerDownRight, needsSite: true },
      { id: 'seo-internal', label: 'Internal Links', icon: Share2, needsSite: true },
    ]},
    { label: 'SEO', items: [
      { id: 'seo-strategy', label: 'Strategy', icon: Target, needsSite: true },
      { id: 'seo-editor', label: 'SEO Editor', icon: Pencil, needsSite: true },
      { id: 'seo-schema', label: 'Schema', icon: Code2, needsSite: true },
      { id: 'seo-briefs', label: 'Content Briefs', icon: Clipboard, needsSite: true },
      { id: 'seo-competitors', label: 'Competitors', icon: Swords, needsSite: true },
    ]},
    { label: 'MANAGE', items: [
      { id: 'requests', label: 'Requests', icon: Clipboard },
      { id: 'media', label: 'Assets', icon: Image },
      { id: 'annotations', label: 'Annotations', icon: Flag, needsSite: true },
    ]},
  ];

  // ── Content renderer ──
  const seoView = tab.startsWith('seo-') ? tab.replace('seo-', '') : null;
  const needsSite = !!(seoView || tab === 'search' || tab === 'analytics' || tab === 'annotations' || tab === 'performance');

  const renderContent = () => {
    if (tab === 'settings') return <SettingsPanel />;
    if (tab === 'roadmap') return <Roadmap />;
    if (tab === 'workspace-settings' && selected) return <WorkspaceSettings key={`ws-settings-${selected.id}`} workspaceId={selected.id} workspaceName={selected.name} webflowSiteId={selected.webflowSiteId} webflowSiteName={selected.webflowSiteName} onUpdate={(patch) => {
      const updated = { ...selected, ...patch } as typeof selected;
      setSelected(updated);
      setWorkspaces(prev => prev.map(w => w.id === selected.id ? updated : w));
    }} />;
    if (tab === 'prospect') return <SalesReport />;

    if (!selected) {
      return <WorkspaceOverview onSelectWorkspace={(id) => {
        const ws = workspaces.find(w => w.id === id);
        if (ws) { setSelected(ws); setTab('home'); }
      }} onNavigate={(t) => setTab(t as Page)} />;
    }

    if (needsSite && !selected.webflowSiteId) {
      return (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-zinc-900">
            <Globe className="w-5 h-5 text-zinc-500" />
          </div>
          <p className="text-sm text-zinc-500">Link a Webflow site to use this tool</p>
          <button onClick={() => setTab('settings')} className="mt-3 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors bg-teal-500/10 text-teal-400">Go to Settings</button>
        </div>
      );
    }

    if (tab === 'home') return <WorkspaceHome key={`home-${selected.id}`} workspaceId={selected.id} workspaceName={selected.webflowSiteName || selected.name} webflowSiteId={selected.webflowSiteId} webflowSiteName={selected.webflowSiteName} gscPropertyUrl={selected.gscPropertyUrl} ga4PropertyId={selected.ga4PropertyId} onNavigate={(t) => setTab(t as Page)} />;
    if (tab === 'media') return <MediaTab key={selected.folder} siteId={selected.webflowSiteId} workspaceFolder={selected.folder} queue={workspaceQueue} />;
    if (seoView) return <SeoAudit key={`seo-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} workspaceId={selected.id} siteName={selected.webflowSiteName || selected.name} view={seoView} onRequestCountChange={setPendingContentRequests} onNavigate={(t: string, ctx?: FixContext) => { setFixContext(ctx || null); setTab(t as Page); }} fixContext={fixContext} />;
    if (tab === 'search') return <SearchConsole key={`search-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} gscPropertyUrl={selected.gscPropertyUrl} />;
    if (tab === 'performance') return <Performance key={`perf-${selected.webflowSiteId}`} siteId={selected.webflowSiteId!} />;
    if (tab === 'analytics') return <GoogleAnalytics key={`ga4-${selected.id}`} workspaceId={selected.id} ga4PropertyId={selected.ga4PropertyId} />;
    if (tab === 'annotations') return <Annotations key={`ann-${selected.id}`} workspaceId={selected.id} />;
    if (tab === 'requests') return <RequestManager key={`requests-${selected.id}`} workspaceId={selected.id} />;

    return null;
  };

  return (
    <div className="flex h-screen bg-[#0f1219] text-zinc-200">
      {/* ── Global sidebar ── */}
      <aside className="w-[200px] flex-shrink-0 flex flex-col border-r border-zinc-800">
        {/* Logo → Command Center */}
        <button
          onClick={() => { setSelected(null); setTab('home'); }}
          className="px-4 pt-4 pb-3 block hover:opacity-80 transition-opacity"
          title="Command Center"
        >
          <img src="/logo.svg" alt="hmpsn.studio" className="h-7" style={theme === 'light' ? { filter: 'invert(1) brightness(0.3)' } : undefined} />
        </button>

        {/* Workspace selector */}
        <div className="px-3 pb-2 border-b border-zinc-800">
          <WorkspaceSelector
            workspaces={workspaces}
            selected={selected}
            onSelect={(ws) => { setSelected(ws); if (tab === 'prospect' || tab === 'settings' || tab === 'roadmap') setTab('home'); }}
            onCreate={handleCreate}
            onDelete={handleDelete}
            onLinkSite={handleLinkSite}
            onUnlinkSite={handleUnlinkSite}
          />
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {navGroups.map((group, gi) => (
            <div key={group.label || `group-${gi}`}>
              {group.label && <div className="text-[11px] text-zinc-500 font-semibold tracking-widest px-2.5 mb-1">{group.label}</div>}
              {group.items.map(item => {
                const Icon = item.icon;
                const active = tab === item.id;
                const disabled = !selected || (item.needsSite && !selected.webflowSiteId);
                return (
                  <button
                    key={item.id}
                    onClick={() => !disabled && setTab(item.id)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-[5px] rounded-lg text-[12px] font-medium transition-all ${
                      active
                        ? 'bg-teal-500/10 text-teal-300'
                        : disabled
                          ? 'text-zinc-700 cursor-not-allowed'
                          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-teal-400' : ''}`} />
                    <span className="truncate">{item.label}</span>
                    {item.id === 'seo-briefs' && pendingContentRequests > 0 && (
                      <span className="ml-auto text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 tabular-nums flex-shrink-0 min-w-[20px] text-center leading-tight">
                        {pendingContentRequests}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Bottom: icon-only utility bar */}
        <div className="px-3 py-2.5 border-t border-zinc-800 flex items-center justify-center gap-1">
          <button
            onClick={() => setTab('settings')}
            title="Settings"
            className={`p-2 rounded-lg transition-all ${tab === 'settings' ? 'text-teal-400 bg-teal-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}`}
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-all"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          {onLogout && (
            <button
              onClick={() => { fetch('/api/auth/logout', { method: 'POST' }); onLogout(); }}
              title="Log out"
              className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/5 transition-all"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {clipboardStatus && (
          <div className="flex items-center gap-1.5 px-5 py-1.5 text-[11px] font-medium bg-teal-500/10 text-teal-400 border-b border-zinc-800">
            <Clipboard className="w-3 h-3" /> {clipboardStatus}
          </div>
        )}
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-5xl mx-auto">
            {pendingContentRequests > 0 && selected && tab !== 'seo-briefs' && (
              <button
                onClick={() => setTab('seo-briefs')}
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
        </main>
        <StatusBar
          hasOpenAIKey={health.hasOpenAIKey}
          hasWebflowToken={health.hasWebflowToken}
          connected={connected}
          workspaceCount={workspaces.length}
        />
      </div>
      {selected && health.hasOpenAIKey && (
        <ErrorBoundary label="Admin Chat">
          <AdminChat
            workspaceId={selected.id}
            workspaceName={selected.webflowSiteName || selected.name}
            ga4PropertyId={selected.ga4PropertyId}
            gscPropertyUrl={selected.gscPropertyUrl}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

export default App;
