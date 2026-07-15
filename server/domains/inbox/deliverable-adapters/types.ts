/**
 * Deliverable adapter interface + self-registering registry (Phase 0, dark).
 *
 * Adding a reviewable work type later is AN ADAPTER, not a sixth send-to-client
 * subsystem (design §4.5). Each Phase-1 type PR creates
 * `server/domains/inbox/deliverable-adapters/<type>.ts`, calls `registerAdapter()`
 * at module scope, and appends `import './<type>.js'` to `index.ts` (the only shared
 * edit — kept append-only so parallel PRs merge trivially).
 *
 * In Phase 0 the registry is empty (no adapters imported by index.ts). The
 * `every-active-type-has-an-adapter` pr-check rule starts as `warn` until each
 * flag group activates.
 */
import type {
  ClientDeliverable,
  DeliverableKind,
  DeliverableStatus,
  DeliverableType,
} from '../../../../shared/types/client-deliverable.js';
import type { UpsertDeliverableItemInput } from '../../../client-deliverables.js';

/** Result of validateSendable — `ok:false` carries an operator-facing reason. */
export type SendableResult = { ok: true } | { ok: false; reason: string };

/** The client decision propagated to the source artifact (R2). */
export type DeliverableSourceDecision = 'approved' | 'changes_requested' | 'declined';

/** Optional context for respondToSource (the client's note, the actor). */
export interface RespondToSourceOptions {
  note?: string | null;
  actor?: { id?: string; name?: string };
  /**
   * R3 per-item subset (APPROVAL-FAMILY ONLY). The items the client flagged in the detail modal,
   * each carrying the `ClientDeliverableItem.id` plus the typed flag note. On an `approved`
   * decision, the approval_batch adapter approves the UNFLAGGED items and rejects (holds) the
   * flagged ones ("implement N of M"), persisting the typed note onto each held item. Empty/absent
   * → the whole-batch R2 behavior (approve all pending). Ignored on changes_requested/declined
   * (whole-deliverable reject) and by the client_action family (no typed items — whole-action only).
   */
  flaggedItems?: { itemId: string; note?: string }[];
  /**
   * Item 2 — EDIT-before-approve (APPROVAL-FAMILY ONLY). The per-item edited proposed values the
   * client typed in the inline editor (seoTitle / seoDescription), each carrying the
   * `ClientDeliverableItem.id` + the edited value. The approval_batch adapter persists each as the
   * legacy approval item's `clientValue` (the Webflow apply path already prefers
   * `clientValue || proposedValue`). Orthogonal to `flaggedItems` — a client can edit AND approve the
   * same item. Empty/absent → no edits. Ignored on changes_requested/declined and by the
   * client_action family (no typed items — whole-action only).
   */
  editedItems?: { itemId: string; value: string }[];
}

/** Outcome of a source propagation — `handled` drives the double-notify suppression. */
export interface RespondToSourceResult {
  /**
   * True when this adapter OWNS the team notification for its source write (it fired the
   * source-path team email / signal itself). `respondToDeliverable` SUPPRESSES its own
   * deliverable-level team email when this is true, so the team is notified exactly once.
   */
  handled: boolean;
}

/** The typed shape buildPayload returns — fed straight into upsertDeliverable. */
export interface BuiltDeliverablePayload {
  title: string;
  summary?: string | null;
  kind: DeliverableKind;
  payload: Record<string, unknown>;
  items?: UpsertDeliverableItemInput[];
  externalRef?: string | null;
  parentDeliverableId?: string | null;
}

/**
 * Everything a new deliverable type implements. `applyDeliverable` is OPT-IN:
 * the shared response handler only calls it on approve when `appliesOnApprove === true`
 * (default false — D-apply, prevents the unified path from re-creating the B1
 * destructive write). `projectFromSource` is implemented ONLY by the projected types
 * (copy_section, content_request) whose source tables are retained.
 */
