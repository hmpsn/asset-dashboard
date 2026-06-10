import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InsightsEngine } from '../../../src/components/client/InsightsEngine';
import { ToastProvider } from '../../../src/components/Toast';
import type { RecommendationSet } from '../../../shared/types/recommendations';

const useQueryMock = vi.fn();
const setQueryDataMock = vi.fn();
const trackJobMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();
const delMock = vi.fn();
let activeJobMock: Record<string, unknown> | undefined;
let latestTerminalJobMock: Record<string, unknown> | undefined;

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (...args: unknown[]) => useQueryMock(...args),
    useQueryClient: () => ({ setQueryData: setQueryDataMock, invalidateQueries: vi.fn() }),
  };
});

vi.mock('../../../src/components/client/useCart', () => ({
  useCart: () => ({
    items: [],
    isOpen: false,
    addItem: vi.fn(),
    removeItem: vi.fn(),
    updateQuantity: vi.fn(),
    clearCart: vi.fn(),
    openCart: vi.fn(),
    closeCart: vi.fn(),
    toggleCart: vi.fn(),
    totalItems: 0,
    totalPrice: 0,
  }),
}));

vi.mock('../../../src/api/client', () => ({
  get: vi.fn(),
  post: (...args: unknown[]) => postMock(...args),
  patch: (...args: unknown[]) => patchMock(...args),
  del: (...args: unknown[]) => delMock(...args),
}));

vi.mock('../../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({
    findActiveJob: vi.fn(() => activeJobMock),
    findLatestTerminalJob: vi.fn(() => latestTerminalJobMock),
    trackJob: trackJobMock,
  }),
}));

