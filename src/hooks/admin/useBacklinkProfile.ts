import { useQuery } from '@tanstack/react-query';
import { backlinks } from '../../api';
import type { BacklinkData } from '../../api/seo';
import { queryKeys } from '../../lib/queryKeys';

/**
 * Reads the backlink profile for a workspace (GET /api/backlinks/:wsId via DataForSEO).
 *
 * React Query (not a raw useEffect) so the profile refetches when a strategy regen broadcasts
 * `strategy:updated` — `strategyMutationKeys` invalidates this key. The DataForSEO backlink
 * file-cache TTL is 7d (CACHE_TTL_BACKLINKS=168), so a matching 168h staleTime avoids refetching
 * data the provider would just serve from its own cache.
 *
 * Returns `BacklinkData | null` (null when the workspace has no provider/domain or no data);
 * throws via `getOptional` on a 503 no-provider response, surfaced as the query `error` so callers
 * can keep the "requires DataForSEO" messaging.
 */
export function useBacklinkProfile(workspaceId: string) {
  return useQuery<BacklinkData | null>({
    queryKey: queryKeys.admin.backlinkProfile(workspaceId),
    queryFn: () => backlinks.get(workspaceId),
    enabled: !!workspaceId,
    staleTime: 168 * 60 * 60 * 1000,
  });
}
