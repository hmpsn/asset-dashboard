# Unified Opportunity Value Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Each phase is **one PR**; per CLAUDE.md *phase-per-PR* + *staging-before-main*, do NOT start phase N+1 until phase N is merged to `staging` and CI is green.

**Goal:** Replace every magic-constant recommendation scorer with one shared, data-grounded `computeOpportunityValue()` that writes to the existing `impactScore` field (no-op consumer boundary), re-ranks on opportunity events, learns from outcomes, and is explainable — closing all 28 findings of the intelligence-quality audit.

**Architecture:** One pure function `server/scoring/opportunity-value.ts` computes a dollar-denominated EMV (`expectedClickDelta × valuePerClick`, ÷ effort, × businessFit × confidence × calibration), normalized per-workspace to the 0–100 `impactScore` the platform already sorts by. A `pickImpactScore(rec, ws)` selector gates legacy-vs-OV behind a flag for strangler-fig cutover with shadow divergence logging. An `opportunity_events` ledger + decaying-Timing multiplier re-ranks the queue on decay/competitor/rank-drop/publish/seasonal events. Ships dark (flags OFF); the production flip is owner-gated after a shadow soak.

**Tech stack:** Express + TypeScript, SQLite (better-sqlite3, WAL, FK ON), React 19 + Vite + Tailwind 4, Zod v3, Vitest. Source baseline: git tip `08d30739`.

**Source-of-truth docs:** design `docs/designs/2026-05-31-opportunity-value-model.md`; pre-plan audit `docs/superpowers/audits/2026-06-01-opportunity-value-model-audit.md`; findings `docs/audits/2026-05-31-intelligence-quality-audit.md`.

---

## Grounding in CLAUDE.md (every PR must honor)

