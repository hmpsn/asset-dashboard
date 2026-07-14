// ── Action Catalog (R5-PR1) ─────────────────────────────────────────────────
//
// A READ-ONLY metadata registry keyed by (context, action). Modeled on
// BACKGROUND_JOB_METADATA's mapped-type shape (shared/types/background-jobs.ts:79)
// — `{ [K in Union]: Metadata }` — so a missing union member is a COMPILE error, not
// a runtime maintenance chore.
//
// THIS FILE NEVER MERGES, WIDENS, OR REDEFINES A UNION. It only IMPORTS the five
// source-of-truth unions and attaches presentation/provenance metadata to each member.
// `ScoringConfig = Record<ActionType, ScoringConfigEntry>` (shared/types/outcome-tracking.ts)
// is the concrete hazard: if this file ever declared its own broader ActionType-shaped
// union, a member added here-but-not-there would silently desync from ScoringConfig and
// every other exhaustive Record<ActionType, …> in the codebase. The owning files remain
// the single source of truth for values:
//   - ActionType                    → shared/types/outcome-tracking.ts
//   - RecType                       → shared/types/recommendations.ts
//   - ClientActionSourceType        → shared/types/client-actions.ts
//   - KeywordCommandCenterActionType → shared/types/keyword-command-center.ts
//   - MCP action verbs              → shared/types/mcp-action-schemas.ts and
//                                     shared/types/mcp-matrix-schemas.ts (NOT server/mcp/tools/*)
//
// Existing seam mappers (RecType → ActionType, ClientActionSourceType → ActionType,
// StrategySignal → RecType) are UNCHANGED by this file — the catalog documents their
// intent as metadata (`outcomeActionType`) but the mappers themselves remain the sole
// runtime authority:
//   - server/domains/recommendations/outcome-action-type.ts  (recommendationOutcomeActionType)
//   - server/domains/inbox/client-action-feedback-loop.ts    (OUTCOME_ACTION_TYPE_BY_SOURCE)
//   - server/domains/recommendations/finalization.ts         (signalToRecType)
//
// See docs/rules/action-catalog.md for the full contract, including the keep-marker
// provenance requirement and the historical/MCP-additive-only constraints.

import type { ActionType } from './outcome-tracking.ts';
import type { RecType } from './recommendations.ts';
import type { ClientActionSourceType } from './client-actions.ts';
import { KEYWORD_COMMAND_CENTER_ACTIONS } from './keyword-command-center.ts';

// ── Contexts ─────────────────────────────────────────────────────────────

/**
 * The bounded-context namespace an action belongs to. Each context keys into a
 * different source union — see the file header for the context → union map.
 */
export type ActionCatalogContext =
  | 'outcome'
  | 'recommendation'
  | 'client_action'
  | 'keyword_command_center'
  | 'mcp';

/**
 * Detect → Decide → Do → Prove is the platform's operating loop (see the Reconcile
 * migration overview). Every catalog entry is tagged with the phase its action
 * belongs to:
 *   - detect — a signal or opportunity is surfaced (insight, anomaly, recommendation minted)
 *   - decide — a human/agent chooses among options (send, throttle, strike, approve, decline)
 *   - do     — the platform or client executes the change (publish, deploy, refresh)
 *   - prove  — the outcome is measured/recorded (tracked_actions / action_outcomes rows)
 */
export type ActionCatalogPhase = 'detect' | 'decide' | 'do' | 'prove';

export interface ActionCatalogEntry {
  /** Canonical admin-facing label. Uses R1 word classes + docs/workflows/ui-vocabulary.md wording. */
  label: string;
  /** Which stage of the detect/decide/do/prove loop this action belongs to. */
  phase: ActionCatalogPhase;
  /**
   * When this action's completion is tracked as an outcome, the ActionType its
   * `tracked_actions` row is recorded under. Optional — not every action produces
   * a tracked outcome (e.g. a pure `decide`-phase MCP verb like `throttle`).
   * Cross-reference only: the seam mappers listed in the file header remain the
   * runtime authority for this mapping; this field documents intent for readers of
   * the catalog and is verified against the real ActionType union by the contract test.
   */
  outcomeActionType?: ActionType;
  /** Whether this action (or its result) is ever visible in the client portal. */
  clientVisible: boolean;
  /** One-line human note: producing surface, seam mapper reference, or historical-vocabulary tag. */
  note?: string;
}

