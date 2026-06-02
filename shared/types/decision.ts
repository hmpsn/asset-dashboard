/**
 * NormalizedDecision — unified shape for InboxTab Decisions section items.
 *
 * The legacy `client_actions` and `approval_batches` are adapted into this shape
 * by `src/lib/decision-adapters.ts`; the unified `client_deliverable` model is adapted
 * by `normalizeDeliverable()` (PR-2a). The shape drives `<DecisionCard>` (entry-point)
 * and `<DecisionDetailModal>` (full-screen approval flow), plus the unified `PriorityStrip`.
 *
 * Discriminants (additive widening — PR-2a):
 *  - `kind` — the deliverable kind this decision represents. Generalizes the model to read
 *    the `ClientDeliverable` model (design §5). For the legacy adapters: `content_decay` →
 *    'decision' (inline), approval batches → 'batch' (modal). `isSingleAction` is KEPT for
 *    back-compat and DERIVED from `kind === 'decision'` so existing consumers behave identically.
 *  - `isSingleAction`
 *      - true  → inline approve/flag affordance in the Decisions section, no full-screen modal.
 *      - false → entry-point card that opens `<DecisionDetailModal>` on click.
 */
export type DecisionSource = 'client_action' | 'approval_batch' | 'deliverable';

/**
 * The deliverable kind a NormalizedDecision represents — mirrors `DeliverableKind` in
 * `shared/types/client-deliverable.ts` (kept as a separate literal union so the legacy
 * decision adapters need not import the unified model). `isSingleAction` is derived from
 * `kind === 'decision'` (the inline single-action affordance).
 */
export type DecisionKind = 'decision' | 'batch' | 'review' | 'notification' | 'order';

export interface NormalizedDecision {
  /** Unique display ID (prefixed: 'ca-{id}', 'ab-{id}', or 'cd-{id}'/source-ref for deliverables). */
  id: string;
  source: DecisionSource;
  /** Original record ID from `client_actions.id`, `approval_batches.id`, or the deliverable id. */
  sourceId: string;
  title: string;
  summary: string;
  priority?: 'high' | 'medium' | 'low';
  /** Total number of changes (1 for content_decay, batch/deliverable item count otherwise). */
  itemCount: number;
  /** The unified deliverable kind this decision represents (design §5). */
  kind: DecisionKind;
  /**
   * true → inline approve/flag affordance (no full-screen modal). DERIVED from `kind === 'decision'`
   * for the unified model; kept for back-compat with the legacy adapters and consumers.
   */
  isSingleAction: boolean;
  /** Short human label shown as a badge: "AEO", "SEO Editor", "Schema", etc. */
  badge: string;
  createdAt: string;
  /**
   * ISO timestamp the deliverable entered awaiting_client (its staleness clock, design §5).
   * Present only for unified deliverables (source==='deliverable'); used to show send age.
   */
  sentAt?: string | null;
}

/** An item flagged by the client inside DecisionDetailModal. */
export interface FlaggedItem {
  itemId: string;
  note: string;
}
