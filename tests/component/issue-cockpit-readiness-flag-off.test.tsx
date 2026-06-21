/**
 * Lane B (B5) — cockpit mount of the setup-readiness checklist + named-leads readout (flag-gated).
 *
 * Holistic flag-OFF parity: with the-issue-client-measured-capture mocked OFF, the readiness panel
 * ("Conversion tracking" header + data-p1b-readiness) and the leads readout ("Captured leads"
 * header) are BOTH absent, while the P0/P1a spine (IssueHeader "Send issue") still renders. With the
 * flag ON + a readiness fixture with gaps, the readiness panel renders above the spine and the leads
 * readout mounts inside the "Supporting detail" disclosure.
 *
 * Reuses the cockpit render harness (mock surface) from KeywordStrategyViewInHub.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { SetupReadinessState } from '../../shared/types/the-issue';
import type { ConversionTrackingStatus } from '../../src/api/conversionTracking';

const { navigateMock, featureFlagMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  featureFlagMock: vi.fn(),
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

// The local-SEO setup drawer is heavy + pulls many local-seo hooks; it is not under test here.
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
  post: vi.fn(),
  del: vi.fn(),
}));

// The two Lane B hooks the cockpit consumes — controlled per-test.
const statusHookMock = vi.fn<() => { status: ConversionTrackingStatus | undefined; isLoading: boolean; isError: boolean }>(
  () => ({ status: undefined, isLoading: false, isError: false }),
);
vi.mock('../../src/hooks/admin/useConversionTrackingStatus', () => ({
  useConversionTrackingStatus: () => statusHookMock(),
}));
const leadsHookMock = vi.fn(() => ({ leads: [], total: 0, isLoading: false, isError: false }));
vi.mock('../../src/hooks/admin/useAdminLeads', () => ({
  useAdminLeads: () => leadsHookMock(),
}));

import { KeywordStrategyPanel } from '../../src/components/KeywordStrategy';

const GAPS: SetupReadinessState = {
  ga4Connected: false,
  valueSet: false,
  basisOfValue: null,
  segmentConfirmed: false,
  eventsPinned: false,
  eventsTyped: false,
  webflowConnected: false,
  conversionTrackingConfirmedAt: null,
  lastLeadAt: null,
  povDrafted: false,
  openGapCount: 7,
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

// theIssueEnabled = strategy-command-center && strategy-the-issue. measuredCapture is the P1b gate.
function flags(measuredCapture: boolean) {
  return (flag: string) => {
    if (flag === 'strategy-command-center' || flag === 'strategy-the-issue') return true;
    if (flag === 'the-issue-client-measured-capture') return measuredCapture;
    return false;
  };
}

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

beforeEach(() => {
  vi.clearAllMocks();
  statusHookMock.mockReturnValue({ status: undefined, isLoading: false, isError: false });
  leadsHookMock.mockReturnValue({ leads: [], total: 0, isLoading: false, isError: false });
});

describe('Cockpit P1b mount — flag OFF byte-identical (B5)', () => {
  it('renders NEITHER the readiness panel NOR the leads readout when measured-capture is OFF', () => {
    featureFlagMock.mockImplementation(flags(false));
    // Even if the hook somehow returned readiness, the OFF gate must suppress the mount.
    statusHookMock.mockReturnValue({ status: STATUS_WITH_READINESS, isLoading: false, isError: false });
    renderPanel();
    // The P1a-shared "Conversion tracking" readout header is absent (the readiness panel re-mounts it).
    expect(screen.queryByText('Conversion tracking')).toBeNull();
    expect(screen.queryByText('Captured leads')).toBeNull();
    expect(document.querySelector('[data-p1b-readiness]')).toBeNull();
    // The cockpit spine still renders.
    expect(screen.getByRole('button', { name: /send issue/i })).toBeInTheDocument();
  });
});

describe('Cockpit P1b mount — flag ON (B5)', () => {
  it('renders the readiness panel above the spine when measured-capture is ON + readiness has gaps', () => {
    featureFlagMock.mockImplementation(flags(true));
    statusHookMock.mockReturnValue({ status: STATUS_WITH_READINESS, isLoading: false, isError: false });
    renderPanel();
    expect(document.querySelector('[data-p1b-readiness]')).not.toBeNull();
    expect(screen.getByText('Conversion tracking')).toBeInTheDocument();
    expect(screen.getByText(/7 steps left/i)).toBeInTheDocument();
    // The readiness panel precedes the IssueHeader "Send issue" button in DOM order (slot-0).
    const readiness = document.querySelector('[data-p1b-readiness]')!;
    const sendIssue = screen.getByRole('button', { name: /send issue/i });
    expect(readiness.compareDocumentPosition(sendIssue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('mounts the AdminLeadsReadout inside the Supporting detail disclosure', () => {
    featureFlagMock.mockImplementation(flags(true));
    statusHookMock.mockReturnValue({ status: STATUS_WITH_READINESS, isLoading: false, isError: false });
    leadsHookMock.mockReturnValue({ leads: [], total: 4, isLoading: false, isError: false });
    renderPanel();
    const leadsHeader = screen.getByText('Captured leads');
    expect(leadsHeader).toBeInTheDocument();
    // It lives inside the collapsed "Supporting detail" <details>.
    expect(leadsHeader.closest('details')).not.toBeNull();
    expect(screen.getByText(/4 captured/i)).toBeInTheDocument();
  });
});
