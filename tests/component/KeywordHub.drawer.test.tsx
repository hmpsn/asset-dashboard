/**
 * KeywordHub — drawer + deep-link RECEIVER + drawer-action DISPATCH tests.
 *
 * Renders the REAL shell → real HubKeywordList → real KeywordTable → real
 * KeywordDetailDrawer (only data hooks + navigate are mocked), so it asserts the
 * assembled behavior the per-phase suites missed:
 *   - clicking a keyword row opens the journey drawer (SEED-2)
 *   - a `?q=<normalizedKeyword>` deep link seeds search AND opens the drawer on
 *     the matching row (finding #1) — exercised through the REAL keywordTrackingKey
 *     normalization on both halves (sender buildHubDeepLinkQuery + receiver match)
 *   - clicking a drawer action actually DISPATCHES it (no silent no-op), including
 *     force-flagging a protected lifecycle action (review finding)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KeywordHub } from '../../src/components/KeywordHub';
import { keywordTrackingKey } from '../../src/lib/keywordTracking';
import { buildHubDeepLinkQuery } from '../../src/lib/keywordHubDeepLink';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  type KeywordCommandCenterNextAction,
  type KeywordCommandCenterRow,
  type KeywordCommandCenterRowsResponse,
  type KeywordCommandCenterSummaryResponse,
} from '../../shared/types/keyword-command-center';

const summaryHookMock = vi.fn();
const rowsHookMock = vi.fn();
const detailHookMock = vi.fn();
const rowActionMutate = vi.fn();
const hardDeleteMutate = vi.fn();
const localRefreshMutate = vi.fn();
const navigateMock = vi.fn();

vi.mock('../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useKeywordCommandCenterSummary: (...a: unknown[]) => summaryHookMock(...a),
  useKeywordCommandCenterRows: (...a: unknown[]) => rowsHookMock(...a),
  useKeywordCommandCenterDetail: (...a: unknown[]) => detailHookMock(...a),
  useKeywordCommandCenterBulkAction: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useKeywordCommandCenterAction: () => ({ mutate: rowActionMutate, isPending: false, error: null, variables: undefined }),
  useKeywordHardDelete: () => ({ mutate: hardDeleteMutate, isPending: false, error: null }),
  useRankTrackingAddKeyword: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useRankTrackingTogglePin: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeo: () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useLocalSeoRefresh: () => ({ mutate: localRefreshMutate, isPending: false, error: null }),
}));

vi.mock('../../src/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => false }));
vi.mock('../../src/hooks/useWorkspaceEvents', () => ({ useWorkspaceEvents: () => ({ send: vi.fn() }) }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

const DISPLAY = 'Cosmetic Dentistry';
const NORMALIZED = keywordTrackingKey(DISPLAY);

const summaryPayload: KeywordCommandCenterSummaryResponse = {
  counts: { total: 1, inStrategy: 1, tracked: 0, needsReview: 0, evidence: 0, local: 0, localCandidates: 0, retired: 0, declined: 0 },
  filters: [{ id: 'all', label: 'All', count: 1 }],
  rawEvidenceTotal: 0,
  rawEvidenceReturned: 0,
  summarizedAt: '2026-06-04T12:00:00.000Z',
};

function makeRow(
  nextActions: KeywordCommandCenterNextAction[] = [],
  tracking: KeywordCommandCenterRow['tracking'] = { status: 'active', source: 'strategy_primary', pinned: false },
): KeywordCommandCenterRow {
  return {
    keyword: DISPLAY,
    normalizedKeyword: NORMALIZED,
    lifecycleStatus: 'tracked',
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: { volume: 700, difficulty: 29, currentPosition: 6, clicks: 12 },
    tracking,
    nextActions,
    isProtected: false,
  };
}

function setRows(
  nextActions: KeywordCommandCenterNextAction[] = [],
  tracking?: KeywordCommandCenterRow['tracking'],
) {
  const payload: KeywordCommandCenterRowsResponse = {
    rows: [makeRow(nextActions, tracking)],
    pageInfo: { page: 1, pageSize: 50, totalRows: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
  };
  rowsHookMock.mockReturnValue({ data: payload, isLoading: false, isError: false, error: null });
}

function renderHub(initialEntry = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <KeywordHub workspaceId="ws-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hardDeleteMutate.mockImplementation(() => undefined);
  summaryHookMock.mockReturnValue({ data: summaryPayload, isLoading: false, error: null });
  detailHookMock.mockReturnValue({ data: undefined, isFetching: false });
  setRows();
});

describe('KeywordHub — journey drawer', () => {
  it('does not render the drawer until a row is clicked', () => {
    renderHub();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the journey drawer when a keyword row is clicked', () => {
    renderHub();
    fireEvent.click(screen.getByText(DISPLAY));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-label', expect.stringContaining(DISPLAY));
  });

  it('closes the drawer after a successful permanent delete', () => {
    setRows([], { status: 'active', source: 'manual', pinned: false });
    hardDeleteMutate.mockImplementation((_vars, options) => {
      options?.onSuccess?.({ ok: true, keyword: NORMALIZED, trackedKeywords: [] });
    });

    renderHub();
    fireEvent.click(screen.getByText(DISPLAY));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `Delete permanently: ${DISPLAY}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(hardDeleteMutate).toHaveBeenCalledWith(
      { keyword: DISPLAY },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('KeywordHub — ?q= deep-link receiver (real normalization)', () => {
  it('seeds the search box from ?q= built by the real sender', () => {
    renderHub(buildHubDeepLinkQuery({ keyword: DISPLAY }));
    expect((screen.getByLabelText('Search keywords') as HTMLInputElement).value).toBe(NORMALIZED);
  });

  it('opens the drawer on the row matching ?q= on mount', () => {
    renderHub(buildHubDeepLinkQuery({ keyword: DISPLAY }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not open a drawer when ?q= matches no visible row', () => {
    renderHub('/?q=no-such-keyword');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('KeywordHub — drawer action dispatch (no silent no-op)', () => {
  function openDrawerAndClick(nextActions: KeywordCommandCenterNextAction[], label: RegExp) {
    setRows(nextActions);
    renderHub();
    fireEvent.click(screen.getByText(DISPLAY)); // open the drawer
    // Scope to the drawer dialog — the list row menu can carry similarly-labelled actions.
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: label }));
  }

  it('dispatches a lifecycle action through the action mutation', () => {
    openDrawerAndClick(
      [{ type: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE, label: 'Retire keyword', detail: '', tone: 'amber', keyword: DISPLAY }],
      /Retire keyword/,
    );
    expect(rowActionMutate).toHaveBeenCalledWith(
      expect.objectContaining({ action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE, keyword: DISPLAY }),
    );
    expect(rowActionMutate).toHaveBeenCalledWith(
      expect.not.objectContaining({ force: true }),
    );
  });

  it('force-flags a PROTECTED lifecycle action (disabledReason set) so the server does not reject it', async () => {
    // Protected click → ConfirmDialog appears first; mutation NOT called yet.
    // Confirming the dialog dispatches the mutation with force: true.
    setRows([{ type: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE, label: 'Retire keyword', detail: '', tone: 'amber', keyword: DISPLAY, disabledReason: 'Client-requested keyword' }]);
    renderHub();

    // Open the drawer
    await act(async () => {
      fireEvent.click(screen.getByText(DISPLAY));
    });

    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /Retire keyword/i }));
    });

    // Mutation must NOT have fired yet — ConfirmDialog is shown instead
    expect(rowActionMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Client-requested keyword/i)).toBeInTheDocument();

    // Confirm the dialog → mutation fires with force: true
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    });

    expect(rowActionMutate).toHaveBeenCalledWith(
      expect.objectContaining({ action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE, keyword: DISPLAY, force: true }),
    );
  });

  it('routes review_page to a navigation, not the action mutation', () => {
    openDrawerAndClick(
      [{ type: 'review_page', label: 'Review the page', detail: '', tone: 'blue', keyword: DISPLAY, pagePath: '/services' }],
      /Review the page/,
    );
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('page-intelligence'),
      expect.objectContaining({ state: expect.anything() }),
    );
    expect(rowActionMutate).not.toHaveBeenCalled();
  });

  it('routes check_local_visibility to the local refresh mutation', () => {
    openDrawerAndClick(
      [{ type: 'check_local_visibility', label: 'Refresh local visibility', detail: '', tone: 'teal', keyword: DISPLAY }],
      /Refresh local visibility/,
    );
    expect(localRefreshMutate).toHaveBeenCalledWith({ keywords: [DISPLAY] });
    expect(rowActionMutate).not.toHaveBeenCalled();
  });
});

describe('KeywordHub — drawer outcome chip (detail fixture)', () => {
  it('renders the outcome read-back chip from detail.data.outcome (KCC parity)', () => {
    detailHookMock.mockReturnValue({
      data: {
        row: makeRow(),
        outcome: {
          actionId: 'act-1',
          actionType: 'strategy_keyword_added',
          score: 'win',
          checkpointDays: 30,
          primaryMetric: 'position',
          direction: 'improved',
          baselineValue: 12,
          currentValue: 5,
          baselinePosition: 12,
          currentPosition: 5,
          baselineClicks: null,
          currentClicks: null,
        },
      },
      isFetching: false,
    });

    renderHub();
    fireEvent.click(screen.getByText(DISPLAY));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('keyword-outcome-section')).toBeInTheDocument();
  });

  it('omits the outcome section when detail.data.outcome is absent', () => {
    detailHookMock.mockReturnValue({ data: { row: makeRow() }, isFetching: false });
    renderHub();
    fireEvent.click(screen.getByText(DISPLAY));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByTestId('keyword-outcome-section')).toBeNull();
  });
});
