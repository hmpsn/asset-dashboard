# MCP Matrix + Brand Deliverable Generation — Implementation Plan

> Controller plan. Every implementation PR starts from then-current
> `origin/staging`, targets `staging`, and ships one phase only. Read the
> [spec](../specs/2026-07-13-mcp-matrix-brand-generation-spec.md),
> [pre-plan audit](../audits/2026-07-13-mcp-matrix-brand-generation-preplan-audit.md),
> [cross-phase contracts](./2026-07-13-mcp-matrix-brand-generation-contracts.md),
> and [durable rule](../../rules/mcp-deliverable-generation.md) before coding.

**Goal:** turn a durable brand intake into reviewed brand foundations, then turn
explicit content-matrix cells into grounded, locked, audited page drafts through
bounded MCP-driven runs. Automatic work stops at `ready_for_human_review`;
explicit approval can advance the workflow to `ready_to_publish`, and publication
remains a separate human-authorized action.

## Execution discipline

Every task follows the same loop: read real types/signatures; write and run a
test that fails for the intended reason; implement the smallest compatible
change; rerun the focused test and typecheck; review the complete diff; run the
phase gates. Never transcribe implementation bodies from this plan.

Shared contracts, migration numbers, feature flags, event constants, tool
registry entries, barrels, roadmap, and generated rules are controller-owned.
Parallel lanes get exclusive files. If a lane needs an unowned shared file, it
stops with `NEEDS_CONTEXT`; the controller lands the contract and redispatches.

The prerequisite planning/S0 security PR merged before implementation began.
P0 is implemented on this branch; every later implementation phase ships as a
separate phase-per-PR branch from then-current `origin/staging` after P0 merges
with green CI.

## Bounded contexts and canonical decisions

| Lane | Primary owner | Secondary seams | Model |
|---|---|---|---|
| Controller / MCP runtime | `platform-foundation` | all tools/jobs | GPT-5.5 |
| Matrix generation | `content-pipeline` | brand, intelligence, MCP/jobs | GPT-5.5; deterministic preflight tasks GPT-5.4 |
| Brand generation | `brand-engine` | intelligence, MCP/jobs | GPT-5.5 |
| Brand review | `inbox` | brand, client portal | GPT-5.4 |
| Client projection | `client-portal` | brand, Inbox | GPT-5.4 |
| pSEO creation bridge | `content-pipeline` | SEO health/page strategy | GPT-5.4 |

Canonical page artifact: the existing `ContentBrief` → `GeneratedPost` path.
The current copy-batch service is useful precedent but is not a second matrix
generator. Canonical client review: unified `ClientDeliverable`. Canonical voice
authority: a genuinely finalized `VoiceProfile`, with approved identity selected
per page type.

## Exact dependency graph

```text
S0 scoped-key alias security fix + planning artifacts (merged prerequisite)
  └─ P0 shared program contracts + two reserved rollout flags
      └─ R1 MCP registry/execution-context hardening
          ├─ M0 matrix revisions + run ledger + structural resolution/reads
          └─ B0 durable typed intake

External generation-quality program (same-date program plan):
  G1 / genq-ai-execution-governance (merged)
  C2 / genq-content-generation-integrity phase B (pending)
    └─ C3 / genq-content-context-v2 (pending exact-once voice/evidence)

B0 ── B1 real voice-finalization service ── B2 voice-bootstrap/pause/resume + dependent brand suite
                                             └─ B3 Inbox review + client projection

M0 + B1 + C2 + C3 ── M1 generation-ready preview + one-cell artifact closure
                         └─ M2 audit + bounded revision
                             └─ M3 durable bounded batch + MCP + repaired UI

M3 ── M4 pSEO/blueprint-to-matrix creation bridge
B3 + M3 ── O1 resumable intake→brand→content orchestration
M4 + O1 ── R2 staging canary, docs/roadmap closeout, flag exit evidence
```

`M0 ∥ B0` may run after R1. `M4 ∥ B3` may run after their independent
dependencies. Every sibling rebases and reruns gates after the other merges.
The imported G1/C2/C3 owners and acceptance criteria are defined in
[`2026-07-13-generation-quality-performance-program.md`](./2026-07-13-generation-quality-performance-program.md);
this program consumes their merged exports and does not reimplement them.

## Locked cross-phase implementation seams

The controller precommits these exports before dispatch. A phase may add private
helpers inside its owned directory but may not rename or duplicate a locked seam.

