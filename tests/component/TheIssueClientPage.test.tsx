// Component tests for the strategy-the-issue evergreen V2 client money surface.
//
// Covers (lane B acceptance):
//   - renders the ordered sections (status, content plan, also-on-plan, loop footer)
//   - "Act on this" fires a content REQUEST (act-on mutation), NOT generation
//   - content FLOOR: < 2 curated content recs falls back to un-curated gaps "we're evaluating"
//   - relevance feedback (Relevant / Not-relevant) fires the keyword-feedback writer
//   - a real loading → loaded transition (Rules of Hooks — flag/hooks read before early return)
//   - evergreen copy: no time-relative phrases in the rendered surface

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { RecommendationSet, Recommendation } from '../../shared/types/recommendations';
import type { ClientKeywordStrategy } from '../../src/components/client/types';
import { hasTemporalLanguage } from '../../src/components/client/the-issue/evergreenCopy';

// ── Mock the data hooks ──────────────────────────────────────────────────────
const mockActOn = vi.fn();
const mockSubmitFeedback = vi.fn().mockResolvedValue(undefined);
const mockUseClientTheIssue = vi.fn();
const mockUseClientRecResponses = vi.fn();
const mockGetFeedbackStatus = vi.fn().mockReturnValue(undefined);

vi.mock('../../src/components/client/the-issue/useClientTheIssue', () => ({
  useClientTheIssue: () => mockUseClientTheIssue(),
}));
vi.mock('../../src/hooks/client/useClientRecResponses', () => ({
  useClientRecResponses: () => mockUseClientRecResponses(),
}));
vi.mock('../../src/hooks/client/useActOnRecommendation', () => ({
  useActOnRecommendation: () => ({ actOn: mockActOn, actOnAsync: vi.fn(), isActingOn: false, pendingRecId: null }),
}));
vi.mock('../../src/components/client/strategy/useStrategyTrackedKeywords', () => ({
  useStrategyTrackedKeywords: () => ({ trackedKeywords: [], trackedKeywordsLoading: false, trackedKeywordsError: false }),
}));
vi.mock('../../src/components/client/strategy/useStrategyKeywordFeedback', () => ({
  useStrategyKeywordFeedback: () => ({ getFeedbackStatus: mockGetFeedbackStatus, submitFeedback: mockSubmitFeedback }),
}));
vi.mock('../../src/hooks/client', () => ({
  useClientContentRequests: () => ({ data: [] }),
}));

// ── Stub the network-heavy reused children to keep the test hermetic ─────────
vi.mock('../../src/components/client/ROIDashboard', () => ({
  ROIDashboard: () => <div data-testid="stub-roi" />,
}));
vi.mock('../../src/components/client/CompetitorGapsSection', () => ({
  CompetitorGapsSection: () => <div data-testid="stub-competitors" />,
}));
vi.mock('../../src/components/client/Briefing/WinsSurface', () => ({
  WinsSurface: () => <div data-testid="stub-wins" />,
}));
vi.mock('../../src/components/client/OutcomeSummary', () => ({
  default: () => <div data-testid="stub-outcomes" />,
}));
vi.mock('../../src/components/client/strategy/StrategyRequestedKeywordTrendSection', () => ({
  StrategyRequestedKeywordTrendSection: () => <div data-testid="stub-kw-trend" />,
}));
vi.mock('../../src/components/client/Briefing/ActionQueueStrip', () => ({
  ActionQueueStrip: () => <div data-testid="stub-action-queue" />,
}));

