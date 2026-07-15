# C2 Content Edit Safety and Provenance — Implementation Plan

**Status:** implementation and adversarial reconciliation in progress on `codex/content-edit-safety-c2`; PR, required CI, staging merge, and post-merge staging verification remain pending
**Phase owner:** `content-pipeline`
**Secondary owner:** `platform-foundation` for background-job claims
**Program:** `genq-content-generation-integrity`
**Depends on:** G1 AI execution metadata and C1 truthful content completion
**Unlocks:** C3 content context/evidence efficiency, then matrix generation M1

## Outcome

An operator or client edit, lifecycle decision, or approval always wins over in-flight AI work. Every adopted generated brief, post, and copy section has internal run provenance. Two requests for the same generation resource cannot duplicate paid work, while unrelated resources in one workspace can run concurrently.

This is an unflagged correctness phase. It changes no content semantics and exposes no new client-visible fields.

## Audit anchors

- Program audit: `docs/superpowers/audits/2026-07-13-generation-quality-performance-preplan-audit.md`
- Program spec: `docs/superpowers/specs/2026-07-13-generation-quality-performance-program-spec.md`
- Cross-phase contract: `docs/superpowers/plans/2026-07-13-generation-quality-cross-phase-contracts.md`
- Runtime rule: `docs/rules/generation-runtime-integrity.md`
- Background-job rule: `docs/rules/background-generation.md`
- Owning context: `content-pipeline`; job acceptance belongs to `platform-foundation`

The pre-plan census verified all production writers. Artifact SQL is confined to `server/content-brief.ts`, `server/content-posts-db.ts`, and `server/copy-review.ts`, aside from legacy importers that rely on column defaults. The highest-risk seams are whole-row post saves after every AI stage, brief successor insertion before lineage validation, copy delete/reinsert after paid work, request-level approvals that do not currently invalidate artifact writes, and workspace-wide check-then-create job dedupe.

## People and trust contract

- **Busy operator:** expects manual edits and approvals never to disappear, and expects a duplicate click to return the active job rather than spend again.
- **Client reviewer:** expects approval or requested changes to become authoritative immediately, even when the artifact row itself has a separate lifecycle.
- **MCP automation:** expects durable IDs, atomic expected-revision writes, deterministic conflict results, and safe retry behavior.
- **Board or compliance reviewer:** expects every adopted AI artifact to identify the actual provider run and exact effective-input fingerprint without exposing prompts or secrets.

The distrust triggers are silent overwrites, false success events, orphan replacement briefs, duplicate provider spend, approved copy returning to draft, and private provenance appearing in a client payload.

## Binding decisions

### 1. Revision semantics

- Migration 189 adds `generation_revision INTEGER NOT NULL DEFAULT 0` and nullable `generation_provenance TEXT` to `content_briefs`, `content_posts`, and `copy_sections`.
- Legacy and manually created rows read as revision `0` with null provenance.
- Every successful operator edit, client decision, lifecycle mutation, publish/schedule stamp, steering note, suggestion, or generation commit increments the artifact revision exactly once.
- Invalid, no-op, not-found, rolled-back, and stale writes do not increment it.
- A generation save uses `WHERE generation_revision = expectedRevision`; the revision comparison, content/status write, provenance write, sibling metadata, snapshots, and lineage changes share one transaction.
- `CopySection.version` remains the business/approval-attempt counter and is never reused as the generation revision.

### 2. Conflict and replacement semantics

- Automatic/background work stops on the first revision conflict, preserves the winning state, and emits no success-semantic activity, notification, or downstream job.
- A conflict never flows through a generic failure writer that could overwrite the winning edit with an error state.
- Explicit regeneration/replacement is an authorized action only when it carries the revision observed when the action began. It still fails if any newer state appeared.
- Approved post/copy state and linked content-request client decisions are authoritative. Sending to review, approving, declining, or requesting changes bumps the linked artifact revision in the same transaction as the request transition.
- Paid work is not rerun solely because its final commit lost a race.

