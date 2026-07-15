import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StrategyTab } from '../../../src/components/client/StrategyTab';
import type { ClientKeywordStrategy } from '../../../src/components/client/types';
import type { PriorityKeywordItem } from '../../../src/components/client/strategy/strategyKeywordDisplay';

const {
  mockUseClientIntelligence,
  mockUseStrategyKeywordFeedback,
  mockRemoveFeedback,
  searchParamsRef,
} = vi.hoisted(() => ({
  mockUseClientIntelligence: vi.fn(),
  mockUseStrategyKeywordFeedback: vi.fn(),
  mockRemoveFeedback: vi.fn(),
  searchParamsRef: { current: '' },
}));

// ── React Router ──────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useSearchParams: () => [new URLSearchParams(searchParamsRef.current), vi.fn()],
    useNavigate: () => vi.fn(),
  };
});

// ── BetaContext ───────────────────────────────────────────────────────────────
vi.mock('../../../src/components/client/BetaContext', () => ({
  useBetaMode: () => false,
}));

vi.mock('../../../src/hooks/client', () => ({
  useClientIntelligence: mockUseClientIntelligence,
}));

// ── Strategy hooks ────────────────────────────────────────────────────────────
vi.mock('../../../src/components/client/strategy/useStrategyKeywordFeedback', () => ({
  useStrategyKeywordFeedback: () => mockUseStrategyKeywordFeedback(),
}));

vi.mock('../../../src/components/client/strategy/useStrategyBusinessPriorities', () => ({
  useStrategyBusinessPriorities: () => ({
    priorities: [],
    prioritiesLoaded: true,
    newPriority: '',
    setNewPriority: vi.fn(),
    newPriorityCategory: 'growth',
    setNewPriorityCategory: vi.fn(),
    savingPriorities: false,
    savePriorities: vi.fn(),
  }),
}));

vi.mock('../../../src/components/client/strategy/useStrategyTrackedKeywords', () => ({
  useStrategyTrackedKeywords: () => ({
    trackedKeywords: [],
    newTrackedKeyword: '',
    setNewTrackedKeyword: vi.fn(),
    addingKeyword: false,
    setAddingKeyword: vi.fn(),
    removingKeyword: null,
    setRemovingKeyword: vi.fn(),
    trackedKeywordsLoading: false,
    trackedKeywordsError: false,
    loadTrackedKeywords: vi.fn(),
    addTrackedKeyword: vi.fn(),
    removeTrackedKeyword: vi.fn(),
  }),
}));

// ── Strategy section sub-components ──────────────────────────────────────────
// Stub all heavy sub-sections to keep tests fast and focused on StrategyTab logic.
vi.mock('../../../src/components/client/strategy/StrategySnapshotSection', () => ({
  StrategySnapshotSection: ({ healthScore }: { healthScore: number }) => (
    <div data-testid="strategy-snapshot">healthScore:{healthScore}</div>
  ),
}));

vi.mock('../../../src/components/client/strategy/StrategyRefreshSummarySection', () => ({
  StrategyRefreshSummarySection: ({ summary }: { summary: string }) => (
    <div data-testid="refresh-summary">{summary}</div>
  ),
}));

vi.mock('../../../src/components/client/strategy/StrategyNextStepsSection', () => ({
  StrategyNextStepsSection: () => <div data-testid="next-steps" />,
}));

vi.mock('../../../src/components/client/strategy/StrategyBusinessPrioritiesSection', () => ({
  StrategyBusinessPrioritiesSection: () => <div data-testid="business-priorities" />,
}));

vi.mock('../../../src/components/client/strategy/StrategyContentOpportunitiesSection', () => ({
  StrategyContentOpportunitiesSection: () => <div data-testid="content-opportunities" />,
}));

vi.mock('../../../src/components/client/strategy/StrategyPageImprovementsSection', () => ({
  StrategyPageImprovementsSection: () => <div data-testid="page-improvements" />,
}));

