/**
 * schema_plan deliverable adapter (PR-1c, DARK).
 *
 * Claims the per-SITE Schema STRATEGY plan (`SchemaSitePlan`, stored in `schema_site_plans`,
 * keyed by `site_id`) — the "Send to client" flow on the Schema Review tab
 * (`server/routes/webflow-schema.ts:705`, status → `sent_to_client`). This is the schema
 * STRATEGY artifact (page-role assignments + canonical entities for the whole site), NOT the
 * per-page `schema_item` approval batches (that is the PR-1a `schema_item` adapter — a
 * different store + dedup key). The two are LINKED: the plan carries a `clientPreviewBatchId`
 * soft-FK to the schema-item batch (audit §B.3).
 *
 * kind = 'review' (design §4.1): a schema strategy is a single review artifact for the whole
 * site, not a per-item batch (kind 'batch') and not a single inline decision (kind 'decision').
 * The plan's pageRoles + canonicalEntities ride in `client_deliverable.payload` JSON; this
 * adapter emits NO typed child items (the per-page schema markup lives in the schema_item
 * family, not here).
 *
 * sourceRef = `schema_plan:<siteId>` — STABLE per-site (there is exactly one live plan per
 * site; `getSchemaPlan(siteId)` returns the single latest plan). A re-send of the same site's
 * plan dedupes onto one deliverable row (design §4.5).
 *
 * externalRef = <siteId> (the Webflow site this strategy targets — audit §A schema_plan row).
 * generatedAt = <plan.generatedAt> (the plan's own generation timestamp, carried through).
 *
 * parentDeliverableId: if the plan carries a `clientPreviewBatchId` (the soft-FK to the
 * schema-item approval batch — audit §B.3), best-effort resolve the corresponding schema_item
 * deliverable via `findBySourceRef(workspaceId, 'schema_item', 'schema_item:<batchId>')` (the
 * schema_item adapter keys its sourceRef on `schema_item:<batch.id>` —
 * `approval-batch-shared.ts:approvalBatchSourceRef`). When the schema-item batch has NOT been
 * mirrored yet (expected while dark — the approval family flag is separately gated), the lookup
 * returns null; we then leave `parentDeliverableId` null and stash the raw `clientPreviewBatchId`
 * in `payload.clientPreviewBatchId` so the linkage is never lost and can be re-resolved at
 * cutover. This is intentionally best-effort and never throws.
 *
 * applyDeliverable: DISABLED (opt-out `appliesOnApprove`, throwing stub). A client approving the
 * schema STRATEGY does NOT auto-apply — operator publish of the per-page schema markup is a
 * SEPARATE transition (D-apply). schema_plan has NO per-type transition override in
 * `state-machines.ts` (it uses the base map; approve → applied is the operator step, never
 * triggered by client approve).
 *
 * Leaf rule: this module imports the shared schema-plan types, the adapter contract, and the
 * store's `findBySourceRef` reader (for the best-effort parent resolution). The store
 * (`client-deliverables.ts`) does NOT import any adapter, so this read import creates no cycle.
 * The `workspaceId` the parent lookup needs is carried on the `SchemaSitePlan` itself.
 */
import type { SchemaSitePlan } from '../../../../shared/types/schema-plan.js';
import type { ClientDeliverable } from '../../../../shared/types/client-deliverable.js';
import { findBySourceRef } from '../../../client-deliverables.js';
import { createLogger } from '../../../logger.js';
import { respondToSchemaPlanFeedback } from '../schema-plan-respond.js';
import {
  registerAdapter,
  type BuiltDeliverablePayload,
  type DeliverableAdapter,
  type DeliverableSourceDecision,
  type RespondToSourceOptions,
  type RespondToSourceResult,
  type SendableResult,
} from './types.js';

const log = createLogger('schema-plan-adapter');

