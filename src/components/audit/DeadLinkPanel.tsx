import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link2Off, Download, ArrowRight, Wrench, Plus, X } from 'lucide-react';
import { redirects as redirectsApi } from '../../api/misc';
import { adminPath, type Page } from '../../routes';
import type { DeadLinkItem } from './types';

interface DeadLinkPanelProps {
  deadLinkDetails: DeadLinkItem[];
  deadLinkSummary: { total: number; internal: number; external: number; redirects: number };
  siteId: string;
  workspaceId?: string;
}

export function DeadLinkPanel({ deadLinkDetails, deadLinkSummary, siteId, workspaceId }: DeadLinkPanelProps) {
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
    <div className="bg-zinc-900 border border-zinc-800 p-5" style={{ borderRadius: '10px 24px 10px 24px' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Link2Off className="w-4 h-4 text-red-400" />
          <span className="text-sm font-medium text-zinc-300">Broken Links</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
            {deadLinkDetails.length}
          </span>
          {pendingRedirects.size > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
              {pendingRedirects.size} redirect{pendingRedirects.size !== 1 ? 's' : ''} queued
            </span>
          )}
        </div>
        <button
          onClick={exportDeadLinksCSV}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/20 transition-colors"
        >
          <Download className="w-3 h-3" /> Export CSV
        </button>
      </div>
      <div className="space-y-1.5">
        {deadLinkDetails.map((link, idx) => {
          const isFormOpen = redirectFormUrl === link.url;
          const hasRedirect = pendingRedirects.has(link.url);
          return (
            <div key={idx} className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
              <div className="flex items-start gap-2 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[11px] px-1 py-px rounded border font-mono flex-shrink-0 ${link.status === 404 || link.status === '404' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                      {link.status}
                    </span>
                    <span className={`text-[10px] px-1 py-px rounded border flex-shrink-0 ${link.type === 'internal' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-zinc-700/50 text-zinc-400 border-zinc-600/50'}`}>
                      {link.type}
                    </span>
                    <span className="text-xs text-zinc-300 font-mono truncate">{link.url}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-[11px] text-zinc-500">Found on:</span>
                    <span className="text-[11px] text-zinc-400 truncate">{link.foundOn || link.foundOnSlug}</span>
                    {link.anchorText && (
                      <>
                        <span className="text-[11px] text-zinc-600">·</span>
                        <span className="text-[11px] text-zinc-500 italic truncate">"{link.anchorText}"</span>
                      </>
                    )}
                  </div>
                  {hasRedirect && !isFormOpen && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <ArrowRight className="w-3 h-3 text-teal-400" />
                      <span className="text-[11px] text-teal-400 font-mono">{pendingRedirects.get(link.url)}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {workspaceId && link.type === 'internal' && (
                    <button
                      onClick={() => navigate(adminPath(workspaceId, 'seo-editor' as Page), {
                        state: { fixContext: { targetRoute: 'seo-editor', pageSlug: link.foundOnSlug, pageName: link.foundOn, issueCheck: 'broken_link', issueMessage: `Broken link: ${link.url}` } },
                      })}
                      className="flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/20 transition-colors"
                      title="Open source page in SEO Editor"
                    >
                      <Wrench className="w-2.5 h-2.5" /> Fix
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (isFormOpen) {
                        setRedirectFormUrl(null);
                        setRedirectFormTo('');
                      } else {
                        setRedirectFormUrl(link.url);
                        setRedirectFormTo(hasRedirect ? pendingRedirects.get(link.url)! : '');
                      }
                    }}
                    className={`flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded border transition-colors ${hasRedirect ? 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border-blue-500/20' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border-zinc-700'}`}
                    title="Create a redirect for this URL"
                  >
                    <Plus className="w-2.5 h-2.5" /> {hasRedirect ? 'Edit Redirect' : 'Add Redirect'}
                  </button>
                </div>
              </div>
              {isFormOpen && (
                <div className="px-3 py-2 border-t border-zinc-800 bg-zinc-900/50 flex items-center gap-2">
                  <ArrowRight className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                  <input
                    type="text"
                    value={redirectFormTo}
                    onChange={e => setRedirectFormTo(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveRedirect(link.url);
                      if (e.key === 'Escape') { setRedirectFormUrl(null); setRedirectFormTo(''); }
                    }}
                    placeholder="/new-path or https://example.com/new"
                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-teal-500"
                    autoFocus
                  />
                  <button
                    onClick={() => saveRedirect(link.url)}
                    disabled={!redirectFormTo.trim() || savingRedirect}
                    className="px-2.5 py-1 rounded text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors"
                  >
                    {savingRedirect ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setRedirectFormUrl(null); setRedirectFormTo(''); }}
                    className="p-1 rounded hover:bg-zinc-700 text-zinc-500"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
