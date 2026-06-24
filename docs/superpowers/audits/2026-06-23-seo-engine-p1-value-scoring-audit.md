# SEO Decision Engine — Phase 1 (value-first scoring) Pre-Plan Audit

**Date:** 2026-06-23
**Spec:** docs/superpowers/specs/2026-06-23-seo-decision-engine-design.md (Phase 1)
**Baseline:** `origin/staging` HEAD `1bcb48fca` (worktree `../asset-dashboard-seo-audit`, branch `seo-decision-engine`)
**Scope of change:** Retire the `keyword-value-scoring` flag (default ON → remove key), make value-first scoring unconditional, delete the crude Hub-sort branches, keep `computeOpportunityScore` for its non-Hub roles.

## Headline

Deleting the crude Hub-sort path removes the flag's OFF branch, so this is a **full flag retirement**, not a default flip. That invalidates every override-based OFF test case (the override becomes a no-op once the flag read is gone). The function `computeOpportunityScore` is **kept** — it is load-bearing in 5 non-Hub places. Net: **3 production files, 1 flag-catalog file, 6 test files, 1 deprecation registry, 1 pr-check rule add, ~5 doc/JSDoc updates.** Atomic single PR.

## Findings by category

### A. Flag-read / branch sites — remove the read, make value-first unconditional (production)

| File:line | Site | Action |
|---|---|---|
| `server/keyword-command-center.ts:107` | `KEYWORD_VALUE_SCORING_FLAG` const | delete |
| `server/keyword-command-center.ts:2956,2961` | `isFeatureEnabled(...)` read → sort | unconditional value-first |
| `server/keyword-command-center.ts:899-922` | `ROW_SORT_ACCESSORS` + `..._VALUE_FIRST` | collapse to one (value-first `opportunity` accessor reads `rowValueScore`) |
| `server/keyword-command-center.ts:928-933` | `sortRowsForQuery(valueScoringOn)` accessor select | always value-first; drop the param |
| `server/keyword-command-center.ts:2522-2542` | `CANDIDATE_SORT_ACCESSORS` + `..._VALUE_FIRST` | collapse to one |
| `server/keyword-command-center.ts:2556-2565` | `candidateSortForQuery(valueScoringOn)` | always value-first; drop the param |
| `server/keyword-command-center.ts:253,1644,2988` | `buildValueScoringConfig` / `valueScoring` | always builds the ctx (drop the `{on:false}` short-circuit) |
| `server/keyword-command-center.ts:1441-1454` | `finalizeDraftRow` valueScore precompute | unconditional |
| `server/keyword-command-center.ts:2357-2359` | candidate.valueScore precompute | unconditional |
| `server/keyword-command-center.ts:2611-2649` | test-parity probe | simplify (probe no longer ON/OFF) |
| `server/keyword-strategy-enrichment.ts:600-648` | `valueScoringOn` (`:607`) + 3 score sites | unconditional value-first; **keep** `computeOpportunityScore` gate-failure fallback at `:626-627` |
| `server/keyword-strategy-ux.ts:420-460` | `KEYWORD_VALUE_SCORING_FLAG` const + branch | unconditional `valueReasons` (keep `exposeCpc` admin gate at `:459`) |

### B. Flag definition / catalog / group — remove the key (shared/types/feature-flags.ts)

| Line | Site | Action |
|---|---|---|
| `:53-54` | comment + `'keyword-value-scoring': false` default | delete |
| `:315-327` | `FEATURE_FLAG_CATALOG['keyword-value-scoring']` entry | delete |
| `:574` | group `keys: ['keyword-universe-full', 'keyword-value-scoring']` | remove the key → `['keyword-universe-full']` |
| `:628,:654` | `assertFeatureFlagGroupingConsistency()` (import-time) | re-validates automatically; confirm green |

### C. `computeOpportunityScore` — KEEP the function; these callers stay green

