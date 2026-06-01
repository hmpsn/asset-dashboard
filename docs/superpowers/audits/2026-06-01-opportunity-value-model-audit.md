# Opportunity Value Model — Pre-Plan Audit (2026-06-01)

> **What was scanned.** Six exhaustive read-only scanner passes over the working tree at git tip `08d30739` (the audit tip): (1) magic-constant scoring sites; (2) `impactScore` / rec-set / `topRecommendationId` consumers; (3) pinning/coverage tests; (4) flag/migration/slice/event mechanics; (5) grounded data fields with names + nullability; (6) prevention (pr-check rules / verifications). Every `file:line` below was re-confirmed against **current** source — a date roll moved some lines since the design was written; the ACTUAL current line is reported and divergences from the design's citations are flagged in §4.
> This document proves exhaustive scope for the design at `docs/designs/2026-05-31-opportunity-value-model.md` (the unified `computeOpportunityValue()` / `server/scoring/opportunity-value.ts` re-architecture, writing to the existing `impactScore` field behind 3 flags with an `opportunity_events` ledger).
> Read-only. Zero source was modified. Owner decisions locked: client sees ROI badge + breakdown bars (not raw $/wk); authority = referring-domains proxy + calibration (no new provider).

---

## Findings by category

### Scanner 1 — Magic-constant scoring sites (Spine A targets — every site `computeOpportunityValue` must replace)

All in `server/recommendations.ts` (1686 lines) unless noted. Every site below currently produces an `impactScore` from an invented scale.

| Producer branch | Magic constant | CURRENT line | Design cited | Verdict |
|---|---|---|---|---|
| `computeImpactScore` def | — | `:577` (decl) | `:586` | decl 577 |
| Technical/audit sevBase | `error?60:warning?35:15` `+critBonus 20` `+traffic 0–20` | `:584` | `:586` | **shifted −2** |
| Audit-path call site | `computeImpactScore(...)` | `:985` | `:985` | exact |
| Site-wide issues | `isCrit ? 80 : 50` | `:1052` | `:1052` | exact |
| Quick-win | `estimatedImpact 'high'?75:'medium'?55:35` | `:1118` | `:1118` | exact |
| Content-gap | `cg.priority 'high'?65:'medium'?45:25` | `:1163` | `:1163` | exact |
| Ranking-opp | `currentPosition<=10 ? 60 : 40` (flat; `pm.volume` never read in `1226-1275`) | `:1234` | `:1234` | exact |
| Decay | `critical: min(90, 60+previousClicks/50)` ; else `min(70, 40+previousClicks/100)` | `:1335-1337` | `:1335` | exact |
| Diagnostic | `diagImpactMap {high:75,medium:55,low:35}` | `:1462` | `:1462` | exact |
| Freshness | `min(round(trafficAtRisk/50), 80)` where `trafficAtRisk = d.impressions ?? 0` | `:1514` | `:1514` (`impressions/50`) | exact (var is `trafficAtRisk`, sourced from `impressions`) |

