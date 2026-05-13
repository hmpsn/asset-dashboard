import { useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { put, post } from '../../api/client';
import { jobs, workspaces } from '../../api';
import { seoBulkJobs } from '../../api/seo';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import { resolvePagePath } from '../../lib/pathUtils';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';
import type { BackgroundJobType } from '../../../shared/types/background-jobs';
import {
  countMissingField,
  filterPagesNeedingFix,
  filterWritableIds,
  filterWritableItems,
} from '../../hooks/admin/seoEditorFilters';
import {
  buildBulkRewriteRequestPages,
  buildBulkSeoUpdate,
  buildPatternApplyPayload,
  buildPatternPreviewItems,
} from './seoEditorBulkHelpers';
import {
  persistCachedSeoBulkAnalyzeJobId,
  persistCachedSeoBulkRewriteJobId,
  readCachedSeoBulkAnalyzeJobId,
  readCachedSeoBulkRewriteJobId,
} from './seoEditorPersistence';
import type { SeoBulkMode, SeoEditState, SeoEditorPage } from './seoEditorTypes';

interface UseSeoEditorBulkWorkflowArgs {
  siteId: string;
  workspaceId?: string;
  pages: SeoEditorPage[];
  edits: Record<string, SeoEditState>;
  approvalSelected: Set<string>;
  analyzedPages: Set<string>;
  setLocalAnalyzedPages: React.Dispatch<React.SetStateAction<Set<string>>>;
  queryClient: QueryClient;
  trackJob: (type: BackgroundJobType, jobId: string, meta: Record<string, unknown>) => void;
  cancelJob: (jobId: string) => Promise<void> | void;
  refetchSuggestions: () => Promise<unknown> | void;
  refreshStates: () => void;
}

export function useSeoEditorBulkWorkflow({
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
}: UseSeoEditorBulkWorkflowArgs) {
  const [bulkFixing, setBulkFixing] = useState(false);
  const [bulkResults, setBulkResults] = useState<string | null>(null);
  const [bulkAnalyzeProgress, setBulkAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkAnalyzeJobId, setBulkAnalyzeJobId] = useState<string | null>(() => readCachedSeoBulkAnalyzeJobId(workspaceId));
  const [bulkRewriteJobId, setBulkRewriteJobId] = useState<string | null>(() => readCachedSeoBulkRewriteJobId(workspaceId));
  const [bulkMode, setBulkMode] = useState<SeoBulkMode>('idle');
  const [bulkField, setBulkField] = useState<'title' | 'description'>('title');
  const [patternAction, setPatternAction] = useState<'append' | 'prepend'>('append');
  const [patternText, setPatternText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<Array<{ pageId: string; oldValue: string; newValue: string }>>([]);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkSource, setBulkSource] = useState<'pattern' | 'ai'>('pattern');

  useEffect(() => {
    persistCachedSeoBulkAnalyzeJobId(workspaceId, bulkAnalyzeJobId);
  }, [bulkAnalyzeJobId, workspaceId]);

  useEffect(() => {
    persistCachedSeoBulkRewriteJobId(workspaceId, bulkRewriteJobId);
  }, [bulkRewriteJobId, workspaceId]);

  const mountAnalyzeJobId = useRef(bulkAnalyzeJobId);
  const mountRewriteJobId = useRef(bulkRewriteJobId);
  useEffect(() => {
    const analyzeId = mountAnalyzeJobId.current;
    const rewriteId = mountRewriteJobId.current;
    if (!analyzeId && !rewriteId) return;
    const terminal = new Set(['done', 'error', 'cancelled']);

    if (analyzeId) {
      jobs.get(analyzeId)
        .then(job => {
          if (terminal.has(job.status)) {
            setBulkAnalyzeJobId(null);
          } else {
            setBulkAnalyzeProgress({ done: job.progress ?? 0, total: job.total ?? 0 });
          }
        })
        .catch(() => setBulkAnalyzeJobId(null));
    }

    if (rewriteId) {
      jobs.get(rewriteId)
        .then(job => {
          if (terminal.has(job.status)) {
            setBulkRewriteJobId(null);
          } else {
            setBulkMode('rewriting');
            setBulkProgress({ done: job.progress ?? 0, total: job.total ?? 0 });
          }
        })
        .catch(() => setBulkRewriteJobId(null));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only recovery

  useWorkspaceEvents(workspaceId, {
    [WS_EVENTS.BULK_OPERATION_PROGRESS]: (data: unknown) => {
      const detail = data as { jobId: string; operation: string; done: number; total: number };
      if (detail.operation === 'bulk-analyze' && detail.jobId === bulkAnalyzeJobId) {
        setBulkAnalyzeProgress({ done: detail.done, total: detail.total });
      }
      if (detail.operation === 'bulk-rewrite' && detail.jobId === bulkRewriteJobId) {
        setBulkProgress({ done: detail.done, total: detail.total });
      }
    },
    [WS_EVENTS.BULK_OPERATION_COMPLETE]: (data: unknown) => {
      const detail = data as { jobId: string; operation: string; generated?: number; generatedPages?: number; suggestions?: number; failed?: number; total: number; field?: string };
      if (detail.operation === 'bulk-analyze' && detail.jobId === bulkAnalyzeJobId) {
        setBulkAnalyzeProgress(prev => (prev ? { ...prev, done: prev.total } : null));
        setBulkAnalyzeJobId(null);
        if (workspaceId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
        }
        setTimeout(() => setBulkAnalyzeProgress(null), 3000);
      }

      if (detail.operation === 'bulk-rewrite' && detail.jobId === bulkRewriteJobId) {
        const failed = detail.failed || 0;
        const generated = detail.generatedPages ?? (detail.total - failed);
        const fieldLabel = detail.field === 'both' ? 'title + description' : (detail.field || 'title');
        const suggestionSuffix = detail.suggestions != null && detail.suggestions !== generated
          ? ` (${detail.suggestions} suggestion rows)`
          : '';
        setBulkResults(
          failed > 0
            ? `Generated ${generated}/${detail.total} ${fieldLabel} variations${suggestionSuffix} (${failed} failed) — review in the suggestions panel.`
            : `Generated ${generated}/${detail.total} ${fieldLabel} variations${suggestionSuffix} — review in the suggestions panel.`,
        );
        setBulkMode('idle');
        setBulkRewriteJobId(null);
        setBulkProgress({ done: 0, total: 0 });
        refetchSuggestions();
        setTimeout(() => setBulkResults(null), 8000);
      }
    },
    [WS_EVENTS.BULK_OPERATION_FAILED]: (data: unknown) => {
      const detail = data as { jobId: string; operation: string; error: string };
      if (detail.operation === 'bulk-analyze' && detail.jobId === bulkAnalyzeJobId) {
        setBulkAnalyzeProgress(null);
        setBulkAnalyzeJobId(null);
        setBulkResults('Bulk analysis failed: ' + detail.error);
        setTimeout(() => setBulkResults(null), 5000);
      }
      if (detail.operation === 'bulk-rewrite' && detail.jobId === bulkRewriteJobId) {
        setBulkMode('idle');
        setBulkRewriteJobId(null);
        setBulkProgress({ done: 0, total: 0 });
        setBulkResults('Bulk rewrite failed: ' + detail.error);
        setTimeout(() => setBulkResults(null), 5000);
      }
    },
  });

  const analyzeAllPages = async () => {
    if (!workspaceId) return;
    const toAnalyze = pages.filter(page => !analyzedPages.has(page.id));
    if (toAnalyze.length === 0) return;

    setBulkAnalyzeProgress({ done: 0, total: toAnalyze.length });
    try {
      const { jobId } = await seoBulkJobs.bulkAnalyze(workspaceId, {
        pages: toAnalyze.map(page => ({
          pageId: page.id,
          title: page.title,
          slug: page.slug,
          publishedPath: page.publishedPath,
          seoTitle: edits[page.id]?.seoTitle || page.seo?.title || '',
          seoDescription: edits[page.id]?.seoDescription || page.seo?.description || '',
        })),
      });
      trackJob(BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE, jobId, { workspaceId });
      setBulkAnalyzeJobId(jobId);
    } catch (err) {
      console.error('Failed to start bulk analyze:', err);
      setBulkAnalyzeProgress(null);
    }
  };

  const handleBulkFix = async (field: 'title' | 'description') => {
    const pagesNeedingFix = filterPagesNeedingFix(pages, field);
    if (pagesNeedingFix.length === 0) {
      setBulkResults(`All pages already have ${field === 'title' ? 'SEO titles' : 'meta descriptions'}.`);
      setTimeout(() => setBulkResults(null), 3000);
      return;
    }
    setBulkFixing(true);
    setBulkResults(null);
    try {
      const data = await post<{ results?: Array<{ applied: boolean }> }>(`/api/webflow/seo-bulk-fix/${siteId}`, {
        workspaceId,
        field,
        pages: pagesNeedingFix.map(page => ({
          pageId: page.id,
          title: page.title,
          slug: page.slug,
          publishedPath: page.publishedPath,
          currentSeoTitle: page.seo?.title,
          currentDescription: page.seo?.description,
        })),
      });
      const applied = data.results?.filter((result: { applied: boolean }) => result.applied).length || 0;
      setBulkResults(`AI generated ${field === 'title' ? 'titles' : 'descriptions'} for ${applied} of ${pagesNeedingFix.length} pages and pushed to Webflow.`);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId, workspaceId) });
      setTimeout(() => setBulkResults(null), 5000);
    } catch (err) {
      console.error('SeoEditor operation failed:', err);
      setBulkResults('Bulk fix failed.');
    } finally {
      setBulkFixing(false);
    }
  };

  const previewPattern = () => {
    if (!patternText.trim()) return;
    const preview = buildPatternPreviewItems(
      filterWritableIds(Array.from(approvalSelected), pages),
      pages,
      edits,
      { field: bulkField, action: patternAction, text: patternText },
    );
    setBulkPreview(preview);
    setBulkSource('pattern');
    setBulkMode('rewrite-preview');
  };

  const applyPattern = async () => {
    setBulkMode('rewriting');
    setBulkProgress({ done: 0, total: bulkPreview.length });
    try {
      const pagesPayload = buildPatternApplyPayload(bulkPreview, pages);
      const data = await post<{ results: Array<{ pageId: string; newValue: string; applied: boolean }> }>(
        `/api/webflow/seo-pattern-apply/${siteId}`,
        { workspaceId, pages: pagesPayload, field: bulkField, action: patternAction, text: patternText },
      );
      const applied = data.results?.filter(result => result.applied).length || 0;
      setBulkResults(`Pattern applied to ${applied}/${bulkPreview.length} pages.`);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId, workspaceId) });
    } catch {
      setBulkResults('Pattern apply failed.');
    } finally {
      setBulkMode('idle');
      setBulkPreview([]);
      setPatternText('');
      setTimeout(() => setBulkResults(null), 5000);
    }
  };

  const bulkAiRewrite = async (field: 'title' | 'description' | 'both') => {
    if (!workspaceId) return;
    const selectedIds = filterWritableIds(Array.from(approvalSelected), pages);
    if (selectedIds.length === 0) return;

    setBulkField(field === 'both' ? 'title' : field);
    setBulkMode('rewriting');
    setBulkProgress({ done: 0, total: selectedIds.length });

    try {
      const { jobId } = await seoBulkJobs.bulkRewrite(workspaceId, {
        siteId,
        pages: buildBulkRewriteRequestPages(selectedIds, pages, edits),
        field,
      });
      trackJob(BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE, jobId, { workspaceId });
      setBulkRewriteJobId(jobId);
    } catch (err) {
      console.error('Failed to start bulk rewrite:', err);
      setBulkMode('idle');
      setBulkProgress({ done: 0, total: 0 });
      setBulkResults('Failed to start bulk rewrite.');
      setTimeout(() => setBulkResults(null), 5000);
    }
  };

  const applyBulkRewrite = async () => {
    const staticItems = filterWritableItems(bulkPreview, pages);
    const pageById = new Map(pages.map(page => [page.id, page]));
    setBulkMode('rewriting');
    setBulkProgress({ done: 0, total: staticItems.length });
    try {
      for (const item of staticItems) {
        const page = pageById.get(item.pageId);
        if (!page) continue;
        const seoFields = buildBulkSeoUpdate(bulkField, item.newValue, page, edits[page.id]);
        await put(`/api/webflow/pages/${page.id}/seo`, {
          siteId,
          workspaceId,
          slug: resolvePagePath(page),
          pageTitle: page.title,
          ...seoFields,
        });
        setBulkProgress(prev => ({ ...prev, done: prev.done + 1 }));
      }
      setBulkResults(`Applied ${staticItems.length} ${bulkField === 'title' ? 'title' : 'description'} changes.`);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId, workspaceId) });
    } catch {
      setBulkResults('Apply failed.');
    } finally {
      setBulkMode('idle');
      setBulkPreview([]);
      setTimeout(() => setBulkResults(null), 5000);
    }
  };

  const cancelAnalyze = async () => {
    if (!bulkAnalyzeJobId) return;
    const activeJobId = bulkAnalyzeJobId;
    try {
      await cancelJob(activeJobId);
    } catch (err) {
      console.error('Failed to cancel bulk analyze job:', err);
    } finally {
      setBulkAnalyzeJobId(null);
      setBulkAnalyzeProgress(null);
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
      }
    }
  };

  const cancelRewrite = async () => {
    if (!bulkRewriteJobId) {
      setBulkMode('idle');
      setBulkProgress({ done: 0, total: 0 });
      return;
    }
    const activeJobId = bulkRewriteJobId;
    try {
      await cancelJob(activeJobId);
    } catch (err) {
      console.error('Failed to cancel bulk rewrite job:', err);
    } finally {
      setBulkRewriteJobId(null);
      setBulkMode('idle');
      setBulkProgress({ done: 0, total: 0 });
    }
  };

  const clearPageTracking = async (pageId: string) => {
    if (!workspaceId) return;
    try {
      await workspaces.deletePageState(workspaceId, pageId);
      setLocalAnalyzedPages(prev => {
        const next = new Set(prev);
        next.delete(pageId);
        return next;
      });
      refreshStates();
    } catch (err) {
      console.error('SeoEditor operation failed:', err);
    }
  };

  return {
    bulkFixing,
    bulkResults,
    bulkAnalyzeProgress,
    bulkAnalyzeJobId,
    bulkRewriteJobId,
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
    missingTitles: countMissingField(pages, 'title'),
    missingDescs: countMissingField(pages, 'description'),
  };
}
