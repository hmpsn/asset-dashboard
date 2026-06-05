# Keyword Value Scoring — Value-First, Posture-Driven Opportunity Score

**Date:** 2026-06-05
**Owner:** analytics-intelligence
**Status:** Design approved (decisions locked); ready for implementation plan
**Builds on:** Keyword Universe Overhaul (`docs/superpowers/plans/2026-06-05-keyword-universe-overhaul.md`, 8 PRs merged to staging @ `c845e233`)
**Baseline:** staging `c845e233` ("Merge pull request #1092")

---

## 1. Problem

The Keyword Hub's `opportunity` sort (now the default sort on load, PR #1091) ranks keywords by a crude
`computeOpportunityScore` (`server/keyword-strategy-helpers.ts:90-108`) that uses **search volume × ease only**:

```
raw = (min(volume/10000,1)·0.45 + (1−difficulty/100)·0.45 + gscBonus·0.1) · trendMult
```

The Hub accessors (`keyword-command-center.ts:855` row, `:2326` candidate) pass **volume (demand, with impressions
as the only fallback) + difficulty** — `computeOpportunityScore`'s own `impressions`/`trendDirection` params are
never supplied, so `gscBonus` and `trendMult` are inert and the score reduces to volume-weighted ease. It has **no
notion of commercial intent, CPC, or local relevance**.

