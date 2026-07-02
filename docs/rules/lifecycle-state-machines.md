# Lifecycle State Machines — Envelope + Status-Union Census

> **Canonical authority:** the `*_TRANSITIONS` tables and `validateTransition()` in
> `server/state-machines.ts`. The shared **lifecycle envelope** (`LifecycleDefinition`,
> `LIFECYCLE_REGISTRY`, `registerLifecycle` in `shared/types/lifecycle.ts`) is a **typed
> view** over those tables — it never introduces a second source of truth. This doc records
> the envelope contract and the **census verdict** for every status-shaped union in the
> codebase.

## The envelope

Each `export const *_TRANSITIONS` table in `server/state-machines.ts` is wrapped once, at
module load, by `registerLifecycle({ entity, states, transitions })`. `states` is derived
from the table's own keys and `transitions` is the **identity-equal** table object, so the
envelope can never drift from the map `validateTransition` actually reads. Enforced by
`tests/contract/lifecycle-envelope.test.ts`:

- every `*_TRANSITIONS` export is registered (no table escapes the envelope);
- every registered definition's declared states exactly match its transition-map keys;
- every transition target is a declared state (targets ⊆ states) — with a documented
  two-axis exception for the recommendation pair (see below).

`validateTransition(entity, transitions, from, to)` is **4-arg** and **THROWS**
`InvalidTransitionError` on an illegal move (it returns the new status on success — it does
NOT return an error string). Do not change this signature: 36 call sites and the
guard-coverage contract test depend on it. DB-layer transition triggers are **deferred** —
see `docs/adr/0007-lifecycle-transition-guards-stay-app-layer.md`.

### Two-axis exception (R4 hard boundary)

The recommendation lifecycle is modeled as **two** registered definitions — the
operator/internal axis (`recommendation` = `RECOMMENDATION_TRANSITIONS`) and the
client-response axis (`client_recommendation` = `CLIENT_REC_TRANSITIONS`). The
`curated → sent` edge on the operator axis deliberately hands off to the client axis, where
`sent` lives, so the operator map is **not** internally closed on its own — its targets are
⊆ the *union* of both axes' states. This is the ratified two-axis model
(`docs/rules/strategy-recommendations.md`); the envelope registers it as a **faithful view
of the current single-writer edges only** and must not formalize, collapse, or otherwise
pre-empt it.

## Classification key

| Verdict | Meaning |
|---|---|
| **mapped-lifecycle** | An entity whose status column is mutated through legal transitions, and which already has a `*_TRANSITIONS` table + envelope registration. |
| **unmapped-lifecycle-candidate** | A genuine transition-driven lifecycle whose write path does **not** yet route through `validateTransition`. Gets a table in R3-PR2/PR3 (Task B3). |
| **classification** | NOT a lifecycle. A grade, health signal, lookup result, insert-only tag, or a **derived projection** of another entity's status. **Never** gets a transition table — out of scope forever. Mapping one would create the parallel-machine problem the envelope exists to prevent. |

---

## Mapped-lifecycle (16 registered entities)

Each row is an envelope-registered `*_TRANSITIONS` table in `server/state-machines.ts`.

