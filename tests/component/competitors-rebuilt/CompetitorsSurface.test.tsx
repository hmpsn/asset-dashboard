import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/components/Toast';
import { CompetitorsSurface } from '../../../src/components/competitors-rebuilt/CompetitorsSurface';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { buildHubDeepLinkQuery } from '../../../src/lib/keywordHubDeepLink';
import { queryKeys } from '../../../src/lib/queryKeys';
import type { FeatureFlagKey } from '../../../shared/types/feature-flags';
import { expectNoA11yViolations } from '../a11y';

const keywordStrategyMock = vi.fn();
const apiGetMock = vi.fn();
const competitorAlertsMock = vi.fn();
const backlinkProfileMock = vi.fn();
const recommendationSetMock = vi.fn();
const featureFlagsListMock = vi.fn();
const navigateMock = vi.fn();
let capturedWorkspaceHandlers: Record<string, () => void> = {};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

vi.mock('../../../src/hooks/admin/useKeywordStrategy', () => ({
  useKeywordStrategy: (...args: unknown[]) => keywordStrategyMock(...args),
}));

vi.mock('../../../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/client')>('../../../src/api/client');
  return {
    ...actual,
    get: (...args: unknown[]) => apiGetMock(...args),
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      list: () => featureFlagsListMock(),
    },
  };
});

vi.mock('../../../src/hooks/admin/useCompetitorAlerts', () => ({
  useCompetitorAlerts: (...args: unknown[]) => competitorAlertsMock(...args),
}));

vi.mock('../../../src/hooks/admin/useBacklinkProfile', () => ({
  useBacklinkProfile: (...args: unknown[]) => backlinkProfileMock(...args),
}));

vi.mock('../../../src/hooks/admin/useAdminRecommendations', () => ({
  useAdminRecommendationSet: (...args: unknown[]) => recommendationSetMock(...args),
}));

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (_workspaceId: string | undefined, handlers: Record<string, () => void>) => {
    capturedWorkspaceHandlers = handlers;
    return { send: vi.fn() };
  },
}));

const workspaceId = 'ws-competitors-rebuilt';
const featureFlagResponse: Partial<Record<FeatureFlagKey, boolean>> = {
  'ui-rebuild-shell': true,
  'strategy-command-center': true,
  'strategy-competitor-send': true,
};

const keywordStrategyData = {
  strategy: {
    siteKeywords: [],
    opportunities: [],
    keywordGaps: [
      {
        keyword: 'emergency dentist austin',
        volume: 900,
        difficulty: 41,
        competitorPosition: 2,
        competitorDomain: 'rival.com',
      },
    ],
    seoDataMode: 'full',
  },
  seoDataAvailable: true,
  providers: [{ name: 'dataforseo', configured: true }],
  workspaceData: {
    competitorDomains: ['rival.com', 'clinic.example'],
    seoDataProvider: 'dataforseo',
  },
};

const competitiveIntelData = {
  domains: [
    {
      domain: 'client.com',
      isOwn: true,
      overview: {
        domain: 'client.com',
        organicKeywords: 120,
        organicTraffic: 4600,
        organicCost: 9100,
        paidKeywords: 0,
        paidTraffic: 0,
        paidCost: 0,
      },
      backlinks: { totalBacklinks: 2500, referringDomains: 180 },
      topKeywords: [
        {
          keyword: 'cosmetic dentist',
          position: 4,
          volume: 1400,
          difficulty: 38,
          url: 'https://client.com/cosmetic',
          traffic: 320,
        },
      ],
      authorityRank: 46,
      top3Keywords: 18,
    },
    {
      domain: 'rival.com',
      isOwn: false,
      overview: {
        domain: 'rival.com',
        organicKeywords: 210,
        organicTraffic: 5400,
        organicCost: 12400,
        paidKeywords: 0,
        paidTraffic: 0,
        paidCost: 0,
      },
      backlinks: { totalBacklinks: 3100, referringDomains: 220 },
      topKeywords: [
        {
          keyword: 'emergency dentist austin',
          position: 2,
          volume: 900,
          difficulty: 41,
          url: 'https://rival.com/emergency',
          traffic: 410,
        },
      ],
      authorityRank: 55,
      top3Keywords: 32,
    },
  ],
  keywordGaps: [
    {
      keyword: 'emergency dentist austin',
      volume: 900,
      difficulty: 41,
      competitorPosition: 2,
      competitorDomain: 'rival.com',
    },
  ],
  fetchedAt: '2026-07-06T16:30:00.000Z',
  degraded: false,
  providerFailures: [],
};

