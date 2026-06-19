// server/domains/strategy/managed-keyword-set.ts
//
// Strategy redesign (graft 1) — managed keyword working-set domain module.
//
// P2 PRE-COMMIT: typed signatures only. Every body throws `not implemented`; the real
// implementation (createStmtCache prepared statements, rowToStrategyKeyword mapper, the
// reconciler algorithm, auto-replenish, addActivity calls) lands in P3 Lane A. This stub
// lets P3 lanes import the interface and write tests against it before the bodies exist.
//
// The reconciler's SOLE writer seam (P3) is persistKeywordStrategy's writeKeywordStrategy
// transaction (keyword-strategy-persistence.ts:169), NOT saveRecommendations() (which has
// no db.transaction). This is a pure server-side library — it adds no HTTP routes.
import type { KeywordStrategy } from '../../../shared/types/workspace.js';
import type { StrategyKeywordSetRow } from '../../../shared/types/strategy-keyword-set.js';

// P2 stub note: bodies throw `not implemented` (filled in P3 Lane A). The leading
// `void <param>` statements keep the P3-consumed parameter names intact while satisfying
// `noUnusedParameters` — they are removed when the real bodies land.

/** Active rows (removed_at IS NULL) for a workspace, ordered by slot_order. */
export function getStrategyKeywordSet(workspaceId: string): StrategyKeywordSetRow[] {
  void workspaceId;
  throw new Error('not implemented');
}

/**
 * The ONLY regen writer. Diffs the freshly-computed `strategy.siteKeywords` against the
 * stored set, inserts net-new as source:'regen_computed', and auto-replenishes removed
 * slots from the opportunity pool. Wired (P3) inside writeKeywordStrategy's transaction.
 */
export function reconcileStrategyKeywordSet(workspaceId: string, strategy: KeywordStrategy): void {
  void workspaceId;
  void strategy;
  throw new Error('not implemented');
}

/** Operator add (or promote-from-client-request). Dedups before insert; logs activity. */
export function addStrategyKeyword(
  workspaceId: string,
  keyword: string,
  source: 'client_request' | 'manual_add',
): StrategyKeywordSetRow {
  void workspaceId;
  void keyword;
  void source;
  throw new Error('not implemented');
}

/** Operator remove — sets removed_at (NOT a hard delete) and replenishes; logs activity. */
export function removeStrategyKeyword(workspaceId: string, keyword: string): void {
  void workspaceId;
  void keyword;
  throw new Error('not implemented');
}

/** Operator keep — stamps kept_at so the keyword survives regen; logs activity. */
export function keepStrategyKeyword(workspaceId: string, keyword: string): void {
  void workspaceId;
  void keyword;
  throw new Error('not implemented');
}
