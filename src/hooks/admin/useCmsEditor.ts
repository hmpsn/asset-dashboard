/**
 * React Query hook for CMS editor data
 * Replaces manual useEffect fetch pattern in CmsEditor.tsx
 */

import { useQuery } from '@tanstack/react-query';
import { get, getSafe } from '../../api/client.js';

interface SeoField {
  id: string;
  slug: string;
  displayName: string;
  type: string;
}

interface CmsItem {
  id: string;
  fieldData: Record<string, unknown>;
}

interface CmsCollection {
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
  seoFields: SeoField[];
  items: CmsItem[];
  total: number;
}

interface ApprovalItem {
  id: string;
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  field: string;
  collectionId?: string;
  currentValue: string;
  proposedValue: string;
  clientValue?: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

interface ApprovalBatch {
  id: string;
  workspaceId: string;
  siteId: string;
  name: string;
  items: ApprovalItem[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface CmsEditorData {
  collections: CmsCollection[];
  approvalBatches: ApprovalBatch[];
}

export function useCmsEditor(siteId: string, workspaceId?: string) {
  return useQuery({
    queryKey: ['cms-editor', siteId, workspaceId],
    queryFn: async (): Promise<CmsEditorData> => {
      const [collectionsData, approvalBatchesData] = await Promise.all([
        get<CmsCollection[]>(`/api/webflow/cms-seo/${siteId}`).catch(() => []),
        workspaceId ? getSafe<ApprovalBatch[]>(`/api/approvals/${workspaceId}`, []).catch(() => []) : []
      ]);
      
      return {
        collections: collectionsData || [],
        approvalBatches: Array.isArray(approvalBatchesData) ? approvalBatchesData : []
      };
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !!siteId,
    retry: 2,
  });
}

export function useCmsCollections(siteId: string) {
  return useQuery({
    queryKey: ['cms-collections', siteId],
    queryFn: async (): Promise<CmsCollection[]> => {
      const data = await get<CmsCollection[]>(`/api/webflow/cms-seo/${siteId}`);
      return data;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !!siteId,
    retry: 2,
  });
}
