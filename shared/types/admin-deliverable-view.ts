/**
 * AdminDeliverableView — the admin "Client Deliverables" pane read contract (PR-2b, DARK).
 *
 * The admin inbox needs ONE operator view of everything sent to a client, grouped by a STATUS
 * AXIS with a staleness signal (audit §E1/E2/E6/E7; design §6). This is a thin annotation over
 * the unified `ClientDeliverable` (server/client-deliverables.ts + the projected adapters) — it
 * adds the operator-facing axis + age fields without changing the deliverable itself.
 *
 * The axis collapses the full status vocabulary into the four operator buckets from design §6:
 *   • `awaiting_client`    — sent, no response yet (the nudge queue; `stale` flags the old ones)
 *   • `changes_requested`  — client asked for changes (incl. `partial`) — needs operator follow-up
 *   • `approved`           — client approved, ready to apply (the "to apply" bucket)
 *   • `other`              — everything else not on the active axis (declined, draft, terminal,
 *                            order/production internals) — surfaced last for completeness (E2)
 *
 * `stale` is DERIVED server-side: an `awaiting_client` item whose `sentAt` is older than
 * `STALE_AWAITING_DAYS` (7). `ageDays` is the whole-day age from `sentAt` (null when never sent).
 *
 * Typed contract at a layer boundary (CLAUDE.md Data Flow #5): server assembles → API → admin
 * hook/pane. No `unified-*` flag dependency here — the `unified-inbox` flag gates whether the
 * admin pane FETCHES this; the read itself is inert (empty physical table) until cutover.
 */
import type { ClientDeliverable } from './client-deliverable.js';

/** The four operator buckets the admin pane groups by (design §6 status axis). */
export const DELIVERABLE_STATUS_AXES = [
  'awaiting_client',
  'changes_requested',
  'approved',
  'other',
] as const;
export type DeliverableStatusAxis = (typeof DELIVERABLE_STATUS_AXES)[number];

/** A deliverable annotated with the operator status axis + staleness signal. */
export interface AdminDeliverableView extends ClientDeliverable {
  /** The operator bucket this deliverable falls into (design §6). */
  statusAxis: DeliverableStatusAxis;
  /** Whole-day age computed from `sentAt` (null when the item was never sent). */
  ageDays: number | null;
  /** True when an `awaiting_client` item's `sentAt` is older than the stale threshold. */
  stale: boolean;
}

/** The admin "Client Deliverables" pane response shape. */
export interface AdminDeliverablesResponse {
  deliverables: AdminDeliverableView[];
}

/**
 * An `awaiting_client` deliverable is STALE once its `sentAt` is older than this many days.
 * Single source of truth shared by the server derivation and any client-side display copy.
 */
export const STALE_AWAITING_DAYS = 7;
