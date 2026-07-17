// @ds-rebuilt
import { useKeywordCommandCenterGroupedView, useKeywordCommandCenterRows } from '../../hooks/admin/useKeywordCommandCenter';
import type {
  KeywordCommandCenterGroup,
  KeywordCommandCenterRow,
  KeywordCommandCenterSummaryResponse,
} from '../../../shared/types/keyword-command-center';
import { KEYWORD_COMMAND_CENTER_GROUP_BY } from '../../../shared/types/keyword-command-center';
import { KEYWORD_LIFECYCLE_STAGES } from '../../../shared/types/keyword-command-center';
import { Badge, BoardCard, BoardColumn, Button, ClickableRow, GroupBlock, InlineBanner, IntentTag, Segmented, Skeleton, Toolbar } from '../ui';
import type { KeywordIntent } from '../ui';
import { KeywordsTable, type KeywordRowsQueryResult } from './KeywordsTable';
import type { UseKeywordsSurfaceStateReturn } from './useKeywordsSurfaceState';

interface KeywordsLensesProps {
  workspaceId: string;
  state: UseKeywordsSurfaceStateReturn;
  summary?: KeywordCommandCenterSummaryResponse;
  initialRowsResult?: KeywordRowsQueryResult;
}

const LIFECYCLE_META: Array<{
  stage: NonNullable<KeywordCommandCenterRow['lifecycleStage']>;
  title: string;
  accent: string;
}> = [
  { stage: KEYWORD_LIFECYCLE_STAGES.DISCOVERED, title: 'Discovered', accent: 'var(--blue)' },
  { stage: KEYWORD_LIFECYCLE_STAGES.TARGETED, title: 'Targeted', accent: 'var(--teal)' },
  { stage: KEYWORD_LIFECYCLE_STAGES.PUBLISHED, title: 'Published', accent: 'var(--emerald)' },
  { stage: KEYWORD_LIFECYCLE_STAGES.RANKING, title: 'Ranking', accent: 'var(--amber)' },
  { stage: KEYWORD_LIFECYCLE_STAGES.WINNING, title: 'Winning', accent: 'var(--emerald)' },
];

const INTENTS = new Set<KeywordIntent>(['commercial', 'informational', 'transactional', 'local']);

function asIntent(value: string | undefined): KeywordIntent | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase() as KeywordIntent;
  return INTENTS.has(normalized) ? normalized : null;
}

function lifecycleAccent(row: KeywordCommandCenterRow): string {
  const stage = row.lifecycleStage ?? KEYWORD_LIFECYCLE_STAGES.DISCOVERED;
  return LIFECYCLE_META.find((meta) => meta.stage === stage)?.accent ?? 'var(--blue)';
}

function formatRollup(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { notation: value >= 10_000 ? 'compact' : 'standard' }).format(value);
}

function GroupedKeywordRow({
  row,
  onOpen,
}: {
  row: KeywordCommandCenterRow;
  onOpen: (row: KeywordCommandCenterRow) => void;
}) {
  const intent = asIntent(row.metrics.intent);
  return (
    <ClickableRow
      aria-label={`Open ${row.keyword}`}
      className="flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-[9px]"
      onClick={() => onOpen(row)}
    >
      <span aria-hidden="true" className="h-2 w-2 flex-none rounded-[var(--radius-pill)]" style={{ background: lifecycleAccent(row) }} />
      <span className="min-w-0 flex-1 truncate t-ui font-semibold text-[var(--brand-text-bright)]">{row.keyword}</span>
      {intent ? <IntentTag intent={intent} /> : <Badge label="Unknown" tone="zinc" variant="outline" size="sm" />}
      <span className="w-10 flex-none text-right t-ui font-bold tabular-nums text-[var(--brand-text-bright)]">
        {row.metrics.currentPosition != null ? `#${row.metrics.currentPosition}` : '—'}
      </span>
    </ClickableRow>
  );
}

function LifecycleKeywordCard({
  row,
  onOpen,
}: {
  row: KeywordCommandCenterRow;
  onOpen: (row: KeywordCommandCenterRow) => void;
}) {
  return (
    <BoardCard
      title={row.keyword}
      meta={row.assignment?.pageTitle ?? row.assignment?.pagePath ?? row.statusLabel}
      onClick={() => onOpen(row)}
    >
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge label={row.metrics.currentPosition != null ? `#${row.metrics.currentPosition}` : 'No rank'} tone="blue" variant="soft" size="sm" />
        {typeof row.opportunityScore === 'number' && (
          <Badge label={`${Math.round(row.opportunityScore)} opp`} tone="blue" variant="soft" size="sm" />
        )}
      </div>
    </BoardCard>
  );
}

function GroupedLens({
  groups,
  onOpen,
}: {
  groups: KeywordCommandCenterGroup[];
  onOpen: (row: KeywordCommandCenterRow) => void;
}) {
  if (groups.length === 0) {
    return <InlineBanner tone="info" title="No grouped keywords">This lens will populate after keywords have page or cluster context.</InlineBanner>;
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <GroupBlock
          key={group.id}
          title={group.title}
          meta={group.meta}
          stats={[
            { label: 'Keywords', value: group.rollup.keywordCount },
            { label: 'Impressions', value: formatRollup(group.rollup.impressions) },
          ]}
          flag={group.flag ? { label: group.flag } : undefined}
          collapsible
          defaultOpen
        >
          <div className="flex flex-col">
            {group.rows.map((row) => (
              <GroupedKeywordRow key={row.normalizedKeyword} row={row} onOpen={onOpen} />
            ))}
          </div>
        </GroupBlock>
      ))}
    </div>
  );
}

