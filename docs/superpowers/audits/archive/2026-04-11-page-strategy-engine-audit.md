# Page Strategy Engine — Pre-Plan Audit (Full)

> **Audit status:** COMPLETE — all findings incorporated into plan on 2026-04-11.
> Plan updated at: `docs/superpowers/plans/2026-03-27-page-strategy-engine.md`
> Initial audit: 12 issues. Expanded audit (3 Opus agents): +14 additional issues. Total: 26 findings.

**Date:** 2026-04-11
**Spec:** `docs/superpowers/specs/2026-03-27-page-strategy-engine-design.md`
**Plan:** `docs/superpowers/plans/2026-03-27-page-strategy-engine.md`
**Auditor:** Claude Code (pre-plan-audit skill)
**Total findings:** 12 issues across 7 files

---

## Executive Summary

The plan is structurally solid and covers the right files, but contains **4 runtime-breaking bugs** that
would cause immediate failures without any wrong logic from the implementer. An additional 4 platform-rule
violations and 4 moderate issues round out the findings. All must be corrected in the plan before
agents are dispatched.

The good news: Phase 1 prerequisites are verified complete (migration 053, brandscript.ts, seo-context.ts
builders, brand-engine routes all present). Test infrastructure is compatible (port 13318 is available,
`assertWorkspaceIsolation` and `assertIdempotentGenerate` helpers exist). The architecture is sound.

---

## Findings by Category

### CRITICAL — Will break at runtime without any implementer error

#### C1: Migration number collision
**File:** `server/db/migrations/027-page-strategy-engine.sql`
**Problem:** Migration `027` is already occupied by `027-brief-variants.sql`. The codebase has grown to
migration `056-brand-identity-unique.sql` since this plan was written in March. The plan's migration
number is stale by **30 migrations**.
**Fix:** Rename to `057-page-strategy-engine.sql`. Update every reference in the plan (Task 1 SQL block,
Task 1 Step 2 verification command, Task 1 Step 3 commit message). The sqlite3 check command should use
the live DB path too — verify with `sqlite3 data/dashboard.db` not `data/app.db`.

#### C2: Route ordering bug — `reorder` after `entryId` (dead endpoint)
**File:** `server/routes/page-strategy.ts` (Task 5)
**Problem:** The plan registers routes in this order:
```
line 1315: PUT /:workspaceId/:blueprintId/entries/:entryId   ← FIRST
line 1327: PUT /:workspaceId/:blueprintId/entries/reorder    ← SECOND (never reached)
```
Express matches routes in registration order. When the client calls `PUT .../entries/reorder`, Express
captures `"reorder"` as the `:entryId` value and routes to the update-entry handler, which looks up an
entry with id `"reorder"`, finds nothing, and returns 404. The comment in the plan even says "reorder
route MUST come before :entryId" but the code has them reversed.
**Fix:** Swap the registration order — reorder route first, entryId route second.

#### C3: Route ordering bug — `section-plan-defaults` shadowed by `/:workspaceId/:blueprintId`
**File:** `server/routes/page-strategy.ts` (Task 5)
**Problem:** The plan registers:
```
line 1256: GET /api/page-strategy/:workspaceId/:blueprintId  ← FIRST (2-segment parameterized)
...
line 1347: GET /api/page-strategy/section-plan-defaults/:pageType ← SECOND (dead)
```
When the client calls `GET /api/page-strategy/section-plan-defaults/service`, Express matches the
first route with `workspaceId="section-plan-defaults"` and `blueprintId="service"`. The second
route is unreachable. The test spec explicitly guards against this: "Verify this route is NOT
shadowed by `/:blueprintId` (regression guard for route ordering)."
**Fix:** Register `GET /api/page-strategy/section-plan-defaults/:pageType` BEFORE the parameterized
`GET /api/page-strategy/:workspaceId` and `GET /api/page-strategy/:workspaceId/:blueprintId` routes.

