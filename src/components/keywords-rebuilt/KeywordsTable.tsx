// @ds-rebuilt
import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  KEYWORD_COMMAND_CENTER_FILTERS,
  type KeywordCommandCenterBulkActionType,
  type KeywordCommandCenterNextAction,
  type KeywordCommandCenterRow,
  type KeywordCommandCenterSummaryResponse,
} from '../../../shared/types/keyword-command-center';
import { GSC_METRIC_WINDOW_DAYS } from '../../../shared/keyword-window';
import { useKeywordCommandCenterBulkAction, useKeywordCommandCenterRows } from '../../hooks/admin/useKeywordCommandCenter';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import { adminPath } from '../../routes';
import { useToast } from '../Toast';
import { KeywordBulkConfirmDialog } from '../keyword-command-center/KeywordBulkConfirmDialog';
import {
  summarizeBulkAction,
  type KeywordBulkActionSummary,
} from '../keyword-command-center/kccActionHelpers';
import { mutationErrorMessage } from './keywordMutationFeedback';
import type { KeywordIntent } from '../ui';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  FilterChip,
  Icon,
  InlineBanner,
  IntentTag,
  Meter,
  StatusBadge,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import type { DataColumn } from '../ui';
import type { UseKeywordsSurfaceStateReturn } from './useKeywordsSurfaceState';
import type { KeywordCommandCenterRowsResponse } from '../../../shared/types/keyword-command-center';

interface KeywordsTableProps {
  workspaceId: string;
  state: UseKeywordsSurfaceStateReturn;
  summary?: KeywordCommandCenterSummaryResponse;
  rowsResult?: KeywordRowsQueryResult;
}

export interface KeywordRowsQueryResult {
  data?: KeywordCommandCenterRowsResponse;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => unknown;
}

type KeywordsTableRecord = Record<string, unknown> & {
  source: KeywordCommandCenterRow;
  keyword: string;
  intent: string;
  rank: number | null;
  opportunity: number | null;
  currentMonthly: number | null;
  lifecycleStatus: string;
};

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const MONEY_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const INTENTS = new Set<KeywordIntent>(['commercial', 'informational', 'transactional', 'local']);

const SORT_CONTROLS = [
  { key: 'opportunity', label: 'Opportunity' },
  { key: 'position', label: 'Rank' },
  { key: 'clicks', label: 'Clicks' },
  { key: 'volume', label: 'Volume' },
  { key: 'difficulty', label: 'Difficulty' },
] as const;

const ROW_NESTED_INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'label',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="link"]',
].join(',');

function focusPointerRow(event: ReactPointerEvent<HTMLDivElement>): void {
  if (event.button !== 0 || !(event.target instanceof Element)) return;
  if (event.target.closest(ROW_NESTED_INTERACTIVE_SELECTOR)) return;

  const row = event.target.closest<HTMLElement>('[role="row"][tabindex]');
  if (!row || !event.currentTarget.contains(row)) return;
  row.focus({ preventScroll: true });
}

function TargetEmptyIcon({ className }: { className?: string }) {
  return <Icon name="target" className={className} />;
}

function SearchEmptyIcon({ className }: { className?: string }) {
  return <Icon name="search" className={className} />;
}

function asIntent(value: string | undefined): KeywordIntent | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase() as KeywordIntent;
  return INTENTS.has(normalized) ? normalized : null;
}

// Empty numeric cells use a quiet em-dash rather than a word-placeholder ("No data",
// "No CPC", …). In the right-aligned columns DataTable styles cell text bright semibold
// tabular-nums, so word placeholders read as loud values; "—" reads correctly as empty.
function formatMoney(value: number | undefined): string {
  return typeof value === 'number' ? MONEY_FORMAT.format(value) : '—';
}

function formatNumber(value: number | undefined): string {
  return typeof value === 'number' ? NUMBER_FORMAT.format(value) : '—';
}

// Estimated monthly upside ("+$X") for the Opportunities-lens Est-gain column.
function formatUpside(value: number | undefined): string {
  return typeof value === 'number' ? `+${MONEY_FORMAT.format(value)}` : '—';
}

