# SEO Strategy & Keyword Recommendation System — Comprehensive Audit

**Date:** 2026-06-02 · **Status:** SOUND_WITH_FIXES (see Corrections at end) · Read-only multi-agent audit (5 subsystem deep-dives + 2 adversarial review lenses).

All six verifications confirm the maps precisely. The sort is tier-primary / impactScore-secondary (`recommendations.ts:586-593`); the page-coverage matcher uses substring `.includes()` for multi-word topics against both assigned keywords and title+path (`enrichment.ts:101-114`); and the strict-business-fit suppression chain (`-18` at rules.ts:304, hard `suppressed=true` for `business_mismatch ≤ -12` at rules.ts:334-336) is exactly as described. I have everything I need to synthesize the report.

---

# Keyword Strategy & Recommendation System — Comprehensive Audit

**Scope:** SEO strategy generation, keyword ranking, recommendation engine, and the newly-flipped Opportunity Value (OV) scorer. Read-only. Every claim is cited `file:line` and verified against source.
**Context symptom under investigation:** a workspace (Faros) regenerated and surfaced only 2 content-gap recommendations.

---

## 1. EXECUTIVE SUMMARY

The system is a four-stage pipeline: external signals (Webflow pages, GSC, GA4, SEMrush/DataForSEO) are fused with client signals during a multi-stage **strategy generation** that writes normalized tables (`content_gaps`, `quick_wins`, `keyword_gaps`, `topic_clusters`, `cannibalization_issues`, `page_keywords`); those tables are then read one-row-per-rec by **`generateRecommendations`** (`server/recommendations.ts:929`), which scores each rec with a legacy per-type heuristic, attaches a shadow **Opportunity Value (OV)** score, and ranks the list; the client sees the ranked list plus a "#1" card. It is sophisticated and mostly sound — but it was built in layers, and the keyword/strategy half has been partly left behind as the OV/recommendation half advanced.

**The 4-5 most important findings:**

