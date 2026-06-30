import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DecayingPagesCard } from '../../../src/components/strategy/DecayingPagesCard';
import type { DecayAnalysis, DecayingPage } from '../../../shared/types/content-decay';
import type { Recommendation, RecommendationSet } from '../../../shared/types/recommendations';

// ── Mocks ──────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  data: null as DecayAnalysis | null,
  isLoading: false,
  recSet: null as RecommendationSet | null,
}));

vi.mock('../../../src/hooks/admin/useContentDecay', () => ({
  useContentDecay: () => ({ data: state.data, isLoading: state.isLoading }),
}));

vi.mock('../../../src/hooks/admin/useAdminRecommendations', () => ({
  useAdminRecommendationSet: () => ({ data: state.recSet }),
}));

// Mock recommendations.send — routes through the rec lifecycle wrapper
const sendMock = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api/misc', () => ({
  recommendations: {
    send: sendMock,
  },
}));

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

// ── Helpers ────────────────────────────────────────────────────────

function renderCard(workspaceId = 'ws1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DecayingPagesCard workspaceId={workspaceId} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// ── Factories ──────────────────────────────────────────────────────

const page = (over: Partial<DecayingPage> = {}): DecayingPage => ({
  page: '/p', currentClicks: 5, previousClicks: 50, clickDeclinePct: 90,
  currentImpressions: 100, previousImpressions: 900, impressionChangePct: 88,
  currentPosition: 12, previousPosition: 4, positionChange: 8, severity: 'critical', ...over,
});

const analysis = (pages: DecayingPage[]): DecayAnalysis => ({
  workspaceId: 'ws1', analyzedAt: '2026-06-01', totalPages: 10, decayingPages: pages,
  summary: { critical: 1, warning: 0, watch: 0, totalDecaying: pages.length, avgDeclinePct: 90 },
});

const makeRec = (over: Partial<Recommendation> = {}): Recommendation => ({
  id: 'rec-1',
  workspaceId: 'ws1',
  priority: 'fix_now',
  type: 'content_refresh',
  title: 'Refresh /pricing',
  description: 'Traffic dropped',
  insight: 'Clicks down 90%',
  impact: 'high',
  effort: 'low',
  impactScore: 80,
  source: 'content-decay',
  affectedPages: ['/pricing'],
  trafficAtRisk: 50,
  impressionsAtRisk: 900,
  estimatedGain: '+~45 clicks/mo',
  actionType: 'content_creation',
  status: 'pending',
  clientStatus: 'system',
  lifecycle: 'active',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  ...over,
});

const makeRecSet = (recs: Recommendation[]): RecommendationSet => ({
  workspaceId: 'ws1',
  generatedAt: '2026-06-01T00:00:00Z',
  recommendations: recs,
  summary: {
    fixNow: 1, fixSoon: 0, fixLater: 0, ongoing: 0,
    totalImpactScore: 80, trafficAtRisk: 50, topRecommendationId: recs[0]?.id ?? null,
  },
});

// ── Tests ──────────────────────────────────────────────────────────

describe('DecayingPagesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.data = null;
    state.isLoading = false;
    state.recSet = null;
    // Default: send resolves successfully
    sendMock.mockResolvedValue(makeRec({ clientStatus: 'sent' }));
  });

  it('renders null when no analysis exists', () => {
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders null when there are no decaying pages', () => {
    state.data = analysis([]);
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders decaying pages and routes the Refresh-brief CTA into the content pipeline', () => {
    state.data = analysis([page({ page: '/pricing', title: 'Pricing', severity: 'critical' })]);
    renderCard();
    expect(screen.getByText('Pricing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh brief/i }));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('content-pipeline'),
      expect.objectContaining({
        state: { fixContext: expect.objectContaining({ targetRoute: 'content-pipeline', pageSlug: '/pricing' }) },
      }),
    );
  });

  // ── P3 Lane C: send UX ─────────────────────────────────────────

  it('renders "Send to client" button when a content_refresh rec exists for the page', () => {
    state.data = analysis([page({ page: '/pricing', title: 'Pricing' })]);
    state.recSet = makeRecSet([makeRec({ affectedPages: ['/pricing'] })]);
    renderCard();
    expect(screen.getByRole('button', { name: /send to client/i })).toBeInTheDocument();
  });

  it('does NOT render "Send to client" when no content_refresh rec exists for the page', () => {
    state.data = analysis([page({ page: '/pricing', title: 'Pricing' })]);
    state.recSet = makeRecSet([]); // no recs
    renderCard();
    expect(screen.queryByRole('button', { name: /send to client/i })).not.toBeInTheDocument();
  });

  it('calls recommendations.send (rec lifecycle) — NOT clientActions.create — when Send is clicked', async () => {
    state.data = analysis([page({ page: '/pricing', title: 'Pricing' })]);
    state.recSet = makeRecSet([makeRec({ id: 'rec-99', affectedPages: ['/pricing'] })]);
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));
    await waitFor(() => expect(sendMock).toHaveBeenCalledWith('ws1', 'rec-99'));
  });

  it('shows a "Sent" pill and hides the Send button after send', async () => {
    state.data = analysis([page({ page: '/pricing', title: 'Pricing' })]);
    state.recSet = makeRecSet([makeRec({ affectedPages: ['/pricing'] })]);
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));
    await waitFor(() => expect(screen.getByText('Sent')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /send to client/i })).not.toBeInTheDocument();
  });

  it('renders "Sent" pill when rec.clientStatus is already "sent"', () => {
    state.data = analysis([page({ page: '/pricing', title: 'Pricing' })]);
    state.recSet = makeRecSet([makeRec({ affectedPages: ['/pricing'], clientStatus: 'sent' })]);
    renderCard();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send to client/i })).not.toBeInTheDocument();
  });

  it('shows "Client approved" emerald badge when clientStatus is "approved"', () => {
    state.data = analysis([page({ page: '/pricing', title: 'Pricing' })]);
    state.recSet = makeRecSet([makeRec({ affectedPages: ['/pricing'], clientStatus: 'approved' })]);
    renderCard();
    expect(screen.getByText('Client approved')).toBeInTheDocument();
  });

  it('shows "Client declined" red badge when clientStatus is "declined"', () => {
    state.data = analysis([page({ page: '/pricing', title: 'Pricing' })]);
    state.recSet = makeRecSet([makeRec({ affectedPages: ['/pricing'], clientStatus: 'declined' })]);
    renderCard();
    expect(screen.getByText('Client declined')).toBeInTheDocument();
  });

  it('shows "Discussing" amber badge when clientStatus is "discussing"', () => {
    state.data = analysis([page({ page: '/pricing', title: 'Pricing' })]);
    state.recSet = makeRecSet([makeRec({ affectedPages: ['/pricing'], clientStatus: 'discussing' })]);
    renderCard();
    expect(screen.getByText('Discussing')).toBeInTheDocument();
  });
});
