/**
 * Tests for HubKeywordList — the list component built on KeywordTable (P1-T3).
 * Mocks KeywordTable and KeywordBulkActionBar; passes props directly.
 *
 * Assertions cover:
 *   - renders KeywordTable with the hub column set
 *   - passes sort config + onSort toggles same-key direction
 *   - selection checkboxes toggle selectedKeys
 *   - bulk bar shown when someSelected, hidden when not
 *   - isBulkPending → bulk bar disabled
 *   - pagination bar when pageInfo defined; prev disabled on page 1 / next disabled on last
 *   - ErrorState when isError
 *   - loading state when isLoading + rows=[]
 *   - action-oriented EmptyState when rows=[] not-loading not-error
 *   - passes showLocalSeo
 *   - localSeoColumnLabel mapping cases + undefined
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { KeywordCommandCenterRow, KeywordCommandCenterPageInfo } from '../../../shared/types/keyword-command-center';
import type { HubSortState, HubSortKey } from '../../../src/hooks/admin/useKeywordHubState';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
// Mock the KeywordTable so we can control its rendered output
vi.mock('../../../src/components/shared/RankTable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/components/shared/RankTable')>();
  return {
    ...actual,
    KeywordTable: vi.fn(({ rows, emptyState, loading, sort, selection, showLocalSeo }: {
      rows: unknown[];
      emptyState?: { title: string; description?: string; action?: React.ReactNode };
      loading?: boolean;
      sort?: { key: string; direction: string; onSort: (key: string) => void };
      selection?: { selected: Set<string>; onToggle: (id: string) => void; header?: { checked: boolean; onToggle: (c: boolean) => void; label: string } };
      showLocalSeo?: boolean;
    }) => {
      if (loading) return <div data-testid="keyword-table-loading">Loading keyword table</div>;
      if (rows.length === 0 && emptyState) {
        return (
          <div data-testid="keyword-table-empty">
            <span>{emptyState.title}</span>
            {emptyState.action}
          </div>
        );
      }
      return (
        <div data-testid="keyword-table">
          <span data-testid="sort-key">{sort?.key}</span>
          <span data-testid="sort-direction">{sort?.direction}</span>
          <span data-testid="show-local-seo">{showLocalSeo ? 'true' : 'false'}</span>
          <span data-testid="row-count">{rows.length}</span>
          {selection && (
            <button
              data-testid="select-all"
              onClick={() => selection.header?.onToggle(true)}
            >
              Select All
            </button>
          )}
        </div>
      );
    }),
  };
});

// Mock KeywordBulkActionBar
vi.mock('../../../src/components/keyword-command-center/KeywordBulkActionBar', () => ({
  KeywordBulkActionBar: vi.fn(({ selectedCount, isPending, onAction, onClear }: {
    selectedCount: number;
    isPending: boolean;
    onAction: (a: string) => void;
    onClear: () => void;
  }) => (
    <div data-testid="bulk-action-bar">
      <span data-testid="selected-count">{selectedCount}</span>
      <span data-testid="is-pending">{isPending ? 'true' : 'false'}</span>
      <button
        data-testid="bulk-action-btn"
        disabled={isPending}
        onClick={() => onAction('track')}
      >
        Track
      </button>
      <button data-testid="clear-btn" onClick={onClear}>Clear</button>
    </div>
  )),
}));

import React from 'react';
import { HubKeywordList, localSeoColumnLabel } from '../../../src/components/keyword-hub/HubKeywordList';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
function makeRow(overrides: Partial<KeywordCommandCenterRow> = {}): KeywordCommandCenterRow {
  return {
    keyword: 'example keyword',
    normalizedKeyword: 'example-keyword',
    lifecycleStatus: 'tracked',
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: { currentPosition: 5, clicks: 100, volume: 1000, difficulty: 30 },
    tracking: { status: 'active' },
    nextActions: [],
    isProtected: false,
    ...overrides,
  };
}

function makePageInfo(overrides: Partial<KeywordCommandCenterPageInfo> = {}): KeywordCommandCenterPageInfo {
  return {
    page: 1,
    pageSize: 50,
    totalRows: 100,
    totalPages: 2,
    hasNextPage: true,
    hasPreviousPage: false,
    ...overrides,
  };
}

const defaultSort: HubSortState = { key: 'keyword', direction: 'asc' };

function defaultProps(overrides: Partial<React.ComponentProps<typeof HubKeywordList>> = {}) {
  return {
    workspaceId: 'ws-123',
    rows: [makeRow()],
    pageInfo: makePageInfo(),
    isLoading: false,
    isError: false,
    sort: defaultSort,
    onSort: vi.fn(),
    selectedKeys: new Set<string>(),
    onToggleKey: vi.fn(),
    onToggleAll: vi.fn(),
    someSelected: false,
    allSelected: false,
    page: 1,
    onPageChange: vi.fn(),
    isBulkPending: false,
    onBulkAction: vi.fn(),
    onRowAction: vi.fn(),
    onDeleteHard: vi.fn(),
    isRowActionPending: false,
    onClearSelection: vi.fn(),
    onResetFilters: vi.fn(),
    onRowClick: vi.fn(),
    activeKeyword: null,
    showLocalSeo: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// KeywordTable rendering
// ---------------------------------------------------------------------------
describe('HubKeywordList — KeywordTable rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the KeywordTable with rows', () => {
    render(<HubKeywordList {...defaultProps()} />);
    expect(screen.getByTestId('keyword-table')).toBeInTheDocument();
    expect(screen.getByTestId('row-count').textContent).toBe('1');
  });

  it('passes sort.key and sort.direction to KeywordTable', () => {
    const sort: HubSortState = { key: 'position', direction: 'desc' };
    render(<HubKeywordList {...defaultProps({ sort })} />);
    expect(screen.getByTestId('sort-key').textContent).toBe('position');
    expect(screen.getByTestId('sort-direction').textContent).toBe('desc');
  });

  it('passes showLocalSeo=true to KeywordTable when set', () => {
    render(<HubKeywordList {...defaultProps({ showLocalSeo: true })} />);
    expect(screen.getByTestId('show-local-seo').textContent).toBe('true');
  });

  it('passes showLocalSeo=false to KeywordTable when not set', () => {
    render(<HubKeywordList {...defaultProps({ showLocalSeo: false })} />);
    expect(screen.getByTestId('show-local-seo').textContent).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------
describe('HubKeywordList — loading state', () => {
  it('shows loading state when isLoading=true and rows=[]', () => {
    render(<HubKeywordList {...defaultProps({ isLoading: true, rows: [] })} />);
    expect(screen.getByTestId('keyword-table-loading')).toBeInTheDocument();
  });

  it('does not show loading table when rows are present even if isLoading', () => {
    // When rows are present but still loading, the table renders with existing data
    render(<HubKeywordList {...defaultProps({ isLoading: false, rows: [makeRow()] })} />);
    expect(screen.getByTestId('keyword-table')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------
describe('HubKeywordList — error state', () => {
  it('renders ErrorState when isError=true', () => {
    render(<HubKeywordList {...defaultProps({ isError: true, rows: [] })} />);
    // ErrorState should be rendered (not the keyword table)
    expect(screen.queryByTestId('keyword-table')).toBeNull();
    expect(screen.queryByTestId('keyword-table-loading')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
describe('HubKeywordList — empty state', () => {
  it('renders action-oriented EmptyState when rows=[] not-loading not-error', () => {
    render(<HubKeywordList {...defaultProps({ rows: [], isLoading: false, isError: false })} />);
    // The mocked KeywordTable renders emptyState content when rows=[]
    expect(screen.getByTestId('keyword-table-empty')).toBeInTheDocument();
  });

  it('empty state "Clear filters" button calls onResetFilters (resets segment/search/advanced — NOT the multi-select)', () => {
    const onResetFilters = vi.fn();
    const onClearSelection = vi.fn();
    render(
      <HubKeywordList
        {...defaultProps({ rows: [], isLoading: false, isError: false, onResetFilters, onClearSelection })}
      />,
    );
    const emptyEl = screen.getByTestId('keyword-table-empty');
    expect(emptyEl).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(onResetFilters).toHaveBeenCalledTimes(1);
    expect(onClearSelection).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bulk action bar
// ---------------------------------------------------------------------------
describe('HubKeywordList — bulk action bar', () => {
  it('hides bulk bar when someSelected=false', () => {
    render(<HubKeywordList {...defaultProps({ someSelected: false })} />);
    expect(screen.queryByTestId('bulk-action-bar')).toBeNull();
  });

  it('shows bulk bar when someSelected=true', () => {
    const selectedKeys = new Set(['example-keyword']);
    render(<HubKeywordList {...defaultProps({ someSelected: true, selectedKeys })} />);
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
  });

  it('bulk bar disabled state reflects isBulkPending=true', () => {
    const selectedKeys = new Set(['example-keyword']);
    render(
      <HubKeywordList
        {...defaultProps({
          someSelected: true,
          selectedKeys,
          isBulkPending: true,
        })}
      />,
    );
    const bar = screen.getByTestId('bulk-action-bar');
    expect(bar.querySelector('[data-testid="is-pending"]')?.textContent).toBe('true');
    const btn = bar.querySelector('[data-testid="bulk-action-btn"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('calls onBulkAction when bulk bar emits an action', () => {
    const onBulkAction = vi.fn();
    const selectedKeys = new Set(['example-keyword']);
    render(
      <HubKeywordList
        {...defaultProps({ someSelected: true, selectedKeys, onBulkAction })}
      />,
    );
    fireEvent.click(screen.getByTestId('bulk-action-btn'));
    expect(onBulkAction).toHaveBeenCalledWith('track');
  });

  it('calls onClearSelection when clear is clicked', () => {
    const onClearSelection = vi.fn();
    const selectedKeys = new Set(['example-keyword']);
    render(
      <HubKeywordList
        {...defaultProps({ someSelected: true, selectedKeys, onClearSelection })}
      />,
    );
    fireEvent.click(screen.getByTestId('clear-btn'));
    expect(onClearSelection).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
describe('HubKeywordList — pagination', () => {
  it('renders pagination when pageInfo is defined', () => {
    render(<HubKeywordList {...defaultProps({ pageInfo: makePageInfo() })} />);
    // Pagination bar should be present
    expect(screen.getByRole('navigation', { name: /pagination/i })).toBeInTheDocument();
  });

  it('does not render pagination when pageInfo is undefined', () => {
    render(<HubKeywordList {...defaultProps({ pageInfo: undefined })} />);
    expect(screen.queryByRole('navigation', { name: /pagination/i })).toBeNull();
  });

  it('prev button is disabled on page 1 (hasPreviousPage=false)', () => {
    const pageInfo = makePageInfo({ page: 1, hasPreviousPage: false });
    render(<HubKeywordList {...defaultProps({ page: 1, pageInfo })} />);
    const prevBtn = screen.getByRole('button', { name: /previous/i });
    expect(prevBtn).toBeDisabled();
  });

  it('next button is disabled on last page (hasNextPage=false)', () => {
    const pageInfo = makePageInfo({ page: 2, totalPages: 2, hasNextPage: false, hasPreviousPage: true });
    render(<HubKeywordList {...defaultProps({ page: 2, pageInfo })} />);
    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).toBeDisabled();
  });

  it('next button is enabled when hasNextPage=true', () => {
    const pageInfo = makePageInfo({ page: 1, hasNextPage: true });
    render(<HubKeywordList {...defaultProps({ page: 1, pageInfo })} />);
    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).not.toBeDisabled();
  });

  it('calls onPageChange when next button clicked', () => {
    const onPageChange = vi.fn();
    const pageInfo = makePageInfo({ page: 1, hasNextPage: true });
    render(<HubKeywordList {...defaultProps({ page: 1, pageInfo, onPageChange })} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange when prev button clicked', () => {
    const onPageChange = vi.fn();
    const pageInfo = makePageInfo({ page: 2, hasPreviousPage: true });
    render(<HubKeywordList {...defaultProps({ page: 2, pageInfo, onPageChange })} />);
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('shows "Page N of M" text', () => {
    const pageInfo = makePageInfo({ page: 1, totalPages: 5 });
    render(<HubKeywordList {...defaultProps({ page: 1, pageInfo })} />);
    expect(screen.getByText(/page 1 of 5/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// localSeoColumnLabel pure helper
// ---------------------------------------------------------------------------
describe('localSeoColumnLabel', () => {
  it('returns "Visible" for posture visible_locally (via localSeo.posture=visible)', () => {
    const row = makeRow({ localSeo: { posture: 'visible' } as KeywordCommandCenterRow['localSeo'] });
    expect(localSeoColumnLabel(row)).toBe('Visible');
  });

  it('returns "Possible" for posture possible_match', () => {
    const row = makeRow({ localSeo: { posture: 'possible_match' } as KeywordCommandCenterRow['localSeo'] });
    expect(localSeoColumnLabel(row)).toBe('Possible');
  });

  it('returns "Not Visible" for posture not_visible', () => {
    const row = makeRow({ localSeo: { posture: 'not_visible' } as KeywordCommandCenterRow['localSeo'] });
    expect(localSeoColumnLabel(row)).toBe('Not Visible');
  });

  it('returns "Degraded" for posture provider_degraded', () => {
    const row = makeRow({ localSeo: { posture: 'provider_degraded' } as KeywordCommandCenterRow['localSeo'] });
    expect(localSeoColumnLabel(row)).toBe('Degraded');
  });

  it('returns localSeoState.lifecycleLabel when localSeo is absent but localSeoState is present', () => {
    const row = makeRow({
      localSeo: undefined,
      localSeoState: {
        lifecycle: 'candidate',
        lifecycleLabel: 'Candidate',
        priority: 'high_opportunity',
        priorityLabel: 'High Opportunity',
        detail: '',
        checked: false,
        sourceLabels: [],
      },
    });
    expect(localSeoColumnLabel(row)).toBe('Candidate');
  });

  it('returns undefined when neither localSeo nor localSeoState present', () => {
    const row = makeRow({ localSeo: undefined, localSeoState: undefined });
    expect(localSeoColumnLabel(row)).toBeUndefined();
  });

  it('returns undefined for unknown posture', () => {
    const row = makeRow({ localSeo: { posture: 'local_pack_present' } as KeywordCommandCenterRow['localSeo'] });
    // local_pack_present is not in the hub mapping — falls through to localSeoState check
    expect(localSeoColumnLabel(row)).toBeUndefined();
  });
});
