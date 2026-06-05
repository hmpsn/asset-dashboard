# Keyword Value Score Consolidation — Shared Classification Core + Layered Contract

**Date:** 2026-06-05
**Owner:** analytics-intelligence
**Status:** Design approved (distinct layers, shared classification core, no flag); ready for implementation plan
**Baseline:** staging `8f9c7751` (post #1100 "ov-legacy-scorer-cleanup")
**Roadmap keystone:** `kwv-one-score-everywhere` (unblocks the rest of the keyword-value amplification sprint)

---

## 1. Problem

The platform now has **two value scorers** that share the same value DNA but compute and classify it independently:

- **Layer 1 — `computeKeywordValueScore`** (`server/scoring/keyword-value-score.ts`): the Hub's *keyword value* — `(intent × cpc) × demand × winnability × local`, a cheap, drift-free, position-agnostic relative 0–100. Used by the Hub sort + the content-gap spine.
- **Layer 2 — `computeOpportunityValue`** (`server/scoring/opportunity-value.ts`): the *recommendation ROI* — an EMV/ROI model (`emvPerWeek = expectedClickDelta × valuePerClick`, `roiPerEffortDay = … × effort/confidence/calibration`), with explainability components. **As of #1100 it is the *sole* canonical recommendation scorer** (the legacy `pickImpactScore` fallback was removed).

These are the **right** two layers (a keyword's intrinsic worth vs. which action to do next — owner decision: "distinct layers, one contract"). The problem is **duplicated, drift-prone classification of the shared value inputs**, not the output math:

**Four intent→4-bucket paths exist, and two disagree numerically:**
1. `toValueIntent` (`keyword-value-score.ts:83`) — Layer 1: `comparison → 'commercial'` (weight **0.7**), 4-bucket passthrough, else `null`.
2. `toOpportunityIntent` (`recommendations.ts:245`) — Layer 2: 4-bucket passthrough, **`comparison`/unknown/null → null` → `DEFAULT_INTENT_WEIGHT` 0.7→0.5**. No keyword-derivation fallback.
3. An **inline hand-copy** of (2) at `keyword-strategy-enrichment.ts:611`.
4. The regex classifier `classifyLocalKeywordIntent` (`local-seo.ts:1549`, 5-bucket incl. `comparison`) — the de-facto classifier both layers should wrap.

**The concrete drift:** a `comparison`-intent keyword scores intent-weight **0.7 in the Hub** but **0.5 in recommendations** — a 0.2 value-per-click delta on the *same keyword*. It bites on the `ranking_opp` branch where free-form `PageKeywordMap.searchIntent` enters (`recommendations.ts:1482`, `:1539`). (`ContentGap.intent` is already a strict 4-bucket, so `comparison` can't enter there.)

Separately, Layer 1 returns a **bare number** — its value components (commercialValue/demand/winnability/local) are computed then discarded, so there is no single component vocabulary for the breakdown. (The content-gap path also hard-passes `cpc: undefined` into Layer 1 at `keyword-strategy-enrichment.ts:599`, but fixing that is **not** a one-liner — `ContentGap` has no `cpc` field; populating it is the separate `kwv-real-cpc` roadmap item, see §3.)

## 2. Goal

Establish **one shared classification/input core** that both layers consume, and a **formal layered contract** between them — so a keyword's intent/local/cpc can never disagree across the Hub and recommendations, and so the downstream amplification items (`kwv-value-breakdown`, `kwv-real-cpc`, `kwv-one-score-everywhere`) build on a single foundation. Keep each layer's *output* math purpose-built.

## 3. Scope

**In scope (the keystone foundation):**
- One canonical keyword **intent classifier** consumed by both layers; retire `toOpportunityIntent` + the inline copy; close the `comparison` drift.
- A documented, tested **layered contract** (Layer 1 → Layer 2 spine for keyword-bearing branches; surface ownership of which layer renders where).
- A **component-exposure interface** on Layer 1 (so there is one value-component vocabulary), without yet reconciling the two render vocabularies.

**Out of scope (own roadmap items, built on this foundation):**
- The full **breakdown render reconciliation** — Layer 2's 7-row `OpportunityComponent` vocabulary (`OverviewTab` "Why this is #1", seoContext slice, `buildTopOpportunityRationale`, `opportunityComponentSchema`) vs. Layer 1's `KeywordStrategyExplanation` shape (StrategyKeywordDrawer "See the numbers") → **`kwv-value-breakdown`**.
- Re-ranking the consuming surfaces (content-plan, briefs, titles/metas, client briefing) onto the unified definition → **`kwv-one-score-everywhere`** surface work.
- **The content-gap `cpc` input fix** → **`kwv-real-cpc`**. It is NOT a one-liner: `ContentGap` carries no `cpc` field (only volume/difficulty/impressions), so it requires adding `cpc?: number` to `ContentGap`, the `content_gaps` column + mapper, and populating it in the enrichment loop. This keystone establishes the shared input-resolution seam that `kwv-real-cpc` then plugs into; it does not do the fix itself.
- Any change to Layer 2's EMV/ROI/effort/calibration math (the "deep merge" approach ② we rejected).

## 4. The shared intent classifier (primary deliverable)

**Canonical function — reuse the existing `deriveValueIntent`** (`keyword-value-score.ts:102`), which already does what every path should: provided-intent-first (via `toValueIntent`'s `comparison → commercial` + 4-bucket coercion), else the deterministic `classifyLocalKeywordIntent` regex fallback. It is **non-null** by construction (the classifier never emits `navigational`; everything maps to one of the 4 buckets).

```
deriveValueIntent(keyword: string, provided?: string | null): ValueIntent   // already exists, exported
  = toValueIntent(provided) ?? toValueIntent(classifyLocalKeywordIntent(keyword))
```

**Replace every Layer-2 intent coercion with it.** `pm`/`pk` are `PageKeywordMap` (no `keyword` field — the keyword string is `primaryKeyword`, `shared/types/workspace.ts:24`); `cg` is `ContentGap` (`targetKeyword`/`intent`):

| Site | Current | After | Effect |
|---|---|---|---|
| `recommendations.ts:1482` (ranking_opp) | `toOpportunityIntent(pm.searchIntent)` | `deriveValueIntent(pm.primaryKeyword, pm.searchIntent)` | **changes weight** for `comparison`/absent searchIntent |
| `recommendations.ts:1539` (intent-mismatch) | `toOpportunityIntent(pk.searchIntent)` | `deriveValueIntent(pk.primaryKeyword, pk.searchIntent)` | **changes weight** for `comparison`/absent searchIntent |
| `recommendations.ts:1420` (content_gap) | `cg.intent ?? null` | `deriveValueIntent(cg.targetKeyword, cg.intent)` | **value-inert** (see below) |
| `keyword-strategy-enrichment.ts:611` (content_gap inline) | inline 4-bucket coercion | `deriveValueIntent(cg.targetKeyword, cg.intent)` | **value-inert** (see below) |

- **Retire `toOpportunityIntent`** (defined `recommendations.ts:245`) once `:1482`/`:1539` are migrated.
- **Value-inert sites (`:1420`, enrichment `:611`):** `ContentGap.intent` is a *required strict 4-bucket union* and `rowToModel` (`content-gaps.ts:53`) coerces any stray value (incl. `comparison`) to `'informational'` on read — so `comparison` can never reach these sites and intent is never absent. Migrating them is for **single-classifier consistency only** (one code path), with **zero behavior change** — do NOT test them for a `comparison` delta that cannot occur. Only the two `searchIntent`-fed sites (`:1482`/`:1539`) can actually change weight.
- `primaryKeyword` can be `''` (coerced from absent at `page-keywords.ts:206`); `classifyLocalKeywordIntent('')` safely returns `'transactional'` (no throw) — assert this empty case in tests.
- Hardcoded-intent local branches (`recommendations.ts` local service-gap/competitor/not-visible) and no-keyword branches (technical/decay/diagnostic/freshness) are **unchanged** — they classify no keyword.

**Behavior-scope — DECIDED: full-derive (owner, 2026-06-05).** Recs classify intent the **same way the Hub does** (`comparison→commercial` **and** a regex fallback from the keyword when `searchIntent` is absent), instead of defaulting absent/`comparison` to 0.5 — the true "one source of truth." Blast radius is bounded and correctness-positive: only `ranking_opp` recs whose `searchIntent` is `comparison` or missing change weight, on the next strategy regen, verified on staging. (The coerce-only alternative — fix `comparison` only, keep 0.5 for absent — was considered and rejected.)

## 5. The layered contract

- **Layer 1 (keyword value) → Layer 2 (OV) as the grounded spine** for keyword-bearing branches. Already true for content gaps (`keyword-strategy-enrichment.ts:598` Layer-1 `base` → `:605` OV `opportunityScore` spine). This spec **documents and tests** that contract; it does **not** force the spine into branches that legitimately use direct provider deltas (`ranking_opp` CTR-uplift, `ctr_opportunity` direct gap, etc.).
- **Surface ownership (the `one-score` rule, documented here, applied per-surface in `kwv-one-score-everywhere`):** keyword-ranking surfaces (Hub, content-plan, the keyword side of briefs/titles) render **Layer 1**; action/recommendation surfaces (recs, client briefing, ROI) render **Layer 2**. Post-#1100, Layer 2 is the *sole* canonical rec score, so this ownership is now unambiguous.
- **Shared inputs:** intent (§4) and local detection (`isLocalKeyword`, already Layer-1-owned). The keyword's raw `cpc/volume/difficulty/impressions` are read as today; making the content-gap path *carry* a real cpc is deferred to `kwv-real-cpc` (§3) — this keystone only establishes the seam.

## 6. Component-exposure interface

Layer 1 today returns `number | undefined` (`keyword-value-score.ts:210`), discarding `commercialValue/demand/winnability/localMultiplier`. Add a **sibling** `computeKeywordValueComponents(input, ctx): { score: number | undefined; components: ... }`, and make `computeKeywordValueScore` a thin wrapper (`= computeKeywordValueComponents(...).score`) so the **4 existing scalar callers are unaffected** (`keyword-command-center.ts:1418`, `:2278`, `:2553`; `keyword-strategy-enrichment.ts:598`). **Signal-gate behavior must be preserved exactly:** when the gate fails (`keyword-value-score.ts:184`, the early return before any component is computed), the sibling returns `{ score: undefined, components: undefined }` so the wrapper's `.score` is `undefined` byte-for-byte as today — a test must lock this gated-out case. This exposes one value-component vocabulary for `kwv-value-breakdown` to render later — **no render change here**, just the interface.

## 7. Safety model (no feature flag)

- **The extraction is behavior-preserving** except the one intended correction (§4). Proven by a parity test that compares the **full `OpportunityScore`** (value/impactScore **and** the `components` array) plus the rendered `topOpportunityRationale` (`recommendations.ts:596-606`) — because `input.intent` also drives the intent `component`'s `rawValue`/`evidence`/`contribution` (`opportunity-value.ts:315`), which can reorder the top-2 components and change the client-visible rationale string. Byte-identical before/after for every branch, *except* the documented `comparison`/absent-`searchIntent` change (intent weight **and** that component's evidence), which has its own assertion.
- **No new flag.** This respects the existing `keyword-value-scoring` flag (the Hub's Layer-1 OFF→`computeOpportunityScore` fallback at `keyword-command-center.ts:903/2445` is preserved untouched) rather than adding a second flag.
- **Staging verification includes a regen.** OV/rec scores are persisted, so the `comparison` correction only manifests after a strategy regen — the staging test must regen a workspace and confirm the (small) rec reordering, not assume "looks unchanged."
- **Non-goal / #1100 guard:** do NOT re-introduce any legacy scorer path or `pickImpactScore`; OV is the canonical rec score now. Do NOT alter the EMV/ROI/effort/calibration math.

## 8. Testing

- **One-classifier unit tests:** `deriveValueIntent` is the single path; `comparison → commercial` (0.7) in *both* layers; absent `searchIntent` → regex-classified (full-derive); the Hub-vs-recs `comparison` drift is closed (same keyword → same weight on both sides).
- **Cross-layer consistency:** a shared fixture keyword resolves to identical intent/local/cpc feeding both layers; Layer-1 value and the Layer-2 spine move together directionally.
- **OV-output parity (refactor safety):** every `computeOpportunityValue` branch yields a byte-identical **full `OpportunityScore` + `topOpportunityRationale`** pre/post for non-`comparison`, intent-present inputs; the `comparison`/absent-`searchIntent` cases assert the *new* intended values (incl. the intent component's evidence). The value-inert sites (`:1420`, enrichment `:611`) assert **zero** change.
- **Component interface:** `computeKeywordValueComponents(x).score === computeKeywordValueScore(x)` for the same input (incl. the signal-gated `undefined` case); components carry `commercialValue/demand/winnability/local`.
- **Empty keyword:** `deriveValueIntent('', searchIntent)` does not throw and classifies sanely (`primaryKeyword` can be `''`).
- **Gates:** `typecheck` 0 · `vite build` · the touched suites + `recommendations*`/`opportunity-value*`/`keyword-value-score*`/`keyword-command-center*` green · `pr-check` 0.

## 9. Risks & non-goals

- **Stale-grounding guard:** #1100 reshaped `recommendations.ts` (line numbers shifted; legacy branches removed). The plan must re-confirm exact call sites at execution against `8f9c7751`+ (not the pre-#1100 map).
- **Drift hazard if partially migrated:** the weight-changing sites are `recommendations.ts:1482`/`:1539` (the `searchIntent`-fed ones) — leaving either un-migrated re-opens the disagreement. The value-inert sites (`recommendations.ts:1420`, `keyword-strategy-enrichment.ts:611`) move for single-classifier consistency. All four migrate + `toOpportunityIntent` retires **in one commit** (CLAUDE.md cross-cutting-constraint rule). NOTE the file is `server/keyword-strategy-enrichment.ts` (not the unrelated `server/insight-enrichment.ts`).
- **Non-goal:** the breakdown *render* reconciliation, surface re-ranking, and any deep merge of the two output maths — those are their own roadmap items built on this foundation.
- **Blast radius is real but bounded + reversible:** the only output change is rec intent weight for `comparison`/absent-`searchIntent` keywords, visible after regen, verified on staging before `staging→main`.

## 10. Decisions (resolved)

- **Intent behavior: full-derive** (owner, 2026-06-05) — recs classify intent exactly like the Hub (see §4). Coerce-only rejected.
- **Layering:** distinct layers, shared classification core, one contract (approach ①). Deep-merge (②) and pure-contract (③) rejected.
- **Rollout:** no feature flag; behavior-preserving full-object parity + staging regen verification.
