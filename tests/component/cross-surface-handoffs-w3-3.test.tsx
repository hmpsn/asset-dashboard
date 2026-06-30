/**
 * Component tests for W3.3 cross-surface handoff repairs.
 *
 * Covers:
 *   1. WorkspaceHome "N new client requests" sender encodes ?tab=requests
 *   2. App.tsx requests-tab receiver fires on same-workspace tab navigation
 *   3. KeywordGaps shows a View-in-Hub link when given workspaceId + navigate
 *   4. LocalSeoVisibilityPanel RepeatCompetitorList has Track button per keyword
 *   5. ContentDecay expanded row has "Refresh brief" and "Review page" buttons
 *   6. ContentPipeline decay banner is clickable (navigates to seo-audit?sub=content-decay)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Shared hoisted mocks
// ---------------------------------------------------------------------------

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// ---------------------------------------------------------------------------
// Test 1: WorkspaceHome requests action encodes ?tab=requests
// ---------------------------------------------------------------------------
describe('WorkspaceHome: "N new client requests" action', () => {
  it('action item has queryString "tab=requests" so the sender encodes ?tab=requests', async () => {
    // We test this statically: the ActionItem definition with tab: 'requests'
    // must have queryString: 'tab=requests'. This verifies the sender half of the
    // two-halves contract without spinning up the full WorkspaceHome render tree.
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(__dirname, '../../src/components/WorkspaceHome.tsx'),
      'utf8',
    ); // readFile-ok — static analysis of sender definition
    // The new requests action must contain tab: 'requests' and queryString: 'tab=requests'
    // These may be on the same line in any order after the push call
    expect(src).toMatch(/tab:\s*'requests'.*queryString:\s*'tab=requests'/s);
  });
});

// ---------------------------------------------------------------------------
// Test 2: App.tsx receiver fires on same-workspace tab navigation
// ---------------------------------------------------------------------------
describe('App.tsx: requestsSubTab receiver', () => {
  it('the useEffect for requestsSubTab depends on tab (not just urlWorkspaceId)', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '../../src/App.tsx'), 'utf8'); // readFile-ok — static analysis of receiver
    // The effect that sets requestsSubTab must include `tab` in its dependency array
    // so navigating from home → requests with ?tab=requests fires the receiver.
    expect(src).toMatch(/\[\s*urlWorkspaceId\s*,\s*tab\s*\]/);
  });

  it('the receiver guards on tab === "requests" before reading searchParams', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '../../src/App.tsx'), 'utf8'); // readFile-ok
    // The guard prevents the effect firing on workspace-only changes unrelated to requests tab
    expect(src).toMatch(/if\s*\(\s*tab\s*!==\s*['"]requests['"]\s*\)\s*return/);
  });
});

// ---------------------------------------------------------------------------
// Test 3: KeywordGaps View-in-Hub link
// ---------------------------------------------------------------------------

const { kgFeatureFlagMock } = vi.hoisted(() => ({
  kgFeatureFlagMock: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => kgFeatureFlagMock(...args),
}));

describe('KeywordGaps: View-in-Hub link', () => {
  const gaps = [
    { keyword: 'local dentist', volume: 500, difficulty: 40, competitorPosition: 3, competitorDomain: 'rival.com' },
    { keyword: 'teeth cleaning', volume: 200, difficulty: 25, competitorPosition: 5, competitorDomain: 'other.com' },
  ];
  const difficultyColor = () => 'text-amber-400';

  // The View-in-Hub link is now unconditional — it renders whenever the gaps
  // component is given a workspaceId + navigate (the Hub is the only keyword
  // surface, so there is no flag to gate it). Omitting navigate suppresses it.
  async function setup(withNavigate = true) {
    const { KeywordGaps } = await import('../../src/components/strategy/KeywordGaps');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <KeywordGaps
            keywordGaps={gaps}
            difficultyColor={difficultyColor}
            workspaceId="ws-1"
            navigate={withNavigate ? navigateMock : undefined}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  beforeEach(() => { navigateMock.mockClear(); });

  it('renders gap keywords without hub links when no navigate is provided', async () => {
    await setup(false);
    expect(screen.getByText('local dentist')).toBeInTheDocument();
    expect(screen.queryByTitle('View in Hub')).toBeNull();
  });

  it('renders a View-in-Hub icon button for each row by default', async () => {
    await setup();
    const hubButtons = screen.getAllByTitle('View in Hub');
    expect(hubButtons).toHaveLength(2);
  });

  it('clicking View-in-Hub navigates to seo-keywords with ?q= param', async () => {
    await setup();
    const hubButtons = screen.getAllByTitle('View in Hub');
    fireEvent.click(hubButtons[0]);
    expect(navigateMock).toHaveBeenCalledOnce();
    const [path] = navigateMock.mock.calls[0] as [string];
    expect(path).toContain('/seo-keywords');
    expect(path).toContain('q=');
    // The normalized key for 'local dentist' is 'local dentist'
    expect(path).toContain('local+dentist');
  });
});

// ---------------------------------------------------------------------------
// Test 4: LocalSeoVisibilityPanel RepeatCompetitorList Track button
// ---------------------------------------------------------------------------

const addKeywordMutateAsync = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useRankTrackingAddKeyword: () => ({
    mutateAsync: addKeywordMutateAsync,
    isPending: false,
    error: null,
  }),
  useRankTrackingTogglePin: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/admin', () => ({
  useLocalSeo: () => ({
    data: {
      featureEnabled: true,
      settings: { posture: 'local', postureSource: 'manual' },
      report: {
        workspacePosture: 'local',
        setupState: 'has_data',
        setupLabel: 'Local SEO active',
        setupDetail: '3 markets configured',
        activeMarketCount: 3,
        configuredMarketCount: 3,
        checkedKeywordCount: 10,
        visibleCount: 5,
        possibleMatchCount: 2,
        notVisibleCount: 3,
        localPackPresentCount: 1,
        lastCapturedAt: '2026-06-01T00:00:00.000Z',
      },
      markets: [{ id: 'm1', label: 'Chicago, IL', status: 'active' }],
      suggestedMarkets: [],
      competitorBrands: [
        {
          title: 'Rival Dental',
          domain: 'rival.com',
          winsAgainstClient: 3,
          totalAppearances: 5,
          markets: ['Chicago, IL'],
          suggestedTrackingKeywords: ['best dentist chicago', 'dental implants chicago'],
        },
      ],
      visibilityTrend: [],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useLocalSeoUpdate: () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false, error: null }),
  useLocalSeoLocationLookup: () => ({ data: [], isLoading: false }),
  useLocalSeoLocations: () => ({ data: [], isLoading: false }),
  useSetPrimaryMarket: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  // GbpReviewsPanel (P7 / local-gbp) mounts inside LocalSeoVisibilityPanel and reads these.
  useGbpReviews: () => ({ data: { owned: null, competitors: [], completenessScore: null } }),
  useLocalGbpRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({
    tasks: [],
    jobs: [],
    findActiveJob: () => undefined,
  }),
}));

describe('LocalSeoVisibilityPanel: suggested tracking keywords Track button', () => {
  async function setup() {
    const { LocalSeoVisibilityPanel } = await import('../../src/components/local-seo/LocalSeoVisibilityPanel');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <LocalSeoVisibilityPanel workspaceId="ws-1" mode="keywords" />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  beforeEach(() => { addKeywordMutateAsync.mockClear(); });

  it('renders a Track button for each suggested keyword', async () => {
    await setup();
    await waitFor(() => expect(screen.getByText('best dentist chicago')).toBeInTheDocument());
    const trackButtons = screen.getAllByTitle('Track');
    expect(trackButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('clicking Track calls addKeyword mutation with the keyword', async () => {
    await setup();
    await waitFor(() => expect(screen.getByText('best dentist chicago')).toBeInTheDocument());
    const trackButtons = screen.getAllByTitle('Track');
    fireEvent.click(trackButtons[0]);
    await waitFor(() => expect(addKeywordMutateAsync).toHaveBeenCalledWith('best dentist chicago'));
  });

  it('shows "Tracked" feedback after successful track', async () => {
    await setup();
    await waitFor(() => expect(screen.getByText('best dentist chicago')).toBeInTheDocument());
    const trackButtons = screen.getAllByTitle('Track');
    fireEvent.click(trackButtons[0]);
    await waitFor(() => expect(screen.getByText('Tracked')).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Test 5: ContentDecay "Refresh brief" and "Review page" buttons
// ---------------------------------------------------------------------------

vi.mock('../../src/api/content', () => ({
  contentDecay: {
    get: vi.fn().mockResolvedValue({
      workspaceId: 'ws-1',
      analyzedAt: '2026-06-01T10:00:00.000Z',
      totalPages: 2,
      decayingPages: [
        {
          page: '/blog/losing-page',
          currentClicks: 50,
          previousClicks: 200,
          clickDeclinePct: 75,
          currentImpressions: 1000,
          previousImpressions: 3000,
          impressionChangePct: -67,
          currentPosition: 15,
          previousPosition: 8,
          positionChange: 7,
          severity: 'critical',
          refreshRecommendation: 'Update this page with recent data.',
        },
      ],
      summary: { critical: 1, warning: 0, watch: 0, totalDecaying: 1, avgDeclinePct: 75 },
    }),
    analyze: vi.fn().mockResolvedValue(null),
    recommendations: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../src/api/clientActions', () => ({
  clientActions: {
    create: vi.fn().mockResolvedValue({ id: 'ca-1' }),
  },
}));

describe('ContentDecay: Refresh brief and Review page buttons', () => {
  async function setup() {
    const ContentDecay = (await import('../../src/components/ContentDecay')).default;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <ContentDecay workspaceId="ws-1" />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  beforeEach(() => { navigateMock.mockClear(); });

  it('renders the decaying page row', async () => {
    await setup();
    await waitFor(() => expect(screen.getByText('/blog/losing-page')).toBeInTheDocument());
  });

  it('clicking the row expands to show Refresh brief and Review page buttons', async () => {
    await setup();
    await waitFor(() => screen.getByText('/blog/losing-page'));
    fireEvent.click(screen.getByText('/blog/losing-page'));
    await waitFor(() => {
      expect(screen.getByText('Refresh brief')).toBeInTheDocument();
      expect(screen.getByText('Review page')).toBeInTheDocument();
    });
  });

  it('"Refresh brief" navigates to content-pipeline passing the page as pageSlug (NOT primaryKeyword)', async () => {
    await setup();
    await waitFor(() => screen.getByText('/blog/losing-page'));
    fireEvent.click(screen.getByText('/blog/losing-page'));
    await waitFor(() => screen.getByText('Refresh brief'));
    fireEvent.click(screen.getByText('Refresh brief'));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('content-pipeline'),
      expect.objectContaining({
        state: expect.objectContaining({
          fixContext: expect.objectContaining({
            targetRoute: 'content-pipeline',
            // page.page is a URL/path — the ContentBriefs receiver reads pageSlug for
            // page targeting and would prefill a raw URL into the keyword field if this
            // were sent as primaryKeyword. Assert the correct contract.
            pageSlug: '/blog/losing-page',
            pageName: '/blog/losing-page',
          }),
        }),
      }),
    );
    // Guard against regression to the wrong contract field.
    const [, options] = navigateMock.mock.calls[0] as [string, { state: { fixContext: Record<string, unknown> } }];
    expect(options.state.fixContext).not.toHaveProperty('primaryKeyword');
  });

  it('"Review page" navigates to page-intelligence with fixContext', async () => {
    await setup();
    await waitFor(() => screen.getByText('/blog/losing-page'));
    fireEvent.click(screen.getByText('/blog/losing-page'));
    await waitFor(() => screen.getByText('Review page'));
    fireEvent.click(screen.getByText('Review page'));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('page-intelligence'),
      expect.objectContaining({ state: expect.objectContaining({ fixContext: expect.objectContaining({ targetRoute: 'page-intelligence' }) }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// Test 6: ContentPipeline decay banner clickthrough (static analysis)
// ---------------------------------------------------------------------------

describe('ContentPipeline: decay banner clickthrough', () => {
  it('decay banner is wrapped in ClickableRow that navigates to seo-audit?sub=content-decay', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(__dirname, '../../src/components/ContentPipeline.tsx'),
      'utf8',
    ); // readFile-ok — static analysis of banner click handler

    // The banner must use ClickableRow (not a plain div)
    expect(src).toContain('ClickableRow');
    // The onClick must navigate to seo-audit with sub=content-decay
    expect(src).toContain('seo-audit');
    expect(src).toContain('sub=content-decay');
  });

  it('dismissal uses e.stopPropagation() to prevent navigation on dismiss', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(__dirname, '../../src/components/ContentPipeline.tsx'),
      'utf8',
    ); // readFile-ok
    // The dismiss button must call stopPropagation so clicking X doesn't navigate
    expect(src).toContain('e.stopPropagation()');
  });
});
