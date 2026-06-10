# PR 4 — Copy Pipeline: Brief Reuse + Background Execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) + `requesting-code-review` before PR. Contract+test-centric. Per task: READ real code → failing test (red for the right reason) → minimal implementation → green + typecheck → commit. STOP and record in the PR body if real code contradicts a contract.

**Goal:** Fix confirmed audit finding #6 (copy pipeline): eliminate the wasteful per-call brief regeneration (reuse `entry.briefId`, skip on section regenerate) and move single-entry copy generation onto the existing background-job platform so it honors its `background-only` operation contract.

**Branch:** `claude/audit-pr4-copy-pipeline-jobs` off `origin/staging` (`f93d37bf`). **Base PR:** `staging`.

**Owning bounded context:** content generation / copy pipeline (`server/copy-generation.ts`, `server/routes/copy-pipeline.ts`, `server/copy-batch-jobs.ts`); secondary: `src/hooks/admin/useCopyPipeline.ts`, `src/api/brand-engine.ts`.

**SCOPE NOTE (recorded):** the audit's "background-job migrations" group also covers blueprint generation (#7) and four admin crawls (#9, verifier-downgraded to medium). Blueprint's frontend `onSuccess` navigates using the returned blueprint (`PageStrategyTab.tsx:43`), so its job migration needs real frontend rework; the crawls are a separate admin-tools surface. **Both move to PR 4b** (`2026-06-09-pr4b-blueprint-and-crawls.md`, authored when reached), where the pr-check sync-loop mechanization can be validated against all migrated routes at once. PR 4 is the cohesive copy-pipeline slice with low frontend risk.

**Verified facts (re-checked @ f93d37bf):**
- `buildCopyGenerationContext` Layer 4.5 (`copy-generation.ts:432-458`) calls `generateBrief(wsId, entry.primaryKeyword, {...}, { persist: false })` UNCONDITIONALLY when `entry.primaryKeyword` exists — a gpt-5.4 7000-token research-mode call + up to 4 context assemblies, discarded except ~8 summary lines.
- `entry.briefId?: string` (`shared/types/page-strategy.ts:53`) is populated by blueprint auto-brief generation and points to a persisted brief. `getBrief(workspaceId, briefId)` (`content-brief.ts:320`) reads it.
- `buildCopyGenerationContext` is called by BOTH `generateCopyForEntry` (`:55`) and `regenerateSection` (`:186`).
- The copy-batch job platform exists: `createCopyBatchGenerationJob({ workspaceId, blueprintId, entryIds, mode, batchSize })` + `void runCopyBatchGenerationJob({...})` returns `{ jobId, batchId }`; the worker loops `entryIds` calling the SAME `generateCopyForEntry` (`copy-batch-jobs.ts:160-162`), so a batch-of-one is behavior-identical.
- `useGenerateCopy` (`useCopyPipeline.ts:75-87`) IGNORES the response body (`_data`) and only invalidates copy queries — the UI refreshes from the DB + WS broadcasts, not the sync response. The sync route broadcasts `COPY_SECTION_UPDATED` + `COPY_METADATA_UPDATED` after generating.

---

## Task Dependencies
```
Task 1 (brief reuse in buildCopyGenerationContext)  — backend only, no frontend
Task 2 (skip brief enrichment on regenerateSection) — depends on Task 1's flag
Task 3 (single-entry generate → job)                — depends on verifying section broadcasts; frontend hook update
```
Model: orchestrator-inline; reviewer Opus-tier.

## Task 1 — Reuse the persisted brief instead of regenerating
**Files:** `server/copy-generation.ts` (Layer 4.5 + signature), `server/content-brief.ts` (import `getBrief`). Test: extend `tests/unit/copy-generation-pure.test.ts` or new `tests/integration/copy-generation-brief-reuse.test.ts` (needs DB for getBrief — prefer integration).
**Contracts:**
1. Layer 4.5: when `entry.briefId` is set AND `getBrief(wsId, entry.briefId)` returns a brief, use it — NO `generateBrief` call. Only when `briefId` is absent/stale (getBrief returns undefined) fall back to the existing `generateBrief(..., { persist: false })`.
2. The enrichment block's output (the `briefLines` projection) is identical regardless of source — same fields read off the brief.
3. Failure of the fallback generate still degrades gracefully (existing try/catch unchanged).
**Test assertions:** (a) entry with a briefId pointing to a seeded brief → `generateBrief` is NOT called (spy/mock), and the context contains the brief's `suggestedTitle`; (b) entry with no briefId → fallback path still produces enrichment (existing behavior); (c) entry with a stale briefId (getBrief undefined) → falls back to generate.

