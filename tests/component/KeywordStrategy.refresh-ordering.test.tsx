/**
 * KeywordStrategy.refresh-ordering.test.tsx — Task 3.3
 *
 * Tests for the Full-refresh button + RefreshOrderingPrompt intercept
 * wired into KeywordStrategyPanel.
 *
 * Mirrors KeywordStrategyBackgroundJob.test.tsx for mocking patterns.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KeywordStrategyPanel } from '../../src/components/KeywordStrategy';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs';
import type { BackgroundJob } from '../../src/hooks/useBackgroundTasks';

// ─── mutable mock state ───────────────────────────────────────────────────────

const refreshMutate = vi.fn();
const startJobMock = vi.fn();
const findActiveJobMock = vi.fn();

const mocks = vi.hoisted(() => ({
  startJob: vi.fn(),
  findActiveJob: vi.fn(),
  jobs: [] as BackgroundJob[],
  providerStatus: vi.fn(),
  getWorkspaceById: vi.fn(),
  isAuxLoading: false,
  // Default: non-local workspace (applies: false)
  keywordStrategyData: {
    strategy: null as null | { strategyUx?: { localSync?: { applies: boolean; localNeedsRefresh: boolean; localNeedsRefreshReason: string | null; lastLocalRefreshAt: string | null } }; generatedAt?: string | null; pageMap?: unknown[]; seoDataMode?: string; businessContext?: string },
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
  lastLocalRefreshAt?: string | null;
}) {
  return {
    applies: opts.applies,
    localNeedsRefresh: opts.localNeedsRefresh,
    localNeedsRefreshReason: opts.localNeedsRefreshReason ?? null,
    lastLocalRefreshAt: opts.lastLocalRefreshAt ?? null,
    strategyStaleVsLocal: false,
    lastStrategyGeneratedAt: null,
  };
}

function makeStrategy(localSync?: ReturnType<typeof makeLocalSync> | null) {
  return {
    generatedAt: null,
    pageMap: [],
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

describe('KeywordStrategyPanel — refresh ordering (Task 3.3)', () => {
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
        strategy: makeStrategy(null),
        seoDataAvailable: true,
        providers: [{ name: 'dataforseo', configured: true }],
        workspaceData: { competitorDomains: [], seoDataProvider: 'dataforseo' },
      };
    });

    it('does NOT show a Full refresh button', () => {
      renderPanel();
      expect(screen.queryByRole('button', { name: /full refresh/i })).toBeNull();
    });

    it('Generate Strategy calls startJob directly (no prompt)', async () => {
      renderPanel();
      fireEvent.click(screen.getByRole('button', { name: /generate strategy/i }));
      await waitFor(() => {
        expect(mocks.startJob).toHaveBeenCalledWith(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, expect.any(Object));
      });
      // Prompt should not appear
      expect(screen.queryByText(/Full refresh \(local → strategy\)/i)).toBeNull();
    });
  });

  describe('(b) local workspace + fresh data (applies=true, localNeedsRefresh=false)', () => {
    beforeEach(() => {
      mocks.keywordStrategyData = {
        strategy: makeStrategy(makeLocalSync({ applies: true, localNeedsRefresh: false })),
        seoDataAvailable: true,
        providers: [{ name: 'dataforseo', configured: true }],
        workspaceData: { competitorDomains: [], seoDataProvider: 'dataforseo' },
      };
    });

    it('shows Full refresh button when applies=true', () => {
      renderPanel();
      expect(screen.getByRole('button', { name: /full refresh/i })).toBeInTheDocument();
    });

    it('Generate Strategy calls startJob directly (no prompt) when data is fresh', async () => {
      renderPanel();
      fireEvent.click(screen.getByRole('button', { name: /generate strategy/i }));
      await waitFor(() => {
        expect(mocks.startJob).toHaveBeenCalledWith(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, expect.any(Object));
      });
      // Prompt should not appear
      expect(screen.queryByText(/Full refresh \(local → strategy\)/i)).toBeNull();
    });
  });

  describe('(c) local workspace + stale data (applies=true, localNeedsRefresh=true)', () => {
    beforeEach(() => {
      mocks.keywordStrategyData = {
        strategy: makeStrategy(makeLocalSync({ applies: true, localNeedsRefresh: true, localNeedsRefreshReason: 'stale' })),
        seoDataAvailable: true,
        providers: [{ name: 'dataforseo', configured: true }],
        workspaceData: { competitorDomains: [], seoDataProvider: 'dataforseo' },
      };
    });

    it('Generate Strategy opens the prompt (does NOT immediately call startJob)', async () => {
      renderPanel();
      fireEvent.click(screen.getByRole('button', { name: /generate strategy/i }));

      // Prompt appears
      await waitFor(() => {
        expect(screen.getByText(/Full refresh \(local → strategy\)/i)).toBeInTheDocument();
      });
      // startJob should NOT have been called yet
      expect(mocks.startJob).not.toHaveBeenCalled();
    });

    it('(d) prompt "Full refresh" button → refresh.mutate called with thenRegenerateStrategy:true', async () => {
      renderPanel();
      fireEvent.click(screen.getByRole('button', { name: /generate strategy/i }));

      await waitFor(() => {
        expect(screen.getByText(/Full refresh \(local → strategy\)/i)).toBeInTheDocument();
      });

      // Click the Full refresh action in the prompt
      fireEvent.click(screen.getByRole('button', { name: /Full refresh \(local → strategy\)/i }));

      expect(mocks.refreshMutate).toHaveBeenCalledWith(
        expect.objectContaining({ thenRegenerateStrategy: true }),
      );
      // startJob NOT called — the chain happens server-side
      expect(mocks.startJob).not.toHaveBeenCalled();
    });

    it('(e) prompt "Generate anyway" → startJob called, refresh NOT called', async () => {
      renderPanel();
      fireEvent.click(screen.getByRole('button', { name: /generate strategy/i }));

      await waitFor(() => {
        expect(screen.getByText(/Full refresh \(local → strategy\)/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /generate anyway/i }));

      await waitFor(() => {
        expect(mocks.startJob).toHaveBeenCalledWith(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, expect.any(Object));
      });
      expect(mocks.refreshMutate).not.toHaveBeenCalled();
    });
  });

  describe('(f) Full refresh button in PageHeader', () => {
    beforeEach(() => {
      mocks.keywordStrategyData = {
        strategy: makeStrategy(makeLocalSync({ applies: true, localNeedsRefresh: true, localNeedsRefreshReason: 'stale' })),
        seoDataAvailable: true,
        providers: [{ name: 'dataforseo', configured: true }],
        workspaceData: { competitorDomains: [], seoDataProvider: 'dataforseo' },
      };
    });

    it('Full refresh button click calls refresh.mutate with thenRegenerateStrategy:true', () => {
      renderPanel();
      const fullRefreshBtn = screen.getByRole('button', { name: /full refresh/i });
      fireEvent.click(fullRefreshBtn);
      expect(mocks.refreshMutate).toHaveBeenCalledWith(
        expect.objectContaining({ thenRegenerateStrategy: true }),
      );
    });
  });
});
