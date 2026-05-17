import { useState, useEffect, useRef } from 'react';
import { Plus, ChevronDown, Link, Link2Off, Trash2, Globe, Eye, EyeOff, ExternalLink, MoreHorizontal } from 'lucide-react';
import { cn, Icon, ConfirmDialog, Button, IconButton, ClickableRow, FormInput } from './ui';
import { webflow } from '../api';
import type { BusinessProfileContact } from '../../shared/types/workspace.js';

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
  businessProfile?: BusinessProfileContact | null;
  intelligenceProfile?: {
    industry?: string;
    targetAudience?: string;
  } | null;
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
  useEffect(() => { // effect-layout-ok — resets hidden form state, no layout flash
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
      <Button
        onClick={() => setOpen(!open)}
        variant="ghost"
        size="sm"
        className={cn(
          'flex items-center gap-2 w-full px-3 py-2 rounded-[var(--radius-lg)] t-caption font-medium transition-all border border-[var(--brand-border)]',
          open ? 'bg-teal-500/10 ring-1 ring-teal-500/20' : 'hover:bg-[var(--surface-3)]/60'
        )}
      >
        <div className={cn(
          'w-2 h-2 rounded-[var(--radius-pill)] shrink-0',
          selected ? 'bg-emerald-400' : 'bg-[var(--brand-border-hover)]'
        )} />
        <div className="truncate flex-1 text-left">
          <span className={selected ? 'text-[var(--brand-text-bright)]' : 'text-[var(--brand-text-muted)]'}>{selected?.name || 'Select workspace'}</span>
          {selected?.webflowSiteName && (
            <div className="t-caption-sm text-[var(--brand-text-muted)] truncate leading-tight">{selected.webflowSiteName}</div>
          )}
        </div>
        <Icon as={ChevronDown} size="md" className={cn('shrink-0 transition-transform', open ? 'rotate-180 text-accent-brand' : 'text-[var(--brand-text-muted)]')} />
      </Button>

      {open && (
        // pr-check-disable-next-line -- dropdown
        <div className="absolute top-full left-0 mt-2 w-80 rounded-[var(--radius-xl)] shadow-2xl z-[var(--z-modal)] overflow-hidden bg-[var(--surface-2)] border border-[var(--brand-border-hover)]">
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
                        'w-2 h-2 rounded-[var(--radius-pill)] shrink-0',
                        ws.webflowSiteId ? 'bg-emerald-400' : 'bg-[var(--brand-text-muted)]'
                      )} />
                      <span className="t-body truncate">{ws.name}</span>
                      {ws.webflowSiteName && (
                        <span className="flex items-center gap-1 t-caption text-[var(--brand-text-muted)]">
                          <Icon as={Link} size="sm" />
                          {ws.webflowSiteName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 relative">
                      {ws.webflowSiteId ? (
                        <IconButton
                          onClick={(e) => { e.stopPropagation(); onUnlinkSite(ws.id); }}
                          icon={Link2Off}
                          label="Unlink site"
                          size="sm"
                          variant="ghost"
                          className="opacity-0 group-hover:opacity-100"
                          title="Unlink site"
                        />
                      ) : (
                        <IconButton
                          onClick={(e) => { e.stopPropagation(); setLinkingId(linkingId === ws.id ? null : ws.id); }}
                          icon={Globe}
                          label="Link Webflow site"
                          size="sm"
                          variant="ghost"
                          className="opacity-0 group-hover:opacity-100"
                          title="Link Webflow site"
                        />
                      )}
                      <IconButton
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === ws.id ? null : ws.id); }}
                        icon={MoreHorizontal}
                        label="Open workspace actions"
                        size="sm"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100"
                      />
                      {menuOpen === ws.id && (
                        <div className="absolute right-0 top-full mt-1 w-36 rounded-[var(--radius-lg)] shadow-xl z-[var(--z-modal)] py-1 bg-[var(--surface-2)] border border-[var(--brand-border-hover)]">
                          <Button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(ws.id); setMenuOpen(null); }}
                            icon={Trash2}
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start rounded-none text-accent-danger hover:bg-red-500/10"
                          >
                            Delete workspace
                          </Button>
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
                        <a href="https://webflow.com/dashboard/account/integrations" target="_blank" rel="noopener noreferrer" className="text-accent-brand hover:text-accent-brand inline-flex items-center gap-0.5">
                          webflow.com <Icon as={ExternalLink} size="xs" />
                        </a>
                      </p>
                      <div className="flex gap-1.5 mb-2">
                        <div className="relative flex-1">
                          <FormInput
                            ref={tokenInputRef}
                            type={showToken ? 'text' : 'password'}
                            value={linkToken}
                            onChange={setLinkToken}
                            onKeyDown={(e) => e.key === 'Enter' && fetchSitesForToken(linkToken)}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Paste API token..."
                            className="w-full px-2 py-1 pr-7 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-[var(--brand-border-hover)] placeholder-[var(--brand-border-hover)]"
                          />
                          <IconButton
                            onClick={(e) => { e.stopPropagation(); setShowToken(!showToken); }}
                            icon={showToken ? EyeOff : Eye}
                            label={showToken ? 'Hide token' : 'Show token'}
                            variant="ghost"
                            size="sm"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
                          />
                        </div>
                        <Button
                          onClick={(e) => { e.stopPropagation(); fetchSitesForToken(linkToken); }}
                          disabled={!linkToken.trim() || loadingSites}
                          variant="primary"
                          size="sm"
                          className="bg-teal-600 text-white rounded hover:bg-teal-500"
                        >
                          {loadingSites ? '...' : 'Go'}
                        </Button>
                      </div>
                      {tokenError && <p className="t-caption text-accent-danger mb-1">{tokenError}</p>}
                      {loadingSites && (
                        <div className="flex items-center gap-2 t-caption text-[var(--brand-text-muted)] py-1">
                          <div className="w-3 h-3 border border-[var(--brand-border)] border-t-[var(--brand-text-muted)] rounded-[var(--radius-pill)] animate-spin" />
                          Loading sites...
                        </div>
                      )}
                      {sites.length > 0 && (
                        <div className="space-y-0.5 max-h-32 overflow-auto">
                          <p className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Select a site:</p>
                          {sites.map(site => (
                            <ClickableRow
                              key={site.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                onLinkSite(ws.id, site.id, site.displayName, linkToken.trim());
                                setLinkingId(null);
                              }}
                              className="flex items-center gap-2 px-2 py-1.5 t-caption rounded"
                            >
                              <Icon as={Globe} size="sm" className="text-accent-brand shrink-0" />
                              <span className="truncate">{site.displayName}</span>
                            </ClickableRow>
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
                <FormInput
                  type="text"
                  value={newName}
                  onChange={setNewName}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="Workspace name..."
                  autoFocus
                  className="flex-1 px-3 py-1.5 bg-[var(--surface-2)] border border-[var(--brand-border-hover)] rounded-[var(--radius-lg)] t-body focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus:border-[var(--brand-text-muted)]"
                />
                <Button
                  onClick={handleCreate}
                  variant="primary"
                  size="sm"
                  className="bg-teal-600 text-white t-body font-medium rounded-[var(--radius-lg)] hover:bg-teal-500"
                >
                  Add
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => setCreating(true)}
                icon={Plus}
                variant="ghost"
                size="sm"
                className="w-full justify-start px-3 py-2 t-body text-[var(--brand-text-muted)] hover:text-white hover:bg-[var(--brand-border-hover)]/50 rounded-[var(--radius-lg)]"
              >
                New workspace
              </Button>
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
