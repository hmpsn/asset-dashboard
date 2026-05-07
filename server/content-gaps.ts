/**
 * content-gaps — CRUD for the content_gaps table.
 *
 * Replaces the keywordStrategy.contentGaps[] JSON array with indexed SQLite rows.
 * Each row = one strategy-level content gap (a topic + target keyword the workspace
 * should create content for) for a workspace.
 *
 * NOTE: distinct from the per-page `content_gaps` column on the page_keywords
 * table (PageKeywordMap.contentGaps), which stores per-page AI-keyword-analysis
 * gap topics as a string[]. This module owns the strategy-level ContentGap[].
 */
import { z } from 'zod';
import db from './db/index.js';
import type { ContentGap } from '../shared/types/workspace.ts';
import { createLogger } from './logger.js';
import { parseJsonSafeArray, parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';

const log = createLogger('content-gaps');

// ── Row <-> Model mapping ──

interface ContentGapRow {
  workspace_id: string;
  target_keyword: string;
  topic: string;
  intent: string;
  priority: string;
  rationale: string;
  suggested_page_type: string | null;
  volume: number | null;
  difficulty: number | null;
  trend_direction: string | null;
  serp_features: string | null;
  impressions: number | null;
  competitor_proof: string | null;
  question_keywords: string | null;
  serp_targeting: string | null;
  opportunity_score: number | null;
}

const intentValues: ContentGap['intent'][] = ['informational', 'commercial', 'transactional', 'navigational'];
const priorityValues: ContentGap['priority'][] = ['high', 'medium', 'low'];
const pageTypeValues: NonNullable<ContentGap['suggestedPageType']>[] = ['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource'];
const trendValues: NonNullable<ContentGap['trendDirection']>[] = ['rising', 'declining', 'stable'];

function rowToModel(r: ContentGapRow): ContentGap {
  const m: ContentGap = {
    topic: r.topic,
    targetKeyword: r.target_keyword,
    intent: (intentValues as readonly string[]).includes(r.intent) ? (r.intent as ContentGap['intent']) : 'informational',
    priority: (priorityValues as readonly string[]).includes(r.priority) ? (r.priority as ContentGap['priority']) : 'medium',
    rationale: r.rationale,
  };
  if (r.suggested_page_type && (pageTypeValues as readonly string[]).includes(r.suggested_page_type)) {
    m.suggestedPageType = r.suggested_page_type as NonNullable<ContentGap['suggestedPageType']>;
  }
  if (r.volume != null) m.volume = r.volume;
  if (r.difficulty != null) m.difficulty = r.difficulty;
  if (r.trend_direction && (trendValues as readonly string[]).includes(r.trend_direction)) {
    m.trendDirection = r.trend_direction as NonNullable<ContentGap['trendDirection']>;
  }
  if (r.serp_features) m.serpFeatures = parseJsonSafeArray(r.serp_features, z.string(), { table: 'content_gaps', field: 'serp_features' });
  if (r.impressions != null) m.impressions = r.impressions;
  if (r.competitor_proof) m.competitorProof = r.competitor_proof;
  if (r.question_keywords) m.questionKeywords = parseJsonSafeArray(r.question_keywords, z.string(), { table: 'content_gaps', field: 'question_keywords' });
  if (r.serp_targeting) m.serpTargeting = parseJsonSafeArray(r.serp_targeting, z.string(), { table: 'content_gaps', field: 'serp_targeting' });
  if (r.opportunity_score != null) m.opportunityScore = r.opportunity_score;
  return m;
}

function modelToParams(workspaceId: string, m: ContentGap) {
  return {
    workspace_id: workspaceId,
    target_keyword: m.targetKeyword,
    topic: m.topic,
    intent: m.intent,
    priority: m.priority,
    rationale: m.rationale,
    suggested_page_type: m.suggestedPageType ?? null,
    volume: m.volume ?? null,
    difficulty: m.difficulty ?? null,
    trend_direction: m.trendDirection ?? null,
    serp_features: m.serpFeatures ? JSON.stringify(m.serpFeatures) : null,
    impressions: m.impressions ?? null,
    competitor_proof: m.competitorProof ?? null,
    question_keywords: m.questionKeywords ? JSON.stringify(m.questionKeywords) : null,
    serp_targeting: m.serpTargeting ? JSON.stringify(m.serpTargeting) : null,
    opportunity_score: m.opportunityScore ?? null,
  };
}

// ── Lazy prepared statements ──

const stmts = createStmtCache(() => ({
  listByWs: db.prepare<[workspaceId: string]>(
    'SELECT * FROM content_gaps WHERE workspace_id = ? ORDER BY opportunity_score DESC NULLS LAST, target_keyword ASC',
  ),
  getOne: db.prepare<[workspaceId: string, targetKeyword: string]>(
    'SELECT * FROM content_gaps WHERE workspace_id = ? AND target_keyword = ?',
  ),
  upsert: db.prepare(`
    INSERT INTO content_gaps (
      workspace_id, target_keyword, topic, intent, priority, rationale,
      suggested_page_type, volume, difficulty, trend_direction, serp_features,
      impressions, competitor_proof, question_keywords, serp_targeting, opportunity_score
    ) VALUES (
      @workspace_id, @target_keyword, @topic, @intent, @priority, @rationale,
      @suggested_page_type, @volume, @difficulty, @trend_direction, @serp_features,
      @impressions, @competitor_proof, @question_keywords, @serp_targeting, @opportunity_score
    )
    ON CONFLICT(workspace_id, target_keyword) DO UPDATE SET
      topic = excluded.topic,
      intent = excluded.intent,
      priority = excluded.priority,
      rationale = excluded.rationale,
      suggested_page_type = excluded.suggested_page_type,
      volume = excluded.volume,
      difficulty = excluded.difficulty,
      trend_direction = excluded.trend_direction,
      serp_features = excluded.serp_features,
      impressions = excluded.impressions,
      competitor_proof = excluded.competitor_proof,
      question_keywords = excluded.question_keywords,
      serp_targeting = excluded.serp_targeting,
      opportunity_score = excluded.opportunity_score
  `),
  deleteOne: db.prepare<[workspaceId: string, targetKeyword: string]>(
    'DELETE FROM content_gaps WHERE workspace_id = ? AND target_keyword = ?',
  ),
  deleteAll: db.prepare<[workspaceId: string]>(
    'DELETE FROM content_gaps WHERE workspace_id = ?',
  ),
  countByWs: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) as cnt FROM content_gaps WHERE workspace_id = ?',
  ),
}));

