/**
 * ClientDeliverable — the unified send-to-client artifact model (Phase 0, dark).
 *
 * One interface for the five bespoke "send to client" pipelines. The physically-
 * migrated types live in the `client_deliverable` (+ `_item`) tables; the two
 * hierarchical types (`copy_section`, `content_request`) are PROJECTED from their
 * source tables through this same interface via a projecting adapter (design §13-D1).
 *
 * This module is TYPES-ONLY: it mirrors the migration-111/112 row shapes exactly
 * (CLAUDE.md DB column + mapper lockstep) plus the const enum arrays. The Zod
 * `deliverablePayloadSchema` and the `rowToDeliverable`/`upsertDeliverable` mapper
 * live in the server-only store (`server/client-deliverables.ts`) because the Zod
 * import path is server-only. No importers in Phase 0 — this lands dark.
 *
 * See docs/designs/2026-06-01-unified-send-to-client-design.md §4.1.
 */

export const DELIVERABLE_TYPES = [
  'seo_edit',
  'audit_issue',
  'schema_item',
  'schema_plan',
  'redirect',
  'internal_link',
  'aeo_change',
  'content_decay',
  'cannibalization',
  'content_plan_sample',
  'content_plan_template',
  'work_order',
  'briefing',
  'copy_section',
  'content_request',
  'recommendation',
  'gbp_review_response',
  'brand_generation',
] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];

export const DELIVERABLE_KINDS = ['decision', 'batch', 'review', 'notification', 'order'] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

export const DELIVERABLE_STATUSES = [
  'draft',
  'awaiting_client',
  'changes_requested',
  'partial',
  'approved',
  'declined',
  'applied',
  'expired',
  'cancelled',
  'ordered',
  'in_progress',
  'completed',
] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];

export interface ClientDeliverableItem {
  id: string;
  deliverableId: string;
  status: string;
  targetRef: string | null;
  collectionId: string | null;
  field: string | null;
  currentValue: string | null;
  proposedValue: string | null;
  clientValue: string | null;
  clientNote: string | null;
  applyable: boolean;
  /**
   * Heterogeneous per-item fields (internal-link 6-field, AEO 7-field, redirect 4-field).
   * Discriminated at runtime by the parent deliverable's `type` against the per-type Zod
   * schema in server/client-deliverables.ts (Phase 1 fills the union per adapter). The shape
   * is genuinely open-ended-per-type at this layer, like the grandfathered AnalyticsInsight.data.
   */
  itemPayload: Record<string, unknown> | null; // record-unknown-ok: per-type payload validated by Zod in the store (design §4.1)
  sortOrder: number;
  createdAt: string;
}

export interface ClientDeliverable {
  id: string;
  workspaceId: string;
  externalRef: string | null;
  type: DeliverableType;
  kind: DeliverableKind;
  status: DeliverableStatus;
  title: string;
  summary: string | null;
  /**
   * Typed JSON, discriminated by `type`. Validated by the per-type Zod
   * `deliverablePayloadSchema` in server/client-deliverables.ts (Phase 1 fills the
   * discriminated union per adapter). Open-ended-per-type at this layer by design (§4.1),
   * like the grandfathered AnalyticsInsight.data.
   */
  payload: Record<string, unknown>; // record-unknown-ok: per-type payload validated by Zod in the store (design §4.1)
  note: string | null;
  clientResponseNote: string | null;
  parentDeliverableId: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  dueAt: string | null;
  appliedAt: string | null;
  generatedAt: string | null;
  source: string | null;
  sourceRef: string | null;
  /** Work-order conversation message count, serialized list-side for order rows. */
  commentCount?: number;
  createdAt: string;
  updatedAt: string;
  items?: ClientDeliverableItem[];
}