| Phase | Shared exports / tables | Domain exports | HTTP / MCP surface |
|---|---|---|---|
| P0 | `MatrixSourceRevision`, `ResolvedMatrixStructuralTarget`, `MatrixGenerationPreviewTarget`, `ResolvedPageBlockManifest`, `MatrixArtifactRevisionExpectations`, `ResolveMatrixGenerationEvidenceRequest`, `RetryMatrixGenerationRequest`, `GenerationEvidenceRequirement`, `GenerationEvidenceResolution`, `BrandGenerationAtomicTarget`, `BRAND_DELIVERABLE_TARGET_POLICY`, `BRAND_GENERATION_PRESET_POLICY`, `MatrixGenerationRun`, `BrandGenerationRun`, `BrandReviewItemDecision`, `BrandContentOnboardingRun` | shared status/policy registries only; transition tables land with each first persisted writer | two OFF flag catalog entries |
| R1 | `McpToolDefinition`, `McpToolExecutionContext`, `McpToolErrorEnvelope` | `MCP_TOOL_REGISTRY`, `getDeclaredWorkspaceField()`, `executeMcpTool()` | existing `/mcp`; no product tool yet |
| M0 | revisions on `content_matrices`/`content_templates`; cell `revision`; `content_matrix_generation_runs`, `_items`, `_attempts`; `content_matrix_cell_evidence` | `resolveMatrixStructure()`, `acceptTemplateGenerationUpgrade()`, `createMatrixGenerationRun()`, `listMatrixGenerationItems()` | `POST /api/content-templates/:workspaceId/:templateId/accept-generation-upgrade`; MCP `list_content_matrices`, `get_content_matrix`, `resolve_content_matrix_cells`, `accept_content_template_generation_upgrade` |
| B0 | `brand_intake_revisions` | `submitBrandIntake()`, `getBrandIntakeRevision()`, `resolveBrandIntakeEvidence()` | existing `POST /api/public/onboarding/:id`; `GET /api/brand-intake/:workspaceId`; `POST /api/brand-intake/:workspaceId/:revisionId/evidence-resolutions`; MCP `get_brand_intake`, `resolve_brand_intake_evidence` |
| B1 | voice anchor/finalization persistence selected against current migration head | `finalizeBrandVoice()`, `getBrandVoiceReadiness()` | `POST /api/voice/:workspaceId/finalize`; MCP `get_brand_voice`, `finalize_brand_voice` |
| B2 | `brand_generation_runs`, `_items`, `_attempts` | `startBrandGeneration()`, `resumeBrandGeneration()`, `getBrandGeneration()`, `reviseBrandGenerationItem()` | `/api/brand-generation/:workspaceId/runs[/:runId]`; `/resume`; `/items/:itemId/revisions`; four matching MCP actions |
| M1 | M0 ledger/evidence store only; no new history blob | `previewMatrixGeneration()`, `generateMatrixCell()`, `resolveContentMatrixEvidence()` | `POST /api/content-matrices/:workspaceId/:matrixId/generation-preview`; `PATCH /api/content-matrices/:workspaceId/:matrixId/cells/:cellId/evidence/:requirementId`; MCP `preview_content_matrix_generation`, `resolve_content_matrix_evidence` |
| M2 | typed item audit/attempt snapshot in M0 ledger | `auditMatrixGenerationItem()`, `reviseMatrixGenerationItem()` | no new public route/tool |
| M3 | M0 ledger extended with batch selection/set findings and page-review evidence | `startContentMatrixGenerationRun()`, `getContentMatrixGenerationRun()`, `retryContentMatrixGenerationRun()`, `auditMatrixGenerationSet()`, `approveMatrixPageForPublishReadiness()` | `POST /api/content-matrices/:workspaceId/:matrixId/generation-runs`; `GET .../generation-runs/:runId`; `POST .../:runId/retry`; `POST .../:runId/items/:itemId/review-approval`; matching start/get/retry MCP actions; approval remains human HTTP action |
| B3 | `brand_generation` in `DELIVERABLE_TYPES`; typed per-item decisions | `createBrandReviewDeliverable()`, `applyBrandReviewDecision()`, `getClientBrandSummary()` | existing deliverable send/respond routes; authenticated `GET /api/public/brand-summary/:workspaceId` |
| M4 | existing blueprint/matrix source refs | `createMatrixFromPseoPlan()` | `POST /api/page-strategy/:workspaceId/:blueprintId/entries/:entryId/content-matrix`; MCP `create_content_matrix_from_pseo_plan`; generation stays separate |
| O1 | `brand_content_onboarding_runs` | `startBrandContentOnboarding()`, `getBrandContentOnboarding()`, `resumeBrandContentOnboarding()` | `/api/brand-content-onboarding/:workspaceId/runs[/:runId]`; three matching MCP actions |

Route modules remain thin HTTP adapters. MCP handlers call these domain exports
directly and never loop back through HTTP.

### Query keys and events

Controller-owned additions to `src/lib/queryKeys.ts` are exact:

- `queryKeys.admin.contentMatrixGeneration(workspaceId, runId)`;
- `queryKeys.admin.brandIntake(workspaceId)`;
- `queryKeys.admin.brandGeneration(workspaceId, runId)`;
- `queryKeys.client.brandSummary(workspaceId)`.

Reuse the existing `queryKeys.admin.contentMatrices`, `briefs`, `posts`,
`voiceProfile`, `brandIdentity`, `workspaceDeliverables`, and
`queryKeys.client.unifiedInbox` keys. Reuse registered `WS_EVENTS.CONTENT_UPDATED`,
`BRIEF_UPDATED`, `POST_UPDATED`, `WORKSPACE_UPDATED`,
`BRAND_IDENTITY_UPDATED`, `VOICE_PROFILE_UPDATED`,
`DELIVERABLE_SENT`, `DELIVERABLE_UPDATED`, `JOB_CREATED`, and `JOB_UPDATED`.
B0 emits `WORKSPACE_UPDATED` with a typed intake-revision payload and adds the
matching admin `brandIntake`/intelligence invalidation. No new event is currently
authorized. Any later proof that the existing events cannot express a committed
domain change requires a cross-contract amendment before code. Event
constants and handlers update `server/ws-events.ts`, `src/lib/wsEvents.ts`, and
`src/lib/wsInvalidation.ts` together; no inline event literal is authorized.

## Phase S0 — MCP workspace-scope correctness (immediate, unflagged)

**Status on this branch:** implemented and focused tests green.

- Authorize against the workspace argument declared by the called tool schema,
  not the first raw alias present.
