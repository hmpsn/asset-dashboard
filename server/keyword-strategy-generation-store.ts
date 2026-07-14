import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe } from './db/json-validation.js';
import type { GenerationProvenance } from '../shared/types/ai-execution.js';
import { generationProvenanceSchema } from './schemas/generation-provenance.js';

const stmts = createStmtCache(() => ({
  get: db.prepare('SELECT keyword_strategy_generation_revision AS revision, keyword_strategy_input_fingerprint AS fingerprint, keyword_strategy_generation_provenance AS provenance FROM workspaces WHERE id = ?'),
  cas: db.prepare(`UPDATE workspaces SET keyword_strategy_generation_revision = keyword_strategy_generation_revision + 1,
    keyword_strategy_input_fingerprint = COALESCE(?, keyword_strategy_input_fingerprint),
    keyword_strategy_generation_provenance = COALESCE(?, keyword_strategy_generation_provenance)
    WHERE id = ? AND keyword_strategy_generation_revision = ?`),
  bump: db.prepare('UPDATE workspaces SET keyword_strategy_generation_revision = keyword_strategy_generation_revision + 1 WHERE id = ?'),
}));

export interface KeywordStrategyGenerationState { revision: number; fingerprint: string | null; provenance: GenerationProvenance | null }

export function getKeywordStrategyGenerationState(workspaceId: string): KeywordStrategyGenerationState {
  const row = stmts().get.get(workspaceId) as { revision: number; fingerprint: string | null; provenance: string | null } | undefined;
  if (!row) return { revision: 0, fingerprint: null, provenance: null };
  return {
    revision: row.revision, fingerprint: row.fingerprint,
    provenance: row.provenance ? parseJsonSafe(row.provenance, generationProvenanceSchema, null, { table: 'workspaces', field: 'keyword_strategy_generation_provenance', workspaceId }) : null,
  };
}

/** Must run inside the caller's final persistence transaction. */
export function claimKeywordStrategyGenerationCommit(workspaceId: string, expectedRevision: number, provenance: GenerationProvenance | null): boolean {
  return stmts().cas.run(provenance?.inputFingerprint ?? null, provenance ? JSON.stringify(provenance) : null, workspaceId, expectedRevision).changes === 1;
}

export function bumpKeywordStrategyGenerationRevision(workspaceId: string): void { stmts().bump.run(workspaceId); }

/** Mutation-side invalidation for any operator-owned input consumed by strategy synthesis. */
export const invalidateKeywordStrategyGenerationInputs = bumpKeywordStrategyGenerationRevision;
