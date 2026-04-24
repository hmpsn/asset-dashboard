import { useState, useEffect } from 'react';
import {
  Search, Loader2, Check, X, Users, ExternalLink, ChevronRight,
  Copy, CheckCircle, Lock, KeyRound, Plus, Trash2, Pencil, Save,
  Pin, PinOff, ArrowUp, ArrowDown, Palette, RefreshCw, DollarSign, Shield,
} from 'lucide-react';
import SearchableSelect from '../SearchableSelect';
import { get, post, patch, del, getSafe } from '../../api/client';
import { themeColor } from '../ui/constants';

import type { SafeClientUser as ClientUserSafe } from '../../../shared/types/users.ts';
import type { EventGroup, EventDisplayConfig } from '../../../shared/types/workspace.ts';

interface WorkspaceData {
  hasPassword?: boolean;
  clientEmail?: string;
  eventConfig?: EventDisplayConfig[];
  eventGroups?: EventGroup[];
  ga4PropertyId?: string;
  contentPricing?: { briefPrice: number; fullPostPrice: number; currency: string; briefLabel?: string; fullPostLabel?: string; briefDescription?: string; fullPostDescription?: string } | null;
  [key: string]: unknown;
}

interface ClientDashboardTabProps {
  workspaceId: string;
  webflowSiteId?: string;
  ws: WorkspaceData | null;
  patchWorkspace: (patch: Record<string, unknown>) => Promise<unknown>;
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function ClientDashboardTab({ workspaceId, webflowSiteId, ws, patchWorkspace, toast }: ClientDashboardTabProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [clientEmail, setClientEmail] = useState(ws?.clientEmail || '');
  const [savingEmail, setSavingEmail] = useState(false);

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

  const GROUP_COLORS = ['#14b8a6', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#fb923c', '#2dd4bf', '#e879f9'];

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

  // Client user CRUD
  const loadClientUsers = async () => {
    setClientUsersLoading(true);
    try {
      const data = await get<ClientUserSafe[]>(`/api/workspaces/${workspaceId}/client-users`);
      setClientUsers(data);
    } catch (err) { console.error('ClientDashboardTab operation failed:', err); }
    finally { setClientUsersLoading(false); }
  };

  const addClientUser = async () => {
    if (!newUserEmail.trim() || !newUserName.trim() || !newUserPassword.trim()) return;
    setAddingUser(true);
    try {
      await post(`/api/workspaces/${workspaceId}/client-users`, { email: newUserEmail.trim(), name: newUserName.trim(), password: newUserPassword.trim(), role: newUserRole });
      toast(`${newUserName.trim()} added`);
      setNewUserName(''); setNewUserEmail(''); setNewUserPassword(''); setNewUserRole('client_member'); setShowAddUser(false);
      loadClientUsers();
    } catch { toast('Failed to add user', 'error'); }
    finally { setAddingUser(false); }
  };

  const saveEditUser = async (userId: string) => {
    try {
      await patch(`/api/workspaces/${workspaceId}/client-users/${userId}`, { name: editUserName.trim(), email: editUserEmail.trim() });
      toast('User updated');
      setEditingUserId(null);
      loadClientUsers();
    } catch { toast('Failed to update user', 'error'); }
  };

  const deleteClientUser = async (userId: string, userName: string) => {
    if (!confirm(`Remove ${userName} from this workspace?`)) return;
    try {
      await del(`/api/workspaces/${workspaceId}/client-users/${userId}`);
      toast(`${userName} removed`);
      loadClientUsers();
    } catch { toast('Failed to remove user', 'error'); }
  };

  const resetClientPassword = async (userId: string) => {
    if (!resetPasswordValue.trim()) return;
    try {
      await post(`/api/workspaces/${workspaceId}/client-users/${userId}/password`, { password: resetPasswordValue.trim() });
      toast('Password reset');
      setResetPasswordUserId(null); setResetPasswordValue('');
    } catch { toast('Failed to reset password', 'error'); }
  };

  // Event config helpers
  const loadEvents = async () => {
    setShowEventConfig(true); setLoadingEvents(true);
    try {
      const [events, pages] = await Promise.all([
        getSafe<{eventName: string; eventCount: number; users: number}[]>(`/api/public/analytics-events/${workspaceId}?days=28`, []),
        getSafe<{path: string}[]>(`/api/public/analytics-top-pages/${workspaceId}?days=28`, []),
      ]);
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

  // Load users on mount
  useEffect(() => { loadClientUsers(); }, []);

  // Sync clientEmail when ws loads asynchronously
  useEffect(() => { if (ws?.clientEmail !== undefined) setClientEmail(ws.clientEmail || ''); }, [ws?.clientEmail]);

  if (!webflowSiteId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Users className="w-8 h-8 text-zinc-500" />
        <p className="text-sm text-zinc-400">Link a Webflow site first to enable the client dashboard</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
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
                : { backgroundColor: themeColor('#18181b', '#ffffff'), color: themeColor('#a1a1aa', '#64748b'), border: `1px solid ${themeColor('#27272a', '#e2e8f0')}` }}>
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
            <DollarSign className="w-4 h-4 text-emerald-400" />
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
            style={{ backgroundColor: themeColor('#27272a', '#e2e8f0'), color: themeColor('#a1a1aa', '#64748b') }}>
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
                style={{ backgroundColor: themeColor('#27272a', '#e2e8f0'), color: themeColor('#a1a1aa', '#64748b') }}>
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
    </div>
  );
}