- Reject conflicting non-empty `workspaceId`/`workspace_id` for every key.
- Reject fake workspace fields on global tools for scoped keys.
- Regression-test representative camel read, snake write, job start, global
  decoy, equal aliases, cross-workspace aliases, and master conflict.

Acceptance: scoped keys cannot make authorization and handler validation consume
different workspace values; MCP auth/routing tests and typecheck pass.

## Phase P0 — Program contracts and rollout registration

**Owner:** controller. **Depends:** S0 merged.

**Status on this branch:** implemented; final CI-equivalent verification pending.

Exclusive ownership: new
`shared/types/{matrix-generation,generation-evidence,brand-intake,brand-generation,brand-content-onboarding}.ts`,
additive changes to
`shared/types/{content,brand-engine,feature-flags,index}.ts`,
shared barrels, lifecycle/flag contract tests, compatibility-only exhaustive
`naming` vocabulary and closed-boundary updates in `server/brand-identity.ts`,
the existing `server/routes/brand-identity.ts` adapter, `src/api/brand-engine.ts`,
`src/components/brand/IdentityTab.tsx`,
`src/components/brand-ai-rebuilt/BrandAiSurface.tsx`,
and focused tests, plus roadmap and rule/spec/plan amendments. Compatibility
keeps the durable label/instructions readable while the legacy generate/refine
service, HTTP schema, API payload, generator census, rendered tier/action, and
stale focused-UI input all reject `naming` before B2. Must not add new endpoints,
workers, AI dispatches, generation UI actions, migrations, or background-job
constants before their owning worker phase can satisfy the job census.

1. Treat the detailed user request as authoritative because the referenced
   external operations notes are unavailable locally. Their absence is
   non-blocking. If they become available, reconcile them and amend the
   spec/plan/contracts before implementing a newly conflicting requirement.
2. Add `content-matrix-generation` and `brand-deliverable-generation` as reserved
   OFF server/workspace flags with roadmap IDs, owners, rollout targets, and
   dated removal conditions. Do not add a composite orchestration flag.
3. Precommit the exact types named in the cross-phase contract, including
   `MatrixSourceRevision`, separate structural/ready matrix targets,
   `ResolvedPageBlockManifest`, `BrandGenerationAtomicTarget`, evidence
   requirement stages, exact brief/post CAS, cell-addressed evidence resolution,
   authorized retry/replace, run/item statuses, per-item brand review decisions,
   and typed onboarding gate evidence; add status/policy census tests before consumers.
   Do not register transition tables before the owning persisted writer exists:
   M0 owns matrix run/item transitions, B2 owns brand run/item transitions, and
   O1 owns onboarding transitions plus the conditional `needs_attention` resume
   rule. This preserves the lifecycle registry's persisted-entity-only contract.
4. The prerequisite PR already added the pending roadmap program and corrected
   the audited feature claims. P0 only amends those records if contract
   reconciliation or the actual shared-type implementation changes them.

Red first: feature-flag catalog and lifecycle tests fail for missing entries;
contract tests fail for missing shared status completeness. Green with contracts
only—no paid behavior or incomplete UI.

Acceptance: cross-phase docs, flags, roadmap, status registries, lexicon (if new
canonical terms are added), and generated rules are consistent.

## Phase R1 — MCP registry and caller-attribution foundation

**Owner:** `platform-foundation`; GPT-5.5. **Depends:** P0.

Exclusive ownership: `server/mcp/server.ts`, `server/mcp/instructions.ts`,
`server/mcp/README.md`, new canonical registry/context/error modules, and MCP
registry/schema/routing tests. Controller owns shared schema types. Must not
import HTTP route handlers, add generation business logic, or change job/domain
status semantics.

- Create one canonical tool registry consumed by discovery, dispatch, unique-
  name census, input-schema census, and declared-workspace-field authorization.
- Include every category, including schema tools, in the property-description
  contract; repair README tool-count drift.
- Thread `McpToolExecutionContext` (tool/request, key ID/label, scope) through
  write handlers into activity/run attribution. Close roadmap item
  `mcp-key-label-attribution`.
- Add a common stable JSON error envelope for new tools without breaking legacy
  tool payloads.

Red first: duplicate/missing dispatch and undeclared/dual workspace-field fixture
tests; caller label missing from a real write activity. Green after registry and
execution context are the only authority.

Acceptance: list/dispatch/schema/scope cannot drift; representative existing
read/write/job tools preserve behavior; no secrets enter logs/results.

## Phase M0 — Matrix revisions, single-item ledger, reads, and structural resolution

**Owner:** `content-pipeline`; GPT-5.4. **Depends:** R1. **May run with:** B0.

Exclusive ownership: new `server/domains/content/matrix-generation/` resolver,
renderer, repository, and read service; matrix/template revision plumbing;
focused tests. Controller owns shared types, MCP schemas/registry, flag catalog,
and the additive migration. Must not touch brief/post generation, brand context,
prompt assembly, or any paid AI path.

- Zod-validate stored matrix/template shapes through current JSON helpers.
- Add monotonic matrix/template revisions and cell `revision` (legacy default
  `0`), conditional writes, and the exact `MatrixSourceRevision` envelope.
  `matrixRevision` covers definition/selection; a generation projection validates
  the common matrix/template plus only its cell revision, merges into the latest
  array transactionally, and increments only that cell so siblings stay valid.
- Add normalized `content_matrix_generation_runs`, items, and attempts before
  any one-cell generation phase; M3 later extends this ledger into batching.
- Add normalized `content_matrix_cell_evidence` for typed requirement
  resolutions; do not place evidence history in the cell JSON blob.
