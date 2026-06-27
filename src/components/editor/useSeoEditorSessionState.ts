import { useEffect, useMemo, useRef, useState } from 'react';
import type { FixContext } from '../../types/fix-context';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import type { SeoEditState, SeoVariationSet, SeoEditorPage } from './seoEditorTypes';
import { matchPageIdentity } from '../../lib/pathUtils';
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
  // The last fixContext target we auto-expanded. Keyed (not a once-per-mount boolean) so a NEW
  // fixContext target re-fires the prefill — the editor is mounted with a workspace-stable key and
  // does not remount, so a triage queue's successive "Fix in editor" jumps (page A, then page B)
  // must each expand their target. location.state is cleared after consumption (App.tsx), so the
  // prop only changes on a fresh navigation — no back/forward re-trigger.
  const lastFixKey = useRef<string | null>(null);

  const [edits, setEdits] = useState<Record<string, SeoEditState>>(() => {
    const cached = readCachedSeoEdits(siteId);
    restoredFromCache.current = cached.restoredFromCache;
    return cached.edits;
  });
  const [expanded, toggleExpand, setExpanded] = useToggleSet<string>(() => {
    return readCachedExpandedPages(siteId);
  }, UNBOUNDED_TOGGLE_SET_OPTIONS);
  const [variations, setVariations] = useState<Record<string, SeoVariationSet>>(() => {
    return readCachedSeoVariations(siteId);
  });
  const [previewExpanded, togglePreview] = useToggleSet<string>([], UNBOUNDED_TOGGLE_SET_OPTIONS);

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
    const fixKey = fixContext?.pageId || fixContext?.pageSlug;
    if (fixKey && fixContext?.targetRoute === 'seo-editor' && pages.length > 0 && lastFixKey.current !== fixKey) {
      const match = pages.find(p =>
        p.id === fixContext.pageId ||
        p.slug === fixContext.pageSlug ||
        (fixContext.pageSlug ? matchPageIdentity(p.publishedPath || p.slug || '', fixContext.pageSlug) : false)
      );
      if (match) {
        lastFixKey.current = fixKey;
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