/**
 * The adapter input for schema_plan: the persisted `SchemaSitePlan` (as built by
 * `server/schema-plan.ts:generateSchemaPlan` and stored via `schema-store.ts:saveSchemaPlan`).
 * The plan already carries `siteId` (for the sourceRef + externalRef) and `workspaceId` (the
 * OWNING workspace — for the best-effort parent lookup), so the input is self-contained: the
 * dual-write seam + backfill pass the plan straight through.
 */
export interface SchemaPlanInput {
  plan: SchemaSitePlan;
}

/**
 * Resolve the schema-item deliverable's sourceRef from the plan's clientPreviewBatchId soft-FK.
 * Must EXACTLY mirror `approval-batch-shared.ts:approvalBatchSourceRef('schema_item', batch)`
 * (`schema_item:<batch.id>`) — that is the natural key the schema_item adapter dedupes on, so
 * this is the key `findBySourceRef` must look up to find the mirrored parent.
 */
function schemaItemSourceRefFor(batchId: string): string {
  return `schema_item:${batchId}`;
}

export const schemaPlanAdapter: DeliverableAdapter<SchemaPlanInput> = {
  type: 'schema_plan',
  // A plan with no content (no pageRoles AND no canonicalEntities) is not a sendable strategy —
  // there is nothing for the client to review. Reject the empty plan (Guarantee 0).
  validateSendable: ({ plan }): SendableResult => {
    const hasPageRoles = Array.isArray(plan.pageRoles) && plan.pageRoles.length > 0;
    const hasEntities = Array.isArray(plan.canonicalEntities) && plan.canonicalEntities.length > 0;
    if (!hasPageRoles && !hasEntities) {
      return { ok: false, reason: 'schema plan is empty (no pageRoles or canonicalEntities to review)' };
    }
    return { ok: true };
  },

  buildPayload: ({ plan }): BuiltDeliverablePayload => {
    // Best-effort parent resolution: the plan's clientPreviewBatchId is a soft-FK to the
    // schema_item approval batch (audit §B.3). Resolve the mirrored schema_item deliverable by
    // its sourceRef; if it is not mirrored yet (dark / flag off), leave null and stash the raw id.
    let parentDeliverableId: string | null = null;
    if (plan.clientPreviewBatchId) {
      try {
        const parent = findBySourceRef(
          plan.workspaceId,
          'schema_item',
          schemaItemSourceRefFor(plan.clientPreviewBatchId),
        );
        parentDeliverableId = parent?.id ?? null;
      } catch (err) {
        // Defensive: a reader failure must never break the build (best-effort linkage).
        // The raw clientPreviewBatchId is still stashed in payload below, so the linkage
        // is never lost — it can be re-resolved at cutover.
        log.debug({ err, planId: plan.id }, 'schema-plan: parent schema_item lookup failed (best-effort, ignored)');
        parentDeliverableId = null;
      }
    }

    const pageCount = Array.isArray(plan.pageRoles) ? plan.pageRoles.length : 0;
    const entityCount = Array.isArray(plan.canonicalEntities) ? plan.canonicalEntities.length : 0;

    return {
      title: 'Schema Strategy Review',
      summary: `${pageCount} page${pageCount !== 1 ? 's' : ''}, ${entityCount} entit${entityCount !== 1 ? 'ies' : 'y'} for review`,
      kind: 'review',
      payload: {
        family: 'schema_plan',
        siteId: plan.siteId,
        siteUrl: plan.siteUrl,
        legacyPlanId: plan.id,
        // Carry the plan's full review content so a reader can reconstruct the strategy without
        // re-reading schema_site_plans (the round-trip is lossless).
        pageRoles: plan.pageRoles ?? [],
        canonicalEntities: plan.canonicalEntities ?? [],
        // ALWAYS stash the raw soft-FK so the schema_item linkage survives even when the parent
        // is not mirrored yet (parentDeliverableId stays null until cutover re-resolves it).
        clientPreviewBatchId: plan.clientPreviewBatchId ?? null,
      },
      externalRef: plan.siteId,
      parentDeliverableId,
      // No typed child items — the per-page schema markup is the schema_item family, not here.
    };
  },

  // Stable per-site key: schema_plan:<siteId>. There is exactly one live plan per site, so a
  // re-send dedupes onto one deliverable row. Null only if a malformed plan has no siteId.
  sourceRef: ({ plan }) => (plan.siteId ? `schema_plan:${plan.siteId}` : null),

  // R2: propagate the client decision to the legacy schema_site_plans row (approve →
  // client_approved; changes_requested/declined → client_changes_requested). Operator publish
  // of the per-page markup stays a separate transition (D-apply) — R2 is decision-only.
  respondToSource: respondToSchemaPlanSource,

  // apply opt-out — D-apply. A client approving the STRATEGY does not auto-publish the per-page
  // schema markup; operator publish is a separate transition. Stub throws if ever reached.
  applyDeliverable: schemaPlanApplyDisabledStub,
};