| Entity (registry key) | Backing union(s) | Evidence |
|---|---|---|
| `approval_item` | `ApprovalItemStatus` | `APPROVAL_ITEM_TRANSITIONS`; pending↔approved↔applied / rejected guarded before approval-batch status writes. |
| `content_request` | `ContentRequestStatus`, shared `client-actions`/content pipeline | `CONTENT_REQUEST_TRANSITIONS`; 10-state content pipeline, admin fast-track forward guarded. |
| `post` | `PostStatus` | `POST_STATUS_TRANSITIONS`; generating→draft→review→approved with error recovery. |
| `work_order` | `WorkOrderStatus` | `WORK_ORDER_TRANSITIONS`; pending→in_progress→completed→closed, operator one-way close-out. |
| `content_subscription` | `ContentSubStatus` | `CONTENT_SUB_TRANSITIONS`; active/paused/past_due/pending, cancelled terminal. |
| `client_action` | `ClientActionStateStatus` (state-machines), `ClientActionStatus` (shared) | `CLIENT_ACTION_TRANSITIONS`; pending→approved/changes_requested/completed/archived. |
| `recommendation` | `RecStatus` / `RecommendationStateStatus` | `RECOMMENDATION_TRANSITIONS` — internal RecStatus axis + operator curation axis; two-axis (see above). **R4 boundary.** |
| `client_recommendation` | `ClientFacingClientStatus` | `CLIENT_REC_TRANSITIONS`; client act-on axis sent→approved/declined/discussing. **R4 boundary.** |
| `briefing_draft` | `BriefingDraftStatus` | `BRIEFING_DRAFT_TRANSITIONS`; draft→approved→published/skipped. |
| `background_job` | `BackgroundJobStatus` | `BACKGROUND_JOB_TRANSITIONS`; pending→running→done/error/cancelled, terminals never reopen. |
| `gbp_review_response` | `GbpReviewResponseStatus` / `GbpReviewResponseStateStatus` | `GBP_REVIEW_RESPONSE_TRANSITIONS`; draft→awaiting_client→approved→publishing→published, resend self-edge. |
| `client_deliverable` | `DeliverableStatus` (`client-deliverable.ts` spine) | `CLIENT_DELIVERABLE_TRANSITIONS` + `getDeliverableTransitions(type)` per-type overrides (unified send-to-client spine). |
| `matrix_cell` | `MatrixCellStatus` | `MATRIX_CELL_TRANSITIONS`; content-plan grid, client-flag edges from review/approved/published. |
| `client_request` | `RequestStatus` / `RequestTransitionStatus` | `REQUEST_TRANSITIONS`; support-ticket flow, closed terminal (forbids closed→new). |
| `schema_plan` | `SchemaPlanStatus` (`SchemaSitePlan['status']`) | `SCHEMA_PLAN_TRANSITIONS`; draft→sent_to_client→client_approved→active, admin reset. |
| `tracked_keyword` | `TrackedKeywordStatus` / `TrackedKeywordTransitionStatus` | `TRACKED_KEYWORD_TRANSITIONS`; active/paused/deprecated/replaced; **note** the `rank-tracking-reconciliation.ts` `replaced` write currently bypasses the guard (routed through `validateTransition` in B3). |

---

## Unmapped-lifecycle-candidate (get a table in R3-PR2 / PR3 — Task B3)

Genuine transition-driven lifecycles whose write path does not yet route through
`validateTransition`. **In scope for B3, not this PR (B2).** The two `⚠ parallel` rows are
existing standalone validators that "never build parallel" requires **folding** into
`state-machines.ts`, not merely mapping.

| Union / entity | Where | Evidence |
|---|---|---|
| `CopySectionStatus` ⚠ parallel | `shared/types/copy-pipeline.ts`; `server/copy-review.ts` `VALID_TRANSITIONS`/`isValidTransition` (:210–219) | Real pending→draft→client_review→approved machine, but enforced by a **local** validator — fold into state-machines.ts (B3-PR2). |
| `VoiceProfileStatus` ⚠ parallel | `shared/types/brand-engine.ts`; `server/voice-calibration.ts` `LEGAL_STATUS_TRANSITIONS` + own `VoiceProfileStateTransitionError` (:120–165) | draft→calibrating→calibrated machine with its **own** error class — fold into the envelope (B3-PR2). |
| `ExtractionStatus` | `shared/types/brand-engine.ts` (discovery extractions) | pending→accepted/dismissed lifecycle; write path unguarded (B3-PR3). |
| `ClientSignalStatus` | `shared/types/client-signals.ts`; `client-signals-store.ts` | new→reviewed→actioned; unguarded status writes (B3-PR3). |
| insight `resolution_status` | `shared/types/analytics.ts` insight store; `analytics-insights-store.ts`, `routes/insights.ts`, MCP insights tools | 852 rows live (838 NULL / 14 in_progress); re-resolve currently silently accepted — needs guard + idempotent self-edge + `InvalidTransitionError`→409 (B3-PR3). |
| `BlueprintStatus` | `shared/types/page-strategy.ts`; `page-strategy.ts` (:92 mid-clause write) | draft→active→archived; unguarded (B3-PR3). |
| `DiagnosticStatus` | `shared/types/diagnostics.ts`; `diagnostic-store.ts` (:49/156 literal writes) | pending→running→completed/failed; unguarded (B3-PR3). |
| `DiscoveredQueryStatus` | `shared/types/local-seo.ts`; `client-discovered-queries.ts` (:62 literal write) | discovered-query triage lifecycle; unguarded (B3-PR3). |
| `ClientLocationStatus` | `shared/types/local-seo.ts`; `client-locations.ts` | location lifecycle; candidate for a guard (B3-PR3, or documented exemption). |
| seo-suggestion status | `seo-suggestions.ts` (:160/171/178 literal writes), `schema-queue.ts` (:46) | suggestion/pending-schema lifecycle; re-dismiss a dismissed suggestion currently tolerated — needs self-edge (B3-PR3). |
| suggested-brief status | `suggested-briefs-store.ts` (:69 literal write) | suggested-brief triage lifecycle; unguarded (B3-PR3). |
| `BrandDeliverableStatus` | `shared/types/brand-engine.ts`; `brand-identity.ts` (:29 mid-clause write) | draft→approved brand-deliverable lifecycle; candidate for a guard (B3-PR3). |