Grounded composites the design folds in as **consumed inputs** (Spine A/E):
- `roiScore = round((volume·(1−difficulty/100))/max(currentPosition,1))` — `server/keyword-strategy-enrichment.ts:798`; ungrounded fallback `'high'?100:'medium'?50:20` at `:801`; sorted client-side `:804`. Persisted `quick_wins.roi_score`, read `ORDER BY roi_score DESC NULLS LAST` at `server/quick-wins.ts:81` (row iface `:22`, mapper `:63`).
- `computeOpportunityScore(cg)` — `server/keyword-strategy-helpers.ts:74-92`; ceilings **`volume/10000`** (`:84`) and **`impressions/2000`** (`:86`); trend mult rising×1.3/declining×0.7/stable×1.0 (`:88-90`). Persisted `content_gaps.opportunity_score`, read `ORDER BY opportunity_score DESC NULLS LAST` at `server/content-gaps.ts:97` (row iface `:39`, mapper `:68`).
- Authority: `classifyKdGap` `authority-context.ts:16` (kdGap≥30 very-challenging, ≥15 challenging, ≤−20 within-reach, else aligned); `KD_SCORE_MULTIPLIER {0.6,0.8,1.0,1.2}` `:25-30`; `adjustKdImpactScore` `:32`; `backlinkProfileToAuthorityStrength` (referringDomains ≥120→80, ≥30→50, else 20) `:50`.
- `domainStrength` proxy: `resolveDomainStrength` `recommendations.ts:859-868` — `organicKeywords ≥1000→80, ≥100→50, else 20` (CC3 root cause). Consumed at `:919`, fed into `adjustKdImpactScore` only at content-gap `:1166`.
- `conversionMap` built `:923`, applied only to technical traffic-score path (`:940, :973, :1001`).
- Per-branch outcome adjustment `applyRecommendationOutcomeAdjustment` (decl `:127`) called at **11 sites** with varying args: `:1017, :1069, :1123, :1191, :1244, :1293, :1352, :1418, :1468, :1521` — the design unifies these through one scorer.
- Static `estimatedGain` constants: `RECOVERY_RATES` table `recommendations.ts:62-104` (`DEFAULT_RECOVERY` `:69`), interpolated `:1012`; per-branch `estimatedGain` strings at `:1038, :1090, :1144, :1213, :1266, :1314, :1373, :1439, :1489, :1542` (Q7 target).

### Scanner 2 — `impactScore` / rec-set / `topRecommendationId` consumers (the no-op boundary)

`impactScore` appears **40×** in `recommendations.ts`.

| Consumer | CURRENT line | Reads | Stays no-op? |
|---|---|---|---|
| `sortRecommendations` (tier→impactScore→intent) | `:518-540` | `b.impactScore − a.impactScore` at `:535` | **YES** — reads field, not how it was computed |
| `topRecommendationId` derivation | `:428` (`activeRecs[0].id`), set in summary `:439` | sorted-array head | **YES** |
| `computeRecommendationSummary` | `:402` (decl), top-id `:428` | sorted recs | **YES** |
| `Recommendation.impactScore` type | `shared/types/recommendations.ts:18` | — | **YES** — M107 adds optional `opportunity?`, `impactScore` becomes derived read |
| `RecommendationSet.summary.topRecommendationId` | `shared/types/recommendations.ts:49` | — | **YES** (summary gains `topOpportunityRationale`) |
| Client `#1` card | `src/components/client/OverviewTab.tsx:98` (`recSet?.summary?.topRecommendationId`) | summary | **YES** |
| React Query key | `queryKeys.shared.recommendations(workspaceId)` — `src/hooks/useRecommendations.ts:15,40`; invalidated `src/hooks/useWsInvalidation.ts:345` | key only | **YES** — same key carries re-rank |
| WS event | `WS_EVENTS.RECOMMENDATIONS_UPDATED` `server/ws-events.ts:125`; FE handler `useWsInvalidation.ts:343` | event name | **YES** |
| Client list render | `InsightsEngine.tsx:521` (renders `rec.estimatedGain`) | string field | **YES** for sort; **NEEDS-CHANGE** for Q7 (gain text re-grounded) |

**Consumers that NEED a change (not by the sort axis, but to deliver design value):**
- `server/admin-chat-context.ts:845-846` — `recSummary` keeps only `{title,type,priority,impact,effort}`; **must add** `impactScore`, `emvPerWeek`, `isTopRecommendation` (MW6).
- `server/routes/public-content.ts:216-220` — quickWins serializer strips `roiScore` (picks only `pagePath/action/estimatedImpact/rationale`); **must add** `roiScore` + ROI badge + breakdown (SI3). ContentGaps serializer already carries `opportunityScore`+`trendDirection` at `:200-214` (no change).
- `server/intelligence/formatters.ts:288` (`formatSeoContextSection`) — emits siteKeywords/pageKeywords/competitorSnapshots; **must add** `topOpportunity` + top-3 components branch (SI2). Blessed precedent `effectiveBrandVoiceBlock` injected directly at `:77,:301`.

