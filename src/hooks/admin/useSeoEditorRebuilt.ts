// @ds-rebuilt
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { post, put } from '../../api/client';
import { seoSuggestions, type SeoSuggestionClient } from '../../api/seo';
import { useBackgroundTasks } from '../useBackgroundTasks';
import { useToggleSet, UNBOUNDED_TOGGLE_SET_OPTIONS } from '../useToggleSet';
import { useRecommendations } from '../useRecommendations';
import { usePageEditStates } from '../usePageEditStates';
import { resolvePagePath } from '../../lib/pathUtils';
import { queryKeys } from '../../lib/queryKeys';
import { useToast } from '../../components/Toast';
import { useSeoEditor } from './useSeoEditor';
import { useCmsEditor } from './useCmsEditor';
import { usePageJoin } from './usePageJoin';
import { useWorkspaces } from './useWorkspaces';
import { resolveSeoEditorWriteTargets } from '../../components/editor/seoWriteTargetResolver';
import { useSeoEditorSessionState } from '../../components/editor/useSeoEditorSessionState';
import { useSeoEditorPageWorkflow } from '../../components/editor/useSeoEditorPageWorkflow';
import { useSeoEditorApprovalWorkflow } from '../../components/editor/useSeoEditorApprovalWorkflow';
import { useSeoEditorBulkWorkflow } from '../../components/editor/useSeoEditorBulkWorkflow';
import { useCmsEditorShellState } from '../../components/cms-editor/useCmsEditorShellState';
import { useCmsEditorSaveWorkflow } from '../../components/cms-editor/useCmsEditorSaveWorkflow';
import { useCmsEditorApprovalWorkflow } from '../../components/cms-editor/useCmsEditorApprovalWorkflow';
import { useCmsEditorAiWorkflow } from '../../components/cms-editor/useCmsEditorAiWorkflow';
import { useCmsEditorPublishBulkWorkflow } from '../../components/cms-editor/useCmsEditorPublishBulkWorkflow';
import type { FixContext } from '../../types/fix-context';
import type { SeoEditorPage } from '../../components/editor/seoEditorTypes';
import type { CmsCollection } from '../../components/cms-editor/cmsEditorModel';
import type {
  CmsSeoWorkflowState,
  SeoEditorKeywordAssignment,
  SeoEditorProjectedMetrics,
  SeoEditorSurfaceRow,
  StaticSeoBulkWorkflowState,
  StaticSeoWorkflowState,
} from '../../components/seo-editor-rebuilt/seoEditorSurfaceTypes';
import { SEO_EDITOR_TARGET_TYPES } from '../../../shared/types/seo-editor-write-target';

export const SEO_EDITOR_REBUILT_QUERY_KEYS = {
  suggestions: (workspaceId: string | undefined) => ['admin', 'seo-editor-rebuilt', 'suggestions', workspaceId ?? 'global'] as const,
};

interface UseSeoEditorSurfaceDataArgs {
  workspaceId: string;
}

interface UseSeoEditorSurfaceWorkflowArgs {
  workspaceId: string;
  siteId: string;
  staticPages: SeoEditorPage[];
  cmsCollections: CmsCollection[];
  filteredStaticPageIds: string[];
  fixContext: FixContext | null;
  onApprovalBatchMutated?: () => void;
}

interface ProjectedSeoEditorPage extends SeoEditorPage {
  optimizationScore?: number | null;
  currentPosition?: number | null;
  rank?: number | null;
  clicks?: number | null;
  traffic?: number | null;
  lastEditedAt?: string | null;
  updatedAt?: string | null;
}

function pageMetrics(page: SeoEditorPage | undefined, authoritative: SeoEditorProjectedMetrics, updatedAt?: string | null): SeoEditorProjectedMetrics {
  const pageProjection = page as ProjectedSeoEditorPage | undefined;
  return {
    optimizationScore: authoritative.optimizationScore ?? pageProjection?.optimizationScore ?? null,
    rank: authoritative.rank ?? pageProjection?.currentPosition ?? pageProjection?.rank ?? null,
    traffic: authoritative.traffic ?? pageProjection?.clicks ?? pageProjection?.traffic ?? null,
    lastEditedAt: updatedAt ?? authoritative.lastEditedAt ?? pageProjection?.lastEditedAt ?? pageProjection?.updatedAt ?? null,
  };
}

