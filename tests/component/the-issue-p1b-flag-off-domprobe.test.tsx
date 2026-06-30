/**
 * the-issue-p1b-flag-off-domprobe.test.tsx — The Issue (Client) P1b Lane D, D7 verification gate.
 *
 * The CONSOLIDATED flag-OFF DOM probe (the highest-value Lane D gap). All three P1b surfaces carry a
 * deterministic test hook on their root node:
 *   - IssueExportBar          → [data-p1b]            (client export affordance)
 *   - IssueYourLeadsSection   → [data-p1b]            (client own-leads view)
 *   - IssueSetupReadiness     → [data-p1b-readiness]  (admin cockpit readiness checklist)
 *
 * This is the design-system "5 verification layers" lesson (feedback_phase5_multilayer_verification):
 * typecheck + build + pr-check + unit can ALL pass while a flag-OFF surface silently grows DOM nodes.
 * A real render-tree probe is the only thing that catches it. Per-surface flag-OFF tests already exist
 * (the-issue-export-bar.test.tsx for the client page; issue-cockpit-readiness-flag-off.test.tsx for the
 * cockpit) — this file is the ONE place that asserts the WHOLE P1b family contributes ZERO nodes when
 * BOTH P1b flags are OFF, across BOTH the client page AND the admin cockpit, with a positive control.
 *
 * Flag posture: the two P1b child flags are `the-issue-client-measured-capture` (admin readiness +
 * admin leads) and `the-issue-client-return-hook` (client export + client leads). Both default-OFF;
 * no net-new flag was created (DR-6). The P1a/P0 spine (`the-issue-client-spine` / strategy-the-issue)
 * stays ON in every scenario so the probe isolates the P1b delta against the pre-P1b baseline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { NamedLeadView } from '../../shared/types/the-issue';

// ── Per-flag useFeatureFlag dispatcher (Sidebar.test.tsx / conversion-tracking pattern) ──────────
// One hoisted mock drives BOTH surfaces. Each scenario installs an implementation that returns the
// exact flag posture under test; the client page additionally honors prop overrides (its blessed
// Rules-of-Hooks-safe path), and we set BOTH so the two halves agree.
const featureFlagMock = vi.fn((_flag: string) => false);
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...(args as [string])),
}));

// ── Client page light deps: the curated-feed query + the export URL/leads wrappers ───────────────
// Resolve the feed deterministically so the spine branch renders (not the loading skeleton).
vi.mock('../../src/components/client/the-issue/useClientTheIssue', () => ({
  useClientTheIssue: () => ({
    data: {
      workspaceId: 'ws-1',
      generatedAt: new Date(0).toISOString(),
      recommendations: [],
      summary: {
        fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0,
        totalImpactScore: 0, trafficAtRisk: 0, topRecommendationId: null,
      },
    },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('../../src/api/conversionTracking', () => ({
  getOnePagerExportUrl: (wsId: string) => `/api/public/export/${wsId}/one-pager`,
  getMyLeads: vi.fn(async () => ({ leads: [] })),
}));

const myLeadsMock = vi.fn<() => { leads: NamedLeadView[]; isLoading: boolean; isError: boolean }>(
  () => ({ leads: [], isLoading: false, isError: false }),
);
vi.mock('../../src/hooks/client', async (importActual) => ({
  ...(await importActual<typeof import('../../src/hooks/client')>()),
  useClientMyLeads: (_wsId: string, _enabled?: boolean) => myLeadsMock(),
}));

// ── Admin cockpit harness (mirrors issue-cockpit-readiness-flag-off.test.tsx) ────────────────────
const strategyFixture = {
  generatedAt: '2026-06-01T10:00:00.000Z',
  siteKeywords: ['cosmetic dentistry'],
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
  useLocalSeo: () => ({
    data: { featureEnabled: false, markets: [], settings: { posture: 'national', keywordsPerRefresh: null } },
    isLoading: false,
  }),
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useLocalSeoUpdate: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ jobs: [], startJob: vi.fn(), findActiveJob: () => undefined }),
}));

vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: () => {},
}));

vi.mock('../../src/components/local-seo/LocalSeoMarketSetupDrawer', () => ({
  LocalSeoMarketSetupDrawer: () => null,
}));

vi.mock('../../src/api/seo', () => ({
  keywords: {
    providerStatus: vi.fn().mockResolvedValue({ providers: [] }),
    discoverCompetitors: vi.fn(),
    saveCompetitors: vi.fn(),
    feedback: vi.fn().mockResolvedValue([]),
    strategyDiff: vi.fn().mockResolvedValue(null),
  },
  rankTracking: { keywords: vi.fn().mockResolvedValue([]), addKeyword: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/api', () => ({
  workspaces: { getById: vi.fn().mockResolvedValue({ seoDataProvider: 'dataforseo' }), update: vi.fn().mockResolvedValue({}) },
  backlinks: { profile: vi.fn().mockResolvedValue(null), get: vi.fn().mockResolvedValue(null) },
  anomalies: { list: vi.fn().mockResolvedValue([]) },
  keywords: { feedback: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../src/api/client', () => ({
  get: vi.fn().mockResolvedValue(null),
  getSafe: vi.fn().mockResolvedValue(null),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

// The two Lane B cockpit hooks — controlled per-scenario.
const statusHookMock = vi.fn(() => ({ status: undefined as unknown, isLoading: false, isError: false }));
vi.mock('../../src/hooks/admin/useConversionTrackingStatus', () => ({
  useConversionTrackingStatus: () => statusHookMock(),
}));
const leadsHookMock = vi.fn(() => ({ leads: [], total: 0, isLoading: false, isError: false }));
vi.mock('../../src/hooks/admin/useAdminLeads', () => ({
  useAdminLeads: () => leadsHookMock(),
}));

import { KeywordStrategyPanel } from '../../src/components/KeywordStrategy';
import { TheIssueClientPage } from '../../src/components/client/the-issue/TheIssueClientPage';
import type { SetupReadinessState } from '../../shared/types/the-issue';
import type { ConversionTrackingStatus } from '../../src/api/conversionTracking';

const GAPS: SetupReadinessState = {
  ga4Connected: false,
  valueSet: false,
  basisOfValue: null,
  outcomeValueLabel: null,
  segmentConfirmed: false,
  segmentLabel: 'b2b saas',
  eventsPinned: false,
  eventsTyped: false,
  webflowConnected: false,
  conversionTrackingConfirmedAt: null,
  lastLeadAt: null,
  povDrafted: false,
  resolvedProvenance: 'estimate_ga4',
  openGapCount: 6,
};

const STATUS_WITH_READINESS: ConversionTrackingStatus = {
  pinnedCount: 0,
  typedCount: 0,
  formCaptureConnected: false,
  lastSubmissionAt: null,
  submissionCount: 0,
  recentOutcomeCount: 0,
  readiness: GAPS,
};

// Spine ON (the pre-P1b baseline), P1b children driven by the booleans.
function flagPosture({ measuredCapture, returnHook }: { measuredCapture: boolean; returnHook: boolean }) {
  return (flag: string) => {
    if (flag === 'strategy-command-center' || flag === 'strategy-the-issue' || flag === 'the-issue-client-spine') return true;
    if (flag === 'the-issue-client-measured-capture') return measuredCapture;
    if (flag === 'the-issue-client-return-hook') return returnHook;
    return false;
  };
}

const clientBaseProps = {
  workspaceId: 'ws-1',
  effectiveTier: 'growth' as const,
  betaMode: false,
  actionCounts: { approvals: 0, briefs: 0, posts: 0, replies: 0, contentPlan: 0 },
  overview: null,
  ga4Overview: null,
  ga4Conversions: [],
  audit: null,
  strategyData: null,
  onAskAi: vi.fn(),
  onOpenChat: vi.fn(),
};

function renderClientPage(extra: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  return render(<TheIssueClientPage {...clientBaseProps} {...extra} />, { wrapper });
}

function renderCockpit() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/ws/ws-1/seo-strategy']}>
      <QueryClientProvider client={qc}>
        <KeywordStrategyPanel workspaceId="ws-1" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  myLeadsMock.mockReturnValue({ leads: [], isLoading: false, isError: false });
  statusHookMock.mockReturnValue({ status: undefined, isLoading: false, isError: false });
  leadsHookMock.mockReturnValue({ leads: [], total: 0, isLoading: false, isError: false });
});

// ── 1. Both P1b flags OFF → ZERO P1b nodes on EITHER surface (byte-identical to pre-P1b) ──────────
describe('P1b flag-OFF DOM probe — both flags OFF → no P1b nodes (byte-identical to pre-P1b)', () => {
  it('client TheIssueClientPage: no [data-p1b] node when the return-hook flag is OFF', () => {
    featureFlagMock.mockImplementation(flagPosture({ measuredCapture: false, returnHook: false }));
    // Spine ON via prop (the P1a baseline) + return-hook OFF via prop AND flag (the two halves agree).
    const { container } = renderClientPage({ theIssueClientSpine: true, theIssueReturnHook: false });
    // The P1a baseline spine still renders (the verdict slot is the pre-P1b surface).
    expect(screen.getByTestId('the-issue-client-page')).toBeInTheDocument();
    expect(screen.getByTestId('slot-verdict')).toBeInTheDocument();
    // ZERO P1b additions: neither the export bar nor the own-leads section mounted.
    expect(container.querySelector('[data-p1b]')).toBeNull();
    expect(container.querySelector('[data-testid="issue-export-bar"]')).toBeNull();
    expect(container.querySelector('[data-testid="issue-your-leads"]')).toBeNull();
  });

  it('admin cockpit: no [data-p1b-readiness] node when measured-capture is OFF', () => {
    featureFlagMock.mockImplementation(flagPosture({ measuredCapture: false, returnHook: false }));
    // Even if the status hook somehow surfaced readiness, the OFF gate must suppress the mount.
    statusHookMock.mockReturnValue({ status: STATUS_WITH_READINESS, isLoading: false, isError: false });
    const { container } = renderCockpit();
    // The P1a/P0 cockpit spine still renders.
    expect(screen.getByRole('button', { name: /send issue/i })).toBeInTheDocument();
    // ZERO P1b additions: the readiness checklist + the leads readout are absent.
    expect(container.querySelector('[data-p1b-readiness]')).toBeNull();
    expect(screen.queryByText('Conversion tracking')).toBeNull();
    expect(screen.queryByText('Captured leads')).toBeNull();
  });

  it('combined: NEITHER surface contributes any [data-p1b]/[data-p1b-readiness] node when both flags OFF', () => {
    featureFlagMock.mockImplementation(flagPosture({ measuredCapture: false, returnHook: false }));
    statusHookMock.mockReturnValue({ status: STATUS_WITH_READINESS, isLoading: false, isError: false });
    const client = renderClientPage({ theIssueClientSpine: true, theIssueReturnHook: false });
    const cockpit = renderCockpit();
    for (const probe of ['[data-p1b]', '[data-p1b-readiness]']) {
      expect(client.container.querySelector(probe)).toBeNull();
      expect(cockpit.container.querySelector(probe)).toBeNull();
    }
  });
});

// ── 2. Positive control — flags ON → the P1b nodes DO appear (the probe is wired, not vacuous) ────
describe('P1b flag-ON positive control — the P1b nodes DO appear (probe is non-vacuous)', () => {
  it('client TheIssueClientPage: [data-p1b] appears when the return-hook flag is ON', () => {
    featureFlagMock.mockImplementation(flagPosture({ measuredCapture: false, returnHook: true }));
    const { container } = renderClientPage({ theIssueClientSpine: true, theIssueReturnHook: true });
    expect(container.querySelector('[data-p1b]')).not.toBeNull();
    expect(screen.getByTestId('issue-export-bar')).toBeInTheDocument();
    // The own-leads section also mounts (inside the "Under the hood" disclosure body) in client view.
    expect(screen.getByTestId('issue-your-leads')).toBeInTheDocument();
  });

  it('admin cockpit: [data-p1b-readiness] appears when measured-capture is ON', () => {
    featureFlagMock.mockImplementation(flagPosture({ measuredCapture: true, returnHook: false }));
    statusHookMock.mockReturnValue({ status: STATUS_WITH_READINESS, isLoading: false, isError: false });
    const { container } = renderCockpit();
    expect(container.querySelector('[data-p1b-readiness]')).not.toBeNull();
    expect(screen.getByText('Conversion tracking')).toBeInTheDocument();
  });
});
