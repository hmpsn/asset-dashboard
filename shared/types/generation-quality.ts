/**
 * Generation-quality telemetry for the keyword-strategy + recommendation
 * generation pipeline (SEO Generation Quality plan, Phase 0).
 *
 * This is a typed observability record — emitted via the module logger from
 * `server/keyword-strategy-generation.ts` and surfaced from the generation
 * function's return value so eval fixtures can assert on it without changing the
 * existing output contract. It records what the generation run actually produced
 * so later phases (P1–P6) are measurable rather than flying blind.
 *
 * Data-Flow #5: this is a typed contract — never an inline object or an untyped
 * key/value bag. P0 is pure infrastructure — no behavior change.
 */
export interface GenerationQuality {
  /** Workspace the strategy was generated for. */
  workspaceId: string;
  /**
   * Size of the candidate keyword universe (unique terms in the pool) the AI
   * synthesis selected from. Knowable today (`keywordPool.size`).
   */
  poolSize: number;
  /**
   * Count of content gaps the AI synthesis actually returned (post-filter, before
   * any future deterministic backfill). Knowable today.
   */
  aiReturnedCount: number;
  /**
   * Count of candidates suppressed by the over-conservative pruning rules.
   * Populated by P1–P2 (the un-suppress + telemetry work); 0 until then.
   */
  suppressedCount: number;
  /**
   * Count of content gaps re-admitted by the deterministic backfill floor.
   * Populated by P2; 0 until then.
   */
  backfilledCount: number;
  /**
   * Whether the deterministic backfill floor (soft floor of 6) had to be hit to
   * guarantee a populated gap list. Populated by P2; false until then.
   */
  floorHit: boolean;
}