### 3. Provenance semantics

- `GenerationProvenance.runId`, provider, model, and operation describe the accepted AI execution that directly authorized the adopted output.
- `executionChainId` correlates every stage of a logical job/workflow.
- A composite artifact additionally stores an ordered, bounded `executions` list containing the accepted contributing executions and their exact effective-input fingerprints.
- A single-call fingerprint hashes the exact provider-rendered system/messages after research/authority resolution. A composite fingerprint hashes the ordered accepted execution fingerprints plus deterministic authority inputs.
- When a repair output is adopted, provenance identifies the accepted repair call; the rejected response remains trace evidence, not adopted artifact provenance.
- Provenance stores identifiers and hashes only—never raw prompts, generated content, credentials, or secrets.
- One shared Zod schema validates provenance at every DB boundary. Malformed legacy JSON degrades to null with contextual logging.

### 4. Resource-scoped job identity

- Migration 189 adds normalized `job_resource_claims` because one batch can claim many entries.
- The active uniqueness boundary is `(workspace_id, resource_type, resource_id)` across job types, not job type plus workspace.
- Claims are canonicalized, sorted, deduplicated, and inserted atomically with the generic job plus any skeleton/domain acceptance row. The unique index decides conflicts; there is no preflight check-then-create race.
- Required identities are request/target-backed brief generation, `content_brief:<briefId>`, `content_post_for_brief:<briefId>`, `content_post:<postId>`, and `copy_entry:<entryId>`.
- A copy batch claims every entry before any work. Overlapping batches conflict atomically; disjoint batches in one workspace may run concurrently.
- Done/error releases claims transactionally. Cancellation retains claims until the worker abort path drains and unregisters. Restart recovery marks unreachable jobs terminal and releases their claims.
- Conflict surfaces return deterministic HTTP 409/MCP conflict information with the active job ID and start no provider work.
- Resource claims remain server-internal on public/client job payloads.
- Manually managed workers release claims idempotently only after their provider,
  artifact, and terminal-bookkeeping paths have fully drained. If both the
  intended terminal job write and its fallback tracking write fail, final drain
  still releases the claim without relabeling an already-committed artifact or
  domain outcome.

### 5. Public privacy

- Admin and MCP boundaries may expose revision/provenance where their typed contract requires it.
- Public brief/post JSON, client mutation responses, copy review payloads,
  unified deliverables, and authenticated exports omit `generationRevision`,
  `generationProvenance`, `runId`, and `inputFingerprint`. Public briefs also
  omit raw `sourceEvidence`; authenticated brief exports intentionally retain
  that evidence while stripping generation authority.
- Public content-request reads and mutation receipts use the explicit
  `PublicContentTopicRequest` projection. It omits workspace identity, rationale,
  client/internal notes, decline reason, target page IDs/slugs, recommendation
  identity/context, and preserves the established status-gated visibility of
  brief, post, and delivery fields.
- Public serializers use explicit safe projections; spread-based serializers must explicitly strip internal fields.

### 6. External MCP provenance and source authority

- Server-prepared external prose is attributed honestly: the exact complete
  prepared context is fingerprinted before it leaves the server, while adopted
  output records `provider: 'external'` and `model: 'unreported'`. Caller text
  never supplies or upgrades provider/model attribution.
- One-time brief/post preparation handles retain that frozen preparation. Post
  adoption re-reads and requires the exact source brief generation revision in
  the same transaction as handle consumption, artifact creation, and any linked
  content-request update. Validation, link, or authority failure rolls back the
  handle deletion and every write.
- An optional parent content request is selected only by
  `prepare_brief_context` / `prepare_post_context`. Its `{id, updatedAt}`
  authority is included in the exact prepared fingerprint and handle, alongside
  target-keyword and brief-lineage constraints. `save_brief` / `save_post`
  cannot adopt a free parent id; a repeated save-time id must exactly match the
  prepared parent, which is re-read and conditionally linked inside the atomic
  adoption transaction. Parent drift rolls back every write and preserves the
  one-time handle. Parent lifecycle is also preflighted before context assembly,
  rechecked in the final prepared snapshot, and checked again during adoption:
  the selected request must be able to advance to `brief_generated` or
  `in_progress` for the producing tool. Correctable payload validation or a
  transient write failure may retry the preserved handle; source, parent,
  lifecycle, or durable-link authority drift leaves that frozen handle stale and
  requires a fresh `prepare_*_context` call.
