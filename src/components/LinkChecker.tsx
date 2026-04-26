import { useState, useEffect } from 'react';
import {
  Loader2, ExternalLink, AlertCircle, ArrowRight,
  RefreshCw, Link2Off, Check, Download,
} from 'lucide-react';
import { get, getOptional } from '../api/client';
import { Icon, cn } from './ui';

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
  crawledDomain?: string;
}

interface SiteDomainInfo {
  staging: string;
  customDomains: string[];
  defaultDomain: string;
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
  const [domains, setDomains] = useState<SiteDomainInfo | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string>('');

  // Fetch available domains when site changes
  useEffect(() => {
    setDomains(null); setSelectedDomain('');
    get<SiteDomainInfo>(`/api/webflow/link-check-domains/${siteId}`)
      .then(d => {
        setDomains(d);
        setSelectedDomain(d.defaultDomain || d.staging);
      })
      .catch((err) => { console.error('LinkChecker operation failed:', err); });
  }, [siteId]);

  const runCheck = () => {
    setLoading(true);
    setHasRun(true);
    const domainParam = selectedDomain ? `?domain=${encodeURIComponent(selectedDomain)}` : '';
    get<LinkCheckResult>(`/api/webflow/link-check/${siteId}${domainParam}`)
      .then(d => setData(d))
      .catch((err) => { console.error('LinkChecker operation failed:', err); })
      .finally(() => setLoading(false));
  };