export function useSeoEditorSurfaceData({ workspaceId }: UseSeoEditorSurfaceDataArgs) {
  const workspaces = useWorkspaces();
  const workspace = useMemo(
    () => workspaces.data?.find((item) => item.id === workspaceId),
    [workspaceId, workspaces.data],
  );
  const siteId = workspace?.webflowSiteId ?? '';
  const pagesQuery = useSeoEditor(siteId, workspaceId);
  const cmsQuery = useCmsEditor(siteId, workspaceId);
  const pageJoin = usePageJoin(workspaceId, siteId);
  const pageStates = usePageEditStates(workspaceId);
  const recommendations = useRecommendations(workspaceId);

  const resolvedTargets = useMemo(
    () => resolveSeoEditorWriteTargets({
      pages: pagesQuery.data ?? [],
      collections: cmsQuery.data?.collections ?? [],
    }),
    [cmsQuery.data?.collections, pagesQuery.data],
  );

  const joinedById = useMemo(() => new Map(pageJoin.pages.map((page) => [page.id, page])), [pageJoin.pages]);
  const keywordByPageId = useMemo(() => {
    const map = new Map<string, SeoEditorKeywordAssignment>();
    for (const page of pageJoin.pages) {
      if (!page.strategy?.primaryKeyword) continue;
      map.set(page.id, {
        primaryKeyword: page.strategy.primaryKeyword,
        secondaryKeywords: page.strategy.secondaryKeywords ?? [],
      });
    }
    return map;
  }, [pageJoin.pages]);

  const rows = useMemo<SeoEditorSurfaceRow[]>(() => {
    const staticPageById = new Map((pagesQuery.data ?? []).map((page) => [page.id, page]));
    const cmsCollectionById = new Map((cmsQuery.data?.collections ?? []).map((collection) => [collection.collectionId, collection]));
    const result: SeoEditorSurfaceRow[] = [];

    for (const target of resolvedTargets.targets) {
      if (target.targetType === SEO_EDITOR_TARGET_TYPES.staticPage) {
        const page = staticPageById.get(target.pageId);
        const joined = joinedById.get(target.pageId);
        const assignment = keywordByPageId.get(target.pageId) ?? (joined?.strategy?.primaryKeyword ? {
          primaryKeyword: joined.strategy.primaryKeyword,
          secondaryKeywords: joined.strategy.secondaryKeywords ?? [],
        } : undefined);
        const state = pageStates.getState(target.pageId);
        const recs = page && recommendations.loaded
          ? recommendations.forPage(resolvePagePath(page)).filter((recommendation: { type: string }) => recommendation.type === 'metadata')
          : [];
        result.push({
          id: target.id,
          target,
          staticPage: page,
          edit: undefined,
          pageState: state,
          recommendations: recs,
          keywordAssignment: assignment,
          metrics: pageMetrics(page, {
            optimizationScore: joined?.strategy?.optimizationScore ?? null,
            rank: joined?.strategy?.currentPosition ?? null,
            traffic: joined?.strategy?.clicks ?? null,
            lastEditedAt: joined?.strategy?.analysisGeneratedAt ?? null,
          }, state?.updatedAt ?? joined?.strategy?.analysisGeneratedAt),
          dirty: false,
          missingTitle: !target.seo.title.trim(),
          missingDescription: !target.seo.description.trim(),
        });
        continue;
      }

      if (target.targetType === SEO_EDITOR_TARGET_TYPES.cmsItem) {
        const collection = cmsCollectionById.get(target.collectionId);
        const item = collection?.items.find((candidate) => candidate.id === target.itemId);
        const state = pageStates.getState(target.itemId);
        result.push({
          id: target.id,
          target,
          cmsCollection: collection,
          cmsItem: item,
          pageState: state,
          recommendations: [],
          metrics: { lastEditedAt: state?.updatedAt ?? null },
          dirty: false,
          missingTitle: !target.seo.title.trim(),
          missingDescription: !target.seo.description.trim(),
        });
        continue;
      }

      result.push({
        id: target.id,
        target,
        pageState: pageStates.getState(target.syntheticPageId),
        recommendations: [],
        metrics: { lastEditedAt: pageStates.getState(target.syntheticPageId)?.updatedAt ?? null },
        dirty: false,
        missingTitle: !target.seo.title.trim(),
        missingDescription: !target.seo.description.trim(),
      });
    }

    return result;
  }, [cmsQuery.data?.collections, joinedById, keywordByPageId, pageStates, pagesQuery.data, recommendations, resolvedTargets.targets]);

  const refetchAll = useCallback(async () => {
    await Promise.all([
      workspaces.refetch(),
      pagesQuery.refetch(),
      cmsQuery.refetch(),
      pageJoin.refetch(),
    ]);
    pageStates.refresh();
  }, [cmsQuery, pageJoin, pageStates, pagesQuery, workspaces]);

  return {
    workspace,
    siteId,
    workspaces,
    pagesQuery,
    cmsQuery,
    pageJoin,
    pageStates,
    resolvedTargets,
    rows,
    refetchAll,
    isLoading: workspaces.isLoading || pagesQuery.isLoading || cmsQuery.isLoading || pageJoin.isLoading,
    isError: workspaces.isError || pagesQuery.isError || cmsQuery.isError || !!pageJoin.error,
    error: workspaces.error ?? pagesQuery.error ?? cmsQuery.error ?? pageJoin.error ?? null,
  };
}