- Migration 191 adds provenance to `content_post_versions`. A revert adopts the
  snapshot's original attribution (or null for a legacy snapshot) and cannot
  borrow the current post's newer provenance.
- A send command that carries an explicit content-request ID is pinned to that
  exact workspace-scoped request. Missing and cross-workspace identities abort
  atomically; send never retargets to an implicit request or creates a replacement.
- Saved brief/post handles are inspected without deletion, then consumed as the
  final DB-only authorization step inside the durable send transaction. Failed
  sends preserve the handle; successful sends consume it exactly once before
  post-commit notification effects run.

### 7. Serialized editor authority

- Independent rich-text debouncers for one mounted post share one
  artifact-scoped `useSerializedArtifactSave` queue. Only an accepted response
  advances its private revision/review-token authority; external authority
  changes invalidate stale queued or in-flight edits instead of rebasing them.
- Debounced edits bind a one-shot serializer attempt at schedule time, freezing
  both their target payload and authority epoch before the timer begins. A newer
  canonical revision observed before timer fire or flush rejects without a PATCH.
- Save conflicts and failures propagate without a hidden retry.
  `useAutoSave.flush()` drains in order, returns `{ ok: false }` after a failure,
  and lifecycle decisions or editor-context switches stop until the user
  explicitly retries or resets.
- Explicit retry replays the retained payload as a distinct attempt pinned to the
  authority used by the failed request. A newer canonical authority rejects the
  retry locally without a PATCH; it is never silently rebased.
- Copy suggestion `originalText` is a frozen source claim. Adoption compares it
  to the authoritative section copy inside the revision-conditional mutation;
  mismatch creates no suggestion, status transition, or revision.

### 8. Post-commit truthfulness and publish reconciliation

- Required artifact transitions and terminal job state commit before optional
  activity, broadcast, cache, notification, outcome, reconciliation-cleanup, or
  follow-on effects. Each effect is independently guarded, so a later failure
  cannot rewrite committed status, produce an HTTP/job failure, or suppress the
  remaining effects.
- Migration 190 adds `content_publish_reconciliations`. When Webflow create,
  update, or publish succeeds but the local post CAS loses, the ledger retains
  the external item identity and state; retry reuses that item rather than
  creating a duplicate, then resolves the row after the local stamp succeeds.
- Publish acceptance also freezes the effective site/collection/field-map,
  one-way token identity, and exact brief-summary revision. Every external
  boundary revalidates that authority. Partial local stamps, stamps belonging to
  another collection, and unresolved identity in any collection fail closed
  before create, so configuration drift cannot fork one post into two Webflow
  items.
- A committed artifact/domain outcome is never relabeled as generation failure
  because generic terminal-job bookkeeping failed. The job records an explicit
  `completion_tracking_failed` result when possible, optional completion effects
  wait for a verified durable terminal, and final worker drain releases manual
  claims without rewriting the outcome.
- Detached brief, post, and copy workers attach an outer rejection observer with
  job/resource context, so even a terminal-finalizer failure cannot become an
  unhandled process rejection.
- Post deletion is blocked while a resource-scoped post/publish job is active or
  a publish-reconciliation row remains unresolved. Deletion becomes eligible
  only after the worker drains and reconciliation resolves.
- Because any content-request mutation advances its previously linked artifact
  revisions, `CONTENT_REQUEST_CREATED` / `CONTENT_REQUEST_UPDATE` invalidation
  refreshes admin brief/post lists and detail authorities plus client content,
  Inbox, preview, and intelligence readers. MCP reuses that shared event instead
  of emitting a duplicate post event.

