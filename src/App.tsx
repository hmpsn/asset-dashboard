import { useState, useEffect, useCallback } from 'react';
import { WorkspaceSelector, type Workspace } from './components/WorkspaceSelector';
import { type QueueItem } from './components/ProcessingQueue';
import { StatusBar } from './components/StatusBar';
import { SettingsPanel } from './components/SettingsPanel';
import { MediaTab } from './components/MediaTab';
import { PageWeight } from './components/PageWeight';
import { SeoAudit } from './components/SeoAudit';
import { PageSpeedPanel } from './components/PageSpeedPanel';
import { SalesReport } from './components/SalesReport';
import { SearchConsole } from './components/SearchConsole';
import { ClientDashboard } from './components/ClientDashboard';
import { LoginScreen } from './components/LoginScreen';
import { useAuth } from './hooks/useAuth';
import { useWebSocket } from './hooks/useWebSocket';
import {
  Settings, Clipboard, BarChart3, Globe, Image, Gauge, FileSearch, Search,
} from 'lucide-react';

type Tab = 'media' | 'seo' | 'search' | 'performance' | 'speed' | 'prospect';

function App() {
  // Client dashboard route: /client/:workspaceId (public, no auth)
  const clientMatch = window.location.pathname.match(/^\/client\/([\w_]+)/);
  if (clientMatch) {
    return <ClientDashboard workspaceId={clientMatch[1]} />;
  }
  return <AdminApp />;
}

function AdminApp() {
  const auth = useAuth();

  if (auth.checking) {
    return <div className="flex items-center justify-center h-screen" style={{ backgroundColor: 'var(--brand-bg)' }}><div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--brand-border)', borderTopColor: 'var(--brand-mint)' }} /></div>;
  }
  if (auth.required && !auth.authenticated) {
    return <LoginScreen onLogin={auth.login} />;
  }

  return <Dashboard />;
}

function Dashboard() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [health, setHealth] = useState({ hasOpenAIKey: false, hasWebflowToken: false });
  const [connected, setConnected] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('media');
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null);

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

  const tabs: { id: Tab; label: string; icon: typeof Image }[] = [
    { id: 'media', label: 'Media', icon: Image },
    { id: 'seo', label: 'SEO', icon: Globe },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'performance', label: 'Performance', icon: BarChart3 },
    { id: 'speed', label: 'Speed', icon: Gauge },
  ];

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: 'var(--brand-bg)', color: 'var(--brand-text-bright)' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--brand-border)' }}>
        <div className="flex items-center gap-4">
          <img src="/logo.svg" alt="hmpsn.studio" className="h-5" />
          <button
            onClick={() => setTab('prospect')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors"
            style={tab === 'prospect' ? {
              backgroundColor: 'var(--brand-mint-dim)',
              color: 'var(--brand-mint)',
            } : {
              color: 'var(--brand-text-muted)',
            }}
          >
            <FileSearch className="w-3.5 h-3.5" />
            Prospect
          </button>
        </div>

        <div className="flex items-center gap-2">
          {clipboardStatus && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium" style={{ backgroundColor: 'var(--brand-mint-dim)', color: 'var(--brand-mint)' }}>
              <Clipboard className="w-3 h-3" /> {clipboardStatus}
            </div>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 rounded-md hover:bg-white/5"
            style={{ color: 'var(--brand-text-muted)' }}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          <WorkspaceSelector
            workspaces={workspaces}
            selected={selected}
            onSelect={setSelected}
            onCreate={handleCreate}
            onDelete={handleDelete}
            onLinkSite={handleLinkSite}
            onUnlinkSite={handleUnlinkSite}
          />
        </div>
      </header>

      {/* Tab bar */}
      {selected && tab !== 'prospect' && (
        <nav className="flex items-center gap-0.5 px-5 py-2" style={{ borderBottom: '1px solid var(--brand-border)' }}>
          {tabs.map(t => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium"
                style={isActive ? {
                  backgroundColor: 'var(--brand-mint-dim)',
                  color: 'var(--brand-mint)',
                } : {
                  color: 'var(--brand-text-muted)',
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </nav>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto p-5">
        {tab === 'prospect' ? (
          <div className="max-w-5xl mx-auto">
            <SalesReport />
          </div>
        ) : !selected ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <img src="/logo.svg" alt="hmpsn.studio" className="h-8 opacity-40" />
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--brand-text-bright)' }}>Select or create a workspace</p>
              <p className="text-xs mt-1" style={{ color: 'var(--brand-text-muted)' }}>Each workspace maps to a Webflow site</p>
            </div>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto">
            {tab === 'media' && (
              <MediaTab
                key={selected.folder}
                siteId={selected.webflowSiteId}
                workspaceFolder={selected.folder}
                queue={workspaceQueue}
              />
            )}

            {tab === 'seo' && selected.webflowSiteId && (
              <SeoAudit key={`seo-${selected.webflowSiteId}`} siteId={selected.webflowSiteId} />
            )}
            {tab === 'seo' && !selected.webflowSiteId && (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--brand-bg-elevated)' }}>
                  <Globe className="w-5 h-5" style={{ color: 'var(--brand-text-muted)' }} />
                </div>
                <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>Link a Webflow site for SEO tools</p>
              </div>
            )}

            {tab === 'search' && selected.webflowSiteId && (
              <SearchConsole key={`search-${selected.webflowSiteId}`} siteId={selected.webflowSiteId} />
            )}
            {tab === 'search' && !selected.webflowSiteId && (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--brand-bg-elevated)' }}>
                  <Search className="w-5 h-5" style={{ color: 'var(--brand-text-muted)' }} />
                </div>
                <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>Link a Webflow site for Search Console data</p>
              </div>
            )}

            {tab === 'performance' && selected.webflowSiteId && (
              <PageWeight key={`weight-${selected.webflowSiteId}`} siteId={selected.webflowSiteId} />
            )}
            {tab === 'performance' && !selected.webflowSiteId && (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--brand-bg-elevated)' }}>
                  <BarChart3 className="w-5 h-5" style={{ color: 'var(--brand-text-muted)' }} />
                </div>
                <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>Link a Webflow site to analyze performance</p>
              </div>
            )}

            {tab === 'speed' && selected.webflowSiteId && (
              <PageSpeedPanel key={`speed-${selected.webflowSiteId}`} siteId={selected.webflowSiteId} />
            )}
            {tab === 'speed' && !selected.webflowSiteId && (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--brand-bg-elevated)' }}>
                  <Gauge className="w-5 h-5" style={{ color: 'var(--brand-text-muted)' }} />
                </div>
                <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>Link a Webflow site to test page speed</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Status bar */}
      <StatusBar
        hasOpenAIKey={health.hasOpenAIKey}
        hasWebflowToken={health.hasWebflowToken}
        connected={connected}
      />

      {/* Settings modal */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onTokenSaved={refreshHealth}
      />
    </div>
  );
}

export default App;
