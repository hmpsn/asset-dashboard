import { useState } from 'react';
import {
  Loader2, ArrowRight, AlertTriangle, AlertCircle, CheckCircle,
  RefreshCw, ChevronDown, ChevronRight, ExternalLink, Search as SearchIcon,
  CornerDownRight, Ban, Link2,
} from 'lucide-react';

interface RedirectHop {
  url: string;
  status: number;
}

interface RedirectChain {
  originalUrl: string;
  hops: RedirectHop[];
  finalUrl: string;
  totalHops: number;
  isLoop: boolean;
  foundOn: string[];
  type: 'internal' | 'external';
}

interface PageStatus {
  url: string;
  path: string;
  title: string;
  status: number | 'error';
  statusText: string;
  redirectsTo?: string;
  source: 'static' | 'cms';
}

interface RedirectScanResult {
  chains: RedirectChain[];
  pageStatuses: PageStatus[];
  summary: {
    totalPages: number;
    healthy: number;
    redirecting: number;
    notFound: number;
    errors: number;
    chainsDetected: number;
    longestChain: number;
  };
  scannedAt: string;
}

interface Props {
  siteId: string;
}

type ViewFilter = 'all' | 'redirects' | 'chains' | '404s' | 'errors';

export function RedirectManager({ siteId }: Props) {
  const [data, setData] = useState<RedirectScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ViewFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedChains, setExpandedChains] = useState<Set<number>>(new Set());

  const runScan = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/webflow/redirect-scan/${siteId}`);
      const result = await res.json();
      if (result.error) {
        setError(result.error);
      } else {
        setData(result);
      }
    } catch {
      setError('Failed to scan redirects');
    } finally {
      setLoading(false);
    }
  };

  const toggleChain = (idx: number) => {
    setExpandedChains(prev => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx); else n.add(idx);
      return n;
    });
  };

  const statusBadge = (status: number | 'error') => {
    if (status === 'error') return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-500/15 text-red-400">ERR</span>;
    if (status >= 200 && status < 300) return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-400">{status}</span>;
    if (status >= 300 && status < 400) return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-400">{status}</span>;
    if (status >= 400) return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-500/15 text-red-400">{status}</span>;
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-500/15 text-zinc-400">{status}</span>;
  };

  const filteredPages = data?.pageStatuses.filter(p => {
    const matchesSearch = !search || p.path.toLowerCase().includes(search.toLowerCase()) || p.title.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (filter === 'redirects') return typeof p.status === 'number' && p.status >= 300 && p.status < 400;
    if (filter === '404s') return typeof p.status === 'number' && p.status >= 400 && p.status < 500;
    if (filter === 'errors') return p.status === 'error' || (typeof p.status === 'number' && p.status >= 500);
    if (filter === 'chains') return false; // chains view is separate
    return true;
  }) || [];

  if (!data && !loading) {
    return (
      <div className="space-y-4">
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-6 py-12 text-center">
          <CornerDownRight className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-sm text-zinc-400 mb-1">Redirect Scanner</p>
          <p className="text-[11px] text-zinc-600 max-w-md mx-auto mb-4">
            Scan your site for redirect chains, 404 pages, and routing issues.
            Detects multi-hop redirects, loops, and pages that need attention.
          </p>
          <button
            onClick={runScan}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium mx-auto transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Scan Redirects
          </button>
          {error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
        <span className="ml-3 text-sm text-zinc-400">Scanning redirects... this may take a minute</span>
      </div>
    );
  }

  if (!data) return null;

  const { summary } = data;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Redirect Manager</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Scanned {new Date(data.scannedAt).toLocaleString()} · {summary.totalPages} pages checked
          </p>
        </div>
        <button
          onClick={runScan}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
        >
          <RefreshCw className="w-3 h-3" /> Rescan
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Healthy</span>
          </div>
          <p className="text-xl font-bold text-emerald-400">{summary.healthy}</p>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Redirecting</span>
          </div>
          <p className="text-xl font-bold text-amber-400">{summary.redirecting}</p>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Ban className="w-3.5 h-3.5 text-red-400" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">404s</span>
          </div>
          <p className="text-xl font-bold text-red-400">{summary.notFound}</p>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Link2 className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Chains</span>
          </div>
          <p className="text-xl font-bold text-violet-400">{summary.chainsDetected}</p>
          {summary.longestChain > 1 && (
            <p className="text-[10px] text-zinc-600">longest: {summary.longestChain} hops</p>
          )}
        </div>
      </div>

      {/* Redirect Chains */}
      {data.chains.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h4 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Redirect Chains
            </h4>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              Multi-hop redirects slow down page load and waste crawl budget. Aim for single-hop redirects.
            </p>
          </div>
          {data.chains.map((chain, idx) => {
            const isExpanded = expandedChains.has(idx);
            return (
              <div key={idx} className="border-b border-zinc-800/50 last:border-b-0">
                <button
                  onClick={() => toggleChain(idx)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/20 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />}
                    <span className="text-xs text-zinc-300 truncate font-mono">{new URL(chain.originalUrl).pathname}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      {chain.totalHops} hop{chain.totalHops !== 1 ? 's' : ''}
                    </span>
                    {chain.isLoop && (
                      <span className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">loop</span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${chain.type === 'internal' ? 'bg-violet-500/10 text-violet-400' : 'bg-zinc-700 text-zinc-400'}`}>
                      {chain.type}
                    </span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-3 pl-10">
                    <div className="space-y-1">
                      {chain.hops.map((hop, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          {statusBadge(hop.status)}
                          <span className="text-zinc-400 font-mono truncate">{hop.url}</span>
                          {i < chain.hops.length - 1 && <ArrowRight className="w-3 h-3 text-zinc-600 flex-shrink-0" />}
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-zinc-500">
                      <span>Final destination:</span>
                      <a href={chain.finalUrl} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline flex items-center gap-0.5 truncate">
                        {chain.finalUrl} <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Filter tabs + search */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          {([
            { id: 'all', label: 'All Pages' },
            { id: 'redirects', label: 'Redirects' },
            { id: '404s', label: '404s' },
            { id: 'errors', label: 'Errors' },
          ] as Array<{ id: ViewFilter; label: string }>).map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
              style={filter === f.id ? {
                backgroundColor: 'var(--brand-mint-dim)',
                color: 'var(--brand-mint)',
              } : {
                color: 'var(--brand-text-muted)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1 relative">
          <SearchIcon className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter pages..."
            className="w-full pl-7 pr-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-violet-500"
          />
        </div>
      </div>

      {/* Page status table */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_80px_1fr] gap-0 text-[10px] text-zinc-500 uppercase tracking-wider font-medium px-4 py-2 border-b border-zinc-800">
          <span className="pr-3">Status</span>
          <span>Path</span>
          <span>Source</span>
          <span>Redirects To</span>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {filteredPages.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-600">
              {filter !== 'all' ? 'No pages match this filter' : 'No pages found'}
            </div>
          ) : (
            filteredPages.map((page, idx) => (
              <div key={idx} className="grid grid-cols-[auto_1fr_80px_1fr] gap-0 px-4 py-2 border-b border-zinc-800/30 items-center hover:bg-zinc-800/10">
                {statusBadge(page.status)}
                <div className="min-w-0 pl-3">
                  <span className="text-xs text-zinc-300 font-mono truncate block">{page.path}</span>
                  <span className="text-[10px] text-zinc-600 truncate block">{page.title}</span>
                </div>
                <span className={`text-[10px] ${page.source === 'cms' ? 'text-violet-400' : 'text-zinc-500'}`}>
                  {page.source}
                </span>
                <div className="min-w-0">
                  {page.redirectsTo ? (
                    <a href={page.redirectsTo} target="_blank" rel="noopener noreferrer" className="text-[11px] text-amber-400 hover:underline truncate block flex items-center gap-0.5">
                      {(() => { try { return new URL(page.redirectsTo).pathname; } catch { return page.redirectsTo; } })()}
                      <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                    </a>
                  ) : (
                    <span className="text-[10px] text-zinc-700">—</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Tips */}
      {(summary.chainsDetected > 0 || summary.notFound > 0) && (
        <div className="bg-zinc-800/30 rounded-lg border border-zinc-800 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-[11px] text-zinc-500 space-y-1">
              {summary.chainsDetected > 0 && (
                <p><strong className="text-zinc-400">Redirect chains:</strong> Update links to point directly to the final destination. Each extra hop adds ~50-100ms of latency and wastes crawl budget.</p>
              )}
              {summary.notFound > 0 && (
                <p><strong className="text-zinc-400">404 pages:</strong> Set up 301 redirects in Webflow (Settings → Hosting → 301 Redirects) to preserve link equity and fix broken bookmarks.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
