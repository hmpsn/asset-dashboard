import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import {
  Check, Search, Loader2, LogIn, LogOut, Globe, ExternalLink, Unplug,
  Shield, Key, Mail, CreditCard, Wifi, WifiOff, HardDrive, Trash2, RefreshCw,
} from 'lucide-react';
import { StripeSettings } from './StripeSettings';
import { get, post, getOptional, getSafe } from '../api/client';

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

interface HealthStatus {
  hasOpenAIKey: boolean;
  hasWebflowToken: boolean;
  hasGoogleAuth: boolean;
  hasEmailConfig: boolean;
  hasStripe: boolean;
}

interface StorageDirStats {
  name: string;
  bytes: number;
  fileCount: number;
  label: string;
}

interface StorageReport {
  totalBytes: number;
  totalFiles: number;
  breakdown: StorageDirStats[];
  backupRetentionDays: number;
  chatSessionCount: number;
  oldestChatSession: string | null;
  timestamp: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export function SettingsPanel() {
  const { toast } = useToast();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; configured: boolean } | null>(null);
  const [gscSites, setGscSites] = useState<GscSite[]>([]);
  const [loadingGsc, setLoadingGsc] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [storage, setStorage] = useState<StorageReport | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [pruning, setPruning] = useState<string | null>(null);

  const loadStorage = async () => {
    setStorageLoading(true);
    try {
      const data = await getOptional<StorageReport>('/api/admin/storage-stats');
      if (data) setStorage(data);
    } catch (err) { console.error('SettingsPanel operation failed:', err); }
    finally { setStorageLoading(false); }
  };

  const runPrune = async (type: 'chat' | 'backups' | 'activity' | 'reports') => {
    const endpoints: Record<string, string> = {
      chat: '/api/admin/storage/prune-chat',
      backups: '/api/admin/storage/prune-backups',
      reports: '/api/admin/storage/prune-reports',
      activity: '/api/admin/storage/prune-activity',
    };
    setPruning(type);
    try {
      const data = await post<{ bytesFreed?: number }>(endpoints[type], {});
      toast(`Pruned ${type}: ${formatBytes(data.bytesFreed || 0)} freed`);
      loadStorage();
    } catch { toast('Prune failed'); }
    finally { setPruning(null); }
  };

  useEffect(() => {
    getSafe<Workspace[]>('/api/workspaces', []).then(setWorkspaces).catch((err) => { console.error('SettingsPanel operation failed:', err); });
    get<{ connected: boolean; configured: boolean }>('/api/google/status').then(s => {
      setGoogleStatus(s);
      if (s.connected) loadGscSites();
    }).catch((err) => { console.error('SettingsPanel operation failed:', err); });
    get<HealthStatus>('/api/health').then(h => setHealth(h)).catch((err) => { console.error('SettingsPanel operation failed:', err); });
    loadStorage();
  }, []);

  const loadGscSites = async () => {
    setLoadingGsc(true);
    try {
      const sites = await get<GscSite[]>('/api/google/gsc-sites');
      if (Array.isArray(sites)) setGscSites(sites);
    } catch (err) { console.error('SettingsPanel operation failed:', err); }
    finally { setLoadingGsc(false); }
  };

  const connectGoogle = async () => {
    const data = await get<{ url?: string }>('/api/google/auth-url');
    if (data.url) window.location.href = data.url;
  };

  const disconnectGoogle = async () => {
    await post('/api/google/disconnect');
    setGoogleStatus({ connected: false, configured: true });
    setGscSites([]);
    toast('Google account disconnected');
  };

  const linked = workspaces.filter(w => w.webflowSiteId);
  const unlinked = workspaces.filter(w => !w.webflowSiteId);

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-zinc-200">Settings</h2>
        <p className="text-xs mt-0.5 text-zinc-500">Account-level connections and configuration</p>
      </div>

      {/* Google Account Connection */}
      <section className="bg-zinc-900 overflow-hidden border border-zinc-800" style={{ borderRadius: '10px 24px 10px 24px' }}>
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
            <span className="text-[11px] text-amber-400/80 bg-amber-500/8 px-2 py-1 rounded-full">Not configured</span>
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
      <section className="bg-zinc-900 overflow-hidden border border-zinc-800" style={{ borderRadius: '10px 24px 10px 24px' }}>
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
      <section className="bg-zinc-900 overflow-hidden border border-zinc-800" style={{ borderRadius: '10px 24px 10px 24px' }}>
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