- Add explicit `(matrixId, cellId, MatrixSourceRevision)` structural resolution,
  deterministic slug/prose rendering, `ResolvedPageBlockManifest`, URL/cell
  collision checks, and keyword evidence. It does not resolve voice/context or
  claim final generation readiness/cost.
- New templates carry `generationContractVersion` and block roles. For legacy
  templates, return a deterministic upgrade proposal and require an explicit
  version-conditional `acceptTemplateGenerationUpgrade()` save before
  generation; expose the dedicated HTTP/MCP action. Ambiguous AEO/CTA roles
  block. Reject unsupported
  `ContentPageType` values outside `BRIEF_PAGE_TYPES` with an actionable error.
- Fix unflagged correctness gaps discovered by tests: create-route template
  workspace validation/schema inheritance and researched keyword evidence loss.
- Add cursor-paged `list_content_matrices`, `get_content_matrix`, and
  `resolve_content_matrix_cells`. No AI call, final preview, or artifact write in
  M0.

Red first: duplicate keyword selects wrong cell; missing/unknown variables,
unresolved braces, invalid/duplicate URLs, stale matrix/template/cell revision,
legacy cell revision default, conditional-write conflict, legacy template
upgrade accept/reject/stale fingerprint, ambiguous roles, unsupported page type, cross-workspace
template, missing schema inheritance, and lost keyword evidence.

Acceptance: structural resolution is deterministic/idempotent, costs zero paid
calls, persists a single-item-capable ledger, and returns the same structural
fingerprint for the same source inputs.

## Phase B0 — Typed durable intake and compatibility projection

**Owner:** `brand-engine`; GPT-5.4. **Depends:** R1. **May run with:** M0.

Exclusive ownership: new `server/domains/brand/intake/` modules/schema/tests,
new thin `server/routes/brand-intake.ts`, and the body of
`POST /api/public/onboarding/:id`. The new admin GET/evidence POST use
`requireWorkspaceAccess('workspaceId')`, Zod validation, and the domain service.
Controller owns shared contract, migration, events, barrels, `server/app.ts`
registration, and MCP registry. Must not touch brand generation prompts,
`VoiceProfile` transitions, Inbox adapters, or client serializers beyond the
existing public response compatibility assertion.

- Move questionnaire types to `shared/types/brand-intake.ts` and add matching
  Zod schemas with clearable optional fields.
- Persist immutable fingerprinted intake revisions before projection.
- Add version-safe intake evidence resolution that creates/reuses a superseding
  immutable revision; older runs remain stale rather than mutating in place.
- Replace append-only legacy text/persona mutation with an idempotent projection
  that preserves compatibility and authentic source provenance.
- Preserve reference URLs/evidence classification; broadcast and invalidate
  brand/intelligence/client workspace caches after commit.
- Wire Brandscript prefill to the typed revision or explicitly retire the
  stranded label-parser path; never maintain both authorities.
- Expose `get_brand_intake` through a thin MCP adapter over the intake read
  service; no raw intake is returned to client/public serializers.

Red first: real admin GET/evidence POST 200 + cross-workspace auth, malformed
input, repeat submission, changed revision, evidence-
resolution idempotency, placeholder-text deletion does not resolve, rollback,
cross-workspace auth, duplicate persona/KB block, calibrated-voice authority,
reference evidence, broadcast/invalidation, and public response compatibility.

Acceptance: one submission/revision is traceable and repeat-safe; raw intake is
absent from client serializers.

## Phase B1 — Real voice finalization

**Owner:** `brand-engine`; GPT-5.5. **Depends:** B0.

Exclusive ownership: `server/domains/brand/voice-finalization.ts`, its schemas/
tests, and thin additions to the existing voice route/MCP category. Controller
owns shared types, transitions, events, and registry. Must not generate the
provisional foundation, dependent brand pieces, or content.

- Add one domain service for finalization requiring non-empty DNA, guardrails,
  and selected authentic anchor evidence; persist ratings/selections.
- Use legal voice transitions and optimistic concurrency. Record/broadcast
  calibration only after real finalization; correct legacy actions that call a
  generated draft “calibrated.”
- Define authority/migration behavior for legacy `workspace.brandVoice` and
  `voice_guidelines`; they may be evidence/draft input, not competing locked
  outputs.
- Expose `get_brand_voice` and `finalize_brand_voice` through thin MCP adapters.

Red first: empty DNA/guardrails, no anchors, stale version, double finalize,
generated-only anchors, late edit, activity/event truth, and exact-once prompt
assembly.

Acceptance: a profile cannot be calibrated without the locked prerequisites;
existing valid calibrated profiles remain readable and compatible.

## Phase B2 — Grounded brand-suite generation and MCP

**Owner:** `brand-engine`; GPT-5.5. **Depends:** B0 + B1 + R1 + merged
`genq-ai-execution-governance` G1.

Exclusive ownership: new `server/domains/brand/generation/`, brand generation
worker/repository, named-operation schemas, MCP brand-generation handlers, and
focused tests. Controller owns shared types, migrations, job metadata, registry,
events, and flags. Must not edit Inbox adapters/client serializers (B3), matrix
generation, or provider-specific AI helpers.

- Add normalized brand run/items, background job metadata, restart
  reconciliation, resource idempotency, hard budgets, and conditional saves.
- Register named structured generate/refine/audit operations. Persist evidence
  refs, claim classification, typed missing requirements, provenance, findings,
  and sanitized errors.
