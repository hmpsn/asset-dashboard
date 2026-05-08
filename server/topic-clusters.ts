/**
 * topic-clusters — CRUD for the topic_clusters table.
 *
 * Normalizes keywordStrategy.topicClusters[] out of the workspace JSON blob into
 * indexed SQLite rows.
 */
import { z } from 'zod';
import db from './db/index.js';
import type { TopicCluster } from '../shared/types/workspace.js';
import { createLogger } from './logger.js';
import { parseJsonFallback, parseJsonSafeArray } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';

const log = createLogger('topic-clusters');

interface TopicClusterRow {
  workspace_id: string;
  topic: string;
  keywords: string;
  owned_count: number;
  total_count: number;
  coverage_percent: number;
  avg_position: number | null;
  top_competitor: string | null;
  top_competitor_coverage: number | null;
  gap_keywords: string;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeTopicCluster(raw: unknown): TopicCluster | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const topic = nonEmptyString(candidate.topic);
  const keywords = Array.isArray(candidate.keywords)
    ? candidate.keywords.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim())
    : [];
  const ownedCount = finiteNumber(candidate.ownedCount);
  const totalCount = finiteNumber(candidate.totalCount);
  const coveragePercent = finiteNumber(candidate.coveragePercent);
  const gap = Array.isArray(candidate.gap)
    ? candidate.gap.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim())
    : [];

  if (!topic || keywords.length === 0 || ownedCount == null || totalCount == null || coveragePercent == null) {
    return null;
  }

  const avgPosition = finiteNumber(candidate.avgPosition);
  const topCompetitor = nonEmptyString(candidate.topCompetitor);
  const topCompetitorCoverage = finiteNumber(candidate.topCompetitorCoverage);

  return {
    topic,
    keywords,
    ownedCount,
    totalCount,
    coveragePercent,
    avgPosition,
    topCompetitor,
    topCompetitorCoverage,
    gap,
  };
}

function rowToModel(row: TopicClusterRow): TopicCluster {
  const cluster: TopicCluster = {
    topic: row.topic,
    keywords: parseJsonSafeArray(row.keywords, z.string(), { table: 'topic_clusters', field: 'keywords' }),
    ownedCount: row.owned_count,
    totalCount: row.total_count,
    coveragePercent: row.coverage_percent,
    gap: parseJsonSafeArray(row.gap_keywords, z.string(), { table: 'topic_clusters', field: 'gap_keywords' }),
  };
  if (row.avg_position != null) cluster.avgPosition = row.avg_position;
  if (row.top_competitor) cluster.topCompetitor = row.top_competitor;
  if (row.top_competitor_coverage != null) cluster.topCompetitorCoverage = row.top_competitor_coverage;
  return cluster;
}

function modelToParams(workspaceId: string, cluster: TopicCluster) {
  return {
    workspace_id: workspaceId,
    topic: cluster.topic,
    keywords: JSON.stringify(cluster.keywords),
    owned_count: cluster.ownedCount,
    total_count: cluster.totalCount,
    coverage_percent: cluster.coveragePercent,
    avg_position: cluster.avgPosition ?? null,
    top_competitor: cluster.topCompetitor ?? null,
    top_competitor_coverage: cluster.topCompetitorCoverage ?? null,
    gap_keywords: JSON.stringify(cluster.gap),
  };
}

function dedupeByTopic(clusters: TopicCluster[]): TopicCluster[] {
  const byTopic = new Map<string, TopicCluster>();
  for (const cluster of clusters) {
    byTopic.set(cluster.topic.toLowerCase(), cluster);
  }
  return [...byTopic.values()];
}

