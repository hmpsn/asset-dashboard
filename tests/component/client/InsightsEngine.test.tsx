import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InsightsEngine } from '../../../src/components/client/InsightsEngine';
import type { RecommendationSet } from '../../../shared/types/recommendations';

const useQueryMock = vi.fn();
const setQueryDataMock = vi.fn();

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: (...args: unknown[]) => useQueryMock(...args),
    useQueryClient: () => ({ setQueryData: setQueryDataMock }),
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
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
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

describe('InsightsEngine', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    setQueryDataMock.mockReset();
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
});
