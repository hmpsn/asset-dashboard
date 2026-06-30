import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KeywordOpportunities } from '../../../src/components/strategy/KeywordOpportunities';
import type { Recommendation, RecommendationSet } from '../../../shared/types/recommendations';

const opportunities = ['Target long-tail blog keywords', 'Optimize for featured snippets', 'Build local landing pages'];

// ── Mocks ──────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  recSet: null as RecommendationSet | null,
}));

vi.mock('../../../src/hooks/admin/useAdminRecommendations', () => ({
  useAdminRecommendationSet: () => ({ data: state.recSet }),
}));

const sendMock = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api/misc', () => ({
  recommendations: {
    send: sendMock,
  },
}));

// ── Factories ──────────────────────────────────────────────────────

const makeRec = (keyword: string, over: Partial<Recommendation> = {}): Recommendation => ({
  id: `rec-${keyword}`,
  workspaceId: 'ws1',
  priority: 'fix_now',
  type: 'keyword_gap',
  title: `Target ${keyword}`,
  description: `Opportunity: ${keyword}`,
  insight: `High search volume for ${keyword}`,
  impact: 'high',
  effort: 'low',
  impactScore: 75,
  source: 'keyword-gap-analysis',
  affectedPages: [],
  trafficAtRisk: 0,
  impressionsAtRisk: 0,
  estimatedGain: '+~200 clicks/mo',
  actionType: 'content_creation',
  status: 'pending',
  clientStatus: 'system',
  lifecycle: 'active',
  targetKeyword: keyword,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  ...over,
});

const makeRecSet = (recs: Recommendation[]): RecommendationSet => ({
  workspaceId: 'ws1',
  generatedAt: '2026-06-01T00:00:00Z',
  recommendations: recs,
  summary: {
    fixNow: recs.length, fixSoon: 0, fixLater: 0, ongoing: 0,
    totalImpactScore: 75, trafficAtRisk: 0, topRecommendationId: recs[0]?.id ?? null,
  },
});

