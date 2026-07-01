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
  useClientROI: () => ({ data: undefined }),
}));

// Spine flag — default OFF so the existing legacy-layout tests stay on the byte-identical
// flag-OFF path. The spine-ON tests pass `theIssueClientSpine` as an explicit prop override.
const mockUseFeatureFlag = vi.fn().mockReturnValue(false);
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => mockUseFeatureFlag(),
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
vi.mock('../../src/components/client/the-issue/IssueVerdictHeadline', () => ({
  IssueVerdictHeadline: () => <div data-testid="stub-verdict" />,
}));
vi.mock('../../src/components/client/the-issue/OutcomeCountBand', () => ({
  OutcomeCountBand: () => <div data-testid="stub-outcome-count" />,
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
  mockUseFeatureFlag.mockReturnValue(false);
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

  it('"Request this" opens a confirm, then fires a content REQUEST (act-on) on confirm — not generation (D1)', () => {
    mockUseClientTheIssue.mockReturnValue({ data: recSet([baseRec({ id: 'rec-99' })]), isLoading: false });
    renderPage();
    // The greenlight is "Request this" (monetizable content move); clicking it opens a ConfirmDialog —
    // act-on fires ONLY on confirm (the no-charge consequence step).
    fireEvent.click(screen.getByRole('button', { name: 'Request this' }));
    expect(mockActOn).not.toHaveBeenCalled(); // not yet — dialog is open
    const requestButtons = screen.getAllByRole('button', { name: 'Request this' });
    fireEvent.click(requestButtons[requestButtons.length - 1]); // the dialog's confirm
    expect(mockActOn).toHaveBeenCalledWith('rec-99');
  });

  it('content FLOOR (2-state, audit fix): zero curated content recs → one honest "sizing up" line, no greenlightable cards', () => {
    // The audit cut the up-to-4 "we're evaluating" filler cards: a single curated rec must never sit
    // atop a hero of non-actionable filler. With zero curated content recs the floor is one honest line.
    mockUseClientTheIssue.mockReturnValue({ data: recSet([], null), isLoading: false });
    renderPage();
    expect(screen.getByText('Your strategist is sizing up your next content opportunities.')).toBeInTheDocument();
    // No fabricated "we're evaluating" cards, and nothing greenlightable in the floor state.
    expect(screen.queryByText("We're evaluating")).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request this|Discuss this/ })).not.toBeInTheDocument();
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
    // In preview the greenlight is read-only: act-on must never fire. Clicking any greenlight button
    // (which would otherwise open the confirm) must not trigger the act-on writer.
    screen.queryAllByRole('button', { name: /Request this|Discuss this/ }).forEach((b) => fireEvent.click(b));
    expect(mockActOn).not.toHaveBeenCalled();
  });

  it('renders no time-relative (non-evergreen) language in section copy', () => {
    mockUseClientTheIssue.mockReturnValue({ data: recSet([baseRec()]), isLoading: false });
    const { container } = renderPage();
    const text = container.textContent ?? '';
    expect(hasTemporalLanguage(text)).toBe(false);
  });

  // ── Flag-OFF byte-identical guard (the #1 acceptance gate) ──────────────────
  it('flag-OFF (default): renders the legacy "See full report" <details> proof band, no spine slots', () => {
    mockUseClientTheIssue.mockReturnValue({ data: recSet([baseRec()]), isLoading: false });
    renderPage({ theIssueClientSpine: false });
    expect(screen.getByText('See full report')).toBeInTheDocument();
    expect(screen.getByText('Where your site stands')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-verdict')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-verdict')).not.toBeInTheDocument();
  });
});

describe('TheIssueClientPage — spine (flag ON)', () => {
  beforeEach(() => {
    mockUseClientTheIssue.mockReturnValue({ data: recSet([baseRec()]), isLoading: false });
  });

  it('orders verdict → content-plan → outcome-count (T3.1 plan-above-proof)', () => {
    // Wave 3 (T3.1): Content Plan sits DIRECTLY under the verdict; outcome count and money
    // follow as proof surfaces. The old order (verdict → outcome → plan) is replaced.
    const outcomeCount = { units: [{ label: 'calls', current: 5, baseline: null, priorPeriod: null }], provenance: 'estimate_ga4' as const, namedRecordsAvailable: false };
    renderPage({ theIssueClientSpine: true, outcomeCount });
    const verdict = screen.getByTestId('slot-verdict');
    const contentPlan = screen.getByTestId('slot-content-plan');
    const outcome = screen.getByTestId('slot-outcome-count');
    // DOCUMENT_POSITION_FOLLOWING (4) = the argument node comes AFTER the reference node.
    expect(verdict.compareDocumentPosition(contentPlan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(contentPlan.compareDocumentPosition(outcome) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the money frame UN-COLLAPSED (not inside a <details>)', () => {
    renderPage({ theIssueClientSpine: true });
    const money = screen.getByTestId('slot-money');
    expect(money.closest('details')).toBeNull();
  });

  it('local_smb segment (showCompetitorAuthority=false) hides the competitor snapshot', () => {
    renderPage({
      theIssueClientSpine: true,
      segmentProfile: {
        segment: 'local_smb', outcomeNounSingular: 'new patient', outcomeNounPlural: 'new patients',
        moneyFrameAltitude: 'production_vs_retainer', showCompetitorAuthority: false,
        showPortfolioRollup: false, showLocalMapAndReviews: true, exportProfile: 'sms_recap',
      },
    });
    expect(screen.queryByTestId('stub-competitors')).not.toBeInTheDocument();
  });

  it('default segment (unresolved) keeps the competitor snapshot visible', () => {
    renderPage({ theIssueClientSpine: true });
    expect(screen.getByTestId('stub-competitors')).toBeInTheDocument();
  });

  it('omits the outcome-count slot when no outcomeCount is provided', () => {
    renderPage({ theIssueClientSpine: true });
    expect(screen.queryByTestId('slot-outcome-count')).not.toBeInTheDocument();
    expect(screen.getByTestId('slot-verdict')).toBeInTheDocument();
  });
});
