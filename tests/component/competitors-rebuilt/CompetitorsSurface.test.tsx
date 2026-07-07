import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/components/Toast';
import { CompetitorsSurface } from '../../../src/components/competitors-rebuilt/CompetitorsSurface';
import { queryKeys } from '../../../src/lib/queryKeys';
import { expectNoA11yViolations } from '../a11y';

const keywordStrategyMock = vi.fn();
const apiGetMock = vi.fn();
const competitorAlertsMock = vi.fn();
const backlinkProfileMock = vi.fn();
const recommendationSetMock = vi.fn();
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
  client.setQueryData(queryKeys.shared.featureFlags(), {
    'strategy-command-center': true,
    'strategy-competitor-send': true,
  });
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

beforeEach(() => {
  vi.clearAllMocks();
  capturedWorkspaceHandlers = {};
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

    expect(await screen.findByText('Competitive intelligence requires DataForSEO')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Workspace Settings/i })).toBeInTheDocument();
    expect(apiGetMock).not.toHaveBeenCalled();
  });
});
