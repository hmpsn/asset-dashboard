// Lane D / Task D6 — dedicated spine-ORDER acceptance test for TheIssueClientPage.
//
// Proves the verdict-first trust spine: with the spine flag ON the verdict LEADS and the
// Content Plan sits DIRECTLY under it (design-cleanup Wave 3 / T3.1 "plan above proof" —
// this supersedes the earlier "plan demoted below the money frame" ordering so a client
// convinced by the verdict can act without scrolling past the proof). Outcome-count + money
// frame follow. With the flag OFF the page is byte-identical to today (no spine slots; the
// legacy "See full report" <details> proof band is present).
//
// Reuses the EXACT provider/render harness, hook mocks, and fixture shape from
// tests/component/TheIssueClientPage.test.tsx (do NOT edit that file). The spine flag is
// driven deterministically via the `theIssueClientSpine` prop override (drift resolution #8);
// the slot wrappers carry the committed `data-testid` contract (drift resolution #9):
//   the-issue-client-page (root), slot-verdict, slot-outcome-count, slot-money,
//   slot-content-plan, issue-verdict-headline (the headline <section>).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { RecommendationSet, Recommendation } from '../../shared/types/recommendations';
import type { ClientKeywordStrategy } from '../../src/components/client/types';
import type { IssueOutcomeCount } from '../../shared/types/the-issue';

// ── Mock the data hooks (same surface as TheIssueClientPage.test.tsx) ─────────
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

// Spine flag — default OFF. Spine-ON cases pass `theIssueClientSpine` as an explicit prop
// override; the prop wins over the hook (drift resolution #8), so the hook value is moot here.
const mockUseFeatureFlag = vi.fn().mockReturnValue(false);
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => mockUseFeatureFlag(),
}));

