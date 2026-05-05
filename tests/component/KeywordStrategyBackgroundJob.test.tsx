import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KeywordStrategyPanel } from '../../src/components/KeywordStrategy';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs';
import type { BackgroundJob } from '../../src/hooks/useBackgroundTasks';

const mocks = vi.hoisted(() => ({
  startJob: vi.fn(),
  findActiveJob: vi.fn(),
  jobs: [] as BackgroundJob[],
}));

vi.mock('../../src/hooks/admin', () => ({
  useKeywordStrategy: () => ({
    data: {
      strategy: null,
      semrushAvailable: true,
      workspaceData: { competitorDomains: ['competitor.test'] },
    },
    isLoading: false,
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
    providerStatus: vi.fn().mockResolvedValue({ providers: [{ name: 'semrush', configured: true }] }),
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
    getById: vi.fn().mockResolvedValue({ seoDataProvider: 'semrush' }),
    update: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../src/api/client', () => ({
  get: vi.fn().mockResolvedValue(null),
  post: vi.fn(),
  del: vi.fn(),
}));

function panelUi(queryClient: QueryClient) {
  return (
    <MemoryRouter initialEntries={['/ws/ws-1/strategy']}>
      <QueryClientProvider client={queryClient}>
        <KeywordStrategyPanel workspaceId="ws-1" />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return { queryClient, ...render(panelUi(queryClient)) };
}

describe('KeywordStrategyPanel background job wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jobs = [];
    mocks.findActiveJob.mockReturnValue(undefined);
    mocks.startJob.mockResolvedValue('job-keyword-1');
  });

  it('starts keyword strategy generation through the shared background job API', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /generate strategy/i }));

    await waitFor(() => {
      expect(mocks.startJob).toHaveBeenCalledWith(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, {
        mode: 'full',
        workspaceId: 'ws-1',
        businessContext: undefined,
        semrushMode: 'quick',
        competitorDomains: ['competitor.test'],
        maxPages: 500,
      });
    });
  });

  it('uses an active keyword strategy job as the generating state', () => {
    mocks.findActiveJob.mockReturnValue({
      id: 'job-keyword-active',
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      status: 'running',
      message: 'Fetching pages and analyzing keywords...',
      createdAt: '2026-05-04T00:00:00.000Z',
      updatedAt: '2026-05-04T00:00:00.000Z',
      workspaceId: 'ws-1',
    });

    renderPanel();

    const button = screen.getByRole('button', { name: /generating/i });
    expect(button).toBeDisabled();
    expect(screen.getByText('Fetching pages and analyzing keywords...')).toBeInTheDocument();
  });

  it('invalidates the strategy query when a started job completes', async () => {
    const { queryClient, rerender } = renderPanel();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(screen.getByRole('button', { name: /generate strategy/i }));

    await waitFor(() => {
      expect(mocks.startJob).toHaveBeenCalled();
    });

    mocks.jobs = [{
      id: 'job-keyword-1',
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      status: 'done',
      message: 'Strategy complete',
      createdAt: '2026-05-04T00:00:00.000Z',
      updatedAt: '2026-05-04T00:00:01.000Z',
      workspaceId: 'ws-1',
    }];
    rerender(panelUi(queryClient));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['keyword-strategy', 'ws-1'] });
    });
  });

  it('tracks an active job that existed before mount and handles its completion', async () => {
    const activeJob: BackgroundJob = {
      id: 'job-keyword-active',
      type: BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY,
      status: 'running',
      message: 'Fetching pages and analyzing keywords...',
      createdAt: '2026-05-04T00:00:00.000Z',
      updatedAt: '2026-05-04T00:00:00.000Z',
      workspaceId: 'ws-1',
    };
    mocks.findActiveJob.mockReturnValue(activeJob);
    const { queryClient, rerender } = renderPanel();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /generating/i })).toBeDisabled();
    });

    mocks.findActiveJob.mockReturnValue(undefined);
    mocks.jobs = [{ ...activeJob, status: 'done', message: 'Strategy complete' }];
    rerender(panelUi(queryClient));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['keyword-strategy', 'ws-1'] });
    });
  });
});
