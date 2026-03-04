import { useState, useEffect } from 'react';
import {
  Settings, Check, Globe, Link2Off, ExternalLink, Search, Loader2, Copy, CheckCircle,
} from 'lucide-react';

interface Workspace {
  id: string;
  name: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  gscPropertyUrl?: string;
}

interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onTokenSaved: () => void;
}

export function SettingsPanel({ open, onClose }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [gscSitesMap, setGscSitesMap] = useState<Record<string, GscSite[]>>({});
  const [loadingGsc, setLoadingGsc] = useState<Set<string>>(new Set());
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetch('/api/workspaces')
        .then(r => r.json())
        .then((wsList: Workspace[]) => {
          setWorkspaces(wsList);
          // Load GSC sites for each linked workspace
          wsList.filter(w => w.webflowSiteId).forEach(ws => {
            loadGscSites(ws.webflowSiteId!);
          });
        })
        .catch(() => {});
    }
  }, [open]);

  const loadGscSites = async (siteId: string) => {
    setLoadingGsc(prev => new Set(prev).add(siteId));
    try {
      const res = await fetch(`/api/google/gsc-sites/${siteId}`);
      const sites = await res.json();
      if (Array.isArray(sites)) {
        setGscSitesMap(prev => ({ ...prev, [siteId]: sites }));
      }
    } catch { /* ignore */ }
    finally {
      setLoadingGsc(prev => { const n = new Set(prev); n.delete(siteId); return n; });
    }
  };

  const saveGscProperty = async (workspaceId: string, gscPropertyUrl: string) => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gscPropertyUrl }),
      });
      const updated = await res.json();
      setWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, gscPropertyUrl: updated.gscPropertyUrl } : w));
    } catch { /* ignore */ }
  };

  const copyClientLink = (wsId: string) => {
    const url = `${window.location.origin}/client/${wsId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(wsId);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  if (!open) return null;

  const linked = workspaces.filter(w => w.webflowSiteId);
  const unlinked = workspaces.filter(w => !w.webflowSiteId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border-hover)' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--brand-border)' }}>
          <Settings className="w-5 h-5" style={{ color: 'var(--brand-text-muted)' }} />
          <h2 className="text-base font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Settings</h2>
          <button
            onClick={onClose}
            className="ml-auto text-sm px-2.5 py-1 rounded-md hover:bg-white/5 transition-colors"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            Done
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Webflow Connections */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium" style={{ color: 'var(--brand-text-bright)' }}>Webflow Connections</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                Each workspace has its own API token. To link a site, hover over a workspace in the dropdown and click the{' '}
                <Globe className="w-3 h-3 inline text-zinc-400" /> icon.
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--brand-text-muted)' }}>
                Generate tokens at{' '}
                <a
                  href="https://webflow.com/dashboard/account/integrations"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-400 hover:text-teal-300 inline-flex items-center gap-1"
                >
                  webflow.com/dashboard <ExternalLink className="w-3 h-3" />
                </a>
              </p>
            </div>

            {linked.length > 0 && (
              <div className="space-y-1">
                {linked.map(ws => (
                  <div
                    key={ws.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ backgroundColor: 'var(--brand-bg-surface)' }}
                  >
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium">{ws.name}</span>
                      <span className="text-xs text-zinc-500 ml-2">{ws.webflowSiteName}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {unlinked.length > 0 && (
              <div className="space-y-1">
                {unlinked.map(ws => (
                  <div
                    key={ws.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ backgroundColor: 'var(--brand-bg-surface)', opacity: 0.7 }}
                  >
                    <Link2Off className="w-4 h-4 text-zinc-600 shrink-0" />
                    <span className="text-sm text-zinc-500">{ws.name}</span>
                    <span className="text-xs text-zinc-600 ml-auto">Not linked</span>
                  </div>
                ))}
              </div>
            )}

            {workspaces.length === 0 && (
              <p className="text-sm text-zinc-500 px-3 py-2">
                No workspaces yet. Create one from the workspace dropdown.
              </p>
            )}
          </div>

          {/* Search Console Properties */}
          {linked.length > 0 && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-medium" style={{ color: 'var(--brand-text-bright)' }}>Search Console Properties</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                  Select which GSC property feeds into each workspace's client dashboard.
                </p>
              </div>
              <div className="space-y-2">
                {linked.map(ws => {
                  const siteId = ws.webflowSiteId!;
                  const sites = gscSitesMap[siteId] || [];
                  const isLoading = loadingGsc.has(siteId);
                  return (
                    <div key={ws.id} className="rounded-lg p-3 space-y-2" style={{ backgroundColor: 'var(--brand-bg-surface)' }}>
                      <div className="flex items-center gap-2">
                        <Search className="w-3.5 h-3.5 text-zinc-500" />
                        <span className="text-sm font-medium">{ws.name}</span>
                        {ws.gscPropertyUrl && (
                          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded ml-auto">Configured</span>
                        )}
                      </div>
                      {isLoading ? (
                        <div className="flex items-center gap-2 text-xs text-zinc-500">
                          <Loader2 className="w-3 h-3 animate-spin" /> Loading properties...
                        </div>
                      ) : sites.length > 0 ? (
                        <select
                          value={ws.gscPropertyUrl || ''}
                          onChange={e => saveGscProperty(ws.id, e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
                        >
                          <option value="">— Select property —</option>
                          {sites.map(s => (
                            <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-[11px] text-zinc-500">Connect Google in the Search tab first</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Client Dashboard Links */}
          {linked.filter(w => w.gscPropertyUrl).length > 0 && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-medium" style={{ color: 'var(--brand-text-bright)' }}>Client Dashboards</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                  Share these links with clients. No login required — read-only access to search data and AI assistant.
                </p>
              </div>
              <div className="space-y-1.5">
                {linked.filter(w => w.gscPropertyUrl).map(ws => (
                  <div key={ws.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--brand-bg-surface)' }}>
                    <Globe className="w-3.5 h-3.5 text-teal-400" />
                    <span className="text-sm text-zinc-300 flex-1 truncate">{ws.name}</span>
                    <button
                      onClick={() => copyClientLink(ws.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                    >
                      {copiedLink === ws.id ? (
                        <><CheckCircle className="w-3 h-3 text-emerald-400" /> Copied!</>
                      ) : (
                        <><Copy className="w-3 h-3" /> Copy link</>
                      )}
                    </button>
                    <a
                      href={`/client/${ws.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                    >
                      <ExternalLink className="w-3 h-3" /> Open
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* OpenAI API Key status */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium" style={{ color: 'var(--brand-text-bright)' }}>OpenAI API Key</h3>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--brand-bg-surface)' }}>
              <Check className="w-4 h-4 text-emerald-400" />
              <span className="text-sm text-zinc-300">Configured (via .env)</span>
            </div>
            <p className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>Used for AI-generated alt text (GPT-4o mini).</p>
          </div>
        </div>
      </div>
    </div>
  );
}
