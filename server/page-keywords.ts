/**
 * page-keywords — CRUD for the page_keywords table.
 *
 * Replaces the keywordStrategy.pageMap JSON array with indexed SQLite rows.
 * Each row = one page's keyword assignment + analysis data for a workspace.
 */
import { z } from 'zod';
import { randomUUID } from 'crypto';
import db from './db/index.js';
import type { PageKeywordMap } from '../shared/types/workspace.ts';
import type { MetricsSource, PageOptimizationScoreSnapshot, UrlLevelKeyword } from '../shared/types/keywords.js';
import {
  EEAT_ASSET_TYPE,
  EEAT_RECOMMENDATION_SURFACE,
  TRUST_SIGNAL_SEVERITY,
} from '../shared/types/eeat-assets.js';
import { normalizePath } from './helpers.js';
import { createLogger } from './logger.js';
import { parseJsonSafeArray, parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';

const log = createLogger('page-keywords');
const SCORE_HISTORY_PER_PAGE_LIMIT = 25;

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
  url_level_keywords: string | null;
  url_level_keyword_source: string | null;
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
  missing_trust_signals: string | null;
  eeat_asset_recommendations: string | null;
}

interface PageKeywordScoreHistoryRow {
  workspace_id: string;
  page_path: string;
  optimization_score: number;
  source: PageOptimizationScoreSnapshot['source'] | string;
  recorded_at: string;
}

const urlLevelKeywordSchema = z.object({
  keyword: z.string(),
  position: z.number(),
  volume: z.number(),
  difficulty: z.number(),
  cpc: z.number(),
  traffic: z.number().optional(),
  url: z.string().optional(),
}).strip();

const missingTrustSignalSchema = z.object({
  signal: z.string(),
  rationale: z.string(),
  severity: z.enum([
    TRUST_SIGNAL_SEVERITY.HIGH,
    TRUST_SIGNAL_SEVERITY.MEDIUM,
    TRUST_SIGNAL_SEVERITY.LOW,
  ]),
  recommendedAssetTypes: z.array(z.enum([
    EEAT_ASSET_TYPE.TESTIMONIAL,
    EEAT_ASSET_TYPE.CASE_STUDY,
    EEAT_ASSET_TYPE.CREDENTIAL,
    EEAT_ASSET_TYPE.BEFORE_AFTER_GALLERY,
    EEAT_ASSET_TYPE.TEAM_BIO,
    EEAT_ASSET_TYPE.AWARD,
    EEAT_ASSET_TYPE.RESEARCH,
    EEAT_ASSET_TYPE.CLIENT_LOGO,
  ])),
}).strip();

const eeatAssetRecommendationSchema = z.object({
  assetId: z.string(),
  type: z.enum([
    EEAT_ASSET_TYPE.TESTIMONIAL,
    EEAT_ASSET_TYPE.CASE_STUDY,
    EEAT_ASSET_TYPE.CREDENTIAL,
    EEAT_ASSET_TYPE.BEFORE_AFTER_GALLERY,
    EEAT_ASSET_TYPE.TEAM_BIO,
    EEAT_ASSET_TYPE.AWARD,
    EEAT_ASSET_TYPE.RESEARCH,
    EEAT_ASSET_TYPE.CLIENT_LOGO,
  ]),
  title: z.string(),
  reason: z.string(),
  surface: z.enum([
    EEAT_RECOMMENDATION_SURFACE.CONTENT_BRIEF,
    EEAT_RECOMMENDATION_SURFACE.PAGE_INTELLIGENCE,
    EEAT_RECOMMENDATION_SURFACE.SCHEMA,
  ]),
  url: z.string().optional(),
}).strip();

function rowToScoreHistory(row: PageKeywordScoreHistoryRow): PageOptimizationScoreSnapshot {
  const source = ['page-analysis', 'bulk-analysis', 'strategy', 'unknown'].includes(row.source)
    ? row.source as PageOptimizationScoreSnapshot['source']
    : 'unknown';
  return {
    score: row.optimization_score,
    recordedAt: row.recorded_at,
    source,
  };
}

