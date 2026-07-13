# MCP Matrix + Brand Generation — Cross-phase Contracts

These contracts prevent the content, brand, MCP, Inbox, and client lanes from
inventing incompatible identities, statuses, evidence shapes, or review rules.
The controller updates this document and every unmerged dependent plan in the
same commit as an approved contract amendment.

## Program invariants

- Implementation PRs start from then-current `origin/staging`; this planning
  branch is not an implementation base once staging advances.
- Shared contracts, migration numbers, event constants, feature flags, tool
  registry changes, and roadmap/docs are controller-owned during parallel work.
- Content source identity is `(workspaceId, matrixId, cellId,
  MatrixSourceRevision)`.
  Brand source identity is `(workspaceId, intakeRevisionId, deliverableType)`.
- Keyword text, matrix position, display name, or tool handle is never a durable
  generation identity.
- A run consumes an immutable resolved-input snapshot. Source changes make it
  stale; they do not silently alter remaining items.
- Automatic generation never overwrites newer operator/client work, auto-
  approves, auto-sends, or auto-publishes.
- `ready_for_human_review` is the strongest automatic success verdict.
- `ready_to_publish` is reachable only after explicit approval and existing
  export/publish preconditions pass; it is not publication.
- Unknown evidence remains unknown. Matrix dimensions are targeting, not proof.
- One approved/finalized voice snapshot is injected exactly once for every item
  in a page-set run.

## Imported platform contracts

### Generation quality program

- G1/C2/C3 refer to the same-date
  [`generation-quality-performance` plan](./2026-07-13-generation-quality-performance-program.md):
  merged `genq-ai-execution-governance`, pending C2 phase B of
  `genq-content-generation-integrity`, and pending `genq-content-context-v2`.
- G1 is the sole owner of named-operation execution policy, provider-neutral
  metadata, run IDs, and traces.
- C1 owns strict content completeness and `needs_attention` semantics.
- C2 must export content generation revisions, durable provenance,
  resource-scoped job identity, and conditional saves before matrix generation
  implementation begins.
- C3 must export the budgeted exact-once voice/evidence context before matrix
  generation begins. The new surface directly consumes the v2 implementation;
  it does not add a second context implementation or feature flag.
- Runtime quality governance owns cross-workflow budgets/reliability registry.
  This program registers new operations; it does not create a parallel telemetry
  system.

### Existing domain authorities

- `ContentBrief` + `GeneratedPost` are the matrix page artifacts.
- Matrix/cell legal states remain owned by the existing matrix state machine.
- `VoiceProfile` is the downstream voice authority after real finalization.
- Approved `BrandDeliverable` rows are identity authority; draft run output is
  not exposed through `BrandSlice`.
- Unified `ClientDeliverable` owns client send/respond state. Brand source rows
  do not grow a second client-review state machine.
- `callAI()`/`callCreativeAI()` remain the only AI entry points; provider helpers
  remain implementation details.

## Shared semantic shapes

These names are locked for the contract PR. Any amendment updates this file and
every unmerged dependent plan in the same commit before implementation resumes.

### Matrix source revision

`MatrixSourceRevision` is:

```ts
interface MatrixSourceRevision {
  matrixRevision: number;
  templateRevision: number;
  cellRevision: number;
}
```

Each field is a monotonic integer. Matrices and templates gain additive revision
columns; stored cells gain `revision`, with legacy absence interpreted as `0`.
`matrixRevision` covers definition/selection inputs, not generation-owned cell
projection. Conditional source writes validate and increment the revisions they
own. A generation commit validates the common frozen matrix/template revisions
plus only that item's cell revision, transactionally merges its projection into
the latest cell array, and increments only that cell revision. It cannot
self-invalidate sibling items from the same preview.

### Resolved matrix targets

`ResolvedMatrixStructuralTarget` contains:

- workspace, matrix, template, and cell IDs plus `MatrixSourceRevision`;
- variable values and deterministic slug/prose substitutions;
- target keyword plus validation/evidence source;
- planned URL, title, meta, page type, schema types;
- `ResolvedPageBlockManifest`, `generationContractVersion`, and explicit
  AEO/CTA requirements;
- source-only structural fingerprint and structural blocking requirements.

It deliberately excludes voice/identity selection, final evidence freshness,
artifact revisions, canonical effective-input fingerprint, and paid estimates.
M0 returns this structural target without claiming generation readiness.

