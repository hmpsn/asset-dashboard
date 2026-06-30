# SEO Decision Engine — Phase 1: Value-First Keyword Scoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline; this is an atomic refactor concentrated in one large file — single-owner, not subagent-fragmented). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Retire the `keyword-value-scoring` feature flag — make value-first keyword scoring unconditional, delete the crude Hub-sort path, keep `computeOpportunityScore` for its non-Hub roles.

**Architecture:** Remove the flag read in 3 production files, collapse the dual sort-accessor sets to the value-first set, drop the flag from the catalog, then rewrite the 6 test files whose override-OFF cases become no-ops. Add a pr-check anti-reintroduction rule (project convention). Atomic: production + tests land in one green commit (a pre-commit hook runs related tests).

**Tech stack:** TypeScript, vitest, better-sqlite3, the project feature-flag catalog + deprecation registry + pr-check.

**Verified scope:** docs/superpowers/audits/2026-06-23-seo-engine-p1-value-scoring-audit.md (every site grep-confirmed).

---

## INVARIANT (do not violate)

**Keep `computeOpportunityScore`** (`server/keyword-strategy-helpers.ts:90`). It stays as: the value-first gate-failure fallback (`enrichment.ts:626`), the backfill basis (`helpers.ts:158`), and the fallback in `briefing-candidates.ts:239`, `briefing-client-projection.ts:67`, `routes/public-content.ts:225`. **Delete only its 2 crude Hub-sort call sites:** `keyword-command-center.ts:909` and `:2530`. The category-E pure-unit tests (audit §E) must stay green untouched — they are the regression guard.

**Green-at-commit:** the pre-commit hook runs related tests. Tasks 1+2 (production + test rewrites) are coupled and commit together; the suite is red between them, so do not commit until both are done.

---

### Task 1: Production — make value-first unconditional, delete crude branches, remove the flag

**Files:**
- Modify: `server/keyword-command-center.ts` (flag const `:107`; accessors `:899-935`, `:2522-2566`; `buildValueScoringConfig :253`; `finalizeDraftRow :1441-1454`; candidate precompute `:2357-2359`; probe `:2611-2621`; build-rows `:2956-2988`; import `:24`)
- Modify: `server/keyword-strategy-enrichment.ts:600-650`
- Modify: `server/keyword-strategy-ux.ts:420-460`
- Modify: `shared/types/feature-flags.ts` (`:53-54`, `:315-327`, `:574`)

- [ ] **Step 1 — `keyword-command-center.ts`: collapse row accessors.** Delete `ROW_SORT_ACCESSORS_VALUE_FIRST` (`:920-923`) and make the base `opportunity` accessor the value-first field read:

```ts
const ROW_SORT_ACCESSORS: SortFieldAccessors<KeywordCommandCenterRow> = {
  keyword: (row) => row.keyword,
  demand: (row) => row.metrics.volume ?? row.metrics.impressions,
  rank: (row) => row.metrics.currentPosition,
  clicks: (row) => row.metrics.clicks,
  difficulty: (row) => row.metrics.difficulty,
  // Value-first opportunity: field read of the score precomputed once per key in
  // finalizeDraftRow (rowValueScore WeakMap). undefined → missing-last in compareMetric.
  opportunity: (row) => rowValueScore.get(row),
};
```

- [ ] **Step 2 — `sortRowsForQuery` (`:925-935`): drop the `valueScoringOn` param** and use `ROW_SORT_ACCESSORS` directly:

```ts
export function sortRowsForQuery(
  sort: KeywordCommandCenterSort | undefined,
  direction?: 'asc' | 'desc',
): (a: KeywordCommandCenterRow, b: KeywordCommandCenterRow) => number {
  if (sort === undefined || sort === 'priority') return sortRows;
  return keywordSortComparator(sort, direction, ROW_SORT_ACCESSORS);
}
```

- [ ] **Step 3 — candidate accessors (`:2522-2566`):** same collapse — delete `CANDIDATE_SORT_ACCESSORS_VALUE_FIRST`, make `CANDIDATE_SORT_ACCESSORS.opportunity = (c) => c.valueScore`, and drop `valueScoringOn` from `candidateSortForQuery`. Delete the crude `opportunity: (c) => computeOpportunityScore(...)` at `:2530`.

- [ ] **Step 4 — unconditionalize the config + precomputes.** `buildValueScoringConfig` (`:253`): always build the `ScoringContext` (remove any `{ on: false }` short-circuit). `finalizeDraftRow` (`:1441-1454`) and candidate merge (`:2357-2359`): always precompute the value score. The test-parity probe (`:2611-2621`): keep computing with value scoring (it was already ON there).

