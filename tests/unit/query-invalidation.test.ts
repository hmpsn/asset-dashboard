import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';
import { invalidateMany, keywordMutationInvalidationKeys } from '../../src/lib/queryInvalidation';

const WS = 'ws-query-invalidation';

describe('queryInvalidation', () => {
  it('keywordMutationInvalidationKeys preserves the KCC/rank-tracking mutation bundle', () => {
    expect(keywordMutationInvalidationKeys(WS)).toEqual([
      queryKeys.admin.keywordCommandCenter(WS),
      queryKeys.admin.keywordStrategy(WS),
      queryKeys.admin.rankTrackingKeywords(WS),
      queryKeys.admin.rankTrackingLatest(WS),
      queryKeys.admin.rankTrackingHistory(WS),
      queryKeys.admin.keywordFeedback(WS),
      queryKeys.admin.intelligenceAll(WS),
    ]);
  });

  it('invalidateMany invalidates each key with React Query object syntax', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
    };
    const keys = [
      queryKeys.admin.keywordCommandCenter(WS),
      queryKeys.admin.keywordStrategy(WS),
      queryKeys.admin.intelligenceAll(WS),
    ] as const;

    invalidateMany(queryClient, keys);

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(keys.length);
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: keys[0] });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: keys[1] });
    expect(queryClient.invalidateQueries).toHaveBeenNthCalledWith(3, { queryKey: keys[2] });
  });
});
