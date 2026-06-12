# Keyword Surface Consolidation — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **CONTRACT + TEST-CENTRIC** (per `docs/PLAN_WRITING_GUIDE.md` → "Plans Are Contract + Test-Centric"). This plan specifies **contracts**, **test assertions**, **constraints**, and **structure**. Implementation **bodies are written at execution** against the real current code, with a real red→green loop — they are NOT pre-baked here. Code blocks below are contracts (signatures/types), test assertions, or trivial one-line deletes only.

**Goal:** Land the flag-agnostic Wave 1 stability quick wins — close the Critical `tracked_keywords` lost-update race, collapse the duplicate rank-tracking query keys, secure + de-cost the unauthenticated recommendations GET, and delete confirmed dead code — without touching the `seo-generation-quality` generation surface.

**Architecture:** Centralize every `tracked_keywords` mutation behind one nesting-safe `withTrackedKeywordsTxn` (BEGIN IMMEDIATE) helper; one rank-tracking query key; a route/job-boundary-only fix for the public recommendations GET; mechanical dead-code/schema removal.

**Tech Stack:** Express + TypeScript, better-sqlite3, React Query, vitest. Spec: `docs/plans/2026-06-03-keyword-surface-consolidation-plan.md`. Audit: `docs/superpowers/audits/2026-06-03-keyword-consolidation-wave1-audit.md`.

---

