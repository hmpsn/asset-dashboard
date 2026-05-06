import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { get, post } from '../../api/client';
import { keywords } from '../../api/seo';
import { useBackgroundTasks } from '../../hooks/useBackgroundTasks';
import { queryKeys } from '../../lib/queryKeys';
import { resolvePagePath } from '../../lib/pathUtils';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';
import type { UnifiedPage } from '../../../shared/types/page-join';
import type { BulkProgress, ContentScore, KeywordData } from './pageIntelligenceTypes';

interface UsePageIntelligenceAnalysisOptions {
  workspaceId: string;
  siteId: string;
  pages: UnifiedPage[];
}

export function usePageIntelligenceAnalysis({
  workspaceId,
  siteId,
  pages,
}: UsePageIntelligenceAnalysisOptions) {
  const queryClient = useQueryClient();
  const [analyses, setAnalyses] = useState<Record<string, KeywordData>>({});
  const [contentScores, setContentScores] = useState<Record<string, ContentScore>>({});
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const { jobs, startJob, findActiveJob, cancelJob: cancelBulkJob } = useBackgroundTasks();
  const [bulkJobId, setBulkJobId] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [showNextSteps, setShowNextSteps] = useState(false);

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
      total: trackedBulkJobTotal ?? pages.length,
    };
  }, [pages.length, trackedBulkJobProgress, trackedBulkJobStatus, trackedBulkJobTotal]);

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

  return {
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
    dismissAnalysisError: () => setAnalysisError(null),
    dismissNextSteps: () => setShowNextSteps(false),
  };
}
