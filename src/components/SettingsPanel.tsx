import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import {
  Check, Search, Loader2, LogIn, LogOut, Globe, ExternalLink, Unplug,
  Shield, Key, Mail, CreditCard, Wifi, WifiOff, HardDrive, Trash2, RefreshCw, CalendarDays,
} from 'lucide-react';
import { StripeSettings } from './StripeSettings';
import { FeatureFlagSettings } from './FeatureFlagSettings';
import { Icon } from './ui';
import { get, post, patch, getOptional, getSafe } from '../api/client';

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
  const [bookingUrl, setBookingUrl] = useState('');
  const [bookingSaving, setBookingSaving] = useState(false);

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
    get<{ bookingUrl: string }>('/api/studio-config').then(d => setBookingUrl(d.bookingUrl || '')).catch(() => {});
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
        <h2 className="text-lg font-semibold text-[var(--brand-text-bright)]">Settings</h2>
        <p className="t-caption mt-0.5 text-[var(--brand-text-muted)]">Account-level connections and configuration</p>
      </div>

      {/* Google Account Connection */}
      {/* pr-check-disable-next-line -- hand-rolled section card with inner subsections; mirrors SectionCard brand signature intentionally */}
      <section className="bg-[var(--surface-2)] overflow-hidden border border-[var(--brand-border)]" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--brand-border)]">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-blue-500/10 flex items-center justify-center">
            <Icon as={Search} size="md" className="text-accent-info" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Google Account</h3>
            <p className="t-caption text-[var(--brand-text-muted)]">Connect once to access Search Console &amp; GA4 across all workspaces</p>
          </div>
          {googleStatus?.connected ? (
            <div className="flex items-center gap-2">
              <span className="t-caption-sm font-medium text-accent-success bg-emerald-500/10 px-2 py-1 rounded-[var(--radius-pill)]">Connected</span>
              <button onClick={disconnectGoogle} className="p-1.5 rounded-[var(--radius-lg)] hover:bg-white/5 transition-colors" title="Disconnect Google">
                <Icon as={LogOut} size="md" className="text-[var(--brand-text-muted)]" />
              </button>
            </div>
          ) : googleStatus?.configured ? (
            <button onClick={connectGoogle} className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-lg)] bg-teal-600 hover:bg-teal-500 text-white t-caption font-medium transition-colors">
              <Icon as={LogIn} size="sm" /> Connect Google
            </button>
          ) : (
            <span className="t-caption-sm text-accent-warning bg-amber-500/8 px-2 py-1 rounded-[var(--radius-pill)]">Not configured</span>
          )}
        </div>

        {googleStatus?.connected && (
          <div className="px-5 py-3">
            {loadingGsc ? (
              <div className="flex items-center gap-2 t-caption py-2 text-[var(--brand-text-muted)]">
                <Icon as={Loader2} size="sm" className="animate-spin" /> Loading properties...
              </div>
            ) : gscSites.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 py-1">
                {gscSites.map(s => (
                  <span key={s.siteUrl} className="t-caption-sm px-2 py-1 rounded-[var(--radius-md)] bg-[var(--surface-3)] text-[var(--brand-text-muted)]">{s.siteUrl}</span>
                ))}
              </div>
            ) : (
              <p className="t-caption py-2 text-[var(--brand-text-muted)]">No properties found. Make sure your Google account has Search Console access.</p>
            )}
          </div>
        )}
      </section>

      {/* Webflow Connections Overview */}
      {/* pr-check-disable-next-line -- hand-rolled section card with inner subsections; mirrors SectionCard brand signature intentionally */}
      <section className="bg-[var(--surface-2)] overflow-hidden border border-[var(--brand-border)]" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <div className="px-5 py-4 border-b border-[var(--brand-border)]">
          <div className="flex items-center gap-2">
            <Icon as={Globe} size="md" className="text-accent-brand" />
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Webflow Connections</h3>
          </div>
          <p className="t-caption mt-0.5 text-[var(--brand-text-muted)]">
            Link sites from the workspace dropdown. Generate tokens at{' '}
            <a href="https://webflow.com/dashboard/account/integrations" target="_blank" rel="noopener noreferrer" className="text-accent-brand hover:text-accent-brand inline-flex items-center gap-0.5">
              webflow.com <Icon as={ExternalLink} size="sm" />
            </a>
          </p>
        </div>
        <div className="divide-y divide-[var(--brand-border)]">
          {linked.map(ws => (
            <div key={ws.id} className="px-5 py-3 flex items-center gap-3">
              <Icon as={Check} size="md" className="text-accent-success shrink-0" />
              <span className="text-sm font-medium text-[var(--brand-text-bright)]">{ws.name}</span>
              <span className="t-caption text-[var(--brand-text-muted)]">{ws.webflowSiteName}</span>
            </div>
          ))}
          {unlinked.map(ws => (
            <div key={ws.id} className="px-5 py-3 flex items-center gap-3 opacity-60">
              <Icon as={Unplug} size="md" className="text-[var(--brand-text-muted)] shrink-0" />
              <span className="text-sm text-[var(--brand-text-muted)]">{ws.name}</span>
              <span className="t-caption text-[var(--brand-text-muted)] ml-auto">Not linked</span>
            </div>
          ))}
          {workspaces.length === 0 && (
            <div className="px-5 py-4">
              <p className="text-sm text-[var(--brand-text-muted)]">No workspaces yet. Create one from the workspace dropdown.</p>
            </div>
          )}
        </div>
      </section>

      {/* API Keys */}
      {/* pr-check-disable-next-line -- hand-rolled section card with inner subsections; mirrors SectionCard brand signature intentionally */}
      <section className="bg-[var(--surface-2)] overflow-hidden border border-[var(--brand-border)]" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <div className="px-5 py-4 border-b border-[var(--brand-border)]">
          <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">API Keys</h3>
        </div>
        <div className="px-5 py-3 flex items-center gap-3">
          <Icon as={Check} size="md" className="text-accent-success" />
          <div>
            <span className="text-sm text-[var(--brand-text-muted)]">OpenAI API Key</span>
            <span className="t-caption text-[var(--brand-text-muted)] ml-2">Configured via .env</span>
          </div>
        </div>
      </section>

      {/* Platform Health */}
      {/* pr-check-disable-next-line -- hand-rolled section card with inner subsections; mirrors SectionCard brand signature intentionally */}
      <section className="bg-[var(--surface-2)] overflow-hidden border border-[var(--brand-border)]" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <div className="px-5 py-4 border-b border-[var(--brand-border)]">
          <div className="flex items-center gap-2">
            <Icon as={Shield} size="md" className="text-accent-brand" />
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Platform Health</h3>
          </div>
          <p className="t-caption mt-0.5 text-[var(--brand-text-muted)]">Connection status and workspace overview</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Connection status */}
          <div>
            <div className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-2">Connections</div>
            <div className="space-y-1.5">
              {[
                { label: 'OpenAI', ok: health?.hasOpenAIKey, icon: Key },
                { label: 'Webflow', ok: health?.hasWebflowToken, icon: Globe },
                { label: 'Google Auth', ok: health?.hasGoogleAuth, icon: Search },
                { label: 'Email', ok: health?.hasEmailConfig, icon: Mail },
                { label: 'Stripe', ok: health?.hasStripe, icon: CreditCard },
              ].map(c => (
                <div key={c.label} className="flex items-center gap-2">
                  <Icon as={c.icon} size="sm" className="text-[var(--brand-text-muted)]" />
                  <span className="t-caption text-[var(--brand-text)] flex-1">{c.label}</span>
                  {c.ok
                    ? <Icon as={Wifi} size="sm" className="text-accent-success" />
                    : <Icon as={WifiOff} size="sm" className="text-[var(--brand-border-hover)]" />}
                </div>
              ))}
            </div>
          </div>

          {/* Workspace stats */}
          <div>
            <div className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-2">Workspaces</div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="t-caption text-[var(--brand-text-muted)]">Total</span>
                <span className="t-caption font-medium text-[var(--brand-text-bright)]">{workspaces.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="t-caption text-[var(--brand-text-muted)]">With Webflow site</span>
                <span className="t-caption font-medium text-[var(--brand-text-bright)]">{workspaces.filter(w => w.webflowSiteId).length}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Storage Monitor */}
      {/* pr-check-disable-next-line -- hand-rolled section card with inner subsections; mirrors SectionCard brand signature intentionally */}
      <section className="bg-[var(--surface-2)] overflow-hidden border border-[var(--brand-border)]" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <div className="px-5 py-4 border-b border-[var(--brand-border)] flex items-center gap-3">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-amber-500/8 flex items-center justify-center">
            <Icon as={HardDrive} size="md" className="text-accent-warning" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Storage Monitor</h3>
            <p className="t-caption text-[var(--brand-text-muted)]">Persistent disk usage breakdown &amp; cleanup tools</p>
          </div>
          <button onClick={loadStorage} disabled={storageLoading} className="p-1.5 rounded-[var(--radius-lg)] hover:bg-white/5 transition-colors" title="Refresh">
            <Icon as={RefreshCw} size="md" className={`text-[var(--brand-text-muted)] ${storageLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {storage ? (
          <div className="px-5 py-4 space-y-4">
            {/* Total usage bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="t-caption font-medium text-[var(--brand-text)]">{formatBytes(storage.totalBytes)}</span>
                <span className="t-caption-sm text-[var(--brand-text-muted)]">{storage.totalFiles.toLocaleString()} files</span>
              </div>
              <div className="h-3 bg-[var(--surface-3)] rounded-[var(--radius-pill)] overflow-hidden flex">
                {storage.breakdown.slice(0, 6).map((d, i) => {
                  const pct = storage.totalBytes > 0 ? (d.bytes / storage.totalBytes) * 100 : 0;
                  if (pct < 0.5) return null;
                  const colors = ['bg-amber-500', 'bg-teal-500', 'bg-blue-500', 'bg-orange-500', 'bg-red-500', 'bg-emerald-500'];
                  return <div key={d.name} className={`h-full ${colors[i % colors.length]} transition-all`} style={{ width: `${pct}%` }} title={`${d.label}: ${formatBytes(d.bytes)}`} />;
                })}
              </div>
            </div>

            {/* Per-category breakdown */}
            <div className="space-y-1">
              {storage.breakdown.map((d, i) => {
                const pct = storage.totalBytes > 0 ? (d.bytes / storage.totalBytes) * 100 : 0;
                const colors = ['text-accent-warning', 'text-accent-brand', 'text-accent-info', 'text-accent-orange', 'text-accent-danger', 'text-accent-success'];
                return (
                  <div key={d.name} className="flex items-center gap-2 py-1">
                    <span className={`w-1.5 h-1.5 rounded-[var(--radius-pill)] ${colors[i % colors.length].replace('text-', 'bg-')}`} />
                    <span className="t-caption text-[var(--brand-text-muted)] flex-1 truncate">{d.label}</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)] tabular-nums">{d.fileCount} files</span>
                    <span className="t-caption font-medium text-[var(--brand-text)] tabular-nums w-16 text-right">{formatBytes(d.bytes)}</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)] tabular-nums w-10 text-right">{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-[var(--brand-border)]">
              <div className="text-center">
                <div className="t-caption font-medium text-[var(--brand-text)]">{storage.chatSessionCount}</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Chat sessions</div>
              </div>
              <div className="text-center">
                <div className="t-caption font-medium text-[var(--brand-text)]">{storage.backupRetentionDays}d</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Backup retention</div>
              </div>
              <div className="text-center">
                <div className="t-caption font-medium text-[var(--brand-text)]">
                  {storage.oldestChatSession ? new Date(storage.oldestChatSession).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                </div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">Oldest chat</div>
              </div>
            </div>

            {/* Prune actions */}
            <div className="pt-2 border-t border-[var(--brand-border)]">
              <div className="t-caption-sm text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-2">Cleanup Actions</div>
              <div className="space-y-1.5">
                <button
                  onClick={() => runPrune('backups')}
                  disabled={!!pruning}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] transition-colors text-left"
                >
                  <Icon as={Trash2} size="sm" className="text-accent-warning shrink-0" />
                  <div className="flex-1">
                    <span className="t-caption text-[var(--brand-text)]">Prune old backups</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)] ml-1.5">Keep last 3 days</span>
                  </div>
                  {pruning === 'backups' && <Icon as={Loader2} size="sm" className="animate-spin text-[var(--brand-text-muted)]" />}
                </button>
                <button
                  onClick={() => runPrune('reports')}
                  disabled={!!pruning}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] transition-colors text-left"
                >
                  <Icon as={Trash2} size="sm" className="text-[var(--brand-text-muted)] shrink-0" />
                  <div className="flex-1">
                    <span className="t-caption text-[var(--brand-text)]">Prune audit snapshots</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)] ml-1.5">Keep last 20 per site</span>
                  </div>
                  {pruning === 'reports' && <Icon as={Loader2} size="sm" className="animate-spin text-[var(--brand-text-muted)]" />}
                </button>
                <button
                  onClick={() => runPrune('chat')}
                  disabled={!!pruning}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] transition-colors text-left"
                >
                  <Icon as={Trash2} size="sm" className="text-accent-brand shrink-0" />
                  <div className="flex-1">
                    <span className="t-caption text-[var(--brand-text)]">Prune chat history</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)] ml-1.5">&gt;90 days old</span>
                  </div>
                  {pruning === 'chat' && <Icon as={Loader2} size="sm" className="animate-spin text-[var(--brand-text-muted)]" />}
                </button>
                <button
                  onClick={() => runPrune('activity')}
                  disabled={!!pruning}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] transition-colors text-left"
                >
                  <Icon as={Trash2} size="sm" className="text-accent-danger shrink-0" />
                  <div className="flex-1">
                    <span className="t-caption text-[var(--brand-text)]">Prune activity logs</span>
                    <span className="t-caption-sm text-[var(--brand-text-muted)] ml-1.5">&gt;6 months old</span>
                  </div>
                  {pruning === 'activity' && <Icon as={Loader2} size="sm" className="animate-spin text-[var(--brand-text-muted)]" />}
                </button>
              </div>
            </div>
          </div>
        ) : storageLoading ? (
          <div className="px-5 py-8 flex items-center justify-center gap-2 t-caption text-[var(--brand-text-muted)]">
            <Icon as={Loader2} size="sm" className="animate-spin" /> Scanning storage...
          </div>
        ) : (
          <div className="px-5 py-4 t-caption text-[var(--brand-text-muted)]">Unable to load storage stats</div>
        )}
      </section>

      {/* Studio Config — Booking URL */}
      {/* pr-check-disable-next-line -- hand-rolled section card with inner subsections; mirrors SectionCard brand signature intentionally */}
      <section className="bg-[var(--surface-2)] overflow-hidden border border-[var(--brand-border)]" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
        <div className="px-5 py-4 flex items-center gap-3 border-b border-[var(--brand-border)]">
          <div className="w-8 h-8 rounded-[var(--radius-lg)] bg-teal-500/10 flex items-center justify-center">
            <Icon as={CalendarDays} size="md" className="text-accent-brand" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">Booking Link</h3>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">Shown as a "Book a call" button in the client AI chat when service interest is detected.</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex gap-2">
            <input
              type="url"
              value={bookingUrl}
              onChange={e => setBookingUrl(e.target.value)}
              placeholder="https://cal.com/yourname or https://calendly.com/yourname"
              className="flex-1 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-2 t-caption text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500"
            />
            <button
              onClick={async () => {
                setBookingSaving(true);
                try {
                  await patch('/api/studio-config', { bookingUrl });
                  toast(bookingUrl ? 'Booking link saved' : 'Booking link cleared');
                } catch { toast('Failed to save'); }
                finally { setBookingSaving(false); }
              }}
              disabled={bookingSaving}
              className="px-3 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-[var(--radius-lg)] t-caption text-white transition-colors flex items-center gap-1.5"
            >
              {bookingSaving ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={Check} size="sm" />}
              Save
            </button>
          </div>
          {bookingUrl && (
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 t-caption-sm text-accent-brand hover:text-accent-brand transition-colors">
              <Icon as={ExternalLink} size="sm" /> Preview link
            </a>
          )}
        </div>
      </section>

      {/* Feature Flags */}
      <FeatureFlagSettings />

      {/* Stripe / Payments */}
      <StripeSettings />

      {/* Hint */}
      <p className="t-caption text-center py-4 text-[var(--brand-text-muted)]">
        Workspace-specific settings (GSC, GA4, client dashboards) are now in the gear icon next to each workspace.
      </p>
    </div>
  );
}
