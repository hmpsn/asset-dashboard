import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalyticsTab } from '../../../src/components/client/AnalyticsTab';
import type { GA4Overview, GA4TopPage, GA4TopSource, WorkspaceInfo } from '../../../src/components/client/types';

const baseWorkspace: WorkspaceInfo = {
  id: 'ws-analytics',
  name: 'Workspace Analytics',
};

describe('AnalyticsTab', () => {
  it('renders empty state when GA4 overview is missing', () => {
    render(
      <AnalyticsTab
        ga4Overview={null}
        ga4Comparison={null}
        ga4Trend={[]}
        ga4Devices={[]}
        ga4Pages={[]}
        ga4Sources={[]}
        ga4Organic={null}
        ga4LandingPages={[]}
        ga4NewVsReturning={null}
        ga4Conversions={[]}
        ga4Events={[]}
        ws={baseWorkspace}
        days={28}
      />,
    );

    expect(screen.getByText('Analytics Coming Soon')).toBeInTheDocument();
  });

  it('renders analytics summary lists when overview data exists', () => {
    const overview: GA4Overview = {
      totalUsers: 1200,
      totalSessions: 1800,
      totalPageviews: 2600,
      avgSessionDuration: 142,
      bounceRate: 44.1,
      newUserPercentage: 62.4,
      dateRange: { start: '2026-04-18', end: '2026-05-16' },
    };

    const pages: GA4TopPage[] = [
      { path: '/services/seo', pageviews: 420, users: 300, avgEngagementTime: 73 },
    ];

    const sources: GA4TopSource[] = [
      { source: 'google', medium: 'organic', users: 250, sessions: 330 },
    ];

    render(
      <AnalyticsTab
        ga4Overview={overview}
        ga4Comparison={null}
        ga4Trend={[]}
        ga4Devices={[]}
        ga4Pages={pages}
        ga4Sources={sources}
        ga4Organic={null}
        ga4LandingPages={[]}
        ga4NewVsReturning={null}
        ga4Conversions={[]}
        ga4Events={[]}
        ws={baseWorkspace}
        days={28}
      />,
    );

    expect(screen.getByText('2026-04-18 — 2026-05-16')).toBeInTheDocument();
    expect(screen.getByText('/services/seo')).toBeInTheDocument();
    expect(screen.getByText('google / organic')).toBeInTheDocument();
  });
});