## Dependency graph

```text
F0 controller: plan/spec/rule + shared types/schema/helper + migration 189
  + typed revision conflict + resource-claim API/signatures + foundation tests
  + checkpoint commit
        ├── P post storage/generation/review/publish lane
        ├── B brief storage/generation/regeneration/lineage lane
        └── C copy storage/generation/batch/review lane
P + B + C
  → I controller integration: routes + MCP + client decisions + public serializers
  → targeted and affected/full gates
  → independent adversarial review and fixes
  → ready PR → CI green → staging merge → post-merge staging CI green
```

No implementation lane starts before F0 is committed. Every lane owns an exclusive file set; a lane that needs another owner’s file reports `NEEDS_CONTEXT` rather than editing it.

## F0 — Foundation checkpoint (controller, GPT-5.5)

**Owns:** shared artifact/AI/job types, migration 189, shared provenance schema/helper, `server/jobs.ts`, job foundation tests, AI operation registry, program/spec/rule/plan amendments.

Tasks:

1. Extend the shared provenance contract with chain and accepted-execution metadata; centralize schema validation and canonical fingerprints.
2. Add artifact revision/provenance fields with internal-only JSDoc.
3. Add the migration and resource-claim table/index without destructive SQL.
4. Add typed `GenerationRevisionConflictError`, conditional-save result vocabulary, `JobResourceRef`, `ActiveJobResourceConflict`, and atomic resource-scoped job acceptance/release/recovery APIs.
5. Register missing brief/post stage operations and pass caller-owned `executionChainId` through the creative wrapper.
6. Add focused contract, migration, provenance, job race, cancellation-drain, recovery, and public-type tests.
7. Run typecheck and focused tests, review the staged diff, then commit this foundation before dispatch.

Acceptance:

- Existing rows survive migration at revision 0/null provenance.
- Same-resource concurrent acceptance creates one job; disjoint resources both succeed.
- Multi-resource overlap rolls back the entire losing acceptance.
- No job broadcast/cache insertion occurs before commit.
- Cancelled claims are retained until worker drain; restart recovery clears unreachable claims.
- Existing recommendation, keyword-strategy, and brand provenance remains readable under the shared schema.

## P — Post lane (exclusive owner, GPT-5.5)

**Owns:** `server/content-posts-db.ts`, `server/content-posts.ts`, `server/content-posts-ai.ts`, `server/content-posts-ai-jobs.ts`, publish-post domain service, and focused post tests. It does not edit routes, shared types, jobs, MCP, or public serializers.

Tasks:

1. Map and validate revision/provenance; split create from conditional update; make version snapshot/revert atomic with CAS.
2. Thread expected revisions through context, intro, each body section, conclusion, partial/failure/cancel handling, unification, SEO metadata, and finalization. Stop immediately on conflict.
3. Preserve actual AI metadata and exact effective-input fingerprints from creative, structured, review, voice, and fix calls.
4. Make section regeneration an explicit expected-revision replacement; snapshot only inside the successful transaction.
5. Make review/voice annotations CAS-safe while preserving content-generation provenance. Return the source revision with AI-fix suggestions so application is a distinct CAS action.
6. Protect Webflow publish stamps against stale writes and explicitly reconcile external success with a local revision conflict.

Acceptance:

- An injected edit/approval at every long stage survives unchanged.
- Conflict never marks the winning post failed or emits generated/published success.
- Initial skeleton and job acceptance are atomic and resource scoped.
- Composite post provenance retains all accepted contributing execution metadata.
- Approved posts cannot be regenerated by an automatic path.

## B — Brief lane (exclusive owner, GPT-5.5)

**Owns:** `server/content-brief.ts`, `server/content-brief-read-model.ts`, `server/content-brief-generation-job.ts`, `server/content-brief-regenerate-job.ts`, and focused brief tests. It does not edit routes, shared types, jobs, MCP, or public serializers.

Tasks:

1. Map revision/provenance and provide create, human bump, and generation CAS primitives.
2. Persist fresh generation provenance with evidence in one artifact commit.
3. Full regeneration conditionally claims the source revision before inserting the successor and setting lineage; a conflict creates no orphan row.
4. Outline regeneration commits only against its starting revision.
5. Carry expected revisions through background job payloads and resource identities.
6. Treat linked request review/approval authority as a finalization precondition supplied by the integration layer.

Acceptance:

- Concurrent full regeneration yields one successor and correct `superseded_by` lineage.
- Outline edits and request decisions during generation defeat the stale output.
- No generic evidence attachment creates an extra uncontrolled write.
- Fresh and repaired outputs store the actual accepted run provenance.

## C — Copy lane (exclusive owner, GPT-5.5)

**Owns:** `server/copy-review.ts`, `server/copy-generation.ts`, copy entry/batch job modules, copy schemas, copy route module, unified copy deliverable adapter, and focused copy tests. It does not edit shared types, generic jobs, MCP, or public-content routes.

Tasks:

1. Map revision/provenance and make every successful status, steering, suggestion, text, and generated-copy mutation increment revision once.
2. Snapshot the full stable section census before paid work. The final transaction verifies IDs, plan IDs, order, revisions, statuses, additions/removals, and approval authority before replacing content.
3. Preserve stable section IDs, created time, business version, feedback, lifecycle, and curation metadata; never delete/reinsert protected rows blindly.
4. Commit all sections plus SEO/OG metadata atomically with adopted-call provenance. A repair records the repair execution.
5. Section regeneration carries the post-steering revision through AI and uses a conditional final save.
6. Claim every canonical entry for single and batch generation; reject duplicate batch entry IDs and allow disjoint batches.
7. Keep internal generation fields out of public and unified deliverable projections.

Acceptance:

- Edit, suggestion, send, approval, add/remove/reorder, and empty-to-nonempty races all preserve newer state.
- Metadata rolls back with a lost section-census CAS.
- Approved copy never returns to draft.
- `version` and `generationRevision` remain independently correct.
- Batch/single overlap performs one paid generation for each claimed entry.

## I — Integration and closeout (controller, GPT-5.5)

**Owns:** admin/shared routes not assigned above, `server/routes/public-content.ts`, request lifecycle services/routes, MCP content tools and schemas, frontend API types only if required, docs/audit/roadmap/features, and cross-seam tests.

Tasks:

1. Replace workspace-wide guards with resource-scoped acceptance across direct routes and `/api/jobs`; map typed conflicts to consistent 409/MCP results.
2. Require expected revisions for admin/client/MCP edit, regeneration, revert, delete, and suggestion-application paths. Convert the MCP SHA precheck to an atomic durable revision contract without a TOCTOU window; freeze optional content-request parent authority and preflight its legal lifecycle transition during prepare rather than accepting adoption-time parent selection.
3. Bump linked artifact revisions in the same transaction as send/review/approve/change-request transitions.
4. Consolidate double-write routes so one logical mutation produces one revision.
5. Add explicit public-safe projections and negative raw-response assertions for all forbidden provenance fields and operator-only content-request fields, while preserving authenticated brief-export evidence.
6. Update `FEATURE_AUDIT.md`, `data/roadmap.json`, and `data/features.json` if the shipped safety is sales-relevant; sort roadmap.
7. Run an independent adversarial review, fix every actionable finding, then execute full PR gates.

## Verification matrix

Focused gates run during each lane; the controller reruns integrated suites after every parallel batch.

- `npm run typecheck`
- `npm run pr-check`
- `npm run lint:hooks`
- `npx vite build`
- Migration preservation and mapper completeness tests
- Migration 190 publish-reconciliation and migration 191 version-provenance tests
- Job claim/recovery/cancellation/status-transition unit tests
- Brief/post/copy generation mutation-safety integration tests
- External MCP prepared-context fingerprint, source/parent-revision,
  parent-keyword/brief-lineage/lifecycle preflight, correctable same-handle retry,
  stale-authority reprepare, and atomic handle-adoption tests
