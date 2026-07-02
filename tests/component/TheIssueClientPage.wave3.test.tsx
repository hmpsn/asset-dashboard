// Wave 3 (The Issue) — TheIssueClientPage acceptance tests.
//
// Covers:
//   T3.1 plan-above-proof: Content Plan slot sits DIRECTLY under the verdict — DOM order is
//         verdict → content-plan → outcome-count → money (spine-ON path only).
//   T3.2 roi-double-mount: <ROIDashboard> mounts ONCE (slot-money only); the second mount
//         previously in "Under the hood" is removed. "Under the hood" uses <Disclosure>.
//   T3.3 pending-surfaces: The "Your turn" action strip carries a jump link to the loop footer;
//         the loop footer carries `id="issue-loop-footer"` so the href="#issue-loop-footer"
//         resolves. Tests verify both ends of the two-halves contract.
//
// Flag discipline: all spine-ON assertions use `theIssueClientSpine: true` prop override.
// Flag-OFF assertions MUST stay green and are not weakened here.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations';
import type { ClientKeywordStrategy } from '../../src/components/client/types';
import type { IssueOutcomeCount } from '../../shared/types/the-issue';

// ── Hook mocks (same surface as existing TheIssueClientPage.test.tsx) ─────────
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

// Spine flag — default OFF (the existing flag-OFF path is the byte-identical guard).
// All spine-ON tests drive the flag via the `theIssueClientSpine` prop override.
const mockUseFeatureFlag = vi.fn().mockReturnValue(false);
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => mockUseFeatureFlag(),
}));

