/**
 * KeywordDetailDrawer — National-rank live-SERP section (SEO Decision Engine P6 /
 * national-serp-tracking).
 *
 * Renders the REAL KeywordHub shell → real KeywordDetailDrawer (only data hooks +
 * navigate mocked) so the drawer's National-rank section is exercised end-to-end
 * from a row's metrics. `useFeatureFlag` is mocked → false (the harness mounts
 * <FeatureFlag flag="national-serp-tracking"> in the toolbar; the mock keeps the
 * render deterministic and flag-CI-safe — see the same mock in
 * tests/component/KeywordHub.drawer.test.tsx).
 *
 * The live-SERP block renders when nationalPosition / serpFeatures / aiOverviewPresent
 * are present (drawer lines ~482-510):
 *   - "Live SERP rank" + "#<nationalPosition>"
 *   - AI-Overview citation Badge (only when aiOverviewPresent): "Cited in AI Overview"
 *     (aiOverviewCited true / emerald) vs "Not cited in AI Overview" (false / zinc)
 *   - "Ranking URL:" + matchedUrl
 *   - serpBadges(..., 'plain') → "AI Overview" badge for the 'ai_overview' feature
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KeywordHub } from '../../src/components/KeywordHub';
import { keywordTrackingKey } from '../../src/lib/keywordTracking';
import type {
  KeywordCommandCenterMetrics,
  KeywordCommandCenterRow,
  KeywordCommandCenterRowsResponse,
  KeywordCommandCenterSummaryResponse,
} from '../../shared/types/keyword-command-center';

const summaryHookMock = vi.fn();
const rowsHookMock = vi.fn();
const detailHookMock = vi.fn();

vi.mock('../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useKeywordCommandCenterInitialView: () => ({ data: undefined, isLoading: false, isError: true, error: new Error('initial disabled in test') }),
  useKeywordCommandCenterSummary: (...a: unknown[]) => summaryHookMock(...a),
  useKeywordCommandCenterRows: (...a: unknown[]) => rowsHookMock(...a),
  useKeywordCommandCenterDetail: (...a: unknown[]) => detailHookMock(...a),
  useKeywordCommandCenterBulkAction: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useKeywordCommandCenterAction: () => ({ mutate: vi.fn(), isPending: false, error: null, variables: undefined }),
  useKeywordHardDelete: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRankTrackingAddKeyword: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useRankTrackingTogglePin: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  // P6 national-serp-tracking: KeywordHub calls this for the "Refresh national ranks" trigger.
  useNationalSerpRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeo: () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

// CRITICAL (flag-CI gotcha): the shell mounts <FeatureFlag flag="national-serp-tracking">.
// Mock useFeatureFlag → false so the render is deterministic regardless of the flag DB.
vi.mock('../../src/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => false }));
vi.mock('../../src/hooks/useWorkspaceEvents', () => ({ useWorkspaceEvents: () => ({ send: vi.fn() }) }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

const DISPLAY = 'Cold Brew Coffee';
const NORMALIZED = keywordTrackingKey(DISPLAY);
const RANKING_URL = 'https://acme.com/guide';

const summaryPayload: KeywordCommandCenterSummaryResponse = {
  counts: { total: 1, inStrategy: 1, tracked: 1, needsReview: 0, evidence: 0, local: 0, localCandidates: 0, retired: 0, declined: 0 },
  filters: [{ id: 'all', label: 'All', count: 1 }],
  rawEvidenceTotal: 0,
  rawEvidenceReturned: 0,
  summarizedAt: '2026-06-24T12:00:00.000Z',
};

function makeRow(metricsOverride: Partial<KeywordCommandCenterMetrics>): KeywordCommandCenterRow {
  return {
    keyword: DISPLAY,
    normalizedKeyword: NORMALIZED,
    lifecycleStatus: 'tracked',
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: {
      volume: 900,
      difficulty: 22,
      currentPosition: 5,
      clicks: 30,
      impressions: 600,
      ...metricsOverride,
    },
    // status !== 'not_tracked' → showNationalRank is true.
    tracking: { status: 'active', source: 'strategy_primary', pinned: false },
    nextActions: [],
    isProtected: false,
  };
}

function setRow(metricsOverride: Partial<KeywordCommandCenterMetrics>) {
  const payload: KeywordCommandCenterRowsResponse = {
    rows: [makeRow(metricsOverride)],
    pageInfo: { page: 1, pageSize: 50, totalRows: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
  };
  rowsHookMock.mockReturnValue({ data: payload, isLoading: false, isError: false, error: null });
}

function renderHubAndOpenDrawer(): HTMLElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <KeywordHub workspaceId="ws-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText(DISPLAY));
  return screen.getByRole('dialog');
}

beforeEach(() => {
  vi.clearAllMocks();
  summaryHookMock.mockReturnValue({ data: summaryPayload, isLoading: false, error: null });
  // detail.data undefined → drawer falls back to the rows-hook preview row, so the
  // national metrics set on the row are what render.
  detailHookMock.mockReturnValue({ data: undefined, isFetching: false });
});

describe('KeywordDetailDrawer — National live-SERP section (P6)', () => {
  it('renders live SERP rank, ranking URL, AI-Overview badge, and the AI Overview serp badge (not cited)', () => {
    setRow({
      nationalPosition: 3,
      matchedUrl: RANKING_URL,
      serpFeatures: ['ai_overview', 'featured_snippet'],
      aiOverviewPresent: true,
      aiOverviewCited: false,
    });

    const dialog = renderHubAndOpenDrawer();

    expect(within(dialog).getByText('Live SERP rank')).toBeInTheDocument();
    expect(within(dialog).getByText('#3')).toBeInTheDocument();
    // aiOverviewCited false → the "Not cited" copy on the citation badge.
    expect(within(dialog).getByText('Not cited in AI Overview')).toBeInTheDocument();
    expect(within(dialog).queryByText('Cited in AI Overview')).toBeNull();
    // Ranking URL surfaced.
    expect(within(dialog).getByText(RANKING_URL)).toBeInTheDocument();
    // serpBadges('plain') renders an "AI Overview" badge for the 'ai_overview' feature.
    expect(within(dialog).getByText('AI Overview')).toBeInTheDocument();
  });

  it('renders "Cited in AI Overview" when aiOverviewCited is true', () => {
    setRow({
      nationalPosition: 3,
      matchedUrl: RANKING_URL,
      serpFeatures: ['ai_overview'],
      aiOverviewPresent: true,
      aiOverviewCited: true,
    });

    const dialog = renderHubAndOpenDrawer();

    expect(within(dialog).getByText('Cited in AI Overview')).toBeInTheDocument();
    expect(within(dialog).queryByText('Not cited in AI Overview')).toBeNull();
  });
});