#### C4: `bulkAddEntries` missing `brief_id` in INSERT call
**File:** `server/page-strategy.ts` (Task 3)
**Problem:** The `insertEntry` prepared statement (line 422–431) includes `@brief_id` as a named
parameter. The `addEntry()` function correctly passes `brief_id: null`. But `bulkAddEntries()` (used
by the AI generator for every entry) does NOT include `brief_id` in its `.run({...})` call. In
better-sqlite3, a missing named parameter throws `TypeError: Missing named parameter "@brief_id"`.
This means **every AI-generated blueprint will crash** during entry insertion.
**Fix:** Add `brief_id: null` to the parameter object in `bulkAddEntries()`.

---

### IMPORTANT — Platform rule violation or wrong behavior

#### I1: Frontend uses `useState+useEffect+fetch` instead of React Query
**File:** `src/components/brand/PageStrategyTab.tsx` (Task 8)
**Problem:** `PageStrategyTab` uses `useState<SiteBlueprint[]>`, `useEffect(() => loadBlueprints())`,
and direct async API calls in event handlers. This violates CLAUDE.md: "Frontend data: all hooks use
useQuery/useMutation. No hand-rolled useState+useEffect+fetch patterns."
Phase 1's `BrandscriptTab.tsx` uses `useQuery` from `@tanstack/react-query` — the plan must follow
the same pattern.
**Fix:** Rewrite `PageStrategyTab` (and the other components in Tasks 8–10) using:
- `useQuery({ queryKey: ['blueprints', workspaceId], queryFn: ... })` for list/get
- `useMutation({ mutationFn: ..., onSuccess: () => queryClient.invalidateQueries(...) })` for mutations
- Remove all manual `useState` + `useEffect` + `loadX()` patterns

#### I2: `PAGE_TYPE_CONFIGS` not exported from `server/content-brief.ts`
**File:** `server/content-brief.ts`
**Problem:** The spec addendum §3 requires `blueprint-generator.ts` to import `PAGE_TYPE_CONFIGS` from
`content-brief.ts`. The actual file declares it as `const PAGE_TYPE_CONFIGS: Record<string, PageTypeConfig>`
(not exported, line 320). The plan mentions "If not exported, export it" as an implementer note —
this is too late; it needs to be a concrete step.
**Fix:** Add a proactive step in Task 4: "Export `PAGE_TYPE_CONFIGS` from `server/content-brief.ts`
by changing `const` to `export const`." Add the corresponding import to `blueprint-generator.ts`.

#### I3: Missing `broadcastToWorkspace` for blueprint mutations
**Files:** `server/routes/page-strategy.ts`, `shared/types/ws-events.ts` (or equivalent)
**Problem:** The plan states: "Blueprint change invalidation is already wired — the existing
strategy-invalidate bridge handles cache invalidation automatically. No additional
`broadcastToWorkspace()` wiring needed."
Verified: There are no blueprint-related WS events defined anywhere in the broadcast layer
(`server/broadcast.ts` has no `BLUEPRINT` entries, `shared/types/` has none either). No bridge
touches `site_blueprints` or `blueprint_entries`. This claim is incorrect.
CLAUDE.md rule: "Every POST/PUT/PATCH/DELETE that changes workspace data must call
`broadcastToWorkspace()`."
**Fix:** Define `BLUEPRINT_UPDATED` (or similar) WS event, call `broadcastToWorkspace()` on all
blueprint/entry mutations in the route file, and add `useWorkspaceEvents` handler in the frontend
that invalidates the relevant React Query cache. If the plan's author intended a frontend
invalidation-on-mutation pattern (no WS needed), document that explicitly and use
`queryClient.invalidateQueries` in each mutation's `onSuccess`.

