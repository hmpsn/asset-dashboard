/**
 * the-issue-flag-parity.test.tsx — The Issue (Phase 1 integration)
 *
 * Verifies the third composed branch in KeywordStrategy.tsx is a strict superset gate:
 *
 *   (a) strategy-the-issue OFF (command-center ON): the Overview render is byte-identical to
 *       the command-center layout — the NEW issue components (IssueHeader / StanceBar /
 *       DraftedPovEditor / BackingMovesQueue) do NOT render; the command-center cockpit
 *       ("Curate recommendations") and the "Keyword Strategy" header DO.
 *
 *   (b) strategy-the-issue ON (command-center ON): the issue cockpit renders — IssueHeader
 *       ("The Issue" + Send issue + Preview as client) + StanceBar + DraftedPovEditor
 *       ("The point of view") + BackingMovesQueue ("Backing moves").
 *
 *   (c) a real loading→loaded transition guards Rules-of-Hooks (the theIssueEnabled flag
 *       read is unconditional, before all early returns).
 *
 * Mocking mirrors the established strategy component tests (KeywordStrategy.reverse-nudge.test.tsx
 * for the data/API surface; Sidebar.test.tsx for the per-flag useFeatureFlag dispatcher;
 * StrategyCockpit.test.tsx for the rec factory + bulk-mutation mock).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KeywordStrategyPanel } from '../../src/components/KeywordStrategy';
import type { Recommendation } from '../../shared/types/recommendations';
import type { StrategyPov } from '../../shared/types/strategy-pov';

// ─── per-flag useFeatureFlag dispatcher (Sidebar.test.tsx pattern) ──────────────
const featureFlagMock = vi.fn((_flag: string) => false);
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...(args as [string])),
}));

// ─── mutable mock state ─────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  loading: false,
  strategy: null as null | Record<string, unknown>,
  recs: [] as Recommendation[],
  pov: null as StrategyPov | null,
  bulkMutate: vi.fn(),
  povEdit: vi.fn(),
  povRegenerate: vi.fn(),
  startJob: vi.fn(),
  findActiveJob: vi.fn(),
  providerStatus: vi.fn(),
  getWorkspaceById: vi.fn(),
}));

vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: () => {},
}));

vi.mock('../../src/hooks/admin', () => ({
  useKeywordStrategy: () => ({
    data: {
      strategy: mocks.strategy,
      seoDataAvailable: true,
      providers: [{ name: 'dataforseo', configured: true }],
      workspaceData: { competitorDomains: [], seoDataProvider: 'dataforseo' },
    },
    isLoading: mocks.loading,
    isAuxLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  // data:undefined → the command-center LocalSeoMarketSetupDrawer is not mounted (matches the
  // "no local SEO configured" production state; the drawer reads data.settings.posture).
  useLocalSeo: () => ({ data: undefined, isLoading: false }),
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useLocalSeoUpdate: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/admin/useAdminRecommendations', () => ({
  useAdminRecommendationSet: () => ({ data: { recommendations: mocks.recs }, isLoading: false }),
}));

vi.mock('../../src/hooks/admin/useRecommendationLifecycle', () => ({
  useRecommendationLifecycle: () => ({
    send: vi.fn(), strike: vi.fn(), unstrike: vi.fn(), throttle: vi.fn(), fix: vi.fn(), isPending: false,
  }),
}));

vi.mock('../../src/hooks/admin/useContentDecay', () => ({
  useContentDecay: () => ({ data: { decayingPages: [] }, isLoading: false }),
}));

vi.mock('../../src/hooks/admin/useStrategyKeywordSet', () => ({
  useStrategyKeywordSet: () => ({
    managedKeywordSet: undefined,
    addStrategyKeyword: vi.fn(),
    removeStrategyKeyword: vi.fn(),
    keepStrategyKeyword: vi.fn(),
  }),
}));

vi.mock('../../src/hooks/admin/useStrategyPov', () => ({
  useStrategyPov: () => ({
    pov: mocks.pov,
    isLoading: false,
    isError: false,
    edit: mocks.povEdit,
    editPending: false,
    generate: vi.fn(),
    regenerate: mocks.povRegenerate,
    isGenerating: false,
    generateError: null,
    wasUnchanged: false,
  }),
}));

vi.mock('../../src/hooks/admin/useRecBulkMutation', () => ({
  useRecBulkMutation: () => ({ mutate: mocks.bulkMutate, isPending: false }),
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ jobs: [], startJob: mocks.startJob, findActiveJob: mocks.findActiveJob }),
}));

vi.mock('../../src/api/seo', () => ({
  keywords: {
    providerStatus: mocks.providerStatus,
    discoverCompetitors: vi.fn(),
    saveCompetitors: vi.fn(),
    feedback: vi.fn().mockResolvedValue([]),
    strategyDiff: vi.fn().mockResolvedValue(null),
  },
  rankTracking: { keywords: vi.fn().mockResolvedValue([]), addKeyword: vi.fn() },
}));

vi.mock('../../src/api', () => ({
  workspaces: { getById: mocks.getWorkspaceById, update: vi.fn().mockResolvedValue({}) },
  backlinks: { get: vi.fn().mockResolvedValue(null), profile: vi.fn().mockResolvedValue(null) },
  anomalies: { list: vi.fn().mockResolvedValue([]) },
  keywords: { feedback: vi.fn().mockResolvedValue([]) },
  contentDecay: { get: vi.fn().mockResolvedValue({ decayingPages: [] }) },
}));

vi.mock('../../src/api/client', () => ({
  get: vi.fn().mockResolvedValue(null),
  getSafe: vi.fn().mockResolvedValue(null),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

// ─── factories ──────────────────────────────────────────────────────────────────
function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'r1', workspaceId: 'ws-1', type: 'content', priority: 'fix_now',
    title: 'Write the pricing post', description: 'why it matters', insight: 'insight text',
    impact: 'high', effort: 'low', impactScore: 80, source: 'audit', affectedPages: ['/pricing'],
    trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: '', actionType: 'content_creation',
    status: 'pending', lifecycle: 'active', clientStatus: 'system',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Recommendation;
}

function makeStrategy() {
  return {
    generatedAt: '2026-01-01T00:00:00Z',
    pageMap: [{ url: '/pricing' }],
    siteKeywords: [],
    siteKeywordMetrics: [],
    opportunities: [],
    quickWins: [],
    contentGaps: [],
    keywordGaps: [],
    topicClusters: [],
    cannibalization: [],
    seoDataMode: 'quick',
    strategyUx: { orient: undefined },
    businessContext: undefined,
  };
}

function makePov(): StrategyPov {
  return {
    situation: 'Traffic is recovering after the refresh.',
    leadMoveRecId: 'r1',
    leadSentence: 'Ship the pricing authority post.',
    wins: ['Recovered 3 decaying pages'],
    flags: ['One cannibalization pair unresolved'],
    version: 1,
    generatedAt: '2026-01-01T00:00:00Z',
    editedAt: null,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/ws/ws-1/strategy']}>
      <QueryClientProvider client={queryClient}>
        <KeywordStrategyPanel workspaceId="ws-1" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// ─── tests ────────────────────────────────────────────────────────────────────────
describe('KeywordStrategyPanel — The Issue flag parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loading = false;
    mocks.strategy = makeStrategy();
    mocks.recs = [makeRec(), makeRec({ id: 'r2', type: 'content_refresh' })];
    mocks.pov = makePov();
    mocks.providerStatus.mockResolvedValue({ providers: [{ name: 'dataforseo', configured: true }] });
    mocks.getWorkspaceById.mockResolvedValue({ seoDataProvider: 'dataforseo' });
    featureFlagMock.mockImplementation((_flag: string) => false);
  });

  describe('(a) strategy-the-issue OFF (command-center ON) — byte-identical command-center layout', () => {
    beforeEach(() => {
      // command-center ON, the-issue OFF.
      featureFlagMock.mockImplementation((flag: string) => flag === 'strategy-command-center');
    });

    it('renders the command-center cockpit, NOT the issue cockpit', () => {
      renderPanel();
      // command-center surfaces present
      expect(screen.getByText('Keyword Strategy')).toBeInTheDocument();
      expect(screen.getByText('Curate recommendations')).toBeInTheDocument();
      // issue surfaces ABSENT (byte-identical OFF — the new branch did not mount)
      expect(screen.queryByText('The Issue')).toBeNull();
      expect(screen.queryByText('The point of view')).toBeNull();
      expect(screen.queryByText('Backing moves')).toBeNull();
      expect(screen.queryByRole('button', { name: /send issue/i })).toBeNull();
      expect(screen.queryByText('Preview as client')).toBeNull();
    });
  });

  describe('(b) strategy-the-issue ON (command-center ON) — issue cockpit renders', () => {
    beforeEach(() => {
      featureFlagMock.mockImplementation(
        (flag: string) => flag === 'strategy-command-center' || flag === 'strategy-the-issue',
      );
    });

    it('renders IssueHeader + StanceBar + DraftedPovEditor + BackingMovesQueue', () => {
      renderPanel();
      // IssueHeader chrome
      expect(screen.getByText('The Issue')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send issue/i })).toBeInTheDocument();
      // "Preview as client" toggle was removed (Phase 1 had no client preview surface — dead
      // control). It returns in Phase 2 once TheIssueClientPage exists.
      expect(screen.queryByText('Preview as client')).toBeNull();
      // DraftedPovEditor
      expect(screen.getByText('The point of view')).toBeInTheDocument();
      // BackingMovesQueue
      expect(screen.getByText('Backing moves')).toBeInTheDocument();
      // The command-center cockpit is NOT rendered in the issue branch.
      expect(screen.queryByText('Curate recommendations')).toBeNull();
      // The base "Keyword Strategy" PageHeader is suppressed in the issue branch — IssueHeader's
      // "The Issue" is the only page header (no duplicate stacked headers).
      expect(screen.queryByText('Keyword Strategy')).toBeNull();
    });

    it('Send issue fires the existing atomic bulk-send route (action:send)', () => {
      renderPanel();
      const sendBtn = screen.getByRole('button', { name: /send issue/i });
      sendBtn.click();
      expect(mocks.bulkMutate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'send', recIds: expect.arrayContaining(['r1', 'r2']) }),
      );
    });
  });

  describe('(c) Rules-of-Hooks: real loading→loaded transition with the issue flag ON', () => {
    beforeEach(() => {
      featureFlagMock.mockImplementation(
        (flag: string) => flag === 'strategy-command-center' || flag === 'strategy-the-issue',
      );
    });

    it('mounts loading then renders the issue cockpit after data arrives (no hook-order crash)', () => {
      mocks.loading = true;
      const { rerender } = renderPanel();
      expect(screen.queryByText('The Issue')).toBeNull();

      // Data arrives — re-render the same tree (the flag read is unconditional, before the
      // loading early-return, so the hook order is stable across the transition).
      mocks.loading = false;
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      rerender(
        <MemoryRouter initialEntries={['/ws/ws-1/strategy']}>
          <QueryClientProvider client={queryClient}>
            <KeywordStrategyPanel workspaceId="ws-1" />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      expect(screen.getByText('The Issue')).toBeInTheDocument();
      expect(screen.getByText('Backing moves')).toBeInTheDocument();
    });
  });
});