`MatrixGenerationPreviewTarget` contains the complete structural target plus:

- identity/voice snapshot IDs and readiness;
- evidence captured/freshness times;
- exact expected brief and post generation revisions (one of each, never a
  generic artifact array);
- canonical effective-input fingerprint and blocking requirements.

M1 is the first phase allowed to return this generation-ready target.
A paid matrix run stores a non-empty tuple of those accepted preview selections;
every item has a non-null preview fingerprint. Onboarding may retain a non-empty
pre-preview selection with nullable preview fingerprints until authorization,
but it cannot dispatch paid work from that looser shape.

The resolver receives explicit IDs. The old keyword cross-reference may remain
for legacy standalone generation but is forbidden in matrix-run code.

`ResolvedPageBlockManifest` covers the complete page: stable
`system:introduction`, ordered template/outline blocks, and
`system:conclusion`. Each block has stable ID, source (`system|template`),
generation role, heading contract, and AEO/CTA requirements.
The manifest is a tuple with exactly one introduction first and one conclusion
last; template blocks cannot use either reserved system ID.

### Evidence requirement

`GenerationEvidenceRequirement` distinguishes:

- `verified`: durable source ref supports the fact;
- `inferred`: an allowed interpretation, labeled and never promoted to fact;
- `missing`: requires client/operator input;
- `conflicting`: sources disagree and require resolution;
- `creative_proposal`: non-factual option such as a tagline or name.

Each requirement has a stable ID, field/claim, reason, source refs,
`claimKind`, `requirementStage`, and optional client-safe prompt. Factual refs
exclude structural-only `content_matrix`, `content_matrix_cell`, and
`content_template` sources; normalized `content_matrix_cell_evidence` remains a
valid durable factual source. `requirementStage` is:

- `preflight`: blocks paid work (source identity, supported/locked template,
  verified service availability, substantive location relevance, finalized
  content voice);
- `ready`: allows a typed placeholder draft but blocks review-ready/send/
  publish-ready (required hours, prices, staff, credentials, statistics, CTA
  details);
- `optional_omit`: omits unsupported optional detail without a placeholder.

`[NEEDS CLIENT INPUT: ...]` is rendered only for a typed `missing` + `ready`
requirement. A local dimension label never satisfies evidence.

`GenerationEvidenceResolution` contains requirement ID, typed value, durable
source ref, resolver attribution, expected source/artifact revisions, and
timestamps. Text edits never resolve it. Content resolutions live in normalized
`content_matrix_cell_evidence`, advance the target cell revision, and require a
fresh preview plus explicit retry/audit. Brand resolutions create/reuse a
superseding immutable intake revision, making the older run stale.
Content resolution is addressed by matrix/cell/requirement plus the full source
revision; it never depends on a run/item that a preflight blocker may prevent.
`ResolveMatrixGenerationEvidenceRequest` carries that owner identity directly.
`RetryMatrixGenerationRequest` requires a non-empty item selection plus the
run/item/source/artifact revisions. Replacement additionally requires explicit
operator authorization; resume cannot carry replacement authorization.

### Audit report

`GenerationAuditReport` contains deterministic check results, structured model
review, human-required checks, revision count, unresolved requirements, and a
derived verdict:

- `ready_for_human_review`;
- `needs_attention`;
- `blocked_missing_evidence`.

`ready_for_human_review` requires an exact empty unresolved-requirement tuple
and deterministic results limited to `passed|not_applicable`;
`blocked_missing_evidence` requires at least one unresolved requirement.
Human-required checks can be `needs_human_review|not_applicable`, never
auto-passed. The shared automatic revision count is exactly `0|1` at the audit,
brand-item, and matrix-item seams. The report never uses a single model boolean
to override a deterministic failure or pass factual/no-hallucination checks.

### Run outcomes

Run status distinguishes:

- `queued`, `running`, `awaiting_review`, `completed`,
  `completed_with_errors`, `blocked`, `conflict`, `cancelled`, `failed`.

Item status adds stage-specific states. A run is `completed` only when every
selected item reached `ready_for_human_review`. Mixed ready/error items are
`completed_with_errors`. Cancellation retains completed items and marks the
remaining items honestly.

Generic `BackgroundJobStatus` does not expand; it remains
`pending|running|done|error|cancelled`. Its bounded terminal result is
`{runId, counts, terminalStatus}` where `terminalStatus` is the rich domain-run
status.

