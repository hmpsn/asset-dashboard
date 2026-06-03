# SEO Strategy + Keyword Generation — Quality Improvement Plan

**Date:** 2026-06-02 · **Method:** multi-agent plan tournament (4 plans → 3-judge panel → synthesis), then a **global blind-spot sweep** (upstream inputs · downstream consumers · contract ripple · adjacent subsystems → completeness critic). **Status:** hardened, pending owner approval to execute.
**Grounding:** `docs/audits/2026-06-02-seo-strategy-keyword-recommendations-audit.md`

All claims verified against source. Key confirmations: `KeywordStrategy.tsx:142-143` defaults to `quick` when a provider exists; MCP `job-actions.ts:92` passes `seoDataProvider` only (no mode, no data); `ov-calibration.ts:16-33` literally anticipates the `predicted_emv` swap; `isFeatureEnabled(flag)` at `feature-flags.ts:87` takes no `workspaceId` (flag is global — per-workspace rollout is genuinely net-new work); OV's `valuePerClick = cpc × intentWeight` only (GA4 value not threaded); `recommendations.ts:1278` reads only `listContentGaps` (keyword_gaps/topic_clusters/cannibalization have zero reads).

> **Hardening note (2026-06-02).** A global blind-spot sweep was run *because the prior inbox feature shipped without its substance.* For a generation-quality plan the danger is worse: changed output flows into consumers that do **not error** — they quietly under-serve or diverge. The sweep found one inbox-equivalent (the predicted-EMV field the plan exists to enable is dropped on read, leaked to clients, and clobbered by the plan's own regen — **G0** below) plus 15 reader/contract gaps. **All are now folded into the phase that changes their contract**, governed by the mandatory **Consumer Contract Check** (§5). Two owner decisions are locked in: (1) the predicted EMV ships as a **documented CPC-proxy placeholder** (real GA4 value in P6); (2) `content_gaps.opportunity_score` is **recomputed from OV EMV** so recs, brief candidates, and the upsell badge share one basis.
>
> **Pre-execution verification (2026-06-02).** Two further adversarial passes ran before execution: (a) plan completeness/correctness/consistency (all 17 G-items + both decisions confirmed folded in; 7/8 load-bearing file:line claims exact); (b) **CLAUDE.md conformance + codebase structural reality** (10/10 structural assumptions confirmed; verdict **GO WITH AMENDMENTS**). Five blocking lockstep gaps (B1–B5) and eight should-adds (S1–S8) are now folded into the phase bodies + the per-phase Definition of Done (§5.4). **Naming convention:** the TypeScript field is `predictedEmv` (camelCase, matching `OpportunityScore`); `predicted_emv` is the SQL column name only.

---

# Recommended Plan: Keyword-Strategy + Recommendation Quality

## 1. THE VERDICT

**Execute a HYBRID with Plan A (surgical) as the chassis.** Plan A won every panel on the dimension that matters most here — it is the only plan that closes *all four* verified defect classes (sparse-generation, OV cross-tier incoherence, orphaned tables, scheduled-audit staleness) at the lowest blast radius with revertable per-PR phasing, and it correctly sequences the highest-symptom-relief work (universe-starvation + shape-validation) first. We graft four ideas A cannot reach: **D's `buildKeywordUniverse` assembler** (fix MCP starvation + whole-pool-US geo in *one* shared seam), **B's closed-set evidence-grounded prompting** (kill invented keywords and silent empties together), **C's `predicted_emv` persistence + OV-derived tier** (coherent ranking + calibration dependency), and **B's deterministic eval fixtures + `generationQuality` telemetry** pulled forward cheaply (but *not* B's full parallel `core-v2` + always-on shadow generation, which doubles every run's cost). Semantic/embedding business-fit is deferred to an explicit, telemetry-gated fast-follow (P6) — no embedding infrastructure exists today, and the Faros symptom is over-determined by input starvation, which P1–P2 resolve.

| Plan | Quality lens | Feasibility lens | Root-cause lens | Verdict role |
|---|---|---|---|---|
| **A — surgical** | **42** (1st) | **42** (1st) | **40** (1st) | **Chassis** — phased spine, risk posture, complete defect sweep |
| **B — gen-rebuild** | 36 (2nd) | 35 (4th) | 36 (3rd) | Graft: closed-set prompting + eval fixtures; defer embedding fit |
| **C — ov-first** | 35 (3rd) | 36 (3rd) | **39 (2nd)** | Graft: `predicted_emv` persistence + OV-derived tier |
| **D — data-first** | 35 (4th) | **38 (2nd)** | 35 (4th) | Graft: `buildKeywordUniverse` assembler (geo + MCP seed) |

Consensus: A first on all three panels; B highest *ceiling* but worst *feasibility*; C best *end-state* but optimizes the half that was **not** the verified symptom cause; D sharpest *input-starvation* diagnosis but scopes the live tier-vs-OV incoherence out.

---

## 2. WHY

**A is the chassis because the verified primary symptom is upstream.** The sort at `recommendations.ts:586` is `priorityOrder[a.priority]` *first*, impactScore second — and `pickImpactScore` writes OV at `:1862` *after* `recordOvDivergence` but the tier is a legacy heuristic, so OV provably only re-orders *within* a tier. `estimatedGain` at `:1110-1113` still renders `getRecoveryRate` legacy percent strings while ranking reads OV — a live, client-facing incoherence. And the sparse symptom is upstream of all of it: `KeywordStrategy.tsx:142-143` defaults provider workspaces to `quick`; discovery/related/question sources are gated behind `if (seoDataMode === 'full')` at `keyword-strategy-seo-data.ts:246`; the MCP path (`job-actions.ts:92`) passes `seoDataProvider` only. A fixes every one of these on an existing seam, revertably.

**The strongest idea grafted from each runner-up** (D's assembler, B's closed-set prompting + eval fixtures, C's `predicted_emv` + OV-derived tier) is detailed inline in each phase below.

**What we honestly do NOT do (the residual ceiling):** business-fit stays *lexical token-overlap* (`rules.ts:166-174`); we stop *suppressing* lexically-unmatched-but-real keywords (P2) but do not yet *score* them semantically; OV stays out of the meeting brief and MCP keyword ranking *unless* the trace gate (§5.2) requires it; SERP-feature crowding stays advice text until P6. These are deferred deliberately, gated on telemetry.

---

## 3. THE RECOMMENDED PHASED PLAN

Risk-ordered: fast wiring/sparse fixes first (likely resolves Faros in P1–P2), then coherence, then coverage, then the measured quality ceiling. Every phase is one PR, flag-gated, independently revertable, and **subject to the Consumer Contract Check (§5).**

---

### Phase 0 — Quality harness + telemetry + guardrails (ship first)
- **Goal.** Make every later phase measurable; convert silent failures into observable ones; write the cross-system guardrails *before* the first contract change (CLAUDE.md Session-Protocol #7).
- **Scope + key files.**
  - Add a `generationQuality` telemetry record (pool size, suppressed count, AI-returned-vs-backfilled count, floor-hit flag) emitted from `keyword-strategy-generation.ts`. **Define a typed `GenerationQuality` interface in `shared/types/` before emitting** (Data-Flow #5 — never an inline object / `Record<string,unknown>`; if persisted to a JSON column, apply the column lockstep).
  - Add deterministic eval fixtures per `docs/rules/ai-quality-evals.md`: a Faros-like sparse workspace asserting ≥6 content gaps (fails red until P1–P2 — that is the acceptance bar); a malformed-AI-response fixture asserting a throw (not empty). **Allocate a unique test port** (`grep -r 'createTestContext(' tests/`; current range 13201–13899) and kill orphan 13xxx ports before commit.
  - Register the per-workspace flag dimension — add `isFeatureEnabled(flag, workspaceId?)` with rollout-target resolution in `server/feature-flags.ts` (today line 87 takes flag only — **52 call sites**, verified global). **Changing this public-function signature requires the rename doc-sweep (S1):** grep `CLAUDE.md` + all `docs/rules/*.md` for `isFeatureEnabled` usage examples (notably `development-patterns.md`, `feature-flag-lifecycle.md`) and update them in the same commit. **Note (net-new, not wiring):** `rolloutTarget` is *static per-flag catalog metadata* today (`shared/types/feature-flags.ts:109-126`) with **no runtime per-workspace resolver anywhere** — the per-workspace dimension is genuinely new logic. Add the new flag to `shared/types/feature-flags.ts` before commit 1, declare its `lifecycle.rolloutTarget`, pass `npm run verify:feature-flags`, and document the new resolution semantics in `feature-flag-lifecycle.md`.
  - **Guardrails (per Session-Protocol #7):** author `docs/rules/seo-generation-quality.md` recording the four changed contracts (the rec/`opportunity` shape, the priority-tier source, the gain string, the keyword-universe sources) and their **full reader lists**. Add two mechanizable pr-check rules: (1) *"any admin-money field added to `opportunity` must appear in `stripEmvFromPublicRecs`"*; (2) *"a new `RecType`/`RecSource` must have a `REC_SOURCE_CATEGORIES` entry + a real `recommendationOutcomeActionType` case (no `audit_fix_applied` fallback for strategy sources)."* **Then run `npm run rules:generate`** — the rule count moves from 161 and CI hard-fails if `docs/rules/automated-rules.md` drifts.
- **Effort.** M–L. **Risk.** Low (additive; no behavior change).
- **Quality lift.** None directly; it is the measurement + rollout + safety substrate. Without it P1–P6 fly blind and the §5 gate has no teeth.
- **Owner gate.** None — pure infrastructure. Approve to proceed.

### Phase 1 — `buildKeywordUniverse` assembler: full pool + geo + MCP seed (the single biggest lever)
- **Goal.** Stop starving the keyword universe; fix the whole-pool-US geo bug at its source. **This phase alone is expected to resolve most of the Faros "2 gaps" symptom.**
- **Scope + key files.** Introduce `buildKeywordUniverse(workspaceId, opts)` (new module, e.g. `server/keyword-strategy-universe.ts`) as the *one* source of the candidate pool. **Define typed `KeywordUniverse` / `KeywordCandidate` interfaces in `shared/types/` before implementing** (Data-Flow #5) — this shape is a cross-module contract consumed by MCP + UI + synthesis, and P3 later attaches per-candidate `declined`/`requested`/`voteWeight`/`priority` annotations to it.
  - **(a) Geo once, threaded everywhere.** Resolve workspace geo via `resolveWorkspaceLocationCode` (`local-seo.ts:587`) and thread `database`/`locationCode` into *every* provider call (DataForSEO defaults `2840`/US when omitted — `providers/dataforseo-provider.ts:57-58`). **Also thread `language_code`** — today it is hardcoded `'en'` at **four sites** (`providers/dataforseo-provider.ts:782,787,860,904`), so a non-English market is queried in English; thread the resolved language at all four (**closes G13**). Bump the metrics cache version so already-cached workspaces don't bleed stale US/en data.
  - **(b) Discovery always-on.** Run discovery/related/question sources whenever a provider exists, with the `quick`/`full` toggle (`KeywordStrategy.tsx:142-143`) repurposed to a **credit-depth cap**, not an on/off gate.
  - **(c) Name the WHOLE universe (closes G3).** The pool is *not* only provider rows. `buildKeywordUniverse` must enumerate, as first-class sources: **GSC queries** (`keyword-strategy-ai-synthesis.ts:414-418`, `source:'gsc'`, fetched via `keyword-strategy-search-data.ts:35` from the orchestrator at `keyword-strategy-generation.ts:176`), **GA4-unmapped landing pages**, **client-tracked** (`ai-synthesis.ts:453-462`), and **client-requested** (`:464-470`) keywords. **Fold the synthesis-side pool builder (`ai-synthesis.ts:395-475`) into the assembler** — do not leave two pool builders (the exact divergence the assembler exists to kill) or silently drop the GSC/client candidates.
  - **(d) Seed the MCP/chat path** (`mcp/tools/job-actions.ts:92`) so "provider-selected" means a real universe.
  - **(e) Multi-market honesty (G14).** `resolveWorkspaceLocationCode → getPrimaryMarket` assumes a single primary market; the pending `intel-quality-keyword-per-market-relevance` documents a confirmed 27.5% cross-market noise bug. State the single-primary assumption explicitly; gate multi-market handling to the future P7 local track.
  - Cost-bounded by a per-workspace monthly credit ceiling + the existing metrics cache (keyed to include `locationCode` + `language_code`).
- **Effort.** L. **Risk.** Medium (provider cost/latency; shared MCP+UI+synthesis seam). De-risk: per-workspace credit ceiling enforced *in* the assembler; locale-keyed cache; discovery seeds capped; run `pre-plan-audit` before implementation.
- **Quality lift.** Largest single lift. Sparse sites go from domain/competitor/gap-only to a true discovery universe; non-US workspaces stop getting US volumes for the *entire* pool.
- **Owner gate.** **Approve the per-workspace provider-credit ceiling.** Confirm rollout cohort: Faros + one non-US + one broad-business workspace first.

### Phase 2 — Relax conservatism + deterministic backfill floor + `backfilled` honesty end-to-end
- **Goal.** Stop silent over-pruning; make "2 gaps" structurally impossible when candidates exist; keep the backfill promise honest all the way to the client.
- **Scope + key files.** Four tunable changes (centralized constants block):
  - **(a)** Demote the hard suppressor at `rules.ts:334-336` — keep the `-18` penalty (`:305`) but drop the `suppressed = true` escalation, so narrow-but-real keywords survive into ranking. (Token-overlap stays; we stop *killing* synonyms, we do not yet *score* them — see P6.)
  - **(b)** Tighten `_removePageCoveredContentGaps` substring `.includes()` (`enrichment.ts:101-114`) to token-subset containment.
  - **(c)** Change `isStrategyQualityDiscoveryKeyword` (`helpers.ts:48-52`) from `difficulty > 0` to `difficulty >= 0` with a volume floor.
  - **(d)** Add a deterministic **backfill**: if post-prune content-gaps < soft floor (6), re-admit highest-scoring pruned candidates by `scoreDelta` until floor met, tagged `backfilled`.
  - **(e) Wire `backfilled` end-to-end (closes G6).** `content_gaps` is a **real normalized table** (migration 086), *not* a JSON blob — so this is a full **DB column + mapper lockstep**, all in this PR (CLAUDE.md): (1) a **new migration** adding the `backfilled` column; (2) `ContentGapRow` (`server/content-gaps.ts:30-42`); (3) **both** mappers — `rowToModel()` (`:47-70`) and `modelToParams()` (`:72-95`); (4) the `INSERT … ON CONFLICT` column list (`:106-126`); then the read-side chain: the public field map (`routes/public-content.ts:203-218`, an explicit whitelist that silently drops unlisted fields) → the client `ContentGap` type (`src/components/client/types.ts:136`) → the renderer/sort (`StrategyContentOpportunitiesSection.tsx:351-352`). State which store owns `backfilled`; if it is *also* written into the legacy `keywordStrategy` JSON blob (gaps path), mark it `.optional()` in `keywordStrategySchema` or every `parseJsonSafe` returns the empty fallback (Schema-vs-stored-shape, the `pageMap` canonical failure). **Acceptance:** a `GET /api/public/...` test (not the admin route) asserting a backfilled gap renders with the tag through the whitelist.
  - **(f) De-pad the `recommendations_ready` email (closes G11 — a fix, not just a trace note).** The email count (`server/email-templates.ts:933`, sent via `server/email.ts:345`) is a raw rec count; exclude `backfilled` items (or count them separately) so clients aren't emailed "12 recommendations" padded with marginal backfill.
- **Effort.** M. **Risk.** Medium (changes output volume; backfill can re-admit a marginal keyword — mitigated by score-ordering + the `backfilled` tag + telemetry).
- **Quality lift.** Directly kills the sparse symptom; narrow workspaces get a populated, floor-guaranteed gap list; the client can *see* what is backfilled vs. organically strong.
- **Owner gate.** **Approve the soft floor value (6) and the un-suppress demotion.**

### Phase 3 — Zod-validated named ops + closed-set evidence-grounded prompting (preserving the client-signal contract)
- **Goal.** Eliminate the silent-empty failure mode; make invented keywords structurally impossible — **without dropping the client-signal guarantees layered on these calls.**
- **Scope + key files.** Register two named operations in `server/ai-operation-registry.ts` — `keyword-page-assignment` and `keyword-site-synthesis` — each with `responseFormat`/`json:true` and a **Zod schema validated post-parse** (today neither has a shape check; a malformed-but-parseable response silently yields empty `contentGaps`). On schema-fail, **retry once with the validator error fed back**, then fall back to the P2 deterministic backfill — never emit empty.
  - *Graft from B:* pass the candidate pool as an enumerated list; require the AI to **select + justify by source row id**, attaching per-candidate evidence (volume, KD, GSC impressions, competitor proof) so grounding is structural.
  - **Preserve the client-signal contract (closes G4).** Declined-exclusion (`ai-synthesis.ts:242-252, :470-471`), requested-keyword "MUST appear as a content gap" (`:257-259, :464`), content-gap-vote prioritization (`:267-268`), and business priorities (`:270-271`) are prompt-side instructions on these same calls. The closed-set rewrite **must carry them forward as pool annotations** (e.g. per-candidate `declined`/`requested`/`voteWeight`/`priority` flags the model is instructed to honor), or client-requested keywords stop appearing and declined ones resurface. State this explicitly in the op contract.
  - **Zod field-name cross-check (S6).** Cross-reference every new schema field name against the source interface in `shared/types/` (`ContentGap`, `PageKeywordMap`) — a wrong name silently `safeParse`-fails to the empty fallback, the *exact* mode this phase exists to kill (CLAUDE.md "Zod schema field names"). Preserve the provenance/evidence contract from `docs/rules/content-quality-grounding.md` (`responseFormat`/`json:true`, evidence attachment).
- **Effort.** M. **Risk.** Low–Medium. De-risk: the P0 malformed-response fixture gates this in CI; add a fixture asserting a requested keyword survives and a declined one stays out. **FM-2 test (S5):** P0's fixture asserts a *throw*; P3 changes that to retry-once→backfill→never-empty — add a test mocking a malformed AI response and asserting the retry fires, then backfill, and the result is non-empty.
- **Quality lift.** Silent empties → validated-or-backfilled; invented keywords eliminated; client signals preserved.
- **Owner gate.** None beyond standard review.

### Phase 4 — OV coherence: `predicted_emv` (survivable + private + CPC-proxy), OV-derived tier, one gain basis
- **Goal.** Make ranking, displayed gain, gap ranking, and (future) calibration all read *one* EMV number — and make `predicted_emv` actually survive to where P6 needs it.
- **Scope + key files.**
  - **(a) Persist the predicted EMV so it SURVIVES (closes G0 — the inbox-equivalent).** **Naming (B2):** the TypeScript field is **`predictedEmv`** (camelCase — every `OpportunityScore` field is camelCase, e.g. `emvPerWeek`; there are zero snake_case TS fields); `predicted_emv` is the **SQL column name only**. Do not conflate them. Capturing `opportunity.emvPerWeek × HORIZON_WEEKS` at generation is *insufficient* on three legs, all fixed in this PR:
    1. **Survive read.** Add `predictedEmv` to `OpportunityScore` (`shared/types/recommendations.ts:78`) **AND** to the closed `opportunityScoreSchema` (`server/schemas/workspace-schemas.ts:314-324`). The nested `opportunity` is a closed `z.object` with no `.passthrough()`, so the field is stripped on every reload otherwise (CLAUDE.md "Schema vs stored shape"). Recs are a JSON blob (`recommendation_sets.recommendations` TEXT) — the lockstep is the **Zod schema**, not a column.
    2. **Stay private.** Add `predictedEmv` to the `stripEmvFromPublicRecs` destructure (`server/routes/recommendations.ts:35-41`, which destructure-and-spreads, so a new field *leaks* unless added) and mirror at the PATCH response (`:158`). It is admin/AI-only money — clients never see raw $/wk.
    3. **Survive regen — full outcome-row lockstep.** Snapshot the value onto the **action/outcome row at `recordAction` time** — this is a new DB column, so the full lockstep: **migration adding the column + the outcome-row interface + its `rowToX` mapper**, plus a field on `RecordActionParams` (`server/outcome-tracking.ts:142-149`, which today has none), threaded at both write sites (`routes/recommendations.ts:131-142`, `outcome-backfill.ts:195`), and SELECTed in `getCalibrationOutcomes`. Do **not** rely on the regenerable rec row: P5 regenerates recs after every scheduled audit and `buildMergeKey` (`recommendations.ts:1774-1794`) does not preserve the old `opportunity`.
    4. **Honest basis (owner decision) + reachable multiplier (S4).** `predictedEmv = emvPerWeek × HORIZON_WEEKS` is built from `valuePerClick = cpc × intentWeight` (`opportunity-value.ts:259-262`) — a **CPC proxy**, not real money. Per owner decision, **stamp it a CPC-proxy placeholder** in its JSDoc and in `docs/rules/seo-generation-quality.md`; the real GA4 `estimatedRevenue` (`shared/types/analytics.ts:311`, collected-but-unused) is threaded in **P6**. **Implementation note:** `HORIZON_WEEKS` (`opportunity-value.ts:38`) is module-private — either export it or (preferred) compute `predictedEmv` *inside* `computeOpportunityValue` (which already multiplies by it at `:327`), so the rec layer doesn't reach a private const.
  - **(b) OV-derived tier (closes G1).** Derive the priority tier from **OV bands** rather than the legacy heuristic feeding `sortRecommendations` at `:586`, keeping `fix_now` reserved for genuine `CRITICAL_CHECKS` (`:599-604`). **Fix the canary first:** `recordOvDivergence`'s `ovClone` (`server/ov-divergence.ts:164-165`) today overrides only `impactScore`, keeping the legacy tier — so the divergence log captures only *within-tier* reorder while this phase's whole point is *cross-tier* re-tiering. Make `ovClone` apply the OV-derived **tier** too, and add an `OvDivergencePanel.tsx` (`:135-146`) assertion surfacing tier-level divergence. Otherwise the gate the owner flips on is blind to the change it gates.
  - **(c) One gain basis (closes G5, G9 — owner decision).** Replace the legacy `getRecoveryRate` `estimatedGain` string (`:1110-1113`) with the OV EMV figure when OV is on, co-designed with the client renderer (CLAUDE.md AI↔frontend contract). **Recompute `content_gaps.opportunity_score` from OV EMV** so the three surfaces that rank the *same gaps* share one basis: admin Strategy recs, brief-candidate ranking (`briefing-candidates.ts:229,239`; `content-gaps.ts:97` ordering), and the client upsell. **Enumerate every gain renderer** in this PR: `FixRecommendations.tsx` (switch its hand-duplicated `ServerRecommendation` at `:21-41` to the shared `Recommendation` type), `InsightsEngine.tsx`, `strategy/*`, and `Briefing/RecommendedForYou.tsx` — **kill its independent `volume × 0.103` clicks estimate (`:139`) and the legacy `/100` badge (`:94`)** or align them. Ensure no dollarized string survives the public strip (the `estimatedGain` string is *not* stripped today — add it). Keep `computeRecommendationSummary` (`:445-457`) numerator/denominator on one source (CLAUDE.md rate rule).
  - **(d) Fix the meeting-brief stale cache (closes G8 — a code fix, not just a trace note, B4).** The brief cache hash (`server/meeting-brief-generator.ts:130-152`) keys on top-10 insights + first-5 site keywords — **no rec/gap/tier signal**. After P4 re-tiers, the brief serves a **stale "#1"**, silently breaking the plan's own thesis. Add a rec/tier/gap signal to the cache hash (re-verify in P5 when new rec sources land). A §5.2 trace would only *detect* this; this makes it a fix.
  - All gated behind `opportunity-value-scorer` (OFF = byte-identical legacy), rolled out via the P0 per-workspace flag dimension. Re-tier broadcasts already fire from `generateRecommendations` (`recommendations.ts:1879-1888` → `RECOMMENDATIONS_UPDATED` + intelligence invalidation; frontend `useWsInvalidation.ts:362`) — do **not** add a manual broadcast (Bridge rule #3).
- **Effort.** L. **Risk.** Medium–High (re-orders the client list; touches the upsell flow + calibration). De-risk: the now-tier-aware `recordOvDivergence` diffs legacy-vs-OV on real workspaces *before* flipping; per-workspace canary; the §5.2 end-to-end trace is a hard acceptance gate. **Public-read test (S5):** `GET /api/public/recommendations/:id` asserting neither `predictedEmv` nor a dollarized `estimatedGain` string leaks.
- **Quality lift.** The #1 card, ordered list, displayed gain, and gap ranking finally reflect one economic value; `predicted_emv` reaches calibration intact.
- **Owner gate.** **Approve the OV-band→tier thresholds and the per-workspace canary cohort.**

### Phase 5 — Wire orphaned subsystems (first-class, not fallthrough) + scheduled-audit regen
- **Goal.** Surface three classes of already-computed analysis that die in the DB — *as first-class rec types, learnings-aware and intelligence-visible* — and stop auto-audit workspaces accruing stale recs.
- **Scope + key files.** Add rec branches in `generateRecommendations` (today reads only `listContentGaps` at `:1278`) reading **keyword_gaps** ("competitor ranks, you don't"), **topic_clusters** (one cluster-head rec, not N), **cannibalization_issues** (consolidation/canonical rec) — each scored through `computeOpportunityValue`.
  - **Make new rec types first-class (closes G2, G7).** New types must not fall through three non-exhaustive maps:
    1. Define new `ActionType`s in `shared/types/outcome-tracking.ts` (the union at `:4` + the `Record<ActionType,…>` maps like `ScoringConfig` at `:175` fail compile = good lockstep) and add cases to `recommendationOutcomeActionType` (`recommendations.ts:126-134`). **The same-commit diff must also update the frontend `ACTION_TYPE_LABELS`/`ACTION_LABELS` maps** — they live in `src/`, not the shared type: `src/components/admin/outcomes/outcomeConstants.ts:16`, `src/components/client/OutcomeSummary.tsx:14`, `src/components/client/Briefing/WinsSurface.tsx:11` (B5). The `audit_fix_applied` fallback (`:133`) feeds `winRateByActionType` (`outcome-learning-default-path.ts:54`), so a fallthrough **distorts calibration**, not just a label (this also transitively fixes G12's `OutcomeSummary` per-type breakdown).
    2. Add the new sources to `REC_SOURCE_CATEGORIES`/`getRecSourceCategory` (`:185-192`) and wrap the new reads so `failedCategories` is populated on a transient failure (`:1804-1808`) — otherwise an empty read **bulk auto-resolves** previously-surfaced recs, falsely telling a client "competitor gap resolved." **FM-2 test (S5):** assert a transient orphan-read failure populates `failedCategories` and does **not** bulk auto-resolve.
    3. Add `typeConfig` cases in `FixRecommendations.tsx:276` (and `REC_TYPE_TAB`/`TYPE_ICONS` if new `RecType`s) so they don't render as "Technical Fixes." Add the `RecType`/`branch` values to `shared/types/recommendations.ts:4,94` in the same commit (string-literal-rename lockstep). **Cross-phase (S7):** `FixRecommendations.tsx:21-41` hand-duplicates `ServerRecommendation` with a closed `type` union (missing `aeo` and any new value) — new RecTypes won't typecheck there until **P4** switches it to the shared `Recommendation` type; keep P4→P5 a hard dependency (or P5 must widen that duplicated union). Confirm **no new `InsightType`** is introduced (`cannibalization` is *already* an `InsightType` at `analytics.ts:193`; these are new *RecTypes* only — if any new InsightType appears, the 4-part registration rule fires).
    4. **Surface the producers in a named intelligence slice (CLAUDE.md Data-Flow #6, B3).** Wiring them only into `generateRecommendations` leaves AdminChat blind. Name all three artifacts: a field on a slice interface in `shared/types/intelligence.ts`, the read inside an `assemble*()` function (extend `insights-slice` or `seo-context-slice`, or add a `competitive-gaps-slice`), and routing via the `buildWorkspaceIntelligence()` facade — **never call the slice from a route**. Route the new branches through `applyOutcomeAdjustmentScore` (`:143-148`) + `buildRecommendationGenerationContext` learnings like existing branches.
  - **Dedupe guard required:** cannibalization *partially* reaches clients via the analytics-intelligence insights path (reader is `listCannibalizationIssues`; readers for the others are `listKeywordGaps`, `listTopicClusters`) — emit a rec only when no active insight covers the URL set, and cross-link. Also dedupe in the `briefing-candidates.ts` collector (`:394-401`), not only in `generateRecommendations` (**G10**).
  - Add `generateRecommendations(ws.id)` after `runScheduledAudit` in `scheduled-audits.ts` (on-demand already does this at `routes/jobs.ts:238`; scheduled does **not** — zero references confirmed), reusing the single-flight debounce. `scheduled-audits.ts` already imports `broadcastToWorkspace`/`invalidateIntelligenceCache` and `generateRecommendations` broadcasts internally (`:1879-1888`) — do **not** add a manual broadcast (Bridge rule #3). Re-verify the P4 brief-cache fix (d) covers scheduled regen.
- **Effort.** L. **Risk.** Medium (dedup + fallthrough maps must be exhaustive). 
- **Quality lift.** Large coverage lift independent of volume tuning; new recs are calibration-correct and AdminChat-visible; auto-audit workspaces get current recs.
- **Owner gate.** **Confirm the cannibalization dedup policy** (rec vs. insight ownership).

### Phase 6 — (Owner-gated, measured) Semantic business-fit + deeper data exploitation
- **Goal.** Reach the relevance + real-money ceiling — only if telemetry shows un-suppress+backfill is insufficient.
- **Scope + key files.** Replace lexical `inferBusinessFit` (`rules.ts:166-174`) with a **semantic relevance score** (embed business context + page corpus + candidates), keeping the reason-weighted framework. Thread **GA4 conversion value → `valuePerClick`** (`opportunity-value.ts:63,259`; this is the real-money fix that retires P4's CPC-proxy placeholder), **GSC-proven demand → OV confidence** (`:199-209`), **SERP-feature crowding → winnability discount**. Swap calibration basis to `median(realized/predicted_emv)` (`ov-calibration.ts:80`) now that P4 persists a *survivable* `predicted_emv`. Optionally enable `opportunity-value-events` per-workspace.
- **Effort.** L. **Risk.** Medium–High (embedding drift; net-new subsystem — none exists today). De-risk: shadow-diff vs. P2 lexical behavior per-workspace; P0 eval fixtures gate each sub-change.
- **Quality lift.** True relevance; money-aware ranking; self-tightening calibration on an honest basis.
- **Owner gate.** **GO/NO-GO gated on P1–P5 telemetry.** Do not build on spec.

### Phase 7 — (Parallel track, owner-gated) Local SEO strategy contribution + local recommendations
- **Goal.** Give the keyword strategy + recommendation engine a genuine *local* dimension, consuming the mature-but-orphaned local-pack subsystem. **Not folded into P1–P5** — it depends on them and would violate the firebreak in `docs/rules/local-seo-visibility.md`.
- **Why it's a separate track.** The plan touches `local-seo.ts` only as a geo helper (`resolveWorkspaceLocationCode`, `:587`). But Local SEO has **no presence in strategy or recs**: no local-intent keywords in the pool (`buildLocalSeoKeywordCandidates`/`selectLocalIntentKeywords` at `:1928,2080` are never called from generation); **no local `RecType`** (`shared/types/recommendations.ts:4`) or `OpportunityInput.branch` (`:94`) — a local rec is structurally impossible today; no local signal in OV scoring. GBP health, reviews, geo-grid, citations, client dashboard are **0% built** (all `pending` in `data/roadmap.json`).
- **Scope (consume existing evidence only).** Posture-gate the whole phase on the existing `local`/`hybrid`/`non_local`/`unknown` field so non-local workspaces pay nothing.
  - **A — local keywords into the universe.** When posture ∈ {local, hybrid}, add a local source to `buildKeywordUniverse` pulling stored `buildLocalSeoKeywordCandidates` + city/near-me variants, behind the P1 credit-depth cap. Honor the boundary: reuse stored candidates, do **not** call `getLocalVisibility` synchronously in the strategy path.
  - **B — local rec branches.** Add local `RecType`(s) + a `local` branch (lockstep per CLAUDE.md, incl. new `ActionType`s + the frontend `ACTION_TYPE_LABELS` maps per P5 step 1), then branches in `generateRecommendations` (mirroring P5) reading `getLocalSeoServiceGaps` (`:970`), `getLocalSeoCompetitorBrands` (`:892`), and `not_visible`/`possible_match` snapshots — with a dedup guard vs. the `LocalSeoVisibilityPanel`. **Surface local rec sources via the existing `local-seo-slice` (Data-Flow #6, B3):** name the `shared/types/intelligence.ts` field + the read inside `assembleLocalSeo` rather than reading from the route.
  - **C — local OV term.** Add a local-visibility winnability/timing term to the OV scorer so local recs rank natively through P4's `predicted_emv` spine. Posture- and flag-gated.
  - **D — propagation.** Trigger debounced rec regen after `runLocalSeoRefreshJob` (`:2157`) completes, reusing P5's debounce.
  - **Prerequisite:** fix the `marketId` passthrough defect (`intelligence/local-seo-slice.ts:306`, documented 27.5% cross-market noise) before Scope A if clean per-market relevance is wanted.
  - **Explicitly still deferred** (own roadmap items): GBP API health, reviews/reputation, geo-grid/map-pack tracking, citations, client-facing local dashboard. **Leave a seam in P5's `generateRecommendations`** for a future local rec source so P7 isn't a re-architecture.
- **Effort.** M–L. **Risk.** Medium. **Owner gate.** GO/NO-GO on (a) how many workspaces are local/hybrid posture (if few, defer), (b) the local→OV thresholds, reviewed via the divergence shadow-log — same canary discipline as P4.

---

## 4. SEQUENCING + DEPENDENCIES

```
P0 (harness + per-workspace flag + guardrails) ──┬──> P1 (universe assembler) ──> P2 (relax + backfill + tag)
                                                  │                                      │
                                                  ├──> P3 (Zod + closed-set + signals) <─┘ (backfill = P3 fallback)
                                                  │
                                                  └──> P4 (predicted_emv survivable + OV tier + one gain) ──> P5 (orphan tables, first-class)
                                                                   │                                                │
                                                                   └──> P6 (calibration swap; semantic; GA4 value) │ [OWNER GO/NO-GO]
                                                                                                                    │
P7 (Local SEO) ── parallel track, starts after P1 + P4 + P5 merge ──────────────────────────────────────────────┘ [OWNER GO/NO-GO]
```

- **P0 unblocks everything** — the per-workspace flag is a hard prerequisite for P4's canary; the telemetry is the GO/NO-GO evidence for P6; the guardrail doc + pr-check rules are the safety net for every contract change.
- **P1 → P2:** backfill needs the larger pool to backfill *from*.
- **P2 → P3:** the deterministic backfill *is* P3's non-empty fallback.
- **P4 → P5:** OV-derived tier must exist before orphan recs so they rank by OV from day one; **P4's survivable `predicted_emv`** is what **P6's calibration swap** joins on.
- **P7 depends on P1 (universe seam), P4 (OV spine), P5 (branch pattern + audit-regen plumbing).**
- **Owner-gated:** P1 credit ceiling; P2 floor + un-suppress; P4 OV thresholds + canary; P5 cannibalization dedup; **P6 entirely** (telemetry GO/NO-GO); **P7 entirely** (posture GO/NO-GO).
- **P3's AI-op registration + closed-set prompting is parallelizable** with P1/P2 (different files) if a second engineer is available — **but its never-emit-empty fallback wires into P2's deterministic backfill, so P3 cannot *merge* before P2.** Build in parallel; merge after P2.

---

## 5. EXECUTION DISCIPLINE — how we guarantee global coverage (the inbox-lesson antidote)

The root cause of the inbox failure *and* every gap below is the same: **the plan enumerates producers but not the full set of readers, and the readers don't error.** Three mechanisms, mandatory, in order of leverage:

**5.1 — Per-phase "Consumer Contract Check" (mandatory in every phase PR description).** For any contract a phase changes, the PR body must list — and the reviewer must verify:
- Every **reader** of the changed shape (grep the field/type name repo-wide; **paste the grep output in the PR**). For a JSON-blob contract like recs, explicitly include the **Zod schema** and the **public strip** as readers — G0a/G0b are invisible otherwise.
- Every **non-exhaustive map** keyed on the changed discriminator (the `Record<string,…>` fallthroughs — G2 — where the compiler gives no help).
- The **public read-path test** (`GET /api/public/recommendations/:id`, `GET /api/public/seo-strategy/:id`), not the admin route — the strip/leak/re-tier bugs hide on the admin path (CLAUDE.md "integration tests must cover the actual read path").

**5.2 — End-to-end "external signal → every surface" trace (hard acceptance gate for P4 and P5).** Pick one real keyword/gap and trace it from external signal (GSC/provider/GA4) → pool → AI op → normalized table → rec → `predicted_emv` → outcome row → calibration → **and every render/consume surface**: client #1 card, `FixRecommendations`, `RecommendedForYou`, admin meeting brief (`meeting-brief-generator.ts` cache hash `:130-152` keys on insights+site-keywords, *not* gaps — stale-brief risk, **G8**), `MCP get_pending_work` (`mcp/tools/clients.ts:84-105`, never reads recs — **G8**), AdminChat, `recommendations_ready` email (`email-templates.ts:933`, raw count — backfill-padding risk, **G11**). The assertion is the plan's own thesis, which `admin-chat-context.ts:847` says is *intended*: **the #1 AdminChat names == the #1 the client sees == the #1 the meeting brief cites.** Any surface where the trace dead-ends or diverges is caught before merge.

**5.3 — Guardrails before commit 1 (P0, per CLAUDE.md Session-Protocol #7).** `docs/rules/seo-generation-quality.md` (four contracts + reader lists) and the two pr-check rules (§Phase 0) ship in the first PR. Guardrails written after the bug cost 3× more.

**5.4 — Per-phase Definition of Done (every phase PR must pass all of these before merge to staging).**
- **Quality gates (CLAUDE.md):** `npm run typecheck` (project-aware `tsc -b`, **not** plain `tsc`), `npx vite build`, `npx vitest run` (full suite, not just new tests), `npx tsx scripts/pr-check.ts`, `npm run verify:feature-flags`, `npm run verify:coverage-ratchet`, no `violet`/`indigo` (and `grep -r "purple-" src/components/client/` after any client-renderer touch — P4/P5 touch `FixRecommendations`/`RecommendedForYou`/`StrategyContentOpportunitiesSection`).
- **Tests, on the actual read path (S5):** integration tests hit the **public** endpoint, not the admin route — P2 asserts `backfilled` survives the whitelist; P4 asserts neither `predictedEmv` nor a dollarized `estimatedGain` string leaks; P3 + P5 add FM-2 error tests (retry→backfill never-empty; transient orphan-read → `failedCategories`, no false auto-resolve). New test files allocate a unique port (13201–13899) and orphan 13xxx ports are killed before commit.
- **Review:** multi-file/parallel phases (P1, P4, P5, P7, and P3 if parallelized) invoke the `scaled-code-review` skill (not single-agent review) per Quality Gates; all Critical/Important findings fixed before merge.
- **Read-before-write:** for the cross-module reads (P1 pool-builder fold, P4 field threading, P5 orphan-table reads), read the source interface/signature first — never guess field names (the codebase's #1 bug pattern); run `pre-plan-audit` for P1.
- **Post-ship (CLAUDE.md After-Completing-a-Task):** update `FEATURE_AUDIT.md`, `data/roadmap.json` (+ `sort-roadmap.ts`), and `data/features.json` if client-impactful.

---

## 6. SILENT-GAP REGISTER (every finding → the phase that closes it)

From the global blind-spot sweep. **Notice** = how likely caught before clients (Silent = no compiler/test help). **Severity** = blast radius on correctness/money/the calibration loop.

| # | Gap (one line) | Notice | Sev | Closed in |
|---|---|---|---|---|
| **G0** | `predicted_emv` dropped on read / leaked to clients / clobbered by P5 regen — the inbox-equivalent | Silent | **Crit** | **P4(a)** |
| **G1** | OV canary blind to cross-tier reorder (`ovClone` keeps legacy tier) | Silent | High | **P4(b)** |
| **G2** | New rec types fall through 3 non-exhaustive maps (mislabel + distort calibration + false auto-resolve) | Silent | High | **P5** |
| **G3** | `buildKeywordUniverse` scoped to provider fetch only; real pool draws from GSC/client sources in synthesis | Silent | High | **P1(c)** |
| **G4** | P3 closed-set rewrite can drop declined/requested/votes/priorities client-signal contract | Silent | High | **P3** |
| **G5** | Brief-candidate + upsell ranking keep legacy basis after P4 reprices recs | Silent | High | **P4(c)** |
| **G6** | `backfilled` tag unwired through 5 layers | Silent | Med | **P2(e)** |
| **G7** | Orphan tables not surfaced to intelligence slice; new recs learnings-blind | Silent | Med | **P5** |
| **G8** | Meeting-brief cache hash never keyed on recs/tiers → stale "#1"; `get_pending_work` never reads recs | Silent | Med | **P4(d) fix** + §5.2 trace |
| **G9** | `estimatedGain` money-leak + rate-source mismatch | Silent | Med | **P4(c)** |
| **G10** | Briefing collector double-surfaces (no cross-source dedup) | Silent | Low | **P5** |
| **G11** | `recommendations_ready` email count padded by backfill | Silent | Low | **P2(f) fix** |
| **G12** | `OutcomeSummary` per-type breakdown can't distinguish new recs | Silent | Low | **P5 (transitively via G2 ActionType + frontend label maps)** |
| **G13** | Geo `language_code` hardcoded `'en'` | Silent | Low | **P1(a)** |
| **G14** | Single-primary-market assumption (27.5% cross-market noise) | Known | Low | **P1(e) ack → P7** |
| **G15** | Strategy↔recs KD-authority incoherence (recs authority-adjust, strategy doesn't) | Silent | Low | **note-and-track** |
| **G16** | Public-content `slice(0,20)` cap + field whitelist truncate richer columns; `mcp/tools/content.ts:111-113` passes rows RAW | Silent | Low | **P1/P5 §5.1 check** |

**Legitimately separate tracks (NOT in this plan):** content brief/post *prose* quality (own grounding contracts; the candidate-*ranking* half is in-scope via P4(c)); schema/structured-data generation (decoupled by slices); reporting/sales surfaces (own audit pipeline — one light coherence check post-P4); reviews/geo-grid local signals (own data deps — separate from P7).

---

## 7. THE FIRST PR TO CUT

**Phase 0 — the quality harness + per-workspace flag + guardrails.** Pure additive infrastructure (low risk), and a *hard prerequisite* for the P4 canary, the P6 GO/NO-GO evidence, and the §5 gate. Concretely:
1. `isFeatureEnabled(flag, workspaceId?)` with rollout-target resolution in `server/feature-flags.ts` (today line 87 takes flag only — 52 call sites, verified global).
2. The `generationQuality` telemetry record emitted from `server/keyword-strategy-generation.ts`.
3. Two eval fixtures per `docs/rules/ai-quality-evals.md`: Faros-like sparse workspace asserting ≥6 gaps (fails red until P1–P2 — the acceptance bar), and a malformed-AI-response fixture asserting a throw.
4. **`docs/rules/seo-generation-quality.md`** (four contracts + full reader lists) and the **two pr-check rules** (admin-money-field-must-be-stripped; new-RecType-needs-category+action-type).

**Honest tradeoff:** leading with P0 means the *visible* Faros fix is one PR later than cutting the assembler first. We accept that one-PR delay: shipping the assembler without telemetry, a per-workspace flag, or the contract guardrails means flying blind on a shared seam and having no canary for the P4 reorder — a worse risk posture than the fast win is worth.

**Relevant files (all absolute):** `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/feature-flags.ts`, `/server/keyword-strategy-generation.ts`, `/server/keyword-strategy-seo-data.ts`, `/server/keyword-strategy-ai-synthesis.ts`, `/server/keyword-strategy-search-data.ts`, `/server/keyword-intelligence/rules.ts`, `/server/keyword-strategy-enrichment.ts`, `/server/keyword-strategy-helpers.ts`, `/server/ai-operation-registry.ts`, `/server/recommendations.ts`, `/server/routes/recommendations.ts`, `/server/schemas/workspace-schemas.ts`, `/server/outcome-tracking.ts`, `/server/ov-divergence.ts`, `/server/scoring/opportunity-value.ts`, `/server/scoring/ov-calibration.ts`, `/server/scheduled-audits.ts`, `/server/briefing-candidates.ts`, `/server/content-gaps.ts`, `/server/mcp/tools/job-actions.ts`, `/server/providers/dataforseo-provider.ts`, `/server/routes/public-content.ts`, `/shared/types/recommendations.ts`, `/shared/types/outcome-tracking.ts`, `/shared/types/feature-flags.ts`, `/src/components/KeywordStrategy.tsx`, `/src/components/client/FixRecommendations.tsx`, `/src/components/client/Briefing/RecommendedForYou.tsx`, `/src/components/client/strategy/StrategyContentOpportunitiesSection.tsx`, `/src/components/client/types.ts`.
