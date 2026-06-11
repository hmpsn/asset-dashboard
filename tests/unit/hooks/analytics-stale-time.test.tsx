import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STALE_TIMES } from '../../../src/lib/queryClient';

interface MockQueryOptions {
  enabled?: boolean;
  staleTime?: number;
  queryFn?: () => unknown;
}

const { queryCalls, useQueryMock, ga4Api, gscApi } = vi.hoisted(() => {
  const queryCalls: MockQueryOptions[] = [];
  const useQueryMock = vi.fn((options: MockQueryOptions) => {
    queryCalls.push(options);

    if (options.enabled !== false && options.queryFn) {
      const result = options.queryFn();
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).catch(() => undefined);
      }
    }

    return {
      data: undefined,
      error: null,
      isLoading: false,
      isSuccess: true,
    };
  });
  const ga4Api = {
    overview: vi.fn(),
    trend: vi.fn(),
    topPages: vi.fn(),
    sources: vi.fn(),
    devices: vi.fn(),
    countries: vi.fn(),
    comparison: vi.fn(),
    newVsReturning: vi.fn(),
    organic: vi.fn(),
    landingPages: vi.fn(),
    conversions: vi.fn(),
    events: vi.fn(),
  };
  const gscApi = {
    overview: vi.fn(),
    trend: vi.fn(),
    comparison: vi.fn(),
    devices: vi.fn(),
    countries: vi.fn(),
    searchTypes: vi.fn(),
  };
  return { queryCalls, useQueryMock, ga4Api, gscApi };
});

vi.mock('@tanstack/react-query', async importOriginal => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: useQueryMock,
  };
});

vi.mock('../../../src/api/analytics', () => ({
  ga4: ga4Api,
  ga4Admin: ga4Api,
  gsc: gscApi,
  gscAdmin: gscApi,
}));

import { ga4, gsc } from '../../../src/api/analytics';
import { useAdminGA4 } from '../../../src/hooks/admin/useAdminGA4';
import { useAdminSearch } from '../../../src/hooks/admin/useAdminSearch';
import { useClientGA4 } from '../../../src/hooks/client/useClientGA4';
import { useClientSearch } from '../../../src/hooks/client/useClientSearch';

function resetHarness() {
  queryCalls.length = 0;
  useQueryMock.mockClear();
  vi.clearAllMocks();
}

describe('analytics stale time wiring', () => {
  beforeEach(() => {
    resetHarness();
  });

  it('applies the analytics stale time to client GA4 queries', () => {
    renderHook(() => useClientGA4('ws-1', 28, undefined, true));

    expect(queryCalls.length).toBeGreaterThanOrEqual(11);
    expect(queryCalls.every(call => call.staleTime === STALE_TIMES.ANALYTICS)).toBe(true);
  });

  it('applies the analytics stale time to client search queries', () => {
    renderHook(() => useClientSearch('ws-1', 28, undefined, true));

    expect(queryCalls.length).toBeGreaterThanOrEqual(4);
    expect(queryCalls.every(call => call.staleTime === STALE_TIMES.ANALYTICS)).toBe(true);
  });

  it('keeps disabled client analytics hooks from fetching', () => {
    renderHook(() => useClientGA4('ws-1', 28, undefined, false));
    renderHook(() => useClientSearch('ws-1', 28, undefined, false));

    expect(ga4.overview).not.toHaveBeenCalled();
    expect(ga4.trend).not.toHaveBeenCalled();
    expect(gsc.overview).not.toHaveBeenCalled();
    expect(gsc.trend).not.toHaveBeenCalled();
    expect(queryCalls.every(call => call.enabled === false)).toBe(true);
  });

  it('does not give admin wrappers the client analytics stale time by default', () => {
    renderHook(() => useAdminGA4('ws-1', 28, true));
    expect(queryCalls.length).toBeGreaterThanOrEqual(11);
    expect(queryCalls.every(call => call.staleTime === undefined)).toBe(true);

    resetHarness();

    renderHook(() => useAdminSearch('ws-1', 'site-1', 'https://example.com', 28));
    expect(queryCalls.length).toBeGreaterThanOrEqual(6);
    expect(queryCalls.every(call => call.staleTime === undefined)).toBe(true);
  });
});
