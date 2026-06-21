// P1 (IA v2) — lead-positioning acceptance test for TheIssueClientPage.
//
// Task 4 of docs/superpowers/plans/2026-06-21-client-ia-p1-overview-reframe.md. Proves the
// check-signer gut-check: with the spine + return-hook ON, the client's OWN captured-leads section
// (IssueYourLeadsSection → data-testid="issue-your-leads") is surfaced ONE TAP from the outcome
// count when client-ia-v2 is ON:
//   • iaV2 ON  → the leads section renders in document order BEFORE the "Under the hood" <details>
//                summary (slot 2.5), and NOT inside the under-the-hood block (never double-mounted).
//   • iaV2 OFF → the leads section renders ONLY inside the "Under the hood" <details> (after the
//                summary), byte-identical to today.
//
// Flags are driven deterministically via the prop overrides (theIssueClientSpine, theIssueReturnHook,
// iaV2) — the prop wins over useFeatureFlag (Rules-of-Hooks-safe). Reuses the provider/render harness,
// hook mocks, and fixture shapes from tests/component/the-issue-spine-order.test.tsx. The leads
// section is NOT stubbed (we assert its real testid); useClientMyLeads is mocked so it stays hermetic.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { RecommendationSet, Recommendation } from '../../../shared/types/recommendations';
import type { ClientKeywordStrategy } from '../../../src/components/client/types';
import type { IssueOutcomeCount } from '../../../shared/types/the-issue';

// ── Mock the data hooks (same surface as the-issue-spine-order.test.tsx) ──────
const mockActOn = vi.fn();
const mockSubmitFeedback = vi.fn().mockResolvedValue(undefined);
const mockUseClientTheIssue = vi.fn();
const mockUseClientRecResponses = vi.fn();
const mockGetFeedbackStatus = vi.fn().mockReturnValue(undefined);

vi.mock('../../../src/components/client/the-issue/useClientTheIssue', () => ({
  useClientTheIssue: () => mockUseClientTheIssue(),
}));
vi.mock('../../../src/hooks/client/useClientRecResponses', () => ({
  useClientRecResponses: () => mockUseClientRecResponses(),
}));
vi.mock('../../../src/hooks/client/useActOnRecommendation', () => ({
  useActOnRecommendation: () => ({ actOn: mockActOn, actOnAsync: vi.fn(), isActingOn: false, pendingRecId: null }),
}));
vi.mock('../../../src/components/client/strategy/useStrategyTrackedKeywords', () => ({
  useStrategyTrackedKeywords: () => ({ trackedKeywords: [], trackedKeywordsLoading: false, trackedKeywordsError: false }),
}));
vi.mock('../../../src/components/client/strategy/useStrategyKeywordFeedback', () => ({
  useStrategyKeywordFeedback: () => ({ getFeedbackStatus: mockGetFeedbackStatus, submitFeedback: mockSubmitFeedback }),
}));
// The hooks/client barrel: TheIssueClientPage reads useClientContentRequests + useClientROI;
// IssueYourLeadsSection reads useClientMyLeads. Mock all three so the page + leads section render
// hermetically (no network). useClientMyLeads returns the {leads,isLoading} shape it really exposes.
vi.mock('../../../src/hooks/client', () => ({
  useClientContentRequests: () => ({ data: [] }),
  useClientROI: () => ({ data: undefined }),
  useClientMyLeads: () => ({ leads: [], isLoading: false }),
}));

// Flags — default OFF. Spine + return-hook + iaV2 are all driven via explicit prop overrides
// (the prop wins over the hook, so the hook value is moot here).
const mockUseFeatureFlag = vi.fn().mockReturnValue(false);
vi.mock('../../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => mockUseFeatureFlag(),
}));