## Flag boundary & sequencing
Flag-agnostic; runs **in parallel with the Wave 0 gen-quality canary soak**. Task 3 (#13) is **route/job-boundary-only** — no changes to `generateRecommendations` internals (protects canary attribution).

## File Structure
- **Task 1 (#1 + 3×-parse):** `server/rank-tracking.ts` (helper + route 5 writers), `server/keyword-feedback.ts` (flip bulk txn to `.immediate()`), `server/keyword-command-center.ts` (read-only confirm of the nested-txn boundary), `scripts/pr-check.ts` (new rule), new integration test (PORT 13886), `tests/pr-check.test.ts`.
- **Task 2 (#11):** `src/lib/queryKeys.ts`, `src/components/RankTracker.tsx`, `src/components/KeywordStrategy.tsx`, `src/hooks/admin/useKeywordCommandCenter.ts`, `src/hooks/useWsInvalidation.ts`, the query-key coverage test.
- **Task 3 (#13):** `server/routes/recommendations.ts`, `scripts/pr-check.ts` (remove exclude mention), new auth-negative integration test (PORT 13887). Reads: `server/middleware.ts`, `server/routes/jobs.ts`.
- **Task 4 (#22 + #19a):** `server/recommendations.ts`, `src/components/KeywordStrategy.tsx`, `server/schemas/workspace-schemas.ts`, `server/routes/keyword-strategy.ts`.
- **Task 5 (#21):** delete `src/components/KeywordAnalysis.tsx` + `src/components/strategy/PageKeywordMap.tsx`; edit `tests/contract/page-intelligence-seo-editor-correctness.test.ts`, `scripts/pr-check.ts`.
- **Overlap couplings:** `scripts/pr-check.ts` is edited by **Task 1 + Task 5**; `src/components/KeywordStrategy.tsx` is edited by **Task 2 + Task 4**. Assign each overlapping file to a single owner or sequence the edits (see Dependencies).

## Execution discipline (every task)
1. **READ the real current code** for the listed files — never work from this plan's snippets; they are contracts, not current code.
2. Write the failing test from the assertions given; **RUN it; confirm it fails for the right reason** (real red).
3. Implement minimally to pass, **matching the real signatures you read**.
4. RUN the test (green) + `npm run typecheck`.
5. Commit.

Never transcribe; never skip the red. **If the real code contradicts a contract here, STOP and report.**

---

## Task 1 — `tracked_keywords` lost-update race + 3×-parse (CRITICAL)

**Files:** Modify `server/rank-tracking.ts`, `server/keyword-feedback.ts`; read-confirm `server/keyword-command-center.ts:2213-2283,2327`; add `scripts/pr-check.ts` rule. Tests: new integration file (PORT 13886) + `tests/pr-check.test.ts`.

**Contract to produce:**
```ts
// server/rank-tracking.ts
export function withTrackedKeywordsTxn(
  workspaceId: string,
  updater: (current: TrackedKeyword[]) => TrackedKeyword[],
): TrackedKeyword[]
```
- **Nesting-safe:** `db.inTransaction ? run() : db.transaction(run).immediate()` (better-sqlite3 throws on nested `BEGIN`).
- **BEGIN IMMEDIATE**, never deferred (the SQLITE_BUSY_SNAPSHOT fix, PR #1030). Exactly **one** read + **one** write inside the txn; returns the post-mutation array (this is the 3×-parse fix — callers stop re-calling `getTrackedKeywords` after the write).
- All **5** writers route through it: `updateTrackedKeywords`, `addTrackedKeyword`, `addTrackedKeywords`, `removeTrackedKeyword`, `togglePinKeyword`. The KCC delegators (`upsertTrackedKeywordByKey`/`retireTrackedKeyword`) keep calling `updateTrackedKeywords` — its inner `BEGIN` no-ops because they already run inside the KCC outer `db.transaction()` (`keyword-command-center.ts:2327`).
- `saveBulkKeywordFeedback` (`keyword-feedback.ts:~196`): flip its `db.transaction()` to `.immediate()`.

**Test cases (write first, must fail red):**
- **T1a — concurrency (integration, PORT 13886):** seed a workspace; fire N=10 concurrent `addTrackedKeyword` for **distinct** keywords via `Promise.all`; assert `getTrackedKeywords(ws).length === 10` and every keyword present. RED today: fewer than 10 survive (last-write-wins). Use the `createTestContext` + `assertConcurrentGenerateSafe`-style pattern in `tests/integration/helpers.ts`.
- **T1b — nesting-safety:** invoke `updateTrackedKeywords` inside an outer `db.transaction(() => …)`; assert it does **not** throw "cannot start a transaction within a transaction".
- **T1c — reconcile-vs-manual race:** run `seedKeywordStrategyTrackedKeywords` (reconcile, full-array rebuild) concurrently with a manual `addTrackedKeyword`; assert the manually-added keyword **survives** the rebuild.
- **T1d — pr-check rule:** a fixture function that reads then single-writes the `tracked_keywords` blob outside `withTrackedKeywordsTxn` is **flagged**; the real (now-routed) writers are **not**.

**Constraints / gotchas:** never revert IMMEDIATE; the `db.inTransaction` guard is mandatory (KCC nested txn); the existing "multi-step DB writes outside `db.transaction()`" rule (`pr-check.ts:1930-1998`) misses this class because it only counts `.run()` **writes** — a read-then-single-write is invisible, hence the new rule. `scripts/pr-check.ts` is also edited by Task 5 → sequence Task 1 before Task 5 or merge those edits.

**Steps:**
- [ ] Read `server/rank-tracking.ts` (`readConfig`/`writeConfig`/`getTrackedKeywords` + the active filter, and the 5 writers), `server/keyword-feedback.ts` (`saveBulkKeywordFeedback`), and confirm the KCC nested-txn boundary at `keyword-command-center.ts:2327`.
- [ ] Write T1a; run `npx vitest run <new-test-path>`; confirm RED (fewer than 10 survive).
- [ ] Implement `withTrackedKeywordsTxn` + route the 5 writers through it (single read, return in-hand array); run T1a → GREEN; `npm run typecheck`; commit.
- [ ] Write T1b + T1c; run → RED; add the `db.inTransaction` guard (if not already) + flip `saveBulkKeywordFeedback` to `.immediate()`; run → GREEN; commit.
- [ ] Read the existing rule at `scripts/pr-check.ts:1930-1998`; write T1d in `tests/pr-check.test.ts`; run → RED; implement the new rule; run → GREEN; `npx tsx scripts/pr-check.ts`; commit.

**Model:** Sonnet (Opus review for the nested-txn boundary).

---

## Task 2 — collapse duplicate rank-tracking query keys (#11)

**Files:** Modify `src/lib/queryKeys.ts:92-93`, `src/components/RankTracker.tsx` (reader ~172; invalidations ~216, ~225, ~235, ~246), `src/components/KeywordStrategy.tsx` (reader ~111-118; `setQueryData` ~224-227), `src/hooks/admin/useKeywordCommandCenter.ts:48-49,64-65`, `src/hooks/useWsInvalidation.ts:377-378,392-393`. Test: query-key coverage/coherence test.

**Contract:** one key `rankTrackingKeywords`; **delete** `rankTrackingKeywordRows`. Each consumer keeps its own `select`: `KeywordStrategy` → `Set<string>`, `RankTracker` → `TrackedKeyword[]` (both off the one key).

**Test cases (red first):** a coverage/coherence test asserting (a) the `rankTrackingKeywordRows` key factory is removed from `src/lib/queryKeys.ts` (assert against the real accessor path you find — do not assume nesting), and (b) the `togglePin` and `snapshot` mutations invalidate `rankTrackingKeywords`.

**Mechanical edits (exact sites from the audit — verify each against real code first):**
- Delete the `rankTrackingKeywordRows` definition (`queryKeys.ts:93`).
- Migrate the only Rows reader (`RankTracker.tsx:~172`) to `rankTrackingKeywords` with an array `select`.
- **RE-POINT (do not delete)** the 2 Rows-only invalidations — `togglePin` (`RankTracker.tsx:~235`) and `snapshot` (`~246`) — to `rankTrackingKeywords`, or the list stops refreshing.
- Delete the 6 redundant paired Rows invalidations: `RankTracker.tsx:~216` & `~225`; `useKeywordCommandCenter.ts:49` & `65`; `useWsInvalidation.ts:378` & `393`.

**Constraints:** the re-point-vs-delete distinction is load-bearing. `KeywordStrategy.tsx` also edited by Task 4 → same owner or sequence Task 4 after Task 2.

**Steps:**
- [ ] Read all ~13 sites above + the existing `queryKeys` coverage test.
- [ ] Write the coverage/coherence test (assertions above); run → RED.
- [ ] Apply the edits; run the test → GREEN; `npm run typecheck`; commit.

**Model:** Sonnet.

---

## Task 3 — secure + de-cost the unauthenticated recommendations GET (#13, route/job boundary only)

**Files:** Modify `server/routes/recommendations.ts` (GET ~80-86, POST ~70-77 hatches), `scripts/pr-check.ts` (remove the recommendations exclude mention). Read: `server/middleware.ts:216-235` (`requireAuthenticatedClientPortalAuth`), `server/routes/jobs.ts:235-243` (`loadRecommendations`), `server/app.ts:269-286`. Test: auth-negative integration (PORT 13887).

**Contract:** the GET requires `requireAuthenticatedClientPortalAuth('workspaceId')`; on cache-miss it returns last-known/empty via `loadRecommendations()` — **no inline `generateRecommendations`**; remove the two `// public-no-auth-ok` hatches. **`generateRecommendations` internals are UNCHANGED.**

**Test case (red first):** `GET /api/public/recommendations/:id` on a workspace **with** `clientPassword` set and **no** session → **401** (today: 200 + inline generation).

**Constraints:** flag-surface proximity → boundary only. **FALLBACK:** if the route handler can't be cleanly separated from generation, **STOP** and move #13 to the front of Wave 2.

**Steps:**
- [ ] Read the route, the `requireAuthenticatedClientPortalAuth` signature, and `loadRecommendations`.
- [ ] Write the auth-negative test (PORT 13887); run → RED.
- [ ] Add the middleware; replace inline `await generateRecommendations` with `loadRecommendations()`; remove the hatches + the pr-check exclude mention; run → GREEN; `npm run typecheck`; `npx tsx scripts/pr-check.ts`; commit.

**Model:** Opus (flag-surface proximity).

---

## Task 4 — delete dead code: `quickWins` fallback (#22) + `topicClusters`/`cannibalization` schema branches (#19a)

**Files:** Modify `server/recommendations.ts:1439`, `src/components/KeywordStrategy.tsx:739` (#22); `server/schemas/workspace-schemas.ts:165-190`, `server/routes/keyword-strategy.ts:225,227` (#19a). These are **trivial mechanical deletes** (exact lines allowed).

**#22 (dead `quickWins` blob fallback):**
- [ ] Confirm `strategyQuickWins` (the `listQuickWins` table read) is the live source at `recommendations.ts:1438`; delete the ` : (strategy.quickWins || [])` arm at `:1439`.
- [ ] At `KeywordStrategy.tsx:739`, confirm `strategy` is the route-reassembled (table-backed) object, then simplify the `strategy.quickWins || []` fallback.

**#19a (dead Zod + route fallbacks):**
- [ ] Grep-verify zero blob readers: `grep -rn "strategy\.\(topicClusters\|cannibalization\)" server src` → confirm matches are only the in-memory pre-persist builders (`keyword-strategy-enrichment.ts`, `*-ai-synthesis.ts` — **leave these**) and the dead route fallbacks (to delete).
- [ ] Delete the `topicClusters` (`:165-175`) and `cannibalization` (`:176-190`) branches in `keywordStrategySchema` and the dead `|| strategy?.topicClusters/.cannibalization` route fallbacks at `keyword-strategy.ts:225,227`.

**Test:** no behavior change → the existing suite must stay green. Run touching tests + `npm run typecheck` + `npx tsx scripts/pr-check.ts`.

**Constraints:** the #19a fields are `.optional()`, so deletion is safe (no `parseJsonSafe` fallback-wipeout). `KeywordStrategy.tsx` coupling with Task 2. Two commits (one #22, one #19a).

**Model:** Haiku.

---

## Task 5 — delete orphaned components (#21)

**Files:** Delete `src/components/KeywordAnalysis.tsx`, `src/components/strategy/PageKeywordMap.tsx`. Same-commit edits (KeywordAnalysis only): `tests/contract/page-intelligence-seo-editor-correctness.test.ts:16-25`, `scripts/pr-check.ts:4875`. **`FixRecommendations.tsx` is HELD — do not delete** (named in the gen-quality reader lists).

**Steps:**
- [ ] Grep-prove zero production importers (show output): `grep -rn "KeywordAnalysis" src server --include=*.ts --include=*.tsx | grep -v test`; same for `PageKeywordMapPanel` / `strategy/PageKeywordMap`. (A same-named *type* import does not count.)
- [ ] Delete `strategy/PageKeywordMap.tsx` (clean — zero tests/pr-check refs). **Do NOT touch `SeoCopyPanel`** (live, imported by `PageIntelligenceStrategySection`). `npm run typecheck` + `npx tsx scripts/pr-check.ts` → commit.
- [ ] Delete `KeywordAnalysis.tsx` **and in the same commit** remove the "legacy KeywordAnalysis analysis" describe block (`page-intelligence-seo-editor-correctness.test.ts:16-25`, a `readFileSync` that ENOENTs on delete) and the `PAGE_COMPONENTS` array entry (`pr-check.ts:4875`, a `readFileSync` that crashes pr-check). Run `npm run typecheck` + `npx vitest run tests/contract/page-intelligence-seo-editor-correctness.test.ts` + `npx tsx scripts/pr-check.ts` → all green → commit.

**Constraints:** the KeywordAnalysis delete is **gated by those 2 CI-failing references** (same commit). `scripts/pr-check.ts` is also edited by Task 1 → sequence Task 5 after Task 1 or merge the pr-check edits.

**Model:** Haiku (Sonnet for the 2 CI-coupled edits).

---

## Task Dependencies

```
Task 1 (sub-steps 1a→1b→1d sequential)  ∥  Task 2  ∥  Task 3  ∥  Task 4  ∥  Task 5
```
All five are independent EXCEPT two shared-file couplings:
- `scripts/pr-check.ts` — edited by Task 1 (new rule) **and** Task 5 (PAGE_COMPONENTS prune) → **sequence Task 1 before Task 5**, or assign both pr-check edits to one owner.
- `src/components/KeywordStrategy.tsx` — edited by Task 2 (#11 reader) **and** Task 4 (#22 fallback) → **same owner, or sequence Task 4 after Task 2**.

All of Wave 1 runs **in parallel with the Wave 0 gen-quality canary soak**.

## Model Assignments
| Task | Model | Reasoning |
|---|---|---|
| 1 — tracked_keywords txn + 3×-parse | Sonnet (Opus review) | better-sqlite3 nested-txn boundary + new concurrency test = real judgment/risk |
| 2 — query-key collapse | Sonnet | multi-site frontend judgment + cache-coherence |
| 3 — recommendations route/job boundary | Opus | on the gen-quality flag surface; must stay strictly at the boundary |
| 4 — dead code (#22/#19a) | Haiku | mechanical, already optional/stripped |
| 5 — orphan deletes (#21) | Haiku (Sonnet for the 2 CI-coupled edits) | deletion mechanical; the same-commit CI edits need care |
| All reviews | Opus | per spec §7 ladder |

## Systemic Improvements
- **Shared utility:** `withTrackedKeywordsTxn` (Task 1) — fixes the race, folds in the 3×-parse, and gives the new pr-check rule one blessed call site.
- **pr-check rules:** (new) ban bare `tracked_keywords` read→write outside `withTrackedKeywordsTxn`; (extend) flag deferred `db.transaction(read→.run())` that should be `.immediate()`.
- **Test additions:** concurrency (PORT 13886), nesting-safety, reconcile-vs-manual race (Task 1); query-key coherence (Task 2); auth-negative (PORT 13887, Task 3).

## Verification Strategy
Per task: the exact `npx vitest run <path>` command shown in its steps. Before any PR: `npm run typecheck` · `npx vite build` · `npx vitest run` (full) · `npx tsx scripts/pr-check.ts` · `npm run verify:feature-flags` · `npm run verify:coverage-ratchet`. Because Wave 1 touches 10+ files across tasks, run `superpowers:scaled-code-review` before merging; fix Critical/Important findings. Phase-per-PR; staging before main.

## Execution Handoff
Two execution options once approved:
1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks (`superpowers:subagent-driven-development`).
2. **Inline Execution** — tasks in this session with checkpoints (`superpowers:executing-plans`).
