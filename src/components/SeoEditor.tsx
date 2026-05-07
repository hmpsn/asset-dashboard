import { useState, useEffect, useRef, useMemo } from 'react';
import { post } from '../api/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
} from 'lucide-react';
import type { FixContext } from '../App';
import { seoSuggestions } from '../api/seo';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import { queryKeys } from '../lib/queryKeys';
import { useRecommendations } from '../hooks/useRecommendations';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { useSeoEditor, usePageJoin } from '../hooks/admin';
import { LoadingState, Icon } from './ui';
import { useToast } from './Toast';
import { BulkOperations } from './editor/BulkOperations';
import { PendingApprovals } from './PendingApprovals';
import { SeoSuggestionsPanel } from './editor/SeoSuggestionsPanel';
import { SeoEditorTableControls } from './editor/SeoEditorTableControls';
import { SeoEditorTrackingSummary } from './editor/SeoEditorTrackingSummary';
import { SeoEditorHeaderActions } from './editor/SeoEditorHeaderActions';
import { SeoEditorPageList } from './editor/SeoEditorPageList';
import { resolvePagePath } from '../lib/pathUtils';
import type { SeoEditState, SeoVariationSet } from './editor/seoEditorTypes';
import {
  filterAndSortSeoPages,
} from './editor/seoEditorDerived';
import { useSeoEditorApprovalWorkflow } from './editor/useSeoEditorApprovalWorkflow';
import { useSeoEditorPageWorkflow } from './editor/useSeoEditorPageWorkflow';
import { useSeoEditorBulkWorkflow } from './editor/useSeoEditorBulkWorkflow';
import {
  buildSeoEditsFromPages,
  persistCachedExpandedPages,
  persistCachedSeoEdits,
  persistCachedSeoVariations,
  readCachedExpandedPages,
  readCachedSeoEdits,
  readCachedSeoVariations,
} from './editor/seoEditorPersistence';

interface Props {
  siteId: string;
  workspaceId?: string;
  fixContext?: FixContext | null;
}