- [ ] **Step 5 — remove the flag read.** Delete `KEYWORD_VALUE_SCORING_FLAG` const (`:107`); at `:2956` remove `const valueScoringOn = isFeatureEnabled(...)` and the `valueScoringOn` arg at `:2961`/`:2988` (the sorters no longer take it). If `computeOpportunityScore` is now unused in this file, remove it from the import at `:24` (keep `isSuspiciousPlannerGroupedVolume`). Verify `isFeatureEnabled` import is still used elsewhere in the file before removing it.

- [ ] **Step 6 — `keyword-strategy-enrichment.ts:604-650`: unconditionalize.** Remove `valueScoringOn` (`:607`); always build `scoringCtx`; `base` becomes value-first with the kept fallback:

```ts
  if (strategy.contentGaps?.length) {
    const ws = getWorkspace(workspaceId);
    const scoringCtx = {
      posture: getLocalSeoPosture(workspaceId),
      markets: listLocalSeoMarkets(workspaceId),
      city: ws?.businessProfile?.address?.city?.toLowerCase(),
      state: ws?.businessProfile?.address?.state?.toLowerCase(),
    };
    for (const cg of strategy.contentGaps) {
      // value-first; computeKeywordValueScore may hit the signal gate → keep the
      // legacy fallback so a gap is never silently dropped.
      const base: number | undefined =
        computeKeywordValueScore(
          { keyword: cg.targetKeyword, volume: cg.volume, difficulty: cg.difficulty, cpc: cg.cpc, intent: cg.intent },
          scoringCtx,
        ) ?? computeOpportunityScore(cg);
      // ... unchanged relaxConservatism OV branch + else (cg.opportunityScore = base) ...
```

Keep the `relaxConservatism` block and the `else` exactly as-is (they read `base`).

- [ ] **Step 7 — `keyword-strategy-ux.ts:420-460`: unconditionalize valueReasons.** Remove the `KEYWORD_VALUE_SCORING_FLAG` const + the flag branch; always compute `valueReasons` via `computeKeywordValueComponents` + `keywordValueReasons`. Preserve the `exposeCpc: surface === 'admin'` gate at `:459` verbatim (client must never get raw CPC text).

- [ ] **Step 8 — `shared/types/feature-flags.ts`: remove the key.** Delete the comment + default (`:53-54`), the catalog entry (`:315-327`), and remove `'keyword-value-scoring'` from the group `keys` array (`:574`) → `keys: ['keyword-universe-full']`. The import-time `assertFeatureFlagGroupingConsistency()` will confirm consistency.

- [ ] **Step 9 — typecheck.** Run: `npm run typecheck` — Expected: zero errors. Fix any references to the removed flag/params the compiler surfaces.

### Task 2: Rewrite the 6 flag-referencing test files (audit §D)

- [ ] **Step 1 — `tests/unit/feature-flags-keyword-hub.test.ts:32-42`:** drop the `keyword-value-scoring` assertions (it no longer exists); keep `keyword-universe-full` coverage and update the group-array assertion (`:42`) to `['keyword-universe-full']`.
- [ ] **Step 2 — `tests/integration/keyword-value-scoring-content-gaps.test.ts`:** remove the OFF cases (`:91-111`, `:134`) and all `setWorkspaceFlagOverride('keyword-value-scoring', …)`; keep the value-first ordering assertions as unconditional (`:162` `infoScore !== computeOpportunityScore(INFO_GAP)`). Rename the file/describe to drop "flag" framing if trivial.
- [ ] **Step 3 — `tests/unit/keyword-command-center.test.ts:1722-1826`:** delete OFF cases (`:1738,:1754,:1826`); make ON cases unconditional (remove the override).
- [ ] **Step 4 — `tests/unit/keyword-strategy-ux.test.ts:193-279`:** delete the "no valueReasons when OFF" cases (`:215-216,:260,:279`); valueReasons now always present.
- [ ] **Step 5 — `tests/integration/keyword-command-center-routes.test.ts:305`:** remove/replace the case toggling `/feature-flags/keyword-value-scoring` (flag gone).
- [ ] **Step 6 — `tests/integration/client-strategy-cpc-tier-gate-public-read.test.ts`:** remove the ON-override setup (`:72-81`); valueReasons now unconditional — keep the raw-CPC tier-gate assertions intact.
- [ ] **Step 7 — `tests/pr-check.test.ts:596`:** confirm `'keyword-value-scoring'` there is a flag-agnostic fixture for the `isFeatureEnabled` detection rule; if the new retired-flag rule (Task 4) would flag it, swap to a neutral sample like `'some-flag'`.
- [ ] **Step 8 — run the affected tests:** `npx vitest run tests/unit/feature-flags-keyword-hub.test.ts tests/unit/keyword-command-center.test.ts tests/unit/keyword-strategy-ux.test.ts tests/integration/keyword-value-scoring-content-gaps.test.ts tests/integration/keyword-command-center-routes.test.ts tests/integration/client-strategy-cpc-tier-gate-public-read.test.ts` — Expected: PASS. Also run the category-E guard: `npx vitest run tests/unit/content-gap-opportunity-score.test.ts tests/unit/keyword-strategy-generation-pure.test.ts tests/contract/admin-client-parity-cluster.test.ts` — Expected: PASS unchanged.

