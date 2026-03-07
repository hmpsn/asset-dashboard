import { useState, useEffect } from 'react';
import {
  Loader2, ExternalLink, AlertCircle, ArrowRight,
  RefreshCw, Link2Off, Check, Download,
} from 'lucide-react';

interface DeadLink {
  url: string;
  status: number | 'timeout' | 'error';
  statusText: string;
  foundOn: string;
  foundOnSlug: string;
  anchorText: string;
  type: 'internal' | 'external';
}

interface LinkCheckResult {
  totalLinks: number;
  deadLinks: DeadLink[];
  redirects: DeadLink[];
  healthy: number;
  checkedAt: string;
}

interface Props {
  siteId: string;
}

export function LinkChecker({ siteId }: Props) {
  const [data, setData] = useState<LinkCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [tab, setTab] = useState<'dead' | 'redirects'>('dead');
  const [typeFilter, setTypeFilter] = useState<'all' | 'internal' | 'external'>('all');

  const runCheck = () => {
    setLoading(true);
    setHasRun(true);
    fetch(`/api/webflow/link-check/${siteId}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setData(null);
    setHasRun(false);
  }, [siteId]);

  const exportCsv = () => {
    if (!data) return;
    const rows = [['Type', 'URL', 'Status', 'Status Text', 'Found On', 'Found On Slug', 'Anchor Text', 'Link Type']];
    for (const link of data.deadLinks) {
      rows.push(['Dead', link.url, String(link.status), link.statusText, link.foundOn, link.foundOnSlug, link.anchorText, link.type]);
    }
    for (const link of data.redirects) {
      rows.push(['Redirect', link.url, String(link.status), link.statusText, link.foundOn, link.foundOnSlug, link.anchorText, link.type]);
    }
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `link-check-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!hasRun) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center">
          <Link2Off className="w-8 h-8 text-zinc-500" />
        </div>
        <p className="text-zinc-400 text-sm">Find broken links and redirect chains across your site</p>
        <p className="text-xs text-zinc-500 max-w-md text-center">
          Crawls every page, extracts all links, and checks each one for 404s, timeouts, and redirects
        </p>
        <button
          onClick={runCheck}
          className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm font-medium transition-colors"
        >
          Run Link Check
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-500">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        <p className="text-sm">Checking all links across the site...</p>
        <p className="text-xs text-zinc-500">This may take a few minutes for large sites</p>
      </div>
    );
  }

  if (!data) return null;

  const currentList = tab === 'dead' ? data.deadLinks : data.redirects;
  const filtered = currentList.filter(l => typeFilter === 'all' || l.type === typeFilter);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-3xl font-bold text-zinc-200">{data.totalLinks}</div>
          <div className="text-xs text-zinc-500 mt-1">Total Links</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <div className="text-3xl font-bold text-green-400">{data.healthy}</div>
          <div className="text-xs text-zinc-500 mt-1">Healthy</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-red-500/30">
          <div className="text-3xl font-bold text-red-400">{data.deadLinks.length}</div>
          <div className="text-xs text-zinc-500 mt-1">Dead Links</div>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-amber-500/30">
          <div className="text-3xl font-bold text-amber-400">{data.redirects.length}</div>
          <div className="text-xs text-zinc-500 mt-1">Redirects</div>
        </div>
      </div>

      {data.deadLinks.length === 0 && data.redirects.length === 0 && (
        <div className="flex items-center gap-3 px-4 py-4 bg-green-500/10 border border-green-500/30 rounded-lg">
          <Check className="w-5 h-5 text-green-400" />
          <div>
            <div className="text-sm font-medium text-green-300">All links are healthy!</div>
            <div className="text-xs text-green-400/70">No broken links or redirect chains found.</div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex bg-zinc-900 rounded-lg border border-zinc-800 p-0.5">
          <button
            onClick={() => setTab('dead')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === 'dead' ? 'bg-red-500/20 text-red-400' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            Dead Links ({data.deadLinks.length})
          </button>
          <button
            onClick={() => setTab('redirects')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === 'redirects' ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            Redirects ({data.redirects.length})
          </button>
        </div>
        <div className="flex bg-zinc-900 rounded-lg border border-zinc-800 p-0.5">
          {(['all', 'internal', 'external'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${typeFilter === t ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-medium transition-colors"
        >
          <Download className="w-3 h-3" /> Export CSV
        </button>
        <button
          onClick={runCheck}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-medium transition-colors"
        >
          <RefreshCw className="w-3 h-3" /> Re-check
        </button>
      </div>

      {/* Link list */}
      <div className="space-y-1">
        {filtered.length === 0 ? (
          <div className="text-sm text-zinc-500 text-center py-8">
            {tab === 'dead' ? 'No broken links found' : 'No redirect chains found'}
          </div>
        ) : (
          filtered.map((link, idx) => (
            <div key={idx} className="flex items-start gap-3 px-4 py-3 rounded-lg bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/50 transition-colors">
              {tab === 'dead' ? (
                <AlertCircle className="w-4 h-4 mt-0.5 text-red-400 shrink-0" />
              ) : (
                <ArrowRight className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-zinc-300 hover:text-white truncate inline-flex items-center gap-1"
                  >
                    {link.url.length > 80 ? link.url.slice(0, 80) + '...' : link.url}
                    <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />
                  </a>
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  Found on <span className="text-zinc-400">{link.foundOn}</span>
                  <span className="text-zinc-500"> (/{link.foundOnSlug})</span>
                  {link.anchorText && <span className="text-zinc-500"> &middot; &ldquo;{link.anchorText.slice(0, 50)}&rdquo;</span>}
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">{link.statusText}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[11px] px-1.5 py-0.5 rounded border ${link.type === 'internal' ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
                  {link.type}
                </span>
                <span className={`text-xs font-mono font-bold ${tab === 'dead' ? 'text-red-400' : 'text-amber-400'}`}>
                  {link.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="text-[11px] text-zinc-500 text-center">
        Last checked: {new Date(data.checkedAt).toLocaleString()}
      </div>
    </div>
  );
}
