/**
 * B1 regression tests — add-keyword input in the Hub header.
 *
 * The Hub had no manual way to add a keyword (the legacy Rank Tracker surface did).
 * After the fix, the Hub header exposes an input + "Add" button that writes through
 * the existing `POST /api/rank-tracking/:wsId/keywords` path via the
 * `useRankTrackingAddKeyword` hook.
 *
 * Tests (from the plan's contract):
 *   1. Add input is rendered.
 *   2. Empty submit does nothing (mutation NOT called).
 *   3. Submit with keyword calls mutation (trimmed).
 *   4. Input clears on success.
 *   5. Enter key triggers add.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KeywordHub } from '../../src/components/KeywordHub';
import type {
  KeywordCommandCenterRowsResponse,
  KeywordCommandCenterSummaryResponse,
} from '../../shared/types/keyword-command-center';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const summaryHookMock = vi.fn();
const rowsHookMock = vi.fn();
const addKeywordMutateMock = vi.fn();
const addKeywordMutateAsyncMock = vi.fn();

vi.mock('../../src/hooks/admin/useKeywordCommandCenter', () => ({
  useKeywordCommandCenterSummary: (...args: unknown[]) => summaryHookMock(...args),
  useKeywordCommandCenterRows: (...args: unknown[]) => rowsHookMock(...args),
  useKeywordCommandCenterBulkAction: () => ({ mutate: vi.fn(), isPending: false }),
  useKeywordCommandCenterAction: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
    error: null,
  }),
  useKeywordHardDelete: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useKeywordCommandCenterDetail: () => ({ data: undefined, isFetching: false }),
  useRankTrackingAddKeyword: () => ({
    mutate: addKeywordMutateMock,
    mutateAsync: addKeywordMutateAsyncMock,
    isPending: false,
    error: null,
  }),
}));

vi.mock('../../src/hooks/admin/useLocalSeo', () => ({
  useLocalSeoRefresh: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (_wsId: string, _handlers: unknown) => ({ send: vi.fn() }),
}));

vi.mock('../../src/components/keyword-hub/HubKeywordList', () => ({
  HubKeywordList: (props: { isLoading: boolean; rows: unknown[] }) => (
    <div data-testid="hub-keyword-list">
      <span data-testid="list-loading">{props.isLoading ? 'loading' : 'ready'}</span>
      <span data-testid="list-row-count">{props.rows.length}</span>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const summaryPayload: KeywordCommandCenterSummaryResponse = {
  counts: {
    total: 3,
    inStrategy: 1,
    tracked: 1,
    needsReview: 0,
    evidence: 0,
    local: 0,
    localCandidates: 0,
    retired: 0,
    declined: 0,
  },
  filters: [],
  rawEvidenceTotal: 3,
  rawEvidenceReturned: 3,
  summarizedAt: '2026-06-10T12:00:00.000Z',
};

const rowsPayload: KeywordCommandCenterRowsResponse = {
  rows: [],
  pageInfo: {
    page: 1,
    pageSize: 50,
    totalRows: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

function setupHooks() {
  summaryHookMock.mockReturnValue({ data: summaryPayload, isLoading: false, error: null });
  rowsHookMock.mockReturnValue({ data: rowsPayload, isLoading: false, isError: false, error: null });
}

function renderHub() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ws/ws-1/seo-keywords']}>
        <KeywordHub workspaceId="ws-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KeywordHub — B1: add-keyword input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHooks();
    // Default: mutateAsync resolves immediately (success path).
    addKeywordMutateAsyncMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an add-keyword input in the header', () => {
    renderHub();
    // The input should be discoverable by a user-facing label or placeholder
    const input = screen.getByPlaceholderText(/add keyword/i);
    expect(input).toBeInTheDocument();
  });

  it('clicking Add with an empty input does NOT call the mutation', async () => {
    renderHub();
    const addBtn = screen.getByRole('button', { name: /^add$/i });
    await act(async () => {
      fireEvent.click(addBtn);
    });
    expect(addKeywordMutateAsyncMock).not.toHaveBeenCalled();
  });

  it('clicking Add with a keyword calls the mutation with the trimmed value', async () => {
    renderHub();
    const input = screen.getByPlaceholderText(/add keyword/i);
    fireEvent.change(input, { target: { value: '  plumber austin  ' } });
    const addBtn = screen.getByRole('button', { name: /^add$/i });
    await act(async () => {
      fireEvent.click(addBtn);
    });
    expect(addKeywordMutateAsyncMock).toHaveBeenCalledOnce();
    expect(addKeywordMutateAsyncMock).toHaveBeenCalledWith('plumber austin');
  });

  it('input clears after a successful add', async () => {
    renderHub();
    const input = screen.getByPlaceholderText(/add keyword/i);
    fireEvent.change(input, { target: { value: 'roofing company' } });
    const addBtn = screen.getByRole('button', { name: /^add$/i });
    await act(async () => {
      fireEvent.click(addBtn);
    });
    expect(input).toHaveValue('');
  });

  it('pressing Enter in the input triggers the add mutation', async () => {
    renderHub();
    const input = screen.getByPlaceholderText(/add keyword/i);
    fireEvent.change(input, { target: { value: 'emergency plumber' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });
    expect(addKeywordMutateAsyncMock).toHaveBeenCalledOnce();
    expect(addKeywordMutateAsyncMock).toHaveBeenCalledWith('emergency plumber');
  });

  it('pressing Enter with an empty input does NOT call the mutation', async () => {
    renderHub();
    const input = screen.getByPlaceholderText(/add keyword/i);
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    });
    expect(addKeywordMutateAsyncMock).not.toHaveBeenCalled();
  });
});
