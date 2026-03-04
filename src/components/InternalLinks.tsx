import { useState } from 'react';
import {
  Loader2, ArrowRight, RefreshCw, ExternalLink, Search as SearchIcon,
  Link, AlertCircle, ChevronDown, ChevronRight, ArrowUpRight,
} from 'lucide-react';

interface LinkSuggestion {
  fromPage: string;
  fromTitle: string;
  toPage: string;
  toTitle: string;
  anchorText: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

interface InternalLinkResult {
  suggestions: LinkSuggestion[];
  pageCount: number;
  existingLinkCount: number;
  analyzedAt: string;
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

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/webflow/internal-links/${siteId}${workspaceId ? `?workspaceId=${workspaceId}` : ''}`;
      const res = await fetch(url);
      const result = await res.json();
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
          <Link className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-sm text-zinc-400 mb-1">Internal Linking Suggestions</p>
          <p className="text-[11px] text-zinc-600 max-w-md mx-auto mb-4">
            Analyze your site's content and discover missing internal links.
            AI finds topically related pages that should link to each other to boost SEO and user navigation.
          </p>
          <button
            onClick={runAnalysis}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium mx-auto transition-colors"
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
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
        <span className="text-sm text-zinc-400">Analyzing page content & finding link opportunities...</span>
        <span className="text-[11px] text-zinc-600">This fetches and reads every page — may take 30-60 seconds</span>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Internal Linking Suggestions</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Analyzed {data.pageCount} pages · {data.existingLinkCount} existing internal links · {data.suggestions.length} suggestions
          </p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
        >
          <RefreshCw className="w-3 h-3" /> Reanalyze
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">High Priority</span>
          <p className="text-xl font-bold text-red-400">{counts.high}</p>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Medium Priority</span>
          <p className="text-xl font-bold text-amber-400">{counts.medium}</p>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Low Priority</span>
          <p className="text-xl font-bold text-blue-400">{counts.low}</p>
        </div>
      </div>

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
            placeholder="Filter by page or anchor text..."
            className="w-full pl-7 pr-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-violet-500"
          />
        </div>
      </div>

      {/* Suggestions list */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-600">
            No suggestions match your filter
          </div>
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
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-xs text-zinc-300 font-mono truncate max-w-[140px]">{s.fromPage}</span>
                    <ArrowRight className="w-3 h-3 text-zinc-600 flex-shrink-0" />
                    <span className="text-xs text-zinc-300 font-mono truncate max-w-[140px]">{s.toPage}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded truncate max-w-[160px]">
                      "{s.anchorText}"
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cfg.bg} ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-3 pl-10 space-y-2">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">From Page</span>
                        <p className="text-xs text-zinc-300 mt-0.5">{s.fromTitle}</p>
                        <p className="text-[10px] text-zinc-600 font-mono">{s.fromPage}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Link To</span>
                        <p className="text-xs text-zinc-300 mt-0.5">{s.toTitle}</p>
                        <p className="text-[10px] text-zinc-600 font-mono">{s.toPage}</p>
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Suggested Anchor Text</span>
                      <p className="text-xs text-violet-300 mt-0.5 bg-violet-500/5 border border-violet-500/10 rounded px-2 py-1 inline-block">
                        {s.anchorText}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Why This Link</span>
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
            <AlertCircle className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
            <div className="text-[11px] text-zinc-500 space-y-1">
              <p><strong className="text-zinc-400">How to implement:</strong> Open each page in the Webflow Designer and add links using the suggested anchor text. Place links naturally within the page's body content where they make contextual sense.</p>
              <p><strong className="text-zinc-400">SEO impact:</strong> Internal links help search engines discover and understand page relationships. They also distribute page authority (PageRank) across your site, which can improve rankings for linked pages.</p>
            </div>
          </div>
        </div>
      )}

      {data.suggestions.length === 0 && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-3 text-xs text-emerald-400 flex items-center gap-2">
          <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
          Your site has good internal linking coverage. No major gaps detected.
        </div>
      )}
    </div>
  );
}