P0 registers these shared status vocabularies but does not add lifecycle
transition tables before their persisted writers exist. M0 adds matrix run/item
tables and transitions together, B2 does the same for brand run/items, and O1
owns onboarding transitions including conditional recovery from
`needs_attention`. The brand voice pause is stage
`awaiting_voice_finalization` while the run's truthful status is
`awaiting_review`; it is not a tenth generic run outcome.

### Brand/content onboarding run

`BrandContentOnboardingRun` and `BrandContentOnboardingStatus` live in
`shared/types/brand-content-onboarding.ts`. Status is exactly:

`intake_ready | brand_generating | awaiting_voice_review |
awaiting_voice_finalization | brand_generating_dependents |
awaiting_operator_review | awaiting_client_review |
awaiting_content_authorization | content_generating | awaiting_content_review |
ready_to_publish |
needs_attention | cancelled | failed`.

Only durable explicit page approval plus passing export/publish preconditions
may transition `awaiting_content_review` to `ready_to_publish`.

`approveMatrixPageForPublishReadiness()` is the sole approval authority for a
matrix-run item. It conditionally validates run/item/post revisions, requires
`ready_for_human_review` with zero unresolved `ready` evidence, legally marks
the post approved/exportable, and records approval evidence atomically. It never
calls publish policy or a CMS job, even when auto-publish is configured. A
content-request `delivered` status is not equivalent. Every selected page must
have this evidence before the set advances.

The run carries a monotonic revision, immutable intake/brand/voice/matrix source
refs, child brand/page-review IDs, idempotency key, and durable gate evidence. Its
idempotency scope is `(workspaceId, intakeRevisionId, idempotencyKey)`.
Gate evidence is discriminated by gate. Voice proof contains the finalized
snapshot; page proof maps every approval to matrix run/item/cell, the full
matrix/template/cell source revision, the post revision, and a human approver.
Content authorization carries a durable authorization ID plus a named
operator/client actor; a system recorder is not the authorization proof. A
generic string ID cannot satisfy a different gate.

## Template and pSEO contracts

- One deterministic renderer owns variable validation and substitution.
- Slug mode is locale-safe, collision-checked, and never silently drops a value
  into an empty segment. Prose mode preserves human-readable values.
- All braces must resolve; unknown/missing variables fail preflight.
- The complete `ResolvedPageBlockManifest` is frozen in the run snapshot.
  Existing generator-owned introduction/conclusion blocks are explicit system
  blocks; models may fill content only and may not create extra blocks.
- New templates declare `generationContractVersion` and an explicit generation
  role for every block. Structural preflight may propose a deterministic legacy
  upgrade, but an operator must explicitly accept/save it. Ambiguous AEO/CTA
  mappings block generation.
- `acceptTemplateGenerationUpgrade()` requires the expected template revision
  and exact proposal fingerprint. It persists only deterministic mappings; a
  stale proposal conflicts, rejection is a no-op, and ambiguous roles stay
  blocked. HTTP and MCP are thin adapters over this one mutation.
- `ContentTemplate.pageType` values outside the current `BRIEF_PAGE_TYPES`
  allow-list fail structural preflight with `unsupported_page_type` and an
  actionable migration path. Existing non-matrix generation remains compatible.
- Required AEO/CTA roles must exist in the locked plan before paid work. The
  generator does not “fix” a deficient locked template by adding sections.
- Primary keyword positions and metadata length are deterministic audit rules.
- Duplicate planned URLs, duplicate source cells, and unresolved
  cannibalization are blocking.
- A location/service cell requires verified relevant service availability and
  enough cell-specific evidence to avoid a variable-only page. Office presence,
  landmarks, reviews, prices, licenses, and service-area claims require their
  own evidence.
- The pSEO creation bridge creates/links a validated matrix first. It does not
  hide matrix creation inside `add_keyword_to_strategy`.

## Brand and voice contracts

- `BrandIntakePayload` is shared, Zod-validated, schema-versioned, immutable per
  revision, and stored before compatibility projection.
- Resubmission creates or reuses one fingerprinted revision and updates legacy
  projections idempotently; it never append-duplicates personas or labeled KB
  blocks.
- Authentic client examples and accepted source excerpts outrank generated
  prose. Generated taglines/examples cannot silently calibrate their own source
  model. Authentic-sample source refs exclude generated deliverables, profiles,
  matrix structure, intelligence summaries, and templates; finalized anchors
  additionally record the operator who selected them and when. A referenced
  `voice_sample` also records an allowed authentic origin, exactly `manual` or
  `transcript_extraction`; calibration-loop and approved generated-copy origins
  cannot anchor final voice.