- Add ordered presets (identity/messaging, audience, `full_brand_system`) and
  typed `naming` as creative proposal. `voice_foundation` is an atomic bootstrap
  target, never a normal preset. A full-suite
  start runs only the provisional voice foundation from accepted intake and
  authentic samples, then persists stage `awaiting_voice_finalization` under the
  truthful `awaiting_review` run status and ends the generic job.
- Add `BrandGenerationAtomicTarget = 'voice_foundation' | BrandDeliverableType`
  and exhaustive atomic/preset policies. `voice_foundation` is the only atomic
  bootstrap target and persists only in the run item/attempt ledger;
  `full_brand_system` is the only `bootstrap_then_resume` preset and may start
  only that foundation. Every durable direct target (including `naming`) and
  every other preset requires the exact finalized `voice_version` from preflight.
- Add `resume_brand_deliverable_generation`; it verifies the exact durable
  finalized voice version before starting dependent identity/messaging/audience.
  Provisional voice never drives dependent outputs.
- Run deterministic checks, structured model audit, at most one revision, then
  stop at operator review. Never auto-approve.
- Add `start_brand_deliverable_generation`, `get_brand_generation`, and
  `start_brand_deliverable_revision`; require expected versions and idempotency
  on all new writes. Keep legacy `update_brand_deliverable.expectedVersion`
  optional with deprecation logging; do not break existing clients in this PR.

Red first: missing facts/placeholders, name clearance claims, schema/provider
failure, voice-bootstrap without an existing profile, every mapped dependent
direct start rejected before finalization, unknown target census failure,
`full_brand_system` starts foundation-only without voice and never dispatches
dependents before resume, stale/wrong-voice resume, partial suite truth, cancellation/
restart, duplicate start, hard budget, late operator edit, cross-deliverable
contradiction, legacy update compatibility, and caller attribution.

Acceptance: voice bootstrap truthfully pauses without a running job; resume is
impossible until explicit finalization; complete means every dependent requested
item passed its automatic gates; a mixed suite is `completed_with_errors`; the
generic job result is summary-only.

## Phase M1 — Generation-ready preview and one explicit cell to one durable page draft

**Owner:** `content-pipeline`; GPT-5.5. **Depends:** M0 + B1 + C2 + C3.

Exclusive ownership: matrix generation-ready preview/service and extracted
single-cell brief/post stage functions inside
`server/domains/content/matrix-generation/`; focused tests. Controller owns
shared schemas, MCP registry, and job metadata. Must not add batch scheduling,
set-level audit, brand generation, Inbox review, or an alternative copy-pipeline
artifact.

- Add `preview_content_matrix_generation` after B1/C3. It resolves finalized
  voice, approved page-type identity, evidence requirements, expected artifact
  revision, hard selection/budget limits, and the effective-input fingerprint.
- Enforce evidence stages: `preflight` blocks paid work; `ready` may yield a
  placeholder draft but cannot be review-ready; `optional_omit` is removed.
- Add conditional `resolve_content_matrix_evidence`: persist typed value/source
  ref by matrix/cell/stable requirement ID plus full source revision—no run/item
  required—advance only the cell source revision, stale the prior preview, and
  require explicit re-preview then retry/audit. Artifact text edits alone cannot
  clear the requirement.
- Extract reusable brief/post stage functions from current job wrappers; keep
  existing single-artifact routes/MCP behavior compatible.
- Generate from the resolved cell snapshot, never keyword cross-reference.
- Lock the full `ResolvedPageBlockManifest`, including explicit system intro/
  conclusion blocks; freeze voice/identity/evidence once; store C2 revision/
  provenance and C3 effective-input fingerprint.
- Atomically commit artifact, run item, cell links, and legal lifecycle
  projection. Resume successful stages only when fingerprints match.

Red first: duplicate keyword ambiguity, full rendered-block census, missing
finalized voice, each evidence stage, resolution/re-preview, placeholder deletion
without evidence remains blocked, resolving a preflight gap before any run
exists, preview/start fingerprint drift,
unresolved template token, provider failure at each stage, cancellation, source
change, operator edit during generation, approved artifact protection, and
atomic rollback of cell/artifact/run.

Acceptance: one explicit cell closes end to end with traceable IDs; a failed or
conflicted run preserves prior artifacts and cell state without paid auto-retry.

## Phase M2 — Persona/SEO/AEO/CTA audit and bounded revision

**Owner:** `content-pipeline`; GPT-5.5 with deterministic review by GPT-5.4.
**Depends:** M1.

Exclusive ownership: item-level audit/check/revision modules and named operation
schemas under `server/domains/content/matrix-generation/`; focused tests. Must
not add batch orchestration/set-audit behavior (M3), change template structure,
or create new review/publish states.

- Implement deterministic template, URL, keyword-position, metadata, internal-
  path, placeholder, local-evidence, CTA, AEO, and uniqueness checks.
- Register a typed model audit for voice/persona/SEO/coherence. Factual and
  hallucination checks remain human-required.
- Permit one automatic revision total per item, preserve evidence/block IDs,
  rerun all deterministic checks, and persist attempts/findings in the M0
  ledger. Record whether the allowance remains for the later set audit.
- Derive only `ready_for_human_review`, `needs_attention`, or
  `blocked_missing_evidence`.

Red first: thin variable-only location pages, invented local fact, missing CTA/
AEO role, bad keyword position, nonexistent internal path, unresolved fact,
uncalibrated voice, revision regression, and model/deterministic disagreement.