import { TheIssueClientPage } from '../../src/components/client/the-issue/TheIssueClientPage';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseRec = (overrides: Partial<Recommendation> = {}): Recommendation => ({
  id: 'rec-1',
  workspaceId: 'ws-1',
  priority: 'fix_now',
  type: 'content',
  title: 'Publish a guide on engineering KPIs',
  description: 'desc',
  insight: 'High-demand topic your competitors own.',
  impact: 'high',
  effort: 'medium',
  impactScore: 80,
  source: 'content-gap',
  affectedPages: [],
  trafficAtRisk: 0,
  impressionsAtRisk: 0,
  estimatedGain: 'Capture ~900 searches/mo',
  actionType: 'content_creation',
  status: 'pending',
  targetKeyword: 'engineering kpis',
  clientStatus: 'sent',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const recSet = (recs: Recommendation[], topId: string | null = recs[0]?.id ?? null): RecommendationSet => ({
  workspaceId: 'ws-1',
  generatedAt: '2026-01-01T00:00:00Z',
  recommendations: recs,
  summary: {
    fixNow: recs.length, fixSoon: 0, fixLater: 0, ongoing: 0,
    totalImpactScore: 0, trafficAtRisk: 0, topRecommendationId: topId,
  },
});

const strategy = (overrides: Partial<ClientKeywordStrategy> = {}): ClientKeywordStrategy => ({
  siteKeywords: [],
  pageMap: [],
  opportunities: [],
  generatedAt: '2026-01-01T00:00:00Z',
  strategyUx: {
    explanations: [],
    orient: {
      visibilityScore: 72,
      visibilityScoreDelta: 4,
      clicks: 1200, clicksDelta: 100,
      impressions: 40000, impressionsDelta: 2000,
      rankedKeywords: 85, rankedKeywordsDelta: 5,
      avgPosition: 14.2, avgPositionDelta: -1.1,
    },
  },
  ...overrides,
});

function renderPage(props: Partial<React.ComponentProps<typeof TheIssueClientPage>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TheIssueClientPage
          workspaceId="ws-1"
          effectiveTier="growth"
          betaMode={false}
          actionCounts={{ approvals: 0, briefs: 0, posts: 0, replies: 0, contentPlan: 0 }}
          overview={{ totalClicks: 1200, totalImpressions: 40000, avgCtr: 3, avgPosition: 14, topQueries: [], topPages: [], dateRange: { start: '', end: '' } } as React.ComponentProps<typeof TheIssueClientPage>['overview']}
          ga4Overview={null}
          ga4Conversions={[]}
          audit={null}
          strategyData={strategy()}
          onAskAi={vi.fn()}
          onOpenChat={vi.fn()}
          setToast={vi.fn()}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFeedbackStatus.mockReturnValue(undefined);
  mockUseClientRecResponses.mockReturnValue({ data: { approved: 2, discussing: 1, declined: 0, pending: 3 } });
});

describe('TheIssueClientPage', () => {
  it('renders the ordered sections when loaded', () => {
    mockUseClientTheIssue.mockReturnValue({ data: recSet([baseRec()]), isLoading: false });
    renderPage();
    expect(screen.getByTestId('the-issue-client-page')).toBeInTheDocument();
    expect(screen.getByText('Where your site stands')).toBeInTheDocument();
    expect(screen.getByText('Your content plan')).toBeInTheDocument();
    expect(screen.getByText('What your SEO is worth')).toBeInTheDocument();
    expect(screen.getByTestId('stub-roi')).toBeInTheDocument();
    expect(screen.getByTestId('stub-competitors')).toBeInTheDocument();
  });

  it('shows a real loading state, then the loaded surface (Rules of Hooks transition)', () => {
    mockUseClientTheIssue.mockReturnValue({ data: undefined, isLoading: true });
    const { rerender } = renderPage();
    expect(screen.getByTestId('the-issue-loading')).toBeInTheDocument();

    // Flip to loaded — the same hooks must already have run (no hook-count change).
    mockUseClientTheIssue.mockReturnValue({ data: recSet([baseRec()]), isLoading: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TheIssueClientPage
            workspaceId="ws-1"
            effectiveTier="growth"
            betaMode={false}
            actionCounts={{ approvals: 0, briefs: 0, posts: 0, replies: 0, contentPlan: 0 }}
            overview={null}
            ga4Overview={null}
            ga4Conversions={[]}
            audit={null}
            strategyData={strategy()}
            onAskAi={vi.fn()}
            onOpenChat={vi.fn()}
            setToast={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('the-issue-loading')).not.toBeInTheDocument();
    expect(screen.getByTestId('the-issue-client-page')).toBeInTheDocument();
  });

  it('"Act on this" fires a content REQUEST (act-on), not generation', () => {
    mockUseClientTheIssue.mockReturnValue({ data: recSet([baseRec({ id: 'rec-99' })]), isLoading: false });
    renderPage();
    const actBtn = screen.getByRole('button', { name: 'Act on this' });
    fireEvent.click(actBtn);
    expect(mockActOn).toHaveBeenCalledWith('rec-99');
  });

  it('content FLOOR: < 2 curated content recs → un-curated gaps framed "we\'re evaluating"', () => {
    // Zero curated content recs → floor uses strategyData.contentGaps.
    mockUseClientTheIssue.mockReturnValue({ data: recSet([], null), isLoading: false });
    renderPage({
      strategyData: strategy({
        contentGaps: [
          { topic: 'Choosing a CRM', targetKeyword: 'best crm for agencies', intent: 'commercial', priority: 'high', rationale: 'gap' },
        ],
      }),
    });
    // Topic renders in both the card headline and the ContentGapRow body — at least one.
    expect(screen.getAllByText('Choosing a CRM').length).toBeGreaterThan(0);
    expect(screen.getByText("We're evaluating")).toBeInTheDocument();
    // Floor cards are NOT greenlightable — no "Act on this" button.
    expect(screen.queryByRole('button', { name: 'Act on this' })).not.toBeInTheDocument();
  });

  it('relevance feedback fires the keyword-feedback writer', () => {
    mockUseClientTheIssue.mockReturnValue({ data: recSet([baseRec({ targetKeyword: 'engineering kpis' })]), isLoading: false });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Not relevant/ }));
    expect(mockSubmitFeedback).toHaveBeenCalledWith('engineering kpis', 'declined', 'the-issue-content');
  });

  it('preview mode suppresses act-on (read-only)', () => {
    mockUseClientTheIssue.mockReturnValue({ data: recSet([baseRec({ id: 'rec-pv' })]), isLoading: false });
    renderPage({ previewMode: true });
    const actBtn = screen.getByRole('button', { name: 'Act on this' });
    fireEvent.click(actBtn);
    expect(mockActOn).not.toHaveBeenCalled();
  });

  it('renders no time-relative (non-evergreen) language in section copy', () => {
    mockUseClientTheIssue.mockReturnValue({ data: recSet([baseRec()]), isLoading: false });
    const { container } = renderPage();
    const text = container.textContent ?? '';
    expect(hasTemporalLanguage(text)).toBe(false);
  });
});
