import { useQuery } from '@tanstack/react-query';
import { get, getSafe } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';

interface Asset {
  id: string;
  displayName?: string;
  originalFileName?: string;
  size: number;
  contentType: string;
  url?: string;
  hostedUrl?: string;
  altText?: string;
  createdOn?: string;
}

/**
 * Fetch all Webflow assets for a site.
 * Replaces loadAssets callback + useEffect in AssetBrowser.tsx.
 */
export function useWebflowAssets(siteId: string) {
  return useQuery<Asset[]>({
    queryKey: queryKeys.admin.webflowAssets(siteId),
    queryFn: async () => {
      const data = await getSafe<Asset[]>(`/api/webflow/assets/${siteId}`, []);
      return Array.isArray(data) ? data : [];
    },
    enabled: !!siteId,
    staleTime: STALE_TIMES.NORMAL,
  });
}

/**
 * Fetch unused asset IDs from the asset audit.
 * Replaces the second useEffect in AssetBrowser.tsx that loads unused IDs.
 */
export function useAssetAudit(siteId: string, enabled: boolean) {
  return useQuery<Set<string>>({
    queryKey: queryKeys.admin.assetAudit(siteId),
    queryFn: async () => {
      const data = await get<{ issues?: Array<{ issues: string[]; assetId: string }> }>(`/api/webflow/audit/${siteId}`);
      return new Set<string>(
        (data.issues || []).filter((i) => i.issues.includes('unused')).map((i) => i.assetId)
      );
    },
    enabled: !!siteId && enabled,
    staleTime: STALE_TIMES.STABLE,
  });
}
