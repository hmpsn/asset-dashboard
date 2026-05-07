import { useState, useEffect, useRef, useMemo } from 'react';
import { put, post } from '../api/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Upload, Check, AlertCircle, Wand2, Sparkles, RefreshCw,
} from 'lucide-react';
import type { FixContext } from '../App';
import { seoSuggestions, keywords, seoBulkJobs } from '../api/seo';
import { workspaces, jobs } from '../api';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import { WS_EVENTS } from '../lib/wsEvents';
import { queryKeys } from '../lib/queryKeys';
import { useRecommendations } from '../hooks/useRecommendations';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { useSeoEditor, usePageJoin } from '../hooks/admin';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs';
import {
  filterWritableItems,
  filterWritableIds,
  filterPagesNeedingFix,
  countMissingField,
} from '../hooks/admin/seoEditorFilters';
import { StatusBadge, LoadingState, EmptyState, Icon } from './ui';
import { useToast } from './Toast';
import { PageEditRow } from './editor/PageEditRow';
import { BulkOperations } from './editor/BulkOperations';
import { ApprovalPanel } from './editor/ApprovalPanel';
import { PendingApprovals } from './PendingApprovals';
import { SeoSuggestionsPanel } from './editor/SeoSuggestionsPanel';
import { resolvePagePath } from '../lib/pathUtils';
import type { SeoBulkMode, SeoEditState, SeoVariationSet } from './editor/seoEditorTypes';
import {
  filterAndSortSeoPages,
} from './editor/seoEditorDerived';
import {
  buildBulkRewriteRequestPages,
  buildBulkSeoUpdate,
  buildPatternApplyPayload,
  buildPatternPreviewItems,
} from './editor/seoEditorBulkHelpers';
import { useSeoEditorApprovalWorkflow } from './editor/useSeoEditorApprovalWorkflow';
import {
  buildSeoEditsFromPages,
  getSeoDraftKey,
  persistCachedExpandedPages,
  persistCachedSeoBulkAnalyzeJobId,
  persistCachedSeoBulkRewriteJobId,
  persistCachedSeoEdits,
  persistCachedSeoVariations,
  readCachedExpandedPages,
  readCachedSeoBulkAnalyzeJobId,
  readCachedSeoBulkRewriteJobId,
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
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [draftSaving, setDraftSaving] = useState<Set<string>>(new Set());
  const [draftSaved, setDraftSaved] = useState<Set<string>>(new Set());
  const [aiLoading, setAiLoading] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [bulkFixing, setBulkFixing] = useState(false);
  const [bulkResults, setBulkResults] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCmsOnly, setShowCmsOnly] = useState(false);
  const [variations, setVariations] = useState<Record<string, SeoVariationSet>>(() => {
    return readCachedSeoVariations(siteId);
  });
  const [errorStates, setErrorStates] = useState<Record<string, { type: string; message: string }>>({});
  const [previewExpanded, setPreviewExpanded] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const [bulkAnalyzeProgress, setBulkAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkAnalyzeJobId, setBulkAnalyzeJobId] = useState<string | null>(() => {
    return readCachedSeoBulkAnalyzeJobId(workspaceId);
  });
  const [bulkRewriteJobId, setBulkRewriteJobId] = useState<string | null>(() => {
    return readCachedSeoBulkRewriteJobId(workspaceId);
  });
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

  // Persist active bulk job IDs so they survive remount (nav away + back)
  useEffect(() => {
    persistCachedSeoBulkAnalyzeJobId(workspaceId, bulkAnalyzeJobId);
  }, [bulkAnalyzeJobId, workspaceId]);
  useEffect(() => {
    persistCachedSeoBulkRewriteJobId(workspaceId, bulkRewriteJobId);
  }, [bulkRewriteJobId, workspaceId]);

  // On remount, query server to recover progress UI for any restored job IDs
  const mountAnalyzeJobId = useRef(bulkAnalyzeJobId);
  const mountRewriteJobId = useRef(bulkRewriteJobId);
  useEffect(() => {
    const analyzeId = mountAnalyzeJobId.current;
    const rewriteId = mountRewriteJobId.current;
    if (!analyzeId && !rewriteId) return;
    const TERMINAL = new Set(['done', 'error', 'cancelled']);
    if (analyzeId) {
      jobs.get(analyzeId)
        .then(job => {
          if (TERMINAL.has(job.status)) { setBulkAnalyzeJobId(null); }
          else { setBulkAnalyzeProgress({ done: job.progress ?? 0, total: job.total ?? 0 }); }
        })
        .catch(() => setBulkAnalyzeJobId(null));
    }
    if (rewriteId) {
      jobs.get(rewriteId)
        .then(job => {
          if (TERMINAL.has(job.status)) { setBulkRewriteJobId(null); }
          else { setBulkMode('rewriting'); setBulkProgress({ done: job.progress ?? 0, total: job.total ?? 0 }); }
        })
        .catch(() => setBulkRewriteJobId(null));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only recovery; refs capture initial values

  // Clear approval selection when CMS filter toggles — prevents hidden pages from being silently submitted
  useEffect(() => {
    setApprovalSelected(new Set());
  }, [showCmsOnly]);

  // ── WebSocket handlers for background bulk operations ──
  useWorkspaceEvents(workspaceId, {
    [WS_EVENTS.BULK_OPERATION_PROGRESS]: (data: unknown) => {
      const d = data as { jobId: string; operation: string; done: number; total: number; failed?: number; field?: string };
      if (d.operation === 'bulk-analyze' && d.jobId === bulkAnalyzeJobId) {
        setBulkAnalyzeProgress({ done: d.done, total: d.total });
      }
      if (d.operation === 'bulk-rewrite' && d.jobId === bulkRewriteJobId) {
        setBulkProgress({ done: d.done, total: d.total });
      }
    },
    [WS_EVENTS.BULK_OPERATION_COMPLETE]: (data: unknown) => {
      const d = data as { jobId: string; operation: string; analyzed?: number; generated?: number; failed?: number; total: number; field?: string };
      if (d.operation === 'bulk-analyze' && d.jobId === bulkAnalyzeJobId) {
        setBulkAnalyzeProgress(prev => prev ? { ...prev, done: prev.total } : null);
        setBulkAnalyzeJobId(null);
        // Refresh keyword strategy so analyzed badges appear
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId!) });
        setTimeout(() => setBulkAnalyzeProgress(null), 3000);
      }
      if (d.operation === 'bulk-rewrite' && d.jobId === bulkRewriteJobId) {
        const failed = d.failed || 0;
        const generated = d.generated ?? (d.total - failed);
        const fieldLabel = d.field === 'both' ? 'title + description' : (d.field || 'title');
        setBulkResults(
          failed > 0
            ? `Generated ${generated}/${d.total} ${fieldLabel} variations (${failed} failed) — review in the suggestions panel.`
            : `Generated ${generated}/${d.total} ${fieldLabel} variations — review in the suggestions panel.`
        );
        setBulkMode('idle');
        setBulkRewriteJobId(null);
        setBulkProgress({ done: 0, total: 0 });
        refetchSuggestions();
        setTimeout(() => setBulkResults(null), 8000);
      }
    },
    [WS_EVENTS.BULK_OPERATION_FAILED]: (data: unknown) => {
      const d = data as { jobId: string; operation: string; error: string };
      if (d.operation === 'bulk-analyze' && d.jobId === bulkAnalyzeJobId) {
        setBulkAnalyzeProgress(null);
        setBulkAnalyzeJobId(null);
        setBulkResults('Bulk analysis failed: ' + d.error);
        setTimeout(() => setBulkResults(null), 5000);
      }
      if (d.operation === 'bulk-rewrite' && d.jobId === bulkRewriteJobId) {
        setBulkMode('idle');
        setBulkRewriteJobId(null);
        setBulkProgress({ done: 0, total: 0 });
        setBulkResults('Bulk rewrite failed: ' + d.error);
        setTimeout(() => setBulkResults(null), 5000);
      }
    },
  });

  // SEO Suggestions (persistent bulk rewrite variations)
  const { data: suggestionsData, refetch: refetchSuggestions } = useQuery({
    queryKey: queryKeys.admin.seoSuggestions(workspaceId!),
    queryFn: () => seoSuggestions.list(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  // Bulk operations state
  const [bulkMode, setBulkMode] = useState<SeoBulkMode>('idle');
  const [bulkField, setBulkField] = useState<'title' | 'description'>('title');
  const [patternAction, setPatternAction] = useState<'append' | 'prepend'>('append');
  const [patternText, setPatternText] = useState('');
  const [bulkPreview, setBulkPreview] = useState<Array<{ pageId: string; oldValue: string; newValue: string }>>([]);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkSource, setBulkSource] = useState<'pattern' | 'ai'>('pattern');

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

  const updateField = (pageId: string, field: keyof SeoEditState, value: string) => {
    setEdits(prev => ({
      ...prev,
      [pageId]: { ...prev[pageId], [field]: value, dirty: true },
    }));
  };

  const saveDraft = async (pageId: string) => {
    const edit = edits[pageId];
    if (!edit) return;
    setDraftSaving(prev => new Set(prev).add(pageId));
    
    try {
      // Save to local storage as draft
      const draftKey = getSeoDraftKey(workspaceId, pageId);
      const draftData = {
        seoTitle: edit.seoTitle,
        seoDescription: edit.seoDescription,
        savedAt: new Date().toISOString(),
        pageId,
        pageSlug: pages.find(p => p.id === pageId)?.slug || '',
      };
      localStorage.setItem(draftKey, JSON.stringify(draftData));
      
      // Mark as draft saved but keep dirty flag (since not published to Webflow)
      setDraftSaved(prev => new Set(prev).add(pageId));
      setTimeout(() => setDraftSaved(prev => { const n = new Set(prev); n.delete(pageId); return n; }), 2000);
    } catch (err) {
      console.error('Draft save failed:', err);
      setErrorStates(prev => ({ 
        ...prev, 
        [pageId]: { 
          type: 'validation', 
          message: 'Failed to save draft locally' 
        } 
      }));
      setTimeout(() => {
        setErrorStates(prev => { const n = { ...prev }; delete n[pageId]; return n; });
      }, 5000);
    } finally {
      setDraftSaving(prev => { const n = new Set(prev); n.delete(pageId); return n; });
    }
  };

  const savePage = async (pageId: string) => {
    const edit = edits[pageId];
    if (!edit) return;
    setSaving(prev => new Set(prev).add(pageId));
    try {
      const data = await put<{ success?: boolean; error?: string }>(`/api/webflow/pages/${pageId}/seo`, {
        siteId,
        workspaceId,
        seo: { title: edit.seoTitle, description: edit.seoDescription },
        openGraph: { title: edit.seoTitle, description: edit.seoDescription },
      });
      if (data.success === false) {
        console.error('Save failed:', data.error);
        setErrorStates(prev => ({ 
          ...prev, 
          [pageId]: { 
            type: 'validation', 
            message: `Failed to save SEO: ${data.error || 'Unknown error'}` 
          } 
        }));
        setTimeout(() => {
          setErrorStates(prev => { 
            const next = { ...prev }; 
            delete next[pageId]; 
            return next; 
          });
        }, 5000);
        return;
      }
      setEdits(prev => ({ ...prev, [pageId]: { ...prev[pageId], dirty: false } }));
      setSaved(prev => new Set(prev).add(pageId));
      // Refresh page edit states to reflect the new 'live' status
      refreshStates();
      // Invalidate audit cache so the audit reflects updated SEO status
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.auditAll() });
      setTimeout(() => setSaved(prev => { const n = new Set(prev); n.delete(pageId); return n; }), 2000);
    } catch (err) {
      console.error('Save failed:', err);
      setErrorStates(prev => ({ 
        ...prev, 
        [pageId]: { 
          type: 'network', 
          message: 'Network error saving SEO fields. Please check your connection and try again.' 
        } 
      }));
      setTimeout(() => {
        setErrorStates(prev => { 
          const next = { ...prev }; 
          delete next[pageId]; 
          return next; 
        });
      }, 5000);
    } finally {
      setSaving(prev => { const n = new Set(prev); n.delete(pageId); return n; });
    }
  };

  const aiRewrite = async (pageId: string, field: 'title' | 'description' | 'both') => {
    const page = pages.find(p => p.id === pageId);
    if (!page) return;
    const edit = edits[pageId];
    setAiLoading(prev => ({ ...prev, [pageId]: field }));
    try {
      const data = await post<{
        text?: string;
        field: string;
        variations?: string[];
        pairs?: Array<{ title: string; description: string }>;
        titleVariations?: string[];
        descriptionVariations?: string[];
      }>('/api/webflow/seo-rewrite', {
        pageTitle: page.title,
        currentSeoTitle: edit?.seoTitle || page.seo?.title,
        currentDescription: edit?.seoDescription || page.seo?.description,
        field,
        workspaceId,
        pagePath: resolvePagePath(page),
      });

      if (field === 'both' && data.pairs && data.pairs.length > 0) {
        // Paired mode — show variation picker without overwriting current values
        setVariations(prev => ({
          ...prev,
          [pageId]: { field: 'both', options: data.pairs!.map(p => p.title), descOptions: data.pairs!.map(p => p.description) },
        }));
      } else if (data.variations && data.variations.length > 1) {
        // Show variation picker without overwriting current values
        setVariations(prev => ({ ...prev, [pageId]: { field, options: data.variations! } }));
      } else if (data.text) {
        // Single result (no picker) — apply directly
        const key = field === 'title' ? 'seoTitle' : 'seoDescription';
        updateField(pageId, key, data.text);
      }
    } catch (err) {
      console.error('AI rewrite failed:', err);
    } finally {
      setAiLoading(prev => { const n = { ...prev }; delete n[pageId]; return n; });
    }
  };


  const analyzePage = async (pageId: string) => {
    const page = pages.find(p => p.id === pageId);
    if (!page || !workspaceId) return;
    const edit = edits[pageId];

    setAnalyzing(prev => new Set(prev).add(pageId));
    try {
      // Step 1: Run keyword analysis
      const analysis = await keywords.analyze({
        pageTitle: page.title,
        seoTitle: edit?.seoTitle || page.seo?.title || '',
        metaDescription: edit?.seoDescription || page.seo?.description || '',
        slug: resolvePagePath(page),
        workspaceId,
      }) as Record<string, unknown>;

      if (analysis && !analysis.error) {
        // Step 2: Persist analysis to workspace keyword strategy
        await keywords.persistAnalysis({
          workspaceId,
          pagePath: resolvePagePath(page),
          analysis,
        });

        // Instant feedback: mark page as analyzed locally before async refetch completes
        setLocalAnalyzedPages(prev => new Set(prev).add(pageId));
        // Refresh strategy query so UI updates; analyzedPages overlay will persist until refetch
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId!) });
      }
    } catch (err) {
      console.error('Page analysis failed:', err);
    } finally {
      setAnalyzing(prev => { const n = new Set(prev); n.delete(pageId); return n; });
    }
  };

  const analyzeAllPages = async () => {
    if (!workspaceId) return;
    const toAnalyze = pages.filter(p => !analyzedPages.has(p.id));
    if (toAnalyze.length === 0) return;
    setBulkAnalyzeProgress({ done: 0, total: toAnalyze.length });
    try {
      const { jobId } = await seoBulkJobs.bulkAnalyze(workspaceId, {
        pages: toAnalyze.map(p => ({
          pageId: p.id,
          title: p.title,
          slug: p.slug,
          publishedPath: p.publishedPath,
          seoTitle: edits[p.id]?.seoTitle || p.seo?.title || '',
          seoDescription: edits[p.id]?.seoDescription || p.seo?.description || '',
        })),
      });
      trackJob(BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE, jobId, { workspaceId });
      setBulkAnalyzeJobId(jobId);
    } catch (err) {
      console.error('Failed to start bulk analyze:', err);
      setBulkAnalyzeProgress(null);
    }
  };

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
        pages: pagesNeedingFix.map(p => ({
          pageId: p.id,
          title: p.title,
          currentSeoTitle: p.seo?.title,
          currentDescription: p.seo?.description,
        })),
      });
      const applied = data.results?.filter((r: { applied: boolean }) => r.applied).length || 0;
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

  // ── Bulk Pattern Apply ──
  const previewPattern = () => {
    if (!patternText.trim()) return;
    // Exclude CMS pages upfront — their synthetic IDs are rejected by the Webflow API on apply
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
        { workspaceId, pages: pagesPayload, field: bulkField, action: patternAction, text: patternText }
      );
      const applied = data.results?.filter(r => r.applied).length || 0;
      setBulkResults(`Pattern applied to ${applied}/${bulkPreview.length} pages.`);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId, workspaceId) });
    } catch { setBulkResults('Pattern apply failed.'); }
    finally { setBulkMode('idle'); setBulkPreview([]); setPatternText(''); setTimeout(() => setBulkResults(null), 5000); }
  };

  // ── Bulk AI Rewrite — background job with WS progress ──
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
    // Pre-filter to only static pages — CMS pages have synthetic IDs the Webflow API rejects.
    // Filtering here (not inside the loop) ensures total/progress counts are accurate.
    const staticItems = filterWritableItems(bulkPreview, pages);
    const pageById = new Map(pages.map(page => [page.id, page]));
    setBulkMode('rewriting');
    setBulkProgress({ done: 0, total: staticItems.length });
    try {
      for (const item of staticItems) {
        const page = pageById.get(item.pageId);
        if (!page) continue;
        const seoFields = buildBulkSeoUpdate(bulkField, item.newValue, page, edits[page.id]);
        await put(`/api/webflow/pages/${page.id}/seo`, { siteId, workspaceId, ...seoFields });
        setBulkProgress(prev => ({ ...prev, done: prev.done + 1 }));
      }
      setBulkResults(`Applied ${staticItems.length} ${bulkField === 'title' ? 'title' : 'description'} changes.`);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId, workspaceId) });
    } catch { setBulkResults('Apply failed.'); }
    finally { setBulkMode('idle'); setBulkPreview([]); setTimeout(() => setBulkResults(null), 5000); }
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

  if (loading) {
    return (
      <LoadingState 
        message="Loading page metadata..."
        size="lg"
      />
    );
  }

  // CMS pages have synthetic IDs that Webflow API rejects — exclude from actionable counts
  const missingTitles = countMissingField(pages, 'title');
  const missingDescs = countMissingField(pages, 'description');

  return (
    <div className="space-y-8">
      {/* Stats bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="t-caption-sm text-[var(--brand-text)]">
          <span className="font-medium text-[var(--brand-text-bright)]">{pages.length}</span> pages
        </div>
        {missingTitles > 0 && (
          <span className="t-caption-sm px-2 py-0.5 rounded bg-amber-500/8 border border-amber-500/30 text-accent-warning">
            {missingTitles} missing SEO titles
          </span>
        )}
        {missingDescs > 0 && (
          <span className="t-caption-sm px-2 py-0.5 rounded bg-red-500/8 border border-red-500/30 text-accent-danger">
            {missingDescs} missing meta descriptions
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId, workspaceId) })}
          className="p-1.5 rounded text-[var(--brand-text-muted)] hover:text-accent-brand hover:bg-[var(--surface-3)] transition-colors"
          title="Refresh pages from Webflow"
        >
          <Icon as={RefreshCw} size="md" />
        </button>
        <button
          onClick={() => handleBulkFix('title')}
          disabled={bulkFixing || missingTitles === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-[var(--radius-lg)] t-caption-sm font-medium transition-colors"
        >
          <Icon as={Wand2} size="sm" /> AI Fix Titles ({missingTitles})
        </button>
        <button
          onClick={() => handleBulkFix('description')}
          disabled={bulkFixing || missingDescs === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-[var(--radius-lg)] t-caption-sm font-medium transition-colors"
        >
          <Icon as={Wand2} size="sm" /> AI Fix Descriptions ({missingDescs})
        </button>
        {workspaceId && (
          <ApprovalPanel
            approvalSelected={approvalSelected}
            sendingApproval={sendingApproval}
            approvalSent={approvalSent}
            onSendApproval={sendForApproval}
          />
        )}
        <button
          onClick={handlePublish}
          disabled={publishing}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium transition-colors ${
            published
              ? 'bg-[var(--emerald)] text-white'
              : 'bg-[var(--surface-3)] text-[var(--brand-text-bright)] hover:bg-[var(--surface-active)]'
          }`}
        >
          <Icon as={publishing ? Loader2 : published ? Check : Upload} size="sm" className={publishing ? 'animate-spin' : ''} />
          {published ? 'Published!' : publishing ? 'Publishing...' : 'Publish Site'}
        </button>
      </div>

      {bulkFixing && (
        <LoadingState 
          message={`AI is generating content for ${missingTitles + missingDescs} pages...`}
          size="md"
          className="border border-teal-500/30"
        />
      )}
      {bulkResults && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-500/8 border border-emerald-500/30 rounded-[var(--radius-lg)] t-caption-sm text-accent-success">
          <Icon as={Check} size="md" /> {bulkResults}
        </div>
      )}

      {/* Pending approval batches sent to client */}
      {workspaceId && (
        <PendingApprovals
          workspaceId={workspaceId}
          refreshKey={approvalRefreshKey}
          nameFilter="SEO"
          onRetracted={() => refreshStates()}
        />
      )}

      {/* Edit status summary bar */}
      {summary.total > 0 && (
        <div className="flex items-center gap-3 t-caption-sm text-[var(--brand-text-muted)]">
          <span className="text-[var(--brand-text)] font-medium">{summary.total} tracked</span>
          {summary.live > 0 && <StatusBadge status="live" />}
          {summary.live > 0 && <span className="text-accent-brand">{summary.live}</span>}
          {summary.inReview > 0 && <StatusBadge status="in-review" />}
          {summary.inReview > 0 && <span className="text-accent-warning">{summary.inReview}</span>}
          {summary.approved > 0 && <StatusBadge status="approved" />}
          {summary.approved > 0 && <span className="text-accent-success">{summary.approved}</span>}
          {summary.rejected > 0 && <StatusBadge status="rejected" />}
          {summary.rejected > 0 && <span className="text-accent-danger">{summary.rejected}</span>}
          {summary.issueDetected > 0 && <StatusBadge status="issue-detected" />}
          {summary.issueDetected > 0 && <span className="text-accent-warning">{summary.issueDetected}</span>}
          {summary.fixProposed > 0 && <StatusBadge status="fix-proposed" />}
          {summary.fixProposed > 0 && <span className="text-accent-info">{summary.fixProposed}</span>}
          {workspaceId && (
            <button
              onClick={async () => {
                await post(`/api/workspaces/${workspaceId}/page-states/clear`, { status: 'all' });
                refreshStates();
              }}
              className="ml-auto t-caption-sm text-[var(--brand-text-muted)] hover:text-accent-danger underline underline-offset-2 transition-colors"
            >
              reset all
            </button>
          )}
        </div>
      )}

      {/* Always-visible reset — clears all page edit states + stale approval data */}
      {workspaceId && summary.total === 0 && (
        <button
          onClick={async () => {
            await post(`/api/workspaces/${workspaceId}/page-states/clear`, { status: 'all' });
            refreshStates();
          }}
          className="t-caption-sm text-[var(--brand-text-muted)] hover:text-accent-danger underline underline-offset-2 transition-colors"
        >
          Reset page tracking
        </button>
      )}

      {/* Analyze All Pages */}
      {workspaceId && (
        <div className="flex items-center gap-3">
          {bulkAnalyzeProgress ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-teal-500/10 border border-teal-500/30 rounded-[var(--radius-lg)]">
              <Icon as={Loader2} size="md" className="animate-spin text-accent-brand" />
              <span className="t-caption-sm text-[var(--brand-text-bright)]">Analyzing {bulkAnalyzeProgress.done}/{bulkAnalyzeProgress.total} pages...</span>
              <button onClick={() => { if (bulkAnalyzeJobId) { cancelJob(bulkAnalyzeJobId); setBulkAnalyzeJobId(null); setBulkAnalyzeProgress(null); queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId!) }); } }} className="t-caption-sm text-accent-danger hover:text-accent-danger ml-2">Cancel</button>
            </div>
          ) : (
            <button
              onClick={analyzeAllPages}
              disabled={analyzing.size > 0 || analyzedPages.size === pages.length}
              className="flex items-center gap-1.5 px-3 py-1.5 t-caption-sm font-medium bg-teal-600/80 hover:bg-teal-500/80 text-white rounded-[var(--radius-lg)] transition-colors disabled:opacity-40"
            >
              <Icon as={Sparkles} size="md" />
              {analyzedPages.size === pages.length && pages.length > 0
                ? 'All Pages Analyzed'
                : analyzedPages.size > 0
                  ? `Analyze Remaining (${pages.length - analyzedPages.size})`
                  : 'Analyze All Pages'}
            </button>
          )}
          {analyzedPages.size > 0 && !bulkAnalyzeProgress && (
            <span className="t-caption-sm text-accent-success">{analyzedPages.size}/{pages.length} pages have analysis on file</span>
          )}
        </div>
      )}

      {/* CMS filter toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowCmsOnly(prev => !prev)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium transition-colors border ${
            showCmsOnly
              ? 'bg-teal-600/20 border-teal-500/40 text-accent-brand'
              : 'bg-[var(--surface-3)] border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]'
          }`}
        >
          CMS pages only
        </button>
        {showCmsOnly && (
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            {filteredPages.length} CMS pages
          </span>
        )}
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search pages..."
        className="w-full px-4 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] t-caption-sm text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-[var(--brand-border-hover)]"
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
        onCancelRewrite={() => { if (bulkRewriteJobId) { cancelJob(bulkRewriteJobId); setBulkRewriteJobId(null); } setBulkMode('idle'); setBulkProgress({ done: 0, total: 0 }); }}
        onClearPreview={() => { setBulkMode('idle'); setBulkPreview([]); }}
      />

      {/* Page list */}
      <div className="space-y-2">
        {showCmsOnly && filteredPages.length === 0 && (
          <EmptyState
            icon={AlertCircle}
            title="No CMS pages found"
            description="No CMS collection pages were discovered via sitemap. Static pages are hidden while this filter is active."
          />
        )}
        {filteredPages.map(page => (
          <div key={page.id}>
            {page.source === 'cms' && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/8 border border-amber-500/20 rounded t-caption-sm text-accent-warning mb-1">
                <Icon as={AlertCircle} size="sm" />
                Manual apply required — CMS pages must be updated directly in Webflow
              </div>
            )}
            <PageEditRow
              page={page} edit={edits[page.id]}
              expanded={expanded.has(page.id)} isSaving={saving.has(page.id)}
              isSaved={saved.has(page.id)} isAiLoading={aiLoading[page.id]}
              isDraftSaving={draftSaving.has(page.id)} isDraftSaved={draftSaved.has(page.id)}
              isSelected={approvalSelected.has(page.id)}
              pageRecs={recsLoaded ? recsForPage(resolvePagePath(page)) : []}
              pageState={getState(page.id)} variations={variations[page.id]}
              showApprovalCheckbox={!!workspaceId} isSendingToClient={sendingPage.has(page.id)}
              isSentToClient={sentPage.has(page.id)} hasChanges={!!(edits[page.id] && ((edits[page.id].seoTitle ?? '') !== (page.seo?.title ?? '') || (edits[page.id].seoDescription ?? '') !== (page.seo?.description ?? '')))}
              onSendToClient={sendPageToClient}
              onToggleExpand={toggleExpand} onToggleApprovalSelect={toggleApprovalSelect}
              onUpdateField={updateField} onSave={page.source === 'cms' ? undefined : savePage} isCmsPage={page.source === 'cms'} onSaveDraft={saveDraft} onAiRewrite={aiRewrite}
              onSelectVariation={(pageId, field, value) => updateField(pageId, field, value)}
              onClearVariations={(pageId) => setVariations(prev => { const n = { ...prev }; delete n[pageId]; return n; })}
              onClearTracking={workspaceId ? async (pageId) => {
                try {
                  await workspaces.deletePageState(workspaceId, pageId);
                  refreshStates();
                } catch (err) { console.error('SeoEditor operation failed:', err); }
              } : undefined}
              errorState={errorStates[page.id] || null}
              showPreview={previewExpanded.has(page.id)}
              onTogglePreview={togglePreview}
              onAnalyzePage={workspaceId ? analyzePage : undefined}
              hasAnalysis={analyzedPages.has(page.id)}
              isAnalyzing={analyzing.has(page.id)}
              primaryKeyword={pageKeywordMap.get(page.id)?.primaryKeyword}
              secondaryKeywords={pageKeywordMap.get(page.id)?.secondaryKeywords}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
