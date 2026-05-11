/**
 * NormalizedDecision — unified shape for InboxTab Decisions section items.
 *
 * Both `client_actions` and `approval_batches` are adapted into this shape
 * by `src/lib/decision-adapters.ts`. The shape drives `<DecisionCard>` (entry-point)
 * and `<DecisionDetailModal>` (full-screen approval flow).
 *
 * Key discriminant: `isSingleAction`
 *  - true  → `content_decay`: rendered inline in the Decisions section with
 *             approve/flag-with-note buttons, no modal.
 *  - false → all other types: rendered as an entry-point card that opens
 *             `<DecisionDetailModal>` on click.
 */
export type DecisionSource = 'client_action' | 'approval_batch';

export interface NormalizedDecision {
  /** Unique display ID (prefixed: 'ca-{id}' or 'ab-{id}'). */
  id: string;
  source: DecisionSource;
  /** Original record ID from `client_actions.id` or `approval_batches.id`. */
  sourceId: string;
  title: string;
  summary: string;
  priority?: 'high' | 'medium' | 'low';
  /** Total number of changes (1 for content_decay, batch.items.length for batches). */
  itemCount: number;
  /**
   * true only for `content_decay` client_actions.
   * Inline approve/flag affordance — no full-screen modal.
   */
  isSingleAction: boolean;
  /** Short human label shown as a badge: "AEO", "SEO Editor", "Schema", etc. */
  badge: string;
  createdAt: string;
}

/** An item flagged by the client inside DecisionDetailModal. */
export interface FlaggedItem {
  itemId: string;
  note: string;
}
