import { useState, useEffect } from 'react';
import { useToast } from './Toast';
import {
  Globe, Search, BarChart3, Loader2, Check, Unplug, ExternalLink, LogIn, LogOut,
  Copy, CheckCircle, Lock, KeyRound, X, Users, ChevronRight,
  Pin, PinOff, Pencil, Save, RefreshCw, Plus, Trash2, ArrowUp, ArrowDown, Palette,
  Shield, SlidersHorizontal, Mail, Image as ImageIcon, DollarSign, BookOpen, Sparkles,
} from 'lucide-react';
import SearchableSelect from './SearchableSelect';

interface ClientUserSafe { id: string; email: string; name: string; role: 'client_owner' | 'client_member'; workspaceId: string; avatarUrl?: string; lastLoginAt?: string; createdAt: string; updatedAt: string; }
interface EventGroup { id: string; name: string; order: number; color: string; defaultPageFilter?: string; allowedPages?: string[]; }
interface EventDisplayConfig { eventName: string; displayName: string; pinned: boolean; group?: string; }
interface GscSite { siteUrl: string; permissionLevel: string; }
interface GA4Property { name: string; displayName: string; propertyId: string; }
interface WorkspaceData {
  id: string; name: string;
  webflowSiteId?: string; webflowSiteName?: string;
  gscPropertyUrl?: string; ga4PropertyId?: string;
  hasPassword?: boolean;
  clientEmail?: string;
  eventConfig?: EventDisplayConfig[];
  eventGroups?: EventGroup[];
  clientPortalEnabled?: boolean;
  seoClientView?: boolean;
  analyticsClientView?: boolean;
  autoReports?: boolean;
  autoReportFrequency?: 'weekly' | 'monthly';
  brandLogoUrl?: string;
  brandAccentColor?: string;
  knowledgeBase?: string;
  personas?: AudiencePersona[];
  contentPricing?: { briefPrice: number; fullPostPrice: number; currency: string; briefLabel?: string; fullPostLabel?: string; briefDescription?: string; fullPostDescription?: string } | null;
  tier?: 'free' | 'growth' | 'premium';
  trialEndsAt?: string;
  onboardingEnabled?: boolean;
  onboardingCompleted?: boolean;
}

interface AudiencePersona {
  id: string;
  name: string;
  description: string;
  painPoints: string[];
  goals: string[];
  objections: string[];
  preferredContentFormat?: string;
  buyingStage?: 'awareness' | 'consideration' | 'decision';
}

interface Props {
  workspaceId: string;
  workspaceName: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  onUpdate?: (patch: Record<string, unknown>) => void;
}

