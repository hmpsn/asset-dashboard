# Strategy Redesign Phase 2 — Lane Plan (IA Rename + Move + P3 Pre-commit Contracts)

> **Phase:** 2 of 4 (synthesized plan §7 Phase 2)
> **Date:** 2026-06-18
> **Branch base:** `strategy-redesign-review-fixes` (continues the v3 line; P1 trust-recovery gate must be MERGED and green on staging before any P2 commit lands)
> **Plan root:** `docs/superpowers/plans/2026-06-18-strategy-redesign-synthesized-plan.md`
> **Cadence:** pre-commit shared contracts → parallel implementer lanes → controller commits per lane → two-stage review (scaled-code-review)

---

## Phase 2 scope (hard-bounded)

**In scope:**
- Rename the "Rankings" tab label → "Keywords & Rankings" (UI label only; `id:'rankings'` stays — deep-link contract test must stay green)
- Move `SiteTargetKeywords`, `KeywordOpportunities`, and `ClientKeywordFeedback` from Overview into the Keywords & Rankings tab (passive display only, existing behavior preserved)
- Add a prominent "Open the Keyword Hub" deep-link button to the Keywords & Rankings tab header (reuses `adminPath(workspaceId, 'seo-keywords')` + `buildHubDeepLinkQuery`)
- Pre-commit all P3 shared contracts so parallel P3 agents have an already-committed foundation (see §Pre-commit contracts below)

**Hard out-of-scope (enforce during review):**
- No managed-set write UI (add/remove/keep buttons, curated-set state) — that is P3 behind `strategy-keywords-managed-set`
- No new API routes, migrations, or domain modules in this PR (those are the P3 pre-commits below, committed BEFORE the lanes fan out)
- No changes to the `strategy-command-center` umbrella flag logic
- No send paths, rec minting, or lifecycle mutations
- No content/competitive/overview tab changes beyond removing the three surfaces being re-homed

---

## Pre-commit contracts (committed by the CONTROLLER before any lane is dispatched)

These must land in a single dedicated commit on the branch before parallel agents start. Every agent's prompt must reference this commit hash so they can import from it.

### P3-contract-1: Child feature flags

**File:** `shared/types/feature-flags.ts`

Add three child flag entries (defaults map + FEATURE_FLAG_CATALOG + Strategy group `keys` array — ALL THREE locations in one commit; `verify:feature-flags` will fail otherwise):

```ts
// defaults map (line ~59 area)
'strategy-keywords-managed-set': false,
'strategy-competitor-send': false,
'strategy-signal-fold': false,

// FEATURE_FLAG_CATALOG entries (after the strategy-command-center block)
'strategy-keywords-managed-set': {
  label: 'Strategy redesign — managed keyword working set (add/remove/keep/replenish)',
  group: 'Strategy',
  lifecycle: {
    owner: 'analytics-intelligence',
    createdAt: '2026-06-18',
    rolloutTarget: 'staging-validation',
    removalCondition: 'Promote to default once the dedicated strategy_keyword_set table, reconciler, and managed-set UI are validated on staging.',
    linkedRoadmapItemId: 'strategy-redesign-phase-3-managed-set',
    staleAuditCadence: 'monthly',
    lastReviewedAt: '2026-06-18',
  },
},
'strategy-competitor-send': {
  label: 'Strategy redesign — competitor RecType send-to-client (Phase 4)',
  group: 'Strategy',
  lifecycle: {
    owner: 'analytics-intelligence',
    createdAt: '2026-06-18',
    rolloutTarget: 'staging-validation',
    removalCondition: 'Promote to default once competitor client renderer + send spine are validated on staging.',
    linkedRoadmapItemId: 'strategy-redesign-phase-4-competitor-send',
    staleAuditCadence: 'monthly',
    lastReviewedAt: '2026-06-18',
  },
},
'strategy-signal-fold': {
  label: 'Strategy redesign — fold Intelligence Signals into cockpit as real recs at gen time (Phase 4)',
  group: 'Strategy',
  lifecycle: {
    owner: 'analytics-intelligence',
    createdAt: '2026-06-18',
    rolloutTarget: 'staging-validation',
    removalCondition: 'Promote to default once mintSignalRecs + carry-over perf audit are validated on staging and the standalone IntelligenceSignals card is deleted.',
    linkedRoadmapItemId: 'strategy-redesign-phase-4-signal-fold',
    staleAuditCadence: 'monthly',
    lastReviewedAt: '2026-06-18',
  },
},

// Strategy group keys array (line ~357)
// extend the existing array: add 'strategy-keywords-managed-set', 'strategy-competitor-send', 'strategy-signal-fold'
```