// ── Stub the network-heavy reused children to keep the test hermetic ─────────
// IssueYourLeadsSection is deliberately NOT stubbed — we assert its real data-testid="issue-your-leads".
vi.mock('../../../src/components/client/ROIDashboard', () => ({
  ROIDashboard: () => <div data-testid="roi-content" />,
}));
vi.mock('../../../src/components/client/CompetitorGapsSection', () => ({
  CompetitorGapsSection: () => <div data-testid="stub-competitors" />,
}));
vi.mock('../../../src/components/client/Briefing/WinsSurface', () => ({
  WinsSurface: () => <div data-testid="stub-wins" />,
}));
vi.mock('../../../src/components/client/OutcomeSummary', () => ({
  default: () => <div data-testid="stub-outcomes" />,
}));
vi.mock('../../../src/components/client/strategy/StrategyRequestedKeywordTrendSection', () => ({
  StrategyRequestedKeywordTrendSection: () => <div data-testid="stub-kw-trend" />,
}));
vi.mock('../../../src/components/client/Briefing/ActionQueueStrip', () => ({
  ActionQueueStrip: () => <div data-testid="stub-action-queue" />,
}));
vi.mock('../../../src/components/client/the-issue/IssueVerdictHeadline', () => ({
  IssueVerdictHeadline: () => <section data-testid="issue-verdict-headline">verdict</section>,
}));
vi.mock('../../../src/components/client/the-issue/OutcomeCountBand', () => ({
  OutcomeCountBand: () => <div data-testid="outcome-count-band" />,
}));
// IssueExportBar is mounted whenever the return-hook is ON; stub it so the export-bar's own data
// hooks don't run (it's irrelevant to lead positioning).
vi.mock('../../../src/components/client/the-issue/IssueExportBar', () => ({
  IssueExportBar: () => <div data-testid="stub-export-bar" />,
}));

import { TheIssueClientPage } from '../../../src/components/client/the-issue/TheIssueClientPage';

// ── Fixtures (identical shape to the-issue-spine-order.test.tsx) ──────────────

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

describe('TheIssueClientPage — IA v2 surfaces captured leads one tap from the count', () => {
  it('iaV2 ON: leads section renders BEFORE the "Under the hood" summary (slot 2.5)', () => {
    renderPage({ theIssueClientSpine: true, theIssueReturnHook: true, iaV2: true, outcomeCount });

    const leads = screen.getByTestId('issue-your-leads');
    const underHoodSummary = screen.getByText('Under the hood');

    expect(leads).toBeInTheDocument();
    // Surfaced ABOVE the fold: the leads section precedes the under-the-hood reveal summary.
    expect(precedes(leads, underHoodSummary)).toBe(true);
  });

  it('iaV2 ON: leads section is NOT inside the "Under the hood" <details> (never double-mounted)', () => {
    renderPage({ theIssueClientSpine: true, theIssueReturnHook: true, iaV2: true, outcomeCount });

    // Exactly one mount, and it is not nested inside a <details> (slot 2.5 is un-collapsed).
    const all = screen.getAllByTestId('issue-your-leads');
    expect(all).toHaveLength(1);
    expect(all[0].closest('details')).toBeNull();
  });

  it('iaV2 ON: leads section sits directly after the outcome count (one tap from the number)', () => {
    renderPage({ theIssueClientSpine: true, theIssueReturnHook: true, iaV2: true, outcomeCount });

    const count = screen.getByTestId('slot-outcome-count');
    const leads = screen.getByTestId('issue-your-leads');
    const money = screen.getByTestId('slot-money');
    // count → leads → money: the receipts land between the count and the money frame.
    expect(precedes(count, leads)).toBe(true);
    expect(precedes(leads, money)).toBe(true);
  });

  it('iaV2 OFF: leads section renders ONLY inside "Under the hood" (after the summary), byte-identical', () => {
    renderPage({ theIssueClientSpine: true, theIssueReturnHook: true, iaV2: false, outcomeCount });

    const all = screen.getAllByTestId('issue-your-leads');
    // Exactly one mount, nested inside the under-the-hood <details> reveal.
    expect(all).toHaveLength(1);
    const leads = all[0];
    expect(leads.closest('details')).not.toBeNull();

    // It appears AFTER the "Under the hood" summary (it's the collapsed-block content).
    const underHoodSummary = screen.getByText('Under the hood');
    expect(precedes(underHoodSummary, leads)).toBe(true);
  });

  it('iaV2 OFF: the leads section never appears above the fold (before the under-the-hood summary)', () => {
    renderPage({ theIssueClientSpine: true, theIssueReturnHook: true, iaV2: false, outcomeCount });

    const underHoodSummary = screen.getByText('Under the hood');
    const leads = screen.getByTestId('issue-your-leads');
    // The OFF path keeps leads buried: it must NOT precede the under-the-hood reveal.
    expect(precedes(leads, underHoodSummary)).toBe(false);
  });
});