- Voice-foundation bootstrap may consume accepted intake and authentic samples
  without an already-finalized profile. A full-suite run generates only that
  provisional foundation, then pauses at `awaiting_voice_finalization`.
- An operator reviews the foundation, selects authentic anchors, and finalizes
  the profile; the snapshot records that finalizing operator. Only
  `resume_brand_deliverable_generation` with that durable
  finalized version may start dependent identity/messaging/audience work.
- `BrandGenerationAtomicTarget` is exactly
  `'voice_foundation' | BrandDeliverableType`.
  `BRAND_DELIVERABLE_TARGET_POLICY` exhaustively maps that union;
  `voice_foundation` alone is `bootstrap` and every durable deliverable,
  including `naming`, requires the exact finalized voice version. The
  provisional foundation lives only in the brand run item/attempt ledger and is
  never persisted as a `BrandDeliverable` or treated as final voice authority.
  `BRAND_GENERATION_PRESET_POLICY` maps
  bundles separately; `full_brand_system` alone is `bootstrap_then_resume` and
  may start only its foundation before finalization. Other presets require
  finalized voice at start. There is no direct/bundle bypass or deadlock.
- Direct atomic selection contains exactly one `target`; arrays, empty
  selections, duplicates, and mixed foundation/dependent starts are not valid
  shared shapes. Preset policy separately freezes `initialTargets` and
  `resumeTargets`, so full-suite initial dispatch is foundation-only.
- Persisted selection and current dispatch targets are one discriminated shape.
  An atomic foundation run can carry only the foundation tuple, and a foundation
  item has permanently-null `deliverableId`/version fields.
- A finalized voice snapshot requires a non-empty authentic-anchor evidence
  tuple. Approved identity refs freeze approval time plus content/approval
  fingerprints, not only the mutable source-row version.
- Real finalization requires non-empty DNA, guardrails, and selected anchor
  evidence, uses the voice state machine, and records calibration activity only
  after commit.
- `naming` and `tagline` output are creative proposals. Naming never claims
  trademark, domain, legal, or cultural clearance without verified external
  evidence. Naming remains outside the released legacy paid-generator service,
  API payload type, focus prop, and rendered generator census until B2.
- Brand generation/refinement uses named structured operations and conditional
  saves against the version read before the paid call.
- Existing `update_brand_deliverable.expectedVersion` stays optional for wire
  compatibility during this program and logs omission as a deprecation. Every
  new generation/revision mutation requires an expected revision. Legacy
  enforcement is a later compatibility PR after consumer migration/telemetry.
- Approved identity selection is page-type-specific. Service/landing content
  may receive differentiators, objections, promise, and CTA principles;
  location content receives only verified local proof; voice enters once via
  prompt assembly.

## Persistence and transaction contracts

- Migrations are additive and allocated from current staging immediately before
  their PR. No destructive migration is authorized.
- Run/item tables are normalized. Attempts, errors, and per-item stage status do
  not grow the matrix/intake JSON.
- JSON snapshots use shared typed interfaces, Zod schemas matching the stored
  shape, and the repository JSON validation helpers.
- A successful item commit atomically records artifact content/status,
  generation revision/provenance, run/item result, source link, and legal cell
  projection. Conflicts change none of those writes.
- Background work reads the expected artifact/source revisions before paid work
  and compares them in the final transaction. A stale result records a conflict
  and preserves the newer artifact.
- Retry reuses successful stage checkpoints when their effective input
  fingerprint matches. Explicit replacement is a separate authorized mode.
- Generic job results contain `{runId, counts, terminalStatus}` only. Full items
  and audit reports come from cursor-paged domain reads.
- Matrix run/item/attempt persistence lands with structural resolution before
  one-cell generation. Batch orchestration extends this proven ledger; it does
  not introduce the first durable item store after generation already exists.
- `brand_content_onboarding_runs` stores the shared orchestration lifecycle,
  monotonic revision, idempotency identity, immutable source refs, child IDs,
  and gate evidence. A waiting human gate never keeps a generic job running.

## Background execution and budget contracts

- `content-matrix-generation` and `brand-deliverable-generation` are registered
  background job types with metadata and the test-matrix census.
- One parent worker invokes extracted domain services directly. It never starts
  nested brief/post/brand jobs.
