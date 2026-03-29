import { useState, useEffect, useRef } from 'react';
import { Plus, ChevronDown, Link, Link2Off, Trash2, Globe, Eye, EyeOff, ExternalLink, MoreHorizontal, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import { webflow } from '../api';

export interface Workspace {
  id: string;
  name: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
  folder: string;
  createdAt: string;
}

interface WebflowSite {
  id: string;
  displayName: string;
  shortName: string;
}

interface Props {
  workspaces: Workspace[];
  selected: Workspace | null;
  onSelect: (ws: Workspace) => void;
  onCreate: (name: string, siteId?: string, siteName?: string) => void;
  onDelete: (id: string) => void;
  onLinkSite: (workspaceId: string, siteId: string, siteName: string, token: string) => void;
  onUnlinkSite: (workspaceId: string) => void;
}

export function WorkspaceSelector({ workspaces, selected, onSelect, onCreate, onDelete, onLinkSite, onUnlinkSite }: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [sites, setSites] = useState<WebflowSite[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreate(newName.trim());
    setNewName('');
    setCreating(false);
  };

  const fetchSitesForToken = async (token: string) => {
    if (!token.trim()) return;
    setLoadingSites(true);
    setTokenError('');
    setSites([]);
    try {
      const data = await webflow.sites(token.trim());
      if (Array.isArray(data) && data.length > 0) {
        setSites(data);
      } else {
        setTokenError('No sites found. Check token permissions.');
      }
    } catch (err) {
      console.error('WorkspaceSelector operation failed:', err);
      setTokenError('Failed to fetch sites.');
    } finally {
      setLoadingSites(false);
    }
  };

  // Reset state when closing link panel
  useEffect(() => {
    if (!linkingId) {
      setLinkToken('');
      setSites([]);
      setTokenError('');
      setShowToken(false);
    } else {
      setTimeout(() => tokenInputRef.current?.focus(), 100);
    }
  }, [linkingId]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium transition-all border border-zinc-800',
          open ? 'bg-teal-500/10 ring-1 ring-teal-500/20' : 'hover:bg-zinc-800/60'
        )}
      >
        <div className={cn(
          'w-2 h-2 rounded-full shrink-0',
          selected ? 'bg-emerald-400' : 'bg-zinc-600'
        )} />
        <div className="truncate flex-1 text-left">
          <span className={selected ? 'text-zinc-200' : 'text-zinc-500'}>{selected?.name || 'Select workspace'}</span>
          {selected?.webflowSiteName && (
            <div className="text-[10px] text-zinc-500 truncate leading-tight">{selected.webflowSiteName}</div>
          )}
        </div>
        <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 transition-transform', open ? 'rotate-180 text-teal-400' : 'text-zinc-500')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-80 rounded-xl shadow-2xl z-50 overflow-hidden bg-zinc-900 border border-zinc-700">
          {workspaces.length > 0 && (
            <div className="p-1">
              {workspaces.map(ws => (
                <div key={ws.id}>
                  <div
                    className={cn(
                      'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors group',
                      selected?.id === ws.id ? 'bg-zinc-700' : 'hover:bg-zinc-700/50'
                    )}
                    onClick={() => { onSelect(ws); setOpen(false); setLinkingId(null); }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn(
                        'w-2 h-2 rounded-full shrink-0',
                        ws.webflowSiteId ? 'bg-emerald-400' : 'bg-zinc-500'
                      )} />
                      <span className="text-sm truncate">{ws.name}</span>
                      {ws.webflowSiteName && (
                        <span className="flex items-center gap-1 text-xs text-zinc-500">
                          <Link className="w-3 h-3" />
                          {ws.webflowSiteName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 relative">
                      {ws.webflowSiteId ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onUnlinkSite(ws.id); }}
                          className="p-1 hover:bg-zinc-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Unlink site"
                        >
                          <Link2Off className="w-3 h-3 text-zinc-400" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setLinkingId(linkingId === ws.id ? null : ws.id); }}
                          className="p-1 hover:bg-zinc-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Link Webflow site"
                        >
                          <Globe className="w-3 h-3 text-zinc-400" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === ws.id ? null : ws.id); }}
                        className="p-1 hover:bg-zinc-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreHorizontal className="w-3 h-3 text-zinc-400" />
                      </button>
                      {menuOpen === ws.id && (
                        <div className="absolute right-0 top-full mt-1 w-36 rounded-lg shadow-xl z-50 py-1 bg-zinc-900 border border-zinc-700">
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(ws.id); setMenuOpen(null); }}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" /> Delete workspace
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Site linking dropdown */}
                  {linkingId === ws.id && (
                    <div className="mx-2 mb-1 p-2 rounded-lg bg-zinc-900 border border-zinc-800">
                      <p className="text-xs text-zinc-500 mb-1">Paste a Webflow API token for this workspace:</p>
                      <p className="text-[11px] text-zinc-500 mb-2">
                        Get one at{' '}
                        <a href="https://webflow.com/dashboard/account/integrations" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300 inline-flex items-center gap-0.5">
                          webflow.com <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </p>
                      <div className="flex gap-1.5 mb-2">
                        <div className="relative flex-1">
                          <input
                            ref={tokenInputRef}
                            type={showToken ? 'text' : 'password'}
                            value={linkToken}
                            onChange={(e) => setLinkToken(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && fetchSitesForToken(linkToken)}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Paste API token..."
                            className="w-full px-2 py-1 pr-7 bg-zinc-800 border border-zinc-700 rounded text-xs focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowToken(!showToken); }}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                          >
                            {showToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); fetchSitesForToken(linkToken); }}
                          disabled={!linkToken.trim() || loadingSites}
                          className="px-2 py-1 text-xs font-medium bg-teal-600 text-white rounded hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {loadingSites ? '...' : 'Go'}
                        </button>
                      </div>
                      {tokenError && <p className="text-xs text-red-400/80 mb-1">{tokenError}</p>}
                      {loadingSites && (
                        <div className="flex items-center gap-2 text-xs text-zinc-500 py-1">
                          <div className="w-3 h-3 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
                          Loading sites...
                        </div>
                      )}
                      {sites.length > 0 && (
                        <div className="space-y-0.5 max-h-32 overflow-auto">
                          <p className="text-[11px] text-zinc-500 mb-1">Select a site:</p>
                          {sites.map(site => (
                            <button
                              key={site.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                onLinkSite(ws.id, site.id, site.displayName, linkToken.trim());
                                setLinkingId(null);
                              }}
                              className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-xs hover:bg-zinc-800 rounded transition-colors"
                            >
                              <Globe className="w-3 h-3 text-teal-400 shrink-0" />
                              <span className="truncate">{site.displayName}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="p-2 border-t border-zinc-800">
            {creating ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="Workspace name..."
                  autoFocus
                  className="flex-1 px-3 py-1.5 bg-zinc-900 border border-zinc-600 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
                />
                <button
                  onClick={handleCreate}
                  className="px-3 py-1.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-500 transition-colors"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-700/50 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                New workspace
              </button>
            )}
          </div>
        </div>
      )}
      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]" onClick={() => setConfirmDelete(null)}>
          <div className="w-80 rounded-xl p-5 shadow-2xl bg-zinc-900 border border-zinc-700" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-red-500/8 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-400/80" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">Delete workspace?</h3>
                <p className="text-xs mt-0.5 text-zinc-500">
                  This will permanently remove <strong>{workspaces.find(w => w.id === confirmDelete)?.name}</strong> and all its data.
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors bg-zinc-900 text-zinc-500 border border-zinc-800">
                Cancel
              </button>
              <button onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); setOpen(false); }} className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