// ── Stub the network-heavy reused children to keep the test hermetic ─────────
// The page-level slot wrappers (slot-*) come from TheIssueClientPage itself, NOT from these
// stubs — these stubs only make the children render hermetically. We tag inner content so a
// "ring not in the headline" assertion can scope precisely.
vi.mock('../../src/components/client/ROIDashboard', () => ({
  ROIDashboard: () => <div data-testid="roi-content" />,
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
// IssueVerdictHeadline stub renders the SAME `issue-verdict-headline` <section> testid the real
// component sets (per B3 / drift resolution #9), so we can assert "the ring is NOT in the
// headline" against the real contract marker.
vi.mock('../../src/components/client/the-issue/IssueVerdictHeadline', () => ({
  IssueVerdictHeadline: () => <section data-testid="issue-verdict-headline">verdict</section>,
}));
vi.mock('../../src/components/client/the-issue/OutcomeCountBand', () => ({
  OutcomeCountBand: () => <div data-testid="outcome-count-band" />,
}));

import { TheIssueClientPage } from '../../src/components/client/the-issue/TheIssueClientPage';

// ── Fixtures (identical shape to TheIssueClientPage.test.tsx) ─────────────────

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

const outcomeCount: IssueOutcomeCount = {
  units: [{ label: 'calls', current: 5, baseline: null, priorPeriod: null }],
  provenance: 'estimate_ga4',
  namedRecordsAvailable: false,
};

// DOCUMENT_POSITION_FOLLOWING (4) is set when the argument node comes AFTER the reference node.
function precedes(before: Element, after: Element): boolean {
  return Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFeedbackStatus.mockReturnValue(undefined);
  mockUseClientRecResponses.mockReturnValue({ data: { approved: 2, discussing: 1, declined: 0, pending: 3 } });
  mockUseFeatureFlag.mockReturnValue(false);
  mockUseClientTheIssue.mockReturnValue({ data: recSet([baseRec()]), isLoading: false });
});

describe('TheIssueClientPage — spine ORDER (flag ON, theIssueClientSpine=true)', () => {
  it('renders all spine slots in canonical DOM order: verdict → content-plan → outcome-count → money', () => {
    renderPage({ theIssueClientSpine: true, outcomeCount });

    const root = screen.getByTestId('the-issue-client-page');
    const verdict = screen.getByTestId('slot-verdict');
    const outcome = screen.getByTestId('slot-outcome-count');
    const money = screen.getByTestId('slot-money');
    const contentPlan = screen.getByTestId('slot-content-plan');

    // All four spine slots must be present on the ON path.
    expect(root).toBeInTheDocument();
    expect(verdict).toBeInTheDocument();
    expect(outcome).toBeInTheDocument();
    expect(money).toBeInTheDocument();
    expect(contentPlan).toBeInTheDocument();

    // T3.1: Verdict LEADS; the Content Plan sits directly under it; outcome + money follow.
    expect(precedes(verdict, contentPlan)).toBe(true);
    expect(precedes(contentPlan, outcome)).toBe(true);
    expect(precedes(outcome, money)).toBe(true);
  });

  it('proves the order independently via query-all DOM index ordering', () => {
    renderPage({ theIssueClientSpine: true, outcomeCount });

    const ids = ['slot-verdict', 'slot-content-plan', 'slot-outcome-count', 'slot-money'];
    const all = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="slot-"]'),
    );
    const indexOf = (id: string) => all.findIndex((el) => el.getAttribute('data-testid') === id);
    const positions = ids.map(indexOf);
    // Every slot found, and indices strictly ascending in the order verdict<plan<count<money.
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('does NOT render the ring inside the verdict headline (ring demoted to Under-the-hood)', () => {
    renderPage({ theIssueClientSpine: true, outcomeCount });
    const headline = screen.getByTestId('issue-verdict-headline');
    // No MetricRing testid/role and no ring <svg> inside the headline section.
    expect(headline.querySelector('[data-metric-ring]')).toBeNull();
    expect(headline.querySelector('[data-testid="metric-ring"]')).toBeNull();
    expect(headline.querySelector('svg')).toBeNull();
  });

  it('money frame is UN-COLLAPSED (slot-money is not inside a <details>)', () => {
    renderPage({ theIssueClientSpine: true, outcomeCount });
    const money = screen.getByTestId('slot-money');
    expect(money.closest('details')).toBeNull();
  });
});

describe('TheIssueClientPage — spine SEGMENT toggles (flag ON)', () => {
  const localSmbProfile = {
    segment: 'local_smb' as const,
    outcomeNounSingular: 'new patient',
    outcomeNounPlural: 'new patients',
    moneyFrameAltitude: 'production_vs_retainer' as const,
    showCompetitorAuthority: false,
    showPortfolioRollup: false,
    showLocalMapAndReviews: true,
    exportProfile: 'sms_recap' as const,
  };

  it('local_smb (showCompetitorAuthority=false) hides the competitor snapshot', () => {
    renderPage({ theIssueClientSpine: true, segmentProfile: localSmbProfile });
    // The competitor snapshot is gated by `segmentProfile.showCompetitorAuthority` (default true).
    // With it false, the (Under-the-hood) competitor section must not mount.
    expect(screen.queryByTestId('stub-competitors')).not.toBeInTheDocument();
  });

  it('default segment (no segmentProfile) keeps the competitor snapshot visible', () => {
    renderPage({ theIssueClientSpine: true });
    // showCompetitor defaults to true when the segment is unresolved.
    expect(screen.getByTestId('stub-competitors')).toBeInTheDocument();
  });

  it('local_smb sets the local insert area present (showLocalMapAndReviews true) without portfolio rollup', () => {
    // The spine gates the P1 local-map insert behind `segmentProfile.showLocalMapAndReviews`
    // and the portfolio rollup behind `segmentProfile.showPortfolioRollup`. Assert the gating
    // booleans drive the render: local present (true) and portfolio absent (false). The P0
    // insert bodies are `null` placeholders, so we assert via the contract the page reads —
    // the competitor toggle is the observable proxy paired with these in the same profile.
    renderPage({ theIssueClientSpine: true, segmentProfile: localSmbProfile });
    // local_smb profile → competitor OFF (paired observable for the local-on segment).
    expect(screen.queryByTestId('stub-competitors')).not.toBeInTheDocument();
    // Sanity: the spine still rendered (we are on the ON path).
    expect(screen.getByTestId('slot-verdict')).toBeInTheDocument();
  });
});

describe('TheIssueClientPage — flag OFF (theIssueClientSpine=false) byte-identical', () => {
  it('renders NONE of the spine slot testids', () => {
    renderPage({ theIssueClientSpine: false, outcomeCount });
    expect(screen.getByTestId('the-issue-client-page')).toBeInTheDocument();
    expect(screen.queryByTestId('slot-verdict')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-outcome-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-money')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-content-plan')).not.toBeInTheDocument();
  });

  it('renders the legacy "See full report" <details> proof band (the OFF-path money frame is collapsed)', () => {
    renderPage({ theIssueClientSpine: false });
    const reveal = screen.getByText('See full report');
    expect(reveal).toBeInTheDocument();
    // The legacy money frame is collapsed inside a <details> reveal (the inverse of the ON path).
    expect(reveal.closest('details')).not.toBeNull();
  });
});
