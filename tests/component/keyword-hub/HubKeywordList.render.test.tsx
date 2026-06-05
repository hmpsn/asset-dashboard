/**
 * HubKeywordList — RENDER-LEVEL regression tests (NOT prop-shape tests).
 *
 * These render the REAL KeywordTable primitive (no mock) and assert on the
 * actual rendered DOM. They exist because the prop-level suite
 * (HubKeywordList.test.tsx) mocks KeywordTable and therefore never noticed that
 * the list was feeding raw KeywordCommandCenterRow objects to the table while
 * the table reads FLAT metric fields — so every metric cell rendered a dash and
 * rows were not clickable (the two owner-reported launch bugs).
 *
 * Guards:
 *   - metric cells render real values from row.metrics.* (SEED-1: no data)
 *   - the local column renders localSeoColumnLabel (was computed-but-unassigned)
 *   - clicking a keyword row fires onRowClick (SEED-2: inert rows)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { HubKeywordList } from '../../../src/components/keyword-hub/HubKeywordList';
import type { KeywordCommandCenterRow, KeywordCommandCenterPageInfo } from '../../../shared/types/keyword-command-center';
import type { HubSortState } from '../../../src/hooks/admin/useKeywordHubState';

function makeRow(overrides: Partial<KeywordCommandCenterRow> = {}): KeywordCommandCenterRow {
  return {
    keyword: 'example keyword',
    normalizedKeyword: 'example-keyword',
    lifecycleStatus: 'tracked',
    statusLabel: 'Tracked',
    sourceLabels: [],
    // currentPosition (NOT position), nested under metrics — the exact shape the
    // table must be adapted to read.
    metrics: { currentPosition: 3, clicks: 42, volume: 2400, difficulty: 55 },
    tracking: { status: 'active' },
    nextActions: [],
    isProtected: false,
    ...overrides,
  };
}

const pageInfo: KeywordCommandCenterPageInfo = {
  page: 1, pageSize: 50, totalRows: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false,
};
const sort: HubSortState = { key: 'keyword', direction: 'asc' };

function props(overrides: Partial<React.ComponentProps<typeof HubKeywordList>> = {}) {
  return {
    workspaceId: 'ws-1',
    rows: [makeRow()],
    pageInfo,
    isLoading: false,
    isError: false,
    sort,
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

function renderList(overrides: Partial<React.ComponentProps<typeof HubKeywordList>> = {}) {
  return render(
    <MemoryRouter>
      <HubKeywordList {...props(overrides)} />
    </MemoryRouter>,
  );
}

describe('HubKeywordList — real-table render (regression: list shows no data)', () => {
  it('renders the position cell from row.metrics.currentPosition', () => {
    renderList();
    // DataCell renders position as "#<rounded>" — proves metrics are wired.
    expect(screen.getByText('#3')).toBeInTheDocument();
  });

  it('renders the clicks cell from row.metrics.clicks (not 0)', () => {
    renderList();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders the volume cell from row.metrics.volume (not a dash)', () => {
    renderList();
    // DataCell renders volume as "<fmtNum>/mo"; assert the /mo unit appears.
    expect(screen.getByText(/\/mo$/)).toBeInTheDocument();
  });

  it('renders the local column label from row.localSeo when showLocalSeo', () => {
    renderList({
      showLocalSeo: true,
      rows: [makeRow({ localSeo: { posture: 'visible' } as KeywordCommandCenterRow['localSeo'] })],
    });
    expect(screen.getByText('Visible')).toBeInTheDocument();
  });
});

describe('HubKeywordList — row click (regression: rows not clickable)', () => {
  it('fires onRowClick with the row when the keyword cell is clicked', () => {
    const onRowClick = vi.fn();
    renderList({ onRowClick });
    fireEvent.click(screen.getByText('example keyword'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0].normalizedKeyword).toBe('example-keyword');
  });
});