function renderComponent(props: Parameters<typeof KeywordOpportunities>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <KeywordOpportunities {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// ── Tests ──────────────────────────────────────────────────────────

describe('KeywordOpportunities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.recSet = null;
    sendMock.mockResolvedValue(makeRec('test', { clientStatus: 'sent' }));
  });

  // ── Pre-existing tests (parity) ───────────────────────────────

  it('renders the heading and each opportunity string', () => {
    renderComponent({ opportunities });
    expect(screen.getByText('Keyword Opportunities')).toBeInTheDocument();
    expect(screen.getByText('Target long-tail blog keywords')).toBeInTheDocument();
    expect(screen.getByText('Optimize for featured snippets')).toBeInTheDocument();
    expect(screen.getByText('Build local landing pages')).toBeInTheDocument();
  });

  it('renders nothing when opportunities is empty', () => {
    const { container } = renderComponent({ opportunities: [] });
    expect(container.firstChild).toBeNull();
  });

  it('renders NO "Explore in Hub" affordance without workspaceId/navigate (legacy parity)', () => {
    renderComponent({ opportunities });
    expect(screen.queryByTitle('Explore in Hub')).not.toBeInTheDocument();
  });

  it('renders a per-row "Explore in Hub" deep-link when workspaceId + navigate are provided', () => {
    const navigate = vi.fn();
    renderComponent({ opportunities, workspaceId: 'ws1', navigate });
    const buttons = screen.getAllByTitle('Explore in Hub');
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[0]);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('seo-keywords'));
  });

  // ── P3 Lane C: send UX ─────────────────────────────────────────

  it('renders "Interested in this one?" button for opportunities that have a keyword_gap rec', () => {
    const kw = 'Target long-tail blog keywords';
    state.recSet = makeRecSet([makeRec(kw)]);
    renderComponent({ opportunities: [kw], workspaceId: 'ws1', enableSend: true });
    expect(screen.getByRole('button', { name: /interested in this one/i })).toBeInTheDocument();
  });

  it('does NOT render send affordance when enableSend is false (parity)', () => {
    const kw = 'Target long-tail blog keywords';
    state.recSet = makeRecSet([makeRec(kw)]);
    renderComponent({ opportunities: [kw], workspaceId: 'ws1', enableSend: false });
    expect(screen.queryByRole('button', { name: /interested in this one/i })).not.toBeInTheDocument();
  });

  it('does NOT render send affordance when workspaceId is absent even if enableSend is true', () => {
    const kw = 'Target long-tail blog keywords';
    state.recSet = makeRecSet([makeRec(kw)]);
    renderComponent({ opportunities: [kw], enableSend: true });
    expect(screen.queryByRole('button', { name: /interested in this one/i })).not.toBeInTheDocument();
  });

  it('shows inline confirm ("Yes, send it" / "Cancel") after clicking "Interested in this one?"', () => {
    const kw = 'Target long-tail blog keywords';
    state.recSet = makeRecSet([makeRec(kw)]);
    renderComponent({ opportunities: [kw], workspaceId: 'ws1', enableSend: true });
    fireEvent.click(screen.getByRole('button', { name: /interested in this one/i }));
    expect(screen.getByRole('button', { name: /yes, send it/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls recommendations.send — NOT clientActions.create — when confirm is clicked', async () => {
    const kw = 'Target long-tail blog keywords';
    state.recSet = makeRecSet([makeRec(kw, { id: 'rec-gap-1' })]);
    renderComponent({ opportunities: [kw], workspaceId: 'ws1', enableSend: true });
    fireEvent.click(screen.getByRole('button', { name: /interested in this one/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, send it/i }));
    await waitFor(() => expect(sendMock).toHaveBeenCalledWith('ws1', 'rec-gap-1'));
  });

  it('shows "Sent" pill after successful send', async () => {
    const kw = 'Target long-tail blog keywords';
    state.recSet = makeRecSet([makeRec(kw)]);
    renderComponent({ opportunities: [kw], workspaceId: 'ws1', enableSend: true });
    fireEvent.click(screen.getByRole('button', { name: /interested in this one/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, send it/i }));
    await waitFor(() => expect(screen.getByText('Sent')).toBeInTheDocument());
  });

  it('returns to "Interested in this one?" on cancel without sending', () => {
    const kw = 'Target long-tail blog keywords';
    state.recSet = makeRecSet([makeRec(kw)]);
    renderComponent({ opportunities: [kw], workspaceId: 'ws1', enableSend: true });
    fireEvent.click(screen.getByRole('button', { name: /interested in this one/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(sendMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /interested in this one/i })).toBeInTheDocument();
  });

  it('shows "Client approved" when clientStatus is "approved"', () => {
    const kw = 'Target long-tail blog keywords';
    state.recSet = makeRecSet([makeRec(kw, { clientStatus: 'approved' })]);
    renderComponent({ opportunities: [kw], workspaceId: 'ws1', enableSend: true });
    expect(screen.getByText('Client approved')).toBeInTheDocument();
  });

  it('shows "Client declined" when clientStatus is "declined"', () => {
    const kw = 'Target long-tail blog keywords';
    state.recSet = makeRecSet([makeRec(kw, { clientStatus: 'declined' })]);
    renderComponent({ opportunities: [kw], workspaceId: 'ws1', enableSend: true });
    expect(screen.getByText('Client declined')).toBeInTheDocument();
  });

  it('shows "Discussing" when clientStatus is "discussing"', () => {
    const kw = 'Target long-tail blog keywords';
    state.recSet = makeRecSet([makeRec(kw, { clientStatus: 'discussing' })]);
    renderComponent({ opportunities: [kw], workspaceId: 'ws1', enableSend: true });
    expect(screen.getByText('Discussing')).toBeInTheDocument();
  });

  it('shows "Sent" pill and no confirm affordance when clientStatus is already "sent"', () => {
    const kw = 'Target long-tail blog keywords';
    state.recSet = makeRecSet([makeRec(kw, { clientStatus: 'sent' })]);
    renderComponent({ opportunities: [kw], workspaceId: 'ws1', enableSend: true });
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /interested in this one/i })).not.toBeInTheDocument();
  });

  it('calls onAddToStrategySet with the keyword after a successful send (FIX 2)', async () => {
    const kw = 'Target long-tail blog keywords';
    const targetKeyword = 'target long-tail blog keywords';
    state.recSet = makeRecSet([makeRec(kw, { id: 'rec-gap-1', targetKeyword })]);
    const onAddToStrategySet = vi.fn();
    renderComponent({ opportunities: [kw], workspaceId: 'ws1', enableSend: true, onAddToStrategySet });
    fireEvent.click(screen.getByRole('button', { name: /interested in this one/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, send it/i }));
    await waitFor(() => expect(sendMock).toHaveBeenCalledWith('ws1', 'rec-gap-1'));
    await waitFor(() => expect(onAddToStrategySet).toHaveBeenCalledWith(targetKeyword));
  });
});