// ── Public API ──

/** Get all content gaps for a workspace (sorted by opportunityScore desc, then targetKeyword asc). */
export function listContentGaps(workspaceId: string): ContentGap[] {
  const rows = stmts().listByWs.all(workspaceId) as ContentGapRow[];
  return rows.map(rowToModel);
}

/** Get a single content gap by target keyword. */
export function getContentGap(workspaceId: string, targetKeyword: string): ContentGap | undefined {
  const row = stmts().getOne.get(workspaceId, targetKeyword) as ContentGapRow | undefined;
  return row ? rowToModel(row) : undefined;
}

/** Upsert a single content gap entry. */
export function upsertContentGap(workspaceId: string, gap: ContentGap): void {
  stmts().upsert.run(modelToParams(workspaceId, gap));
}

/** Upsert multiple content gap entries in a single transaction. */
export function upsertContentGapsBatch(workspaceId: string, gaps: ContentGap[]): void {
  const run = db.transaction(() => {
    const stmt = stmts().upsert;
    for (const gap of gaps) {
      stmt.run(modelToParams(workspaceId, gap));
    }
  });
  run();
}

/** Replace all content gaps for a workspace (delete + insert in transaction).
 *  Deduplicates by targetKeyword — if the input contains duplicates, the last
 *  occurrence wins (mirrors the ON CONFLICT DO UPDATE behaviour). */
export function replaceAllContentGaps(workspaceId: string, gaps: ContentGap[]): void {
  const run = db.transaction(() => {
    stmts().deleteAll.run(workspaceId);
    const stmt = stmts().upsert;
    for (const gap of gaps) {
      stmt.run(modelToParams(workspaceId, gap));
    }
  });
  run();
}

/** Delete a single content gap entry. */
export function deleteContentGap(workspaceId: string, targetKeyword: string): void {
  stmts().deleteOne.run(workspaceId, targetKeyword);
}

/** Delete all content gaps for a workspace. */
export function deleteAllContentGaps(workspaceId: string): void {
  stmts().deleteAll.run(workspaceId);
}

/** Count total content gaps for a workspace. */
export function countContentGaps(workspaceId: string): number {
  return (stmts().countByWs.get(workspaceId) as { cnt: number }).cnt;
}

/**
 * Migrate keywordStrategy.contentGaps from the workspace JSON blob into the
 * content_gaps table. Idempotent — skips workspaces that already have rows.
 *
 * After insert, strips contentGaps from the JSON blob so the table becomes the
 * single source of truth.
 */
export function migrateFromJsonBlob(): void {
  const rows = db.prepare(`
    SELECT id, keyword_strategy FROM workspaces
    WHERE keyword_strategy IS NOT NULL AND keyword_strategy != ''
  `).all() as { id: string; keyword_strategy: string }[];

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (countContentGaps(row.id) > 0) {
      skipped++;
      continue;
    }

    try {
      const strategy = parseJsonFallback<Record<string, unknown> | null>(row.keyword_strategy, null);
      if (!strategy) continue;
      const gaps = strategy.contentGaps;
      if (!Array.isArray(gaps) || gaps.length === 0) continue;

      replaceAllContentGaps(row.id, gaps as ContentGap[]);

      delete strategy.contentGaps;
      db.prepare('UPDATE workspaces SET keyword_strategy = ? WHERE id = ?')
        .run(JSON.stringify(strategy), row.id);

      migrated++;
      log.info({ workspaceId: row.id, gaps: gaps.length }, 'Migrated contentGaps to content_gaps table');
    } catch (err) {
      log.error({ err, workspaceId: row.id }, 'Failed to migrate contentGaps');
    }
  }

  if (migrated > 0 || skipped > 0) {
    log.info({ migrated, skipped }, 'contentGaps migration complete');
  }
}
