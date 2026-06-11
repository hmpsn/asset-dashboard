/**
 * KeywordStrategy-error-states.test.tsx — W1.1
 *
 * Covers three verified silent-failure bugs:
 *   Bug 1: fetch error swallowed → renders empty-state instead of ErrorState
 *   Bug 2: add-keyword failure re-uses generation error state (wrong title + wrong retry)
 *   Bug 3: trackKeyword swallows all failures as if they were duplicates
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KeywordStrategyPanel } from '../../src/components/KeywordStrategy';
import type { BackgroundJob } from '../../src/hooks/useBackgroundTasks';

// ─── mutable mock state ───────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  startJob: vi.fn(),
  findActiveJob: vi.fn(),
  jobs: [] as BackgroundJob[],
  // useKeywordStrategy return values — overridden per test
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  strategyData: null as null | {
    strategy: null | Record<string, unknown>;
    seoDataAvailable: boolean;
    providers: Array<{ name: string; configured: boolean }>;
    workspaceData: { competitorDomains?: string[]; seoDataProvider?: 'dataforseo' } | null;
  },
  // addKeyword / trackKeyword
  addKeywordAction: vi.fn(),
  addKeywordMock: vi.fn(),
  // keyword feedback rows — overridden in Bug 2 tests
  feedbackRows: [] as Array<{
    keyword: string;
    status: string;
    created_at: string;
    updated_at: string;
    reason: null | string;
  }>,
}));

// Hook mocks — useKeywordStrategy controls isError + refetch now
vi.mock('../../src/hooks/admin', () => ({
  useKeywordStrategy: () => ({
    data: mocks.strategyData ?? undefined,
    isLoading: mocks.isLoading,
    isError: mocks.isError,
    refetch: mocks.refetch,
    isAuxLoading: false,
  }),
  useLocalSeo: () => ({ data: { featureEnabled: false }, isLoading: false }),
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
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

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/api/seo', () => ({
  keywords: {
    providerStatus: vi.fn().mockResolvedValue({ providers: [] }),
    discoverCompetitors: vi.fn(),
    saveCompetitors: vi.fn(),
    // feedback is controlled via mocks.feedbackRows so individual tests can inject rows
    feedback: vi.fn().mockImplementation(() => Promise.resolve(mocks.feedbackRows)),
    strategyDiff: vi.fn().mockResolvedValue(null),
  },
  rankTracking: {
    keywords: vi.fn().mockResolvedValue([]),
    addKeyword: (...args: unknown[]) => mocks.addKeywordMock(...args),
  },
}));

vi.mock('../../src/api/keywordCommandCenter', () => ({
  keywordCommandCenter: {
    action: mocks.addKeywordAction,
  },
}));

vi.mock('../../src/api', () => ({
  workspaces: {
    getById: vi.fn().mockResolvedValue(null),
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

// ─── helpers ──────────────────────────────────────────────────────────────────

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

// ─── Bug 1: fetch error renders ErrorState, NOT the empty-state card ──────────

describe('Bug 1 — strategy fetch error (useKeywordStrategy.isError)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isLoading = false;
    mocks.isError = false;
    mocks.strategyData = null;
    mocks.feedbackRows = [];
    mocks.findActiveJob.mockReturnValue(undefined);
    mocks.startJob.mockResolvedValue('job-1');
    mocks.jobs = [];
  });

  it('renders an error affordance (not the empty-state card) when isError is true', () => {
    mocks.isError = true;
    mocks.strategyData = undefined as unknown as null;
    renderPanel();

    // Should NOT see the empty-state copy
    expect(screen.queryByText(/No keyword strategy yet/i)).not.toBeInTheDocument();

    // Should see an error affordance
    // ErrorState renders a role="alert" element
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('the error affordance retry button calls refetch, not generateStrategy', async () => {
    mocks.isError = true;
    mocks.strategyData = undefined as unknown as null;
    renderPanel();

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();

    // Find and click retry button within the alert
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mocks.refetch).toHaveBeenCalledTimes(1);
    });
    // Generate strategy job should NOT have been started
    expect(mocks.startJob).not.toHaveBeenCalled();
  });

  it('renders the empty-state card (not an error) when isError is false and data is null', () => {
    mocks.isError = false;
    mocks.strategyData = {
      strategy: null,
      seoDataAvailable: false,
      providers: [],
      workspaceData: null,
    };
    renderPanel();

    expect(screen.getByText(/No keyword strategy yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ─── Bug 2: add-keyword failure must NOT reuse the generation ErrorState ───────

describe('Bug 2 — add-keyword failure has its own error surface', () => {
  const requestedKeyword = 'organic traffic growth';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isLoading = false;
    mocks.isError = false;
    mocks.findActiveJob.mockReturnValue(undefined);
    mocks.startJob.mockResolvedValue('job-1');
    mocks.jobs = [];
    mocks.addKeywordAction.mockRejectedValue(new Error('Server error'));

    // Provide a workspace with a requested keyword so "Add to Strategy" button renders.
    // The keywords.feedback mock reads mocks.feedbackRows at call time.
    mocks.feedbackRows = [
      {
        keyword: requestedKeyword,
        status: 'requested',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        reason: null,
      },
    ];

    mocks.strategyData = {
      strategy: null,
      seoDataAvailable: false,
      providers: [],
      workspaceData: null,
    };
  });

  it('add-keyword failure does NOT render "Strategy Generation Failed" title', async () => {
    renderPanel();

    const addBtn = await screen.findByRole('button', { name: /add to strategy/i });
    fireEvent.click(addBtn);

    // Wait for mutation to settle
    await waitFor(() => expect(mocks.addKeywordAction).toHaveBeenCalledTimes(1));

    // Should NOT see the generation error title
    await waitFor(() => {
      expect(screen.queryByText(/Strategy Generation Failed/i)).not.toBeInTheDocument();
    });
  });

  it('add-keyword failure renders a distinct inline error, not the generation ErrorState', async () => {
    renderPanel();

    const addBtn = await screen.findByRole('button', { name: /add to strategy/i });
    fireEvent.click(addBtn);

    await waitFor(() => expect(mocks.addKeywordAction).toHaveBeenCalledTimes(1));

    // Should show some error indication that does NOT title as generation failure
    await waitFor(() => {
      // The inline error should exist (some text about the failure)
      const errorText = screen.queryByText(/failed to add keyword/i);
      expect(errorText).toBeInTheDocument();
    });
  });

  it('add-keyword failure retry re-runs the mutation, not generateStrategy', async () => {
    renderPanel();

    const addBtn = await screen.findByRole('button', { name: /add to strategy/i });
    fireEvent.click(addBtn);

    await waitFor(() => expect(mocks.addKeywordAction).toHaveBeenCalledTimes(1));

    // After failure, clicking retry should call action again (not startJob)
    // Look for a retry button specific to the add-keyword failure
    await waitFor(() => {
      expect(screen.queryByText(/failed to add keyword/i)).toBeInTheDocument();
    });

    // Clicking "Add to Strategy" again should re-run the mutation
    const addBtnAgain = screen.getAllByRole('button', { name: /add to strategy/i })[0];
    fireEvent.click(addBtnAgain);

    await waitFor(() => {
      expect(mocks.addKeywordAction).toHaveBeenCalledTimes(2);
      expect(mocks.startJob).not.toHaveBeenCalled();
    });
  });
});

// ─── Bug 3: trackKeyword distinguishes real failures from duplicates ───────────

describe('Bug 3 — trackKeyword error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isLoading = false;
    mocks.isError = false;
    mocks.findActiveJob.mockReturnValue(undefined);
    mocks.startJob.mockResolvedValue('job-1');
    mocks.jobs = [];
    mocks.addKeywordMock.mockReset();
    mocks.feedbackRows = [];

    mocks.strategyData = {
      strategy: {
        generatedAt: '2026-01-01T00:00:00Z',
        pageMap: [],
        seoDataMode: 'none',
        businessContext: '',
        siteKeywords: ['test keyword'],
        siteKeywordMetrics: [],
        opportunities: [],
        contentGaps: [],
        keywordGaps: [],
        quickWins: [],
      },
      seoDataAvailable: false,
      providers: [],
      workspaceData: null,
    };
  });

  it('the track button has a pending/disabled state while the request is in flight', async () => {
    // Make addKeyword hang so we can observe the pending state
    let resolveTrack!: () => void;
    mocks.addKeywordMock.mockImplementation(
      () => new Promise<unknown>((resolve) => { resolveTrack = () => resolve({}); })
    );

    renderPanel();

    // The strategy section with siteKeywords should render
    await screen.findByText('test keyword');

    // keywordHubEnabled is mocked as false, so label is "Track in Rank Tracker"
    const trackBtn = screen.getByRole('button', { name: /track in rank tracker/i });
    expect(trackBtn).not.toBeDisabled();

    fireEvent.click(trackBtn);

    // While pending, button should be disabled (shows "Adding...")
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /adding\.\.\./i })).toBeDisabled();
    });

    // Resolve to clean up
    resolveTrack();
  });

  it('a non-duplicate failure surfaces an error instead of silently succeeding', async () => {
    mocks.addKeywordMock.mockRejectedValue({ error: 'Internal server error' });

    renderPanel();

    await screen.findByText('test keyword');

    // keywordHubEnabled is mocked as false
    const trackBtn = screen.getByRole('button', { name: /track in rank tracker/i });
    fireEvent.click(trackBtn);

    // Should eventually show a role="alert" with the error
    await waitFor(() => {
      const alerts = screen.queryAllByRole('alert');
      const errorMessages = screen.queryAllByText(/failed to track|error.*track|track.*failed/i);
      expect(alerts.length + errorMessages.length).toBeGreaterThan(0);
    });
  });

  it('a "already tracked" error from the server is treated as success (no error shown)', async () => {
    // Server returns 200 for duplicates (deduplicates silently). This test verifies
    // that when the server returns an error with "already" in it, we do NOT surface it
    // as a user-visible failure (matches the comment in the original code about duplicates).
    // In practice the server 200s for duplicates, but if a 4xx with "already" or
    // "duplicate" message arrives, we should swallow it quietly.
    mocks.addKeywordMock.mockRejectedValue({ error: 'keyword already tracked' });

    renderPanel();
    await screen.findByText('test keyword');

    const trackBtn = screen.getByRole('button', { name: /track in rank tracker/i });
    fireEvent.click(trackBtn);

    // After settling, no error should appear for duplicate
    await waitFor(() => expect(mocks.addKeywordMock).toHaveBeenCalledTimes(1));

    // Allow all microtasks to settle
    await new Promise((r) => setTimeout(r, 50));

    const errorMessages = screen.queryAllByText(/failed to track|error.*track|track.*failed/i);
    expect(errorMessages).toHaveLength(0);
  });
});
