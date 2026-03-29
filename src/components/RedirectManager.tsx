import { useState, useEffect } from 'react';
import {
  Loader2, ArrowRight, AlertTriangle, AlertCircle, CheckCircle,
  RefreshCw, ChevronDown, ChevronRight, ExternalLink, Search as SearchIcon,
  CornerDownRight, Ban, Link2, Download, Copy, Check, Sparkles, Edit3, X,
} from 'lucide-react';
import { PageHeader, StatCard } from './ui';
import { redirects } from '../api/misc';

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
  recommendedTarget?: string;
  recommendedReason?: string;
  source: 'static' | 'cms' | 'gsc';
}

interface RedirectRule {
  from: string;
  to: string;
  reason: string;
  accepted: boolean;
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
  const [rules, setRules] = useState<RedirectRule[]>([]);
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [copiedRules, setCopiedRules] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);

  // Load saved redirect snapshot on mount
  useEffect(() => {
    (async () => {
      try {
        const snapshot = await redirects.snapshot(siteId) as { result?: RedirectScanResult; createdAt?: string } | null;
        if (snapshot?.result) {
          setData(snapshot.result);
          setSnapshotDate(snapshot.createdAt ?? null);
          // Build rules from recommendations
          const newRules: RedirectRule[] = [];
          for (const ps of snapshot.result.pageStatuses) {
            if (ps.recommendedTarget) {
              newRules.push({
                from: ps.path,
                to: ps.recommendedTarget,
                reason: ps.recommendedReason || '',
                accepted: false,
              });
            }
          }
          setRules(newRules);
        }
      } catch (err) { console.error('RedirectManager operation failed:', err); }
    })();
  }, [siteId]);

  const runScan = async () => {
    setLoading(true);
    setError(null);
    setRules([]);
    try {
      const result = await redirects.scan(siteId) as RedirectScanResult & { error?: string };
      if (result.error) {
        setError(result.error);
      } else {
        setData(result);
        // Build initial redirect rules from recommendations
        const newRules: RedirectRule[] = [];
        for (const ps of result.pageStatuses) {
          if (ps.recommendedTarget) {
            newRules.push({
              from: ps.path,
              to: ps.recommendedTarget,
              reason: ps.recommendedReason || '',
              accepted: false,
            });
          }
        }
        setRules(newRules);
      }
    } catch (err) {
      console.error('RedirectManager operation failed:', err);
      setError('Failed to scan redirects');
    } finally {
      setLoading(false);
    }
  };

  const acceptRule = (from: string) => setRules(prev => prev.map(r => r.from === from ? { ...r, accepted: true } : r));
  const rejectRule = (from: string) => setRules(prev => prev.filter(r => r.from !== from));
  const updateRuleTo = (from: string, newTo: string) => {
    setRules(prev => prev.map(r => r.from === from ? { ...r, to: newTo, accepted: true } : r));
    setEditingRule(null);
    setEditDraft('');
  };

  const acceptedRules = rules.filter(r => r.accepted);

  const exportCSV = () => {
    const rows = acceptedRules.map(r => `${r.from},${r.to}`);
    const csv = 'Old Path,Redirect To\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'webflow-redirects.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyRulesToClipboard = () => {
    const text = acceptedRules.map(r => `${r.from} → ${r.to}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedRules(true);
    setTimeout(() => setCopiedRules(false), 2000);
  };

  const toggleChain = (idx: number) => {
    setExpandedChains(prev => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx); else n.add(idx);
      return n;
    });
  };

  const statusBadge = (status: number | 'error') => {
    if (status === 'error') return <span className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-red-500/15 text-red-400">ERR</span>;
    if (status >= 200 && status < 300) return <span className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-emerald-500/15 text-emerald-400">{status}</span>;
    if (status >= 300 && status < 400) return <span className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-amber-500/15 text-amber-400">{status}</span>;
    if (status >= 400) return <span className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-red-500/15 text-red-400">{status}</span>;
    return <span className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-zinc-500/15 text-zinc-400">{status}</span>;
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
          <CornerDownRight className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
          <p className="text-sm text-zinc-400 mb-1">Redirect Scanner</p>
          <p className="text-[11px] text-zinc-500 max-w-md mx-auto mb-4">
            Scan your site for redirect chains, 404 pages, and routing issues.
            Detects multi-hop redirects, loops, and pages that need attention.
          </p>
          <button
            onClick={runScan}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium mx-auto transition-colors"
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
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        <span className="ml-3 text-sm text-zinc-400">Scanning redirects... this may take a minute</span>
      </div>
    );
  }

  if (!data) return null;

  const { summary } = data;

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        title="Redirect Manager"
        subtitle={`Scanned ${new Date(snapshotDate || data.scannedAt).toLocaleString()} · ${summary.totalPages} pages checked`}
        actions={
          <button onClick={runScan} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors">
            <RefreshCw className="w-3 h-3" /> Rescan
          </button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Healthy" value={summary.healthy} icon={CheckCircle} iconColor="#34d399" valueColor="text-emerald-400" size="hero" />
        <StatCard label="Redirecting" value={summary.redirecting} icon={ArrowRight} iconColor="#fbbf24" valueColor="text-amber-400" size="hero" />
        <StatCard label="404s" value={summary.notFound} icon={Ban} iconColor="#f87171" valueColor="text-red-400" size="hero" />
        <StatCard label="Chains" value={summary.chainsDetected} icon={Link2} iconColor="#2dd4bf" valueColor="text-teal-400" sub={summary.longestChain > 1 ? `longest: ${summary.longestChain} hops` : undefined} size="hero" />
      </div>

      {/* Redirect Chains */}
      {data.chains.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h4 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Redirect Chains
            </h4>
            <p className="text-[11px] text-zinc-500 mt-0.5">
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
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />}
                    <span className="text-xs text-zinc-300 truncate font-mono">{new URL(chain.originalUrl).pathname}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[11px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      {chain.totalHops} hop{chain.totalHops !== 1 ? 's' : ''}
                    </span>
                    {chain.isLoop && (
                      <span className="text-[11px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">loop</span>
                    )}
                    <span className={`text-[11px] px-1.5 py-0.5 rounded ${chain.type === 'internal' ? 'bg-teal-500/10 text-teal-400' : 'bg-zinc-700 text-zinc-400'}`}>
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
                          {i < chain.hops.length - 1 && <ArrowRight className="w-3 h-3 text-zinc-500 flex-shrink-0" />}
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <span>Final destination:</span>
                      <a href={chain.finalUrl} target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline flex items-center gap-0.5 truncate">
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

      {/* Redirect Recommendations */}
      {rules.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-teal-400" /> Redirect Recommendations
              </h4>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                {rules.filter(r => !r.accepted).length > 0
                  ? `Review ${rules.filter(r => !r.accepted).length} suggested redirect target${rules.filter(r => !r.accepted).length !== 1 ? 's' : ''}. Accept, edit, or dismiss.`
                  : `${acceptedRules.length} redirect rule${acceptedRules.length !== 1 ? 's' : ''} ready to export.`}
              </p>
            </div>
            {acceptedRules.length > 0 && (
              <div className="flex items-center gap-2">
                <button onClick={copyRulesToClipboard} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-[11px] font-medium transition-colors">
                  {copiedRules ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copiedRules ? 'Copied!' : 'Copy All'}
                </button>
                <button onClick={exportCSV} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-medium transition-colors">
                  <Download className="w-3 h-3" /> Export CSV
                </button>
              </div>
            )}
          </div>
          <div className="divide-y divide-zinc-800/50 max-h-[300px] overflow-y-auto">
            {rules.map(rule => (
              <div key={rule.from} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-zinc-300 font-mono">{rule.from}</span>
                  <ArrowRight className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                  {editingRule === rule.from ? (
                    <div className="flex items-center gap-1.5 flex-1">
                      <input
                        type="text"
                        value={editDraft}
                        onChange={e => setEditDraft(e.target.value)}
                        className="flex-1 px-2 py-1 bg-zinc-800 border border-teal-500/50 rounded text-xs text-zinc-200 font-mono focus:outline-none focus:border-teal-400"
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') updateRuleTo(rule.from, editDraft); if (e.key === 'Escape') { setEditingRule(null); setEditDraft(''); } }}
                      />
                      <button onClick={() => updateRuleTo(rule.from, editDraft)} className="px-2 py-1 bg-teal-600 hover:bg-teal-500 rounded text-[11px] font-medium text-white transition-colors">Save</button>
                      <button onClick={() => { setEditingRule(null); setEditDraft(''); }} className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] text-zinc-400 transition-colors">Cancel</button>
                    </div>
                  ) : (
                    <span className={`text-xs font-mono ${rule.accepted ? 'text-green-400' : 'text-teal-400'}`}>{rule.to}</span>
                  )}
                  {rule.accepted && !editingRule && (
                    <Check className="w-3 h-3 text-green-400 flex-shrink-0" />
                  )}
                </div>
                <div className="text-[11px] text-zinc-500 mb-2">{rule.reason}</div>
                {!rule.accepted && editingRule !== rule.from && (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => acceptRule(rule.from)} className="flex items-center gap-1 px-2.5 py-1 bg-green-600/80 hover:bg-green-500 rounded text-[11px] font-medium text-white transition-colors">
                      <Check className="w-3 h-3" /> Accept
                    </button>
                    <button onClick={() => { setEditingRule(rule.from); setEditDraft(rule.to); }} className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-[11px] font-medium text-zinc-300 transition-colors">
                      <Edit3 className="w-3 h-3" /> Edit Target
                    </button>
                    <button onClick={() => rejectRule(rule.from)} className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-[11px] font-medium text-red-400 transition-colors">
                      <X className="w-3 h-3" /> Dismiss
                    </button>
                  </div>
                )}
                {rule.accepted && editingRule !== rule.from && (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => { setEditingRule(rule.from); setEditDraft(rule.to); }} className="text-[11px] text-zinc-500 hover:text-zinc-400 transition-colors">
                      Change target
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
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
                backgroundColor: 'rgba(45,212,191,0.1)',
                color: '#2dd4bf',
              } : {
                color: '#71717a',
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
            className="w-full pl-7 pr-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
          />
        </div>
      </div>

      {/* Page status table */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_80px_1fr] gap-0 text-[11px] text-zinc-500 uppercase tracking-wider font-medium px-4 py-2 border-b border-zinc-800">
          <span className="pr-3">Status</span>
          <span>Path</span>
          <span>Source</span>
          <span>Redirects To</span>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {filteredPages.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-500">
              {filter !== 'all' ? 'No pages match this filter' : 'No pages found'}
            </div>
          ) : (
            filteredPages.map((page, idx) => {
              const rule = rules.find(r => r.from === page.path);
              return (
                <div key={idx} className="border-b border-zinc-800/30 hover:bg-zinc-800/10">
                  <div className="grid grid-cols-[auto_1fr_80px_1fr] gap-0 px-4 py-2 items-center">
                    {statusBadge(page.status)}
                    <div className="min-w-0 pl-3">
                      <span className="text-xs text-zinc-300 font-mono truncate block">{page.path}</span>
                      <span className="text-[11px] text-zinc-500 truncate block">{page.title}</span>
                    </div>
                    <span className={`text-[11px] ${page.source === 'gsc' ? 'text-amber-400' : page.source === 'cms' ? 'text-teal-400' : 'text-zinc-500'}`}>
                      {page.source === 'gsc' ? 'GSC' : page.source}
                    </span>
                    <div className="min-w-0">
                      {page.redirectsTo ? (
                        <a href={page.redirectsTo} target="_blank" rel="noopener noreferrer" className="text-[11px] text-amber-400 hover:underline truncate block flex items-center gap-0.5">
                          {(() => { try { return new URL(page.redirectsTo).pathname; } catch { return page.redirectsTo; } })()}
                          <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                        </a>
                      ) : (
                        <span className="text-[11px] text-zinc-700">—</span>
                      )}
                    </div>
                  </div>
                  {rule && (
                    <div className="px-4 pb-2 pl-[calc(auto+0.75rem)] ml-10">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <Sparkles className="w-3 h-3 text-teal-400 flex-shrink-0" />
                        <span className="text-teal-400">Suggested redirect:</span>
                        <span className="text-zinc-300 font-mono">{rule.to}</span>
                        {rule.accepted && <Check className="w-3 h-3 text-green-400" />}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
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
              {acceptedRules.length > 0 && (
                <p><strong className="text-zinc-400">Ready to apply:</strong> You have {acceptedRules.length} accepted redirect rule{acceptedRules.length !== 1 ? 's' : ''}. Export as CSV and import in Webflow Settings → Hosting → 301 Redirects.</p>
              )}
              <p><strong className="text-teal-400">Tip:</strong> Run a <strong className="text-teal-400">Site Audit</strong> to find pages linking to these broken URLs, or check <strong className="text-teal-400">Dead Links</strong> for a comprehensive link scan.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
