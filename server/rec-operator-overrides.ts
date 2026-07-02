/**
 * rec-operator-overrides — CRUD for the rec_operator_override table (The Issue, operator-steering).
 *
 * Per-rec operator overrides that survive the weekly regen: `title`/`insight` correct a rec's
 * wording, `sort_order` sets the client-facing running order. One row per (workspace, rec_id),
 * keyed on rec_id (NOT the merge key) because applyLifecycleCarryOver copies the rec id old→new
 * across regen, so a rec_id-keyed override follows the rec automatically (id-continuity).
 *
 * TRUST-CRITICAL — overrides apply ONLY at display boundaries (the admin GET serialization + the
 * public client projection). They are NEVER baked into the recommendation_items rows, so
 * loadRecommendations stays PURE and clearing an override restores the source wording.
 *
 * See: server/db/migrations/145-rec-operator-override.sql
 * Template: server/cannibalization-keeper-override.ts (createStmtCache CRUD) +
 * server/strategy-autosend-store.ts (typed error + db.transaction()).
 */
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import {
  REC_WORDING_TITLE_MAX,
  REC_WORDING_INSIGHT_MAX,
  type RecWordingOverridePayload,
} from '../shared/types/rec-operator-steering.js';
import type { Recommendation } from '../shared/types/recommendations.js';

interface OverrideRow {
  workspace_id: string;
  rec_id: string;
  title: string | null;
  insight: string | null;
  sort_order: number | null;
  updated_at: string;
}

const stmts = createStmtCache(() => ({
  listForWorkspace: db.prepare<[workspace_id: string]>(
    `SELECT rec_id, title, insight, sort_order FROM rec_operator_override
     WHERE workspace_id = ?`,
  ),
  get: db.prepare<[workspace_id: string, rec_id: string]>(
    `SELECT rec_id, title, insight, sort_order FROM rec_operator_override
     WHERE workspace_id = ? AND rec_id = ?`,
  ),
  upsert: db.prepare(`
    INSERT INTO rec_operator_override
      (workspace_id, rec_id, title, insight, sort_order, updated_at)
    VALUES
      (@workspace_id, @rec_id, @title, @insight, @sort_order, @updated_at)
    ON CONFLICT(workspace_id, rec_id) DO UPDATE SET
      title      = excluded.title,
      insight    = excluded.insight,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `),
  del: db.prepare<[workspace_id: string, rec_id: string]>(
    `DELETE FROM rec_operator_override
     WHERE workspace_id = ? AND rec_id = ?`,
  ),
  // Clear sort_order on every workspace row, deleting any row left all-NULL (used by setSortOrders
  // so a removed rec's stale order is dropped before the new order is applied).
  clearAllSortOrders: db.prepare(
    // Only rows that actually HAVE a sort_order — so wording-only rows excluded from the new order
    // don't get a spurious updated_at bump.
    `UPDATE rec_operator_override SET sort_order = NULL, updated_at = @updated_at
     WHERE workspace_id = @workspace_id AND sort_order IS NOT NULL`,
  ),
  deleteEmptyRows: db.prepare<[workspace_id: string]>(
    `DELETE FROM rec_operator_override
     WHERE workspace_id = ? AND title IS NULL AND insight IS NULL AND sort_order IS NULL`,
  ),
}));

/** Thrown by setWordingOverride when a wording field exceeds its cap. The route maps it to a 400. */
export class RecWordingOverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecWordingOverrideError';
  }
}

/** The two override maps for a workspace — wording (title/insight) + sort order, both rec_id-keyed. */
export interface OperatorOverrides {
  wording: Map<string, { title?: string; insight?: string }>;
  sortOrder: Map<string, number>;
}

/**
 * Read all operator overrides for a workspace. A row contributes to `wording` when title OR insight
 * is non-null, and to `sortOrder` when sort_order is non-null. Always workspace-scoped.
 */
export function getOperatorOverrides(workspaceId: string): OperatorOverrides {
  const rows = stmts().listForWorkspace.all(workspaceId) as Array<
    Pick<OverrideRow, 'rec_id' | 'title' | 'insight' | 'sort_order'>
  >;
  const wording = new Map<string, { title?: string; insight?: string }>();
  const sortOrder = new Map<string, number>();
  for (const row of rows) {
    if (row.title !== null || row.insight !== null) {
      const entry: { title?: string; insight?: string } = {};
      if (row.title !== null) entry.title = row.title;
      if (row.insight !== null) entry.insight = row.insight;
      wording.set(row.rec_id, entry);
    }
    if (row.sort_order !== null) sortOrder.set(row.rec_id, row.sort_order);
  }
  return { wording, sortOrder };
}

/** The sort-order map alone (used by the public projection ordering). Always workspace-scoped. */
export function getSortOrderMap(workspaceId: string): Map<string, number> {
  return getOperatorOverrides(workspaceId).sortOrder;
}