### Scanner 3 — Pinning / coverage tests (must be updated in lockstep with the scorer)

Tests that hard-assert current magic-constant scoring behavior and will break (or must be re-pinned to OV / golden fixtures):
- `tests/unit/recommendations-pure-logic.test.ts` — asserts `RECOVERY_RATES` exact strings + `computeImpactScore` (imports both).
- `tests/unit/recommendations-extended.test.ts` — `computeImpactScore`, `estimatedRecoverableImpressions`, outcome action-type mapping.
- `tests/integration/recommendations-recovery-rates.test.ts` — exact `perRec`/`summary` recovery-rate values + weighted summary `toBe(214)`.
- `tests/unit/recommendations-top-id.test.ts` — `computeRecommendationSummary` topRecommendationId pointer (no-op boundary regression guard — **keep, must stay green**).
- `tests/unit/recommendations-intent-ranking.test.ts` — `sortRecommendations` (impactScore SECONDARY, intent tiebreaker — **keep, validates no-op sort**).
- `tests/unit/recommendations-authority-kd.test.ts` — `classifyKdGap` boundaries + `adjustKdImpactScore` (extend as authority routes through all branches).
- `tests/unit/score-preservation.test.ts` — `applyScoreAdjustment` ledger math (`_originalBaseScore`, `_scoreAdjustments`) — anomaly/outcome bridge path.
- `tests/integration/recommendations-ctr-gap.test.ts` — CTR-gap rec priority/type/trafficAtRisk assertions.
- `tests/contract/outcome-publish-triggers-rec-regen.test.ts` — asserts cron import order + `queueKeywordStrategyPostUpdateFollowOns` ordering (Spine B publish/apply tail must not regress this).
- `tests/unit/content-gap-opportunity-score.test.ts`, `tests/unit/keyword-strategy-helpers.test.ts`, `tests/unit/quick-wins.test.ts`, `tests/unit/keyword-strategy-enrichment.test.ts` — grounded-composite math (roiScore/opportunityScore) the scorer consumes.
- Broader rec lifecycle/resolution suite (no-op boundary regression surface): `tests/integration/recommendations-lifecycle.test.ts`, `recommendation-resolution.test.ts`, `recommendations-read-routes.test.ts`, `seo-apply-resolves-recommendations.test.ts`, `bulk-accept-resolves-recommendations.test.ts`, `approval-resolves-recommendations.test.ts`, `work-order-resolves-recommendations.test.ts`, `bulk-seo-fix-resolves-recommendations.test.ts`, `scheduled-audits-dedup.test.ts`.

### Scanner 4 — Flag / migration / slice / event mechanics (verified current lines)

**Feature flags** — all in `shared/types/feature-flags.ts` (798 lines; server `server/feature-flags.ts` is only the 138-line resolver):
- `FEATURE_FLAGS` defaults `:12`; `FeatureFlagKey` `:81`; rollout-target union (`staging-validation` `:86`, `tiered-client-rollout` `:89`).
- `FEATURE_FLAG_CATALOG` `:151`; precedent `intelligence-shadow-mode` entry `:339` (`rolloutTarget:'staging-validation'` `:345`).
- `FEATURE_FLAG_GROUPS` `:682`; `assertFeatureFlagGroupingConsistency` **decl `:772`**, **boot-time call `:798`**.
- Server resolver: `isFeatureEnabled` `server/feature-flags.ts:87`; `feature_flag_overrides` DB-backed (`:42-48`, `setFlagOverride` `:129`) — confirms CC5 live state lives in DB/env, not source.
- `outcome-tracking` (default false `:29`, catalog `:152`, `rolloutTarget:'tiered-client-rollout'` `:158`); `outcome-ai-injection` (default false `:31`, catalog `:204`, `:210`).

