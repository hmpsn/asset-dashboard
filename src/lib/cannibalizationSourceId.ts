/**
 * Stable, regeneration-proof idempotency key for a cannibalization issue's tracked action.
 *
 * The `cannibalization_issues` table is delete-then-reinsert on every strategy regen (no resolved
 * column), so resolution state lives on a durable `tracked_action` instead. The keyword is the row
 * identity (the table's PK), so it's the natural key. This MUST be used identically at both the
 * write site (recordAction sourceId) and the read site (resolved-set match), or resolved issues
 * won't be recognized after a regen re-emits the same keyword.
 */
export const cannibalizationSourceId = (keyword: string): string => keyword.trim().toLowerCase();
