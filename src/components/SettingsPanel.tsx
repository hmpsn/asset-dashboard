import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import {
  Check, Globe, ExternalLink, Search, Loader2, Copy, CheckCircle,
  LogIn, LogOut, ChevronRight, Users, Unplug, Lock, KeyRound, X, BarChart3,
  Pin, PinOff, Pencil, Save, RefreshCw,
} from 'lucide-react';

interface EventDisplayConfig {
  eventName: string;
  displayName: string;
  pinned: boolean;
  group?: string;
}

interface Workspace {
  id: string;
  name: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
  hasPassword?: boolean;
  eventConfig?: EventDisplayConfig[];
}

interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

interface GA4Property {
  name: string;
  displayName: string;
  propertyId: string;
}

type SettingsTab = 'connections' | 'integrations' | 'dashboards';

export function SettingsPanel() {
  const { toast } = useToast();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('connections');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [gscSites, setGscSites] = useState<GscSite[]>([]);
  const [ga4Properties, setGa4Properties] = useState<GA4Property[]>([]);
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; configured: boolean } | null>(null);
  const [loadingGsc, setLoadingGsc] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [editingPassword, setEditingPassword] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [eventConfigWs, setEventConfigWs] = useState<string | null>(null);
  const [availableEvents, setAvailableEvents] = useState<{eventName: string; eventCount: number; users: number}[]>([]);
  const [localEventConfig, setLocalEventConfig] = useState<EventDisplayConfig[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [savingEvents, setSavingEvents] = useState(false);
  const [editingEventName, setEditingEventName] = useState<string | null>(null);
  const [editingDisplayName, setEditingDisplayName] = useState('');

  useEffect(() => {
    fetch('/api/workspaces').then(r => r.json()).then(setWorkspaces).catch(() => {});
    fetch('/api/google/status').then(r => r.json()).then((s: { connected: boolean; configured: boolean }) => {
      setGoogleStatus(s);
      if (s.connected) {
        loadGscSites();
        loadGA4Properties();
      }
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

  const loadGA4Properties = async () => {
    try {
      const res = await fetch('/api/google/ga4-properties');
      const props = await res.json();
      if (Array.isArray(props)) setGa4Properties(props);
    } catch { /* ignore */ }
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
    setGa4Properties([]);
    setWorkspaces(prev => prev.map(w => ({ ...w, gscPropertyUrl: undefined, ga4PropertyId: undefined })));
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
      toast('Search Console property saved');
    } catch { toast('Failed to save property', 'error'); }
  };

  const copyClientLink = (wsId: string) => {
    const url = `${window.location.origin}/client/${wsId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(wsId);
    toast('Dashboard link copied');
    setTimeout(() => setCopiedLink(null), 2000);
  };

  const savePassword = async (wsId: string) => {
    setSavingPassword(true);
    try {
      const res = await fetch(`/api/workspaces/${wsId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientPassword: newPassword || '' }),
      });
      const updated = await res.json();
      setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, hasPassword: updated.hasPassword } : w));
      setEditingPassword(null);
      setNewPassword('');
      toast('Password saved');
    } catch { toast('Failed to save password', 'error'); }
    finally { setSavingPassword(false); }
  };

  const removePassword = async (wsId: string) => {
    setSavingPassword(true);
    try {
      const res = await fetch(`/api/workspaces/${wsId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientPassword: '' }),
      });
      const updated = await res.json();
      setWorkspaces(prev => prev.map(w => w.id === wsId ? { ...w, hasPassword: updated.hasPassword } : w));
      toast('Password removed');
    } catch { toast('Failed to remove password', 'error'); }
    finally { setSavingPassword(false); }
  };

  const saveGa4Property = async (workspaceId: string, ga4PropertyId: string) => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ga4PropertyId }),
      });
      const updated = await res.json();
      setWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, ga4PropertyId: updated.ga4PropertyId } : w));
      toast('GA4 property saved');
    } catch { toast('Failed to save GA4 property', 'error'); }
  };

  const loadEventsForWorkspace = async (wsId: string) => {
    setEventConfigWs(wsId);
    setLoadingEvents(true);
    try {
      const res = await fetch(`/api/public/analytics-events/${wsId}?days=28`);
      const events = await res.json();
      if (Array.isArray(events)) setAvailableEvents(events);
      const ws = workspaces.find(w => w.id === wsId);
      setLocalEventConfig(ws?.eventConfig || []);
    } catch { setAvailableEvents([]); }
    finally { setLoadingEvents(false); }
  };

  const getEventDisplayName = (eventName: string): string => {
    const cfg = localEventConfig.find(c => c.eventName === eventName);
    return cfg?.displayName || eventName;
  };

  const isEventPinned = (eventName: string): boolean => {
    return localEventConfig.find(c => c.eventName === eventName)?.pinned || false;
  };

  const toggleEventPin = (eventName: string) => {
    setLocalEventConfig(prev => {
      const existing = prev.find(c => c.eventName === eventName);
      if (existing) return prev.map(c => c.eventName === eventName ? { ...c, pinned: !c.pinned } : c);
      return [...prev, { eventName, displayName: eventName, pinned: true }];
    });
  };

  const updateEventDisplayName = (eventName: string, displayName: string) => {
    setLocalEventConfig(prev => {
      const existing = prev.find(c => c.eventName === eventName);
      if (existing) return prev.map(c => c.eventName === eventName ? { ...c, displayName } : c);
      return [...prev, { eventName, displayName, pinned: false }];
    });
    setEditingEventName(null);
    setEditingDisplayName('');
  };

  const saveEventConfig = async () => {
    if (!eventConfigWs) return;
    setSavingEvents(true);
    try {
      const res = await fetch(`/api/workspaces/${eventConfigWs}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventConfig: localEventConfig }),
      });
      const updated = await res.json();
      setWorkspaces(prev => prev.map(w => w.id === eventConfigWs ? { ...w, eventConfig: updated.eventConfig } : w));
      toast('Event configuration saved');
    } catch { toast('Failed to save event config', 'error'); }
    finally { setSavingEvents(false); }
  };

  const linked = workspaces.filter(w => w.webflowSiteId);
  const unlinked = workspaces.filter(w => !w.webflowSiteId);
  const dashboardReady = workspaces.filter(w => w.webflowSiteId);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Settings tab navigation */}
      <nav className="flex items-center gap-1 mb-6 border-b" style={{ borderColor: 'var(--brand-border)' }}>
        {([['connections', 'Connections'], ['integrations', 'Integrations'], ['dashboards', 'Client Dashboards']] as [SettingsTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setSettingsTab(id)}
            className="px-4 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px"
            style={settingsTab === id ? { borderColor: 'var(--brand-mint)', color: 'var(--brand-mint)' } : { borderColor: 'transparent', color: 'var(--brand-text-muted)' }}>
            {label}
          </button>
        ))}
      </nav>

      <div className="space-y-6">

      {/* ═══ CONNECTIONS TAB ═══ */}
      {settingsTab === 'connections' && (<>
      {/* Google Search Console Connection */}
      <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
        <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--brand-border)' }}>
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Search className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Google Search Console</h3>
            <p className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>Connect once to access all your properties</p>
          </div>
          {googleStatus?.connected ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">Connected</span>
              <button onClick={disconnectGoogle} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" title="Disconnect Google">
                <LogOut className="w-4 h-4 text-zinc-500" />
              </button>
            </div>
          ) : googleStatus?.configured ? (
            <button onClick={connectGoogle} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors">
              <LogIn className="w-3.5 h-3.5" /> Connect Google
            </button>
          ) : (
            <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full">Not configured</span>
          )}
        </div>

        {googleStatus?.connected && (
          <div className="px-5 py-3">
            {loadingGsc ? (
              <div className="flex items-center gap-2 text-xs py-2" style={{ color: 'var(--brand-text-muted)' }}>
                <Loader2 className="w-3 h-3 animate-spin" /> Loading properties...
              </div>
            ) : gscSites.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 py-1">
                {gscSites.map(s => (
                  <span key={s.siteUrl} className="text-[11px] px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">{s.siteUrl}</span>
                ))}
              </div>
            ) : (
              <p className="text-xs py-2" style={{ color: 'var(--brand-text-muted)' }}>No properties found. Make sure your Google account has Search Console access.</p>
            )}
          </div>
        )}
      </section>

      {/* Webflow Connections */}
      <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--brand-border)' }}>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-teal-400" />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Webflow Connections</h3>
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
            Link sites from the workspace dropdown. Generate tokens at{' '}
            <a href="https://webflow.com/dashboard/account/integrations" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300 inline-flex items-center gap-0.5">
              webflow.com <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--brand-border)' }}>
          {linked.map(ws => (
            <div key={ws.id} className="px-5 py-3 flex items-center gap-3">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-sm font-medium" style={{ color: 'var(--brand-text-bright)' }}>{ws.name}</span>
              <span className="text-xs text-zinc-500">{ws.webflowSiteName}</span>
            </div>
          ))}
          {unlinked.map(ws => (
            <div key={ws.id} className="px-5 py-3 flex items-center gap-3 opacity-60">
              <Unplug className="w-4 h-4 text-zinc-600 shrink-0" />
              <span className="text-sm text-zinc-500">{ws.name}</span>
              <span className="text-xs text-zinc-600 ml-auto">Not linked</span>
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
      <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--brand-border)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-bright)' }}>API Keys</h3>
        </div>
        <div className="px-5 py-3 flex items-center gap-3">
          <Check className="w-4 h-4 text-emerald-400" />
          <div>
            <span className="text-sm" style={{ color: 'var(--brand-text)' }}>OpenAI API Key</span>
            <span className="text-xs text-zinc-500 ml-2">Configured via .env</span>
          </div>
        </div>
      </section>
      </>)}

      {/* ═══ INTEGRATIONS TAB ═══ */}
      {settingsTab === 'integrations' && (<>
      {/* Workspace GSC Assignment */}
      {gscSites.length > 0 && linked.length > 0 && (
        <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--brand-border)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Assign Properties to Workspaces</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>Select which Search Console property feeds into each workspace's client dashboard.</p>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--brand-border)' }}>
            {linked.map(ws => (
              <div key={ws.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--brand-text-bright)' }}>{ws.name}</span>
                    <span className="text-[10px] text-zinc-500">{ws.webflowSiteName}</span>
                  </div>
                </div>
                <select
                  value={ws.gscPropertyUrl || ''}
                  onChange={e => saveGscProperty(ws.id, e.target.value)}
                  className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500 min-w-[200px]"
                >
                  <option value="">— None —</option>
                  {gscSites.map(s => (
                    <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* GA4 Analytics Assignment */}
      {ga4Properties.length > 0 && linked.length > 0 ? (
        <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--brand-border)' }}>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-orange-400" />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Assign GA4 Properties</h3>
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>Select which GA4 property feeds into each workspace's Analytics tab.</p>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--brand-border)' }}>
            {linked.map(ws => (
              <div key={ws.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--brand-text-bright)' }}>{ws.name}</span>
                    <span className="text-[10px] text-zinc-500">{ws.webflowSiteName}</span>
                  </div>
                </div>
                <select
                  value={ws.ga4PropertyId || ''}
                  onChange={e => saveGa4Property(ws.id, e.target.value)}
                  className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-orange-500 min-w-[220px]"
                >
                  <option value="">— None —</option>
                  {ga4Properties.map(p => (
                    <option key={p.propertyId} value={p.propertyId}>{p.displayName}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Event Display Configuration */}
      {linked.filter(w => w.ga4PropertyId).length > 0 && (
        <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--brand-border)' }}>
            <div className="flex items-center gap-2">
              <Pin className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Event Display Names & Pinning</h3>
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>Rename events for client-facing dashboards and pin key metrics to the top.</p>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--brand-border)' }}>
            {linked.filter(w => w.ga4PropertyId).map(ws => (
              <div key={ws.id} className="px-5 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--brand-text-bright)' }}>{ws.name}</span>
                    {eventConfigWs === ws.id && localEventConfig.filter(c => c.pinned).length > 0 && (
                      <span className="text-[10px] text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded">{localEventConfig.filter(c => c.pinned).length} pinned</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {eventConfigWs === ws.id && (
                      <button onClick={saveEventConfig} disabled={savingEvents}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors disabled:opacity-50">
                        {savingEvents ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                      </button>
                    )}
                    <button onClick={() => eventConfigWs === ws.id ? setEventConfigWs(null) : loadEventsForWorkspace(ws.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      style={{ backgroundColor: 'var(--brand-bg-card)', color: 'var(--brand-text)' }}>
                      {eventConfigWs === ws.id ? 'Close' : <><RefreshCw className="w-3 h-3" /> Configure</>}
                    </button>
                  </div>
                </div>
                {eventConfigWs === ws.id && (
                  <div className="mt-3">
                    {loadingEvents ? (
                      <div className="flex items-center gap-2 text-xs py-4 justify-center" style={{ color: 'var(--brand-text-muted)' }}>
                        <Loader2 className="w-3 h-3 animate-spin" /> Loading events from GA4...
                      </div>
                    ) : availableEvents.length === 0 ? (
                      <p className="text-xs py-4 text-center" style={{ color: 'var(--brand-text-muted)' }}>No events found. Make sure GA4 is tracking events on this site.</p>
                    ) : (
                      <div className="space-y-1 max-h-[400px] overflow-y-auto">
                        {availableEvents.map((ev) => {
                          const pinned = isEventPinned(ev.eventName);
                          const displayName = getEventDisplayName(ev.eventName);
                          const isEditing = editingEventName === ev.eventName;
                          return (
                            <div key={ev.eventName} className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${pinned ? 'bg-violet-500/10 border border-violet-500/20' : 'hover:bg-white/5'}`}>
                              <button onClick={() => toggleEventPin(ev.eventName)} className="shrink-0" title={pinned ? 'Unpin' : 'Pin to dashboard'}>
                                {pinned ? <Pin className="w-3.5 h-3.5 text-violet-400" /> : <PinOff className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-400" />}
                              </button>
                              <div className="flex-1 min-w-0">
                                {isEditing ? (
                                  <div className="flex items-center gap-1.5">
                                    <input autoFocus value={editingDisplayName} onChange={e => setEditingDisplayName(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Enter') updateEventDisplayName(ev.eventName, editingDisplayName); if (e.key === 'Escape') setEditingEventName(null); }}
                                      className="flex-1 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-xs text-zinc-200 focus:outline-none focus:border-violet-500" />
                                    <button onClick={() => updateEventDisplayName(ev.eventName, editingDisplayName)} className="text-emerald-400 hover:text-emerald-300"><Check className="w-3.5 h-3.5" /></button>
                                    <button onClick={() => setEditingEventName(null)} className="text-zinc-500 hover:text-zinc-300"><X className="w-3.5 h-3.5" /></button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-medium truncate" style={{ color: displayName !== ev.eventName ? 'var(--brand-text-bright)' : 'var(--brand-text)' }}>
                                      {displayName !== ev.eventName ? displayName : ev.eventName.replace(/_/g, ' ')}
                                    </span>
                                    {displayName !== ev.eventName && <span className="text-[10px] text-zinc-600 font-mono">{ev.eventName}</span>}
                                    <button onClick={() => { setEditingEventName(ev.eventName); setEditingDisplayName(displayName !== ev.eventName ? displayName : ''); }}
                                      className="opacity-0 group-hover:opacity-100 ml-1"><Pencil className="w-3 h-3 text-zinc-600 hover:text-zinc-400" /></button>
                                  </div>
                                )}
                              </div>
                              <span className="text-[10px] text-zinc-500 tabular-nums shrink-0">{ev.eventCount.toLocaleString()}</span>
                              <button onClick={() => { setEditingEventName(ev.eventName); setEditingDisplayName(getEventDisplayName(ev.eventName) !== ev.eventName ? getEventDisplayName(ev.eventName) : ''); }}
                                className="shrink-0" title="Rename"><Pencil className="w-3 h-3 text-zinc-600 hover:text-zinc-400" /></button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      </>)}

      {/* ═══ DASHBOARDS TAB ═══ */}
      {settingsTab === 'dashboards' && (<>
      {/* Client Dashboard Links */}
      {dashboardReady.length > 0 && (
        <section className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--brand-bg-elevated)', border: '1px solid var(--brand-border)' }}>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--brand-border)' }}>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-bright)' }}>Client Dashboards</h3>
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>Share these links with clients. Set a password per dashboard for access control.</p>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--brand-border)' }}>
            {dashboardReady.map(ws => (
              <div key={ws.id} className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--brand-text-bright)' }}>{ws.name}</div>
                    <div className="text-[11px] text-zinc-500 truncate mt-0.5">{ws.gscPropertyUrl || ws.webflowSiteName}</div>
                  </div>
                  {/* Password status */}
                  {ws.hasPassword ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Protected
                      </span>
                      <button
                        onClick={() => { setEditingPassword(ws.id); setNewPassword(''); }}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1.5 py-1 rounded transition-colors"
                      >Change</button>
                      <button
                        onClick={() => removePassword(ws.id)}
                        disabled={savingPassword}
                        className="text-[10px] text-red-400/60 hover:text-red-400 px-1.5 py-1 rounded transition-colors"
                      >Remove</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingPassword(ws.id); setNewPassword(''); }}
                      className="flex items-center gap-1 text-[10px] text-amber-400/70 bg-amber-500/10 px-2 py-1 rounded-full hover:bg-amber-500/15 transition-colors"
                    >
                      <KeyRound className="w-3 h-3" /> Set Password
                    </button>
                  )}
                  <button
                    onClick={() => copyClientLink(ws.id)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all"
                    style={copiedLink === ws.id ? {
                      backgroundColor: 'rgba(52, 211, 153, 0.1)',
                      color: '#34d399',
                      border: '1px solid rgba(52, 211, 153, 0.2)',
                    } : {
                      backgroundColor: 'var(--brand-bg-surface)',
                      color: 'var(--brand-text)',
                      border: '1px solid var(--brand-border)',
                    }}
                  >
                    {copiedLink === ws.id ? (
                      <><CheckCircle className="w-3.5 h-3.5" /> Copied!</>
                    ) : (
                      <><Copy className="w-3.5 h-3.5" /> Copy Link</>
                    )}
                  </button>
                  <a
                    href={`/client/${ws.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(217, 70, 239, 0.15))',
                      color: '#c084fc',
                      border: '1px solid rgba(139, 92, 246, 0.2)',
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open <ChevronRight className="w-3 h-3" />
                  </a>
                </div>
                {/* Inline password editor */}
                {editingPassword === ws.id && (
                  <div className="mt-3 flex items-center gap-2 pl-0">
                    <input
                      type="text"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500"
                      autoFocus
                      onKeyDown={e => e.key === 'Enter' && newPassword.trim() && savePassword(ws.id)}
                    />
                    <button
                      onClick={() => savePassword(ws.id)}
                      disabled={savingPassword || !newPassword.trim()}
                      className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                    >{savingPassword ? '...' : 'Save'}</button>
                    <button
                      onClick={() => { setEditingPassword(null); setNewPassword(''); }}
                      className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                    ><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      </>)}

      </div>
    </div>
  );
}