function rowToModel(r: PageKeywordRow, optimizationScoreHistory: PageOptimizationScoreSnapshot[] = []): PageKeywordMap {
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
  if (r.url_level_keywords) m.urlLevelKeywords = parseJsonSafeArray(r.url_level_keywords, urlLevelKeywordSchema, { table: 'page_keywords', field: 'url_level_keywords' }) as UrlLevelKeyword[];
  if (r.url_level_keyword_source === 'semrush' || r.url_level_keyword_source === 'dataforseo') m.urlLevelKeywordSource = r.url_level_keyword_source;
  if (optimizationScoreHistory.length) m.optimizationScoreHistory = optimizationScoreHistory;
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
  if (r.missing_trust_signals) {
    m.missingTrustSignals = parseJsonSafeArray(r.missing_trust_signals, missingTrustSignalSchema, {
      table: 'page_keywords',
      field: 'missing_trust_signals',
    });
  }
  if (r.eeat_asset_recommendations) {
    m.eeatAssetRecommendations = parseJsonSafeArray(r.eeat_asset_recommendations, eeatAssetRecommendationSchema, {
      table: 'page_keywords',
      field: 'eeat_asset_recommendations',
    });
  }
  return m;
}

function modelToParams(workspaceId: string, m: PageKeywordMap, preserveAnalysisFields = false) {
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
    url_level_keywords: m.urlLevelKeywords ? JSON.stringify(m.urlLevelKeywords) : null,
    url_level_keyword_source: m.urlLevelKeywordSource ?? null,
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
    missing_trust_signals: m.missingTrustSignals ? JSON.stringify(m.missingTrustSignals) : null,
    eeat_asset_recommendations: m.eeatAssetRecommendations ? JSON.stringify(m.eeatAssetRecommendations) : null,
    preserve_analysis_fields: preserveAnalysisFields ? 1 : 0,
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
      url_level_keywords, url_level_keyword_source,
      optimization_score, analysis_generated_at, optimization_issues, recommendations,
      content_gaps, primary_keyword_presence, long_tail_keywords, competitor_keywords,
      estimated_difficulty, keyword_difficulty, monthly_volume, topic_cluster, search_intent_confidence,
      serp_features, missing_trust_signals, eeat_asset_recommendations
    ) VALUES (
      @workspace_id, @page_path, @page_title, @primary_keyword, @secondary_keywords,
      @search_intent, @current_position, @previous_position, @impressions, @clicks,
      @gsc_keywords, @volume, @difficulty, @cpc, @secondary_metrics, @metrics_source, @validated,
      @url_level_keywords, @url_level_keyword_source,
      @optimization_score, @analysis_generated_at, @optimization_issues, @recommendations,
      @content_gaps, @primary_keyword_presence, @long_tail_keywords, @competitor_keywords,
      @estimated_difficulty, @keyword_difficulty, @monthly_volume, @topic_cluster, @search_intent_confidence,
      @serp_features, @missing_trust_signals, @eeat_asset_recommendations
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
      url_level_keywords = COALESCE(excluded.url_level_keywords, page_keywords.url_level_keywords),
      url_level_keyword_source = COALESCE(excluded.url_level_keyword_source, page_keywords.url_level_keyword_source),
      optimization_score = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.optimization_score, page_keywords.optimization_score) ELSE excluded.optimization_score END,
      analysis_generated_at = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.analysis_generated_at, page_keywords.analysis_generated_at) ELSE excluded.analysis_generated_at END,
      optimization_issues = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.optimization_issues, page_keywords.optimization_issues) ELSE excluded.optimization_issues END,
      recommendations = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.recommendations, page_keywords.recommendations) ELSE excluded.recommendations END,
      content_gaps = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.content_gaps, page_keywords.content_gaps) ELSE excluded.content_gaps END,
      primary_keyword_presence = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.primary_keyword_presence, page_keywords.primary_keyword_presence) ELSE excluded.primary_keyword_presence END,
      long_tail_keywords = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.long_tail_keywords, page_keywords.long_tail_keywords) ELSE excluded.long_tail_keywords END,
      competitor_keywords = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.competitor_keywords, page_keywords.competitor_keywords) ELSE excluded.competitor_keywords END,
      estimated_difficulty = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.estimated_difficulty, page_keywords.estimated_difficulty) ELSE excluded.estimated_difficulty END,
      keyword_difficulty = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.keyword_difficulty, page_keywords.keyword_difficulty) ELSE excluded.keyword_difficulty END,
      monthly_volume = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.monthly_volume, page_keywords.monthly_volume) ELSE excluded.monthly_volume END,
      topic_cluster = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.topic_cluster, page_keywords.topic_cluster) ELSE excluded.topic_cluster END,
      search_intent_confidence = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.search_intent_confidence, page_keywords.search_intent_confidence) ELSE excluded.search_intent_confidence END,
      serp_features = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.serp_features, page_keywords.serp_features) ELSE excluded.serp_features END,
      missing_trust_signals = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.missing_trust_signals, page_keywords.missing_trust_signals) ELSE excluded.missing_trust_signals END,
      eeat_asset_recommendations = CASE WHEN @preserve_analysis_fields = 1 THEN COALESCE(excluded.eeat_asset_recommendations, page_keywords.eeat_asset_recommendations) ELSE excluded.eeat_asset_recommendations END
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
      search_intent_confidence = NULL,
      missing_trust_signals = NULL,
      eeat_asset_recommendations = NULL
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
  scoreHistoryByWs: db.prepare<[workspaceId: string, limit: number]>(`
    SELECT workspace_id, page_path, optimization_score, source, recorded_at
    FROM (
      SELECT
        workspace_id, page_path, optimization_score, source, recorded_at, id,
        ROW_NUMBER() OVER (PARTITION BY page_path ORDER BY recorded_at DESC, id DESC) AS rn
      FROM page_keyword_score_history
      WHERE workspace_id = ?
    )
    WHERE rn <= ?
    ORDER BY page_path ASC, recorded_at ASC
  `,
  ),
  scoreHistoryByPage: db.prepare<[workspaceId: string, pagePath: string, limit: number]>(`
    SELECT workspace_id, page_path, optimization_score, source, recorded_at
    FROM (
      SELECT workspace_id, page_path, optimization_score, source, recorded_at, id
      FROM page_keyword_score_history
      WHERE workspace_id = ? AND page_path = ?
      ORDER BY recorded_at DESC, id DESC
      LIMIT ?
    )
    ORDER BY recorded_at ASC
  `,
  ),
  latestScoreHistory: db.prepare<[workspaceId: string, pagePath: string]>(
    'SELECT workspace_id, page_path, optimization_score, source, recorded_at FROM page_keyword_score_history WHERE workspace_id = ? AND page_path = ? ORDER BY recorded_at DESC LIMIT 1',
  ),
  insertScoreHistory: db.prepare(`
    INSERT OR IGNORE INTO page_keyword_score_history (id, workspace_id, page_path, optimization_score, source, recorded_at)
    VALUES (@id, @workspace_id, @page_path, @optimization_score, @source, @recorded_at)
  `),
  pruneScoreHistory: db.prepare<[workspaceId: string, pagePath: string, subWorkspaceId: string, subPagePath: string, limit: number]>(`
    DELETE FROM page_keyword_score_history
    WHERE workspace_id = ? AND page_path = ? AND id IN (
      SELECT id
      FROM page_keyword_score_history
      WHERE workspace_id = ? AND page_path = ?
      ORDER BY recorded_at DESC, id DESC
      LIMIT -1 OFFSET ?
    )
  `),
  deleteScoreHistory: db.prepare<[workspaceId: string, pagePath: string]>(
    'DELETE FROM page_keyword_score_history WHERE workspace_id = ? AND page_path = ?',
  ),
  deleteAllScoreHistory: db.prepare<[workspaceId: string]>(
    'DELETE FROM page_keyword_score_history WHERE workspace_id = ?',
  ),
}));

