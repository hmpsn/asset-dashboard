import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

export type QueryInvalidationKey = readonly unknown[];

export function invalidateMany(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  keys: readonly QueryInvalidationKey[],
): void {
  for (const queryKey of keys) {
    queryClient.invalidateQueries({ queryKey });
  }
}

export function keywordMutationInvalidationKeys(workspaceId: string): readonly QueryInvalidationKey[] {
  return [
    queryKeys.admin.keywordCommandCenter(workspaceId),
    queryKeys.admin.keywordStrategy(workspaceId),
    queryKeys.admin.rankTrackingKeywords(workspaceId),
    queryKeys.admin.rankTrackingLatest(workspaceId),
    queryKeys.admin.rankTrackingHistory(workspaceId),
    queryKeys.admin.intelligenceAll(workspaceId),
  ] as const;
}
