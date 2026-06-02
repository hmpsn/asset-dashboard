# SEO Strategy + Keyword Generation — Quality Improvement Plan

**Date:** 2026-06-02 · **Method:** multi-agent plan tournament (4 competing plans -> 3-judge panel -> synthesis). **Status:** recommended, pending owner approval.
**Grounding:** docs/audits/2026-06-02-seo-strategy-keyword-recommendations-audit.md

All claims verified against source. Key confirmations: `KeywordStrategy.tsx:142-143` defaults to `quick` when a provider exists; MCP `job-actions.ts:92` passes `seoDataProvider` only (no mode, no data); `ov-calibration.ts:16-33` literally anticipates the `predicted_emv` swap; `isFeatureEnabled(flag)` at `feature-flags.ts:87` takes no `workspaceId` (flag is global — per-workspace rollout is genuinely net-new work); OV's `valuePerClick = cpc × intentWeight` only (GA4 value not threaded); `recommendations.ts:1278` reads only `listContentGaps` (keyword_gaps/topic_clusters/cannibalization have zero reads). The verified state holds. Producing the recommendation.

---

# Recommended Plan: Keyword-Strategy + Recommendation Quality

## 1. THE VERDICT

**Execute a HYBRID with Plan A (surgical) as the chassis.** Plan A won every panel on the dimension that matters most here — it is the only plan that closes *all four* verified defect classes (sparse-generation, OV cross-tier incoherence, orphaned tables, scheduled-audit staleness) at the lowest blast radius with revertable per-PR phasing, and it correctly sequences the highest-symptom-relief work (universe-starvation + shape-validation) first. But A's runners-up each own one idea A cannot reach, and the cost of grafting them is low, so we steal four: **D's `buildKeywordUniverse` assembler** (fix MCP starvation + whole-pool-US geo in *one* shared seam instead of A's three scattered point-edits), **B's closed-set evidence-grounded prompting** (implement A's Zod phase as schema-validation *plus* selection-from-real-source-rows — kills invented keywords and silent empties together), **C's `predicted_emv` persistence + OV-derived tier** (so coherent ranking and self-tightening calibration ship together), and **B's deterministic eval fixtures + `generationQuality` telemetry** pulled forward cheaply (but *not* B's full parallel `core-v2` + always-on shadow generation, which doubles every run's cost). Semantic/embedding business-fit is deferred to an explicit, measured fast-follow — the codebase has *no* embedding infrastructure (verified: 2 incidental refs), and no plan establishes that semantic fit is *necessary* to hit 6–10 gaps once we stop suppressing and add a backfill floor. The Faros symptom is over-determined by input starvation; it should resolve in Phase 1–2, before any deep quality work begins.

| Plan | Quality lens | Feasibility lens | Root-cause lens | Verdict role |
|---|---|---|---|---|
| **A — surgical** | **42** (1st) | **42** (1st) | **40** (1st) | **Chassis** — phased spine, risk posture, complete defect sweep |
| **B — gen-rebuild** | 36 (2nd) | 35 (4th) | 36 (3rd) | Graft: closed-set prompting + eval fixtures; defer embedding fit |
| **C — ov-first** | 35 (3rd) | 36 (3rd) | **39 (2nd)** | Graft: `predicted_emv` persistence + OV-derived tier |
| **D — data-first** | 35 (4th) | **38 (2nd)** | 35 (4th) | Graft: `buildKeywordUniverse` assembler (geo + MCP seed) |

Consensus: A first on all three panels; B is the highest *ceiling* but worst *feasibility* (its embedding subsystem doesn't exist and its shadow rig doubles run cost); C has the best *end-state* (OV as one spine) but optimizes the half of the system that was **not** the verified cause of the symptom; D has the sharpest *input-starvation* diagnosis but self-inflicts a wound by scoping the live tier-vs-OV incoherence out.

---

## 2. WHY

**A is the chassis because the verified primary symptom is upstream.** I re-confirmed in source: the sort at `recommendations.ts:586` is `priorityOrder[a.priority] - priorityOrder[b.priority]` *first*, impactScore second — and `pickImpactScore` writes OV at `:1862` *after* `recordOvDivergence` but the tier is a legacy heuristic, so OV provably only re-orders *within* a tier. Meanwhile `estimatedGain` at `:1110-1113` still renders `getRecoveryRate(group.check)` legacy percent strings while ranking reads OV — a live, client-facing incoherence. And the sparse symptom is upstream of all of it: `KeywordStrategy.tsx:142-143` defaults provider workspaces to `quick`; the discovery/related/question sources are gated behind `if (seoDataMode === 'full')` at `keyword-strategy-seo-data.ts:246`; the MCP path (`job-actions.ts:92`) passes `seoDataProvider` only — no mode, no data. So a "provider-selected" workspace gets a thin domain/competitor/gap pool, which the AI then prunes to 2. A fixes every one of these on a seam that already exists, revertably.

**The strongest idea grafted from each runner-up:**
- **From D — `buildKeywordUniverse(workspaceId, opts)` assembler.** A's Phase 1 + 6 edit three callsites (UI default, MCP entry, geo threading) separately, which risks the UI default and MCP default diverging. D's single assembler resolves geo *once* (`resolveWorkspaceLocationCode` exists at `local-seo.ts:587`; DataForSEO defaults to `2840`/US when omitted) and threads `database`/`locationCode` into *every* provider call from the first fetch, makes discovery always-on (the `quick`/`full` toggle becomes a *credit-depth cap*, not a source on/off gate), and seeds the MCP path — fixing sparse + whole-pool-US geo in one place. Cleaner than three point-edits.
- **From B — closed-set evidence-grounded prompting.** A's Phase 3 only validates the *shape* the AI returns. B's idea — pass the candidate pool as an enumerated list and require the model to *select + justify by source row id* — makes invented keywords structurally impossible rather than post-hoc filtered. We fold this into the same Zod/named-ops PR so shape-validation and grounded-selection land together. (B's *embedding* business-fit is the highest-regression-risk idea in the field and is deferred.)
- **From C — `predicted_emv` persistence + OV-derived tier.** `ov-calibration.ts:16-33` literally documents that predicted EMV "IS NOT RECOVERABLE" today (migration 106 stores realized `attributed_value` only) and says "swap the basis here" once it is. Persisting `opportunity.emvPerWeek × HORIZON_WEEKS` at generation time converts calibration from a win-rate proxy (`realization = mean(scoreWeight)`, `:80`) into a realized-vs-predicted join. And deriving the tier *from OV bands* (not the legacy heuristic) is what finally lets OV rank *across* tiers, not just within one.
- **From B (again, cheaply) — deterministic eval fixtures + `generationQuality` telemetry.** The `docs/rules/ai-quality-evals.md` convention already exists. We pull a thin version forward as a CI gate (a Faros-like fixture must yield ≥6 gaps; a malformed AI response must throw) — *without* adopting B's full parallel `core-v2` module or always-on shadow generation, which doubles provider+AI cost on every run.

**What we honestly do NOT do (the residual ceiling, owned by everyone):** business-fit stays *lexical token-overlap* (`rules.ts:166-174`); we stop *suppressing* lexically-unmatched-but-real keywords (Phase 2), but we do not yet *score* them semantically. OV stays out of the meeting brief and MCP keyword ranking. SERP-feature crowding stays advice text until Phase 6. These are deferred deliberately, gated on telemetry showing un-suppress+backfill is insufficient.

---

## 3. THE RECOMMENDED PHASED PLAN

Risk-ordered: fast wiring/sparse fixes first (likely resolves Faros in P1–P2), then coherence, then coverage, then the measured quality ceiling. Every phase is one PR, flag-gated, independently revertable.

---

### Phase 0 — Quality harness + telemetry (ship first, measures everything after)
- **Goal.** Make every later phase measurable; convert silent failures into observable ones.
- **Scope + key files.** Add a `generationQuality` telemetry record (pool size, suppressed count, AI-returned-vs-backfilled count, floor-hit flag) emitted from `keyword-strategy-generation.ts`. Add deterministic eval fixtures per `docs/rules/ai-quality-evals.md`: a Faros-like sparse workspace fixture asserting ≥6 content gaps, and a malformed-AI-response fixture asserting a throw (not empty). Register the per-workspace flag dimension — `isFeatureEnabled(flag)` at `feature-flags.ts:87` takes **no `workspaceId`** today, so add `isFeatureEnabled(flag, workspaceId?)` with rollout-target resolution. *This is net-new shared infrastructure every later phase depends on — build it once, here.*
- **Effort.** M. **Risk.** Low (additive; no behavior change).
- **Quality lift.** None directly; it is the measurement + rollout substrate. Without it, P1–P6 fly blind.
- **Owner gate.** None — pure infrastructure. Approve to proceed.

### Phase 1 — `buildKeywordUniverse` assembler: full pool + geo + MCP seed (the single biggest lever)
- **Goal.** Stop starving the keyword universe; fix the whole-pool-US geo bug at its source. **This phase alone is expected to resolve most of the Faros "2 gaps" symptom.**
- **Scope + key files.** Introduce `buildKeywordUniverse(workspaceId, opts)` (new module, e.g. `server/keyword-strategy-universe.ts`) that becomes the *one* source of the candidate pool, replacing the inline mode-gated fetch in `keyword-strategy-seo-data.ts:246-325`. It (a) resolves workspace geo once via `resolveWorkspaceLocationCode` (`local-seo.ts:587`) and threads `database`/`locationCode` into *every* provider call (DataForSEO defaults `2840`/US when omitted — `dataforseo-provider.ts:58`); (b) runs discovery/related/question sources whenever a provider exists, with the `quick`/`full` toggle (`KeywordStrategy.tsx:142-143`) repurposed to a **credit-depth cap** (`compLimit`, suggestion fan-out `seed.slice(0,3)×20`) rather than an on/off gate; (c) seeds the **MCP/chat path** (`mcp/tools/job-actions.ts:92`) with at least domain+gap fetch so "provider-selected" means a real universe. Cost-bounded by a per-workspace monthly credit ceiling + the existing metrics cache (keyed to include `locationCode`).
- **Effort.** M–L. **Risk.** Medium (provider cost/latency; shared MCP+UI path). De-risk: per-workspace credit ceiling enforced *in* the assembler; locale-keyed cache; discovery seeds capped; run `pre-plan-audit` before implementation since it touches shared MCP+UI seams.
- **Quality lift.** Largest single lift. Sparse/low-footprint sites go from domain/competitor/gap-only to a true discovery universe; non-US workspaces stop getting US volumes/SERP/difficulty for the *entire* pool (today only late enrichment is localized via `provider-keyword-metrics.ts:36`).
- **Owner gate.** **Approve the per-workspace provider-credit ceiling** (cost vs. coverage tradeoff). Confirm rollout cohort: Faros + one non-US + one broad-business workspace first.

### Phase 2 — Relax conservatism + deterministic backfill floor
- **Goal.** Stop silent over-pruning; make "2 gaps" structurally impossible when candidates exist.
- **Scope + key files.** Four tunable changes (centralized constants block): **(a)** Demote the hard suppressor at `rules.ts:334-336` — any `business_mismatch` reason with `weight <= -12` currently escalates to `suppressed = true`. Keep the `-18` penalty (`:305`) but drop the `suppressed = true` escalation, so narrow-but-real competitor/gap keywords survive into ranking. (Token-overlap stays; we stop *killing* synonyms, we do not yet *score* them — see Phase 6.) **(b)** Tighten `_removePageCoveredContentGaps` substring `.includes()` (`enrichment.ts:101-114`) to token-subset containment so "dental implants cost" isn't eaten by a `/dental-implants` page. **(c)** Change `isStrategyQualityDiscoveryKeyword` (`helpers.ts:48-52`) from `difficulty > 0` to `difficulty >= 0` with a volume floor (KD-0 long-tail is real signal). **(d)** Add a deterministic **backfill**: if post-prune content-gaps < soft floor (6), re-admit highest-scoring pruned/penalized candidates by `scoreDelta` until floor met, tagged `backfilled` for UI honesty.
- **Effort.** M. **Risk.** Medium (changes output volume; backfill can re-admit a marginal keyword — mitigated by score-ordering + the `backfilled` tag).
- **Quality lift.** Directly kills the sparse symptom; narrow workspaces get a populated, floor-guaranteed gap list.
- **Owner gate.** **Approve the soft floor value (6) and the un-suppress demotion** (accepts slightly more, slightly-less-precise candidates in exchange for never collapsing to 2).

### Phase 3 — Zod-validated named ops + closed-set evidence-grounded prompting
- **Goal.** Eliminate the silent-empty failure mode (CLAUDE.md structured-output violation); make invented keywords structurally impossible.
- **Scope + key files.** Register two named operations in `server/ai-operation-registry.ts` — `keyword-page-assignment` and `keyword-site-synthesis` — each with `responseFormat`/`json:true` and a **Zod schema validated post-parse** (today both use instruction-based JSON with no shape check; a malformed-but-parseable response silently yields empty `contentGaps`). On schema-fail, **retry once with the validator error fed back**, then fall back to the Phase 2 deterministic backfill — never emit empty. *Graft from B:* pass the candidate pool as an enumerated list and require the AI to **select + justify by source row id**, attaching per-candidate evidence (volume, KD, GSC impressions, competitor proof) so grounding is structural, not post-hoc filtered.
- **Effort.** M. **Risk.** Low–Medium. De-risk: the Phase 0 malformed-response fixture gates this in CI.
- **Quality lift.** Converts silent empties into validated-or-deterministically-backfilled output; eliminates invented keywords. Satisfies the structured-output rule.
- **Owner gate.** None beyond standard review — this is a correctness fix.

### Phase 4 — OV coherence: persist `predicted_emv`, OV-derived tier, estimatedGain-from-EMV
- **Goal.** Make ranking, displayed gain, and (future) calibration all read *one* EMV number.
- **Scope + key files.** *Graft from C:* **(a)** Add a `predicted_emv` column to the rec/outcome linkage (DB column + mapper lockstep per CLAUDE.md), capturing `opportunity.emvPerWeek × HORIZON_WEEKS` at generation — `ov-calibration.ts:33` explicitly anticipates this. (This is the *dependency* for real calibration but ships its coherence value immediately.) **(b)** Derive the priority tier from **OV bands** rather than the legacy heuristic feeding `sortRecommendations` at `recommendations.ts:586`, keeping `fix_now` reserved for genuine `CRITICAL_CHECKS` (`:599-604`) so trust isn't broken — this ends within-tier-only OV ordering. **(c)** Replace the legacy `getRecoveryRate` `estimatedGain` string (`:1110-1113`) with the OV EMV figure when OV is on, co-designed with the client renderer per the AI↔frontend contract rule. All gated behind `opportunity-value-scorer` (OFF = byte-identical legacy, preserving the `pickImpactScore` discipline at `:1862`), rolled out via the Phase 0 per-workspace flag dimension, watched by the existing `recordOvDivergence` shadow log (`:1853`).
- **Effort.** M. **Risk.** Medium (re-orders the client-facing list). De-risk: `recordOvDivergence` diffs legacy-vs-OV ordering on real workspaces *before* flipping; per-workspace canary.
- **Quality lift.** The #1 card and ordered list finally reflect economic value; displayed gain stops contradicting rank.
- **Owner gate.** **Approve the OV-band→tier thresholds and the per-workspace canary cohort.** This is the most visible reordering — owner reviews the divergence report before global rollout.

### Phase 5 — Wire orphaned subsystems + scheduled-audit regen
- **Goal.** Surface three classes of already-computed analysis that die in the DB; stop auto-audit workspaces accruing stale recs.
- **Scope + key files.** Add rec branches in `generateRecommendations` (which today reads only `listContentGaps` at `recommendations.ts:1278`) reading: **keyword_gaps** ("competitor ranks, you don't" content rec), **topic_clusters** (one cluster-head rec, not N duplicates), **cannibalization_issues** (consolidation/canonical rec) — each scored through `computeOpportunityValue` so they rank natively. **Dedupe guard required:** cannibalization *partially* reaches clients via the separate analytics-intelligence insights path — emit a rec only when no active insight already covers the URL set, and cross-link. Separately, add `generateRecommendations(ws.id)` after `runScheduledAudit` in `scheduled-audits.ts` (on-demand audits already do this at `routes/jobs.ts:238`; scheduled audits do **not** — confirmed zero references), reusing the single-flight debounce.
- **Effort.** M. **Risk.** Low–Medium (dedup must prevent double-surfacing).
- **Quality lift.** Large coverage lift independent of volume tuning; auto-audit workspaces get current recs.
- **Owner gate.** **Confirm the cannibalization dedup policy** (rec vs. insight — which surface owns it).

### Phase 6 — (Owner-gated, measured) Semantic business-fit + deeper data exploitation
- **Goal.** Reach the relevance ceiling A/C/D cannot — only if telemetry shows un-suppress+backfill is insufficient.
- **Scope + key files.** Replace the lexical `inferBusinessFit` (`rules.ts:166-174`) with a **semantic relevance score** (embed business context + page corpus + candidates, cosine similarity), keeping the reason-weighted framework. Thread **GA4 conversion value → `valuePerClick`** (today `cpc × intentWeight` only — `opportunity-value.ts:63,259`), **GSC-proven demand → OV confidence** (the impressions fallback exists at `:199-209`; promote it to a confidence term), and **SERP-feature crowding → winnability discount** (today advice text). Swap calibration basis to `median(realized/predicted_emv)` now that Phase 4 persists `predicted_emv` (`ov-calibration.ts:80` → the documented swap). Optionally turn on `opportunity-value-events` per-workspace (the timing→regen pipeline is built but inert).
- **Effort.** L. **Risk.** Medium–High (embedding drift; suppression regressions hidden by green tests; net-new embedding subsystem — *none exists today*). De-risk: shadow-diff vs. the Phase 2 lexical behavior per-workspace before promotion; the Phase 0 eval fixtures gate each sub-change; embedding cache keyed by `keywordComparisonKey`.
- **Quality lift.** True relevance (synonyms/paraphrases score, not just survive); money-aware ranking; self-tightening calibration.
- **Owner gate.** **GO/NO-GO decision gated on Phase 1–5 telemetry.** Only proceed if `generationQuality` shows un-suppress+backfill is *not* hitting relevance targets. This is a new subsystem with real cost — do not build it on spec.

---

## 4. SEQUENCING + DEPENDENCIES

```
P0 (harness + per-workspace flag) ──┬──> P1 (universe assembler) ──> P2 (relax + backfill)
                                    │                                      │
                                    ├──> P3 (Zod + closed-set) <───────────┘ (backfill = P3 fallback)
                                    │
                                    └──> P4 (predicted_emv + OV tier + gain) ──> P5 (orphan tables, rank by OV)
                                                     │
                                                     └──> P6 (calibration swap; semantic fit) [OWNER GO/NO-GO]
```

- **P0 unblocks everything** — the per-workspace flag dimension is a hard prerequisite for P4's canary (today `isFeatureEnabled` is global, `feature-flags.ts:87`); the telemetry is the GO/NO-GO evidence for P6.
- **P1 → P2:** backfill needs the larger candidate pool to backfill *from*.
- **P2 → P3:** the deterministic backfill *is* P3's non-empty fallback path.
- **P4 → P5:** OV-derived tier must exist before orphan recs so they rank by OV from day one; **P4 persists `predicted_emv`** which **P6's calibration swap** requires.
- **Owner-gated:** P1's credit ceiling; P2's floor value + un-suppress; P4's OV thresholds + canary; P5's cannibalization dedup policy; **P6 entirely** (GO/NO-GO on telemetry — this is the rebuild-risk firebreak).
- **P3 is parallelizable** with P1/P2 (different files) if a second engineer is available.

---

## 5. THE FIRST PR TO CUT

**Phase 0 — the quality harness + per-workspace flag dimension.** It is pure additive infrastructure (low risk, no behavior change), and it is a *hard prerequisite* for the canary rollout in P4 and the GO/NO-GO evidence for P6. Concretely, the first PR:
1. Adds `isFeatureEnabled(flag, workspaceId?)` with rollout-target resolution in `server/feature-flags.ts` (today line 87 takes flag only — verified global).
2. Adds the `generationQuality` telemetry record emitted from `server/keyword-strategy-generation.ts` (pool size, suppressed count, AI-returned-vs-backfilled, floor-hit).
3. Adds two deterministic eval fixtures per `docs/rules/ai-quality-evals.md`: a Faros-like sparse workspace asserting ≥6 gaps (will *fail red* until P1–P2 land — that is the point: it encodes the acceptance bar) and a malformed-AI-response fixture asserting a throw.

This makes the very next PR (Phase 1, the `buildKeywordUniverse` assembler — the single biggest lever and the likely Faros fix) measurable against a red-then-green fixture, and gives the owner a per-workspace canary switch before any client-visible reorder ships.

**Honest tradeoff:** leading with P0 means the *visible* Faros fix is one PR later than if we cut the assembler first. We accept that one-PR delay because shipping the assembler without telemetry or a per-workspace flag means flying blind on a shared MCP+UI seam and having no canary for the P4 reorder — a worse risk posture than the fast win is worth.

**Relevant files (all absolute):** `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/feature-flags.ts`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/keyword-strategy-generation.ts`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/keyword-strategy-seo-data.ts`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/keyword-intelligence/rules.ts`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/keyword-strategy-enrichment.ts`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/keyword-strategy-helpers.ts`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/keyword-strategy-ai-synthesis.ts`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/ai-operation-registry.ts`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/recommendations.ts`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/scoring/opportunity-value.ts`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/scoring/ov-calibration.ts`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/scheduled-audits.ts`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/server/mcp/tools/job-actions.ts`, `/Users/joshuahampson/CascadeProjects/asset-dashboard/src/components/KeywordStrategy.tsx`.