#### I4: DELETE returns 200 + `{ ok: true }` but test spec expects 204
**File:** `server/routes/page-strategy.ts`
**Problem:** The plan's routes return `res.json({ ok: true })` on successful deletion (200 response).
The test spec says "DELETE... returns 204". These disagree. The convention across the rest of the
platform should be confirmed — but the test is the authoritative spec.
**Fix:** Either change delete routes to `res.status(204).send()` OR change the test assertion.
Check Phase 1 brand-engine DELETE routes for the platform convention and match it.

---

### MODERATE — Missing coverage or spec gaps

#### M1: `generate` endpoint lacks 409 duplicate-guard
**File:** `server/routes/page-strategy.ts` (Task 5)
**Problem:** The test spec calls `assertIdempotentGenerate` with `expectedStatus: 409`. The plan's
route implementation has no 409 guard — it calls `generateBlueprint()` unconditionally. If the
client double-submits (race, retry), two blueprints are created. The plan says "if the generate
endpoint doesn't have a 409 guard yet, add it as part of this task" but gives no implementation
guidance.
**Fix:** Add a check before calling `generateBlueprint()`: if a blueprint with the same
`industryType` already exists for the workspace (or is currently being generated), return 409.
Reference `docs/rules/ai-dispatch-patterns.md` Pattern 2 for the standard approach.

#### M2: `BrandHubTab` type not updated
**File:** `src/components/BrandHub.tsx` (Task 11)
**Problem:** `BrandHub.tsx` declares `type BrandHubTab = 'overview' | 'brandscript' | 'discovery' | 'voice' | 'identity'`. The plan (Task 11) adds a Page Strategy section but doesn't show adding `'page-strategy'` to this type union. Without the type update, TypeScript will error when the component tries to use `'page-strategy'` as a tab value.
**Fix:** Task 11 must explicitly include: add `| 'page-strategy'` to the `BrandHubTab` type before
the tab is used anywhere.

#### M3: `TierGate` missing for AI generation
**File:** `src/components/brand/PageStrategyTab.tsx`
**Problem:** The spec says AI blueprint generation is Professional+ tier only (manual creation is
free). The `handleGenerate` function in `PageStrategyTab` calls the generate endpoint without
any tier check. The platform convention is `<TierGate>` wrapping for Pro/Premium features.
**Fix:** Wrap the "Generate with AI" button/form in `<TierGate tier="professional">` and add
server-side tier validation in the generate route.

#### M4: App.ts line number references are stale
**File:** `server/app.ts` (Task 6)
**Problem:** Task 6 says "add import around line 87... add route mount around line 316." The current
`app.ts` has `competitorSchemaRoutes` at line 95 (import) and ~349 (mount). All Phase 1 brand engine
routes are mounted at the end. The line numbers in the plan are stale guides that will mislead
implementers.
**Fix:** Replace specific line numbers with grep-based location instructions: "Add import after the
`brandIdentityRoutes` import" and "Mount after `app.use(brandIdentityRoutes)`."

---

## Existing Infrastructure Verified

| Component | Status | Notes |
|-----------|--------|-------|
| Migration 053 (brandscript) | ✓ Present | Phase 1 complete |
| `getBrandscript()` in brandscript.ts | ✓ Exported | Used by generator |
| `buildBrandscriptContext()` in seo-context.ts | ✓ Exported | Phase 1 context builder |
| `buildVoiceProfileContext()` in seo-context.ts | ✓ Exported | Phase 1 context builder |
| `buildIdentityContext()` in seo-context.ts | ✓ Exported | Phase 1 context builder |
| `getDomainOrganicKeywords()` in semrush.ts | ✓ Exported | Generator depends on this |
| `getRelatedKeywords()` in semrush.ts | ✓ Exported | |
| `getKeywordOverview()` in semrush.ts | ✓ Exported | Keyword enrichment |
| `callAnthropic()` in anthropic-helpers.ts | ✓ Exported, `claude-sonnet-4-20250514` compatible | |
| `callOpenAI()` in openai-helpers.ts | ✓ Exported | |
| `assertWorkspaceIsolation()` in tests/integration/helpers.ts | ✓ Present | |
| `assertIdempotentGenerate()` in tests/integration/helpers.ts | ✓ Present | |
| Test port 13318 | ✓ Available | Highest in use: 13317 |
| `PAGE_TYPE_CONFIGS` in content-brief.ts | ✗ NOT exported | Needs export step added |
| Blueprint WS events | ✗ Not defined | No broadcast mechanism exists |