// ── outcome context — every ActionType member (18) ──────────────────────────
//
// Keep-markers (topic_cluster_keep, content_gap_keep) are LIVE PRODUCER entries, not
// phantom/vestigial vocabulary — verified by grep + DB evidence in the R5 inventory
// (src/components/strategy/ContentGaps.tsx:149, TopicClusters.tsx:103) and pinned by
// tests/integration/strategy-managed-set-keep.test.ts. Never drop them from this catalog.

const OUTCOME_CATALOG = {
  insight_acted_on: {
    label: 'Insight Acted On',
    phase: 'prove',
    outcomeActionType: 'insight_acted_on',
    clientVisible: false,
    note: 'Recorded by recordInsightResolutionOutcome (server/outcome-tracking.ts) when an insight is resolved; also the resolve_insight MCP seam.',
  },
  content_published: {
    label: 'Content Published',
    phase: 'prove',
    outcomeActionType: 'content_published',
    clientVisible: true,
    note: 'Producer: server/domains/content/publish-post-to-webflow.ts.',
  },
  brief_created: {
    label: 'Brief Created',
    phase: 'prove',
    outcomeActionType: 'brief_created',
    clientVisible: false,
    note: 'Producer: server/content-brief-generation-job.ts.',
  },
  strategy_keyword_added: {
    label: 'Strategy Update',
    phase: 'prove',
    outcomeActionType: 'strategy_keyword_added',
    clientVisible: true,
    note: 'Producer: server/keyword-strategy-persistence.ts, server/outcome-measurement-keywords.ts. Implicit seam target of KCC add_to_strategy.',
  },
  schema_deployed: {
    label: 'Schema Deployed',
    phase: 'prove',
    outcomeActionType: 'schema_deployed',
    clientVisible: true,
    note: 'Producer: server/domains/schema/publish-schema-to-live.ts.',
  },
  audit_fix_applied: {
    label: 'Audit Fix',
    phase: 'prove',
    outcomeActionType: 'audit_fix_applied',
    clientVisible: true,
    note: 'Generic audit-fix family fallback for technical/performance/accessibility/aeo RecTypes — see recommendationOutcomeActionType.',
  },
  content_refreshed: {
    label: 'Content Refresh',
    phase: 'prove',
    outcomeActionType: 'content_refreshed',
    clientVisible: true,
    note: 'Producer: server/routes/content-decay.ts. Also the aeo_change/content_decay ClientActionSourceType seam target.',
  },
  internal_link_added: {
    label: 'Internal Link',
    phase: 'prove',
    outcomeActionType: 'internal_link_added',
    clientVisible: true,
    note: 'Producer: server/routes/webflow-analysis.ts. Also the internal_link ClientActionSourceType seam target.',
  },
  meta_updated: {
    label: 'Meta Update',
    phase: 'prove',
    outcomeActionType: 'meta_updated',
    clientVisible: true,
    note: 'Producer: server/domains/inbox/approval-batch-apply.ts (highest-volume local producer).',
  },
  voice_calibrated: {
    label: 'Voice Calibration',
    phase: 'prove',
    outcomeActionType: 'voice_calibrated',
    clientVisible: false,
    note: 'Producer: server/workspace-context-generation-job.ts.',
  },
  competitor_gap_closed: {
    label: 'Keyword Gap Closed',
    phase: 'prove',
    outcomeActionType: 'competitor_gap_closed',
    clientVisible: true,
    note: 'Outcome target for RecType keyword_gap and competitor (P4 competitor send).',
  },
  cluster_published: {
    label: 'Cluster Published',
    phase: 'prove',
    outcomeActionType: 'cluster_published',
    clientVisible: true,
    note: 'Outcome target for RecType topic_cluster.',
  },
  cannibalization_resolved: {
    label: 'Cannibalization Resolved',
    phase: 'prove',
    outcomeActionType: 'cannibalization_resolved',
    clientVisible: true,
    note: 'Outcome target for RecType cannibalization. Also the cannibalization ClientActionSourceType seam target.',
  },
  local_visibility_won: {
    label: 'Local Visibility Won',
    phase: 'prove',
    outcomeActionType: 'local_visibility_won',
    clientVisible: true,
    note: 'Outcome target for RecType local_visibility (SEO Gen-Quality P7.1).',
  },
  local_service_added: {
    label: 'Local Service Targeted',
    phase: 'prove',
    outcomeActionType: 'local_service_added',
    clientVisible: true,
    note: 'Outcome target for RecType local_service_gap (SEO Gen-Quality P7.1).',
  },
  topic_cluster_keep: {
    label: 'Topic Cluster Kept',
    phase: 'prove',
    outcomeActionType: 'topic_cluster_keep',
    clientVisible: false,
    note: 'LIVE keep-marker producer: src/components/strategy/TopicClusters.tsx (Keep button) via POST /api/outcomes/:ws/actions. Never scored as a win/loss outcome — exists to keep Record<ActionType,…> registries exhaustive and the managed-set state inferable. Pinned by tests/integration/strategy-managed-set-keep.test.ts.',
  },
  content_gap_keep: {
    label: 'Content Gap Kept',
    phase: 'prove',
    outcomeActionType: 'content_gap_keep',
    clientVisible: false,
    note: 'LIVE keep-marker producer: src/components/strategy/ContentGaps.tsx (Keep button) via POST /api/outcomes/:ws/actions. Never scored as a win/loss outcome. Pinned by tests/integration/strategy-managed-set-keep.test.ts.',
  },
  gbp_review_reply: {
    label: 'GBP Review Reply Published',
    phase: 'prove',
    outcomeActionType: 'gbp_review_reply',
    clientVisible: true,
    note: 'Reconcile R8-PR1 (B13) — SHIPS DARK. Producer: server/google-business-profile-review-response-publish-job.ts (runGbpReviewReplyPublishJob), recorded when updateGbpReviewReply succeeds. Cannot fire in production until Google API access opens; recording logic is verified now by tests. See docs/rules/outcome-engine-stubs.md.',
  },
} as const satisfies Record<ActionType, ActionCatalogEntry>;

