import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link2Off, Download, ArrowRight, Wrench, Plus, X } from 'lucide-react';
import { redirects as redirectsApi } from '../../api/misc';
import { adminPath, type Page } from '../../routes';
import type { DeadLinkItem } from './types';
import { Button, Icon, IconButton, SectionCard, cn } from '../ui';

interface DeadLinkPanelProps {
  deadLinkDetails: DeadLinkItem[];
  siteId: string;
  workspaceId?: string;
}

export function DeadLinkPanel({ deadLinkDetails, siteId, workspaceId }: DeadLinkPanelProps) {
  const navigate = useNavigate();
  const [redirectFormUrl, setRedirectFormUrl] = useState<string | null>(null);
  const [redirectFormTo, setRedirectFormTo] = useState('');
  const [pendingRedirects, setPendingRedirects] = useState<Map<string, string>>(new Map());
  const [savingRedirect, setSavingRedirect] = useState(false);

  const exportDeadLinksCSV = () => {
    if (deadLinkDetails.length === 0) return;
    const rows = deadLinkDetails.map(l => {
      const redirectTo = pendingRedirects.get(l.url) || '';
      return [l.url, String(l.status), l.statusText, l.type, l.foundOn, l.anchorText, redirectTo]
        .map(v => `"${v.replace(/"/g, '""')}"`)
        .join(',');
    });
    const csv = 'Broken URL,Status,Status Text,Type,Found On,Anchor Text,Redirect To\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dead-links.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveRedirect = async (fromUrl: string) => {
    const toUrl = redirectFormTo.trim();
    if (!toUrl) return;
    setSavingRedirect(true);
    try {
      setPendingRedirects(prev => new Map(prev).set(fromUrl, toUrl));
      try {
        await redirectsApi.save(siteId, { rules: [{ from: fromUrl, to: toUrl }] });
      } catch { /* server save is best-effort */ }
      setRedirectFormUrl(null);
      setRedirectFormTo('');
    } finally {
      setSavingRedirect(false);
    }
  };

  return (
    <SectionCard>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon as={Link2Off} size="md" className="text-red-400" />
          <span className="t-body font-medium text-[var(--brand-text-bright)]">Broken Links</span>
          <span className="t-caption-sm px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
            {deadLinkDetails.length}
          </span>
          {pendingRedirects.size > 0 && (
            <span className="t-caption-sm px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
              {pendingRedirects.size} redirect{pendingRedirects.size !== 1 ? 's' : ''} queued
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={exportDeadLinksCSV}
          icon={Download}
          className="gap-1 t-caption-sm px-2 py-1 rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/20"
        >
          Export CSV
        </Button>
      </div>
      <div className="space-y-1.5">
        {deadLinkDetails.map((link, idx) => {
          const isFormOpen = redirectFormUrl === link.url;
          const hasRedirect = pendingRedirects.has(link.url);
          return (
            <div key={idx} className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)]/40 overflow-hidden">
              <div className="flex items-start gap-2 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn('t-caption-sm px-1 py-px rounded border font-mono flex-shrink-0', link.status === 404 || link.status === '404' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20')}>
                      {link.status}
                    </span>
                    <span className={cn('t-micro px-1 py-px rounded border flex-shrink-0', link.type === 'internal' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-[var(--surface-2)] text-[var(--brand-text)] border-[var(--brand-border)]')}>
                      {link.type}
                    </span>
                    <span className="t-caption text-[var(--brand-text-bright)] font-mono truncate">{link.url}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">Found on:</span>
                    <span className="t-caption-sm text-[var(--brand-text)] truncate">{link.foundOn || link.foundOnSlug}</span>
                    {link.anchorText && (
                      <>
                        <span className="t-caption-sm text-[var(--brand-text-dim)]">·</span>
                        <span className="t-caption-sm text-[var(--brand-text-muted)] italic truncate">"{link.anchorText}"</span>
                      </>
                    )}
                  </div>
                  {hasRedirect && !isFormOpen && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Icon as={ArrowRight} size="sm" className="text-teal-400" />
                      <span className="t-caption-sm text-teal-400 font-mono">{pendingRedirects.get(link.url)}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {workspaceId && link.type === 'internal' && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(adminPath(workspaceId, 'seo-editor' as Page), {
                        state: { fixContext: { targetRoute: 'seo-editor', pageSlug: link.foundOnSlug, pageName: link.foundOn, issueCheck: 'broken_link', issueMessage: `Broken link: ${link.url}` } },
                      })}
                      icon={Wrench}
                      className="gap-0.5 t-caption-sm px-1.5 py-0.5 rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/20"
                      title="Open source page in SEO Editor"
                    >
                      Fix
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (isFormOpen) {
                        setRedirectFormUrl(null);
                        setRedirectFormTo('');
                      } else {
                        setRedirectFormUrl(link.url);
                        setRedirectFormTo(hasRedirect ? pendingRedirects.get(link.url)! : '');
                      }
                    }}
                    icon={Plus}
                    className={cn('gap-0.5 t-caption-sm px-1.5 py-0.5 rounded border', hasRedirect ? 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border-blue-500/20' : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--brand-text)] border-[var(--brand-border)]')}
                    title="Create a redirect for this URL"
                  >
                    {hasRedirect ? 'Edit Redirect' : 'Add Redirect'}
                  </Button>
                </div>
              </div>
              {isFormOpen && (
                <div className="px-3 py-2 border-t border-[var(--brand-border)] bg-[var(--surface-2)] flex items-center gap-2">
                  <Icon as={ArrowRight} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                  <input
                    type="text"
                    value={redirectFormTo}
                    onChange={e => setRedirectFormTo(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveRedirect(link.url);
                      if (e.key === 'Escape') { setRedirectFormUrl(null); setRedirectFormTo(''); }
                    }}
                    placeholder="/new-path or https://example.com/new"
                    className="flex-1 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded px-2 py-1 t-caption text-[var(--brand-text-bright)] placeholder-zinc-600 focus:outline-none focus:border-teal-500"
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => saveRedirect(link.url)}
                    disabled={!redirectFormTo.trim() || savingRedirect}
                    className="px-2.5 py-1 rounded t-caption font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50"
                  >
                    {savingRedirect ? 'Saving...' : 'Save'}
                  </Button>
                  <IconButton
                    type="button"
                    icon={X}
                    label="Cancel redirect"
                    size="sm"
                    variant="ghost"
                    onClick={() => { setRedirectFormUrl(null); setRedirectFormTo(''); }}
                    className="p-1 rounded hover:bg-[var(--surface-3)] text-[var(--brand-text-muted)]"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
