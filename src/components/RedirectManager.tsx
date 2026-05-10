import { useState, useEffect } from 'react';
import {
  Loader2, ArrowRight, AlertTriangle, AlertCircle, CheckCircle,
  RefreshCw, ChevronDown, ChevronRight, ExternalLink, Search as SearchIcon,
  CornerDownRight, Ban, Link2, Download, Copy, Check, Sparkles, Edit3, X,
  Send,
} from 'lucide-react';
import { PageHeader, StatCard, Icon, SectionCard, cn } from './ui';
import { redirects } from '../api/misc';
import { clientActions } from '../api/clientActions';
import { themeColor } from './ui/constants';

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
  workspaceId?: string;
}

type ViewFilter = 'all' | 'redirects' | 'chains' | '404s' | 'errors';

export function RedirectManager({ siteId, workspaceId }: Props) {
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
  const [sendingToClient, setSendingToClient] = useState(false);
  const [sentToClient, setSentToClient] = useState(false);

  // Load saved redirect snapshot on mount
  useEffect(() => {
    (async () => {
      try {
        const snapshot = await redirects.snapshot(siteId, workspaceId) as { result?: RedirectScanResult; createdAt?: string } | null;
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
  }, [siteId, workspaceId]);

  const runScan = async () => {
    setLoading(true);
    setError(null);
    setRules([]);
    try {
      const result = await redirects.scan(siteId, workspaceId) as RedirectScanResult & { error?: string };
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

  const sendAcceptedRulesToClient = async () => {
    if (!workspaceId || acceptedRules.length === 0) return;
    setSendingToClient(true);
    setError(null);
    try {
      await clientActions.create(workspaceId, {
        sourceType: 'redirect_proposal',
        sourceId: `redirects:${snapshotDate || data?.scannedAt || new Date().toISOString()}`,
        title: `Redirect recommendations (${acceptedRules.length})`,
        summary: `Review ${acceptedRules.length} redirect proposal${acceptedRules.length !== 1 ? 's' : ''}. These are manual or agency-executed for v1 and are not written directly to Webflow by the client.`,
        priority: acceptedRules.length > 3 ? 'high' : 'medium',
        payload: {
          scannedAt: snapshotDate || data?.scannedAt,
          redirects: acceptedRules.map(r => ({
            source: r.from,
            target: r.to,
            rationale: r.reason,
          })),
          summary: data?.summary,
        },
      });
      setSentToClient(true);
    } catch (err) {
      console.error('RedirectManager operation failed:', err);
      setError('Failed to send redirect proposals to client');
    } finally {
      setSendingToClient(false);
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
    if (status === 'error') return <span className="px-1.5 py-0.5 rounded t-caption font-mono bg-red-500/15 text-red-400">ERR</span>;
    if (status >= 200 && status < 300) return <span className="px-1.5 py-0.5 rounded t-caption font-mono bg-emerald-500/15 text-emerald-400">{status}</span>;
    if (status >= 300 && status < 400) return <span className="px-1.5 py-0.5 rounded t-caption font-mono bg-amber-500/15 text-amber-400">{status}</span>;
    if (status >= 400) return <span className="px-1.5 py-0.5 rounded t-caption font-mono bg-red-500/15 text-red-400">{status}</span>;
    return <span className="px-1.5 py-0.5 rounded t-caption font-mono bg-[var(--surface-2)] text-[var(--brand-text)]">{status}</span>;
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
      <div className="space-y-8">
        <SectionCard noPadding className="px-6 py-12 text-center">
          <Icon as={CornerDownRight} size="2xl" className="text-[var(--brand-text-muted)] mx-auto mb-3" />
          <p className="t-body text-[var(--brand-text)] mb-1">Redirect Scanner</p>
          <p className="t-caption-sm text-[var(--brand-text-muted)] max-w-md mx-auto mb-4">
            Scan your site for redirect chains, 404 pages, and routing issues.
            Detects multi-hop redirects, loops, and pages that need attention.
          </p>
          <button
            onClick={runScan}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white t-caption font-medium mx-auto transition-colors"
          >
            <Icon as={RefreshCw} size="md" /> Scan Redirects
          </button>
          {error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 t-caption text-red-400">
              {error}
            </div>
          )}
        </SectionCard>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        <span className="ml-3 t-body text-[var(--brand-text)]">Scanning redirects... this may take a minute</span>
      </div>
    );
  }

  if (!data) return null;

  const { summary } = data;

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        title="Redirect Manager"
        subtitle={`Scanned ${new Date(snapshotDate || data.scannedAt).toLocaleString()} · ${summary.totalPages} pages checked`}
        actions={
          <button onClick={runScan} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--brand-text-bright)] t-caption font-medium transition-colors">
            <Icon as={RefreshCw} size="sm" /> Rescan
          </button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Healthy" value={summary.healthy} icon={CheckCircle} iconColor="#34d399" valueColor="text-emerald-400" size="hero" staggerIndex={0} />
        <StatCard label="Redirecting" value={summary.redirecting} icon={ArrowRight} iconColor="#fbbf24" valueColor="text-amber-400" size="hero" staggerIndex={1} />
        <StatCard label="404s" value={summary.notFound} icon={Ban} iconColor="#f87171" valueColor="text-red-400" size="hero" staggerIndex={2} />
        <StatCard label="Chains" value={summary.chainsDetected} icon={Link2} iconColor="#2dd4bf" valueColor="text-teal-400" sub={summary.longestChain > 1 ? `longest: ${summary.longestChain} hops` : undefined} size="hero" staggerIndex={3} />
      </div>

      {/* Redirect Chains */}
      {data.chains.length > 0 && (
        <SectionCard noPadding>
          <div className="px-4 py-3 border-b border-[var(--brand-border)]">
            <h4 className="t-caption font-semibold text-[var(--brand-text-bright)] flex items-center gap-1.5">
              <Icon as={AlertTriangle} size="md" className="text-amber-400" /> Redirect Chains
            </h4>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
              Multi-hop redirects slow down page load and waste crawl budget. Aim for single-hop redirects.
            </p>
          </div>
          {data.chains.map((chain, idx) => {
            const isExpanded = expandedChains.has(idx);
            return (
              <div key={idx} className="border-b border-[var(--brand-border)]/50 last:border-b-0">
                <button
                  onClick={() => toggleChain(idx)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[var(--surface-2)]/20 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isExpanded
                      ? <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                      : <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />}
                    <span className="t-caption text-[var(--brand-text-bright)] truncate font-mono">{new URL(chain.originalUrl).pathname}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="t-caption-sm text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      {chain.totalHops} hop{chain.totalHops !== 1 ? 's' : ''}
                    </span>
                    {chain.isLoop && (
                      <span className="t-caption-sm text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">loop</span>
                    )}
                    <span className={cn('t-caption-sm px-1.5 py-0.5 rounded', chain.type === 'internal' ? 'bg-teal-500/10 text-teal-400' : 'bg-[var(--surface-2)] text-[var(--brand-text)]')}>
                      {chain.type}
                    </span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-3 pl-10">
                    <div className="space-y-1">
                      {chain.hops.map((hop, i) => (
                        <div key={i} className="flex items-center gap-2 t-caption-sm">
                          {statusBadge(hop.status)}
                          <span className="text-[var(--brand-text)] font-mono truncate">{hop.url}</span>
                          {i < chain.hops.length - 1 && <Icon as={ArrowRight} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />}
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)]">
                      <span>Final destination:</span>
                      <a href={chain.finalUrl} target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline flex items-center gap-0.5 truncate">
                        {chain.finalUrl} <Icon as={ExternalLink} size="sm" className="flex-shrink-0" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </SectionCard>
      )}

      {/* Redirect Recommendations */}
      {rules.length > 0 && (
        <SectionCard noPadding>
          <div className="px-4 py-3 border-b border-[var(--brand-border)] flex items-center justify-between">
            <div>
              <h4 className="t-caption font-semibold text-[var(--brand-text-bright)] flex items-center gap-1.5">
                <Icon as={Sparkles} size="md" className="text-teal-400" /> Redirect Recommendations
              </h4>
              <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
                {rules.filter(r => !r.accepted).length > 0
                  ? `Review ${rules.filter(r => !r.accepted).length} suggested redirect target${rules.filter(r => !r.accepted).length !== 1 ? 's' : ''}. Accept, edit, or dismiss.`
                  : `${acceptedRules.length} redirect rule${acceptedRules.length !== 1 ? 's' : ''} ready to export.`}
              </p>
            </div>
            {acceptedRules.length > 0 && (
              <div className="flex items-center gap-2">
                {workspaceId && (
                  <button onClick={sendAcceptedRulesToClient} disabled={sendingToClient || sentToClient} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-600/15 border border-teal-500/20 hover:bg-teal-600/25 text-teal-300 t-caption-sm font-medium transition-colors disabled:opacity-60">
                    <Icon as={sentToClient ? Check : Send} size="sm" className={sentToClient ? 'text-emerald-400' : undefined} />
                    {sendingToClient ? 'Sending...' : sentToClient ? 'Sent' : 'Send to Client'}
                  </button>
                )}
                <button onClick={copyRulesToClipboard} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--brand-text)] t-caption-sm font-medium transition-colors">
                  {copiedRules ? <Icon as={Check} size="sm" className="text-emerald-400" /> : <Icon as={Copy} size="sm" />}
                  {copiedRules ? 'Copied!' : 'Copy All'}
                </button>
                <button onClick={exportCSV} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white t-caption-sm font-medium transition-colors">
                  <Icon as={Download} size="sm" /> Export CSV
                </button>
              </div>
            )}
          </div>
          <div className="divide-y divide-[var(--brand-border)]/50 max-h-[300px] overflow-y-auto">
            {rules.map(rule => (
              <div key={rule.from} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="t-caption text-[var(--brand-text-bright)] font-mono">{rule.from}</span>
                  <Icon as={ArrowRight} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                  {editingRule === rule.from ? (
                    <div className="flex items-center gap-1.5 flex-1">
                      <input
                        type="text"
                        value={editDraft}
                        onChange={e => setEditDraft(e.target.value)}
                        className="flex-1 px-2 py-1 bg-[var(--surface-2)] border border-teal-500/50 rounded t-caption text-[var(--brand-text-bright)] font-mono focus:outline-none focus:border-teal-400"
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') updateRuleTo(rule.from, editDraft); if (e.key === 'Escape') { setEditingRule(null); setEditDraft(''); } }}
                      />
                      <button onClick={() => updateRuleTo(rule.from, editDraft)} className="px-2 py-1 bg-teal-600 hover:bg-teal-500 rounded t-caption-sm font-medium text-white transition-colors">Save</button>
                      <button onClick={() => { setEditingRule(null); setEditDraft(''); }} className="px-2 py-1 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded t-caption-sm text-[var(--brand-text)] transition-colors">Cancel</button>
                    </div>
                  ) : (
                    <span className={cn('t-caption font-mono', rule.accepted ? 'text-emerald-400' : 'text-teal-400')}>{rule.to}</span>
                  )}
                  {rule.accepted && !editingRule && (
                    <Icon as={Check} size="sm" className="text-emerald-400 flex-shrink-0" />
                  )}
                </div>
                <div className="t-caption-sm text-[var(--brand-text-muted)] mb-2">{rule.reason}</div>
                {!rule.accepted && editingRule !== rule.from && (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => acceptRule(rule.from)} className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600/80 hover:bg-emerald-500 rounded t-caption-sm font-medium text-white transition-colors">
                      <Icon as={Check} size="sm" /> Accept
                    </button>
                    <button onClick={() => { setEditingRule(rule.from); setEditDraft(rule.to); }} className="flex items-center gap-1 px-2.5 py-1 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption-sm font-medium text-[var(--brand-text-bright)] transition-colors">
                      <Icon as={Edit3} size="sm" /> Edit Target
                    </button>
                    <button onClick={() => rejectRule(rule.from)} className="flex items-center gap-1 px-2.5 py-1 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--brand-border)] rounded t-caption-sm font-medium text-red-400 transition-colors">
                      <Icon as={X} size="sm" /> Dismiss
                    </button>
                  </div>
                )}
                {rule.accepted && editingRule !== rule.from && (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => { setEditingRule(rule.from); setEditDraft(rule.to); }} className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors">
                      Change target
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
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
              className="px-2.5 py-1 rounded t-caption-sm font-medium transition-colors"
              style={filter === f.id ? {
                backgroundColor: 'rgba(45,212,191,0.1)',
                color: '#2dd4bf',
              } : {
                color: themeColor('#71717a', '#94a3b8'),
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1 relative">
          <SearchIcon className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter pages..."
            className="w-full pl-7 pr-3 py-1.5 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-lg t-caption text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500"
          />
        </div>
      </div>

      {/* Page status table */}
      <SectionCard noPadding>
        <div className="grid grid-cols-[auto_1fr_80px_1fr] gap-0 t-caption-sm text-[var(--brand-text-muted)] uppercase tracking-wider font-medium px-4 py-2 border-b border-[var(--brand-border)]">
          <span className="pr-3">Status</span>
          <span>Path</span>
          <span>Source</span>
          <span>Redirects To</span>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {filteredPages.length === 0 ? (
            <div className="px-4 py-8 text-center t-caption text-[var(--brand-text-muted)]">
              {filter !== 'all' ? 'No pages match this filter' : 'No pages found'}
            </div>
          ) : (
            filteredPages.map((page, idx) => {
              const rule = rules.find(r => r.from === page.path);
              return (
                <div key={idx} className="border-b border-[var(--brand-border)]/30 hover:bg-[var(--surface-2)]/10">
                  <div className="grid grid-cols-[auto_1fr_80px_1fr] gap-0 px-4 py-2 items-center">
                    {statusBadge(page.status)}
                    <div className="min-w-0 pl-3">
                      <span className="t-caption text-[var(--brand-text-bright)] font-mono truncate block">{page.path}</span>
                      <span className="t-caption-sm text-[var(--brand-text-muted)] truncate block">{page.title}</span>
                    </div>
                    <span className={cn('t-caption-sm', page.source === 'gsc' ? 'text-amber-400' : page.source === 'cms' ? 'text-teal-400' : 'text-[var(--brand-text-muted)]')}>
                      {page.source === 'gsc' ? 'GSC' : page.source}
                    </span>
                    <div className="min-w-0">
                      {page.redirectsTo ? (
                        <a href={page.redirectsTo} target="_blank" rel="noopener noreferrer" className="t-caption-sm text-amber-400 hover:underline truncate block flex items-center gap-0.5">
                          {(() => { try { return new URL(page.redirectsTo).pathname; } catch { return page.redirectsTo; } })()}
                          <Icon as={ExternalLink} size="sm" className="flex-shrink-0" />
                        </a>
                      ) : (
                        <span className="t-caption-sm text-[var(--brand-text-muted)]/30">—</span>
                      )}
                    </div>
                  </div>
                  {rule && (
                    <div className="px-4 pb-2 pl-[calc(auto+0.75rem)] ml-10">
                      <div className="flex items-center gap-1.5 t-caption-sm">
                        <Icon as={Sparkles} size="sm" className="text-teal-400 flex-shrink-0" />
                        <span className="text-teal-400">Suggested redirect:</span>
                        <span className="text-[var(--brand-text-bright)] font-mono">{rule.to}</span>
                        {rule.accepted && <Icon as={Check} size="sm" className="text-emerald-400" />}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </SectionCard>

      {/* Tips */}
      {(summary.chainsDetected > 0 || summary.notFound > 0) && (
        <SectionCard noPadding variant="subtle" className="px-4 py-3">
          <div className="flex items-start gap-2">
            <Icon as={AlertCircle} size="md" className="text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="t-caption-sm text-[var(--brand-text-muted)] space-y-1">
              {summary.chainsDetected > 0 && (
                <p><strong className="text-[var(--brand-text)]">Redirect chains:</strong> Update links to point directly to the final destination. Each extra hop adds ~50-100ms of latency and wastes crawl budget.</p>
              )}
              {summary.notFound > 0 && (
                <p><strong className="text-[var(--brand-text)]">404 pages:</strong> Set up 301 redirects in Webflow (Settings → Hosting → 301 Redirects) to preserve link equity and fix broken bookmarks.</p>
              )}
              {acceptedRules.length > 0 && (
                <p><strong className="text-[var(--brand-text)]">Ready to apply:</strong> You have {acceptedRules.length} accepted redirect rule{acceptedRules.length !== 1 ? 's' : ''}. Export as CSV and import in Webflow Settings → Hosting → 301 Redirects.</p>
              )}
              <p><strong className="text-teal-400">Tip:</strong> Run a <strong className="text-teal-400">Site Audit</strong> to find pages linking to these broken URLs, or check <strong className="text-teal-400">Dead Links</strong> for a comprehensive link scan.</p>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