Consequence (owner's example, Swish, a local dental practice): a high-volume **informational** national query
like *"cause of bad breath"* outranks a moderate-volume **transactional local** query like *"teeth cleaning
sarasota"* — even though the latter is far more likely to convert into revenue for a local client.

A full money-model **already exists** — `server/scoring/opportunity-value.ts` computes
`valuePerClick = cpc × intentWeight` (`:285-289`) using the `INTENT_WEIGHT` map (`:68-73`) — but it is wired into
**recommendations/strategy**, never into the Hub's opportunity sort.

## 2. Goal

Replace the Hub's crude opportunity score (and align the content-gap opportunity spine) with a **value-first,
posture-driven keyword value score** that prioritizes the most valuable, highest-converting keywords: commercial
intent + CPC drive the score, search volume is a secondary tiebreaker, and local relevance reshapes the ranking
automatically based on the workspace's local-SEO posture.

## 3. Locked decisions (owner-approved)

| # | Decision | Detail |
|---|----------|--------|
| D1 | **Value-first** | Commercial intent (`transactional`/`commercial`) + CPC are the PRIMARY driver; volume is a secondary signal/tiebreaker. A moderate-volume transactional keyword outranks a high-volume informational one. |
| D2 | **Posture-driven (auto)** | Local weighting auto-scales by `getLocalSeoPosture(workspaceId)`: `local` = strong local boost, `hybrid` = moderate, `non_local`/`unknown` = no local factor (value-first only). No per-client config. |
| D3 | **Scope = Hub sort + content gaps** | The new score drives both the Hub `opportunity` sort AND the content-gap opportunity spine (so strategy/recs/briefing inherit one consistent definition of "valuable"). |
| D4 | **Demote, don't filter** | High-volume informational keywords stay visible (they are not junk), just ranked far below converting terms. Consistent with the Universe "show everything, strip only junk" philosophy. |
| D5 | **Spare national commercial/transactional under local posture** | Local posture demotes only **national-informational** keywords. National transactional/commercial terms (e.g. "invisalign cost") are NOT penalized — a local client still converts on them. |
| D6 | **Dedicated flag** | A new `keyword-value-scoring` flag (default OFF, byte-identical to today when OFF) gates both wirings, independent of the coverage flag (`keyword-universe-full`) and the SEO-gen-quality flag (`relaxConservatism`/P4). |

## 4. Architecture overview

One new pure scoring module, consumed by two surfaces, gated by one flag:

```
server/scoring/keyword-value-score.ts   (NEW — pure, no DB, no workspace lookups)
  ├─ computeKeywordValueScore(input, ctx): number | undefined  ← the score (drop-in shape for computeOpportunityScore)
  ├─ toValueIntent(raw): ValueIntent | null                   ← 5→4 intent adapter (comparison→commercial)
  ├─ deriveValueIntent(keyword, provided?): ValueIntent        ← provided-first, deterministic fallback
  ├─ valueIntentWeight(intent): number                         ← INTENT_WEIGHT lookup, DEFAULT 0.5 on null
  ├─ isLocalKeyword(keyword, ctx): boolean                     ← pure geo/near-me/service predicate
  └─ localRelevanceMultiplier(posture, isLocal, intent): number

  ScoringContext (the request/strategy-level constant): { posture, markets, city, state }
    — built ONCE per request from getLocalSeoPosture + listLocalSeoMarkets + workspace.businessProfile.address.

Consumer A — Keyword Hub sort (server/keyword-command-center.ts)
  • resolveBundleMetrics + populateDraftRows resolve cpc (already) + intent (new) per key — parity-guaranteed
  • RowCandidateKey carries cpc + intent + a precomputed valueScore (new)
  • when flag ON: the value score is computed ONCE per key (candidate merge-back + row finalize, same fn + same
    parity inputs + same ctx) and stored; the opportunity accessor is then a trivial field read (NOT recomputed per
    comparison). When flag OFF: valueScore is never populated and the accessor is today's computeOpportunityScore({volume,difficulty}).
  • gated: isFeatureEnabled('keyword-value-scoring', workspaceId)

Consumer B — Content-gap opportunity score (server/keyword-strategy-enrichment.ts)
  • the persisted cg.opportunityScore (and the grounded spine fed to computeOpportunityValue) becomes
    computeKeywordValueScore({...cg, intent: cg.intent, keyword: cg.targetKeyword}, ctx) when flag ON
  • gated by the same flag; the relaxConservatism/P4 CONTROL FLOW is unchanged — only the score VALUE swaps (see §10)
```

The exported helpers `INTENT_WEIGHT`, `DEFAULT_INTENT_WEIGHT`, and the intent union are reused from
`opportunity-value.ts` (today they are module-private — see §11 task notes).

## 5. The score contract

`computeKeywordValueScore(input, ctx): number | undefined`

**Signal gate first (mirrors `computeOpportunityScore`'s `hasData`).** BEFORE any default-filling, return
`undefined` when the keyword has **no usable raw signal** — i.e. all of: no `volume > 0`, no `impressions > 0`,
`difficulty == null`, `cpc == null`, AND no *provided* intent. (The regex-derived intent does NOT count as
signal — every string yields one, so it must not rescue a metric-less keyword.) This preserves the missing-last
contract: a genuinely data-less row returns `undefined` and sorts last via the existing `compareMetric`
(`keyword-command-center.ts:805-811`). Only after the gate passes do the `DEFAULT_INTENT_WEIGHT` / `CPC_UNKNOWN` /
`difficulty ?? 50` defaults apply.

**Multiplicative-with-floor (commercial value is the dominant factor; demand/winnability are within-tier
tiebreakers).** All factors normalized to `[0,1]`; the only term that may exceed 1 is the local multiplier.

```
commercialValue = valueIntentWeight(intent) × cpcFactor(cpc)              // PRIMARY driver, ∈ (0,1]
demandSignal    = (volume > 0) ? volume : (impressions ?? 0)              // volume:0 (provider-coerced) must not mask real impressions
demand          = min( log10(1 + demandSignal) / log10(1 + DEMAND_REF), 1 )   // secondary
winnability     = 1 − (difficulty ?? 50)/100                              // secondary
tiebreak        = W_DEMAND·demand + W_WIN·winnability                     // ∈ [0,1], W_DEMAND+W_WIN = 1 (0.4 / 0.6)

score = round( min(100, commercialValue × (FLOOR + (1−FLOOR)·tiebreak) × localRelevanceMultiplier(...) × 100) )
```

**Why multiplicative, not additive.** With additive weighting the demand+winnability span (≈0.40) exceeds the
no-CPC commercial-value gap between transactional and informational (≈0.21), so a very-low-difficulty high-volume
*informational* keyword can outrank a high-difficulty *transactional* one — the exact anti-pattern D1 forbids. The
multiplicative-with-floor form makes commercial value gate the ordering: the `(FLOOR + (1−FLOOR)·tiebreak)` term
ranges only `[FLOOR, 1]` (here `[0.5, 1]`), so demand/winnability can at most *double* a keyword's score within
its commercial tier but can never lift a low-value keyword past a high-value one. **Guarantee** (`FLOOR = 0.5`,
no-CPC so both get `cpcFactor = 0.5`): worst-case transactional (`cv 0.50`, tiebreak 0) → `0.50·0.5 = 0.25`;
best-case informational (`cv 0.15`, tiebreak 1) → `0.15·1.0 = 0.15`; `0.25 > 0.15` — transactional with zero
demand/winnability still beats informational with maximal demand/winnability. The same holds for commercial vs
informational (`0.35·0.5 = 0.175 > 0.15`).

**Factor definitions:**

- `valueIntentWeight(intent)` — `INTENT_WEIGHT[intent]` (transactional 1.0 / commercial 0.7 / informational 0.3 /
  navigational 0.2), or `DEFAULT_INTENT_WEIGHT` (0.5) when intent is null/unknown.
- `cpcFactor(cpc)` — `cpc > 0 ? min(cpc / CPC_REF, 1) : CPC_UNKNOWN`. `CPC_REF` ≈ `12`, `CPC_UNKNOWN` = `0.5`
  (mid-band). **Rationale:** CPC is `undefined`/`0` on the majority of Hub rows (§7), so an unknown CPC must map to
  a neutral mid-band — the keyword is then ordered by intent alone — rather than to the model's unbounded "bare
  intentWeight" fallback (which would over-reward the common no-CPC case). This is a deliberate, documented
  divergence from `valuePerClick`'s fallback, appropriate because this is a *relative sort* among mostly-CPC-less
  rows, not an absolute EMV.

**Named constants (single source, in the new module):** `W_DEMAND=0.40`, `W_WIN=0.60` (within-tier tiebreak;
sum to 1), `FLOOR=0.50`, `DEMAND_REF=10000`, `CPC_REF=12`, `CPC_UNKNOWN=0.5`, and the local multipliers in §8. All
tunable later; the calibration infra in `opportunity-value.ts` remains a future upgrade, out of scope here.

### 5.1 Value-first guarantee (worked example)

Swish (local dental, `posture = local`). `cv` = commercialValue; `tier` = `FLOOR + (1−FLOOR)·tiebreak` = `0.5 + 0.5·tiebreak`:

| keyword | intent (source) | cpc | volume | diff | cv | demand | winn. | tiebreak | tier | ×local | **final** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| what causes bad breath | informational (regex: "what " prefix) | — | 22000 | 40 | 0.3·0.5 = 0.15 | 1.00 | 0.60 | 0.76 | 0.88 | ×0.6 | **≈8** |
| teeth cleaning sarasota | transactional (regex default) | $6 | 480 | 30 | 1.0·cpcFactor($6) = 1.0·0.50 = 0.50 | 0.67 | 0.70 | 0.69 | 0.84 | ×1.5 | **≈63** |

`0.15 × 0.88 × 0.6 × 100 ≈ 8` vs `0.50 × 0.84 × 1.5 × 100 ≈ 63`. The commercial-value factor (`0.50` vs `0.15`)
dominates; demand/winnability only modulate within tier. **Even under `non_local` posture** (local multiplier 1.0
for both) the order holds: `13` vs `42`.

> Both keywords here resolve through the **deterministic regex** (`classifyLocalKeywordIntent`), not provided AI
> intent: `"what causes bad breath"` matches the informational question-word prefix; `"teeth cleaning sarasota"`
> matches no comparison/informational/commercial pattern and defaults to `transactional`. (The `cpcFactor($6) =
> min(6/12,1) = 0.50` value coincides with `CPC_UNKNOWN = 0.50` here — different sources, same number at this CPC.)

**Counterexample the formula must survive** (a low-difficulty high-volume informational keyword vs a high-difficulty
transactional one, `non_local`): informational `vol 50000, diff 0` → `0.15 × 1.0 = 0.15 → 15`; transactional
`vol 100, diff 95, $6 cpc` → `0.50 × 0.615 = 0.31 → 31`. Transactional wins — additive weighting would have
inverted this. Pinned as a named regression test (§12).

## 6. Intent resolution contract

Every keyword must resolve to a 4-bucket value intent so it can be weighted. Source of truth, in order:

1. **Provided intent** (preferred) — the AI/provider intent already attached to the keyword's source:
   `ContentGap.intent` (strict 4-bucket union, `shared/types/workspace.ts:79`), `TrackedKeyword.intent` (free
   string, `rank-tracking.ts:37`), `PageKeywordMap.searchIntent` (**note the field name**, `workspace.ts:26`).
2. **Deterministic fallback** — `classifyLocalKeywordIntent(keyword)` (`local-seo.ts:1549`, pure regex, sync),
   for keywords with no provided intent (most GSC ranking keywords).

**The 5→4 adapter (`toValueIntent`) — REQUIRED, net-new.** `classifyLocalKeywordIntent` returns
`LocalSeoKeywordIntent` (`shared/types/local-seo.ts:1`): a **5-value** enum
`{transactional, commercial, navigational, informational, comparison}` that in practice emits
`{comparison, informational, commercial, transactional}` and **never** `navigational`. This does not match
`INTENT_WEIGHT`'s keys. The adapter:

```
toValueIntent(raw):
  'comparison'   → 'commercial'     // comparison shoppers are pre-purchase / commercial intent (design decision D-adapter)
  'transactional'|'commercial'|'informational'|'navigational' → passthrough
  anything else / null / undefined  → null   (caller applies DEFAULT_INTENT_WEIGHT)
```

`deriveValueIntent(keyword, provided?)` = `toValueIntent(provided) ?? toValueIntent(classifyLocalKeywordIntent(keyword))`.
This guarantees a value intent for every keyword; provided AI intent always wins over the regex fallback.

> Note: the existing `toOpportunityIntent` (`recommendations.ts:265`, file-local) is a *coercer* (validates an
> existing string, returns null for `comparison`), not a deriver — it is not reused; the new `toValueIntent`
> supersedes it for this module.

## 7. CPC handling (reality)

CPC reaches a Hub row **only** through `TrackedKeyword.cpc`, populated by bounded URL-level provider enrichment
(`keyword-strategy-enrichment.ts:242…`) reconciled onto tracked keywords (`rank-tracking-reconciliation.ts:126/167`).
Gap/site/siteKeywordMetrics/lostVisibility rows have **no cpc field at all**; DataForSEO coerces absent CPC to `0`
(`server/providers/dataforseo-provider.ts:525/580`). So across the full row set, **cpc is usually `undefined` or `0`**, real
positive CPC only on enriched tracked rows.

Implication: the `CPC_UNKNOWN` mid-band (§5) is the common path, not an edge case. Intent carries the commercial
signal for the majority of rows; CPC is a lift where it exists. The score must be sensible and well-ordered with
intent alone — which the §5.1 example demonstrates.

## 8. Posture-driven local relevance contract

```
localRelevanceMultiplier(posture, isLocal, intent):
  non_local | unknown : 1.0                                  // value-first only
  hybrid  : isLocal → 1.25 ; national-informational → 0.90 ; else 1.0
  local   : isLocal → 1.50 ; national-informational → 0.60 ; else 1.0

national-informational  ≡  !isLocal && intent === 'informational'   // D5: only informational is demoted
```

**Canonical `ScoringContext` shape** (one shape used by every consumer — §4, §9, §10): `{ posture, markets, city,
state }`, where `markets: LocalSeoMarket[]` (from `listLocalSeoMarkets`), and `city`/`state` come from
`workspace.businessProfile?.address` (`workspace.ts:248`). (Note: `LocalSeoMarket` uses `stateOrRegion`, not
`state` — `hasMarketModifier` already reads `market.city`/`market.stateOrRegion` internally; the `ctx.state` is the
*business-profile* state string.)

`isLocalKeyword(keyword, ctx): boolean` — a **pure** predicate (no DB). Geo branch is the explicit OR (mirrors
`hasLocalIntent`'s logic minus the DB read, so it also covers workspaces that have a business address but no
configured markets):

```
isLocalKeyword(keyword, ctx) =
     hasMarketModifier(keyword, ctx.markets)          // near me / local + market city/stateOrRegion match (local-seo.ts:1529, pure)
  || (ctx.city  && normalize(keyword).includes(ctx.city))
  || (ctx.state && normalize(keyword).includes(ctx.state))
  || SERVICE_KEYWORD_RE.test(normalize(keyword))      // the service-keyword regex literal from hasLocalIntent (local-seo.ts:1509):
       // dentist|dental|orthodont|implant|invisalign|veneer|emergency|clinic|lawyer|attorney|restaurant|contractor|plumber|roofing|med spa
```

> `hasLocalIntent` itself is **module-private and not pure** (it does a settings DB read in the service-keyword
> branch — `local-seo.ts:1510`), so it is NOT reused directly. `isLocalKeyword` is a new pure helper that reuses the
> same regex literals without the DB read, keeping the per-keyword scoring path allocation-free and drift-safe.

**Posture is fetched once per request** (`getLocalSeoPosture` does a workspace + settings DB read and may derive
over ≤75 pages — `local-seo.ts:575/585`; documented as once-per-cycle, never per-keyword). The `ScoringContext` is
built once per request and reused for every key.

## 9. Hub wiring (drift-free)

The candidate stage and row stage must produce the **identical** score per key (the Universe overhaul's hard-won
invariant; `__candidateRowMetricParityForTest`, `keyword-command-center.ts:2378`). The score inputs are
`{volume/demand, impressions, difficulty, cpc, intent}` (per-key, parity via `resolveBundleMetrics`) +
`{keyword}` (on both candidate and row) + the `ScoringContext` (a request constant). Because every input is either
resolver-parity-guaranteed or a request constant, the score is drift-free by construction.

**Compute once per key, not per comparison.** `keywordSortComparator` invokes the accessor on every pairwise
comparison (`keyword-command-center.ts:838-842`), so an accessor that *recomputes* the value score (regex + market
scan) would run `O(n log n)` times. Instead the score is computed **once per key** and stored, and the accessor is
a trivial field read. This is both drift-safe (single function, parity inputs) and efficient.

Changes (all server-side):

1. **`shared/types/keyword-command-center.ts:104`** — add `intent?: string` to `KeywordCommandCenterMetrics`
   (`cpc?` already exists). `mergeMetricsInto` is spread-over-entries (`keyword-command-center.ts:240-257`), so
   once `intent` is on the interface and passed into a `merge(...)` call it propagates with no merge-fn edit.
2. **`resolveBundleMetrics` (`:2188`) + `populateDraftRows` (the row stage)** — merge `intent` from the sources in
   **both** stages symmetrically, **in the same source order** (pageMap → contentGaps → trackedKeywords, so
   last-writer-wins resolves identically): `trackedKeywords` → `keyword.intent` (`:2234/1159`), `pageMap` →
   `page.searchIntent` (currently only `{volume,difficulty}` merged — add intent), `contentGaps` → `gap.intent`.
   `cpc` is already merged in both stages from `trackedKeywords`; do not add `pageMap.cpc` to only one side or it
   reintroduces drift.
3. **`RowCandidateKey` (`:1940-1951`)** — add `cpc?: number`, `intent?: string`, and `valueScore?: number` (the
   precomputed score; `undefined` when the signal gate returns no score).
4. **Candidate merge-back (`:2164-2172`)** — add `candidate.cpc = metrics.cpc`, `candidate.intent = metrics.intent`,
   and (flag-ON only) `candidate.valueScore = computeKeywordValueScore({demand/volume, impressions, difficulty,
   cpc, intent}, ctx)` (today copies only demand/clicks/rank/difficulty). The matching row-side compute happens in
   the row finalize where `row.metrics` is assembled, via the **same** function + the same `ctx`.
5. **Opportunity accessor selection** — when the flag is ON, the `opportunity` accessor for **both** stages reads
   the precomputed `valueScore` (a field read — and `undefined` flows through as missing-last); when OFF, it is
   today's `computeOpportunityScore({volume, difficulty})`. The selection is by the request flag (a one-line
   conditional at the sorter dispatch), not a per-accessor recompute — this avoids a `buildSortAccessors` factory
   entirely. Storing the score on the row likewise needs a transient `valueScore` carrier on the working row object
   (the plan picks the exact field; it need not be exposed on the public API row type).
6. **`buildKeywordCommandCenterRowsSkinny` (`:2698`) and `buildKeywordCommandCenterRowsViaModel` (`:2665`, dispatched
   at `:2791`)** — build the `ScoringContext` once (`getLocalSeoPosture(workspace.id)`,
   `listLocalSeoMarkets(workspace.id)`, `workspace.businessProfile?.address`), read the flag once
   (`isFeatureEnabled('keyword-value-scoring', workspace.id)`), and thread both into the candidate + row build.
7. **Extend `__candidateRowMetricParityForTest` (`:2378`)** to assert `cpc`/`intent`/`valueScore` parity per key.
   **Critical fix for the test itself:** today its row side calls only `populateDraftRows` while the real skinny
   path also calls `ensureLocalVisibilityRows(rows, localVisibility)` (`:2729-2730`); with a non-zero `valueScore`,
   a localVisibility-only key would exist on the candidate side but be absent on the row side, yielding a false
   pass/fail. The test must (a) call `ensureLocalVisibilityRows` on the row side to match production, and (b) assert
   the candidate/row **key sets are equal** (not only per-key values) so a future one-sided source addition fails loudly.

The Hub already defaults to the `opportunity` sort key (PR #1091); no client change is needed — only the
server-side score computation changes.

## 10. Content-gap wiring (contained)

The content-gap opportunity score is computed in `keyword-strategy-enrichment.ts:572-600`, which has **three**
`computeOpportunityScore(cg)` call sites across two `relaxConservatism` (SEO-gen-quality **P4**) branches:
- **`:577`** — P4-ON: the *grounded spine* fed as the `opportunityScore` input into `computeOpportunityValue(...)`.
- **`:593`** — P4-ON: the `ov.value > 0 ? ov.value : computeOpportunityScore(cg)` fallback when the OV value is 0.
- **`:595`** — P4-OFF: the directly-persisted `cg.opportunityScore`.

The persisted `cg.opportunityScore` then flows to recommendations (`recommendations.ts:1521-1523`, which re-feeds it
as the OV `opportunityScore` input), briefing (`briefing-candidates.ts:239`, `briefing-client-projection.ts:67`),
and public content (`server/routes/public-content.ts:191`).

**Change — gate the score's *definition*, in one place.** Compute the base score once at the top of the per-gap
loop: `const base = isFeatureEnabled('keyword-value-scoring', workspaceId) ? computeKeywordValueScore({ volume:
cg.volume, difficulty: cg.difficulty, cpc: undefined, intent: cg.intent, keyword: cg.targetKeyword }, ctx) :
computeOpportunityScore(cg)`. Use `base` at **all three** sites (`:577` spine input, `:593` fallback, `:595` OFF
write) so the P4-ON and P4-OFF paths use a consistent score. `ctx` is built once per strategy-gen
(`getLocalSeoPosture(workspaceId)` + `listLocalSeoMarkets` + `businessProfile.address`). `ContentGap` carries no
`cpc`, so `cpc` is always `undefined` here (intent + local relevance drive it).

**Behavior matrix:**
- our-flag **OFF** (any P4 state): `base = computeOpportunityScore(cg)` at every site → **byte-identical to today**.
- our-flag **ON**, P4-OFF: `cg.opportunityScore = base` (value-first score) — the only change is a more valuable score.
- our-flag **ON**, P4-ON: the value-first `base` becomes the OV grounded-spine input; OV's EMV math is unchanged.

**Non-entanglement (the real boundary):** the `relaxConservatism`/P4 **control flow** and `computeOpportunityValue`'s
**code path** are unchanged — we only change the score *value* fed in. We do NOT claim recs are byte-identical when
our flag is ON: by design (D3) the rec/briefing **outputs** inherit the new value-first score magnitude — that is
the point of including content gaps in scope. The `?? computeOpportunityScore(...)` *fallback* sites in
briefing/public-content (and `keyword-strategy-helpers.ts:158`) are left as-is — they only fire for gaps persisted
before this change and are not value-first-critical; touching them widens the blast radius for no user-visible gain.

## 11. Flag specification

A new flag requires **three coordinated edits** in `shared/types/feature-flags.ts` (the catalog is typed
`Record<FeatureFlagKey, …>`, so a missing entry is a compile error, and `assertFeatureFlagGroupingConsistency`
throws at import if grouping is inconsistent):

1. `FEATURE_FLAGS` (`:12`) — `'keyword-value-scoring': false`.
2. `FEATURE_FLAG_CATALOG` (`:119`) — a `FeatureFlagCatalogEntry` whose 7 lifecycle fields are **nested under a
   `lifecycle:` object** (not flat — siblings of `label`/`group` would be a typecheck error):
   ```ts
   'keyword-value-scoring': {
     label: 'Keyword Hub — value-first opportunity scoring (commercial intent + CPC + posture-driven local)',
     group: 'Keyword Hub',
     lifecycle: {
       owner: 'analytics-intelligence',
       createdAt: '2026-06-02',          // match the existing Keyword Hub cohort date (see roadmap-link note)
       rolloutTarget: 'staging-validation',
       removalCondition: 'Remove after value-first scoring is validated on staging and becomes the default; the crude computeOpportunityScore Hub path is then deleted.',
       linkedRoadmapItemId: 'keyword-value-scoring',   // or 'keyword-universe-overhaul'
       staleAuditCadence: 'weekly',
       lastReviewedAt: '2026-06-02',
     },
   },
   ```
3. `FEATURE_FLAG_GROUPS` (the `'Keyword Hub'` bucket `keys[]`, `:268`) — add `'keyword-value-scoring'`.

**Roadmap link:** add a new sprint item `keyword-value-scoring` to `data/roadmap.json` (preferred, for a distinct
removal track), or reuse `keyword-universe-overhaul` (already present, `roadmap.json:20`). `verify:feature-flags`
(`scripts/feature-flag-lifecycle.ts`) fails if `linkedRoadmapItemId` is absent or dates are non-ISO/in the future
**relative to the pinned audit `asOf` horizon** — the existing Keyword Hub entries deliberately use `2026-06-02`
(not the commit day) for exactly this reason, so this flag matches that cohort date rather than `2026-06-05`.

**Read:** server `isFeatureEnabled('keyword-value-scoring', workspaceId)` (`server/feature-flags.ts:147`) — both
wirings are server-side; no client `useFeatureFlag` is needed. Per-workspace overrides resolve via the
`workspaceId` argument (the owner flips per-workspace on staging).

## 12. Testing strategy

- **Unit — score (`keyword-value-score.ts`):** value-first ordering (transactional-modest-volume > informational-
  huge-volume, no-CPC); **the §5.1 counterexample** (low-difficulty high-volume informational < high-difficulty
  transactional) — the case additive weighting fails; unknown-CPC falls back to mid-band intent ordering; known high
  CPC lifts a transactional keyword above a same-intent low-CPC one; within-tier, demand/winnability order two
  same-intent keywords; **signal gate** returns `undefined` for a fully data-less, no-provided-intent input (and a
  regex-derived intent does NOT rescue it); bounded 0..100.
- **Unit — intent adapter:** `toValueIntent('comparison') === 'commercial'`; 4-bucket passthrough; unknown → null →
  `DEFAULT_INTENT_WEIGHT`; `deriveValueIntent` prefers provided over regex; GSC keyword with no provided intent gets
  a classified one.
- **Unit — `isLocalKeyword`:** near-me / market-city match (positive), service-keyword regex hit (e.g.
  `'invisalign'`, positive), business-profile city substring (positive), a national non-service term (negative);
  assert it performs **no DB read** (pure / allocation-free per §8).
- **Unit — posture multipliers:** each posture × {isLocal, national-informational, national-transactional} cell of
  §8; `non_local` is a strict no-op (multiplier 1.0); D5 (national transactional NOT demoted under local).
- **Named regression:** *"what causes bad breath"* (regex→informational) vs *"teeth cleaning sarasota"*
  (regex→transactional) under `local` posture — sarasota ranks far above; and under `non_local` posture — sarasota
  still ranks above (value-first alone). Both resolve via the regex fallback, no provided intent.
- **Drift parity:** candidate `valueScore` == row `valueScore` per key on real data paths, small `pageSize`; extend
  `__candidateRowMetricParityForTest` to cover cpc/intent/`valueScore` **and** call `ensureLocalVisibilityRows` on
  the row side + assert candidate/row key-set equality (§9.7).
- **Integration — flag on/off:** Hub default-sort order changes under flag ON; **byte-identical** rows + order +
  scores when OFF. Content-gap `opportunityScore` reorders under flag ON; identical when OFF (independent of P4).
- **Flag hygiene:** `npm run verify:feature-flags` passes; typecheck/build green; `report-style-drift` (no UI
  changes expected, but run it).

## 13. Risks & non-goals

- **Non-goal:** do NOT modify `computeOpportunityValue`, the `INTENT_WEIGHT` weights, the `relaxConservatism`/P4
  control flow, or the calibration/learning infra. This change introduces a value-first score and wires it into the
  Hub sort + content-gap spine, not a new money model.
- **Formula must guarantee value-first, not just weight toward it.** The score is **multiplicative-with-floor** (§5),
  not additive — additive weighting was rejected because the demand+winnability span can override the no-CPC
  commercial-value gap (a low-difficulty high-volume informational keyword outranking a high-difficulty
  transactional one). The multiplicative floor caps demand/winnability to a within-tier modulation.
- **Drift hazard:** feeding cpc/intent/posture into one stage but not the other breaks the parity invariant and its
  guard test. Mitigation: resolver-level parity for cpc/intent + a request-constant `ScoringContext`; the score is
  precomputed once per key by a single function; extended parity test that also fixes the test's own
  candidate/row key-set asymmetry (§9.7).
- **Intent field-name trap:** `PageKeywordMap.searchIntent` (not `.intent`) — a naive `source.intent` silently
  misses pageMap. Enumerated explicitly in §9.2.
- **`navigational` is unreachable** from the deterministic classifier (it never emits it). Acceptable: provided AI
  intent supplies `navigational` where it matters (rare on Hub keywords); the fallback's absence of it only means
  navigational queries default to `transactional` (the classifier's default), a conservative over-value, not a
  bug. Documented.
- **`comparison → commercial`** is a product decision (D-adapter); revisit if comparison queries prove
  lower-converting in practice.
- **CPC sparsity** (§7) is the reason intent dominates; if richer CPC coverage lands later, `CPC_REF` may want
  retuning.

## 14. For owner review

One scope question to confirm during spec review (does not change the locked decisions):

- **Content-gap depth (D3 + §10):** the plan swaps only the *spine value* at the content-gap score sites,
  flag-gated and byte-identical when OFF, leaving the `relaxConservatism`/P4 money-model flow untouched. The
  alternative (route content gaps fully through a value-first `computeOpportunityValue` always-on) would entangle
  this with the SEO-gen-quality rollout — explicitly avoided here. Confirm the contained approach is right, or say
  if you want content gaps left entirely alone for now (Hub-only), deferring §10.
