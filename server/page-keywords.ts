/**
 * page-keywords — CRUD for the page_keywords table.
 *
 * Replaces the keywordStrategy.pageMap JSON array with indexed SQLite rows.
 * Each row = one page's keyword assignment + analysis data for a workspace.
 */
import { z } from 'zod';
import db from './db/index.js';
import type { PageKeywordMap } from '../shared/types/workspace.ts';
import type { MetricsSource } from '../shared/types/keywords.js';
import { normalizePath } from './helpers.js';
import { createLogger } from './logger.js';
import { parseJsonSafeArray, parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';

const log = createLogger('page-keywords');

// ── Row <-> Model mapping ──

interface PageKeywordRow {
  workspace_id: string;
  page_path: string;
  page_title: string;
  primary_keyword: string;
  secondary_keywords: string;
  search_intent: string | null;
  current_position: number | null;
  previous_position: number | null;
  impressions: number | null;
  clicks: number | null;
  gsc_keywords: string | null;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  secondary_metrics: string | null;
  metrics_source: string | null;
  validated: number | null;
  optimization_score: number | null;
  analysis_generated_at: string | null;
  optimization_issues: string | null;
  recommendations: string | null;
  content_gaps: string | null;
  primary_keyword_presence: string | null;
  long_tail_keywords: string | null;
  competitor_keywords: string | null;
  estimated_difficulty: string | null;
  keyword_difficulty: number | null;
  monthly_volume: number | null;
  topic_cluster: string | null;
  search_intent_confidence: number | null;
  serp_features: string | null;
}

function rowToModel(r: PageKeywordRow): PageKeywordMap {
  const m: PageKeywordMap = {
    pagePath: r.page_path,
    pageTitle: r.page_title,
    primaryKeyword: r.primary_keyword,
    secondaryKeywords: parseJsonSafeArray(r.secondary_keywords, z.string(), { table: 'page_keywords', field: 'secondary_keywords' }),
    searchIntent: r.search_intent ?? undefined,
  };
  if (r.current_position != null) m.currentPosition = r.current_position;
  if (r.previous_position != null) m.previousPosition = r.previous_position;
  if (r.impressions != null) m.impressions = r.impressions;
  if (r.clicks != null) m.clicks = r.clicks;
  if (r.gsc_keywords) m.gscKeywords = parseJsonFallback(r.gsc_keywords, []);
  if (r.volume != null) m.volume = r.volume;
  if (r.difficulty != null) m.difficulty = r.difficulty;
  if (r.cpc != null) m.cpc = r.cpc;
  if (r.secondary_metrics) m.secondaryMetrics = parseJsonFallback(r.secondary_metrics, undefined);
  if (r.metrics_source) m.metricsSource = r.metrics_source as MetricsSource;
  if (r.validated != null) m.validated = !!r.validated;
  if (r.optimization_score != null) m.optimizationScore = r.optimization_score;
  if (r.analysis_generated_at) m.analysisGeneratedAt = r.analysis_generated_at;
  if (r.optimization_issues) m.optimizationIssues = parseJsonSafeArray(r.optimization_issues, z.string(), { table: 'page_keywords', field: 'optimization_issues' });
  if (r.recommendations) m.recommendations = parseJsonSafeArray(r.recommendations, z.string(), { table: 'page_keywords', field: 'recommendations' });
  if (r.content_gaps) m.contentGaps = parseJsonSafeArray(r.content_gaps, z.string(), { table: 'page_keywords', field: 'content_gaps' });
  if (r.primary_keyword_presence) m.primaryKeywordPresence = parseJsonFallback(r.primary_keyword_presence, undefined);
  if (r.long_tail_keywords) m.longTailKeywords = parseJsonSafeArray(r.long_tail_keywords, z.string(), { table: 'page_keywords', field: 'long_tail_keywords' });
  if (r.competitor_keywords) m.competitorKeywords = parseJsonSafeArray(r.competitor_keywords, z.string(), { table: 'page_keywords', field: 'competitor_keywords' });
  if (r.estimated_difficulty) m.estimatedDifficulty = r.estimated_difficulty;
  if (r.keyword_difficulty != null) m.keywordDifficulty = r.keyword_difficulty;
  if (r.monthly_volume != null) m.monthlyVolume = r.monthly_volume;
  if (r.topic_cluster) m.topicCluster = r.topic_cluster;
  if (r.search_intent_confidence != null) m.searchIntentConfidence = r.search_intent_confidence;
  if (r.serp_features) m.serpFeatures = parseJsonSafeArray(r.serp_features, z.string(), { table: 'page_keywords', field: 'serp_features' });
  return m;
}

function modelToParams(workspaceId: string, m: PageKeywordMap) {
  return {
    workspace_id: workspaceId,
    page_path: normalizePath(m.pagePath),
    page_title: m.pageTitle || '',
    primary_keyword: m.primaryKeyword || '',
    secondary_keywords: JSON.stringify(m.secondaryKeywords || []),
    search_intent: m.searchIntent ?? null,
    current_position: m.currentPosition ?? null,
    previous_position: m.previousPosition ?? null,
    impressions: m.impressions ?? null,
    clicks: m.clicks ?? null,
    gsc_keywords: m.gscKeywords ? JSON.stringify(m.gscKeywords) : null,
    volume: m.volume ?? null,
    difficulty: m.difficulty ?? null,
    cpc: m.cpc ?? null,
    secondary_metrics: m.secondaryMetrics ? JSON.stringify(m.secondaryMetrics) : null,
    metrics_source: m.metricsSource ?? null,
    validated: m.validated != null ? (m.validated ? 1 : 0) : null,
    optimization_score: m.optimizationScore ?? null,
    analysis_generated_at: m.analysisGeneratedAt ?? null,
    optimization_issues: m.optimizationIssues ? JSON.stringify(m.optimizationIssues) : null,
    recommendations: m.recommendations ? JSON.stringify(m.recommendations) : null,
    content_gaps: m.contentGaps ? JSON.stringify(m.contentGaps) : null,
    primary_keyword_presence: m.primaryKeywordPresence ? JSON.stringify(m.primaryKeywordPresence) : null,
    long_tail_keywords: m.longTailKeywords ? JSON.stringify(m.longTailKeywords) : null,
    competitor_keywords: m.competitorKeywords ? JSON.stringify(m.competitorKeywords) : null,
    estimated_difficulty: m.estimatedDifficulty ?? null,
    keyword_difficulty: m.keywordDifficulty ?? null,
    monthly_volume: m.monthlyVolume ?? null,
    topic_cluster: m.topicCluster ?? null,
    search_intent_confidence: m.searchIntentConfidence ?? null,
    serp_features: m.serpFeatures ? JSON.stringify(m.serpFeatures) : null,
  };
}

// ── Lazy prepared statements ──

const stmts = createStmtCache(() => ({
  listByWs: db.prepare<[workspaceId: string]>(
    'SELECT * FROM page_keywords WHERE workspace_id = ?',
  ),
  getOne: db.prepare<[workspaceId: string, pagePath: string]>(
    'SELECT * FROM page_keywords WHERE workspace_id = ? AND page_path = ?',
  ),
  upsert: db.prepare(`
    INSERT INTO page_keywords (
      workspace_id, page_path, page_title, primary_keyword, secondary_keywords,
      search_intent, current_position, previous_position, impressions, clicks,
      gsc_keywords, volume, difficulty, cpc, secondary_metrics, metrics_source, validated,
      optimization_score, analysis_generated_at, optimization_issues, recommendations,
      content_gaps, primary_keyword_presence, long_tail_keywords, competitor_keywords,
      estimated_difficulty, keyword_difficulty, monthly_volume, topic_cluster, search_intent_confidence,
      serp_features
    ) VALUES (
      @workspace_id, @page_path, @page_title, @primary_keyword, @secondary_keywords,
      @search_intent, @current_position, @previous_position, @impressions, @clicks,
      @gsc_keywords, @volume, @difficulty, @cpc, @secondary_metrics, @metrics_source, @validated,
      @optimization_score, @analysis_generated_at, @optimization_issues, @recommendations,
      @content_gaps, @primary_keyword_presence, @long_tail_keywords, @competitor_keywords,
      @estimated_difficulty, @keyword_difficulty, @monthly_volume, @topic_cluster, @search_intent_confidence,
      @serp_features
    )
    ON CONFLICT(workspace_id, page_path) DO UPDATE SET
      page_title = excluded.page_title,
      primary_keyword = excluded.primary_keyword,
      secondary_keywords = excluded.secondary_keywords,
      search_intent = excluded.search_intent,
      current_position = excluded.current_position,
      previous_position = excluded.previous_position,
      impressions = excluded.impressions,
      clicks = excluded.clicks,
      gsc_keywords = excluded.gsc_keywords,
      volume = excluded.volume,
      difficulty = excluded.difficulty,
      cpc = excluded.cpc,
      secondary_metrics = excluded.secondary_metrics,
      metrics_source = excluded.metrics_source,
      validated = excluded.validated,
      optimization_score = COALESCE(excluded.optimization_score, page_keywords.optimization_score),
      analysis_generated_at = COALESCE(excluded.analysis_generated_at, page_keywords.analysis_generated_at),
      optimization_issues = COALESCE(excluded.optimization_issues, page_keywords.optimization_issues),
      recommendations = COALESCE(excluded.recommendations, page_keywords.recommendations),
      content_gaps = COALESCE(excluded.content_gaps, page_keywords.content_gaps),
      primary_keyword_presence = COALESCE(excluded.primary_keyword_presence, page_keywords.primary_keyword_presence),
      long_tail_keywords = COALESCE(excluded.long_tail_keywords, page_keywords.long_tail_keywords),
      competitor_keywords = COALESCE(excluded.competitor_keywords, page_keywords.competitor_keywords),
      estimated_difficulty = COALESCE(excluded.estimated_difficulty, page_keywords.estimated_difficulty),
      keyword_difficulty = COALESCE(excluded.keyword_difficulty, page_keywords.keyword_difficulty),
      monthly_volume = COALESCE(excluded.monthly_volume, page_keywords.monthly_volume),
      topic_cluster = COALESCE(excluded.topic_cluster, page_keywords.topic_cluster),
      search_intent_confidence = COALESCE(excluded.search_intent_confidence, page_keywords.search_intent_confidence),
      serp_features = COALESCE(excluded.serp_features, page_keywords.serp_features)
  `),
  deleteOne: db.prepare<[workspaceId: string, pagePath: string]>(
    'DELETE FROM page_keywords WHERE workspace_id = ? AND page_path = ?',
  ),
  deleteAll: db.prepare<[workspaceId: string]>(
    'DELETE FROM page_keywords WHERE workspace_id = ?',
  ),
  clearAnalysis: db.prepare<[workspaceId: string]>(`
    UPDATE page_keywords SET
      optimization_score = NULL,
      analysis_generated_at = NULL,
      optimization_issues = NULL,
      recommendations = NULL,
      content_gaps = NULL,
      primary_keyword_presence = NULL,
      long_tail_keywords = NULL,
      competitor_keywords = NULL,
      estimated_difficulty = NULL,
      keyword_difficulty = NULL,
      monthly_volume = NULL,
      topic_cluster = NULL,
      search_intent_confidence = NULL
    WHERE workspace_id = ?
  `),
  countByWs: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) as cnt FROM page_keywords WHERE workspace_id = ?',
  ),
  countAnalyzed: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) as cnt FROM page_keywords WHERE workspace_id = ? AND optimization_score > 0',
  ),
  unanalyzed: db.prepare<[workspaceId: string]>(
    'SELECT * FROM page_keywords WHERE workspace_id = ? AND (optimization_score IS NULL OR optimization_score <= 0)',
  ),
}));

