import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeywordCommandCenterInitialViewResponse } from '../../shared/types/keyword-command-center';
import { queryKeys } from '../../src/lib/queryKeys';
import {
  useKeywordCommandCenterInitialView,
  useKeywordCommandCenterRows,
  useKeywordCommandCenterSummary,
} from '../../src/hooks/admin/useKeywordCommandCenter';

const { initialMock, rowsMock, summaryMock } = vi.hoisted(() => ({
  initialMock: vi.fn(),
  rowsMock: vi.fn(),
  summaryMock: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}

vi.mock('../../src/api/keywordCommandCenter', () => ({
  keywordCommandCenter: {
    initial: initialMock,
    rows: rowsMock,
    summary: summaryMock,
  },
}));

describe('useKeywordCommandCenterInitialView', () => {
  beforeEach(() => {
    initialMock.mockReset();
    rowsMock.mockReset();
    summaryMock.mockReset();
  });

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

  it('uses initial exactly once, then prefix invalidation refreshes canonical summary and rows only', async () => {
    const query = { filter: 'all' as const, sort: 'rank' as const, page: 1, pageSize: 50 };
    const initialPayload = {
      summary: {
        counts: { total: 1, inStrategy: 1, tracked: 1, needsReview: 0, evidence: 0, local: 0, localCandidates: 0, retired: 0, declined: 0 },
        filters: [],
        rawEvidenceTotal: 1,
        rawEvidenceReturned: 1,
        summarizedAt: '2026-07-13T00:00:00.000Z',
        rankFreshness: { snapshotDate: null, ageDays: null, status: 'missing' as const },
      },
      rows: {
        rows: [],
        pageInfo: { page: 1, pageSize: 50, totalRows: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
        rankFreshness: { snapshotDate: null, ageDays: null, status: 'missing' as const },
      },
    } satisfies KeywordCommandCenterInitialViewResponse;
    const refreshedSummary = {
      ...initialPayload.summary,
      counts: { ...initialPayload.summary.counts, total: 2 },
      summarizedAt: '2026-07-13T00:05:00.000Z',
    };
    const refreshedRows = {
      ...initialPayload.rows,
      pageInfo: { ...initialPayload.rows.pageInfo, totalRows: 2 },
    };
    initialMock.mockResolvedValue(initialPayload);
    summaryMock.mockResolvedValue(refreshedSummary);
    rowsMock.mockResolvedValue(refreshedRows);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => {
      const initial = useKeywordCommandCenterInitialView('ws-1', query);
      const transportSettled = initial.data != null || initial.isError;
      const summary = useKeywordCommandCenterSummary('ws-1', { enabled: transportSettled });
      const rows = useKeywordCommandCenterRows('ws-1', query, { enabled: transportSettled });
      return { initial, summary, rows };
    }, { wrapper });

    await waitFor(() => expect(result.current.initial.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.summary.data).toEqual(initialPayload.summary));
    expect(result.current.rows.data).toEqual(initialPayload.rows);
    expect(initialMock).toHaveBeenCalledTimes(1);
    expect(summaryMock).not.toHaveBeenCalled();
    expect(rowsMock).not.toHaveBeenCalled();

    await queryClient.invalidateQueries({
      queryKey: queryKeys.admin.keywordCommandCenter('ws-1'),
    });

    await waitFor(() => expect(result.current.summary.data).toEqual(refreshedSummary));
    await waitFor(() => expect(result.current.rows.data).toEqual(refreshedRows));
    expect(initialMock).toHaveBeenCalledTimes(1);
    expect(summaryMock).toHaveBeenCalledTimes(1);
    expect(rowsMock).toHaveBeenCalledTimes(1);
  });

  it('does not seed canonical caches after an in-flight prefix invalidation', async () => {
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
    const pending = deferred<KeywordCommandCenterInitialViewResponse>();
    initialMock.mockReturnValue(pending.promise);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () => useKeywordCommandCenterInitialView('ws-race', query),
      { wrapper },
    );
    await waitFor(() => expect(initialMock).toHaveBeenCalledTimes(1));

    await queryClient.invalidateQueries({
      queryKey: queryKeys.admin.keywordCommandCenter('ws-race'),
    });
    pending.resolve(payload);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(queryKeys.admin.keywordCommandCenterSummary('ws-race'))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.admin.keywordCommandCenterRows('ws-race', query))).toBeUndefined();
  });

  it('does not overwrite newer canonical cache data while initial is in flight', async () => {
    const query = { filter: 'all' as const, sort: 'rank' as const, page: 1, pageSize: 50 };
    const stalePayload = {
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
        pageInfo: { page: 1, pageSize: 50, totalRows: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
        rankFreshness: { snapshotDate: null, ageDays: null, status: 'missing' as const },
      },
    } satisfies KeywordCommandCenterInitialViewResponse;
    const newerSummary = {
      ...stalePayload.summary,
      counts: { ...stalePayload.summary.counts, total: 7 },
      summarizedAt: '2026-07-13T00:10:00.000Z',
    };
    const newerRows = {
      ...stalePayload.rows,
      pageInfo: { ...stalePayload.rows.pageInfo, totalRows: 7 },
    };
    const pending = deferred<KeywordCommandCenterInitialViewResponse>();
    initialMock.mockReturnValue(pending.promise);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () => useKeywordCommandCenterInitialView('ws-newer', query),
      { wrapper },
    );
    await waitFor(() => expect(initialMock).toHaveBeenCalledTimes(1));

    queryClient.setQueryData(queryKeys.admin.keywordCommandCenterSummary('ws-newer'), newerSummary);
    queryClient.setQueryData(queryKeys.admin.keywordCommandCenterRows('ws-newer', query), newerRows);
    pending.resolve(stalePayload);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(queryKeys.admin.keywordCommandCenterSummary('ws-newer'))).toEqual(newerSummary);
    expect(queryClient.getQueryData(queryKeys.admin.keywordCommandCenterRows('ws-newer', query))).toEqual(newerRows);
  });
});
