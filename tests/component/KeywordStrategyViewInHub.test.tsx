import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KeywordStrategyPanel } from '../../src/components/KeywordStrategy';
import { readHubDeepLink } from '../../src/lib/keywordHubDeepLink';
import { keywordTrackingKey } from '../../src/lib/keywordTracking';

const { navigateMock, featureFlagMock, addKeywordMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  featureFlagMock: vi.fn(),
  addKeywordMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...args),
}));

const strategyFixture = {
  generatedAt: '2026-06-01T10:00:00.000Z',
  siteKeywords: ['cosmetic dentistry', 'teeth whitening'],
  siteKeywordMetrics: [],
  opportunities: [],
  pageMap: [],
};

vi.mock('../../src/hooks/admin', () => ({
  useKeywordStrategy: () => ({
    data: {
      strategy: strategyFixture,
      seoDataAvailable: true,
      providers: [{ name: 'dataforseo', configured: true }],
      workspaceData: { competitorDomains: [], seoDataProvider: 'dataforseo' },
    },
    isLoading: false,
    isAuxLoading: false,
  }),
  useLocalSeo: () => ({ data: { featureEnabled: false }, isLoading: false }),
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useLocalSeoUpdate: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ jobs: [], startJob: vi.fn(), findActiveJob: () => undefined }),
}));

vi.mock('../../src/api/seo', () => ({
  keywords: {
    providerStatus: vi.fn().mockResolvedValue({ providers: [] }),
    discoverCompetitors: vi.fn(),
    saveCompetitors: vi.fn(),
    feedback: vi.fn().mockResolvedValue([]),
    strategyDiff: vi.fn().mockResolvedValue(null),
  },
  rankTracking: { keywords: vi.fn().mockResolvedValue([]), addKeyword: addKeywordMock },
}));

vi.mock('../../src/api', () => ({
  workspaces: { getById: vi.fn().mockResolvedValue({ seoDataProvider: 'dataforseo' }), update: vi.fn().mockResolvedValue({}) },
  backlinks: { profile: vi.fn().mockResolvedValue(null), get: vi.fn().mockResolvedValue(null) },
  anomalies: { list: vi.fn().mockResolvedValue([]) },
  keywords: { feedback: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../src/api/client', () => ({
  get: vi.fn().mockResolvedValue(null),
  post: vi.fn(),
  del: vi.fn(),
}));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/ws/ws-1/seo-strategy']}>
      <QueryClientProvider client={queryClient}>
        <KeywordStrategyPanel workspaceId="ws-1" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('KeywordStrategy — View in Hub deep-link sender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateMock.mockReset();
  });

  it('renders BOTH a Track control AND a View in Hub control on the chip', () => {
    renderPanel();
    expect(screen.getAllByRole('button', { name: /view in hub/i }).length).toBeGreaterThan(0);
    // Track control still present (label "Track" or "Tracking").
    expect(screen.getAllByRole('button', { name: /^track/i }).length).toBeGreaterThan(0);
  });

  it('View in Hub navigates to a /seo-keywords path whose q is keywordTrackingKey(kw)', () => {
    renderPanel();
    const viewButtons = screen.getAllByRole('button', { name: /view in hub/i });
    fireEvent.click(viewButtons[0]);
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const target = navigateMock.mock.calls[0][0] as string;
    expect(target).toContain('/seo-keywords');
    const [, qs] = target.split('?');
    const parsed = readHubDeepLink(new URLSearchParams(qs));
    expect(parsed.query).toBe(keywordTrackingKey('cosmetic dentistry'));
  });

  it('Track still fires the existing trackKeyword path (addKeyword API)', () => {
    renderPanel();
    const trackButtons = screen.getAllByRole('button', { name: /^track/i });
    fireEvent.click(trackButtons[0]);
    expect(addKeywordMock).toHaveBeenCalledWith('ws-1', { query: 'cosmetic dentistry' });
  });

  it('the Track control no longer renders the literal "Rank Tracker" copy', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: /track in rank tracker/i })).toBeNull();
  });
});
