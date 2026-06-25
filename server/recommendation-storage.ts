/**
 * recommendation-storage
 *
 * Normalized persistence for RecommendationSet. The set row owns generated_at
 * and summary; recommendation_items owns addressable per-rec payloads.
 */
import db from './db/index.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import { recommendationSchema, recommendationSummarySchema } from './schemas/workspace-schemas.js';
import type { Recommendation, RecommendationSet, RecStatus } from '../shared/types/recommendations.js';

interface RecSetRow {
  workspace_id: string;
  generated_at: string;
  recommendations: string;
  summary: string;
}

interface RecItemRow {
  workspace_id: string;
  id: string;
  rank_order: number;
  type: string;
  priority: string;
  status: string;
  source: string;
  impact: string;
  impact_score: number;
  client_status: string | null;
  lifecycle: string | null;
  target_keyword: string | null;
  created_at: string;
  updated_at: string;
  payload: string;
}

const emptySummaryFallback: RecommendationSet['summary'] = {
  fixNow: 0,
  fixSoon: 0,
  fixLater: 0,
  ongoing: 0,
  totalImpactScore: 0,
  trafficAtRisk: 0,
  totalOpportunityValue: 0,
  actionableOpportunityValue: 0,
  topRecommendationId: null,
};

const stmts = createStmtCache(() => ({
  selectSet: db.prepare<[workspaceId: string]>(
    `SELECT * FROM recommendation_sets WHERE workspace_id = ?`,
  ),
  upsertSet: db.prepare(`
    INSERT INTO recommendation_sets (workspace_id, generated_at, recommendations, summary)
    VALUES (@workspace_id, @generated_at, @recommendations, @summary)
    ON CONFLICT(workspace_id) DO UPDATE SET
      generated_at = @generated_at,
      recommendations = @recommendations,
      summary = @summary
  `),
  updateSetSummary: db.prepare(`
    UPDATE recommendation_sets
    SET generated_at = @generated_at, summary = @summary
    WHERE workspace_id = @workspace_id
  `),
  listItems: db.prepare<[workspaceId: string]>(
    `SELECT * FROM recommendation_items
     WHERE workspace_id = ?
     ORDER BY rank_order ASC, id ASC`,
  ),
  countItems: db.prepare<[workspaceId: string]>(
    `SELECT COUNT(*) as cnt FROM recommendation_items WHERE workspace_id = ?`,
  ),
  getItem: db.prepare<[workspaceId: string, id: string]>(
    `SELECT * FROM recommendation_items WHERE workspace_id = ? AND id = ?`,
  ),
  deleteItems: db.prepare<[workspaceId: string]>(
    `DELETE FROM recommendation_items WHERE workspace_id = ?`,
  ),
  insertItem: db.prepare(`
    INSERT INTO recommendation_items (
      workspace_id, id, rank_order, type, priority, status, source, impact,
      impact_score, client_status, lifecycle, target_keyword, created_at,
      updated_at, payload
    ) VALUES (
      @workspace_id, @id, @rank_order, @type, @priority, @status, @source,
      @impact, @impact_score, @client_status, @lifecycle, @target_keyword,
      @created_at, @updated_at, @payload
    )
  `),
  upsertItem: db.prepare(`
    INSERT INTO recommendation_items (
      workspace_id, id, rank_order, type, priority, status, source, impact,
      impact_score, client_status, lifecycle, target_keyword, created_at,
      updated_at, payload
    ) VALUES (
      @workspace_id, @id, @rank_order, @type, @priority, @status, @source,
      @impact, @impact_score, @client_status, @lifecycle, @target_keyword,
      @created_at, @updated_at, @payload
    )
    ON CONFLICT(workspace_id, id) DO UPDATE SET
      rank_order = excluded.rank_order,
      type = excluded.type,
      priority = excluded.priority,
      status = excluded.status,
      source = excluded.source,
      impact = excluded.impact,
      impact_score = excluded.impact_score,
      client_status = excluded.client_status,
      lifecycle = excluded.lifecycle,
      target_keyword = excluded.target_keyword,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      payload = excluded.payload
  `),
}));

function setRowToSummary(row: RecSetRow, workspaceId: string): RecommendationSet['summary'] {
  return parseJsonSafe(
    row.summary,
    recommendationSummarySchema,
    emptySummaryFallback,
    { table: 'recommendation_sets', field: 'summary', workspaceId },
  ) as RecommendationSet['summary'];
}

function legacyRecommendations(row: RecSetRow, workspaceId: string): Recommendation[] {
  return parseJsonSafeArray(
    row.recommendations,
    recommendationSchema,
    { table: 'recommendation_sets', field: 'recommendations', workspaceId },
  ) as Recommendation[];
}

function itemRowToRecommendation(row: RecItemRow): Recommendation | null {
  const parsed = parseJsonSafe(
    row.payload,
    recommendationSchema,
    null,
    { table: 'recommendation_items', field: 'payload', workspaceId: row.workspace_id },
  ) as Recommendation | null;
  if (!parsed) return null;
  return parsed;
}

function itemParams(workspaceId: string, rec: Recommendation, rankOrder: number) {
  return {
    workspace_id: workspaceId,
    id: rec.id,
    rank_order: rankOrder,
    type: rec.type,
    priority: rec.priority,
    status: rec.status,
    source: rec.source,
    impact: rec.impact,
    impact_score: rec.impactScore,
    client_status: rec.clientStatus ?? null,
    lifecycle: rec.lifecycle ?? null,
    target_keyword: rec.targetKeyword ?? null,
    created_at: rec.createdAt,
    updated_at: rec.updatedAt,
    payload: JSON.stringify(rec),
  };
}