## Task 2 — Skip brief enrichment on single-section regenerate
**Files:** `server/copy-generation.ts` (`buildCopyGenerationContext` gains `opts?: { skipBriefEnrichment?: boolean }`; `regenerateSection` passes `{ skipBriefEnrichment: true }`).
**Contracts:**
1. `regenerateSection` (a 150-word section tweak) must not trigger ANY brief read or generation — the steering note + section plan is sufficient context.
2. `generateCopyForEntry` (full entry) keeps brief enrichment (via Task 1's reuse path).
**Test assertions:** regenerateSection path → neither `getBrief` nor `generateBrief` is called; generateCopyForEntry path → brief enrichment present.

## Task 3 — Single-entry generation on the job platform
**Files:** `server/routes/copy-pipeline.ts` (`/generate` route), `src/hooks/admin/useCopyPipeline.ts`, `src/api/brand-engine.ts`. Test: extend `tests/integration/copy-pipeline-routes.test.ts`.
**Contracts:**
1. First READ `runCopyBatchGenerationJob` and confirm whether it (or `generateCopyForEntry`) broadcasts `COPY_SECTION_UPDATED` per entry. If the batch worker only emits `COPY_BATCH_PROGRESS/COMPLETE`, EITHER add a per-entry `COPY_SECTION_UPDATED` + `COPY_METADATA_UPDATED` broadcast in the worker loop OR have the single-entry frontend also invalidate on `COPY_BATCH_COMPLETE`. Pick the option that keeps the existing single-entry UI refreshing — verify which events `useCopyPipeline` / the pipeline WS handlers consume before choosing. **If neither is clean, STOP and record** — the brief-reuse wins (Tasks 1-2) ship regardless.
2. `/generate` route creates a batch-of-one (`createCopyBatchGenerationJob({ ..., entryIds: [entryId] })`) guarded by `hasActiveJob(COPY_BATCH_GENERATION, workspaceId)` (mirror the existing `/batch` route at `copy-pipeline.ts:266`), returns `{ jobId, batchId }`, runs `void runCopyBatchGenerationJob` after a tick.
3. `copyGeneration.generate` (api) return type changes to `{ jobId, batchId }`; `useGenerateCopy` keeps its invalidation onSuccess (now redundant-but-harmless; the WS broadcast drives the refresh) — confirm no caller reads `.sections` off the mutation result (grep).
4. The operation contract is now honored: `executionMode: 'background-only'` for `copy-generation` is no longer violated on the canonical path.
**Test assertions:** POST `/generate` returns `{ jobId, batchId }` (not `{ sections }`); a second concurrent POST returns 409; after the job runs, the entry's sections are persisted and a `COPY_SECTION_UPDATED` (or chosen event) broadcast fired.

## Systemic Improvements
- New tests: brief-reuse (no-regen), regenerate-skip, job-response contract.
- pr-check sync-AI-loop mechanization: **deferred to PR 4b** (validate against all migrated routes at once; a sync-await detector scoped to one route is low-value).
- Feature-class gates: performance/bugfix — full gates; no FEATURE_AUDIT/flag changes; BRAND_DESIGN unaffected.

## Verification Strategy
- [ ] `npx vitest run tests/integration/copy-pipeline-routes.test.ts tests/integration/copy-generation-brief-reuse.test.ts tests/unit/copy-generation-pure.test.ts`
- [ ] Full suite, typecheck, build, pr-check, flags, ratchet
- [ ] Preview: trigger a copy generation in the admin Page Strategy UI, confirm sections appear via the job path (TaskPanel shows progress; sections refresh on completion)
- [ ] `superpowers:requesting-code-review` — fix Important+ in-PR