/**
 * Upsert a wording override for a rec. MERGE semantics — title and insight are independent overrides
 * (the inline editor commits each field separately on blur), so each PATCH updates ONLY the fields it
 * carries:
 *   - a field ABSENT from the payload (undefined) → leave the existing override for that field unchanged
 *   - a field PRESENT and non-blank → set it (capped)
 *   - a field PRESENT but blank/whitespace ('') → clear that field to NULL (restores its source wording)
 * So PATCH `{ title: 'T2' }` on a row holding `{title:'T', insight:'I'}` → `{title:'T2', insight:'I'}`
 * (the insight override is preserved); PATCH `{ title: '' }` clears ONLY the title. This matters for
 * regen correctness: editing the title must never freeze a stale copy of the source insight as an
 * override that would later mask a freshly-regenerated insight. Caps are enforced — over-cap throws
 * RecWordingOverrideError (the route maps it to a 400). The existing sort_order is always preserved
 * (wording edits never touch the running order). If after the write the row is all-NULL (title NULL
 * AND insight NULL AND sort_order NULL), the row is deleted so a fully-cleared override leaves no
 * orphan. Always workspace-scoped.
 */
export function setWordingOverride(
  workspaceId: string,
  recId: string,
  payload: RecWordingOverridePayload,
): void {
  // Read the existing row so an ABSENT field is preserved (merge, not full-replace).
  const existing = stmts().get.get(workspaceId, recId) as
    | Pick<OverrideRow, 'title' | 'insight' | 'sort_order'>
    | undefined;

  // Per field: undefined → keep existing; present → non-blank value or NULL (clear).
  const title =
    payload.title === undefined
      ? existing?.title ?? null
      : payload.title.trim()
        ? payload.title
        : null;
  const insight =
    payload.insight === undefined
      ? existing?.insight ?? null
      : payload.insight.trim()
        ? payload.insight
        : null;

  if (title !== null && title.length > REC_WORDING_TITLE_MAX) {
    throw new RecWordingOverrideError(`title: must be ${REC_WORDING_TITLE_MAX} characters or fewer`);
  }
  if (insight !== null && insight.length > REC_WORDING_INSIGHT_MAX) {
    throw new RecWordingOverrideError(`insight: must be ${REC_WORDING_INSIGHT_MAX} characters or fewer`);
  }

  // Preserve any existing sort_order on the row (wording edits never touch the running order).
  const sortOrder = existing?.sort_order ?? null;

  if (title === null && insight === null && sortOrder === null) {
    // Nothing left to store — drop the row so a fully-cleared override leaves no orphan.
    stmts().del.run(workspaceId, recId);
    return;
  }

  stmts().upsert.run({
    workspace_id: workspaceId,
    rec_id: recId,
    title,
    insight,
    sort_order: sortOrder,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Persist the client-facing running order. In a single db.transaction(): clear sort_order on ALL the
 * workspace's rows (deleting any row left all-NULL so a removed rec's stale order is dropped), then
 * upsert sort_order = 0..n-1 for the listed recIds (preserving any title/insight already on the row).
 * Always workspace-scoped.
 */
export function setSortOrders(workspaceId: string, orderedRecIds: string[]): void {
  const now = new Date().toISOString();
  const apply = db.transaction(() => {
    // 1. Drop every existing sort_order, then delete rows that became all-NULL (no wording left).
    stmts().clearAllSortOrders.run({ workspace_id: workspaceId, updated_at: now });
    stmts().deleteEmptyRows.run(workspaceId);
    // 2. Assign 0..n-1 to the listed recIds, preserving any title/insight on the row.
    for (let i = 0; i < orderedRecIds.length; i++) {
      const recId = orderedRecIds[i];
      const existing = stmts().get.get(workspaceId, recId) as
        | Pick<OverrideRow, 'title' | 'insight'>
        | undefined;
      stmts().upsert.run({
        workspace_id: workspaceId,
        rec_id: recId,
        title: existing?.title ?? null,
        insight: existing?.insight ?? null,
        sort_order: i,
        updated_at: now,
      });
    }
  });
  apply();
}

/**
 * Apply wording overrides to a rec list for DISPLAY ONLY. Returns SHALLOW CLONES (each rec spread)
 * with title/insight overridden where present — NEVER mutates the input array or its rec objects
 * (loadRecommendations returns cached-parsed objects; baking an override into them would corrupt the
 * pure base blob). When the workspace has no wording overrides, returns a new array of the same recs.
 * Always workspace-scoped.
 */
export function applyWordingOverrides(
  workspaceId: string,
  recs: Recommendation[],
): Recommendation[] {
  const { wording } = getOperatorOverrides(workspaceId);
  if (wording.size === 0) return recs.slice();
  return recs.map((rec) => {
    const override = wording.get(rec.id);
    if (!override) return rec;
    const clone = { ...rec };
    if (override.title !== undefined) clone.title = override.title;
    if (override.insight !== undefined) clone.insight = override.insight;
    return clone;
  });
}
