/**
 * Component tests for Phase 4B — Schema Opportunities and Content Health insight cards.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SchemaOpportunitiesCard, ContentHealthCard } from '../../src/components/client/InsightCards';
import type { AnalyticsInsight } from '../../shared/types/analytics';

const mockInsights: AnalyticsInsight[] = [
  {
    id: '1',
    workspaceId: 'ws1',
    pageId: 'https://example.com/services',
    insightType: 'page_health',
    data: { score: 82, trend: 'improving', clicks: 100, impressions: 2000, position: 5, ctr: 5, pageviews: 500, bounceRate: 30, engagementTime: 120 },
    severity: 'positive',
    computedAt: new Date().toISOString(),
  },
  {
    id: '2',
    workspaceId: 'ws1',
    pageId: 'https://example.com/blog/old-post',
    insightType: 'content_decay',
    data: { baselineClicks: 150, currentClicks: 80, deltaPercent: -47, baselinePeriod: '2026-02-01/2026-02-28', currentPeriod: '2026-03-01/2026-03-28' },
    severity: 'critical',
    computedAt: new Date().toISOString(),
  },
  {
    id: '3',
    workspaceId: 'ws1',
    pageId: 'https://example.com/about',
    insightType: 'content_decay',
    data: { baselineClicks: 50, currentClicks: 35, deltaPercent: -30, baselinePeriod: '2026-02-01/2026-02-28', currentPeriod: '2026-03-01/2026-03-28' },
    severity: 'warning',
    computedAt: new Date().toISOString(),
  },
  {
    id: '4',
    workspaceId: 'ws1',
    pageId: 'https://example.com/services',
    insightType: 'page_health',
    data: { score: 45, trend: 'declining', clicks: 30, impressions: 800, position: 12, ctr: 3.8, pageviews: 200, bounceRate: 65, engagementTime: 40 },
    severity: 'warning',
    computedAt: new Date().toISOString(),
  },
];

describe('ContentHealthCard', () => {
  it('renders decay count and estimated recovery', () => {
    render(<ContentHealthCard insights={mockInsights} tier="growth" loading={false} />);
    expect(screen.getByText(/Content Health/i)).toBeTruthy();
    // Should show 2 decaying pages
    expect(screen.getByText(/2/)).toBeTruthy();
  });

  it('shows upgrade CTA for free tier', () => {
    render(<ContentHealthCard insights={mockInsights} tier="free" loading={false} />);
    expect(screen.getByText(/upgrade/i)).toBeTruthy();
  });

  it('shows loading skeleton', () => {
    const { container } = render(<ContentHealthCard insights={[]} tier="growth" loading={true} />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('shows empty state when no decay insights', () => {
    render(<ContentHealthCard insights={[]} tier="growth" loading={false} />);
    expect(screen.getByText(/no.*data/i)).toBeTruthy();
  });
});

describe('SchemaOpportunitiesCard', () => {
  it('renders with page health data', () => {
    render(<SchemaOpportunitiesCard insights={mockInsights} tier="growth" loading={false} />);
    expect(screen.getByText('Schema Opportunities')).toBeTruthy();
  });

  it('shows upgrade CTA for free tier', () => {
    render(<SchemaOpportunitiesCard insights={mockInsights} tier="free" loading={false} />);
    expect(screen.getByText(/upgrade/i)).toBeTruthy();
  });

  it('shows loading skeleton', () => {
    const { container } = render(<SchemaOpportunitiesCard insights={[]} tier="growth" loading={true} />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });
});