// ── Stub network-heavy children ──────────────────────────────────────────────
// ROIDashboard is stubbed with a unique testid so we can count mounts (T3.2).
vi.mock('../../src/components/client/ROIDashboard', () => ({
  ROIDashboard: () => <div data-testid="roi-dashboard-mount" />,
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
vi.mock('../../src/components/client/the-issue/IssueVerdictHeadline', () => ({
  IssueVerdictHeadline: () => <div data-testid="stub-verdict-headline" />,
}));
vi.mock('../../src/components/client/the-issue/IssueNextBetsSection', () => ({
  IssueNextBetsSection: () => <div data-testid="stub-next-bets" />,
}));
vi.mock('../../src/components/client/the-issue/IssueExportBar', () => ({
  IssueExportBar: () => <div data-testid="stub-export-bar" />,
}));
vi.mock('../../src/components/client/the-issue/IssueYourLeadsSection', () => ({
  IssueYourLeadsSection: () => <div data-testid="stub-your-leads" />,
}));
vi.mock('../../src/components/client/the-issue/NarratedStatusHeadline', () => ({
  NarratedStatusHeadline: () => <div data-testid="stub-narrated-status" />,
}));

import { TheIssueClientPage } from '../../src/components/client/the-issue/TheIssueClientPage';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const baseRec = (overrides: Partial<Recommendation> = {}): Recommendation => ({
  id: 'rec-1',
  workspaceId: 'ws-1',
  priority: 'fix_now',
  type: 'content',
  title: 'Publish a guide on engineering KPIs',
  description: 'desc',
  insight: 'High-demand topic.',
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
      visibilityScore: 72, visibilityScoreDelta: 4,
      clicks: 1200, clicksDelta: 100,
      impressions: 40000, impressionsDelta: 2000,
      rankedKeywords: 85, rankedKeywordsDelta: 5,
      avgPosition: 14.2, avgPositionDelta: -1.1,
    },
  },
  ...overrides,
});

const outcomeCount: IssueOutcomeCount = {
  units: [{ label: 'calls', current: 5, baseline: null, priorPeriod: null }],
  provenance: 'estimate_ga4',
  namedRecordsAvailable: false,
};

function renderPage(props: Partial<React.ComponentProps<typeof TheIssueClientPage>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TheIssueClientPage
          workspaceId="ws-1"
          effectiveTier="growth"
          betaMode={false}
          actionCounts={{ approvals: 2, briefs: 0, posts: 0, replies: 0, contentPlan: 0 }}
          overview={null}
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

// ── T3.1 — plan-above-proof ───────────────────────────────────────────────────
describe('T3.1 plan-above-proof (spine ON)', () => {
  it('Content Plan slot precedes the outcome-count slot in DOM order', () => {
    renderPage({ theIssueClientSpine: true, outcomeCount });
    const contentPlan = screen.getByTestId('slot-content-plan');
    const outcome = screen.getByTestId('slot-outcome-count');
    expect(precedes(contentPlan, outcome)).toBe(true);
  });

  it('verdict slot precedes content-plan slot in DOM order', () => {
    renderPage({ theIssueClientSpine: true, outcomeCount });
    const verdict = screen.getByTestId('slot-verdict');
    const contentPlan = screen.getByTestId('slot-content-plan');
    expect(precedes(verdict, contentPlan)).toBe(true);
  });

  it('outcome-count slot precedes slot-money in DOM order', () => {
    renderPage({ theIssueClientSpine: true, outcomeCount });
    const outcome = screen.getByTestId('slot-outcome-count');
    const money = screen.getByTestId('slot-money');
    expect(precedes(outcome, money)).toBe(true);
  });

  it('full canonical order: verdict → content-plan → outcome-count → money', () => {
    renderPage({ theIssueClientSpine: true, outcomeCount });
    const slots = ['slot-verdict', 'slot-content-plan', 'slot-outcome-count', 'slot-money'];
    const all = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="slot-"]'));
    const indexOf = (id: string) => all.findIndex((el) => el.getAttribute('data-testid') === id);
    const positions = slots.map(indexOf);
    // Every slot found.
    expect(positions.every((p) => p >= 0)).toBe(true);
    // Strictly ascending — same slot order as the canonical comment in the source.
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

// ── T3.2 — roi-double-mount fix ───────────────────────────────────────────────
describe('T3.2 roi-double-mount (spine ON)', () => {
  it('ROIDashboard mounts EXACTLY once on the spine-ON path', () => {
    renderPage({ theIssueClientSpine: true });
    // getAllByTestId throws when zero; use querySelectorAll to count.
    const mounts = document.querySelectorAll('[data-testid="roi-dashboard-mount"]');
    expect(mounts).toHaveLength(1);
  });

  it('the ROIDashboard is inside slot-money (not in Under the hood)', () => {
    renderPage({ theIssueClientSpine: true });
    const money = screen.getByTestId('slot-money');
    const roi = document.querySelector('[data-testid="roi-dashboard-mount"]')!;
    // slot-money contains the ROIDashboard.
    expect(money.contains(roi)).toBe(true);
  });

  it('"Under the hood" uses <Disclosure> (no raw <details> wrapper around it)', () => {
    renderPage({ theIssueClientSpine: true });
    // The Disclosure primitive renders a <details> element, but the outer ErrorBoundary
    // container must NOT be a raw <details> — the design-x-disclosure-pattern requires the
    // <Disclosure> component, not hand-rolled markup. We assert the summary text renders
    // (meaning Disclosure rendered) and the ROIDashboard is NOT inside the Disclosure body.
    expect(screen.getByText('Under the hood')).toBeInTheDocument();
    // ROIDashboard must not appear inside the Disclosure (no second mount there).
    const disclosureDetails = screen.getByText('Under the hood').closest('details');
    expect(disclosureDetails).not.toBeNull();
    const roiInsideDisclosure = disclosureDetails!.querySelector('[data-testid="roi-dashboard-mount"]');
    expect(roiInsideDisclosure).toBeNull();
  });

  it('slot-money is NOT inside a <details> element (money frame stays un-collapsed)', () => {
    renderPage({ theIssueClientSpine: true });
    const money = screen.getByTestId('slot-money');
    expect(money.closest('details')).toBeNull();
  });
});

// ── T3.3 — pending-surfaces: strip ↔ footer relationship ─────────────────────
describe('T3.3 strip-to-footer relationship (spine ON)', () => {
  it('the loop footer container carries id="issue-loop-footer"', () => {
    renderPage({ theIssueClientSpine: true });
    const footer = document.getElementById('issue-loop-footer');
    expect(footer).not.toBeNull();
  });

  it('slot-loop-footer data-testid is present on the spine-ON path', () => {
    renderPage({ theIssueClientSpine: true });
    expect(screen.getByTestId('slot-loop-footer')).toBeInTheDocument();
  });

  it('the jump link (strip-to-footer-jump) points to #issue-loop-footer', () => {
    renderPage({
      theIssueClientSpine: true,
      // actionCounts has approvals: 2 from the renderPage default → strip renders → jump link appears.
    });
    const jumpLink = screen.getByTestId('strip-to-footer-jump');
    expect(jumpLink).toBeInTheDocument();
    expect(jumpLink.getAttribute('href')).toBe('#issue-loop-footer');
  });

  it('loop footer precedes Under the hood in DOM order (jump lands before hood)', () => {
    renderPage({ theIssueClientSpine: true });
    const footer = screen.getByTestId('slot-loop-footer');
    const hoodSummary = screen.getByText('Under the hood');
    expect(precedes(footer, hoodSummary)).toBe(true);
  });

  it('jump link is NOT rendered when there are zero pending items', () => {
    renderPage({
      theIssueClientSpine: true,
      actionCounts: { approvals: 0, briefs: 0, posts: 0, replies: 0, contentPlan: 0 },
    });
    expect(screen.queryByTestId('strip-to-footer-jump')).not.toBeInTheDocument();
  });
});

// ── Flag-OFF byte-identical guard ─────────────────────────────────────────────
describe('Wave 3 — flag OFF byte-identical guard', () => {
  it('flag-OFF renders none of the spine slot testids', () => {
    renderPage({ theIssueClientSpine: false, outcomeCount });
    expect(screen.queryByTestId('slot-verdict')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-content-plan')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-outcome-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-money')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-loop-footer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slot-under-the-hood')).not.toBeInTheDocument();
  });

  it('flag-OFF renders the legacy "See full report" <details> proof band', () => {
    renderPage({ theIssueClientSpine: false });
    const reveal = screen.getByText('See full report');
    expect(reveal).toBeInTheDocument();
    expect(reveal.closest('details')).not.toBeNull();
  });

  it('flag-OFF does NOT render the strip-to-footer jump link', () => {
    renderPage({ theIssueClientSpine: false });
    expect(screen.queryByTestId('strip-to-footer-jump')).not.toBeInTheDocument();
  });

  it('flag-OFF does NOT render the Disclosure "Under the hood" summary', () => {
    renderPage({ theIssueClientSpine: false });
    // The "Under the hood" label belongs to the spine-ON Disclosure only.
    expect(screen.queryByText('Under the hood')).not.toBeInTheDocument();
  });
});
