import { useState, useEffect, useRef } from 'react';
import {
  Loader2, ChevronDown, ChevronRight, Target, AlertCircle,
  BarChart3, Sparkles, Search as SearchIcon, TrendingUp,
  CheckCircle, Tag, Zap, BookOpen, Pencil, Check, X,
  Shield, DollarSign, ArrowUp, ArrowDown,
} from 'lucide-react';
import { scoreColorClass, scoreBgBarClass } from './ui';
import { get, post } from '../api/client';
import { keywords } from '../api/seo';
import { useKeywordStrategy } from '../hooks/admin';
import { SeoCopyPanel } from './strategy/SeoCopyPanel';
import { useQueryClient } from '@tanstack/react-query';
import type { FixContext } from '../App';

// ── Types ──

interface PageMeta {
  id: string;
  title: string;
  slug: string;
  publishedPath?: string | null;
  seo?: { title?: string | null; description?: string | null };
  source?: 'static' | 'cms';
}

interface StrategyPage {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent?: string;
  currentPosition?: number;
  impressions?: number;
  clicks?: number;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  metricsSource?: 'exact' | 'partial_match' | 'ai_estimate';
  validated?: boolean;
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
  optimizationScore?: number;
  optimizationIssues?: string[];
  recommendations?: string[];
  contentGaps?: string[];
  analysisGeneratedAt?: string;
}

interface KeywordPresence {
  inTitle: boolean;
  inMeta: boolean;
  inContent: boolean;
  inSlug: boolean;
}

interface KeywordData {
  primaryKeyword: string;
  primaryKeywordPresence: KeywordPresence;
  secondaryKeywords: string[];
  longTailKeywords: string[];
  searchIntent: string;
  searchIntentConfidence: number;
  contentGaps: string[];
  competitorKeywords: string[];
  optimizationScore: number;
  optimizationIssues: string[];
  recommendations: string[];
  estimatedDifficulty: string;
  topicCluster: string;
}

interface ContentScore {
  wordCount: number;
  sentenceCount: number;
  avgWordsPerSentence: number;
  readabilityScore: number;
  readabilityGrade: string;
  headings: { total: number; h1: number; h2: number; texts: string[] };
  topKeywords: Array<{ word: string; count: number; density: number }>;
  titleLength: number;
  descLength: number;
  titleOk: boolean;
  descOk: boolean;
}

interface SeoCopy {
  seoTitle: string;
  metaDescription: string;
  h1: string;
  introParagraph: string;
  internalLinkSuggestions?: { targetPath: string; anchorText: string; context: string }[];
  changes?: string[];
}

// Merged page row combining strategy + webflow page data
interface UnifiedPage {
  id: string; // webflow page id or synthesized from path
  title: string;
  path: string;
  slug: string;
  source: 'static' | 'cms';
  seo?: { title?: string | null; description?: string | null };
  publishedPath?: string | null;
  // Strategy data (may be null if page not in strategy)
  strategy?: StrategyPage;
}

interface Props {
  workspaceId: string;
  siteId: string;
  fixContext?: FixContext | null;
}

type SortBy = 'priority' | 'position' | 'volume' | 'score';

// ── Helpers ──

function positionColor(pos?: number) {
  if (!pos) return 'text-zinc-500';
  if (pos <= 3) return 'text-emerald-400';
  if (pos <= 10) return 'text-green-400';
  if (pos <= 20) return 'text-amber-400';
  return 'text-red-400';
}

function kdColor(kd?: number) {
  if (kd === undefined) return 'text-zinc-500';
  if (kd <= 30) return 'text-emerald-400';
  if (kd <= 50) return 'text-amber-400';
  if (kd <= 70) return 'text-orange-400';
  return 'text-red-400';
}

function kdLabel(kd?: number) {
  if (kd === undefined) return '';
  if (kd <= 30) return 'Easy';
  if (kd <= 50) return 'Medium';
  if (kd <= 70) return 'Hard';
  return 'Very Hard';
}

function intentColor(intent?: string) {
  switch (intent) {
    case 'commercial': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
    case 'informational': return 'text-green-400 bg-green-500/10 border-green-500/20';
    case 'transactional': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    case 'navigational': return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
    default: return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
  }
}

