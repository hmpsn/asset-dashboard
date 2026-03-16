import { useState, useEffect } from 'react';
import {
  Loader2, ArrowRight, RefreshCw, ExternalLink, Search as SearchIcon,
  Link, AlertCircle, ChevronDown, ChevronRight, ArrowUpRight,
  AlertTriangle, Copy, Check, LayoutList, List,
} from 'lucide-react';
import { PageHeader, StatCard } from './ui';
import { webflow } from '../api/seo';

interface LinkSuggestion {
  fromPage: string;
  fromTitle: string;
  toPage: string;
  toTitle: string;
  anchorText: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

interface PageLinkHealth {
  path: string;
  title: string;
  outboundLinks: number;
  inboundLinks: number;
  score: number;
  isOrphan: boolean;
}

interface InternalLinkResult {
  suggestions: LinkSuggestion[];
  pageCount: number;
  attemptedPageCount?: number;
  existingLinkCount: number;
  analyzedAt: string;
  pageHealth?: PageLinkHealth[];
  orphanCount?: number;
}

interface Props {
  siteId: string;
  workspaceId?: string;
}

type PriorityFilter = 'all' | 'high' | 'medium' | 'low';

const priorityConfig = {
  high: { label: 'High', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  medium: { label: 'Medium', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  low: { label: 'Low', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
};

export function InternalLinks({ siteId, workspaceId }: Props) {
  const [data, setData] = useState<InternalLinkResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PriorityFilter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>('list');
  const [copied, setCopied] = useState<number | null>(null);
  const [showOrphans, setShowOrphans] = useState(false);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await webflow.internalLinksWithParams(siteId, workspaceId) as InternalLinkResult & { error?: string };
      if (result.error) {
        setError(result.error);
      } else {
        setData(result);
      }
    } catch {
      setError('Failed to analyze internal links');
    } finally {
      setLoading(false);
    }
  };

  // Load last saved snapshot on mount
  useEffect(() => {
    let cancelled = false;
    webflow.internalLinksSnapshot(siteId)
      .then(snap => {
        const s = snap as { result?: InternalLinkResult } | null;
        if (!cancelled && s?.result) setData(s.result);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [siteId]);

  const toggleExpanded = (idx: number) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(idx)) n.delete(idx); else n.add(idx);
      return n;
    });
  };

  const filtered = data?.suggestions.filter(s => {
    const matchesFilter = filter === 'all' || s.priority === filter;
    const matchesSearch = !search ||
      s.fromPage.toLowerCase().includes(search.toLowerCase()) ||
      s.toPage.toLowerCase().includes(search.toLowerCase()) ||
      s.fromTitle.toLowerCase().includes(search.toLowerCase()) ||
      s.toTitle.toLowerCase().includes(search.toLowerCase()) ||
      s.anchorText.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  }) || [];

  const counts = {
    high: data?.suggestions.filter(s => s.priority === 'high').length || 0,
    medium: data?.suggestions.filter(s => s.priority === 'medium').length || 0,
    low: data?.suggestions.filter(s => s.priority === 'low').length || 0,
  };

  if (!data && !loading) {
    return (
      <div className="space-y-4">
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-6 py-12 text-center">
          <Link className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
          <p className="text-sm text-zinc-400 mb-1">Internal Linking Suggestions</p>
          <p className="text-[11px] text-zinc-500 max-w-md mx-auto mb-4">
            Analyze your site's content and discover missing internal links.
            AI finds topically related pages that should link to each other to boost SEO and user navigation.
          </p>
          <button
            onClick={runAnalysis}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium mx-auto transition-colors"
          >
            <ArrowUpRight className="w-3.5 h-3.5" /> Analyze Internal Links
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
      <div className="flex flex-col items-center justify-center py-20 gap-2">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        <span className="text-sm text-zinc-400">Analyzing page content & finding link opportunities...</span>
        <span className="text-[11px] text-zinc-500">This fetches and reads every page — may take 30-60 seconds</span>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        title="Internal Linking Suggestions"
        subtitle={`Analyzed ${data.pageCount}${data.attemptedPageCount && data.attemptedPageCount !== data.pageCount ? `/${data.attemptedPageCount}` : ''} pages · ${data.existingLinkCount} existing internal links · ${data.suggestions.length} suggestions`}
        actions={
          <button onClick={runAnalysis} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors">
            <RefreshCw className="w-3 h-3" /> Reanalyze
          </button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-3">
        <StatCard label="High Priority" value={counts.high} valueColor="text-red-400" />
        <StatCard label="Medium Priority" value={counts.medium} valueColor="text-amber-400" />
        <StatCard label="Low Priority" value={counts.low} valueColor="text-blue-400" />
        <StatCard label="Orphan Pages" value={data.orphanCount || 0} valueColor={data.orphanCount ? 'text-orange-400' : 'text-zinc-400'} />
        <StatCard label="Avg Link Score" value={data.pageHealth?.length ? Math.round(data.pageHealth.reduce((s, p) => s + p.score, 0) / data.pageHealth.length) : '—'} sub="/100" />
      </div>

      {/* Orphan Pages Warning */}
      {data.orphanCount && data.orphanCount > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-orange-500/20 overflow-hidden">
          <button
            onClick={() => setShowOrphans(!showOrphans)}
            className="w-full px-4 py-3 flex items-center gap-2 hover:bg-zinc-800/30 transition-colors"
          >
            {showOrphans ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
            <AlertTriangle className="w-4 h-4 text-orange-400" />
            <span className="text-sm font-medium text-orange-300 flex-1 text-left">{data.orphanCount} Orphan Pages</span>
            <span className="text-[11px] text-zinc-500">No internal links point to these pages</span>
          </button>
          {showOrphans && data.pageHealth && (
            <div className="px-4 pb-3 border-t border-zinc-800 pt-2 space-y-1 max-h-[250px] overflow-y-auto">
              {data.pageHealth.filter(p => p.isOrphan).map((p, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-1.5 bg-zinc-950/50 rounded-lg text-xs">
                  <span className="text-zinc-500 font-mono flex-1 truncate">{p.path}</span>
                  <span className="text-zinc-400 truncate max-w-[200px]">{p.title}</span>
                  <span className="text-orange-400">0 inbound</span>
                  <span className="text-zinc-500">{p.outboundLinks} outbound</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filter + search */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          {([
            { id: 'all', label: `All (${data.suggestions.length})` },
            { id: 'high', label: `High (${counts.high})` },
            { id: 'medium', label: `Medium (${counts.medium})` },
            { id: 'low', label: `Low (${counts.low})` },
          ] as Array<{ id: PriorityFilter; label: string }>).map(f => (
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
            placeholder="Filter by page or anchor text..."
            className="w-full pl-7 pr-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
          />
        </div>
        <div className="flex items-center gap-0.5 bg-zinc-800 rounded-lg p-0.5">
          <button onClick={() => setViewMode('list')} className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500'}`} title="List view">
            <List className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setViewMode('grouped')} className={`p-1.5 rounded ${viewMode === 'grouped' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500'}`} title="Group by page">
            <LayoutList className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Suggestions list */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-500">
            No suggestions match your filter
          </div>
        ) : viewMode === 'grouped' ? (
          // Grouped by source page
          (() => {
            const groups = new Map<string, typeof filtered>();
            for (const s of filtered) {
              const key = s.fromPage;
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key)!.push(s);
            }
            return Array.from(groups.entries()).map(([fromPage, suggestions]) => (
              <div key={fromPage} className="border-b border-zinc-800/50 last:border-b-0">
                <div className="px-4 py-2.5 bg-zinc-800/30">
                  <div className="flex items-center gap-2">
                    <Link className="w-3.5 h-3.5 text-teal-400" />
                    <span className="text-xs font-medium text-zinc-200">{suggestions[0].fromTitle}</span>
                    <span className="text-[11px] text-zinc-500 font-mono">{fromPage}</span>
                    <span className="text-[11px] text-zinc-500 ml-auto">{suggestions.length} links to add</span>
                  </div>
                </div>
                {suggestions.map((s, i) => {
                  const cfg = priorityConfig[s.priority];
                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-2 pl-10 hover:bg-zinc-800/20 transition-colors">
                      <ArrowRight className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                      <span className="text-xs text-zinc-300 font-mono truncate max-w-[160px]">{s.toPage}</span>
                      <span className="text-[11px] text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded truncate max-w-[180px]">"{s.anchorText}"</span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                      <button
                        onClick={() => { navigator.clipboard.writeText(`<a href="${s.toPage}">${s.anchorText}</a>`); setCopied(i); setTimeout(() => setCopied(null), 2000); }}
                        className="ml-auto text-zinc-500 hover:text-zinc-300 transition-colors"
                        title="Copy HTML link"
                      >
                        {copied === i ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            ));
          })()
        ) : (
          filtered.map((s, idx) => {
            const isExpanded = expanded.has(idx);
            const cfg = priorityConfig[s.priority];

            return (
              <div key={idx} className="border-b border-zinc-800/50 last:border-b-0">
                <button
                  onClick={() => toggleExpanded(idx)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/20 transition-colors text-left"
                >
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-xs text-zinc-300 font-mono truncate max-w-[140px]">{s.fromPage}</span>
                    <ArrowRight className="w-3 h-3 text-zinc-500 flex-shrink-0" />
                    <span className="text-xs text-zinc-300 font-mono truncate max-w-[140px]">{s.toPage}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[11px] text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded truncate max-w-[160px]">
                      "{s.anchorText}"
                    </span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded border ${cfg.bg} ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`<a href="${s.toPage}">${s.anchorText}</a>`); setCopied(idx); setTimeout(() => setCopied(null), 2000); }}
                      className="text-zinc-500 hover:text-zinc-300 transition-colors"
                      title="Copy HTML link"
                    >
                      {copied === idx ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-3 pl-10 space-y-2">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">From Page</span>
                        <p className="text-xs text-zinc-300 mt-0.5">{s.fromTitle}</p>
                        <p className="text-[11px] text-zinc-500 font-mono">{s.fromPage}</p>
                      </div>
                      <div>
                        <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Link To</span>
                        <p className="text-xs text-zinc-300 mt-0.5">{s.toTitle}</p>
                        <p className="text-[11px] text-zinc-500 font-mono">{s.toPage}</p>
                      </div>
                    </div>
                    <div>
                      <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Suggested Anchor Text</span>
                      <p className="text-xs text-teal-300 mt-0.5 bg-teal-500/5 border border-teal-500/10 rounded px-2 py-1 inline-block">
                        {s.anchorText}
                      </p>
                    </div>
                    <div>
                      <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Why This Link</span>
                      <p className="text-[11px] text-zinc-400 mt-0.5">{s.reason}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Tips */}
      {data.suggestions.length > 0 && (
        <div className="bg-zinc-800/30 rounded-lg border border-zinc-800 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-teal-400 mt-0.5 flex-shrink-0" />
            <div className="text-[11px] text-zinc-500 space-y-1">
              <p><strong className="text-zinc-400">How to implement:</strong> Open each page in the Webflow Designer and add links using the suggested anchor text. Place links naturally within the page's body content where they make contextual sense.</p>
              <p><strong className="text-zinc-400">SEO impact:</strong> Internal links help search engines discover and understand page relationships. They also distribute page authority (PageRank) across your site, which can improve rankings for linked pages.</p>
              <p><strong className="text-teal-400">Tip:</strong> Use the <strong className="text-teal-400">SEO Editor</strong> from the sidebar to update page content directly, or run a <strong className="text-teal-400">Site Audit</strong> to validate the changes.</p>
            </div>
          </div>
        </div>
      )}

      {data.suggestions.length === 0 && data.attemptedPageCount && data.pageCount < data.attemptedPageCount * 0.5 ? (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3 text-xs text-amber-400 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <div>
            <strong>Content fetch issue:</strong> Only {data.pageCount} of {data.attemptedPageCount} pages could be loaded.
            {data.pageCount === 0
              ? ' Your site may be password-protected, behind a staging gate, or unreachable. Check that the live domain is set in Workspace Settings.'
              : ' Some pages may be password-protected or returning errors. Results may be incomplete.'}
          </div>
        </div>
      ) : data.suggestions.length === 0 && data.pageCount < 2 ? (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3 text-xs text-amber-400 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          Not enough pages to analyze. At least 2 published pages with fetchable content are required.
        </div>
      ) : data.suggestions.length === 0 ? (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-3 text-xs text-emerald-400 flex items-center gap-2">
          <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
          Your site has good internal linking coverage. No major gaps detected.
        </div>
      ) : null}
    </div>
  );
}