- Starts require a preflight fingerprint, expected source revision,
  idempotency key, explicit selection, and configured maxima.
- Batch starts carry the full `MatrixSourceRevision` envelope for every selected
  cell. A single expected matrix revision is insufficient.
- Before dispatch, the service enforces item, provider-call, token, estimated
  cost, and concurrency limits. The current informational paid counter is not a
  quota substitute.
- Workers check cancellation between stages and items. Restart reconciliation
  converts generic interrupted jobs to a resumable domain-run state rather than
  losing item checkpoints.
- Partial provider failure is isolated by item/source and never relabeled as
  complete.
- After item audits, batch runs execute deterministic set checks for duplicate
  URLs, typed keyword overlap/cannibalization, block-manifest coverage,
  structured claim/evidence conflicts, and configured overlap thresholds. They
  then call the named, schema-validated `content-matrix-set-audit` operation for
  cross-page factual consistency and substantive uniqueness. The model result
  cannot certify factual truth; provenance-sensitive verdicts remain human-
  required. Findings attach to the run and affected items. Structural issues
  require source correction/retry. Prose issues may use only an item's remaining
  one-pass allowance; total automatic revision remains one per item across both
  audit levels, followed by rerunning both set gates.

## MCP boundary contracts

- New tools use snake_case workspace inputs and described top-level schemas.
- Tool discovery, dispatch, unique-name census, input-schema census, and
  declared-workspace-argument census derive from one canonical registry.
- Authorization validates the workspace field declared by the called tool.
  Conflicting camel/snake aliases are rejected for master and scoped keys.
- New mutations receive `McpToolExecutionContext` containing request/tool name,
  key ID/label, and scope. Activity/run attribution records that identity.
- Durable run IDs replace short-lived handles for long work.
- Start returns quickly with job/run ID, selection count, estimate, dashboard
  URL, and `existing` idempotency signal. Status/detail is paged.
- Errors are stable JSON with code, message, retryable flag, and safe details;
  no prompt, secret, stack, or raw private evidence is returned.

## Review, events, and client projection

- Brand review uses one grouped `brand_generation` adapter with one typed item
  per source `BrandDeliverable` and per-item `approve|changes_requested`.
- Review decisions require a human operator/client actor; automatic/system/MCP
  approval is not a valid shared shape, and `changes_requested` requires a note.
- Unresolved `ready` evidence prevents send. Item approval updates that source
  draft→approved only when its expected version matches. Changes requested
  preserves the note, keeps/returns the source in draft, and marks that run item
  accordingly. The group is `partial` until all items are terminal and is
  `approved` only when all items are approved.
- Voice foundation uses a separate review bundle/gate. Client approval never
  finalizes voice; operator anchor selection plus `finalize_brand_voice` does.
- Drafts, raw intake, internal evidence/audit, prompts, and provenance never
  enter public/client serializers.
- `ClientBrandSummary` contains only approved/client-visible resolved fields and
  a safe voice summary.
- Every committed workspace mutation logs activity and broadcasts a canonical
  event. Every new event has a matching `useWorkspaceEvents` invalidation in the
  same PR.
- B0 emits existing `WS_EVENTS.WORKSPACE_UPDATED` with typed intake-revision
  metadata. All planned work reuses workspace, content/brief/post, brand/voice,
  deliverable, and job events unless this contract is amended first.
- Matrix/brief/post mutations invalidate existing content keys; brand/intake
  mutations invalidate brand/voice/intelligence and client-safe workspace keys;
  Inbox uses existing deliverable invalidation.

## Feature flags

Only these new product flags are authorized:

| Flag | Scope | Default | Gates | Does not gate |
|---|---|---|---|---|
| `content-matrix-generation` | server/workspace | OFF | paid matrix run start + start UI | preflight correctness, CAS, scope, failure truth |
| `brand-deliverable-generation` | server/workspace | OFF | paid brand run start + start UI | intake validation, voice invariants, CAS, client safety |

The final orchestration requires both. It does not add a composite flag. Client
renderers are additive and data-driven; no plan assumes a workspace server
override reaches the global frontend `useFeatureFlag` hook.

## Amendment and verification rule

Any change to identity, source revision, status, evidence classification,
placeholder convention, voice authority, section census, operation name, job
type, tool schema, event, client visibility, flag boundary, or budget must update
this contract, the specification, and all unmerged dependent phase plans before
implementation continues.