- **Authority-layered fields (CLAUDE.md:254):** add exactly ONE resolved field (`Recommendation.opportunity`); `impactScore` becomes a derived read. **Never** ship a `formatOpportunityForPrompt(raw)` helper — the advisor injects `opportunity` directly (precedent `effectiveBrandVoiceBlock`, `formatters.ts:77,:301`). Enforced by pr-check `:1166` (extended in PR3).
- **Slice architecture (CLAUDE.md:180):** new slice fields go on the interface in `shared/types/intelligence.ts` AND the `assemble*` function; consumed only via `buildWorkspaceIntelligence()`. The AI is blind to data not in a slice.
- **DB column + mapper lockstep (CLAUDE.md:261):** each migration commit ships migration SQL + row interface + `rowToX()` mapper + write path + `public-portal.ts` serialization (if client-facing) + Zod schema with `.optional()` for fields absent on legacy rows.
- **Typed contracts at boundaries (CLAUDE.md Data-Flow #5):** no `Record<string,unknown>`; typed interfaces in `shared/types/` before implementing.
- **Read-before-write (#1 bug = guessed field names):** all grounded field names/nullability are pinned in the audit §Scanner-5 — use them verbatim, never guess.
- **State machines, broadcasts, activity logging, intelligence-consumer-builders** per CLAUDE.md where touched.
- **Quality gates (every PR):** `npm run typecheck` (`tsc -b`) · `npx vite build` · full `npx vitest run` · `npx tsx scripts/pr-check.ts` · `npm run verify:feature-flags` · `npm run verify:coverage-ratchet`. Update `FEATURE_AUDIT.md` / `data/roadmap.json` / `BRAND_DESIGN_LANGUAGE.md` as applicable. **CI must be green before merge.**

**Execution-environment note:** workflow subagents use **sonnet/opus only** (haiku hits a known MCP-schema spawn bug here). Model tiers in the audit's table map haiku→sonnet for this run.

---

## Phase 0 — Shared contracts (in PR1; single-owner, gates everything)

These types are the contract every later phase compiles against. Defined in `shared/types/recommendations.ts` (alongside the existing `Recommendation` iface at `:8`).

```ts
export type OpportunityDimension =
  | 'demand' | 'winnability' | 'intent' | 'effort' | 'businessFit' | 'timing' | 'evidence';

export interface OpportunityComponent {
  dimension: OpportunityDimension;
  rawValue: number | string | null;   // e.g. volume 2400, position 7, "transactional"
  normalized: number;                  // 0..1
  weight: number;                      // calibrated dimension weight (P5 / default platform weights)
  contribution: number;                // weight × normalized
  evidence: string;                    // one-line "why" the advisor recites verbatim
}

export interface OpportunityScore {
  value: number;                       // 0..100 — written into Recommendation.impactScore
  emvPerWeek: number;                  // $/week — admin/AI-only (owner decision); 0 when ungrounded
  roiPerEffortDay: number;             // internal ROI quantity (pre-normalization)
  confidence: number;                  // 0.4..1.0 — grounded vs LLM-adjective provenance
  calibration: number;                 // 0.75..1.25 per-workspace (1.0 until outcomes exist)
  groundedSpine: 'roiScore' | 'opportunityScore' | 'computed';
  components: OpportunityComponent[];
  calibrationVersion: string;          // weights-row version → stable client-visible contract
  modelVersion: string;                // 'ov-1'
}

/** Producer-agnostic input; every branch maps its fields here. All optional fields
 *  mirror the nullability pinned in the audit (PageKeywordMap/contentGaps are all optional). */
export interface OpportunityInput {
  branch: 'quick_win' | 'ranking_opp' | 'content_gap' | 'decay' | 'technical' | 'freshness' | 'diagnostic';
  volume?: number | null;
  impressions?: number | null;
  currentPosition?: number | null;
  cpc?: number | null;
  difficulty?: number | null;            // keyword difficulty (KD)
  intent?: 'transactional' | 'commercial' | 'informational' | 'navigational' | null;
  roiScore?: number | null;              // grounded composite (quick-win spine)
  opportunityScore?: number | null;      // grounded composite (content-gap spine)
  trendDirection?: 'rising' | 'declining' | 'stable' | null;
  previousClicks?: number | null;        // decay
  currentClicks?: number | null;         // decay
  isRepeatDecay?: boolean | null;        // decay tactic switch
  severity?: 'error' | 'warning' | 'info' | null;  // technical
  isCritical?: boolean | null;           // technical
  llmLabel?: 'high' | 'medium' | 'low' | null;     // demoted to Confidence fallback
  authorityStrength?: number | null;     // referring-domains proxy (P5; default platform value pre-P5)
  effortDays?: number | null;            // {0.5, 2, 5} default by branch until calibrated
  businessFitAlignment?: number | null;  // 0..1 semantic align vs effectiveBusinessPriorities
  ctrCurve?: Record<number, number> | null; // per-ws calibrated CTR-by-position (P1 helper)
}
```

Additive type extensions (legacy-tolerant):
- `Recommendation.opportunity?: OpportunityScore;` (audit: iface `:8`, `impactScore:number` stays at `:18`).
- `RecommendationSet.summary.topOpportunityRationale?: string;` (summary type `:49`).

Feature flags (added in the PR that first reads them, each per `shared/types/feature-flags.ts` shape — `FEATURE_FLAGS` default `:12`, `FEATURE_FLAG_CATALOG` entry `:151` with full lifecycle block, `FEATURE_FLAG_GROUPS` membership `:682`, or boot `assertFeatureFlagGroupingConsistency` `:798` throws; mirror `intelligence-shadow-mode` `:339`, `rolloutTarget:'staging-validation'`):
- `opportunity-value-scorer` — added PR3 (gates `pickImpactScore`).
- `opportunity-value-events` — added PR7.
- `opportunity-value-calibration` — added PR5.

Migrations (next number is **107**): M107 (PR2), M108 (PR7), M109+M111 (PR5), M110 (PR7/seasonal). Lockstep per CLAUDE.md:261.

---

## PR1 (P1) — Foundation: the pure scorer + types + tests

**Goal:** Ship `computeOpportunityValue` + types + CTR helper + selector, fully tested, with ZERO call sites (pure, dark). Nothing in production behavior changes.

**Files:**
- Create: `server/scoring/opportunity-value.ts`, `server/scoring/ctr-curve.ts`
- Modify: `shared/types/recommendations.ts` (Phase 0 types)
- Test: `tests/unit/opportunity-value.test.ts`, `tests/unit/ctr-curve.test.ts`

**Tasks:**
- [ ] **Add the Phase 0 types** to `shared/types/recommendations.ts`. Run `tsc -b` — green (additive, no consumers yet).
- [ ] **Write failing tests** `tests/unit/ctr-curve.test.ts`: `buildCtrCurve(gscKeywords)` returns a position→CTR map from a workspace's own `{clicks,impressions,position}` history (audit field `gscKeywords` `workspace.ts:32`); falls back to a documented industry curve when `< MIN_OBSERVATIONS`; the curve source is returned for evidence logging. Assert: monotonic-decreasing CTR by position; fallback used at low N; calibrated used at high N.
- [ ] **Implement `server/scoring/ctr-curve.ts`** to pass.
- [ ] **Write failing tests** `tests/unit/opportunity-value.test.ts` covering the formula (design §2.1) per branch:
  - quick_win consumes `roiScore` as grounded spine; `groundedSpine==='roiScore'`, `confidence>=0.95`.
  - ranking_opp reads `volume` + routes `difficulty` through authority (CTR-uplift), NOT flat 60/40.
  - content_gap consumes `opportunityScore` + `trendDirection`.
  - decay uses recoverability-weighted `(previousClicks-currentClicks)×recoverability`; `isRepeatDecay` → `recoverability ×= 0.4`.
  - technical `severityLift` is bounded so it cannot exceed a grounded commercial opportunity of real EMV.
  - freshness `impressions × CTR-gap`.
  - **Invariant test (load-bearing):** given a grounded item and an ungrounded (LLM-label-only) item of equal raw EMV, the grounded one's `value` ≥ the ungrounded one's (`confidence` discount). This is the §2.4 grounded-beats-ungrounded guarantee.
  - null-CPC path: `valuePerClick` degrades to intent-weight tier; `emvPerWeek` still finite; no NaN.
  - `normalizeToScore` clamps to [0,100]; `components[]` sums to a sensible contribution; `modelVersion==='ov-1'`.
- [ ] **Implement `server/scoring/opportunity-value.ts`** (pure, side-effect-free) to pass. Default platform dimension weights as named consts with a `// calibration path: P5 workspace_opportunity_weights` comment (no naked magic). Default `effortDays` by branch {0.5,2,5} with the same calibration comment.
- [ ] **Gate:** `tsc -b` · `npx vite build` · `npx vitest run` · `pr-check` all green.
- [ ] **Commit** (branch `opportunity-value/p1-foundation`), open **PR → wait for CI green → merge to staging**.

**DoD:** pure fn + helper + types merged, 100% of the invariant + per-branch unit tests green, zero call sites, zero production behavior change. `FEATURE_AUDIT.md` updated.

---

## PR2 (P2) — M107 migration + mapper/Zod lockstep (dark)

**Goal:** Persist an `opportunity_json` column on recommendations, dark-launched (column exists, mapper/Zod handle it, nothing writes a non-null value yet).

**Files:**
- Create: `server/db/migrations/107-recommendation-opportunity.sql`
- Modify: the recommendations row interface + `rowToRecommendation` + `saveRecommendations` write path (audit: rec set persisted via `recommendation_sets`; locate the row mapper in `server/recommendations.ts` persistence section) + the recommendations Zod schema + `server/public-portal.ts` serialization list (recommendations are client-facing).
- Test: `tests/integration/recommendation-opportunity-column.test.ts`

**Tasks:**
- [ ] **M107 SQL:** `ALTER TABLE recommendation_sets ADD COLUMN opportunity_model_version TEXT;` plus the `opportunity` payload — since recs live as JSON under the set, the `opportunity` rides inside each rec object in the existing recs JSON blob (no new column per-rec); add `opportunity_model_version` on the set for shadow/A-B. Confirm the exact storage shape by reading the current `recommendation_sets` write path first (read-before-write).
- [ ] **Lockstep:** extend the rec Zod schema with `opportunity: opportunityScoreSchema.optional()` (every nested field `.optional()` per CLAUDE.md "schema vs stored shape"); add `opportunityScoreSchema` mirroring the type. Update `rowToRecommendation`/serializer to round-trip `opportunity` when present, tolerate absent (legacy).
- [ ] **`public-portal.ts`:** ensure the recommendations serialization passes through `opportunity` IF present (client-facing fields are gated to the ROI-badge/breakdown subset in PR6; here just don't drop it at the boundary).
- [ ] **Test:** round-trip a rec with and without `opportunity`; assert legacy rows (no field) parse to fallback, not data loss (the canonical `keywordStrategySchema.pageMap` failure mode).
- [ ] **Gate + PR → CI green → merge to staging.**

**DoD:** column/blob round-trips `opportunity`, Zod `.optional()` verified against legacy rows, `db:migrate` clean, no reader yet.

---

## PR3 (P3 · Spine A) — Wire OV into every branch behind flag-off selector

**Goal:** Every producer branch builds an `OpportunityInput` and calls `computeOpportunityValue`; the result is persisted into each rec's `opportunity` (shadow), but `pickImpactScore` returns **legacy** `impactScore` while `opportunity-value-scorer` is OFF — so ranking is unchanged in production. Closes Spine A structurally.

**Files (Spine A owns `server/recommendations.ts` exclusively):**
- Modify: `server/recommendations.ts` (all scoring sites per audit §Scanner-1), consumes `server/scoring/opportunity-value.ts`.
- Modify: `shared/types/feature-flags.ts` (+`opportunity-value-scorer` flag).
- Modify: `scripts/pr-check.ts` (+magic-scale guard rule; extend authority-layered rule `:1166` to also block `formatOpportunityForPrompt`).
- Test: `tests/unit/recommendations-opportunity-wiring.test.ts`; update the pinning tests per audit §Scanner-3.

**Tasks:**
- [ ] **Add `pickImpactScore(rec, workspaceId)` selector** + the `opportunity-value-scorer` flag (default false). Selector returns `rec.opportunity?.value` only when the flag is on for that workspace, else legacy `rec.impactScore`. Single chokepoint.
- [ ] **For each of the 7 magic sites** (audit: technical `:584`/`:985`, site-wide `:1052`, quick-win `:1118`, content-gap `:1163`, ranking-opp `:1234`, decay `:1335`, **diagnostic `:1462`**, freshness `:1514`): build the `OpportunityInput` from the branch's already-available fields and call `computeOpportunityValue`; attach `opportunity` to the rec; set `impactScore = opportunity.value` ONLY behind the selector (shadow write keeps `opportunity` regardless). Ranking-opp must now read `pm.volume` (audit: unread in `1226-1275`) and route `difficulty` through authority.
- [ ] **Replace the 11 `applyRecommendationOutcomeAdjustment` call sites** (audit: `:1017…:1521`) — calibration now lives inside `computeOpportunityValue` (uniform). Keep the anomaly/outcome `applyScoreAdjustment` ledger path (`score-preservation.test.ts`) intact — that is a different mechanism.
- [ ] **Re-ground `estimatedGain`** (Q7): replace `RECOVERY_RATES` interpolation (`:62-104`,`:1012`) with `emvPerWeek × HorizonWeeks` (admin/AI dollars) → a client-safe relative string at the boundary. (Client $ visibility deferred to PR6 per owner decision.)
- [ ] **pr-check magic-scale guard:** flag any new inline `impactScore = <literal>` / `'high'?75:` bucket in `recommendations.ts` outside `computeOpportunityValue`; `// scorer-ok` hatch. Run `npm run rules:generate`.
- [ ] **Update pinning tests** (audit §Scanner-3): re-point recovery-rate/`computeImpactScore` assertions to the OV path or golden fixtures; **keep `recommendations-top-id.test.ts` + `recommendations-intent-ranking.test.ts` green with the flag OFF** (proves the no-op boundary). Add `recommendations-opportunity-wiring.test.ts`: with flag ON, ranking reflects OV; with flag OFF, identical to legacy.
- [ ] **Gate (kill orphaned test-server PIDs first) + PR → CI green → merge to staging.**

**DoD:** every branch computes+persists `opportunity`; flag OFF ⇒ byte-identical ranking (no-op proof tests green); flag ON ⇒ OV ranking; magic-scale rule live; full suite green.

---

## PR4 (P4 · Shadow) — Dual-compute divergence logging + dashboard

**Goal:** With the scorer flag still OFF, log per-generation divergence between legacy `#1` and OV `#1` on every workspace, so the owner can review before any flip.

**Files:**
- Create: `server/scoring/ov-divergence.ts` (logger + store), migration for an `ov_divergence` table (next number), a read route under an admin path, a small admin dashboard panel.
- Modify: the rec generation/persist path to emit a divergence record (behind a cheap always-on shadow compute since `opportunity` is already persisted in PR3).
- Test: `tests/integration/ov-divergence.test.ts`.

**Tasks:**
- [ ] Migration + lockstep for `ov_divergence { workspace_id, legacy_top_rec_id, ov_top_rec_id, agree, legacy_top3 JSON, ov_top3 JSON, per_rec_delta JSON, computed_at }`.
- [ ] On each `generateRecommendations`, compute both orderings (legacy `impactScore` vs `opportunity.value`) and write a divergence row. No client-visible effect.
- [ ] Admin read route + dashboard panel: "OV vs legacy #1" per workspace, the top-3 diff, and the grounded-beats-ungrounded invariant pass/fail count.
- [ ] **Validation-gate assertion (test):** the grounded-beats-ungrounded invariant holds in 100% of generated sets; `emvPerWeek` floor keeps low-effort title fixes out of the OV `#1` slot pre-calibration.
- [ ] **Gate + PR → CI green → merge to staging.**

**DoD:** divergence logged + visible on staging; invariant + floor asserted; this is the artifact the owner reviews before P8.

---

## PR5 (P5 · Spine C) — Authority (M109) + realized-$ calibration + weights (M111)

**Goal:** Replace the organic-keyword-count `domainStrength` proxy with the referring-domains signal, make `computeOpportunityValue`'s calibration learn realized-$/predicted-$ per workspace, and add calibrated dimension weights. Closes CC3/CC5/Q7-calibration/MW5-calibration.

**Files (exclusive):** `server/authority-context.ts`, `server/outcome-learning-default-path.ts`, migrations M109 (`workspace_authority`) + M111 (`workspace_opportunity_weights`) + stores, `shared/types/feature-flags.ts` (+`opportunity-value-calibration` flag). Owner-decided: **no new provider** — use `backlinkProfileToAuthorityStrength` (`authority-context.ts:50`).

**Tasks:**
- [ ] M109 `workspace_authority` + lockstep: persist `referring_domains` + `authority_strength` (from `backlinkProfileToAuthorityStrength`); `getOrCreateWorkspaceAuthority` returns **non-nullable** (pr-check `:2107`). Feed `authorityStrength` into `OpportunityInput` for ALL branches (replaces `resolveDomainStrength` `:859-868`).
- [ ] M111 `workspace_opportunity_weights` + lockstep: 7 dimension weights, `calibration_version`, default platform values; `getOrCreate` non-nullable. `computeOpportunityValue` reads these (passed in) instead of the PR1 default consts.
- [ ] Extend `buildOutcomeAdjustment` (`outcome-learning-default-path.ts:44`) from win-rate to `clamp[0.75,1.25]( median(attributed_value / EMV_predicted) )` per `(actionType, difficultyBucket)`, sourced from `action_outcomes.attributed_value` (audit: written `outcome-tracking.ts:286`). Identity 1.0 until ≥N outcomes (safe day-one). Gate behind `opportunity-value-calibration`.
- [ ] Monthly weight ridge-nudge (clamped ±15%, audit-logged) toward the outcome-predictive mix; bump `calibration_version`.
- [ ] Tests: authority routing changes scores correctly; calibration is identity with no outcomes and shifts with seeded outcomes; weights round-trip; invariant still holds.
- [ ] **Gate + PR → CI green → merge to staging.**

**DoD:** real authority feeds all branches; calibration extension live behind flag (identity-safe); weights persisted; CC3/CC5 closed structurally.

---

## PR6 (P6 · Spine D) — Advisor + client coherence

**Goal:** The persisted `opportunity` object reaches the advisor and the client through slices/formatter/MCP/public-serializer — one explainable shared `#1`. Closes SI1/SI2/SI4/MW6/SI3.

**Files (exclusive):** `shared/types/intelligence.ts`, `server/intelligence/seo-context-slice.ts`, `server/intelligence/formatters.ts`, `server/admin-chat-context.ts`, `server/routes/public-content.ts`, `src/components/client/types.ts`, `src/components/client/OverviewTab.tsx` (+ the `#1` breakdown render).

**Tasks:**
- [ ] **Slice fields** (CLAUDE.md:180) on `SeoContextSlice` (`intelligence.ts:133`) + `assembleSeoContext`: `quickWins[]` with `roiScore` (SI1; reads `listQuickWins`), enriched `contentGaps[]` with `opportunityScore`+`trendDirection` (SI2), `cannibalizationIssues[]` (SI4; reads `listCannibalizationIssues`), `topOpportunity: { recommendationId, value, emvPerWeek, components }`.
- [ ] **Formatter** branch in `formatSeoContextSection` (`formatters.ts:288`) emitting `topOpportunity` + top-3 components as prose (token-budgeted; inject `opportunity` directly — NO format helper, per authority-layered law).
- [ ] **Admin `recSummary`** (`admin-chat-context.ts:845-846`): add `impactScore`, `emvPerWeek`, `isTopRecommendation` (MW6).
- [ ] **Public serializer** (`public-content.ts:216-220`): add `roiScore` + the `opportunity` **ROI badge + component breakdown** to the quickWins pick list and `ClientKeywordStrategy` type — **but NOT `emvPerWeek`** (owner decision: client sees relative ROI + bars, not raw $). SI3 closed within the owner's visibility envelope.
- [ ] **Client `#1` card** (`OverviewTab.tsx:98`): unchanged read path; add a "why this is #1" breakdown rendered from `opportunity.components` (no purple; narrative ROI per client-framing law). `calibrationVersion` stabilizes the shown explanation.
- [ ] Update test-mocks for every slice-literal (audit lesson: tests aren't typechecked — new required-ish slice fields break mocks); run the FULL suite.
- [ ] **Gate + PR → CI green → merge to staging.**

**DoD:** advisor + client read the same `opportunity`; `roiScore`/breakdown reach the client (no `$`); MCP picks up slice fields; full suite green incl. updated mocks.

---

## PR7 (P7 · Spine B) — Event ledger + decay cron + decaying Timing

**Goal:** Kill the frozen snapshot. Detected events re-rank the queue via a cheap re-score pass. Closes Q4/Q5/MW3/MW5-timing/SI5.

**Files (exclusive):** migration M108 (`opportunity_events`) + M110 (`keyword_monthly_volumes`) + stores, `server/outcome-crons.ts` (decay cron), `server/intelligence-crons.ts` (competitor → event), `server/intelligence/seo-context-slice.ts` rank-decline detector tap, a new `server/scoring/opportunity-events.ts` (`enqueueOpportunityRegen`), `shared/types/feature-flags.ts` (+`opportunity-value-events` flag).

**Tasks:**
- [ ] M108 `opportunity_events` + M110 `keyword_monthly_volumes` (persist the 12-month series `trendDirection()` currently drops, `seo-provider-signals.ts:6`) + lockstep.
- [ ] **Decaying Timing** in `computeOpportunityValue`: `timing = 1 + Σ(boost·e^(−age/halfLife))` over active events, lifting `emvPerWeek`/horizon. Boost/half-life consts behind the events flag with calibration-path comments; bounded so Timing can't hijack `#1` pre-calibration; `emvPerWeek` floor enforced.
- [ ] **Detectors → `enqueueOpportunityRegen(workspaceId)`** on `debounceBridge(flag, 90_000)` (`bridge-infrastructure.ts:155`): (1) NEW `runDecayScan()` in `startOutcomeCrons` (`outcome-crons.ts:36`), 24h, emits `decay` events incl. `isRepeatDecay`; (2) competitor cron (`intelligence-crons.ts:129`) emits `competitor` event + mints a defensive rec; (3) rank-decline from `positionChanges.declined` (`seo-context-slice.ts:88`); (4) publish/apply `reprioritize` tail on `resolveRecommendationsForChange` (`:334`) so completing `#1` promotes next-best; (5) monthly seasonal from M110.
- [ ] Regen recomputes summary + `topRecommendationId`, broadcasts `RECOMMENDATIONS_UPDATED` (`ws-events.ts:125`) **only when `topRecommendationId` changes** (anti-thrash). Don't regress `outcome-publish-triggers-rec-regen.test.ts` (cron import order).
- [ ] Tests: each detector enqueues; debounce collapses; Timing decays; anti-thrash; defensive-rec mint.
- [ ] **Gate + PR → CI green → merge to staging.**

**DoD:** events ledger live; decay cron running; queue re-ranks within 90s of a timing-critical event behind the events flag; no thrash; full suite green.

---

## PR8 (P8) — Flip ladder · OWNER-GATED (NOT autonomous)

**Goal:** Turn the scorer ON in production, one client at a time. **This phase is not executed autonomously.** It requires the design §7 validation gate:
- Owner reviews the `ov_divergence` dashboard (PR4) on both live workspaces and confirms each OV `#1` ≠ legacy `#1` is defensibly higher value (N=2 ⇒ human review, no fake stats).
- Grounded-beats-ungrounded invariant held in 100% of shadow runs; `emvPerWeek` floor verified.
- Calibration confirmed identity until ≥N outcomes; CC5 live-flag state confirmed (`outcome-tracking`/`outcome-ai-injection` per-client).
- Staging soak ≥1 week.

**Ladder (config-only flips):** `staging-validation` → `tiered-client-rollout` (client A) → client B → default true; keep legacy one release behind a kill-switch; delete legacy scorers + the magic-scale-now-unused branches after 2 green releases.

**Autonomous boundary:** the assistant builds + merges PR1–PR7 dark, then hands off the divergence dashboard and this checklist. The flag flip is the owner's call.

---

## Verification strategy (per PR)

1. Kill orphaned test-server PIDs (`lsof -ti :13000-13999 | xargs kill -9` as needed) to avoid EADDRINUSE false failures.
2. `npm run typecheck` → `npx vite build` → `npx vitest run` (FULL suite, not just new) → `npx tsx scripts/pr-check.ts` → `npm run verify:feature-flags` → `npm run verify:coverage-ratchet`.
3. Adversarial review workflow (3 opus lenses: correctness/no-op-boundary, platform-law fit, migration safety) → fix every Critical/Important → re-review until clean.
4. PR → `gh run watch` until **CI green** → merge to staging. Never merge on a red/in-flight run.

## Parallelization & models

Per audit §Parallelization + §Model-assignments. Phase 0/PR1–PR2 single-owner sequential. PR3/PR5/PR6/PR7 have exclusive file ownership and *could* parallelize, but are executed **serially PR-by-PR** here to satisfy staging-before-next-phase. PR4 depends on PR3. Opus for the scorer + contracts + final review; sonnet for wiring/slices/events/migrations (haiku tier → sonnet in this env).

## Open risks (carry from audit §Open-risks)

CPC population (P1 audit), live flag state (CC5), CTR-curve calibration threshold, golden-test data capture (needs sanctioned scrubbed staging data), event aggressiveness (owner-deferred, bounded default), cross-workspace `value` incomparability (accepted).
