import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { adminPath } from '../routes';
import { TabBar } from './ui';
import { ErrorBoundary } from './ErrorBoundary';
import { useKeywordStrategy, usePageJoin } from '../hooks/admin';
import type { UnifiedPage } from '../../shared/types/page-join';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import type { FixContext } from '../App';
import { PageIntelligenceGuide } from './PageIntelligenceGuide';
import { buildEffectiveAnalyses, buildFilteredPages, buildFixQueue } from './page-intelligence/pageIntelligenceData';
import type { KeywordData, SortBy } from './page-intelligence/pageIntelligenceTypes';
import { PageIntelligencePageList } from './page-intelligence/PageIntelligencePageList';
import { PageIntelligencePagesHeader } from './page-intelligence/PageIntelligencePagesHeader';
import { usePageIntelligenceAnalysis } from './page-intelligence/usePageIntelligenceAnalysis';
import { usePageIntelligenceKeywordEditing } from './page-intelligence/usePageIntelligenceKeywordEditing';
import { usePageIntelligenceKeywordTracking } from './page-intelligence/usePageIntelligenceKeywordTracking';
import { usePageIntelligenceSeoCopy } from './page-intelligence/usePageIntelligenceSeoCopy';
import { matchPageIdentity } from '../lib/pathUtils';

const SiteArchitecture = lazyWithRetry(() => import('./SiteArchitecture').then(m => ({ default: m.SiteArchitecture })));

interface Props {
  workspaceId: string;
  siteId: string;
  fixContext?: FixContext | null;
}

// ── Component ──

export function PageIntelligence({ workspaceId, siteId, fixContext }: Props) {
  const navigate = useNavigate();
  const { data: keywordData } = useKeywordStrategy(workspaceId);
  const strategy = keywordData?.strategy || null;

  // Tab state
  const [activeTab, setActiveTab] = useState<'pages' | 'architecture' | 'guide'>('pages');

  // Unified page list (Webflow pages + strategy data)
  const { pages: unifiedPages, isLoading: pagesLoading } = usePageJoin(workspaceId, siteId);

  const {
    analyses,
    contentScores,
    analyzing,
    bulkProgress,
    cancellableBulkJobId,
    analysisError,
    showNextSteps,
    analyzePage,
    analyzeAllPages,
    cancelBulkJob,
    dismissAnalysisError,
    dismissNextSteps,
  } = usePageIntelligenceAnalysis({ workspaceId, siteId, pages: unifiedPages });

  // Page list UI state
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('priority');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const {
    editingPageId,
    editDraft,
    saving,
    startEdit,
    saveEdit,
    setEditDraft,
    cancelEdit,
  } = usePageIntelligenceKeywordEditing({ workspaceId, strategy });
  const { trackedKeywords, trackKeyword } = usePageIntelligenceKeywordTracking(workspaceId);
  const {
    generatingCopy,
    seoCopyResults,
    copiedField,
    generateSeoCopy,
    copyText,
  } = usePageIntelligenceSeoCopy({ workspaceId });

  // Auto-expand target page from fixContext.
  // Caller: AuditIssueRow "Page" button sets targetRoute='page-intelligence'.
  // Guard on targetRoute so stale fixContext from other tabs doesn't auto-expand.
  // fixConsumed ref prevents re-triggering on subsequent renders after initial expand.
  const fixConsumed = useRef(false);
  // effect-layout-ok: auto-expansion waits for async page data and should only happen once per fix context.
  useEffect(() => {
    if (fixContext?.pageSlug && fixContext.targetRoute === 'page-intelligence' && !fixConsumed.current && unifiedPages.length > 0) {
      const match = unifiedPages.find(p =>
        p.id === fixContext.pageId ||
        p.slug === fixContext.pageSlug ||
        (fixContext.pageSlug ? matchPageIdentity(p.path, fixContext.pageSlug) : false)
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
        onCancelBulkJob={cancelBulkJob}
        onDismissError={dismissAnalysisError}
        onDismissNextSteps={dismissNextSteps}
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
        onCancelEdit={cancelEdit}
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
