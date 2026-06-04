/**
 * BEHAVIORAL coherence guard for the SHARED `rankTrackingKeywords` cache key.
 *
 * Background (Task 2 follow-up): `RankTracker` and `KeywordStrategy` both read the
 * SINGLE query key `queryKeys.admin.rankTrackingKeywords(workspaceId)`. They mount
 * on adjacent admin tabs for the same workspace and `gcTime` is 5 min, so whichever
 * mounts second hydrates from the first's cached value.
 *
 * The CONTRACT (the spec's `select` design):
 *   - The CACHE holds ONE canonical shape: `TrackedKeyword[]` (the array the queryFn returns).
 *   - RankTracker consumes the array directly (identity / no `select`) and `.map`s it.
 *   - KeywordStrategy keeps a `select: rows => new Set(rows.map(k => keywordTrackingKey(k.query)))`
 *     so the COMPONENT receives a `Set` (which it `.has`-es) while the CACHE stays an array.
 *
 * The BUG this guards against (the broken Task 2 state):
 *   KeywordStrategy's `queryFn` did `.then(kws => new Set(...))`, writing a `Set` into the
 *   shared array-shaped cache. When RankTracker then read the same key it got a `Set` and
 *   crashed with `TypeError: keywords.map is not a function` (RankTracker.tsx :116/:140/:585/:590).
 *
 * This test renders BOTH components against ONE shared QueryClient (the real app topology)
 * and asserts neither crashes and each consumer gets its correct shape. Against the broken
 * code it goes RED (RankTracker throws on the Set); after the `select` fix it is GREEN.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TrackedKeyword, LatestRank } from '../../shared/types/rank-tracking';

// ── Mock API client (used by both components via src/api/seo.ts) ──────────────
vi.mock('../../src/api/client', () => ({
  get: vi.fn().mockResolvedValue([]),
  getSafe: vi.fn().mockResolvedValue([]),
  post: vi.fn().mockResolvedValue({}),
  patch: vi.fn().mockResolvedValue({}),
  del: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn().mockReturnValue(false),
}));
vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: vi.fn(),
}));

// KeywordStrategy pulls in a heavy hook graph (background tasks, useKeywordStrategy, etc.).
// Partially mock the admin hooks barrel: only neutralize `useKeywordStrategy` (so the panel
// renders its "no strategy" path) while keeping every other real export (`useLocalSeo`, etc.)
// intact. The real `useQuery` for tracked keywords stays live — that's what we're testing.
vi.mock('../../src/hooks/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/hooks/admin')>();
  return {
    ...actual,
    useKeywordStrategy: vi.fn().mockReturnValue({ data: null, isLoading: false, isAuxLoading: false }),
  };
});
vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: vi.fn().mockReturnValue({ jobs: [], startJob: vi.fn(), findActiveJob: vi.fn() }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

import { RankTracker } from '../../src/components/RankTracker';
import { KeywordStrategyPanel } from '../../src/components/KeywordStrategy';

const WS = 'ws-shared-cache';

function makeKeyword(overrides: Partial<TrackedKeyword> = {}): TrackedKeyword {
  return { query: 'seo tips', pinned: false, addedAt: '2024-01-01T00:00:00Z', source: 'manual', ...overrides };
}
function makeRank(overrides: Partial<LatestRank> = {}): LatestRank {
  return { query: 'seo tips', position: 5.0, clicks: 120, impressions: 2000, ctr: 0.06, change: -2, pinned: false, ...overrides };
}

async function setupMocks(keywords: TrackedKeyword[], ranks: LatestRank[]) {
  const { get, getSafe } = await import('../../src/api/client');
  vi.mocked(get).mockImplementation((url: string) => {
    if (url.includes('/rank-tracking') && url.includes('/keywords')) {
      return Promise.resolve(keywords) as ReturnType<typeof get>;
    }
    if (url.includes('/latest')) return Promise.resolve(ranks) as ReturnType<typeof get>;
    if (url.includes('/history')) return Promise.resolve([]) as ReturnType<typeof get>;
    // AIContextIndicator fetches /api/ai/context/:ws and reads `.sources`.
    if (url.includes('/ai/context')) return Promise.resolve({ sources: [] }) as ReturnType<typeof get>;
    return Promise.resolve([]) as ReturnType<typeof get>;
  });
  vi.mocked(getSafe).mockImplementation((url: string, fallback: unknown) => {
    if (url.includes('/latest')) return Promise.resolve(ranks) as ReturnType<typeof getSafe>;
    return Promise.resolve((fallback ?? []) as unknown) as ReturnType<typeof getSafe>;
  });
}

describe('rankTrackingKeywords shared-cache coherence (RankTracker ↔ KeywordStrategy)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('KeywordStrategy populating the cache does not break RankTracker reading the same key', async () => {
    await setupMocks([makeKeyword({ query: 'seo tips' })], [makeRank({ query: 'seo tips' })]);

    // ONE QueryClient shared by both components — the real admin-tab topology.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    // 1) Mount KeywordStrategy FIRST so it (and only it) populates the shared
    //    `rankTrackingKeywords` cache entry. In the broken code this writes a Set.
    const ksUtils = render(
      <QueryClientProvider client={queryClient}>
        <KeywordStrategyPanel workspaceId={WS} />
      </QueryClientProvider>,
    );

    // Let the tracked-keywords query settle and populate the cache.
    await waitFor(() => {
      expect(queryClient.getQueryData(['admin-rank-tracking-keywords', WS])).toBeDefined();
    });

    // CONTRACT: the cached value must be the canonical ARRAY, never a Set.
    const cached = queryClient.getQueryData(['admin-rank-tracking-keywords', WS]);
    expect(Array.isArray(cached)).toBe(true);
    expect(cached instanceof Set).toBe(false);

    // KeywordStrategy itself must still receive a Set (it `.has`-es keys) — proven by
    // the component not crashing AND the `select` deriving from the array. Rendering
    // without throwing is the proof that `trackedKeywords.has(...)` works.
    expect(ksUtils.container).toBeTruthy();

    // 2) Now mount RankTracker against the SAME QueryClient. It reads the same key and
    //    `.map`s it. In the broken code (Set in cache) this throws "keywords.map is not
    //    a function" during render; after the fix it renders the array fine.
    render(
      <QueryClientProvider client={queryClient}>
        <RankTracker workspaceId={WS} hasGsc={true} />
      </QueryClientProvider>,
    );

    // RankTracker rendered its array-derived UI without a TypeError.
    await waitFor(() => {
      // "seo tips" appears in RankTracker's rankings table (array consumed + mapped).
      expect(screen.getAllByText('seo tips').length).toBeGreaterThan(0);
      // Subtitle "1 keyword tracked" is derived from keywords.length — only works on an array.
      expect(screen.getByText(/1 keyword tracked/i)).toBeInTheDocument();
    });

    queryClient.clear();
  });
});
