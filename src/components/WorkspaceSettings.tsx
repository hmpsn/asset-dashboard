import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import {
  Globe, Search, BarChart3, Loader2, Check, Unplug, ExternalLink, LogIn, LogOut,
  Copy, CheckCircle, Lock, KeyRound, X, Users, ChevronRight,
  Pin, PinOff, Pencil, Save, RefreshCw, Plus, Trash2, ArrowUp, ArrowDown, Palette,
} from 'lucide-react';

interface EventGroup { id: string; name: string; order: number; color: string; defaultPageFilter?: string; allowedPages?: string[]; }
interface EventDisplayConfig { eventName: string; displayName: string; pinned: boolean; group?: string; }
interface GscSite { siteUrl: string; permissionLevel: string; }
interface GA4Property { name: string; displayName: string; propertyId: string; }
interface WorkspaceData {
  id: string; name: string;
  webflowSiteId?: string; webflowSiteName?: string;
  gscPropertyUrl?: string; ga4PropertyId?: string;
  hasPassword?: boolean;
  eventConfig?: EventDisplayConfig[];
  eventGroups?: EventGroup[];
}

interface Props {
  workspaceId: string;
  workspaceName: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  onUpdate?: (patch: Record<string, unknown>) => void;
}

type SectionTab = 'connections' | 'dashboard';