function makeSet(): RecommendationSet {
  return {
    workspaceId: 'ws-test',
    generatedAt: '2026-05-16T00:00:00.000Z',
    summary: {
      fixNow: 1,
      fixSoon: 0,
      fixLater: 0,
      ongoing: 0,
      totalImpactScore: 88,
      trafficAtRisk: 120,
      estimatedRecoverableClicks: 14,
      estimatedRecoverableImpressions: 60,
    },
    recommendations: [
      {
        id: 'rec-1',
        workspaceId: 'ws-test',
        priority: 'fix_now',
        type: 'metadata',
        title: 'Fix homepage title',
        description: 'Title tag is missing.',
        insight: 'This affects click-through rate on your top page.',
        impact: 'high',
        effort: 'low',
        impactScore: 88,
        source: 'audit',
        affectedPages: [''],
        trafficAtRisk: 120,
        impressionsAtRisk: 500,
        estimatedGain: 'Recover up to 14 clicks/mo',
        actionType: 'manual',
        status: 'pending',
        createdAt: '2026-05-16T00:00:00.000Z',
        updatedAt: '2026-05-16T00:00:00.000Z',
      },
    ],
  };
}

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe('InsightsEngine', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    setQueryDataMock.mockReset();
    trackJobMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    delMock.mockReset();
    activeJobMock = undefined;
    latestTerminalJobMock = undefined;
  });

  it('renders loading state', () => {
    useQueryMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<InsightsEngine workspaceId="ws-test" tier="growth" />);
    expect(screen.getByText('Analyzing your site for recommendations...')).toBeInTheDocument();
  });

  it('renders empty state when no recommendations are available', () => {
    const set = makeSet();
    set.recommendations = [];
    useQueryMock.mockReturnValue({ data: set, isLoading: false, isError: false });

    render(<InsightsEngine workspaceId="ws-test" tier="growth" />);
    expect(screen.getByText('No recommendations yet')).toBeInTheDocument();
  });

  it('renders compact recommendations and navigates on Fix click', () => {
    const set = makeSet();
    useQueryMock.mockReturnValue({ data: set, isLoading: false, isError: false });
    const onNavigate = vi.fn();

    render(<InsightsEngine workspaceId="ws-test" tier="growth" compact onNavigate={onNavigate} />);

    expect(screen.getByText('Action Plan')).toBeInTheDocument();
    expect(screen.getByText('Fix homepage title')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /fix/i }));
    expect(onNavigate).toHaveBeenCalledWith('seo-editor', { pageSlug: '', recType: 'metadata' });
  });

  it('shows recommendation job progress in the empty state', () => {
    const set = makeSet();
    set.recommendations = [];
    useQueryMock.mockReturnValue({ data: set, isLoading: false, isError: false });
    activeJobMock = {
      id: 'job-1',
      type: 'recommendations-generation',
      status: 'running',
      message: 'Generating recommendations...',
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
      workspaceId: 'ws-test',
    };

    render(<InsightsEngine workspaceId="ws-test" tier="growth" />);

    expect(screen.getByText('Generating recommendations')).toBeInTheDocument();
    expect(screen.getByText('Generating recommendations...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
  });

  it('tracks the public recommendation generation job when refresh starts', async () => {
    const set = makeSet();
    useQueryMock.mockReturnValue({ data: set, isLoading: false, isError: false });
    postMock.mockResolvedValue({ jobId: 'job-77' });

    render(<InsightsEngine workspaceId="ws-test" tier="growth" />);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(postMock).toHaveBeenCalledWith('/api/public/recommendations/ws-test/generate');
    await waitFor(() => {
      expect(trackJobMock).toHaveBeenCalledWith('recommendations-generation', 'job-77', { workspaceId: 'ws-test' });
    });
  });

  // ── Error toast tests (fix 5) ────────────────────────────────────────────

  it('shows error toast when handleRegenerate post() rejects', async () => {
    const set = makeSet();
    useQueryMock.mockReturnValue({ data: set, isLoading: false, isError: false });
    postMock.mockRejectedValue(new Error('Network error'));

    renderWithToast(<InsightsEngine workspaceId="ws-test" tier="growth" />);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows error toast when handleStatusUpdate patch() rejects', async () => {
    const set = makeSet();
    // premium tier — renders "Start Working On This" button after rec is expanded
    useQueryMock.mockReturnValue({ data: set, isLoading: false, isError: false });
    patchMock.mockRejectedValue(new Error('Status update failed'));

    renderWithToast(<InsightsEngine workspaceId="ws-test" tier="premium" />);

    // The fix_now priority group is expanded by default (see expandedPriorities initial state).
    // Expand the first rec by clicking the chevron toggle.
    const chevronBtns = screen.getAllByRole('button');
    const toggleBtn = chevronBtns.find(b => b.className.includes('rounded-[var(--radius-sm)]') && b.className.includes('bg-[var(--surface-3)]'));
    expect(toggleBtn).toBeDefined();
    fireEvent.click(toggleBtn!);

    // "Start Working On This" should now be present (rec expanded, status=pending, tier=premium)
    const startBtn = await screen.findByRole('button', { name: /start working on this/i });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(screen.getByText('Could not update recommendation')).toBeInTheDocument();
    });
  }, 10000);

  it('shows error toast when handleDismiss del() rejects', async () => {
    const set = makeSet();
    useQueryMock.mockReturnValue({ data: set, isLoading: false, isError: false });
    delMock.mockRejectedValue(new Error('Dismiss failed'));

    renderWithToast(<InsightsEngine workspaceId="ws-test" tier="growth" />);

    // Expand the rec to reveal the Dismiss button
    const chevronBtns = screen.getAllByRole('button');
    const toggleBtn = chevronBtns.find(b => b.className.includes('rounded-[var(--radius-sm)]') && b.className.includes('bg-[var(--surface-3)]'));
    expect(toggleBtn).toBeDefined();
    fireEvent.click(toggleBtn!);

    // Now "Dismiss" button should appear
    await waitFor(() => {
      const dismissBtn = screen.queryByRole('button', { name: /^dismiss$/i });
      expect(dismissBtn).toBeTruthy();
      fireEvent.click(dismissBtn!);
    });

    await waitFor(() => {
      expect(screen.getByText('Could not dismiss recommendation')).toBeInTheDocument();
    });
  });
});