// ── Public API ──

/** Get all page keywords for a workspace. */
export function listPageKeywords(workspaceId: string): PageKeywordMap[] {
  const rows = stmts().listByWs.all(workspaceId) as PageKeywordRow[];
  return rows.map(rowToModel);
}

/** Get a single page's keywords by path (normalized). */
export function getPageKeyword(workspaceId: string, pagePath: string): PageKeywordMap | undefined {
  const row = stmts().getOne.get(workspaceId, normalizePath(pagePath)) as PageKeywordRow | undefined;
  return row ? rowToModel(row) : undefined;
}

/** Upsert a single page keyword entry. */
export function upsertPageKeyword(workspaceId: string, entry: PageKeywordMap): void {
  stmts().upsert.run(modelToParams(workspaceId, entry));
}

/** Upsert multiple page keyword entries in a single transaction. */
export function upsertPageKeywordsBatch(workspaceId: string, entries: PageKeywordMap[]): void {
  const run = db.transaction(() => {
    const stmt = stmts().upsert;
    for (const entry of entries) {
      stmt.run(modelToParams(workspaceId, entry));
    }
  });
  run();
}

/**
 * Upsert new page keyword entries AND delete any stale rows no longer in the batch.
 * Preserves Page Intelligence analysis fields on surviving rows (via COALESCE in upsertStmt).
 * Use this for strategy generation/updates where the incoming batch is the complete desired set.
 */
