# Broadcast ↔ Cache-Invalidation Centralization — Implementation Plan

## Overview

CLAUDE.md Data Flow Rule #2 requires every workspace-scoped broadcast to have a matching `useWorkspaceEvents` consumer that invalidates React Query caches. The project already has a central hook (`src/hooks/useWsInvalidation.ts`) mounted once in `App.tsx:315` that handles 36 events — but **7 workspace-scoped events bypass the central hook** and instead rely on ad-hoc inline subscriptions scattered across 10 component files. This is a silent-failure hazard: any new component that reads one of the affected query keys without remembering to subscribe gets stale data until `staleTime` expires. The PR #249/#250 follow-ups (PageIntelligence + SeoEditor + KeywordStrategy missing STRATEGY_UPDATED) are the third, fourth, and fifth instances of this bug class this quarter.

This plan centralizes the 7 missing events in `useWsInvalidation`, removes the duplicate inline handlers, and adds a pr-check rule + contract test to prevent regression.

**Closes roadmap item #597.** Pairs with #595 (JSDoc `@reads`/`@writes`) — same underlying class of invisible cross-module contract.

---

## Pre-Plan Audit Summary

*Full methodology per `docs/PLAN_WRITING_GUIDE.md` Step 1. Audit artifacts below — not committed separately since scope is contained.*

### Events currently centralized in `useWsInvalidation` (36 — DO NOT re-add)

APPROVAL_UPDATE, APPROVAL_APPLIED, REQUEST_CREATED, REQUEST_UPDATE, CONTENT_REQUEST_CREATED, CONTENT_REQUEST_UPDATE, ACTIVITY_NEW, AUDIT_COMPLETE, ANOMALIES_UPDATE, WORKSPACE_UPDATED, CONTENT_PUBLISHED, WORK_ORDER_UPDATE, INSIGHT_RESOLVED, INTELLIGENCE_SIGNALS_UPDATED, OUTCOME_ACTION_RECORDED, OUTCOME_SCORED, OUTCOME_EXTERNAL_DETECTED, OUTCOME_LEARNINGS_UPDATED, OUTCOME_PLAYBOOK_DISCOVERED, SUGGESTED_BRIEF_UPDATED, INSIGHT_BRIDGE_UPDATED, ANNOTATION_BRIDGE_CREATED, INTELLIGENCE_CACHE_UPDATED, CLIENT_SIGNAL_CREATED, CLIENT_SIGNAL_UPDATED, MEETING_BRIEF_GENERATED, COPY_SECTION_UPDATED, COPY_METADATA_UPDATED, COPY_BATCH_PROGRESS, COPY_BATCH_COMPLETE, COPY_INTELLIGENCE_UPDATED, DIAGNOSTIC_COMPLETE, DIAGNOSTIC_FAILED, RECOMMENDATIONS_UPDATED.

### Gaps — workspace-scoped events NOT in `useWsInvalidation` (7)

| Event | Server broadcast sites | Current frontend consumers | Target query keys |
|-------|------------------------|----------------------------|-------------------|
| `STRATEGY_UPDATED` | `server/routes/keyword-strategy.ts` (multiple) | `PageIntelligence.tsx:211`, `SeoEditor.tsx:205`, `KeywordStrategy.tsx` | `queryKeys.admin.keywordStrategy(wsId)` |
| `BRANDSCRIPT_UPDATED` | `server/routes/brandscript.ts` | `BrandscriptTab.tsx:594` | `queryKeys.admin.brandscripts(wsId)` |
| `DISCOVERY_UPDATED` | `server/routes/discovery.ts` | `DiscoveryTab.tsx:797` | `queryKeys.admin.discoverySources(wsId)`, `queryKeys.admin.discoveryExtractionsAll(wsId)` |
| `VOICE_PROFILE_UPDATED` | `server/routes/voice-profile.ts` | `VoiceTab.tsx:998` | `queryKeys.admin.voiceProfile(wsId)` |
| `BRAND_IDENTITY_UPDATED` | `server/routes/brand-identity.ts` | `IdentityTab.tsx:276` | `queryKeys.admin.brandIdentity(wsId)` |
| `BLUEPRINT_UPDATED` | `server/routes/blueprints.ts` | `PageStrategyTab.tsx:28`, `BlueprintDetail.tsx:375`, `BlueprintVersionHistory.tsx:20` | prefix `['admin-blueprint', wsId]` + `['admin-blueprint-versions', wsId]` + `queryKeys.admin.blueprints(wsId)` |
| `BLUEPRINT_GENERATED` | `server/routes/blueprints.ts` | `PageStrategyTab.tsx` | `queryKeys.admin.blueprints(wsId)` |

