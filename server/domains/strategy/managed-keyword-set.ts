// server/domains/strategy/managed-keyword-set.ts
//
// Strategy redesign (graft 1) — managed keyword working-set domain module.
//
// SOLE WRITER of the `strategy_keyword_set` table (migration 139). The set is the operator's
// curated working list of target keywords. It lives in its OWN table (NOT a column on
// tracked_keywords) precisely so it survives:
//   (a) a keyword-strategy regen — the reconciler below IS the regen step, grafted into
//       persistKeywordStrategy's writeKeywordStrategy transaction, and
//   (b) a rank-tracking sync — replaceAllTrackedKeywordRows deleteAll cannot touch a separate
//       table, so kept/active rows persist across every sync.
//
// A keyword is "in the managed set" iff it has a row with removed_at IS NULL.
//   - source 'regen_computed'  → seeded by the reconciler from strategy.siteKeywords.
//   - source 'client_request'  → promoted from a client keyword request.
//   - source 'manual_add'      → operator added by hand.
//   - kept_at set              → operator explicitly kept it (survives regen AND the
//                                 tracked-keywords clobber; the deprecation shield).
//   - removed_at set           → operator removed the slot (soft delete; excluded from
//                                 replenish; survives regen so a re-computed keyword stays out).
import db from '../../db/index.js';
import { createStmtCache } from '../../db/stmt-cache.js';
import { addActivity } from '../../activity-log.js';
import { createLogger } from '../../logger.js';
import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import type { KeywordStrategy } from '../../../shared/types/workspace.js';
import type {
  KeywordSetSource,
  StrategyKeywordSetRow,
} from '../../../shared/types/strategy-keyword-set.js';

const log = createLogger('managed-keyword-set');

interface StrategyKeywordSetDbRow {
  id: number;
  workspace_id: string;
  keyword: string;
  source: string;
  kept_at: string | null;
  removed_at: string | null;
  slot_order: number;
  created_at: string;
}

const VALID_SOURCES: ReadonlySet<string> = new Set<KeywordSetSource>([
  'regen_computed',
  'client_request',
  'manual_add',
]);

/** Map a DB row → the shared StrategyKeywordSetRow contract (snake_case → camelCase boundary).
 *  Three-state columns (kept_at / removed_at) preserve NULL as null. The CHECK constraint
 *  guarantees `source` is one of the union members; fall back to 'regen_computed' defensively
 *  so a corrupt row can never crash a read. */
function rowToManagedKeyword(row: StrategyKeywordSetDbRow): StrategyKeywordSetRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    keyword: row.keyword,
    source: VALID_SOURCES.has(row.source) ? (row.source as KeywordSetSource) : 'regen_computed',
    keptAt: row.kept_at ?? null,
    removedAt: row.removed_at ?? null,
    slotOrder: row.slot_order,
    createdAt: row.created_at,
  };
}

/** Normalize a keyword for storage: trimmed lowercase (matches the table comment + the
 *  UNIQUE(workspace_id, keyword) dedup contract). Empty after trim → empty string (callers guard). */
function normalizeForStorage(keyword: string): string {
  return keyword.trim().toLowerCase();
}

const stmts = createStmtCache(() => ({
  // Active rows (in the set), ordered by curation slot.
  listActive: db.prepare<[workspaceId: string]>(
    'SELECT * FROM strategy_keyword_set WHERE workspace_id = ? AND removed_at IS NULL ORDER BY slot_order ASC, id ASC',
  ),
  // ALL rows (active + soft-removed) — the reconciler diffs against the full set so a
  // re-computed keyword that the operator removed stays removed (not re-inserted).
  listAll: db.prepare<[workspaceId: string]>(
    'SELECT * FROM strategy_keyword_set WHERE workspace_id = ? ORDER BY slot_order ASC, id ASC',
  ),
  getByKeyword: db.prepare<[workspaceId: string, keyword: string]>(
    'SELECT * FROM strategy_keyword_set WHERE workspace_id = ? AND keyword = ?',
  ),
  maxSlot: db.prepare<[workspaceId: string]>(
    'SELECT COALESCE(MAX(slot_order), -1) AS maxSlot FROM strategy_keyword_set WHERE workspace_id = ?',
  ),
  insert: db.prepare(`
    INSERT INTO strategy_keyword_set (workspace_id, keyword, source, slot_order)
    VALUES (@workspace_id, @keyword, @source, @slot_order)
  `),
  setRemoved: db.prepare<[removedAt: string, workspaceId: string, keyword: string]>(
    'UPDATE strategy_keyword_set SET removed_at = ? WHERE workspace_id = ? AND keyword = ?',
  ),
  setKept: db.prepare<[keptAt: string, workspaceId: string, keyword: string]>(
    // Keeping a keyword also un-removes it (an operator who keeps a slot wants it active).
    'UPDATE strategy_keyword_set SET kept_at = ?, removed_at = NULL WHERE workspace_id = ?  AND keyword = ?',
  ),
  reactivate: db.prepare<[workspaceId: string, keyword: string]>(
    'UPDATE strategy_keyword_set SET removed_at = NULL WHERE workspace_id = ? AND keyword = ?',
  ),
}));