Acceptance: no model verdict can override a deterministic or human-required
failure; bounded call count and provenance are observable.

## Phase M3 — Durable bounded matrix batch, MCP, and repaired admin action

**Owner:** `content-pipeline`; GPT-5.5. **Depends:** M2 + R1.

Exclusive ownership: matrix parent worker/scheduler, batch/set-audit service,
matrix generation HTTP adapters, MCP start/get/retry handlers, admin API/hook/UI
for the existing Matrix actions, and focused tests. Controller owns shared
types, job metadata, registry, event/query-key additions, and flags. Must not
introduce a new run ledger, nest brief/post jobs, change brand code, or publish.

- Extend the M0 single-item ledger with parent batch orchestration and per-cell
  checkpoints, bounded concurrency, hard call/token/cost/item caps,
  cancellation, restart reconciliation, idempotency, stale-input handling, and
  failed-item retry.
- After item audits, run deterministic set checks for duplicate URLs, typed
  keyword overlap/cannibalization, block-manifest coverage, structured
  claim/evidence conflicts, and configured overlap thresholds. Then run the
  named, schema-validated `content-matrix-set-audit` operation for cross-page
  factual consistency and substantive uniqueness; it cannot certify factual
  truth, so provenance-sensitive verdicts remain human-required. Attach
  findings to run/items. Structural conflicts require source correction/retry;
  prose-only findings may use only an item's unused one-pass allowance. Rerun
  both gates and report unresolved conflicts as mixed/needs-attention.
- Add start/get/retry MCP tools; start requires preview fingerprint, explicit
  cell selection, one full `MatrixSourceRevision` per cell, and idempotency key.
- Add the thin admin start/status route, React Query wrapper/hook, contextual
  progress/error states, and wire the currently inert single/bulk actions.
- Add the review-only approval service/HTTP action. It validates expected run,
  item, and post revisions, records approval evidence and the legal approved/
  exportable post state atomically, and never calls publish policy/CMS jobs. MCP
  can observe the result but cannot mint the human approval.
- Use canonical content/job events and `useWorkspaceEvents` invalidation; add a
  new event only if existing events cannot represent committed state.

Red first: over-limit start, selection drift, duplicate start, independent-cell
concurrency, same-cell dedupe, partial provider failure, cancel between every
stage, restart/resume, same-preview concurrent 10-cell commits without sibling
staleness, duplicate/cannibalizing set, cross-page factual drift,
structural conflict no-auto-rewrite, one-revision-total enforcement, mixed result
truth, review approval with auto-publish configured produces zero publish jobs,
partial 10-page approval cannot advance the set, cursor paging, and loading→flag-ON UI.

Acceptance: a realistic 10-cell service set can preview, start, poll, partially
fail, retry failed items, and reach honest per-cell outcomes without nested jobs.

## Phase B3 — Brand review through Inbox and client-safe projection

**Owner:** `inbox` with `brand-engine` service seam; GPT-5.4. **Depends:** B2.

Exclusive ownership: `brand-generation` deliverable adapter, brand review bundle
projection/application service, client-safe brand summary serializer, related
Inbox/client UI and focused tests. Controller owns shared deliverable unions,
transitions, events, query keys, and barrels. Must not finalize voice, mutate
generation prompts/runs, or expose raw intake/evidence/audit/provenance.

- Add typed `brand_generation` deliverable adapter and extend existing
  `send_to_client`; do not add a parallel send action.
- Block send while factual requirements are unresolved. Group the suite into one
  Reviews artifact with one typed item per source deliverable and safe summaries.
- Per-item approval moves only the expected source draft→approved. Per-item
  changes requested preserves the note, keeps/returns the source in draft, and
  updates the run item. Bundle status is `partial` until every item is terminal
  and `approved` only when all items are approved.
- Keep voice-foundation review as a separate bundle/gate. Client approval never
  finalizes a voice profile; B1 operator finalization owns that transition.
- Add `ClientBrandSummary` containing approved/client-visible fields only and
  wire client workspace serialization, Brand surface, and event invalidation.

Red first: source/mirror divergence, partial decisions, changes-requested note,
stale source version, placeholder send block, draft/raw-evidence leakage,
cross-workspace access, public endpoint actual read path, and client render.

Acceptance: operator and client see one coherent per-item review with honest
partial state; voice is not implicitly finalized; drafts/prompts/intake/audit
internals never appear client-side.

## Phase M4 — pSEO/blueprint creation bridge

**Owner:** `content-pipeline`; GPT-5.4. **Depends:** M3.

Exclusive ownership: `server/domains/content/matrix-generation/pseo-bridge.ts`,
thin additions to `server/routes/page-strategy.ts`,
`server/mcp/tools/content-matrix-actions.ts`, and focused domain/HTTP/MCP tests.
Controller owns shared action schemas, MCP registry/instructions/counts, route
barrels, and event/query-key amendments. Must not touch B3 Inbox/client files,
generation workers/audits, or hide a generation start inside matrix creation.

- Convert explicit service/location or collection blueprint inputs into a
  validated matrix with stable source refs and template linkage.
- Make blueprint `isCollection`/`matrixId` behavior real and idempotent; do not
  overload `add_keyword_to_strategy`.
- Require preflight evidence/uniqueness before allowing generation start.
- Add idempotent blueprint-entry HTTP materialization at
  `POST /api/page-strategy/:workspaceId/:blueprintId/entries/:entryId/content-matrix`
  plus `create_content_matrix_from_pseo_plan` on `/mcp`; both call
  `createMatrixFromPseoPlan()` and return the same matrix/source identity.