// ── Public API ──

function scoreHistorySourceFor(entry: PageKeywordMap): PageOptimizationScoreSnapshot['source'] {
  if (!entry.analysisGeneratedAt) return 'strategy';
  return 'page-analysis';
}

function groupScoreHistory(workspaceId: string): Map<string, PageOptimizationScoreSnapshot[]> {
  const rows = stmts().scoreHistoryByWs.all(workspaceId, SCORE_HISTORY_PER_PAGE_LIMIT) as PageKeywordScoreHistoryRow[];
  const grouped = new Map<string, PageOptimizationScoreSnapshot[]>();
  for (const row of rows) {
    const key = normalizePath(row.page_path).toLowerCase();
    const existing = grouped.get(key) ?? [];
    existing.push(rowToScoreHistory(row));
    grouped.set(key, existing);
  }
  return grouped;
}

function maybeRecordScoreSnapshot(workspaceId: string, entry: PageKeywordMap): void {
  if (entry.optimizationScore == null) return;
  const pagePath = normalizePath(entry.pagePath);
  const roundedScore = Math.round(entry.optimizationScore);
  const latest = stmts().latestScoreHistory.get(workspaceId, pagePath) as PageKeywordScoreHistoryRow | undefined;
  if (latest?.optimization_score === roundedScore) return;
  stmts().insertScoreHistory.run({
    id: randomUUID(),
    workspace_id: workspaceId,
    page_path: pagePath,
    optimization_score: roundedScore,
    source: scoreHistorySourceFor(entry),
    recorded_at: entry.analysisGeneratedAt ?? new Date().toISOString(),
  });
  stmts().pruneScoreHistory.run(workspaceId, pagePath, workspaceId, pagePath, SCORE_HISTORY_PER_PAGE_LIMIT);
}

function normalizedKeyword(value: string | undefined | null): string {
  return keywordComparisonKey(value);
}