// ── recommendation context — every RecType member (15) ──────────────────────

const RECOMMENDATION_CATALOG = {
  technical: {
    label: 'Technical Fix',
    phase: 'detect',
    outcomeActionType: 'audit_fix_applied',
    clientVisible: true,
  },
  content: {
    label: 'Content Recommendation',
    phase: 'detect',
    outcomeActionType: 'content_published',
    clientVisible: true,
  },
  content_refresh: {
    label: 'Content Refresh Recommendation',
    phase: 'detect',
    outcomeActionType: 'content_refreshed',
    clientVisible: true,
  },
  schema: {
    label: 'Schema Recommendation',
    phase: 'detect',
    outcomeActionType: 'schema_deployed',
    clientVisible: true,
  },
  metadata: {
    label: 'Metadata Recommendation',
    phase: 'detect',
    outcomeActionType: 'meta_updated',
    clientVisible: true,
  },
  performance: {
    label: 'Performance Fix',
    phase: 'detect',
    outcomeActionType: 'audit_fix_applied',
    clientVisible: true,
  },
  accessibility: {
    label: 'Accessibility Fix',
    phase: 'detect',
    outcomeActionType: 'audit_fix_applied',
    clientVisible: true,
  },
  strategy: {
    label: 'Strategy Recommendation',
    phase: 'detect',
    // Ambiguous by design: recommendationOutcomeActionType splits `strategy` between
    // content_published (source starts with 'strategy:content-gap') and insight_acted_on
    // (everything else) at RUNTIME based on `source`, not `type` alone. Documented here,
    // not re-encoded — the seam mapper is the single authority for this branch.
    clientVisible: true,
    note: 'Runtime-branches to content_published or insight_acted_on based on `source` — see recommendationOutcomeActionType.',
  },
  aeo: {
    label: 'AEO Recommendation',
    phase: 'detect',
    outcomeActionType: 'audit_fix_applied',
    clientVisible: true,
  },
  keyword_gap: {
    label: 'Keyword Gap Recommendation',
    phase: 'detect',
    outcomeActionType: 'competitor_gap_closed',
    clientVisible: true,
  },
  topic_cluster: {
    label: 'Topic Cluster Recommendation',
    phase: 'detect',
    outcomeActionType: 'cluster_published',
    clientVisible: true,
  },
  cannibalization: {
    label: 'Cannibalization Recommendation',
    phase: 'detect',
    outcomeActionType: 'cannibalization_resolved',
    clientVisible: true,
  },
  local_visibility: {
    label: 'Local Visibility Recommendation',
    phase: 'detect',
    outcomeActionType: 'local_visibility_won',
    clientVisible: true,
  },
  local_service_gap: {
    label: 'Local Service Gap Recommendation',
    phase: 'detect',
    outcomeActionType: 'local_service_added',
    clientVisible: true,
  },
  competitor: {
    label: 'Competitor Gap Recommendation',
    phase: 'detect',
    outcomeActionType: 'competitor_gap_closed',
    clientVisible: true,
    note: 'P4 competitor send (Lane C) — maps to the same outcome as keyword_gap.',
  },
} as const satisfies Record<RecType, ActionCatalogEntry>;

