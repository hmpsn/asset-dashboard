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
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { FormInput, PageHeader, SectionCard } from './ui';
import { queryKeys } from '../lib/queryKeys';
import { WS_EVENTS } from '../lib/wsEvents';
import { useFeatureFlag } from '../hooks/useFeatureFlag';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import {
  useKeywordCommandCenterBulkAction,
  useKeywordCommandCenterRows,
  useKeywordCommandCenterSummary,
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
  KeywordCommandCenterBulkActionType,
  KeywordCommandCenterCounts,
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
  const queryClient = useQueryClient();

  // ?tab= two-halves contract: seed the initial segment from the URL.
  const initialSegment = searchParams.get('tab');

  const hub = useKeywordHubState({ initialSegment });

  const showLocalSeo = useFeatureFlag('local-seo-visibility');

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

  // Bulk action handler -----------------------------------------------------
  const handleBulkAction = (action: KeywordCommandCenterBulkActionType) => {
    const keywords = Array.from(hub.selectedKeys);
    if (keywords.length === 0) return;
    bulkAction.mutate(
      { action, keywords },
      { onSuccess: () => hub.clearSelection() },
    );
  };

  const visibleKeys = useMemo(
    () => rows.map((r) => r.normalizedKeyword),
    [rows],
  );
  const allSelected = hub.allSelected(visibleKeys);

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
          onClearSelection={hub.clearSelection}
          showLocalSeo={showLocalSeo}
        />
      </SectionCard>
    </div>
  );
}