      {/* Platform Health */}
      <section className="bg-zinc-900 overflow-hidden border border-zinc-800" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-teal-400" />
            <h3 className="text-sm font-semibold text-zinc-200">Platform Health</h3>
          </div>
          <p className="text-xs mt-0.5 text-zinc-500">Connection status and workspace overview</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Connection status */}
          <div>
            <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mb-2">Connections</div>
            <div className="space-y-1.5">
              {[
                { label: 'OpenAI', ok: health?.hasOpenAIKey, icon: Key },
                { label: 'Webflow', ok: health?.hasWebflowToken, icon: Globe },
                { label: 'Google Auth', ok: health?.hasGoogleAuth, icon: Search },
                { label: 'Email', ok: health?.hasEmailConfig, icon: Mail },
                { label: 'Stripe', ok: health?.hasStripe, icon: CreditCard },
              ].map(c => {
                const Icon = c.icon;
                return (
                  <div key={c.label} className="flex items-center gap-2">
                    <Icon className="w-3 h-3 text-zinc-500" />
                    <span className="text-xs text-zinc-300 flex-1">{c.label}</span>
                    {c.ok ? <Wifi className="w-3 h-3 text-emerald-400/80" /> : <WifiOff className="w-3 h-3 text-zinc-600" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Workspace stats */}
          <div>
            <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mb-2">Workspaces</div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">Total</span>
                <span className="text-xs font-medium text-zinc-200">{workspaces.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">With Webflow site</span>
                <span className="text-xs font-medium text-zinc-200">{workspaces.filter(w => w.webflowSiteId).length}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Storage Monitor */}
      <section className="bg-zinc-900 overflow-hidden border border-zinc-800" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/8 flex items-center justify-center">
            <HardDrive className="w-4 h-4 text-amber-400/80" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-200">Storage Monitor</h3>
            <p className="text-xs text-zinc-500">Persistent disk usage breakdown &amp; cleanup tools</p>
          </div>
          <button onClick={loadStorage} disabled={storageLoading} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" title="Refresh">
            <RefreshCw className={`w-4 h-4 text-zinc-500 ${storageLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {storage ? (
          <div className="px-5 py-4 space-y-4">
            {/* Total usage bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-zinc-300">{formatBytes(storage.totalBytes)}</span>
                <span className="text-[11px] text-zinc-500">{storage.totalFiles.toLocaleString()} files</span>
              </div>
              <div className="h-3 bg-zinc-800 rounded-full overflow-hidden flex">
                {storage.breakdown.slice(0, 6).map((d, i) => {
                  const pct = storage.totalBytes > 0 ? (d.bytes / storage.totalBytes) * 100 : 0;
                  if (pct < 0.5) return null;
                  const colors = ['bg-amber-500', 'bg-teal-500', 'bg-blue-500', 'bg-violet-500', 'bg-rose-500', 'bg-emerald-500'];
                  return <div key={d.name} className={`h-full ${colors[i % colors.length]} transition-all`} style={{ width: `${pct}%` }} title={`${d.label}: ${formatBytes(d.bytes)}`} />;
                })}
              </div>
            </div>

            {/* Per-category breakdown */}
            <div className="space-y-1">
              {storage.breakdown.map((d, i) => {
                const pct = storage.totalBytes > 0 ? (d.bytes / storage.totalBytes) * 100 : 0;
                const colors = ['text-amber-400', 'text-teal-400', 'text-blue-400', 'text-violet-400', 'text-rose-400', 'text-emerald-400'];
                return (
                  <div key={d.name} className="flex items-center gap-2 py-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${colors[i % colors.length].replace('text-', 'bg-')}`} />
                    <span className="text-xs text-zinc-400 flex-1 truncate">{d.label}</span>
                    <span className="text-[11px] text-zinc-500 tabular-nums">{d.fileCount} files</span>
                    <span className="text-xs font-medium text-zinc-300 tabular-nums w-16 text-right">{formatBytes(d.bytes)}</span>
                    <span className="text-[11px] text-zinc-600 tabular-nums w-10 text-right">{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-zinc-800">
              <div className="text-center">
                <div className="text-xs font-medium text-zinc-300">{storage.chatSessionCount}</div>
                <div className="text-[11px] text-zinc-500">Chat sessions</div>
              </div>
              <div className="text-center">
                <div className="text-xs font-medium text-zinc-300">{storage.backupRetentionDays}d</div>
                <div className="text-[11px] text-zinc-500">Backup retention</div>
              </div>
              <div className="text-center">
                <div className="text-xs font-medium text-zinc-300">
                  {storage.oldestChatSession ? new Date(storage.oldestChatSession).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                </div>
                <div className="text-[11px] text-zinc-500">Oldest chat</div>
              </div>
            </div>

            {/* Prune actions */}
            <div className="pt-2 border-t border-zinc-800">
              <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mb-2">Cleanup Actions</div>
              <div className="space-y-1.5">
                <button
                  onClick={() => runPrune('backups')}
                  disabled={!!pruning}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors text-left"
                >
                  <Trash2 className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
                  <div className="flex-1">
                    <span className="text-xs text-zinc-300">Prune old backups</span>
                    <span className="text-[11px] text-zinc-500 ml-1.5">Keep last 3 days</span>
                  </div>
                  {pruning === 'backups' && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
                </button>
                <button
                  onClick={() => runPrune('reports')}
                  disabled={!!pruning}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors text-left"
                >
                  <Trash2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <div className="flex-1">
                    <span className="text-xs text-zinc-300">Prune audit snapshots</span>
                    <span className="text-[11px] text-zinc-500 ml-1.5">Keep last 20 per site</span>
                  </div>
                  {pruning === 'reports' && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
                </button>
                <button
                  onClick={() => runPrune('chat')}
                  disabled={!!pruning}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors text-left"
                >
                  <Trash2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                  <div className="flex-1">
                    <span className="text-xs text-zinc-300">Prune chat history</span>
                    <span className="text-[11px] text-zinc-500 ml-1.5">&gt;90 days old</span>
                  </div>
                  {pruning === 'chat' && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
                </button>
                <button
                  onClick={() => runPrune('activity')}
                  disabled={!!pruning}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors text-left"
                >
                  <Trash2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <div className="flex-1">
                    <span className="text-xs text-zinc-300">Prune activity logs</span>
                    <span className="text-[11px] text-zinc-500 ml-1.5">&gt;6 months old</span>
                  </div>
                  {pruning === 'activity' && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
                </button>
              </div>
            </div>
          </div>
        ) : storageLoading ? (
          <div className="px-5 py-8 flex items-center justify-center gap-2 text-xs text-zinc-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning storage...
          </div>
        ) : (
          <div className="px-5 py-4 text-xs text-zinc-500">Unable to load storage stats</div>
        )}
      </section>

      {/* Stripe / Payments */}
      <StripeSettings />

      {/* Hint */}
      <p className="text-xs text-center py-4 text-zinc-500">
        Workspace-specific settings (GSC, GA4, client dashboards) are now in the gear icon next to each workspace.
      </p>
    </div>
  );
}
