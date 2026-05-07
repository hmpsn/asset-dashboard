# Platform Consolidation Phase 0 - Baseline Audit Plan

## Overview

Phase 0 establishes the verified baseline for platform consolidation before any implementation work begins. The goal is to audit every long-running admin generation surface, confirm which already use the background job system, identify drifted synchronous flows, and define the contracts Phase 1+ must follow.

This phase is audit and planning only. It should not migrate generation flows yet.

Status: completed on 2026-05-04. Final baseline lives in `docs/superpowers/audits/2026-05-04-platform-consolidation-audit.md`.

## Why Phase 0 Exists

The platform already has useful background-job infrastructure:

- `server/routes/jobs.ts`
- `src/hooks/useBackgroundTasks.tsx`
- `src/components/TaskPanel.tsx`

The floating task modal is therefore an asset, not something to replace by default. Phase 0 should decide how far the existing `TaskPanel`/`useBackgroundTasks` model can stretch and where it needs a contract, shared adapter, or guardrail.

## Task Dependencies

Sequential:

Task 1 (Staging Baseline) -> Task 2 (Generation Inventory) -> Task 3 (Coverage Classification) -> Task 4 (Contract Draft)

Parallel after Task 2:

Task 5 (UX Surface Audit) || Task 6 (Server Job Capability Audit) || Task 7 (Guardrail/Test Gap Audit)

Sequential after parallel batch:

Task 8 (Synthesis) -> Task 9 (Roadmap Reconciliation)

## Task 1 - Staging Baseline

Model: `sonnet`

Owns:

- Audit notes only

Reads:

- `data/roadmap.json`
- `docs/superpowers/audits/2026-05-04-platform-consolidation-audit.md`
- `server/routes/jobs.ts`
- `src/hooks/useBackgroundTasks.tsx`
- `src/components/TaskPanel.tsx`

Steps:

1. Branch from fresh `origin/staging`.
2. Record commit SHA and latest merged PR context.
3. Check stash list for related prior audit work.
4. Confirm whether platform-consolidation roadmap/audit artifacts already exist.

Acceptance:

- Baseline commit recorded.
- Stash relevance documented.
- No assumptions made from older local branches.

## Task 2 - Generation Inventory

Model: `sonnet`

Owns:

- Audit findings table

Reads:

- `server/routes/jobs.ts`
- `server/routes/content-requests.ts`
- `server/routes/content-posts.ts`
- `server/routes/webflow-seo.ts`
- `server/routes/keyword-strategy.ts`
- `server/routes/workspaces.ts`
- `src/components/ContentBriefs.tsx`
- `src/components/PostEditor.tsx`
- `src/components/SchemaSuggester.tsx`
- `src/components/SeoAudit.tsx`
- `src/components/PageIntelligence.tsx`
- `src/components/SeoEditor.tsx`
- `src/components/TaskPanel.tsx`

Steps:

1. Inventory every admin generation trigger.
2. Record entry point, server endpoint, duration risk, current execution mode, progress UI, cancellation support, and completion invalidation.
3. Include these known target areas:
   - Keyword strategy
   - Site audit
   - Page analysis
   - Schema generation
   - CMS schema template generation
   - Bulk content generation
   - Brief generation
   - Post generation
   - Section regeneration
   - Content-plan/matrix bulk actions
   - AEO/page rewrite generation
   - Brand/page deliverables

Acceptance:

- Every listed target area is classified as `job-backed`, `partially job-backed`, `synchronous`, or `not applicable`.
- Each classification includes file references.

## Task 3 - Coverage Classification

Model: `sonnet`

Owns:

- Coverage matrix

Steps:

1. Classify each generation flow by whether it uses `/api/jobs`, feature-specific bulk job endpoints, or direct synchronous route calls.
2. Mark existing job-backed flows that should remain unchanged.
3. Mark drifted flows that Phase 1 should migrate.
4. Mark short interactive refinements that may deserve explicit exceptions.

Acceptance:

- No roadmap item says background jobs are missing wholesale.
- Existing coverage is preserved and acknowledged.
- Phase 1 scope is limited to drifted or missing surfaces.

## Task 4 - Background Generation Contract Draft

Model: `opus`

Owns:

- Contract section in audit or follow-up guardrails doc

Contract must define:

- How a generation flow starts.
- Required job type naming.
- Required job metadata.
- Progress and total semantics.
- Cancellation expectations.
- Result handoff behavior.
- Activity logging.
- Usage/rate-limit accounting.
- Broadcast and React Query invalidation.
- Error and retry behavior.
- Which short operations can remain synchronous.

Acceptance:

- Contract is specific enough to implement from.
- Exceptions are explicit and reviewable.

## Task 5 - UX Surface Audit

Model: `sonnet`

Owns:

