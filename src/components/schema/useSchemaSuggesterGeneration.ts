import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { post, getSafe } from '../../api/client';
import { useSchemaSnapshot, useWebflowPages } from '../../hooks/admin';
import { useBackgroundTasks } from '../../hooks/useBackgroundTasks';
import { queryKeys } from '../../lib/queryKeys';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';
import type { SchemaPageOption, SchemaPageSuggestion } from './schemaSuggesterTypes';

interface UseSchemaSuggesterGenerationOptions {
  siteId: string;
  workspaceId?: string;
  fixContext?: { pageId?: string; targetRoute?: string } | null;
  onPageGenerated: (pageId: string) => void;
}

export function useSchemaSuggesterGeneration({
  siteId,
  workspaceId,
  fixContext,
  onPageGenerated,
}: UseSchemaSuggesterGenerationOptions) {
  const [data, setData] = useState<SchemaPageSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [showNextSteps, setShowNextSteps] = useState(false);
  const [showPagePicker, setShowPagePicker] = useState(false);
  const [availablePages, setAvailablePages] = useState<SchemaPageOption[]>([]);
  const [pageSearch, setPageSearch] = useState('');
  const [loadingPages, setLoadingPages] = useState(false);
  const [generatingSingle, setGeneratingSingle] = useState<string | null>(null);
  const [pageTypes, setPageTypes] = useState<Record<string, string>>({});
  const [singlePageTypeOverrides, setSinglePageTypeOverrides] = useState<Record<string, string>>({});
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { jobs, startJob, cancelJob } = useBackgroundTasks();
  const jobIdRef = useRef<string | null>(null);
  const fixConsumed = useRef(false);

  const { data: snapshotData } = useSchemaSnapshot(siteId, workspaceId);
  useEffect(() => { // effect-layout-ok: saved snapshot arrives asynchronously from React Query.
    if (!snapshotData) {
      setSnapshotDate(null);
      setData(null);
      return;
    }
    setSnapshotDate(prev => prev === snapshotData.createdAt ? prev : snapshotData.createdAt);
    if (snapshotData.results.length > 0) {
      setData(snapshotData.results as SchemaPageSuggestion[]);
      setStarted(true);
    }
    const typesFromSnapshot: Record<string, string> = {};
    for (const result of snapshotData.results as SchemaPageSuggestion[]) {
      const savedPageType = (result as unknown as { savedPageType?: string }).savedPageType;
      if (savedPageType) {
        typesFromSnapshot[result.pageId] = savedPageType;
      }
    }
    if (Object.keys(typesFromSnapshot).length > 0) {
      setPageTypes(prev => ({ ...typesFromSnapshot, ...prev }));
    }
  }, [snapshotData]);

  useEffect(() => { // effect-layout-ok: persisted page types arrive asynchronously from the server.
    if (!siteId) return;
    getSafe<{ pageTypes: Record<string, string> }>(`/api/webflow/schema-page-types/${siteId}?workspaceId=${workspaceId || ''}`, { pageTypes: {} })
      .then(({ pageTypes: saved }) => {
        if (saved && Object.keys(saved).length > 0) {
          setPageTypes(prev => ({ ...saved, ...prev }));
        }
      })
      .catch(() => { /* ignore — page types are non-critical */ });
  }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: fetchedPages = [] } = useWebflowPages(siteId, workspaceId);
  useEffect(() => {
    if (fetchedPages.length > 0 && availablePages.length === 0) {
      setAvailablePages(fetchedPages);
    }
  }, [fetchedPages]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // effect-layout-ok: background job results arrive asynchronously via WebSocket.
    if (!jobIdRef.current) return;
    const job = jobs.find(j => j.id === jobIdRef.current);
    if (!job) return;
    if (job.result && Array.isArray(job.result) && job.result.length > 0) {
      setData(job.result as SchemaPageSuggestion[]);
    }
    if (job.message) setProgressMsg(job.message);
    if (job.status === 'done') {
      setLoading(false);
      if (job.result && Array.isArray(job.result)) {
        setData(job.result as SchemaPageSuggestion[]);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.schemaSnapshot(siteId, workspaceId) });
      setShowNextSteps(true);
      setProgressMsg(null);
      jobIdRef.current = null;
    } else if (job.status === 'error') {
      setLoading(false);
      setScanError(job.error || 'Schema generation failed');
      setProgressMsg(null);
      jobIdRef.current = null;
    } else if (job.status === 'cancelled') {
      setLoading(false);
      setProgressMsg(null);
      jobIdRef.current = null;
    }
  }, [jobs, queryClient, siteId, workspaceId]);

  const runScan = useCallback(async () => {
    setStarted(true);
    setLoading(true);
    setShowNextSteps(false);
    setData(null);
    setScanError(null);
    setProgressMsg('Starting schema generation...');
    const jobId = await startJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, { siteId, workspaceId: workspaceId || '' });
    if (jobId) {
      jobIdRef.current = jobId;
    } else {
      setScanError('Failed to start schema generation job');
      setLoading(false);
    }
  }, [siteId, startJob, workspaceId]);

  const stopScan = useCallback(() => {
    if (jobIdRef.current) cancelJob(jobIdRef.current);
  }, [cancelJob]);

  const fetchPages = useCallback(async () => {
    if (availablePages.length > 0) {
      setShowPagePicker(true);
      return;
    }
    setLoadingPages(true);
    try {
      const pages = await getSafe<Array<{ _id?: string; id?: string; title?: string; slug?: string }>>(`/api/webflow/pages/${siteId}${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, []);
      if (Array.isArray(pages)) {
        setAvailablePages(pages.map(page => ({
          id: page._id || page.id || '',
          title: page.title || page.slug || 'Untitled',
          slug: page.slug || '',
        })));
      }
      setShowPagePicker(true);
    } catch (err) {
      console.error('SchemaSuggester operation failed:', err);
    }
    setLoadingPages(false);
  }, [availablePages.length, siteId, workspaceId]);

  const generateSinglePage = useCallback(async (pageId: string) => {
    setGeneratingSingle(pageId);
    setShowPagePicker(false);
    setStarted(true);
    try {
      const pt = singlePageTypeOverrides[pageId];
      const result = await post<SchemaPageSuggestion>(`/api/webflow/schema-suggestions/${siteId}/page${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, { pageId, pageType: pt && pt !== 'auto' ? pt : undefined });
      setData(prev => {
        if (!prev) return [result];
        const exists = prev.findIndex(page => page.pageId === pageId);
        if (exists >= 0) return prev.map(page => page.pageId === pageId ? result : page);
        return [...prev, result];
      });
      setSinglePageTypeOverrides(prev => {
        if (!prev[pageId]) return prev;
        const next = { ...prev };
        delete next[pageId];
        return next;
      });
      onPageGenerated(pageId);
    } catch (err) {
      console.error('SchemaSuggester operation failed:', err);
      setScanError('Single page generation failed');
    } finally {
      setGeneratingSingle(null);
    }
  }, [onPageGenerated, singlePageTypeOverrides, siteId, workspaceId]);

  useEffect(() => {
    if (fixContext?.pageId && fixContext.targetRoute === 'seo-schema' && !fixConsumed.current) {
      fixConsumed.current = true;
      const timer = setTimeout(() => {
        generateSinglePage(fixContext.pageId!);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [fixContext, generateSinglePage]);

  const regeneratePage = useCallback(async (pageId: string) => {
    setRegenerating(prev => new Set(prev).add(pageId));
    try {
      const result = await post<SchemaPageSuggestion>(`/api/webflow/schema-suggestions/${siteId}/page${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, { pageId });
      setData(prev => {
        if (!prev) return prev;
        return prev.map(page => page.pageId === pageId ? {
          ...result,
          lastPublishedAt: page.lastPublishedAt,
        } : page);
      });
      onPageGenerated(pageId);
    } catch (err) {
      console.error('SchemaSuggester operation failed:', err);
    } finally {
      setRegenerating(prev => {
        const next = new Set(prev);
        next.delete(pageId);
        return next;
      });
    }
  }, [onPageGenerated, siteId, workspaceId]);

  const filteredInitialPages = useMemo(() => availablePages.filter(
    page => !pageSearch || page.title.toLowerCase().includes(pageSearch.toLowerCase()) || page.slug.toLowerCase().includes(pageSearch.toLowerCase()),
  ), [availablePages, pageSearch]);

  return {
    data,
    setData,
    loading,
    started,
    regenerating,
    scanError,
    progressMsg,
    showNextSteps,
    setShowNextSteps,
    showPagePicker,
    setShowPagePicker,
    availablePages,
    pageSearch,
    setPageSearch,
    loadingPages,
    generatingSingle,
    pageTypes,
    setPageTypes,
    setSinglePageTypeOverrides,
    snapshotDate,
    filteredInitialPages,
    runScan,
    stopScan,
    fetchPages,
    generateSinglePage,
    regeneratePage,
  };
}
