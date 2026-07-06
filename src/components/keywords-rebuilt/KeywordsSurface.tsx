// @ds-rebuilt
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import {
  useKeywordCommandCenterAction,
  useKeywordCommandCenterInitialView,
  useKeywordCommandCenterSummary,
  useRankTrackingAddKeyword,
} from '../../hooks/admin/useKeywordCommandCenter';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { queryKeys } from '../../lib/queryKeys';
import { WS_EVENTS } from '../../lib/wsEvents';
import { KEYWORD_COMMAND_CENTER_ACTIONS, KEYWORD_COMMAND_CENTER_FILTERS } from '../../../shared/types/keyword-command-center';
import type { KeywordCommandCenterSummaryResponse } from '../../../shared/types/keyword-command-center';
import type { AdminKeywordFeedbackListRow } from '../../../shared/types/keyword-feedback';
import { useKeywordFeedback } from '../strategy/hooks/useKeywordFeedback';
import { useToast } from '../Toast';
import { mutationErrorMessage } from './keywordMutationFeedback';
import { Badge, Button, ErrorState, PageHeader, LensSwitcher, SearchField, Toolbar, ToolbarSpacer, FilterChip, InlineBanner, MetricTile, Skeleton, FormInput, FormSelect, GroupBlock } from '../ui';
import { KeywordDrawer } from './KeywordDrawer';
import { KeywordsLenses } from './KeywordsLenses';
import type { KeywordRowsQueryResult } from './KeywordsTable';
import {
  KEYWORDS_SURFACE_FILTERS,
  KEYWORDS_SURFACE_LENSES,
  type KeywordsSurfaceLens,
  useKeywordsSurfaceState,
} from './useKeywordsSurfaceState';

interface KeywordsSurfaceProps {
  workspaceId: string;
}

const MONEY_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const LENS_FILTER_HINTS: Partial<Record<KeywordsSurfaceLens, string>> = {
  rankings: 'tracked',
  pages: 'page_assigned',
};

const PRIMARY_FILTER_IDS = new Set<string>(KEYWORDS_SURFACE_FILTERS.map((filter) => filter.id));

function isLockedError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 402 || error.status === 403);
}

function lensCount(summary: KeywordCommandCenterSummaryResponse | undefined, lens: KeywordsSurfaceLens): number | undefined {
  if (!summary) return undefined;
  if (lens === 'clusters') return summary.topicClusters?.length;
  if (lens === 'lifecycle') return summary.counts.total;
  if (lens === 'opportunities') return summary.counts.total;
  const filterId = LENS_FILTER_HINTS[lens];
  if (!filterId) return undefined;
  return summary.filters.find((filter) => filter.id === filterId)?.count;
}

function feedbackGroups(rows: AdminKeywordFeedbackListRow[]) {
  return {
    requested: rows.filter((row) => row.status === 'requested'),
    declined: rows.filter((row) => row.status === 'declined'),
    approved: rows.filter((row) => row.status === 'approved'),
  };
}

function FeedbackRow({
  row,
  onAdd,
  disabled,
}: {
  row: AdminKeywordFeedbackListRow;
  onAdd?: (keyword: string) => void;
  disabled?: boolean;
}) {
  const tone = row.status === 'requested' ? 'teal' : row.status === 'approved' ? 'emerald' : 'red';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge label={row.status} tone={tone} variant="soft" size="sm" />
          <span className="t-caption font-semibold text-[var(--brand-text-bright)]">{row.keyword}</span>
        </div>
        {row.reason && <p className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">{row.reason}</p>}
      </div>
      {row.status === 'requested' && onAdd && (
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onAdd(row.keyword)}>
          Add to strategy
        </Button>
      )}
    </div>
  );
}

