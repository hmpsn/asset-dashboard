// @ds-rebuilt
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { adminPath } from '../../routes';
import { useKeywordStrategy, usePageJoin, useWorkspaces } from '../../hooks/admin';
import { useLocalSeo } from '../../hooks/admin/useLocalSeo';
import { localSeoKeywordVisibilitySummaryFromSnapshots } from '../../../shared/types/local-seo';
import type { LocalSeoKeywordVisibilitySummary, LocalVisibilitySnapshot } from '../../../shared/types/local-seo';
import type { UnifiedPage } from '../../../shared/types/page-join';
import type { FixContext } from '../../types/fix-context';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { keywordComparisonKey } from '../../../shared/keyword-normalization';
import { ErrorBoundary } from '../ErrorBoundary';
import { PageIntelligenceGuide } from '../PageIntelligenceGuide';
import {
  Badge,
  Button,
  ClickableRow,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  ProgressIndicator,
  SearchField,
  Segmented,
  NextStepsCard,
  scoreColorClass,
} from '../ui';
import { buildEffectiveAnalyses, buildFilteredPages, buildFixQueue } from '../page-intelligence/pageIntelligenceData';
import type { KeywordData, SortBy } from '../page-intelligence/pageIntelligenceTypes';
import { usePageIntelligenceAnalysis } from '../page-intelligence/usePageIntelligenceAnalysis';
import { usePageIntelligenceKeywordEditing } from '../page-intelligence/usePageIntelligenceKeywordEditing';
import { usePageIntelligenceKeywordTracking } from '../page-intelligence/usePageIntelligenceKeywordTracking';
import { usePageIntelligenceSeoCopy } from '../page-intelligence/usePageIntelligenceSeoCopy';
import { LocalSeoVisibilityPanel } from '../local-seo/LocalSeoVisibilityPanel';
import { PageIntelligenceDetailPane } from './PageIntelligenceDetailPane';
import { resolveInitialPage, resolvePageIntelligenceTab, type IntelligenceTab } from './pageIntelligenceRouting';

const SiteArchitecture = lazyWithRetry(() => import('../SiteArchitecture').then(module => ({ default: module.SiteArchitecture })));

const TABS: IntelligenceTab[] = ['pages', 'architecture', 'guide'];
const SORT_OPTIONS = [
  { value: 'priority', label: 'Priority' },
  { value: 'position', label: 'Position' },
  { value: 'volume', label: 'Volume' },
  { value: 'score', label: 'Score' },
];

interface PageIntelligenceSurfaceProps {
  workspaceId: string;
}

function readPageIntelligenceFixContext(state: unknown): FixContext | null {
  const fixContext = (state as { fixContext?: FixContext } | null)?.fixContext;
  return fixContext?.targetRoute === 'page-intelligence' ? fixContext : null;
}