Run `npm run verify:feature-flags` immediately after — fail is a blocker.

### P3-contract-2: Migration 139 skeleton

**File:** `server/db/migrations/139-strategy-keyword-set.sql`

Exact SQL from §3.1 of the synthesized plan. The table is created but empty; the reconciler (P3 Lane B) wires into `persistKeywordStrategy` later. This commit makes the migration available for Lane B to import against.

```sql
CREATE TABLE IF NOT EXISTS strategy_keyword_set (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL,
  keyword       TEXT NOT NULL,
  source        TEXT NOT NULL CHECK(source IN ('regen_computed', 'client_request', 'manual_add')),
  kept_at       TEXT,
  removed_at    TEXT,
  slot_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(workspace_id, keyword)
);
CREATE INDEX IF NOT EXISTS idx_strategy_keyword_set_ws ON strategy_keyword_set(workspace_id);
```

### P3-contract-3: Shared types for managed keyword set

**File:** `shared/types/strategy-keyword-set.ts` (NEW — add to `shared/types/`)

```ts
// shared/types/strategy-keyword-set.ts
export type KeywordSetSource = 'regen_computed' | 'client_request' | 'manual_add';

export interface StrategyKeywordSetRow {
  id: number;
  workspaceId: string;
  keyword: string;
  source: KeywordSetSource;
  keptAt: string | null;    // ISO; operator explicitly kept — survives regen
  removedAt: string | null; // ISO; operator removed — excluded from replenish
  slotOrder: number;
  createdAt: string;
}

/** Active rows (removedAt IS NULL), ordered by slotOrder. */
export type ActiveStrategyKeyword = StrategyKeywordSetRow & { removedAt: null };
```

### P3-contract-4: Domain module stub (signatures only, no implementation)

**File:** `server/domains/strategy/managed-keyword-set.ts` (NEW — create the directory too)

Export the exact function signatures Lane B will implement, typed stubs that compile and throw `Error('not implemented')`. This lets Lane A (frontend) import types and lets Lane C (tests) write against the interface before the implementation lands.

```ts
// server/domains/strategy/managed-keyword-set.ts
import type { StrategyKeywordSetRow } from '../../../shared/types/strategy-keyword-set.js';
import type { KeywordStrategy } from '../../../shared/types/keyword-strategy.js';

export function getStrategyKeywordSet(workspaceId: string): StrategyKeywordSetRow[] {
  throw new Error('not implemented');
}
export function reconcileStrategyKeywordSet(workspaceId: string, strategy: KeywordStrategy): void {
  throw new Error('not implemented');
}
export function addStrategyKeyword(workspaceId: string, keyword: string, source: 'client_request' | 'manual_add'): StrategyKeywordSetRow {
  throw new Error('not implemented');
}
export function removeStrategyKeyword(workspaceId: string, keyword: string): void {
  throw new Error('not implemented');
}
export function keepStrategyKeyword(workspaceId: string, keyword: string): void {
  throw new Error('not implemented');
}
```

### P3-contract-5: WS event constant + query key

**Files:**
- `server/ws-events.ts` — add `STRATEGY_KEYWORD_SET_UPDATED: 'strategy:keyword-set:updated'` to `WS_EVENTS`
- `src/lib/queryKeys.ts` — add `strategyKeywordSet: (wsId: string) => ['admin-strategy-keyword-set', wsId] as const` under the `admin` key group (near line 90, after `strategyDiff`)

### P3-contract-6: ActionType union extension

**File:** `shared/types/outcome-tracking.ts`

Add two new values to the `ActionType` union (line ~4–19):
```ts
| 'topic_cluster_keep'
| 'content_gap_keep'
```