export function useSeoEditorSurfaceWorkflows({
  workspaceId,
  siteId,
  staticPages,
  cmsCollections,
  filteredStaticPageIds,
  fixContext,
  onApprovalBatchMutated,
}: UseSeoEditorSurfaceWorkflowArgs) {
  const queryClient = useQueryClient();
  const { cancelJob, startJob, trackJob } = useBackgroundTasks();
  const { toast } = useToast();
  const pageStates = usePageEditStates(workspaceId);
  const pageJoin = usePageJoin(workspaceId, siteId);
  const [localAnalyzedPages, , setLocalAnalyzedPages] = useToggleSet<string>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [approvalRefreshKey, setApprovalRefreshKey] = useState(0);

  const {
    edits,
    setEdits,
    variations,
    setVariations,
    hasUnsaved,
  } = useSeoEditorSessionState({
    siteId,
    workspaceId,
    pages: staticPages,
    fixContext,
  });

  const analyzedPages = useMemo(
    () => new Set([...pageJoin.pages.filter((page) => page.analyzed).map((page) => page.id), ...localAnalyzedPages]),
    [localAnalyzedPages, pageJoin.pages],
  );

  const suggestionsQuery = useQuery({
    queryKey: SEO_EDITOR_REBUILT_QUERY_KEYS.suggestions(workspaceId),
    queryFn: () => seoSuggestions.list(workspaceId),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  const staticPageWorkflow = useSeoEditorPageWorkflow({
    siteId,
    workspaceId,
    pages: staticPages,
    edits,
    setEdits,
    setVariations,
    queryClient,
    refreshStates: pageStates.refresh,
    setLocalAnalyzedPages,
  });

  const staticApprovalWorkflow = useSeoEditorApprovalWorkflow({
    workspaceId,
    siteId,
    pages: staticPages,
    edits,
    filteredPageIds: filteredStaticPageIds,
    refreshStates: pageStates.refresh,
    toast: (message) => toast(message, 'error'),
    onApprovalBatchMutated: () => {
      setApprovalRefreshKey((key) => key + 1);
      onApprovalBatchMutated?.();
    },
  });

  const staticBulkWorkflow = useSeoEditorBulkWorkflow({
    siteId,
    workspaceId,
    pages: staticPages,
    edits,
    approvalSelected: staticApprovalWorkflow.approvalSelected,
    analyzedPages,
    setLocalAnalyzedPages,
    queryClient,
    startJob,
    trackJob,
    cancelJob,
    refetchSuggestions: () => suggestionsQuery.refetch(),
    refreshStates: pageStates.refresh,
  });

  const cmsShellState = useCmsEditorShellState({ siteId, collections: cmsCollections });
  const cmsSaveWorkflow = useCmsEditorSaveWorkflow({
    siteId,
    workspaceId,
    edits: cmsShellState.edits,
    setSaving: cmsShellState.setSaving,
    setErrors: cmsShellState.setErrors,
    setDirty: cmsShellState.setDirty,
    setSaved: cmsShellState.setSaved,
    refreshStates: pageStates.refresh,
    queryClient,
  });
  const cmsApprovalWorkflow = useCmsEditorApprovalWorkflow({
    workspaceId,
    siteId,
    edits: cmsShellState.edits,
    collections: cmsCollections,
    refreshStates: pageStates.refresh,
    onApprovalBatchMutated: () => {
      setApprovalRefreshKey((key) => key + 1);
      onApprovalBatchMutated?.();
    },
  });
  const cmsAiWorkflow = useCmsEditorAiWorkflow({
    siteId,
    workspaceId,
    collections: cmsCollections,
    edits: cmsShellState.edits,
    updateField: cmsShellState.updateField,
  });
  const cmsPublishWorkflow = useCmsEditorPublishBulkWorkflow({
    siteId,
    workspaceId,
    collections: cmsCollections,
    saved: cmsShellState.saved,
    approvalSelected: cmsApprovalWorkflow.approvalSelected,
    setExpandedCollections: cmsShellState.setExpandedCollections,
    setExpandedItems: cmsShellState.setExpandedItems,
    aiRewrite: cmsAiWorkflow.aiRewrite,
    aiRewriteBoth: cmsAiWorkflow.aiRewriteBoth,
    queryClient,
  });

  const savePageTitle = useCallback(async (pageId: string, title: string) => {
    const page = staticPages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    await put<{ success?: boolean; error?: string }>(`/api/webflow/pages/${pageId}/seo`, {
      siteId,
      workspaceId,
      slug: resolvePagePath(page),
      publishedPath: page.publishedPath,
      pageTitle: title,
      title,
    });
    pageStates.refresh();
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId, workspaceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.auditAll() });
  }, [pageStates, queryClient, siteId, staticPages, workspaceId]);

  const clearStaticVariations = useCallback((pageId: string) => {
    setVariations((previous) => {
      const next = { ...previous };
      delete next[pageId];
      return next;
    });
  }, [setVariations]);

  const handlePublishSite = useCallback(async () => {
    if (!siteId) return;
    setPublishing(true);
    try {
      const data = await post<{ success?: boolean }>(`/api/webflow/publish/${siteId}?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (data.success) {
        setPublished(true);
        toast('Site publish started', 'success');
        setTimeout(() => setPublished(false), 3000);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Site publish failed', 'error');
    } finally {
      setPublishing(false);
    }
  }, [siteId, toast, workspaceId]);

  const staticWorkflow: StaticSeoWorkflowState = {
    edits,
    saving: staticPageWorkflow.saving,
    saved: staticPageWorkflow.saved,
    draftSaving: staticPageWorkflow.draftSaving,
    draftSaved: staticPageWorkflow.draftSaved,
    aiLoading: staticPageWorkflow.aiLoading,
    errorStates: staticPageWorkflow.errorStates,
    analyzing: staticPageWorkflow.analyzing,
    variations,
    analyzedPages,
    approvalSelected: staticApprovalWorkflow.approvalSelected,
    sendingApproval: staticApprovalWorkflow.sendingApproval,
    approvalSent: staticApprovalWorkflow.approvalSent,
    sendingPage: staticApprovalWorkflow.sendingPage,
    sentPage: staticApprovalWorkflow.sentPage,
    updateField: staticPageWorkflow.updateField,
    saveDraft: staticPageWorkflow.saveDraft,
    savePage: staticPageWorkflow.savePage,
    savePageTitle,
    aiRewrite: staticPageWorkflow.aiRewrite,
    analyzePage: staticPageWorkflow.analyzePage,
    toggleApprovalSelect: staticApprovalWorkflow.toggleApprovalSelect,
    selectAllForApproval: staticApprovalWorkflow.selectAllForApproval,
    sendPageToClient: staticApprovalWorkflow.sendPageToClient,
    sendForApproval: staticApprovalWorkflow.sendForApproval,
    clearPageTracking: staticBulkWorkflow.clearPageTracking,
    clearVariations: clearStaticVariations,
  };

  const bulkWorkflow: StaticSeoBulkWorkflowState = {
    bulkFixing: staticBulkWorkflow.bulkFixing,
    bulkResults: staticBulkWorkflow.bulkResults,
    bulkAnalyzeProgress: staticBulkWorkflow.bulkAnalyzeProgress,
    bulkMode: staticBulkWorkflow.bulkMode,
    bulkField: staticBulkWorkflow.bulkField,
    patternAction: staticBulkWorkflow.patternAction,
    patternText: staticBulkWorkflow.patternText,
    bulkPreview: staticBulkWorkflow.bulkPreview,
    bulkProgress: staticBulkWorkflow.bulkProgress,
    bulkSource: staticBulkWorkflow.bulkSource,
    missingTitles: staticBulkWorkflow.missingTitles,
    missingDescs: staticBulkWorkflow.missingDescs,
    setBulkMode: staticBulkWorkflow.setBulkMode,
    setBulkField: staticBulkWorkflow.setBulkField,
    setPatternAction: staticBulkWorkflow.setPatternAction,
    setPatternText: staticBulkWorkflow.setPatternText,
    setBulkPreview: staticBulkWorkflow.setBulkPreview,
    handleBulkFix: staticBulkWorkflow.handleBulkFix,
    analyzeAllPages: staticBulkWorkflow.analyzeAllPages,
    previewPattern: staticBulkWorkflow.previewPattern,
    applyPattern: staticBulkWorkflow.applyPattern,
    bulkAiRewrite: staticBulkWorkflow.bulkAiRewrite,
    applyBulkRewrite: staticBulkWorkflow.applyBulkRewrite,
    cancelAnalyze: staticBulkWorkflow.cancelAnalyze,
    cancelRewrite: staticBulkWorkflow.cancelRewrite,
  };

  const cmsWorkflow: CmsSeoWorkflowState = {
    edits: cmsShellState.edits,
    dirty: cmsShellState.dirty,
    saved: cmsShellState.saved,
    saving: cmsShellState.saving,
    errors: cmsShellState.errors,
    variations: cmsAiWorkflow.variations,
    aiLoading: cmsAiWorkflow.aiLoading,
    aiError: cmsAiWorkflow.aiError,
    approvalSelected: cmsApprovalWorkflow.approvalSelected,
    sendingApproval: cmsApprovalWorkflow.sendingApproval,
    approvalSent: cmsApprovalWorkflow.approvalSent,
    approvalError: cmsApprovalWorkflow.approvalError,
    publishing: cmsPublishWorkflow.publishing,
    published: cmsPublishWorkflow.published,
    bulkMode: cmsPublishWorkflow.bulkMode,
    bulkProgress: cmsPublishWorkflow.bulkProgress,
    bulkResults: cmsPublishWorkflow.bulkResults,
    updateField: cmsShellState.updateField,
    saveItem: cmsSaveWorkflow.saveItem,
    publishCollection: cmsPublishWorkflow.publishCollection,
    aiRewrite: cmsAiWorkflow.aiRewrite,
    aiRewriteBoth: cmsAiWorkflow.aiRewriteBoth,
    applySingleVariation: cmsAiWorkflow.applySingleVariation,
    applyPairedVariation: cmsAiWorkflow.applyPairedVariation,
    toggleApprovalItem: cmsApprovalWorkflow.toggleApprovalItem,
    toggleSelectAllInCollection: cmsApprovalWorkflow.toggleSelectAllInCollection,
    sendForApproval: cmsApprovalWorkflow.sendForApproval,
    bulkAiRewrite: cmsPublishWorkflow.bulkAiRewrite,
  };

  return {
    hasUnsaved,
    approvalRefreshKey,
    staticWorkflow,
    bulkWorkflow,
    cmsWorkflow,
    suggestions: (suggestionsQuery.data?.suggestions ?? []) as SeoSuggestionClient[],
    suggestionCounts: suggestionsQuery.data?.counts ?? { pending: 0, selected: 0, total: 0 },
    suggestionsQuery,
    publishing,
    published,
    publishSite: handlePublishSite,
  };
}