1. **The Faros "2 content gaps" symptom is real, upstream of OV, and over-determined by conservatism + data starvation — not by the scorer.** Content-gap recs are one-per-row from `content_gaps`; OV only re-ranks and cannot cut count (`recommendations.ts:1862`). The low count is produced by a stack of pruning gates during *generation*: a hardcoded `strictBusinessFit: true` that hard-suppresses provider keywords lacking literal token overlap (`ai-synthesis.ts:303` → `rules.ts:303-336`), a broad substring page-coverage prune (`enrichment.ts:101-114`), and — most decisively — **`seoDataMode` defaulting that starves the keyword pool** (see #2).

2. **MCP-triggered strategy generation runs with NO provider data at all.** The MCP tool schema does not accept `seoDataMode` (`mcp-action-schemas.ts:521`); `generateKeywordStrategy` receives `undefined` → `normalizeSeoDataMode` returns `'none'` (`generation.ts:82-84`, verified), which short-circuits the entire SEO-provider stage. An agent-"regenerated" strategy fetches zero domain/competitor/gap/discovery keywords — the single most likely concrete cause of Faros's sparse gaps if it was regenerated via chat.

3. **The OV cutover changed the secondary sort key but left the primary one (priority tier) on legacy logic — and the flag is global.** `sortRecommendations` orders by **tier first, OV score second** (`recommendations.ts:586-593`, verified); the tier is assigned per-branch from legacy heuristics and never recomputed from OV. So flipping the flag re-ranks only *within* a tier — an OV-95 `ongoing` gap still sits below every OV-30 `fix_soon` item. Compounding this, `isFeatureEnabled` is **global, not per-workspace** (`feature-flags.ts:87`), so the flip hit every workspace at once with no canary.

4. **Client-facing `estimatedGain` still uses legacy recovery math while ranking uses OV — a coherence risk that survives the flag flip.** `pickImpactScore` touches `impactScore` only; `estimatedGain` is explicitly "deferred" (`recommendations.ts:1861`, verified). With OV on, the client sees recs *ordered* by grounded OV EMV but with *gain copy* derived from static per-check recovery constants (`recommendations.ts:1110-1113`) — identical for every workspace/page.

5. **Whole subsystems are detected, stored, and then never turned into recommendations.** `keyword_gaps`, `topic_clusters`, and `cannibalization_issues` are populated by generation (`persistence.ts:148-152`) but `generateRecommendations` imports none of them. **Cannibalization** — the highest-leverage "free" SEO win — is detected and stored but never reaches the priority queue. And **scheduled audits do not regenerate recommendations** (`scheduled-audits.ts`, no regen call), so a workspace on auto-audit cadence accrues fresh audits but stale recs.

---

## 2. HOW IT WORKS END-TO-END

### Data flow at a glance

```
EXTERNAL SIGNALS                STRATEGY GENERATION                 NORMALIZED TABLES        RECOMMENDATION ENGINE              CLIENT
─────────────────               ────────────────────                ─────────────────        ─────────────────────              ──────
Webflow pages/sitemap ─┐        discoverPages (S1)                  page_keywords ───────┐   generateRecommendations()          Overview #1 card
GSC (90d queries) ─────┤───────▶ searchData    (S2) ──┐             content_gaps ────────┤   ├─ 8 branches, 1 rec/row  ──────┐  (OV value + bars,
GA4 (28d) ─────────────┤        seoData       (S3) ───┼──▶ AI       quick_wins ──────────┼──▶├─ legacy impactScore         │  EMV stripped)
SEMrush/DataForSEO ────┘         synthesize    (S4) ──┘   synthesis keyword_gaps ────────┤   ├─ +OV (computeOpportunityValue)│  Strategy tab
  (gated on seoDataMode)         sanitize      (S5)        2 calls   topic_clusters ──────┤   ├─ pickImpactScore cutover ────┼─▶(legacy opportunity
client signals ────────────────▶ enrich        (S6) ─────────────┐  cannibalization ─────┘   ├─ sortRecommendations (tier→OV)│   score 0-100)
 (declined/requested/votes)      sanitize      (S7)              │                            └─ merge/auto-resolve/save     │
                                 persist        (S8) ◀───────────┘   (strategy_history ×5)                                   └─▶recommendation_sets
                                 follow-ons     (S9) ──30s──▶ generateRecommendations
```

### Owner Q2 — How strategy is generated

One orchestrator, `generateKeywordStrategy()` (`keyword-strategy-generation.ts:90`), reached from two callers: MCP chat (`job-actions.ts:42,89`) and the direct route/worker. Nine stages:

- **S1 Page discovery** (`keyword-strategy-pages.ts:296`, deterministic): resolves live URL, crawls sitemap (Webflow-API fallback), skip-lists utility/legal/tag pages (`:38-51`), caps to `maxPages` (default 500, hard cap 2000) preferring shallow pages with Webflow metadata (`capPaths:134`), fetches bounded HTML, drops thin pages <50 chars (`removeThinPages:253`). 7-day incremental skip.
- **S2 Search data** (`keyword-strategy-search-data.ts:35`, deterministic): GSC 90-day queries + 28-day device/country/period; GA4 28-day landing/overview/conversions/events. Every sub-call `.catch()`-guarded → silently degrades to empty.
- **S3 SEO provider data** (`keyword-strategy-seo-data.ts:68`): **entirely gated on `seoDataMode !== 'none'` and a configured provider (`:114-121`)**. Produces domain keywords (top 200), competitor keywords, keyword gaps (top 50), and — **only in `full` mode (`:246`)** — discovery/related/question keywords (the sources explicitly built "for sparse/low-footprint sites").
- **S4 AI synthesis** (`keyword-strategy-ai-synthesis.ts:174`) — the core. Assembles a business+client-signal context with **`strictBusinessFit: true`** (`:303`, verified); builds a deduped keyword pool from all sources, gated through `isStrategyPoolEligibleKeyword` and sliced to top 200 (`:474-487`); **AI call #1** assigns primary/secondary keywords per page in batches (`gpt-5.4-mini`, 20 pages/batch); validates keywords against the provider; **AI call #2** (master synthesis) returns `siteKeywords (8-15), opportunities (5-8), contentGaps (6-10), quickWins (3-5)`. Heavy deterministic hard-filtering follows each AI call (branded/declined/eligibility strips, `:1050-1142`).
- **S5/S7 Sanitize** (`keyword-strategy-sanitizer.ts:249`): re-runs every keyword through eligibility; repairs or drops pages with unrepairable primaries.
- **S6 Enrichment** (`keyword-strategy-enrichment.ts:220`): backfills volume/KD (bulk API **capped at 30**, `:344,402`), GSC metrics, SERP features; runs **`_removePageCoveredContentGaps`** (`:501`, the key prune); detects cannibalization; **AI call #3** clusters topics.
- **S8 Persist** (`keyword-strategy-persistence.ts:52`): single `BEGIN IMMEDIATE` txn; writes the 6 normalized tables (no count caps — `replaceAllContentGaps` inserts exactly what survived, `content-gaps.ts:172`) + a strategy-meta JSON blob; snapshots history (last 5).
- **S9 Follow-ons** (`keyword-strategy-follow-ons.ts:71`): 30s later, queues `generateRecommendations(workspaceId)` — the bridge into ranking.

### Owner Q1 — How keywords/opportunities are ranked

Four scoring stages:

- **Stage 1 — upstream "grounded spines" (generation time):** quick-win `roiScore = round(volume × (1−KD/100) / max(position,1))` (`enrichment.ts:798`); content-gap `opportunityScore` (0-100) = `(vol×0.45 + ease×0.45 + gscBonus×0.1) × trendMult` (`keyword-strategy-helpers.ts:84-91`). Persisted, later consumed by OV.
- **Stage 2 — legacy per-type `impactScore` (0-100):** one branch per producer — audit `severity base + critical bonus + traffic mult` (`recommendations.ts:630`); content-gap `65/45/25 → adjustKdImpactScore → +volumeBoost −difficultyPenalty` (`:1284-1298`); quick-win `75/55/35`; ranking-opp `60/40`; decay/CTR/freshness formulas; all × `pageImportanceMultiplier` (home 1.5×).
- **Stage 3 — two adjusters:** `adjustKdImpactScore` (KD-vs-authority `0.6/0.8/1.0/1.2`, `authority-context.ts:32-36`) and `applyRecommendationOutcomeAdjustment` (learned win-rate `[0.75,1.25]`, applied to every branch).
- **Stage 4 — OV attach + cutover + sort:** every branch attaches `computeOpportunityValue(...)` as `rec.opportunity`; `pickImpactScore` swaps `impactScore` ← `opportunity.value` when the flag is on (`:1862`, verified); `sortRecommendations` ranks **tier → impactScore → intent-alignment tiebreaker** (`:586-593`, verified).

**OV internals** (`scoring/opportunity-value.ts:307`): `value = normalizeToScore(emvPerWeek × 12wk × businessFit × confidence × calibration × timing ÷ effortDays)`, `normalizeToScore = min(100, 12·ln(1+roi))`. Demand from the grounded spines or volume×CTR-uplift; value-per-click from `cpc × intentWeight`; winnability from the KD/authority multiplier; confidence a discount (`1.0` grounded → `0.5` LLM-label → `0.4` heuristic).

### Owner Q3 — Why recommendations are made

`generateRecommendations` (`recommendations.ts:929`) produces recs from exactly **8 branches**, one rec per source row:

| Branch | Input source | Type / source key |
|---|---|---|
| Audit issue groups (`:1044`) | latest audit snapshot, grouped by check | metadata/schema/aeo/accessibility/performance/technical |
| Site-wide audit (`:1156`) | `audit.siteWideIssues` | technical |
| Strategy quick wins (`:1224`) | `listQuickWins` | strategy:quick-win |
| **Strategy content gaps (`:1278`)** | **`listContentGaps` (the `content_gaps` table)** | strategy:content-gap |
| Page ranking opps (`:1360`) | `page_keywords` pos 4-20, impr>100 | strategy:ranking-opportunity |
| Intent mismatch (`:1430`, cap 10) | mismatched page types | strategy:intent-mismatch |
| Content decay (`:1484`) | decay analysis, critical/warning | content_refresh |
| CTR / Diagnostic / Freshness (`:1562/1632/1689`) | insights + diagnostic reports | metadata / content / content_refresh |

Each rec gets a priority tier, product mapping (purchasable vs manual), `assignedTo`. Recs merge with the prior run by `buildMergeKey`, carrying over status/id; absent prior recs **auto-resolve to completed** (guarded by `failedCategories` so a data outage doesn't mass-complete). The set is saved to a single-row `recommendation_sets` blob; clients read it with `emfPerWeek`/`roiPerEffortDay` stripped (`routes/recommendations.ts:35-46`).

---

## 3. OV WIRING GAP ANALYSIS

The OV scorer is **fully and correctly wired for its one shipped job: re-ranking recommendations.** All 8 branches (11 push sites) attach an `opportunity`, and a single chokepoint (`pickImpactScore`, `:1862`) flips them together. The gaps are at the boundaries.

| # | Surface | Wired to OV? | Evidence | Severity |
|---|---|---|---|---|
| 1 | All rec branches → `impactScore` | **YES** (single chokepoint) | `recommendations.ts:1862` | — |
| 2 | Client #1 card / Strategy-tab detail (value + bars; EMV stripped) | **YES** | `OverviewTab.tsx:288-301`; `routes/recommendations.ts:35-46` | — |
| 3 | seoContext slice + AdminChat context | **YES** | `seo-context-slice.ts:297-303`; `admin-chat-context.ts:846-855` | — |
| 4 | Shadow divergence log + admin panel | **YES** (always-on, dark) | `ov-divergence.ts:156-197` | — |
| 5 | Events → timing → regen pipeline | **WIRED but DARK** (`opportunity-value-events` off) | `opportunity-detectors.ts:50,114`; `opportunity-regen.ts:54` | inert |
| 6 | Calibration | **WIRED but proxy basis** | `ov-calibration.ts:15-34` (win-rate proxy, not realized-vs-predicted EMV) | partial |
| **7** | **Client `estimatedGain` copy** | **NO — legacy recovery math** | `recommendations.ts:1110-1113,1265,1348`; summary `:445-456` | **HIGH (client-facing, survives flip)** |
| 8 | Sort **priority tier** (drives final order) | **NO — legacy heuristic** | tiers assigned per-branch; never recomputed from OV; sort tier-first `:586-593` | **HIGH (neutralizes OV ordering across tiers)** |
| 9 | Keyword-strategy keyword ranking (Strategy tab) | **NO — legacy `opportunityScore` 0-100** | `StrategyTab.tsx:443-476`; `keyword-strategy-helpers.ts:74` | MEDIUM (two-scorer divergence) |
| 10 | Content-gap surfacing / pruning | **NO** (correctly out of scope) | `content-gaps.ts` zero OV refs | n/a (Faros symptom lives here) |
| 11 | Per-workspace flag rollout | **NOT POSSIBLE** — flag is global | `feature-flags.ts:87` (no workspaceId param) | MEDIUM (rollout blocker) |
| 12 | Meeting brief, MCP keyword tools, keyword-gaps/clusters/cannibalization tables | **NO** | `meeting-brief-generator.ts:47`; no OV refs under `server/mcp/` | LOW |

**The most important coherence risk (#7 + #8 together):** with the flag on, the client sees recommendations *ordered* by OV (within tiers) but with *gain copy* from static legacy constants, and the cross-tier ordering still obeys legacy tiers. So the headline promise of OV — "rank by grounded ROI" — is only partially delivered: a high-ROI content gap can be both mis-ordered (stuck in `ongoing` below low-ROI `fix_soon` items) and mislabeled (legacy recovery-rate gain string). `ov-estimatedgain-real-attribution` is genuinely deferred (needs persisted predicted EMV + accumulated outcomes), but it should ship *with or before* a real cutover, not after.

**Confirmed for the symptom:** OV neither caused nor can fix Faros's 2 content gaps. `content-gaps.ts` and every `keyword-strategy-*.ts` file contain zero OV references; the count is decided entirely in generation.

---

## 4. WHAT HAS BEEN LEFT IN THE DUST

### The Faros content-gap sparsity — full causal chain (extraction → pruning → declines)

Content gaps pass through a 5-gate funnel, each able to prune toward zero. In order of impact:

1. **Data starvation from `seoDataMode` defaults (root cause).** MCP path → `'none'` (no provider data at all, `generation.ts:82-84` verified + `job-actions.ts:89`). UI default → `'none'`, auto-upgraded only to `'quick'` when a provider exists (`KeywordStrategy.tsx:90,143`), never `'full'`. Discovery/related/question keywords — the sources designed for sparse sites — are `full`-only (`seo-data.ts:246`). A low-footprint site therefore gets a tiny pool and the AI has little to draw gaps from.

2. **`strictBusinessFit: true` hard-suppression (dominant pruning gate).** Hardcoded at `ai-synthesis.ts:303` (verified). A provider-owned candidate with zero business-token overlap gets `-18` (`rules.ts:304`), and any `business_mismatch ≤ -12` becomes a hard `suppressed = true` (`rules.ts:334-336`, verified). This fires at pool entry, both sanitizer stages, AND the content-gap filter — so for a workspace whose context tokens don't *lexically* overlap its competitor/gap keywords, legitimate gaps are silently removed at multiple stages. Business-fit is **token-overlap only** (`rules.ts:166-174`) — no semantic match — so this over-prunes any workspace with a short/empty business context.

3. **`_removePageCoveredContentGaps` substring matching (overly broad).** A multi-word gap is removed if it's a *substring* of any assigned keyword OR of any `pageTitle + pagePath` (`enrichment.ts:101-114`, verified). "dental implants cost" is pruned if any page is merely titled/slugged to contain that phrase, even if it doesn't target the cost intent. Combined with the prompt already telling the AI to avoid overlaps, this is double-pruning.

4. **Difficulty-gate discards easy long-tail.** `isStrategyQualityDiscoveryKeyword` drops discovery keywords with `difficulty === 0` (`keyword-strategy-helpers.ts:48-52`), but DataForSEO legitimately reports 0 for low-competition long-tail — the easiest wins for a sparse site.

5. **No floor / no backfill.** The "6-10" content-gap count is a soft LLM prompt target (`ai-synthesis.ts:1014`) with no deterministic top-up. After the stacked hard filters, nothing refills toward a target, so aggressive suppression compounds straight into a low final count.

6. **Declines** (the legitimate prune): client-declined keywords are skipped (`recommendations.ts:1282`). This is correct behavior, not staleness.

**Verdict on the symptom:** the extraction/pruning IS overly conservative — specifically gates #2, #3, and #4 — and it is amplified by data starvation (#1). For Faros specifically the two highest-probability culprits are: regenerated via MCP (→ `seoDataMode='none'`), and/or `strictBusinessFit` suppressing competitor-gap keywords that don't lexically match its business terms.

### Other staleness / left-behind findings

- **Scheduled audits never regenerate recs** (`scheduled-audits.ts`, no `generateRecommendations` call) — only on-demand audits do (`routes/jobs.ts:236-251`). Auto-audit-only workspaces get fresh audits, stale recs. **The single biggest recommendation-staleness gap.**
- **Three tables never become recs:** `keyword_gaps`, `topic_clusters`, `cannibalization_issues` are populated (`persistence.ts:148-152`) but never read by `recommendations.ts`. The `strategyInsight('keyword_gap')` branch (`:885-895`) is dead code — a fossil from when keyword gaps were meant to be recs.
- **Cannibalization detected, stored, never surfaced** as a rec or insight-rec — `generateRecommendations` reads only `ctr_opportunity`/`freshness_alert`/`conversion_attribution` insights, never `cannibalization`. Self-competition (a free win) never enters the queue.
- **Event-driven re-ranking spine fully inert** — the entire timing/decay/rank-drop infrastructure is gated behind `opportunity-value-events = false`; timing boost is always 0, the "reprioritize on apply" tail never fires.
- **Geo defaults to US for the whole pool** — primary provider calls pass no `database`/`location` (`dataforseo-provider.ts:57-58`); only late enrichment backfill threads `resolveWorkspaceLocationCode` (`enrichment.ts:347`). A non-US workspace gets US volumes/SERP for its entire keyword universe.
- **Collected-but-unused signals:** GA4 conversion value is fetched but not fed into OV (the intent proxy is used instead); GSC-proven demand is skipped for gap volume (`enrichment.ts:378-388`), collapsing GSC-validated gaps to weak LLM-label confidence; Google Ads planner data is parked unused (`seo-data.ts:265`); SERP-feature crowding is advice-text only, not a ranking input.
- **Code fossils:** stale comment "keyword-intelligence module not available in this branch" with a duplicated local type (`keyword-strategy-context.ts:5-6`); `LOW_ACTIONABILITY_PHRASES` hardcodes demo-specific phrases ("paper tiger", "typing tiger") into the global suppressor (`rules.ts:8-15`); the two high-value AI calls use instruction-based JSON with no Zod shape validation, against CLAUDE.md's structured-output rule.

---

## 5. RANKED IMPROVEMENT OPPORTUNITIES (Owner Q4 + Q5)

Honestly separated: material fixes first, polish last. Effort S/M/L; Impact H/M/L.

### Tier A — Materially fixes the symptom and the most-visible coherence risks

| # | Improvement | Problem it solves | Approach | Impact | Effort | Depends on |
|---|---|---|---|---|---|---|
| A1 | **Thread `seoDataMode` through MCP + default to `full` when a provider is configured** | MCP regens run with zero provider data → starved pool → sparse gaps (Faros root cause #1) | Add `seoDataMode` to `mcp-action-schemas.ts:521` and pass it at `job-actions.ts:89`; change `normalizeSeoDataMode` default / UI default (`KeywordStrategy.tsx:143`) to `full` when a provider exists | **H** | **S** | none |
| A2 | **Move discovery/related/question fetches out of the `full`-only gate** | The sources built for sparse sites never fire on the default path (`seo-data.ts:246`) | Run discovery whenever a provider is configured (cost-bounded), independent of mode | **H** | **S** | A1 (or standalone) |
| A3 | **Make `strictBusinessFit` config-/flag-driven and exempt the `content_gap` source from hard suppression** | Dominant over-pruner; token-overlap-only suppression silently kills legitimate competitor-gap content gaps at multiple stages (`ai-synthesis.ts:303`, `rules.ts:334-336`) | Plumb a workspace/flag setting; for `content_gap` candidates downgrade `business_mismatch` from hard-suppress to a score penalty so the prompt's "invent only if relevant" path survives | **H** | **M** | owner decision (how strict to be) |
| A4 | **Recompute priority tier from OV (or sort by OV across tiers) when the flag is on** | OV ordering is neutralized across tiers; tier comes from legacy heuristic, sort is tier-first (`recommendations.ts:586-593`) | Either derive tier from OV value bands when `useOv`, or make OV the primary sort key with tier as tiebreaker | **H** | **M** | OV cutover decision |
| A5 | **Derive client `estimatedGain` from `opportunity.emvPerWeek`** (the `ov-estimatedgain-real-attribution` item) | Client sees OV-ranked recs with stale legacy gain copy — incoherent after flip (`recommendations.ts:1110-1113`) | Compute gain from OV EMV when grounded; keep legacy fallback for ungrounded; respect EMV-stripping for the public response | **H** | **M** | OV cutover; needs persisted predicted EMV for full fidelity |

### Tier B — Materially improves strategy quality / closes left-behind subsystems

| # | Improvement | Problem it solves | Approach | Impact | Effort | Depends on |
|---|---|---|---|---|---|---|
| B1 | **Regenerate recommendations after scheduled audits** | Auto-audit workspaces accrue stale recs (`scheduled-audits.ts` has no regen) | Call `generateRecommendations` (debounced) at the end of `runScheduledAudit`, mirroring `routes/jobs.ts:236-251` | **H** | **S** | none |
| B2 | **Surface cannibalization as recommendations** | Highest-leverage free win is detected/stored but never queued | Add a branch reading `listCannibalizationIssues`, mapping to a `technical`/`content` rec with the existing canonical recommender output | **H** | **M** | none |
| B3 | **Per-workspace flag dimension for OV** (the `ov-per-workspace-flag-dimension` item) | Flag is global (`feature-flags.ts:87`); no staged/canary rollout possible — the flip already hit all workspaces | Extend `feature_flag_overrides` with an optional `workspaceId` key; thread `workspaceId` into `isFeatureEnabled` for OV flags | **M** | **M** | owner decision (do staged rollout?) |
| B4 | **Surface keyword-gap recs from the `keyword_gaps` table** | Populated but never recommended; dead `strategyInsight('keyword_gap')` branch | Add a branch reading `listKeywordGaps`; reuse the dead `keyword_gap` story path | **M** | **M** | none |
| B5 | **Narrow `_removePageCoveredContentGaps` matching** | Substring prune erases distinct intent-variant gaps (`enrichment.ts:101-114`) | Require exact assigned-keyword match (drop the title+path substring path, or require full-phrase token-set match), so cost/comparison/intent variants survive | **M** | **S** | A3 (related conservatism knob) |
| B6 | **Add a deterministic content-gap backfill toward a floor** | Soft "6-10" target with no top-up; suppression compounds into low counts | After filters, if count < floor, refill from the highest-`opportunityScore` suppressed/uncovered pool candidates | **M** | **M** | A3/B5 (so backfill has candidates) |
| B7 | **Thread workspace locale into the primary provider calls** | Whole keyword universe fetched against US volumes/SERP for non-US workspaces (`dataforseo-provider.ts:57-58`) | Pass `resolveWorkspaceLocationCode` / a workspace country field into `getDomainKeywords`/`getKeywordGap`/`getRelatedKeywords`/`getQuestionKeywords` (`seo-data.ts`) | **M** (H for non-US) | **M** | workspace country field if absent |
| B8 | **Drop the `difficulty > 0` discovery gate** | Discards zero-competition long-tail — the easiest sparse-site wins (`keyword-strategy-helpers.ts:48-52`) | Remove/relax the gate; rely on eligibility + opportunity score instead | **M** | **S** | none |

### Tier C — Raises OV grounding / data exploitation (do after OV is live)

| # | Improvement | Problem it solves | Approach | Impact | Effort | Depends on |
|---|---|---|---|---|---|---|
| C1 | **Feed GA4 conversion value into OV for content-gap/quick-win branches** | Real per-page conversion value is fetched but discarded; OV uses a generic intent proxy (`recommendations.ts:1330`) | Pass conversion value as `valuePerClick` when present, replacing `cpc × intentWeight` | **M** | **M** | OV cutover |
| C2 | **Stop discarding GSC-proven demand for gap volume** | GSC-validated gaps collapse to llm-label confidence in OV (`enrichment.ts:378-388`) | Pass GSC impressions as an explicit `gscImpressions` OV input / volume estimate | **M** | **M** | OV grounding |
| C3 | **Calibration on realized-vs-predicted EMV** (the `ov-calibration` item) | Calibration ships a win-rate proxy, not what the model intends (`ov-calibration.ts:15-34`) | Persist `predicted_emv` per rec; divide realized against it | **M** | **M** | C1/C2; needs prediction column |
| C4 | **Harden event-regen single-flight before enabling `-events`** | Event regen can race the cron regen (`opportunity-regen.ts`) | Share the cron's `recsInFlight` guard | **M** | **S** | enabling `-events` |
| C5 | **Add Zod shape validation to the two strategy AI calls** | Malformed-but-parseable master response silently yields empty gaps; violates CLAUDE.md structured-output rule (`ai-synthesis.ts:1043`) | Register named operations + validate parsed payloads | **M** | **M** | none |

### Tier D — Polish / cleanup (not material to strategy quality)

- Configurable fan-out caps (intent-mismatch 10, CTR/freshness 10, diagnostics 3×5) so large sites' tail surfaces (`recommendations.ts:1433,1570,1693`). **L / S.**
- Remove demo-specific `LOW_ACTIONABILITY_PHRASES` from the global suppressor (`rules.ts:8-15`). **L / S.**
- Delete the stale "module not available" comment + duplicated local type in `keyword-strategy-context.ts:5-6`. **L / S.**
- Add failure guards to audit/strategy rec branches so a transient empty doesn't auto-resolve (`recommendations.ts:1044,1278`). **L / S.**
- Decide on parked Google Ads planner data + use SERP-feature crowding as an OV CTR modifier (`seo-data.ts:265`). **L / M.**
- Post-flip: remove legacy magic scorers + the `ov-legacy-scorer-removal` / `ov-magic-scale-prcheck` cleanups. **L / M, post-cutover.**

**Honest framing of the wish-list:** A1-A5 and B1-B2 are the genuinely material moves — A1/A2/A3 directly fix the Faros symptom, A4/A5 fix the OV coherence risks that are *already live* with the flag on, and B1/B2 close the two biggest "detected-but-never-recommended" gaps. Everything in Tier C is real but should follow a confirmed OV cutover (it only matters once OV scores drive the product). Tier D is correctness hygiene, not strategy improvement — worth doing opportunistically, not as a project.

**Key files:** `server/keyword-strategy-{generation,seo-data,ai-synthesis,enrichment,helpers,sanitizer,persistence,follow-ons}.ts`, `server/keyword-intelligence/rules.ts:303-338`, `server/mcp/tools/job-actions.ts:89`, `shared/types/mcp-action-schemas.ts:521`, `server/recommendations.ts` (`:929,1278,1862,1866,586-593`), `server/scoring/opportunity-value.ts:307,358`, `server/scheduled-audits.ts`, `server/content-gaps.ts:172`, `server/feature-flags.ts:87`, `src/components/KeywordStrategy.tsx:90,143`.

---

# Adversarial Review — Corrections (apply before acting)

Two independent review lenses graded this **SOUND_WITH_FIXES**: the backbone is line-accurate and verified, with these targeting corrections (do not act on the original wording for these):

- **A3 / strictBusinessFit — the "empty context" framing is INVERTED.** The `-18` business_mismatch penalty + hard-suppress (`rules.ts:303-336`) fire ONLY when the business context is *populated* (`hasBusinessFitContext`, `rules.ts:283-289`); an **empty** context *disables* the gate. So the over-pruning hits workspaces with a **narrow/populated** context whose tokens don't lexically overlap competitor/gap keywords (token-overlap only, no semantic match, `rules.ts:166-174`). The A3 fix (exempt `content_gap` from hard-suppress → score penalty, or add semantic matching) stands; only the "who it hurts" story changes.
- **B2 / cannibalization — partly redundant (demote H→M, needs dedup).** Cannibalization ALSO reaches clients today via the analytics-intelligence **insights** pipeline (`insightType:'cannibalization'`, `analytics.ts:193`, `analytics-intelligence.ts:1240-1250`). The real gap is only that the *strategy-generation* `cannibalization_issues` table (which carries 301/canonical/differentiate actions) is never wired to recs. Dedup against the existing insight before adding a rec branch.
- **C2 / GSC-for-gap-volume — overstated/risky (demote).** Skipping GSC as a VOLUME source is an INTENTIONAL, documented choice (`enrichment.ts:379-381`): GSC "volume" is impressions, not search volume, and GSC entries carry difficulty=0 — feeding it in as volume would corrupt the KD-based impactScore. Reframe: add a SEPARATE `gscImpressions` confidence/demand input; never substitute it for volume.
- **B5 / page-coverage prune — overstated (soften).** The substring match is **multi-word-only** with a deliberate single-word guard + explanatory comment (`enrichment.ts:88-117`). Scope the fix narrowly to the substring-direction edge case (a multi-word gap contained in a longer assigned keyword), not a broad over-prune.
- **A1 — split by cost.** A1a = thread `seoDataMode` through the MCP tool (`mcp-action-schemas.ts:521` + `job-actions.ts:89`) — S, no risk, and the single most likely fix for a chat-regenerated Faros. A1b = change the *default* mode to quick/full — gated on a provider-credit cost decision (full mode fires paid DataForSEO calls). Promote A2 (un-gate discovery, cost-bounded) as the cheaper sparse-site lever.
- **Compounding effect (strengthens A4):** surviving medium/low content gaps default to the `ongoing` tier (`recommendations.ts:1322`); since the sort is tier-primary, they're buried beneath every `fix_soon`/`fix_now` item **regardless of OV** — so Faros-type gaps are both sparse AND buried. A4 (tier-from-OV or OV-primary sort) addresses the second half.
- **Citation:** the DataForSEO provider is at `server/providers/dataforseo-provider.ts` (not `server/dataforseo-provider.ts`).

Net: trust the structure and the A1a / A2 / A4 / A5 / B1 prioritization. Correct A3's targeting, demote B2 and C2, soften B5.
