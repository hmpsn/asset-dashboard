/**
 * Recommendation storage
 *
 * Normalized persistence for RecommendationSet. The set row owns generated_at
 * and summary; recommendation_items owns addressable per-rec payloads.
 */
import db from '../../db/index.js';
import { parseJsonFallback, parseJsonSafe, parseJsonSafeArray } from '../../db/json-validation.js';
import { createStmtCache } from '../../db/stmt-cache.js';
import { createLogger } from '../../logger.js';
import { recommendationSchema, recommendationSummarySchema } from '../../schemas/workspace-schemas.js';
import type { Recommendation, RecommendationSet, RecStatus } from '../../../shared/types/recommendations.js';

const backfillLog = createLogger('recommendation-backfill');

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
  listSetWorkspaceIds: db.prepare(
    `SELECT workspace_id FROM recommendation_sets ORDER BY workspace_id ASC`,
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

/**
 * Result of a full blob → rows backfill sweep.
 * - `workspaces`: number of recommendation_sets rows visited (whether skipped or backfilled).
 * - `blobRecs`: total valid recs read from legacy blobs of workspaces that WERE backfilled
 *   (skipped/already-populated workspaces contribute nothing — their blob is never read).
 * - `rowsWritten`: total recommendation_items rows inserted across all backfilled workspaces.
 * - `dropped`: every rec that could not be materialized, with a reason (schema violation or
 *   a per-workspace transaction failure). Never silently discarded.
 */
export interface RecommendationBackfillResult {
  workspaces: number;
  blobRecs: number;
  rowsWritten: number;
  dropped: Array<{ workspaceId: string; recId: string; reason: string }>;
}

/** Best-effort id extraction for a raw (possibly malformed) blob rec, for drop reporting. */
function rawRecId(item: unknown): string {
  if (item && typeof item === 'object' && 'id' in item) {
    const id = (item as { id?: unknown }).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return '(unknown)';
}

/**
 * ADDITIVE backfill sweep (Reconcile R7-PR1): materialize every workspace's legacy
 * recommendation_sets.recommendations blob into normalized recommendation_items rows.
 *
 * Idempotent & mixed-prod-safe: any workspace whose recommendation_items table already
 * has rows is SKIPPED (count>0 guard) and its blob is NOT re-read — prod may already carry
 * post-158 regens that wrote rows, and those authoritative rows must never be clobbered.
 *
 * Per-item validation uses the same per-item semantics as the read path
 * (`legacyRecommendations` → `parseJsonSafeArray`): the written set is exactly the VALID
 * recs, and any malformed/unknown rec is recorded in `dropped` with a reason (and a Pino
 * warn) rather than dropping the whole set or being silently discarded.
 *
 * Each workspace's write is wrapped in its own transaction and try/catch, so one bad
 * workspace never aborts the sweep. Readers are unaffected: the items-win fallback in
 * loadRecommendationSet still serves a workspace that fails backfill from its blob.
 */
export function materializeAllRecommendationItems(): RecommendationBackfillResult {
  const rows = stmts().listSetWorkspaceIds.all() as Array<{ workspace_id: string }>;
  const result: RecommendationBackfillResult = {
    workspaces: 0,
    blobRecs: 0,
    rowsWritten: 0,
    dropped: [],
  };

  for (const { workspace_id: workspaceId } of rows) {
    result.workspaces += 1;

    // count>0 guard: authoritative rows already exist — skip WITHOUT reading the blob.
    const count = (stmts().countItems.get(workspaceId) as { cnt: number }).cnt;
    if (count > 0) continue;

    const setRow = stmts().selectSet.get(workspaceId) as RecSetRow | undefined;
    if (!setRow) continue;

    // Valid recs come from the same per-item read path the fallback uses. Then walk the
    // raw blob array to attribute each dropped item to a recId + reason.
    const validRecs = legacyRecommendations(setRow, workspaceId);
    const validIds = new Set(validRecs.map(rec => rec.id));

    // Unparseable blob → parseJsonFallback returns the [] fallback (legacyRecommendations
    // already logged the parse failure); a valid-JSON-non-array blob (e.g. '{}') fails the
    // Array.isArray guard and maps to "no recs to backfill" — never a throw.
    let rawItems: unknown[] = [];
    const parsed = parseJsonFallback<unknown>(setRow.recommendations, []);
    if (Array.isArray(parsed)) rawItems = parsed;

    for (const raw of rawItems) {
      const parsedItem = recommendationSchema.safeParse(raw);
      if (parsedItem.success && validIds.has(parsedItem.data.id)) continue;
      const recId = rawRecId(raw);
      const reason = parsedItem.success
        ? 'valid rec dropped by read-path validation'
        : parsedItem.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ') || 'schema validation failed';
      result.dropped.push({ workspaceId, recId, reason });
      backfillLog.warn({ workspaceId, recId, reason }, 'Dropped malformed recommendation during backfill');
    }

    if (validRecs.length === 0) continue;

    try {
      const run = db.transaction(() => {
        writeItems(workspaceId, validRecs);
      });
      run();
      result.blobRecs += validRecs.length;
      result.rowsWritten += validRecs.length;
      backfillLog.info(
        { workspaceId, blobRecs: validRecs.length, rowsWritten: validRecs.length, dropped: rawItems.length - validRecs.length },
        'Backfilled recommendation blob → rows for workspace',
      );
    } catch (err) {
      // One bad workspace must not abort the sweep. Record the failure and continue.
      for (const rec of validRecs) {
        result.dropped.push({
          workspaceId,
          recId: rec.id,
          reason: `backfill transaction failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      backfillLog.error({ workspaceId, err }, 'Recommendation backfill transaction failed for workspace');
    }
  }

  return result;
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
