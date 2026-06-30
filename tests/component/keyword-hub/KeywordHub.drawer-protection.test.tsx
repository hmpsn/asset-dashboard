/**
 * KeywordHub.drawer-protection.test.tsx — W2.2 component regression guard.
 *
 * Bug: handleDrawerAction in KeywordHub previously sent { force: true } silently on
 * the first click when action.disabledReason was set, bypassing keyword protection
 * in one click. The fix gates those actions behind a ConfirmDialog (same as
 * KeywordActionMenu's pendingForceAction pattern).
 *
 * Tests (from W2.2 spec):
 *   1. Clicking a protected drawer action does NOT fire the mutation.
 *   2. Clicking a protected drawer action opens the ConfirmDialog showing the reason.
 *   3. Cancelling the dialog closes it without firing the mutation.
 *   4. Confirming the dialog fires the mutation with force: true.
 *   5. An unprotected drawer action fires the mutation immediately (no dialog).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { KeywordHub } from '../../../src/components/KeywordHub';
import type {
  KeywordCommandCenterNextAction,
  KeywordCommandCenterRow,
  KeywordCommandCenterRowsResponse,
  KeywordCommandCenterSummaryResponse,
} from '../../../shared/types/keyword-command-center';
import { KEYWORD_COMMAND_CENTER_ACTIONS } from '../../../shared/types/keyword-command-center';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const summaryHookMock = vi.fn();
const rowsHookMock = vi.fn();
const rowActionMutateMock = vi.fn();
const featureFlagMock = vi.fn();
const getMock = vi.fn();

// Mock all Hub data hooks. rowAction.mutate is the call-under-test.
vi.mock('../../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useKeywordCommandCenterInitialView: () => ({ data: undefined, isLoading: false, isError: true, error: new Error('initial disabled in test') }),
  useKeywordCommandCenterSummary: (...args: unknown[]) => summaryHookMock(...args),
  useKeywordCommandCenterRows: (...args: unknown[]) => rowsHookMock(...args),
  useKeywordCommandCenterBulkAction: () => ({ mutate: vi.fn(), isPending: false }),
  useKeywordCommandCenterAction: () => ({
    mutate: rowActionMutateMock,
    isPending: false,
    variables: undefined,
    error: null,
  }),
  useKeywordHardDelete: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useKeywordCommandCenterDetail: () => ({ data: undefined, isFetching: false }),
  useRankTrackingAddKeyword: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  // A2: pin toggle added to KeywordDetailDrawer — must be present to avoid "not exported" error.
  useRankTrackingTogglePin: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  // P6 national-serp-tracking: KeywordHub calls this for the "Refresh national ranks" trigger.
  useNationalSerpRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

// Barrel mock for LocalSeoVisibilityPanel (now mounted in Hub after idle callback fires).
vi.mock('../../../src/hooks/admin', () => ({
  useLocalSeo: () => ({
    data: { featureEnabled: false },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useLocalSeoUpdate: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useLocalSeoLocationLookup: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useSetPrimaryMarket: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ findActiveJob: () => null, tasks: [] }),
}));

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: () => ({ send: vi.fn() }),
}));

// Mock the feature flag (drawer uses it for journey sections)
vi.mock('../../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...args),
}));

// Mock the API client (drawer uses it for rank history fetch)
vi.mock('../../../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/api/client')>();
  return { ...actual, get: (...args: unknown[]) => getMock(...args) };
});

// HubKeywordList: expose onRowClick via a test button so we can open the drawer.
vi.mock('../../../src/components/keyword-hub/HubKeywordList', () => ({
  HubKeywordList: (props: {
    rows: KeywordCommandCenterRow[];
    onRowClick: (row: KeywordCommandCenterRow) => void;
  }) => (
    <div data-testid="hub-keyword-list">
      {props.rows.map(row => (
        <button
          key={row.normalizedKeyword}
          data-testid={`row-click-${row.normalizedKeyword}`}
          onClick={() => props.onRowClick(row)}
        >
          {row.keyword}
        </button>
      ))}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const protectedRetireAction: KeywordCommandCenterNextAction = {
  type: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
  label: 'Retire',
  detail: 'Retire this keyword.',
  tone: 'red',
  keyword: 'gap approved kw',
  pagePath: '/services/dental',
  // disabledReason present → protected, drawer renders it as a live button
  disabledReason: 'Gap-approved keyword requires confirmation before retirement.',
};

const unprotectedTrackAction: KeywordCommandCenterNextAction = {
  type: KEYWORD_COMMAND_CENTER_ACTIONS.TRACK,
  label: 'Track keyword',
  detail: 'Add to tracking.',
  tone: 'teal',
  keyword: 'plain unprotected kw',
  // no disabledReason → fires immediately
};

const protectedRow: KeywordCommandCenterRow = {
  keyword: 'gap approved kw',
  normalizedKeyword: 'gap approved kw',
  lifecycleStatus: 'tracked',
  statusLabel: 'Tracked',
  sourceLabels: [],
  metrics: { volume: 500 },
  tracking: { status: 'active', source: 'content_gap' },
  nextActions: [protectedRetireAction],
  isProtected: true,
};

const unprotectedRow: KeywordCommandCenterRow = {
  keyword: 'plain unprotected kw',
  normalizedKeyword: 'plain unprotected kw',
  lifecycleStatus: 'tracked',
  statusLabel: 'Tracked',
  sourceLabels: [],
  metrics: { volume: 200 },
  tracking: { status: 'active', source: 'manual' },
  nextActions: [unprotectedTrackAction],
  isProtected: false,
};

const summaryPayload: KeywordCommandCenterSummaryResponse = {
  counts: {
    total: 2, inStrategy: 0, tracked: 2, needsReview: 0,
    evidence: 0, local: 0, localCandidates: 0, declined: 0, retired: 0,
  },
  filters: [],
  rawEvidenceTotal: 0,
  rawEvidenceReturned: 0,
  summarizedAt: '2026-06-11T00:00:00.000Z',
};

function makeRowsPayload(rows: KeywordCommandCenterRow[]): KeywordCommandCenterRowsResponse {
  return {
    rows,
    pageInfo: {
      page: 1, pageSize: 50, totalRows: rows.length,
      totalPages: 1, hasNextPage: false, hasPreviousPage: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderHub() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ws/ws-1/seo-keywords']}>
        <KeywordHub workspaceId="ws-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // keyword-hub flag ON: enable journey sections in the drawer
  featureFlagMock.mockReturnValue(true);
  // History API returns empty
  getMock.mockResolvedValue([]);
  summaryHookMock.mockReturnValue({ data: summaryPayload, isLoading: false, error: null });
  rowsHookMock.mockReturnValue({
    data: makeRowsPayload([protectedRow, unprotectedRow]),
    isLoading: false,
    isError: false,
    error: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KeywordHub — W2.2: protected drawer action requires ConfirmDialog', () => {
  it('clicking a protected drawer action does NOT fire the mutation immediately', async () => {
    renderHub();

    // Open the drawer for the protected row
    await act(async () => {
      fireEvent.click(screen.getByTestId('row-click-gap approved kw'));
    });

    // Scope to the drawer to avoid ambiguity with segment-bar "Retired" button
    const drawer = screen.getByRole('dialog');
    const retireBtn = within(drawer).getByRole('button', { name: /^retire$/i });
    await act(async () => {
      fireEvent.click(retireBtn);
    });

    // Mutation must NOT have fired yet
    expect(rowActionMutateMock).not.toHaveBeenCalled();
  });

  it('clicking a protected drawer action shows the ConfirmDialog with the protection reason', async () => {
    renderHub();

    await act(async () => {
      fireEvent.click(screen.getByTestId('row-click-gap approved kw'));
    });

    const drawer = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(drawer).getByRole('button', { name: /^retire$/i }));
    });

    // ConfirmDialog renders the disabledReason as the message
    expect(screen.getByText(/gap-approved keyword requires confirmation/i)).toBeInTheDocument();
  });

  it('cancelling the ConfirmDialog does NOT fire the mutation', async () => {
    renderHub();

    await act(async () => {
      fireEvent.click(screen.getByTestId('row-click-gap approved kw'));
    });
    const drawer = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(drawer).getByRole('button', { name: /^retire$/i }));
    });

    // Cancel — scoped to the confirm dialog buttons (multiple "Cancel" buttons may exist)
    const cancelBtns = screen.getAllByRole('button', { name: /^cancel$/i });
    await act(async () => {
      fireEvent.click(cancelBtns[cancelBtns.length - 1]);
    });

    expect(rowActionMutateMock).not.toHaveBeenCalled();
    // Dialog is dismissed
    expect(screen.queryByText(/gap-approved keyword requires confirmation/i)).not.toBeInTheDocument();
  });

  it('confirming the ConfirmDialog fires the mutation with force: true', async () => {
    renderHub();

    await act(async () => {
      fireEvent.click(screen.getByTestId('row-click-gap approved kw'));
    });
    const drawer = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(drawer).getByRole('button', { name: /^retire$/i }));
    });

    // Confirm
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    });

    expect(rowActionMutateMock).toHaveBeenCalledOnce();
    expect(rowActionMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'retire', force: true }),
    );
  });

  it('confirm uses the keyword/pagePath captured ON the action, not re-resolved at confirm time', async () => {
    // W2-review hardening: the confirm handler must read keyword/pagePath from the
    // pending action (captured when the dialog opened), NOT from selectedRow at
    // confirm time — otherwise a drawer-row change while the dialog is open would
    // force the override against the wrong keyword.
    renderHub();

    await act(async () => {
      fireEvent.click(screen.getByTestId('row-click-gap approved kw'));
    });
    const drawer = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(drawer).getByRole('button', { name: /^retire$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    });

    expect(rowActionMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'retire',
        keyword: 'gap approved kw',
        pagePath: '/services/dental',
        force: true,
      }),
    );
  });

  it('closing the drawer clears the pending force dialog', async () => {
    renderHub();

    await act(async () => {
      fireEvent.click(screen.getByTestId('row-click-gap approved kw'));
    });
    const drawer = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(drawer).getByRole('button', { name: /^retire$/i }));
    });
    // Dialog is open
    expect(screen.getByText(/gap-approved keyword requires confirmation/i)).toBeInTheDocument();

    // Close the drawer (KeywordDetailDrawer onClose). The drawer's close control is
    // labelled "Close keyword detail".
    const closeBtn = within(drawer).getByRole('button', { name: /close keyword detail/i });
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    // The pending force dialog must be gone (cleared by onClose), and no mutation fired.
    expect(screen.queryByText(/gap-approved keyword requires confirmation/i)).not.toBeInTheDocument();
    expect(rowActionMutateMock).not.toHaveBeenCalled();
  });

  it('clicking an unprotected drawer action fires the mutation immediately without a dialog', async () => {
    renderHub();

    // Open the drawer for the unprotected row
    await act(async () => {
      fireEvent.click(screen.getByTestId('row-click-plain unprotected kw'));
    });

    const drawer = screen.getByRole('dialog');
    const trackBtn = within(drawer).getByRole('button', { name: /track keyword/i });
    await act(async () => {
      fireEvent.click(trackBtn);
    });

    // Mutation fires immediately — no dialog, force is absent
    expect(rowActionMutateMock).toHaveBeenCalledOnce();
    expect(rowActionMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'track' }),
    );
    expect(rowActionMutateMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ force: true }),
    );
    // No ConfirmDialog visible
    expect(screen.queryByText(/override keyword protection/i)).not.toBeInTheDocument();
  });
});
