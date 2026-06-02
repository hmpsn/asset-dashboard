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
import type { ClientDeliverableItem } from './client-deliverable.js';

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
  /**
   * The unified deliverable's typed per-item rows (field/currentValue/proposedValue/clientValue/
   * targetRef/applyable/itemPayload). Carried straight from `ClientDeliverable.items` so R3 can
   * render the per-item diff/review surface without a second fetch. Present only for unified
   * deliverables (source==='deliverable'); the approval/SEO/schema family populates this, the
   * client_action family (redirect/internal_link/aeo_change) carries its sub-items in `payload`
   * instead (design §4.1), so this may be an empty array for those types. Additive — legacy
   * adapters (client_action/approval_batch) leave it undefined and existing consumers are unchanged.
   */
  items?: ClientDeliverableItem[];
  /**
   * The unified deliverable's typed JSON payload (discriminated by the deliverable type). Carried
   * straight from `ClientDeliverable.payload` so R3 can render the substance that does NOT live in
   * the typed `_item` rows — notably the redirect/internal_link/aeo_change sub-items, which ride in
   * `payload.items` (design §4.1). Present only for unified deliverables (source==='deliverable').
   * Additive — legacy adapters leave it undefined.
   */
  payload?: Record<string, unknown>; // record-unknown-ok: mirrors ClientDeliverable.payload, validated by Zod in the store (design §4.1)
}

/** An item flagged by the client inside DecisionDetailModal. */
export interface FlaggedItem {
  itemId: string;
  note: string;
}