- UX audit section only

Reads:

- `src/components/TaskPanel.tsx`
- `src/hooks/useBackgroundTasks.tsx`
- `src/components/NotificationBell.tsx`
- `src/components/SeoAudit.tsx`
- `src/components/SchemaSuggester.tsx`
- `src/components/PageIntelligence.tsx`
- `src/components/SeoEditor.tsx`

Questions:

- Can `TaskPanel` be the canonical admin job surface?
- Does it show enough context for queued/running/completed/error jobs?
- Can users resume work after route changes or refresh?
- Does cancellation behave consistently?
- Should completion feed into the future unified notification hub?
- Does `useBackgroundTasks` need to share the same WebSocket connection as `useWorkspaceEvents`?

Acceptance:

- Recommendation states whether to evolve `TaskPanel`, split it, or replace it.
- Recommendation includes minimum UX parity requirements for Phase 1.

## Task 6 - Server Job Capability Audit

Model: `sonnet`

Owns:

- Server findings only

Reads:

- `server/routes/jobs.ts`
- `server/jobs.ts`
- `server/broadcast.ts`
- `server/ws-events.ts`
- relevant route files for generation endpoints

Questions:

- Which job types already support progress?
- Which support cancellation safely?
- Which write results into durable storage?
- Which only return ephemeral `job.result`?
- Which update activity logs?
- Which broadcast completion events or invalidate caches?
- Are there single-flight guards for expensive generation?

Acceptance:

- Phase 1 knows whether to extend `server/routes/jobs.ts` directly or extract job handlers.
- Any shared-job-handler extraction candidate is documented.

## Task 7 - Guardrail And Test Gap Audit

Model: `opus`

Owns:

- Guardrail/test recommendation section

Questions:

- Can a pr-check rule detect new synchronous admin generation endpoints?
- Should the rule be route-based, API-client-based, or allowlist-based?
- What tests should protect job lifecycle behavior?
- What tests should prove completion invalidates the right React Query keys?
- What tests should prove `TaskPanel` sees running jobs after remount?

Acceptance:

- Recommended guardrail is concrete enough for a Phase 1 or Phase 2 task.
- Test list includes exact likely test files or new test names.

## Task 8 - Synthesis

Model: `opus`

Owns:

- Final Phase 0 audit artifact

Steps:

1. Merge findings into a single table.
2. Mark each finding `resolved`, `still valid`, `reframed`, or `needs implementation`.
3. Update `docs/superpowers/audits/2026-05-04-platform-consolidation-audit.md`.
4. Include recommended Phase 1 work order.

Acceptance:

- User can see exactly what staging already fixed and what remains.
- Phase 1 can start without another discovery pass.

## Task 9 - Roadmap Reconciliation

Model: `haiku`

Owns:

- `data/roadmap.json`

Steps:

1. Update `sprint-platform-consolidation` based on Phase 0 findings.
2. Avoid duplicate IDs.
3. Rehome existing related items only when it reduces ambiguity.
4. Run `npx tsx scripts/sort-roadmap.ts`.

Acceptance:

- Roadmap JSON is valid.
- `scripts/pr-check.ts` roadmap ID uniqueness passes.
- Each Phase 1+ roadmap item references the audit.

## Systemic Improvements

Shared utilities to consider:

- Shared job-starting API wrapper for admin generation.
- Shared generation job result handoff helper.
- Shared job type constants instead of raw strings.
- Shared progress message vocabulary.

pr-check rules to consider:

- Flag new admin generation routes that call AI/generation helpers synchronously without a job exception.
- Flag new `startJob('<raw-string>')` values not registered in shared job type constants.
- Flag new raw WebSocket creation if a shared event bus exists.

Tests to add later:

- Contract test for registered job types and labels.
- Integration test for job lifecycle: create, progress, complete, cancel.
- Component test for `TaskPanel` rendering active/completed/error jobs.
- Route tests for migrated brief/post generation flows.

## Verification Strategy

Phase 0 verification:

```bash
npx tsx scripts/sort-roadmap.ts
npx tsx scripts/pr-check.ts
node -e "JSON.parse(require('fs').readFileSync('data/roadmap.json','utf8')); console.log('roadmap valid')"
```

If Phase 0 changes only docs and roadmap, full typecheck/build is not required before review. Phase 1 implementation plans must include:

```bash
npm run typecheck
npx vite build
npx vitest run
npx tsx scripts/pr-check.ts
```

## Phase 0 Exit Criteria

- Baseline audit completed against fresh `origin/staging`.
- Existing `TaskPanel`/`useBackgroundTasks` role decided.
- All admin generation flows inventoried.
- Drifted flows identified.
- Background generation contract drafted.
- Guardrail/test recommendations written.
- Roadmap reconciled without duplicate IDs.
