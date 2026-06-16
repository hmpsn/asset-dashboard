import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DecisionQueue } from '../../../src/components/strategy/DecisionQueue';
import type { Recommendation } from '../../../shared/types/recommendations';

const mockState = vi.hoisted(() => ({ set: undefined as unknown, isLoading: false }));
vi.mock('../../../src/hooks/admin/useAdminRecommendations', () => ({
  useAdminRecommendationSet: () => ({ data: mockState.set, isLoading: mockState.isLoading }),
}));

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

const makeRec = (over: Partial<Recommendation> = {}): Recommendation => ({
  id: 'r1', workspaceId: 'ws1', priority: 'fix_now', type: 'content',
  title: 'Write the pricing post', description: 'd', insight: 'i',
  impact: 'high', effort: 'low', impactScore: 80,
  opportunity: { value: 72, emvPerWeek: 0, predictedEmv: 0, roiPerEffortDay: 0, confidence: 0.8, calibration: 1, groundedSpine: [], components: [], calibrationVersion: 'v1', modelVersion: 'v1' },
  source: 'audit', affectedPages: ['/pricing'], trafficAtRisk: 0, impressionsAtRisk: 0,
  estimatedGain: '', actionType: 'content_creation', status: 'pending', targetKeyword: 'pricing',
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  ...over,
} as unknown as Recommendation);

const setOf = (recs: Recommendation[], topRecommendationId: string | null = null) => ({
  workspaceId: 'ws1', generatedAt: '2026-01-01', recommendations: recs,
  summary: { fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0, topRecommendationId },
});

describe('DecisionQueue', () => {
  beforeEach(() => { vi.clearAllMocks(); mockState.set = undefined; mockState.isLoading = false; });

  it('shows the empty state when there are no fix-now/fix-soon recs', () => {
    mockState.set = setOf([]);
    render(<MemoryRouter><DecisionQueue workspaceId="ws1" /></MemoryRouter>);
    expect(screen.getByText('Do this next')).toBeInTheDocument();
    expect(screen.getByText('No urgent actions')).toBeInTheDocument();
  });

  it('renders urgent recs and routes the Fix CTA with a fixContext', () => {
    mockState.set = setOf([makeRec()], 'r1');
    render(<MemoryRouter><DecisionQueue workspaceId="ws1" /></MemoryRouter>);
    expect(screen.getByText('Write the pricing post')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^fix$/i }));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('content-pipeline'),
      expect.objectContaining({
        state: { fixContext: expect.objectContaining({ targetRoute: 'content-pipeline', primaryKeyword: 'pricing' }) },
      }),
    );
  });

  it('excludes dismissed, completed, and fix-later recs from the urgent queue', () => {
    mockState.set = setOf([
      makeRec({ id: 'a', title: 'Active fix-now', priority: 'fix_now' }),
      makeRec({ id: 'b', title: 'Dismissed rec', status: 'dismissed' }),
      makeRec({ id: 'c', title: 'Later rec', priority: 'fix_later' }),
      // Completing a rec leaves priority='fix_now' — must NOT surface with a live Fix CTA.
      makeRec({ id: 'd', title: 'Completed rec', priority: 'fix_now', status: 'completed' }),
    ]);
    render(<MemoryRouter><DecisionQueue workspaceId="ws1" /></MemoryRouter>);
    expect(screen.getByText('Active fix-now')).toBeInTheDocument();
    expect(screen.queryByText('Dismissed rec')).not.toBeInTheDocument();
    expect(screen.queryByText('Later rec')).not.toBeInTheDocument();
    expect(screen.queryByText('Completed rec')).not.toBeInTheDocument();
  });

  it('renders a loading state while fetching', () => {
    mockState.isLoading = true;
    render(<MemoryRouter><DecisionQueue workspaceId="ws1" /></MemoryRouter>);
    expect(screen.getByText('Do this next')).toBeInTheDocument();
  });
});
