import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import { normalizePageUrl } from '../../../shared/page-address-utils.js';
import {
  KEYWORD_COMMAND_CENTER_FILTERS,
  KEYWORD_COMMAND_CENTER_GROUP_BY,
  KEYWORD_LIFECYCLE_STAGES,
  type KeywordCommandCenterGroup,
  type KeywordCommandCenterGroupedViewQuery,
  type KeywordCommandCenterGroupedViewResponse,
  type KeywordCommandCenterRow,
} from '../../../shared/types/keyword-command-center.js';
import { buildKeywordCommandCenterRowsForGrouping } from './rows-service.js';
import { buildKeywordCommandCenterSourceSnapshot } from './source-snapshot.js';

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function rollup(rows: KeywordCommandCenterRow[]): KeywordCommandCenterGroup['rollup'] {
  const clicks = rows
    .map(row => row.metrics.clicks)
    .filter((value): value is number => typeof value === 'number');
  const impressions = rows
    .map(row => row.metrics.impressions)
    .filter((value): value is number => typeof value === 'number');
  const positioned = rows.filter(row => typeof row.metrics.currentPosition === 'number');
  const weighted = positioned.filter(row => typeof row.metrics.impressions === 'number' && row.metrics.impressions > 0);
  const weightedImpressions = weighted.reduce((total, row) => total + (row.metrics.impressions ?? 0), 0);
  const averagePosition = positioned.length === 0
    ? null
    : weightedImpressions > 0
      ? weighted.reduce(
          (total, row) => total + (row.metrics.currentPosition ?? 0) * (row.metrics.impressions ?? 0),
          0,
        ) / weightedImpressions
      : positioned.reduce((total, row) => total + (row.metrics.currentPosition ?? 0), 0) / positioned.length;
  return {
    keywordCount: rows.length,
    clicks: clicks.length > 0 ? round(clicks.reduce((total, value) => total + value, 0)) : null,
    impressions: impressions.length > 0 ? round(impressions.reduce((total, value) => total + value, 0)) : null,
    averagePosition: averagePosition == null ? null : round(averagePosition),
  };
}

function finalizeGroup(group: Omit<KeywordCommandCenterGroup, 'rollup'>): KeywordCommandCenterGroup {
  return { ...group, rollup: rollup(group.rows) };
}

function pageGroups(
  rows: KeywordCommandCenterRow[],
  cannibalizedPaths: Set<string>,
): KeywordCommandCenterGroup[] {
  const groups = new Map<string, Omit<KeywordCommandCenterGroup, 'rollup'>>();
  for (const row of rows) {
    const path = row.assignment?.pagePath ? normalizePageUrl(row.assignment.pagePath).toLowerCase() : 'unassigned';
    const group = groups.get(path) ?? {
      id: path,
      title: row.assignment?.pageTitle ?? row.assignment?.pagePath ?? 'Unassigned keywords',
      flag: cannibalizedPaths.has(path) ? 'Cannibalization risk' : undefined,
      rows: [],
    };
    group.rows.push(row);
    groups.set(path, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(finalizeGroup);
}

function clusterGroups(
  rows: KeywordCommandCenterRow[],
  topicClusters: NonNullable<ReturnType<typeof buildKeywordCommandCenterSourceSnapshot>>['topicClusters'],
  cannibalizedKeywords: Set<string>,
): KeywordCommandCenterGroup[] {
  const clusterByKeyword = new Map<string, string>();
  const groups = new Map<string, Omit<KeywordCommandCenterGroup, 'rollup'>>();
  for (const cluster of topicClusters ?? []) {
    groups.set(cluster.topic, {
      id: cluster.topic,
      title: cluster.topic,
      meta: `${cluster.ownedCount}/${cluster.totalCount} covered`,
      rows: [],
    });
    for (const keyword of cluster.keywords) clusterByKeyword.set(keywordComparisonKey(keyword), cluster.topic);
  }
  for (const row of rows) {
    const topic = clusterByKeyword.get(row.normalizedKeyword) ?? row.assignment?.topicCluster ?? 'Unclustered keywords';
    const group = groups.get(topic) ?? { id: topic, title: topic, rows: [] };
    group.rows.push(row);
    if (cannibalizedKeywords.has(row.normalizedKeyword)) group.flag = 'Cannibalization risk';
    groups.set(topic, group);
  }
  return [...groups.values()].filter(group => group.rows.length > 0).map(finalizeGroup);
}

const LIFECYCLE_GROUPS = [
  { id: KEYWORD_LIFECYCLE_STAGES.DISCOVERED, title: 'Discovered' },
  { id: KEYWORD_LIFECYCLE_STAGES.TARGETED, title: 'Targeted' },
  { id: KEYWORD_LIFECYCLE_STAGES.PUBLISHED, title: 'Published' },
  { id: KEYWORD_LIFECYCLE_STAGES.RANKING, title: 'Ranking' },
  { id: KEYWORD_LIFECYCLE_STAGES.WINNING, title: 'Winning' },
] as const;

function lifecycleGroups(rows: KeywordCommandCenterRow[]): KeywordCommandCenterGroup[] {
  return LIFECYCLE_GROUPS.map(({ id, title }) => finalizeGroup({
    id,
    title,
    rows: rows.filter(row => (row.lifecycleStage ?? KEYWORD_LIFECYCLE_STAGES.DISCOVERED) === id),
  }));
}

/** Server-owned complete grouped view over the KCC skinny source snapshot. */
export async function buildKeywordCommandCenterGroupedView(
  workspaceId: string,
  query: KeywordCommandCenterGroupedViewQuery,
  options: { includeLocalSeo?: boolean } = {},
): Promise<KeywordCommandCenterGroupedViewResponse | null> {
  const filter = query.filter ?? KEYWORD_COMMAND_CENTER_FILTERS.ALL;
  const snapshot = buildKeywordCommandCenterSourceSnapshot(workspaceId, {
    includeLocalSeo: options.includeLocalSeo,
    includeLocalCandidates: filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES,
    includeSummary: true,
    includeScoring: true,
  });
  if (!snapshot) return null;
  const rows = await buildKeywordCommandCenterRowsForGrouping(workspaceId, query, {
    includeLocalSeo: options.includeLocalSeo,
    sourceSnapshot: snapshot,
  });
  if (!rows) return null;

  const cannibalizedPaths = new Set<string>();
  const cannibalizedKeywords = new Set<string>();
  for (const issue of snapshot.cannibalization ?? []) {
    cannibalizedKeywords.add(keywordComparisonKey(issue.keyword));
    for (const page of issue.pages) cannibalizedPaths.add(normalizePageUrl(page.path).toLowerCase());
  }
  const groups = query.groupBy === KEYWORD_COMMAND_CENTER_GROUP_BY.PAGE
    ? pageGroups(rows, cannibalizedPaths)
    : query.groupBy === KEYWORD_COMMAND_CENTER_GROUP_BY.CLUSTER
      ? clusterGroups(rows, snapshot.topicClusters, cannibalizedKeywords)
      : lifecycleGroups(rows);

  return {
    groupBy: query.groupBy,
    groups,
    totalRows: rows.length,
    groupedAt: new Date().toISOString(),
    rankFreshness: snapshot.rankFreshness,
  };
}
