import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DecayingPagesCard } from '../../../src/components/strategy/DecayingPagesCard';
import type { DecayAnalysis, DecayingPage } from '../../../shared/types/content-decay';

const state = vi.hoisted(() => ({ data: null as DecayAnalysis | null, isLoading: false }));
vi.mock('../../../src/hooks/admin/useContentDecay', () => ({
  useContentDecay: () => ({ data: state.data, isLoading: state.isLoading }),
}));
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

const page = (over: Partial<DecayingPage> = {}): DecayingPage => ({
  page: '/p', currentClicks: 5, previousClicks: 50, clickDeclinePct: 90,
  currentImpressions: 100, previousImpressions: 900, impressionChangePct: 88,
  currentPosition: 12, previousPosition: 4, positionChange: 8, severity: 'critical', ...over,
});
const analysis = (pages: DecayingPage[]): DecayAnalysis => ({
  workspaceId: 'ws1', analyzedAt: '2026-06-01', totalPages: 10, decayingPages: pages,
  summary: { critical: 1, warning: 0, watch: 0, totalDecaying: pages.length, avgDeclinePct: 90 },
});

describe('DecayingPagesCard', () => {
  beforeEach(() => { vi.clearAllMocks(); state.data = null; state.isLoading = false; });

  it('renders null when no analysis exists', () => {
    const { container } = render(<MemoryRouter><DecayingPagesCard workspaceId="ws1" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders null when there are no decaying pages', () => {
    state.data = analysis([]);
    const { container } = render(<MemoryRouter><DecayingPagesCard workspaceId="ws1" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders decaying pages and routes the Refresh-brief CTA into the content pipeline', () => {
    state.data = analysis([page({ page: '/pricing', title: 'Pricing', severity: 'critical' })]);
    render(<MemoryRouter><DecayingPagesCard workspaceId="ws1" /></MemoryRouter>);
    expect(screen.getByText('Pricing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh brief/i }));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('content-pipeline'),
      expect.objectContaining({
        state: { fixContext: expect.objectContaining({ targetRoute: 'content-pipeline', pageSlug: '/pricing' }) },
      }),
    );
  });
});