function LifecycleLens({
  groups,
  onOpen,
}: {
  groups: KeywordCommandCenterGroup[];
  onOpen: (row: KeywordCommandCenterRow) => void;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-5">
      {LIFECYCLE_META.map((meta) => {
        const group = groups.find((candidate) => candidate.id === meta.stage);
        const stageRows = group?.rows ?? [];
        return (
          <BoardColumn key={meta.stage} title={meta.title} count={group?.rollup.keywordCount ?? 0} accent={meta.accent} className="max-h-[680px]">
            {stageRows.map((row) => (
              <LifecycleKeywordCard key={row.normalizedKeyword} row={row} onOpen={onOpen} />
            ))}
          </BoardColumn>
        );
      })}
    </div>
  );
}

export function KeywordsLenses({ workspaceId, state, summary, initialRowsResult }: KeywordsLensesProps) {
  // state.rowsQuery already carries the lens-appropriate default sort (setLens applies
  // it on every lens switch) AND the user's sort-chip choice. Do NOT re-force a per-lens
  // sort here — that override was silently ignoring the sort chips in the owned-query
  // (local_candidates) path, leaving them dead. Use the state query in both paths.
  const rowsQuery = state.rowsQuery;
  const ownedRowsResult = useKeywordCommandCenterRows(workspaceId, rowsQuery, {
    enabled: initialRowsResult == null,
  });
  const rowsResult = initialRowsResult ?? ownedRowsResult;
  const groupedQuery = state.groupedQuery ?? {
    groupBy: KEYWORD_COMMAND_CENTER_GROUP_BY.PAGE,
    filter: state.filter,
  };
  const groupedResult = useKeywordCommandCenterGroupedView(workspaceId, groupedQuery, {
    enabled: state.groupedQuery != null,
  });
  const groups = groupedResult.data?.groups ?? [];

  if (state.groupedQuery && groupedResult.isLoading && !groupedResult.data) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="keywords-grouped-loading">
        {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-[116px] w-full" />)}
      </div>
    );
  }

  if (state.groupedQuery && groupedResult.isError && !groupedResult.data) {
    return (
      <InlineBanner tone="error" title="Could not load complete keyword groups">
        <div className="flex flex-wrap items-center gap-2">
          <span>Try again to reload this grouped view.</span>
          <Button size="sm" variant="secondary" onClick={() => groupedResult.refetch()}>Retry</Button>
        </div>
      </InlineBanner>
    );
  }

  if (rowsResult.isLoading && !rowsResult.data) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="keywords-lens-loading">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-[116px] w-full" />
        ))}
      </div>
    );
  }

  if (rowsResult.isError && !rowsResult.data) {
    return (
      <InlineBanner tone="error" title="Could not load keyword rows">
        <div className="flex flex-wrap items-center gap-2">
          <span>Try again to reload this lens.</span>
          <Button size="sm" variant="secondary" onClick={() => rowsResult.refetch()}>
            Retry
          </Button>
        </div>
      </InlineBanner>
    );
  }

  if (state.lens === 'lifecycle') {
    return <LifecycleLens groups={groups} onOpen={(row) => state.openKeyword(row.keyword)} />;
  }

  const presentationControls = (
    <Toolbar label="Keyword table presentation" className="w-full" gap={8}>
      <span className="t-caption font-medium text-[var(--brand-text-muted)]">Columns</span>
      <Segmented
        id="keyword-columns"
        options={[
          { value: 'full', label: 'Full' },
          { value: 'triage', label: 'Triage' },
        ]}
        value={state.columns}
        onChange={(value) => state.setColumns(value as typeof state.columns)}
      />
      <span className="ml-2 t-caption font-medium text-[var(--brand-text-muted)]">Group by</span>
      <Segmented
        id="keyword-group-by"
        options={[
          { value: 'none', label: 'None' },
          { value: 'page', label: 'Page' },
          { value: 'cluster', label: 'Cluster' },
        ]}
        value={state.groupBy}
        onChange={(value) => state.setGroupBy(value as typeof state.groupBy)}
      />
    </Toolbar>
  );

  if (state.groupBy === 'page') {
    return (
      <div className="flex flex-col gap-3">
        {presentationControls}
        <GroupedLens groups={groups} onOpen={(row) => state.openKeyword(row.keyword)} />
      </div>
    );
  }

  if (state.groupBy === 'cluster') {
    return (
      <div className="flex flex-col gap-3">
        {presentationControls}
        <GroupedLens groups={groups} onOpen={(row) => state.openKeyword(row.keyword)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {presentationControls}
      <KeywordsTable
        workspaceId={workspaceId}
        state={state}
        summary={summary}
        rowsResult={rowsResult}
      />
    </div>
  );
}