type SectionTab = 'connections' | 'features' | 'dashboard';

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
  const [clientEmail, setClientEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
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
  const [ga4Pages, setGa4Pages] = useState<{path: string}[]>([]);
  const [expandedGroupPages, setExpandedGroupPages] = useState<string | null>(null);
  const [groupPageSearch, setGroupPageSearch] = useState('');
  // Content pricing state
  const [showPricingConfig, setShowPricingConfig] = useState(false);
  const [pricingBrief, setPricingBrief] = useState(0);
  const [pricingFull, setPricingFull] = useState(0);
  const [pricingCurrency, setPricingCurrency] = useState('USD');
  const [savingPricing, setSavingPricing] = useState(false);
  // Client user management state
  const [clientUsers, setClientUsers] = useState<ClientUserSafe[]>([]);
  const [clientUsersLoading, setClientUsersLoading] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'client_owner' | 'client_member'>('client_member');
  const [addingUser, setAddingUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserEmail, setEditUserEmail] = useState('');
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  // Personas state
  const [showPersonas, setShowPersonas] = useState(false);
  const [localPersonas, setLocalPersonas] = useState<AudiencePersona[]>([]);
  const [savingPersonas, setSavingPersonas] = useState(false);
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [personaDraft, setPersonaDraft] = useState({ name: '', description: '', painPoints: '', goals: '', objections: '', preferredContentFormat: '', buyingStage: '' as string });
  const [generatingPersonas, setGeneratingPersonas] = useState(false);
  // Knowledge base generation state
  const [generatingKB, setGeneratingKB] = useState(false);
  const [kbDraft, setKbDraft] = useState<string | null>(null);

  const GROUP_COLORS = ['#14b8a6', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#fb923c', '#2dd4bf', '#e879f9'];

  useEffect(() => {
    // Load workspace data
    fetch(`/api/workspaces/${workspaceId}`).then(r => r.json()).then((d: WorkspaceData) => { setWs(d); setClientEmail(d.clientEmail || ''); }).catch(() => {});
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
      const [evRes, pgRes] = await Promise.all([
        fetch(`/api/public/analytics-events/${workspaceId}?days=28`),
        fetch(`/api/public/analytics-top-pages/${workspaceId}?days=28`),
      ]);
      const [events, pages] = await Promise.all([evRes.json(), pgRes.json()]);
      if (Array.isArray(events)) setAvailableEvents(events);
      if (Array.isArray(pages)) setGa4Pages(pages);
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

  // Client user CRUD
  const loadClientUsers = async () => {
    setClientUsersLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/client-users`);
      if (res.ok) setClientUsers(await res.json());
    } catch { /* ignore */ }
    finally { setClientUsersLoading(false); }
  };

  const addClientUser = async () => {
    if (!newUserEmail.trim() || !newUserName.trim() || !newUserPassword.trim()) return;
    setAddingUser(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/client-users`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newUserEmail.trim(), name: newUserName.trim(), password: newUserPassword.trim(), role: newUserRole }),
      });
      if (!res.ok) { const err = await res.json(); toast(err.error || 'Failed to add user', 'error'); return; }
      toast(`${newUserName.trim()} added`);
      setNewUserName(''); setNewUserEmail(''); setNewUserPassword(''); setNewUserRole('client_member'); setShowAddUser(false);
      loadClientUsers();
    } catch { toast('Failed to add user', 'error'); }
    finally { setAddingUser(false); }
  };

  const saveEditUser = async (userId: string) => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/client-users/${userId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editUserName.trim(), email: editUserEmail.trim() }),
      });
      if (!res.ok) { const err = await res.json(); toast(err.error || 'Failed to update', 'error'); return; }
      toast('User updated');
      setEditingUserId(null);
      loadClientUsers();
    } catch { toast('Failed to update user', 'error'); }
  };

  const deleteClientUser = async (userId: string, userName: string) => {
    if (!confirm(`Remove ${userName} from this workspace?`)) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/client-users/${userId}`, { method: 'DELETE' });
      if (!res.ok) { toast('Failed to remove user', 'error'); return; }
      toast(`${userName} removed`);
      loadClientUsers();
    } catch { toast('Failed to remove user', 'error'); }
  };

  const resetClientPassword = async (userId: string) => {
    if (!resetPasswordValue.trim()) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/client-users/${userId}/password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPasswordValue.trim() }),
      });
      if (!res.ok) { toast('Failed to reset password', 'error'); return; }
      toast('Password reset');
      setResetPasswordUserId(null); setResetPasswordValue('');
    } catch { toast('Failed to reset password', 'error'); }
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
      <nav className="flex items-center gap-1 border-b border-zinc-800">
        {([['connections', 'Connections'], ['features', 'Features'], ['dashboard', 'Client Dashboard']] as [SectionTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); if (id === 'dashboard') loadClientUsers(); }}
            className="px-4 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px"
            style={tab === id ? { borderColor: '#2dd4bf', color: '#2dd4bf' } : { borderColor: 'transparent', color: '#71717a' }}>
            {label}
          </button>
        ))}
      </nav>

      {/* ═══ CONNECTIONS ═══ */}
      {tab === 'connections' && (
        <div className="space-y-5">
          {/* Webflow */}
          <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
            <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
              <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
                <Globe className="w-4 h-4 text-teal-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-zinc-200">Webflow Site</h3>
                <p className="text-xs text-zinc-500">Linked via workspace dropdown</p>
              </div>
              {webflowSiteId ? (
                <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full flex items-center gap-1">
                  <Check className="w-3 h-3" /> {webflowSiteName}
                </span>
              ) : (
                <span className="text-[11px] text-zinc-500 bg-zinc-800 px-2 py-1 rounded-full flex items-center gap-1">
                  <Unplug className="w-3 h-3" /> Not linked
                </span>
              )}
            </div>
          </section>

          {/* Google Auth */}
          <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
            <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Search className="w-4 h-4 text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-zinc-200">Google Account</h3>
                <p className="text-xs text-zinc-500">Search Console & Analytics access</p>
              </div>
              {googleStatus?.connected ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">Connected</span>
                  <button onClick={disconnectGoogle} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" title="Disconnect">
                    <LogOut className="w-4 h-4 text-zinc-500" />
                  </button>
                </div>
              ) : googleStatus?.configured ? (
                <button onClick={connectGoogle} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors">
                  <LogIn className="w-3.5 h-3.5" /> Connect
                </button>
              ) : (
                <span className="text-[11px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full">Not configured</span>
              )}
            </div>
          </section>

          {/* GSC Property */}
          {googleStatus?.connected && gscSites.length > 0 && (
            <section className="rounded-xl bg-zinc-900 border border-zinc-800">
              <div className="px-5 py-4 flex items-center gap-3">
                <Search className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium flex-1 text-zinc-200">Search Console Property</span>
                {loadingGoogle ? <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" /> : (
                  <SearchableSelect
                    options={gscSites.map(s => ({ value: s.siteUrl, label: s.siteUrl }))}
                    value={ws?.gscPropertyUrl || ''}
                    onChange={saveGscProperty}
                    placeholder="Search properties..."
                    emptyLabel="— None —"
                    className="min-w-[200px]"
                    size="md"
                  />
                )}
              </div>
            </section>
          )}

          {/* GA4 Property */}
          {googleStatus?.connected && ga4Properties.length > 0 && (
            <section className="rounded-xl bg-zinc-900 border border-zinc-800">
              <div className="px-5 py-4 flex items-center gap-3">
                <BarChart3 className="w-4 h-4 text-teal-400" />
                <span className="text-sm font-medium flex-1 text-zinc-200">GA4 Property</span>
                {loadingGoogle ? <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" /> : (
                  <SearchableSelect
                    options={ga4Properties.map(p => ({ value: p.propertyId, label: p.displayName }))}
                    value={ws?.ga4PropertyId || ''}
                    onChange={saveGa4Property}
                    placeholder="Search properties..."
                    emptyLabel="— None —"
                    className="min-w-[220px]"
                    size="md"
                  />
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ═══ FEATURES ═══ */}
      {tab === 'features' && (
        <div className="space-y-5">
          {/* Workspace Tier */}
          <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
            <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-zinc-200">Workspace Tier</h3>
                <p className="text-xs text-zinc-500">Controls which features the client can access</p>
              </div>
              <span className={`text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                (ws?.tier || 'free') === 'premium' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                  : (ws?.tier || 'free') === 'growth' ? 'text-teal-400 bg-teal-500/10 border-teal-500/20'
                  : 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20'
              }`}>
                {ws?.tier || 'free'}
              </span>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-2">
                {(['free', 'growth', 'premium'] as const).map(t => (
                  <button
                    key={t}
                    onClick={async () => {
                      await patchWorkspace({ tier: t });
                      toast(`Tier set to ${t}`);
                    }}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                      (ws?.tier || 'free') === t
                        ? t === 'premium' ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                          : t === 'growth' ? 'bg-teal-500/15 border-teal-500/30 text-teal-300'
                          : 'bg-zinc-700/50 border-zinc-600 text-zinc-200'
                        : 'bg-zinc-800/30 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                    }`}
                  >
                    {t === 'premium' && <Sparkles className="w-3 h-3 inline mr-1" />}
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-zinc-600">
                Free: limited features &amp; chat • Growth: all features, full chat • Premium: priority support, advanced analytics
              </p>
              {ws?.trialEndsAt && (
                <div className="text-[11px] text-teal-400/80 bg-teal-500/5 border border-teal-500/15 rounded-lg px-3 py-2">
                  Trial active — expires {new Date(ws.trialEndsAt).toLocaleDateString()}
                </div>
              )}
            </div>
          </section>

          {/* Client Portal Toggles */}
          <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
            <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
              <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
                <SlidersHorizontal className="w-4 h-4 text-teal-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-zinc-200">Client Portal Features</h3>
                <p className="text-xs text-zinc-500">Control what the client can see and access in their dashboard</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* Client Portal */}
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-3">
                  <Users className="w-4 h-4 text-zinc-500" />
                  <div>
                    <div className="text-xs font-medium text-zinc-200">Client Portal</div>
                    <div className="text-[11px] text-zinc-500">Master toggle — enable or disable the client dashboard entirely</div>
                  </div>
                </div>
                <button onClick={async () => {
                  const val = !(ws?.clientPortalEnabled !== false);
                  await patchWorkspace({ clientPortalEnabled: val });
                  toast(val ? 'Client portal enabled' : 'Client portal disabled');
                }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    ws?.clientPortalEnabled !== false ? 'bg-teal-500' : 'bg-zinc-700'
                  }`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    ws?.clientPortalEnabled !== false ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
              </label>
              {/* SEO Client View */}
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-3">
                  <Shield className="w-4 h-4 text-zinc-500" />
                  <div>
                    <div className="text-xs font-medium text-zinc-200">SEO Health View</div>
                    <div className="text-[11px] text-zinc-500">Show SEO audit scores and detailed findings to the client (paid upgrade)</div>
                  </div>
                </div>
                <button onClick={async () => {
                  const val = !ws?.seoClientView;
                  await patchWorkspace({ seoClientView: val });
                  toast(val ? 'SEO view enabled for client' : 'SEO view hidden from client');
                }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    ws?.seoClientView ? 'bg-teal-500' : 'bg-zinc-700'
                  }`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    ws?.seoClientView ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
              </label>
              {/* Analytics Client View */}
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-3">
                  <BarChart3 className="w-4 h-4 text-zinc-500" />
                  <div>
                    <div className="text-xs font-medium text-zinc-200">Analytics View</div>
                    <div className="text-[11px] text-zinc-500">Show Google Analytics and Search Console data to the client</div>
                  </div>
                </div>
                <button onClick={async () => {
                  const val = !(ws?.analyticsClientView !== false);
                  await patchWorkspace({ analyticsClientView: val });
                  toast(val ? 'Analytics view enabled for client' : 'Analytics view hidden from client');
                }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    ws?.analyticsClientView !== false ? 'bg-teal-500' : 'bg-zinc-700'
                  }`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    ws?.analyticsClientView !== false ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
              </label>
              {/* Client Onboarding Questionnaire */}
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-4 h-4 text-zinc-500" />
                  <div>
                    <div className="text-xs font-medium text-zinc-200">Client Onboarding Questionnaire</div>
                    <div className="text-[11px] text-zinc-500">
                      Prompt new clients to share business info, audience, and brand voice
                      {ws?.onboardingCompleted && <span className="ml-1 text-teal-400">(completed)</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {ws?.onboardingCompleted && (
                    <button onClick={async (e) => {
                      e.stopPropagation();
                      await patchWorkspace({ onboardingCompleted: false });
                      toast('Onboarding reset — client will see the questionnaire again');
                    }}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 transition-colors">
                      Reset
                    </button>
                  )}
                  <button onClick={async () => {
                    const val = !ws?.onboardingEnabled;
                    await patchWorkspace({ onboardingEnabled: val });
                    toast(val ? 'Onboarding questionnaire enabled' : 'Onboarding questionnaire disabled');
                  }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      ws?.onboardingEnabled ? 'bg-teal-500' : 'bg-zinc-700'
                    }`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      ws?.onboardingEnabled ? 'translate-x-4' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              </label>
            </div>
          </section>

          {/* Automated Reports */}
          <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
            <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Mail className="w-4 h-4 text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-zinc-200">Automated Reports</h3>
                <p className="text-xs text-zinc-500">Automatically send SEO and performance reports to the client</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-4">
              <label className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-zinc-500" />
                  <div>
                    <div className="text-xs font-medium text-zinc-200">Enable Auto-Reports</div>
                    <div className="text-[11px] text-zinc-500">Send scheduled SEO audit reports to the client email{ws?.clientEmail ? ` (${ws.clientEmail})` : ' — set email in Client Dashboard tab'}</div>
                  </div>
                </div>
                <button onClick={async () => {
                  const val = !ws?.autoReports;
                  await patchWorkspace({ autoReports: val });
                  toast(val ? 'Auto-reports enabled' : 'Auto-reports disabled');
                }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    ws?.autoReports ? 'bg-teal-500' : 'bg-zinc-700'
                  }`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    ws?.autoReports ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
              </label>
              {ws?.autoReports && (
                <div className="space-y-3 pl-7">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500">Frequency:</span>
                    {(['monthly', 'weekly'] as const).map(freq => (
                      <button key={freq} onClick={async () => {
                        await patchWorkspace({ autoReportFrequency: freq });
                        toast(`Report frequency set to ${freq}`);
                      }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          (ws?.autoReportFrequency || 'monthly') === freq
                            ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30'
                            : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-300'
                        }`}>
                        {freq.charAt(0).toUpperCase() + freq.slice(1)}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={async () => {
                      toast('Generating report...');
                      try {
                        const res = await fetch(`/api/monthly-report/${workspaceId}`, { method: 'POST' });
                        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
                        const data = await res.json();
                        toast(data.sent ? 'Report sent to client!' : 'Report generated (no client email configured)');
                      } catch (err) {
                        toast(err instanceof Error ? err.message : 'Report failed');
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30 transition-colors"
                  >
                    <Mail className="w-3 h-3" /> Send Report Now
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Branding */}
          <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
            <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
              <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
                <ImageIcon className="w-4 h-4 text-teal-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-zinc-200">White-Label Branding</h3>
                <p className="text-xs text-zinc-500">Customize the client dashboard and reports appearance</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <div className="text-[11px] font-medium mb-1.5 text-zinc-500">Logo URL</div>
                <div className="flex items-center gap-2">
                  <input type="url" defaultValue={ws?.brandLogoUrl || ''}
                    placeholder="https://example.com/logo.svg"
                    onBlur={async (e) => {
                      const val = e.target.value.trim();
                      if (val !== (ws?.brandLogoUrl || '')) {
                        await patchWorkspace({ brandLogoUrl: val });
                        toast('Logo URL saved');
                      }
                    }}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" />
                  {ws?.brandLogoUrl && <img src={ws.brandLogoUrl} alt="" className="h-6 rounded" />}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium mb-1.5 text-zinc-500">Accent Color</div>
                <div className="flex items-center gap-2">
                  <input type="color" defaultValue={ws?.brandAccentColor || '#2dd4bf'}
                    onChange={async (e) => {
                      const val = e.target.value;
                      await patchWorkspace({ brandAccentColor: val });
                    }}
                    className="w-8 h-8 rounded-lg border border-zinc-700 cursor-pointer bg-transparent" />
                  <code className="text-xs text-zinc-400">{ws?.brandAccentColor || '#2dd4bf'}</code>
                  <span className="text-[11px] text-zinc-500">Used in reports and the client portal header</span>
                </div>
              </div>
            </div>
          </section>

          {/* Knowledge Base */}
          <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
            <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
              <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-teal-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-zinc-200">Knowledge Base</h3>
                <p className="text-xs text-zinc-500">Business context for the AI chatbot — services, capabilities, FAQs, industry info</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <textarea
                value={kbDraft !== null ? kbDraft : (ws?.knowledgeBase || '')}
                onChange={(e) => setKbDraft(e.target.value)}
                rows={8}
                placeholder={"Example:\n- Industry: Home services (plumbing, HVAC)\n- Location: Denver metro area\n- Key services: Emergency repair, new installations, maintenance plans\n- Differentiators: 24/7 availability, licensed & insured, 15+ years\n- Target audience: Homeowners, property managers\n- Common client questions: pricing, response time, service areas"}
                onBlur={async (e) => {
                  const val = e.target.value.trim();
                  if (val !== (ws?.knowledgeBase || '')) {
                    await patchWorkspace({ knowledgeBase: val });
                    toast('Knowledge base saved');
                    setKbDraft(null);
                  }
                }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-y font-mono leading-relaxed"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    setGeneratingKB(true);
                    try {
                      const res = await fetch(`/api/workspaces/${workspaceId}/generate-knowledge-base`, { method: 'POST' });
                      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Generation failed'); }
                      const data = await res.json();
                      setKbDraft(data.knowledgeBase);
                      toast(`Knowledge base generated from ${data.pagesScraped} pages — review and save`);
                    } catch (err) {
                      toast(err instanceof Error ? err.message : 'Failed to generate', 'error');
                    } finally {
                      setGeneratingKB(false);
                    }
                  }}
                  disabled={generatingKB || !ws?.webflowSiteId}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {generatingKB ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Crawling site...</> : <><Sparkles className="w-3.5 h-3.5" /> Generate from Website</>}
                </button>
                {kbDraft !== null && kbDraft !== (ws?.knowledgeBase || '') && (
                  <span className="text-[11px] text-amber-400">Unsaved changes — click outside the textarea to save</span>
                )}
              </div>
              <p className="text-[11px] text-zinc-500">
                This context is shared with both the client Insights Engine and Admin Insights chatbots.
                You can also place <code className="text-zinc-400">.txt</code> or <code className="text-zinc-400">.md</code> files in the <code className="text-zinc-400">knowledge-docs/</code> folder for longer documents.
              </p>
            </div>
          </section>

          {/* Audience Personas */}
          <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
            <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-zinc-200">Audience Personas</h3>
                <p className="text-xs text-zinc-500">Define target audience segments — used in content briefs and AI writing prompts</p>
              </div>
              <button
                onClick={() => {
                  if (!showPersonas) setLocalPersonas(ws?.personas || []);
                  setShowPersonas(!showPersonas);
                  setEditingPersonaId(null);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ backgroundColor: '#27272a', color: '#a1a1aa' }}>
                {showPersonas ? 'Close' : <><Plus className="w-3 h-3" /> Manage</>}
              </button>
            </div>

            {/* Summary when collapsed */}
            {!showPersonas && (
              <div className="px-5 py-3">
                {(ws?.personas?.length || 0) > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {ws!.personas!.map(p => (
                      <span key={p.id} className="text-[11px] px-2 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        {p.name}{p.buyingStage ? ` · ${p.buyingStage}` : ''}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-[11px] text-zinc-500">No personas defined — AI will use generic audience targeting</span>
                )}
              </div>
            )}

            {/* Expanded persona manager */}
            {showPersonas && (
              <div className="px-5 py-4 space-y-4">
                {/* Existing personas */}
                {localPersonas.map(p => (
                  <div key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-zinc-200">{p.name}</span>
                        {p.buyingStage && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">{p.buyingStage}</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => {
                          if (editingPersonaId === p.id) { setEditingPersonaId(null); return; }
                          setEditingPersonaId(p.id);
                          setPersonaDraft({
                            name: p.name, description: p.description,
                            painPoints: p.painPoints.join('\n'), goals: p.goals.join('\n'),
                            objections: p.objections.join('\n'),
                            preferredContentFormat: p.preferredContentFormat || '',
                            buyingStage: p.buyingStage || '',
                          });
                        }} className="p-1 rounded text-zinc-500 hover:text-zinc-300"><Pencil className="w-3 h-3" /></button>
                        <button onClick={() => setLocalPersonas(prev => prev.filter(x => x.id !== p.id))}
                          className="p-1 rounded text-zinc-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                    {editingPersonaId !== p.id && (
                      <div className="px-3 pb-2.5 text-[11px] text-zinc-500">{p.description}</div>
                    )}
                    {editingPersonaId === p.id && (
                      <div className="px-3 pb-3 space-y-2 border-t border-zinc-800 pt-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] text-zinc-500 block mb-0.5">Name</label>
                            <input value={personaDraft.name} onChange={e => setPersonaDraft(d => ({ ...d, name: e.target.value }))}
                              className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 focus:outline-none focus:border-teal-500" />
                          </div>
                          <div>
                            <label className="text-[11px] text-zinc-500 block mb-0.5">Buying Stage</label>
                            <select value={personaDraft.buyingStage} onChange={e => setPersonaDraft(d => ({ ...d, buyingStage: e.target.value }))}
                              className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 focus:outline-none cursor-pointer">
                              <option value="">None</option>
                              <option value="awareness">Awareness</option>
                              <option value="consideration">Consideration</option>
                              <option value="decision">Decision</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-zinc-500 block mb-0.5">Description</label>
                          <input value={personaDraft.description} onChange={e => setPersonaDraft(d => ({ ...d, description: e.target.value }))}
                            placeholder="Who is this person?"
                            className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-[11px] text-zinc-500 block mb-0.5">Pain Points (one per line)</label>
                            <textarea value={personaDraft.painPoints} onChange={e => setPersonaDraft(d => ({ ...d, painPoints: e.target.value }))}
                              rows={3} className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-none" />
                          </div>
                          <div>
                            <label className="text-[11px] text-zinc-500 block mb-0.5">Goals (one per line)</label>
                            <textarea value={personaDraft.goals} onChange={e => setPersonaDraft(d => ({ ...d, goals: e.target.value }))}
                              rows={3} className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-none" />
                          </div>
                          <div>
                            <label className="text-[11px] text-zinc-500 block mb-0.5">Objections (one per line)</label>
                            <textarea value={personaDraft.objections} onChange={e => setPersonaDraft(d => ({ ...d, objections: e.target.value }))}
                              rows={3} className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-none" />
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-zinc-500 block mb-0.5">Preferred Content Format</label>
                          <input value={personaDraft.preferredContentFormat} onChange={e => setPersonaDraft(d => ({ ...d, preferredContentFormat: e.target.value }))}
                            placeholder="e.g. how-to guides, case studies, comparison articles"
                            className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500" />
                        </div>
                        <button onClick={() => {
                          setLocalPersonas(prev => prev.map(x => x.id === p.id ? {
                            ...x, name: personaDraft.name.trim(), description: personaDraft.description.trim(),
                            painPoints: personaDraft.painPoints.split('\n').map(s => s.trim()).filter(Boolean),
                            goals: personaDraft.goals.split('\n').map(s => s.trim()).filter(Boolean),
                            objections: personaDraft.objections.split('\n').map(s => s.trim()).filter(Boolean),
                            preferredContentFormat: personaDraft.preferredContentFormat.trim() || undefined,
                            buyingStage: (personaDraft.buyingStage || undefined) as AudiencePersona['buyingStage'],
                          } : x));
                          setEditingPersonaId(null);
                        }} className="flex items-center gap-1 px-3 py-1.5 rounded bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-medium transition-colors">
                          <Check className="w-3 h-3" /> Apply Changes
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add new persona */}
                <button onClick={() => {
                  const newP: AudiencePersona = {
                    id: `persona_${Date.now()}`, name: 'New Persona', description: '',
                    painPoints: [], goals: [], objections: [],
                  };
                  setLocalPersonas(prev => [...prev, newP]);
                  setEditingPersonaId(newP.id);
                  setPersonaDraft({ name: newP.name, description: '', painPoints: '', goals: '', objections: '', preferredContentFormat: '', buyingStage: '' });
                }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-zinc-700 text-xs text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-colors w-full justify-center">
                  <Plus className="w-3 h-3" /> Add Persona
                </button>

                {/* Save button */}
                <div className="pt-2 border-t border-zinc-800 flex items-center gap-3">
                  <button
                    disabled={savingPersonas}
                    onClick={async () => {
                      setSavingPersonas(true);
                      try {
                        await patchWorkspace({ personas: localPersonas });
                        toast('Audience personas saved');
                      } catch { toast('Failed to save personas', 'error'); }
                      finally { setSavingPersonas(false); }
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors disabled:opacity-50">
                    {savingPersonas ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save Personas
                  </button>
                  <button
                    onClick={async () => {
                      setGeneratingPersonas(true);
                      try {
                        const res = await fetch(`/api/workspaces/${workspaceId}/generate-personas`, { method: 'POST' });
                        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Generation failed'); }
                        const data = await res.json();
                        setLocalPersonas(data.personas);
                        toast(`${data.personas.length} personas generated from ${data.pagesScraped} pages — review and save`);
                      } catch (err) {
                        toast(err instanceof Error ? err.message : 'Failed to generate', 'error');
                      } finally {
                        setGeneratingPersonas(false);
                      }
                    }}
                    disabled={generatingPersonas || !ws?.webflowSiteId}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {generatingPersonas ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Crawling site...</> : <><Sparkles className="w-3.5 h-3.5" /> Generate from Website</>}
                  </button>
                  <span className="text-[11px] text-zinc-500">{localPersonas.length} persona{localPersonas.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ═══ CLIENT DASHBOARD ═══ */}
      {tab === 'dashboard' && (
        <div className="space-y-5">
          {!webflowSiteId ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Users className="w-8 h-8 text-zinc-500" />
              <p className="text-sm text-zinc-400">Link a Webflow site first to enable the client dashboard</p>
            </div>
          ) : (<>
            {/* Dashboard link + password */}
            <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
              <div className="px-5 py-4 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-teal-400" />
                  <h3 className="text-sm font-semibold text-zinc-200">Client Access</h3>
                </div>
                <p className="text-xs mt-0.5 text-zinc-500">Share the dashboard link with your client. Optionally protect it with a password.</p>
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
                      : { backgroundColor: '#18181b', color: '#a1a1aa', border: '1px solid #27272a' }}>
                    {copiedLink ? <><CheckCircle className="w-3.5 h-3.5" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                  </button>
                  <a href={`/client/${workspaceId}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors bg-teal-500/10 text-teal-400 border border-teal-500/20">
                    <ExternalLink className="w-3.5 h-3.5" /> Open <ChevronRight className="w-3 h-3" />
                  </a>
                </div>
                {/* Password */}
                <div className="flex items-center gap-2">
                  {ws?.hasPassword ? (
                    <>
                      <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Password Protected
                      </span>
                      <button onClick={() => { setEditingPassword(true); setNewPassword(''); }}
                        className="text-[11px] text-zinc-500 hover:text-zinc-300 px-1.5 py-1 rounded transition-colors">Change</button>
                      <button onClick={removePassword} disabled={savingPassword}
                        className="text-[11px] text-red-400/60 hover:text-red-400 px-1.5 py-1 rounded transition-colors">Remove</button>
                    </>
                  ) : (
                    <button onClick={() => { setEditingPassword(true); setNewPassword(''); }}
                      className="flex items-center gap-1 text-[11px] text-amber-400/70 bg-amber-500/10 px-2 py-1 rounded-full hover:bg-amber-500/15 transition-colors">
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
                {/* Client notification email */}
                <div className="pt-2 border-t border-zinc-800">
                  <div className="text-[11px] font-medium mb-1.5 text-zinc-500">Client Notification Email</div>
                  <p className="text-[11px] mb-2 text-zinc-500">We'll email this address when you respond to requests or change status.</p>
                  <div className="flex items-center gap-2">
                    <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)}
                      placeholder="client@company.com"
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500" />
                    <button onClick={async () => {
                      setSavingEmail(true);
                      try { await patchWorkspace({ clientEmail: clientEmail.trim() }); toast(clientEmail.trim() ? 'Client email saved' : 'Client email removed'); }
                      catch { toast('Failed to save email', 'error'); }
                      finally { setSavingEmail(false); }
                    }} disabled={savingEmail}
                      className="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-medium transition-colors">
                      {savingEmail ? '...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Client Users */}
            <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
              <div className="px-5 py-4 border-b border-zinc-800">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
                    <Shield className="w-4 h-4 text-teal-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-zinc-200">Client Users</h3>
                    <p className="text-xs text-zinc-500">Individual login accounts for your clients. Each user gets their own credentials.</p>
                  </div>
                  <button onClick={() => { setShowAddUser(!showAddUser); setNewUserName(''); setNewUserEmail(''); setNewUserPassword(''); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white">
                    <Plus className="w-3 h-3" /> Add User
                  </button>
                </div>
              </div>

              <div className="px-5 py-4 space-y-3">
                {/* Add user form */}
                {showAddUser && (
                  <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-4 space-y-3">
                    <div className="text-[11px] font-medium text-teal-400 uppercase tracking-wider">New Client User</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[11px] font-medium mb-1 text-zinc-500">Name</div>
                        <input value={newUserName} onChange={e => setNewUserName(e.target.value)} placeholder="Jane Smith"
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500" />
                      </div>
                      <div>
                        <div className="text-[11px] font-medium mb-1 text-zinc-500">Email</div>
                        <input value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} placeholder="jane@company.com" type="email"
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500" />
                      </div>
                      <div>
                        <div className="text-[11px] font-medium mb-1 text-zinc-500">Password</div>
                        <input value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} placeholder="Temporary password" type="text"
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500" />
                      </div>
                      <div>
                        <div className="text-[11px] font-medium mb-1 text-zinc-500">Role</div>
                        <select value={newUserRole} onChange={e => setNewUserRole(e.target.value as 'client_owner' | 'client_member')}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-teal-500">
                          <option value="client_member">Member</option>
                          <option value="client_owner">Owner</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={addClientUser} disabled={addingUser || !newUserName.trim() || !newUserEmail.trim() || !newUserPassword.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-medium transition-all disabled:opacity-50">
                        {addingUser ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add User
                      </button>
                      <button onClick={() => setShowAddUser(false)}
                        className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* User list */}
                {clientUsersLoading ? (
                  <div className="flex items-center gap-2 justify-center py-6 text-xs text-zinc-500">
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading users...
                  </div>
                ) : clientUsers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center">
                      <Users className="w-5 h-5 text-zinc-600" />
                    </div>
                    <p className="text-xs text-zinc-500">No client users yet</p>
                    <p className="text-[11px] text-zinc-600 max-w-xs text-center">Add individual accounts so clients can log in with their own credentials. Activity will be attributed to each user.</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {clientUsers.map(user => (
                      <div key={user.id} className="group rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
                        <div className="flex items-center gap-3 px-4 py-3">
                          {/* Avatar */}
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                            {user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                          </div>

                          {/* Info */}
                          {editingUserId === user.id ? (
                            <div className="flex-1 flex items-center gap-2 min-w-0">
                              <input value={editUserName} onChange={e => setEditUserName(e.target.value)} placeholder="Name"
                                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-teal-500" />
                              <input value={editUserEmail} onChange={e => setEditUserEmail(e.target.value)} placeholder="Email"
                                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-teal-500" />
                              <button onClick={() => saveEditUser(user.id)} className="text-emerald-400 hover:text-emerald-300"><Check className="w-3.5 h-3.5" /></button>
                              <button onClick={() => setEditingUserId(null)} className="text-zinc-500 hover:text-zinc-300"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          ) : (
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-zinc-200 truncate">{user.name}</span>
                                <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${user.role === 'client_owner' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-zinc-800 text-zinc-500'}`}>
                                  {user.role === 'client_owner' ? 'Owner' : 'Member'}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[11px] text-zinc-500 truncate">{user.email}</span>
                                {user.lastLoginAt && (
                                  <span className="text-[11px] text-zinc-600">Last login {new Date(user.lastLoginAt).toLocaleDateString()}</span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Actions */}
                          {editingUserId !== user.id && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => { setEditingUserId(user.id); setEditUserName(user.name); setEditUserEmail(user.email); }}
                                title="Edit" className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button onClick={() => { setResetPasswordUserId(resetPasswordUserId === user.id ? null : user.id); setResetPasswordValue(''); }}
                                title="Reset password" className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                                <KeyRound className="w-3 h-3" />
                              </button>
                              <button onClick={() => deleteClientUser(user.id, user.name)}
                                title="Remove" className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Password reset inline */}
                        {resetPasswordUserId === user.id && (
                          <div className="px-4 pb-3 flex items-center gap-2">
                            <KeyRound className="w-3 h-3 text-zinc-500 shrink-0" />
                            <input value={resetPasswordValue} onChange={e => setResetPasswordValue(e.target.value)}
                              placeholder="New password" type="text" autoFocus
                              onKeyDown={e => e.key === 'Enter' && resetPasswordValue.trim() && resetClientPassword(user.id)}
                              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500" />
                            <button onClick={() => resetClientPassword(user.id)} disabled={!resetPasswordValue.trim()}
                              className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-medium transition-colors">
                              Reset
                            </button>
                            <button onClick={() => { setResetPasswordUserId(null); setResetPasswordValue(''); }}
                              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 transition-colors">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {clientUsers.length > 0 && (
                  <div className="text-[11px] text-zinc-600 pt-1">
                    {clientUsers.length} user{clientUsers.length !== 1 ? 's' : ''} with individual access to this dashboard
                  </div>
                )}
              </div>
            </section>

            {/* Content Pricing */}
            <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
              <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
                <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-green-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-zinc-200">Content Pricing</h3>
                  <p className="text-xs text-zinc-500">Set pricing for content briefs and full blog posts. Clients see these before confirming.</p>
                </div>
                <button
                  onClick={() => {
                    if (!showPricingConfig) {
                      setPricingBrief(ws?.contentPricing?.briefPrice || 0);
                      setPricingFull(ws?.contentPricing?.fullPostPrice || 0);
                      setPricingCurrency(ws?.contentPricing?.currency || 'USD');
                    }
                    setShowPricingConfig(!showPricingConfig);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{ backgroundColor: '#27272a', color: '#a1a1aa' }}>
                  {showPricingConfig ? 'Close' : <><Pencil className="w-3 h-3" /> Configure</>}
                </button>
              </div>

              {/* Summary row when collapsed */}
              {!showPricingConfig && (
                <div className="px-5 py-3 flex items-center gap-4">
                  {ws?.contentPricing ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-zinc-500">Brief:</span>
                        <span className="text-xs font-semibold text-teal-400">${ws.contentPricing.briefPrice}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-zinc-500">Full Post:</span>
                        <span className="text-xs font-semibold text-blue-400">${ws.contentPricing.fullPostPrice}</span>
                      </div>
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active</span>
                    </>
                  ) : (
                    <span className="text-[11px] text-zinc-500">No pricing set — clients will see "Pricing confirmed after submission"</span>
                  )}
                </div>
              )}

              {/* Expanded config form */}
              {showPricingConfig && (
                <div className="px-5 py-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[11px] font-medium mb-1.5 text-zinc-500">Content Brief Price</div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">$</span>
                        <input type="number" min={0} value={pricingBrief || ''} onChange={e => setPricingBrief(Number(e.target.value))}
                          placeholder="150"
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-7 pr-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500" />
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-medium mb-1.5 text-zinc-500">Full Blog Post Price</div>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">$</span>
                        <input type="number" min={0} value={pricingFull || ''} onChange={e => setPricingFull(Number(e.target.value))}
                          placeholder="500"
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-7 pr-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-teal-500" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium mb-1.5 text-zinc-500">Currency</div>
                    <select value={pricingCurrency} onChange={e => setPricingCurrency(e.target.value)}
                      className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-teal-500">
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="CAD">CAD (C$)</option>
                      <option value="AUD">AUD (A$)</option>
                    </select>
                  </div>
                  <div className="pt-2 flex items-center gap-3 border-t border-zinc-800">
                    <button
                      disabled={savingPricing}
                      onClick={async () => {
                        setSavingPricing(true);
                        try {
                          const contentPricing = pricingBrief > 0 || pricingFull > 0
                            ? { briefPrice: pricingBrief, fullPostPrice: pricingFull, currency: pricingCurrency }
                            : null;
                          await patchWorkspace({ contentPricing });
                          toast(contentPricing ? 'Content pricing saved' : 'Content pricing removed');
                          setShowPricingConfig(false);
                        } catch { toast('Failed to save pricing', 'error'); }
                        finally { setSavingPricing(false); }
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors disabled:opacity-50">
                      {savingPricing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save Pricing
                    </button>
                    {ws?.contentPricing && (
                      <button
                        disabled={savingPricing}
                        onClick={async () => {
                          setSavingPricing(true);
                          try {
                            await patchWorkspace({ contentPricing: null });
                            setPricingBrief(0); setPricingFull(0);
                            toast('Content pricing removed');
                            setShowPricingConfig(false);
                          } catch { toast('Failed to remove pricing', 'error'); }
                          finally { setSavingPricing(false); }
                        }}
                        className="text-xs text-red-400/60 hover:text-red-400 transition-colors">
                        Remove Pricing
                      </button>
                    )}
                  </div>
                  <div className="text-[11px] leading-relaxed text-zinc-500">
                    Clients will see these prices in a confirmation dialog before submitting content requests. Stripe integration for direct payments is coming soon.
                  </div>
                </div>
              )}
            </section>

            {/* Event Configuration */}
            {ws?.ga4PropertyId && (
              <section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
                <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
                  <Pin className="w-4 h-4 text-teal-400" />
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-zinc-200">Event Display & Pinning</h3>
                    <p className="text-xs text-zinc-500">Rename events, pin key metrics, and group them for the client dashboard.</p>
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
                      style={{ backgroundColor: '#27272a', color: '#a1a1aa' }}>
                      {showEventConfig ? 'Close' : <><RefreshCw className="w-3 h-3" /> Configure</>}
                    </button>
                  </div>
                </div>

                {showEventConfig && (
                  <div className="px-5 py-4 space-y-4">
                    {loadingEvents ? (
                      <div className="flex items-center gap-2 text-xs py-4 justify-center text-zinc-500">
                        <Loader2 className="w-3 h-3 animate-spin" /> Loading events from GA4...
                      </div>
                    ) : availableEvents.length === 0 ? (
                      <p className="text-xs py-4 text-center text-zinc-500">No events found.</p>
                    ) : (<>
                      {/* Groups */}
                      <div className="rounded-lg border border-zinc-700/50 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Palette className="w-3.5 h-3.5 text-teal-400" />
                          <span className="text-xs font-medium text-zinc-200">Event Groups</span>
                          <span className="text-[11px] text-zinc-500 ml-auto">{localGroups.length} groups</span>
                        </div>
                        {localGroups.sort((a, b) => a.order - b.order).map((g, idx) => (
                          <div key={g.id} className="rounded-lg hover:bg-white/5 mb-1">
                            <div className="flex items-center gap-2 px-2 py-1.5">
                              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                              <span className="text-xs flex-1 text-zinc-400">{g.name}</span>
                              <span className="text-[11px] text-zinc-500">{localEventConfig.filter(c => c.group === g.id).length} events</span>
                              <button onClick={() => moveGroup(g.id, -1)} disabled={idx === 0} className="p-0.5 text-zinc-500 hover:text-zinc-400 disabled:opacity-30"><ArrowUp className="w-3 h-3" /></button>
                              <button onClick={() => moveGroup(g.id, 1)} disabled={idx === localGroups.length - 1} className="p-0.5 text-zinc-500 hover:text-zinc-400 disabled:opacity-30"><ArrowDown className="w-3 h-3" /></button>
                              <button onClick={() => removeGroup(g.id)} className="p-0.5 text-red-400/50 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                            </div>
                            <div className="px-2 pb-2 space-y-2">
                              <div className="flex items-center gap-1.5">
                                <label className="text-[11px] text-zinc-500 whitespace-nowrap">Default page:</label>
                                <SearchableSelect
                                  options={(() => {
                                    const allowed = g.allowedPages || [];
                                    const pages = allowed.length > 0
                                      ? ga4Pages.filter(p => allowed.some(ap => p.path.includes(ap)))
                                      : ga4Pages;
                                    return pages.map(p => ({ value: p.path, label: p.path }));
                                  })()}
                                  value={g.defaultPageFilter || ''}
                                  onChange={val => setLocalGroups(prev => prev.map(gr => gr.id === g.id ? { ...gr, defaultPageFilter: val || undefined } : gr))}
                                  placeholder="Search pages..."
                                  emptyLabel="None"
                                  className="w-40"
                                />
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                  <label className="text-[11px] text-zinc-500 whitespace-nowrap">Allowed pages:</label>
                                  <span className="text-[11px] text-zinc-500">{(g.allowedPages || []).length ? `${g.allowedPages!.length} selected` : 'All pages'}</span>
                                  <button onClick={() => { setExpandedGroupPages(expandedGroupPages === g.id ? null : g.id); setGroupPageSearch(''); }}
                                    className="text-[11px] text-teal-400 hover:text-teal-300 ml-auto">{expandedGroupPages === g.id ? 'Close' : 'Edit'}</button>
                                </div>
                                {expandedGroupPages === g.id && (
                                  <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-2 mt-1">
                                    <div className="flex items-center gap-1.5 mb-2">
                                      <Search className="w-3 h-3 text-zinc-500" />
                                      <input value={groupPageSearch} onChange={e => setGroupPageSearch(e.target.value)}
                                        placeholder="Filter pages..."
                                        className="flex-1 bg-transparent text-[11px] text-zinc-300 placeholder:text-zinc-500 focus:outline-none" />
                                      {(g.allowedPages || []).length > 0 && (
                                        <button onClick={() => setLocalGroups(prev => prev.map(gr => gr.id === g.id ? { ...gr, allowedPages: undefined } : gr))}
                                          className="text-[11px] text-zinc-500 hover:text-zinc-300">Clear all</button>
                                      )}
                                    </div>
                                    <div className="max-h-[150px] overflow-y-auto space-y-0.5">
                                      {ga4Pages
                                        .filter(p => !groupPageSearch || p.path.toLowerCase().includes(groupPageSearch.toLowerCase()))
                                        .map(p => {
                                          const checked = (g.allowedPages || []).some(ap => p.path.includes(ap));
                                          return (
                                            <label key={p.path} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-zinc-700/30 cursor-pointer">
                                              <input type="checkbox" checked={checked}
                                                onChange={() => {
                                                  setLocalGroups(prev => prev.map(gr => {
                                                    if (gr.id !== g.id) return gr;
                                                    const current = gr.allowedPages || [];
                                                    const next = checked
                                                      ? current.filter(ap => !p.path.includes(ap))
                                                      : [...current, p.path];
                                                    return { ...gr, allowedPages: next.length > 0 ? next : undefined };
                                                  }));
                                                }}
                                                className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 text-teal-500 focus:ring-0 focus:ring-offset-0 accent-teal-500" />
                                              <span className="text-[11px] text-zinc-300 truncate">{p.path}</span>
                                            </label>
                                          );
                                        })}
                                      {ga4Pages.filter(p => !groupPageSearch || p.path.toLowerCase().includes(groupPageSearch.toLowerCase())).length === 0 && (
                                        <p className="text-[11px] text-zinc-500 text-center py-2">No pages found</p>
                                      )}
                                    </div>
                                  </div>
                                )}
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
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-[11px] font-medium transition-colors">
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
                                {pinned ? <Pin className="w-3.5 h-3.5 text-teal-400" /> : <PinOff className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-400" />}
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
                                    <span className={`text-xs font-medium truncate ${displayName !== ev.eventName ? 'text-zinc-200' : 'text-zinc-400'}`}>
                                      {displayName !== ev.eventName ? displayName : ev.eventName.replace(/_/g, ' ')}
                                    </span>
                                    {displayName !== ev.eventName && <span className="text-[11px] text-zinc-500 font-mono">{ev.eventName}</span>}
                                  </div>
                                )}
                              </div>
                              {localGroups.length > 0 && (
                                <select value={evGroup || ''} onChange={e => assignGroup(ev.eventName, e.target.value || undefined)}
                                  className="px-1.5 py-1 bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-400 focus:outline-none focus:border-teal-500 max-w-[100px]">
                                  <option value="">No group</option>
                                  {localGroups.sort((a, b) => a.order - b.order).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                </select>
                              )}
                              <span className="text-[11px] text-zinc-500 tabular-nums shrink-0">{ev.eventCount.toLocaleString()}</span>
                              <button onClick={() => { setEditingEventName(ev.eventName); setEditingDisplayName(getDisplayName(ev.eventName) !== ev.eventName ? getDisplayName(ev.eventName) : ''); }}
                                className="shrink-0" title="Rename"><Pencil className="w-3 h-3 text-zinc-500 hover:text-zinc-400" /></button>
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
