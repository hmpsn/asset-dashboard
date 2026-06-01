# Unified Opportunity Value Model — Recommended Design (2026-05-31)

> **What this is.** A single re-architecture proposal for the Insights Engine's recommendation intelligence: one shared, data-grounded **Opportunity Value** model that the whole platform computes once and every surface (ranked queue, client `#1` card, public serializer, AI advisor) reads from the same object. World-class = **grounded** (built from data we already pay SEMrush/DataForSEO for), **timely** (re-ranks when the world changes), **self-correcting** (learns from real outcomes), **explainable** (the advisor recites the exact numbers the client sees).
>
> **How it was chosen.** A 4-design architect panel (D1 economic/value-purist, D2 migration-safety/strangler-fig, D3 event-driven/timing-first, D4 advisor-coherence/explainability) was scored by 3 judges across 6 dimensions. **Base = D2** (won 2 of 3 judge votes, highest total 162; its keystone — *the cutover is a no-op at every consumer boundary* — collapses the migration risk surface to one pure function behind one flag, the binding constraint for 2 live paying clients). **Grafted in:** D1's dollar-denominated EMV core, grounded-beats-ungrounded invariant, and recoverability-weighted decay; D4's self-describing component breakdown + calibrated weights + the precise public-serializer fix; D3's typed event ledger + decaying-Timing multiplier on verified debounce infrastructure. Contradictions were resolved in favor of (1) closing all 5 spines, (2) safe landing for 2 live clients, (3) platform-law fit. (Judge tally: D2 162/2 wins · D4 154/1 · D1 142 · D3 140.)
>
> **Read-only / design-only.** No source was modified. Every current-state claim below was independently re-verified against working-tree source at git tip `08d30739` (the audit tip). One citation correction vs. the panel: the feature-flag *catalog/groups/assert* the designs cite as `feature-flags.ts:339/798` actually live in **`shared/types/feature-flags.ts`** (server `feature-flags.ts` is only the 138-line resolver); both are cited correctly throughout.

---

## 1. Executive summary

**North star.** The client always sees the single highest-expected-value action *right now*. Today they cannot: every producer invents its own magic-constant scale (`computeImpactScore` 60/35/15 at `recommendations.ts:586`; quick-win 75/55/35 at `:1118`; content-gap 65/45/25 at `:1163`; ranking-opp flat 60/40 at `:1234`; freshness `impressions/50` at `:1514`), they all compete on one `impactScore` sort axis (`sortRecommendations`, `recommendations.ts:518-541`), and the genuinely grounded composites the platform already computes and persists — `roiScore = volume·(1−KD/100)/position` (`keyword-strategy-enrichment.ts:798`, persisted `ORDER BY roi_score DESC` at `quick-wins.ts:81`), the trend-weighted `opportunityScore` (`keyword-strategy-helpers.ts:74-92`, persisted `ORDER BY opportunity_score DESC` at `content-gaps.ts:97`), and `adjustKdImpactScore` authority-vs-KD (`authority-context.ts:32`) — are *discarded* at the one surface that sets `topRecommendationId` (`roiScore` appears zero times in `recommendations.ts`). The set is also a frozen, regen-gated snapshot: detected NOW-events (competitor overtake, rank decline, decay) never re-rank it.

