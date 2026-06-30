import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe } from './db/json-validation.js';
import { strategyPovSchema } from './schemas/strategy-pov-schemas.js';
import type { StrategyPov } from '../shared/types/strategy-pov.js';

/**
 * The Issue (Lane B) — strategy POV store. One row per workspace, upserted on regenerate.
 * Mirrors server/meeting-brief-store.ts: lazy prepared statements via createStmtCache, JSON
 * column parsed at the read boundary via parseJsonSafe, ON CONFLICT upsert.
 *
 * The stored `pov_json` is the resolved StrategyPov (operator override ∪ AI draft). `prompt_hash`
 * busts the cache when any signal changes; `version` bumps on every operator edit.
 */

interface PovRow {
  workspace_id: string;
  pov_json: string;
  prompt_hash: string | null;
  version: number;
  generated_at: string | null;
  edited_at: string | null;
}

const stmts = createStmtCache(() => ({
  get: db.prepare(
    `SELECT * FROM strategy_pov WHERE workspace_id = ?`,
  ),
  getHash: db.prepare(
    `SELECT prompt_hash FROM strategy_pov WHERE workspace_id = ?`,
  ),
  getVersion: db.prepare(
    `SELECT version FROM strategy_pov WHERE workspace_id = ?`,
  ),
  upsert: db.prepare(`
    INSERT INTO strategy_pov
      (workspace_id, pov_json, prompt_hash, version, generated_at, edited_at)
    VALUES
      (@workspace_id, @pov_json, @prompt_hash, @version, @generated_at, @edited_at)
    ON CONFLICT(workspace_id) DO UPDATE SET
      pov_json     = excluded.pov_json,
      prompt_hash  = excluded.prompt_hash,
      version      = excluded.version,
      generated_at = excluded.generated_at,
      edited_at    = excluded.edited_at
  `),
}));

function rowToPov(row: PovRow): StrategyPov {
  const fallback: StrategyPov = {
    situation: '',
    leadMoveRecId: null,
    leadSentence: '',
    wins: [],
    flags: [],
    version: row.version,
    generatedAt: row.generated_at ?? '',
    editedAt: row.edited_at,
  };
  const parsed = parseJsonSafe(row.pov_json, strategyPovSchema, fallback, {
    table: 'strategy_pov',
    field: 'pov_json',
    workspaceId: row.workspace_id,
  });
  // Authority: the row columns (version/timestamps) are the source of truth for those fields —
  // re-apply them over the blob so a stale blob copy never wins.
  return {
    ...parsed,
    version: row.version,
    generatedAt: row.generated_at ?? parsed.generatedAt,
    editedAt: row.edited_at,
  };
}

/** Fetch the stored (resolved) POV for a workspace, or null if none has been generated. */
export function getStrategyPov(workspaceId: string): StrategyPov | null {
  const row = stmts().get.get(workspaceId) as PovRow | undefined;
  return row ? rowToPov(row) : null;
}

/** Read the cached prompt hash without materializing the full POV. Null when no row exists. */
export function getStrategyPovHash(workspaceId: string): string | null {
  const row = stmts().getHash.get(workspaceId) as Pick<PovRow, 'prompt_hash'> | undefined;
  return row?.prompt_hash ?? null;
}

/** Read the current version (0 when no row exists). */
export function getStrategyPovVersion(workspaceId: string): number {
  const row = stmts().getVersion.get(workspaceId) as Pick<PovRow, 'version'> | undefined;
  return row?.version ?? 0;
}

/**
 * Upsert the POV for a workspace. The caller owns the resolved blob (override ∪ draft), the hash,
 * the version, and the timestamps. `pov.version`/`pov.generatedAt`/`pov.editedAt` are written to
 * both the blob and the dedicated columns so the columns stay the read authority. StrategyPov
 * carries no workspaceId field (it is keyed by the row), so the workspace is an explicit arg.
 */
export function saveStrategyPov(
  workspaceId: string,
  pov: StrategyPov,
  promptHash: string | null,
): void {
  stmts().upsert.run({
    workspace_id: workspaceId,
    pov_json: JSON.stringify(pov),
    prompt_hash: promptHash,
    version: pov.version,
    generated_at: pov.generatedAt,
    edited_at: pov.editedAt,
  });
}

/**
 * Bump the version after an operator edit. Re-reads, applies the edited fields onto the resolved
 * blob, increments version, stamps editedAt, and persists. Returns the new resolved POV.
 * The prompt_hash is left UNCHANGED here — the generator's hash keys on curated rec content +
 * variant + regenerate nonce, NOT on version, so an operator edit leaves the cache key intact: a
 * subsequent plain generate over unchanged curated content reports POV_UNCHANGED and the edit
 * survives (only a regenerate forces a redraft). Returns null if no row.
 */
export function bumpStrategyPovVersion(
  workspaceId: string,
  edits: Partial<Pick<StrategyPov, 'situation' | 'leadSentence' | 'wins' | 'flags' | 'leadMoveRecId'>>,
): StrategyPov | null {
  const current = getStrategyPov(workspaceId);
  if (!current) return null;
  const next: StrategyPov = {
    ...current,
    ...edits,
    version: current.version + 1,
    editedAt: new Date().toISOString(),
  };
  const existingHash = getStrategyPovHash(workspaceId);
  saveStrategyPov(workspaceId, next, existingHash);
  return next;
}
