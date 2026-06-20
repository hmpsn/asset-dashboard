/**
 * recommendation deliverable adapter (Strategy "The Issue" — Phase 2, the close-the-loop spine).
 *
 * Mirrors the cannibalization adapter (the closest template — both are a SINGLE inline client
 * decision, kind = 'decision'). When the operator sends a curated recommendation to the client
 * (`sendRecommendation` → clientStatus 'sent'), `mirrorRecommendationToDeliverable` mints ONE
 * `client_deliverable` of this type (born `awaiting_client`) so the rec surfaces in the unified
 * client feed/inbox and the operator can track its response. This closes half-loop #1 (operator
 * send → client sees) for the §7 revenue spine.
 *
 * THE UNIT: one `ClientDeliverable` per recommendation. The rec's client-facing meaning rides in
 * `client_deliverable.payload` JSON as the single decision — the source rec id, its `targetKeyword`,
 * and its `StrategyCardContext` (spec §7: the deliverable is "stamped with the source rec id +
 * targetKeyword + the rec's StrategyCardContext"). The client never sees admin/AI-only $/ROI fields
 * (those never enter this payload — only the client-safe insight/estimatedGain/title prose).
 *
 * sourceRef = `recommendation:<id>` — STABLE per-rec. The rec id is the globally-unique natural key,
 * so a re-send of the SAME rec dedupes onto one deliverable row (upsertDeliverable collapses on
 * (ws, type, sourceRef)).
 *
 * Apply stays DISABLED (D-apply, respond-only). A rec-derived deliverable carries no `legacyBatchId`
 * — the deliverable `/apply` route would 400 — so greenlight is a RESPOND-only path: clientStatus
 * → approved + a durable content REQUEST + a TrackedAction, with the operator marking the work
 * complete manually (spec §7 C1). The adapter opts OUT of `appliesOnApprove`; `applyDisabledStub`
 * throws if any future caller wires it on.
 *
 * Leaf rule: this module imports ONLY shared types + the adapter contract + the (already-leaf)
 * `applyDisabledStub`. It is NOT imported back by the store/service.
 */
import { registerAdapter, type DeliverableAdapter } from './types.js';
import { applyDisabledStub } from './client-action-shared.js';
import { buildStrategyCardContextFromRec } from '../../../recommendation-strategy-card-context.js';
import type { Recommendation } from '../../../../shared/types/recommendations.js';
import type { StrategyCardContext } from '../../../../shared/types/content.js';

/**
 * The adapter input for a recommendation deliverable: the persisted curated `Recommendation`
 * (post-`sendRecommendation`, so clientStatus is 'sent'). The dual-write seam passes the freshly
 * sent rec straight through. Self-contained — no external lookup needed (unlike the
 * redirect/internal_link siteId resolution), because a rec carries its own id + targetKeyword +
 * strategyCardContext.
 */
export interface RecommendationInput {
  rec: Recommendation;
}

/**
 * The typed payload carried in `client_deliverable.payload` for a recommendation deliverable.
 * Carries ONLY client-safe fields (spec §5: no admin jargon, no $/ROI). The rec id +
 * targetKeyword + strategyCardContext are the §7 stamps the act-on route reads back to create the
 * durable content request + the attribution TrackedAction.
 */
export interface RecommendationDeliverablePayload {
  family: 'recommendation';
  /** The source recommendation id — the §7 stamp the act-on route + attribution join read back. */
  recommendationId: string;
  /** The rec's type (content / keyword_gap / technical / …) — drives client archetype grouping. */
  recType: Recommendation['type'];
  /** Client-safe "why this matters" prose. */
  insight: string;
  /** Client-safe expected-improvement phrase (non-dollarized). */
  estimatedGain: string;
  /** The keyword this rec targets — stamped for the act-on content request + attribution. */
  targetKeyword: string | null;
  /** The rec's strategy card context — DERIVED from the rec's fields (the rec has no native
   *  StrategyCardContext column) so act-on can seed the content request losslessly. */
  strategyCardContext: StrategyCardContext;
  [key: string]: unknown;
}

function buildRecPayload(rec: Recommendation): RecommendationDeliverablePayload {
  return {
    family: 'recommendation',
    recommendationId: rec.id,
    recType: rec.type,
    insight: rec.insight,
    estimatedGain: rec.estimatedGain,
    targetKeyword: rec.targetKeyword ?? null,
    strategyCardContext: buildStrategyCardContextFromRec(rec),
  };
}

export const recommendationAdapter: DeliverableAdapter<RecommendationInput> = {
  type: 'recommendation',
  // A rec must carry the prose the client decides on. A rec with no insight/title is not a
  // sendable decision (mirrors cannibalization's targetKeyword guard).
  validateSendable: ({ rec }) => {
    if (!rec.id) return { ok: false, reason: 'recommendation has no id' };
    if (!rec.title?.trim() && !rec.insight?.trim()) {
      return { ok: false, reason: 'recommendation has no title or insight to present' };
    }
    return { ok: true };
  },
  // Single inline decision: the rec (insight + gain + targetKeyword + strategyCardContext) is the
  // sole item, riding in payload JSON. No typed child items (kind = 'decision').
  buildPayload: ({ rec }) => ({
    title: rec.title,
    summary: rec.insight,
    kind: 'decision',
    payload: buildRecPayload(rec),
    // externalRef ties the deliverable back to the rec for traceability.
    externalRef: rec.id,
  }),
  // Stable per-rec key: recommendation:<id>. A re-send of the same rec dedupes onto one row.
  sourceRef: ({ rec }) => (rec.id ? `recommendation:${rec.id}` : null),
  // apply opt-out — D-apply (respond-only). Greenlight is the act-on route (clientStatus → approved
  // + content request + TrackedAction); marking the work complete is a manual operator action. The
  // adapter does NOT implement respondToSource: the rec's clientStatus is the source of truth, and
  // the public act-on route is the single writer of it (NOT the deliverable respond path — a
  // rec-derived deliverable's respond is purely an inbox affordance; the canonical client decision
  // flows through POST /api/public/recommendations/:ws/:recId/act-on).
  applyDeliverable: applyDisabledStub,
};

registerAdapter(recommendationAdapter as DeliverableAdapter);
