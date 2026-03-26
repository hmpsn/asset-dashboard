/**
 * React Query hook for content pipeline summary data
 * Replaces manual useEffect fetch pattern in ContentPipeline.tsx
 */

import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';

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

export function useContentPipeline(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.contentPipeline(workspaceId),
    queryFn: async (): Promise<{ summary: PipelineSummary | null; decay: DecaySummary | null }> => {
      const [briefs, posts, matrices, decayData] = await Promise.all([
        get(`/api/content-briefs/${workspaceId}`).catch(() => []),
        get(`/api/content-posts/${workspaceId}`).catch(() => []),
        get(`/api/content-matrices/${workspaceId}`).catch(() => []),
        get(`/api/content-decay/${workspaceId}`).catch(() => null),
      ]);
      
      const briefArr = Array.isArray(briefs) ? briefs : [];
      const postArr = Array.isArray(posts) ? posts : [];
      const matrixArr = Array.isArray(matrices) ? matrices as { cells?: { status?: string }[] }[] : [];
      const allCells = matrixArr.flatMap(m => m.cells || []);
      
      const summary: PipelineSummary = {
        briefs: briefArr.length,
        posts: postArr.length,
        matrices: matrixArr.length,
        cells: allCells.length,
        published: allCells.filter(c => c.status === 'published').length,
      };
      
      // Decay analysis
      const d = decayData as { summary?: DecaySummary } | null;
      const decay = d?.summary && d.summary.totalDecaying > 0 ? d.summary : null;
      
      return { summary, decay };
    },
    staleTime: 60 * 1000, // 1 minute
    enabled: !!workspaceId,
    retry: 2,
  });
}
