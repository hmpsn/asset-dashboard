import { useState, useMemo } from 'react';
import { post } from '../api/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FixContext } from '../App';
import { seoSuggestions } from '../api/seo';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import { queryKeys } from '../lib/queryKeys';
import { useRecommendations } from '../hooks/useRecommendations';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { useSeoEditor, usePageJoin } from '../hooks/admin';
import { LoadingState } from './ui';
import { useToast } from './Toast';
import { SeoEditorTableControls } from './editor/SeoEditorTableControls';
import { SeoEditorTrackingSummary } from './editor/SeoEditorTrackingSummary';
import { SeoEditorHeaderActions } from './editor/SeoEditorHeaderActions';
import { SeoEditorPageList } from './editor/SeoEditorPageList';
import { SeoEditorWorkflowPanels } from './editor/SeoEditorWorkflowPanels';
import { resolvePagePath } from '../lib/pathUtils';
import {
  filterAndSortSeoPages,
} from './editor/seoEditorDerived';
import { filterWritablePages } from '../hooks/admin/seoEditorFilters';
import { useSeoEditorApprovalWorkflow } from './editor/useSeoEditorApprovalWorkflow';
import { useSeoEditorPageWorkflow } from './editor/useSeoEditorPageWorkflow';
import { useSeoEditorBulkWorkflow } from './editor/useSeoEditorBulkWorkflow';
import { useSeoEditorSessionState } from './editor/useSeoEditorSessionState';

interface Props {
  siteId: string;
  workspaceId?: string;
  fixContext?: FixContext | null;
  externalSearch?: string;
}