function intentIcon(intent: string): string {
  if (intent === 'informational') return 'i';
  if (intent === 'transactional') return '$';
  if (intent === 'navigational') return '→';
  return '?';
}

function difficultyTextColor(d: string): string {
  if (d === 'low') return 'text-green-400';
  if (d === 'medium') return 'text-amber-400';
  return 'text-red-400';
}

function opportunityScore(p: StrategyPage) {
  const pos = p.currentPosition || 999;
  const imp = p.impressions || 0;
  const vol = p.volume || 0;
  if (pos >= 4 && pos <= 20 && imp > 0) return imp * (21 - pos);
  if (pos > 20 && imp > 0) return imp * 2;
  if (pos <= 3) return imp * 0.5;
  if (vol > 0) return vol;
  return 1;
}

// ── Component ──

export function PageIntelligence({ workspaceId, siteId, fixContext }: Props) {
  const queryClient = useQueryClient();
  const { data: keywordData, isLoading: strategyLoading } = useKeywordStrategy(workspaceId);
  const strategy = keywordData?.strategy || null;

  // All pages from webflow (static + CMS)
  const [allPages, setAllPages] = useState<PageMeta[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);

  // AI analysis state
  const [analyses, setAnalyses] = useState<Record<string, KeywordData>>({});
  const [contentScores, setContentScores] = useState<Record<string, ContentScore>>({});
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelBulkRef = useRef(false);

  // Page list UI state
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('priority');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Keyword editing state
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ primary: '', secondary: '' });
  const [saving, setSaving] = useState(false);

  // SEO copy generation state
  const [generatingCopy, setGeneratingCopy] = useState<string | null>(null);
  const [seoCopyResults, setSeoCopyResults] = useState<Map<string, SeoCopy>>(new Map());
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Fetch all pages
  useEffect(() => {
    setPagesLoading(true);
    get<PageMeta[]>(`/api/webflow/all-pages/${siteId}`)
      .then(setAllPages)
      .catch(() => get<PageMeta[]>(`/api/webflow/pages/${siteId}`).then(setAllPages).catch(() => setAllPages([])))
      .finally(() => setPagesLoading(false));
  }, [siteId]);

  // Auto-expand target page from fixContext
  const fixConsumed = useRef(false);
  useEffect(() => {
    if (fixContext?.pageSlug && !fixConsumed.current && unifiedPages.length > 0) {
      const match = unifiedPages.find(p =>
        p.slug === fixContext.pageSlug || p.path === `/${fixContext.pageSlug}` || p.id === fixContext.pageId
      );
      if (match) {
        fixConsumed.current = true;
        setExpanded(match.id);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixContext, allPages, strategy]);

  // ── Merge strategy data + all pages into unified list ──
  const unifiedPages: UnifiedPage[] = (() => {
    const pageMap = strategy?.pageMap || [];
    const result: UnifiedPage[] = [];
    const usedPaths = new Set<string>();

    // Start with all webflow pages, enriched with strategy data
    for (const page of allPages) {
      const pagePath = `/${page.slug || ''}`;
      const strategyMatch = pageMap.find((sp: StrategyPage) =>
        sp.pagePath === pagePath || sp.pagePath === page.slug ||
        pagePath.includes(sp.pagePath) || sp.pagePath.includes(pagePath.replace(/^\//,''))
      );
      result.push({
        id: page.id,
        title: strategyMatch?.pageTitle || page.title,
        path: pagePath,
        slug: page.slug,
        source: page.source || 'static',
        seo: page.seo,
        publishedPath: page.publishedPath,
        strategy: strategyMatch || undefined,
      });
      if (strategyMatch) usedPaths.add(strategyMatch.pagePath);
    }

    // Add any strategy pages that aren't in webflow pages (e.g., discovered via GSC)
    for (const sp of pageMap) {
      if (!usedPaths.has(sp.pagePath)) {
        result.push({
          id: `strategy-${sp.pagePath}`,
          title: sp.pageTitle,
          path: sp.pagePath,
          slug: sp.pagePath.replace(/^\//, ''),
          source: 'static',
          strategy: sp,
        });
      }
    }

    return result;
  })();

  // ── AI Analysis ──
  const analyzePage = async (page: UnifiedPage) => {
    setAnalyzing(prev => new Set(prev).add(page.id));
    try {
      let pageContent = '';
      try {
        const pagePath = page.publishedPath || page.path;
        if (pagePath) {
          const result = await get<{ text?: string }>(`/api/webflow/page-html/${siteId}?path=${encodeURIComponent(pagePath)}`);
          pageContent = result.text || '';
        }
      } catch { /* best-effort */ }

      const [kwData, csData] = await Promise.all([
        post<KeywordData & { error?: string }>('/api/webflow/keyword-analysis', {
          pageTitle: page.title,
          seoTitle: page.seo?.title,
          metaDescription: page.seo?.description,
          slug: page.slug,
          pageContent,
        }),
        post<ContentScore & { error?: string }>('/api/webflow/content-score', {
          pageTitle: page.title,
          seoTitle: page.seo?.title,
          metaDescription: page.seo?.description,
          pageContent,
        }),
      ]);

      if (!kwData.error) {
        setAnalyses(prev => ({ ...prev, [page.id]: kwData }));
        // Auto-persist to workspace keyword strategy
        try {
          await keywords.persistAnalysis({
            workspaceId,
            pagePath: page.path,
            analysis: {
              primaryKeyword: kwData.primaryKeyword,
              secondaryKeywords: kwData.secondaryKeywords,
              searchIntent: kwData.searchIntent,
              optimizationIssues: kwData.optimizationIssues,
              recommendations: kwData.recommendations,
              contentGaps: kwData.contentGaps,
              optimizationScore: kwData.optimizationScore,
            },
          });
          // Invalidate strategy cache so persisted data shows up
          queryClient.invalidateQueries({ queryKey: ['keyword-strategy', workspaceId] });
        } catch { /* persist is best-effort */ }
      }
      if (!csData.error) {
        setContentScores(prev => ({ ...prev, [page.id]: csData }));
      }
    } catch (err) {
      console.error('Analysis failed:', err);
    } finally {
      setAnalyzing(prev => { const n = new Set(prev); n.delete(page.id); return n; });
    }
  };

  const analyzeAllPages = async () => {
    cancelBulkRef.current = false;
    const toAnalyze = unifiedPages.filter(p => !analyses[p.id]);
    setBulkProgress({ done: 0, total: toAnalyze.length });
    for (let i = 0; i < toAnalyze.length; i++) {
      if (cancelBulkRef.current) break;
      setBulkProgress({ done: i, total: toAnalyze.length });
      await analyzePage(toAnalyze[i]);
    }
    setBulkProgress(prev => prev ? { ...prev, done: prev.total } : null);
    setTimeout(() => setBulkProgress(null), 3000);
  };

  // ── Keyword Editing ──
  const startEdit = (page: UnifiedPage) => {
    if (!page.strategy) return;
    setEditingPageId(page.id);
    setEditDraft({
      primary: page.strategy.primaryKeyword,
      secondary: page.strategy.secondaryKeywords.join(', '),
    });
  };

  const saveEdit = async (page: UnifiedPage) => {
    if (!strategy || !page.strategy) return;
    setSaving(true);
    const pageIdx = strategy.pageMap.indexOf(page.strategy);
    if (pageIdx === -1) { setSaving(false); return; }
    const updated = [...strategy.pageMap];
    updated[pageIdx] = {
      ...updated[pageIdx],
      primaryKeyword: editDraft.primary.trim(),
      secondaryKeywords: editDraft.secondary.split(',').map(s => s.trim()).filter(Boolean),
    };
    try {
      await keywords.patchStrategy(workspaceId, { pageMap: updated });
      queryClient.invalidateQueries({ queryKey: ['keyword-strategy', workspaceId] });
      setEditingPageId(null);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  // ── SEO Copy Generation ──
  const generateSeoCopy = async (page: UnifiedPage) => {
    if (!page.strategy) return;
    setGeneratingCopy(page.strategy.pagePath);
    try {
      const data = await keywords.seoCopy({
        pagePath: page.strategy.pagePath,
        pageTitle: page.strategy.pageTitle,
        workspaceId,
      }) as SeoCopy & { error?: string };
      if (!data.error) {
        setSeoCopyResults(prev => new Map(prev).set(page.strategy!.pagePath, data));
      }
    } catch (err) {
      console.error('SEO copy generation failed:', err);
    } finally {
      setGeneratingCopy(null);
    }
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // ── Filtering + Sorting ──
  const filtered = unifiedPages
    .filter(p => {
      if (!search) return true;
      const q = search.toLowerCase();
      return p.title.toLowerCase().includes(q) ||
             p.path.toLowerCase().includes(q) ||
             (p.strategy?.primaryKeyword || '').toLowerCase().includes(q);
    })
    .sort((a, b) => {
      let cmp = 0;
      const sa = a.strategy;
      const sb = b.strategy;
      switch (sortBy) {
        case 'position': cmp = (sa?.currentPosition || 999) - (sb?.currentPosition || 999); break;
        case 'volume': cmp = (sb?.volume || 0) - (sa?.volume || 0); break;
        case 'score': {
          const scoreA = analyses[a.id]?.optimizationScore ?? sa?.optimizationScore ?? -1;
          const scoreB = analyses[b.id]?.optimizationScore ?? sb?.optimizationScore ?? -1;
          cmp = scoreB - scoreA;
          break;
        }
        case 'priority':
        default:
          cmp = (sa ? opportunityScore(sa) : 0) - (sb ? opportunityScore(sb) : 0);
          cmp = -cmp; // Higher opportunity first
          break;
      }
      return sortDir === 'asc' ? -cmp : cmp;
    });

  // ── Stats ──
  const analyzedCount = Object.keys(analyses).length + unifiedPages.filter(p => p.strategy?.analysisGeneratedAt && !analyses[p.id]).length;
  const cmsCount = unifiedPages.filter(p => p.source === 'cms').length;
  const withStrategy = unifiedPages.filter(p => p.strategy).length;

  const loading = strategyLoading || pagesLoading;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-teal-400" />
        <span className="ml-3 text-sm text-zinc-400">Loading page intelligence...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Page Intelligence</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {unifiedPages.length} pages
            {cmsCount > 0 && <span className="text-violet-400"> · {cmsCount} CMS</span>}
            {withStrategy > 0 && <span> · {withStrategy} with strategy</span>}
            {analyzedCount > 0 && <span className="text-teal-400"> · {analyzedCount} analyzed</span>}
          </p>
        </div>
        {/* Analyze All */}
        {bulkProgress ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-violet-500/10 border border-violet-500/30 rounded-lg">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />
            <span className="text-xs text-zinc-300">Analyzing {bulkProgress.done}/{bulkProgress.total}...</span>
            <button onClick={() => { cancelBulkRef.current = true; }} className="text-[11px] text-red-400 hover:text-red-300 ml-2">Cancel</button>
          </div>
        ) : (
          <button
            onClick={analyzeAllPages}
            disabled={analyzing.size > 0 || analyzedCount === unifiedPages.length}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600/80 hover:bg-violet-500/80 text-white rounded-lg transition-colors disabled:opacity-40"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {analyzedCount === unifiedPages.length && unifiedPages.length > 0
              ? 'All Analyzed'
              : analyzedCount > 0
                ? `Analyze Remaining (${unifiedPages.length - analyzedCount})`
                : 'Analyze All Pages'}
          </button>
        )}
      </div>

      {/* Search + Sort */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search pages, keywords..."
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-[11px] text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-teal-500"
          />
        </div>
        <div className="flex items-center gap-1">
          {(['priority', 'position', 'volume', 'score'] as const).map(s => (
            <button
              key={s}
              onClick={() => { if (sortBy === s) setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortBy(s); setSortDir('desc'); } }}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-0.5 ${
                sortBy === s ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30' : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-300'
              }`}
            >
              {s === 'priority' ? 'Priority' : s === 'score' ? 'Score' : s.charAt(0).toUpperCase() + s.slice(1)}
              {sortBy === s && (sortDir === 'desc' ? <ArrowDown className="w-2.5 h-2.5" /> : <ArrowUp className="w-2.5 h-2.5" />)}
            </button>
          ))}
        </div>
      </div>

      {/* Page List */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        {filtered.map(page => {
          const isExpanded = expanded === page.id;
          const isAnalyzing = analyzing.has(page.id);
          const kw = analyses[page.id];
          const cs = contentScores[page.id];
          const sp = page.strategy;
          const isEditing = editingPageId === page.id;
          const hasPersistedAnalysis = !!sp?.analysisGeneratedAt;
          const displayScore = kw?.optimizationScore ?? sp?.optimizationScore;

          return (
            <div key={page.id} className="border-b border-zinc-800/50 last:border-b-0">
              {/* Collapsed Row */}
              <button
                onClick={() => setExpanded(isExpanded ? null : page.id)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/20 transition-colors text-left"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {isAnalyzing ? (
                    <Loader2 className="w-3.5 h-3.5 text-teal-400 animate-spin flex-shrink-0" />
                  ) : isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-zinc-300 truncate">{page.title}</span>
                      {page.source === 'cms' && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/20 shrink-0">CMS</span>
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-500 font-mono">{page.path}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  {sp?.searchIntent && (
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full border font-medium ${intentColor(sp.searchIntent)}`}>
                      {sp.searchIntent}
                    </span>
                  )}
                  {sp?.primaryKeyword && (
                    <span className="text-[11px] text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded max-w-[180px] truncate">
                      {sp.primaryKeyword}
                    </span>
                  )}
                  {sp?.validated === false && (
                    <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1 py-0.5 rounded border border-amber-500/20" title="Keyword not validated in SEMRush">
                      Unvalidated
                    </span>
                  )}
                  {sp?.volume !== undefined && sp.volume > 0 && (
                    <span className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded font-mono">{sp.volume.toLocaleString()}/mo</span>
                  )}
                  {sp?.difficulty !== undefined && sp.difficulty > 0 && (
                    <span className={`text-[11px] ${kdColor(sp.difficulty)} bg-zinc-800 px-1.5 py-0.5 rounded font-mono`}>KD {sp.difficulty}%</span>
                  )}
                  {sp?.currentPosition ? (
                    <span className={`text-[11px] ${positionColor(sp.currentPosition)} font-mono font-medium bg-zinc-800 px-1.5 py-0.5 rounded`}>
                      #{sp.currentPosition.toFixed(0)}
                    </span>
                  ) : null}
                  {displayScore !== undefined && (
                    <span className={`text-xs font-bold tabular-nums ${scoreColorClass(displayScore)}`}>{displayScore}</span>
                  )}
                </div>
              </button>

              {/* Expanded Detail */}
              {isExpanded && (
                <div className="px-4 pb-4 pl-10 space-y-4">

                  {/* ── Section 1: Keywords & Metrics (from strategy) ── */}
                  {sp && !isEditing && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Primary Keyword</span>
                          <p className="text-xs text-zinc-200 mt-0.5">{sp.primaryKeyword}</p>
                        </div>
                        <button onClick={() => startEdit(page)} className="p-1 text-zinc-500 hover:text-teal-400 transition-colors" title="Edit keywords">
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                      <div>
                        <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Secondary Keywords</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {sp.secondaryKeywords.map((kw, i) => (
                            <span key={i} className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-400">{kw}</span>
                          ))}
                        </div>
                      </div>
                      {/* Metrics row */}
                      <div className="flex flex-wrap gap-3 mt-1">
                        {sp.volume != null && sp.volume > 0 && (
                          <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                            <BarChart3 className="w-3 h-3 text-orange-400" />
                            <span className="text-zinc-300 font-medium">{sp.volume.toLocaleString()}</span>/mo
                          </div>
                        )}
                        {sp.difficulty != null && sp.difficulty > 0 && (
                          <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                            <Shield className="w-3 h-3" />
                            KD: <span className={`font-medium ${kdColor(sp.difficulty)}`}>{sp.difficulty}%</span>
                            <span className={kdColor(sp.difficulty)}>({kdLabel(sp.difficulty)})</span>
                          </div>
                        )}
                        {sp.cpc !== undefined && sp.cpc > 0 && (
                          <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                            <DollarSign className="w-3 h-3 text-green-400" />
                            CPC: <span className="text-green-400 font-medium">${sp.cpc.toFixed(2)}</span>
                          </div>
                        )}
                        {sp.impressions !== undefined && (
                          <span className="text-[11px] text-zinc-500"><span className="text-zinc-400 font-medium">{sp.impressions.toLocaleString()}</span> impressions</span>
                        )}
                        {sp.clicks !== undefined && (
                          <span className="text-[11px] text-zinc-500"><span className="text-zinc-400 font-medium">{sp.clicks.toLocaleString()}</span> clicks</span>
                        )}
                        {sp.currentPosition && (
                          <span className="text-[11px] text-zinc-500">Avg position: <span className={`font-medium ${positionColor(sp.currentPosition)}`}>#{sp.currentPosition.toFixed(1)}</span></span>
                        )}
                      </div>
                      {/* Secondary keyword metrics */}
                      {sp.secondaryMetrics && sp.secondaryMetrics.length > 0 && (
                        <div className="mt-1">
                          <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Secondary keyword data</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {sp.secondaryMetrics.filter(sm => sm.volume > 0 || sm.difficulty > 0).map((sm, si) => (
                              <span key={si} className="text-[11px] px-1.5 py-0.5 bg-zinc-800/80 border border-zinc-700/50 rounded text-zinc-500">
                                {sm.keyword} {sm.volume > 0 && <span className="text-zinc-400">{sm.volume}/mo</span>} {sm.difficulty > 0 && <span className={kdColor(sm.difficulty)}>KD {sm.difficulty}%</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* SEO Copy */}
                      <SeoCopyPanel
                        page={sp}
                        seoCopyResults={seoCopyResults}
                        generatingCopy={generatingCopy}
                        copiedField={copiedField}
                        onGenerateSeoCopy={() => generateSeoCopy(page)}
                        onCopyText={copyText}
                      />
                    </div>
                  )}

                  {/* Editing mode */}
                  {sp && isEditing && (
                    <div className="space-y-2">
                      <div>
                        <label className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider block mb-1">Primary Keyword</label>
                        <input type="text" value={editDraft.primary} onChange={e => setEditDraft(prev => ({ ...prev, primary: e.target.value }))}
                          className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500" />
                      </div>
                      <div>
                        <label className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider block mb-1">Secondary Keywords (comma-separated)</label>
                        <input type="text" value={editDraft.secondary} onChange={e => setEditDraft(prev => ({ ...prev, secondary: e.target.value }))}
                          className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => saveEdit(page)} disabled={saving}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-[11px] font-medium">
                          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                        </button>
                        <button onClick={() => setEditingPageId(null)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-[11px] font-medium">
                          <X className="w-3 h-3" /> Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* No strategy data — prompt to analyze */}
                  {!sp && !kw && !isAnalyzing && (
                    <div className="text-center py-4">
                      <p className="text-xs text-zinc-500 mb-2">This page isn't in your keyword strategy yet.</p>
                      <button onClick={() => analyzePage(page)}
                        className="flex items-center gap-1.5 px-3 py-1.5 mx-auto text-xs font-medium bg-teal-600/80 hover:bg-teal-500/80 text-white rounded-lg transition-colors">
                        <Sparkles className="w-3.5 h-3.5" /> Run AI Analysis
                      </button>
                    </div>
                  )}

                  {/* Loading analysis */}
                  {isAnalyzing && !kw && (
                    <div className="flex items-center gap-2 py-6 justify-center text-zinc-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Running AI keyword analysis...</span>
                    </div>
                  )}

                  {/* ── Section 2: AI Analysis Results ── */}
                  {kw && (
                    <div className="space-y-3 pt-2 border-t border-zinc-800">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">AI Analysis</span>
                        <button onClick={() => analyzePage(page)} disabled={isAnalyzing}
                          className="text-[11px] text-zinc-500 hover:text-teal-400 flex items-center gap-1 transition-colors disabled:opacity-50">
                          {isAnalyzing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />} Re-analyze
                        </button>
                      </div>

                      {/* Score + Intent + Difficulty */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Optimization</div>
                          <div className={`text-2xl font-bold ${scoreColorClass(kw.optimizationScore)}`}>
                            {kw.optimizationScore}<span className="text-xs font-normal text-zinc-500">/100</span>
                          </div>
                          <div className="mt-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${scoreBgBarClass(kw.optimizationScore)}`} style={{ width: `${kw.optimizationScore}%` }} />
                          </div>
                        </div>
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Search Intent</div>
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-teal-500/20 text-teal-400 flex items-center justify-center text-xs font-bold">{intentIcon(kw.searchIntent)}</span>
                            <div>
                              <div className="text-sm font-medium text-zinc-200 capitalize">{kw.searchIntent}</div>
                              <div className="text-[11px] text-zinc-500">{Math.round(kw.searchIntentConfidence * 100)}% confidence</div>
                            </div>
                          </div>
                        </div>
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Difficulty</div>
                          <div className={`text-lg font-bold capitalize ${difficultyTextColor(kw.estimatedDifficulty)}`}>{kw.estimatedDifficulty}</div>
                          <div className="text-[11px] text-zinc-500 mt-0.5">Cluster: {kw.topicCluster}</div>
                        </div>
                      </div>

                      {/* Primary keyword presence */}
                      <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                        <div className="flex items-center gap-2 mb-2">
                          <Target className="w-3.5 h-3.5 text-teal-400" />
                          <span className="text-xs font-medium text-zinc-300">Primary Keyword: <span className="text-white">{kw.primaryKeyword}</span></span>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          {(['inTitle', 'inMeta', 'inContent', 'inSlug'] as const).map(key => {
                            const labels = { inTitle: 'Title', inMeta: 'Meta', inContent: 'Content', inSlug: 'URL' };
                            const present = kw.primaryKeywordPresence[key];
                            return (
                              <div key={key} className="flex items-center gap-1">
                                {present ? <CheckCircle className="w-3 h-3 text-green-400" /> : <AlertCircle className="w-3 h-3 text-red-400" />}
                                <span className={`text-[11px] ${present ? 'text-green-400' : 'text-red-400'}`}>{labels[key]}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Keywords grid */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="flex items-center gap-2 mb-2">
                            <Tag className="w-3.5 h-3.5 text-blue-400" />
                            <span className="text-xs font-medium text-zinc-300">Secondary Keywords</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {kw.secondaryKeywords.map((k, i) => (
                              <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400">{k}</span>
                            ))}
                          </div>
                        </div>
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                            <span className="text-xs font-medium text-zinc-300">Long-Tail Keywords</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {kw.longTailKeywords.map((k, i) => (
                              <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-400">{k}</span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Competitor keywords */}
                      {kw.competitorKeywords.length > 0 && (
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="flex items-center gap-2 mb-2">
                            <Zap className="w-3.5 h-3.5 text-amber-400" />
                            <span className="text-xs font-medium text-zinc-300">Competitor Keywords</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {kw.competitorKeywords.map((k, i) => (
                              <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">{k}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── Section 3: Issues & Recommendations (admin secret sauce) ── */}
                      {(kw.contentGaps.length > 0 || kw.optimizationIssues.length > 0 || kw.recommendations.length > 0) && (
                        <div className="space-y-3 pt-2 border-t border-zinc-800">
                          <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">Issues & Recommendations</span>

                          {kw.contentGaps.length > 0 && (
                            <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                              <div className="flex items-center gap-2 mb-2">
                                <AlertCircle className="w-3.5 h-3.5 text-orange-400" />
                                <span className="text-xs font-medium text-zinc-300">Content Gaps</span>
                              </div>
                              <ul className="space-y-1">
                                {kw.contentGaps.map((gap, i) => (
                                  <li key={i} className="text-xs text-zinc-400 flex items-start gap-1.5">
                                    <span className="text-orange-400 mt-0.5">-</span> {gap}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-3">
                            {kw.optimizationIssues.length > 0 && (
                              <div className="bg-zinc-900 rounded-lg p-3 border border-red-500/20">
                                <div className="flex items-center gap-2 mb-2">
                                  <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                                  <span className="text-xs font-medium text-zinc-300">Issues</span>
                                </div>
                                <ul className="space-y-1">
                                  {kw.optimizationIssues.map((issue, i) => (
                                    <li key={i} className="text-[11px] text-zinc-400">{issue}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {kw.recommendations.length > 0 && (
                              <div className="bg-zinc-900 rounded-lg p-3 border border-green-500/20">
                                <div className="flex items-center gap-2 mb-2">
                                  <Sparkles className="w-3.5 h-3.5 text-green-400" />
                                  <span className="text-xs font-medium text-zinc-300">Recommendations</span>
                                </div>
                                <ul className="space-y-1">
                                  {kw.recommendations.map((rec, i) => (
                                    <li key={i} className="text-[11px] text-zinc-400">{rec}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Content metrics */}
                      {cs && (
                        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                          <div className="flex items-center gap-2 mb-3">
                            <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                            <span className="text-xs font-medium text-zinc-300">Content Metrics</span>
                          </div>
                          <div className="grid grid-cols-4 gap-3 mb-3">
                            <div>
                              <div className="text-lg font-bold text-zinc-200">{cs.wordCount}</div>
                              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Words</div>
                            </div>
                            <div>
                              <div className={`text-lg font-bold ${cs.readabilityScore >= 60 ? 'text-green-400' : cs.readabilityScore >= 30 ? 'text-amber-400' : 'text-red-400'}`}>
                                {cs.readabilityScore}
                              </div>
                              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Readability</div>
                            </div>
                            <div>
                              <div className="text-lg font-bold text-zinc-200">{cs.headings.total}</div>
                              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Headings</div>
                            </div>
                            <div>
                              <div className="text-lg font-bold text-zinc-200">{cs.avgWordsPerSentence}</div>
                              <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Words/Sent</div>
                            </div>
                          </div>
                          {cs.topKeywords.length > 0 && (
                            <div>
                              <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Top Words in Content</div>
                              <div className="flex flex-wrap gap-1">
                                {cs.topKeywords.slice(0, 10).map((tk, i) => (
                                  <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                                    {tk.word} <span className="text-cyan-600">({tk.density}%)</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="flex items-center gap-4 mt-3">
                            <div className="flex items-center gap-1.5">
                              {cs.titleOk ? <CheckCircle className="w-3 h-3 text-green-400" /> : <AlertCircle className="w-3 h-3 text-amber-400" />}
                              <span className="text-[11px] text-zinc-400">Title: {cs.titleLength} chars</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {cs.descOk ? <CheckCircle className="w-3 h-3 text-green-400" /> : <AlertCircle className="w-3 h-3 text-amber-400" />}
                              <span className="text-[11px] text-zinc-400">Desc: {cs.descLength} chars</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <BookOpen className="w-3 h-3 text-zinc-500" />
                              <span className="text-[11px] text-zinc-400">{cs.readabilityGrade} ({cs.readabilityScore})</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Show persisted analysis hint if no fresh analysis but strategy has it */}
                  {!kw && hasPersistedAnalysis && !isAnalyzing && (
                    <div className="pt-2 border-t border-zinc-800">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-green-400">Analysis on file (run {new Date(sp!.analysisGeneratedAt!).toLocaleDateString()})</span>
                        <button onClick={() => analyzePage(page)}
                          className="text-[11px] text-zinc-500 hover:text-teal-400 flex items-center gap-1 transition-colors">
                          <Sparkles className="w-2.5 h-2.5" /> Run fresh analysis
                        </button>
                      </div>
                      {/* Show persisted issues/recommendations */}
                      {(sp!.optimizationIssues?.length || sp!.recommendations?.length || sp!.contentGaps?.length) ? (
                        <div className="mt-2 space-y-2">
                          {sp!.optimizationScore !== undefined && (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-zinc-500">Score:</span>
                              <span className={`text-sm font-bold ${scoreColorClass(sp!.optimizationScore!)}`}>{sp!.optimizationScore}</span>
                            </div>
                          )}
                          {sp!.optimizationIssues && sp!.optimizationIssues.length > 0 && (
                            <div className="text-[11px] text-zinc-400">
                              <span className="text-red-400 font-medium">{sp!.optimizationIssues.length} issues</span> · {sp!.optimizationIssues.slice(0, 2).join(' · ')}
                              {sp!.optimizationIssues.length > 2 && ` +${sp!.optimizationIssues.length - 2} more`}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">
            {search ? 'No pages match your search.' : 'No pages found.'}
          </div>
        )}
      </div>
    </div>
  );
}
