// @ds-rebuilt
import { normalizePageUrl } from '../../../shared/page-address-utils';
import { keywordTrackingKey } from '../../lib/keywordTracking';
import { useKeywordCommandCenterRows } from '../../hooks/admin/useKeywordCommandCenter';
import type {
  KeywordCommandCenterRow,
  KeywordCommandCenterSummaryResponse,
} from '../../../shared/types/keyword-command-center';
import { KEYWORD_LIFECYCLE_STAGES } from '../../../shared/types/keyword-command-center';
import { Badge, BoardCard, BoardColumn, Button, GroupBlock, InlineBanner, Skeleton } from '../ui';
import { KeywordsTable, type KeywordRowsQueryResult } from './KeywordsTable';
import type { KeywordsSurfaceLens, UseKeywordsSurfaceStateReturn } from './useKeywordsSurfaceState';

interface KeywordsLensesProps {
  workspaceId: string;
  state: UseKeywordsSurfaceStateReturn;
  summary?: KeywordCommandCenterSummaryResponse;
  initialRowsResult?: KeywordRowsQueryResult;
}

interface KeywordGroup {
  id: string;
  title: string;
  rows: KeywordCommandCenterRow[];
  flag?: string;
  meta?: string;
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

function opportunityTraffic(rows: KeywordCommandCenterRow[]): string {
  const impressions = rows
    .map((row) => row.metrics.impressions)
    .filter((value): value is number => typeof value === 'number');
  if (impressions.length === 0) return 'No data';
  const total = impressions.reduce((sum, value) => sum + value, 0);
  return new Intl.NumberFormat('en-US', { notation: total >= 10_000 ? 'compact' : 'standard' }).format(total);
}

function normalizedPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return normalizePageUrl(value).toLowerCase();
}

function groupRowsByPage(rows: KeywordCommandCenterRow[], summary?: KeywordCommandCenterSummaryResponse): KeywordGroup[] {
  const cannibalizedPaths = new Set<string>();
  for (const issue of summary?.cannibalization ?? []) {
    for (const page of issue.pages) {
      const path = normalizedPath(page.path);
      if (path) cannibalizedPaths.add(path);
    }
  }

  const groups = new Map<string, KeywordGroup>();
  for (const row of rows) {
    const pagePath = row.assignment?.pagePath ?? 'unassigned';
    const pageKey = normalizedPath(row.assignment?.pagePath) ?? pagePath;
    const title = row.assignment?.pageTitle ?? row.assignment?.pagePath ?? 'Unassigned keywords';
    const existing = groups.get(pageKey) ?? {
      id: pageKey,
      title,
      rows: [],
      flag: cannibalizedPaths.has(pageKey) ? 'Cannibalization risk' : undefined,
    };
    existing.rows.push(row);
    groups.set(pageKey, existing);
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function groupRowsByCluster(rows: KeywordCommandCenterRow[], summary?: KeywordCommandCenterSummaryResponse): KeywordGroup[] {
  const rowsByKeyword = new Map(rows.map((row) => [keywordTrackingKey(row.keyword), row]));
  const cannibalizedKeywords = new Set((summary?.cannibalization ?? []).map((issue) => keywordTrackingKey(issue.keyword)));
  const used = new Set<string>();

  const groups: KeywordGroup[] = [];
  for (const cluster of summary?.topicClusters ?? []) {
    const clusterRows = cluster.keywords
      .map((keyword) => rowsByKeyword.get(keywordTrackingKey(keyword)))
      .filter((row): row is KeywordCommandCenterRow => row != null);
    for (const row of rows) {
      if (row.assignment?.topicCluster === cluster.topic && !clusterRows.some((existing) => existing.normalizedKeyword === row.normalizedKeyword)) {
        clusterRows.push(row);
      }
    }
    for (const row of clusterRows) used.add(row.normalizedKeyword);
    groups.push({
      id: cluster.topic,
      title: cluster.topic,
      rows: clusterRows,
      flag: clusterRows.some((row) => cannibalizedKeywords.has(keywordTrackingKey(row.keyword)))
        ? 'Cannibalization risk'
        : undefined,
      meta: `${cluster.ownedCount}/${cluster.totalCount} covered`,
    });
  }

  const uncategorized = rows.filter((row) => !used.has(row.normalizedKeyword));
  const assignmentGroups = new Map<string, KeywordCommandCenterRow[]>();
  for (const row of uncategorized) {
    const topic = row.assignment?.topicCluster;
    if (!topic) continue;
    const next = assignmentGroups.get(topic) ?? [];
    next.push(row);
    assignmentGroups.set(topic, next);
  }
  for (const [topic, groupRows] of assignmentGroups) {
    groups.push({ id: `assignment:${topic}`, title: topic, rows: groupRows });
  }

  const stillUncategorized = uncategorized.filter((row) => !row.assignment?.topicCluster);
  if (stillUncategorized.length > 0) {
    groups.push({ id: 'uncategorized', title: 'Unclustered keywords', rows: stillUncategorized });
  }

  return groups;
}

function KeywordMiniRow({
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
          <Badge label={`${Math.round(row.opportunityScore)} opp`} tone="teal" variant="soft" size="sm" />
        )}
      </div>
    </BoardCard>
  );
}