---

## Required Plan Corrections (ordered by task)

### Task 1 — Migration
- [ ] Rename migration file: `027-page-strategy-engine.sql` → `057-page-strategy-engine.sql`
- [ ] Update all migration number references in the plan (3 places: file name, Step 2 verify command, Step 3 commit)
- [ ] Fix DB path: `data/app.db` → `data/dashboard.db`

### Task 3 — Blueprint CRUD Service
- [ ] In `bulkAddEntries()`, add `brief_id: null` to the `stmts().insertEntry.run({...})` call

### Task 4 — Blueprint Generator
- [ ] Add a new sub-step: "Export `PAGE_TYPE_CONFIGS` from `server/content-brief.ts` (change `const` to `export const` on line 320)"
- [ ] Add the corresponding import in `blueprint-generator.ts` Task 4 code

### Task 5 — API Routes
- [ ] Move `GET /section-plan-defaults/:pageType` BEFORE the parameterized `GET /:workspaceId` and `GET /:workspaceId/:blueprintId` routes
- [ ] Move `PUT /:blueprintId/entries/reorder` BEFORE `PUT /:blueprintId/entries/:entryId`
- [ ] Add 409 duplicate-generation guard to `POST /:workspaceId/generate` (check for in-progress generation using a flag or by checking for existing blueprints with same inputs)
- [ ] Decide and document DELETE response convention (204 + no body vs 200 + `{ ok: true }`) — align with test assertions

### Task 6 — Route Registration
- [ ] Replace stale line numbers with relative instructions: "after `brandIdentityRoutes` import" and "after `app.use(brandIdentityRoutes)`"

### Task 8 — PageStrategyTab UI
- [ ] Rewrite all data fetching using `useQuery` / `useMutation` from `@tanstack/react-query`
- [ ] Remove all `useState<blueprint[]>` + `useEffect` + manual `loadBlueprints()` patterns
- [ ] Add `<TierGate tier="professional">` around AI generation controls

### Task 11 — BrandHub Integration
- [ ] Explicitly add `| 'page-strategy'` to the `BrandHubTab` type union

### New Task — WS Events (insert after Task 5, before Task 6)
- [ ] Define `BLUEPRINT_UPDATED` event in the WS events constant file
- [ ] Add `broadcastToWorkspace()` calls on blueprint and entry mutations in routes
- [ ] Add `useWorkspaceEvents` handler in `PageStrategyTab` that invalidates `['blueprints', workspaceId]` query key

---

## Parallelization Strategy

The dependency graph in the plan is correct. These corrections don't change the structure:

### Phase 0 — Sequential foundation (unchanged)
- Task 1 (Migration 057) → Task 2 (Shared Types + content.ts extension + PAGE_TYPE_CONFIGS export)

### Phase 1 — Parallel services (after Task 2)
- Task 3 (Blueprint CRUD — with `brief_id` fix) ∥ Task 4 (Blueprint Generator — with PAGE_TYPE_CONFIGS import)

### Phase 2 — Sequential shared-file (after parallel batch + diff review)
- NEW: WS Events task (define constants, add broadcast calls)
- Task 5 (Routes — with all 3 route ordering fixes + 409 guard)
- Task 6 (App.ts registration — with corrected location instructions)
- Task 7 (API client)

### Phase 3 — Parallel frontend (after Task 7)
- Task 8 (PageStrategyTab — React Query + TierGate) ∥ Task 9 (BlueprintDetail) ∥ Task 10 (VersionHistory)