Red first: Cartesian count, stable rerun, source link, collisions, missing
service/location evidence, cannibalization, rollback, MCP discovery/schema/
workspace scope/caller attribution, and real `/mcp` idempotent replay.

Acceptance: a service×location request creates exactly one inspectable matrix;
generation remains a separate explicit authorized start.

## Phase O1 — Resumable intake→brand→content orchestration

**Owner:** controller/`platform-foundation`; GPT-5.5. **Depends:** B3 + M3.

Exclusive ownership: `shared/types/brand-content-onboarding.ts`, additive
`brand_content_onboarding_runs` migration, orchestration domain/repository,
thin MCP tools, and focused lifecycle tests. Must not duplicate brand/matrix run
state, hold jobs open across human gates, auto-send, auto-approve, or publish.

- Implement the locked lifecycle: `intake_ready`, `brand_generating`,
  `awaiting_voice_review`, `awaiting_voice_finalization`,
  `brand_generating_dependents`, `awaiting_operator_review`,
  `awaiting_client_review`, `awaiting_content_authorization`,
  `content_generating`, `awaiting_content_review`, `ready_to_publish`,
  `needs_attention`, `cancelled`, and `failed`.
- Add a version-conditional durable record referencing intake, brand run/review,
  finalized voice, approved identity snapshot, and matrix run. Idempotency scope
  is `(workspaceId, intakeRevisionId, idempotencyKey)`.
- Start brand work, then pause at operator review, client review, and content
  authorization. After content generation, create/reference the existing page
  review surface and pause at `awaiting_content_review`. Resume only after every
  selected page has durable M3 review-only approval evidence; neither the
  existing content-request `delivered` state nor an MCP assertion is sufficient.
  Generation cannot jump directly to publish readiness.
- Expose start/get/resume MCP tools; require both existing rollout flags.
- Freeze the approved brand snapshot for the page run and mark remaining work
  stale if authority changes.

Red first: every pause/resume edge, direct content-generating→ready-to-publish
rejection, duplicate resume, rejected/changes-requested brand review, authority
change, process restart, cancelled child run, partial matrix result, one
unapproved page in a 10-page set, Webflow auto-publish enabled, and no auto-send/
publish.

Acceptance: one MCP-started workflow is traceable from intake revision to page
run while all human decisions remain explicit and resumable. After explicit page
approval, the workflow proves export/publish preconditions and reaches
`ready_to_publish`; it does not invoke publication.

## Phase R2 — Staging canary and closeout

- Seed a realistic business with authentic voice samples, services, locations,
  missing facts, and a duplicate/cannibalizing edge case.
- Enable each flag for one staging workspace through the server-aware path;
  preview and run a single cell, then a 10-cell set; exercise cancel/retry,
  operator edit conflict, brand changes requested/approval, and orchestration
  pause/resume in the real browser and MCP client.
- Record completeness, ready rate, evidence blocks, first-pass/revision rate,
  latency, calls/tokens/cost, partial failures, and zero stale overwrites.
- Approve a canary page through the real review path and prove it reaches
  `ready_to_publish` with valid export/publish preconditions while no publish
  job/API call and no live CMS mutation occurs.
- Update `FEATURE_AUDIT.md`, roadmap, `data/features.json` if sales-relevant,
  MCP README/instructions/tool counts, brand/content rules, and flag review dates.
- Do not enable production or retire flags in this PR. Retirement follows the
  normal lifecycle after observed exit criteria are met.

## Systemic improvements and enforcement

This program deliberately leaves reusable platform improvements rather than
one-off glue:

- one canonical MCP registry/execution context for discovery, dispatch, schema,
  authorization, stable errors, and caller attribution;
- one structural template renderer and full-page block manifest shared by
  preview, generation, audit, retry, and future exporters;
- one typed evidence-requirement policy (`preflight|ready|optional_omit`) shared
  by brand and content generation;
- one normalized, cursor-paged run/item/attempt pattern with generic job summary
  results, hard budgets, restart recovery, and conditional commits;
- extracted brief/post domain stages reusable by standalone and matrix jobs,
  with job wrappers kept as adapters;
- one grouped Inbox adapter pattern for version-safe per-item decisions.

Enforcement choices: schema/registry/workspace-field completeness, job census,
lifecycle completeness, section/block census, serializer exclusion, page-type
allow-list, and query/event wiring are contract tests. Add a `pr-check` rule only
if implementation reveals a reliable source-level hazard that cannot be covered
by types or contract tests; if added, update the `CHECKS` array and regenerate
`docs/rules/automated-rules.md` in that same phase. Do not add regex enforcement
for domain behavior that belongs in integration tests.

Feature-class definition-of-done mapping:

| Feature class | Phases | Required proof beyond common gates |
|---|---|---|
| Migration/storage | M0, B0, B1, B2, O1 | fresh migrate, existing-data readback, legacy cell revision `0`, rollback/transaction and snapshot-schema tests |
| AI generation | B2, M1, M2, M3 | named operations, Zod output, truthful required-stage failure, C2 CAS/provenance, C3 exact-once context, deterministic eval fixtures, hard budget |
| Background job | B2, M3 | job metadata/census, bounded summary result, cancel/restart/resume, no nested jobs, partial outcome truth |
| MCP action | R1, M0, B0–B2, M1, M3, M4, O1 | discovery/dispatch/schema/scope lockstep, caller attribution, stable errors, idempotency, paged reads |
| Client-visible/review | B3, R2 | actual authenticated public read, unified Inbox state machine, serializer exclusions, mobile/a11y, workspace-event invalidation |
| Flagged UI | M3, R2 | real query loading→enabled transition plus realistic flag-ON browser smoke and recorded exit evidence |

