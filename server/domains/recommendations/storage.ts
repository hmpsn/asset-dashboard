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
import { generationProvenanceSchema } from '../../schemas/generation-provenance.js';
import { Sentry, isSentryEnabled } from '../../sentry.js';
import type { GenerationProvenance } from '../../../shared/types/ai-execution.js';
import type { Recommendation, RecommendationSet, RecStatus } from '../../../shared/types/recommendations.js';

const backfillLog = createLogger('recommendation-backfill');

/**
 * Storage-layer logger. Exported so the loud empty-set log (a legacy blob-only workspace
 * that survives the R7 cutover with zero materialized rows) is observable/assertable.
 */
export const storageLog = createLogger('recommendation-storage');

interface RecSetRow {
  workspace_id: string;
  generated_at: string;
  generation_revision: number;
  generation_provenance: string | null;
  // Archive placeholder after the R7 blob→rows cutover: recommendation_items is the sole
  // store. saveRecommendationSet writes '[]' here; loadRecommendationSet never reads it.
  // Still selected by the boot-time backfill sweep (materializeAllRecommendationItems) until
  // the delayed column-drop migration retires it. See docs/rules/recommendation-storage.md.
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
    INSERT INTO recommendation_sets (workspace_id, generated_at, recommendations, summary, generation_revision)
    VALUES (@workspace_id, @generated_at, @recommendations, @summary, 1)
    ON CONFLICT(workspace_id) DO UPDATE SET
      generated_at = @generated_at,
      recommendations = @recommendations,
      summary = @summary,
      generation_revision = recommendation_sets.generation_revision + 1
  `),
  updateSetSummary: db.prepare(`
    UPDATE recommendation_sets
    SET generated_at = @generated_at,
        summary = @summary,
        generation_revision = generation_revision + 1
    WHERE workspace_id = @workspace_id
  `),
  claimExistingGeneration: db.prepare(`
    UPDATE recommendation_sets
    SET generation_revision = generation_revision + 1
    WHERE workspace_id = ? AND generation_revision = ?
  `),
  claimInitialGeneration: db.prepare(`
    INSERT INTO recommendation_sets (
      workspace_id, generated_at, recommendations, summary, generation_revision
    ) VALUES (?, ?, '[]', ?, 1)
    ON CONFLICT(workspace_id) DO NOTHING
  `),
  updateGeneratedSet: db.prepare(`
    UPDATE recommendation_sets
    SET generated_at = @generated_at,
        recommendations = @recommendations,
        summary = @summary,
        generation_provenance = @generation_provenance
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

/**
 * Parse a workspace's legacy `recommendation_sets.recommendations` blob into recs.
 *
 * NOT a read fallback after the R7 cutover — loadRecommendationSet reads rows only. This is
 * used exclusively by the boot-time backfill sweep (materializeAllRecommendationItems) to
 * seed recommendation_items from any still-populated legacy blob, and is retired when the
 * delayed column-drop migration removes the column.
 */
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

/**
 * Enforce the struck≠completed invariant at the single write choke point.
 *
 * recommendation_items is the row-authoritative store: the `status` COLUMN is derived on
 * write from the payload, and reads parse the payload ONLY (itemRowToRecommendation). A
 * struck rec must never read as "done". Migration 168 added a DB trigger pair that
 * RAISE(ABORT)s on lifecycle='struck' AND status='completed', and a one-time cleanup that
 * fixed only the COLUMN — NOT the payload JSON. So a legacy blob carrying
 * {lifecycle:'struck', status:'completed'} would still be served as completed AND would
 * ABORT the whole delete-then-reinsert (writeItems) transaction on the next regen/backfill.
 *
 * This is a coerce-and-continue safety net (NOT a throw — throwing would abort a whole regen
 * for one legacy row, the very failure we're preventing). Demote status to 'pending' for both
 * the column and the stringified payload so neither the trigger fires nor the stale value
 * survives. See migration 168 + migration 171 (the one-time payload cleanup for existing rows).
 */
function coerceStruckCompleted(rec: Recommendation): Recommendation {
  if (rec.lifecycle === 'struck' && rec.status === 'completed') {
    return { ...rec, status: 'pending' };
  }
  return rec;
}

function itemParams(workspaceId: string, rec: Recommendation, rankOrder: number) {
  const safeRec = coerceStruckCompleted(rec);
  return {
    workspace_id: workspaceId,
    id: safeRec.id,
    rank_order: rankOrder,
    type: safeRec.type,
    priority: safeRec.priority,
    status: safeRec.status,
    source: safeRec.source,
    impact: safeRec.impact,
    impact_score: safeRec.impactScore,
    client_status: safeRec.clientStatus ?? null,
    lifecycle: safeRec.lifecycle ?? null,
    target_keyword: safeRec.targetKeyword ?? null,
    created_at: safeRec.createdAt,
    updated_at: safeRec.updatedAt,
    payload: JSON.stringify(safeRec),
  };
}

function writeItems(workspaceId: string, recs: Recommendation[]): void {
  stmts().deleteItems.run(workspaceId);
  recs.forEach((rec, index) => {
    stmts().insertItem.run(itemParams(workspaceId, rec, index));
  });
}

// R7 cutover: the recommendations column is an archive placeholder. Always persist '[]' —
// recommendation_items is the sole store, and no read path consults the blob.
const ARCHIVED_BLOB = '[]';

function upsertSetRow(set: RecommendationSet): void {
  stmts().upsertSet.run({
    workspace_id: set.workspaceId,
    generated_at: set.generatedAt,
    recommendations: ARCHIVED_BLOB,
    summary: JSON.stringify(set.summary),
  });
}

function updateGeneratedSetRow(set: RecommendationSet, provenance: GenerationProvenance | null): void {
  const validatedProvenance = provenance ? generationProvenanceSchema.parse(provenance) : null;
  stmts().updateGeneratedSet.run({
    workspace_id: set.workspaceId,
    generated_at: set.generatedAt,
    recommendations: ARCHIVED_BLOB,
    summary: JSON.stringify(set.summary),
    generation_provenance: validatedProvenance ? JSON.stringify(validatedProvenance) : null,
  });
}

export class RecommendationGenerationRevisionConflictError extends Error {
  readonly workspaceId: string;
  readonly expectedRevision: number;