export function KeywordsSurface({ workspaceId }: KeywordsSurfaceProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const state = useKeywordsSurfaceState();
  const canUseInitialView = state.rowsQuery.filter !== KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES;
  const initialView = useKeywordCommandCenterInitialView(workspaceId, state.rowsQuery, {
    enabled: canUseInitialView,
  });
  const summaryFallback = useKeywordCommandCenterSummary(workspaceId, {
    enabled: !canUseInitialView,
  });
  const addKeyword = useRankTrackingAddKeyword(workspaceId);
  const feedback = useKeywordFeedback(workspaceId);
  const feedbackAction = useKeywordCommandCenterAction(workspaceId);
  const [addKeywordValue, setAddKeywordValue] = useState('');
  const summary = canUseInitialView ? initialView.data?.summary : summaryFallback.data;
  const summaryIsLoading = canUseInitialView ? initialView.isLoading : summaryFallback.isLoading;
  const summaryIsError = canUseInitialView ? initialView.isError : summaryFallback.isError;
  const summaryError = canUseInitialView ? initialView.error : summaryFallback.error;
  const refetchSummary = canUseInitialView ? initialView.refetch : summaryFallback.refetch;
  const initialRowsResult: KeywordRowsQueryResult | undefined = canUseInitialView ? {
    data: initialView.data?.rows,
    isLoading: initialView.isLoading,
    isError: initialView.isError,
    error: initialView.error,
    refetch: () => initialView.refetch(),
  } : undefined;
  const counts = summary?.counts;
  const trafficValue = summary?.trafficValueMonthly;
  const activeFilterLabel = summary?.filters.find((filter) => filter.id === state.filter)?.label
    ?? KEYWORDS_SURFACE_FILTERS.find((filter) => filter.id === state.filter)?.label
    ?? 'All';
  const advancedFilterOptions = useMemo(() => (
    summary?.filters
      .filter((filter) => !PRIMARY_FILTER_IDS.has(filter.id))
      .map((filter) => ({ value: filter.id, label: `${filter.label} (${filter.count})` })) ?? []
  ), [summary?.filters]);
  const feedbackData = useMemo(() => feedbackGroups(feedback.rows), [feedback.rows]);
  const invalidateKeywordCommandCenter = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordCommandCenter(workspaceId) });
  }, [queryClient, workspaceId]);

  const handleAddKeyword = () => {
    const keyword = addKeywordValue.trim();
    if (!keyword) return;
    addKeyword.mutate(keyword, {
      onSuccess: () => {
        setAddKeywordValue('');
        toast('Keyword added to rank tracking', 'success');
      },
      onError: (error) => toast(mutationErrorMessage(error, 'Keyword add failed'), 'error'),
    });
  };

  const handleAddRequestedKeyword = (keyword: string) => {
    feedbackAction.mutate(
      { action: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY, keyword },
      {
        onSuccess: () => {
          toast('Requested keyword added to strategy', 'success');
          queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordFeedback(workspaceId) });
          queryClient.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
        },
        onError: (error) => toast(mutationErrorMessage(error, 'Requested keyword add failed'), 'error'),
      },
    );
  };

  useWorkspaceEvents(workspaceId, {
    // ws-invalidation-ok — rebuilt Keywords pilot deliberately owns its KCC prefix invalidation so the surface remains live even when mounted outside the legacy shell.
    [WS_EVENTS.RANK_TRACKING_UPDATED]: invalidateKeywordCommandCenter,
    // ws-invalidation-ok — rebuilt Keywords pilot deliberately owns its KCC prefix invalidation so the surface remains live even when mounted outside the legacy shell.
    [WS_EVENTS.SERP_SNAPSHOTS_REFRESHED]: invalidateKeywordCommandCenter,
    // ws-invalidation-ok — rebuilt Keywords pilot deliberately owns its KCC prefix invalidation so the surface remains live even when mounted outside the legacy shell.
    [WS_EVENTS.STRATEGY_UPDATED]: invalidateKeywordCommandCenter,
  });

  if (isLockedError(summaryError)) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader
          title="Keywords"
          subtitle="Rankings, opportunities, pages, clusters, and lifecycle state in one rebuild pilot."
        />
        <ErrorState
          type="permission"
          title="Keyword intelligence is locked"
          message="This workspace plan does not include keyword command-center access yet. Upgrade the workspace or choose a workspace with keyword access."
          className="min-h-[420px]"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="Keywords"
        subtitle="Rankings, opportunities, pages, clusters, and lifecycle state in one rebuild pilot."
        actions={(
          <div className="flex min-w-[280px] items-center gap-2">
            <FormInput
              value={addKeywordValue}
              onChange={setAddKeywordValue}
              placeholder="Add keyword"
              aria-label="Add keyword"
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleAddKeyword();
              }}
            />
            <Button size="sm" variant="primary" disabled={addKeyword.isPending} onClick={handleAddKeyword}>
              Add
            </Button>
          </div>
        )}
      />

      <Toolbar label="Keyword view controls" className="w-full">
        <LensSwitcher
          id="keywords-rebuilt-lens"
          options={KEYWORDS_SURFACE_LENSES.map((lens) => ({
            value: lens.id,
            label: lens.label,
            count: lensCount(summary, lens.id),
          }))}
          value={state.lens}
          onChange={(value) => state.setLens(value as typeof state.lens)}
          size="sm"
        />
        <SearchField
          value={state.searchInput}
          onChange={state.setSearchInput}
          placeholder="Search keywords"
          className="min-w-[220px] flex-1"
        />
        <ToolbarSpacer />
        {advancedFilterOptions.length > 0 && (
          <FormSelect
            aria-label="Advanced keyword filter"
            value={PRIMARY_FILTER_IDS.has(state.filter) ? '' : state.filter}
            onChange={(value) => state.setFilter(value as typeof state.filter)}
            placeholder="More filters"
            options={advancedFilterOptions}
            className="w-[220px]"
          />
        )}
      </Toolbar>

      <div className="flex flex-wrap gap-2" aria-label="Keyword filters">
        {KEYWORDS_SURFACE_FILTERS.map((filter) => (
          <FilterChip
            key={filter.id}
            label={filter.label}
            active={state.filter === filter.id}
            onClick={() => state.setFilter(filter.id)}
          />
        ))}
      </div>

      {summaryIsError && !summary ? (
        <ErrorState
          title="Keyword summary did not load"
          message="The keyword table is still available below if row data is cached. Retry the summary when the connection is healthy."
          action={{ label: 'Retry summary', onClick: () => refetchSummary() }}
          type="data"
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {summaryIsLoading && !summary ? (
            Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-[92px] w-full" />
            ))
          ) : (
            <>
              <MetricTile label="Total" value={counts?.total ?? 0} sub={activeFilterLabel} accent="var(--blue)" />
              <MetricTile label="In Strategy" value={counts?.inStrategy ?? 0} accent="var(--teal)" />
              <MetricTile label="Tracked" value={counts?.tracked ?? 0} accent="var(--blue)" />
              <MetricTile label="Needs Review" value={counts?.needsReview ?? 0} accent="var(--amber)" />
              <MetricTile
                label="Monthly Value"
                value={typeof trafficValue === 'number' ? MONEY_FORMAT.format(trafficValue) : 'No source'}
                sub="Display-only"
                accent="var(--emerald)"
              />
            </>
          )}
        </div>
      )}

      {summaryIsError && summary && (
        <InlineBanner tone="warning" title="Summary may be stale">
          <div className="flex flex-wrap items-center gap-2">
            <span>Keyword summary data did not refresh, so the last loaded numbers are still shown.</span>
            <Button size="sm" variant="secondary" onClick={() => refetchSummary()}>
              Retry summary
            </Button>
          </div>
        </InlineBanner>
      )}

      {state.selectedKeyword && (
        <div className="flex justify-end">
          <Button onClick={state.closeKeyword} variant="secondary" size="sm">
            {state.selectedKeyword}
          </Button>
        </div>
      )}

      <KeywordsLenses workspaceId={workspaceId} state={state} summary={summary} initialRowsResult={initialRowsResult} />

      <GroupBlock
        title="Client keyword feedback"
        meta="Requested, declined, and approved keyword direction from the client portal."
        stats={[
          { label: 'Requested', value: feedbackData.requested.length, color: 'var(--teal)' },
          { label: 'Declined', value: feedbackData.declined.length, color: 'var(--red)' },
          { label: 'Approved', value: feedbackData.approved.length, color: 'var(--emerald)' },
        ]}
        collapsible
        defaultOpen={feedback.rows.length > 0}
      >
        {feedback.rows.length === 0 ? (
          <p className="t-caption-sm text-[var(--brand-text-muted)]">No client keyword feedback submitted yet.</p>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {[...feedbackData.requested, ...feedbackData.declined, ...feedbackData.approved].slice(0, 12).map((row) => (
              <FeedbackRow
                key={`${row.status}-${row.keyword}`}
                row={row}
                disabled={feedbackAction.isPending}
                onAdd={handleAddRequestedKeyword}
              />
            ))}
          </div>
        )}
      </GroupBlock>

      <KeywordDrawer
        workspaceId={workspaceId}
        keyword={state.selectedKeyword}
        onClose={state.closeKeyword}
      />
    </div>
  );
}
