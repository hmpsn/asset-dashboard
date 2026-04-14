import { useState, useEffect, useRef } from 'react';
import { put, post, del } from '../api/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Upload, Check, AlertCircle, Wand2, Sparkles, RefreshCw,
} from 'lucide-react';
import type { FixContext } from '../App';
import { seoSuggestions, keywords, seoBulkJobs } from '../api/seo';
import { workspaces } from '../api';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import { queryKeys } from '../lib/queryKeys';
import { useRecommendations } from '../hooks/useRecommendations';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { useSeoEditor } from '../hooks/admin';
import {
  filterWritableItems,
  filterWritableIds,
  filterPagesNeedingFix,
  countMissingField,
} from '../hooks/admin/seoEditorFilters';
import { StatusBadge, LoadingState, EmptyState } from './ui';
import { PageEditRow } from './editor/PageEditRow';
import { BulkOperations } from './editor/BulkOperations';
import { ApprovalPanel } from './editor/ApprovalPanel';
import { PendingApprovals } from './PendingApprovals';
import { SeoSuggestionsPanel } from './editor/SeoSuggestionsPanel';

interface EditState {
  seoTitle: string;
  seoDescription: string;
  dirty: boolean;
}

interface Props {
  siteId: string;
  workspaceId?: string;
  fixContext?: FixContext | null;
}

