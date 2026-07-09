// @ds-rebuilt
import { useCallback, useMemo, useState } from 'react';
import { BarChart3, Clock, FileText, Network, Target, type LucideIcon } from 'lucide-react';
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

const PRIMARY_FILTER_IDS = new Set<string>(KEYWORDS_SURFACE_FILTERS.map((filter) => filter.id));

// Per-lens icon anchors for the LensSwitcher (parity with the prototype's lens tabs).
const LENS_ICONS: Record<KeywordsSurfaceLens, LucideIcon> = {
  rankings: BarChart3,
  opportunities: Target,
  pages: FileText,
  clusters: Network,
  lifecycle: Clock,
};

function isLockedError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 402 || error.status === 403);
}

function lensCount(summary: KeywordCommandCenterSummaryResponse | undefined, lens: KeywordsSurfaceLens): number | undefined {
  if (!summary) return undefined;
  // Clusters is the one lens with a truthful server-provided group count. The
  // rankings / opportunities / pages / lifecycle lenses each organize the SAME
  // full keyword set (just sorted or grouped differently), so every one previews
  // counts.total — a single consistent unit instead of the old mix of filter
  // counts (which contradicted the table) and per-lens subsets. Distinct-page and
  // high-opportunity-subset counts await server support (DEF-kw follow-up).
  if (lens === 'clusters') return summary.topicClusters?.length;
  return summary.counts.total;
}

function feedbackGroups(rows: AdminKeywordFeedbackListRow[]) {
  return {
    requested: rows.filter((row) => row.status === 'requested'),
    declined: rows.filter((row) => row.status === 'declined'),
    approved: rows.filter((row) => row.status === 'approved'),
  };
}

// Status → accent hue + Badge tone for the client-feedback rows (parity with the
// prototype's status-tinted rows: teal=requested, emerald=approved, red=declined).
const FEEDBACK_ACCENT: Record<AdminKeywordFeedbackListRow['status'], string> = {
  requested: 'var(--teal)',
  approved: 'var(--emerald)',
  declined: 'var(--red)',
};
const FEEDBACK_TONE: Record<AdminKeywordFeedbackListRow['status'], 'teal' | 'emerald' | 'red'> = {
  requested: 'teal',
  approved: 'emerald',
  declined: 'red',
};
const FEEDBACK_DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

function formatFeedbackDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : FEEDBACK_DATE_FORMAT.format(parsed);
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
  const accent = FEEDBACK_ACCENT[row.status];
  const date = formatFeedbackDate(row.created_at);
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border px-3 py-2"
      style={{
        borderColor: `color-mix(in srgb, ${accent} 25%, transparent)`,
        background: `color-mix(in srgb, ${accent} 7%, transparent)`,
      }}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge label={row.status} tone={FEEDBACK_TONE[row.status]} variant="soft" size="sm" />
          <span className="t-ui font-semibold text-[var(--brand-text-bright)]">{row.keyword}</span>
          {date && <span className="t-mono text-[var(--brand-text-dim)]">{date}</span>}
        </div>
        {row.reason && <p className="mt-1 t-body text-[var(--brand-text-muted)]">{row.reason}</p>}
      </div>
      {row.status === 'requested' && onAdd && (
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onAdd(row.keyword)}>
          Add to strategy
        </Button>
      )}
    </div>
  );
}

function FeedbackGroup({
  label,
  rows,
  onAdd,
  disabled,
}: {
  label: string;
  rows: AdminKeywordFeedbackListRow[];
  onAdd?: (keyword: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 t-label text-[var(--brand-text-muted)]">{label}</div>
      <div className="grid gap-2 lg:grid-cols-2">
        {rows.slice(0, 12).map((row) => (
          <FeedbackRow key={`${row.status}-${row.keyword}`} row={row} onAdd={onAdd} disabled={disabled} />
        ))}
      </div>
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
          subtitle="Rankings, opportunities, pages, clusters, and lifecycle for every tracked keyword."
        />
        <ErrorState
          type="permission"
          title="Keyword intelligence is locked"
          message="This workspace plan does not include keyword intelligence yet. Upgrade the workspace or choose a workspace with keyword access."
          className="min-h-[420px]"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="Keywords"
        subtitle="Rankings, opportunities, pages, clusters, and lifecycle for every tracked keyword."
        className="flex-col items-start gap-3 sm:flex-row sm:items-center"
        actions={(
          <div className="flex w-full max-w-[360px] items-center gap-2 sm:min-w-[280px]">
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
            icon: LENS_ICONS[lens.id],
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
            count={summary?.filters.find((meta) => meta.id === filter.id)?.count}
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
                value={typeof trafficValue === 'number' ? MONEY_FORMAT.format(trafficValue) : '—'}
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
          <p className="t-body text-[var(--brand-text-muted)]">No client keyword feedback submitted yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {feedbackData.requested.length > 0 && (
              <FeedbackGroup
                label="Requested by client"
                rows={feedbackData.requested}
                onAdd={handleAddRequestedKeyword}
                disabled={feedbackAction.isPending}
              />
            )}
            {feedbackData.declined.length > 0 && (
              <FeedbackGroup label="Declined by client" rows={feedbackData.declined} />
            )}
            {feedbackData.approved.length > 0 && (
              <FeedbackGroup label="Approved" rows={feedbackData.approved} />
            )}
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
