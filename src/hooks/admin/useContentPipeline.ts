/**
 * React Query hook for content pipeline summary data
 * Replaces manual useEffect fetch pattern in ContentPipeline.tsx
 */

import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';
import { STALE_TIMES } from '../../lib/queryClient';
import type { ContentBrief, ContentMatrix, GeneratedPost } from '../../../shared/types/content';

interface PipelineSummary {
  briefs: number;
  posts: number;
  matrices: number;
  cells: number;
  published: number;
}

interface DecaySummary {
  critical: number;
  warning: number;
  totalDecaying: number;
  avgDeclinePct: number;
}

interface ContentPipelineQueryOptions {
  /**
   * The legacy surface still needs this hook to assemble brief/post counts.
   * Rebuilt consumers already own authoritative list queries and can skip the
   * duplicate payloads, then derive those two counts locally.
   */
  includeContentLists?: boolean;
}

export function useContentPipeline(
  workspaceId: string,
  { includeContentLists = true }: ContentPipelineQueryOptions = {},
) {
  const baseKey = queryKeys.admin.contentPipeline(workspaceId);

  return useQuery({
    queryKey: includeContentLists ? baseKey : [...baseKey, 'aggregate-only'],
    queryFn: async ({ signal }): Promise<{ summary: PipelineSummary | null; decay: DecaySummary | null }> => {
      const [briefs, posts, matrices, decayData] = await Promise.all([
        includeContentLists
          ? get<ContentBrief[]>(`/api/content-briefs/${workspaceId}`, signal).catch(() => [])
          : Promise.resolve([]),
        includeContentLists
          ? get<GeneratedPost[]>(`/api/content-posts/${workspaceId}`, signal).catch(() => [])
          : Promise.resolve([]),
        get<ContentMatrix[]>(`/api/content-matrices/${workspaceId}`, signal).catch(() => []),
        get<{ summary?: DecaySummary }>(`/api/content-decay/${workspaceId}`, signal).catch(() => null),
      ]);

      const briefArr = Array.isArray(briefs) ? briefs : [];
      const postArr = Array.isArray(posts) ? posts : [];
      const matrixArr = Array.isArray(matrices) ? matrices : [];
      const allCells = matrixArr.flatMap(m => m.cells || []);

      const summary: PipelineSummary = {
        briefs: briefArr.length,
        posts: postArr.length,
        matrices: matrixArr.length,
        cells: allCells.length,
        published: allCells.filter(c => c.status === 'published').length,
      };

      // Decay analysis
      const decay = decayData?.summary && decayData.summary.totalDecaying > 0
        ? decayData.summary
        : null;

      return { summary, decay };
    },
    staleTime: STALE_TIMES.NORMAL,
    enabled: !!workspaceId,
    retry: 2,
  });
}