function writeItems(workspaceId: string, recs: Recommendation[]): void {
  stmts().deleteItems.run(workspaceId);
  recs.forEach((rec, index) => {
    stmts().insertItem.run(itemParams(workspaceId, rec, index));
  });
}

function upsertSetRow(set: RecommendationSet, recommendationsJson: string): void {
  stmts().upsertSet.run({
    workspace_id: set.workspaceId,
    generated_at: set.generatedAt,
    recommendations: recommendationsJson,
    summary: JSON.stringify(set.summary),
  });
}

export function loadRecommendationSet(workspaceId: string): RecommendationSet | null {
  const row = stmts().selectSet.get(workspaceId) as RecSetRow | undefined;
  if (!row) return null;

  const itemRows = stmts().listItems.all(workspaceId) as RecItemRow[];
  const recommendations = itemRows.length > 0
    ? itemRows
      .map(itemRowToRecommendation)
      .filter((rec): rec is Recommendation => rec !== null)
    : legacyRecommendations(row, workspaceId);

  return {
    workspaceId: row.workspace_id,
    generatedAt: row.generated_at,
    recommendations,
    summary: setRowToSummary(row, workspaceId),
  };
}

export function saveRecommendationSet(set: RecommendationSet): void {
  const run = db.transaction(() => {
    upsertSetRow(set, JSON.stringify(set.recommendations));
    writeItems(set.workspaceId, set.recommendations);
  });
  run();
}

export function materializeRecommendationItems(workspaceId: string): RecommendationSet | null {
  const row = stmts().selectSet.get(workspaceId) as RecSetRow | undefined;
  if (!row) return null;
  const count = (stmts().countItems.get(workspaceId) as { cnt: number }).cnt;
  const recs = legacyRecommendations(row, workspaceId);
  const set: RecommendationSet = {
    workspaceId: row.workspace_id,
    generatedAt: row.generated_at,
    recommendations: recs,
    summary: setRowToSummary(row, workspaceId),
  };
  if (count > 0 || recs.length === 0) return set;
  const run = db.transaction(() => {
    writeItems(workspaceId, recs);
  });
  run();
  return set;
}

export function replaceRecommendationItems(
  set: RecommendationSet,
  recommendations: Recommendation[],
  summary: RecommendationSet['summary'],
): void {
  const run = db.transaction(() => {
    stmts().updateSetSummary.run({
      workspace_id: set.workspaceId,
      generated_at: set.generatedAt,
      summary: JSON.stringify(summary),
    });
    writeItems(set.workspaceId, recommendations);
  });
  run();
}

export function updateRecommendationItem(
  workspaceId: string,
  recId: string,
  updatedRec: Recommendation,
  allRecommendations: Recommendation[],
  summary: RecommendationSet['summary'],
  generatedAt: string,
): void {
  const run = db.transaction(() => {
    stmts().updateSetSummary.run({
      workspace_id: workspaceId,
      generated_at: generatedAt,
      summary: JSON.stringify(summary),
    });
    const rankOrder = allRecommendations.findIndex(rec => rec.id === recId);
    stmts().upsertItem.run(itemParams(workspaceId, updatedRec, rankOrder < 0 ? allRecommendations.length : rankOrder));
  });
  run();
}

export function loadRecommendationItem(workspaceId: string, recId: string): Recommendation | null {
  materializeRecommendationItems(workspaceId);
  const row = stmts().getItem.get(workspaceId, recId) as RecItemRow | undefined;
  return row ? itemRowToRecommendation(row) : null;
}

export function setRecommendationItemStatus(
  workspaceId: string,
  recId: string,
  status: RecStatus,
  computeSummary: (recs: Recommendation[]) => RecommendationSet['summary'],
  validateStatusTransition?: (current: RecStatus, next: RecStatus) => void,
): Recommendation | null {
  const run = db.transaction((): Recommendation | null => {
    const materialized = materializeRecommendationItems(workspaceId);
    if (!materialized) return null;

    const set = loadRecommendationSet(workspaceId);
    if (!set) return null;
    const rec = set.recommendations.find(r => r.id === recId);
    if (!rec) return null;

    if (rec.status !== status) {
      validateStatusTransition?.(rec.status, status);
    }
    rec.status = status;
    rec.updatedAt = new Date().toISOString();
    const summary = computeSummary(set.recommendations);
    updateRecommendationItem(workspaceId, recId, rec, set.recommendations, summary, set.generatedAt);
    return rec;
  });
  return run();
}

export function mutateRecommendationItem(
  workspaceId: string,
  recId: string,
  apply: (rec: Recommendation) => void,
  computeSummary: (recs: Recommendation[]) => RecommendationSet['summary'],
): Recommendation | null {
  const run = db.transaction((): Recommendation | null => {
    materializeRecommendationItems(workspaceId);
    const set = loadRecommendationSet(workspaceId);
    if (!set) return null;
    const rec = set.recommendations.find(r => r.id === recId);
    if (!rec) return null;
    apply(rec);
    rec.updatedAt = new Date().toISOString();
    const summary = computeSummary(set.recommendations);
    updateRecommendationItem(workspaceId, recId, rec, set.recommendations, summary, set.generatedAt);
    return rec;
  });
  return run();
}