export function SeoEditor({ siteId, workspaceId, fixContext, externalSearch }: Props) {
  const { forPage: recsForPage, loaded: recsLoaded } = useRecommendations(workspaceId);
  const queryClient = useQueryClient();
  const { cancelJob, startJob, trackJob } = useBackgroundTasks();
  const { toast } = useToast();
  
  // React Query hook replaces manual data fetching
  const { data: pages = [], isLoading: loading } = useSeoEditor(siteId, workspaceId);

  // Unified page join: derives analyzedPages and pageKeywordMap from joined Webflow + strategy data
  const { pages: unified } = usePageJoin(workspaceId ?? '', siteId);
  // Immediate feedback state for pages just analyzed in this session
  const [localAnalyzedPages, setLocalAnalyzedPages] = useState<Set<string>>(new Set());
  const analyzedPages = useMemo(
    () => new Set([...unified.filter(p => p.analyzed).map(p => p.id), ...localAnalyzedPages]),
    [unified, localAnalyzedPages],
  );
  const pageKeywordMap = useMemo(() => {
    const map = new Map<string, { primaryKeyword: string; secondaryKeywords: string[] }>();
    for (const p of unified) {
      if (p.strategy?.primaryKeyword) {
        map.set(p.id, {
          primaryKeyword: p.strategy.primaryKeyword,
          secondaryKeywords: p.strategy.secondaryKeywords ?? [],
        });
      }
    }
    return map;
  }, [unified]);
  
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [search, setSearch] = useState('');
  const effectiveSearch = externalSearch ?? search;
  const writablePages = useMemo(() => filterWritablePages(pages), [pages]);
  const cmsPageCount = pages.length - writablePages.length;
  const {
    edits,
    setEdits,
    expanded,
    variations,
    setVariations,
    previewExpanded,
    hasUnsaved,
    toggleExpand,
    togglePreview,
  } = useSeoEditorSessionState({
    siteId,
    workspaceId,
    pages: writablePages,
    fixContext,
  });
  const { getState, refresh: refreshStates, summary } = usePageEditStates(workspaceId);

  // SEO Suggestions (persistent bulk rewrite variations)
  const { data: suggestionsData, refetch: refetchSuggestions } = useQuery({
    queryKey: queryKeys.admin.seoSuggestions(workspaceId!),
    queryFn: () => seoSuggestions.list(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  const {
    saving,
    saved,
    draftSaving,
    draftSaved,
    aiLoading,
    errorStates,
    analyzing,
    updateField,
    saveDraft,
    savePage,
    aiRewrite,
    analyzePage,
  } = useSeoEditorPageWorkflow({
    siteId,
    workspaceId,
    pages: writablePages,
    edits,
    setEdits,
    setVariations,
    queryClient,
    refreshStates,
    setLocalAnalyzedPages,
  });

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const data = await post<{ success?: boolean }>(`/api/webflow/publish/${siteId}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`);
      if (data.success) {
        setPublished(true);
        setTimeout(() => setPublished(false), 3000);
      }
    } catch (err) {
      console.error('Publish failed:', err);
    } finally {
      setPublishing(false);
    }
  };

  const resetAllTracking = async () => {
    if (!workspaceId) return;
    await post(`/api/workspaces/${workspaceId}/page-states/clear`, { status: 'all' });
    refreshStates();
  };

  const metadataRecommendationCountByPageId = useMemo(() => {
    if (!recsLoaded) return new Map<string, number>();
    return new Map(
      writablePages.map(page => [
        page.id,
        recsForPage(resolvePagePath(page)).filter((recommendation: { type: string }) => recommendation.type === 'metadata').length,
      ]),
    );
  }, [writablePages, recsLoaded, recsForPage]);

  const filteredPages = useMemo(
    () => filterAndSortSeoPages(writablePages, { search: effectiveSearch, metadataRecommendationCountByPageId }),
    [writablePages, effectiveSearch, metadataRecommendationCountByPageId],
  );
  const analyzedWritablePagesCount = useMemo(
    () => writablePages.filter(page => analyzedPages.has(page.id)).length,
    [writablePages, analyzedPages],
  );
  const {
    approvalSelected,
    sendingApproval,
    approvalSent,
    approvalRefreshKey,
    sendingPage,
    sentPage,
    toggleApprovalSelect,
    selectAllForApproval,
    sendPageToClient,
    sendForApproval,
  } = useSeoEditorApprovalWorkflow({
    workspaceId,
    siteId,
    pages: writablePages,
    edits,
    filteredPageIds: filteredPages.map(page => page.id),
    refreshStates,
    toast,
  });

  const {
    bulkFixing,
    bulkResults,
    bulkAnalyzeProgress,
    bulkMode,
    bulkField,
    patternAction,
    patternText,
    bulkPreview,
    bulkProgress,
    bulkSource,
    setBulkMode,
    setBulkField,
    setPatternAction,
    setPatternText,
    setBulkPreview,
    handleBulkFix,
    analyzeAllPages,
    previewPattern,
    applyPattern,
    bulkAiRewrite,
    applyBulkRewrite,
    cancelAnalyze,
    cancelRewrite,
    clearPageTracking,
    missingTitles,
    missingDescs,
  } = useSeoEditorBulkWorkflow({
    siteId,
    workspaceId,
    pages: writablePages,
    edits,
    approvalSelected,
    analyzedPages,
    setLocalAnalyzedPages,
    queryClient,
    startJob,
    trackJob,
    cancelJob,
    refetchSuggestions,
    refreshStates,
  });

  if (loading) {
    return (
      <LoadingState 
        message="Loading page metadata..."
        size="lg"
      />
    );
  }

  return (
    <div className="space-y-8">
      <SeoEditorHeaderActions
        pagesCount={writablePages.length}
        missingTitles={missingTitles}
        missingDescs={missingDescs}
        bulkFixing={bulkFixing}
        bulkResults={bulkResults}
        workspaceId={workspaceId}
        approvalSelected={approvalSelected}
        sendingApproval={sendingApproval}
        approvalSent={approvalSent}
        onSendApproval={sendForApproval}
        publishing={publishing}
        published={published}
        onRefreshPages={() => queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId, workspaceId) })}
        onFixTitles={() => handleBulkFix('title')}
        onFixDescriptions={() => handleBulkFix('description')}
        onPublish={handlePublish}
      />

      <SeoEditorTrackingSummary
        workspaceId={workspaceId}
        summary={summary}
        onResetAll={resetAllTracking}
      />

      <SeoEditorTableControls
        workspaceId={workspaceId}
        bulkAnalyzeProgress={bulkAnalyzeProgress}
        onCancelAnalyze={cancelAnalyze}
        onAnalyzeAllPages={analyzeAllPages}
        analyzeDisabled={analyzing.size > 0 || analyzedWritablePagesCount === writablePages.length}
        analyzedPagesCount={analyzedWritablePagesCount}
        totalPages={writablePages.length}
        cmsPageCount={cmsPageCount}
        search={effectiveSearch}
        onSearchChange={setSearch}
        showSearch={externalSearch === undefined}
      />

      <SeoEditorWorkflowPanels
        workspaceId={workspaceId}
        approvalRefreshKey={approvalRefreshKey}
        onApprovalsRetracted={refreshStates}
        hasUnsaved={hasUnsaved}
        suggestionsData={suggestionsData}
        onRefreshSuggestions={() => refetchSuggestions()}
        onSuggestionsApplied={() => queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId, workspaceId) })}
        bulkOperationsProps={{
          filteredPages,
          approvalSelected,
          bulkMode,
          bulkField,
          patternAction,
          patternText,
          bulkPreview,
          bulkProgress,
          bulkSource,
          pages: writablePages,
          onSelectAll: selectAllForApproval,
          onSetBulkField: setBulkField,
          onSetBulkMode: setBulkMode,
          onSetPatternAction: setPatternAction,
          onSetPatternText: setPatternText,
          onPreviewPattern: previewPattern,
          onApplyPattern: applyPattern,
          onApplyBulkRewrite: applyBulkRewrite,
          onBulkAiRewrite: bulkAiRewrite,
          onCancelRewrite: cancelRewrite,
          onClearPreview: () => { setBulkMode('idle'); setBulkPreview([]); },
        }}
      />

      <SeoEditorPageList
        workspaceId={workspaceId}
        showCmsOnly={false}
        filteredPages={filteredPages}
        expanded={expanded}
        saving={saving}
        saved={saved}
        aiLoading={aiLoading}
        draftSaving={draftSaving}
        draftSaved={draftSaved}
        approvalSelected={approvalSelected}
        getPageRecommendations={(page) => (recsLoaded ? recsForPage(resolvePagePath(page)) : [])}
        getPageState={getState}
        variations={variations}
        sendingPage={sendingPage}
        sentPage={sentPage}
        onSendToClient={sendPageToClient}
        onToggleExpand={toggleExpand}
        onToggleApprovalSelect={toggleApprovalSelect}
        onUpdateField={updateField}
        onSavePage={savePage}
        onSaveDraft={saveDraft}
        onAiRewrite={aiRewrite}
        onSelectVariation={updateField}
        onClearVariations={(pageId) => setVariations(prev => { const next = { ...prev }; delete next[pageId]; return next; })}
        onClearTracking={workspaceId ? clearPageTracking : undefined}
        errorStates={errorStates}
        previewExpanded={previewExpanded}
        onTogglePreview={togglePreview}
        onAnalyzePage={workspaceId ? analyzePage : undefined}
        analyzedPages={analyzedPages}
        analyzing={analyzing}
        pageKeywordMap={pageKeywordMap}
        edits={edits}
      />
    </div>
  );
}