  // Load last saved snapshot on site change
  useEffect(() => {
    let cancelled = false;
    setData(null); setHasRun(false);
    getOptional<{ result?: LinkCheckResult }>(`/api/webflow/link-check-snapshot/${siteId}`)
      .then(snap => { if (!cancelled && snap?.result) { setData(snap.result); setHasRun(true); } })
      .catch((err) => { console.error('LinkChecker operation failed:', err); });
    return () => { cancelled = true; };
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
        <div className="w-16 h-16 rounded-2xl bg-[var(--surface-2)] flex items-center justify-center">
          <Icon as={Link2Off} size="2xl" className="text-[var(--brand-text-muted)]" />
        </div>
        <p className="text-[var(--brand-text)] t-body">Find broken links and redirect chains across your site</p>
        <p className="t-caption text-[var(--brand-text-muted)] max-w-md text-center">
          Crawls every page, extracts all links (including buttons &amp; onclick), and checks each one for 404s, timeouts, and redirects
        </p>
        {domains && (
          <div className="flex items-center gap-2">
            <span className="t-caption text-[var(--brand-text-muted)]">Crawl domain:</span>
            <select
              value={selectedDomain}
              onChange={e => setSelectedDomain(e.target.value)}
              className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-lg px-3 py-1.5 t-caption text-[var(--brand-text-bright)] focus:border-teal-500/50 focus:outline-none"
            >
              <option value={domains.staging}>{domains.staging.replace('https://', '')} (staging)</option>
              {domains.customDomains.map(d => (
                <option key={d} value={d}>{d.replace('https://', '')} (live)</option>
              ))}
            </select>
          </div>
        )}
        <button
          onClick={runCheck}
          disabled={!selectedDomain}
          className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg t-body font-medium transition-colors"
        >
          Run Link Check
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--brand-text-muted)]">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        <p className="t-body">Checking all links across the site...</p>
        <p className="t-caption text-[var(--brand-text-muted)]">This may take a few minutes for large sites</p>
      </div>
    );
  }

  if (!data) return null;

  const currentList = tab === 'dead' ? data.deadLinks : data.redirects;
  const filtered = currentList.filter(l => typeFilter === 'all' || l.type === typeFilter);

  return (
    <div className="space-y-8">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4" style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="text-3xl font-bold text-[var(--brand-text-bright)]">{data.totalLinks}</div>
          <div className="t-caption text-[var(--brand-text-muted)] mt-1">Total Links</div>
        </div>
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-4" style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="text-3xl font-bold text-emerald-400">{data.healthy}</div>
          <div className="t-caption text-[var(--brand-text-muted)] mt-1">Healthy</div>
        </div>
        <div className="bg-[var(--surface-2)] p-4 border border-red-500/30" style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="text-3xl font-bold text-red-400">{data.deadLinks.length}</div>
          <div className="t-caption text-[var(--brand-text-muted)] mt-1">Dead Links</div>
        </div>
        <div className="bg-[var(--surface-2)] p-4 border border-amber-500/30" style={{ borderRadius: 'var(--radius-signature)' }}>
          <div className="text-3xl font-bold text-amber-400">{data.redirects.length}</div>
          <div className="t-caption text-[var(--brand-text-muted)] mt-1">Redirects</div>
        </div>
      </div>

      {data.deadLinks.length === 0 && data.redirects.length === 0 && (
        <div className="flex items-center gap-3 px-4 py-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
          <Icon as={Check} size="lg" className="text-emerald-400" />
          <div>
            <div className="t-body font-medium text-emerald-300">All links are healthy!</div>
            <div className="t-caption text-emerald-400/70">No broken links or redirect chains found.</div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex bg-[var(--surface-2)] rounded-lg border border-[var(--brand-border)] p-0.5">
          <button
            onClick={() => setTab('dead')}
            className={cn('px-3 py-1.5 t-caption font-medium rounded-md transition-colors', tab === 'dead' ? 'bg-red-500/20 text-red-400' : 'text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]')}
          >
            Dead Links ({data.deadLinks.length})
          </button>
          <button
            onClick={() => setTab('redirects')}
            className={cn('px-3 py-1.5 t-caption font-medium rounded-md transition-colors', tab === 'redirects' ? 'bg-amber-500/20 text-amber-400' : 'text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]')}
          >
            Redirects ({data.redirects.length})
          </button>
        </div>
        <div className="flex bg-[var(--surface-2)] rounded-lg border border-[var(--brand-border)] p-0.5">
          {(['all', 'internal', 'external'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn('px-3 py-1.5 t-caption font-medium rounded-md transition-colors capitalize', typeFilter === t ? 'bg-[var(--surface-3)] text-[var(--brand-text-bright)]' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]')}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded-lg t-caption font-medium transition-colors"
        >
          <Icon as={Download} size="sm" /> Export CSV
        </button>
        <button
          onClick={runCheck}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded-lg t-caption font-medium transition-colors"
        >
          <Icon as={RefreshCw} size="sm" /> Re-check
        </button>
      </div>

      {/* Link list */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="t-body text-[var(--brand-text-muted)] text-center py-8">
            {tab === 'dead' ? 'No broken links found' : 'No redirect chains found'}
          </div>
        ) : (
          filtered.map((link, idx) => (
            <div key={idx} className="flex items-start gap-3 px-4 py-3 bg-[var(--surface-2)] hover:bg-[var(--surface-3)]/50 border border-[var(--brand-border)] transition-colors" style={{ borderRadius: '6px 12px 6px 12px' }}>
              {tab === 'dead' ? (
                <Icon as={AlertCircle} size="md" className="mt-0.5 text-red-400 shrink-0" />
              ) : (
                <Icon as={ArrowRight} size="md" className="mt-0.5 text-amber-400 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="t-body text-[var(--brand-text-bright)] hover:text-white truncate inline-flex items-center gap-1"
                  >
                    {link.url.length > 80 ? link.url.slice(0, 80) + '...' : link.url}
                    <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />
                  </a>
                </div>
                <div className="t-caption text-[var(--brand-text-muted)] mt-0.5">
                  Found on <span className="text-[var(--brand-text)]">{link.foundOn}</span>
                  <span> (/{link.foundOnSlug})</span>
                  {link.anchorText && <span> &middot; &ldquo;{link.anchorText.slice(0, 50)}&rdquo;</span>}
                </div>
                <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{link.statusText}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn('t-caption-sm px-1.5 py-0.5 rounded border', link.type === 'internal' ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-[var(--surface-2)] border-[var(--brand-border)] text-[var(--brand-text)]')}>
                  {link.type}
                </span>
                <span className={cn('t-caption font-mono font-bold', tab === 'dead' ? 'text-red-400' : 'text-amber-400')}>
                  {link.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="t-caption-sm text-[var(--brand-text-muted)] text-center">
        Last checked: {new Date(data.checkedAt).toLocaleString()}{data.crawledDomain && ` · ${data.crawledDomain.replace('https://', '')}`}
      </div>
    </div>
  );
}
