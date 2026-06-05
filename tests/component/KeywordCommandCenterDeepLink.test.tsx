import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KeywordCommandCenter } from '../../src/components/KeywordCommandCenter';
import {
  KEYWORD_COMMAND_CENTER_STATUS,
  type KeywordCommandCenterResponse,
  type KeywordCommandCenterRowsQuery,
} from '../../shared/types/keyword-command-center';
import { TRACKED_KEYWORD_STATUS } from '../../shared/types/rank-tracking';
import { keywordTrackingKey } from '../../src/lib/keywordTracking';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useKeywordCommandCenterSummary: vi.fn(),
  useKeywordCommandCenterRows: vi.fn(),
  useKeywordCommandCenterDetail: vi.fn(),
  useKeywordCommandCenterAction: vi.fn(),
  useKeywordCommandCenterBulkAction: vi.fn(),
}));

vi.mock('../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/admin', () => ({
  useLocalSeo: () => ({ data: undefined, isLoading: false, error: null }),
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useLocalSeoUpdate: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useLocalSeoLocationLookup: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useSetPrimaryMarket: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const TRACKED_KEY = keywordTrackingKey('cosmetic dentistry');

const payload: KeywordCommandCenterResponse = {
  rows: [
    {
      keyword: 'cosmetic dentistry',
      normalizedKeyword: TRACKED_KEY,
      lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED,
      statusLabel: 'Tracked',
      sourceLabels: [{ kind: 'tracking', label: 'Tracking' }],
      metrics: { volume: 1200, difficulty: 40, currentPosition: 4 },
      tracking: { status: TRACKED_KEYWORD_STATUS.ACTIVE },
      nextActions: [],
      isProtected: false,
    },
  ],
  counts: {
    total: 1, inStrategy: 0, tracked: 1, needsReview: 0, content: 0, pageAssigned: 0,
    rawEvidence: 0, local: 0, localCandidates: 0, visibleLocally: 0, possibleMatch: 0,
    notVisible: 0, notChecked: 0, providerDegraded: 0, requested: 0, declined: 0,
    retired: 0, lostVisibility: 0,
  },
  filters: [
    { id: 'all', label: 'All', count: 1 },
    { id: 'in_strategy', label: 'In Strategy', count: 0 },
    { id: 'tracked', label: 'Tracked', count: 1 },
    { id: 'needs_review', label: 'Needs Review', count: 0 },
  ],
  rawEvidenceTotal: 0,
  rawEvidenceReturned: 0,
  generatedAt: '2026-06-04T10:00:00.000Z',
} as unknown as KeywordCommandCenterResponse;

function rowsForQuery(query: KeywordCommandCenterRowsQuery) {
  const search = query.search?.toLowerCase();
  const rows = payload.rows.filter(row =>
    !search || row.normalizedKeyword.includes(search),
  );
  return {
    rows,
    pageInfo: { page: 1, pageSize: 50, totalRows: rows.length, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    generatedAt: payload.generatedAt,
  };
}

async function primeMocks() {
  const hooks = await import('../../src/hooks/admin/useKeywordCommandCenter');
  vi.mocked(hooks.useKeywordCommandCenterSummary).mockReturnValue({
    data: {
      counts: payload.counts,
      filters: payload.filters,
      rawEvidenceTotal: 0,
      rawEvidenceReturned: 0,
      generatedAt: payload.generatedAt,
      summarizedAt: payload.generatedAt,
    },
    isLoading: false,
    error: null,
  } as ReturnType<typeof hooks.useKeywordCommandCenterSummary>);
  vi.mocked(hooks.useKeywordCommandCenterRows).mockImplementation((_ws, query) => ({
    data: rowsForQuery(query),
    isLoading: false,
    isFetching: false,
    error: null,
  }) as ReturnType<typeof hooks.useKeywordCommandCenterRows>);
  vi.mocked(hooks.useKeywordCommandCenterDetail).mockImplementation((_ws, keyword) => ({
    data: keyword ? { row: payload.rows.find(r => r.normalizedKeyword === keyword) ?? payload.rows[0], generatedAt: payload.generatedAt } : undefined,
    isFetching: false,
    error: null,
  }) as ReturnType<typeof hooks.useKeywordCommandCenterDetail>);
  vi.mocked(hooks.useKeywordCommandCenterAction).mockReturnValue({ mutate: vi.fn(), isPending: false, variables: undefined } as ReturnType<typeof hooks.useKeywordCommandCenterAction>);
  vi.mocked(hooks.useKeywordCommandCenterBulkAction).mockReturnValue({ mutate: vi.fn(), isPending: false, variables: undefined } as ReturnType<typeof hooks.useKeywordCommandCenterBulkAction>);
}

function renderAt(initialEntry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <KeywordCommandCenter workspaceId="ws-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function isActiveFilter(label: string): boolean {
  const btn = screen.getByRole('button', { name: new RegExp(`^${label}`) });
  // Active filter pills render Button variant="primary" → teal gradient.
  return btn.className.includes('from-[var(--teal)]');
}

describe('KeywordCommandCenter deep-link receiver (?q= + ?tab=)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    navigateMock.mockReset();
    await primeMocks();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('inits the tracked filter and seeds search from ?q=&tab=tracked', () => {
    renderAt(`/ws/w1/seo-keywords?q=${encodeURIComponent(TRACKED_KEY)}&tab=tracked`);
    // Active pill is "Tracked", NOT "All".
    expect(isActiveFilter('Tracked')).toBe(true);
    expect(isActiveFilter('All')).toBe(false);
    // Search seeded with the normalized q.
    const search = screen.getByLabelText('Search keywords') as HTMLInputElement;
    expect(search.value).toBe(TRACKED_KEY);
  });

  it('falls back to the all filter when ?tab= is bogus (no crash)', () => {
    renderAt('/ws/w1/seo-keywords?tab=bogus');
    expect(isActiveFilter('All')).toBe(true);
    expect(isActiveFilter('Tracked')).toBe(false);
  });
});