function GroupedLens({
  groups,
  onOpen,
}: {
  groups: KeywordGroup[];
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
            { label: 'Rows', value: group.rows.length },
            { label: 'Opp traffic', value: opportunityTraffic(group.rows) },
          ]}
          flag={group.flag ? { label: group.flag } : undefined}
          collapsible
          defaultOpen
        >
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {group.rows.map((row) => (
              <KeywordMiniRow key={row.normalizedKeyword} row={row} onOpen={onOpen} />
            ))}
          </div>
        </GroupBlock>
      ))}
    </div>
  );
}

function LifecycleLens({
  rows,
  onOpen,
}: {
  rows: KeywordCommandCenterRow[];
  onOpen: (row: KeywordCommandCenterRow) => void;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-5">
      {LIFECYCLE_META.map((meta) => {
        const stageRows = rows.filter((row) => (row.lifecycleStage ?? KEYWORD_LIFECYCLE_STAGES.DISCOVERED) === meta.stage);
        return (
          <BoardColumn key={meta.stage} title={meta.title} count={stageRows.length} accent={meta.accent}>
            {stageRows.map((row) => (
              <KeywordMiniRow key={row.normalizedKeyword} row={row} onOpen={onOpen} />
            ))}
          </BoardColumn>
        );
      })}
    </div>
  );
}

function rowsQueryForLens(state: UseKeywordsSurfaceStateReturn, lens: KeywordsSurfaceLens) {
  if (lens === 'opportunities') {
    return { ...state.rowsQuery, sort: 'opportunity' as const, direction: 'desc' as const };
  }
  if (lens === 'rankings') {
    return { ...state.rowsQuery, sort: 'rank' as const, direction: 'asc' as const };
  }
  return state.rowsQuery;
}

export function KeywordsLenses({ workspaceId, state, summary, initialRowsResult }: KeywordsLensesProps) {
  const rowsQuery = rowsQueryForLens(state, state.lens);
  const ownedRowsResult = useKeywordCommandCenterRows(workspaceId, rowsQuery, {
    enabled: initialRowsResult == null,
  });
  const rowsResult = initialRowsResult ?? ownedRowsResult;
  const rows = rowsResult.data?.rows ?? [];

  // Pages/Clusters/Lifecycle group the CURRENT PAGE of rows, not the whole workspace.
  // Be honest when that is a subset — never present a page-1 board as the full universe
  // (review PR #1480). Full server-side grouping over all keywords is DEF-kw-003.
  const totalCount = summary?.counts?.total ?? rows.length;
  const hiddenFromGroups = Math.max(0, totalCount - rows.length);
  const truncationBanner = hiddenFromGroups > 0 ? (
    <InlineBanner tone="warning" title={`Grouped from the first ${rows.length} keywords`}>
      {hiddenFromGroups} more keywords are not shown here — these lenses group the current
      page, not the full set (server-side grouping is tracked as DEF-kw-003). Use the
      Rankings lens to page through every keyword.
    </InlineBanner>
  ) : null;

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

  if (state.lens === 'pages') {
    return (
      <div className="flex flex-col gap-3">
        {truncationBanner}
        <GroupedLens groups={groupRowsByPage(rows, summary)} onOpen={(row) => state.openKeyword(row.keyword)} />
      </div>
    );
  }

  if (state.lens === 'clusters') {
    return (
      <div className="flex flex-col gap-3">
        {truncationBanner}
        <GroupedLens groups={groupRowsByCluster(rows, summary)} onOpen={(row) => state.openKeyword(row.keyword)} />
      </div>
    );
  }

  if (state.lens === 'lifecycle') {
    return (
      <div className="flex flex-col gap-3">
        {truncationBanner}
        <LifecycleLens rows={rows} onOpen={(row) => state.openKeyword(row.keyword)} />
      </div>
    );
  }

  return (
    <KeywordsTable
      workspaceId={workspaceId}
      state={state}
      summary={summary}
      rowsResult={rowsResult}
    />
  );
}
