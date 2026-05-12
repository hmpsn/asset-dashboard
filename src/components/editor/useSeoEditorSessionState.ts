import { useEffect, useMemo, useRef, useState } from 'react';
import type { FixContext } from '../../App';
import type { SeoEditState, SeoVariationSet, SeoEditorPage } from './seoEditorTypes';
import {
  buildSeoEditsFromPages,
  persistCachedExpandedPages,
  persistCachedSeoEdits,
  persistCachedSeoVariations,
  readCachedExpandedPages,
  readCachedSeoEdits,
  readCachedSeoVariations,
} from './seoEditorPersistence';

interface UseSeoEditorSessionStateParams {
  siteId: string;
  workspaceId?: string;
  pages: SeoEditorPage[];
  fixContext?: FixContext | null;
}

export function useSeoEditorSessionState({
  siteId,
  workspaceId,
  pages,
  fixContext,
}: UseSeoEditorSessionStateParams) {
  const restoredFromCache = useRef(false);
  const fixConsumed = useRef(false);

  const [edits, setEdits] = useState<Record<string, SeoEditState>>(() => {
    const cached = readCachedSeoEdits(siteId);
    restoredFromCache.current = cached.restoredFromCache;
    return cached.edits;
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    return readCachedExpandedPages(siteId);
  });
  const [variations, setVariations] = useState<Record<string, SeoVariationSet>>(() => {
    return readCachedSeoVariations(siteId);
  });
  const [previewExpanded, setPreviewExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    persistCachedSeoEdits(siteId, edits);
  }, [edits, siteId]);
  useEffect(() => {
    persistCachedExpandedPages(siteId, expanded);
  }, [expanded, siteId]);
  useEffect(() => {
    persistCachedSeoVariations(siteId, variations);
  }, [variations, siteId]);

  useEffect(() => {
    if (restoredFromCache.current) {
      restoredFromCache.current = false;
      return;
    }
    setEdits(buildSeoEditsFromPages(pages, workspaceId));
  }, [pages, workspaceId]);

  // effect-layout-ok -- this sync is intentionally post-paint because it scrolls the target element.
  useEffect(() => {
    if (fixContext?.pageId && fixContext.targetRoute === 'seo-editor' && pages.length > 0 && !fixConsumed.current) {
      const match = pages.find(p => p.id === fixContext.pageId || p.slug === fixContext.pageSlug);
      if (match) {
        fixConsumed.current = true;
        setExpanded(new Set([match.id]));
        setTimeout(() => {
          const el = document.getElementById(`seo-editor-page-${match.id}`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    }
  }, [fixContext, pages]);

  const hasUnsaved = useMemo(() => {
    return Object.values(edits).some(entry => entry.dirty);
  }, [edits]);

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

  return {
    edits,
    setEdits,
    expanded,
    variations,
    setVariations,
    previewExpanded,
    hasUnsaved,
    toggleExpand,
    togglePreview,
  };
}