**Chosen architecture.** One pure function, **`computeOpportunityValue(input): OpportunityScore`**, that every producer branch calls instead of inventing a scale. Internally it computes a **dollar-denominated Expected Monetary Value** — `EMV/week = expected click-delta × value-per-click`, discounted by a **Confidence** provenance factor (grounded → 1.0, LLM-adjective → ~0.5) and a per-workspace **OutcomeCalibration** (realized-$/predicted-$, learned from `action_outcomes.attributed_value`, migration 106), divided by **EffortDays** — and emits both a sortable `value` and a **self-describing component breakdown**. The model writes to the **same `impactScore` field on the same `Recommendation` shape** (D2's keystone), so `sortRecommendations`, `topRecommendationId`, the client `#1` card, the React Query key, and the WS event need **zero changes**; the new value flows through the existing path. A **typed `opportunity_events` ledger + decaying-Timing multiplier** makes the queue re-rank on decay/competitor/rank-drop/publish/seasonal events via the existing `debounceBridge` and `RECOMMENDATIONS_UPDATED` broadcast. The whole thing ships strangler-fig: dual-scorer shadow, divergence logging, flag ladder, validated on the 2 live workspaces before any flip.

---

## 2. The Opportunity Value model

### 2.1 Canonical formula

`computeOpportunityValue` lives in a new pure module `server/scoring/opportunity-value.ts` (side-effect-free, fully unit-testable). Every rec-producing branch builds a typed `OpportunityInput` and calls it; the function is producer-agnostic.

```
clickDeltaPerWeek   = expectedClickDelta(input)          // type-specific, grounded — §2.2
valuePerClick       = cpc × intentWeight                  // OR intentWeight-only when CPC null — §2.3
emvPerWeek          = clickDeltaPerWeek × valuePerClick   // $/week (the economic quantity)

confidence          = provenance(input)                   // 0.4–1.0 — §2.4 (LLM demoted to here)
calibration         = outcomeCalibration(input, ws)       // 0.75–1.25, identity day-one — §2.5
businessFit         = 1.0 + 0.5 × semanticAlign(input, effectiveBusinessPriorities)  // 1.0–1.5

roiPerEffortDay     = (emvPerWeek × HorizonWeeks × businessFit × confidence × calibration)
                      ÷ effortDays                         // INTERNAL sort quantity

value (0–100)       = normalizeToScore(roiPerEffortDay, ws)   // → written to impactScore — §2.6
```

**Design decision (resolves the D1-vs-D2 axis contradiction):** the *internal* quantity is D1's dollar-denominated `roiPerEffortDay`. The *persisted, sorted-by* field stays D2's `impactScore` (0–100), produced by `normalizeToScore`. This keeps the consumer boundary a no-op (no new `ORDER BY roi_per_effort_day` server path, the heaviest part of D1's migration that both safety judges flagged) **and** gives a real, commensurable economic value underneath. The dollars surface as an *explainable evidence band* (§7), not as the raw sort axis — avoiding D1's "dollar overconfidence" and null-CPC-collapse risk while keeping its economic rigor.

### 2.2 ExpectedClickDelta — every term mapped to a grounded field

`expectedClickDelta` is type-specific but always grounded, using the **CTR-by-position uplift** model (a striking-distance keyword's value reflects real click economics, not a position bucket). `CTR(pos)` is **calibrated per-workspace from the workspace's own GSC `position→CTR` history** (we already store per-keyword `{clicks, impressions, position}` — `gscKeywords` at `shared/types/workspace.ts:32`); a documented industry fallback curve is used only until ≥N GSC observations exist, and the chosen curve source is logged as evidence (this prevents the CTR curve from becoming new ungrounded magic — D1's own flagged risk).

| Producer branch (current magic site) | Grounded ExpectedClickDelta | Inputs (file:line) |
|---|---|---|
| **Quick-win** (`recommendations.ts:1118`, 75/55/35) | `volume × (CTR(targetPos) − CTR(currentPos)) × P(win)`. **Consumes `roiScore`** (`keyword-strategy-enrichment.ts:798`) as the grounded spine; `roi_score` from `quick-wins.ts:81`. `P(win)` from `classifyKdGap`→`KD_SCORE_MULTIPLIER` {0.6,0.8,1.0,1.2} (`authority-context.ts:20-30`). | `volume`,`currentPosition`,`difficulty` on `QuickWin`/`pageMap` (`workspace.ts:34-36`) |
| **Ranking-opp** (`recommendations.ts:1234`, flat 60/40; volume **never read**) | Same CTR-uplift form. **Now reads `pm.volume`** (currently unread in `1226-1275`) and routes `pm.difficulty` through `adjustKdImpactScore` — closes Q2/CC2 (today authority touches only the content-gap branch at `:1166`). | `pm.volume`,`pm.currentPosition`,`pm.difficulty`,`pm.impressions` |
| **Content-gap** (`recommendations.ts:1163`, 65/45/25) | **Consumes `opportunityScore`** (`content-gaps.ts:97`, `keyword-strategy-helpers.ts:74-92`) as grounded spine: `clickDelta = (opportunityScore/100) × volume × CTR(targetPos)`. `trendDirection` flows in for free (seasonality). | `cg.opportunityScore`,`cg.volume`,`cg.trendDirection`,`cg.difficulty` |
| **Decay** (`recommendations.ts:1335`, `60+previousClicks/50`) | **Recoverability-weighted, not loss-magnitude** (graft from D1, fixes IW6): `clickDelta = (previousClicks − currentClicks) × recoverability`, where `recoverability = f(currentPosition, classifyKdGap(difficulty,authority), cause)` and *cause* distinguishes competitor-overtake (recoverable) from market-wide collapse (not). `isRepeatDecay` (`content-decay.ts:39,206`) sets `recoverability ×= 0.4` **and switches tactic** — closes MW5. | `dp.previousClicks`,`dp.currentClicks`,`dp.currentPosition`,`dp.isRepeatDecay` |
| **Technical/audit** (`recommendations.ts:586`, 60/35/15 +20; site-wide 80/50 at `:1052`) | `clickDelta = trafficScore_normalized × severityLift`, where `severityLift` is the one surviving heuristic, **Confidence-flagged and bounded so it cannot outrank a grounded commercial opportunity** (fixes Q1). | `trafficScore`,`maxTrafficScore`,`severity`,`isCritical` |
| **Freshness** (`recommendations.ts:1514`, `impressions/50`) | `clickDelta = impressions × CTR-gap`, gated on **real content-age + decay evidence** (not analysis-date age), reconciled against decay to avoid double-counting (fixes IW7). | `d.impressions`,`d.daysSinceLastAnalysis` |

### 2.3 ValuePerClick — the commensurating unit (Intent dimension)

`valuePerClick = cpc × intentWeight`, with a strict priority ladder:
1. **`cpc`** — exists on the keyword type (`shared/types/workspace.ts:36`) but is **never read today**. Used as the value-per-click proxy *gated on a live-population audit* (see §8): if CPC is mostly null on the 2 live workspaces, the ladder degrades to (2).
2. **Intent multiplier** from `ContentGap.intent` / `PageKeywordMap.searchIntent`: transactional 1.0 / commercial 0.7 / informational 0.3 / navigational 0.2.
3. **`conversionMap`** (`recommendations.ts:923`) applied to *all* branches (today only technical).

This is the term that lets a transactional keyword legitimately beat a higher-volume informational one — the rubric's Intent/commercial-value dimension, which no current scorer honors.

### 2.4 Confidence — LLM label demoted to a provenance discount

`confidence = f(provenance)`: grounded provider metric → 1.0; computed composite (`roiScore`/`opportunityScore`) → 0.95; LLM adjective (`qw.estimatedImpact`, `cg.priority`) → 0.5; pure heuristic fallback → 0.4. The LLM `high/medium/low` is **no longer a score** — it is a Confidence-discounted *fallback EMV* used only when `volume`/`cpc`/`position` are null, plus a within-tier tiebreaker.

> **The grounded-beats-ungrounded INVARIANT** (graft from D1, the sharpest statement of the Q6/CC1/IW1/MW1 root cause): *a grounded opportunity can never rank below an ungrounded one of equal raw EMV.* A `roiScore`-140 striking-distance win can no longer sink below a `roiScore`-8 page the LLM called "high". This is enforced as a **pass/fail shadow-validation gate** (§7): asserted in 100% of shadow runs before any flip.

### 2.5 Per-workspace OutcomeCalibration — self-correcting, safe day-one

Reuse and extend `buildOutcomeAdjustment` (`outcome-learning-default-path.ts:44`), which already returns a `[0.75,1.25]`-clamped multiplier from win-rate-by-action-type (±14% factors, `:29-40`) and win-rate-by-difficulty (±12%, `:36-42`), gated on `learnings.availability === 'ready'` (returns identity `1.0` otherwise, `:47-49`).

- **Extend win-RATE → realized-$ ratio** (graft from D1): `calibration = clamp[0.75,1.25]( median(attributed_value_realized / EMV_predicted) )` per `(actionType, difficultyBucket)`, sourced from `action_outcomes.attributed_value` (migration `106-action-outcome-value.sql`, written by `recordOutcome` at `outcome-tracking.ts:286-312`).
- **Drive it through ALL branches**, not just ranking-opp/content (today `applyRecommendationOutcomeAdjustment` is called per-branch with varying args). The single `computeOpportunityValue` makes this uniform.
- **Bootstraps at identity** (1.0) until ≥N outcomes — so the flip is safe with zero history (matches today's CC5 behavior; the win is structural readiness now, measurable self-correction in ~1 outcome cycle).
- **Retires the static `estimatedGain` strings** (`recommendations.ts:69-108`, the "could recover 15-30%" constants — Q7): `estimatedGain = emvPerWeek × HorizonWeeks` in the page's own dollars, OR the per-action-type **median realized gain** from `attributed_value` once available.

### 2.6 normalizeToScore — preserving the no-op boundary

`value = normalizeToScore(roiPerEffortDay, ws)` maps the internal ROI quantity onto the existing 0–100 `impactScore` range via per-workspace percentile (against the workspace's own rec distribution). **Known limitation (accepted, flagged):** a "70" means different absolute things across the 2 clients — fine for per-client ranking (all `topRecommendationId` needs), breaks cross-workspace comparison. The *dollars* (`emvPerWeek`) carry the absolute meaning and travel in the component breakdown for explainability. A **low-effort floor**: to prevent `roiPerEffortDay` from sweeping the `#1` slot with 30-second title fixes pre-calibration (D1's flagged cold-start risk), a minimum `emvPerWeek` floor gates eligibility for the `#1` card — checked in shadow before flip.

---

## 3. Data contract

### 3.1 OpportunityScore shape (self-describing — graft from D4)

New shared type in `shared/types/recommendations.ts`. **Authority-layered (CLAUDE.md:254):** exactly one resolved field is added; `impactScore` becomes a *derived read* of `opportunity.value` (kept as the existing field name so sort/summary/cache-key/WS-event are untouched). **No `formatOpportunityForPrompt(raw)` helper is shipped** — the advisor injects `opportunity` directly (the pr-check rule at `scripts/pr-check.ts:1166` mechanically blocks the helper; the blessed precedent is `effectiveBrandVoiceBlock`, `formatters.ts:288` / CLAUDE.md:254).

```ts
export interface OpportunityComponent {
  dimension: 'demand'|'winnability'|'intent'|'effort'|'businessFit'|'timing'|'evidence';
  rawValue: number | string | null;   // e.g. volume 2400, position 7, "transactional"
  normalized: number;                  // 0..1
  weight: number;                      // calibrated W.* (from workspace_opportunity_weights)
  contribution: number;                // weight × normalized (for the bar)
  evidence: string;                    // one-line "why" the advisor recites verbatim
}

export interface OpportunityScore {
  value: number;                       // 0..100 — derived into impactScore
  emvPerWeek: number;                  // $/week — the economic quantity (D1 core)
  roiPerEffortDay: number;             // internal ROI quantity
  confidence: number;                  // 0..1 — LLM demotion lands here
  calibration: number;                 // 0.75..1.25 per-workspace
  groundedSpine: 'roiScore'|'opportunityScore'|'computed';
  components: OpportunityComponent[];   // self-describing breakdown
  calibrationVersion: string;          // weights-row version → stable client-visible contract
  modelVersion: string;                // 'ov-1' — shadow diffing / A-B
}
```

`Recommendation` gains **one** field: `opportunity?: OpportunityScore` (optional for legacy rows). `impactScore` stays as today's field, set from `opportunity.value` during/after cutover. `RecommendationSet.summary` gains `topOpportunityRationale: string` (the `#1`'s breakdown rendered once).

### 3.2 Migrations (DB column + mapper lockstep — CLAUDE.md:261; one commit each)

Latest existing migration is `106-action-outcome-value.sql`, so new files are 107+. Each migration commit ships **all** of: migration SQL + row interface + `rowToX()` mapper + write path (`upsertX`/`saveRecommendations`) + **`public-portal.ts` serialization list if client-facing** + Zod schema (`.optional()` for fields absent on legacy rows).

- **M107 `recommendations.opportunity_json TEXT`** (+ `model_version TEXT`). Dark-launched: *written but unread* until the flag flips. Touches: SQL, `RecommendationRow`, `rowToRecommendation`, `saveRecommendations` write path, the public serialization list, and `opportunityScoreSchema` (Zod, every nested field `.optional()`).
  - ⚠️ **As-built (PR2): NO migration.** `recommendation_sets` stores recs as a `.passthrough()` JSON blob, so `opportunity` round-trips inside each rec with no column; this M107 spec assumed a per-rec relational table that does not exist. PR2 shipped `opportunityScoreSchema` validation (`.optional().catch(undefined)`) instead, and dropped the set-level `model_version` column (per-rec `opportunity.modelVersion` carries it; PR4's `ov_divergence` table is self-contained). See plan PR2 note.
- **M108 `opportunity_events`** ledger `{ id, workspace_id, type, page_path, keyword, boost, half_life_days, detected_at, source, payload JSON }` + row interface + `rowToOpportunityEvent` + `upsertOpportunityEvent` + Zod. The new event primitive (§5).
- **M109 `workspace_authority`** `{ workspace_id, referring_domains, authority_strength, captured_at }` — persists `backlinkProfileToAuthorityStrength` (`authority-context.ts:50`, the real backlink signal, today wired only to prose) to replace the `organicKeywords`-count proxy (`resolveDomainStrength`, `recommendations.ts:866-868`) — closes CC3 with data.
- **M110 `keyword_monthly_volumes`** `{ workspace_id, keyword, month, volume }` — persists the raw 12-month series currently *dropped* after `trendDirection()` consumes it (`seo-provider-signals.ts:6`), enabling real seasonality timing (the one genuinely-missing field).
- **M111 `workspace_opportunity_weights`** `{ workspace_id PK, seven weights, calibration_version, updated_at }` (graft from D4) — calibrated per-dimension weights, default platform values, monthly ridge-nudge toward the outcome-predictive mix, clamped ±15%, audit-logged. `getOrCreate` returns non-nullable.

### 3.3 Slice fields (Slice architecture — CLAUDE.md:180)

Add to `shared/types/intelligence.ts` interfaces AND the corresponding `assemble*` functions; consume only via `buildWorkspaceIntelligence()`:
- `SeoContextSlice.quickWins[]` with `roiScore` (closes SI1).
- `SeoContextSlice.strategy.contentGaps[]` enriched with `opportunityScore` + `trendDirection` (closes SI2).
- `SeoContextSlice.cannibalizationIssues[]` from `listCannibalizationIssues` (closes SI4).
- `SeoContextSlice.topOpportunity: { recommendationId, value, emvPerWeek, components }` — the resolved `#1` (closes the advisor-coherence gap).

---

## 4. The 5 spines

### Spine A — Unified scoring
**Design.** One `computeOpportunityValue` (§2) replaces the 5 magic scales; `roiScore`/`opportunityScore`/`adjustKdImpactScore`/`cpc` become *consumed inputs*; the LLM adjective is demoted to a Confidence discount governed by the grounded-beats-ungrounded invariant. Every constant either traces to a grounded field or carries a calibration path (no new magic).

| Closes | How | Residual gap |
|---|---|---|
| Q1, Q2, Q3, Q6, IW1, IW2, IW6, IW7, CC1, CC2, MW1, MW2 | Single ROI/EMV axis; grounded composites consumed; KD-authority on all branches; recoverability-weighted decay; CTR-gap freshness | CTR-by-position curve is itself a model — must calibrate from workspace GSC, not hard-code (mitigated by per-ws calibration + logged fallback); EffortDays {0.5,2,5} invented until outcome time-to-measure calibrates it |

### Spine B — Event-driven
**Design.** Typed `opportunity_events` ledger (M108) + a new decay cron + 5 detectors fan into one debounced `enqueueOpportunityRegen`; **Timing is a first-class decaying multiplier** raising `emvPerWeek`/horizon, not a tier label (§5).

| Closes | How | Residual gap |
|---|---|---|
| Q4, Q5, MW3, MW5, SI5 | Decay cron (none exists today — `analyzeContentDecay` runs only on admin POST, `routes/content-decay.ts:26`); competitor/rank-drop/publish/seasonal detectors → event ledger → debounced re-rank | Seasonal events need ≥1yr `keyword_monthly_volumes`; boost/half-life constants need outcome calibration (shipped behind own flag, shadow-logged, bounded so Timing can't hijack `#1` pre-calibration) |

### Spine C — Self-calibrating
**Design.** Extend `buildOutcomeAdjustment` from win-rate to realized-$/predicted-$ calibration (§2.5); calibrated `workspace_opportunity_weights` (M111); `isRepeatDecay` tactic-switch; real referring-domains authority (M109); dollar-grounded `estimatedGain`.

| Closes | How | Residual gap |
|---|---|---|
| CC3, CC5, Q7, MW5 | Realized-$ calibration; ridge-nudged weights; `attributed_value`→`estimatedGain`; `isRepeatDecay` escalation; M109 authority | Inert until outcome history accrues (safe identity meanwhile — by design); CC5 live flag state must be confirmed per-client (§8); domainStrength still bucketed even with referring-domains |

### Spine D — Advisor-visible
**Design.** The self-describing `OpportunityScore.components` flows slice → formatter → MCP → public serializer (§6); admin/client/AI read the *same persisted object*, so coherence is structural, not disciplinary.

| Closes | How | Residual gap |
|---|---|---|
| SI1, SI2, SI4, MW6 | `quickWins`(+roiScore)/`contentGaps`/`cannibalizationIssues`/`topOpportunity` slice fields; `formatSeoContextSection` branch; `recSummary` gains `impactScore`+`topRecommendationId` (`admin-chat-context.ts:845`); public serializer gains `roiScore` (`public-content.ts:217`) | Token budget of full `components` breakdown in prompt — emit top-3 contributors + evidence strings, not all 7 |

### Spine E — Data-principled
**Design.** Real referring-domains authority (M109) replaces the keyword-count proxy; `cpc`/intent as the $-weight; persist the 12-month series (M110); promote keyword-strategy synthesis off the cheap tier.

| Closes | How | Residual gap |
|---|---|---|
| CC3, CC6, SI3 | M109 backlink authority; CPC/intent value-per-click; M110 seasonality; recommend `gpt-5.4`/`gpt-5.5` for synthesis (one-line registry change, out of scorer scope) | No industry-standard DA integer on `DomainOverview` (provider surface limit) — referring-domains is the best available proxy; CC6 model-tier lift needs an A/B once strategies regenerate |

---

## 5. Event architecture

**Re-prioritization, not rebuild.** Events do not re-run AI synthesis on every fire; they write a typed `OpportunityEvent` to the ledger (M108) and trigger a **debounced re-score-and-re-sort pass** over the existing recs (cheap, no LLM). This resolves the D2-vs-D3 contradiction: D3's typed ledger + decaying-Timing (the most principled spine-B treatment) is adopted, but driven by D2's *re-score-existing* pass (lower cost/thrash than D3's full `generateRecommendations` regen) for everyday events; net-new defensive-rec *minting* happens only on the competitor-overtake trigger (the one event with no existing rec to re-score).

**Timing as a decaying multiplier** (graft from D3): `timing = 1 + Σ(boost · e^(−age/halfLife))` over active events, applied as a lift on `emvPerWeek`/horizon (not a free-floating multiplier — so urgency raises the *economic* quantity). A competitor overtake on a money keyword → `boost 0.6, halfLife 7d`; fresh critical decay → `0.5/14d`; rank decline → `0.4/10d`; publish window → `0.3/30d`; seasonal rise → `0.25/season`. Timing decays toward 1.0, so a defensive rec naturally falls back down the queue as the threat ages — no manual expiry. **The boost/half-life values ship behind their own flag with a documented calibration path from `action_outcomes`, are shadow-logged before they ever move a live `#1`, and are bounded so Timing cannot hijack the top slot pre-calibration.**

**Detectors → ledger → debounced regen:**
1. **Decay cron (NEW):** add `runDecayScan()` to the existing cron host (`server/outcome-crons.ts`), 24h; emits `decay` events for critical/`isRepeatDecay` pages. (Add a heartbeat — concentrating timing-critical work in one host is a single point of failure, flagged by D3.)
2. **Competitor overtake:** the weekly cron already writes `competitor_alert` insights (`intelligence-crons.ts:132`, today read zero times by the rec engine); extend it to emit a `competitor` event and mint a defensive rec.
3. **Rank decline:** `positionChanges.declined` (`seo-context-slice.ts:87`) crossing threshold → `rank_drop` event.
4. **Publish/apply:** the existing `resolveRecommendationsForChange` callers (`recommendations.ts:334`) already flip intersecting recs to completed + recompute summary + broadcast — extend with a `reprioritize` tail so completing the `#1` promotes the next-best immediately.
5. **Seasonal:** monthly job reads `keyword_monthly_volumes` (M110) → `seasonal` event.

**Wiring (all verified to exist):** all detectors call one `enqueueOpportunityRegen(workspaceId)` built on `debounceBridge(flag, 90_000)` (`bridge-infrastructure.ts:155`, signature `(flag, delayMs) => (workspaceId, fn) => void`, collapses per-workspace calls). The regen recomputes the summary, re-derives `topRecommendationId`, and calls `broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, …)` (`ws-events.ts:125`) — a wire already handled by `useWsInvalidation.ts:343`. **Anti-thrash (graft from D2):** only re-emit `RECOMMENDATIONS_UPDATED` when `topRecommendationId` actually changes, so the client `#1` card doesn't flicker. **Freshness guarantee:** the `#1` is recomputed within 90s of any timing-critical event.

---

## 6. Advisor + client coherence

**One object, one read path, four consumers** (graft from D4). The persisted `opportunity` object is the single source of truth; nobody re-derives `the #1`.

- **Slice → assembler:** `quickWins`(+roiScore), enriched `strategy.contentGaps`, `cannibalizationIssues`, `topOpportunity` added to the seoContext slice interface + `assembleSeoContext`, exposed via `buildWorkspaceIntelligence()` (never direct slice reads — CLAUDE.md:180).
- **Formatter:** add a branch to `formatSeoContextSection` (`formatters.ts:288`) emitting `topOpportunity` + top-3 components as prose — e.g. *"#1: [title] — value 87 ($420/wk expected). Drivers: demand (2,400/mo) 0.31, winnability (KD 18 vs authority, pos 6) 0.28, transactional intent 0.12."* The advisor recites the **same numbers the client sees**.
- **MCP:** raw-JSON tools (`get_seo_context`, `get_intelligence`) pick up the new slice fields automatically. The admin advisor `recSummary` (`admin-chat-context.ts:845`, today keeps only title/type/priority/impact/effort) gains `impactScore`, `emvPerWeek`, and an `isTopRecommendation` flag — closes MW6.
- **Public serializer:** add `roiScore` to the quick-wins pick list (`public-content.ts:217-219`, the *precise* gap — gaps already carry `opportunityScore`+`trendDirection` at `:210-214`, only quickWins strip the score) + the `opportunity` breakdown + the fields on `ClientKeywordStrategy` (closes SI3) — the strongest evidence the platform computes finally reaches the paying client.
- **Client `#1` card:** unchanged read path (`OverviewTab.tsx:98`, reads `summary.topRecommendationId` then finds the active rec); now backed by EMV with a "why this is #1" breakdown rendered from `opportunity.components`.

**Contract discipline (graft from D4):** once clients see the component bars, weight changes alter a *visible* explanation. `calibrationVersion` versions the breakdown so a shown explanation stays a stable contract; weight-calibration changes are gated on a version bump and surfaced.

---

## 7. Rollout

**Strategy: strangler-fig, dual-scorer shadow, no-op consumer boundary (D2 chassis).** The new scorer writes the **same `impactScore` field on the same `Recommendation` shape**; the cutover is config-only.

**Feature flags** (add per `shared/types/feature-flags.ts` shape — default in `FEATURE_FLAGS`, entry in `FEATURE_FLAG_CATALOG` with `{label, group, lifecycle{owner, createdAt, rolloutTarget, removalCondition, linkedRoadmapItemId, staleAuditCadence, lastReviewedAt}}`, and membership in `FEATURE_FLAG_GROUPS`, or the boot-time `assertFeatureFlagGroupingConsistency()` at `shared/types/feature-flags.ts:773` throws). Three flags, each mirroring the `intelligence-shadow-mode` precedent (`shared/types/feature-flags.ts:339`, `rolloutTarget:'staging-validation'`):
- `opportunity-value-scorer` (the scorer + sort cutover)
- `opportunity-value-events` (the event bus + decaying Timing)
- `opportunity-value-calibration` (realized-$ + weight nudging)

**Selector + divergence (graft from D2).** A pure `pickImpactScore(rec, flag)` returns legacy `impactScore` unless the flag is on for that workspace. The OV path writes only to the dark-launched M107 column until flip. Each generation logs a structured `ov_divergence` record `{ workspaceId, legacyTopRecId, ovTopRecId, agree, legacyTop3, ovTop3, perRecDelta }` — answering exactly *"which #1 does each scorer crown?"* on the 2 live workspaces, zero client-visible effect.

**Validation gate (must pass per rung — honest about N=2):**
- **Owner reviews every divergence** where `ovTopRecId ≠ legacyTopRecId` and confirms the OV pick is defensibly higher value (no fake statistical %, given N=2).
- **Grounded-beats-ungrounded invariant held in 100% of shadow runs** (the §2.4 pass/fail gate).
- **Calibration stayed identity (1.0)** until ≥N outcomes — so the flip is safe with zero history.
- **`emvPerWeek` floor** kept low-effort title fixes out of the `#1` slot pre-calibration.
- `npm run typecheck && npx vite build && npx vitest run` green; **golden tests pinned on both live workspaces' real data**; `npm run verify:feature-flags` green; staging soak ≥1 week with the divergence dashboard reviewed.

**Phase-per-PR ladder + dependency graph** (each PR staging→main, incomplete phases dark-launched):

```
P1  Foundation: opportunity-value.ts pure fn + OpportunityScore type + golden/unit tests.
    (zero call sites; CPC-population audit run here during fixture capture)
        │
        ▼
P2  M107 migration + mapper/Zod lockstep, dark-launched (written, unread).
        │
        ├──────────────┬───────────────┬─────────────────┐
        ▼              ▼               ▼                 ▼
P3 Spine A:     P5 Spine C:      P6 Spine D:        P7 Spine B:
   wire OV into     M109 authority    slice/formatter/   M108 events +
   all 6 branches   + realized-$      MCP/public chain   decay cron +
   behind flag-     calibration +     (advisor/client    decaying Timing
   off pickImpact   M111 weights      coherence)         (own flag)
        │              │               │                 │
        └──────────────┴───────┬───────┴─────────────────┘
                               ▼
P4  Shadow: dual-compute + ov_divergence logging + dashboard.
                               │
                               ▼
P8  Flip ladder (config-only): staging-validation → tiered-client-rollout
    (client A, lower-stakes) → client B → default true; legacy kept one
    release behind a kill-switch; delete legacy scorers after 2 green releases.
```

Foundation (P1→P2) gates everything; the four spines (P3/P5/P6/P7) proceed in **parallel** behind flag-off; P4 shadow depends on P3; P8 flip depends on P4 + the validation gate.

---

## 8. Open questions / decisions for the owner

1. **Client-visible dollars vs. qualitative ROI.** ✅ **DECIDED (owner, 2026-06-01): ROI badge + breakdown bars on the client `#1` card; raw `$X/wk` (`emvPerWeek`) is admin/AI-only.** The public serializer (SI3) therefore exposes `roiScore` + the component breakdown + a relative ROI badge, but NOT `emvPerWeek`. Avoids "dollar overconfidence" while still surfacing the grounded evidence. This design keeps `impactScore` (0–100) as the sort axis with `emvPerWeek` carried internally.
2. **CPC population on the 2 live workspaces.** `cpc` exists (`workspace.ts:36`) but is unread; population rate is unverified. **Must be audited in P1.** If mostly null, `valuePerClick` degrades to the intent-weight tier — economically still sound, but the "$" framing becomes intent-driven, not CPC-driven. Acceptable? Or block the dollar surface until a CPC backfill?
3. **Event re-rank aggressiveness.** Re-score-existing (cheap, chosen default) vs. full `generateRecommendations` regen on events (richer, D3's original). And: should a high-boost competitor event be *allowed* to take the `#1` slot pre-calibration, or only after the boost/half-life constants are outcome-calibrated? (Default: bounded so it cannot pre-calibration.)
4. **Real authority data source.** ✅ **DECIDED (owner, 2026-06-01): referring-domains proxy + outcome-calibration — no new provider spend.** M109 persists the backlink-derived `authority_strength` we already fetch (today wired only to prose); outcomes calibrate it over time. No Moz/SEMrush Authority Score integration. CC3 closes "good enough"; the residual (no industry DA integer on `DomainOverview`) is accepted.
5. **CC5 live flag state.** Confirm `outcome-tracking` + `outcome-ai-injection` are enabled for both live workspaces (lives in `feature_flag_overrides` DB / env, not source) — gates whether calibration ever fires. Both carry `rolloutTarget:'tiered-client-rollout'`, so they may already be on.
6. **Model-tier promotion (CC6).** Promote keyword-strategy synthesis off `gpt-5.4-mini` to `gpt-5.4` (or `gpt-5.5` for the master-synthesis call)? Out of scorer scope (one-line registry change) but its labels feed Confidence; do it before or after the flip?

---

## 9. Traceability — all 28 findings

| Finding | Closed by | Spine |
|---|---|---|
| **Q1** Technical score blind to winnability/demand/intent/effort | §2.2 technical branch (clickDelta × severityLift, bounded); unified EMV axis | A |
| **Q2** Striking-distance flat 60/40, volume unread, KD only prose | §2.2 ranking-opp now reads `pm.volume` + routes `difficulty` through `adjustKdImpactScore` | A |
| **Q3** Content-gap discards trend-aware `opportunityScore` | §2.2 content-gap consumes `opportunityScore` as grounded spine (incl. `trendDirection`) | A |
| **Q4** Competitor alerts never become a ranked rec | §5 competitor detector → event → defensive rec mint | B |
| **Q5** Rec set frozen snapshot, no event re-score | §5 event bus + decay cron + debounced re-rank | B |
| **Q6** Quick-win/diagnostic = LLM buckets; roiScore unused | §2.2 quick-win consumes `roiScore`; §2.4 invariant | A |
| **Q7** Static `estimatedGain` "15-30%" constants | §2.5 `estimatedGain = EMV×Horizon` / median realized `attributed_value` | C |
| **Q8** Business priorities only break exact ties | §2.1 `businessFit` graded multiplier 1.0–1.5 | A |
| **MW1** roiScore on Strategy tab but ignored by rec engine | §2.2 quick-win consumes `roiScore` | A |
| **MW2** Content-gap ranker ignores `opportunityScore`+`trendDirection` | §2.2 content-gap grounded spine | A |
| **MW3** Competitor/rank-decline event-blind to rec engine | §5 competitor + rank_drop detectors | B |
| **MW5** `isRepeatDecay` detected but ignored in decay rec | §2.2 `recoverability ×= 0.4` + tactic switch | A/C |
| **MW6** Advisor drops `impactScore` + `topRecommendationId` | §6 `recSummary` gains both | D |
| **IW1** Quick-win re-scores from LLM bucket, discards `roi_score` | §2.2 + §2.4 invariant | A |
| **IW2** Content-gap rebuilds from LLM priority bucket | §2.2 content-gap grounded spine | A |
| **IW6** Decay score scales with `previousClicks` (loss, not upside) | §2.2 recoverability-weighted clickDelta, cause-distinguished | A |
| **IW7** Freshness = raw `impressions/50`, tier by analysis-date | §2.2 `impressions × CTR-gap` gated on real content-age | A |
| **SI1** roiScore composite never reaches advisor | §3.3/§6 `quickWins`(+roiScore) slice + formatter | D |
| **SI2** seoContext `strategy.contentGaps` assembled but never formatted | §6 `formatSeoContextSection` branch | D |
| **SI3** Public quick-wins serializer strips `roiScore` | §6 add `roiScore` at `public-content.ts:217` + `ClientKeywordStrategy` | D/E |
| **SI4** `cannibalization_issues` reaches no slice | §3.3 `cannibalizationIssues` slice field | D |
| **SI5** Rec set + `topRecommendationId` frozen | §5 event-driven re-rank | B |
| **SI6** Business fit degenerate boolean tiebreaker | §2.1 `businessFit` graded multiplier | A |
| **CC1** Quick-win discards `roi_score`, LLM bucket drives `topRecommendationId` | §2.2 + §2.4 invariant | A |
| **CC2** `adjustKdImpactScore` on content-gap only | §2.2 KD-authority on all branches | A |
| **CC3** `domainStrength` = organic-keyword-count proxy | §3.2 M109 referring-domains authority + calibration | C/E |
| **CC5** Outcome reweight identity ×1.0 | §2.5 realized-$ calibration; (live flag confirm — §8.5) | C |
| **CC6** Keyword-strategy synthesis on cheap `gpt-5.4-mini` | §4 Spine E: promote to `gpt-5.4`/`gpt-5.5` (registry change) — **partial/deferred:** A/B validation post-regen (§8.6) | E |

All 28 confirmed findings are addressed; the only item carrying a deferred component is **CC6** (the model-tier promotion is a one-line change in scope but its quality lift needs an empirical A/B once strategies regenerate — flagged in §8.6, not blocking the scorer).

---

## Appendix — implementation anchors & verified corrections

**Key file paths for the implementation plan (all relative to repo root):**
- New scorer: `server/scoring/opportunity-value.ts` (to create)
- Producer/sort/summary: `server/recommendations.ts`
- Grounded composites: `server/keyword-strategy-enrichment.ts`, `server/keyword-strategy-helpers.ts`
- Authority + outcome calibration: `server/authority-context.ts`, `server/outcome-learning-default-path.ts`
- Types: `shared/types/recommendations.ts`, `shared/types/intelligence.ts`, `shared/types/feature-flags.ts`
- Flag resolver + boot assert: `server/feature-flags.ts` (resolver, 138 lines), `shared/types/feature-flags.ts:773` (`assertFeatureFlagGroupingConsistency`)
- Event infra: `server/bridge-infrastructure.ts:155` (`debounceBridge`), `server/outcome-crons.ts`, `server/ws-events.ts:125` (`RECOMMENDATIONS_UPDATED`)
- Advisor/client surfaces: `server/intelligence/formatters.ts:288`, `server/admin-chat-context.ts:845`, `server/routes/public-content.ts:217`, `src/components/client/OverviewTab.tsx:98`
- Migrations dir (next is 107): `server/db/migrations/`
- Law enforcement: `scripts/pr-check.ts:1166` (authority-layered), `:1487` (consumer-builder); `CLAUDE.md:180,254,261`

**Verified corrections vs. the panel/audit citations (use these in the plan):**
1. The feature-flag catalog/groups/`assertFeatureFlagGroupingConsistency` cited as `feature-flags.ts:339/798` actually live in **`shared/types/feature-flags.ts`** (server `server/feature-flags.ts` is only the 138-line resolver).
2. `computeOpportunityScore` uses **`volume/10000`** and **`impressions/2000`** ceilings (`keyword-strategy-helpers.ts:84-86`), not the `/50000` and `/20000` some designs stated — the plan must use the verified ceilings.

---

*Recommended design for the platform owner. Read-only / design-only — no source was modified. Base D2 (judge-panel winner) + grafted D1 economics, D4 explainability, D3 event engine. All current-state claims independently re-verified against source at git tip `08d30739`.*
