// @ds-rebuilt
import { useMemo, useState } from 'react';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  type KeywordCommandCenterBulkActionType,
  type KeywordCommandCenterRow,
  type KeywordCommandCenterSummaryResponse,
} from '../../../shared/types/keyword-command-center';
import { GSC_METRIC_WINDOW_DAYS } from '../../../shared/keyword-window';
import { useKeywordCommandCenterBulkAction, useKeywordCommandCenterRows } from '../../hooks/admin/useKeywordCommandCenter';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import { KeywordBulkConfirmDialog } from '../keyword-command-center/KeywordBulkConfirmDialog';
import {
  summarizeBulkAction,
  type KeywordBulkActionSummary,
} from '../keyword-command-center/kccActionHelpers';
import type { KeywordIntent } from '../ui';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  FilterChip,
  InlineBanner,
  IntentTag,
  Meter,
  StatusBadge,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import type { DataColumn } from '../ui';
import type { UseKeywordsSurfaceStateReturn } from './useKeywordsSurfaceState';
import type { UseQueryResult } from '@tanstack/react-query';
import type { KeywordCommandCenterRowsResponse } from '../../../shared/types/keyword-command-center';

interface KeywordsTableProps {
  workspaceId: string;
  state: UseKeywordsSurfaceStateReturn;
  summary?: KeywordCommandCenterSummaryResponse;
  rowsResult?: UseQueryResult<KeywordCommandCenterRowsResponse, Error>;
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

function asIntent(value: string | undefined): KeywordIntent | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase() as KeywordIntent;
  return INTENTS.has(normalized) ? normalized : null;
}

function formatMoney(value: number | undefined): string {
  return typeof value === 'number' ? MONEY_FORMAT.format(value) : 'No CPC';
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

  const clearSelection = () => setSelectedKeys(new Set());

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
          setPendingBulk(null);
          clearSelection();
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

  const columns = useMemo<DataColumn[]>(() => [
    {
      key: 'select',
      label: 'Select',
      width: '52px',
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
      width: 'minmax(220px, 1.8fr)',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{row.keyword}</span>
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
      width: '118px',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        const intent = asIntent(row.metrics.intent);
        return intent ? <IntentTag intent={intent} /> : <Badge label="Unknown" tone="zinc" variant="outline" size="sm" />;
      },
    },
    {
      key: 'rank',
      label: 'Rank',
      width: '92px',
      align: 'right',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return <span>{row.metrics.currentPosition != null ? `#${row.metrics.currentPosition}` : 'No rank'}</span>;
      },
    },
    {
      key: 'opportunity',
      label: 'Opp',
      width: '148px',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        const score = row.opportunityScore;
        return typeof score === 'number'
          ? <Meter value={score} showValue ariaLabel={`${row.keyword} opportunity score`} gradient />
          : <span className="t-caption-sm text-[var(--brand-text-muted)]">No score</span>;
      },
    },
    {
      key: 'currentMonthly',
      label: '$',
      width: '92px',
      align: 'right',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return <span>{formatMoney(row.currentMonthly)}</span>;
      },
    },
    {
      key: 'lifecycleStatus',
      label: 'Lifecycle',
      width: 'minmax(220px, 1.2fr)',
      render: (_value, record) => {
        const row = (record as KeywordsTableRecord).source;
        return (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <StatusBadge status={row.lifecycleStatus} domain="keyword-command-center" variant="soft" />
            {row.tracking.sourceGapKey && <Badge label="From gap" tone="blue" variant="soft" size="sm" />}
            {row.tracking.strategyOwned === true && <Badge label="Auto-managed" tone="teal" variant="soft" size="sm" />}
            {row.rawEvidenceOnly && <Badge label="Raw evidence" tone="zinc" variant="outline" size="sm" />}
          </div>
        );
      },
    },
  ], [selectedKeys, toggleKey]);

  return (
    <div className="flex flex-col gap-3">
      <Toolbar label="Keyword table controls" className="w-full">
        {SORT_CONTROLS.map((control) => (
          <FilterChip
            key={control.key}
            label={`${control.label}${state.sort.key === control.key ? ` ${state.sort.direction}` : ''}`}
            active={state.sort.key === control.key}
            onClick={() => state.setSort(control.key)}
          />
        ))}
        <ToolbarSpacer />
        <span className="t-caption text-[var(--brand-text-muted)]">
          {pageInfo ? `${NUMBER_FORMAT.format(pageInfo.totalRows)} keywords` : 'Keyword rows'}
        </span>
      </Toolbar>

      <p className="t-caption text-[var(--brand-text-muted)]">
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

      {selectedKeys.size > 0 && (
        <InlineBanner tone="info" size="sm" title={`${selectedKeys.size} selected`}>
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

      <DataTable
        columns={columns}
        rows={tableRows}
        loading={rowsResult.isLoading && tableRows.length === 0}
        getRowKey={(record) => (record as KeywordsTableRecord).source.normalizedKeyword}
        onRowClick={(record) => state.openKeyword((record as KeywordsTableRecord).source.keyword)}
        empty="No keywords match this view"
      />

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
