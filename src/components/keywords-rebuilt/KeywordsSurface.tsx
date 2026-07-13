// @ds-rebuilt
import { Suspense, useCallback, useMemo, useRef, useState } from 'react';
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
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { WS_EVENTS } from '../../lib/wsEvents';
import { KEYWORD_COMMAND_CENTER_ACTIONS, KEYWORD_COMMAND_CENTER_FILTERS } from '../../../shared/types/keyword-command-center';
import type { KeywordCommandCenterSummaryResponse } from '../../../shared/types/keyword-command-center';
import type { AdminKeywordFeedbackListRow } from '../../../shared/types/keyword-feedback';
import { useKeywordFeedback } from '../strategy/hooks/useKeywordFeedback';
import { useToast } from '../Toast';
import { mutationErrorMessage } from './keywordMutationFeedback';
import { Badge, Button, Drawer, ErrorState, PageHeader, LensSwitcher, LoadingState, SearchField, Toolbar, ToolbarSpacer, FilterChip, InlineBanner, MetricTile, Skeleton, FormInput, FormSelect, GroupBlock } from '../ui';
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

const LazyKeywordDrawer = lazyWithRetry(() => import('./KeywordDrawer').then((module) => ({
  default: module.KeywordDrawer,
})));

const MONEY_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const PRIMARY_FILTER_IDS = new Set<string>(KEYWORDS_SURFACE_FILTERS.map((filter) => filter.id));

const KEYWORDS_HEADER_CLASS = [
  'flex-col items-start gap-3 sm:flex-row sm:items-start',
  '[&_h2]:![font-size:var(--type-h2-size)] [&_h2]:!font-bold',
  '[&_p]:!max-w-[60ch] [&_p]:!whitespace-normal',
].join(' ');

const SUMMARY_TILE_CLASS = [
  '!flex !h-full !min-h-[80px] !min-w-0 !flex-col !rounded-[var(--radius-lg)]',
  '[&>div:first-child]:order-2 [&>div:first-child]:!mb-0',
  '[&>div:nth-child(2)]:order-1 [&>div:nth-child(2)]:mb-1',
].join(' ');

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

function SummaryCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div data-testid="keywords-summary-cell" className="min-w-0 [&>*]:h-full">
      <MetricTile label={label} value={value} accent={accent} className={SUMMARY_TILE_CLASS} />
    </div>
  );
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
      <div className="flex flex-col gap-2">
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
  const initialRowsQueryRef = useRef(state.rowsQuery);
  const canUseInitialView = initialRowsQueryRef.current.filter !== KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES;
  const initialView = useKeywordCommandCenterInitialView(workspaceId, initialRowsQueryRef.current, {
    enabled: canUseInitialView,
  });
  const viewingInitialRows = JSON.stringify(state.rowsQuery) === JSON.stringify(initialRowsQueryRef.current);
  const summaryFallback = useKeywordCommandCenterSummary(workspaceId, {
    enabled: !canUseInitialView || initialView.isError,
  });
  const addKeyword = useRankTrackingAddKeyword(workspaceId);
  const feedback = useKeywordFeedback(workspaceId);
  const feedbackAction = useKeywordCommandCenterAction(workspaceId);
  const [addKeywordValue, setAddKeywordValue] = useState('');
  const summary = initialView.data?.summary ?? summaryFallback.data;
  const summaryIsLoading = canUseInitialView ? initialView.isLoading && !summary : summaryFallback.isLoading;
  const summaryIsError = canUseInitialView ? initialView.isError && summaryFallback.isError : summaryFallback.isError;
  const summaryError = initialView.error ?? summaryFallback.error;
  const refetchSummary = initialView.data ? initialView.refetch : summaryFallback.refetch;
  const initialRowsResult: KeywordRowsQueryResult | undefined = canUseInitialView && viewingInitialRows ? {
    data: initialView.data?.rows,
    isLoading: initialView.isLoading,
    isError: initialView.isError,
    error: initialView.error,
    refetch: () => initialView.refetch(),
  } : undefined;
  const counts = summary?.counts;
  const trafficValue = summary?.trafficValueMonthly;
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
      <div className="flex min-h-full w-full max-w-[1128px] flex-col gap-5">
        <PageHeader
          title="Keywords"
          subtitle="Rankings, opportunities, pages, clusters, and lifecycle for every tracked keyword."
          className={KEYWORDS_HEADER_CLASS}
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
    <div data-testid="keywords-surface" className="flex min-h-full w-full max-w-[1128px] flex-col">
      <PageHeader
        title="Keywords"
        subtitle="Rankings, opportunities, pages, clusters, and lifecycle for every tracked keyword."
        className={KEYWORDS_HEADER_CLASS}
        actions={(
          <div className="flex w-full max-w-[280px] items-center gap-2 sm:min-w-[260px]">
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

      {summaryIsError && !summary ? (
        <div className="mt-[18px]">
          <ErrorState
            title="Keyword summary did not load"
            message="The keyword table is still available below if row data is cached. Retry the summary when the connection is healthy."
            action={{ label: 'Retry summary', onClick: () => refetchSummary() }}
            type="data"
          />
        </div>
      ) : (
        <div data-testid="keywords-summary" className="mt-[18px] grid grid-cols-2 gap-[10px] xl:grid-cols-4">
          {summaryIsLoading && !summary ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[80px] w-full" />
            ))
          ) : (
            <>
              <SummaryCell label="Total keywords" value={counts?.total ?? 0} accent="var(--blue)" />
              <SummaryCell label="Rank tracked" value={counts?.tracked ?? 0} accent="var(--blue)" />
              <SummaryCell label="Needs review" value={counts?.needsReview ?? 0} accent="var(--amber)" />
              <SummaryCell
                label="Monthly value"
                value={typeof trafficValue === 'number' ? MONEY_FORMAT.format(trafficValue) : '—'}
                accent="var(--blue)"
              />
            </>
          )}
        </div>
      )}

      {summaryIsError && summary && (
        <div className="mt-3">
          <InlineBanner tone="warning" title="Summary may be stale">
            <div className="flex flex-wrap items-center gap-2">
              <span>Keyword summary data did not refresh, so the last loaded numbers are still shown.</span>
              <Button size="sm" variant="secondary" onClick={() => refetchSummary()}>
                Retry summary
              </Button>
            </div>
          </InlineBanner>
        </div>
      )}

      <div data-testid="keywords-lens-tray" className="mt-4 w-fit max-w-full overflow-x-auto rounded-[var(--radius-lg)]">
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
          size="md"
        />
      </div>

      <div data-testid="keywords-tools" className="mt-4 flex flex-col gap-2">
        <Toolbar label="Keyword search and advanced filters" className="w-full">
          <SearchField
            value={state.searchInput}
            onChange={state.setSearchInput}
            placeholder="Search keywords…"
            className="w-full max-w-[320px]"
          />
          <ToolbarSpacer />
          {advancedFilterOptions.length > 0 && (
            <FormSelect
              aria-label="Advanced keyword filter"
              value={PRIMARY_FILTER_IDS.has(state.filter) ? '' : state.filter}
              onChange={(value) => state.setFilter(value as typeof state.filter)}
              placeholder="More filters"
              options={advancedFilterOptions}
              className="w-[190px] max-w-full"
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
      </div>

      <div className="mt-3">
        <KeywordsLenses workspaceId={workspaceId} state={state} summary={summary} initialRowsResult={initialRowsResult} />
      </div>

      <div className="mt-4">
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
      </div>

      {state.selectedKeyword && (
        <Suspense
          fallback={(
            <Drawer
              open
              onClose={state.closeKeyword}
              title={state.selectedKeyword}
              subtitle="Keyword detail"
              eyebrow="Keyword detail"
              width={440}
            >
              <LoadingState message="Loading keyword details…" />
            </Drawer>
          )}
        >
          <LazyKeywordDrawer
            workspaceId={workspaceId}
            keyword={state.selectedKeyword}
            onClose={state.closeKeyword}
          />
        </Suspense>
      )}
    </div>
  );
}