export function SeoEditor({ siteId, workspaceId, fixContext }: Props) {
  const { forPage: recsForPage, loaded: recsLoaded } = useRecommendations(workspaceId);
  const queryClient = useQueryClient();
  const { cancelJob, trackJob } = useBackgroundTasks();
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
  
  // Session persistence: restore edits/variations/expanded from sessionStorage (survives tab switches + refresh)
  const restoredFromCache = useRef(false);
  const [edits, setEdits] = useState<Record<string, SeoEditState>>(() => {
    const cached = readCachedSeoEdits(siteId);
    restoredFromCache.current = cached.restoredFromCache;
    return cached.edits;
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    return readCachedExpandedPages(siteId);
  });
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [search, setSearch] = useState('');
  const [showCmsOnly, setShowCmsOnly] = useState(false);
  const [variations, setVariations] = useState<Record<string, SeoVariationSet>>(() => {
    return readCachedSeoVariations(siteId);
  });
  const [previewExpanded, setPreviewExpanded] = useState<Set<string>>(new Set());
  const { getState, refresh: refreshStates, summary } = usePageEditStates(workspaceId);

  // Sync edits/variations/expanded to sessionStorage for persistence across tab switches + refresh
  useEffect(() => {
    persistCachedSeoEdits(siteId, edits);
  }, [edits, siteId]);
  useEffect(() => {
    persistCachedExpandedPages(siteId, expanded);
  }, [expanded, siteId]);
  useEffect(() => {
    persistCachedSeoVariations(siteId, variations);
  }, [variations, siteId]);

  // SEO Suggestions (persistent bulk rewrite variations)
  const { data: suggestionsData, refetch: refetchSuggestions } = useQuery({
    queryKey: queryKeys.admin.seoSuggestions(workspaceId!),
    queryFn: () => seoSuggestions.list(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  // Load drafts and update edits when pages data changes from React Query
  useEffect(() => {
    // Skip re-initialization if edits were restored from RQ cache (admin tab switch)
    if (restoredFromCache.current) {
      restoredFromCache.current = false;
      return;
    }
    setEdits(buildSeoEditsFromPages(pages, workspaceId));
  }, [pages, workspaceId]);

  // Auto-expand target page from audit Fix→
  // Guard on targetRoute so stale fixContext from other tabs doesn't scroll/expand a page unexpectedly.
  const fixConsumed = useRef(false);
  // effect-layout-ok -- this sync is intentionally post-paint because it scrolls the target element.
  useEffect(() => {
    if (fixContext?.pageId && fixContext.targetRoute === 'seo-editor' && pages.length > 0 && !fixConsumed.current) {
      const match = pages.find(p => p.id === fixContext.pageId || p.slug === fixContext.pageSlug);
      if (match) {
        fixConsumed.current = true;
        setExpanded(new Set([match.id]));
        // Scroll to the page after a tick
        setTimeout(() => {
          const el = document.getElementById(`seo-editor-page-${match.id}`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    }
  }, [fixContext, pages]);

  const hasUnsaved = useMemo(
    () => Object.values(edits).some(e => e.dirty),
    [edits],
  );

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
    pages,
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

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePreview = (pageId: string) => {
    setPreviewExpanded(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
      return next;
    });
  };

  const resetAllTracking = async () => {
    if (!workspaceId) return;
    await post(`/api/workspaces/${workspaceId}/page-states/clear`, { status: 'all' });
    refreshStates();
  };

  const metadataRecommendationCountByPageId = useMemo(() => {
    if (!recsLoaded) return new Map<string, number>();
    return new Map(
      pages.map(page => [
        page.id,
        recsForPage(resolvePagePath(page)).filter((recommendation: { type: string }) => recommendation.type === 'metadata').length,
      ]),
    );
  }, [pages, recsLoaded, recsForPage]);

  const filteredPages = useMemo(
    () => filterAndSortSeoPages(pages, { search, showCmsOnly, metadataRecommendationCountByPageId }),
    [pages, search, showCmsOnly, metadataRecommendationCountByPageId],
  );
  const {
    approvalSelected,
    setApprovalSelected,
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
    pages,
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
    pages,
    edits,
    approvalSelected,
    analyzedPages,
    setLocalAnalyzedPages,
    queryClient,
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
        pagesCount={pages.length}
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

      {/* Pending approval batches sent to client */}
      {workspaceId && (
        <PendingApprovals
          workspaceId={workspaceId}
          refreshKey={approvalRefreshKey}
          nameFilter="SEO"
          onRetracted={() => refreshStates()}
        />
      )}

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
        analyzeDisabled={analyzing.size > 0 || analyzedPages.size === pages.length}
        analyzedPagesCount={analyzedPages.size}
        totalPages={pages.length}
        showCmsOnly={showCmsOnly}
        onToggleCmsOnly={() => {
          setShowCmsOnly(prev => !prev);
          setApprovalSelected(new Set());
        }}
        filteredCmsCount={filteredPages.length}
        search={search}
        onSearchChange={setSearch}
      />

      {hasUnsaved && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/8 border border-amber-500/30 rounded-[var(--radius-lg)] t-caption-sm text-accent-warning">
          <Icon as={AlertCircle} size="md" /> You have unsaved changes. Save individual pages then publish to go live.
        </div>
      )}

      {/* Persistent SEO Suggestions Panel */}
      {workspaceId && suggestionsData && suggestionsData.suggestions.length > 0 && (
        <SeoSuggestionsPanel
          workspaceId={workspaceId}
          suggestions={suggestionsData.suggestions}
          counts={suggestionsData.counts}
          onRefresh={() => refetchSuggestions()}
          onApplied={() => queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId, workspaceId) })}
        />
      )}

      <BulkOperations
        filteredPages={filteredPages} approvalSelected={approvalSelected}
        bulkMode={bulkMode} bulkField={bulkField} patternAction={patternAction}
        patternText={patternText} bulkPreview={bulkPreview} bulkProgress={bulkProgress}
        bulkSource={bulkSource} pages={pages}
        onSelectAll={selectAllForApproval} onSetBulkField={setBulkField}
        onSetBulkMode={setBulkMode} onSetPatternAction={setPatternAction}
        onSetPatternText={setPatternText} onPreviewPattern={previewPattern}
        onApplyPattern={applyPattern} onApplyBulkRewrite={applyBulkRewrite}
        onBulkAiRewrite={bulkAiRewrite}
        onCancelRewrite={cancelRewrite}
        onClearPreview={() => { setBulkMode('idle'); setBulkPreview([]); }}
      />

      <SeoEditorPageList
        workspaceId={workspaceId}
        showCmsOnly={showCmsOnly}
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