## Focused verification by phase

Any listed test path not present on the phase's staging base is a planned test
owner and lands in that phase. Each command runs after the phase's red test is
observed.

| Phase | Focused command / assertion |
|---|---|
| S0 | `npx vitest run tests/unit/mcp-auth-perkey.test.ts tests/contract/mcp-tool-input-schema-properties.test.ts tests/contract/mcp-tool-workspace-scope-schema.test.ts` |
| P0 | `npx vitest run tests/unit/feature-flags.test.ts tests/unit/feature-flag-lifecycle.test.ts tests/contract/feature-flag-catalog.test.ts tests/contract/mcp-generation-contracts.test.ts` |
| R1 | `npx vitest run tests/unit/mcp-routing.test.ts tests/unit/mcp-auth-perkey.test.ts tests/contract/mcp-tool-input-schema-properties.test.ts tests/contract/mcp-tool-workspace-scope-schema.test.ts tests/integration/mcp-api-keys-admin.test.ts` |
| M0 | `npx vitest run tests/unit/content-matrix-renderer.test.ts tests/integration/content-matrices-routes.test.ts tests/contract/mcp-matrix-read-tools.test.ts`; repeat structural resolve and assert identical source fingerprint/zero AI executions; accept/reject/stale template upgrade |
| B0 | `npx vitest run tests/integration/public-onboarding-routes.test.ts tests/integration/brand-intake.test.ts`; submit the same body twice to `POST /api/public/onboarding/:id`, assert one revision/projection, then cover authenticated admin GET/evidence POST |
| B1 | `npx vitest run tests/integration/voice-calibration.test.ts tests/contract/voice-finalization.test.ts`; assert generated-only anchors cannot finalize |
| B2 | `npx vitest run tests/integration/brand-generation.test.ts tests/contract/background-job-coverage-contract.test.ts tests/contract/ai-operation-registry.test.ts`; start full suite, observe `awaiting_voice_finalization`, prove dependent items do not exist before explicit finalize/resume, and census every direct target policy |
| M1 | `npx vitest run tests/integration/content-brief-routes.test.ts tests/integration/content-posts-workflow.test.ts tests/integration/content-matrix-single-generation.test.ts`; compare preview/start fingerprint, assert full block manifest/CAS, and prove placeholder deletion cannot clear typed evidence |
| M2 | `npx vitest run tests/unit/content-matrix-generation-audit.test.ts tests/integration/content-plan-review-routes.test.ts`; assert exactly one paid revision and human-required factual verdict |
| M3 | `npx vitest run tests/integration/content-matrix-generation-batch.test.ts tests/contract/background-job-coverage-contract.test.ts tests/component/ContentPlanner.matrixGeneration.test.tsx`; browser: flag loading→ON, preview/start 10 cells concurrently without sibling staleness, cancel, retry, inspect mixed/set findings |
| B3 | `npx vitest run tests/integration/brand-deliverable-review.test.ts tests/integration/public-brand-summary.test.ts tests/component/client/BrandGenerationReview.test.tsx`; approve one item/request changes on one, assert `partial` and no voice finalization/raw-data leakage |
| M4 | `npx vitest run tests/integration/pseo-matrix-bridge.test.ts tests/integration/mcp-server-routing.test.ts tests/contract/mcp-tool-input-schema-properties.test.ts`; create the same service×location plan through HTTP and `/mcp`, assert one linked matrix/exact Cartesian cell count |
| O1 | `npx vitest run tests/integration/brand-content-onboarding.test.ts tests/contract/brand-content-onboarding-lifecycle.test.ts`; restart at every gate, reject generation→publish-ready jump, and assert expected-revision/idempotent page-review resume |
| R2 | Real MCP + browser canary: approved item reaches `ready_to_publish`; job list/CMS audit proves no publish call or live mutation; run `npm run verify:platform` |

For new HTTP adapters, integration tests exercise the real paths in the seam
table. Authenticated curl-equivalent assertions must cover 200, stale 409,
cross-workspace 403/404 as appropriate, hard-budget 422, and idempotent replay.
MCP integration tests make the same calls through `/mcp`; they may not substitute
route-only coverage for the actual tool boundary.

## Per-PR gates

Every phase runs focused red→green tests, applicable domain smoke, then:

```bash
npm run typecheck
npx vite build
npx vitest run
npm run pr-check
npm run lint:hooks
npm run verify:feature-flags
npm run verify:platform:quick
```

Also run job-census, MCP registry/schema/auth, lifecycle, lexicon, migration,
client public-read, AI reliability/quality, performance-budget, and browser gates
when touched. Provider smokes are read-only/cost-capped. Database phases verify
fresh migrate plus existing-data readback. Client phases verify mobile and the
actual public serializer path.

## Review and merge protocol

For each PR: diff review → focused/full gates → independent GPT-5.5 spec,
correctness, and adversarial failure review → draft PR to `staging` → resolve
actionable threads → rebase if staging advanced → rerun gates → merge only green
→ wait for staging deploy → health and phase-specific smoke. Dependent work does
not start before that staging verification.

Pause only for a contract contradiction, unavailable external acceptance
criteria that materially change scope, destructive migration, new paid-provider
authority/spend, production flag/release change, or unavailable staging access
for a required real-path gate. Fix ordinary implementation, test, review, and
staging defects in the owning PR.