  constructor(workspaceId: string, expectedRevision: number) {
    super('Recommendations changed while generation was in flight');
    this.name = 'RecommendationGenerationRevisionConflictError';
    this.workspaceId = workspaceId;
    this.expectedRevision = expectedRevision;
  }
}

export interface RecommendationGenerationSnapshot {
  revision: number;
  set: RecommendationSet | null;
  provenance: GenerationProvenance | null;
}

export function loadRecommendationGenerationSnapshot(workspaceId: string): RecommendationGenerationSnapshot {
  const row = stmts().selectSet.get(workspaceId) as RecSetRow | undefined;
  return {
    revision: row?.generation_revision ?? 0,
    set: row ? loadRecommendationSet(workspaceId) : null,
    provenance: row?.generation_provenance
      ? parseJsonSafe(
          row.generation_provenance,
          generationProvenanceSchema,
          null,
          { table: 'recommendation_sets', field: 'generation_provenance', workspaceId },
        )
      : null,
  };
}

export function commitGeneratedRecommendationSet<T extends { set: RecommendationSet }>(
  workspaceId: string,
  expectedRevision: number,
  finalize: (current: RecommendationSet | null) => T,
  provenance: GenerationProvenance | null = null,
): T {
  const commit = db.transaction((): T => {
    const currentRow = stmts().selectSet.get(workspaceId) as RecSetRow | undefined;
    const currentRevision = currentRow?.generation_revision ?? 0;
    if (currentRevision !== expectedRevision) {
      throw new RecommendationGenerationRevisionConflictError(workspaceId, expectedRevision);
    }

    if (currentRow) {
      const claimed = stmts().claimExistingGeneration.run(workspaceId, expectedRevision).changes === 1;
      if (!claimed) throw new RecommendationGenerationRevisionConflictError(workspaceId, expectedRevision);
    } else {
      const emptySummary = JSON.stringify(emptySummaryFallback);
      const claimed = stmts().claimInitialGeneration.run(
        workspaceId,
        new Date().toISOString(),
        emptySummary,
      ).changes === 1;
      if (!claimed) throw new RecommendationGenerationRevisionConflictError(workspaceId, expectedRevision);
    }

    const result = finalize(currentRow ? loadRecommendationSet(workspaceId) : null);
    if (result.set.workspaceId !== workspaceId) {
      throw new Error('Generated recommendation set workspace mismatch');
    }
    updateGeneratedSetRow(result.set, provenance);
    writeItems(workspaceId, result.set.recommendations);
    return result;
  });
  return commit.immediate();
}

/**
 * Load a workspace's recommendation set from the normalized recommendation_items rows.
 *
 * R7 cutover: rows are the SOLE store. The legacy recommendations blob fallback is GONE.
 * A legacy blob-only workspace (metadata row present, a non-empty blob, but zero materialized
 * rows) now yields an EMPTY recommendations array plus a loud warn — the fallback is deleted,
 * so this is the visible signal of a would-be data loss. Per the verified A4 backfill sweep
 * (prod: rows==blob for all workspaces, zero drops; staging: rows populated) no such workspace
 * exists; the log makes any future regression loud rather than silent.
 */
export function loadRecommendationSet(workspaceId: string): RecommendationSet | null {
  const row = stmts().selectSet.get(workspaceId) as RecSetRow | undefined;
  if (!row) return null;

  const itemRows = stmts().listItems.all(workspaceId) as RecItemRow[];
  const recommendations = itemRows
    .map(itemRowToRecommendation)
    .filter((rec): rec is Recommendation => rec !== null);

  if (recommendations.length === 0 && row.recommendations && row.recommendations !== ARCHIVED_BLOB) {
    // A metadata row carrying a non-empty archive blob produced zero rows. Pre-cutover this
    // fell back to the blob; post-cutover it is empty. Loud so a missed-backfill regression
    // surfaces instead of silently dropping every rec for the workspace.
    const anomalyMsg = 'Recommendation set has a non-empty legacy blob but zero normalized rows — the blob fallback is retired (R7); returning empty. Investigate: this workspace was not backfilled.';
    storageLog.warn({ workspaceId, table: 'recommendation_sets' }, anomalyMsg);
    // A would-be data-loss anomaly on the destructive-migration path should be alertable, not
    // grep-only. captureMessage is a no-op when Sentry has no DSN (tests/dev), so this is safe.
    if (isSentryEnabled) {
      Sentry.captureMessage(anomalyMsg, {
        level: 'warning',
        tags: { workspaceId, area: 'recommendation-storage', anomaly: 'blob-only-zero-rows' },
      });
    }
  }

  return {
    workspaceId: row.workspace_id,
    generatedAt: row.generated_at,
    recommendations,
    summary: setRowToSummary(row, workspaceId),
  };
}

export function saveRecommendationSet(set: RecommendationSet): void {
  const run = db.transaction(() => {
    upsertSetRow(set);
    writeItems(set.workspaceId, set.recommendations);
  });
  run();
}

// R7 cutover: the per-workspace on-read lazy materializer (materializeRecommendationItems)
// is retired. Rows are the sole store — the boot-time backfill sweep
// (materializeAllRecommendationItems) is the ONLY remaining blob→rows path, and it runs once
// at startup before any reader. No read path lazily seeds rows from the blob anymore.

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
 * Per-item validation uses per-item `parseJsonSafeArray` semantics (`legacyRecommendations`):
 * the written set is exactly the VALID recs, and any malformed/unknown rec is recorded in
 * `dropped` with a reason (and a Pino warn) rather than dropping the whole set or being
 * silently discarded.
 *
 * Each workspace's write is wrapped in its own transaction and try/catch, so one bad
 * workspace never aborts the sweep. Post the R7 contract cutover, readers see ROWS ONLY:
 * a workspace that fails backfill yields an empty set + a loud `storageLog.warn` from
 * loadRecommendationSet (the blob fallback is GONE) — its blob is never served. This sweep
 * is therefore the sole remaining path that materializes rows from the legacy blob.
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
  // R7 cutover: rows are the sole store (boot backfill + dual-write keep them populated), so
  // the on-read lazy materialize is retired — read the row directly.
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
    // R7 cutover: rows are the sole store, so no lazy materialize is needed — load directly.
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
    // R7 cutover: rows are the sole store, so no lazy materialize is needed — load directly.
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
