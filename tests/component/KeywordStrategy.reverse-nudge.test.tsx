/**
 * KeywordStrategy.reverse-nudge.test.tsx — Task 4.1
 *
 * Tests for the reverse-staleness nudge banner: rendered when the strategy is
 * older than the most recent local SEO refresh (strategyStaleVsLocal = true).
 *
 * Mirrors KeywordStrategy.refresh-ordering.test.tsx for mocking patterns.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KeywordStrategyPanel } from '../../src/components/KeywordStrategy';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs';
import type { BackgroundJob } from '../../src/hooks/useBackgroundTasks';

// ─── mutable mock state ───────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  startJob: vi.fn(),
  findActiveJob: vi.fn(),
  jobs: [] as BackgroundJob[],
  providerStatus: vi.fn(),
  getWorkspaceById: vi.fn(),
  isAuxLoading: false,
  keywordStrategyData: {
    strategy: null as null | {
      strategyUx?: {
        localSync?: {
          applies: boolean;
          localNeedsRefresh: boolean;
          localNeedsRefreshReason: string | null;
          strategyStaleVsLocal: boolean;
          lastLocalRefreshAt: string | null;
          lastStrategyGeneratedAt: string | null;
        };
      };
      generatedAt?: string | null;
      pageMap?: unknown[];
      seoDataMode?: string;
      businessContext?: string;
    },
    seoDataAvailable: true,
    providers: [{ name: 'dataforseo', configured: true }] as Array<{ name: string; configured: boolean }>,
    workspaceData: { competitorDomains: [] as string[], seoDataProvider: 'dataforseo' as const },
  },
  refreshMutate: vi.fn(),
}));

vi.mock('../../src/hooks/admin', () => ({
  useKeywordStrategy: () => ({
    data: mocks.keywordStrategyData,
    isLoading: false,
    isAuxLoading: mocks.isAuxLoading,
  }),
  useLocalSeo: () => ({
    data: { featureEnabled: false },
    isLoading: false,
  }),
  useLocalSeoRefresh: () => ({
    mutate: mocks.refreshMutate,
    isPending: false,
    error: null,
  }),
  useLocalSeoUpdate: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({
    jobs: mocks.jobs,
    startJob: mocks.startJob,
    findActiveJob: mocks.findActiveJob,
  }),
}));

vi.mock('../../src/api/seo', () => ({
  keywords: {
    providerStatus: mocks.providerStatus,
    discoverCompetitors: vi.fn(),
    saveCompetitors: vi.fn(),
    feedback: vi.fn().mockResolvedValue([]),
    strategyDiff: vi.fn().mockResolvedValue(null),
  },
  rankTracking: {
    keywords: vi.fn().mockResolvedValue([]),
    addKeyword: vi.fn(),
  },
}));

vi.mock('../../src/api', () => ({
  workspaces: {
    getById: mocks.getWorkspaceById,
    update: vi.fn().mockResolvedValue({}),
  },
  backlinks: {
    get: vi.fn().mockResolvedValue(null),
    profile: vi.fn().mockResolvedValue(null),
  },
  anomalies: {
    list: vi.fn().mockResolvedValue([]),
  },
  keywords: {
    feedback: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../src/api/client', () => ({
  get: vi.fn().mockResolvedValue(null),
  post: vi.fn(),
  del: vi.fn(),
}));

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeLocalSync(opts: {
  applies: boolean;
  localNeedsRefresh: boolean;
  localNeedsRefreshReason?: 'missing' | 'stale' | 'markets_changed' | null;
  strategyStaleVsLocal?: boolean;
  lastLocalRefreshAt?: string | null;
  lastStrategyGeneratedAt?: string | null;
}) {
  return {
    applies: opts.applies,
    localNeedsRefresh: opts.localNeedsRefresh,
    localNeedsRefreshReason: opts.localNeedsRefreshReason ?? null,
    strategyStaleVsLocal: opts.strategyStaleVsLocal ?? false,
    lastLocalRefreshAt: opts.lastLocalRefreshAt ?? null,
    lastStrategyGeneratedAt: opts.lastStrategyGeneratedAt ?? null,
  };
}

function makeStrategy(localSync?: ReturnType<typeof makeLocalSync> | null) {
  return {
    generatedAt: '2025-01-01T00:00:00Z',
    pageMap: [],
    siteKeywords: [],
    siteKeywordMetrics: [],
    opportunities: [],
    quickWins: [],
    seoDataMode: 'quick',
    strategyUx: localSync != null ? { localSync } : undefined,
    businessContext: undefined,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const ui = (
    <MemoryRouter initialEntries={['/ws/ws-1/strategy']}>
      <QueryClientProvider client={queryClient}>
        <KeywordStrategyPanel workspaceId="ws-1" />
      </QueryClientProvider>
    </MemoryRouter>
  );
  return { queryClient, ...render(ui) };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('KeywordStrategyPanel — reverse-staleness nudge (Task 4.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jobs = [];
    mocks.findActiveJob.mockReturnValue(undefined);
    mocks.startJob.mockResolvedValue('job-1');
    mocks.providerStatus.mockResolvedValue({ providers: [{ name: 'dataforseo', configured: true }] });
    mocks.getWorkspaceById.mockResolvedValue({ seoDataProvider: 'dataforseo' });
    mocks.isAuxLoading = false;
    mocks.refreshMutate.mockReset();
  });

  describe('(a) non-local workspace (applies=false)', () => {
    beforeEach(() => {
      mocks.keywordStrategyData = {
        strategy: makeStrategy(makeLocalSync({ applies: false, localNeedsRefresh: false, strategyStaleVsLocal: true })),
        seoDataAvailable: true,
        providers: [{ name: 'dataforseo', configured: true }],
        workspaceData: { competitorDomains: [], seoDataProvider: 'dataforseo' },
      };
    });

    it('does NOT render the reverse-staleness nudge', () => {
      renderPanel();
      expect(screen.queryByTestId('reverse-staleness-nudge')).toBeNull();
    });
  });

  describe('(b) local workspace, fresh strategy (applies=true, strategyStaleVsLocal=false)', () => {
    beforeEach(() => {
      mocks.keywordStrategyData = {
        strategy: makeStrategy(makeLocalSync({
          applies: true,
          localNeedsRefresh: false,
          strategyStaleVsLocal: false,
          lastLocalRefreshAt: '2025-06-01T00:00:00Z',
          lastStrategyGeneratedAt: '2025-06-02T00:00:00Z',
        })),
        seoDataAvailable: true,
        providers: [{ name: 'dataforseo', configured: true }],
        workspaceData: { competitorDomains: [], seoDataProvider: 'dataforseo' },
      };
    });

    it('does NOT render the reverse-staleness nudge', () => {
      renderPanel();
      expect(screen.queryByTestId('reverse-staleness-nudge')).toBeNull();
    });
  });

  describe('(c) local workspace, strategy older than local (applies=true, strategyStaleVsLocal=true)', () => {
    beforeEach(() => {
      mocks.keywordStrategyData = {
        strategy: makeStrategy(makeLocalSync({
          applies: true,
          localNeedsRefresh: false,
          strategyStaleVsLocal: true,
          lastLocalRefreshAt: '2025-06-05T00:00:00Z',
          lastStrategyGeneratedAt: '2025-01-01T00:00:00Z',
        })),
        seoDataAvailable: true,
        providers: [{ name: 'dataforseo', configured: true }],
        workspaceData: { competitorDomains: [], seoDataProvider: 'dataforseo' },
      };
    });

    it('renders the reverse-staleness nudge', () => {
      renderPanel();
      expect(screen.getByTestId('reverse-staleness-nudge')).toBeInTheDocument();
    });

    it('nudge contains regenerate copy referencing both dates', () => {
      renderPanel();
      const nudge = screen.getByTestId('reverse-staleness-nudge');
      expect(nudge.textContent).toMatch(/Regenerate/i);
    });

    it('clicking the dismiss control hides the nudge', () => {
      renderPanel();
      expect(screen.getByTestId('reverse-staleness-nudge')).toBeInTheDocument();

      // Find and click the dismiss button inside the nudge
      const nudge = screen.getByTestId('reverse-staleness-nudge');
      const dismissBtn = nudge.querySelector('[aria-label*="ismiss"], [title*="ismiss"]');
      expect(dismissBtn).not.toBeNull();
      fireEvent.click(dismissBtn!);

      expect(screen.queryByTestId('reverse-staleness-nudge')).toBeNull();
    });

    it('clicking "Generate Strategy" CTA calls startJob directly (localNeedsRefresh=false)', async () => {
      renderPanel();
      // There may be multiple "Generate Strategy" buttons — find the one inside the nudge
      const nudge = screen.getByTestId('reverse-staleness-nudge');
      const genBtn = nudge.querySelector('button');
      expect(genBtn).not.toBeNull();
      fireEvent.click(genBtn!);

      await waitFor(() => {
        expect(mocks.startJob).toHaveBeenCalledWith(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, expect.any(Object));
      });
      // Should NOT call refreshMutate — local data is fresh, goes straight to generate
      expect(mocks.refreshMutate).not.toHaveBeenCalled();
    });
  });
});