**Migrations** — latest is `server/db/migrations/106-action-outcome-value.sql`; new files **107+** (matches design M107–M111). `action_outcomes.attributed_value` written by `recordOutcome` `server/outcome-tracking.ts:286` (value `:312`); column added by migration 106.

**Slices** — `SeoContextSlice` `shared/types/intelligence.ts:133`; current fields include `strategy`, `effectiveBrandVoiceBlock` (`:152`, authority precedent), `pageKeywords`, `backlinkProfile`, `competitorSnapshots`. **Absent (net-new):** `quickWins[]`, enriched `contentGaps[]` (only the thin `string[]` at `:225`), `cannibalizationIssues[]`, `topOpportunity`. `listQuickWins` and `listCannibalizationIssues` have **zero importers under `server/intelligence/`** (SI1, SI4 confirmed; cannibalization importers are cannibalization-issues, keyword-strategy-*, mcp/tools/content, routes/* only).

**Events / crons:**
- `debounceBridge(flag, delayMs)` `server/bridge-infrastructure.ts:155` (existing instances `:230-235`).
- `RECOMMENDATIONS_UPDATED` `server/ws-events.ts:125`; FE handler `useWsInvalidation.ts:343` → invalidate `:345`.
- Decay: `analyzeContentDecay` runs **only** on admin POST `server/routes/content-decay.ts:26` — **no decay cron** (Spine B P7 must add `runDecayScan()` to `server/outcome-crons.ts`, host decl `startOutcomeCrons` `:36`).
- Competitor: weekly cron `server/intelligence-crons.ts` writes `competitor_alert` via `upsertInsight` `:129` (`insightType:'competitor_alert'` `:132`), read zero times by the rec engine.
- Rank decline: `positionChanges.declined` computed `server/intelligence/seo-context-slice.ts:88` (object `:98`).
- Publish/apply: `resolveRecommendationsForChange` `recommendations.ts:334` (flips to completed only; design adds a `reprioritize` tail).
- `trendDirection()` `server/seo-provider-signals.ts:6` consumes the 12-month array then drops it (M110 source).
- Frozen-snapshot mechanics (Q5/SI5): `generateRecommendations` has exactly 4 callers — POST `routes/recommendations.ts:29`, first-GET `:42` (gated `if(!set)` `:40`), `keyword-strategy-follow-ons.ts:83`, `routes/jobs.ts:238`. `scheduled-audits.ts` calls `invalidateIntelligenceCache` + writes `audit_finding` but **never** `generateRecommendations`.

### Scanner 5 — Grounded data fields (exact names + nullability)

`shared/types/workspace.ts` — `PageKeywordMap`: `searchIntent?` `:26`, `currentPosition?` `:27`, `impressions?` `:30`, `gscKeywords?: {query,clicks,impressions,position}[]` `:32`, `volume?` `:34`, `difficulty?` `:35`, `cpc?` `:36` (all **optional**). `cpc` exists but is read **zero times** today — gates Open Risk #1.
`shared/types/intelligence.ts` — `contentGaps`: `volume?` `:84`, `difficulty?` `:85`, `trendDirection?: 'rising'|'declining'|'stable'` `:86`, opportunity score `:96` (optional).
`shared/types/recommendations.ts` — `Recommendation` iface `:8`; `impactScore: number` `:18` (required); `summary.topRecommendationId: string | null` `:49`. **No `opportunity` field exists** (M107 adds `opportunity?: OpportunityScore`, optional for legacy rows).
Authority signal: `BacklinkProfile.referringDomains` (drives `backlinkProfileToAuthorityStrength`); only DA-equivalent surface; `DomainOverview` has no industry DA integer (accepted residual, owner-decided proxy).

### Scanner 6 — Prevention (existing pr-check rules / verifications)

`scripts/pr-check.ts` (7846 lines, **158 rules: 139 error, 19 warn**):
- **Authority-layered reintroduction rule** `:1166` (`name: 'formatBrandVoiceForPrompt reintroduction'`, pattern `:1167`, message `:1174`, rationale `:1176`) — this is the rule the design relies on to mechanically block any `formatOpportunityForPrompt(raw)` helper. Sibling authority rules: `client_business_priorities` direct-read `:1207`, `effectiveBusinessPriorities` `:1244`.
- **Consumer-builder rule** `:1471` (name) / `:1487` (message) — intelligence consumers must use `buildRecommendationGenerationContext` etc.; `// intel-builder-ok` hatch.
- **`getOrCreate* returns nullable`** `:2107` — M111 `workspace_opportunity_weights` `getOrCreate` must return non-nullable to pass.
- DB lockstep / `public-portal.ts` activity + serialization rules (`:214, :3613`); JSON-parse, transaction-guard, workspace-scoping rules (per CLAUDE.md "DB patterns").
- Verifications: `npm run verify:feature-flags` (catalog consistency), `npm run verify:coverage-ratchet`, `npm run typecheck` (`tsc -b`), `npx vite build`, `npx vitest run`.
- **No existing rule prevents a producer from inventing a new magic-constant `impactScore` scale or bypassing `computeOpportunityValue`** — this is the systemic gap (see §6).

---

## No-op-boundary verdict

**HELD.** Under exhaustive scan, writing the OV result into the existing `impactScore` field is a no-op at every *sort/identity* consumer:
- `sortRecommendations` (`recommendations.ts:535`) reads `impactScore` only — agnostic to how it was computed.
- `topRecommendationId` (`:428`/`:439`), `computeRecommendationSummary` (`:402`), client `#1` card (`OverviewTab.tsx:98`), React Query key (`useRecommendations.ts:15,40`), WS event + FE handler (`ws-events.ts:125` / `useWsInvalidation.ts:343,345`) — all unchanged.
- The `Recommendation`/`RecommendationSet` types extend additively (`opportunity?`, `summary.topOpportunityRationale`), legacy rows tolerate absence via `.optional()` Zod.

**No consumer breaks the sort no-op.** The three consumers that need edits do so to *surface new value*, not because the field semantics changed:
1. `admin-chat-context.ts:845-846` — additive `recSummary` fields (MW6).
2. `routes/public-content.ts:216-220` — additive `roiScore` + breakdown (SI3).
3. `intelligence/formatters.ts:288` — additive `topOpportunity` branch (SI2).
4. Client gain text `InsightsEngine.tsx:521` re-grounds `estimatedGain` (Q7) — same field, new value, no render change.

Caveat the plan must hold: `normalizeToScore` is per-workspace percentile, so a "70" is not cross-workspace comparable — accepted/flagged in the design (§2.6); the absolute meaning travels in `emvPerWeek`, admin/AI-only per owner decision.

---

## Design corrections / surprises

**Confirming the two known citation corrections (with current lines):**
1. **Feature-flag catalog/groups/assert live in `shared/types/feature-flags.ts`, not `server/feature-flags.ts`.** CONFIRMED. `FEATURE_FLAG_CATALOG:151`, `intelligence-shadow-mode:339`, `FEATURE_FLAG_GROUPS:682`. Server file is the 138-line resolver.
2. **`computeOpportunityScore` ceilings are `volume/10000` and `impressions/2000`.** CONFIRMED at `keyword-strategy-helpers.ts:84` and `:86`. Not `/50000`/`/20000`.

**New line-number corrections found this scan (date roll shifted some):**
- `assertFeatureFlagGroupingConsistency` — design (§7 + appendix) cites **`:773`**; current is **decl `:772`, boot call `:798`**. Plan must reference `:772`/`:798`.
- `computeImpactScore` sevBase magic line — design cites **`:586`**; current is **`:584`** (decl `:577`).
- `estimatedGain` recovery constants — design cites **`:69-108`**; current `RECOVERY_RATES` is **`:62-104`**.
- `sortRecommendations` — design cites **`518-541`**; current is **`518-540`**.
- `positionChanges.declined` — design/audit cite **`:87`**; `declined` computed at **`:88`**, object at **`:98`**.
- `public-content.ts` quickWins serializer — design cites **`:217-219`**; current is **`:216-220`** (contentGaps `opportunityScore`/`trendDirection` at `:200-214`, not `:210-214`).
- `competitor_alert` write — design cites **`:132`** (the `insightType` line); the `upsertInsight(` call is at **`:129`**.
- `buildOutcomeAdjustment` factor lines — design cites `:29-40`/`:36-42`/`:47-49`; current is `:29-33` (actionType), `:36-41` (difficulty), `:46-48` (identity short-circuit). Function decl `:44`.

**Surprises / things to flag (none contradict the design's architecture):**
- The freshness magic reads a variable named `trafficAtRisk` (= `d.impressions ?? 0`) at `:1514`, not literally `impressions/50`. Same semantics; the plan's grep should target `trafficAtRisk / 50`.
- `diagImpactMap` (diagnostic branch `:1462`, `75/55/35`) is a **6th** magic site distinct from the quick-win `75/55/35` at `:1118`. The design's §2.2 table lists 6 producer branches but the diagnostic site shares the technical branch row — the plan must explicitly enumerate `:1462` as its own call site so it is not missed.
- `applyRecommendationOutcomeAdjustment` is invoked at **11** call sites (not "per ranking-opp/content only"); the design's claim that the unified scorer makes calibration uniform is correct, but the plan must delete/refactor all 11.
- `roiScore` client-side `.sort()` at `keyword-strategy-enrichment.ts:804` is a second, independent sort axis that the design does not mention — harmless (it orders the persisted quickWins list, not recs), but the plan should note it exists so it isn't mistaken for a rec-engine path.

---

## Existing coverage (must respect)

- **pr-check rules** the design's invariants depend on: authority-layered reintroduction `:1166` (blocks `formatOpportunityForPrompt` helper — keep relying on it), consumer-builder `:1471/:1487`, `getOrCreate* nullable` `:2107` (M111 must satisfy), DB lockstep + `public-portal.ts` serialization, JSON-validation/transaction/workspace-scoping rules.
- **Verifications:** `npm run verify:feature-flags` (the 3 new flags must pass catalog+group consistency or boot `assertFeatureFlagGroupingConsistency` `:798` throws), `npm run verify:coverage-ratchet`, `typecheck` (`tsc -b`), `vite build`, `vitest run`.
- **Pinning tests to keep green (no-op proof):** `recommendations-top-id.test.ts`, `recommendations-intent-ranking.test.ts`, the full rec-resolution/lifecycle integration suite, `outcome-publish-triggers-rec-regen.test.ts`.
- **CLAUDE.md laws:** Slice architecture (`:180` — new slice fields go through `assemble*` + `buildWorkspaceIntelligence()`, never direct slice reads); authority-layered single resolved representation (`:254`); DB column + mapper lockstep incl. `public-portal.ts` (`:261`); phase-per-PR + dark-launch flags; staging→main; client framing (no purple, narrative ROI).

---

## Infrastructure recommendations

**Shared utilities to extract (Phase 0 / P1):**
- `server/scoring/opportunity-value.ts` — the pure `computeOpportunityValue(input): OpportunityScore` (side-effect-free, golden+unit tested).
- A per-workspace `CTR(pos)` curve helper calibrated from `gscKeywords` (`workspace.ts:32`) with a logged industry fallback — so the CTR curve does not become new ungrounded magic.
- A `pickImpactScore(rec, flag)` selector (legacy vs OV) — single chokepoint for the cutover.
- `OpportunityScore` / `OpportunityComponent` / `OpportunityInput` types in `shared/types/recommendations.ts`; `OpportunityEvent` types for M108.

**NEW pr-check rules to prevent regression of design invariants:**
1. **Magic-scale guard** — flag any new `impactScore = <literal>` / inline `'high'?75:...` bucket in `recommendations.ts` outside `computeOpportunityValue`. (Closes the systemic root cause; `// scorer-ok` hatch.) This rule does not exist today.
2. **`formatOpportunityForPrompt` reintroduction** — extend the existing authority-layered rule (`:1166`) to also block a generic OV format helper; advisor must inject `opportunity` directly (precedent `effectiveBrandVoiceBlock`).
3. **Public serializer must not strip `roiScore`/`opportunity`** — assert `public-content.ts` quickWins pick list includes `roiScore` (guards SI3 regression).
4. **OV slice fields read via `buildWorkspaceIntelligence()`** — covered by existing slice rule; add a contract test that `topOpportunity`/`quickWins`/`cannibalizationIssues` are present on the assembled slice.

**Systemic root cause:** every producer was free to invent its own 0–100 scale because nothing forced a single scoring function — the platform has a unified *AI dispatcher* and *intelligence builder* but no unified *scorer*. The fix is structural (one pure fn + a pr-check rule that forbids re-inventing the scale), mirroring how `callAI()` and `buildWorkspaceIntelligence()` already chokepoint their domains.

---

## Parallelization strategy

**Phase 0 — Shared contracts (single-owner, NO parallelism, must land first):**
- `shared/types/recommendations.ts` — `OpportunityScore`, `OpportunityComponent`, `OpportunityInput`; `Recommendation.opportunity?`; `summary.topOpportunityRationale`. (Maps to design **P1** types.)
- The 3 feature flags in `shared/types/feature-flags.ts` — `FEATURE_FLAGS` default, `FEATURE_FLAG_CATALOG` entry (lifecycle block), `FEATURE_FLAG_GROUPS` membership (or boot assert `:798` throws): `opportunity-value-scorer`, `opportunity-value-events`, `opportunity-value-calibration`.
- Migrations **M107–M111** SQL + row ifaces + mappers + Zod (`.optional()`), dark-launched. (Design **P2** gates everything; M108/M109/M110/M111 land before the spines that read them.)
- `server/scoring/opportunity-value.ts` pure fn + `pickImpactScore` selector. (Design **P1**.)

These are the types/migrations/flags that MUST exist before any spine branch compiles. One owner, one PR sequence P1→P2.

**Parallel phases (exclusive file ownership per task), mapping to design P3/P5/P6/P7:**

| Task | Design phase | EXCLUSIVE files |
|---|---|---|
| Spine A — wire OV into all 6 branches behind flag-off `pickImpactScore` | P3 | `server/recommendations.ts` (sole owner — all scoring sites + 11 outcome-adjust calls), consumes `opportunity-value.ts` |
| Spine C — M109 authority + realized-$ calibration + M111 weights | P5 | `server/authority-context.ts`, `server/outcome-learning-default-path.ts`, `server/db/migrations/109/111`, `workspace_authority`/`workspace_opportunity_weights` stores |
| Spine D — slice/formatter/MCP/public chain | P6 | `shared/types/intelligence.ts`, `server/intelligence/seo-context-slice.ts` + new slice reads, `server/intelligence/formatters.ts`, `server/admin-chat-context.ts`, `server/routes/public-content.ts`, `src/components/client/types.ts` + `OverviewTab.tsx` |
| Spine B — M108 events + decay cron + decaying Timing (own flag) | P7 | `server/db/migrations/108`, `server/outcome-crons.ts`, `server/intelligence-crons.ts`, new `opportunity-events` store + `enqueueOpportunityRegen` |

**Dependency graph:** P1→P2 gate all. P3/P5/P6/P7 run in parallel behind flag-off (no shared files — `recommendations.ts` is Spine A's alone; Spine D touches consumers, Spine C touches authority/calibration, Spine B touches crons/events). **P4** (shadow dual-compute + `ov_divergence` logging + dashboard) depends on P3. **P8** (flip ladder, config-only) depends on P4 + the validation gate. Diff-review + `scaled-code-review` after each parallel batch (CLAUDE.md multi-agent rule).

---

## Model assignments

| Task type | Model | Reasoning |
|---|---|---|
| Phase 0 shared contracts (types, flags, migration scaffolds, pure-fn signature) | **Opus** | Cross-context, single-owner, every downstream task depends on it — get the contract exactly right |
| `computeOpportunityValue` pure fn + EMV/CTR-curve math + golden tests | **Opus** | Economic model with calibration logic; the load-bearing correctness surface |
| Spine A — wire OV into 6 branches + delete 11 magic sites/outcome calls | **Sonnet** | Local judgment, bounded to one file, contract pre-set by Phase 0 |
| Spine C — authority M109 / realized-$ calibration / M111 weights | **Sonnet** | Domain logic with clear contract; calibration math reviewed by Opus |
| Spine D — slice/formatter/MCP/public chain | **Sonnet** | Mechanical wiring across known consumers, additive fields |
| Spine B — events/decay cron/Timing multiplier | **Sonnet** | Builds on verified `debounceBridge`/WS infra; bounded files |
| Migration SQL + row iface + mapper + Zod lockstep | **Haiku** | Mechanical, pattern-replicated (lockstep template), pr-check-gated |
| New pr-check rules + contract tests | **Haiku** | Pattern-following against `pr-check-rule-authoring.md` |
| P4 shadow divergence logging + dashboard | **Sonnet** | Structured logging, modest judgment |
| Final scaled-code-review across the parallel batch | **Opus** | Cross-module correctness the single-agent reviewers miss |

(Codex-platform equivalent ladder per CLAUDE.md: GPT-5.4-Mini = Haiku, GPT-5.4 = Sonnet, GPT-5.5 = Opus.) **Execution note:** in *this* environment, workflow subagents must use **sonnet/opus only** — haiku workflow agents hit a known MCP-schema spawn bug. Haiku-tier tasks above will be run by sonnet agents.

---

## Open risks for the plan

1. **CPC population (Open Q#2).** `cpc` (`workspace.ts:36`) exists but is read **zero times**; population rate on the 2 live workspaces is unverified. **Must be audited in P1 during fixture capture.** If mostly null, `valuePerClick` degrades to the intent-weight tier (economically sound, but "$" framing becomes intent-driven). Owner-decided: client never sees `$X/wk` regardless, so client-visible risk is bounded; admin/AI `emvPerWeek` accuracy is the open call.
2. **Live flag state (CC5, Open Q#5).** `outcome-tracking` + `outcome-ai-injection` default false (`feature-flags.ts:29,31`); actual per-client state lives in `feature_flag_overrides` DB / env — **not in source.** Both carry `rolloutTarget:'tiered-client-rollout'` so they may already be on. Gates whether calibration ever fires. Human/empirical confirmation required before claiming Spine C self-corrects.
3. **CTR-curve calibration.** The per-workspace `CTR(pos)` curve needs ≥N GSC observations; the industry fallback must be logged-as-evidence and bounded so it cannot become new ungrounded magic (design's own flagged risk). Capture the fallback-vs-calibrated threshold empirically.
4. **Golden-test data capture.** Golden tests must be pinned on both live workspaces' **real** data (design §7 gate). Requires a sanctioned data capture from staging (`db:sync-staging`) — a human/data call, and the data must be scrubbed before it enters the test fixtures.
5. **Event re-rank aggressiveness + Timing hijack (Open Q#3).** Whether a high-boost competitor event may take `#1` pre-calibration is owner-deferred (default: bounded so it cannot). Boost/half-life constants are uncalibrated until `action_outcomes` history accrues — ship behind `opportunity-value-events` flag, shadow-logged, `emvPerWeek` floor enforced.
6. **Cross-workspace incomparability of `value`.** `normalizeToScore` percentile means "70" differs across clients (accepted, §2.6). N=2 means the validation gate is owner-review-based, not statistical — no fake significance.
