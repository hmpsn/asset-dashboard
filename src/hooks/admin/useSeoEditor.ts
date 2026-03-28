/**
 * React Query hook for SEO editor pages data
 * Replaces manual useEffect fetch pattern in SeoEditor.tsx
 */

import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';

interface PageMeta {
  id: string;
  title: string;
  slug: string;
  seo?: { title?: string; description?: string };
  openGraph?: { title?: string; description?: string; titleCopied?: boolean; descriptionCopied?: boolean };
}

export function useSeoEditor(siteId: string) {
  return useQuery({
    queryKey: queryKeys.admin.seoEditor(siteId),
    queryFn: async (): Promise<PageMeta[]> => {
      const response = await get<PageMeta[]>(`/api/webflow/pages/${siteId}`);
      return Array.isArray(response) ? response : [];
    },
    staleTime: STALE_TIMES.FAST,
    enabled: !!siteId,
    retry: 1,
  });
}
