import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, ChevronDown, ChevronRight, Target, AlertCircle,
  BarChart3, Sparkles, Search as SearchIcon, TrendingUp,
  CheckCircle, Tag, Zap, BookOpen, Pencil, Check, X,
  Shield, DollarSign, ArrowUp, ArrowDown, ArrowUpRight, Code2, Plus,
} from 'lucide-react';
import { adminPath } from '../routes';
import { scoreColorClass, scoreBgBarClass, MetricRing, TabBar, ErrorState, ProgressIndicator, NextStepsCard } from './ui';
import { ErrorBoundary } from './ErrorBoundary';
import { queryKeys } from '../lib/queryKeys';
import { normalizePath, resolvePagePath } from '../lib/pathUtils';
import { get, post } from '../api/client';
import { keywords, rankTracking } from '../api/seo';
import { useKeywordStrategy } from '../hooks/admin';
import { SeoCopyPanel } from './strategy/SeoCopyPanel';
import { useQueryClient } from '@tanstack/react-query';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import type { FixContext } from '../App';
import type { MetricsSource } from '../../shared/types/keywords.js';
import { PageIntelligenceGuide } from './PageIntelligenceGuide';

const SiteArchitecture = lazyWithRetry(() => import('./SiteArchitecture').then(m => ({ default: m.SiteArchitecture })));

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
  metricsSource?: MetricsSource;
  validated?: boolean;
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
  optimizationScore?: number;
  optimizationIssues?: string[];
  recommendations?: string[];
  contentGaps?: string[];
  analysisGeneratedAt?: string;
  primaryKeywordPresence?: { inTitle: boolean; inMeta: boolean; inContent: boolean; inSlug: boolean };
  longTailKeywords?: string[];
  competitorKeywords?: string[];
  estimatedDifficulty?: string;
  keywordDifficulty?: number;
  monthlyVolume?: number;
  topicCluster?: string;
  searchIntentConfidence?: number;
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
  keywordDifficulty: number;
  monthlyVolume: number;
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: keywordData, isLoading: strategyLoading } = useKeywordStrategy(workspaceId);
  const strategy = keywordData?.strategy || null;

  // Tab state
  const [activeTab, setActiveTab] = useState<'pages' | 'architecture' | 'guide'>('pages');

  // All pages from webflow (static + CMS)
  const [allPages, setAllPages] = useState<PageMeta[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);

  // AI analysis state
  const [analyses, setAnalyses] = useState<Record<string, KeywordData>>({});
  const [contentScores, setContentScores] = useState<Record<string, ContentScore>>({});
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelBulkRef = useRef(false);
  const { jobs, startJob, cancelJob: cancelBgJob } = useBackgroundTasks();
  const bulkJobIdRef = useRef<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [showNextSteps, setShowNextSteps] = useState(false);

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

  // Rank tracking state
  const [trackedKeywords, setTrackedKeywords] = useState<Set<string>>(new Set());
  useEffect(() => {
    rankTracking.keywords(workspaceId)
      .then(kws => setTrackedKeywords(new Set((kws || []).map(k => k.query))))
      .catch(() => {});
  }, [workspaceId]);
  const trackKeyword = async (kw: string) => {
    if (!kw || trackedKeywords.has(kw)) return;
    try {
      await rankTracking.addKeyword(workspaceId, { query: kw });
      setTrackedKeywords(prev => new Set(prev).add(kw));
    } catch {
      // silently ignore duplicates
    }
  };
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Fetch all pages
  useEffect(() => {
    setPagesLoading(true);
    get<PageMeta[]>(`/api/webflow/all-pages/${siteId}`)
      .then(setAllPages)
      .catch(() => get<PageMeta[]>(`/api/webflow/pages/${siteId}`).then(setAllPages).catch(() => setAllPages([])))
      .finally(() => setPagesLoading(false));
  }, [siteId]);

  // Auto-expand target page from fixContext.
  // Caller: AuditIssueRow "Page" button sets targetRoute='page-intelligence'.
  // Guard on targetRoute so stale fixContext from other tabs doesn't auto-expand.
  // fixConsumed ref prevents re-triggering on subsequent renders after initial expand.
  const fixConsumed = useRef(false);
  useEffect(() => {
    if (fixContext?.pageSlug && fixContext.targetRoute === 'page-intelligence' && !fixConsumed.current && unifiedPages.length > 0) {
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

    // Build a lookup map for strategy entries by normalized path
    const strategyByPath = new Map<string, StrategyPage>();
    for (const sp of pageMap) {
      const norm = normalizePath(sp.pagePath);
      if (!strategyByPath.has(norm)) strategyByPath.set(norm, sp);
    }

    // Start with all webflow pages, enriched with strategy data (exact match only)
    for (const page of allPages) {
      const pagePath = resolvePagePath(page);
      const strategyMatch = strategyByPath.get(normalizePath(pagePath));
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
        // Deduplicate: skip if a page with this normalized path already exists
        const norm = normalizePath(sp.pagePath);
        if (result.some(r => normalizePath(r.path) === norm)) continue;
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

  // Derive effective analyses: always hydrate from persisted strategy data (keyed by
  // current page IDs), then overlay any fresh in-session analyses on top.
  const effectiveAnalyses = useMemo(() => {
    const fromStrategy: Record<string, KeywordData> = {};
    for (const page of unifiedPages) {
      const sp = page.strategy;
      if (sp?.analysisGeneratedAt && (sp.optimizationScore != null)) {
        fromStrategy[page.id] = {
          primaryKeyword: sp.primaryKeyword,
          primaryKeywordPresence: sp.primaryKeywordPresence || { inTitle: false, inMeta: false, inContent: false, inSlug: false },
          secondaryKeywords: sp.secondaryKeywords || [],
          longTailKeywords: sp.longTailKeywords || [],
          searchIntent: sp.searchIntent || 'informational',
          searchIntentConfidence: sp.searchIntentConfidence ?? 0.5,
          contentGaps: sp.contentGaps || [],
          competitorKeywords: sp.competitorKeywords || [],
          optimizationScore: sp.optimizationScore ?? 0,
          optimizationIssues: sp.optimizationIssues || [],
          recommendations: sp.recommendations || [],
          estimatedDifficulty: sp.estimatedDifficulty || 'medium',
          keywordDifficulty: sp.keywordDifficulty ?? 0,
          monthlyVolume: sp.monthlyVolume ?? 0,
          topicCluster: sp.topicCluster || '',
        };
      }
    }
    // Fresh in-session analyses take precedence over persisted data
    return { ...fromStrategy, ...analyses };
  }, [unifiedPages, analyses]);

  // ── AI Analysis ──
  const analyzePage = async (page: UnifiedPage) => {
    setAnalysisError(null);
    setShowNextSteps(false);
    setAnalyzing(prev => new Set(prev).add(page.id));
    try {
      let pageContent = '';
      let htmlSeoTitle: string | undefined;
      let htmlMetaDesc: string | undefined;
      try {
        const pagePath = page.publishedPath || page.path;
        if (pagePath) {
          const result = await get<{ text?: string; seoTitle?: string; metaDescription?: string }>(`/api/webflow/page-html/${siteId}?path=${encodeURIComponent(pagePath)}`);
          pageContent = result.text || '';
          htmlSeoTitle = result.seoTitle;
          htmlMetaDesc = result.metaDescription;
        }
      } catch { /* best-effort */ }

      // Use HTML-extracted title/meta for CMS pages that lack Webflow API seo data
      const effectiveTitle = page.seo?.title || htmlSeoTitle || page.title;
      const effectiveMeta = page.seo?.description || htmlMetaDesc;

      const [kwData, csData] = await Promise.all([
        post<KeywordData & { error?: string }>('/api/webflow/keyword-analysis', {
          pageTitle: page.title,
          seoTitle: effectiveTitle,
          metaDescription: effectiveMeta,
          slug: resolvePagePath(page),
          pageContent,
        }),
        post<ContentScore & { error?: string }>('/api/webflow/content-score', {
          pageTitle: page.title,
          seoTitle: effectiveTitle,
          metaDescription: effectiveMeta,
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
              primaryKeywordPresence: kwData.primaryKeywordPresence,
              longTailKeywords: kwData.longTailKeywords,
              competitorKeywords: kwData.competitorKeywords,
              estimatedDifficulty: kwData.estimatedDifficulty,
              keywordDifficulty: kwData.keywordDifficulty,
              monthlyVolume: kwData.monthlyVolume,
              topicCluster: kwData.topicCluster,
              searchIntentConfidence: kwData.searchIntentConfidence,
            },
          });
          // Invalidate strategy cache so persisted data shows up
          queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
        } catch { /* persist is best-effort */ }
      }
      if (!csData.error) {
        setContentScores(prev => ({ ...prev, [page.id]: csData }));
      }
    } catch (err) {
      console.error('Analysis failed:', err);
      setAnalysisError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(prev => { const n = new Set(prev); n.delete(page.id); return n; });
    }
  };

  // ── Bulk Analysis via Background Job ──
  const analyzeAllPages = async (forceRefresh = false) => {
    cancelBulkRef.current = false;
    setAnalysisError(null);
    setShowNextSteps(false);
    setBulkProgress({ done: 0, total: unifiedPages.length });
    const jobId = await startJob('page-analysis', { siteId, workspaceId, forceRefresh });
    if (jobId) {
      bulkJobIdRef.current = jobId;
    } else {
      setBulkProgress(null);
    }
  };

  // Watch background job progress via WebSocket
  const lastRefreshedAt = useRef(0);
  useEffect(() => {
    if (!bulkJobIdRef.current) return;
    const job = jobs.find(j => j.id === bulkJobIdRef.current);
    if (!job) return;
    if (job.status === 'running' || job.status === 'pending') {
      const progress = job.progress || 0;
      setBulkProgress({ done: progress, total: job.total || 0 });
      // Refresh strategy cache periodically so analyzed count updates mid-run
      if (progress > 0 && progress - lastRefreshedAt.current >= 5) {
        lastRefreshedAt.current = progress;
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
      }
    } else if (job.status === 'done') {
      setBulkProgress(null);
      setShowNextSteps(true);
      bulkJobIdRef.current = null;
      lastRefreshedAt.current = 0;
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
    } else if (job.status === 'error' || job.status === 'cancelled') {
      setBulkProgress(null);
      bulkJobIdRef.current = null;
      lastRefreshedAt.current = 0;
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
    }
  }, [jobs, queryClient, workspaceId]);

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
    const pageIdx = (strategy.pageMap ?? []).indexOf(page.strategy);
    if (pageIdx === -1) { setSaving(false); return; }
    const updated = [...(strategy.pageMap ?? [])];
    updated[pageIdx] = {
      ...updated[pageIdx],
      primaryKeyword: editDraft.primary.trim(),
      secondaryKeywords: editDraft.secondary.split(',').map(s => s.trim()).filter(Boolean),
    };
    try {
      await keywords.patchStrategy(workspaceId, { pageMap: updated });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
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
          const scoreA = effectiveAnalyses[a.id]?.optimizationScore ?? sa?.optimizationScore ?? -1;
          const scoreB = effectiveAnalyses[b.id]?.optimizationScore ?? sb?.optimizationScore ?? -1;
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
  const analyzedCount = Object.keys(effectiveAnalyses).length;
  const cmsCount = unifiedPages.filter(p => p.source === 'cms').length;
  const withStrategy = unifiedPages.filter(p => p.strategy).length;

  // ── Fix Queue: score × traffic impact ranking ──
  const fixQueue = unifiedPages
    .map(p => {
      const score = effectiveAnalyses[p.id]?.optimizationScore ?? p.strategy?.optimizationScore;
      const impressions = p.strategy?.impressions || 0;
      if (score === undefined || score === null) return null;
      // Impact = traffic potential lost due to poor optimization
      const impact = impressions > 0
        ? Math.round(impressions * (100 - score) / 100)
        : Math.max(1, 100 - score); // fallback: pure score gap
      return { page: p, score, impressions, impact };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.score < 75)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 5);

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
    <ErrorBoundary label="Page Intelligence">
    <div className="space-y-6">
      {/* tab-deeplink-ok — page intel tabs are not navigated to via ?tab= from other components */}
      <TabBar
        tabs={[
          { id: 'pages', label: 'Pages' },
          { id: 'architecture', label: 'Architecture' },
          { id: 'guide', label: 'Guide' },
        ]}
        active={activeTab}
        onChange={(id) => setActiveTab(id as 'pages' | 'architecture' | 'guide')}
      />

      {activeTab === 'architecture' && (
        <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" /></div>}>
          <SiteArchitecture key={`arch-${workspaceId}`} workspaceId={workspaceId} />
        </Suspense>
      )}

      {activeTab === 'guide' && <PageIntelligenceGuide />}

      {activeTab === 'pages' && (
      <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Page Intelligence</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {unifiedPages.length} pages
            {cmsCount > 0 && <span className="text-blue-400"> · {cmsCount} CMS</span>}
            {withStrategy > 0 && <span> · {withStrategy} with strategy</span>}
            {analyzedCount > 0 && <span className="text-teal-400"> · {analyzedCount} analyzed</span>}
          </p>
        </div>
        {/* Analyze All */}
        {bulkProgress ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-teal-500/10 border border-teal-500/30 rounded-lg">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
            <span className="text-xs text-zinc-300">Analyzing {bulkProgress.done}/{bulkProgress.total}...</span>
            <button onClick={() => { if (bulkJobIdRef.current) cancelBgJob(bulkJobIdRef.current); else cancelBulkRef.current = true; }} className="text-[11px] text-red-400 hover:text-red-300 ml-2">Cancel</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {analyzedCount > 0 && analyzedCount < unifiedPages.length && (
              <button
                onClick={() => analyzeAllPages(false)}
                disabled={analyzing.size > 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-teal-600/80 hover:bg-teal-500/80 text-white rounded-lg transition-colors disabled:opacity-40"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Analyze Remaining ({unifiedPages.length - analyzedCount})
              </button>
            )}
            <button
              onClick={() => analyzeAllPages(analyzedCount > 0)}
              disabled={analyzing.size > 0}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-40 ${
                analyzedCount > 0
                  ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200'
                  : 'bg-teal-600/80 hover:bg-teal-500/80 text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {analyzedCount > 0 ? 'Re-analyze All' : 'Analyze All Pages'}
            </button>
          </div>
        )}
      </div>
      {bulkProgress && (
        <ProgressIndicator
          status="running"
          detail={`Analyzing ${bulkProgress.done}/${bulkProgress.total}...`}
          percent={bulkProgress.total > 0 ? (bulkProgress.done / bulkProgress.total) * 100 : 0}
          onCancel={() => { if (bulkJobIdRef.current) cancelBgJob(bulkJobIdRef.current); else cancelBulkRef.current = true; }}
        />
      )}

      {analysisError && (
        <ErrorState
          type="general"
          title="Page Analysis Failed"
          message={analysisError}
          actions={[{ label: 'Dismiss', onClick: () => { setAnalysisError(null); }, variant: 'secondary' }]}
        />
      )}

      {showNextSteps && !bulkProgress && (
        <NextStepsCard
          title="Analysis complete"
          variant="success"
          onDismiss={() => setShowNextSteps(false)}
          staggerIndex={0}
          steps={[
            {
              label: 'Go to SEO Editor',
              onClick: () => navigate(adminPath(workspaceId, 'seo-editor')),
            },
          ]}
        />
      )}

      {/* Fix These First — impact-ranked priority queue */}
      {fixQueue.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-semibold text-amber-300">Fix These First</span>
            <span className="text-[10px] text-zinc-500 ml-auto">ranked by traffic × optimization gap</span>
          </div>
          <div className="space-y-1.5">
            {fixQueue.map((item, i) => (
              <button
                key={item.page.id}
                onClick={() => setExpanded(expanded === item.page.id ? null : item.page.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-800/50 transition-colors text-left"
              >
                <span className="text-[10px] font-mono text-zinc-500 w-4">{i + 1}.</span>
                <span className="text-[11px] text-zinc-200 truncate flex-1">{item.page.title || item.page.path}</span>
                {item.impressions > 0 && (
                  <span className="text-[10px] text-zinc-500">{item.impressions.toLocaleString()} imp</span>
                )}
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                  item.score < 40 ? 'text-red-400 bg-red-500/10' :
                  item.score < 60 ? 'text-amber-400 bg-amber-500/10' :
                  'text-yellow-400 bg-yellow-500/10'
                }`}>
                  {item.score}/100
                </span>
                <span className="text-[10px] text-amber-400/70 font-mono w-12 text-right">↑{item.impact}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
      <div className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
        {filtered.map(page => {
          const isExpanded = expanded === page.id;
          const isAnalyzing = analyzing.has(page.id);
          const kw = effectiveAnalyses[page.id];
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
                        <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">CMS</span>
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
                    <span className="inline-flex items-center gap-1 text-[11px] text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded max-w-[200px]">
                      <span className="truncate">{sp.primaryKeyword}</span>
                      <button
                        onClick={e => { e.stopPropagation(); trackKeyword(sp.primaryKeyword); }}
                        title={trackedKeywords.has(sp.primaryKeyword) ? 'Tracking' : 'Track in Rank Tracker'}
                        className={`flex-shrink-0 transition-colors ${trackedKeywords.has(sp.primaryKeyword) ? 'text-emerald-400' : 'text-teal-600 hover:text-teal-300'}`}
                      >
                        {trackedKeywords.has(sp.primaryKeyword) ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                      </button>
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
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-xs text-zinc-200">{sp.primaryKeyword}</p>
                            <button
                              onClick={() => trackKeyword(sp.primaryKeyword)}
                              title={trackedKeywords.has(sp.primaryKeyword) ? 'Tracking' : 'Track in Rank Tracker'}
                              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${trackedKeywords.has(sp.primaryKeyword) ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-teal-500/30 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20'}`}
                            >
                              {trackedKeywords.has(sp.primaryKeyword) ? <><Check className="w-2.5 h-2.5" /> Tracking</> : <><Plus className="w-2.5 h-2.5" /> Track</>}
                            </button>
                          </div>
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
                        <div className="bg-zinc-900 p-3 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
                          <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Optimization</div>
                          <div className={`text-2xl font-bold ${scoreColorClass(kw.optimizationScore)}`}>
                            {kw.optimizationScore}<span className="text-xs font-normal text-zinc-500">/100</span>
                          </div>
                          <div className="mt-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${scoreBgBarClass(kw.optimizationScore)}`} style={{ width: `${kw.optimizationScore}%` }} />
                          </div>
                        </div>
                        <div className="bg-zinc-900 p-3 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
                          <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Search Intent</div>
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-teal-500/20 text-teal-400 flex items-center justify-center text-xs font-bold">{intentIcon(kw.searchIntent)}</span>
                            <div>
                              <div className="text-sm font-medium text-zinc-200 capitalize">{kw.searchIntent}</div>
                              <div className="text-[11px] text-zinc-500">{Math.round(kw.searchIntentConfidence * 100)}% confidence</div>
                            </div>
                          </div>
                        </div>
                        <div className="bg-zinc-900 p-3 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
                          <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Difficulty</div>
                          <div className={`text-lg font-bold capitalize ${difficultyTextColor(kw.estimatedDifficulty)}`}>{kw.estimatedDifficulty}</div>
                          <div className="text-[11px] text-zinc-500 mt-0.5">Cluster: {kw.topicCluster}</div>
                        </div>
                      </div>

                      {/* Primary keyword presence */}
                      <div className="bg-zinc-900 p-3 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <Target className="w-3.5 h-3.5 text-teal-400" />
                          <span className="text-xs font-medium text-zinc-300">Primary Keyword: <span className="text-white">{kw.primaryKeyword}</span></span>
                          <button
                            onClick={() => trackKeyword(kw.primaryKeyword)}
                            title={trackedKeywords.has(kw.primaryKeyword) ? 'Tracking' : 'Track in Rank Tracker'}
                            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${trackedKeywords.has(kw.primaryKeyword) ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-teal-500/30 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20'}`}
                          >
                            {trackedKeywords.has(kw.primaryKeyword) ? <><Check className="w-2.5 h-2.5" /> Tracking</> : <><Plus className="w-2.5 h-2.5" /> Track</>}
                          </button>
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
                        <div className="bg-zinc-900 p-3 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
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
                        <div className="bg-zinc-900 p-3 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
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
                        <div className="bg-zinc-900 p-3 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
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
                            <div className="bg-zinc-900 p-3 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
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
                              <div className="bg-zinc-900 p-3 border border-red-500/20" style={{ borderRadius: '6px 12px 6px 12px' }}>
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
                              <div className="bg-zinc-900 p-3 border border-green-500/20" style={{ borderRadius: '6px 12px 6px 12px' }}>
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
                        <div className="bg-zinc-900 p-3 border border-zinc-800" style={{ borderRadius: '6px 12px 6px 12px' }}>
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
                              <div className="flex items-center gap-3">
                                <MetricRing score={cs.readabilityScore} size={64} noAnimation />
                                <div>
                                  <div className={`text-lg font-bold ${cs.readabilityScore >= 60 ? 'text-green-400' : cs.readabilityScore >= 30 ? 'text-amber-400' : 'text-red-400'}`}>
                                    {cs.readabilityScore}
                                  </div>
                                  <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Readability</div>
                                </div>
                              </div>
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

                  {/* ── Action bar ── */}
                  <div className="flex items-center gap-2 pt-3 mt-1 border-t border-zinc-800/60 flex-wrap">
                    <button
                      onClick={() => navigate(adminPath(workspaceId, 'seo-editor'), { state: { fixContext: { targetRoute: 'seo-editor', pageSlug: page.slug, pageName: page.title } } })}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-teal-400 bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/20 transition-all"
                    >
                      <Pencil className="w-3 h-3" /> Fix in SEO Editor
                    </button>
                    <button
                      onClick={() => {
                        navigate(adminPath(workspaceId, 'seo-briefs'), {
                          state: {
                            fixContext: {
                              targetRoute: 'seo-briefs',
                              pageSlug: page.slug,
                              pageName: page.title,
                              primaryKeyword: sp?.primaryKeyword || kw?.primaryKeyword || undefined,
                              searchIntent: sp?.searchIntent || kw?.searchIntent || undefined,
                              optimizationScore: sp?.optimizationScore ?? kw?.optimizationScore ?? undefined,
                              optimizationIssues: (sp?.optimizationIssues?.length ? sp.optimizationIssues : undefined) || (kw?.optimizationIssues?.length ? kw.optimizationIssues : undefined),
                              recommendations: (sp?.recommendations?.length ? sp.recommendations : undefined) || (kw?.recommendations?.length ? kw.recommendations : undefined),
                              contentGaps: (sp?.contentGaps?.length ? sp.contentGaps : undefined) || (kw?.contentGaps?.length ? kw.contentGaps : undefined),
                              autoGenerate: true,
                            },
                          },
                        });
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-teal-400 bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/20 transition-all"
                    >
                      <BookOpen className="w-3 h-3" /> Create Brief
                    </button>
                    {(kw?.optimizationIssues?.some(i => /schema|structured data/i.test(i)) || sp?.optimizationIssues?.some(i => /schema|structured data/i.test(i))) && (
                      <button
                        onClick={() => navigate(adminPath(workspaceId, 'seo-schema'), { state: { fixContext: { targetRoute: 'seo-schema', pageSlug: page.slug, pageName: page.title } } })}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-teal-400 bg-teal-500/10 hover:bg-teal-500/15 border border-teal-500/20 transition-all"
                      >
                        <Code2 className="w-3 h-3" /> Add Schema
                      </button>
                    )}
                    <div className="flex-1" />
                    <button
                      onClick={() => navigate(adminPath(workspaceId, 'page-intelligence'))}
                      className="flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      View full analysis <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </div>
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
      )}
    </div>
    </ErrorBoundary>
  );
}
