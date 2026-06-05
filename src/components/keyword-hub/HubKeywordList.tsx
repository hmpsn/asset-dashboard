/**
 * HubKeywordList — the unified Keyword Hub list (P1-T3).
 *
 * Renders the keyword table using the extended KeywordTable primitive with:
 *   - columns: position, change, clicks, volume, difficulty
 *   - changeSign="lowerIsBetter" (rank position: lower = better)
 *   - showLocalSeo from prop
 *   - sort wired to onSort (emits raw HubSortKey column keys; the shell translates to KeywordCommandCenterSort)
 *   - selection by normalizedKeyword
 *   - renderKeywordMeta → <HubKeywordRowMeta>
 *   - action-oriented EmptyState with Clear-filters affordance
 *   - loading Skeleton via KeywordTable's loading prop
 *   - ErrorState when isError
 *   - KeywordBulkActionBar when someSelected
 *   - Pagination (prev/next ghost buttons + "Page N of M" + total)
 *
 * Also exports the pure `localSeoColumnLabel` helper used to pre-resolve the
 * `localSeoLabel` slot on KeywordTableRow for the local-SEO column.
 *
 * Four Laws of Color enforced: teal=actions, blue=data, emerald=success, amber/red=warn.
 * No violet/indigo/rose/pink; no green-* success colors — emerald only.
 *
 * TODO: virtualize when rows > 200 (react-virtual)
 */
import { Search } from 'lucide-react';
import { KeywordTable } from '../shared/RankTable';
import { ErrorState } from '../ui/ErrorState';
import { KeywordBulkActionBar } from '../keyword-command-center/KeywordBulkActionBar';
import { KeywordActionMenu } from '../keyword-command-center/KeywordActionMenu';
import { HubKeywordRowMeta } from './HubKeywordRowMeta';
import { Button } from '../ui/Button';
import type { KeywordCommandCenterRow, KeywordCommandCenterPageInfo, KeywordCommandCenterActionType, KeywordCommandCenterBulkActionType } from '../../../shared/types/keyword-command-center';
import type { HubSortState, HubSortKey } from '../../hooks/admin/useKeywordHubState';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HubKeywordListProps {
  workspaceId: string;
  rows: KeywordCommandCenterRow[];
  pageInfo: KeywordCommandCenterPageInfo | undefined;
  isLoading: boolean;
  isError: boolean;
  sort: HubSortState;
  onSort: (key: HubSortKey) => void;
  selectedKeys: Set<string>;
  onToggleKey: (k: string) => void;
  onToggleAll: (visibleKeys: string[]) => void;
  someSelected: boolean;
  allSelected: boolean;
  page: number;
  onPageChange: (p: number) => void;
  isBulkPending: boolean;
  onBulkAction: (action: KeywordCommandCenterBulkActionType) => void;
  /** Per-row lifecycle action (P3-3b) — mounts via KeywordActionMenu in the row actions slot. */
  onRowAction: (keyword: string, action: KeywordCommandCenterActionType, opts?: { force?: boolean }) => void;
  /** Separate hard-delete channel (P3-3c) — never a lifecycle action. */
  onDeleteHard: (keyword: string) => void;
  /** True while a per-row action or hard delete is in flight — disables the row menu. */
  isRowActionPending: boolean;
  onClearSelection: () => void;
  /** Resets the active segment/search/advanced-filter (NOT the multi-select). Wired to the empty-state "Clear filters" CTA. */
  onResetFilters: () => void;
  /** Opens the per-keyword journey drawer for a row (P2 drawer wiring). */
  onRowClick: (row: KeywordCommandCenterRow) => void;
  /** normalizedKeyword of the row whose drawer is currently open — drives the active-row highlight. */
  activeKeyword?: string | null;
  showLocalSeo: boolean;
}

/**
 * The KeywordTable primitive renders its built-in metric columns from FLAT row
 * fields (`row.position`, `row.clicks`, `row.volume`, `row.difficulty`) and the
 * local column from `row.localSeoLabel`. A KeywordCommandCenterRow instead nests
 * its metrics under `row.metrics` (`currentPosition`, etc.). This adapter lifts
 * those onto the flat fields the table reads so the cells render real values —
 * without it every metric/local cell silently renders a dash. (`change` has no
 * per-row source on a KCC row, so the Hub does not render a change column; the
 * rank journey lives in the drawer.)
 */
type HubKeywordTableRow = KeywordCommandCenterRow & {
  position?: number;
  clicks?: number;
  volume?: number;
  difficulty?: number;
  localSeoLabel?: string;
};

// ---------------------------------------------------------------------------
// Pure helper — localSeoColumnLabel
// ---------------------------------------------------------------------------

/**
 * Resolves a concise label for the local-SEO column from the row's local-seo data.
 *
 * Priority:
 *   1. row.localSeo.posture → short label map
 *   2. row.localSeoState.lifecycleLabel → raw lifecycle label
 *   3. undefined (no local-seo data on this row)
 *
 * Posture mapping (mirrors KEYWORD_COMMAND_CENTER_FILTERS visible-locally group):
 *   visible        → "Visible"
 *   possible_match → "Possible"
 *   not_visible    → "Not Visible"
 *   provider_degraded → "Degraded"
 *   (other postures, e.g. local_pack_present) → falls through to localSeoState
 */
