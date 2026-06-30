// shared/types/strategy-keyword-set.ts
//
// Strategy redesign (graft 1) — managed keyword working-set contracts. The set is backed
// by the dedicated `strategy_keyword_set` table (migration 139), whose sole writer is the
// reconciler in server/domains/strategy/managed-keyword-set.ts. Pre-committed in P2;
// consumed in P3 (server typing + the SiteTargetKeywords managed-set UI + the
// useStrategyKeywordSet hook).
//
// Field names mirror the table columns 1:1 (snake_case → camelCase at the rowToX boundary):
//   id, workspace_id, keyword, source, kept_at, removed_at, slot_order, created_at.

/** Provenance of a managed-set row — matches the table's CHECK(source IN (...)) constraint. */
export type KeywordSetSource = 'regen_computed' | 'client_request' | 'manual_add';

export interface StrategyKeywordSetRow {
  id: number;
  workspaceId: string;
  keyword: string;
  source: KeywordSetSource;
  /** ISO; operator explicitly kept — survives regen. Null when never explicitly kept. */
  keptAt: string | null;
  /** ISO; operator removed — excluded from replenish. Null when active (in the set). */
  removedAt: string | null;
  slotOrder: number;
  createdAt: string;
}

/** Active rows (removedAt IS NULL), ordered by slotOrder. */
export type ActiveStrategyKeyword = StrategyKeywordSetRow & { removedAt: null };