Note: `strategy_keyword_added` already exists (line 8). Add also:
```ts
| 'strategy_keyword_kept'
| 'strategy_keyword_removed'
```
(These three are the admin-only activity log types for P3 mutations; pre-committing them avoids a later union-merge conflict.)

### P3-contract-7: FixContext extension (6 new optional fields)

**File:** `src/App.tsx` — extend the EXISTING `interface FixContext` at line 77–98.

Add after `pageType?: string`:
```ts
// Content-gap brief pre-seed fields (P3 — all optional so existing callers compile unchanged)
rationale?: string;
competitorProof?: string;
volume?: number;
intent?: string;
questionKeywords?: string[];
serpFeatures?: string[];
```

**Important:** this is a purely additive change (all `.optional()`). The four receiver layers that READ these fields (`ContentBriefs.tsx:469-491`, `content-brief-generation-job.ts:36-42`, `server/routes/jobs.ts:287-288`, `server/content-brief.ts:1219-1230`) are P3 work — not here. Pre-committing the interface means Lane C (FixContext receiver wiring) can write against the type without a merge conflict.

### P3-contract-8: pr-check rules (incomplete-rec-filter + strategy-send-must-route-through-lifecycle)

**File:** `scripts/pr-check.ts`

Add both rules to the `CHECKS` array (see §3.3 and §3.5 of the synthesized plan for exact regex). After adding:
- Run `npm run rules:generate` to regenerate `docs/rules/automated-rules.md`
- Commit both `scripts/pr-check.ts` AND `docs/rules/automated-rules.md` together

**Rule 1 — incomplete-rec-filter:**
```
name: 'incomplete-rec-filter',
pattern: /status\s*===\s*['"]dismissed['"]|status\s*!==\s*['"]dismissed['"]/,
files: ['src/components/strategy/**'],
message: "Direct status==='dismissed' filter without isActiveRec() — use isActiveRec() from recommendations.ts as the single active-set predicate. Add // incomplete-rec-filter-ok with justification if intentional.",
excludeLines: ['incomplete-rec-filter-ok'],
```

**Rule 2 — strategy-send-must-route-through-lifecycle:**
```
name: 'strategy-send-must-route-through-lifecycle',
pattern: /clientActions\.create\(|ClientActionSourceType/,
files: ['src/components/strategy/**'],
message: "New clientActions.create() or ClientActionSourceType value inside strategy components — sends must route through sendRecommendation() / the rec lifecycle. Add // strategy-send-must-route-through-lifecycle-ok naming the bespoke renderer if a deliverable spine is genuinely required.",
excludeLines: ['strategy-send-must-route-through-lifecycle-ok'],
```

---

## Lane decomposition

### Lane A — Tab label rename + Keywords & Rankings tab re-wiring

**Model:** sonnet (mechanical JSX reorder, label string, no data-model changes)

**Owns exclusively:**
- `src/components/KeywordStrategy.tsx` (THE contested file — assigned here; no other lane touches it)
- `src/components/strategy/StrategyRankingsTab.tsx` (read-only reference — verify it passes through cleanly; no edits unless its imports need updating)

**Task summary (3 sentences):**

Rename the "Rankings" label in `STRATEGY_INTERIOR_TABS` (line 55 of `KeywordStrategy.tsx`) from `'Rankings'` to `'Keywords & Rankings'` — the `id:'rankings'` literal stays unchanged (deep-link contract test scans for this exact string). Remove `realLeaves.siteKeywords`, `realLeaves.opportunities`, and `clientFeedbackCombinedEl` from their current render positions (lines 420, 421, 395 respectively) inside the `interiorTab === 'overview'` block; these three elements move to the Keywords & Rankings tab block (handled in this same file). In the `interiorTab === 'rankings'` block (line 444), replace the bare `<StrategyRankingsTab .../>` with a wrapper `<div className="space-y-8">` that first renders a tab-header Hub deep-link button, then `realLeaves.siteKeywords`, then `realLeaves.opportunities`, then `realLeaves.clientFeedbackCombined` (collapsible), then `<StrategyRankingsTab .../>` — maintaining the render order specified in §4② of the synthesized plan.

