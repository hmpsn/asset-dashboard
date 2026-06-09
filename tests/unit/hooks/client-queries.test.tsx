/**
 * tests/unit/hooks/client-queries.test.tsx
 *
 * Smoke-level unit tests for client-facing React Query hooks.
 * Runs in the `component` vitest project (jsdom environment).
 *
 * Strategy:
 *  - Mock the relevant API modules so no real fetch calls fire.
 *  - Assert: disabled when args are empty, isLoading while pending, data returned on resolve.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

// ── Shared wrapper ────────────────────────────────────────────────────────────

function makeWrapper() {
  return makeWrapperWithClient().wrapper;
}

function makeWrapperWithClient(client?: QueryClient) {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client: qc,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  };
}

// ── Mock: src/api/client ──────────────────────────────────────────────────────

vi.mock('../../../src/api/client', () => ({
  get: vi.fn(),
  getSafe: vi.fn(),
  getOptional: vi.fn(),
  post: vi.fn(),
  ApiError: class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

import { get, getSafe, getOptional } from '../../../src/api/client';
const mockGet = vi.mocked(get);
const mockGetSafe = vi.mocked(getSafe);
const mockGetOptional = vi.mocked(getOptional);

// ── Mock: src/api/outcomes ────────────────────────────────────────────────────

vi.mock('../../../src/api/outcomes', () => ({
  clientOutcomesApi: {
    getSummary: vi.fn(),
    getWins: vi.fn(),
  },
  outcomesApi: {},
}));

import { clientOutcomesApi } from '../../../src/api/outcomes';
const mockGetSummary = vi.mocked(clientOutcomesApi.getSummary);
const mockGetWins = vi.mocked(clientOutcomesApi.getWins);

// ── Mock: src/api/content ─────────────────────────────────────────────────────

vi.mock('../../../src/api/content', () => ({
  publicPostReview: {
    getPost: vi.fn(),
  },
  contentBriefs: {},
  contentPosts: {},
}));

import { publicPostReview } from '../../../src/api/content';
const mockGetPost = vi.mocked(publicPostReview.getPost);

// ── Mock: src/api/analytics ───────────────────────────────────────────────────

vi.mock('../../../src/api/analytics', () => ({
  gsc: {
    overview: vi.fn(),
    trend: vi.fn(),
    comparison: vi.fn(),
    devices: vi.fn(),
  },
  ga4: {},
  fetchClientIntelligence: vi.fn(),
}));

import { gsc, fetchClientIntelligence } from '../../../src/api/analytics';
const mockGscOverview = vi.mocked(gsc.overview);
const mockGscTrend = vi.mocked(gsc.trend);
const mockGscComparison = vi.mocked(gsc.comparison);
const mockGscDevices = vi.mocked(gsc.devices);
const mockFetchClientIntelligence = vi.mocked(fetchClientIntelligence);

// ── Hook imports (after mocks) ────────────────────────────────────────────────

import {
  useClientActivity,
  useClientRankHistory,
  useClientApprovals,
  useClientAnomalies,
  useClientAnnotations,
  useClientActions,
  useClientAuditSummary,
  useClientRawInsights,
} from '../../../src/hooks/client/useClientQueries';
import { useClientInsights } from '../../../src/hooks/client/useClientInsights';
import { useClientOutcomeSummary, useClientOutcomeWins } from '../../../src/hooks/client/useClientOutcomes';
import { useClientPostPreview } from '../../../src/hooks/client/useClientPostPreview';
import { useClientSearch } from '../../../src/hooks/client/useClientSearch';
import { useMonthlyDigest } from '../../../src/hooks/client/useMonthlyDigest';
import { useClientIntelligence } from '../../../src/hooks/client/useClientIntelligence';
import { queryKeys } from '../../../src/lib/queryKeys';

// ─────────────────────────────────────────────────────────────────────────────
// useClientActivity
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientActivity', () => {
  beforeEach(() => mockGetSafe.mockReset());

  it('does not fetch when enabled is false', () => {
    renderHook(() => useClientActivity('ws-1', false), { wrapper: makeWrapper() });
    expect(mockGetSafe).not.toHaveBeenCalled();
  });

  it('returns data on success', async () => {
    const items = [{ id: 'a1', type: 'test', message: 'hello', createdAt: '2024-01-01' }];
    mockGetSafe.mockResolvedValue(items);
    const { result } = renderHook(() => useClientActivity('ws-1', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(items);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useClientRankHistory
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientRankHistory', () => {
  beforeEach(() => mockGetSafe.mockReset());

  it('does not fetch when enabled is false', () => {
    renderHook(() => useClientRankHistory('ws-1', false), { wrapper: makeWrapper() });
    expect(mockGetSafe).not.toHaveBeenCalled();
  });

  it('returns data array on success', async () => {
    const history = [{ keyword: 'seo tips', position: 4, date: '2024-01-01' }];
    mockGetSafe.mockResolvedValue(history);
    const { result } = renderHook(() => useClientRankHistory('ws-1', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(history);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useClientApprovals
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientApprovals', () => {
  beforeEach(() => mockGetSafe.mockReset());

  it('does not fetch when enabled is false', () => {
    renderHook(() => useClientApprovals('ws-1', false), { wrapper: makeWrapper() });
    expect(mockGetSafe).not.toHaveBeenCalled();
  });

  it('returns data on success', async () => {
    const batches = [{ id: 'b1', status: 'pending', title: 'Batch 1' }];
    mockGetSafe.mockResolvedValue(batches);
    const { result } = renderHook(() => useClientApprovals('ws-1', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(batches);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useClientAnomalies
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientAnomalies', () => {
  beforeEach(() => mockGetSafe.mockReset());

  it('does not fetch when enabled is false', () => {
    renderHook(() => useClientAnomalies('ws-1', false), { wrapper: makeWrapper() });
    expect(mockGetSafe).not.toHaveBeenCalled();
  });

  it('returns anomaly data on success', async () => {
    const anomalies = [{ type: 'traffic_drop', severity: 'high', title: 'Drop' }];
    mockGetSafe.mockResolvedValue(anomalies);
    const { result } = renderHook(() => useClientAnomalies('ws-1', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(anomalies);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useClientAnnotations
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientAnnotations', () => {
  beforeEach(() => mockGetSafe.mockReset());

  it('does not fetch when enabled is false', () => {
    renderHook(() => useClientAnnotations('ws-1', false), { wrapper: makeWrapper() });
    expect(mockGetSafe).not.toHaveBeenCalled();
  });

  it('returns annotations on success', async () => {
    const annotations = [{ id: 'ann1', text: 'note', date: '2024-01-01' }];
    mockGetSafe.mockResolvedValue(annotations);
    const { result } = renderHook(() => useClientAnnotations('ws-1', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(annotations);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useClientActions
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientActions', () => {
  beforeEach(() => mockGetSafe.mockReset());

  it('does not fetch when enabled is false', () => {
    renderHook(() => useClientActions('ws-1', false), { wrapper: makeWrapper() });
    expect(mockGetSafe).not.toHaveBeenCalled();
  });

  it('returns data on success', async () => {
    const actions = [{ id: 'ca1', type: 'approve', status: 'pending' }];
    mockGetSafe.mockResolvedValue(actions);
    const { result } = renderHook(() => useClientActions('ws-1', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(actions);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useClientAuditSummary
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientAuditSummary', () => {
  beforeEach(() => mockGetOptional.mockReset());

  it('does not fetch when enabled is false', () => {
    renderHook(() => useClientAuditSummary('ws-1', false), { wrapper: makeWrapper() });
    expect(mockGetOptional).not.toHaveBeenCalled();
  });

  it('returns null when API returns null', async () => {
    mockGetOptional.mockResolvedValue(null);
    const { result } = renderHook(() => useClientAuditSummary('ws-1', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('returns audit summary data on success', async () => {
    const summary = { id: 'audit1', siteScore: 82, totalPages: 50, errors: 2, warnings: 5 };
    mockGetOptional.mockResolvedValue(summary);
    const { result } = renderHook(() => useClientAuditSummary('ws-1', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(summary);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useClientRawInsights
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientRawInsights', () => {
  beforeEach(() => mockGetSafe.mockReset());

  it('does not fetch when enabled is false', () => {
    renderHook(() => useClientRawInsights('ws-1', false), { wrapper: makeWrapper() });
    expect(mockGetSafe).not.toHaveBeenCalled();
  });

  it('returns data array on success', async () => {
    const insights = [{ id: 'i1', type: 'traffic_spike', title: 'Spike' }];
    mockGetSafe.mockResolvedValue(insights);
    const { result } = renderHook(() => useClientRawInsights('ws-1', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(insights);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useClientInsights (narrative)
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientInsights', () => {
  beforeEach(() => mockGetSafe.mockReset());

  it('does not fetch when workspaceId is empty string', () => {
    // enabled defaults to true but !!workspaceId guard disables it
    renderHook(() => useClientInsights(''), { wrapper: makeWrapper() });
    expect(mockGetSafe).not.toHaveBeenCalled();
  });

  it('does not fetch when enabled is false', () => {
    renderHook(() => useClientInsights('ws-1', false), { wrapper: makeWrapper() });
    expect(mockGetSafe).not.toHaveBeenCalled();
  });

  it('returns insights data on success', async () => {
    const payload = { insights: [{ id: 'ci1', title: 'Insight A', body: 'content' }] };
    mockGetSafe.mockResolvedValue(payload);
    const { result } = renderHook(() => useClientInsights('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useClientOutcomeSummary
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientOutcomeSummary', () => {
  beforeEach(() => mockGetSummary.mockReset());

  it('does not fetch when wsId is empty string', () => {
    renderHook(() => useClientOutcomeSummary(''), { wrapper: makeWrapper() });
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it('returns scorecard data on success', async () => {
    const scorecard = { winRate: 0.75, totalActions: 20, confirmedWins: 15 };
    mockGetSummary.mockResolvedValue(scorecard);
    const { result } = renderHook(() => useClientOutcomeSummary('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(scorecard);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useClientOutcomeWins
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientOutcomeWins', () => {
  beforeEach(() => mockGetWins.mockReset());

  it('does not fetch when wsId is empty string', () => {
    renderHook(() => useClientOutcomeWins(''), { wrapper: makeWrapper() });
    expect(mockGetWins).not.toHaveBeenCalled();
  });

  it('returns wins array on success', async () => {
    const wins = [{ id: 'w1', title: 'Ranked #1', confirmedAt: '2024-03-01' }];
    mockGetWins.mockResolvedValue(wins);
    const { result } = renderHook(() => useClientOutcomeWins('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(wins);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useClientPostPreview
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientPostPreview', () => {
  beforeEach(() => mockGetPost.mockReset());

  it('does not fetch when postId is undefined', () => {
    renderHook(() => useClientPostPreview('ws-1', undefined, true), { wrapper: makeWrapper() });
    expect(mockGetPost).not.toHaveBeenCalled();
  });

  it('does not fetch when enabled is false', () => {
    renderHook(() => useClientPostPreview('ws-1', 'post-1', false), { wrapper: makeWrapper() });
    expect(mockGetPost).not.toHaveBeenCalled();
  });

  it('returns post data on success', async () => {
    const post = { id: 'post-1', title: 'My Article', status: 'post_review' };
    mockGetPost.mockResolvedValue(post);
    const { result } = renderHook(() => useClientPostPreview('ws-1', 'post-1', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(post);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useClientSearch
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientSearch', () => {
  beforeEach(() => {
    mockGscOverview.mockReset();
    mockGscTrend.mockReset();
    mockGscComparison.mockReset();
    mockGscDevices.mockReset();
  });

  it('does not call any sub-query when enabled is false', () => {
    renderHook(() => useClientSearch('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(mockGscOverview).not.toHaveBeenCalled();
    expect(mockGscTrend).not.toHaveBeenCalled();
  });

  it('returns isLoading true while sub-queries are pending', () => {
    mockGscOverview.mockReturnValue(new Promise(() => {}));
    mockGscTrend.mockReturnValue(new Promise(() => {}));
    mockGscComparison.mockReturnValue(new Promise(() => {}));
    mockGscDevices.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns overview and trend data when all sub-queries succeed', async () => {
    const overview = { totalClicks: 100, totalImpressions: 1000, avgCtr: 0.1, avgPosition: 5 };
    const trend = [{ date: '2024-01-01', clicks: 10, impressions: 100, ctr: 0.1, position: 5 }];
    mockGscOverview.mockResolvedValue(overview);
    mockGscTrend.mockResolvedValue(trend);
    mockGscComparison.mockResolvedValue(null);
    mockGscDevices.mockResolvedValue([]);
    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.overview).toEqual(overview);
    expect(result.current.trend).toEqual(trend);
  });

  it('keeps client GSC query keys on the shared factory shape', async () => {
    const dr = { startDate: '2024-01-01', endDate: '2024-01-31' } as const;
    mockGscOverview.mockResolvedValue(null);
    mockGscTrend.mockResolvedValue([]);
    mockGscComparison.mockResolvedValue(null);
    mockGscDevices.mockResolvedValue([]);

    const { client, wrapper } = makeWrapperWithClient();
    renderHook(() => useClientSearch('ws-1', 28, dr, true), { wrapper });

    await waitFor(() => expect(client.getQueryState(queryKeys.client.gsc('ws-1', 'overview', 28, dr))?.status).toBe('success'));
    expect(client.getQueryState(queryKeys.client.gsc('ws-1', 'trend', 28, dr))?.status).toBe('success');
    expect(client.getQueryState(queryKeys.client.gsc('ws-1', 'comparison', 28, dr))?.status).toBe('success');
    expect(client.getQueryState(queryKeys.client.gsc('ws-1', 'devices', 28, dr))?.status).toBe('success');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useMonthlyDigest
// ─────────────────────────────────────────────────────────────────────────────

describe('useMonthlyDigest', () => {
  beforeEach(() => mockGetSafe.mockReset());

  it('does not fetch when workspaceId is empty string', () => {
    renderHook(() => useMonthlyDigest(''), { wrapper: makeWrapper() });
    expect(mockGetSafe).not.toHaveBeenCalled();
  });

  it('returns digest data on success', async () => {
    const digest = {
      month: 'January 2024',
      period: { start: '2024-01-01', end: '2024-01-31' },
      summary: 'Great month',
      wins: [],
      issuesAddressed: [],
      metrics: { clicksChange: 12, impressionsChange: 5, avgPositionChange: -0.5, pagesOptimized: 3 },
      roiHighlights: [],
    };
    mockGetSafe.mockResolvedValue(digest);
    const { result } = renderHook(() => useMonthlyDigest('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(digest);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useClientIntelligence
// ─────────────────────────────────────────────────────────────────────────────

describe('useClientIntelligence', () => {
  beforeEach(() => mockFetchClientIntelligence.mockReset());

  it('does not fetch when workspaceId is empty string', () => {
    renderHook(() => useClientIntelligence(''), { wrapper: makeWrapper() });
    expect(mockFetchClientIntelligence).not.toHaveBeenCalled();
  });

  it('returns intelligence data on success', async () => {
    const intelligence = {
      workspaceId: 'ws-1',
      assembledAt: '2024-01-01T00:00:00Z',
      tier: 'growth',
      insightsSummary: { total: 5, actionable: 3, highPriority: 1 },
      pipelineStatus: null,
    };
    mockFetchClientIntelligence.mockResolvedValue(intelligence);
    const { result } = renderHook(() => useClientIntelligence('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(intelligence);
  });
});