vi.mock('../../../src/components/client/strategy/StrategyKeywordsSection', () => ({
  StrategyKeywordsSection: ({
    strategyKeywordRows,
    keywordIdeaRows,
    removePriorityKeyword,
  }: {
    strategyKeywordRows: PriorityKeywordItem[];
    keywordIdeaRows: PriorityKeywordItem[];
    removePriorityKeyword: (row: PriorityKeywordItem) => Promise<void>;
  }) => (
    <div data-testid="strategy-keywords">
      count:{strategyKeywordRows.length}
      {[...strategyKeywordRows, ...keywordIdeaRows].map(row => (
        <div key={row.identityKey}>
          <span>{row.label}</span>
          <button type="button" onClick={() => void removePriorityKeyword(row)}>Remove {row.label}</button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../../../src/components/client/strategy/StrategyPageKeywordMapSection', () => ({
  StrategyPageKeywordMapSection: () => <div data-testid="page-keyword-map" />,
}));

vi.mock('../../../src/components/client/strategy/StrategyDeclinedKeywordsSection', () => ({
  StrategyDeclinedKeywordsSection: () => <div data-testid="declined-keywords" />,
}));

// A4: requested-keyword trend card owns its own React Query hook — stub like the
// other sections (covered by StrategyRequestedKeywordTrendSection.test.tsx).
vi.mock('../../../src/components/client/strategy/StrategyRequestedKeywordTrendSection', () => ({
  StrategyRequestedKeywordTrendSection: () => <div data-testid="requested-keyword-trend" />,
}));

vi.mock('../../../src/components/client/strategy/StrategyDeclineKeywordModal', () => ({
  StrategyDeclineKeywordModal: () => <div data-testid="decline-modal" />,
}));

vi.mock('../../../src/components/client/strategy/StrategyKeywordDrawer', () => ({
  StrategyKeywordDrawer: () => <div data-testid="keyword-drawer" />,
}));

// v2 command-center additions (flag-ON only) — stubbed for the layout tests.
vi.mock('../../../src/components/client/CompetitorGapsSection', () => ({
  CompetitorGapsSection: () => <div data-testid="competitor-gaps" />,
}));

vi.mock('../../../src/components/client/strategy/StrategyClientOrientHeader', () => ({
  StrategyClientOrientHeader: ({ orient }: { orient?: { visibilityScore: number } }) => (
    <div data-testid="orient-header">{orient ? `score:${orient.visibilityScore}` : 'no-orient'}</div>
  ),
}));

// ── calculateStrategyHealth — return stable mock values ───────────────────────
vi.mock('../../../src/lib/strategy-health-score', () => ({
  calculateStrategyHealth: () => ({
    contentGapsFound: 3,
    quickWinsAvailable: 2,
    keywordGapCount: 5,
    newContentTopicCount: 3,
    pagesRanking: 4,
    totalPages: 10,
    pagesWithGrowthOpps: 2,
    contentScore: 70,
    quickWinScore: 60,
    coverageScore: 50,
    healthScore: 65,
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeStrategy(overrides: Partial<ClientKeywordStrategy> = {}): ClientKeywordStrategy {
  return {
    siteKeywords: ['seo services', 'digital marketing'],
    pageMap: [
      {
        pagePath: '/services',
        primaryKeyword: 'seo services',
        secondaryKeywords: ['local seo'],
        currentPosition: 8,
        volume: 500,
        difficulty: 40,
      },
    ],
    opportunities: ['Improve page title tags'],
    contentGaps: [
      {
        topic: 'Content Marketing Guide',
        targetKeyword: 'content marketing guide',
        intent: 'informational',
        priority: 'high',
        rationale: 'High demand with low competition',
      },
    ],
    quickWins: [
      { pagePath: '/services', action: 'Update title tag', estimatedImpact: 'Medium', rationale: 'Missing primary keyword' },
    ],
    keywordGaps: [],
    generatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

const defaultProps = {
  requestedTopics: new Set<string>(),
  effectiveTier: 'growth' as const,
  briefPrice: 199,
  fullPostPrice: 499,
  fmtPrice: (n: number) => `$${n}`,
  setPricingModal: vi.fn(),
  workspaceId: 'ws-strategy-test',
  setToast: vi.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('StrategyTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsRef.current = '';
    mockUseClientIntelligence.mockReturnValue({ data: undefined });
    mockUseStrategyKeywordFeedback.mockReturnValue({
      keywordFeedback: new Map(),
      feedbackLoadError: false,
      loadFeedback: vi.fn(),
      submitFeedback: vi.fn(),
      removeFeedback: mockRemoveFeedback,
      undoFeedback: mockRemoveFeedback,
      getFeedbackStatus: vi.fn(() => undefined),
      isLoadingFeedback: vi.fn(() => false),
      requestedKeywords: [],
      declinedKeywords: [],
    });
  });

  it('keeps C/C#/C++ distinct and removes the raw C# feedback identity only', async () => {
    mockUseStrategyKeywordFeedback.mockReturnValue({
      keywordFeedback: new Map([
        ['c', 'requested'],
        ['c sharp', 'requested'],
        ['c plus plus', 'requested'],
        ['東京', 'requested'],
      ]),
      feedbackLoadError: false,
      loadFeedback: vi.fn(),
      submitFeedback: vi.fn(),
      removeFeedback: mockRemoveFeedback,
      undoFeedback: mockRemoveFeedback,
      getFeedbackStatus: vi.fn(() => 'requested'),
      isLoadingFeedback: vi.fn(() => false),
      requestedKeywords: ['C', 'C#', 'C++', '東京'],
      declinedKeywords: [],
    });
    render(<StrategyTab {...defaultProps} strategyData={makeStrategy({ siteKeywords: [] })} />);

    fireEvent.click(screen.getByText('Rankings'));
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('C#')).toBeInTheDocument();
    expect(screen.getByText('C++')).toBeInTheDocument();
    expect(screen.getByText('東京')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove C#' }));

    await waitFor(() => expect(mockRemoveFeedback).toHaveBeenCalledWith(
      'C#',
      expect.objectContaining({ rethrow: true }),
    ));
    expect(mockRemoveFeedback).not.toHaveBeenCalledWith('C', expect.anything());
  });

  it('renders without crashing when strategy data is provided', () => {
    render(
      <StrategyTab
        {...defaultProps}
        strategyData={makeStrategy()}
      />,
    );
    expect(screen.getByTestId('strategy-snapshot')).toBeInTheDocument();
    expect(screen.getByTestId('next-steps')).toBeInTheDocument();
  });

  it('shows empty state when strategyData is null', () => {
    render(
      <StrategyTab
        {...defaultProps}
        strategyData={null}
      />,
    );
    expect(screen.getByText('SEO strategy is being prepared')).toBeInTheDocument();
  });

  it('passes healthScore from calculateStrategyHealth to snapshot section', () => {
    render(
      <StrategyTab
        {...defaultProps}
        strategyData={makeStrategy()}
      />,
    );
    expect(screen.getByTestId('strategy-snapshot')).toHaveTextContent('healthScore:65');
  });

  it('renders major section stubs across command-center tabs when strategy data exists', () => {
    render(
      <StrategyTab
        {...defaultProps}
        strategyData={makeStrategy()}
      />,
    );
    // Overview tab (default): business-priorities and snapshot are present.
    expect(screen.getByTestId('business-priorities')).toBeInTheDocument();
    expect(screen.getByTestId('strategy-snapshot')).toBeInTheDocument();
    // Content tab: content-opportunities and page-improvements.
    fireEvent.click(screen.getByText('Content'));
    expect(screen.getByTestId('content-opportunities')).toBeInTheDocument();
    expect(screen.getByTestId('page-improvements')).toBeInTheDocument();
    // Rankings tab: strategy-keywords, page-keyword-map, declined-keywords.
    fireEvent.click(screen.getByText('Rankings'));
    expect(screen.getByTestId('strategy-keywords')).toBeInTheDocument();
    expect(screen.getByTestId('page-keyword-map')).toBeInTheDocument();
    expect(screen.getByTestId('declined-keywords')).toBeInTheDocument();
  });

  it('renders refresh summary section when strategyUx.refreshSummary is present', () => {
    const strategyData = makeStrategy({
      strategyUx: {
        refreshSummary: 'This is a refresh summary note.',
      },
    });
    render(
      <StrategyTab
        {...defaultProps}
        strategyData={strategyData}
      />,
    );
    expect(screen.getByTestId('refresh-summary')).toHaveTextContent('This is a refresh summary note.');
  });

  it('renders keyword feedback summary from client intelligence when available', () => {
    mockUseClientIntelligence.mockReturnValue({
      data: {
        workspaceId: 'ws-strategy-test',
        assembledAt: '2026-05-20T00:00:00.000Z',
        tier: 'growth',
        insightsSummary: null,
        pipelineStatus: null,
        keywordFeedbackSummary: {
          approvedCount: 3,
          rejectedCount: 1,
          approveRate: 0.75,
          approvedSamples: ['seo services'],
          rejectedSamples: ['cheap backlinks'],
          rejectionReasons: ['Off-brand'],
        },
      },
    });

    render(
      <StrategyTab
        {...defaultProps}
        strategyData={makeStrategy()}
      />,
    );

    expect(mockUseClientIntelligence).toHaveBeenCalledWith('ws-strategy-test');
    expect(screen.getByText('Keyword Feedback')).toBeInTheDocument();
    expect(screen.getByText(/You approved/i).closest('p')).toHaveTextContent(
      'You approved 75% of keyword suggestions.',
    );
    expect(screen.getByText('seo services')).toBeInTheDocument();
  });

  it('does not render stale keyword feedback summary for a free-tier view', () => {
    mockUseClientIntelligence.mockReturnValue({
      data: {
        workspaceId: 'ws-strategy-test',
        assembledAt: '2026-05-20T00:00:00.000Z',
        tier: 'growth',
        insightsSummary: null,
        pipelineStatus: null,
        keywordFeedbackSummary: {
          approvedCount: 3,
          rejectedCount: 1,
          approveRate: 0.75,
          approvedSamples: ['seo services'],
          rejectedSamples: ['cheap backlinks'],
          rejectionReasons: ['Off-brand'],
        },
      },
    });

    render(
      <StrategyTab
        {...defaultProps}
        effectiveTier="free"
        strategyData={makeStrategy()}
      />,
    );

    expect(screen.queryByText('Keyword Feedback')).not.toBeInTheDocument();
  });

  it('does NOT render refresh summary section when strategyUx.refreshSummary is absent', () => {
    render(
      <StrategyTab
        {...defaultProps}
        strategyData={makeStrategy()}
      />,
    );
    expect(screen.queryByTestId('refresh-summary')).not.toBeInTheDocument();
  });

  it('shows unvalidated strategy warning when no page has volume data', () => {
    const strategyData = makeStrategy({
      pageMap: [
        {
          pagePath: '/no-volume',
          primaryKeyword: 'test keyword',
          // no volume field — should trigger the warning
        },
      ],
    });
    render(
      <StrategyTab
        {...defaultProps}
        strategyData={strategyData}
      />,
    );
    expect(
      screen.getByText(/Keyword volume and difficulty metrics are currently unavailable/i),
    ).toBeInTheDocument();
  });

  it('does NOT show unvalidated strategy warning when a page has volume data', () => {
    render(
      <StrategyTab
        {...defaultProps}
        strategyData={makeStrategy()}
      />,
    );
    expect(
      screen.queryByText(/Keyword volume and difficulty metrics are currently unavailable/i),
    ).not.toBeInTheDocument();
  });

  it('renders keyword strategies when siteKeywords are provided', () => {
    const strategyData = makeStrategy({
      siteKeywords: ['keyword one', 'keyword two', 'keyword three'],
    });
    render(
      <StrategyTab
        {...defaultProps}
        strategyData={strategyData}
      />,
    );
    // StrategyKeywordsSection is on the Rankings tab in the command-center layout.
    fireEvent.click(screen.getByText('Rankings'));
    // StrategyKeywordsSection receives strategyKeywordRows — confirmed non-empty
    expect(screen.getByTestId('strategy-keywords')).toBeInTheDocument();
  });

  it('renders with free tier — TierGate wraps keyword section', () => {
    render(
      <StrategyTab
        {...defaultProps}
        effectiveTier="free"
        strategyData={makeStrategy()}
      />,
    );
    // Component should still render without crashing on free tier
    expect(screen.getByTestId('strategy-snapshot')).toBeInTheDocument();
  });

  it('renders with premium tier without crashing', () => {
    render(
      <StrategyTab
        {...defaultProps}
        effectiveTier="premium"
        strategyData={makeStrategy()}
      />,
    );
    expect(screen.getByTestId('strategy-snapshot')).toBeInTheDocument();
  });

  it('does not render keyword drawer when no keyword is open', () => {
    render(
      <StrategyTab
        {...defaultProps}
        strategyData={makeStrategy()}
      />,
    );
    expect(screen.queryByTestId('keyword-drawer')).not.toBeInTheDocument();
  });

  it('does not render decline modal when no decline reason is set', () => {
    render(
      <StrategyTab
        {...defaultProps}
        strategyData={makeStrategy()}
      />,
    );
    expect(screen.queryByTestId('decline-modal')).not.toBeInTheDocument();
  });
});

describe('StrategyTab — command center (v2 cutover baseline)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsRef.current = '';
    mockUseClientIntelligence.mockReturnValue({ data: undefined });
  });

  const orient = {
    visibilityScore: 72, visibilityScoreDelta: 5,
    clicks: 1200, clicksDelta: 100, impressions: 50000, impressionsDelta: 2000,
    rankedKeywords: 80, rankedKeywordsDelta: 4, avgPosition: 12.3, avgPositionDelta: -1.1,
  };

  function renderV2() {
    return render(
      <StrategyTab
        {...defaultProps}
        strategyData={makeStrategy({ strategyUx: { explanations: [], orient } })}
      />,
    );
  }

  it('renders the Orient header + interior TabBar and defaults to the Overview tab', () => {
    renderV2();
    expect(screen.getByTestId('orient-header')).toHaveTextContent('score:72');
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Competitive')).toBeInTheDocument();
    // Overview tab content present; other tabs' content not mounted.
    expect(screen.getByTestId('strategy-snapshot')).toBeInTheDocument();
    expect(screen.getByTestId('business-priorities')).toBeInTheDocument();
    expect(screen.queryByTestId('content-opportunities')).not.toBeInTheDocument();
    expect(screen.queryByTestId('competitor-gaps')).not.toBeInTheDocument();
  });

  it('switches to the Content tab', () => {
    renderV2();
    fireEvent.click(screen.getByText('Content'));
    expect(screen.getByTestId('content-opportunities')).toBeInTheDocument();
    expect(screen.getByTestId('page-improvements')).toBeInTheDocument();
    expect(screen.queryByTestId('strategy-snapshot')).not.toBeInTheDocument();
  });

  it('switches to the Competitive tab (Premium-gated section)', () => {
    renderV2();
    fireEvent.click(screen.getByText('Competitive'));
    expect(screen.getByTestId('competitor-gaps')).toBeInTheDocument();
    expect(screen.queryByTestId('content-opportunities')).not.toBeInTheDocument();
  });

  it('bridges a legacy ?tab=content-gaps deep-link onto the Content tab', () => {
    searchParamsRef.current = 'tab=content-gaps';
    renderV2();
    // The legacy section value resolves to the v2 Content tab (not a silent fallback to Overview).
    expect(screen.getByTestId('content-opportunities')).toBeInTheDocument();
    expect(screen.queryByTestId('strategy-snapshot')).not.toBeInTheDocument();
  });

  it('renders the command-center layout unconditionally after the v2 cutover (Orient header + interior tabs)', () => {
    render(<StrategyTab {...defaultProps} strategyData={makeStrategy({ strategyUx: { explanations: [], orient } })} />);
    // Orient header + interior TabBar are now the baseline (no flag to turn them off).
    expect(screen.getByTestId('orient-header')).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Competitive')).toBeInTheDocument();
    // Defaults to Overview; the Content tab's sections are NOT mounted until selected.
    expect(screen.getByTestId('strategy-snapshot')).toBeInTheDocument();
    expect(screen.queryByTestId('content-opportunities')).not.toBeInTheDocument();
  });
});
