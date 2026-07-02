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

## Mapped-lifecycle (27 registered entities)

Each row is an envelope-registered `*_TRANSITIONS` table in `server/state-machines.ts`.
The first 16 arrived with the envelope (B2, R3-PR1); the 11 marked **(R3-PR2)** were
added in Task B3 — folding the two parallel validators and guarding the previously
unguarded lifecycle write paths.

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
| `tracked_keyword` | `TrackedKeywordStatus` / `TrackedKeywordTransitionStatus` | `TRACKED_KEYWORD_TRANSITIONS`; active/paused/deprecated/replaced. **(R3-PR2)** the `rank-tracking-reconciliation.ts` `replaced`/`deprecated` write is now routed through `validateTransition('tracked_keyword', …)` in the reconcile mutator (the documented bypass is closed). |
| `copy_section` **(R3-PR2)** | `CopySectionStatus` | `COPY_SECTION_TRANSITIONS`; **folded** from `copy-review.ts` `VALID_TRANSITIONS`/`isValidTransition`. pending→draft→client_review→{approved\|revision_requested}→draft. Guard in `updateSectionStatus`/`saveGeneratedCopy` catches `InvalidTransitionError` and returns null (route → 404) to preserve the historical contract. `isValidTransition` is now a thin boolean wrapper over the shared table. |
| `voice_profile` **(R3-PR2)** | `VoiceProfileStatus` | `VOICE_PROFILE_TRANSITIONS`; **folded** from `voice-calibration.ts` `LEGAL_STATUS_TRANSITIONS`. draft→calibrating→calibrated; **draft→calibrated is FORBIDDEN**. `VoiceProfileStateTransitionError` is preserved (route handlers catch it by class); the guard translates the shared `InvalidTransitionError` into it. |
| `insight_resolution` **(R3-PR2)** | `AnalyticsInsight['resolutionStatus']` (`in_progress`\|`resolved`\|`null`) | `INSIGHT_RESOLUTION_TRANSITIONS`; NULL current status is coerced to the synthetic `unresolved` origin in `resolveInsight()` so a null-origin never crashes the validator (838 NULL rows in dev). unresolved→{in_progress\|resolved}, in_progress→resolved, resolved→in_progress (reopen, kept legal). Idempotent re-resolve is a call-site no-op. Route→409, MCP single→tool error, MCP bulk→per-item `rejected` skip-and-report. |
| `discovery_extraction` **(R3-PR2)** | `ExtractionStatus` | `EXTRACTION_TRANSITIONS`; pending→{accepted\|dismissed} (terminals). Guard in `updateExtractionStatus`; route→409. |
| `suggested_brief` **(R3-PR2)** | `SuggestedBrief['status']` | `SUGGESTED_BRIEF_TRANSITIONS`; pending→{accepted\|dismissed\|snoozed}, snoozed→{accepted\|dismissed\|pending}. Guard in `updateSuggestedBrief`/`snoozeSuggestedBrief`; route→409. |
| `seo_suggestion` **(R3-PR2)** | seo-suggestions inline union | `SEO_SUGGESTION_TRANSITIONS`; pending→{applied\|dismissed}. **Bulk `WHERE id IN` writes** guarded per-row by `legalSuggestionIdsForTarget()` — reads each row's status, drops idempotent no-ops AND illegal moves (re-apply a dismissed suggestion) with a warn, never throws (batch-safe skip-and-report). |
| `client_signal` **(R3-PR2)** | `ClientSignalStatus` | `CLIENT_SIGNAL_TRANSITIONS`; new/reviewed/actioned **fully reversible** — the admin route deliberately allows backward undo, so the map models the whole reversible triage graph (its job is rejecting out-of-union values, not imposing a forward-only pipeline). Guard in `updateSignalStatus`; route→409. |
| `blueprint` **(R3-PR2)** | `BlueprintStatus` | `BLUEPRINT_TRANSITIONS`; draft↔active↔archived. Guarded only on actual status change in `updateBlueprint` (general multi-field update carries status through unchanged on name/notes edits). Route maps `InvalidTransitionError`→409 via `runWorkspaceMutation` `mapError`. |
| `brand_deliverable` **(R3-PR2)** | `BrandDeliverableStatus` | `BRAND_DELIVERABLE_TRANSITIONS`; draft↔approved. Guarded in `setDeliverableStatus` only on change (re-approval is short-circuited before the guard); route→409. |
| `client_location` **(R3-PR2)** | `ClientLocationStatus` | `CLIENT_LOCATION_TRANSITIONS`; needs_review↔confirmed. Guarded only on change in `updateClientLocation`; route→409. |

> **Idempotency & terminals are enforced at the write boundary, not with self-edges.**
> The graph-contract test (`tests/unit/state-machine-graph-contract.test.ts`) forbids
> self-transitions in its pinned maps, so idempotent replays (re-resolve a resolved
> insight, re-set an unchanged status) are handled by callers skipping the guard when
> `from === to` — the maps themselves have **no self-edges**. Cyclic maps with no
> terminal state (`voice_profile`, `insight_resolution`, `blueprint`,
> `brand_deliverable`, `client_location`, `client_signal`) are envelope-registered
> but intentionally **excluded from the graph-contract's terminal-requiring pinned list**.

---

## Unmapped-lifecycle-candidate — RESOLVED in R3-PR2 (Task B3)

Every genuine transition-driven lifecycle from B2's census work list has now been either
(a) **mapped + guarded** (moved to the mapped table above), or (b) recorded as a
**documented exemption** (below, with rationale). The two `⚠ parallel` validators were
**folded** into `state-machines.ts`, not merely mapped:

| Union / entity | Disposition in R3-PR2 |
|---|---|
| `CopySectionStatus` ⚠ parallel | **Folded** → `COPY_SECTION_TRANSITIONS` (mapped). Local `VALID_TRANSITIONS` deleted. |
| `VoiceProfileStatus` ⚠ parallel | **Folded** → `VOICE_PROFILE_TRANSITIONS` (mapped). Local `LEGAL_STATUS_TRANSITIONS` deleted; `VoiceProfileStateTransitionError` preserved. |
| insight `resolution_status` | **Mapped** → `INSIGHT_RESOLUTION_TRANSITIONS` with `unresolved` synthetic null-origin. |
| `ExtractionStatus` | **Mapped** → `EXTRACTION_TRANSITIONS`. |
| `ClientSignalStatus` | **Mapped** → `CLIENT_SIGNAL_TRANSITIONS` (reversible triage). |
| `BlueprintStatus` | **Mapped** → `BLUEPRINT_TRANSITIONS`. |
| `SuggestedBrief['status']` | **Mapped** → `SUGGESTED_BRIEF_TRANSITIONS`. |
| seo-suggestion status | **Mapped** → `SEO_SUGGESTION_TRANSITIONS` (per-row bulk guard). |
| `PendingSchema` status | **Mapped** → `PENDING_SCHEMA_TRANSITIONS` (WHERE-clause-enforced write is exempt-hatched; see below). |
| `BrandDeliverableStatus` | **Mapped** → `BRAND_DELIVERABLE_TRANSITIONS`. |
| `ClientLocationStatus` | **Mapped** → `CLIENT_LOCATION_TRANSITIONS`. |
| `DiagnosticStatus` | **Documented exemption** (internal orchestrator + crash-recovery sweep). |
| `DiscoveredQueryStatus` | **Documented exemption** (WHERE-clause-enforced cron detector). |
| `copy_batch_jobs` status | **Documented exemption** (job-progress mirror of the guarded background job). |
| payments status | **Documented exemption** (Stripe-owned external lifecycle). |

---

## Exemption registry (documented `// status-ok` / `-- status-ok` hatches)

These status columns are NOT platform-guarded lifecycles. Each carries an inline hatch
with a rationale that points here. Mapping any of them would fabricate a parallel machine
or fight a crash-recovery / external-authority path.

| Column / write | Where | Why it is exempt (not a guarded lifecycle) |
|---|---|---|
| `diagnostic_reports.status` | `diagnostic-store.ts` (`updateStatus`, `updateCompleted`, `recoverStuckDiagnosticReports`) | Internal-orchestrator-only progress tracker (pending→running→completed/failed). No route/client exposure. The startup **crash-recovery sweep** forces any `running`/`pending`→`failed` after a restart — a transition guard can't model "the process died mid-run". |
| `discovered_queries.status` | `client-discovered-queries.ts` (`markLost`, upsert revive) | Cron-driven **bulk detector**; the `WHERE status = 'active'` clause structurally enforces the only legal origin (active→lost_visibility). Upsert always re-sets `active` (revive). No per-row id read path. |
| `copy_batch_jobs.status` | `copy-batch-jobs.ts` (`updateStatus`) | Job-progress **mirror** of the real background job (which IS guarded via `updateJob` → `BACKGROUND_JOB_TRANSITIONS`). Records running/complete/failed with a catch-any→failed crash path. |
| `payments.status` | `payments.ts` (`update`) | **Stripe-owned** external lifecycle (pending→paid/failed/refunded). Stripe/webhook is the authority for the legal order; this is an idempotent upsert-of-record. |
| `pending_schemas.status` | `schema-queue.ts` (`markStaleByCellId`) | Only status write at HEAD; the `WHERE status = 'pending'` clause structurally enforces the sole legal origin (pending→stale). Cell-scoped bulk write, no per-row id to read. (The map exists for the future `applied` writer.) |
| `google_business_review_reply_publish_attempts.status` | `google-business-profile-review-responses-store.ts` (`markAttemptDone`, `markAttemptFailed`) | Provider-attempt/job tracker (running→done/failed), separate from the guarded `gbp_review_response` lifecycle. |
| `approval_batches.status` | `approvals.ts` (`update`) | **Derived aggregate** of item statuses (recomputed in `recalcBatchStatus`). The guarded machine is the *item* transition (`APPROVAL_ITEM_TRANSITIONS`). |
| Guarded-store write hatches | `requests.ts`, `brand-identity.ts` (`updateContent`), `copy-review.ts` (`updateSectionText`/`updateSectionClientSuggestions`), the GBP response `mark*` stmts | Not exemptions from guarding — the guard runs in the calling store function *before* the SQL write; the hatch documents that the SQL line itself is downstream of a `validateTransition`. |

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
| mapped-lifecycle | 27 registered entities (16 from B2 + 11 from B3-R3-PR2) |
| documented exemption | 7 (diagnostic, discovered-query, copy-batch-job, payments, pending-schema, gbp-reply-attempt, approval-batch-aggregate) |
| classification (never a lifecycle) | ~18 (17 status unions + 2 zod input types excluded) |

Source of truth for the raw union inventory: the R3 section of
`docs/superpowers/audits/2026-07-01-reconcile-plan-audit-inventories.json`
(`grep 'export type *Status' shared/types` → 34 exported, + 3 server-local; the ~37 figure
includes the server-local unions). Verdicts + evidence above are grep-verified at authoring
time; re-derive from the source files before acting on a row.