/** Active rows (removed_at IS NULL) for a workspace, ordered by slot_order. */
export function getStrategyKeywordSet(workspaceId: string): StrategyKeywordSetRow[] {
  const rows = stmts().listActive.all(workspaceId) as StrategyKeywordSetDbRow[];
  return rows.map(rowToManagedKeyword);
}

/** Build the ranked replenish pool from the freshly-computed strategy: every distinct
 *  opportunity keyword ranked by its strength signal (estimatedGain / opportunity_score),
 *  highest first. Drawn from contentGaps.opportunityScore (already a composite 0–100),
 *  keywordGaps (ranked by volume), and opportunitiesDetailed (volume). Net-new only is
 *  decided by the caller against the stored set. */
function buildReplenishPool(strategy: KeywordStrategy): string[] {
  const scored = new Map<string, { keyword: string; score: number }>();
  const consider = (keyword: string | undefined, score: number) => {
    if (!keyword || !keyword.trim()) return;
    const key = keywordComparisonKey(keyword);
    const existing = scored.get(key);
    if (!existing || score > existing.score) {
      scored.set(key, { keyword: normalizeForStorage(keyword), score });
    }
  };

  // contentGaps carry a composite opportunity score (0–100) — the strongest ranking signal.
  for (const gap of strategy.contentGaps ?? []) {
    consider(gap.targetKeyword, typeof gap.opportunityScore === 'number' ? gap.opportunityScore : (gap.volume ?? 0) / 100);
  }
  // keywordGaps: competitors rank, we don't — rank by volume.
  for (const gap of strategy.keywordGaps ?? []) {
    consider(gap.keyword, typeof gap.volume === 'number' ? gap.volume / 100 : 0);
  }
  // opportunitiesDetailed: typed parallel to bare `opportunities` — rank by volume.
  for (const opp of strategy.opportunitiesDetailed ?? []) {
    consider(opp.keyword, typeof opp.volume === 'number' ? opp.volume / 100 : 0);
  }
  // Bare opportunities string[] — lowest priority (no score signal), preserve order.
  let tieBreak = 0;
  for (const opp of strategy.opportunities ?? []) {
    consider(opp, -1 - tieBreak++);
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.keyword);
}

/**
 * The ONLY regen writer. PURE read-diff-insert — NO AI calls (it runs inside the caller's
 * persistKeywordStrategy transaction; an AI call there would break the txn guard + the
 * ai-call-before-db-write rule). Idempotent: safe to call repeatedly.
 *
 * Steps:
 *   1. SELECT the full stored set ONCE (active + soft-removed) → a Set of normalized keys.
 *   2. For each strategy.siteKeywords not present, INSERT as source:'regen_computed'.
 *      (A keyword the operator soft-removed stays removed — its key is in the set, so we skip it.)
 *   3. Auto-replenish: for every soft-removed row, fill ONE net-new slot from the ranked
 *      opportunity pool (estimatedGain / opportunity_score), skipping anything already in the set.
 *
 * MUST run inside the caller's db.transaction() — does NOT open its own.
 */
export function reconcileStrategyKeywordSet(workspaceId: string, strategy: KeywordStrategy): void {
  // (1) Single read of the full set (active + removed). The diff key is the normalized keyword,
  // so a soft-removed keyword is "present" and never re-inserted by regen.
  const allRows = stmts().listAll.all(workspaceId) as StrategyKeywordSetDbRow[];
  const presentKeys = new Set(allRows.map((row) => keywordComparisonKey(row.keyword)));
  const removedCount = allRows.filter((row) => row.removed_at != null).length;

  let nextSlot = (stmts().maxSlot.get(workspaceId) as { maxSlot: number }).maxSlot + 1;
  const insert = stmts().insert;
  let inserted = 0;
  let replenished = 0;

  // (2) Seed net-new computed keywords from siteKeywords.
  for (const raw of strategy.siteKeywords ?? []) {
    const normalized = normalizeForStorage(raw ?? '');
    if (!normalized) continue;
    const key = keywordComparisonKey(normalized);
    if (presentKeys.has(key)) continue; // already in the set (active OR soft-removed) — skip
    insert.run({ // txn-ok: caller (persistKeywordStrategy.writeKeywordStrategy) wraps this in db.transaction()
      workspace_id: workspaceId,
      keyword: normalized,
      source: 'regen_computed' satisfies KeywordSetSource,
      slot_order: nextSlot++,
    });
    presentKeys.add(key);
    inserted++;
  }

  // (3) Auto-replenish: one net-new opportunity per soft-removed slot, ranked by strength.
  if (removedCount > 0) {
    const pool = buildReplenishPool(strategy);
    let budget = removedCount;
    for (const candidate of pool) {
      if (budget <= 0) break;
      const key = keywordComparisonKey(candidate);
      if (presentKeys.has(key)) continue; // already in the set — not net-new
      insert.run({ // txn-ok: caller wraps this in db.transaction()
        workspace_id: workspaceId,
        keyword: candidate,
        source: 'regen_computed' satisfies KeywordSetSource,
        slot_order: nextSlot++,
      });
      presentKeys.add(key);
      replenished++;
      budget--;
    }
  }

  if (inserted > 0 || replenished > 0) {
    log.info({ workspaceId, inserted, replenished, removedCount }, 'Reconciled strategy keyword set');
  }
}