export function localSeoColumnLabel(row: KeywordCommandCenterRow): string | undefined {
  const posture = row.localSeo?.posture;
  if (posture === 'visible') return 'Visible';
  if (posture === 'possible_match') return 'Possible';
  if (posture === 'not_visible') return 'Not Visible';
  if (posture === 'provider_degraded') return 'Degraded';

  // Fallback: lifecycle label from the localSeoState (candidate, checked, etc.)
  if (row.localSeoState?.lifecycleLabel) {
    return row.localSeoState.lifecycleLabel;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
//
// NOTE: the HubSortKey → KeywordCommandCenterSort translation (for the server
// query) lives in the KeywordHub shell (`hubSortToKccSort`), NOT here. This
// list emits raw column keys through `onSort`, which the shell interprets as
// HubSortKey values when updating `useKeywordHubState`.

export function HubKeywordList({
  rows,
  pageInfo,
  isLoading,
  isError,
  sort,
  onSort,
  selectedKeys,
  onToggleKey,
  onToggleAll,
  someSelected,
  allSelected,
  page,
  onPageChange,
  isBulkPending,
  onBulkAction,
  onRowAction,
  onDeleteHard,
  isRowActionPending,
  onClearSelection,
  onResetFilters,
  onRowClick,
  activeKeyword,
  showLocalSeo,
}: HubKeywordListProps) {
  // Passthrough: the table emits raw column keys (HubSortKey values); forward
  // them unchanged to the Hub sort handler. The HubSortKey → KeywordCommandCenterSort
  // translation for the server query lives in the KeywordHub shell (`hubSortToKccSort`).
  const handleSort = (rawKey: string) => {
    onSort(rawKey as HubSortKey);
  };

  const visibleKeys = rows.map((r) => r.normalizedKeyword);

  // Adapt KCC rows onto the flat shape the KeywordTable primitive reads (see
  // HubKeywordTableRow). Preserves the full row (keyword/normalizedKeyword/
  // metrics/tracking/...) so the selection, meta, action, and row-click slots
  // still receive a complete KeywordCommandCenterRow.
  const tableRows: HubKeywordTableRow[] = rows.map((r) => ({
    ...r,
    position: r.metrics.currentPosition,
    clicks: r.metrics.clicks,
    volume: r.metrics.volume,
    difficulty: r.metrics.difficulty,
    localSeoLabel: localSeoColumnLabel(r),
  }));

  // Error state — rendered before the table so it's always visible
  if (isError) {
    return (
      <div className="overflow-y-auto">
        <ErrorState
          title="Could not load keywords"
          message="Check your connection and try again."
          type="data"
        />
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      {/* TODO: virtualize when rows > 200 (react-virtual) */}
      <KeywordTable<HubKeywordTableRow>
        rows={tableRows}
        columns={['position', 'clicks', 'volume', 'difficulty']}
        showLocalSeo={showLocalSeo}
        onRowClick={onRowClick}
        isRowActive={(r) => !!activeKeyword && r.normalizedKeyword === activeKeyword}
        sort={{
          key: sort.key,
          direction: sort.direction,
          onSort: handleSort,
        }}
        selection={{
          selected: selectedKeys,
          onToggle: onToggleKey,
          rowId: (r) => r.normalizedKeyword,
          label: (r) => `Select ${r.keyword}`,
          header: {
            checked: allSelected,
            onToggle: (checked) => {
              if (checked) {
                onToggleAll(visibleKeys);
              } else {
                onClearSelection();
              }
            },
            label: 'Select all visible keywords',
          },
        }}
        keywordText={(r) => r.keyword}
        renderKeywordMeta={(r) => <HubKeywordRowMeta row={r} />}
        renderActions={(r) => (
          <KeywordActionMenu
            row={r}
            isPending={isRowActionPending}
            onAction={(action: KeywordCommandCenterActionType, opts) => onRowAction(r.keyword, action, opts)}
            onDeleteHard={onDeleteHard}
          />
        )}
        loading={isLoading && rows.length === 0}
        emptyState={{
          icon: Search,
          title: 'No keywords match your filters',
          description: 'Try adjusting your filters or search term.',
          action: (
            <Button
              variant="ghost"
              size="sm"
              onClick={onResetFilters}
              aria-label="Clear filters"
            >
              Clear filters
            </Button>
          ),
        }}
        stickyHeader
        density="comfortable"
      />

      {/* Pagination */}
      {pageInfo && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-4 px-3 py-3 border-t border-[var(--brand-border)] t-caption text-[var(--brand-text-muted)]"
        >
          <span>
            Page {pageInfo.page} of {pageInfo.totalPages}
            {pageInfo.totalRows > 0 && (
              <span className="ml-2 text-[var(--brand-text-muted)]">
                ({pageInfo.totalRows.toLocaleString()} total)
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!pageInfo.hasPreviousPage}
              onClick={() => onPageChange(page - 1)}
              aria-label="Previous page"
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!pageInfo.hasNextPage}
              onClick={() => onPageChange(page + 1)}
              aria-label="Next page"
            >
              Next
            </Button>
          </div>
        </nav>
      )}

      {/* Bulk action bar — floats over the bottom of the page when rows are selected */}
      {someSelected && (
        <KeywordBulkActionBar
          selectedCount={selectedKeys.size}
          isPending={isBulkPending}
          onAction={onBulkAction}
          onClear={onClearSelection}
        />
      )}
    </div>
  );
}
