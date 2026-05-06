import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { adminPath } from '../routes';
import { TabBar } from './ui';
import { ErrorBoundary } from './ErrorBoundary';
import { queryKeys } from '../lib/queryKeys';
import { resolvePagePath } from '../lib/pathUtils';
import { get, post } from '../api/client';
import { keywords, rankTracking } from '../api/seo';
import { useKeywordStrategy, usePageJoin } from '../hooks/admin';
import type { UnifiedPage } from '../../shared/types/page-join';
import { useQueryClient } from '@tanstack/react-query';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import type { FixContext } from '../App';
import { PageIntelligenceGuide } from './PageIntelligenceGuide';
import { buildEffectiveAnalyses, buildFilteredPages, buildFixQueue } from './page-intelligence/pageIntelligenceData';
import type { BulkProgress, ContentScore, KeywordData, KeywordEditDraft, SeoCopy, SortBy } from './page-intelligence/pageIntelligenceTypes';
import { PageIntelligencePageList } from './page-intelligence/PageIntelligencePageList';
import { PageIntelligencePagesHeader } from './page-intelligence/PageIntelligencePagesHeader';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs';

const SiteArchitecture = lazyWithRetry(() => import('./SiteArchitecture').then(m => ({ default: m.SiteArchitecture })));

interface Props {
  workspaceId: string;
  siteId: string;
  fixContext?: FixContext | null;
}

// ── Component ──