| File:line | Role | Action |
|---|---|---|
| `server/keyword-strategy-helpers.ts:90` | definition | **keep** |
| `server/keyword-strategy-helpers.ts:158` | content-gap backfill basis | keep |
| `server/keyword-strategy-enrichment.ts:626-627` | value-first gate-failure fallback | keep |
| `server/briefing-candidates.ts:239` | impact fallback | keep |
| `server/briefing-client-projection.ts:67` | projection fallback | keep |
| `server/routes/public-content.ts:225` | public projection fallback | keep |
| `server/keyword-strategy-generation.ts:36`, `server/routes/keyword-strategy.ts:72` | re-exports | keep |
| `server/keyword-command-center.ts:909`, `:2530` | **crude Hub-sort branches** | **DELETE** (the only delete sites) |
| `server/keyword-command-center.ts:24` | import of `computeOpportunityScore` | remove if no longer used in this file after :909/:2530 deletion (verify) |

### D. Tests — REWRITE (override-OFF cases become no-ops once the flag is gone)

| File | Lines | Action |
|---|---|---|
| `tests/unit/feature-flags-keyword-hub.test.ts` | 32-42 | the "survives, defaults OFF, stays in group" test is now wrong — drop the `keyword-value-scoring` assertions (`:33,:37,:42`); keep `keyword-universe-full` coverage |
| `tests/integration/keyword-value-scoring-content-gaps.test.ts` | 91-176 | drop OFF cases (`:91-111,:134`); unconditionalize ON cases (remove `setWorkspaceFlagOverride(...true)`); keep value-first assertions (`:162`) |
| `tests/unit/keyword-command-center.test.ts` | 1722-1826 | drop OFF cases (`:1738,:1754,:1826`); unconditionalize ON (`:1722,:1809`) |
| `tests/unit/keyword-strategy-ux.test.ts` | 193-279 | drop "no valueReasons when OFF" (`:215-216,:260,:279`); valueReasons now always present |
| `tests/integration/keyword-command-center-routes.test.ts` | 305 | hits `/feature-flags/keyword-value-scoring` — flag won't exist; update/remove |
| `tests/integration/client-strategy-cpc-tier-gate-public-read.test.ts` | 34,72-81,119 | remove ON override setup (valueReasons now unconditional); keep raw-CPC tier-gate assertions |
| `tests/pr-check.test.ts` | 596 | sample literal `'keyword-value-scoring'` in an `isFeatureEnabled` fixture — **verify** it's flag-agnostic (rule tests pattern detection, not catalog membership); swap to a neutral sample if needed |

### E. `computeOpportunityScore` pure-unit tests — UNCHANGED (function kept)
`tests/unit/content-gap-opportunity-score.test.ts`, `tests/unit/keyword-strategy-generation-pure.test.ts`, `tests/unit/keyword-strategy-helpers.test.ts`, `tests/contract/admin-client-parity-cluster.test.ts`, `tests/unit/content-gaps-pure-extended.test.ts`, `tests/unit/keyword-strategy-enrichment.test.ts` (mocks the fn). These stay green; do not touch.

### F. Deprecation registry — ADVANCE
`scripts/deprecation-lifecycle.ts:134-146` — advance `keyword-value-scoring-dark-launch` from `hidden` → `removed`; update `evidence`/`testEvidence` (no longer "default false" / "survives, defaults OFF"). Per `docs/rules/deprecation-lifecycle.md`.

### G. Docs / JSDoc — UPDATE
- `docs/rules/keyword-hub.md` (cheap-vs-Evaluated split references the flag); `docs/rules/verified-clean-rules.md`.
- JSDoc "when the flag is ON" → "always": `shared/types/keyword-command-center.ts:118,240`, `shared/types/keyword-strategy-ux.ts:64`, `src/components/client/strategy/strategyKeywordDisplay.ts:46`.
- `data/roadmap.json`: mark existing item `keyword-value-scoring` **done** + the new `seo-engine-p1-value-first-keyword-scoring` item done on completion.
- `FEATURE_AUDIT.md`: add/refresh the value-scoring entry.

## Existing coverage (machinery already in place)