**Specific constraints:**
- The `clientFeedbackCombinedEl` variable is built at line 290–297; keep the variable, just move where it renders. Do NOT remove the variable definition — it will render under the Keywords & Rankings tab.
- The leak comment (line 392–396) documents that `clientFeedbackCombinedEl` + `settingsEl` render outside tabs as interim. After this move, `clientFeedbackCombinedEl` still renders outside (in the no-real-strategy state, before the TabBar) via the current unconditional render, AND inside the `rankings` tab. The comment needs updating to reflect `clientFeedbackCombinedEl` is now also re-homed, leaving only `settingsEl` + `localSeoEl` as the remaining leak. P4 removes the leak entirely.
- `settingsEl` and `localSeoEl` remain in their current outside-tabs positions — do NOT move them in this PR.
- The "Open the Keyword Hub" button must use `adminPath(workspaceId, 'seo-keywords')` (already imported) + `buildHubDeepLinkQuery` (already imported via `KeywordOpportunities`). Import `buildHubDeepLinkQuery` from `'../lib/keywordHubDeepLink'` if not already at the top of the file.
- `StrategyDiff` (line 419, the `realLeaves.strategyDiff`) and `intelligenceSignalsEl` (line 422) remain in Overview — do NOT move them.

**Flag-OFF correctness check (critical):** with `strategy-command-center = false` (the flag-OFF path), the current render at line 406 uses `actQueueEl` instead of `cockpitEl`. The `realLeaves.siteKeywords` and `realLeaves.opportunities` are STILL REMOVED from Overview even flag-OFF (because the IA move is not a cockpit feature — it's a tab IA change independent of the flag). Confirm the flag-OFF render path still shows the renamed tab with the re-homed surfaces. This is the byte-identical guard: the public data output is unchanged but the admin IA changes apply to both flag states.

**Tests to run after this lane:**
- `tests/contract/tab-deep-link-wiring.test.ts` — must still pass; `id:'rankings'` unchanged.
- `npm run typecheck && npx vite build`
- `npm run pr-check`
- Snapshot: `tests/integration/recommendations-public-allowlist.test.ts` — flag-OFF byte-identical (no data changes, should be green trivially)

---

### Lane B — P3 Backend domain stub implementation (managed-keyword-set)

**Model:** opus (backend data-model work, transaction seam, reconciler wiring)

**Owns exclusively:**
- `server/domains/strategy/managed-keyword-set.ts` (implement the stubs from P3-contract-4)
- `server/keyword-strategy-persistence.ts` (add `reconcileStrategyKeywordSet` call inside `writeKeywordStrategy` txn at line 169, after line 214)

**Task summary (3 sentences):**

Implement the five exported functions in `server/domains/strategy/managed-keyword-set.ts` using `createStmtCache()`/`stmts()` prepared statements, a `rowToStrategyKeyword()` mapper, and `addActivity()` calls for each mutation — referencing the spec in §3.1 of the synthesized plan for the exact reconciler algorithm (SELECT once, diff against `strategy.siteKeywords`, insert net-new as `source:'regen_computed'`, auto-replenish vacancies from the opportunity pool ranked by `estimatedGain`/`opportunity_score`). Wire `reconcileStrategyKeywordSet(ws.id, strategy)` into the existing `writeKeywordStrategy = db.transaction(...)` in `server/keyword-strategy-persistence.ts` at line 169, as call number 4 immediately after the three existing sibling reconciler calls at lines 212–214 — this is the ONLY writer seam: NOT `saveRecommendations()` (which has no transaction) and NOT any route handler. Broadcast `WS_EVENTS.STRATEGY_KEYWORD_SET_UPDATED` via `broadcastToWorkspace()` after the transaction commits (outside the txn body, at the same level as the existing broadcast pattern in the persistence layer).

**Specific constraints:**
- The reconciler body runs INSIDE the existing `db.transaction()` — no nested `db.transaction()` call; better-sqlite3 siblings self-open inside an enclosing txn. The three sibling reconcilers (`replaceAllKeywordGaps`, `replaceAllTopicClusters`, `replaceAllCannibalizationIssues`) at lines 212–214 are the model to follow.
- No AI calls inside the txn body (pr-check `ai-call-before-db-write` rule guards this).
- `removeStrategyKeyword` sets `removed_at` (NOT a hard delete) so the keyword persists for replenish-exclusion; the auto-replenish step runs inside the same `db.transaction()` call on the `removeStrategyKeyword` path.
- `addStrategyKeyword` must call `assertKeywordNotAlreadyTargeted` (from `keyword-command-center.ts` — read its signature before calling) before the INSERT, per §3.1.
- All three mutation functions (`add`, `remove`, `keep`) call `addActivity()` with the pre-committed `ActionType` values (`strategy_keyword_added`, `strategy_keyword_removed`, `strategy_keyword_kept`).
- The broadcast (`STRATEGY_KEYWORD_SET_UPDATED`) goes OUTSIDE the transaction, after `writeKeywordStrategy.immediate()` returns at line 300.
- This lane does NOT add any HTTP routes. Route handlers are P3 follow-on work (not in scope for this PR). The domain module is a pure server-side library for the reconciler path only.

**Tests to write (within this lane):**
- Unit test for `reconcileStrategyKeywordSet`: curate a set, simulate a keyword-strategy regen (call `reconcileStrategyKeywordSet` directly with new `siteKeywords`), assert active rows survive; add a `kept_at` row and assert it also survives.
- Durability test stub (the P3 gate): call `reconcileStrategyKeywordSet`, then simulate `replaceAllTrackedKeywordRows` (the rank-tracking clobber path at `tracked-keywords-store.ts:184`), assert `strategy_keyword_set` rows are untouched. This is the graft-1 regression guard.

---

### Lane C — FixContext receiver wiring (brief pre-seed 4-layer)

**Model:** sonnet (mechanical wiring across four known receiver layers, no new logic)

**Owns exclusively:**
- `src/components/ContentBriefs.tsx` (extend `handleGenerate` payload at line 483–489)
- `server/content-brief-generation-job.ts` (widen `StandaloneContentBriefGenerationParams.pageAnalysisContext` at line 36–42)
- `server/routes/jobs.ts` (widen the type-narrowing cast at line ~287-288 so new fields aren't stripped at the HTTP boundary)
- `server/content-brief.ts` (add emission of the 6 new fields into the prompt-assembly block at line 1219–1230)

**Task summary (3 sentences):**

Wire the 6 new optional `FixContext` fields (`rationale`, `competitorProof`, `volume`, `intent`, `questionKeywords`, `serpFeatures`) through all four receiver layers so a Content Gaps "Generate Brief" action pre-seeds the brief with gap evidence: (1) extend `ContentBriefs.tsx:handleGenerate` to read them from `fixContextRef.current` and include them in the `pageAnalysisContext` object passed to `startBriefGenerationJob`; (2) widen `StandaloneContentBriefGenerationParams.pageAnalysisContext` in `content-brief-generation-job.ts` to carry the six fields; (3) ensure the type-narrowing at `server/routes/jobs.ts:287-288` does not strip them (widen the cast or the narrower type it casts to); (4) emit the new fields into the `pageAnalysisBlock` in `server/content-brief.ts:1219-1230`. Resolve the `serpFeatures` precedence decision inline: when `matchedPage?.serpFeatures` is present (the page_keywords-derived source at line 1240), it takes precedence; `fixContext.serpFeatures` is the fallback emitted only when `matchedPage?.serpFeatures` is absent — document this in a `// precedence:` inline comment on the conditional.

**Specific constraints:**
- The `ContentGaps.tsx:78` sender passes `primaryKeyword`; the `ContentGaps.tsx:86` sender passes `pageName`. This lane's job is RECEIVER wiring only — do not change `ContentGaps.tsx` (it is not in this lane's file ownership). The `FixContext` interface already has both fields (they existed before this PR). The mismatch is a pre-existing sender divergence; defer sender unification to the P3 PR that adds the new fields to the `ContentGaps` send call.
- All 6 new fields are `.optional()` on the `pageAnalysisContext` shape — no breaking change to existing callers.
- The Zod schema at `server/routes/jobs.ts` (if the route validates `params` with Zod) must also be widened to permit the new optional fields; a required field with a wrong Zod schema silently drops the data.
- Do NOT touch `src/App.tsx` (the `FixContext` interface was extended in the pre-commit contracts). Import the updated type; do not re-extend it.
- Do NOT touch any strategy component files — this lane is purely the brief-generation pipeline.

**Tests to write (within this lane):**
- End-to-end read-path contract test: pass a `fixContext` with all 6 new fields through a stubbed `startBriefGenerationJob` call and assert each field appears in the assembled `pageAnalysisBlock` / prompt (not merely passed to the job). This is the both-halves guard §5.5(e) in the synthesized plan. Use `createEphemeralTestContext` for a spawned-server test.

---

### Lane D — Flag catalog + pr-check rules (pre-commit companion verification)

**Model:** sonnet (mechanical — adding flag entries and pr-check regex, then regenerating docs)

**Owns exclusively:**
- `shared/types/feature-flags.ts` (already mutated in the pre-commit contracts — this lane's job is to VERIFY the pre-commit is correct and fix any issues; it does not own the file for novel edits)
- `scripts/pr-check.ts` (add the two new rules)
- `docs/rules/automated-rules.md` (regenerated via `npm run rules:generate`)

**Task summary (3 sentences):**

Verify the pre-committed flag additions in `shared/types/feature-flags.ts` compile and pass `npm run verify:feature-flags` — fix any missing entry in the defaults map, FEATURE_FLAG_CATALOG, or group `keys` array if the pre-commit is incomplete. Add the two new pr-check rules (`incomplete-rec-filter` and `strategy-send-must-route-through-lifecycle`) to `scripts/pr-check.ts` per the exact specifications in §3.3 and §3.5 of the synthesized plan (regex patterns, file scope `src/components/strategy/**`, escape-hatch suffixes). Regenerate `docs/rules/automated-rules.md` with `npm run rules:generate` and commit both files together; verify the new rules appear correctly in the generated output.

**Specific constraints:**
- This lane runs AFTER the pre-commit controller commit but BEFORE or in parallel with the other lanes (no dependency on A/B/C). It owns only two files for novel edits (`scripts/pr-check.ts`, `docs/rules/automated-rules.md`).
- The pr-check rules are pattern-based (inline hatch placement per `feedback_pr_check_hatch_placement`). The escape hatch suffix must be on the SAME LINE as the flagged code, not above it.
- Do not introduce a new `pr-check` test that hits the live codebase in ways that would generate false positives from existing code — scope the `files` glob narrowly to `src/components/strategy/**` to avoid cross-module noise.
- After adding the rules, run `npm run pr-check` against the current working tree to confirm zero false positives in the existing strategy components.

---

## File ownership matrix (no overlaps)

| File | Lane |
|------|------|
| `src/components/KeywordStrategy.tsx` | A |
| `src/components/strategy/StrategyRankingsTab.tsx` | A (read-only verify) |
| `server/domains/strategy/managed-keyword-set.ts` | B |
| `server/keyword-strategy-persistence.ts` | B |
| `src/components/ContentBriefs.tsx` | C |
| `server/content-brief-generation-job.ts` | C |
| `server/routes/jobs.ts` | C |
| `server/content-brief.ts` | C |
| `scripts/pr-check.ts` | D |
| `docs/rules/automated-rules.md` | D |
| `shared/types/feature-flags.ts` | pre-commit (controller only) |
| `server/db/migrations/139-strategy-keyword-set.sql` | pre-commit (controller only) |
| `shared/types/strategy-keyword-set.ts` | pre-commit (controller only) |
| `shared/types/outcome-tracking.ts` | pre-commit (controller only) |
| `src/App.tsx` | pre-commit (controller only) |
| `server/ws-events.ts` | pre-commit (controller only) |
| `src/lib/queryKeys.ts` | pre-commit (controller only) |

**No lane may touch a file not in its ownership column.** Any overlap found during review is a blocking issue.

---

## Intra-phase dependency ordering

```
[pre-commit controller commit]
         │
         ├──▶ Lane A (tab rename + IA move)       — no deps on B/C/D
         ├──▶ Lane B (domain stub + reconciler)    — depends on pre-commit types/migration
         ├──▶ Lane C (FixContext receivers)         — depends on pre-commit FixContext extension
         └──▶ Lane D (flags + pr-check rules)      — depends on pre-commit only
                                          │
                          [controller diff-review checkpoint]
                          [git diff, grep duplicates, tsc -b, npx vitest run]
                          [scaled-code-review before merge]
```

Lanes A, B, C, D can run in parallel after the pre-commit controller commit. No lane depends on another lane's output. The controller runs a diff-review checkpoint after all four complete before merging.

---

## Phase 2 acceptance gate (ALL must be green before merge to staging)

- [ ] `npm run typecheck` — zero errors (`tsc -b --noEmit`)
- [ ] `npx vite build` — builds successfully
- [ ] `npx vitest run` — full test suite passes (not just new tests)
- [ ] `npm run pr-check` — zero new violations
- [ ] `npm run verify:feature-flags` — no orphaned or ungrouped flag keys
- [ ] `tests/contract/tab-deep-link-wiring.test.ts` — passes (`id:'rankings'` unchanged, label change is display-only)
- [ ] `tests/integration/recommendations-public-allowlist.test.ts` — flag-OFF byte-identical (no data changes)
- [ ] Real-browser DOM probe: Keywords & Rankings tab renders all three re-homed surfaces (`SiteTargetKeywords`, `KeywordOpportunities`, `ClientKeywordFeedback`) and the Hub deep-link button is visible at top-right without scrolling
- [ ] Mobile breakpoint: tab rename and re-homed surfaces render correctly at narrow viewport
- [ ] Lane B durability test stub passes (the `strategy_keyword_set` table + stub reconciler survive a simulated rank-tracking clobber)
- [ ] Lane C end-to-end read-path contract test passes (all 6 new `FixContext` fields reach the assembled prompt)
- [ ] `npm run rules:generate` output matches committed `docs/rules/automated-rules.md`
- [ ] Scaled-code-review invoked; all Critical/Important findings fixed before merge
- [ ] Flag-OFF path verified: with `strategy-command-center = false`, the renamed tab + re-homed surfaces still appear (the IA move is tab-structure level, not cockpit-gated)

---

## Key design invariants the review must enforce (per synthesized plan)

1. **Flag-OFF byte-identical on public data** — the moved surfaces are admin-UI-only. `GET /api/public/workspace/:id` and `GET /api/public/recommendations/:ws` output must be identical between flag states.
2. **`id:'rankings'` literal NOT changed** — the deep-link contract test at `tests/contract/tab-deep-link-wiring.test.ts` scans for exact `id` literals. Changing it breaks client-side deep links and the contract test.
3. **`StrategyDiff` JSX position is not touched** — it must remain above cockpit in Overview (graft 3, the P1 trust-recovery gate result). Any JSX reorder in Overview that displaces `StrategyDiff` is a regression.
4. **`useWorkspaceEvents` handler in `StrategyDiff` is preserved** — the component's `queryKeys.admin.strategyDiff` invalidation on `STRATEGY_UPDATED` must survive the JSX shuffle in `KeywordStrategy.tsx`. Code-review gate item (synthesized plan §4①).
5. **No managed-set UI in this PR** — the add/remove/keep buttons, curated-set state, and `strategy-keywords-managed-set` flag usage in components are P3. Lane A's re-homed `SiteTargetKeywords` and `KeywordOpportunities` render in passive/read-only mode identical to today.
6. **Corrected txn seam (graft 1)** — Lane B wires into `persistKeywordStrategy`'s `writeKeywordStrategy` txn at line 169, NOT `saveRecommendations()`. Review blocks any implementation that hooks into `saveRecommendations` (which has ZERO `db.transaction` calls).
7. **FixContext extension is additive only** — all 6 new fields are `.optional()` on `FixContext`. A compile error from an existing caller is a broken pre-commit.
8. **5-map competitor RecType lockstep is P4 work** — do not start adding the `competitor` RecType in this PR. The 5-map lockstep (`REC_POLICY_REGISTRY` + `REC_TYPE_ACT_CATEGORY` + `REC_TYPE_ADMIN_TAB` + `REC_TYPE_TAB` in `src/components/client/InsightsEngine.tsx:39` + `TYPE_ICONS` in `InsightsEngine.tsx:99`) is a single atomic P4 commit.
