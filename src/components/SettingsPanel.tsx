import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import {
  Check, Search, Loader2, LogIn, LogOut, Globe, ExternalLink, Unplug,
} from 'lucide-react';

interface Workspace {
  id: string;
  name: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
}

interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export function SettingsPanel() {
  const { toast } = useToast();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; configured: boolean } | null>(null);
  const [gscSites, setGscSites] = useState<GscSite[]>([]);
  const [loadingGsc, setLoadingGsc] = useState(false);

  useEffect(() => {
    fetch('/api/workspaces').then(r => r.json()).then(setWorkspaces).catch(() => {});
    fetch('/api/google/status').then(r => r.json()).then((s: { connected: boolean; configured: boolean }) => {
      setGoogleStatus(s);
      if (s.connected) loadGscSites();
    }).catch(() => {});
  }, []);

  const loadGscSites = async () => {
    setLoadingGsc(true);
    try {
      const res = await fetch('/api/google/gsc-sites');
      const sites = await res.json();
      if (Array.isArray(sites)) setGscSites(sites);
    } catch { /* ignore */ }
    finally { setLoadingGsc(false); }
  };

  const connectGoogle = async () => {
    const res = await fetch('/api/google/auth-url');
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  };

  const disconnectGoogle = async () => {
    await fetch('/api/google/disconnect', { method: 'POST' });
    setGoogleStatus({ connected: false, configured: true });
    setGscSites([]);
    toast('Google account disconnected');
  };

  const linked = workspaces.filter(w => w.webflowSiteId);
  const unlinked = workspaces.filter(w => !w.webflowSiteId);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-200">Settings</h2>
        <p className="text-xs mt-0.5 text-zinc-500">Account-level connections and configuration</p>
      </div>

      {/* Google Account Connection */}
      <section className="bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Search className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-200">Google Account</h3>
            <p className="text-xs text-zinc-500">Connect once to access Search Console &amp; GA4 across all workspaces</p>
          </div>
          {googleStatus?.connected ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">Connected</span>
              <button onClick={disconnectGoogle} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" title="Disconnect Google">
                <LogOut className="w-4 h-4 text-zinc-500" />
              </button>
            </div>
          ) : googleStatus?.configured ? (
            <button onClick={connectGoogle} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors">
              <LogIn className="w-3.5 h-3.5" /> Connect Google
            </button>
          ) : (
            <span className="text-[11px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full">Not configured</span>
          )}
        </div>

        {googleStatus?.connected && (
          <div className="px-5 py-3">
            {loadingGsc ? (
              <div className="flex items-center gap-2 text-xs py-2 text-zinc-500">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading properties...
              </div>
            ) : gscSites.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 py-1">
                {gscSites.map(s => (
                  <span key={s.siteUrl} className="text-[11px] px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">{s.siteUrl}</span>
                ))}
              </div>
            ) : (
              <p className="text-xs py-2 text-zinc-500">No properties found. Make sure your Google account has Search Console access.</p>
            )}
          </div>
        )}
      </section>

      {/* Webflow Connections Overview */}
      <section className="bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800">
        <div className="px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-teal-400" />
            <h3 className="text-sm font-semibold text-zinc-200">Webflow Connections</h3>
          </div>
          <p className="text-xs mt-0.5 text-zinc-500">
            Link sites from the workspace dropdown. Generate tokens at{' '}
            <a href="https://webflow.com/dashboard/account/integrations" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300 inline-flex items-center gap-0.5">
              webflow.com <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>
        <div className="divide-y divide-zinc-800">
          {linked.map(ws => (
            <div key={ws.id} className="px-5 py-3 flex items-center gap-3">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-sm font-medium text-zinc-200">{ws.name}</span>
              <span className="text-xs text-zinc-500">{ws.webflowSiteName}</span>
            </div>
          ))}
          {unlinked.map(ws => (
            <div key={ws.id} className="px-5 py-3 flex items-center gap-3 opacity-60">
              <Unplug className="w-4 h-4 text-zinc-500 shrink-0" />
              <span className="text-sm text-zinc-500">{ws.name}</span>
              <span className="text-xs text-zinc-500 ml-auto">Not linked</span>
            </div>
          ))}
          {workspaces.length === 0 && (
            <div className="px-5 py-4">
              <p className="text-sm text-zinc-500">No workspaces yet. Create one from the workspace dropdown.</p>
            </div>
          )}
        </div>
      </section>

      {/* API Keys */}
      <section className="bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-200">API Keys</h3>
        </div>
        <div className="px-5 py-3 flex items-center gap-3">
          <Check className="w-4 h-4 text-emerald-400" />
          <div>
            <span className="text-sm text-zinc-400">OpenAI API Key</span>
            <span className="text-xs text-zinc-500 ml-2">Configured via .env</span>
          </div>
        </div>
      </section>

      {/* Hint */}
      <p className="text-xs text-center py-4 text-zinc-500">
        Workspace-specific settings (GSC, GA4, client dashboards) are now in the gear icon next to each workspace.
      </p>
    </div>
  );
}