const competitorAlertsPayload = {
  workspaceId,
  lastSnapshotDate: '2026-07-06',
  alerts: [
    {
      id: 'alert-1',
      competitorDomain: 'rival.com',
      alertType: 'keyword_gained',
      keyword: 'emergency dentist austin',
      previousPosition: 7,
      currentPosition: 2,
      positionChange: 5,
      volume: 900,
      severity: 'opportunity',
      snapshotDate: '2026-07-06',
      insightId: 'insight-1',
      createdAt: '2026-07-06T12:00:00.000Z',
    },
  ],
};

function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  client.setQueryData(queryKeys.shared.featureFlags(), featureFlagResponse);
  client.setQueryData(queryKeys.admin.workspaces(), [{ id: workspaceId, name: 'Client Workspace' }]);
  client.setQueryData(queryKeys.admin.competitorAlerts(workspaceId), competitorAlertsPayload);
  return client;
}

function renderSurface(client = createQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <CompetitorsSurface workspaceId={workspaceId} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function FlaggedCompetitors() {
  const enabled = useFeatureFlag('ui-rebuild-shell');
  return enabled ? <CompetitorsSurface workspaceId={workspaceId} /> : <div data-testid="legacy-competitors">Legacy competitors</div>;
}

function renderFlagged(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  client.setQueryData(queryKeys.admin.workspaces(), [{ id: workspaceId, name: 'Client Workspace' }]);
  return {
    queryClient: client,
    ...render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <FlaggedCompetitors />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedWorkspaceHandlers = {};
  featureFlagsListMock.mockReturnValue(new Promise(() => {}));
  apiGetMock.mockResolvedValue(competitiveIntelData);
  keywordStrategyMock.mockReturnValue({
    data: keywordStrategyData,
    isLoading: false,
    isAuxLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  competitorAlertsMock.mockReturnValue({
    alerts: competitorAlertsPayload.alerts,
    isLoading: false,
    isError: false,
  });
  backlinkProfileMock.mockReturnValue({
    data: {
      overview: {
        totalBacklinks: 2500,
        referringDomains: 180,
        followLinks: 1900,
        textLinks: 2300,
        imageLinks: 200,
      },
      referringDomains: [
        {
          domain: 'directory.example',
          backlinksCount: 42,
          firstSeen: '2026-01-01',
          lastSeen: '2026-07-01',
        },
      ],
    },
    isLoading: false,
    error: null,
  });
  recommendationSetMock.mockReturnValue({
    data: { recommendations: [] },
    isLoading: false,
    error: null,
  });
});

describe('CompetitorsSurface', () => {
  it('mounts through a real feature-flag loading to loaded transition', async () => {
    const { queryClient } = renderFlagged();

    expect(screen.getByTestId('legacy-competitors')).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(queryKeys.shared.featureFlags(), featureFlagResponse);
      queryClient.setQueryData(queryKeys.admin.competitorAlerts(workspaceId), competitorAlertsPayload);
    });

    expect(await screen.findByRole('heading', { name: 'Competitors' })).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-competitors')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Share of voice' })).toBeInTheDocument();
  });

  it('renders the rebuilt competitors admin surface with seeded feature flags and passes the a11y floor', async () => {
    const { container } = renderSurface();

    expect(await screen.findByRole('heading', { name: 'Competitors' })).toBeInTheDocument();
    expect(await screen.findByText('Share of voice')).toBeInTheDocument();
    expect(screen.getAllByText('rival.com').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Send to client/i })).toBeInTheDocument();
    expect(Object.keys(capturedWorkspaceHandlers)).toContain('strategy:updated');

    // Every section loads independently; wait for ALL skeletons to clear so axe
    // never runs against a mid-settle DOM (the source of the intermittent a11y flake).
    await waitFor(() => {
      expect(container.querySelectorAll('.animate-pulse').length).toBe(0);
    });
    await expectNoA11yViolations(container);
  });

  it('renders the prototype section stack without top tabs or internal implementation labels', async () => {
    const { container } = renderSurface();

    const surface = screen.getByTestId('competitors-surface');
    expect(surface).toHaveClass('max-w-[1120px]', 'sm:px-[30px]');
    expect(await screen.findByRole('heading', { name: 'Competitor alerts' })).toBeInTheDocument();
    const alertFeed = screen.getByRole('list', { name: 'Competitor alert feed' });
    expect(within(alertFeed).getByText('rival.com')).toHaveClass('t-ui');
    expect(within(alertFeed).getByText('emergency dentist austin')).toHaveClass('t-label');
    expect(within(alertFeed).getByText('#7 → #2')).toHaveClass('text-[var(--blue)]');
    expect(within(alertFeed).queryByRole('grid')).not.toBeInTheDocument();
    const header = screen.getByLabelText('Competitive intelligence header');
    expect(within(header).getByText('Competitive intelligence · Client Workspace')).toBeInTheDocument();
    expect(within(header).getByText(/Weekly check/)).toBeInTheDocument();
    expect(await within(header).findByText(/Last scanned/)).toBeInTheDocument();
    expect(within(header).getByText('rival.com')).toBeInTheDocument();
    expect(within(header).getByText('clinic.example')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Edit set' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Re-scan' })).toHaveLength(1);

    const sectionHeadings = [
      await screen.findByRole('heading', { name: 'Competitor alerts' }),
      await screen.findByRole('heading', { name: 'Share of voice' }),
      screen.getByRole('heading', { name: 'Head-to-head' }),
      screen.getByRole('heading', { name: 'Keyword gaps' }),
      screen.getByRole('heading', { name: 'Backlink profile' }),
    ];
    for (let index = 1; index < sectionHeadings.length; index += 1) {
      expect(sectionHeadings[index - 1].compareDocumentPosition(sectionHeadings[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getAllByRole('meter')).toHaveLength(2);
    expect(screen.getByText('Total backlinks')).toBeInTheDocument();
    expect(screen.getByText('Top referring domains')).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Competitor set controls' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Raw Competitor Evidence|provider terms|cached data|projection|migration|rebuild|mounted below/i);
  });

  it('opens the competitor detail drawer exactly once from a competitor row', async () => {
    renderSurface();

    await screen.findByRole('heading', { name: 'Head-to-head' });
    await screen.findByText('5,400');
    const rows = screen.getAllByRole('row');
    const competitorRow = rows.find((row) => row.textContent?.includes('rival.com') && row.textContent?.includes('5,400'));
    expect(competitorRow).toBeTruthy();

    fireEvent.click(competitorRow!);

    const dialogs = await screen.findAllByRole('dialog', { name: 'rival.com' });
    expect(dialogs).toHaveLength(1);
    expect(screen.getByText('Domain comparison and top keyword evidence.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'rival.com' })).not.toBeInTheDocument());
  });

  it('routes gap actions to Keyword Hub and Briefs without adding local write paths', async () => {
    renderSurface();

    expect(await screen.findByRole('heading', { name: 'Keyword gaps' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /View in Hub/i }));
    const expectedHubLink = `/ws/ws-competitors-rebuilt/seo-keywords${buildHubDeepLinkQuery({ keyword: 'emergency dentist austin' })}`;
    expect(navigateMock.mock.calls.some(([path]) => (
      String(path) === expectedHubLink
    ))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Create brief/i }));
    expect(navigateMock).toHaveBeenCalledWith('/ws/ws-competitors-rebuilt/content-pipeline?tab=briefs', {
      state: {
        fixContext: {
          targetRoute: 'content-pipeline',
          primaryKeyword: 'emergency dentist austin',
          pageName: 'emergency dentist austin',
        },
      },
    });
  });

  it('shows the provider setup state without rendering live tables when SEO data is unavailable', async () => {
    keywordStrategyMock.mockReturnValue({
      data: {
        ...keywordStrategyData,
        seoDataAvailable: false,
        providers: [{ name: 'dataforseo', configured: false }],
      },
      isLoading: false,
      isAuxLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderSurface();

    expect(await screen.findByText('Connect an SEO data provider')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Workspace Settings/i })).toBeInTheDocument();
    expect(apiGetMock).not.toHaveBeenCalled();
  });
});