export function PageIntelligence({ workspaceId, siteId, fixContext }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: keywordData } = useKeywordStrategy(workspaceId);
  const strategy = keywordData?.strategy || null;

  // Tab state
  const [activeTab, setActiveTab] = useState<'pages' | 'architecture' | 'guide'>('pages');

  // Unified page list (Webflow pages + strategy data)
  const { pages: unifiedPages, isLoading: pagesLoading } = usePageJoin(workspaceId, siteId);

  // AI analysis state
  const [analyses, setAnalyses] = useState<Record<string, KeywordData>>({});
  const [contentScores, setContentScores] = useState<Record<string, ContentScore>>({});
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const { jobs, startJob, findActiveJob, cancelJob: cancelBgJob } = useBackgroundTasks();
  const [bulkJobId, setBulkJobId] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [showNextSteps, setShowNextSteps] = useState(false);

  // Page list UI state
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('priority');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Keyword editing state
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<KeywordEditDraft>({ primary: '', secondary: '' });
  const [saving, setSaving] = useState(false);

  // SEO copy generation state
  const [generatingCopy, setGeneratingCopy] = useState<string | null>(null);
  const [seoCopyResults, setSeoCopyResults] = useState<Map<string, SeoCopy>>(new Map());
  const activePageAnalysisJob = findActiveJob({ type: BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, workspaceId });
  const trackedBulkJob = useMemo(
    () => (bulkJobId ? jobs.find(job => job.id === bulkJobId) : undefined) || activePageAnalysisJob,
    [activePageAnalysisJob, bulkJobId, jobs],
  );
  const trackedBulkJobId = trackedBulkJob?.id ?? null;
  const trackedBulkJobStatus = trackedBulkJob?.status ?? null;
  const trackedBulkJobProgress = trackedBulkJob?.progress;
  const trackedBulkJobTotal = trackedBulkJob?.total;
  const trackedBulkJobError = trackedBulkJob?.error;
  const trackedBulkJobMessage = trackedBulkJob?.message;
  const cancellableBulkJobId = bulkJobId || activePageAnalysisJob?.id || null;
  const bulkProgress = useMemo<BulkProgress | null>(() => {
    if (!trackedBulkJobStatus || trackedBulkJobStatus === 'done' || trackedBulkJobStatus === 'error' || trackedBulkJobStatus === 'cancelled') {
      return null;
    }
    return {
      done: trackedBulkJobProgress ?? 0,
      total: trackedBulkJobTotal ?? unifiedPages.length,
    };
  }, [trackedBulkJobProgress, trackedBulkJobStatus, trackedBulkJobTotal, unifiedPages.length]);

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

  // Auto-expand target page from fixContext.
  // Caller: AuditIssueRow "Page" button sets targetRoute='page-intelligence'.
  // Guard on targetRoute so stale fixContext from other tabs doesn't auto-expand.
  // fixConsumed ref prevents re-triggering on subsequent renders after initial expand.
  const fixConsumed = useRef(false);
  // effect-layout-ok: auto-expansion waits for async page data and should only happen once per fix context.
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
  }, [fixContext, unifiedPages]);

  // Derive effective analyses: always hydrate from persisted strategy data (keyed by
  // current page IDs), then overlay any fresh in-session analyses on top.
  const effectiveAnalyses = useMemo(() => {
    return buildEffectiveAnalyses(unifiedPages, analyses);
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
          const result = await get<{ text?: string; seoTitle?: string; metaDescription?: string }>(`/api/webflow/page-html/${siteId}?path=${encodeURIComponent(pagePath)}${workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ''}`);
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
    setAnalysisError(null);
    setShowNextSteps(false);
    const jobId = await startJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, { siteId, workspaceId, forceRefresh });
    if (jobId) {
      setBulkJobId(jobId);
    }
  };

  // effect-layout-ok: active page-analysis jobs can predate this component mount.
  useEffect(() => {
    if (activePageAnalysisJob && !bulkJobId) {
      setBulkJobId(activePageAnalysisJob.id);
    }
  }, [activePageAnalysisJob, bulkJobId]);

  // Watch background job progress via WebSocket
  const lastRefreshedAt = useRef(0);
  // effect-layout-ok: job terminal state arrives asynchronously from the shared background task stream.
  useEffect(() => {
    if (!trackedBulkJobStatus) return;
    if (trackedBulkJobStatus === 'running' || trackedBulkJobStatus === 'pending') {
      const progress = trackedBulkJobProgress || 0;
      // Refresh strategy cache periodically so analyzed count updates mid-run
      if (progress > 0 && progress - lastRefreshedAt.current >= 5) {
        lastRefreshedAt.current = progress;
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
      }
    } else if (trackedBulkJobStatus === 'done') {
      setShowNextSteps(true);
      setBulkJobId(null);
      lastRefreshedAt.current = 0;
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.pageJoinPages(siteId, workspaceId) });
    } else if (trackedBulkJobStatus === 'error' || trackedBulkJobStatus === 'cancelled') {
      setBulkJobId(null);
      lastRefreshedAt.current = 0;
      if (trackedBulkJobStatus === 'error') {
        setAnalysisError(trackedBulkJobError || trackedBulkJobMessage || 'Page analysis failed');
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
    }
  }, [
    queryClient,
    siteId,
    trackedBulkJobError,
    trackedBulkJobId,
    trackedBulkJobMessage,
    trackedBulkJobProgress,
    trackedBulkJobStatus,
    workspaceId,
  ]);

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
    // page.strategy is a direct reference into strategy.pageMap — indexOf depends on object identity
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
  const filtered = buildFilteredPages({
    pages: unifiedPages,
    search,
    sortBy,
    sortDir,
    analyses: effectiveAnalyses,
  });

  // ── Stats ──
  const analyzedCount = Object.keys(effectiveAnalyses).length;
  const cmsCount = unifiedPages.filter(p => p.source === 'cms').length;
  const withStrategy = unifiedPages.filter(p => p.strategy).length;

  // ── Fix Queue: score × traffic impact ranking ──
  const fixQueue = buildFixQueue(unifiedPages, effectiveAnalyses);

  const handleSortChange = (nextSortBy: SortBy) => {
    if (sortBy === nextSortBy) {
      setSortDir(dir => dir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(nextSortBy);
      setSortDir('desc');
    }
  };

  const openSeoEditorForPage = (page: UnifiedPage) => {
    navigate(adminPath(workspaceId, 'seo-editor'), {
      state: {
        fixContext: {
          targetRoute: 'seo-editor',
          pageSlug: page.slug,
          pageName: page.title,
        },
      },
    });
  };

  const createBriefForPage = (page: UnifiedPage, kw?: KeywordData) => {
    const sp = page.strategy;
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
  };

  const openSchemaForPage = (page: UnifiedPage) => {
    navigate(adminPath(workspaceId, 'seo-schema'), {
      state: {
        fixContext: {
          targetRoute: 'seo-schema',
          pageSlug: page.slug,
          pageName: page.title,
        },
      },
    });
  };

  const loading = pagesLoading;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-accent-brand" />
        <span className="ml-3 t-body text-[var(--brand-text)]">Loading page intelligence...</span>
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
        <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="w-5 h-5 border-2 rounded-[var(--radius-pill)] animate-spin border-[var(--brand-border)] border-t-teal-400" /></div>}>
          <SiteArchitecture key={`arch-${workspaceId}`} workspaceId={workspaceId} />
        </Suspense>
      )}

      {activeTab === 'guide' && <PageIntelligenceGuide />}

      {activeTab === 'pages' && (
      <div className="space-y-8">
      <PageIntelligencePagesHeader
        pageCount={unifiedPages.length}
        cmsCount={cmsCount}
        withStrategy={withStrategy}
        analyzedCount={analyzedCount}
        analyzingCount={analyzing.size}
        bulkProgress={bulkProgress}
        cancellableBulkJobId={cancellableBulkJobId}
        analysisError={analysisError}
        showNextSteps={showNextSteps}
        fixQueue={fixQueue}
        search={search}
        sortBy={sortBy}
        sortDir={sortDir}
        onAnalyzeRemaining={() => analyzeAllPages(false)}
        onAnalyzeAll={() => analyzeAllPages(analyzedCount > 0)}
        onCancelBulkJob={cancelBgJob}
        onDismissError={() => setAnalysisError(null)}
        onDismissNextSteps={() => setShowNextSteps(false)}
        onGoToSeoEditor={() => navigate(adminPath(workspaceId, 'seo-editor'))}
        onToggleFixQueuePage={pageId => setExpanded(prev => prev === pageId ? null : pageId)}
        onSearchChange={setSearch}
        onSortChange={handleSortChange}
      />

      <PageIntelligencePageList
        pages={filtered}
        search={search}
        expandedPageId={expanded}
        analyzingPageIds={analyzing}
        analyses={effectiveAnalyses}
        contentScores={contentScores}
        editingPageId={editingPageId}
        editDraft={editDraft}
        saving={saving}
        seoCopyResults={seoCopyResults}
        generatingCopy={generatingCopy}
        copiedField={copiedField}
        trackedKeywords={trackedKeywords}
        onToggleExpanded={pageId => setExpanded(prev => prev === pageId ? null : pageId)}
        onTrackKeyword={trackKeyword}
        onStartEdit={startEdit}
        onEditDraftChange={setEditDraft}
        onSaveEdit={saveEdit}
        onCancelEdit={() => setEditingPageId(null)}
        onAnalyzePage={analyzePage}
        onGenerateSeoCopy={generateSeoCopy}
        onCopyText={copyText}
        onOpenSeoEditor={openSeoEditorForPage}
        onCreateBrief={createBriefForPage}
        onAddSchema={openSchemaForPage}
        onViewFullAnalysis={() => navigate(adminPath(workspaceId, 'page-intelligence'))}
      />
      </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