export interface DeliverableAdapter<TInput = unknown, TSourceRow = unknown> {
  /** The deliverable type this adapter owns. Must be unique across the registry. */
  type: DeliverableType;
  /** Guarantee 0: reject not-ready inputs before anything else (design §4.3-g0). */
  validateSendable(input: TInput): SendableResult;
  /** Build the typed payload (+ child items) for the store. */
  buildPayload(input: TInput): BuiltDeliverablePayload;
  /** Stable natural key for dedup-on-resend (per-type, design §4.5). null = no dedup. */
  sourceRef(input: TInput): string | null;
  /**
   * Optional honest resend state. Most artifacts supersede back to awaiting_client;
   * grouped per-item reviews may need to remain partial when approved children are
   * retained. Returning approved/terminal states is deliberately not supported.
   */
  resolveSendStatus?(
    input: TInput,
    existing: ClientDeliverable | null,
  ): Extract<DeliverableStatus, 'awaiting_client' | 'partial'>;
  /**
   * Opt-in: when appliesOnApprove is true, the response handler runs this on approve
   * (Webflow write outside the DB txn). Default no-op — apply is a separate transition
   * from "client approved" during cutover (D-apply).
   */
  appliesOnApprove?: boolean;
  applyDeliverable?(deliverable: ClientDeliverable): Promise<{ applied: number }>;
  /**
   * R2 — respond propagation. Implemented by the PHYSICAL types whose source artifact the
   * operator/apply logic still reads (approval_batch family → legacy batch; client_action
   * family → legacy client_action; schema_plan → schema_site_plans). Maps the deliverable
   * back to its source id (via `payload`) and drives the EXISTING per-type source-writing
   * logic so a unified-inbox client decision is no longer a silent no-op on the real work.
   *
   * Propagates only the DECISION/status (R2) — never the Webflow publish (R3, a separate
   * step). `approved` → source approved; `changes_requested`/`declined` → source reject/
   * changes path (passing the client's note). Returns `{ handled }` so respondToDeliverable
   * can suppress its deliverable-level team email for types whose source path owns it.
   *
   * Notification/decision-less types (work_order/briefing) and projected types
   * (copy_section/content_request) do NOT implement this.
   */
  respondToSource?(
    workspaceId: string,
    deliverable: ClientDeliverable,
    decision: DeliverableSourceDecision,
    opts?: RespondToSourceOptions,
  ): Promise<RespondToSourceResult> | RespondToSourceResult;
  /** ONLY for projected types — expose a source-table row through the unified model. */
  projectFromSource?(sourceRow: TSourceRow): ClientDeliverable;
}

// Module-level registry. Adapters self-register on import (index.ts is the barrel).
const registry = new Map<DeliverableType, DeliverableAdapter>();

/**
 * Register a deliverable adapter. Throws if the type is already registered — a double
 * registration is a bug (two modules claiming the same type silently shadow each other).
 */
export function registerAdapter(adapter: DeliverableAdapter): void {
  if (registry.has(adapter.type)) {
    throw new Error(`deliverable adapter already registered for type: ${adapter.type}`);
  }
  registry.set(adapter.type, adapter);
}

/** Resolve the adapter for a type. Throws if none is registered. */
export function getAdapter(type: DeliverableType): DeliverableAdapter {
  const adapter = registry.get(type);
  if (!adapter) {
    throw new Error(`no deliverable adapter registered for type: ${type}`);
  }
  return adapter;
}

/** Resolve the adapter for a type, or undefined if none is registered (no throw). */
export function tryGetAdapter(type: DeliverableType): DeliverableAdapter | undefined {
  return registry.get(type);
}

/** All currently-registered deliverable types. */
export function listAdapterTypes(): DeliverableType[] {
  return [...registry.keys()];
}

/** Test-only: clear the registry between cases so registrations do not leak. */
export function __resetAdapterRegistryForTests(): void {
  registry.clear();
}
