/**
 * Component tests for OverviewTab.
 *
 * Heavy sub-components (MonthlyDigest, IntelligenceSummaryCard, HealthScoreCard,
 * PredictionShowcaseCard, InsightsDigest) are stubbed so
 * tests stay focused on the OverviewTab logic: welcome message, stat card grid,
 * action-needed banner, primary CTA, empty state, and the SEO-advisor sidebar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OverviewTab } from '../../../src/components/client/OverviewTab';
import type { WorkspaceInfo } from '../../../src/components/client/types';

// ── React Router ──────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ── BetaContext ───────────────────────────────────────────────────────────────
vi.mock('../../../src/components/client/BetaContext', () => ({
  useBetaMode: () => false,
}));

// ── Feature flags — off by default ───────────────────────────────────────────
vi.mock('../../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => false,
}));

// ── Client intelligence hook ──────────────────────────────────────────────────
vi.mock('../../../src/hooks/client', () => ({
  useClientIntelligence: () => ({ data: undefined }),
}));

// ── Recommendations hook — no top rec by default ──────────────────────────────
vi.mock('../../../src/hooks/useRecommendations', () => ({
  useRecommendationSet: () => ({ data: undefined }),
}));

// ── Heavy sub-components ──────────────────────────────────────────────────────
vi.mock('../../../src/components/client/MonthlyDigest', () => ({
  MonthlyDigest: () => <div data-testid="monthly-digest" />,
}));

vi.mock('../../../src/components/client/IntelligenceSummaryCard', () => ({
  IntelligenceSummaryCard: () => <div data-testid="intelligence-summary" />,
}));

vi.mock('../../../src/components/client/HealthScoreCard', () => ({
  HealthScoreCard: ({ score }: { score?: number }) => (
    <div data-testid="health-score-card">{score ?? 'no-score'}</div>
  ),
}));

vi.mock('../../../src/components/client/PredictionShowcaseCard', () => ({
  PredictionShowcaseCard: () => <div data-testid="prediction-showcase" />,
}));

vi.mock('../../../src/components/client/InsightsDigest', () => ({
  InsightsDigest: () => <div data-testid="insights-digest" />,
}));

// ── Minimal fixtures ──────────────────────────────────────────────────────────
const baseWs: WorkspaceInfo = {
  id: 'ws-test',
  name: 'Acme Corp',
  tier: 'growth',
  siteIntelligenceClientView: true,
};

const baseProps = {
  ws: baseWs,
  overview: null,
  searchComparison: null,
  trend: [],
  ga4Overview: null,
  ga4Trend: [],
  ga4Comparison: null,
  ga4Organic: null,
  ga4Conversions: [],
  ga4NewVsReturning: [],
  searchDataUpdatedAt: null,
  ga4DataUpdatedAt: null,
  audit: null,
  auditDetail: null,
  strategyData: null,
  insights: null,
  contentRequests: [],
  requests: [],
  approvalBatches: [],
  activityLog: [],
  pendingApprovals: 0,
  unreadTeamNotes: 0,
  eventDisplayName: (n: string) => n,
  isEventPinned: () => false,
  workspaceId: 'ws-test',
  onAskAi: vi.fn(),
  onOpenChat: vi.fn(),
  clientUser: null,
  contentPlanSummary: null,
};

const searchOverview = {
  totalClicks: 125,
  totalImpressions: 2400,
  avgCtr: 5.2,
  avgPosition: 8.4,
  topQueries: [],
  topPages: [],
  dateRange: { start: '2026-06-01', end: '2026-06-11' },
};

const ga4Overview = {
  totalUsers: 320,
  totalSessions: 440,
  totalPageviews: 980,
  avgSessionDuration: 72,
  bounceRate: 42,
  newUserPercentage: 64,
  dateRange: { start: '2026-06-01', end: '2026-06-11' },
};

beforeEach(() => {
  mockNavigate.mockReset();
  vi.mocked(baseProps.onAskAi).mockReset?.();
  vi.mocked(baseProps.onOpenChat).mockReset?.();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('OverviewTab — basic rendering', () => {
  it('renders without crashing when all data is null', () => {
    render(<OverviewTab {...baseProps} />);
    // Default dynamic subtitle when no data
    expect(screen.getByText(/Here are your latest insights/i)).toBeInTheDocument();
  });

  it('shows welcome message without user name when clientUser is null', () => {
    render(<OverviewTab {...baseProps} />);
    const welcome = screen.getByText(/Welcome back/i);
    expect(welcome.textContent).toMatch(/Welcome back\./);
  });

  it('shows personalised welcome when clientUser is provided', () => {
    render(
      <OverviewTab
        {...baseProps}
        clientUser={{ id: 'u1', name: 'Jane Smith', email: 'jane@example.com', role: 'editor' }}
      />,
    );
    expect(screen.getByText(/Welcome back, Jane\./i)).toBeInTheDocument();
  });

  it('renders HealthScoreCard (always present)', () => {
    render(<OverviewTab {...baseProps} />);
    expect(screen.getByTestId('health-score-card')).toBeInTheDocument();
  });

  it('renders source-specific freshness stamps for blended overview metrics', () => {
    render(
      <OverviewTab
        {...baseProps}
        overview={searchOverview}
        ga4Overview={ga4Overview}
        searchDataUpdatedAt={new Date('2026-06-11T15:30:00.000Z').getTime()}
        ga4DataUpdatedAt={new Date('2026-06-11T16:45:00.000Z').getTime()}
      />,
    );

    expect(screen.getByText(/Search data as of/i)).toBeInTheDocument();
    expect(screen.getByText(/Analytics data as of/i)).toBeInTheDocument();
    expect(screen.getByText((_content, element) => {
      return element?.tagName.toLowerCase() === 'time'
        && element.getAttribute('dateTime') === '2026-06-11T15:30:00.000Z';
    })).toBeInTheDocument();
    expect(screen.getByText((_content, element) => {
      return element?.tagName.toLowerCase() === 'time'
        && element.getAttribute('dateTime') === '2026-06-11T16:45:00.000Z';
    })).toBeInTheDocument();
  });

  it('does not show freshness stamps when source metrics are missing', () => {
    render(
      <OverviewTab
        {...baseProps}
        searchDataUpdatedAt={new Date('2026-06-11T15:30:00.000Z').getTime()}
        ga4DataUpdatedAt={new Date('2026-06-11T16:45:00.000Z').getTime()}
      />,
    );

    expect(screen.queryByText(/Search data as of/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Analytics data as of/i)).not.toBeInTheDocument();
  });

  it('renders InsightsDigest', () => {
    render(<OverviewTab {...baseProps} />);
    expect(screen.getByTestId('insights-digest')).toBeInTheDocument();
  });

  it('renders Ask your SEO advisor section with quick questions', () => {
    render(<OverviewTab {...baseProps} />);
    expect(screen.getByText('Ask your SEO advisor')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('OverviewTab — empty state (no data connected)', () => {
  it('shows setup guidance when no GSC, GA4 or audit data exists', () => {
    render(<OverviewTab {...baseProps} />);
    expect(screen.getByText('Connect Google Search Console')).toBeInTheDocument();
    expect(screen.getByText('Connect Google Analytics')).toBeInTheDocument();
    expect(screen.getByText('Run first site audit')).toBeInTheDocument();
  });

  it('displays the workspace name in the empty state header', () => {
    render(<OverviewTab {...baseProps} />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('OverviewTab — dynamic subtitle', () => {
  it('uses GA4 comparison when present (traffic up)', () => {
    render(
      <OverviewTab
        {...baseProps}
        ga4Comparison={{ changePercent: { users: 15, sessions: 10, pageviews: 12 } } as never}
      />,
    );
    expect(screen.getByText(/Traffic is up 15%/i)).toBeInTheDocument();
  });

  it('uses GA4 comparison when traffic is down', () => {
    render(
      <OverviewTab
        {...baseProps}
        ga4Comparison={{ changePercent: { users: -8, sessions: -5, pageviews: -7 } } as never}
      />,
    );
    expect(screen.getByText(/Traffic is down 8%/i)).toBeInTheDocument();
  });

  it('uses search comparison when GA4 comparison is absent', () => {
    render(
      <OverviewTab
        {...baseProps}
        searchComparison={{ changePercent: { clicks: 22, impressions: 10, position: 0, ctr: 0 } } as never}
      />,
    );
    expect(screen.getByText(/Search clicks up 22%/i)).toBeInTheDocument();
  });

  it('uses audit score subtitle when score is high', () => {
    render(
      <OverviewTab
        {...baseProps}
        audit={{ id: 'a1', createdAt: '2026-01-01', siteScore: 92, totalPages: 10, errors: 0, warnings: 2 }}
      />,
    );
    expect(screen.getByText(/Site health is strong at 92\/100/i)).toBeInTheDocument();
  });

  it('shows issue count when audit score is low', () => {
    render(
      <OverviewTab
        {...baseProps}
        audit={{ id: 'a2', createdAt: '2026-01-01', siteScore: 55, totalPages: 10, errors: 7, warnings: 3 }}
      />,
    );
    expect(screen.getByText(/7 site issues need attention/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('OverviewTab — action-needed banner', () => {
  it('does not render banner when there are no pending items', () => {
    render(<OverviewTab {...baseProps} />);
    expect(screen.queryByText(/items? need/i)).not.toBeInTheDocument();
  });

  it('renders banner when there are pending approvals', () => {
    render(<OverviewTab {...baseProps} pendingApprovals={3} />);
    expect(screen.getByText(/3 items need your attention/i)).toBeInTheDocument();
  });

  it('renders banner when unread team notes exist', () => {
    render(<OverviewTab {...baseProps} unreadTeamNotes={2} />);
    expect(screen.getByText(/2 items need your attention/i)).toBeInTheDocument();
  });

  it('navigates to inbox decisions tab on approval click', () => {
    render(<OverviewTab {...baseProps} pendingApprovals={1} />);
    // The action row text is split — find the clickable row
    const row = screen.getByText(/SEO change to review/i).closest('[class]');
    fireEvent.click(row!);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('tab=decisions'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('OverviewTab — primary CTA banners', () => {
  it('shows "Improve your site health" CTA when audit score < 80', () => {
    render(
      <OverviewTab
        {...baseProps}
        audit={{ id: 'a1', createdAt: '2026-01-01', siteScore: 65, totalPages: 10, errors: 5, warnings: 3 }}
      />,
    );
    expect(screen.getByText('Improve your site health')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View Issues/i })).toBeInTheDocument();
  });

  it('"View Issues" button navigates to health tab', () => {
    render(
      <OverviewTab
        {...baseProps}
        audit={{ id: 'a1', createdAt: '2026-01-01', siteScore: 65, totalPages: 10, errors: 5, warnings: 3 }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /View Issues/i }));
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('health'));
  });

  it('shows "Grow your search traffic" CTA when clicks < 100', () => {
    render(
      <OverviewTab
        {...baseProps}
        overview={{ totalClicks: 42, totalImpressions: 3000, avgPosition: 18, avgCtr: 0.014, dateRange: null } as never}
      />,
    );
    expect(screen.getByText('Grow your search traffic')).toBeInTheDocument();
    expect(screen.getByText(/You got 42 clicks last month/i)).toBeInTheDocument();
  });
});

describe('OverviewTab — metrics grid classes', () => {
  it('uses static 5-column class mapping for the largest metrics layout', () => {
    render(
      <OverviewTab
        {...baseProps}
        ga4Overview={{
          totalUsers: 1200,
          totalSessions: 1800,
          dateRange: { start: '2026-05-01', end: '2026-05-31' },
        } as never}
        overview={{
          totalClicks: 640,
          totalImpressions: 12200,
          avgPosition: 12.5,
          avgCtr: 0.052,
          dateRange: null,
        } as never}
        strategyData={{
          pageMap: [{ pagePath: '/services', currentPosition: 7.2 }],
        } as never}
        audit={{ id: 'a-grid', createdAt: '2026-05-01', siteScore: 88, totalPages: 25, errors: 2, warnings: 4 }}
      />,
    );

    const visitors = screen.getByText('Visitors');
    let el: HTMLElement | null = visitors.parentElement;
    while (el && (!el.className.includes('grid') || !el.className.includes('gap-3'))) {
      el = el.parentElement;
    }

    expect(el).not.toBeNull();
    expect(el!.className).toContain('grid-cols-2');
    expect(el!.className).toContain('sm:grid-cols-3');
    expect(el!.className).toContain('lg:grid-cols-5');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('OverviewTab — activity log', () => {
  it('renders Recent Work section when relevant activity exists', () => {
    render(
      <OverviewTab
        {...baseProps}
        activityLog={[
          { id: '1', type: 'audit_completed', title: 'Site audit completed', actorName: 'Team', createdAt: '2026-05-01T10:00:00Z' },
          { id: '2', type: 'seo_updated', title: 'Meta tags updated', actorName: 'Team', createdAt: '2026-05-02T10:00:00Z' },
        ]}
      />,
    );
    expect(screen.getByText('Recent Work')).toBeInTheDocument();
    expect(screen.getByText('Meta tags updated')).toBeInTheDocument();
  });

  it('does not render Recent Work when activity log is empty', () => {
    render(<OverviewTab {...baseProps} activityLog={[]} />);
    expect(screen.queryByText('Recent Work')).not.toBeInTheDocument();
  });

  it('does not render Recent Work for non-work event types', () => {
    render(
      <OverviewTab
        {...baseProps}
        activityLog={[
          { id: '1', type: 'insight_generated', title: 'Some insight', createdAt: '2026-05-01T10:00:00Z' },
        ]}
      />,
    );
    expect(screen.queryByText('Recent Work')).not.toBeInTheDocument();
  });
});
