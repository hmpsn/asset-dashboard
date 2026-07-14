# C2 Content Edit Safety and Provenance — Implementation Plan

**Status:** approved for implementation after the foundation checkpoint commit
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

### 5. Public privacy

- Admin and MCP boundaries may expose revision/provenance where their typed contract requires it.
- Public brief/post JSON, client mutation responses, copy review payloads, unified deliverables, and exports omit `generationRevision`, `generationProvenance`, `runId`, and `inputFingerprint`.
- Public serializers use explicit safe projections; spread-based serializers must explicitly strip internal fields.

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
2. Require expected revisions for admin/client/MCP edit, regeneration, revert, delete, and suggestion-application paths. Convert the MCP SHA precheck to an atomic durable revision contract without a TOCTOU window.
3. Bump linked artifact revisions in the same transaction as send/review/approve/change-request transitions.
4. Consolidate double-write routes so one logical mutation produces one revision.
5. Add explicit public-safe projections and negative raw-response assertions for all forbidden provenance fields.
6. Update `FEATURE_AUDIT.md`, `data/roadmap.json`, and `data/features.json` if the shipped safety is sales-relevant; sort roadmap.
7. Run an independent adversarial review, fix every actionable finding, then execute full PR gates.

## Verification matrix

Focused gates run during each lane; the controller reruns integrated suites after every parallel batch.

- `npm run typecheck`
- `npm run pr-check`
- `npm run lint:hooks`
- `npx vite build`
- Migration preservation and mapper completeness tests
- Job claim/recovery/cancellation/status-transition unit tests
- Brief/post/copy generation mutation-safety integration tests
- Direct-route and `/api/jobs` parity tests
- MCP content generation/action contract tests
- Public content, copy review, unified deliverable, and export privacy tests
- `npx vitest run` using repository worker limits when broad verification is required

Adversarial injection points include every post stage, brief research/full/outline/finalization, copy context/main/repair/section/metadata finalization, client decisions, publish, cancellation, duplicate starts, overlapping batches, malformed provenance, and retry after terminal failure.

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