export function upsertAndCleanPageKeywords(workspaceId: string, entries: PageKeywordMap[]): void {
  const run = db.transaction(() => {
    const stmt = stmts().upsert;
    for (const entry of entries) {
      stmt.run(modelToParams(workspaceId, entry));
    }
    if (entries.length === 0) {
      // Empty batch — delete all rows for this workspace
      stmts().deleteAll.run(workspaceId);
      return;
    }
    const normalizedPaths = entries.map(e => normalizePath(e.pagePath));
    const placeholders = normalizedPaths.map(() => '?').join(', ');
    db.prepare(
      `DELETE FROM page_keywords WHERE workspace_id = ? AND page_path NOT IN (${placeholders})`
    ).run(workspaceId, ...normalizedPaths);
  });
  run();
}

/** Replace all page keywords for a workspace (delete + insert in transaction). */
export function replaceAllPageKeywords(workspaceId: string, entries: PageKeywordMap[]): void {
  const run = db.transaction(() => {
    stmts().deleteAll.run(workspaceId);
    const stmt = stmts().upsert;
    for (const entry of entries) {
      stmt.run(modelToParams(workspaceId, entry));
    }
  });
  run();
}

/** Delete a single page keyword entry. */
export function deletePageKeyword(workspaceId: string, pagePath: string): void {
  stmts().deleteOne.run(workspaceId, normalizePath(pagePath));
}