export function PageIntelligenceSurface({ workspaceId }: PageIntelligenceSurfaceProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaces = useWorkspaces();
  const workspace = workspaces.data?.find(item => item.id === workspaceId);
  const siteId = workspace?.webflowSiteId ?? '';
  const routeFixContext = useMemo(() => readPageIntelligenceFixContext(location.state), [location.state]);
  const retainedFixContext = useRef<FixContext | null>(routeFixContext);
  const fixContext = routeFixContext ?? retainedFixContext.current;
  const activeTab = resolvePageIntelligenceTab(searchParams.get('tab'));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('priority');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const initialSelectionResolved = useRef<string | null>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const pageRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectionOriginRef = useRef<HTMLElement | null>(null);
  const pendingReturnFocusRef = useRef<{ pageId: string; origin: HTMLElement | null } | null>(null);

  const keywordQuery = useKeywordStrategy(workspaceId);
  const strategy = keywordQuery.data?.strategy ?? null;
  const localSeoQuery = useLocalSeo(workspaceId, { includeSnapshots: true });
  const pageJoin = usePageJoin(workspaceId, siteId);
  const analysis = usePageIntelligenceAnalysis({ workspaceId, siteId, pages: pageJoin.pages });
  const keywordEditing = usePageIntelligenceKeywordEditing({ workspaceId, strategy });
  const keywordTracking = usePageIntelligenceKeywordTracking(workspaceId);
  const seoCopy = usePageIntelligenceSeoCopy({ workspaceId });

  // Dashboard clears router state after consuming it. Preserve this receiver's
  // context until cold page/strategy queries settle so the intended page can
  // still be selected after that replace-navigation has completed.
  useEffect(() => {
    if (routeFixContext) {
      retainedFixContext.current = routeFixContext;
      initialSelectionResolved.current = null;
    }
  }, [routeFixContext]);

  const effectiveAnalyses = useMemo(
    () => buildEffectiveAnalyses(pageJoin.pages, analysis.analyses),
    [analysis.analyses, pageJoin.pages],
  );
  const filteredPages = useMemo(() => buildFilteredPages({
    pages: pageJoin.pages,
    search,
    sortBy,
    sortDir,
    analyses: effectiveAnalyses,
  }), [effectiveAnalyses, pageJoin.pages, search, sortBy, sortDir]);
  const fixQueue = useMemo(() => buildFixQueue(pageJoin.pages, effectiveAnalyses), [effectiveAnalyses, pageJoin.pages]);
  const selectedPage = pageJoin.pages.find(page => page.id === selectedId);

  const localSeoByKeyword = useMemo(() => {
    const result = new Map<string, LocalSeoKeywordVisibilitySummary>();
    if (!localSeoQuery.data?.featureEnabled) return result;
    const grouped = new Map<string, LocalVisibilitySnapshot[]>();
    for (const snapshot of localSeoQuery.data.latestSnapshots) {
      if (!snapshot.normalizedKeyword) continue;
      grouped.set(snapshot.normalizedKeyword, [...(grouped.get(snapshot.normalizedKeyword) ?? []), snapshot]);
    }
    for (const [keyword, snapshots] of grouped) {
      const summary = localSeoKeywordVisibilitySummaryFromSnapshots(snapshots);
      if (summary) result.set(keyword, summary);
    }
    return result;
  }, [localSeoQuery.data]);

  useEffect(() => {
    if (pageJoin.isLoading) return;
    if (pageJoin.pages.length === 0) return;
    const pageParam = searchParams.get('page');
    const selectionKey = `${workspaceId}:${pageParam ?? ''}`;
    if (initialSelectionResolved.current === selectionKey) return;
    const resolvedPage = resolveInitialPage(pageJoin.pages, pageParam, fixContext);
    const hasRequestedPage = pageParam !== null || fixContext !== null;
    if (hasRequestedPage && !resolvedPage && pageJoin.isFetching) return;
    initialSelectionResolved.current = selectionKey;
    setSelectedId(resolvedPage?.id ?? null);
    retainedFixContext.current = null;
  }, [fixContext, pageJoin.isFetching, pageJoin.isLoading, pageJoin.pages, searchParams, workspaceId]);

  useEffect(() => {
    if (selectedId) {
      const isMobileWorkbench = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(max-width: 767px)').matches;
      if (isMobileWorkbench) backButtonRef.current?.focus();
      return;
    }

    const pending = pendingReturnFocusRef.current;
    if (!pending) return;
    pendingReturnFocusRef.current = null;
    const origin = pending.origin?.isConnected ? pending.origin : pageRowRefs.current.get(pending.pageId);
    origin?.focus();
    selectionOriginRef.current = null;
  }, [selectedId]);

  const updateTab = (tab: IntelligenceTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'pages') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const selectPage = (page: UnifiedPage | null, origin?: HTMLElement) => {
    if (page && origin) selectionOriginRef.current = origin;
    setSelectedId(page?.id ?? null);
    const next = new URLSearchParams(searchParams);
    if (page) next.set('page', page.id);
    else next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const returnToPageList = () => {
    if (selectedId) {
      pendingReturnFocusRef.current = {
        pageId: selectedId,
        origin: selectionOriginRef.current,
      };
    }
    selectPage(null);
  };

  const changeSort = (next: string) => {
    const value = next as SortBy;
    if (sortBy === value) setSortDir(current => current === 'desc' ? 'asc' : 'desc');
    else {
      setSortBy(value);
      setSortDir('desc');
    }
  };

  const openSeoEditor = (page: UnifiedPage) => navigate(adminPath(workspaceId, 'seo-editor'), {
    state: { fixContext: { targetRoute: 'seo-editor', pageSlug: page.slug, pageName: page.title } },
  });
  const createBrief = (page: UnifiedPage, result?: KeywordData) => navigate(`${adminPath(workspaceId, 'content-pipeline')}?tab=briefs`, {
    state: {
      fixContext: {
        targetRoute: 'content-pipeline',
        pageSlug: page.slug,
        pageName: page.title,
        primaryKeyword: page.strategy?.primaryKeyword || result?.primaryKeyword,
        searchIntent: page.strategy?.searchIntent || result?.searchIntent,
        optimizationScore: page.strategy?.optimizationScore ?? result?.optimizationScore,
        optimizationIssues: page.strategy?.optimizationIssues?.length ? page.strategy.optimizationIssues : result?.optimizationIssues,
        recommendations: page.strategy?.recommendations?.length ? page.strategy.recommendations : result?.recommendations,
        contentGaps: page.strategy?.contentGaps?.length ? page.strategy.contentGaps : result?.contentGaps,
        autoGenerate: true,
      },
    },
  });
  const openSchema = (page: UnifiedPage) => navigate(adminPath(workspaceId, 'seo-schema'), {
    state: { fixContext: { targetRoute: 'seo-schema', pageSlug: page.slug, pageName: page.title } },
  });
  const openTraffic = () => navigate(adminPath(workspaceId, 'analytics-hub'));

  if (workspaces.isLoading) return <LoadingState message="Resolving this workspace..." className="py-20" />;
  if (!siteId) {
    return (
      <EmptyState
        icon={() => <Icon name="link" size="xl" />}
        title="Connect a Webflow site"
        description="Page Intelligence needs a linked site to assemble editable pages and strategy evidence."
        action={(
          <Button size="sm" variant="primary" onClick={() => navigate(`${adminPath(workspaceId, 'workspace-settings')}?tab=connections`)}>
            <Icon name="settings" size="sm" />
            Open Workspace Settings
          </Button>
        )}
      />
    );
  }
  if (pageJoin.isLoading) return <LoadingState message="Assembling page intelligence and strategy mappings..." className="py-20" />;
  if (pageJoin.error) {
    return <ErrorState title="Couldn't load Page Intelligence" message="The page inventory or strategy mapping did not load." action={{ label: 'Retry', onClick: pageJoin.refetch }} type="data" />;
  }

  const analyzedCount = Object.keys(effectiveAnalyses).length;
  const withStrategy = pageJoin.pages.filter(page => page.strategy).length;
  const cmsCount = pageJoin.pages.filter(page => page.source === 'cms').length;

  return (
    <ErrorBoundary label="Page Intelligence">
      {/* pr-check-disable-next-line -- prototype Research workbench is one bounded asymmetric desktop canvas, not a content card */}
      <section className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-signature-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]" style={{ height: 'calc(100vh - var(--shell-topbar) - var(--page-pad-y) - var(--page-pad-bottom))' }}>
        <header className="flex-none border-b border-[var(--brand-border)] bg-[var(--surface-2)] px-5 pt-4">
          <div className="flex flex-col items-start gap-3 pb-3 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 t-micro font-semibold uppercase tracking-[0.08em] text-accent-brand">
                <span className="h-1.5 w-1.5 rounded-[var(--radius-pill)] bg-[var(--teal)]" />
                Research workbench
              </div>
              <h1 className="t-h2 text-[var(--brand-text-bright)]">Page Intelligence</h1>
              <p className="mt-0.5 t-caption-sm text-[var(--brand-text-muted)]">
                <strong className="font-semibold text-[var(--brand-text)]">{pageJoin.pages.length}</strong> pages · {cmsCount} CMS · {withStrategy} mapped · {analyzedCount} analyzed
              </p>
            </div>
            {activeTab === 'pages' && (
              <div className="flex flex-wrap items-center gap-2">
                {analysis.bulkProgress ? (
                  <Button variant="secondary" size="sm" onClick={() => analysis.cancellableBulkJobId && analysis.cancelBulkJob(analysis.cancellableBulkJobId)} disabled={!analysis.cancellableBulkJobId}>Cancel analysis</Button>
                ) : (
                  <>
                    {analyzedCount > 0 && analyzedCount < pageJoin.pages.length && <Button variant="primary" size="sm" onClick={() => analysis.analyzeAllPages(false)}>Analyze remaining</Button>}
                    <Button variant={analyzedCount > 0 ? 'secondary' : 'primary'} size="sm" onClick={() => analysis.analyzeAllPages(analyzedCount > 0)}>{analyzedCount > 0 ? 'Re-analyze all' : 'Analyze all pages'}</Button>
                  </>
                )}
              </div>
            )}
          </div>
          <nav className="flex gap-5" aria-label="Page Intelligence sections">
            {TABS.map(tab => (
              <Button key={tab} variant="ghost" size="sm" onClick={() => updateTab(tab)} className={`rounded-none border-b-2 px-0.5 pb-2 t-ui font-medium capitalize ${activeTab === tab ? 'border-[var(--teal)] text-[var(--teal)]' : 'border-transparent text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'}`}>{tab}</Button>
            ))}
          </nav>
        </header>

        {activeTab === 'architecture' && <div className="min-h-0 flex-1 overflow-auto p-5"><Suspense fallback={<LoadingState message="Mapping site architecture..." className="py-20" />}><SiteArchitecture workspaceId={workspaceId} /></Suspense></div>}
        {activeTab === 'guide' && <div className="min-h-0 flex-1 overflow-auto p-5"><PageIntelligenceGuide /></div>}
        {activeTab === 'pages' && (
          <div className="flex min-h-0 flex-1 flex-col">
            {analysis.bulkProgress && <div className="flex-none px-4 pt-3"><ProgressIndicator status="running" detail={`Analyzing ${analysis.bulkProgress.done}/${analysis.bulkProgress.total} pages`} percent={analysis.bulkProgress.total ? analysis.bulkProgress.done / analysis.bulkProgress.total * 100 : 0} onCancel={analysis.cancellableBulkJobId ? () => analysis.cancelBulkJob(analysis.cancellableBulkJobId!) : undefined} /></div>}
            {analysis.analysisError && <div className="flex-none px-4 pt-3"><ErrorState title="Page analysis failed" message={analysis.analysisError} type="general" actions={[{ label: 'Dismiss', onClick: analysis.dismissAnalysisError, variant: 'secondary' }]} /></div>}
            {analysis.showNextSteps && !analysis.bulkProgress && <div className="flex-none px-4 pt-3"><NextStepsCard title="Analysis complete" variant="success" onDismiss={analysis.dismissNextSteps} steps={[{ label: 'Go to SEO Editor', onClick: () => navigate(adminPath(workspaceId, 'seo-editor')) }]} /></div>}
            <div className={`${selectedPage ? 'hidden md:block' : 'block'} flex-none px-4 pt-3`}><LocalSeoVisibilityPanel workspaceId={workspaceId} mode="page" onOpenKeywords={() => navigate(adminPath(workspaceId, 'seo-keywords'))} /></div>
            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(360px,42%)_minmax(0,1fr)]">
              <aside className={`${selectedPage ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-r border-[var(--brand-border)] bg-[var(--surface-1)]/40`}>
                <div className="flex-none space-y-2 border-b border-[var(--brand-border)] p-3">
                  <SearchField value={search} onChange={setSearch} placeholder="Search pages or keywords…" className="py-1.5" />
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                    <Segmented options={SORT_OPTIONS} value={sortBy} onChange={changeSort} className="w-full sm:w-auto [&_button]:min-w-0 [&_button]:flex-1 [&_button]:px-1.5 [&_button]:py-1.5 sm:[&_button]:flex-none sm:[&_button]:px-2.5" />
                    <span className="self-end t-micro font-mono uppercase tracking-[0.06em] text-[var(--brand-text-dim)] sm:self-auto">{sortDir === 'desc' ? 'High → low' : 'Low → high'}</span>
                  </div>
                  {fixQueue.length > 0 && (
                    <ClickableRow onClick={event => selectPage(fixQueue[0]?.page ?? null, event.currentTarget)} className="flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-[var(--amber)] bg-[var(--brand-yellow-dim)] px-2.5 py-2 text-left hover:border-[var(--brand-yellow)]">
                      <Icon name="zap" size="sm" className="text-accent-warning" />
                      <span className="min-w-0 flex-1 t-caption-sm text-[var(--brand-text)]"><strong className="font-semibold text-accent-warning">Fix first:</strong> {fixQueue[0]?.page.title}</span>
                      <span className="t-micro font-mono text-[var(--brand-text-muted)]">+{fixQueue[0]?.impact}</span>
                    </ClickableRow>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Page inventory">
                  {filteredPages.map(page => {
                    const result = effectiveAnalyses[page.id];
                    const score = result?.optimizationScore ?? page.strategy?.optimizationScore;
                    const isSelected = page.id === selectedId;
                    return (
                      <ClickableRow
                        key={page.id}
                        ref={node => {
                          if (node) pageRowRefs.current.set(page.id, node);
                          else pageRowRefs.current.delete(page.id);
                        }}
                        onClick={event => selectPage(page, event.currentTarget)}
                        active={isSelected}
                        className={`group flex w-full items-center gap-3 border-b border-[var(--brand-border)]/60 px-3 py-2.5 text-left ${isSelected ? 'bg-[var(--surface-3)]' : 'hover:bg-[var(--surface-3)]/55'}`}
                        aria-pressed={isSelected}
                      >
                        <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-md)] border ${page.source === 'cms' ? 'border-[var(--blue)] bg-[var(--blue-ghost)] text-accent-info' : 'border-[var(--brand-border)] bg-[var(--surface-2)] text-[var(--brand-text-muted)]'}`}><Icon name={page.source === 'cms' ? 'layers' : 'file'} size="sm" /></span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate t-caption font-medium ${isSelected ? 'text-[var(--teal)]' : 'text-[var(--brand-text-bright)]'}`}>{page.title}</span>
                          <span className="mt-0.5 flex items-center gap-1.5">
                            <span className="max-w-[45%] truncate t-micro font-mono text-[var(--brand-text-dim)]">{page.path}</span>
                            {page.strategy?.primaryKeyword && <span className="truncate t-caption-sm text-[var(--brand-text-muted)]">· {page.strategy.primaryKeyword}</span>}
                          </span>
                        </span>
                        {analysis.analyzing.has(page.id)
                          ? <Icon name="refresh" size="sm" className="animate-spin text-accent-brand" />
                          : score !== undefined
                            ? <span className={`t-caption font-bold tabular-nums ${scoreColorClass(score)}`}>{score}</span>
                            : <Badge label={page.strategy ? 'Mapped' : 'Unmapped'} tone={page.strategy ? 'blue' : 'zinc'} />}
                      </ClickableRow>
                    );
                  })}
                  {filteredPages.length === 0 && <EmptyState icon={() => <Icon name="search" size="xl" />} title="No matching pages" description="Try a page title, path, or target keyword." className="py-14" />}
                </div>
              </aside>
              <PageIntelligenceDetailPane
                page={selectedPage}
                analysis={selectedPage ? effectiveAnalyses[selectedPage.id] : undefined}
                contentScore={selectedPage ? analysis.contentScores[selectedPage.id] : undefined}
                isAnalyzing={selectedPage ? analysis.analyzing.has(selectedPage.id) : false}
                editing={keywordEditing}
                tracking={keywordTracking}
                seoCopy={seoCopy}
                localSeoVisibility={selectedPage?.strategy?.primaryKeyword ? localSeoByKeyword.get(keywordComparisonKey(selectedPage.strategy.primaryKeyword)) : undefined}
                onAnalyzePage={analysis.analyzePage}
                onOpenSeoEditor={openSeoEditor}
                onCreateBrief={createBrief}
                onAddSchema={openSchema}
                onViewTraffic={openTraffic}
                onBackToPages={returnToPageList}
                backButtonRef={backButtonRef}
              />
            </div>
          </div>
        )}
      </section>
    </ErrorBoundary>
  );
}