### Non-gaps (verified)

- `SCHEMA_PLAN_SENT` — broadcast at `server/routes/webflow-schema.ts:455` but **no frontend consumer at all**. Investigation needed (Task 5).
- `BULK_OPERATION_PROGRESS` / `_COMPLETE` / `_FAILED` — intentionally local to SeoEditor.tsx because handlers key off `bulkAnalyzeJobId` / `bulkRewriteJobId` local state. Belongs in component, NOT central.
- Diagnostic hooks, intelligence signals, outcome hooks, copy hooks — all confirmed to use `useWsInvalidation` (earlier audit agent reported false positives here; the central hook does handle them).

### Blueprint prefix-invalidation note

Blueprint queries are keyed `['admin-blueprint', wsId, blueprintId]` and `['admin-blueprint-versions', wsId, blueprintId]`. React Query's `invalidateQueries` uses **prefix matching** by default, so invalidating by `['admin-blueprint', wsId]` (without blueprintId) refreshes every per-blueprint cache for that workspace. Confirmed in `src/lib/queryKeys.ts:84-86`.

---

## Pre-requisites

- [x] This plan committed to `docs/superpowers/plans/`
- [x] Worktree on latest `staging` (PR #250 merged)
- [x] Pre-plan audit complete (embedded above)
- [ ] Task 1 committed before parallel batch 2/3/4 starts (shared contract)

---

## Task 1 — Extend `useWsInvalidation` + investigate SCHEMA_PLAN_SENT (Model: haiku)

**Sequential prerequisite — must complete and commit before Tasks 2/3/4 start.**

**Owns:**
- `src/hooks/useWsInvalidation.ts`

**Must not touch:** any component file, any brand tab file, any server file.

**Steps:**

1. In `src/hooks/useWsInvalidation.ts`, add 7 new event handlers following the existing pattern (each guarded with `if (!workspaceId) return;`):

   ```typescript
   [WS_EVENTS.STRATEGY_UPDATED]: () => {
     if (!workspaceId) return;
     qc.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(workspaceId) });
   },
   [WS_EVENTS.BRANDSCRIPT_UPDATED]: () => {
     if (!workspaceId) return;
     qc.invalidateQueries({ queryKey: queryKeys.admin.brandscripts(workspaceId) });
   },
   [WS_EVENTS.DISCOVERY_UPDATED]: () => {
     if (!workspaceId) return;
     qc.invalidateQueries({ queryKey: queryKeys.admin.discoverySources(workspaceId) });
     qc.invalidateQueries({ queryKey: queryKeys.admin.discoveryExtractionsAll(workspaceId) });
   },
   [WS_EVENTS.VOICE_PROFILE_UPDATED]: () => {
     if (!workspaceId) return;
     qc.invalidateQueries({ queryKey: queryKeys.admin.voiceProfile(workspaceId) });
   },
   [WS_EVENTS.BRAND_IDENTITY_UPDATED]: () => {
     if (!workspaceId) return;
     qc.invalidateQueries({ queryKey: queryKeys.admin.brandIdentity(workspaceId) });
   },
   [WS_EVENTS.BLUEPRINT_UPDATED]: () => {
     if (!workspaceId) return;
     qc.invalidateQueries({ queryKey: queryKeys.admin.blueprints(workspaceId) });
     qc.invalidateQueries({ queryKey: ['admin-blueprint', workspaceId] });         // prefix — all per-blueprint caches
     qc.invalidateQueries({ queryKey: ['admin-blueprint-versions', workspaceId] }); // prefix — all version histories
   },
   [WS_EVENTS.BLUEPRINT_GENERATED]: () => {
     if (!workspaceId) return;
     qc.invalidateQueries({ queryKey: queryKeys.admin.blueprints(workspaceId) });
   },
   ```

2. SCHEMA_PLAN_SENT investigation: grep `src/` for `schema_plan|schemaPlan|SchemaPlan` usage. If a client-visible query key exists that should refresh on schema plan send, add a handler. If there is no client-visible consumer (fire-and-forget notification to admin only), add this inline comment above the handler block at the end of `useWsInvalidation`:
   ```typescript
   // SCHEMA_PLAN_SENT is intentionally not handled here — it's an admin-side
   // confirmation event with no React Query cache to invalidate. If a future
   // feature adds a schema-plan-status query, wire it here.
   ```

3. Run `npm run typecheck` — zero errors expected.

4. Commit: `fix(ws-invalidation): centralize 7 workspace-scoped events` — include in commit body a one-line summary per event.

---

## Task 2 — Remove inline STRATEGY_UPDATED subscriptions (Model: sonnet)

**Parallel with Tasks 3 and 4 — requires Task 1 committed.**

**Owns:**
- `src/components/PageIntelligence.tsx`
- `src/components/SeoEditor.tsx`
- `src/components/KeywordStrategy.tsx`

**Must not touch:** any other file.

**Steps:**

1. In each of the three files, locate the `useWorkspaceEvents(workspaceId, { ... })` call and remove ONLY the `[WS_EVENTS.STRATEGY_UPDATED]: () => { queryClient.invalidateQueries(...) }` handler that invalidates `keywordStrategy`. Keep every other handler intact (bulk ops, progress state, toasts, UI transitions).

2. If removing STRATEGY_UPDATED leaves a file with an empty `useWorkspaceEvents` object, remove the entire `useWorkspaceEvents(...)` call and any now-unused imports (`useWorkspaceEvents`, `WS_EVENTS` if unused elsewhere).

3. **KEEP** all manual `queryClient.invalidateQueries(queryKeys.admin.keywordStrategy(...))` calls that fire after local mutations (e.g. `PageIntelligence.tsx:434`, `SeoEditor.tsx:170`). These are needed for optimistic UX — the broadcast round-trip would delay the UI update. The central hook handles the cross-tab/cross-component case; inline calls handle the same-component case.

4. Run `npm run typecheck && npx vitest run tests/integration/keyword-strategy-partial-state.test.ts`.

5. Smoke-test in browser: open PageIntelligence in one tab, trigger a strategy save from KeywordStrategy in another tab, verify PageIntelligence refreshes without manual reload. Screenshot or console log showing query refetch fires proves the central hook is wired.

---

## Task 3 — Remove inline brand-tab subscriptions (Model: sonnet)

**Parallel with Tasks 2 and 4 — requires Task 1 committed.**

**Owns:**
- `src/components/brand/VoiceTab.tsx`
- `src/components/brand/IdentityTab.tsx`
- `src/components/brand/BrandscriptTab.tsx`
- `src/components/brand/DiscoveryTab.tsx`
- `src/components/brand/PageStrategyTab.tsx`

**Must not touch:** `BlueprintDetail.tsx`, `BlueprintVersionHistory.tsx` (owned by Task 4), any other file.

**Steps:**

1. For each file, locate `useWorkspaceEvents(workspaceId, { ... })` and remove ONLY the handler(s) for the event(s) now centralized:
   - `VoiceTab.tsx` — remove `[WS_EVENTS.VOICE_PROFILE_UPDATED]` handler
   - `IdentityTab.tsx` — remove `[WS_EVENTS.BRAND_IDENTITY_UPDATED]` handler
   - `BrandscriptTab.tsx` — remove `[WS_EVENTS.BRANDSCRIPT_UPDATED]` handler
   - `DiscoveryTab.tsx` — remove `[WS_EVENTS.DISCOVERY_UPDATED]` handler at line ~797 (the outer component; if there's any inline subscription elsewhere in the file, leave it alone)
   - `PageStrategyTab.tsx` — remove `[WS_EVENTS.BLUEPRINT_UPDATED]` and `[WS_EVENTS.BLUEPRINT_GENERATED]` handlers

2. If removing the handler leaves an empty `useWorkspaceEvents` object, remove the entire call and prune unused imports.

3. **KEEP** all non-broadcast invalidation calls (e.g. `queryClient.invalidateQueries(...)` fired after local mutations in `VoiceTab.tsx:1005` or `IdentityTab.tsx:283`). These are post-mutation optimistic refreshes, not broadcast handlers.

4. Run `npm run typecheck && npx vitest run` (full suite — brand components have extensive tests).

5. Smoke-test: trigger a VoiceTab calibration completion or BrandscriptTab save in one tab, confirm the corresponding query refetches in another tab.

---

## Task 4 — Remove inline Blueprint subscriptions (Model: sonnet)

**Parallel with Tasks 2 and 3 — requires Task 1 committed.**

**Owns:**
- `src/components/brand/BlueprintDetail.tsx`
- `src/components/brand/BlueprintVersionHistory.tsx`

**Must not touch:** any other file.

**Steps:**

1. In `BlueprintDetail.tsx` (line ~375): the `useWorkspaceEvents` block has 5 handlers that all invalidate `queryKeys.admin.blueprint(workspaceId, blueprintId)` and `queryKeys.admin.blueprintVersions(workspaceId, blueprintId)`. Since the central hook now uses **prefix invalidation** (`['admin-blueprint', workspaceId]` and `['admin-blueprint-versions', workspaceId]`), all of these become redundant. Verify handler-by-handler that each handled event is now centralized (BLUEPRINT_UPDATED, BLUEPRINT_GENERATED, or similar), and remove the redundant invalidation calls.

2. If any handler fires ONLY a non-invalidation side effect (e.g. a toast or state update), keep that handler with the side effect but remove the invalidation line.

3. In `BlueprintVersionHistory.tsx` (line ~20): same treatment — the sole handler invalidates `blueprintVersions(workspaceId, blueprintId)`, now covered by the central prefix. Remove the entire `useWorkspaceEvents` call and its imports.

4. **Critical verification:** open BlueprintDetail in browser DevTools → Network tab, trigger a blueprint update via `PageStrategyTab`, confirm `/api/brand-engine/blueprints/...` refetches automatically. React Query prefix matching must cover the per-blueprintId cache; if it doesn't, the centralization is broken and we need `blueprintAll`/`blueprintVersionsAll` helpers in `queryKeys.ts` (add those to Task 4 ownership if needed).

5. Run `npm run typecheck && npx vitest run`.

---

## Task 5 — Add pr-check rule to prevent regression (Model: sonnet)

**Parallel with Tasks 2/3/4 — requires Task 1 committed.**

**Owns:**
- `scripts/pr-check.ts`
- `docs/rules/automated-rules.md` (auto-regenerated, do not hand-edit)

**Must not touch:** any component, hook, or server file.

**Steps:**

1. Add a new check to the `CHECKS` array in `scripts/pr-check.ts`:

   **Name:** `useWorkspaceEvents handler for centralized event`

   **Rationale:** Inline `useWorkspaceEvents` subscriptions for events already handled in `useWsInvalidation` duplicate logic and create silent drift. The central hook is the single source of truth.

   **Regex approach:** grep files matching `src/**/*.{ts,tsx}` (excluding `src/hooks/useWsInvalidation.ts` itself and `src/**/*.test.tsx`) for patterns of the form `\[WS_EVENTS\.(EVENT_NAME)\]` where `EVENT_NAME` is one of the 36+7=43 events currently centralized. Maintain the allowlist as an array in the check.

   **Escape hatch:** inline comment `// ws-invalidation-ok` on the line above or end-of-line, for legitimate local side effects (e.g. `BulkOperation*` events that key off component-local state).

   **Sample match:** `[WS_EVENTS.STRATEGY_UPDATED]: () => { ... }` outside `useWsInvalidation.ts` without `// ws-invalidation-ok` → fail.

2. Write the rule so the allowlist is derived from `useWsInvalidation.ts` itself — parse the file once at pr-check startup, extract every `[WS_EVENTS.X]` key, and use that as the source of truth. This keeps the rule in sync automatically when new events are centralized.

3. Regenerate `docs/rules/automated-rules.md`:
   ```bash
   npm run rules:generate
   ```

4. Run `npx tsx scripts/pr-check.ts` — the new rule should find ZERO violations after Tasks 2/3/4 complete (since they remove all the inline handlers). If it reports matches, those represent genuine local side effects — verify and add `// ws-invalidation-ok` on those lines.

5. Test the rule: temporarily reintroduce one inline handler in a component, run pr-check, confirm it fails. Revert.

---

## Task 6 — Contract test for central hook coverage (Model: sonnet)

**Parallel with Tasks 2/3/4/5 — requires Task 1 committed.**

**Owns:**
- `tests/contract/ws-invalidation-coverage.test.ts` (new file)

**Must not touch:** production code.

**Steps:**

1. Create a contract test that enforces: every workspace-scoped `WS_EVENTS.*` value must either be handled in `useWsInvalidation.ts` OR be on an explicit exemption list with a rationale comment.

2. Read `src/lib/wsEvents.ts` and `src/hooks/useWsInvalidation.ts` as **data** via `readFileSync` (pr-check already does source-sniffing for similar contract checks; see `scripts/pr-check.ts` for patterns — the usual ban on source-sniffing in tests has exceptions for contract tests, which pr-check allows). Parse:
   - All `WS_EVENTS.X: 'some-string'` entries from wsEvents.ts → expected event set
   - All `[WS_EVENTS.X]:` handler keys from useWsInvalidation.ts → covered event set

3. Assert: `expectedEvents - coveredEvents ⊆ localOnlyEvents`, where `localOnlyEvents` is a hard-coded array in the test:
   ```typescript
   const LOCAL_ONLY_EVENTS = [
     'BULK_OPERATION_PROGRESS',
     'BULK_OPERATION_COMPLETE',
     'BULK_OPERATION_FAILED',
     'SCHEMA_PLAN_SENT',          // pending Task 1 investigation — remove if centralized
   ] as const;
   ```

4. Fail-closed: if a new event is added to `WS_EVENTS` without either centralizing it or adding to `LOCAL_ONLY_EVENTS` (with a comment explaining why), the test fails. This is the canonical enforcement point — pr-check catches inline-drift, this test catches absence-of-handler.

5. Run `npx vitest run tests/contract/ws-invalidation-coverage.test.ts` — must pass.

6. Port allocation: no integration test, so no port needed. Follows the contract-test pattern at `tests/contract/tab-deep-link-wiring.test.ts`.

---

## Task 7 — Verification, FEATURE_AUDIT, roadmap update (Model: sonnet)

**Sequential — runs after all other tasks complete and merge cleanly.**

**Owns:**
- `FEATURE_AUDIT.md`
- `data/roadmap.json`

**Steps:**

1. Run full quality gate:
   ```bash
   npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
   ```
   All must pass zero-error / zero-violation.

2. Update `FEATURE_AUDIT.md`: either add a new entry under "Platform / Infrastructure" describing the centralized broadcast-invalidation system, OR update an existing entry if one covers WebSocket/React Query infrastructure.

3. Update `data/roadmap.json`: find item #597 in the broadcast-invalidation-audit sprint, mark `"status": "done"`, add `"notes"` summarizing the 7 events centralized and the pr-check rule added. Run:
   ```bash
   npx tsx scripts/sort-roadmap.ts
   ```

4. Verify no `violet` / `indigo` introductions:
   ```bash
   grep -rE "(violet|indigo)-\\d{3}" src/components/ || echo "clean"
   ```

5. Write the PR body using `docs/workflows/new-feature-checklist.md` as a reference. Include:
   - Summary: what was centralized, why
   - Tests: test file paths, full suite pass count
   - Manual verification: the two-tab smoke tests from Tasks 2/3/4
   - Follow-ups: link to roadmap #595 (JSDoc convention) as the next related piece

6. Invoke `superpowers:scaled-code-review` skill (touches 10+ files across 3 domains — qualifies as medium). Address Critical/Important issues before merge.

---

## Task Dependencies

```
Task 1 (useWsInvalidation extension)              ← haiku, sequential prerequisite
  │
  ├──┬──┬──┬──┐
  │  │  │  │  │
Task 2  Task 3  Task 4  Task 5  Task 6              ← sonnet, all parallel after Task 1
(strategy) (brand) (blueprint) (pr-check) (contract test)
  │  │  │  │  │
  └──┴──┴──┴──┘
  │
Task 7 (verification + docs)                       ← sonnet, sequential after batch
```

**Dispatch gates:**
- Task 1 must be **committed** to the working branch before any Task 2–6 agent starts.
- After Task 1 commit, dispatch Tasks 2, 3, 4, 5, 6 in a single parallel batch.
- After all five return, run `git diff`, full typecheck, full test suite, pr-check — all green before Task 7.

---

## File Ownership Matrix

| Task | Files owned | Files forbidden |
|------|-------------|-----------------|
| 1 | `src/hooks/useWsInvalidation.ts` | all components, all server files |
| 2 | `src/components/{PageIntelligence,SeoEditor,KeywordStrategy}.tsx` | brand/*, hooks/, scripts/, tests/ |
| 3 | `src/components/brand/{VoiceTab,IdentityTab,BrandscriptTab,DiscoveryTab,PageStrategyTab}.tsx` | `BlueprintDetail.tsx`, `BlueprintVersionHistory.tsx`, Task 2 files, scripts/, tests/ |
| 4 | `src/components/brand/{BlueprintDetail,BlueprintVersionHistory}.tsx` + optionally `src/lib/queryKeys.ts` if `blueprintAll`/`blueprintVersionsAll` helpers need adding | Task 3 files, Task 2 files, scripts/, tests/ |
| 5 | `scripts/pr-check.ts`, `docs/rules/automated-rules.md` | all src/, all tests/ |
| 6 | `tests/contract/ws-invalidation-coverage.test.ts` (new) | all src/, all scripts/, other test files |
| 7 | `FEATURE_AUDIT.md`, `data/roadmap.json` | all code |

---

## Systemic Improvements

**Shared utilities to extract:** none — the central hook IS the shared utility. The 7 events being added follow the same pattern as the existing 36.

**pr-check rules to add:** one new rule (Task 5) — `useWorkspaceEvents handler for centralized event`. Self-synchronizing by reading `useWsInvalidation.ts` as the source of truth for the allowlist.

**New tests required:** one contract test (Task 6) — `tests/contract/ws-invalidation-coverage.test.ts`. Fail-closed enforcement of the invariant "every workspace WS event is either centralized or explicitly local-only."

**Documentation updates:**
- `FEATURE_AUDIT.md` (Task 7)
- `data/roadmap.json` #597 → done (Task 7)
- `CLAUDE.md` Data Flow Rule #2 — consider a one-line addition stating that new workspace-scoped events should default to being handled in `useWsInvalidation`, with inline subscriptions reserved for genuinely component-local side effects. This is a small post-merge follow-up, not part of this plan's task list.

---

## Verification Strategy

**Automated:**
- `npm run typecheck` — zero errors (every task)
- `npx vitest run` — full suite green (Tasks 2/3/4/6/7)
- `npx vitest run tests/contract/ws-invalidation-coverage.test.ts` — explicit contract test (Task 6, Task 7)
- `npx tsx scripts/pr-check.ts` — zero violations including the new rule (Tasks 5, 7)
- `npx vite build` — production build succeeds (Task 7)

**Manual / browser:**
- **Strategy round-trip:** open PageIntelligence in Tab A, KeywordStrategy in Tab B. Trigger a strategy save in Tab B. Verify Tab A auto-refreshes without manual reload. (Task 2 exit criterion.)
- **Brand round-trip:** open VoiceTab in Tab A. Trigger a voice-profile calibration in Tab B (via the calibration endpoint). Verify Tab A refetches. Repeat for IdentityTab, BrandscriptTab, DiscoveryTab, PageStrategyTab. (Task 3 exit criterion.)
- **Blueprint round-trip:** open BlueprintDetail for blueprint X in Tab A. Trigger a blueprint update in PageStrategyTab (Tab B). Verify Tab A's per-blueprint and version-history caches both refresh via prefix match. (Task 4 exit criterion. This is the most sensitive test — if prefix matching fails, this UX breaks.)

**Regression guardrails going forward:**
- New WS_EVENT added without handler → contract test fails at CI.
- Inline `[WS_EVENTS.CENTRALIZED_EVENT]` subscription added → pr-check fails.
- Both layers together = "the rule is enforced no matter which direction the drift comes from."

---

## Out of Scope (follow-ups)

- **Roadmap #595** (JSDoc `@reads`/`@writes` convention + pr-check rule) — same conceptual gap (invisible cross-module contracts) but a different mechanism. Ship this plan first, then tackle #595.
- **BULK_OPERATION_***events — intentionally staying local-scoped. Only revisit if bulk operations gain a persistent job-status query that needs cross-tab invalidation.
- **Client-dashboard event coverage** — the audit focused on admin-side. A follow-up pass on client hooks (`src/hooks/client/`) could verify parity, though spot-checks showed all client queries are already covered by the central hook's client-prefix invalidations.

---

## Rollback Plan

Low risk — this PR is purely additive to `useWsInvalidation.ts` (Task 1) + deletions of duplicate handlers (Tasks 2/3/4) + new guardrails (Tasks 5/6). If any cross-tab refresh breaks in production:

1. Revert Tasks 2/3/4 commits (reintroduce inline handlers). The central hook additions from Task 1 stay — they're harmless when duplicated.
2. File a bug describing which event failed to propagate via the central hook, add a regression test, fix, re-merge.
