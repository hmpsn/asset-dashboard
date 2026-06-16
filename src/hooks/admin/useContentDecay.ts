import { useQuery } from '@tanstack/react-query';
import { contentDecay } from '../../api';
import { queryKeys } from '../../lib/queryKeys';
import type { DecayAnalysis } from '../../../shared/types/content-decay';

/**
 * Reads the cached content-decay analysis for a workspace. GET /api/content-decay/:wsId is
 * cache-read-only and returns null until an analyze job has run, so callers MUST handle a null
 * result (the endpoint never triggers analysis itself).
 */
export function useContentDecay(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.admin.contentDecay(workspaceId!),
    queryFn: async () => ((await contentDecay.get(workspaceId!)) as DecayAnalysis | null) ?? null,
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}