// The primary recommended move for the Opportunities-lens "Fix" column: the first
// actionable next-step, skipping the passive "view rankings" pseudo-action.
function fixAction(row: KeywordCommandCenterRow): KeywordCommandCenterNextAction | null {
  return row.nextActions.find((action) => action.type !== 'view_rankings') ?? null;
}

function toRecord(row: KeywordCommandCenterRow): KeywordsTableRecord {
  return {
    source: row,
    keyword: row.keyword,
    intent: row.metrics.intent ?? '',
    rank: row.metrics.currentPosition ?? null,
    opportunity: row.opportunityScore ?? null,
    currentMonthly: row.currentMonthly ?? null,
    lifecycleStatus: row.lifecycleStatus,
  };
}

function selectedRowsFrom(rows: KeywordCommandCenterRow[], selectedKeys: Set<string>): KeywordCommandCenterRow[] {
  return rows.filter((row) => selectedKeys.has(row.normalizedKeyword));
}

export function KeywordsTable({ workspaceId, state, summary, rowsResult: externalRowsResult }: KeywordsTableProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const ownedRowsResult = useKeywordCommandCenterRows(workspaceId, state.rowsQuery, {
    enabled: externalRowsResult == null,
  });
  const rowsResult = externalRowsResult ?? ownedRowsResult;
  const rows = rowsResult.data?.rows ?? [];
  const pageInfo = rowsResult.data?.pageInfo;
  const bulkAction = useKeywordCommandCenterBulkAction(workspaceId);
  const [selectedKeys, toggleKey, setSelectedKeys] = useToggleSet<string>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  const [pendingBulk, setPendingBulk] = useState<KeywordBulkActionSummary | null>(null);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const selectedRows = selectedRowsFrom(rows, selectedKeys);
  const hiddenByCap = Math.max(0, (summary?.rawEvidenceTotal ?? 0) - (summary?.rawEvidenceReturned ?? 0));
  const visibleKeys = useMemo(() => rows.map((row) => row.normalizedKeyword), [rows]);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));

  const clearSelection = () => setSelectedKeys(new Set());
  const toggleVisibleSelection = () => {
    if (allVisibleSelected) {
      setSelectedKeys(new Set([...selectedKeys].filter((key) => !visibleKeys.includes(key))));
      return;
    }
    setSelectedKeys(new Set([...selectedKeys, ...visibleKeys]));
  };

  const runBulkAction = (bulkSummary: KeywordBulkActionSummary, force: boolean) => {
    bulkAction.mutate(
      {
        action: bulkSummary.action,
        keywords: bulkSummary.keywords,
        force: force || undefined,
      },
      {
        onSuccess: (result) => {
          setBulkResult(result.message);
          toast(result.message, 'success');
          setPendingBulk(null);
          clearSelection();
        },
        onError: (error) => {
          toast(mutationErrorMessage(error, 'Keyword bulk action failed'), 'error');
        },
      },
    );
  };

  const handleBulkAction = (action: KeywordCommandCenterBulkActionType) => {
    const bulkSummary = summarizeBulkAction(selectedRows, action);
    if (bulkSummary.requiresConfirmation) {
      setPendingBulk(bulkSummary);
      return;
    }
    runBulkAction(bulkSummary, false);
  };

  const tableRows = useMemo(() => rows.map(toRecord), [rows]);
  const isDefaultView = state.filter === KEYWORD_COMMAND_CENTER_FILTERS.ALL && state.search.length === 0;
  const emptyState = isDefaultView ? (
    <EmptyState
      icon={TargetEmptyIcon}
      title="No keywords yet"
      description="Connect Search Console data or run an initial strategy to seed keyword opportunities."
      action={(
        <Button size="sm" variant="secondary" onClick={() => navigate(adminPath(workspaceId, 'seo-strategy'))}>
          Open strategy
        </Button>
      )}
    />
  ) : (
    <EmptyState
      icon={SearchEmptyIcon}
      title="No keywords match this view"
      description="Clear filters or adjust the search to bring keyword opportunities back into view."
      action={(
        <Button
          size="sm"
          variant="secondary"
          onClick={state.clearFilters}
        >
          Clear filters
        </Button>
      )}
    />
  );

  const columns = useMemo<DataColumn[]>(() => [
    {
      key: 'select',
      label: 'Select',
      width: '44px',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return (
          <div
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Checkbox
              checked={selectedKeys.has(row.normalizedKeyword)}
              onChange={() => toggleKey(row.normalizedKeyword)}
              label={`Select ${row.keyword}`}
              srOnlyLabel
            />
          </div>
        );
      },
    },
    {
      key: 'keyword',
      label: 'Keyword',
      width: 'minmax(190px, 1.6fr)',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate t-ui font-semibold text-[var(--brand-text-bright)]">{row.keyword}</span>
            <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">
              {row.assignment?.pageTitle ?? row.assignment?.pagePath ?? 'No page assigned'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'intent',
      label: 'Intent',
      width: '88px',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        const intent = asIntent(row.metrics.intent);
        return intent ? <IntentTag intent={intent} /> : <Badge label="Unknown" tone="zinc" variant="outline" size="sm" />;
      },
    },
    {
      key: 'rank',
      label: 'Rank',
      width: '52px',
      align: 'right',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return <span>{row.metrics.currentPosition != null ? `#${row.metrics.currentPosition}` : '—'}</span>;
      },
    },
    {
      key: 'clicks',
      label: 'Clicks',
      width: '58px',
      align: 'right',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return <span>{formatNumber(row.metrics.clicks)}</span>;
      },
    },
    {
      key: 'volume',
      label: 'Volume',
      width: '68px',
      align: 'right',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return <span>{formatNumber(row.metrics.volume)}</span>;
      },
    },
    {
      key: 'opportunity',
      label: 'Opp',
      width: '108px',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        const score = row.opportunityScore;
        return typeof score === 'number'
          ? <Meter value={score} showValue color="var(--blue)" ariaLabel={`${row.keyword} opportunity score`} />
          : <span className="t-caption-sm text-[var(--brand-text-muted)]">—</span>;
      },
    },
    {
      key: 'difficulty',
      label: 'KD',
      width: '44px',
      align: 'right',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return <span>{formatNumber(row.metrics.difficulty)}</span>;
      },
    },
    {
      key: 'currentMonthly',
      label: '$',
      width: '64px',
      align: 'right',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return <span>{formatMoney(row.currentMonthly)}</span>;
      },
    },
    {
      key: 'lifecycleStatus',
      label: 'Lifecycle',
      width: 'minmax(128px, 0.9fr)',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <StatusBadge status={row.lifecycleStatus} domain="keyword-command-center" variant="soft" />
            {row.tracking.sourceGapKey && <Badge label="From gap" tone="blue" variant="soft" size="sm" />}
            {row.tracking.strategyOwned === true && <Badge label="Auto-managed" tone="teal" variant="soft" size="sm" />}
            {/* No separate "Raw evidence" badge — the StatusBadge above already renders the
                raw-evidence lifecycle status; a second badge duplicated the term (with
                inconsistent casing) in the same cell. */}
          </div>
        );
      },
    },
    {
      key: 'local',
      label: 'Local',
      width: 'minmax(112px, 0.8fr)',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        if (!row.localSeoState) {
          return <span className="t-caption-sm text-[var(--brand-text-muted)]">No local data</span>;
        }
        return (
          <div className="flex min-w-0 flex-col gap-1">
            <Badge label={row.localSeoState.lifecycleLabel} tone="blue" variant="soft" size="sm" />
            <span className="truncate t-caption-sm text-[var(--brand-text-muted)]">{row.localSeoState.priorityLabel}</span>
          </div>
        );
      },
    },
  ], [selectedKeys, toggleKey]);

  // The Opportunities lens gets its own upside-focused shape (parity with the design
  // prototype's Opportunities view) instead of the wide Rankings grid re-sorted: the
  // triage question is "what do I fix next and what's it worth", so it leads with
  // Opportunity + Est. gain + the recommended Fix, and drops rank/clicks/KD noise.
  const opportunityColumns = useMemo<DataColumn[]>(() => [
    {
      key: 'select',
      label: 'Select',
      width: '44px',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return (
          <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <Checkbox
              checked={selectedKeys.has(row.normalizedKeyword)}
              onChange={() => toggleKey(row.normalizedKeyword)}
              label={`Select ${row.keyword}`}
              srOnlyLabel
            />
          </div>
        );
      },
    },
    {
      key: 'keyword',
      label: 'Keyword',
      width: 'minmax(220px, 1.6fr)',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        const rankMeta = row.metrics.currentPosition != null ? `#${row.metrics.currentPosition}` : 'Not ranking';
        const kdMeta = typeof row.metrics.difficulty === 'number' ? ` · KD ${row.metrics.difficulty}` : '';
        return (
          <div className="min-w-0">
            <span className="block truncate t-ui font-semibold text-[var(--brand-text-bright)]">{row.keyword}</span>
            <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">{rankMeta}{kdMeta}</span>
          </div>
        );
      },
    },
    {
      key: 'intent',
      label: 'Intent',
      width: '88px',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        const intent = asIntent(row.metrics.intent);
        return intent ? <IntentTag intent={intent} /> : <Badge label="Unknown" tone="zinc" variant="outline" size="sm" />;
      },
    },
    {
      key: 'opportunity',
      label: 'Opp',
      width: 'minmax(135px, 1fr)',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        const score = row.opportunityScore;
        return typeof score === 'number'
          ? <Meter value={score} showValue color="var(--blue)" ariaLabel={`${row.keyword} opportunity score`} />
          : <span className="t-caption-sm text-[var(--brand-text-muted)]">—</span>;
      },
    },
    {
      key: 'upside',
      label: 'Est. gain',
      width: '90px',
      align: 'right',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return typeof row.upsideMonthly === 'number'
          ? <span className="tabular-nums font-semibold text-[var(--blue)]">{formatUpside(row.upsideMonthly)}</span>
          : <span className="t-caption-sm text-[var(--brand-text-muted)]">—</span>;
      },
    },
    {
      key: 'fix',
      label: 'Fix',
      width: 'minmax(160px, 1.1fr)',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        const action = fixAction(row);
        return action
          ? <Badge label={action.label} tone={action.tone} variant="soft" size="sm" />
          : <span className="t-caption-sm text-[var(--brand-text-muted)]">No action</span>;
      },
    },
  ], [selectedKeys, toggleKey]);

  const activeColumns = state.lens === 'opportunities' ? opportunityColumns : columns;

  return (
    <div className="flex flex-col gap-2">
      <Toolbar label="Keyword table controls" className="w-full" gap={6}>
        {/* Leading "Sort" label so this chip row is not mistaken for the status FilterChip
            row above it — same primitive, different axis (sort vs filter). The active chip
            shows its direction as an arrow rather than raw "asc"/"desc" enum text. */}
        <span className="t-caption font-medium text-[var(--brand-text-muted)]">Sort</span>
        {SORT_CONTROLS.map((control) => {
          const isActive = state.sort.key === control.key;
          const arrow = isActive ? (state.sort.direction === 'asc' ? ' ↑' : ' ↓') : '';
          return (
            <FilterChip
              key={control.key}
              label={`${control.label}${arrow}`}
              active={isActive}
              className="!px-[9px] !py-1"
              onClick={() => state.setSort(control.key)}
            />
          );
        })}
        <ToolbarSpacer />
        {rows.length > 0 && (
          <Button size="sm" variant="ghost" onClick={toggleVisibleSelection}>
            {allVisibleSelected ? 'Deselect visible' : `Select visible ${rows.length}`}
          </Button>
        )}
        <span className="t-caption text-[var(--brand-text-muted)]">
          {pageInfo ? `${NUMBER_FORMAT.format(pageInfo.totalRows)} keywords` : 'Keyword rows'}
        </span>
      </Toolbar>

      <p className="t-body !text-[11.5px] !leading-[1.4] text-[var(--brand-text-muted)]">
        Clicks &amp; impressions: last {GSC_METRIC_WINDOW_DAYS} days. Rank: {GSC_METRIC_WINDOW_DAYS}-day average. Volume: provider estimate.
      </p>

      {hiddenByCap > 0 && (
        <InlineBanner
          tone="info"
          size="sm"
          title="Display cap"
          aria-label={`${hiddenByCap} more keywords hidden by the display cap`}
        >
          Showing the highest-value keywords. {NUMBER_FORMAT.format(hiddenByCap)} more lower-value {hiddenByCap === 1 ? 'keyword is' : 'keywords are'} below the display cap.
        </InlineBanner>
      )}

      {bulkResult && (
        <InlineBanner tone="success" size="sm" title="Bulk action complete" onDismiss={() => setBulkResult(null)}>
          {bulkResult}
        </InlineBanner>
      )}

      {selectedRows.length > 0 && (
        <div className="sticky top-0 z-[var(--z-dropdown)] bg-[var(--surface-1)] pb-1">
          {/* Sticky so the bulk-action bar stays reachable while scrolling a long
              selection. The AppShell scroll container is #app-shell-main-content, so
              top-0 pins it just under the topbar; the solid surface backdrop stops
              scrolled rows bleeding through the translucent InlineBanner. z-dropdown
              (above the DataTable's own z-sticky header) keeps the pinned bar — and its
              buttons — clickable over the sticky column header they share the top edge
              with. pb-1 gives the overlay a clean lower edge over the header. */}
          {/* Count + visibility track selectedROWS (the current page's intersection with
              the selection), NOT selectedKeys.size — a bulk action only ever executes on
              the loaded rows it can summarize, so counting off-page keys would let the
              banner claim "60 selected" while the action touches ~50. */}
        <InlineBanner tone="info" size="sm" title={`${selectedRows.length} selected`}>
          <Toolbar label="Selected keyword bulk actions" className="mt-2">
            <Button size="sm" variant="primary" disabled={bulkAction.isPending} onClick={() => handleBulkAction(KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY)}>
              Add to strategy
            </Button>
            <Button size="sm" variant="secondary" disabled={bulkAction.isPending} onClick={() => handleBulkAction(KEYWORD_COMMAND_CENTER_ACTIONS.TRACK)}>
              Track
            </Button>
            <Button size="sm" variant="ghost" disabled={bulkAction.isPending} onClick={() => handleBulkAction(KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING)}>
              Pause
            </Button>
            <Button size="sm" variant="ghost" disabled={bulkAction.isPending} onClick={() => handleBulkAction(KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE)}>
              Retire
            </Button>
            <Button size="sm" variant="ghost" disabled={bulkAction.isPending} onClick={() => handleBulkAction(KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE)}>
              Decline
            </Button>
            <ToolbarSpacer />
            <Button size="sm" variant="ghost" disabled={bulkAction.isPending} onClick={clearSelection}>
              Clear
            </Button>
          </Toolbar>
        </InlineBanner>
        </div>
      )}

      {rowsResult.isError && (
        <InlineBanner tone="error" title="Could not load keywords">
          <div className="flex flex-wrap items-center gap-2">
            <span>Check the workspace connection and try again.</span>
            <Button size="sm" variant="secondary" onClick={() => rowsResult.refetch()}>
              Retry
            </Button>
          </div>
        </InlineBanner>
      )}

      <div onPointerDownCapture={focusPointerRow}>
        <DataTable
          columns={activeColumns}
          rows={tableRows}
          loading={rowsResult.isLoading && tableRows.length === 0}
          getRowKey={(record) => (record as KeywordsTableRecord).source.normalizedKeyword}
          onRowClick={(record) => state.openKeyword((record as KeywordsTableRecord).source.keyword)}
          empty={emptyState}
          className="[&>[role=row]]:!gap-2 [&>[role=row]]:!px-4 [&>[role=row]:first-child]:!h-[38px] [&>[role=row]:first-child]:!py-0 [&>[role=row]:not(:first-child)]:!min-h-14 [&>[role=row]:not(:first-child)]:!py-2"
        />
      </div>

      {pageInfo && pageInfo.totalPages > 1 && (
        <Toolbar label="Keyword pagination" className="justify-end">
          <span className="t-caption text-[var(--brand-text-muted)]">
            Page {pageInfo.page} of {pageInfo.totalPages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!pageInfo.hasPreviousPage}
            onClick={() => state.setPage(pageInfo.page - 1)}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!pageInfo.hasNextPage}
            onClick={() => state.setPage(pageInfo.page + 1)}
          >
            Next
          </Button>
        </Toolbar>
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