### Task 3: Commit Tasks 1+2 (atomic green)

- [ ] **Step 1 — full gates:** `npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts && npm run verify:feature-flags` — all green.
- [ ] **Step 2 — commit:**
```bash
git add server/keyword-command-center.ts server/keyword-strategy-enrichment.ts server/keyword-strategy-ux.ts shared/types/feature-flags.ts tests/
git commit -m "feat(seo): retire keyword-value-scoring flag — value-first scoring unconditional (P1)"
```

### Task 4: Anti-reintroduction pr-check rule + registry advance

- [ ] **Step 1 — pr-check rule:** in `scripts/pr-check.ts`, add `'keyword-value-scoring'` to the `retired` array of the **"Retired SEO/runtime rollout flags"** rule (`~:1329`). Mirror the `keyword-hub` precedent (`:1391`).
- [ ] **Step 2 — regenerate rules:** `npm run rules:generate` (CI verifies `automated-rules.md` is in sync).
- [ ] **Step 3 — deprecation registry:** in `scripts/deprecation-lifecycle.ts:134-146`, advance `keyword-value-scoring-dark-launch` `hidden → removed`; update `evidence`/`testEvidence` (no longer "default false").
- [ ] **Step 4 — verify the rule fires:** add/adjust a case in `tests/pr-check.test.ts` if the retired-flag rule group has test coverage; run `npx vitest run tests/pr-check.test.ts` — Expected: PASS.
- [ ] **Step 5 — commit:** `git add scripts/ docs/rules/automated-rules.md tests/pr-check.test.ts && git commit -m "chore(seo): retire keyword-value-scoring — pr-check guard + deprecation registry (P1)"`

### Task 5: Docs, JSDoc, roadmap, FEATURE_AUDIT

- [ ] **Step 1 — JSDoc "when ON" → "always":** `shared/types/keyword-command-center.ts:118,240`, `shared/types/keyword-strategy-ux.ts:64`, `src/components/client/strategy/strategyKeywordDisplay.ts:46`.
- [ ] **Step 2 — docs:** `docs/rules/keyword-hub.md`, `docs/rules/verified-clean-rules.md` (drop/adjust the flag mention).
- [ ] **Step 3 — roadmap:** mark `keyword-value-scoring` and `seo-engine-p1-value-first-keyword-scoring` items `done` in `data/roadmap.json`; run `npx tsx scripts/sort-roadmap.ts`.
- [ ] **Step 4 — FEATURE_AUDIT.md:** refresh the value-scoring entry (now live, not dark).
- [ ] **Step 5 — commit:** `git add -A && git commit -m "docs(seo): value-first scoring is live — docs/JSDoc/roadmap/audit (P1)"`

### Task 6: Final DoD + push

- [ ] **Step 1 — full suite:** `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run verify:feature-flags && npm run verify:coverage-ratchet` — all green.
- [ ] **Step 2 — push + PR** (see executing flow): `git push -u origin seo-engine-p1-value-scoring`; `gh pr create --base staging`.

---

## Self-review

- **Spec coverage:** P1 spec items — flip+delete (Task 1), keep `computeOpportunityScore` (INVARIANT), test updates (Task 2), deprecation+pr-check (Task 4), docs/roadmap (Task 5). ✔
- **Placeholders:** none — every step names exact files/commands. ✔
- **Type consistency:** `sortRowsForQuery`/`candidateSortForQuery` lose the `valueScoringOn` param in Task 1; every caller (`:2961`) is updated in the same task. ✔
- **Regression guard:** category-E tests untouched and asserted green in Task 2 Step 8. ✔