- Explicit send-request tests proving missing and cross-workspace IDs create no
  fallback request, artifact revision, email, broadcast, or activity
- MCP brief/post send tests proving a failed durable send retains its one-time
  handle and a successful retry consumes it exactly once
- Serialized autosave authority/flush failure component and hook tests
- Admin and public copy-suggestion tests proving current authority plus false
  original text is rejected without a suggestion or revision
- Terminal-bookkeeping and post-commit effect-injection tests proving committed
  artifacts/domain outcomes remain truthful, optional effects wait for verified
  durable terminal state, and manually drained workers release claims after both
  terminal writes fail
- Detached-worker source contract proving every C2 fire-and-forget launch
  observes its outer rejection
- Direct-route and `/api/jobs` parity tests
- MCP content generation/action contract tests
- Public content/request, copy review, unified deliverable, and export privacy
  tests, including authenticated export evidence retention
- Fresh `origin/staging` versus C2 manifest builds with an exact-delta bundle
  ratchet (1,809,882 → 1,815,469 gzip bytes, +5,587) limited to C2-owned
  serialization/content-editor/review entries
- `npx vitest run` using repository worker limits when broad verification is required

### Local closeout evidence — 2026-07-14

- Static/platform gates passed: typecheck, pr-check, hooks lint, lexicon,
  feature-flag and deferred-ledger verification, diff check, Vite production and
  manifest builds, and the exact-delta bundle-budget ratchet.
- Contract: 164 files / 1,906 tests passed.
- Component: 392 files / 5,083 tests passed, with one skipped and three todo.
- Unit: 1,008 files / 15,697 tests passed.
- Integration: the three CI-equivalent 198-file shards passed 2,754, 2,487, and
  2,444 tests respectively (594 files / 7,685 tests total) at the CI runner's
  effective three-worker concurrency. The local machine's unbounded 13-worker
  default caused systemic server-startup contention and is not the CI topology.
- The first shard-3 run found a real authority-precedence/lifecycle-response bug
  and invalid Promise mocks. The fix makes stale request authority win before
  lifecycle validation inside atomic job acceptance, maps a fresh invalid
  lifecycle to typed HTTP 409, and keeps detached-worker mocks honest. The
  affected 12-test cluster, typecheck, independent adversarial remediation
  review, and the complete 2,444-test shard rerun passed.

Adversarial injection points include every post stage, brief research/full/outline/finalization, copy context/main/repair/section/metadata finalization, client decisions, serialized field saves, MCP handle consumption, source/parent lifecycle adoption, external publish/local reconciliation and deletion, each terminal bookkeeping write and post-commit effect, cancellation/drain, duplicate starts, overlapping batches, malformed provenance, and retry after terminal failure.

## PR and release gates

1. Review the full diff against the exclusive ownership map and shared checkpoint.
2. Verify no new raw provider-helper import, workspace-wide generation guard, public provenance field, or non-CAS generation update exists.
3. Run an independent GPT-5.5 adversarial review focused on TOCTOU, cancellation drain, lifecycle authority, orphan rows, false success, and serializer leakage.
4. Fix all actionable findings and rerun affected plus full required gates.
5. Push one ready C2 PR to `staging`; wait for every required check to pass.
6. Merge only after CI green; fetch `origin/staging`, verify the merge ancestor, and wait for post-merge staging CI/E2E green.
7. Start C3 only from that verified staging commit.

## Deliberate non-goals

- No prompt/context/ranking change; C3 owns those semantics behind `content-generation-context-v2`.
- No client UI provenance display.
- No completed-response cache policy change beyond naming missing generation operations.
- No destructive migration or revision-history backfill.
- No production feature-flag change.

## Systemic improvement included

The phase replaces route-local dedupe and artifact-specific stale-write patterns with two reusable platform contracts: atomic multi-resource job claims and a shared typed generation-provenance/CAS boundary. Future matrix and brand/content generators import these primitives instead of inventing new locks, hashes, or conflict shapes.
