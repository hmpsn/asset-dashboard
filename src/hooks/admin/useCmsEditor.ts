/**
 * React Query hook for CMS editor data
 * Replaces manual useEffect fetch pattern in CmsEditor.tsx
 */

import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client.js';

interface CmsPage {
  id: string;
  name: string;
  slug: string;
  collectionId?: string;
  lastPublished?: string;
  isArchived: boolean;
  isDraft: boolean;
}

interface ApprovalBatch {
  id: string;
  name: string;
  itemCount: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export function useCmsEditor(siteId: string) {
  return useQuery({
    queryKey: ['cms-editor', siteId],
    queryFn: async () => {
      const [pages, batches] = await Promise.all([
        get<{ data?: CmsPage[] }>(`/api/webflow/cms/${siteId}/pages`),
        get<{ data?: ApprovalBatch[] }>(`/api/approvals/${siteId}/batches`)
      ]);
      
      return {
        pages: pages.data || [],
        batches: batches.data || []
      };
    },
    staleTime: 30 * 1000, // 30 seconds
    enabled: !!siteId,
    retry: 1,
  });
}
