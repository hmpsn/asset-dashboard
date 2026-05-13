import { useCallback, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { put, post } from '../../api/client';
import { keywords } from '../../api/seo';
import { queryKeys } from '../../lib/queryKeys';
import { resolvePagePath } from '../../lib/pathUtils';
import type { SeoEditState, SeoEditorPage, SeoVariationSet } from './seoEditorTypes';

interface UseSeoEditorPageWorkflowArgs {
  siteId: string;
  workspaceId?: string;
  pages: SeoEditorPage[];
  edits: Record<string, SeoEditState>;
  setEdits: React.Dispatch<React.SetStateAction<Record<string, SeoEditState>>>;
  setVariations: React.Dispatch<React.SetStateAction<Record<string, SeoVariationSet>>>;
  queryClient: QueryClient;
  refreshStates: () => void;
  setLocalAnalyzedPages: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useSeoEditorPageWorkflow({
  siteId,
  workspaceId,
  pages,
  edits,
  setEdits,
  setVariations,
  queryClient,
  refreshStates,
  setLocalAnalyzedPages,
}: UseSeoEditorPageWorkflowArgs) {
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [draftSaving, setDraftSaving] = useState<Set<string>>(new Set());
  const [draftSaved, setDraftSaved] = useState<Set<string>>(new Set());
  const [aiLoading, setAiLoading] = useState<Record<string, string>>({});
  const [errorStates, setErrorStates] = useState<Record<string, { type: string; message: string }>>({});
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());

  const updateField = useCallback((pageId: string, field: keyof SeoEditState, value: string) => {
    setEdits(prev => ({
      ...prev,
      [pageId]: { ...prev[pageId], [field]: value, dirty: true },
    }));
  }, [setEdits]);

  const saveDraft = useCallback(async (pageId: string) => {
    const edit = edits[pageId];
    if (!edit) return;
    setDraftSaving(prev => new Set(prev).add(pageId));

    try {
      const draftKey = `seo_draft_${workspaceId || 'global'}_${pageId}`;
      const draftData = {
        seoTitle: edit.seoTitle,
        seoDescription: edit.seoDescription,
        savedAt: new Date().toISOString(),
        pageId,
        pageSlug: pages.find(page => page.id === pageId)?.slug || '',
      };
      localStorage.setItem(draftKey, JSON.stringify(draftData));
      setDraftSaved(prev => new Set(prev).add(pageId));
      setTimeout(() => {
        setDraftSaved(prev => {
          const next = new Set(prev);
          next.delete(pageId);
          return next;
        });
      }, 2000);
    } catch (err) {
      console.error('Draft save failed:', err);
      setErrorStates(prev => ({
        ...prev,
        [pageId]: {
          type: 'validation',
          message: 'Failed to save draft locally',
        },
      }));
      setTimeout(() => {
        setErrorStates(prev => {
          const next = { ...prev };
          delete next[pageId];
          return next;
        });
      }, 5000);
    } finally {
      setDraftSaving(prev => {
        const next = new Set(prev);
        next.delete(pageId);
        return next;
      });
    }
  }, [edits, pages, workspaceId]);

  const savePage = useCallback(async (pageId: string) => {
    const edit = edits[pageId];
    if (!edit) return;
    const page = pages.find(entry => entry.id === pageId);
    setSaving(prev => new Set(prev).add(pageId));
    try {
      const data = await put<{ success?: boolean; error?: string }>(`/api/webflow/pages/${pageId}/seo`, {
        siteId,
        workspaceId,
        slug: page ? resolvePagePath(page) : '',
        pageTitle: page?.title || '',
        seo: { title: edit.seoTitle, description: edit.seoDescription },
        openGraph: { title: edit.seoTitle, description: edit.seoDescription },
      });
      if (data.success === false) {
        console.error('Save failed:', data.error);
        setErrorStates(prev => ({
          ...prev,
          [pageId]: {
            type: 'validation',
            message: `Failed to save SEO: ${data.error || 'Unknown error'}`,
          },
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
      refreshStates();
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.seoEditor(siteId, workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.auditAll() });
      setTimeout(() => {
        setSaved(prev => {
          const next = new Set(prev);
          next.delete(pageId);
          return next;
        });
      }, 2000);
    } catch (err) {
      console.error('Save failed:', err);
      setErrorStates(prev => ({
        ...prev,
        [pageId]: {
          type: 'network',
          message: 'Network error saving SEO fields. Please check your connection and try again.',
        },
      }));
      setTimeout(() => {
        setErrorStates(prev => {
          const next = { ...prev };
          delete next[pageId];
          return next;
        });
      }, 5000);
    } finally {
      setSaving(prev => {
        const next = new Set(prev);
        next.delete(pageId);
        return next;
      });
    }
  }, [edits, pages, queryClient, refreshStates, setEdits, siteId, workspaceId]);

  const aiRewrite = useCallback(async (pageId: string, field: 'title' | 'description' | 'both') => {
    const page = pages.find(entry => entry.id === pageId);
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
        setVariations(prev => ({
          ...prev,
          [pageId]: {
            field: 'both',
            options: data.pairs!.map(pair => pair.title),
            descOptions: data.pairs!.map(pair => pair.description),
          },
        }));
      } else if (data.variations && data.variations.length > 1) {
        setVariations(prev => ({ ...prev, [pageId]: { field, options: data.variations! } }));
      } else if (data.text) {
        const key = field === 'title' ? 'seoTitle' : 'seoDescription';
        updateField(pageId, key, data.text);
      }
    } catch (err) {
      console.error('AI rewrite failed:', err);
    } finally {
      setAiLoading(prev => {
        const next = { ...prev };
        delete next[pageId];
        return next;
      });
    }
  }, [edits, pages, setVariations, updateField, workspaceId]);

  const analyzePage = useCallback(async (pageId: string) => {
    const page = pages.find(entry => entry.id === pageId);
    if (!page || !workspaceId) return;
    const edit = edits[pageId];

    setAnalyzing(prev => new Set(prev).add(pageId));
    try {
      const analysis = await keywords.analyze({
        pageTitle: page.title,
        seoTitle: edit?.seoTitle || page.seo?.title || '',
        metaDescription: edit?.seoDescription || page.seo?.description || '',
        slug: resolvePagePath(page),
        workspaceId,
      }) as Record<string, unknown>;

      if (analysis && !analysis.error) {
        await keywords.persistAnalysis({
          workspaceId,
          pagePath: resolvePagePath(page),
          pageTitle: page.title,
          analysis,
        });

        setLocalAnalyzedPages(prev => new Set(prev).add(pageId));
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
      }
    } catch (err) {
      console.error('Page analysis failed:', err);
    } finally {
      setAnalyzing(prev => {
        const next = new Set(prev);
        next.delete(pageId);
        return next;
      });
    }
  }, [edits, pages, queryClient, setLocalAnalyzedPages, workspaceId]);

  return {
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
  };
}
