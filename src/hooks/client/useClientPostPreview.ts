import { useQuery } from '@tanstack/react-query';
import { publicPostReview } from '../../api/content';
import { queryKeys } from '../../lib/queryKeys';
import type { GeneratedPost } from '../../../shared/types/content';

/**
 * Fetches a GeneratedPost for client review.
 * Only fires when `enabled` is true (i.e., the card is expanded and status is post_review).
 */
export function useClientPostPreview(
  workspaceId: string,
  postId: string | undefined,
  enabled: boolean,
) {
  return useQuery<GeneratedPost>({
    queryKey: queryKeys.client.postPreview(workspaceId, postId),
    queryFn: () => publicPostReview.getPost(workspaceId, postId!),
    enabled: !!postId && enabled,
    staleTime: 1000 * 60 * 5, // 5 min — post content rarely changes mid-session
    retry: false,
  });
}
