// @ds-rebuilt
import { normalizePageUrl } from '../../../shared/page-address-utils';
import { keywordTrackingKey } from '../../lib/keywordTracking';
import { useKeywordCommandCenterRows } from '../../hooks/admin/useKeywordCommandCenter';
import type {
  KeywordCommandCenterRow,
  KeywordCommandCenterSummaryResponse,
} from '../../../shared/types/keyword-command-center';
import { KEYWORD_LIFECYCLE_STAGES } from '../../../shared/types/keyword-command-center';
import { Badge, BoardCard, BoardColumn, Button, ClickableRow, GroupBlock, InlineBanner, IntentTag, Skeleton } from '../ui';
import type { KeywordIntent } from '../ui';
import { KeywordsTable, type KeywordRowsQueryResult } from './KeywordsTable';
import type { UseKeywordsSurfaceStateReturn } from './useKeywordsSurfaceState';

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

// Sum of the group's last-window Search Console impressions. Labeled honestly as
// "Impressions" — this is realized search exposure, NOT projected opportunity/upside
// traffic (the platform has no per-row estimated-gain field, so a mislabel here would
// present delivered impressions as future upside — see the design-parity audit).
function impressionsTotal(rows: KeywordCommandCenterRow[]): string {
  const impressions = rows
    .map((row) => row.metrics.impressions)
    .filter((value): value is number => typeof value === 'number');
  if (impressions.length === 0) return '—';
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
            { label: 'Keywords', value: group.rows.length },
            { label: 'Impressions', value: impressionsTotal(group.rows) },
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
          <BoardColumn key={meta.stage} title={meta.title} count={stageRows.length} accent={meta.accent} className="max-h-[680px]">
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
  const rows = rowsResult.data?.rows ?? [];

  // Pages/Clusters/Lifecycle group the CURRENT PAGE of rows, not the whole workspace.
  // Be honest when that is a subset — never present a page-1 board as the full universe
  // (review PR #1480). Full server-side grouping over all keywords is a tracked follow-up.
  // Use the FILTER/SEARCH-scoped total (pageInfo.totalRows) so "N more hidden" is correct
  // when a filter or search narrows the set — the workspace-global counts.total would
  // overstate the hidden figure whenever a filter is active.
  const totalCount = rowsResult.data?.pageInfo?.totalRows ?? summary?.counts?.total ?? rows.length;
  const hiddenFromGroups = Math.max(0, totalCount - rows.length);
  const truncationBanner = hiddenFromGroups > 0 ? (
    <InlineBanner tone="warning" title={`Grouped from the first ${rows.length} keywords`}>
      {hiddenFromGroups} more keywords are not shown here — these lenses group the current
      page, not the full set. Use the Rankings lens to page through every keyword.
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
