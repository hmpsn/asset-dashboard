/**
 * React Query hook for SEO editor pages data.
 * Uses the unified all-pages endpoint which includes both static Webflow
 * pages and CMS collection items discovered via sitemap.
 */

import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';

export interface PageMeta {
  id: string;
  title: string;
  slug: string;
  publishedPath?: string | null;
  seo?: { title?: string | null; description?: string | null };
  /** 'static' = Webflow static page. 'cms' = CMS collection item from sitemap discovery. */
  source?: 'static' | 'cms';
  /** For CMS items — the Webflow collection ID needed for SEO write-back via the approvals API. */
  collectionId?: string;
}

export function useSeoEditor(siteId: string, workspaceId?: string) {
  return useQuery({
    queryKey: queryKeys.admin.seoEditor(siteId),
    queryFn: async (): Promise<PageMeta[]> => {
      const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
      const response = await get<PageMeta[]>(`/api/webflow/all-pages/${siteId}${qs}`);
      return Array.isArray(response) ? response : [];
    },
    staleTime: STALE_TIMES.FAST,
    enabled: !!siteId,
    retry: 1,
  });
}