// ── client_action context — every ClientActionSourceType member (5) ─────────

const CLIENT_ACTION_CATALOG = {
  aeo_change: {
    label: 'AEO Change',
    phase: 'decide',
    outcomeActionType: 'content_refreshed',
    clientVisible: true,
    note: 'Seam: OUTCOME_ACTION_TYPE_BY_SOURCE (server/domains/inbox/client-action-feedback-loop.ts).',
  },
  internal_link: {
    label: 'Internal Link',
    phase: 'decide',
    outcomeActionType: 'internal_link_added',
    clientVisible: true,
    note: 'Seam: OUTCOME_ACTION_TYPE_BY_SOURCE (server/domains/inbox/client-action-feedback-loop.ts).',
  },
  redirect_proposal: {
    label: 'Redirect Proposal',
    phase: 'decide',
    outcomeActionType: 'audit_fix_applied',
    clientVisible: true,
    note: 'Seam: OUTCOME_ACTION_TYPE_BY_SOURCE (server/domains/inbox/client-action-feedback-loop.ts).',
  },
  content_decay: {
    label: 'Content Decay',
    phase: 'decide',
    outcomeActionType: 'content_refreshed',
    clientVisible: true,
    note: 'Seam: OUTCOME_ACTION_TYPE_BY_SOURCE (server/domains/inbox/client-action-feedback-loop.ts).',
  },
  cannibalization: {
    label: 'Cannibalization',
    phase: 'decide',
    outcomeActionType: 'cannibalization_resolved',
    clientVisible: true,
    note: 'Seam: OUTCOME_ACTION_TYPE_BY_SOURCE (server/domains/inbox/client-action-feedback-loop.ts).',
  },
} as const satisfies Record<ClientActionSourceType, ActionCatalogEntry>;

// ── keyword_command_center context — the 7 lifecycle verbs ──────────────────
//
// KEYWORD_COMMAND_CENTER_ACTIONS is a const object (not a TS union declaration), so
// completeness is enforced via `satisfies Record<KeywordCommandCenterActionType, …>`
// against its derived value type, imported below.

const KCC_CATALOG = {
  [KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY]: {
    label: 'Add to Strategy',
    phase: 'decide',
    outcomeActionType: 'strategy_keyword_added',
    clientVisible: false,
    note: 'Implicit seam: server/keyword-strategy-persistence.ts records strategy_keyword_added on this verb.',
  },
  [KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE]: {
    label: 'Promote to Tracked',
    phase: 'decide',
    clientVisible: false,
  },
  [KEYWORD_COMMAND_CENTER_ACTIONS.TRACK]: {
    label: 'Track Keyword',
    phase: 'decide',
    clientVisible: false,
  },
  [KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING]: {
    label: 'Pause Tracking',
    phase: 'decide',
    clientVisible: false,
  },
  [KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE]: {
    label: 'Retire Keyword',
    phase: 'decide',
    clientVisible: false,
  },
  [KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE]: {
    label: 'Decline Keyword',
    phase: 'decide',
    clientVisible: false,
  },
  [KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE]: {
    label: 'Restore Keyword',
    phase: 'decide',
    clientVisible: false,
  },
} as const satisfies Record<
  (typeof KEYWORD_COMMAND_CENTER_ACTIONS)[keyof typeof KEYWORD_COMMAND_CENTER_ACTIONS],
  ActionCatalogEntry
>;

