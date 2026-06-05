/**
 * KeywordHub — the unified Keyword Hub surface (Wave 4, Phase P1).
 *
 * P1-T4: the full Hub shell, replacing the T1 stub. Composes:
 *   - useKeywordHubState (the single interaction-state owner — segment/search/
 *     sort/page/selection/advancedFilter)
 *   - useKeywordCommandCenterSummary → HubSegmentBar counts + advanced-filter metas
 *   - useKeywordCommandCenterRows → the list
 *   - useKeywordCommandCenterBulkAction → bulk lifecycle mutation
 *   - useWorkspaceEvents(RANK_TRACKING_UPDATED, STRATEGY_UPDATED) → cache invalidation
 *
 * `?tab=` two-halves contract: this component reads `useSearchParams().get('tab')`
 * and seeds `initialSegment`. P4's deep-link senders construct
 * `adminPath(ws, 'seo-keywords') + ?tab=<HubSegment>` against this receiver.
 *
 * Gate: rendered only when the 'keyword-hub' feature flag is ON — the gate lives
 * in App.tsx, NOT here (per plan: "the component is NOT itself wrapped in
 * <FeatureFlag>"). `showLocalSeo` is gated narrowly on `local-seo-visibility`.
 *
 * Four Laws of Color enforced via the shared primitives. No violet/indigo/rose/pink.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { FormInput, PageHeader, SectionCard } from './ui';
import { KeywordBulkConfirmDialog } from './keyword-command-center/KeywordBulkConfirmDialog';
import { KeywordDetailDrawer } from './keyword-command-center/KeywordDetailDrawer';
import { summarizeBulkAction, type KeywordBulkActionSummary } from './keyword-command-center/kccActionHelpers';
import { isServerAction } from './keyword-command-center/kccDisplayHelpers';
import { queryKeys } from '../lib/queryKeys';
import { WS_EVENTS } from '../lib/wsEvents';
import { readHubDeepLink } from '../lib/keywordHubDeepLink';
import { adminPath } from '../routes';
import { useFeatureFlag } from '../hooks/useFeatureFlag';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import { useLocalSeoRefresh } from '../hooks/admin/useLocalSeo';
import {
  useKeywordCommandCenterAction,
  useKeywordCommandCenterBulkAction,
  useKeywordCommandCenterDetail,
  useKeywordCommandCenterRows,
  useKeywordCommandCenterSummary,
  useKeywordHardDelete,
} from '../hooks/admin/useKeywordCommandCenter';
import { useKeywordHubState } from '../hooks/admin/useKeywordHubState';
import type { HubSortKey } from '../hooks/admin/useKeywordHubState';
import {
  HubSegmentBar,
  HUB_SEGMENT_METAS,
  type HubSegmentMeta,
} from './keyword-hub/HubSegmentBar';
import { HubAdvancedFilters } from './keyword-hub/HubAdvancedFilters';
import { HubKeywordList } from './keyword-hub/HubKeywordList';
import type {
  KeywordCommandCenterActionType,
  KeywordCommandCenterBulkActionResult,
  KeywordCommandCenterBulkActionType,
  KeywordCommandCenterCounts,
  KeywordCommandCenterNextAction,
  KeywordCommandCenterSort,
} from '../../shared/types/keyword-command-center';

export interface KeywordHubProps {
  workspaceId: string;
}

// ---------------------------------------------------------------------------
// HubSortKey → server KeywordCommandCenterSort
// ---------------------------------------------------------------------------

/**
 * Maps a HubSortKey to the server's KeywordCommandCenterSort capability.
 * Verified against KeywordCommandCenterSort = 'priority' | 'keyword' | 'demand' | 'rank'.
 *   keyword           → keyword
 *   position | change → rank
 *   volume | difficulty → demand
 *   date | clicks     → priority (fallback — no dedicated server sort)
 */
function hubSortToKccSort(key: HubSortKey): KeywordCommandCenterSort {
  switch (key) {
    case 'keyword':
      return 'keyword';
    case 'position':
    case 'change':
      return 'rank';
    case 'volume':
    case 'difficulty':
      return 'demand';
    case 'clicks':
    case 'date':
    default:
      return 'priority';
  }
}

// ---------------------------------------------------------------------------
// Segment counts from summary
// ---------------------------------------------------------------------------