const stmts = createStmtCache(() => ({
  listByWs: db.prepare<[workspaceId: string]>(
    'SELECT * FROM topic_clusters WHERE workspace_id = ? ORDER BY coverage_percent ASC, topic ASC',
  ),
  insert: db.prepare(`
    INSERT INTO topic_clusters (
      workspace_id, topic, keywords, owned_count, total_count, coverage_percent,
      avg_position, top_competitor, top_competitor_coverage, gap_keywords
    ) VALUES (
      @workspace_id, @topic, @keywords, @owned_count, @total_count, @coverage_percent,
      @avg_position, @top_competitor, @top_competitor_coverage, @gap_keywords
    )
  `),
  deleteAll: db.prepare<[workspaceId: string]>(
    'DELETE FROM topic_clusters WHERE workspace_id = ?',
  ),
  countByWs: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) as cnt FROM topic_clusters WHERE workspace_id = ?',
  ),
}));

export function listTopicClusters(workspaceId: string): TopicCluster[] {
  const rows = stmts().listByWs.all(workspaceId) as TopicClusterRow[];
  return rows.map(rowToModel);
}

export function replaceAllTopicClusters(workspaceId: string, clusters: TopicCluster[]): void {
  const run = db.transaction(() => {
    stmts().deleteAll.run(workspaceId);
    const normalized = clusters
      .map((cluster) => normalizeTopicCluster(cluster))
      .filter((cluster): cluster is TopicCluster => cluster != null);
    if (normalized.length !== clusters.length) {
      log.warn({ workspaceId, total: clusters.length, kept: normalized.length }, 'Skipping invalid topic-cluster payload(s)');
    }
    const deduped = dedupeByTopic(normalized);
    const insert = stmts().insert;
    for (const cluster of deduped) {
      insert.run(modelToParams(workspaceId, cluster));
    }
  });
  run();
}

export function deleteAllTopicClusters(workspaceId: string): void {
  stmts().deleteAll.run(workspaceId);
}

export function countTopicClusters(workspaceId: string): number {
  return (stmts().countByWs.get(workspaceId) as { cnt: number }).cnt;
}

/**
 * Migrate keywordStrategy.topicClusters from the workspace JSON blob into topic_clusters.
 * Idempotent — skips workspaces that already have topic_clusters rows.
 */
export function migrateFromJsonBlob(): void {
  const rows = db.prepare(`
    SELECT id, keyword_strategy FROM workspaces
    WHERE keyword_strategy IS NOT NULL AND keyword_strategy != ''
  `).all() as { id: string; keyword_strategy: string }[];

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const strategy = parseJsonFallback<Record<string, unknown> | null>(row.keyword_strategy, null);
      if (!strategy) continue;
      const topicClusters = strategy.topicClusters;
      if (!Array.isArray(topicClusters) || topicClusters.length === 0) continue;

      const normalized = dedupeByTopic(topicClusters
        .map((cluster) => normalizeTopicCluster(cluster))
        .filter((cluster): cluster is TopicCluster => cluster != null));
      if (normalized.length === 0) continue;

      delete strategy.topicClusters;
      const migrateOne = db.transaction((): 'migrated' | 'already-migrated' | 'concurrent-update' => {
        if (countTopicClusters(row.id) > 0) return 'already-migrated';
        const write = db.prepare(`
          UPDATE workspaces
          SET keyword_strategy = ?
          WHERE id = ? AND keyword_strategy = ?
        `).run(JSON.stringify(strategy), row.id, row.keyword_strategy);
        if (write.changes === 0) return 'concurrent-update';
        const insert = stmts().insert;
        for (const cluster of normalized) {
          insert.run(modelToParams(row.id, cluster));
        }
        return 'migrated';
      });

      const outcome = migrateOne();
      if (outcome === 'already-migrated') {
        skipped++;
        continue;
      }
      if (outcome === 'concurrent-update') {
        skipped++;
        log.warn({ workspaceId: row.id }, 'Skipped topicClusters blob cleanup due to concurrent keyword_strategy update');
        continue;
      }

      migrated++;
      log.info({ workspaceId: row.id, topicClusters: normalized.length }, 'Migrated topicClusters to topic_clusters table');
    } catch (err) {
      log.error({ err, workspaceId: row.id }, 'Failed to migrate topicClusters');
    }
  }

  if (migrated > 0 || skipped > 0) {
    log.info({ migrated, skipped }, 'topicClusters migration complete');
  }
}
