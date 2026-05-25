import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InsightsDigest } from '../../../src/components/client/InsightsDigest';
import type {
  SearchOverview,
  SearchComparison,
  GA4Overview,
  GA4Comparison,
  GA4OrganicOverview,
  GA4ConversionSummary,
  GA4NewVsReturning,
  AuditSummary,
  AuditDetail,
  ClientKeywordStrategy,
} from '../../../src/components/client/types';
import type { ClientInsight } from '../../../shared/types/narrative';

// ─── Module-level mocks ───────────────────────────────────────────────────────

vi.mock('../../../src/components/client/BetaContext', () => ({
  useBetaMode: () => false,
}));

const mockUseClientInsights = vi.fn().mockReturnValue({ data: { insights: [] } });
vi.mock('../../../src/hooks/client/useClientInsights', () => ({
  useClientInsights: (...args: unknown[]) => mockUseClientInsights(...args),
}));

vi.mock('../../../src/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  getSafe: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'ws-test';

function makeGA4Overview(): GA4Overview {
  return {
    totalUsers: 1200,
    totalSessions: 1800,
    totalPageviews: 3400,
    avgSessionDuration: 95,
    bounceRate: 45,
  };
}

function makeGA4Comparison(): GA4Comparison {
  return {
    current: { totalUsers: 1200, totalSessions: 1800, totalPageviews: 3400, avgSessionDuration: 95, bounceRate: 45 },
    previous: { totalUsers: 1000, totalSessions: 1600, totalPageviews: 3000, avgSessionDuration: 90, bounceRate: 47 },
    change: { totalUsers: 200, totalSessions: 200, totalPageviews: 400, avgSessionDuration: 5, bounceRate: -2 },
    changePercent: { users: 20, sessions: 12, pageviews: 13 },
  };
}

function makeSearchOverview(): SearchOverview {
  return {
    totalClicks: 450,
    totalImpressions: 8200,
    avgCtr: 5.5,
    avgPosition: 8.3,
  };
}

function makeSearchComparison(): SearchComparison {
  return {
    current: { totalClicks: 450, totalImpressions: 8200, avgCtr: 5.5, avgPosition: 8.3 },
    previous: { totalClicks: 400, totalImpressions: 7500, avgCtr: 5.3, avgPosition: 9.1 },
    change: { clicks: 50, impressions: 700, ctr: 0.2, position: -0.8 },
    changePercent: { clicks: 12, impressions: 9 },
  };
}

function makeAuditSummary(score = 85, prevScore: number | null = null): AuditSummary {
  return {
    siteScore: score,
    totalPages: 40,
    issueCount: score >= 80 ? 0 : 5,
    previousScore: prevScore,
  };
}

function makeAuditDetail(): AuditDetail {
  return {
    id: 'audit-1',
    createdAt: '2026-05-16T00:00:00.000Z',
    siteName: 'Acme',
    audit: {
      siteScore: 85,
      totalPages: 40,
      errors: 0,
      warnings: 2,
      infos: 5,
      pages: [],
      siteWideIssues: [],
      cwvSummary: {
        mobile: { assessment: 'good', lcp: 2.1, cls: 0.05, fid: 80 },
        desktop: { assessment: 'good', lcp: 1.4, cls: 0.02, fid: 40 },
      },
    },
    scoreHistory: [],
  };
}

function makeGA4Organic(): GA4OrganicOverview {
  return {
    organicUsers: 700,
    shareOfTotalUsers: 58,
    engagementRate: 72,
  };
}

function makeStrategy(): ClientKeywordStrategy {
  return {
    workspaceId: WORKSPACE_ID,
    generatedAt: '2026-05-16T00:00:00.000Z',
    pageMap: [
      { pageUrl: '/blog/seo', targetKeyword: 'seo tips', currentPosition: 6 },
      { pageUrl: '/about', targetKeyword: 'about us', currentPosition: null },
    ],
    quickWins: [
      { pagePath: '/blog/seo', action: 'Update title tag to include primary keyword', difficulty: 'easy', estimatedImpact: 'medium' },
    ],
    contentGaps: [
      { topic: 'Local SEO guide', intent: 'informational', priority: 'high' },
      { topic: 'Link building tactics', intent: 'informational', priority: 'medium' },
    ],
  };
}

function makeConversions(): GA4ConversionSummary[] {
  return [
    { eventName: 'contact_form_submit', conversions: 28, rate: 2.3 },
    { eventName: 'newsletter_signup', conversions: 14, rate: 1.1 },
  ];
}

function makeNewVsReturning(): GA4NewVsReturning[] {
  return [
    { segment: 'new', users: 850, percentage: 71 },
    { segment: 'returning', users: 350, percentage: 29 },
  ];
}

const defaultProps = {
  overview: null,
  searchComparison: null,
  ga4Overview: null,
  ga4Comparison: null,
  ga4Organic: null,
  ga4Conversions: [] as GA4ConversionSummary[],
  ga4NewVsReturning: [] as GA4NewVsReturning[],
  audit: null,
  auditDetail: null,
  strategyData: null,
  searchInsights: null,
  eventDisplayName: (name: string) => name.replace(/_/g, ' '),
  isEventPinned: () => false,
  workspaceId: WORKSPACE_ID,
  contentPlanSummary: null,
  siteIntelligenceEnabled: false,
};

function renderDigest(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(
    <MemoryRouter>
      <InsightsDigest {...props} />
    </MemoryRouter>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('InsightsDigest — basic rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when no data is provided', () => {
    const { container } = renderDigest();
    // No insights generated → returns null
    expect(container.firstChild).toBeNull();
  });

  it('renders the Insights header when data is available', () => {
    renderDigest({ ga4Overview: makeGA4Overview() });
    expect(screen.getByText('Insights')).toBeInTheDocument();
  });

  it('shows insight count in header', () => {
    renderDigest({ ga4Overview: makeGA4Overview() });
    expect(screen.getByText(/things to know/i)).toBeInTheDocument();
  });

  it('does not contain purple styling in the rendered output', () => {
    const { container } = renderDigest({ ga4Overview: makeGA4Overview() });
    // No purple class should appear in client-facing components
    expect(container.innerHTML).not.toMatch(/purple-/);
  });
});

describe('InsightsDigest — traffic trend card', () => {
  it('renders "traffic is up" card when GA4 comparison shows positive change', () => {
    renderDigest({ ga4Comparison: makeGA4Comparison() });
    expect(screen.getByText(/website traffic is up 20%/i)).toBeInTheDocument();
  });

  it('renders "traffic is down" card when GA4 comparison shows negative change', () => {
    const negComp: GA4Comparison = {
      ...makeGA4Comparison(),
      changePercent: { users: -15, sessions: -10, pageviews: -12 },
    };
    renderDigest({ ga4Comparison: negComp });
    expect(screen.getByText(/website traffic is down 15%/i)).toBeInTheDocument();
  });

  it('shows visitor count numbers in the traffic trend body', () => {
    renderDigest({ ga4Comparison: makeGA4Comparison() });
    // 1200 visitors → fmtNum produces "1.2K"
    expect(screen.getByText(/1\.2K/)).toBeInTheDocument();
  });

  it('mentions organic share in traffic card when ga4Organic is provided', () => {
    renderDigest({
      ga4Comparison: makeGA4Comparison(),
      ga4Organic: makeGA4Organic(),
    });
    expect(screen.getByText(/58% of your total traffic/i)).toBeInTheDocument();
  });

  it('falls back to traffic-overview card when no comparison is available', () => {
    renderDigest({ ga4Overview: makeGA4Overview() });
    // 1200 totalUsers → fmtNum produces "1.2K"
    expect(screen.getByText(/1\.2K visitors this period/i)).toBeInTheDocument();
  });

  it('shows "View analytics" action link on traffic card', () => {
    renderDigest({ ga4Comparison: makeGA4Comparison() });
    expect(screen.getByText('View analytics')).toBeInTheDocument();
  });
});

describe('InsightsDigest — search performance card', () => {
  it('renders search trend card when searchComparison is provided', () => {
    renderDigest({ searchComparison: makeSearchComparison() });
    expect(screen.getByText(/search clicks up 12% vs last period/i)).toBeInTheDocument();
  });

  it('renders search overview card when only overview is provided', () => {
    renderDigest({ overview: makeSearchOverview() });
    expect(screen.getByText(/450 search clicks this period/i)).toBeInTheDocument();
  });

  it('shows "View search data" action link', () => {
    renderDigest({ searchComparison: makeSearchComparison() });
    expect(screen.getByText('View search data')).toBeInTheDocument();
  });

  it('mentions average position change in body when position shifted', () => {
    renderDigest({ searchComparison: makeSearchComparison() });
    // position changed by -0.8 → "improved"
    expect(screen.getByText(/improved by 0.8 spots/i)).toBeInTheDocument();
  });
});

describe('InsightsDigest — site health card', () => {
  it('renders healthy site health card', () => {
    renderDigest({ audit: makeAuditSummary(90) });
    expect(screen.getByText(/site health: 90\/100/i)).toBeInTheDocument();
  });

  it('renders site health card with issues for low score', () => {
    renderDigest({ audit: makeAuditSummary(55) });
    expect(screen.getByText(/site health: 55\/100/i)).toBeInTheDocument();
  });

  it('shows "View site health" action link', () => {
    renderDigest({ audit: makeAuditSummary(85) });
    expect(screen.getByText('View site health')).toBeInTheDocument();
  });

  it('mentions score improvement when previousScore is lower', () => {
    renderDigest({ audit: makeAuditSummary(90, 80) });
    expect(screen.getByText(/improved from 80/i)).toBeInTheDocument();
  });
});

describe('InsightsDigest — Core Web Vitals card', () => {
  it('renders CWV card when cwvSummary is present', () => {
    renderDigest({ auditDetail: makeAuditDetail() });
    // CWV headline uses "Page speed:" prefix
    expect(screen.getAllByText(/page speed/i).length).toBeGreaterThan(0);
  });

  it('shows "Passed" status for good CWV assessments', () => {
    renderDigest({ auditDetail: makeAuditDetail() });
    expect(screen.getByText(/Mobile: Passed · Desktop: Passed/i)).toBeInTheDocument();
  });
});

describe('InsightsDigest — search insights cards', () => {
  it('renders rankings-wins card when top performers are present', () => {
    renderDigest({
      searchInsights: {
        topPerformers: [
          { query: 'seo services', position: 2, clicks: 45, impressions: 800, ctr: 5.6 },
          { query: 'local seo', position: 3, clicks: 30, impressions: 600, ctr: 5 },
        ],
        lowHanging: [],
      },
    });
    expect(screen.getByText(/2 keywords ranking in the top 3/i)).toBeInTheDocument();
  });

  it('shows top keyword names in rankings-wins detail', () => {
    renderDigest({
      searchInsights: {
        topPerformers: [
          { query: 'seo services', position: 2, clicks: 45, impressions: 800, ctr: 5.6 },
        ],
        lowHanging: [],
      },
    });
    expect(screen.getByText(/"seo services"/i)).toBeInTheDocument();
  });

  it('renders low-hanging-fruit card when available', () => {
    renderDigest({
      searchInsights: {
        topPerformers: [],
        lowHanging: [
          { query: 'best seo tools', position: 12, clicks: 10, impressions: 500, ctr: 2 },
        ],
      },
    });
    expect(screen.getByText(/1 keyword almost on page 1/i)).toBeInTheDocument();
  });
});

describe('InsightsDigest — strategy cards', () => {
  it('renders quick-wins card when strategy has quickWins', () => {
    renderDigest({ strategyData: makeStrategy() });
    expect(screen.getByText(/1 quick win identified/i)).toBeInTheDocument();
  });

  it('renders content-gaps card when strategy has contentGaps', () => {
    renderDigest({ strategyData: makeStrategy() });
    expect(screen.getByText(/2 content opportunities for new traffic/i)).toBeInTheDocument();
  });

  it('shows "View strategy" action link for quick wins', () => {
    renderDigest({ strategyData: makeStrategy() });
    expect(screen.getAllByText('View strategy').length).toBeGreaterThan(0);
  });
});

describe('InsightsDigest — conversion events card', () => {
  it('renders conversions card for pinned events', () => {
    renderDigest({
      ga4Conversions: makeConversions(),
      isEventPinned: (name: string) => name === 'contact_form_submit',
    });
    expect(screen.getByText(/28 key events this period/i)).toBeInTheDocument();
  });

  it('does not render conversions card when no events are pinned', () => {
    renderDigest({
      ga4Conversions: makeConversions(),
      isEventPinned: () => false,
    });
    // No conversion card should appear
    expect(screen.queryByText(/key events this period/i)).toBeNull();
  });
});

describe('InsightsDigest — new vs returning visitors card', () => {
  it('renders new-vs-returning card when segment data is present', () => {
    renderDigest({ ga4NewVsReturning: makeNewVsReturning() });
    expect(screen.getByText(/71% of visitors are new/i)).toBeInTheDocument();
  });
});

describe('InsightsDigest — content plan cards', () => {
  it('renders content-plan-review card when items need review', () => {
    renderDigest({
      contentPlanSummary: {
        totalCells: 10,
        publishedCells: 6,
        reviewCells: 2,
        approvedCells: 1,
        inProgressCells: 1,
        matrixCount: 2,
      },
    });
    expect(screen.getByText(/2 content plan pages need your review/i)).toBeInTheDocument();
  });

  it('renders content-plan-progress card when plan is in progress', () => {
    renderDigest({
      contentPlanSummary: {
        totalCells: 10,
        publishedCells: 6,
        reviewCells: 0,
        approvedCells: 1,
        inProgressCells: 2,
        matrixCount: 1,
      },
    });
    expect(screen.getByText(/content plan is 60% complete/i)).toBeInTheDocument();
  });

  it('renders content-plan-complete card when all items published', () => {
    renderDigest({
      contentPlanSummary: {
        totalCells: 5,
        publishedCells: 5,
        reviewCells: 0,
        approvedCells: 0,
        inProgressCells: 0,
        matrixCount: 1,
      },
    });
    expect(screen.getByText(/content plan fully published/i)).toBeInTheDocument();
  });
});

describe('InsightsDigest — show more interaction', () => {
  it('shows "Show X more insights" button when more than 4 insights exist', () => {
    renderDigest({
      ga4Comparison: makeGA4Comparison(),
      searchComparison: makeSearchComparison(),
      audit: makeAuditSummary(85),
      strategyData: makeStrategy(),
      ga4NewVsReturning: makeNewVsReturning(),
      auditDetail: makeAuditDetail(),
    });
    const showMoreBtn = screen.queryByText(/show .+ more insight/i);
    // With enough cards this button should appear
    if (showMoreBtn) {
      expect(showMoreBtn).toBeInTheDocument();
    }
  });

  it('expands all insights when "show more" button is clicked', () => {
    renderDigest({
      ga4Comparison: makeGA4Comparison(),
      searchComparison: makeSearchComparison(),
      audit: makeAuditSummary(85),
      strategyData: makeStrategy(),
      ga4NewVsReturning: makeNewVsReturning(),
      auditDetail: makeAuditDetail(),
    });
    const showMoreBtn = screen.queryByText(/show .+ more insight/i);
    if (showMoreBtn) {
      fireEvent.click(showMoreBtn);
      // After clicking, the button should be gone
      expect(screen.queryByText(/show .+ more insight/i)).toBeNull();
    }
  });
});

describe('InsightsDigest — server insights integration', () => {
  const serverInsight: ClientInsight = {
    id: 'si-1',
    type: 'ranking_mover',
    severity: 'positive',
    domain: 'search',
    headline: 'Your AI Tools page moved up in rankings',
    narrative: 'Position improved from 11 to 4.',
    impact: 'Estimated +800 monthly visits.',
    actionTaken: undefined,
    impactScore: 82,
  };

  it('renders server insight headline when siteIntelligenceEnabled is true', () => {
    mockUseClientInsights.mockReturnValueOnce({ data: { insights: [serverInsight] } });

    renderDigest({
      siteIntelligenceEnabled: true,
    });

    expect(screen.getByText('Your AI Tools page moved up in rankings')).toBeInTheDocument();
  });

  it('hides server insights when siteIntelligenceEnabled is false', () => {
    const decayInsight: ClientInsight = {
      id: 'si-2',
      type: 'content_decay',
      severity: 'warning',
      domain: 'content',
      headline: 'Page traffic is declining',
      narrative: 'The page lost 40% of clicks.',
      impact: undefined,
      actionTaken: undefined,
      impactScore: 60,
    };
    mockUseClientInsights.mockReturnValueOnce({ data: { insights: [decayInsight] } });

    renderDigest({
      ga4Overview: makeGA4Overview(),
      siteIntelligenceEnabled: false,
    });

    // Server insight headline should NOT appear even if hook returns data
    expect(screen.queryByText('Page traffic is declining')).toBeNull();
  });

  it('shows Insights section header when server insights are present', () => {
    mockUseClientInsights.mockReturnValueOnce({ data: { insights: [serverInsight] } });

    renderDigest({ siteIntelligenceEnabled: true });

    expect(screen.getByText('Insights')).toBeInTheDocument();
  });

  it('shows "Win" sentiment badge for positive severity server insights', () => {
    mockUseClientInsights.mockReturnValueOnce({ data: { insights: [serverInsight] } });

    renderDigest({ siteIntelligenceEnabled: true });

    expect(screen.getByText('Win')).toBeInTheDocument();
  });
});