/**
 * Read the legacy siteId off a mirrored schema_plan deliverable. The adapter stores it as the
 * `externalRef` (and mirrors it into `payload.siteId`); prefer the externalRef, falling back to
 * the payload field. This is the deliverable → source mapping for schema_plan.
 */
function schemaPlanSiteId(deliverable: ClientDeliverable): string | null {
  if (typeof deliverable.externalRef === 'string' && deliverable.externalRef.trim()) {
    return deliverable.externalRef;
  }
  const fromPayload = (deliverable.payload as { siteId?: unknown })?.siteId;
  return typeof fromPayload === 'string' && fromPayload.trim() ? fromPayload : null;
}

/**
 * R2 source propagation for schema_plan. Maps the deliverable back to its site and drives the
 * SHARED `respondToSchemaPlanFeedback` service:
 *   - approved                       → plan status `client_approved`
 *   - changes_requested / declined   → plan status `client_changes_requested` (note carried)
 *
 * The schema-plan source path notifies the team via the activity log + SCHEMA_PLAN_SENT
 * broadcast (it has NO team email — same as the legacy feedback route, by design / B4-parity).
 * To keep the no-double-notify contract — the source path is the single owner of the team-facing
 * signal — this returns `{ handled: true }`, so respondToDeliverable suppresses its own
 * deliverable-level team email for schema_plan. A missing siteId / absent plan is a swallowed
 * best-effort miss (the deliverable mirror has already moved).
 */
export function respondToSchemaPlanSource(
  workspaceId: string,
  deliverable: ClientDeliverable,
  decision: DeliverableSourceDecision,
  opts: RespondToSourceOptions = {},
): RespondToSourceResult {
  const siteId = schemaPlanSiteId(deliverable);
  if (!siteId) {
    log.warn(
      { workspaceId, deliverableId: deliverable.id },
      'schema_plan respondToSource: no siteId on deliverable (externalRef/payload) — source not updated',
    );
    return { handled: true };
  }
  const action = decision === 'approved' ? 'approve' : 'request_changes';
  respondToSchemaPlanFeedback(workspaceId, siteId, action, opts.note ?? null);
  return { handled: true };
}

/**
 * The disabled-apply stub for schema_plan. The client approving the schema strategy does NOT
 * auto-apply — operator publish of the per-page schema markup is a separate transition (D-apply,
 * design §4.2). The adapter opts OUT of `appliesOnApprove`, so `respondToDeliverable` never calls
 * this; it throws to make the disabled-apply contract explicit if any future caller wires it on.
 */
export async function schemaPlanApplyDisabledStub(_deliverable: ClientDeliverable): Promise<{ applied: number }> {
  throw new Error(
    'schema_plan apply is a separate operator transition (D-apply): a client approving the schema strategy does NOT auto-publish per-page schema markup; operator publish is wired separately at cutover',
  );
}

registerAdapter(schemaPlanAdapter as DeliverableAdapter);
