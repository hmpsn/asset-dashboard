/**
 * P3-3d: bulk-bar lifecycle wiring in the Keyword Hub.
 *
 * Reuses KeywordBulkActionBar + summarizeBulkAction + KeywordBulkConfirmDialog (no new
 * bulk engine). Asserts: N selected → "N selected"; Retire on a selection containing a
 * protected row → KeywordBulkConfirmDialog (requiresConfirmation); the per-item result
 * summary renders applied/skipped/failed (the illegal-state→error case is proved at the
 * server layer in keyword-command-center-bulk.test.ts, which depends on the 3b guard).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeywordHub } from '../../../src/components/KeywordHub';
import { KEYWORD_COMMAND_CENTER_STATUS } from '../../../shared/types/keyword-command-center';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } from '../../../shared/types/rank-tracking';
import type { KeywordCommandCenterRow, KeywordCommandCenterBulkActionResult } from '../../../shared/types/keyword-command-center';

const bulkMutateMock = vi.fn();

vi.mock('../../../src/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => false }));
vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({ useWorkspaceEvents: () => ({ send: vi.fn() }) }));

function makeRow(keyword: string, source: string, status = TRACKED_KEYWORD_STATUS.ACTIVE): KeywordCommandCenterRow {
  return {
    keyword,
    normalizedKeyword: keyword,
    lifecycleStatus: KEYWORD_COMMAND_CENTER_STATUS.TRACKED,
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: {},
    tracking: { status, source: source as never, pinned: false },
    nextActions: [],
    isProtected: source === TRACKED_KEYWORD_SOURCE.MANUAL,
    protectionReason: source === TRACKED_KEYWORD_SOURCE.MANUAL ? 'Manual keyword' : undefined,
  };
}

const ROWS = [
  makeRow('kw recommendation a', TRACKED_KEYWORD_SOURCE.RECOMMENDATION),
  makeRow('kw recommendation b', TRACKED_KEYWORD_SOURCE.RECOMMENDATION),
  makeRow('kw protected manual', TRACKED_KEYWORD_SOURCE.MANUAL), // protected → forces confirmation
];

vi.mock('../../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useKeywordCommandCenterInitialView: () => ({ data: undefined, isLoading: false, isError: true, error: new Error('initial disabled in test') }),
  useKeywordCommandCenterSummary: () => ({ data: { counts: {}, filters: [] }, isLoading: false }),
  useKeywordCommandCenterRows: () => ({
    data: { rows: ROWS, pageInfo: undefined },
    isLoading: false,
    isError: false,
  }),
  useKeywordCommandCenterBulkAction: () => ({ mutate: bulkMutateMock, isPending: false, error: null }),
  useKeywordCommandCenterAction: () => ({ mutate: vi.fn(), isPending: false, error: null, variables: undefined }),
  useKeywordHardDelete: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useKeywordCommandCenterDetail: () => ({ data: undefined, isFetching: false }),
  useRankTrackingAddKeyword: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useRankTrackingTogglePin: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useNationalSerpRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

// A1 mounts LocalSeoVisibilityPanel inside KeywordHub (idle-deferred); it reads
// useLocalSeo + friends from the barrel and useBackgroundTasks. Mock both so the
// panel renders its null state instead of crashing the tree.
vi.mock('../../../src/hooks/admin', () => ({
  useLocalSeo: () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useLocalSeoUpdate: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useLocalSeoLocationLookup: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useLocalSeoLocations: () => ({ data: [], isLoading: false, error: null }),
  useSetPrimaryMarket: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRankTrackingAddKeyword: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ findActiveJob: () => null, tasks: [] }),
}));

function renderHub() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <KeywordHub workspaceId="ws_test" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function selectRow(keyword: string) {
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`Select ${keyword}`, 'i') }));
}

describe('Keyword Hub bulk bar (P3-3d)', () => {
  beforeEach(() => {
    bulkMutateMock.mockReset();
  });

  it('selecting N rows shows "N selected" in the bulk bar', () => {
    renderHub();
    selectRow('kw recommendation a');
    selectRow('kw recommendation b');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('Retire on a selection with a protected row opens the KeywordBulkConfirmDialog (requiresConfirmation)', async () => {
    renderHub();
    selectRow('kw recommendation a');
    selectRow('kw protected manual');

    fireEvent.click(screen.getByRole('button', { name: /^retire$/i }));

    // Confirmation dialog appears (protectedCount > 0 → requiresConfirmation) — NOT a direct mutate.
    await waitFor(() => {
      expect(screen.getByText(/protected keyword.*require.*confirmation/i)).toBeInTheDocument();
    });
    expect(bulkMutateMock).not.toHaveBeenCalled();
  });

  it('confirming the dialog fires the bulk mutation and renders the per-item result summary', async () => {
    const result: KeywordCommandCenterBulkActionResult = {
      action: 'retire',
      applied: 1,
      skipped: 1,
      failed: 0,
      items: [
        { keyword: 'kw recommendation a', status: 'applied' },
        { keyword: 'kw protected manual', status: 'skipped_protected', error: 'Manual keyword requires explicit confirmation before this action.' },
      ],
      message: '1 keyword retired from active tracking, 1 skipped',
    };
    bulkMutateMock.mockImplementation((_vars, opts?: { onSuccess?: (r: KeywordCommandCenterBulkActionResult) => void }) => {
      opts?.onSuccess?.(result);
    });

    renderHub();
    selectRow('kw recommendation a');
    selectRow('kw protected manual');
    // The bulk-bar Retire button (the first "Retire" in the DOM) opens the dialog.
    fireEvent.click(screen.getAllByRole('button', { name: /^retire$/i })[0]);

    // The dialog confirm button is the LAST "Retire" button once the dialog is open.
    await waitFor(() => expect(screen.getByText(/protected keyword.*require.*confirmation/i)).toBeInTheDocument());
    const retireButtons = screen.getAllByRole('button', { name: /^retire$/i });
    fireEvent.click(retireButtons[retireButtons.length - 1]);

    expect(bulkMutateMock).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/1 keyword retired from active tracking/i)).toBeInTheDocument();
      expect(screen.getByText(/1 skipped by protection or tracking state/i)).toBeInTheDocument();
    });
  });
});