// ── mcp context — wire-level action verbs from shared/types MCP schemas ──
//
// MCP action vocabulary is NOT a TypeScript union — it's inline `z.enum([...])` literals
// on the Zod input schemas (applyRecommendationInputSchema.action,
// acceptContentTemplateGenerationUpgradeInputSchema.decision, etc.), verified live in the
// shared/types MCP schema modules (NOT server/mcp/tools/* — those files only consume the
// schemas). Completeness for this context is checked by the contract test reading the real
// Zod schema `.options` at runtime rather than a `satisfies` mapped type (Zod enums don't
// produce an importable union alias here). Additive-only: 65 MCP tools + long-lived
// per-workspace API keys mean these keys must never be renamed once shipped.

const MCP_CATALOG: Record<string, ActionCatalogEntry> = {
  // applyRecommendationInputSchema.action — z.enum(['send', 'throttle', 'strike'])
  send: {
    label: 'Send to Client',
    phase: 'decide',
    clientVisible: true,
    note: 'applyRecommendationInputSchema.action — clientStatus → sent. Dispatched via server/mcp/tools/recommendation-actions.ts to the single-writer recommendation lifecycle.',
  },
  throttle: {
    label: 'Throttle Recommendation',
    phase: 'decide',
    clientVisible: false,
    note: 'applyRecommendationInputSchema.action — lifecycle → throttled for a fixed window (7/30/90 days).',
  },
  strike: {
    label: 'Strike Recommendation',
    phase: 'decide',
    clientVisible: false,
    note: 'applyRecommendationInputSchema.action — lifecycle → struck (permanently suppressed).',
  },
  // respondToClientActionInputSchema.status — z.enum(['approved','changes_requested','completed','archived','pending'])
  'respond_client_action:approved': {
    label: 'Approve Client Action',
    phase: 'decide',
    clientVisible: true,
  },
  'respond_client_action:changes_requested': {
    label: 'Request Changes on Client Action',
    phase: 'decide',
    clientVisible: true,
  },
  'respond_client_action:completed': {
    label: 'Complete Client Action',
    phase: 'do',
    clientVisible: true,
    note: 'Resolving (completed/approved) also updates the linked insight + outcome learning.',
  },
  'respond_client_action:archived': {
    label: 'Archive Client Action',
    phase: 'decide',
    clientVisible: false,
  },
  'respond_client_action:pending': {
    label: 'Reopen Client Action',
    phase: 'decide',
    clientVisible: false,
    note: 'Reopens a resolved client action back to pending.',
  },
  // respondToApprovalItemInputSchema — decline-only by design (an MCP agent may request
  // changes but may NEVER approve on the client's behalf; approval is the client's review
  // decision and triggers "approved" team emails). No `status` field on the wire schema.
  decline_approval_item: {
    label: 'Decline Approval Item',
    phase: 'decide',
    clientVisible: true,
    note: 'respondToApprovalItemInputSchema is decline-only by design — an MCP agent can never approve on the client\'s behalf.',
  },
  // acceptContentTemplateGenerationUpgradeInputSchema.decision — namespaced because
  // accept/reject are specific to the deterministic template-generation upgrade proposal.
  'template_generation_upgrade:accept': {
    label: 'Accept Template Generation Upgrade',
    phase: 'decide',
    clientVisible: false,
    note: 'Accepts the exact revision-bound deterministic proposal before any v1 contract write.',
  },
  'template_generation_upgrade:reject': {
    label: 'Reject Template Generation Upgrade',
    phase: 'decide',
    clientVisible: false,
    note: 'Rejects the proposal and returns a no-op response without changing the source template.',
  },
};

// ── the catalog ──────────────────────────────────────────────────────────────

export const ACTION_CATALOG = {
  outcome: OUTCOME_CATALOG,
  recommendation: RECOMMENDATION_CATALOG,
  client_action: CLIENT_ACTION_CATALOG,
  keyword_command_center: KCC_CATALOG,
  mcp: MCP_CATALOG,
} as const;

// ── accessors ────────────────────────────────────────────────────────────────

/**
 * Look up a single catalog entry by (context, action). Returns undefined for an
 * unknown action — callers must not assume every string resolves (e.g. historical
 * vocabulary tolerated by legacy-alias switches, like resolveWinTitle's 'post'/'content_post'
 * handling in server/routes/outcomes.ts, is intentionally NOT in this catalog).
 */
export function getActionCatalogEntry(
  context: ActionCatalogContext,
  action: string,
): ActionCatalogEntry | undefined {
  const contextCatalog = ACTION_CATALOG[context] as Record<string, ActionCatalogEntry> | undefined;
  return contextCatalog?.[action];
}