> The 17th parallel machine (`server/copy-review.ts` `VALID_TRANSITIONS`) and the
> voice-calibration validator are called out above with the ⚠ marker. **Folding them is
> B3's job, not B2's** — this census only records that they exist and must not remain
> parallel.

---

## Classification (NOT lifecycles — out of scope forever)

Grades, health signals, lookup/operation results, insert-only tags, and **derived
projections** of another entity's status. These never get a transition table. Mapping any of
them would fabricate a parallel machine.

| Union | Where | Why it is a classification |
|---|---|---|
| `ContentTermCoverageStatus` | `shared/types/content.ts` | Coverage **grade** (strong/partial/weak/unavailable) — computed, not transitioned. |
| `IntegrationQuotaStatus` | `shared/types/integration-health.ts` | Quota **health** (ok/warning/critical/unknown) — a signal, not a lifecycle. |
| `SchemaValidationStatus` | `shared/types/schema-generation.ts` | Validation **result** (valid/warnings/errors) — a grade. |
| `SchemaDeliveryStatus` | `shared/types/schema-generation.ts` | Delivery **readiness** grade (ready/published/manual-required/failed) — derived from schema state, not a guarded lifecycle. |
| `SchemaFieldResolutionStatus` | `shared/types/site-inventory.ts` | Per-field **resolution result** (resolved/skipped-*/fallback-used) — a computed outcome. |
| `DeliverableStatusAxis` | `shared/types/admin-deliverable-view.ts` | Admin **view axis** over deliverable status — a projection, not a mutated column. |
| `ClientRequestStatus` | `shared/types/requests.ts` | **Derived projection** of admin `RequestStatus` into a client-facing view (comments prove the mapping) — not independently transitioned. |
| `KeywordCommandCenterStatus` | `shared/types/keyword-command-center.ts` | **Derived** command-center classification of a keyword's position — computed from strategy/tracking, not a guarded column. |
| `KeywordFeedbackStatus` | `shared/types/keyword-feedback.ts` | Feedback **tag**; enforced (where relevant) by a value-enum `CHECK` (migrations 020/029), not a transition. |
| `LocalSeoMarketStatus` | `shared/types/local-seo.ts` | active/inactive/needs_review — **insert-only** at HEAD (no status-update path); a classification tag despite looking lifecycle-shaped. |
| `LocalVisibilityStatus` | `shared/types/local-seo.ts` | Visibility **run outcome** (success/degraded/provider_failed/skipped) — a result grade. |
| `LocalSeoLocationLookupStatus` | `shared/types/local-seo.ts` | Location **lookup result** — a computed outcome, not a mutated column. |
| `PageEditStatus` | `shared/types/workspace.ts` (dup in `src/components/ui/statusConfig.ts`) | A **priority lattice** (clean … live), not a transition map; local dev has out-of-union values — normalization is a separate data-hygiene follow-up, not a guard. |
| `GbpConnectionStatus` | `shared/types/google-business-profile.ts` | OAuth/connection **health** — an integration signal. |
| `GbpLocationSyncStatus` | `shared/types/google-business-profile.ts` | Sync **availability** classification (available/…). |
| `GbpReviewSyncStatus` | `shared/types/google-business-profile.ts` | Review-sync **result** classification. |
| `ActionStatus` (server-local) | `server/reports.ts` | Report **rollup** of action progress (planned/in-progress/completed) — a derived summary. |
| `CreditBudgetStatus` (server-local) | `server/credit-budget-gate.ts` | Budget **health** gate (ok/warning/critical) — a signal. |
| `OperationTraceStatus` (server-local) | `server/platform-observability.ts` | Trace **outcome** (success/error/warning) — an observability grade. |
| `GetJobStatusInput`, `AdvanceContentStatusInput` | `shared/types/mcp-action-schemas.ts` | Zod `z.infer` **input** types (not status unions) — excluded from the census entirely. |

---

## Census counts

| Verdict | Count |
|---|---|
| mapped-lifecycle | 16 registered entities |
| unmapped-lifecycle-candidate | ~13 (incl. 2 parallel validators to fold) — addressed in B3 |
| classification (never a lifecycle) | ~18 (17 status unions + 2 zod input types excluded) |

Source of truth for the raw union inventory: the R3 section of
`docs/superpowers/audits/2026-07-01-reconcile-plan-audit-inventories.json`
(`grep 'export type *Status' shared/types` → 34 exported, + 3 server-local; the ~37 figure
includes the server-local unions). Verdicts + evidence above are grep-verified at authoring
time; re-derive from the source files before acting on a row.
