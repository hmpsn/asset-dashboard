// src/hooks/admin/useInsightFeed.ts
// Stub — full implementation in Task 6
import { useQuery } from '@tanstack/react-query';
import type { FeedInsight, SummaryCount } from '../../../shared/types/insights.js';

interface InsightFeedResult {
  feed: FeedInsight[];
  summary: SummaryCount[];
  isLoading: boolean;
}

export function useInsightFeed(workspaceId: string): InsightFeedResult {
  const { data, isLoading } = useQuery<{ feed: FeedInsight[]; summary: SummaryCount[] }>({
    queryKey: ['admin-insight-feed', workspaceId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/insights/feed`);
      if (!res.ok) throw new Error('Failed to fetch insight feed');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(workspaceId),
  });

  return {
    feed: data?.feed ?? [],
    summary: data?.summary ?? [],
    isLoading,
  };
}