### Phase 4 — Sequential shared frontend (after diff review)
- Task 11 (BrandHub — with type union fix + WS handler)

### Phase 5 — Sequential testing + verification
- Task 13 (Integration tests, port 13318)
- Task 14 (Final verification)

---

## Model Assignments

| Task | Recommended Model | Reasoning |
|------|------------------|-----------|
| Task 1 — Migration SQL | Haiku | Mechanical SQL, just renumber |
| Task 2 — Shared Types | Haiku | Type transcription + PAGE_TYPE_CONFIGS export (one-line change) |
| Task 3 — CRUD Service | Sonnet | Edge-case judgment in update/reorder logic |
| Task 4 — Blueprint Generator | Sonnet | AI prompt assembly + SEMrush integration |
| Task 4b — Auto-Brief Creation | Sonnet | Needs to read content-briefs.ts interface |
| WS Events task | Haiku | Mechanical constant + broadcast call insertion |
| Task 5 — Routes | Sonnet | Route ordering judgment, 409 guard design |
| Task 6 — App.ts | Haiku | One-line import + mount |
| Task 7 — API Client | Haiku | Typed fetch wrappers |
| Tasks 8–10 — Frontend | Sonnet | React Query patterns + component logic |
| Task 11 — BrandHub | Sonnet | Tab integration with existing complex component |
| Task 13 — Tests | Sonnet | Integration test coverage, workspace isolation patterns |
| Task 14 — Verification | Opus | Full-context judgment on whether output is correct |

---

---

## Extended Audit Findings (Opus agents, 2026-04-11)

### EX1: `createContentBrief` does not exist — BLOCKING
**Function is `generateBrief(workspaceId, targetKeyword, context)` in `server/content-brief.ts`** (singular). `createContentBrief` appears nowhere in the codebase. Task 4b must be rewritten. Additionally:
- `blueprintEntryId` does not exist on `ContentBrief` type, the `content_briefs` table, or `generateBrief` context — requires type extension + DB migration addendum.
- File path is `server/content-brief.ts`, NOT `server/content-briefs.ts` (the plural is the routes file).
- **Fixed in plan.**

### EX2: PAGE_TYPE_CONFIGS page type mismatch — BLOCKING
Blueprint generator produces types `homepage`, `about`, `contact`, `faq`, `testimonials`. `PAGE_TYPE_CONFIGS` in `content-brief.ts` has NONE of these — only `blog`, `landing`, `service`, `location`, `product`, `pillar`, `resource`, `provider-profile`, `procedure-guide`, `pricing-page`. Passing unknown types to `getPageTypeConfig()` silently returns `blog` config — wrong word counts, wrong prompt guidance.
**Fix:** Add entries for the 5 new types to `PAGE_TYPE_CONFIGS` when exporting it. **Noted in plan.**

### EX3: `PAGE_TYPE_CONFIGS` and `PageTypeConfig` not exported — BLOCKING
Both are `const` / `interface` (not `export`). Phase 2 cannot import them. **Noted in plan.**

### EX4: `BrandscriptSection.content` is optional — WARNING
`content?: string | undefined` — not guaranteed to be present. Plan's generator does `section.content ?? '(not yet filled in)'` which is correct. No change needed but implementer must not assume it.

### EX5: Bare `JSON.parse(row.*)` fails pr-check — BLOCKING
All `JSON.parse(row.*)` in `server/page-strategy.ts` will trigger the pr-check `Bare JSON.parse on DB row column` rule (error severity). Must use `parseJsonFallback` from `server/db/json-validation.ts`. **Fixed in plan.**

### EX6: Bare `JSON.parse(jsonStr)` in generator fails pr-check — BLOCKING
The AI response parse in `server/blueprint-generator.ts` also triggers `Bare JSON.parse on server`. **Fixed in plan.**