function preparePrimaryKeywordUpdate(workspaceId: string, entry: PageKeywordMap): boolean {
  const pagePath = normalizePath(entry.pagePath);
  const existing = stmts().getOne.get(workspaceId, pagePath) as PageKeywordRow | undefined;
  if (!existing) return false;
  const preserveAnalysisFields = normalizedKeyword(existing.primary_keyword) === normalizedKeyword(entry.primaryKeyword);
  if (preserveAnalysisFields) return true;
  stmts().deleteScoreHistory.run(workspaceId, pagePath);
  return false;
}

/** Get all page keywords for a workspace. */
export function listPageKeywords(workspaceId: string): PageKeywordMap[] {
  const rows = stmts().listByWs.all(workspaceId) as PageKeywordRow[];
  const histories = groupScoreHistory(workspaceId);
  return rows.map(row => rowToModel(row, histories.get(normalizePath(row.page_path).toLowerCase()) ?? []));
}

/** Get a single page's keywords by path (normalized). */
export function getPageKeyword(workspaceId: string, pagePath: string): PageKeywordMap | undefined {
  const normalized = normalizePath(pagePath);
  const row = stmts().getOne.get(workspaceId, normalized) as PageKeywordRow | undefined;
  const historyRows = stmts().scoreHistoryByPage.all(workspaceId, normalized, SCORE_HISTORY_PER_PAGE_LIMIT) as PageKeywordScoreHistoryRow[];
  return row ? rowToModel(row, historyRows.map(rowToScoreHistory)) : undefined;
}

/** Upsert a single page keyword entry. */
export function upsertPageKeyword(workspaceId: string, entry: PageKeywordMap): void {
  const run = db.transaction(() => {
    const preserveAnalysisFields = preparePrimaryKeywordUpdate(workspaceId, entry);
    stmts().upsert.run(modelToParams(workspaceId, entry, preserveAnalysisFields));
    maybeRecordScoreSnapshot(workspaceId, entry);
  });
  run();
}

/** Upsert multiple page keyword entries in a single transaction. */
export function upsertPageKeywordsBatch(workspaceId: string, entries: PageKeywordMap[]): void {
  const run = db.transaction(() => {
    const stmt = stmts().upsert;
    for (const entry of entries) {
      const preserveAnalysisFields = preparePrimaryKeywordUpdate(workspaceId, entry);
      stmt.run(modelToParams(workspaceId, entry, preserveAnalysisFields));
      maybeRecordScoreSnapshot(workspaceId, entry);
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
      const preserveAnalysisFields = preparePrimaryKeywordUpdate(workspaceId, entry);
      stmt.run(modelToParams(workspaceId, entry, preserveAnalysisFields));
      maybeRecordScoreSnapshot(workspaceId, entry);
    }
    if (entries.length === 0) {
      // Empty batch — delete all rows for this workspace
      stmts().deleteAll.run(workspaceId);
      stmts().deleteAllScoreHistory.run(workspaceId);
      return;
    }
    const normalizedPaths = entries.map(e => normalizePath(e.pagePath));
    const placeholders = normalizedPaths.map(() => '?').join(', ');
    db.prepare(
      `DELETE FROM page_keywords WHERE workspace_id = ? AND page_path NOT IN (${placeholders})`
    ).run(workspaceId, ...normalizedPaths);
    db.prepare(
      `DELETE FROM page_keyword_score_history WHERE workspace_id = ? AND page_path NOT IN (${placeholders})`
    ).run(workspaceId, ...normalizedPaths);
  });
  run();
}

/** Replace all page keywords for a workspace (delete + insert in transaction). */
export function replaceAllPageKeywords(workspaceId: string, entries: PageKeywordMap[]): void {
  const run = db.transaction(() => {
    stmts().deleteAll.run(workspaceId);
    stmts().deleteAllScoreHistory.run(workspaceId);
    const stmt = stmts().upsert;
    for (const entry of entries) {
      stmt.run(modelToParams(workspaceId, entry));
      maybeRecordScoreSnapshot(workspaceId, entry);
    }
  });
  run();
}

/** Delete a single page keyword entry. */
export function deletePageKeyword(workspaceId: string, pagePath: string): void {
  const run = db.transaction(() => {
    const normalized = normalizePath(pagePath);
    stmts().deleteOne.run(workspaceId, normalized);
    stmts().deleteScoreHistory.run(workspaceId, normalized);
  });
  run();
}

/** Delete all page keywords for a workspace. */
export function deleteAllPageKeywords(workspaceId: string): void {
  const run = db.transaction(() => {
    stmts().deleteAll.run(workspaceId);
    stmts().deleteAllScoreHistory.run(workspaceId);
  });
  run();
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
  return rows.map(row => rowToModel(row));
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