export function WorkspaceSettings({ workspaceId, workspaceName, webflowSiteId, webflowSiteName, onUpdate }: Props) {
  const { toast } = useToast();
  const [tab, setTab] = useState<SectionTab>('connections');
  const [ws, setWs] = useState<WorkspaceData | null>(null);
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; configured: boolean } | null>(null);
  const [gscSites, setGscSites] = useState<GscSite[]>([]);
  const [ga4Properties, setGa4Properties] = useState<GA4Property[]>([]);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  // Event config state
  const [showEventConfig, setShowEventConfig] = useState(false);
  const [availableEvents, setAvailableEvents] = useState<{eventName: string; eventCount: number; users: number}[]>([]);
  const [localEventConfig, setLocalEventConfig] = useState<EventDisplayConfig[]>([]);
  const [localGroups, setLocalGroups] = useState<EventGroup[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [savingEvents, setSavingEvents] = useState(false);
  const [editingEventName, setEditingEventName] = useState<string | null>(null);
  const [editingDisplayName, setEditingDisplayName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#14b8a6');

  const GROUP_COLORS = ['#14b8a6', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#fb923c', '#2dd4bf', '#e879f9'];

  useEffect(() => {
    // Load workspace data
    fetch(`/api/workspaces/${workspaceId}`).then(r => r.json()).then(setWs).catch(() => {});
    // Load Google status + properties
    fetch('/api/google/status').then(r => r.json()).then((s: { connected: boolean; configured: boolean }) => {
      setGoogleStatus(s);
      if (s.connected) {
        setLoadingGoogle(true);
        Promise.all([
          fetch('/api/google/gsc-sites').then(r => r.json()).then(d => { if (Array.isArray(d)) setGscSites(d); }),
          fetch('/api/google/ga4-properties').then(r => r.json()).then(d => { if (Array.isArray(d)) setGa4Properties(d); }),
        ]).finally(() => setLoadingGoogle(false));
      }
    }).catch(() => {});
  }, [workspaceId]);

  const patchWorkspace = async (patch: Record<string, unknown>) => {
    const res = await fetch(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const updated = await res.json();
    setWs(updated);
    onUpdate?.(patch);
    return updated;
  };

  const connectGoogle = async () => {
    const res = await fetch('/api/google/auth-url');
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  };

  const disconnectGoogle = async () => {
    await fetch('/api/google/disconnect', { method: 'POST' });
    setGoogleStatus({ connected: false, configured: true });
    setGscSites([]); setGa4Properties([]);
  };

  const saveGscProperty = async (gscPropertyUrl: string) => {
    try { await patchWorkspace({ gscPropertyUrl }); toast('Search Console property saved'); }
    catch { toast('Failed to save', 'error'); }
  };

  const saveGa4Property = async (ga4PropertyId: string) => {
    try { await patchWorkspace({ ga4PropertyId }); toast('GA4 property saved'); }
    catch { toast('Failed to save', 'error'); }
  };

  const copyClientLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/client/${workspaceId}`);
    setCopiedLink(true); toast('Dashboard link copied');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const savePassword = async () => {
    setSavingPassword(true);
    try { await patchWorkspace({ clientPassword: newPassword || '' }); setEditingPassword(false); setNewPassword(''); toast('Password saved'); }
    catch { toast('Failed to save password', 'error'); }
    finally { setSavingPassword(false); }
  };

  const removePassword = async () => {
    setSavingPassword(true);
    try { await patchWorkspace({ clientPassword: '' }); toast('Password removed'); }
    catch { toast('Failed to remove password', 'error'); }
    finally { setSavingPassword(false); }
  };

  // Event config helpers
  const loadEvents = async () => {
    setShowEventConfig(true); setLoadingEvents(true);
    try {
      const res = await fetch(`/api/public/analytics-events/${workspaceId}?days=28`);
      const events = await res.json();
      if (Array.isArray(events)) setAvailableEvents(events);
      setLocalEventConfig(ws?.eventConfig || []);
      setLocalGroups(ws?.eventGroups || []);
    } catch { setAvailableEvents([]); }
    finally { setLoadingEvents(false); }
  };

  const getDisplayName = (name: string) => localEventConfig.find(c => c.eventName === name)?.displayName || name;
  const isPinned = (name: string) => localEventConfig.find(c => c.eventName === name)?.pinned || false;

  const togglePin = (name: string) => {
    setLocalEventConfig(prev => {
      const existing = prev.find(c => c.eventName === name);
      if (existing) return prev.map(c => c.eventName === name ? { ...c, pinned: !c.pinned } : c);
      return [...prev, { eventName: name, displayName: name, pinned: true }];
    });
  };

  const assignGroup = (name: string, groupId: string | undefined) => {
    setLocalEventConfig(prev => {
      const existing = prev.find(c => c.eventName === name);
      if (existing) return prev.map(c => c.eventName === name ? { ...c, group: groupId } : c);
      return [...prev, { eventName: name, displayName: name, pinned: false, group: groupId }];
    });
  };

  const updateDisplayName = (name: string, displayName: string) => {
    setLocalEventConfig(prev => {
      const existing = prev.find(c => c.eventName === name);
      if (existing) return prev.map(c => c.eventName === name ? { ...c, displayName } : c);
      return [...prev, { eventName: name, displayName, pinned: false }];
    });
    setEditingEventName(null);
  };

  const addGroup = () => {
    if (!newGroupName.trim()) return;
    const id = `grp_${Date.now()}`;
    const order = localGroups.length;
    setLocalGroups(prev => [...prev, { id, name: newGroupName.trim(), order, color: newGroupColor || GROUP_COLORS[order % GROUP_COLORS.length] }]);
    setNewGroupName('');
    setNewGroupColor(GROUP_COLORS[(order + 1) % GROUP_COLORS.length]);
  };

  const removeGroup = (gid: string) => {
    setLocalGroups(prev => prev.filter(g => g.id !== gid).map((g, i) => ({ ...g, order: i })));
    setLocalEventConfig(prev => prev.map(c => c.group === gid ? { ...c, group: undefined } : c));
  };

  const moveGroup = (gid: string, dir: -1 | 1) => {
    setLocalGroups(prev => {
      const idx = prev.findIndex(g => g.id === gid);
      if (idx === -1) return prev;
      const ni = idx + dir;
      if (ni < 0 || ni >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[ni]] = [copy[ni], copy[idx]];
      return copy.map((g, i) => ({ ...g, order: i }));
    });
  };

  const saveEventConfig = async () => {
    setSavingEvents(true);
    try { await patchWorkspace({ eventConfig: localEventConfig, eventGroups: localGroups }); toast('Event configuration saved'); }
    catch { toast('Failed to save', 'error'); }
    finally { setSavingEvents(false); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-200">{workspaceName}</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          {webflowSiteName ? `Connected to ${webflowSiteName}` : 'No Webflow site linked'}
        </p>
      </div>

      {/* Tab nav */}
      <nav className="flex items-center gap-1 border-b" style={{ borderColor: 'var(--brand-border)' }}>
        {([['connections', 'Connections'], ['dashboard', 'Client Dashboard']] as [SectionTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="px-4 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px"
            style={tab === id ? { borderColor: 'var(--brand-mint)', color: 'var(--brand-mint)' } : { borderColor: 'transparent', color: 'var(--brand-text-muted)' }}>
            {label}
          </button>
        ))}
      </nav>

      {/* ═══ CONNECTIONS ═══ */}
      {tab === 'connections' && (
        <div className="space-y-5">
          {/* Webflow */}
          <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
            <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--brand-border)' }}>
              <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
                <Globe className="w-4 h-4 text-teal-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Webflow Site</h3>
                <p className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>Linked via workspace dropdown</p>
              </div>
              {webflowSiteId ? (
                <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full flex items-center gap-1">
                  <Check className="w-3 h-3" /> {webflowSiteName}
                </span>
              ) : (
                <span className="text-[10px] text-zinc-500 bg-zinc-800 px-2 py-1 rounded-full flex items-center gap-1">
                  <Unplug className="w-3 h-3" /> Not linked
                </span>
              )}
            </div>
          </section>

          {/* Google Auth */}
          <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
            <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--brand-border)' }}>
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Search className="w-4 h-4 text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Google Account</h3>
                <p className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>Search Console & Analytics access</p>
              </div>
              {googleStatus?.connected ? (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">Connected</span>
                  <button onClick={disconnectGoogle} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" title="Disconnect">
                    <LogOut className="w-4 h-4 text-zinc-500" />
                  </button>
                </div>
              ) : googleStatus?.configured ? (
                <button onClick={connectGoogle} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors">
                  <LogIn className="w-3.5 h-3.5" /> Connect
                </button>
              ) : (
                <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full">Not configured</span>
              )}
            </div>
          </section>

          {/* GSC Property */}
          {googleStatus?.connected && gscSites.length > 0 && (
            <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
              <div className="px-5 py-4 flex items-center gap-3">
                <Search className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium flex-1" style={{ color: 'var(--brand-text-bright)' }}>Search Console Property</span>
                {loadingGoogle ? <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" /> : (
                  <select
                    value={ws?.gscPropertyUrl || ''}
                    onChange={e => saveGscProperty(e.target.value)}
                    className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500 min-w-[200px]"
                  >
                    <option value="">— None —</option>
                    {gscSites.map(s => <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>)}
                  </select>
                )}
              </div>
            </section>
          )}

          {/* GA4 Property */}
          {googleStatus?.connected && ga4Properties.length > 0 && (
            <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
              <div className="px-5 py-4 flex items-center gap-3">
                <BarChart3 className="w-4 h-4 text-teal-400" />
                <span className="text-sm font-medium flex-1" style={{ color: 'var(--brand-text-bright)' }}>GA4 Property</span>
                {loadingGoogle ? <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" /> : (
                  <select
                    value={ws?.ga4PropertyId || ''}
                    onChange={e => saveGa4Property(e.target.value)}
                    className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500 min-w-[220px]"
                  >
                    <option value="">— None —</option>
                    {ga4Properties.map(p => <option key={p.propertyId} value={p.propertyId}>{p.displayName}</option>)}
                  </select>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ═══ CLIENT DASHBOARD ═══ */}
      {tab === 'dashboard' && (
        <div className="space-y-5">
          {!webflowSiteId ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Users className="w-8 h-8 text-zinc-600" />
              <p className="text-sm text-zinc-400">Link a Webflow site first to enable the client dashboard</p>
            </div>
          ) : (<>
            {/* Dashboard link + password */}
            <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
              <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--brand-border)' }}>
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-teal-400" />
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Client Access</h3>
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>Share the dashboard link with your client. Optionally protect it with a password.</p>
              </div>
              <div className="px-5 py-4 space-y-3">
                {/* Link row */}
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[11px] text-zinc-400 bg-zinc-800 px-3 py-2 rounded-lg truncate">
                    {window.location.origin}/client/{workspaceId}
                  </code>
                  <button onClick={copyClientLink}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all"
                    style={copiedLink ? { backgroundColor: 'rgba(52,211,153,0.1)', color: '#34d399', border: '1px solid rgba(52,211,153,0.2)' }
                      : { backgroundColor: 'var(--brand-bg-surface)', color: 'var(--brand-text)', border: '1px solid var(--brand-border)' }}>
                    {copiedLink ? <><CheckCircle className="w-3.5 h-3.5" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                  </button>
                  <a href={`/client/${workspaceId}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                    style={{ backgroundColor: 'var(--brand-mint-dim)', color: 'var(--brand-mint)', border: '1px solid rgba(45,212,191,0.2)' }}>
                    <ExternalLink className="w-3.5 h-3.5" /> Open <ChevronRight className="w-3 h-3" />
                  </a>
                </div>
                {/* Password */}
                <div className="flex items-center gap-2">
                  {ws?.hasPassword ? (
                    <>
                      <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Password Protected
                      </span>
                      <button onClick={() => { setEditingPassword(true); setNewPassword(''); }}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1.5 py-1 rounded transition-colors">Change</button>
                      <button onClick={removePassword} disabled={savingPassword}
                        className="text-[10px] text-red-400/60 hover:text-red-400 px-1.5 py-1 rounded transition-colors">Remove</button>
                    </>
                  ) : (
                    <button onClick={() => { setEditingPassword(true); setNewPassword(''); }}
                      className="flex items-center gap-1 text-[10px] text-amber-400/70 bg-amber-500/10 px-2 py-1 rounded-full hover:bg-amber-500/15 transition-colors">
                      <KeyRound className="w-3 h-3" /> Set Password
                    </button>
                  )}
                </div>
                {editingPassword && (
                  <div className="flex items-center gap-2">
                    <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                      placeholder="Enter new password" autoFocus
                      onKeyDown={e => e.key === 'Enter' && newPassword.trim() && savePassword()}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" />
                    <button onClick={savePassword} disabled={savingPassword || !newPassword.trim()}
                      className="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-medium transition-colors">
                      {savingPassword ? '...' : 'Save'}
                    </button>
                    <button onClick={() => { setEditingPassword(false); setNewPassword(''); }}
                      className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Event Configuration */}
            {ws?.ga4PropertyId && (
              <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
                <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--brand-border)' }}>
                  <Pin className="w-4 h-4 text-teal-400" />
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Event Display & Pinning</h3>
                    <p className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>Rename events, pin key metrics, and group them for the client dashboard.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {showEventConfig && (
                      <button onClick={saveEventConfig} disabled={savingEvents}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors disabled:opacity-50">
                        {savingEvents ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                      </button>
                    )}
                    <button onClick={() => showEventConfig ? setShowEventConfig(false) : loadEvents()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      style={{ backgroundColor: 'var(--brand-bg-card)', color: 'var(--brand-text)' }}>
                      {showEventConfig ? 'Close' : <><RefreshCw className="w-3 h-3" /> Configure</>}
                    </button>
                  </div>
                </div>

                {showEventConfig && (
                  <div className="px-5 py-4 space-y-4">
                    {loadingEvents ? (
                      <div className="flex items-center gap-2 text-xs py-4 justify-center" style={{ color: 'var(--brand-text-muted)' }}>
                        <Loader2 className="w-3 h-3 animate-spin" /> Loading events from GA4...
                      </div>
                    ) : availableEvents.length === 0 ? (
                      <p className="text-xs py-4 text-center" style={{ color: 'var(--brand-text-muted)' }}>No events found.</p>
                    ) : (<>
                      {/* Groups */}
                      <div className="rounded-lg border border-zinc-700/50 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Palette className="w-3.5 h-3.5 text-teal-400" />
                          <span className="text-xs font-medium" style={{ color: 'var(--brand-text-bright)' }}>Event Groups</span>
                          <span className="text-[10px] text-zinc-600 ml-auto">{localGroups.length} groups</span>
                        </div>
                        {localGroups.sort((a, b) => a.order - b.order).map((g, idx) => (
                          <div key={g.id} className="rounded-lg hover:bg-white/5 mb-1">
                            <div className="flex items-center gap-2 px-2 py-1.5">
                              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                              <span className="text-xs flex-1" style={{ color: 'var(--brand-text)' }}>{g.name}</span>
                              <span className="text-[10px] text-zinc-600">{localEventConfig.filter(c => c.group === g.id).length} events</span>
                              <button onClick={() => moveGroup(g.id, -1)} disabled={idx === 0} className="p-0.5 text-zinc-600 hover:text-zinc-400 disabled:opacity-30"><ArrowUp className="w-3 h-3" /></button>
                              <button onClick={() => moveGroup(g.id, 1)} disabled={idx === localGroups.length - 1} className="p-0.5 text-zinc-600 hover:text-zinc-400 disabled:opacity-30"><ArrowDown className="w-3 h-3" /></button>
                              <button onClick={() => removeGroup(g.id)} className="p-0.5 text-red-400/50 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                            </div>
                            <div className="px-2 pb-2 flex flex-wrap items-center gap-2">
                              <div className="flex items-center gap-1.5">
                                <label className="text-[10px] text-zinc-600 whitespace-nowrap">Default page:</label>
                                <input
                                  value={g.defaultPageFilter || ''}
                                  onChange={e => setLocalGroups(prev => prev.map(gr => gr.id === g.id ? { ...gr, defaultPageFilter: e.target.value || undefined } : gr))}
                                  placeholder="/contact"
                                  className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[10px] text-zinc-300 w-28 focus:outline-none focus:border-teal-500 placeholder:text-zinc-600"
                                />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <label className="text-[10px] text-zinc-600 whitespace-nowrap">Allowed pages:</label>
                                <input
                                  value={(g.allowedPages || []).join(', ')}
                                  onChange={e => setLocalGroups(prev => prev.map(gr => gr.id === g.id ? { ...gr, allowedPages: e.target.value ? e.target.value.split(',').map(s => s.trim()).filter(Boolean) : undefined } : gr))}
                                  placeholder="/page1, /page2"
                                  className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[10px] text-zinc-300 w-40 focus:outline-none focus:border-teal-500 placeholder:text-zinc-600"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center gap-2 mt-2">
                          <input type="color" value={newGroupColor} onChange={e => setNewGroupColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer bg-transparent border-0" />
                          <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="New group name..."
                            onKeyDown={e => e.key === 'Enter' && addGroup()}
                            className="flex-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500" />
                          <button onClick={addGroup} disabled={!newGroupName.trim()}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white text-[10px] font-medium transition-colors">
                            <Plus className="w-3 h-3" /> Add
                          </button>
                        </div>
                      </div>

                      {/* Events list */}
                      <div className="space-y-1 max-h-[400px] overflow-y-auto">
                        {availableEvents.map(ev => {
                          const pinned = isPinned(ev.eventName);
                          const displayName = getDisplayName(ev.eventName);
                          const isEditing = editingEventName === ev.eventName;
                          const evGroup = localEventConfig.find(c => c.eventName === ev.eventName)?.group;
                          return (
                            <div key={ev.eventName} className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${pinned ? 'bg-teal-500/10 border border-teal-500/20' : 'hover:bg-white/5'}`}>
                              <button onClick={() => togglePin(ev.eventName)} className="shrink-0" title={pinned ? 'Unpin' : 'Pin'}>
                                {pinned ? <Pin className="w-3.5 h-3.5 text-teal-400" /> : <PinOff className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-400" />}
                              </button>
                              <div className="flex-1 min-w-0">
                                {isEditing ? (
                                  <div className="flex items-center gap-1.5">
                                    <input autoFocus value={editingDisplayName} onChange={e => setEditingDisplayName(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Enter') updateDisplayName(ev.eventName, editingDisplayName); if (e.key === 'Escape') setEditingEventName(null); }}
                                      className="flex-1 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs text-zinc-200 focus:outline-none focus:border-teal-500" />
                                    <button onClick={() => updateDisplayName(ev.eventName, editingDisplayName)} className="text-emerald-400 hover:text-emerald-300"><Check className="w-3.5 h-3.5" /></button>
                                    <button onClick={() => setEditingEventName(null)} className="text-zinc-500 hover:text-zinc-300"><X className="w-3.5 h-3.5" /></button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-medium truncate" style={{ color: displayName !== ev.eventName ? 'var(--brand-text-bright)' : 'var(--brand-text)' }}>
                                      {displayName !== ev.eventName ? displayName : ev.eventName.replace(/_/g, ' ')}
                                    </span>
                                    {displayName !== ev.eventName && <span className="text-[10px] text-zinc-600 font-mono">{ev.eventName}</span>}
                                  </div>
                                )}
                              </div>
                              {localGroups.length > 0 && (
                                <select value={evGroup || ''} onChange={e => assignGroup(ev.eventName, e.target.value || undefined)}
                                  className="px-1.5 py-1 bg-zinc-800 border border-zinc-700 rounded text-[10px] text-zinc-400 focus:outline-none focus:border-teal-500 max-w-[100px]">
                                  <option value="">No group</option>
                                  {localGroups.sort((a, b) => a.order - b.order).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                </select>
                              )}
                              <span className="text-[10px] text-zinc-500 tabular-nums shrink-0">{ev.eventCount.toLocaleString()}</span>
                              <button onClick={() => { setEditingEventName(ev.eventName); setEditingDisplayName(getDisplayName(ev.eventName) !== ev.eventName ? getDisplayName(ev.eventName) : ''); }}
                                className="shrink-0" title="Rename"><Pencil className="w-3 h-3 text-zinc-600 hover:text-zinc-400" /></button>
                            </div>
                          );
                        })}
                      </div>
                    </>)}
                  </div>
                )}
              </section>
            )}
          </>)}
        </div>
      )}
    </div>
  );
}