### EX7: `violet-` colors in BlueprintDetail.tsx — BLOCKING
Two uses of `bg-violet-500/10 text-violet-400` and `text-violet-400/70`. Pr-check `Forbidden hues` rule will fail. **Fixed in plan → teal/blue.**

### EX8: `Record<string, unknown>` in shared/types — BLOCKING
`SiteBlueprint.generationInputs?: Record<string, unknown>` triggers pr-check in `shared/types/`. **Fixed in plan → `BlueprintGenerationInput`.**

### EX9: Hand-rolled stmts cache — IMPORTANT
`let _stmts: Stmts | null = null; function stmts() {...}` pattern violates the `createStmtCache` convention. Every Phase 1 service uses `createStmtCache`. **Fixed in plan.**

### EX10: No `ActivityType` values for blueprints — IMPORTANT
`server/activity-log.ts` has no `blueprint_*` ActivityType values. All 27 other route files call `addActivity`. Phase 1 routes (brandscript, identity, voice) all call it. Must extend the union and add calls to routes. **Noted in plan + calls added to route template.**

### EX11: No WS_EVENTS constants for blueprints — IMPORTANT
No `BLUEPRINT_UPDATED` / `BLUEPRINT_GENERATED` in `server/ws-events.ts`. Plan's claim "already wired" was incorrect. **Fixed in plan — broadcast calls added to POST/generate routes, WS_EVENTS prerequisite noted.**

### EX12: `queryKeys` factories required — IMPORTANT
Platform requires ALL React Query keys to come from `src/lib/queryKeys.ts` factory. Components cannot use inline `['blueprints', wsId]` arrays. Requires adding admin factories before Tasks 8–10. **Added as Task 7 Step 0.**

### EX13: `useState+useEffect+fetch` in frontend components — IMPORTANT
`PageStrategyTab.tsx` template uses the forbidden `useState<SiteBlueprint[]> + useEffect + fetch` pattern. Must use React Query. **Warning added to Task 8; hook usage documented.**

### EX14: `ContentPageType` missing Phase 2 types — BLOCKING
`homepage`, `about`, `contact`, `faq`, `testimonials` are not in the current `ContentPageType` union. Blueprint entry `pageType` field is typed as `ContentPageType` — TypeScript will reject Phase 2 values. **Added as Task 2 Step 2 (bumped TemplateSection step to Step 3).**

### EX15: `useWorkspaceEvents` handler missing from frontend — IMPORTANT
Without this, real-time blueprint updates (generate complete, entry added by another tab) won't propagate to the UI. **Noted in Task 8 warning block.**

### EX16: `buildWorkspaceIntelligence` confirmed working — INFO
`buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext', 'insights'] })` exists and works. `seoContext.effectiveBrandVoiceBlock` (NOT `brandVoice`) is the correct field for brand/voice context — it has Phase 1 authority applied. The plan's generator uses the legacy `getBrandscript()` direct call path; the intelligence layer upgrade is already documented as a comment in the generator.

---

## Notes for Dispatcher

1. **Phase 1 is confirmed complete.** Migration 053, all brandscript/voice/identity exports, all context
   builders — verified present. You can start Phase 2 immediately.

2. **Correct the plan document before dispatching agents.** Agents will follow the plan literally.
   Runtime-breaking bugs in plan code become runtime-breaking bugs in implementation.

3. **The `brief_id` bug (C4) is the most dangerous.** It will silently crash the entire AI generation
   flow (the primary user-facing action) with no obvious error message.

4. **The route ordering bugs (C2, C3) are the sneakiest.** Routes compile and serve fine — they just
   route to the wrong handler. The `section-plan-defaults` endpoint will never respond correctly, and
   `reorder` will silently update a nonexistent entry. Both would only surface as mystery 404s in
   the browser.

5. **Don't skip the WS broadcast task.** The claim in the plan ("already wired") is incorrect. The
   blueprint mutations have no broadcast mechanism. This means the admin who creates a blueprint in
   one browser tab will not see it in another tab until refresh.
