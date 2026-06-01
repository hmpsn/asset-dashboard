/**
 * Component test for the OverviewTab #1-priority card "why this is #1" breakdown (PR6 / SI3).
 *
 * Verifies the client #1 card renders:
 *  - the relative ROI badge from opportunity.value (NOT the dollar emvPerWeek)
 *  - the component breakdown (dimension + evidence) from opportunity.components
 *  - graceful behaviour when opportunity is absent (legacy recs) — no breakdown
 *
 * Per the owner decision the client NEVER sees emvPerWeek; the public route strips it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RecommendationSet } from '../../../shared/types/recommendations';
import type { WorkspaceInfo } from '../../../src/components/client/types';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../../src/components/client/BetaContext', () => ({ useBetaMode: () => false }));
vi.mock('../../../src/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => false }));
vi.mock('../../../src/hooks/client', () => ({ useClientIntelligence: () => ({ data: undefined }) }));

// This test owns the recommendations hook mock — a single hoisted holder lets each
// test swap the returned set before rendering.
const recHolder = vi.hoisted(() => ({ set: undefined as RecommendationSet | undefined }));
vi.mock('../../../src/hooks/useRecommendations', () => ({
  useRecommendationSet: () => ({ data: recHolder.set }),
}));

vi.mock('../../../src/components/client/MonthlyDigest', () => ({ MonthlyDigest: () => <div /> }));
vi.mock('../../../src/components/client/IntelligenceSummaryCard', () => ({ IntelligenceSummaryCard: () => <div /> }));
vi.mock('../../../src/components/client/HealthScoreCard', () => ({ HealthScoreCard: () => <div /> }));
vi.mock('../../../src/components/client/PredictionShowcaseCard', () => ({ PredictionShowcaseCard: () => <div /> }));
vi.mock('../../../src/components/client/InsightsDigest', () => ({ InsightsDigest: () => <div /> }));
vi.mock('../../../src/components/client/Briefing/InsightsBriefingPage', () => ({ InsightsBriefingPage: () => <div /> }));

import { OverviewTab } from '../../../src/components/client/OverviewTab';

const baseWs: WorkspaceInfo = { id: 'ws-test', name: 'Acme Corp', tier: 'growth', siteIntelligenceClientView: true };

const baseProps = {
  ws: baseWs,
  overview: null, searchComparison: null, trend: [], ga4Overview: null, ga4Trend: [],
  ga4Comparison: null, ga4Organic: null, ga4Conversions: [], ga4NewVsReturning: [],
  audit: null, auditDetail: null, strategyData: null, insights: null,
  contentRequests: [], requests: [], approvalBatches: [], activityLog: [],
  pendingApprovals: 0, unreadTeamNotes: 0,
  eventDisplayName: (n: string) => n, isEventPinned: () => false,
  workspaceId: 'ws-test', onAskAi: vi.fn(), onOpenChat: vi.fn(),
  clientUser: null, contentPlanSummary: null,
};

function makeSet(opportunityPresent: boolean): RecommendationSet {
  const now = new Date().toISOString();
  return {
    workspaceId: 'ws-test',
    generatedAt: now,
    recommendations: [
      {
        id: 'rec-top', workspaceId: 'ws-test', priority: 'fix_now', type: 'metadata',
        title: 'Optimize the services page title', description: 'd',
        insight: 'High-demand keyword sitting just off page one.',
        impact: 'high', effort: 'low', impactScore: 82,
        source: 'audit:title', affectedPages: ['/services'],
        trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
        status: 'pending', createdAt: now, updatedAt: now,
        ...(opportunityPresent ? {
          opportunity: {
            value: 82,
            // The public route strips emvPerWeek/roiPerEffortDay — they are absent
            // on the client payload. The type still allows them; we omit here to
            // mirror the real client shape.
            confidence: 0.95, calibration: 1, groundedSpine: 'roiScore' as const,
            components: [
              { dimension: 'demand' as const, rawValue: 2400, normalized: 0.8, weight: 0.25, contribution: 0.2, evidence: '2,400 monthly searches' },
              { dimension: 'winnability' as const, rawValue: 7, normalized: 0.6, weight: 0.2, contribution: 0.12, evidence: 'ranking position 7 — close to page one' },
            ],
            calibrationVersion: 'v1', modelVersion: 'ov-1',
          } as RecommendationSet['recommendations'][number]['opportunity'],
        } : {}),
      },
    ],
    summary: {
      fixNow: 1, fixSoon: 0, fixLater: 0, ongoing: 0,
      totalImpactScore: 82, trafficAtRisk: 0,
      estimatedRecoverableClicks: 0, estimatedRecoverableImpressions: 0,
      topRecommendationId: 'rec-top',
    },
  };
}

beforeEach(() => {
  mockNavigate.mockReset();
  recHolder.set = undefined;
});

describe('OverviewTab #1 priority — opportunity breakdown (SI3)', () => {
  it('renders the relative ROI badge and component breakdown when opportunity is present', () => {
    recHolder.set = makeSet(true);
    render(<OverviewTab {...baseProps} />);

    expect(screen.getByText(/Your #1 priority/i)).toBeInTheDocument();
    // Relative ROI badge from opportunity.value
    expect(screen.getByText('ROI 82')).toBeInTheDocument();
    // Breakdown heading + component evidence
    expect(screen.getByText(/Why this is your top priority/i)).toBeInTheDocument();
    expect(screen.getByText('2,400 monthly searches')).toBeInTheDocument();
    expect(screen.getByText(/ranking position 7/i)).toBeInTheDocument();
  });

  it('never renders a raw dollar emvPerWeek figure', () => {
    recHolder.set = makeSet(true);
    const { container } = render(<OverviewTab {...baseProps} />);
    expect(container.textContent).not.toMatch(/\/week/i);
    expect(container.textContent).not.toMatch(/emvPerWeek/);
  });

  it('renders the #1 card without a breakdown when opportunity is absent (legacy rec)', () => {
    recHolder.set = makeSet(false);
    render(<OverviewTab {...baseProps} />);

    expect(screen.getByText(/Your #1 priority/i)).toBeInTheDocument();
    expect(screen.getByText('Optimize the services page title')).toBeInTheDocument();
    // No breakdown block for legacy recs
    expect(screen.queryByText(/Why this is your top priority/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^ROI /)).not.toBeInTheDocument();
  });
});