export function SeoEditor({ siteId, workspaceId, fixContext }: Props) {
  const { forPage: recsForPage, loaded: recsLoaded } = useRecommendations(workspaceId);
  const queryClient = useQueryClient();
  
  // React Query hook replaces manual data fetching
  const { data: pages = [], isLoading: loading } = useSeoEditor(siteId, workspaceId);
  
  // Session persistence: restore edits/variations/expanded from sessionStorage (survives tab switches + refresh)
  const restoredFromCache = useRef(false);
  const [edits, setEdits] = useState<Record<string, EditState>>(() => {
    try {
      const raw = sessionStorage.getItem(`seo-editor-edits-${siteId}`);
      if (raw) { const parsed = JSON.parse(raw); if (Object.keys(parsed).length > 0) { restoredFromCache.current = true; return parsed; } }
    } catch { /* ignore */ }
    return {};
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem(`seo-editor-expanded-${siteId}`);
      if (raw) return new Set(JSON.parse(raw));
    } catch { /* ignore */ }
    return new Set();
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
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [approvalSelected, setApprovalSelected] = useState<Set<string>>(new Set());
  const [sendingApproval, setSendingApproval] = useState(false);
  const [approvalSent, setApprovalSent] = useState(false);
  const [approvalRefreshKey, setApprovalRefreshKey] = useState(0);
  const [sendingPage, setSendingPage] = useState<Set<string>>(new Set());
  const [sentPage, setSentPage] = useState<Set<string>>(new Set());
  const [variations, setVariations] = useState<Record<string, { field: string; options: string[]; descOptions?: string[] }>>(() => {
    try {
      const raw = sessionStorage.getItem(`seo-editor-vars-${siteId}`);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return {};
  });
  const [errorStates, setErrorStates] = useState<Record<string, { type: string; message: string }>>({});
  const [previewExpanded, setPreviewExpanded] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const [analyzedPages, setAnalyzedPages] = useState<Set<string>>(new Set());
  const [bulkAnalyzeProgress, setBulkAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkAnalyzeJobId, setBulkAnalyzeJobId] = useState<string | null>(null);
  const [bulkRewriteJobId, setBulkRewriteJobId] = useState<string | null>(null);
  const { getState, refresh: refreshStates, summary } = usePageEditStates(workspaceId);

  // Sync edits/variations/expanded to sessionStorage for persistence across tab switches + refresh
  useEffect(() => { if (Object.keys(edits).length > 0) try { sessionStorage.setItem(`seo-editor-edits-${siteId}`, JSON.stringify(edits)); } catch { /* ignore */ } }, [edits, siteId]);
  useEffect(() => { try { sessionStorage.setItem(`seo-editor-expanded-${siteId}`, JSON.stringify(Array.from(expanded))); } catch { /* ignore */ } }, [expanded, siteId]);
  useEffect(() => { try { sessionStorage.setItem(`seo-editor-vars-${siteId}`, JSON.stringify(variations)); } catch { /* ignore */ } }, [variations, siteId]);

  // Clear approval selection when CMS filter toggles — prevents hidden pages from being silently submitted
  useEffect(() => {
    setApprovalSelected(new Set());
  }, [showCmsOnly]);

  // ── WebSocket handlers for background bulk operations ──
  useWorkspaceEvents(workspaceId, {
    'bulk-operation:progress': (data: unknown) => {
      const d = data as { jobId: string; operation: string; done: number; total: number; failed?: number; field?: string };
      if (d.operation === 'bulk-analyze' && d.jobId === bulkAnalyzeJobId) {
        setBulkAnalyzeProgress({ done: d.done, total: d.total });
      }
      if (d.operation === 'bulk-rewrite' && d.jobId === bulkRewriteJobId) {
        setBulkProgress({ done: d.done, total: d.total });
      }
    },
    'bulk-operation:complete': (data: unknown) => {
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
        const generated = d.generated || (d.total - failed);
        const fieldLabel = d.field === 'both' ? 'title + description' : (d.field || 'title');
        setBulkResults(
          failed > 0
            ? `Generated ${generated}/${d.total} ${fieldLabel} variations (${failed} failed) — review in the suggestions panel.`
            : `Generated ${generated}/${d.total} ${fieldLabel} variations — review in the suggestions panel.`
        );
        setBulkMode('idle');
        setBulkRewriteJobId(null);
        refetchSuggestions();
        setTimeout(() => setBulkResults(null), 8000);
      }
    },
    'bulk-operation:failed': (data: unknown) => {
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
  const [bulkMode, setBulkMode] = useState<'idle' | 'pattern' | 'rewrite-preview' | 'rewriting'>('idle');
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
    const editMap: Record<string, EditState> = {};
    for (const p of pages) {
      // Check for saved draft first
      const draftKey = `seo-draft-${workspaceId}-${p.id}`;
      let seoTitle = p.seo?.title || '';
      let seoDescription = p.seo?.description || '';
      let dirty = false;

      try {
        const draftData = localStorage.getItem(draftKey);
        if (draftData) {
          const draft = JSON.parse(draftData);
          // Only use draft if it's newer than the current Webflow data
          const draftDate = new Date(draft.savedAt);
          const lastModified = new Date(); // We don't have page last modified, so use draft if it exists
          if (draftDate <= lastModified) {
            seoTitle = draft.seoTitle;
            seoDescription = draft.seoDescription;
            dirty = true; // Mark as dirty since it differs from Webflow
          }
        }
      } catch (err) {
        console.warn('Failed to load draft for page', p.id, err);
      }

      editMap[p.id] = {
        seoTitle,
        seoDescription,
        dirty,
      };
    }
    setEdits(editMap);
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

  useEffect(() => {
    setHasUnsaved(Object.values(edits).some(e => e.dirty));
  }, [edits]);

  const updateField = (pageId: string, field: keyof EditState, value: string) => {
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
      const draftKey = `seo-draft-${workspaceId}-${pageId}`;
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
        pagePath: `/${page.slug || ''}`,
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

  // Fetch keyword strategy to know which pages already have persisted analysis
  const { data: strategyData } = useQuery({
    queryKey: queryKeys.admin.keywordStrategy(workspaceId!),
    queryFn: () => keywords.webflowStrategy(workspaceId!) as Promise<{ pageMap?: Array<{ pagePath: string; analysisGeneratedAt?: string }> }>,
    enabled: !!workspaceId,
    staleTime: 60_000,
  });

  // Build set of page slugs that have persisted analysis
  useEffect(() => {
    if (!strategyData?.pageMap) return;
    const analyzed = new Set<string>();
    for (const entry of strategyData.pageMap) {
      if (entry.analysisGeneratedAt) {
        // Match by slug — pageMap stores paths like "/slug"
        const slug = entry.pagePath.replace(/^\//, '');
        const match = pages.find(p => p.slug === slug || entry.pagePath.includes(p.slug));
        if (match) analyzed.add(match.id);
      }
    }
    setAnalyzedPages(analyzed);
  }, [strategyData, pages]);

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
        slug: page.slug,
        workspaceId,
      }) as Record<string, unknown>;

      if (analysis && !analysis.error) {
        // Step 2: Persist analysis to workspace keyword strategy
        await keywords.persistAnalysis({
          workspaceId,
          pagePath: `/${page.slug || ''}`,
          analysis,
        });

        // Mark page as analyzed
        setAnalyzedPages(prev => new Set(prev).add(pageId));
        // Refresh strategy query so UI updates
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
        workspaceId,
        pages: toAnalyze.map(p => ({
          pageId: p.id,
          title: p.title,
          slug: p.slug,
          seoTitle: edits[p.id]?.seoTitle || p.seo?.title || '',
          seoDescription: edits[p.id]?.seoDescription || p.seo?.description || '',
        })),
      });
      setBulkAnalyzeJobId(jobId);
    } catch (err) {
      console.error('Failed to start bulk analyze:', err);
      setBulkAnalyzeProgress(null);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const data = await post<{ success?: boolean }>(`/api/webflow/publish/${siteId}`);
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
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId) });
      setTimeout(() => setBulkResults(null), 5000);
    } catch (err) {
      console.error('SeoEditor operation failed:', err);
      setBulkResults('Bulk fix failed.');
    } finally {
      setBulkFixing(false);
    }
  };

  const toggleApprovalSelect = (pageId: string) => {
    setApprovalSelected(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
      return next;
    });
  };

  const selectAllForApproval = () => {
    if (approvalSelected.size === filteredPages.length) {
      setApprovalSelected(new Set());
    } else {
      setApprovalSelected(new Set(filteredPages.map(p => p.id)));
    }
  };

  // ── Bulk Pattern Apply ──
  const previewPattern = () => {
    if (!patternText.trim()) return;
    const maxLen = bulkField === 'description' ? 160 : 60;
    // Exclude CMS pages upfront — their synthetic IDs are rejected by the Webflow API on apply
    const preview = filterWritableIds(Array.from(approvalSelected), pages).map(pageId => {
      const page = pages.find(p => p.id === pageId);
      const edit = edits[pageId];
      if (!page || !edit) return null;
      const oldValue = bulkField === 'title' ? (edit.seoTitle || page.seo?.title || '') : (edit.seoDescription || page.seo?.description || '');
      let newValue = patternAction === 'append' ? `${oldValue} ${patternText}`.trim() : `${patternText} ${oldValue}`.trim();
      if (newValue.length > maxLen) newValue = newValue.slice(0, maxLen).replace(/\s+\S*$/, '');
      return { pageId, oldValue, newValue };
    }).filter(Boolean) as Array<{ pageId: string; oldValue: string; newValue: string }>;
    setBulkPreview(preview);
    setBulkSource('pattern');
    setBulkMode('rewrite-preview');
  };

  const applyPattern = async () => {
    setBulkMode('rewriting');
    setBulkProgress({ done: 0, total: bulkPreview.length });
    try {
      const pagesPayload = bulkPreview.map(p => {
        const page = pages.find(pg => pg.id === p.pageId);
        return { pageId: p.pageId, title: page?.title || '', slug: page?.slug, currentValue: p.oldValue };
      });
      const data = await post<{ results: Array<{ pageId: string; newValue: string; applied: boolean }> }>(
        `/api/webflow/seo-pattern-apply/${siteId}`,
        { pages: pagesPayload, field: bulkField, action: patternAction, text: patternText }
      );
      const applied = data.results?.filter(r => r.applied).length || 0;
      setBulkResults(`Pattern applied to ${applied}/${bulkPreview.length} pages.`);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId) });
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

    // Auto-expand all selected pages so users can watch results appear
    setExpanded(prev => {
      const next = new Set(prev);
      for (const id of selectedIds) next.add(id);
      return next;
    });

    try {
      const { jobId } = await seoBulkJobs.bulkRewrite(workspaceId, {
        workspaceId,
        siteId,
        pages: selectedIds.map(id => {
          const page = pages.find(p => p.id === id);
          const edit = edits[id];
          return {
            pageId: id,
            title: page?.title || '',
            slug: page?.slug,
            currentSeoTitle: edit?.seoTitle || page?.seo?.title || '',
            currentDescription: edit?.seoDescription || page?.seo?.description || '',
          };
        }),
        field,
      });
      setBulkRewriteJobId(jobId);
    } catch (err) {
      console.error('Failed to start bulk rewrite:', err);
      setBulkMode('idle');
      setBulkResults('Failed to start bulk rewrite.');
      setTimeout(() => setBulkResults(null), 5000);
    }
  };

  const applyBulkRewrite = async () => {
    // Pre-filter to only static pages — CMS pages have synthetic IDs the Webflow API rejects.
    // Filtering here (not inside the loop) ensures total/progress counts are accurate.
    const staticItems = filterWritableItems(bulkPreview, pages);
    setBulkMode('rewriting');
    setBulkProgress({ done: 0, total: staticItems.length });
    try {
      for (const item of staticItems) {
        const page = pages.find(pg => pg.id === item.pageId);
        if (!page) continue;
        const seoFields = bulkField === 'title'
          ? { seo: { title: item.newValue, description: edits[page.id]?.seoDescription || page.seo?.description || '' } }
          : { seo: { title: edits[page.id]?.seoTitle || page.seo?.title || '', description: item.newValue } };
        await put(`/api/webflow/pages/${page.id}/seo`, { siteId, ...seoFields, openGraph: seoFields.seo });
        setBulkProgress(prev => ({ ...prev, done: prev.done + 1 }));
      }
      setBulkResults(`Applied ${staticItems.length} ${bulkField === 'title' ? 'title' : 'description'} changes.`);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId) });
    } catch { setBulkResults('Apply failed.'); }
    finally { setBulkMode('idle'); setBulkPreview([]); setTimeout(() => setBulkResults(null), 5000); }
  };

  const sendPageToClient = async (pageId: string) => {
    if (!workspaceId) return;
    const page = pages.find(p => p.id === pageId);
    const edit = edits[pageId];
    // CMS pages (sitemap-discovered or template pages) cannot be written via the approvals
    // API — sitemap pages have synthetic IDs, template pages' collectionId is a page-level
    // attribute, not a CMS item ID. Exclude them entirely from the approval workflow.
    if (!page || !edit || page.source === 'cms') return;
    const items: Array<{ pageId: string; pageTitle: string; pageSlug: string; field: 'seoTitle' | 'seoDescription'; currentValue: string; proposedValue: string }> = [];
    if (edit.seoTitle !== (page.seo?.title || '')) {
      items.push({ pageId, pageTitle: page.title, pageSlug: page.slug, field: 'seoTitle', currentValue: page.seo?.title || '', proposedValue: edit.seoTitle });
    }
    if (edit.seoDescription !== (page.seo?.description || '')) {
      items.push({ pageId, pageTitle: page.title, pageSlug: page.slug, field: 'seoDescription', currentValue: page.seo?.description || '', proposedValue: edit.seoDescription });
    }
    if (items.length === 0) return;
    setSendingPage(prev => new Set(prev).add(pageId));
    try {
      await post(`/api/approvals/${workspaceId}`, { siteId, name: `SEO Review — ${page.title}`, items });
      setSentPage(prev => new Set(prev).add(pageId));
      refreshStates();
      setTimeout(() => setSentPage(prev => { const n = new Set(prev); n.delete(pageId); return n; }), 4000);
    } catch (err) { console.error('SeoEditor operation failed:', err); }
    setSendingPage(prev => { const n = new Set(prev); n.delete(pageId); return n; });
  };

  const sendForApproval = async () => {
    if (!workspaceId || approvalSelected.size === 0) return;
    setSendingApproval(true);
    try {
      const items: Array<{ pageId: string; pageTitle: string; pageSlug: string; field: 'seoTitle' | 'seoDescription'; currentValue: string; proposedValue: string }> = [];
      // filterWritableIds excludes CMS pages (source === 'cms') — these cannot be written
      // via the approvals API. collectionId is intentionally omitted: on Webflow template
      // pages it means "renders this collection", not "this is a collection item ID".
      // Passing it would mis-route items into updateCollectionItem(collectionId, pageId)
      // where pageId ≠ itemId → 404.
      for (const pageId of filterWritableIds(Array.from(approvalSelected), pages)) {
        const page = pages.find(p => p.id === pageId);
        const edit = edits[pageId];
        if (!page || !edit) continue;
        // Include title if changed from original
        if (edit.seoTitle !== (page.seo?.title || '')) {
          items.push({
            pageId, pageTitle: page.title, pageSlug: page.slug,
            field: 'seoTitle', currentValue: page.seo?.title || '', proposedValue: edit.seoTitle,
          });
        }
        // Include description if changed from original
        if (edit.seoDescription !== (page.seo?.description || '')) {
          items.push({
            pageId, pageTitle: page.title, pageSlug: page.slug,
            field: 'seoDescription', currentValue: page.seo?.description || '', proposedValue: edit.seoDescription,
          });
        }
      }
      if (items.length === 0) {
        alert('No changes detected on selected pages. Edit SEO fields first.');
        setSendingApproval(false);
        return;
      }
      await post(`/api/approvals/${workspaceId}`, { siteId, name: `SEO Changes — ${new Date().toLocaleDateString()}`, items });
      setApprovalSent(true);
      // Refresh page edit states to reflect the new 'in-review' status
      refreshStates();
      setApprovalSelected(new Set());
      setApprovalRefreshKey(k => k + 1);
      setTimeout(() => setApprovalSent(false), 4000);
    } catch (err) {
      console.error('Failed to send for approval:', err);
      alert('Failed to send for approval');
    } finally {
      setSendingApproval(false);
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

  const filteredPages = pages.filter(p => {
    if (showCmsOnly && p.source !== 'cms') return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return p.title.toLowerCase().includes(q) || (p.slug || '').toLowerCase().includes(q);
  }).sort((a, b) => {
    const scoreA = (!a.seo?.title ? 2 : 0) + (!a.seo?.description ? 2 : 0) + (recsLoaded ? recsForPage(a.slug).filter((r: { type: string }) => r.type === 'metadata').length : 0);
    const scoreB = (!b.seo?.title ? 2 : 0) + (!b.seo?.description ? 2 : 0) + (recsLoaded ? recsForPage(b.slug).filter((r: { type: string }) => r.type === 'metadata').length : 0);
    return scoreB - scoreA;
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
        <div className="text-sm text-zinc-400">
          <span className="font-medium text-zinc-200">{pages.length}</span> pages
        </div>
        {missingTitles > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-500/8 border border-amber-500/30 text-amber-400/80">
            {missingTitles} missing SEO titles
          </span>
        )}
        {missingDescs > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-red-500/8 border border-red-500/30 text-red-400/80">
            {missingDescs} missing meta descriptions
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId) })}
          className="p-1.5 rounded text-zinc-500 hover:text-teal-400 hover:bg-zinc-800 transition-colors"
          title="Refresh pages from Webflow"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => handleBulkFix('title')}
          disabled={bulkFixing || missingTitles === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
        >
          <Wand2 className="w-3 h-3" /> AI Fix Titles ({missingTitles})
        </button>
        <button
          onClick={() => handleBulkFix('description')}
          disabled={bulkFixing || missingDescs === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
        >
          <Wand2 className="w-3 h-3" /> AI Fix Descriptions ({missingDescs})
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
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            published ? 'bg-green-600 text-white' : 'bg-white text-black hover:bg-zinc-200'
          }`}
        >
          {publishing ? <Loader2 className="w-3 h-3 animate-spin" /> : published ? <Check className="w-3 h-3" /> : <Upload className="w-3 h-3" />}
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
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-500/8 border border-emerald-500/30 rounded-lg text-sm text-emerald-300">
          <Check className="w-4 h-4" /> {bulkResults}
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
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="text-zinc-400 font-medium">{summary.total} tracked</span>
          {summary.live > 0 && <StatusBadge status="live" />}
          {summary.live > 0 && <span className="text-teal-400">{summary.live}</span>}
          {summary.inReview > 0 && <StatusBadge status="in-review" />}
          {summary.inReview > 0 && <span className="text-purple-400">{summary.inReview}</span>}
          {summary.approved > 0 && <StatusBadge status="approved" />}
          {summary.approved > 0 && <span className="text-emerald-400/80">{summary.approved}</span>}
          {summary.rejected > 0 && <StatusBadge status="rejected" />}
          {summary.rejected > 0 && <span className="text-red-400/80">{summary.rejected}</span>}
          {summary.issueDetected > 0 && <StatusBadge status="issue-detected" />}
          {summary.issueDetected > 0 && <span className="text-amber-400/80">{summary.issueDetected}</span>}
          {summary.fixProposed > 0 && <StatusBadge status="fix-proposed" />}
          {summary.fixProposed > 0 && <span className="text-blue-400">{summary.fixProposed}</span>}
          {workspaceId && (
            <button
              onClick={async () => {
                await post(`/api/workspaces/${workspaceId}/page-states/clear`, { status: 'all' });
                refreshStates();
              }}
              className="ml-auto text-[10px] text-zinc-500 hover:text-red-400 underline underline-offset-2 transition-colors"
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
          className="text-[10px] text-zinc-500 hover:text-red-400 underline underline-offset-2 transition-colors"
        >
          Reset page tracking
        </button>
      )}

      {/* Analyze All Pages */}
      {workspaceId && (
        <div className="flex items-center gap-3">
          {bulkAnalyzeProgress ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 border border-purple-500/30 rounded-lg">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
              <span className="text-xs text-zinc-300">Analyzing {bulkAnalyzeProgress.done}/{bulkAnalyzeProgress.total} pages...</span>
              <button onClick={() => { if (bulkAnalyzeJobId) { del(`/api/jobs/${bulkAnalyzeJobId}`).catch(() => {}); setBulkAnalyzeJobId(null); setBulkAnalyzeProgress(null); } }} className="text-[11px] text-red-400 hover:text-red-300 ml-2">Cancel</button>
            </div>
          ) : (
            <button
              onClick={analyzeAllPages}
              disabled={analyzing.size > 0 || analyzedPages.size === pages.length}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-600/80 hover:bg-purple-500/80 text-white rounded-lg transition-colors disabled:opacity-40"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {analyzedPages.size === pages.length && pages.length > 0
                ? 'All Pages Analyzed'
                : analyzedPages.size > 0
                  ? `Analyze Remaining (${pages.length - analyzedPages.size})`
                  : 'Analyze All Pages'}
            </button>
          )}
          {analyzedPages.size > 0 && !bulkAnalyzeProgress && (
            <span className="text-[11px] text-emerald-400/80">{analyzedPages.size}/{pages.length} pages have analysis on file</span>
          )}
        </div>
      )}

      {/* CMS filter toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowCmsOnly(prev => !prev)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
            showCmsOnly
              ? 'bg-teal-600/20 border-teal-500/40 text-teal-300'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          CMS pages only
        </button>
        {showCmsOnly && (
          <span className="text-[11px] text-zinc-500">
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
        className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-600"
      />

      {hasUnsaved && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/8 border border-amber-500/30 rounded-lg text-xs text-amber-400/80">
          <AlertCircle className="w-3.5 h-3.5" /> You have unsaved changes. Save individual pages then publish to go live.
        </div>
      )}

      {/* Persistent SEO Suggestions Panel */}
      {workspaceId && suggestionsData && suggestionsData.suggestions.length > 0 && (
        <SeoSuggestionsPanel
          workspaceId={workspaceId}
          suggestions={suggestionsData.suggestions}
          counts={suggestionsData.counts}
          onRefresh={() => refetchSuggestions()}
          onApplied={() => queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId) })}
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
              <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/8 border border-amber-500/20 rounded text-[11px] text-amber-400/80 mb-1">
                <AlertCircle className="w-3 h-3" />
                Manual apply required — CMS pages must be updated directly in Webflow
              </div>
            )}
            <PageEditRow
              page={page} edit={edits[page.id]}
              expanded={expanded.has(page.id)} isSaving={saving.has(page.id)}
              isSaved={saved.has(page.id)} isAiLoading={aiLoading[page.id]}
              isDraftSaving={draftSaving.has(page.id)} isDraftSaved={draftSaved.has(page.id)}
              isSelected={approvalSelected.has(page.id)}
              pageRecs={recsLoaded ? recsForPage(page.slug) : []}
              pageState={getState(page.id)} variations={variations[page.id]}
              showApprovalCheckbox={!!workspaceId} isSendingToClient={sendingPage.has(page.id)}
              isSentToClient={sentPage.has(page.id)} hasChanges={!!(edits[page.id] && (edits[page.id].seoTitle !== (page.seo?.title || '') || edits[page.id].seoDescription !== (page.seo?.description || '')))}
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
            />
          </div>
        ))}
      </div>
    </div>
  );
}
