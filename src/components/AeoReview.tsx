/**
 * AEO Page Review — Admin-only AI-powered per-page content change recommendations.
 * Shows as a sub-tab within the SEO Audit view.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, ChevronDown, ChevronRight, Sparkles, Clock, Zap,
  FileText, User, Calendar, Quote, ListChecks, LayoutList, Table2,
  BookOpen, EyeOff, RefreshCw,
} from 'lucide-react';
import { aeoScoreColorClass, aeoScoreBgBarClass } from './ui';
import { aeoReview as aeoReviewApi } from '../api/seo';

// ─── Types ────────────────────────────────────────────────────────

type AeoChangeType =
  | 'rewrite_intro' | 'add_author' | 'add_date' | 'add_section'
  | 'add_citations' | 'add_schema' | 'add_faq' | 'add_comparison'
  | 'add_definition' | 'restructure_content' | 'remove_dark_pattern' | 'copy_edit';

type AeoEffort = 'quick' | 'moderate' | 'significant';

interface AeoPageChange {
  id: string;
  changeType: AeoChangeType;
  location: string;
  currentContent?: string;
  suggestedChange: string;
  rationale: string;
  effort: AeoEffort;
  priority: 'high' | 'medium' | 'low';
  aeoImpact: string;
}

interface AeoPageReview {
  pageUrl: string;
  pageTitle: string;
  reviewedAt: string;
  overallScore: number;
  summary: string;
  changes: AeoPageChange[];
  quickWinCount: number;
  estimatedTimeMinutes: number;
}

interface AeoSiteReview {
  workspaceId: string;
  generatedAt: string;
  pages: AeoPageReview[];
  sitewideSummary: string;
  totalChanges: number;
  quickWins: number;
}

interface Props {
  workspaceId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────

const CHANGE_TYPE_CONFIG: Record<AeoChangeType, { label: string; icon: typeof Sparkles; color: string }> = {
  rewrite_intro:       { label: 'Rewrite Intro',       icon: FileText,       color: 'text-amber-400' },
  add_author:          { label: 'Add Author',           icon: User,           color: 'text-purple-400' },
  add_date:            { label: 'Add Date',             icon: Calendar,       color: 'text-blue-400' },
  add_section:         { label: 'Add Section',          icon: LayoutList,     color: 'text-teal-400' },
  add_citations:       { label: 'Add Citations',        icon: Quote,          color: 'text-emerald-400' },
  add_schema:          { label: 'Add Schema',           icon: ListChecks,     color: 'text-cyan-400' },
  add_faq:             { label: 'Add FAQ',              icon: ListChecks,     color: 'text-sky-400' },
  add_comparison:      { label: 'Add Comparison',       icon: Table2,         color: 'text-teal-400' },
  add_definition:      { label: 'Add Definition',       icon: BookOpen,       color: 'text-teal-400' },
  restructure_content: { label: 'Restructure',          icon: LayoutList,     color: 'text-orange-400' },
  remove_dark_pattern: { label: 'Remove Dark Pattern',  icon: EyeOff,        color: 'text-red-400' },
  copy_edit:           { label: 'Copy Edit',            icon: FileText,       color: 'text-zinc-400' },
};

const EFFORT_CONFIG: Record<AeoEffort, { label: string; color: string; bg: string }> = {
  quick:       { label: '< 15 min',  color: 'text-emerald-400',  bg: 'bg-emerald-500/10 border-emerald-500/20' },
  moderate:    { label: '15–60 min', color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20' },
  significant: { label: '1+ hours',  color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
};

const PRIORITY_CONFIG: Record<string, { color: string; bg: string }> = {
  high:   { color: 'text-red-400',   bg: 'bg-red-500/10 border-red-500/20' },
  medium: { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  low:    { color: 'text-blue-400',  bg: 'bg-blue-500/10 border-blue-500/20' },
};


// ─── Component ────────────────────────────────────────────────────

export function AeoReview({ workspaceId }: Props) {
  const [review, setReview] = useState<AeoSiteReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPage, setLoadingPage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedChanges, setExpandedChanges] = useState<Set<string>>(new Set());
  const [filterEffort, setFilterEffort] = useState<AeoEffort | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');

  // Load saved review on mount
  useEffect(() => {
    aeoReviewApi.get(workspaceId)
      .then(d => { const r = d as AeoSiteReview | null; if (r && r.pages) setReview(r); })
      .catch((err) => { console.error('AeoReview operation failed:', err); });
  }, [workspaceId]);

  const runSiteReview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await aeoReviewApi.siteReview(workspaceId, { maxPages: 15 });
      setReview(data as AeoSiteReview);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const runSinglePageReview = useCallback(async (pageUrl: string) => {
    setLoadingPage(pageUrl);
    try {
      const pageReview = await aeoReviewApi.pageReview(workspaceId, { pageUrl }) as AeoPageReview;
      // Merge into existing review
      setReview(prev => {
        if (!prev) {
          return {
            workspaceId,
            generatedAt: new Date().toISOString(),
            pages: [pageReview],
            sitewideSummary: `Reviewed 1 page. ${pageReview.changes.length} changes found.`,
            totalChanges: pageReview.changes.length,
            quickWins: pageReview.quickWinCount,
          };
        }
        const pages = prev.pages.filter(p => p.pageUrl !== pageUrl).concat(pageReview);
        const totalChanges = pages.reduce((s, p) => s + p.changes.length, 0);
        const quickWins = pages.reduce((s, p) => s + p.quickWinCount, 0);
        return { ...prev, pages, totalChanges, quickWins, generatedAt: new Date().toISOString() };
      });
    } catch (err) {
      console.error('AeoReview operation failed:', err);
      setError(`Failed to review ${pageUrl}`);
    } finally {
      setLoadingPage(null);
    }
  }, [workspaceId]);

  const togglePage = (url: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      return next;
    });
  };

  const toggleChange = (id: string) => {
    setExpandedChanges(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Empty state ──
  if (!review && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-teal-500/20 border border-purple-500/30 flex items-center justify-center">
          <Sparkles className="w-8 h-8 text-purple-400" />
        </div>
        <div className="text-center max-w-md">
          <h3 className="text-sm font-semibold text-zinc-200 mb-1">AEO Page Review</h3>
          <p className="text-xs text-zinc-500 leading-relaxed">
            AI-powered analysis of your existing pages with specific copy rewrites, section additions,
            citation recommendations, and structural changes to maximize AI citation likelihood.
          </p>
          <p className="text-[11px] text-zinc-600 mt-2">
            Requires a completed SEO audit. Reviews pages with AEO issues first, prioritized by traffic.
          </p>
        </div>
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-xs text-red-400 max-w-md text-center">
            {error}
          </div>
        )}
        <button
          onClick={runSiteReview}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors bg-purple-600 hover:bg-purple-500 text-white"
        >
          <Sparkles className="w-4 h-4" /> Run AEO Review
        </button>
      </div>
    );
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
        <p className="text-sm text-zinc-400">Running AEO review across site pages...</p>
        <p className="text-xs text-zinc-600">This may take 1-2 minutes depending on the number of pages</p>
      </div>
    );
  }

  if (!review) return null;

  // ── Filter changes across all pages ──
  const filteredPages = review.pages.map(page => ({
    ...page,
    changes: page.changes
      .filter(c => filterEffort === 'all' || c.effort === filterEffort)
      .filter(c => filterPriority === 'all' || c.priority === filterPriority),
  })).filter(p => p.changes.length > 0);

  const totalFilteredChanges = filteredPages.reduce((s, p) => s + p.changes.length, 0);
  const avgScore = filteredPages.length > 0
    ? Math.round(review.pages.reduce((s, p) => s + p.overallScore, 0) / review.pages.length)
    : 0;

  return (
    <div className="space-y-8">
      {/* Summary bar */}
      <div className="grid grid-cols-5 gap-3">
        <div className="bg-zinc-900 p-4 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-1">Avg AEO Score</div>
          <div className={`text-3xl font-bold ${aeoScoreColorClass(avgScore)}`}>{avgScore}</div>
          <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${aeoScoreBgBarClass(avgScore)}`} style={{ width: `${avgScore}%` }} />
          </div>
        </div>
        <div className="bg-zinc-900 p-4 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-1">Pages Reviewed</div>
          <div className="text-2xl font-bold text-zinc-200">{review.pages.length}</div>
        </div>
        <div className="bg-zinc-900 p-4 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-1">Total Changes</div>
          <div className="text-2xl font-bold text-purple-400">{review.totalChanges}</div>
        </div>
        <div className="bg-zinc-900 p-4 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-1">Quick Wins</div>
          <div className="text-2xl font-bold text-emerald-400">{review.quickWins}</div>
        </div>
        <div className="bg-zinc-900 p-4 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-1">Est. Time</div>
          <div className="text-2xl font-bold text-zinc-200">
            {(() => {
              const mins = review.pages.reduce((s, p) => s + p.estimatedTimeMinutes, 0);
              return mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
            })()}
          </div>
        </div>
      </div>

      {/* Site summary */}
      <div className="bg-purple-500/5 border border-purple-500/20 px-4 py-3" style={{ borderRadius: '10px 24px 10px 24px' }}>
        <div className="text-xs text-purple-300">{review.sitewideSummary}</div>
        <div className="text-[11px] text-zinc-500 mt-1">
          Last reviewed: {new Date(review.generatedAt).toLocaleString()}
        </div>
      </div>

      {/* Filters + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-zinc-500 mr-1">Effort:</span>
            {(['all', 'quick', 'moderate', 'significant'] as const).map(e => (
              <button
                key={e}
                onClick={() => setFilterEffort(e)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors border ${
                  filterEffort === e
                    ? 'border-zinc-500 bg-zinc-800 text-zinc-200'
                    : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'
                }`}
              >
                {e === 'all' ? 'All' : e === 'quick' ? 'Quick' : e === 'moderate' ? 'Moderate' : '1h+'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-zinc-500 mr-1">Priority:</span>
            {(['all', 'high', 'medium', 'low'] as const).map(p => (
              <button
                key={p}
                onClick={() => setFilterPriority(p)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors border ${
                  filterPriority === p
                    ? 'border-zinc-500 bg-zinc-800 text-zinc-200'
                    : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'
                }`}
              >
                {p === 'all' ? 'All' : p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-zinc-500">{totalFilteredChanges} changes</span>
        </div>
        <button
          onClick={runSiteReview}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-medium transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Re-run Review
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Page list */}
      <div className="space-y-3">
        {filteredPages.map(page => {
          const isExpanded = expanded.has(page.pageUrl);
          const highCount = page.changes.filter(c => c.priority === 'high').length;
          const quickCount = page.changes.filter(c => c.effort === 'quick').length;
          const isRefreshing = loadingPage === page.pageUrl;

          return (
            <div key={page.pageUrl} className="bg-zinc-900 border border-zinc-800" style={{ borderRadius: '10px 24px 10px 24px' }}>
              <button
                onClick={() => togglePage(page.pageUrl)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/50 transition-colors text-left"
              >
                {isExpanded
                  ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                  : <ChevronRight className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-200 truncate">{page.pageTitle}</div>
                  <div className="text-xs text-zinc-500 truncate">{page.pageUrl}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded border ${EFFORT_CONFIG.quick.bg} ${EFFORT_CONFIG.quick.color}`}>
                    {quickCount} quick
                  </span>
                  {highCount > 0 && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400">
                      {highCount} high priority
                    </span>
                  )}
                  <span className="text-[11px] text-zinc-500">{page.changes.length} changes</span>
                  <span className={`text-sm font-bold tabular-nums ${aeoScoreColorClass(page.overallScore)}`}>
                    {page.overallScore}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-3">
                  {/* Page summary */}
                  <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-xs text-zinc-300 leading-relaxed">{page.summary}</div>
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-zinc-500">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> ~{page.estimatedTimeMinutes} min total</span>
                        <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-emerald-400" /> {page.quickWinCount} quick wins</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); runSinglePageReview(page.pageUrl); }}
                          disabled={isRefreshing}
                          className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 transition-colors ml-auto"
                        >
                          {isRefreshing
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <RefreshCw className="w-3 h-3" />}
                          Re-review
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Changes list */}
                  <div className="space-y-1.5">
                    {page.changes.map(change => {
                      const typeCfg = CHANGE_TYPE_CONFIG[change.changeType] || CHANGE_TYPE_CONFIG.copy_edit;
                      const effortCfg = EFFORT_CONFIG[change.effort] || EFFORT_CONFIG.moderate;
                      const prioCfg = PRIORITY_CONFIG[change.priority] || PRIORITY_CONFIG.medium;
                      const Icon = typeCfg.icon;
                      const isChangeExpanded = expandedChanges.has(change.id);

                      return (
                        <div key={change.id} className="rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
                          <button
                            onClick={() => toggleChange(change.id)}
                            className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left"
                          >
                            <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${typeCfg.color}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-medium text-zinc-200">{typeCfg.label}</span>
                                <span className="text-[11px] text-zinc-500">· {change.location}</span>
                              </div>
                              <div className="text-[11px] text-zinc-400 mt-0.5 line-clamp-1">{change.rationale}</div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${prioCfg.bg} ${prioCfg.color}`}>
                                {change.priority}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${effortCfg.bg} ${effortCfg.color}`}>
                                {effortCfg.label}
                              </span>
                              {isChangeExpanded
                                ? <ChevronDown className="w-3 h-3 text-zinc-600" />
                                : <ChevronRight className="w-3 h-3 text-zinc-600" />}
                            </div>
                          </button>

                          {isChangeExpanded && (
                            <div className="px-3 pb-3 ml-6 space-y-2">
                              {/* Current content (if applicable) */}
                              {change.currentContent && (
                                <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2">
                                  <div className="text-[10px] text-red-400 font-semibold uppercase tracking-wider mb-1">Current</div>
                                  <div className="text-[11px] text-zinc-400 italic leading-relaxed">"{change.currentContent}"</div>
                                </div>
                              )}

                              {/* Suggested change */}
                              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2">
                                <div className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider mb-1">Recommended Change</div>
                                <div className="text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap">{change.suggestedChange}</div>
                              </div>

                              {/* Rationale */}
                              <div className="text-[11px] text-zinc-500 leading-relaxed">
                                <span className="font-medium text-zinc-400">Why:</span> {change.rationale}
                              </div>

                              {/* AEO Impact */}
                              <div className="flex items-start gap-1.5 text-[11px]">
                                <Sparkles className="w-3 h-3 text-purple-400 flex-shrink-0 mt-0.5" />
                                <span className="text-purple-300">{change.aeoImpact}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredPages.length === 0 && review.pages.length > 0 && (
          <div className="text-center py-8 text-xs text-zinc-500">
            No changes match your current filters.
          </div>
        )}
      </div>
    </div>
  );
}

export default AeoReview;