- **`assertFeatureFlagGroupingConsistency()`** (`feature-flags.ts:628`, runs at import) — guarantees catalog ↔ group ↔ `FEATURE_FLAGS` consistency; will throw if the three aren't updated together. Free safety net for step B.
- **`verify:feature-flags`** (`scripts/feature-flag-lifecycle.ts`) — asserts `lastReviewedAt`/cadence sanity + roadmap-link resolution, **not** the boolean default. Removing the key drops it from iteration cleanly; the `linkedRoadmapItemId: 'keyword-value-scoring'` resolves to the roadmap item (mark done).
- **Deprecation registry** (`scripts/deprecation-lifecycle.ts`) — already tracks the dark-launch; just advance state.
- **Retired-flag pr-check rules** (`pr-check.ts:1032,1070,1163,1238,1313,1391`) — the established anti-reintroduction pattern; `keyword-value-scoring` is **not** currently named in any rule (confirmed), so removal trips nothing.

## Infrastructure recommendations

1. **pr-check: anti-reintroduction (do in this PR).** Add `'keyword-value-scoring'` to the `retired` array of the **"Retired SEO/runtime rollout flags"** rule (`scripts/pr-check.ts:~1329`). Mirrors the `keyword-hub` precedent (`:1391`); prevents the key re-entering `isFeatureEnabled`/`FEATURE_FLAGS[...]`/`<FeatureFlag>` after removal. Update `docs/rules/automated-rules.md` via `npm run rules:generate`.
2. **Systemic (program-level, recommend separately): dark-launch staleness gate.** Extend `verify:feature-flags` (or a pr-check rule) to FAIL a flag whose `rolloutTarget: 'staging-validation'` has exceeded its `staleAuditCadence` past `lastReviewedAt` without being flipped or removed. This is the mechanized fix for the audit's #1 theme (the value scorer sat dark for weeks; EMV calibration is dark now). Tracks as its own small task, not blocking P1.
3. **Keep-boundary as the contract.** The single most likely regression is over-deleting `computeOpportunityScore`. The plan must state the keep-list (category C) as an explicit invariant and the worker must run the category-E tests unchanged as the guard.

## Parallelization strategy

This is an **atomic single PR** (flag retirement + tests + docs must land together for green CI). Low parallelism by nature — the production edits are interdependent and concentrated in one large file.

### Phase 0 — none (no shared contract to pre-commit; the keep-list is the contract).

### Lane 1 — Production retirement (sequential, single owner)
Files: `server/keyword-command-center.ts`, `server/keyword-strategy-enrichment.ts`, `server/keyword-strategy-ux.ts`, `shared/types/feature-flags.ts`. Collapse accessors, unconditionalize value-first, preserve the gate-failure fallback + `exposeCpc` admin gate, remove the flag key.

### Lane 2 — Test rewrite (after Lane 1 defines behavior; can split across 2 agents)
Owner A: `feature-flags-keyword-hub`, `keyword-value-scoring-content-gaps`, `keyword-command-center-routes`. Owner B: `keyword-command-center.test`, `keyword-strategy-ux.test`, `client-strategy-cpc-tier-gate-public-read`, verify `pr-check.test:596`.

### Lane 3 — Mechanical (parallel with Lane 2)
Deprecation registry, JSDoc "when ON"→"always", `docs/rules/*`, `FEATURE_AUDIT.md`, roadmap, the pr-check retired-flag rule + `rules:generate`.

## Model assignments

| Task | Model | Reasoning |
|---|---|---|
| Production retirement (accessor collapse, unconditionalize, keep-boundary) | Opus / Sonnet | judgment — must preserve gate-failure fallback + score identity (admin Hub ↔ client Strategy) |
| Test rewrite (drop OFF cases, unconditionalize ON) | Sonnet | must understand each assertion's intent |
| pr-check retired-flag rule add | Sonnet | small but must match existing rule shape + `rules:generate` |
| Deprecation registry, JSDoc, docs, roadmap, FEATURE_AUDIT | Haiku | mechanical text edits |
| Verification + orchestration (full DoD gates, score-identity spot-check) | Opus | full-context judgment |

## Verification (P1 DoD)

`npm run typecheck` + `npx vite build` + `npx vitest run` (full suite — the 6 rewritten test files + the untouched category-E tests must all pass) + `npx tsx scripts/pr-check.ts` + `npm run verify:feature-flags` + `npm run verify:coverage-ratchet`. Plus a manual staging eyeball of admin Hub + client Strategy keyword ordering (the re-rank is user-visible). Confirm `computeOpportunityScore` still imported only where category C lists.
