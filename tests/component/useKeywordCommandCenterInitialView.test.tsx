import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KeywordCommandCenterInitialViewResponse } from '../../shared/types/keyword-command-center';
import { queryKeys } from '../../src/lib/queryKeys';
import { useKeywordCommandCenterInitialView } from '../../src/hooks/admin/useKeywordCommandCenter';

const { initialMock } = vi.hoisted(() => ({ initialMock: vi.fn() }));

vi.mock('../../src/api/keywordCommandCenter', () => ({
  keywordCommandCenter: {
    initial: initialMock,
  },
}));

describe('useKeywordCommandCenterInitialView', () => {
  it('seeds independently cacheable summary and first-row query data', async () => {
    const query = { filter: 'all' as const, sort: 'rank' as const, page: 1, pageSize: 50 };
    const payload = {
      summary: {
        counts: { total: 1, inStrategy: 1, tracked: 1, needsReview: 0, evidence: 0, local: 0, localCandidates: 0, retired: 0, declined: 0 },
        filters: [],
        rawEvidenceTotal: 0,
        rawEvidenceReturned: 0,
        summarizedAt: '2026-07-13T00:00:00.000Z',
        rankFreshness: { snapshotDate: null, ageDays: null, status: 'missing' as const },
      },
      rows: {
        rows: [],
        pageInfo: { page: 1, pageSize: 50, totalRows: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
        rankFreshness: { snapshotDate: null, ageDays: null, status: 'missing' as const },
      },
    } satisfies KeywordCommandCenterInitialViewResponse;
    initialMock.mockResolvedValue(payload);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () => useKeywordCommandCenterInitialView('ws-1', query),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(initialMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(queryKeys.admin.keywordCommandCenterSummary('ws-1'))).toEqual(payload.summary);
    expect(queryClient.getQueryData(queryKeys.admin.keywordCommandCenterRows('ws-1', query))).toEqual(payload.rows);
  });
});
