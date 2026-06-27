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
 * This is the canonical keyword surface: App.tsx renders it unconditionally for
 * the `seo-keywords` tab (the legacy Keyword Command Center and standalone Rank
 * Tracker were retired in the W4 cutover). `showLocalSeo` reflects the canonical
 * local SEO surface.
 *
 * Four Laws of Color enforced via the shared primitives. No violet/indigo/rose/pink.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Eye, MapPin, RefreshCw, Target, TrendingUp } from 'lucide-react'; // trend-icon-ok — TrendingUp is a summary-metric icon here, not a trend badge

import { Button, ConfirmDialog, FormInput, PageHeader, SectionCard } from './ui';
import { KeywordBulkConfirmDialog } from './keyword-command-center/KeywordBulkConfirmDialog';
import { KeywordDetailDrawer } from './keyword-command-center/KeywordDetailDrawer';
import { SummaryMetric } from './keyword-command-center/SummaryMetric';
import { LocalSeoVisibilityPanel } from './local-seo/LocalSeoVisibilityPanel';
import { AiVisibilityPanel } from './strategy/AiVisibilityPanel';
import { summarizeBulkAction, type KeywordBulkActionSummary } from './keyword-command-center/kccActionHelpers';
import { isServerAction } from './keyword-command-center/kccDisplayHelpers';
import { queryKeys } from '../lib/queryKeys';
import { WS_EVENTS } from '../lib/wsEvents';
import { readHubDeepLink } from '../lib/keywordHubDeepLink';
import { adminPath } from '../routes';
import { GSC_METRIC_WINDOW_DAYS } from '../../shared/keyword-window';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import { useLocalSeoRefresh } from '../hooks/admin/useLocalSeo';
import { FeatureFlag } from './ui/FeatureFlag';
import {
  useKeywordCommandCenterAction,
  useKeywordCommandCenterBulkAction,
  useKeywordCommandCenterDetail,
  useKeywordCommandCenterInitialView,
  useKeywordCommandCenterRows,
  useKeywordCommandCenterSummary,
  useKeywordHardDelete,
  useNationalSerpRefresh,
  useRankTrackingAddKeyword,
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
 * Verified against
 *   KeywordCommandCenterSort = 'priority' | 'keyword' | 'demand' | 'rank' | 'clicks' | 'difficulty'.
 *   keyword     → keyword
 *   position    → rank
 *   clicks      → clicks   (dedicated server sort, Task 1)
 *   volume      → demand
 *   difficulty  → difficulty (dedicated server sort, Task 1)
 *   change | date → priority (not rendered as sortable columns — harmless default)
 */
function hubSortToKccSort(key: HubSortKey): KeywordCommandCenterSort {
  switch (key) {
    case 'opportunity':
      return 'opportunity';
    case 'keyword':
      return 'keyword';
    case 'position':
      return 'rank';
    case 'clicks':
      return 'clicks';
    case 'volume':
      return 'demand';
    case 'difficulty':
      return 'difficulty';
    case 'change':
    case 'date':
    default:
      return 'priority';
  }
}

function rowsQuerySignature(query: {
  filter?: string;
  search?: string;
  sort?: string;
  direction?: string;
  page?: number;
  pageSize?: number;
}): string {
  return [
    query.filter ?? '',
    query.search ?? '',
    query.sort ?? '',
    query.direction ?? '',
    query.page ?? '',
    query.pageSize ?? '',
  ].join('|');
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
    case 'striking_distance':
      return counts.strikingDistance;
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

  const showLocalSeo = true;

  // Deferred local panel: mount after first rows render (idle-callback pattern,
  // same as KCC ~:228-240). The placeholder shows until rows arrive.
  const [localPanelEnabled, setLocalPanelEnabled] = useState(false);

  // Journey drawer (P2): the selected row opens the per-keyword detail drawer.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const detail = useKeywordCommandCenterDetail(workspaceId, selectedKey);

  const rowsQuery = useMemo(
    () => ({
      filter: hub.activeKccFilter,
      search: hub.debouncedSearch.trim() || undefined,
      sort: hubSortToKccSort(hub.sort.key),
      direction: hub.sort.direction,
      page: hub.page,
      pageSize: 50,
    }),
    [hub.activeKccFilter, hub.debouncedSearch, hub.sort.key, hub.sort.direction, hub.page],
  );

  const initialRowsQueryRef = useRef(rowsQuery);
  const initialView = useKeywordCommandCenterInitialView(workspaceId, initialRowsQueryRef.current);
  const viewingInitialRows = rowsQuerySignature(rowsQuery) === rowsQuerySignature(initialRowsQueryRef.current);
  const summary = useKeywordCommandCenterSummary(workspaceId, {
    enabled: initialView.isError,
  });
  const rowsResult = useKeywordCommandCenterRows(workspaceId, rowsQuery, {
    enabled: !viewingInitialRows || initialView.isError,
  });
  const summaryData = initialView.data?.summary ?? summary.data;
  const rowsData = viewingInitialRows ? initialView.data?.rows ?? rowsResult.data : rowsResult.data;
  const rowsError = rowsData || rowsResult.isLoading
    ? null
    : viewingInitialRows ? rowsResult.error ?? initialView.error : rowsResult.error;
  const counts = summaryData?.counts;
  const filterMetas = summaryData?.filters ?? [];
  const summaryLoading = initialView.isLoading || summary.isLoading;
  const rowsLoading = viewingInitialRows ? initialView.isLoading || rowsResult.isLoading : rowsResult.isLoading;
  const rows = rowsData?.rows ?? [];
  const pageInfo = rowsData?.pageInfo;

  // Trust signals (Task 4) --------------------------------------------------
  // The universe is truncated by the display cap whenever the true post-gate
  // total exceeds the returned/displayed count. We disclose the hidden tail
  // honestly rather than silently dropping it. (Under keyword-universe-full the
  // total can include rank-evidence beyond the value-ceiling, so the copy is a
  // generic "N more keywords below the cap" — accurate for both cases.)
  const rawEvidenceTotal = summaryData?.rawEvidenceTotal ?? 0;
  const rawEvidenceReturned = summaryData?.rawEvidenceReturned ?? 0;
  const hiddenByCap = Math.max(0, rawEvidenceTotal - rawEvidenceReturned);
  const isTruncated = rawEvidenceTotal > rawEvidenceReturned;

  // Summary error band (KCC :461-468 parity) — non-null when the summary fetch fails.
  const summaryErrorMessage = summary.error instanceof Error
    ? summary.error.message
    : summary.error
      ? 'Keyword summary metrics could not load. Row data remains available.'
      : null;

  const bulkAction = useKeywordCommandCenterBulkAction(workspaceId);
  const rowAction = useKeywordCommandCenterAction(workspaceId);
  const hardDelete = useKeywordHardDelete(workspaceId);
  const localRefresh = useLocalSeoRefresh(workspaceId);
  const nationalRefresh = useNationalSerpRefresh(workspaceId);
  const addKeywordMutation = useRankTrackingAddKeyword(workspaceId);

  // Add-keyword input state (local — not a filter, not hub state).
  const [addKeywordValue, setAddKeywordValue] = useState('');

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

  // Reset local panel when workspaceId changes (mirrors KCC :213-216).
  useEffect(() => {
    setLocalPanelEnabled(false);
  }, [workspaceId]);

  // Deferred local panel mount: fires after the first rows response arrives.
  // Falls back to setTimeout(0) when requestIdleCallback is absent (jsdom/test).
  useEffect(() => {
    if (!rowsData) return;
    if (localPanelEnabled) return;
    const idle = 'requestIdleCallback' in window
      ? (window as Window & {
        requestIdleCallback: (callback: IdleRequestCallback, opts?: IdleRequestOptions) => number;
        cancelIdleCallback: (id: number) => void;
      })
      : null;
    if (idle) {
      const id = idle.requestIdleCallback(() => setLocalPanelEnabled(true), { timeout: 400 });
      return () => idle.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(() => setLocalPanelEnabled(true), 0);
    return () => window.clearTimeout(timer);
  }, [localPanelEnabled, rowsData]);

  // WebSocket: invalidate on rank/strategy mutations (both-halves contract).
  const wsHandlers = useMemo(
    () => ({
      [WS_EVENTS.RANK_TRACKING_UPDATED]: () =>
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.keywordCommandCenter(workspaceId),
        }),
      // P6 national-serp-tracking: a national SERP refresh upserted fresh serp_snapshots →
      // re-pull the command center so the drawer's Live SERP / AI-Overview detail updates.
      [WS_EVENTS.SERP_SNAPSHOTS_REFRESHED]: () =>
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

  // Protected drawer action gate: mirrors the KeywordActionMenu ConfirmDialog pattern.
  // The first click sets this; the confirmed click sends force: true.
  const [pendingDrawerForceAction, setPendingDrawerForceAction] = useState<KeywordCommandCenterNextAction | null>(null);

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
    hardDelete.mutate(
      { keyword },
      {
        onSuccess: () => {
          setSelectedKey(null);
        },
      },
    );
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
    // `disabled` — so the drawer renders them as live buttons. Gate behind a
    // ConfirmDialog (same as KeywordActionMenu) so the user sees WHY the keyword
    // is protected before the force is sent. The old code silently set force: true
    // in one click — that was the bug. On confirm the dialog dispatches with force.
    if (action.disabledReason) {
      setPendingDrawerForceAction(action);
      return;
    }
    rowAction.mutate({
      action: action.type,
      keyword: row.keyword,
      pagePath: action.pagePath,
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

  // A filter is active when any non-default state exists — any non-all segment,
  // any search term, or any advancedFilter set (A3 blocker 9: empty-state branch).
  const isFiltered =
    hub.segment !== 'all' ||
    hub.debouncedSearch.trim().length > 0 ||
    hub.advancedFilter !== null;

  // Add-keyword: trim → guard empty → mutateAsync → clear on success.
  // Errors surface via the shared actionErrorMessage band below.
  const handleAddKeyword = async () => {
    const trimmed = addKeywordValue.trim();
    if (!trimmed) return;
    try {
      await addKeywordMutation.mutateAsync(trimmed);
      setAddKeywordValue('');
    } catch {
      // Error surfaced via actionErrorMessage below — no double-reporting needed.
    }
  };

  // Surface a failed row/drawer/local action (mirrors KCC's actionErrorMessage).
  // Without this a thrown mutation — e.g. a server-rejected lifecycle move — would
  // fail silently in the Hub.
  const firstError = rowAction.error ?? hardDelete.error ?? localRefresh.error ?? nationalRefresh.error ?? bulkAction.error ?? addKeywordMutation.error;
  const actionErrorMessage = firstError instanceof Error
    ? firstError.message
    : firstError
      ? 'Keyword action failed. Try again or refresh the page.'
      : null;

  return (
    <div className={`space-y-4${hub.someSelected ? ' pb-24' : ''}`}>
      <PageHeader
        title="Keyword Hub"
        subtitle="One surface for every keyword — strategy, tracking, rank, and local visibility."
        actions={
          // Mobile: flex-col + full-width inputs below sm; row layout above sm (A3 blocker 8).
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {/* Add-keyword input (B1): writes through the existing rank-tracking add path. */}
            <div className="flex items-center gap-1.5">
              <FormInput
                value={addKeywordValue}
                onChange={setAddKeywordValue}
                placeholder="Add keyword..."
                aria-label="Add keyword"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleAddKeyword();
                  }
                }}
              />
              <Button
                variant="primary"
                size="sm"
                disabled={addKeywordMutation.isPending}
                onClick={() => void handleAddKeyword()}
              >
                Add
              </Button>
            </div>

            <div className="w-full sm:w-[260px]">
              <FormInput
                value={hub.searchTerm}
                onChange={hub.setSearchTerm}
                placeholder="Search keywords, pages..."
                aria-label="Search keywords"
              />
            </div>

            {/* P6 national-serp-tracking — flag-gated trigger for the national advanced-SERP
                rank refresh. The route enforces Growth+ tier; a Free workspace gets a 403
                surfaced via the shared error band. Progress shows in the NotificationBell. */}
            <FeatureFlag flag="national-serp-tracking">
              <Button
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                disabled={nationalRefresh.isPending}
                onClick={() => nationalRefresh.mutate()}
              >
                {nationalRefresh.isPending ? 'Refreshing ranks…' : 'Refresh national ranks'}
              </Button>
            </FeatureFlag>
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

      {/* KPI summary cards — 5 top-line counts above the segment bar (KCC :417-431 parity).
          Reuses SummaryMetric (kept in Phase C per A1 adoption).
          Skeleton grid shown while summary data is unavailable. */}
      {counts ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <SummaryMetric label="In Strategy" value={counts.inStrategy ?? 0} icon={Target} tone="teal" />
          <SummaryMetric label="Tracked" value={counts.tracked ?? 0} icon={TrendingUp} tone="blue" />
          <SummaryMetric label="Local" value={counts.local ?? 0} icon={MapPin} tone="blue" />
          <SummaryMetric label="Needs Review" value={counts.needsReview ?? 0} icon={Eye} tone="amber" />
          <SummaryMetric label="Retired" value={counts.retired ?? 0} icon={Archive} tone="zinc" />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="h-[88px] rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-3)]/30 animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Summary error band (KCC :461-468 parity). role="status" so screen readers
          announce the advisory without interrupting the page flow. */}
      {summaryErrorMessage && (
        <div
          role="status"
          className="rounded-[var(--radius-xl)] border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-amber-300 t-caption"
        >
          {summaryErrorMessage}
        </div>
      )}

      {/* Local SEO visibility panel — deferred via requestIdleCallback after first rows
          render (same pattern as KCC :224-240). onOpenKeywords wires to Hub's local segment. */}
      {localPanelEnabled ? (
        <LocalSeoVisibilityPanel
          workspaceId={workspaceId}
          mode="keywords"
          onOpenKeywords={() => {
            hub.setSegment('local');
            hub.setPage(1);
          }}
        />
      ) : (
        <SectionCard title="Local Keyword Visibility" variant="subtle">
          <div className="flex items-center gap-2 text-[var(--brand-text-muted)] t-caption">
            <span className="inline-block h-2 w-2 rounded-[var(--radius-sm)] bg-blue-400 animate-pulse" />
            Local visibility summary will load after the keyword rows are ready.
          </div>
        </SectionCard>
      )}

      {/* AI-visibility (LLM-mention) KPI panel — P8 / ai-visibility. Self-gating: renders nothing
          when the `ai-visibility` flag is off (the read endpoint returns latest: null). */}
      <AiVisibilityPanel workspaceId={workspaceId} />

      <SectionCard noPadding variant="subtle">
        <div className="px-3 py-3 border-b border-[var(--brand-border)] flex flex-wrap items-center gap-2">
          <HubSegmentBar
            segments={segments}
            active={hub.segment}
            onChange={hub.setSegment}
            isLoading={summaryLoading}
          />
          <div className="ml-auto">
            <HubAdvancedFilters
              activeAdvancedFilter={hub.advancedFilter}
              filterMetas={filterMetas}
              onChange={hub.setAdvancedFilter}
            />
          </div>
        </div>

        {/* Metric-window label (Task 4). Read-only data context → muted/blue per the
            Four Laws (no actionable hue). The "N days" is sourced from the shared
            GSC_METRIC_WINDOW_DAYS constant, never hard-coded. */}
        <p className="px-3 py-2 border-b border-[var(--brand-border)] t-caption text-[var(--brand-text-muted)]">
          Clicks &amp; impressions: last {GSC_METRIC_WINDOW_DAYS} days
          {' · '}rank: {GSC_METRIC_WINDOW_DAYS}-day avg
          {' · '}volume: provider estimate
        </p>

        {/* Truncation honesty banner (Task 4): the universe is capped for display;
            disclose the hidden tail rather than silently dropping it. */}
        {isTruncated && (
          <div
            role="status"
            aria-label={`${hiddenByCap} more keywords hidden by the display cap`}
            className="px-3 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-3)]/20"
          >
            <p className="t-caption-sm text-[var(--brand-text-muted)]">
              Showing the highest-value keywords. {hiddenByCap.toLocaleString()} more lower-value{' '}
              {hiddenByCap === 1 ? 'keyword is' : 'keywords are'} below the display cap.
            </p>
          </div>
        )}

        <HubKeywordList
          workspaceId={workspaceId}
          rows={rows}
          pageInfo={pageInfo}
          isLoading={rowsLoading}
          isError={Boolean(rowsError)}
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
          isFiltered={isFiltered}
        />
      </SectionCard>

      {/* Per-keyword journey drawer (P2): origin → tracking → national rank →
          local-per-market → lifecycle, plus the deep-link back-links. */}
      <KeywordDetailDrawer
        open={!!selectedKey}
        row={selectedRow}
        outcome={detail.data?.outcome}
        workspaceId={workspaceId}
        isLoading={detail.isFetching && !!selectedKey && !detail.data}
        loadingAction={localRefresh.isPending ? 'check_local_visibility' : rowAction.isPending ? rowAction.variables?.action : undefined}
        onAction={handleDrawerAction}
        onSelectKeyword={(keyword) => setSelectedKey(keyword)}
        onClose={() => {
          setSelectedKey(null);
          // Drop any pending force-override gate tied to the now-closed drawer so a
          // stale dialog can't fire against a different keyword on reopen.
          setPendingDrawerForceAction(null);
        }}
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

      {/* Protected-drawer force gate — mirrors KeywordActionMenu's ConfirmDialog.
          First click opens this dialog; confirmed click sends force: true. */}
      <ConfirmDialog
        open={!!pendingDrawerForceAction}
        variant="default"
        title="Override keyword protection?"
        message={pendingDrawerForceAction?.disabledReason ?? ''}
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        onCancel={() => setPendingDrawerForceAction(null)}
        onConfirm={() => {
          // Use the keyword/pagePath captured ON the action when the dialog opened —
          // NOT resolved from selectedRow at confirm time. If the drawer's selected
          // row changes while the dialog is open, reading selectedRow would force the
          // override against the wrong keyword. The action carries both fields.
          if (pendingDrawerForceAction && isServerAction(pendingDrawerForceAction.type)) {
            rowAction.mutate({
              action: pendingDrawerForceAction.type,
              keyword: pendingDrawerForceAction.keyword,
              pagePath: pendingDrawerForceAction.pagePath,
              force: true,
            });
          }
          setPendingDrawerForceAction(null);
        }}
      />
    </div>
  );
}
