import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalyticsTab } from '../../../src/components/client/AnalyticsTab';
import type { GA4Overview, GA4TopPage, GA4TopSource, WorkspaceInfo } from '../../../src/components/client/types';

const baseWorkspace: WorkspaceInfo = {
  id: 'ws-analytics',
  name: 'Workspace Analytics',
};

const overview: GA4Overview = {
  totalUsers: 1200,
  totalSessions: 1800,
  totalPageviews: 2600,
  avgSessionDuration: 142,
  bounceRate: 44.1,
  newUserPercentage: 62.4,
  dateRange: { start: '2026-04-18', end: '2026-05-16' },
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
    const pages: GA4TopPage[] = [
      { path: '/services/seo', pageviews: 420, users: 300, sessions: 330, avgEngagementTime: 73 },
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
        dataUpdatedAt={new Date('2026-06-11T15:30:00.000Z').getTime()}
      />,
    );

    expect(screen.getByText('2026-04-18 — 2026-05-16')).toBeInTheDocument();
    expect(screen.getByText(/Data as of/i)).toBeInTheDocument();
    expect(screen.getByText((_content, element) => {
      return element?.tagName.toLowerCase() === 'time'
        && element.getAttribute('dateTime') === '2026-06-11T15:30:00.000Z';
    })).toBeInTheDocument();
    expect(screen.getByText('/services/seo')).toBeInTheDocument();
    expect(screen.getByText('google / organic')).toBeInTheDocument();
  });

  it('renders a deterministic analytics takeaway from current metrics', () => {
    render(
      <AnalyticsTab
        ga4Overview={overview}
        ga4Comparison={{
          current: overview,
          previous: overview,
          change: { users: 120, sessions: 140, pageviews: 160, bounceRate: -2, avgSessionDuration: 10 },
          changePercent: { users: 12, sessions: 8, pageviews: 5 },
        }}
        ga4Trend={[]}
        ga4Devices={[]}
        ga4Pages={[
          { path: '/services/seo', pageviews: 420, users: 300, sessions: 330, avgEngagementTime: 73 },
          { path: '/blog', pageviews: 120, users: 90, sessions: 110, avgEngagementTime: 55 },
        ]}
        ga4Sources={[
          { source: 'google', medium: 'organic', users: 250, sessions: 330 },
          { source: 'direct', medium: '(none)', users: 120, sessions: 140 },
        ]}
        ga4Organic={null}
        ga4LandingPages={[]}
        ga4NewVsReturning={null}
        ga4Conversions={[{ eventName: 'lead_form_submit', conversions: 21, users: 300, rate: 7 }]}
        ga4Events={[]}
        ws={{
          ...baseWorkspace,
          eventConfig: [{ eventName: 'lead_form_submit', displayName: 'Lead form', pinned: true }],
        }}
        days={28}
      />,
    );

    expect(screen.getByText('Analytics takeaway')).toBeInTheDocument();
    expect(screen.getByText(/Traffic is up 12% from the previous period/i)).toBeInTheDocument();
    expect(screen.getByText(/google \/ organic is the top source, and \/services\/seo led page views/i)).toBeInTheDocument();
    expect(screen.getByText(/Lead form is the top tracked action at 7% conversion rate/i)).toBeInTheDocument();
  });

  it('uses judgment colors for conversion rates without rescaling percentages', () => {
    render(
      <AnalyticsTab
        ga4Overview={overview}
        ga4Comparison={null}
        ga4Trend={[]}
        ga4Devices={[]}
        ga4Pages={[]}
        ga4Sources={[]}
        ga4Organic={null}
        ga4LandingPages={[]}
        ga4NewVsReturning={null}
        ga4Conversions={[
          { eventName: 'high_rate', conversions: 14, users: 200, rate: 7 },
          { eventName: 'mid_rate', conversions: 6, users: 200, rate: 3 },
          { eventName: 'low_rate', conversions: 2, users: 200, rate: 1 },
        ]}
        ga4Events={[]}
        ws={baseWorkspace}
        days={28}
      />,
    );

    expect(screen.getByText('7%', { selector: 'span' })).toHaveClass('text-accent-success');
    expect(screen.getByText('3%', { selector: 'span' })).toHaveClass('text-accent-warning');
    expect(screen.getByText('1%', { selector: 'span' })).toHaveClass('text-accent-danger');
    expect(screen.queryByText('700%')).not.toBeInTheDocument();
  });
});