/** Delete all page keywords for a workspace. */
export function deleteAllPageKeywords(workspaceId: string): void {
  stmts().deleteAll.run(workspaceId);
}

/** Clear analysis fields from all pages (preserves keyword assignments). */
export function clearAnalysisFields(workspaceId: string): number {
  const result = stmts().clearAnalysis.run(workspaceId);
  return result.changes;
}

/** Count total page keywords for a workspace. */
export function countPageKeywords(workspaceId: string): number {
  return (stmts().countByWs.get(workspaceId) as { cnt: number }).cnt;
}

/** Count analyzed pages (optimization_score > 0). */
export function countAnalyzedPages(workspaceId: string): number {
  return (stmts().countAnalyzed.get(workspaceId) as { cnt: number }).cnt;
}

/** Get pages that haven't been analyzed yet. */
export function getUnanalyzedPages(workspaceId: string): PageKeywordMap[] {
  const rows = stmts().unanalyzed.all(workspaceId) as PageKeywordRow[];
  return rows.map(rowToModel);
}

/**
 * Migrate pageMap data from the workspace JSON blob into the page_keywords table.
 * Idempotent — skips workspaces that already have page_keywords rows.
 */
export function migrateFromJsonBlob(): void {
  // Read all workspaces that have keyword_strategy JSON with pageMap
  const rows = db.prepare(`
    SELECT id, keyword_strategy FROM workspaces
    WHERE keyword_strategy IS NOT NULL AND keyword_strategy != ''
  `).all() as { id: string; keyword_strategy: string }[];

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    // Skip if this workspace already has page_keywords rows
    const existing = countPageKeywords(row.id);
    if (existing > 0) {
      skipped++;
      continue;
    }

    try {
      const strategy = parseJsonFallback<Record<string, unknown> | null>(row.keyword_strategy, null);
      if (!strategy) continue;
      const pageMap = strategy.pageMap;
      if (!Array.isArray(pageMap) || pageMap.length === 0) continue;

      // Insert all pageMap entries
      replaceAllPageKeywords(row.id, pageMap);

      // Strip pageMap from the JSON blob and save back
      delete strategy.pageMap;
      db.prepare('UPDATE workspaces SET keyword_strategy = ? WHERE id = ?')
        .run(JSON.stringify(strategy), row.id);

      migrated++;
      log.info({ workspaceId: row.id, pages: pageMap.length }, 'Migrated pageMap to page_keywords table');
    } catch (err) {
      log.error({ err, workspaceId: row.id }, 'Failed to migrate pageMap');
    }
  }

  if (migrated > 0 || skipped > 0) {
    log.info({ migrated, skipped }, 'pageMap migration complete');
  }
}