function segmentCount(
  id: HubSegmentMeta['id'],
  counts: KeywordCommandCenterCounts | undefined,
): number | undefined {
  if (!counts) return undefined;
  switch (id) {
    case 'all':
      return counts.total;
    case 'in_strategy':
      return counts.inStrategy;
    case 'tracked':
      return counts.tracked;
    case 'needs_review':
      return counts.needsReview;
    case 'retired':
      return counts.retired;
    case 'local':
      return counts.local;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KeywordHub({ workspaceId }: KeywordHubProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Deep-link receiver (the two-halves contract's receiving half). Read ONCE on
  // mount via a ref so the params seed initial state without a useEffect that
  // would fight later user input. `?tab=` seeds the segment; `?q=` seeds the
  // search AND (below) opens the drawer on the matching row.
  const deepLink = useRef(readHubDeepLink(searchParams)).current;

  const hub = useKeywordHubState({
    initialSegment: searchParams.get('tab'),
    initialSearch: deepLink.query ?? undefined,
  });

  const showLocalSeo = useFeatureFlag('local-seo-visibility');

  // Journey drawer (P2): the selected row opens the per-keyword detail drawer.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const detail = useKeywordCommandCenterDetail(workspaceId, selectedKey);

  // Data --------------------------------------------------------------------
  const summary = useKeywordCommandCenterSummary(workspaceId);
  const counts = summary.data?.counts;
  const filterMetas = summary.data?.filters ?? [];

  const rowsQuery = useMemo(
    () => ({
      filter: hub.activeKccFilter,
      search: hub.debouncedSearch.trim() || undefined,
      sort: hubSortToKccSort(hub.sort.key),
      page: hub.page,
      pageSize: 50,
    }),
    [hub.activeKccFilter, hub.debouncedSearch, hub.sort.key, hub.page],
  );

  const rowsResult = useKeywordCommandCenterRows(workspaceId, rowsQuery);
  const rows = rowsResult.data?.rows ?? [];
  const pageInfo = rowsResult.data?.pageInfo;

  const bulkAction = useKeywordCommandCenterBulkAction(workspaceId);
  const rowAction = useKeywordCommandCenterAction(workspaceId);
  const hardDelete = useKeywordHardDelete(workspaceId);
  const localRefresh = useLocalSeoRefresh(workspaceId);

  // The selected row for the drawer: the freshly-fetched detail row when it
  // arrives, otherwise the list row as an instant preview (mirrors KCC).
  const selectedPreviewRow = useMemo(
    () => (selectedKey ? rows.find((r) => r.normalizedKeyword === selectedKey) ?? null : null),
    [rows, selectedKey],
  );
  const selectedRow = detail.data?.row ?? selectedPreviewRow;

  // Deep-link `?q=` open-on-mount: once rows load, open the drawer on the row
  // matching the normalized query. Guarded ref → fires at most once and never
  // fights later user navigation; no-op when there is no `q` or no match.
  const deepLinkOpenedRef = useRef(false);
  useEffect(() => {
    if (deepLinkOpenedRef.current) return;
    if (!deepLink.query) {
      deepLinkOpenedRef.current = true;
      return;
    }
    if (rows.length === 0) return;
    const match = rows.find((r) => r.normalizedKeyword === deepLink.query);
    if (match) setSelectedKey(match.normalizedKeyword);
    deepLinkOpenedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only deep-link open; deepLink is a stable ref value
  }, [rows]);

  // WebSocket: invalidate on rank/strategy mutations (both-halves contract).
  const wsHandlers = useMemo(
    () => ({
      [WS_EVENTS.RANK_TRACKING_UPDATED]: () =>
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.keywordCommandCenter(workspaceId),
        }),
      [WS_EVENTS.STRATEGY_UPDATED]: () =>
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.keywordCommandCenter(workspaceId),
        }),
    }),
    [queryClient, workspaceId],
  );
  useWorkspaceEvents(workspaceId, wsHandlers);

  // Segment metas with live counts -----------------------------------------
  const segments: HubSegmentMeta[] = useMemo(
    () =>
      HUB_SEGMENT_METAS.map((meta) => ({
        ...meta,
        count: segmentCount(meta.id, counts),
      })),
    [counts],
  );

  // Bulk action handler (P3-3d) ---------------------------------------------
  // Reuses summarizeBulkAction + KeywordBulkConfirmDialog: a selection with a protected
  // row (or a retire/decline) requires confirmation before mutating. Per-item results
  // (applied / skipped_protected / skipped_not_tracked / error) render as a summary.
  const [pendingBulk, setPendingBulk] = useState<KeywordBulkActionSummary | null>(null);
  const [bulkResult, setBulkResult] = useState<KeywordCommandCenterBulkActionResult | null>(null);

  // The currently-selected rows (for protection/tracking-state summarization).
  const selectedBulkRows = useMemo(
    () => rows.filter((r) => hub.selectedKeys.has(r.normalizedKeyword)),
    [rows, hub.selectedKeys],
  );

  const runBulkAction = (summary: KeywordBulkActionSummary, force: boolean) => {
    setBulkResult(null);
    bulkAction.mutate(
      { action: summary.action, keywords: summary.keywords, force: force || undefined },
      {
        onSuccess: (result) => {
          setBulkResult(result);
          setPendingBulk(null);
          hub.clearSelection();
        },
      },
    );
  };

  const handleBulkAction = (action: KeywordCommandCenterBulkActionType) => {
    const summary = summarizeBulkAction(selectedBulkRows, action);
    if (summary.total === 0) return;
    if (summary.requiresConfirmation) {
      setPendingBulk(summary);
      return;
    }
    runBulkAction(summary, false);
  };

  // Per-row lifecycle action + the separate hard-delete channel (P3-3b/3c).
  const handleRowAction = (keyword: string, action: KeywordCommandCenterActionType, opts?: { force?: boolean }) => {
    rowAction.mutate({ action, keyword, force: opts?.force });
  };
  const handleDeleteHard = (keyword: string) => {
    hardDelete.mutate({ keyword });
  };

  // Drawer action dispatcher (P2 journey drawer). The drawer emits a
  // KeywordCommandCenterNextAction from the selected row's nextActions; route
  // every type the same way KCC's handleAction does so no drawer button is a
  // silent no-op (navigation actions navigate, local-visibility refreshes,
  // lifecycle actions hit the action mutation).
  const handleDrawerAction = (action: KeywordCommandCenterNextAction) => {
    const row = selectedRow;
    if (!row) return;
    if (action.type === 'view_rankings') {
      // National rank lives in this drawer's own section — it is already open.
      setSelectedKey(row.normalizedKeyword);
      return;
    }
    if (action.type === 'review_page') {
      navigate(adminPath(workspaceId, 'page-intelligence'), {
        state: {
          fixContext: {
            targetRoute: 'page-intelligence',
            pageSlug: action.pagePath,
            pageName: row.assignment?.pageTitle,
            primaryKeyword: row.keyword,
          },
        },
      });
      return;
    }
    if (action.type === 'generate_brief') {
      navigate(adminPath(workspaceId, 'content-pipeline'), {
        state: {
          fixContext: {
            targetRoute: 'content-pipeline',
            primaryKeyword: row.keyword,
            pageType: row.assignment?.role === 'content_gap' ? 'blog' : undefined,
          },
        },
      });
      return;
    }
    if (action.type === 'check_local_visibility') {
      localRefresh.mutate({ keywords: [row.keyword] });
      return;
    }
    if (!isServerAction(action.type)) return;
    // Protected keywords (client-requested, strategy-owned, gap-sourced, pinned)
    // come back with `disabledReason` set on their lifecycle actions — but NOT
    // `disabled` — so the drawer renders them as live buttons. The server rejects
    // an UNFORCED protected mutation, so force-flag exactly as the list's
    // KeywordActionMenu does (`a.disabledReason ? { force: true }`); otherwise a
    // protected retire/decline/pause would throw instead of applying.
    rowAction.mutate({
      action: action.type,
      keyword: row.keyword,
      pagePath: action.pagePath,
      force: action.disabledReason ? true : undefined,
    });
  };

  // Reset all active filters (segment → 'all', search → '', advanced → null).
  // Distinct from clearSelection, which only empties the multi-select Set.
  const handleResetFilters = () => {
    hub.setSegment('all');
    hub.setSearchTerm('');
    hub.setAdvancedFilter(null);
  };

  const visibleKeys = useMemo(
    () => rows.map((r) => r.normalizedKeyword),
    [rows],
  );
  const allSelected = hub.allSelected(visibleKeys);

  // Surface a failed row/drawer/local action (mirrors KCC's actionErrorMessage).
  // Without this a thrown mutation — e.g. a server-rejected lifecycle move — would
  // fail silently in the Hub.
  const firstError = rowAction.error ?? hardDelete.error ?? localRefresh.error ?? bulkAction.error;
  const actionErrorMessage = firstError instanceof Error
    ? firstError.message
    : firstError
      ? 'Keyword action failed. Try again or refresh the page.'
      : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Keyword Hub"
        subtitle="One surface for every keyword — strategy, tracking, rank, and local visibility."
        actions={
          <div className="w-[260px]">
            <FormInput
              value={hub.searchTerm}
              onChange={hub.setSearchTerm}
              placeholder="Search keywords, pages..."
              aria-label="Search keywords"
            />
          </div>
        }
      />

      {actionErrorMessage && (
        <div
          role="alert"
          className="rounded-[var(--radius-xl)] border border-red-500/40 bg-red-500/10 px-4 py-3"
        >
          <p className="t-caption font-semibold text-red-400">{actionErrorMessage}</p>
        </div>
      )}

      <SectionCard noPadding variant="subtle">
        <div className="px-3 py-3 border-b border-[var(--brand-border)] flex flex-wrap items-center gap-2">
          <HubSegmentBar
            segments={segments}
            active={hub.segment}
            onChange={hub.setSegment}
            isLoading={summary.isLoading}
          />
          <div className="ml-auto">
            <HubAdvancedFilters
              activeAdvancedFilter={hub.advancedFilter}
              filterMetas={filterMetas}
              onChange={hub.setAdvancedFilter}
            />
          </div>
        </div>

        <HubKeywordList
          workspaceId={workspaceId}
          rows={rows}
          pageInfo={pageInfo}
          isLoading={rowsResult.isLoading}
          isError={rowsResult.isError}
          sort={hub.sort}
          onSort={hub.setSort}
          selectedKeys={hub.selectedKeys}
          onToggleKey={hub.toggleKey}
          onToggleAll={hub.toggleAll}
          someSelected={hub.someSelected}
          allSelected={allSelected}
          page={hub.page}
          onPageChange={hub.setPage}
          isBulkPending={bulkAction.isPending}
          onBulkAction={handleBulkAction}
          onRowAction={handleRowAction}
          onDeleteHard={handleDeleteHard}
          isRowActionPending={rowAction.isPending || hardDelete.isPending}
          onClearSelection={hub.clearSelection}
          onResetFilters={handleResetFilters}
          onRowClick={(row) => setSelectedKey(row.normalizedKeyword)}
          activeKeyword={selectedKey}
          showLocalSeo={showLocalSeo}
        />
      </SectionCard>

      {/* Per-keyword journey drawer (P2): origin → tracking → national rank →
          local-per-market → lifecycle, plus the deep-link back-links. */}
      <KeywordDetailDrawer
        open={!!selectedKey}
        row={selectedRow}
        workspaceId={workspaceId}
        isLoading={detail.isFetching && !!selectedKey && !detail.data}
        loadingAction={localRefresh.isPending ? 'check_local_visibility' : rowAction.isPending ? rowAction.variables?.action : undefined}
        onAction={handleDrawerAction}
        onClose={() => setSelectedKey(null)}
      />

      {/* Per-item bulk result summary (applied / skipped / failed). */}
      {bulkResult && (
        <div
          role="status"
          className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-3)]/40 px-4 py-3"
        >
          <p className="t-caption font-semibold text-[var(--brand-text-bright)]">{bulkResult.message}</p>
          {(bulkResult.skipped > 0 || bulkResult.failed > 0) && (
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">
              {bulkResult.skipped > 0 ? `${bulkResult.skipped} skipped by protection or tracking state. ` : ''}
              {bulkResult.failed > 0 ? `${bulkResult.failed} failed — review the selected keywords and try again.` : ''}
            </p>
          )}
        </div>
      )}

      <KeywordBulkConfirmDialog
        summary={pendingBulk}
        isPending={bulkAction.isPending}
        onConfirm={(force) => {
          if (pendingBulk) runBulkAction(pendingBulk, force);
        }}
        onCancel={() => setPendingBulk(null)}
      />
    </div>
  );
}
