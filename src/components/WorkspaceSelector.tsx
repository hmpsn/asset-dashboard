import { useState, useEffect, useRef } from 'react';
import { Plus, ChevronDown, Link, Link2Off, Trash2, Globe, Eye, EyeOff, ExternalLink, MoreHorizontal } from 'lucide-react';
import { cn, Icon, ConfirmDialog } from './ui';
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
  tier?: 'free' | 'growth' | 'premium';
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
        setSites(data as WebflowSite[]);
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
          'flex items-center gap-2 w-full px-3 py-2 rounded-[var(--radius-lg)] t-caption font-medium transition-all border border-[var(--brand-border)]',
          open ? 'bg-teal-500/10 ring-1 ring-teal-500/20' : 'hover:bg-[var(--surface-3)]/60'
        )}
      >
        <div className={cn(
          'w-2 h-2 rounded-full shrink-0',
          selected ? 'bg-emerald-400' : 'bg-[var(--brand-border-hover)]'
        )} />
        <div className="truncate flex-1 text-left">
          <span className={selected ? 'text-[var(--brand-text-bright)]' : 'text-[var(--brand-text-muted)]'}>{selected?.name || 'Select workspace'}</span>
          {selected?.webflowSiteName && (
            <div className="t-caption-sm text-[var(--brand-text-muted)] truncate leading-tight">{selected.webflowSiteName}</div>
          )}
        </div>
        <Icon as={ChevronDown} size="md" className={cn('shrink-0 transition-transform', open ? 'rotate-180 text-teal-400' : 'text-[var(--brand-text-muted)]')} />
      </button>

      {open && (
        // pr-check-disable-next-line -- dropdown
        <div className="absolute top-full left-0 mt-2 w-80 rounded-[var(--radius-xl)] shadow-2xl z-50 overflow-hidden bg-[var(--surface-2)] border border-[var(--brand-border-hover)]">
          {workspaces.length > 0 && (
            <div className="p-1">
              {workspaces.map(ws => (
                <div key={ws.id}>
                  <div
                    className={cn(
                      'flex items-center justify-between px-3 py-2 rounded-[var(--radius-lg)] cursor-pointer transition-colors group',
                      selected?.id === ws.id ? 'bg-[var(--brand-border-hover)]' : 'hover:bg-[var(--brand-border-hover)]/50'
                    )}
                    onClick={() => { onSelect(ws); setOpen(false); setLinkingId(null); }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn(
                        'w-2 h-2 rounded-full shrink-0',
                        ws.webflowSiteId ? 'bg-emerald-400' : 'bg-[var(--brand-text-muted)]'
                      )} />
                      <span className="text-sm truncate">{ws.name}</span>
                      {ws.webflowSiteName && (
                        <span className="flex items-center gap-1 t-caption text-[var(--brand-text-muted)]">
                          <Icon as={Link} size="sm" />
                          {ws.webflowSiteName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 relative">
                      {ws.webflowSiteId ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onUnlinkSite(ws.id); }}
                          className="p-1 hover:bg-[var(--brand-border-hover)] rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Unlink site"
                        >
                          <Icon as={Link2Off} size="sm" className="text-[var(--brand-text-muted)]" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setLinkingId(linkingId === ws.id ? null : ws.id); }}
                          className="p-1 hover:bg-[var(--brand-border-hover)] rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Link Webflow site"
                        >
                          <Icon as={Globe} size="sm" className="text-[var(--brand-text-muted)]" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === ws.id ? null : ws.id); }}
                        className="p-1 hover:bg-[var(--brand-border-hover)] rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Icon as={MoreHorizontal} size="sm" className="text-[var(--brand-text-muted)]" />
                      </button>
                      {menuOpen === ws.id && (
                        <div className="absolute right-0 top-full mt-1 w-36 rounded-[var(--radius-lg)] shadow-xl z-50 py-1 bg-[var(--surface-2)] border border-[var(--brand-border-hover)]">
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(ws.id); setMenuOpen(null); }}
                            className="flex items-center gap-2 w-full px-3 py-1.5 t-caption text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Icon as={Trash2} size="sm" /> Delete workspace
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Site linking dropdown */}
                  {linkingId === ws.id && (
                    <div className="mx-2 mb-1 p-2 rounded-[var(--radius-lg)] bg-[var(--surface-2)] border border-[var(--brand-border)]">
                      <p className="t-caption text-[var(--brand-text-muted)] mb-1">Paste a Webflow API token for this workspace:</p>
                      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">
                        Get one at{' '}
                        <a href="https://webflow.com/dashboard/account/integrations" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300 inline-flex items-center gap-0.5">
                          webflow.com <Icon as={ExternalLink} size="xs" />
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
                            className="w-full px-2 py-1 pr-7 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption focus:outline-none focus:border-[var(--brand-border-hover)] placeholder-[var(--brand-border-hover)]"
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowToken(!showToken); }}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
                          >
                            {showToken ? <Icon as={EyeOff} size="sm" /> : <Icon as={Eye} size="sm" />}
                          </button>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); fetchSitesForToken(linkToken); }}
                          disabled={!linkToken.trim() || loadingSites}
                          className="px-2 py-1 t-caption font-medium bg-teal-600 text-white rounded hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {loadingSites ? '...' : 'Go'}
                        </button>
                      </div>
                      {tokenError && <p className="t-caption text-red-400/80 mb-1">{tokenError}</p>}
                      {loadingSites && (
                        <div className="flex items-center gap-2 t-caption text-[var(--brand-text-muted)] py-1">
                          <div className="w-3 h-3 border border-[var(--brand-border)] border-t-[var(--brand-text-muted)] rounded-full animate-spin" />
                          Loading sites...
                        </div>
                      )}
                      {sites.length > 0 && (
                        <div className="space-y-0.5 max-h-32 overflow-auto">
                          <p className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Select a site:</p>
                          {sites.map(site => (
                            <button
                              key={site.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                onLinkSite(ws.id, site.id, site.displayName, linkToken.trim());
                                setLinkingId(null);
                              }}
                              className="flex items-center gap-2 w-full px-2 py-1.5 text-left t-caption hover:bg-[var(--surface-3)] rounded transition-colors"
                            >
                              <Icon as={Globe} size="sm" className="text-teal-400 shrink-0" />
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

          <div className="p-2 border-t border-[var(--brand-border)]">
            {creating ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="Workspace name..."
                  autoFocus
                  className="flex-1 px-3 py-1.5 bg-[var(--surface-2)] border border-[var(--brand-border-hover)] rounded-[var(--radius-lg)] text-sm focus:outline-none focus:border-[var(--brand-text-muted)]"
                />
                <button
                  onClick={handleCreate}
                  className="px-3 py-1.5 bg-teal-600 text-white text-sm font-medium rounded-[var(--radius-lg)] hover:bg-teal-500 transition-colors"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[var(--brand-text-muted)] hover:text-white hover:bg-[var(--brand-border-hover)]/50 rounded-[var(--radius-lg)] transition-colors"
              >
                <Icon as={Plus} size="md" />
                New workspace
              </button>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete workspace?"
        message={`This will permanently remove ${workspaces.find(w => w.id === confirmDelete)?.name ?? 'this workspace'} and all its data.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => { if (confirmDelete) { onDelete(confirmDelete); setConfirmDelete(null); setOpen(false); } }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
