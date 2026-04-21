/**
 * usePageJoin — Unified hook that joins Webflow pages with keyword strategy data.
 *
 * Merges the page list from Webflow (all-pages or pages endpoint) with
 * keyword strategy entries, producing a single UnifiedPage[] that is the
 * authoritative list for SEO editor and page intelligence views.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { get } from '../../api/client';
import { useKeywordStrategy } from './useKeywordStrategy';
import {
  findPageMapEntryForPage,
  normalizePath,
  resolvePagePath,
} from '../../lib/pathUtils';
import { queryKeys } from '../../lib/queryKeys';
import type { UnifiedPage } from '../../../shared/types/page-join';

/** Minimal page shape returned by the Webflow pages endpoints. */
interface PageMeta {
  id: string;
  title: string;
  slug: string;
  publishedPath?: string | null;
  seo?: { title?: string | null; description?: string | null };
  source?: 'static' | 'cms';
}

export function usePageJoin(
  workspaceId: string,
  siteId: string,
): {
  pages: UnifiedPage[];
  strategyPages: UnifiedPage[];
  webflowPages: UnifiedPage[];
  isLoading: boolean;
  error: Error | null;
} {
  // ── Fetch Webflow pages (all-pages with CMS, falling back to static-only) ──
  const pagesQuery = useQuery({
    queryKey: queryKeys.admin.pageJoinPages(siteId),
    queryFn: async (): Promise<PageMeta[]> => {
      try {
        return await get<PageMeta[]>(`/api/webflow/all-pages/${siteId}`);
      } catch {
        return get<PageMeta[]>(`/api/webflow/pages/${siteId}`);
      }
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!siteId,
    retry: 2,
  });

  // ── Fetch keyword strategy ──
  const strategyQuery = useKeywordStrategy(workspaceId);

  // ── Build unified list ──
  const pages = useMemo<UnifiedPage[]>(() => {
    const webflowPages: PageMeta[] = pagesQuery.data ?? [];
    const pageMap = strategyQuery.data?.strategy?.pageMap ?? [];

    const results: UnifiedPage[] = [];
    const matchedStrategyPaths = new Set<string>();

    // Pass 1: emit one UnifiedPage per Webflow page
    for (const page of webflowPages) {
      const strategyEntry = findPageMapEntryForPage(pageMap, page);
      if (strategyEntry) {
        matchedStrategyPaths.add(normalizePath(strategyEntry.pagePath).toLowerCase());
      }

      const path = resolvePagePath(page);

      results.push({
        id: page.id,
        title: strategyEntry?.pageTitle || page.title,
        path,
        slug: page.slug,
        source: page.source ?? 'static',
        publishedPath: page.publishedPath,
        seo: page.seo,
        strategy: strategyEntry,
        analyzed: !!strategyEntry?.analysisGeneratedAt,
      });
    }

    // Pass 2: emit strategy-only entries (pageMap entries not matched to a Webflow page)
    const resultPaths = new Set(
      results.map(r => normalizePath(r.path).toLowerCase()),
    );

    for (const sp of pageMap) {
      const norm = normalizePath(sp.pagePath).toLowerCase();
      if (matchedStrategyPaths.has(norm) || resultPaths.has(norm)) {
        // Already matched to a Webflow page — skip
        continue;
      }
      // Dedup by normalized path
      if (resultPaths.has(norm)) continue;
      resultPaths.add(norm);

      results.push({
        id: `strategy-${sp.pagePath}`,
        title: sp.pageTitle,
        path: sp.pagePath,
        source: 'strategy-only',
        strategy: sp,
        analyzed: !!sp.analysisGeneratedAt,
      });
    }

    return results;
  }, [pagesQuery.data, strategyQuery.data]);

  // ── Derived views ──
  const strategyPages = useMemo(
    () => pages.filter(p => p.strategy !== undefined),
    [pages],
  );

  const webflowPages = useMemo(
    () => pages.filter(p => p.source !== 'strategy-only'),
    [pages],
  );

  // ── Loading / error ──
  const isLoading =
    (pagesQuery.isLoading && pagesQuery.data === undefined) ||
    (strategyQuery.isLoading && strategyQuery.data === undefined);

  const error: Error | null =
    (pagesQuery.error as Error | null) ?? (strategyQuery.error as Error | null) ?? null;

  return { pages, strategyPages, webflowPages, isLoading, error };
}
