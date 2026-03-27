/**
 * Component tests for InsightCards — verifies card rendering with mocked data.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InsightCards } from '../../src/components/client/InsightCards';
import type { AnalyticsInsight } from '../../shared/types/analytics';

const mockInsights: AnalyticsInsight[] = [
  {
    id: 'ins_001',
    workspaceId: 'ws_test',
    pageId: null,
    insightType: 'page_health',
    data: { score: 78, trend: 'improving', clicks: 320 },
    severity: 'positive',
    computedAt: new Date().toISOString(),
  },
  {
    id: 'ins_002',
    workspaceId: 'ws_test',
    pageId: '/blog/seo-tips',
    insightType: 'quick_win',
    data: {
      query: 'seo tips for beginners',
      currentPosition: 7,
      estimatedTrafficGain: 150,
      pageUrl: '/blog/seo-tips',
    },
    severity: 'opportunity',
    computedAt: new Date().toISOString(),
  },
  {
    id: 'ins_003',
    workspaceId: 'ws_test',
    pageId: null,
    insightType: 'conversion_attribution',
    data: { sessions: 1200, conversions: 48, conversionRate: 0.04, estimatedRevenue: null },
    severity: 'positive',
    computedAt: new Date().toISOString(),
  },
];

describe('InsightCards', () => {
  it('renders all five insight cards', () => {
    render(
      <InsightCards
        workspaceId="ws_test"
        insights={mockInsights}
        tier="growth"
        loading={false}
      />
    );

    expect(screen.getByText('Traffic Momentum')).toBeInTheDocument();
    expect(screen.getByText('Quick Wins')).toBeInTheDocument();
    expect(screen.getByText('Top Performers')).toBeInTheDocument();
    expect(screen.getByText('Schema Opportunities')).toBeInTheDocument();
    expect(screen.getByText('Content Health')).toBeInTheDocument();
  });

  it('shows loading skeletons when loading=true', () => {
    const { container } = render(
      <InsightCards
        workspaceId="ws_test"
        insights={[]}
        tier="growth"
        loading={true}
      />
    );

    // Expect skeleton elements to be present
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('displays quick win page URL for growth tier', () => {
    render(
      <InsightCards
        workspaceId="ws_test"
        insights={mockInsights}
        tier="growth"
        loading={false}
      />
    );

    expect(screen.getByText('/blog/seo-tips')).toBeInTheDocument();
  });

  it('shows upgrade nudge for quick wins on free tier', () => {
    render(
      <InsightCards
        workspaceId="ws_test"
        insights={mockInsights}
        tier="free"
        loading={false}
      />
    );

    // Multiple cards show upgrade CTAs on free tier (Quick Wins, Schema Opportunities, Content Health)
    const upgradeElements = screen.getAllByText(/upgrade/i);
    expect(upgradeElements.length).toBeGreaterThan(0);
  });

  it('shows premium messaging for premium tier', () => {
    render(
      <InsightCards
        workspaceId="ws_test"
        insights={mockInsights}
        tier="premium"
        loading={false}
      />
    );

    expect(screen.getAllByText(/strategist/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state when no quick wins exist', () => {
    const noQuickWins = mockInsights.filter(i => i.insightType !== 'quick_win');
    render(
      <InsightCards
        workspaceId="ws_test"
        insights={noQuickWins}
        tier="growth"
        loading={false}
      />
    );

    expect(screen.getByText(/no quick wins/i)).toBeInTheDocument();
  });
});