/** Operator add (or promote-from-client-request). Dedups before insert; logs activity.
 *  If the keyword already has a soft-removed row, re-activates it instead of inserting a
 *  duplicate (UNIQUE(workspace_id, keyword) would otherwise throw). Wrapped in db.transaction()
 *  (multi-step read-then-write + activity) — NOT called from the reconciler. */
export function addStrategyKeyword(
  workspaceId: string,
  keyword: string,
  source: 'client_request' | 'manual_add',
): StrategyKeywordSetRow {
  const normalized = normalizeForStorage(keyword);
  if (!normalized) {
    throw new Error('addStrategyKeyword: keyword is empty after normalization');
  }
  const run = db.transaction((): StrategyKeywordSetRow => {
    const existing = stmts().getByKeyword.get(workspaceId, normalized) as StrategyKeywordSetDbRow | undefined;
    if (existing) {
      // Re-activate a soft-removed row rather than violate the UNIQUE constraint.
      if (existing.removed_at != null) {
        stmts().reactivate.run(workspaceId, normalized);
      }
    } else {
      const nextSlot = (stmts().maxSlot.get(workspaceId) as { maxSlot: number }).maxSlot + 1;
      stmts().insert.run({
        workspace_id: workspaceId,
        keyword: normalized,
        source,
        slot_order: nextSlot,
      });
    }
    const row = stmts().getByKeyword.get(workspaceId, normalized) as StrategyKeywordSetDbRow;
    addActivity(
      workspaceId,
      'strategy_keyword_added',
      'Keyword added to strategy',
      `"${normalized}" added to the managed keyword set (${source === 'client_request' ? 'client request' : 'manual add'})`,
      { keyword: normalized, source },
    );
    return rowToManagedKeyword(row);
  });
  return run();
}

/** Operator remove — sets removed_at (NOT a hard delete, so it survives regen and the
 *  reconciler never re-inserts it). No-op if the keyword isn't present or is already removed.
 *  Logs activity. Wrapped in db.transaction() (multi-step) — NOT called from the reconciler. */
export function removeStrategyKeyword(workspaceId: string, keyword: string): void {
  const normalized = normalizeForStorage(keyword);
  if (!normalized) return;
  const run = db.transaction(() => {
    const existing = stmts().getByKeyword.get(workspaceId, normalized) as StrategyKeywordSetDbRow | undefined;
    if (!existing || existing.removed_at != null) return; // absent or already removed — no-op
    stmts().setRemoved.run(new Date().toISOString(), workspaceId, normalized);
    addActivity(
      workspaceId,
      'strategy_keyword_removed',
      'Keyword removed from strategy',
      `"${normalized}" removed from the managed keyword set`,
      { keyword: normalized },
    );
  });
  run();
}

/** Operator keep — stamps kept_at so the keyword survives regen AND the tracked-keywords
 *  clobber (the deprecation shield), and clears any removed_at. No-op if the keyword isn't
 *  present. Logs activity. Wrapped in db.transaction() — NOT called from the reconciler. */
export function keepStrategyKeyword(workspaceId: string, keyword: string): void {
  const normalized = normalizeForStorage(keyword);
  if (!normalized) return;
  const run = db.transaction(() => {
    const existing = stmts().getByKeyword.get(workspaceId, normalized) as StrategyKeywordSetDbRow | undefined;
    if (!existing) return; // absent — nothing to keep
    stmts().setKept.run(new Date().toISOString(), workspaceId, normalized);
    addActivity(
      workspaceId,
      'strategy_keyword_kept',
      'Keyword kept in strategy',
      `"${normalized}" explicitly kept — it now survives strategy regeneration`,
      { keyword: normalized },
    );
  });
  run();
}
