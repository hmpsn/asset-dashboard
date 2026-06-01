# Intelligence Quality & Wiring Audit — 2026-05-31

> **Read-only diagnosis.** Zero source writes were made. Every claim below was verified against current staging source at tip `08d30739` (the merge of all four remediation phases — `integrity/phase-4-advisor-completeness`). Each finding cites `file:line` confirmed by direct read.
>
> This audit **builds on, and does not duplicate,** the prior foundational-integrity audit (`docs/audits/2026-05-31-foundational-integrity-audit.md`), which asked *"does a state change propagate downstream?"* and covered the ROI-loop data model — both now largely remediated. **This audit asks a different question:** are the recommendations the **right ones at the right time** (quality), and is the strategy / keyword / SEO-recommendation machinery **wired and configured to deliver maximum client value**? "Does it propagate" was audit #1; "is it good / correctly sourced / correctly configured" is this one.
>
> Findings are graded ONLY against the 7-dimension rubric (Winnability, Demand, Intent/commercial value, Effort, Business fit, Timing, Evidence) and the 3 platform capabilities (i: surface ONE ranked priority per client; ii: close rec→action→outcome→ROI loop; iii: coherent advisor context), and ranked by **client impact for the 2 live paying clients**. Where the remediation added a wire, this audit verified whether that wire actually closed the gap — in most cases it added a *tiebreaker* or a *completion* path, not the quality/sourcing fix the dimension requires.
>
> Method: 6 mapping agents → 5 specialist workers → 35 candidate findings → 35 adversarial skeptics (each defaulting to "refuted" unless it could prove the gap from current source). 47 agents total. The synthesis lead independently re-verified the load-bearing anchors against tip `08d30739`.

---

## 1. Verdict counts

| Verdict | Count |
|---|---|
| **Confirmed** | **28** |
| — collapsing to distinct root causes (after dedup, §5) | ~14 |
| Unclear / needs human | 0 |
| **Needs empirical validation** (post-outcome-loop; subset of confirmed) | 5 |
| Refuted & dropped (adversarial) | 7 |
| Candidates raised | 35 |

### Worker × impact matrix (28 confirmed)

| Worker | High | Medium | Low | Total |
|---|---|---|---|---|
| Quality | 2 (Q1, Q2) | 5 (Q3, Q4, Q5, Q6, Q7) | 1 (Q8) | 8 |
| Missed Wiring | 0 | 4 (MW1, MW2, MW3, MW5) | 1 (MW6) | 5 |
| Incorrect Wiring | 0 | 4 (IW1, IW2, IW6, IW7) | 0 | 4 |
| Slice Integration | 2 (SI1, SI5) | 4 (SI2, SI3, SI4, SI6) | 0 | 6 |
| Configuration | 2 (CC1, CC2) | 3 (CC3, CC5, CC6) | 0 | 5 |
| **Total** | **6** | **20** | **2** | **28** |

> The 28 confirmed findings collapse to ~14 distinct root causes (§5) — several were independently raised from the quality, wiring, incorrect-wiring, and config angles and corroborate one another. Counts above are distinct findings; §5 records the merges.

---

## 2. The through-line

**The engine surfaces plausible LLM/heuristic *guesses* as if they were opportunity-grounded priorities, and it is event-blind: it never re-prioritizes when the world changes.** Two themes converge. First, **on the quality axis**, every high-stakes client-facing ranking number — the technical-rec impactScore, the quick-win score, the content-gap score, the ranking-opportunity score, the freshness score — is built from a *magic constant or an LLM-written adjective* (severity bases, `75/55/35` impact buckets, `60/40` position buckets, `impressions/50`), while the genuinely data-grounded signals the platform already paid SEMrush/DataForSEO to compute (`roiScore = volume·(1−KD/100)/position`, the trend-weighted `opportunityScore`, per-keyword KD vs domain authority) are computed, persisted, *sorted by* in their own tables — and then **discarded at the one surface that drives the client's ranked queue and `topRecommendationId`.** Second, **on the timing axis**, the recommendation set is a frozen, regen-gated snapshot: there is no decay cron, the scheduled-audit cron refreshes insights but never regenerates recs, and the two clearest NOW-events the platform detects (a competitor overtaking the client; tracked-keyword position losses) reach only advisor prose or a never-lead briefing watch-list — never the ranked priority. The four remediation phases wired *completion* (recs flip to done on apply) and a *within-tier intent tiebreaker*, but neither touches the scoring sourcing nor adds event-driven re-prioritization. Net effect for the 2 live clients: the single `#1 priority` card can be the harder, lower-yield, market-collapsed, or stale opportunity, and "right rec at the right time" degrades to "the rec as of the last manual regen."

---

## 3. Top 5 Highest-Impact Findings

### 1. The technical/audit rec score ignores winnability, demand, commercial intent, and effort — and it sets `topRecommendationId` (Q1)
`server/recommendations.ts:577-592` — `computeImpactScore = severity_base (60/35/15) + critical_bonus (+20) + traffic_multiplier (0-20)`, then `× pageImportanceMultiplier`; site-wide issues hard-coded `80/50` at `:1052`. This is the **largest rec category** (technical/metadata/schema/AEO/performance) and it competes against difficulty/volume-scored content recs on the **same `impactScore` axis** that feeds the global sort (`:518-541`), `topRecommendationId` (`:428`), and the client's `#1` card (`src/components/client/OverviewTab.tsx:98-104`). **Fails dimensions 1, 2, 3, 4 + Capability (i).** Client cost: a title fix on a low-traffic page can outrank a striking-distance commercial opportunity; clients are steered to effort that may not move revenue. The remediation's `effectiveBusinessPriorities` is only a within-equal-impactScore tiebreaker (`:533-540`, doc at `:514-516`) and cannot rescue a higher-value lower-scored fix.

### 2. The roiScore winnability composite is computed, persisted, sorted by — then discarded; quick wins rank by an LLM adjective (Q6 / MW1 / IW1 / CC1 — one root cause)
`server/keyword-strategy-enrichment.ts:798` computes `roiScore = volume·(1−difficulty/100)/max(position,1)` — a genuine winnability + demand + striking-distance composite — persisted to `quick_wins.roi_score` and read `ORDER BY roi_score DESC` (`server/quick-wins.ts:81`). But the quick-win rec's `impactScore` **and** its priority tier are built purely from the LLM-written `estimatedImpact` string bucket (`75/55/35` at `server/recommendations.ts:1118-1122`). `roiScore`/`roi_score` appears **zero times** in `recommendations.ts` (verified). **Fails dimensions 1, 4, 7 + Capability (i).** Client cost: a roiScore-140 striking-distance win tagged "medium" sinks below a roiScore-8 page the model called "high"; the single surfaced `#1` priority can be the wrong quick win. The `:801` fallback (`high?100:medium?50:20`) means the upstream signal is itself a magic bucket when metrics are absent — so even the sorted table is partly ungrounded.

### 3. The recommendation set is a frozen snapshot — no decay cron, scheduled audits don't regen, competitor/position-loss events never re-rank (Q5 / SI5 — one root cause)
`GET` serves the cached set and regenerates only `if (!set)` (`server/routes/recommendations.ts:39-43`); `generateRecommendations` has exactly four callers (POST, first-GET, keyword-strategy follow-on, on-demand audit job). The weekly scheduled-audit cron (`server/scheduled-audits.ts:116-348`) fires `audit_finding` insight bridges + `invalidateIntelligenceCache` but **never** calls `generateRecommendations`. `analyzeContentDecay` runs **only** on an admin POST (`server/routes/content-decay.ts:26`) — there is no decay cron. `resolveRecommendationsForChange` (`:334-377`) only flips intersecting recs to *completed* — it adds and re-scores nothing. **Fails dimension 6 + Capability (i).** Client cost: a critical decay or competitor overtake occurring after the last audit sits invisible; the `#1` priority card (`OverviewTab.tsx:98`) can be stale for days/weeks — the headline promise fails precisely when timing matters most.

### 4. The platform detects the two clearest NOW-events and routes neither to the ranked queue (Q4 / MW3 — one root cause)
A weekly Monday cron writes `competitor_alert` insights (`server/intelligence-crons.ts:129`), and the seoContext slice computes tracked-keyword `positionChanges.declined` and per-competitor organic-traffic snapshots (`server/intelligence/seo-context-slice.ts:87-98, 236-256`). `generateRecommendations` reads exactly three insight types — `conversion_attribution`, `ctr_opportunity`, `freshness_alert` — and **none** of them is competitor- or rank-decline-derived (`recommendations.ts:876, 925, 1395, 1507`; the rec engine reads only `backlinkProfile` from seoContext, `:913`). `competitor_alert` is consumed only by the briefing Watch List, where it is marked *never-lead* (`briefing-templates/competitor-alert.ts:195`). **Fails dimension 6.** Client cost: the moment a competitor leapfrogs the client on a money keyword — the most time-sensitive SEO event there is — produces no ranked recommendation. (Note: the briefing watch-list surfacing and the never-lead spec decision soften, but do not close, the gap.)

### 5. Authority/winnability discrimination is applied to content-gap recs only — the striking-distance recs where it matters most never see it (CC2 / Q2 — one root cause)
`adjustKdImpactScore(base, difficulty, domainStrength)` is the engine's winnability adjustment (KD vs domain authority). It is called at **exactly one** numeric-scoring site: the content-gap branch (`recommendations.ts:1166`). The ranking-opportunity branch (positions 4-20, where "can we realistically rank?" decides ROI) scores on a flat `60/40` position bucket × path multiplier (`:1234-1235`); `pm.difficulty` is available but routed only to a prose `authorityAssessment` note (`:1242`), and **`pm.volume` is never read at all** in the block (`1226-1275`). **Fails dimensions 1, 2.** Client cost: a KD-5 / 5000-volume opportunity and a KD-90 / 50-volume opportunity at the same position score identically; a low-authority client gets the same score for an unwinnable KD-80 push as a winnable KD-20 keyword, so unwinnable pushes can occupy the `#1` slot.

---

## 4. Findings by worker

### Quality (Q)

**Q1 — Technical/audit score blind to winnability/demand/intent/effort.** `server/recommendations.ts:577-592` (score), `:985-995` (audit path), `:1052` (site-wide `80/50`), `:1017-1022`/`:1069-1074` (outcome-adjustment omits difficulty). Today: severity + critical-flag + relative-traffic only, the largest rec category. **Fails 1,2,3,4 + Cap (i).** Cost: see Top-5 #1. *Direction:* fold KD-vs-authority, volume, and effort into `computeImpactScore`. **Impact: high.**

**Q2 — Striking-distance recs use flat 60/40 bucket; volume never read, KD/authority used only as prose.** `recommendations.ts:1234-1235, 1242, 1249`; volume absent in `1226-1275`. The one rec type gated on a *real* winnability signal (`pos 4-20 AND impressions>100`, `:1231`) then discards it. **Fails 1,2.** Cost: two pos-8 pages with wildly different KD/volume score identically. *Direction:* score from `volume × winnability-vs-KD × position-proximity`. **Impact: high.** *(Shares root cause with CC2 — merged in Top-5 #5.)*

**Q3 — Content-gap recs discard the persisted, trend-aware `opportunityScore`.** `recommendations.ts:1163` (baseScore from LLM `cg.priority`), `:1201` (tier from `cg.priority`); composite computed at `keyword-strategy-helpers.ts:74-92`, trend mult from `seo-provider-signals.ts:6-15`, persisted at `content-gaps.ts:68,89,97` (table even `ORDER BY opportunity_score DESC`) — **never read** in `recommendations.ts`. **Fails 7,6,2.** Cost: rising-demand seasonal gaps not boosted, declining ones not demoted in the ranking the client sees. *Direction:* consume persisted `opportunityScore` (incl. `trendDirection`). **Impact: medium.** *(Duplicate of MW2/IW2 — merged below.)*

**Q4 — Competitor alerts never become a ranked rec.** See Top-5 #4. **Fails 6.** *Direction:* add a `competitor_alert → recommendation` path. **Impact: medium.** *(Shares root cause with MW3.)*

**Q5 — Rec set is a regen-gated snapshot; no decay/competitor/ranking-loss event re-scores it.** See Top-5 #3. **Fails 6 + Cap (i).** *Direction:* schedule decay analysis + event-triggered regen on publish/decay/competitor. **Impact: medium** (per-finding) / escalated to **high** on the merged staleness root cause (SI5). *(Merged with SI5.)*

**Q6 — Quick-win & diagnostic impactScores are LLM string buckets (75/55/35); the data-grounded roiScore is unused and its own fallback is a magic bucket.** `recommendations.ts:1118` (quick-win), `:1462` (diagnostic); roiScore fallback `keyword-strategy-enrichment.ts:801` (real formula `:798`). Provenance LLM-confirmed: `keyword-strategy-ai-synthesis.ts:1003` (gpt-5.4-mini), `diagnostic-orchestrator.ts:436`. **Fails 7.** Cost: a "high" label invented by the LLM outranks a measured opportunity when metrics are missing. *Direction:* treat the LLM label as a tiebreaker; never rank an ungrounded quick win above a measured one. **Impact: medium.** *(Root cause shared with MW1/IW1/CC1 — Top-5 #2.)*

**Q7 — Client-facing `estimatedGain` recovery % are static per-check constants with zero grounding.** `recommendations.ts:69-108` (constants), `:1011-1015` (interpolation), served `routes/recommendations.ts:50`, rendered `InsightsEngine.tsx:521`. Today: `"could recover 15-30%"` strings identical for every workspace/page; the just-built `attributed_value` outcome loop does **not** feed them (zero matches for `attributed_value`/`recordOutcome` in `recommendations.ts`). **Fails 7 + Cap (ii).** Cost: concrete-sounding invented percentages shown to both paying clients — a credibility risk for a high-end product, and irreconcilable with tracked outcomes. *Direction:* ground in the page's actual traffic-at-risk + accumulated outcomes. **Impact: medium.**

**Q8 — Stated business priorities only break exact tier+impactScore ties; the multi-dimensional business-fit scorer is confined to the content-matrices surface.** `recommendations.ts:533-540` (tiebreaker), doc `:512-516`; the richer scorer (`keyword-intelligence/rules.ts:103-316`, client-requested +18 / business-priority +10 / businessFit×8) is imported only by `keyword-recommendations.ts` → `routes/content-matrices.ts`, never by `generateRecommendations`. **Fails 5,3 + Cap (i).** Cost: a client who says "grow emergency plumbing revenue" still sees an unrelated high-traffic title fix above a plumbing opportunity. *Direction:* let `effectiveBusinessPriorities` apply a graded weight, or reuse the `rules.ts` deltas. **Impact: low.** *(Duplicate of SI6 — merged below.)*

### Missed Wiring (MW)

**MW1 — Quick-win roiScore surfaced on Strategy tab but ignored by the rec engine.** `recommendations.ts:1118,1122,1661` vs `src/components/strategy/QuickWins.tsx:34` (ROI badge shown). **Fails 1,4 + Cap (i).** *Direction:* feed `qw.roiScore` into the quick-win impactScore + tier. **Impact: medium.** *(Same root cause as Q6/IW1/CC1 — Top-5 #2.)*

**MW2 — Content-gap ranker ignores `opportunityScore` + `trendDirection`; sort also discards the `opportunity_score DESC` ordering.** `content-gaps.ts:60-68,97`; `keyword-strategy-helpers.ts:87-90` (trend mult baked in); `recommendations.ts:1163-1206` (reads `cg.priority/volume/difficulty` only). **Fails 6,7.** *Direction:* consume `cg.opportunityScore`. **Impact: medium.** *(Duplicate of Q3/IW2.)*

**MW3 — Competitor snapshots + rank-decline are event-blind to the rec engine.** `seo-context-slice.ts:87-98, 236-256`; `recommendations.ts:903,913` reads only `backlinkProfile`. The `position_decline` anomaly path runs off GSC period-comparison (not `positionChanges.declined`), is flag-gated, and fires only on manual diagnostic; there is **no** competitor-based anomaly type at all. **Fails 6.** *Direction:* add a timing input that consumes rank declines and competitor organic-traffic deltas. **Impact: medium.** *(Shares root cause with Q4 — Top-5 #4.)*

**MW5 — Repeat-decay (`isRepeatDecay`) is detected and shown to the advisor but ignored in the decay rec's priority/score/framing.** `content-decay.ts:39,206` (set from prior `content_refresh` "loss" outcomes); surfaced `content-pipeline-slice.ts:139`, `formatters.ts:659`; **ignored** in rec build `recommendations.ts:1331-1381` (zero reads of `isRepeatDecay`, verified). **Fails 6,4 + Cap (ii).** Cost: a page that already burned a refresh and kept declining is re-sold the same "refresh again" framing at the same priority — the one place the outcome loop should change the *next* recommendation never closes. *Direction:* read `dp.isRepeatDecay` to escalate priority/score or switch tactic. **Impact: medium.** **(Needs empirical: requires accumulated outcome history to fire.)**

**MW6 — Admin advisor context drops `rec.impactScore` and `summary.topRecommendationId`.** `admin-chat-context.ts:845-848` (keeps only title/type/priority/impact/effort); `recommendations.ts:428,439` computes `topRecommendationId` but it never reaches the advisor. **Fails 7 + Cap (iii).** Cost: the advisor can paraphrase "impact: high" but can't cite the numeric rank or name the `#1`; admin and client can hold different notions of the top priority. *Direction:* include `impactScore`, `trafficAtRisk`, and flag the `topRecommendationId` rec in the advisor `recSummary`. **Impact: low.**

### Incorrect Wiring (IW)

**IW1 — Quick-win recs re-score from the LLM bucket, discarding `roi_score`; both tier and `topRecommendationId` can invert the engine's own math.** `recommendations.ts:1108-1122`; `keyword-strategy-enrichment.ts:796-804`; `quick-wins.ts:81`. **Fails 1,7 + Cap (i).** *Direction:* derive impactScore + tier from normalized `roi_score`, LLM bucket as documented fallback. **Impact: medium.** *(Top-5 #2.)*

**IW2 — Content-gap recs rebuild impactScore from the LLM priority bucket, dropping the trend-weighted `opportunityScore`.** `recommendations.ts:1163-1208`; `keyword-strategy-helpers.ts:74-92`; `content-gaps.ts:68,89,97`. **Fails 6,7,2.** *Direction:* feed `cg.opportunityScore` into impactScore. **Impact: medium.** *(Duplicate of Q3/MW2.)*

**IW6 — Decay impactScore & recoverable-traffic estimate scale with `previousClicks` (pre-decay volume), conflating size-of-loss with recoverable upside.** `recommendations.ts:1335-1337` (`60+previousClicks/50` / `40+previousClicks/100`), `:1371` (`trafficAtRisk = previousClicks`); severity from click-decline magnitude only (`content-decay.ts:177-179`). **Fails 1,4** (timing present, recoverability not weighed). Cost: a page that lost 500 clicks to a market-wide collapse scores the same as one losing 500 to a beatable competitor; the score presents past loss as future upside, and `computeRecommendationSummary` then estimates recoverable clicks as a flat 12% of historical traffic. *Direction:* weight decay impact by recoverability (current position, KD/authority, competitor-overtake vs market-wide drop). **Impact: medium.**

**IW7 — Freshness-alert impactScore is raw `impressions/50` (cap 80); `fix_now` tier set solely by analysis-date age.** `recommendations.ts:1513-1514, 1530, 1535`; floors `analytics-intelligence.ts:167-169,188-189`. No winnability/intent/business-fit; "stale by analysis date" can diverge from real content staleness. **Fails 2,3,7.** Cost: a high-impression but content-fresh page can dominate the `fix_now` tier on impression count alone and beat genuinely winnable opportunities for the single slot (freshness can reach 80, above the quick-win max of 75). *Direction:* gate/scale on actual content-age + decay/position evidence, and reconcile with content-decay to avoid double-counting. **Impact: medium.**

### Slice Integration (SI)

**SI1 — The roiScore winnability/demand composite never reaches the admin advisor.** No file in `server/intelligence/` imports `listQuickWins`; no MCP tool exposes quick wins (`get_keyword_analysis` returns gaps/clusters/cannibalization/lostVisibility only). roiScore at `keyword-strategy-enrichment.ts:798`; table `ORDER BY roi_score DESC` (`quick-wins.ts:81`). **Fails Cap (iii), 1, 2.** Cost: when a client asks the advisor "what should we work on," the advisor cannot see the workspace's highest-ROI striking-distance opportunities at all — it reasons from keyword strings. (Partial leak: rec *titles* reach the operational slice as bare counts and the pageProfile slice, but neither carries roiScore and pageProfile isn't advisor-routed.) *Direction:* surface `listQuickWins` (with roiScore) through seoContext and/or a dedicated MCP path. **Impact: high.**

**SI2 — seoContext reassembles enriched `strategy.contentGaps` every build, but no advisor formatter emits it.** `seo-context-slice.ts:39-52` (assembled) vs `formatters.ts:288-445` (`formatSeoContextSection` emits siteKeywords/pageKeywords/competitorSnapshots but never `strategy.contentGaps`/`quickWins`/`opportunities`); the only `contentGaps` emission (`:969`) is the thinner `string[]` in the pageProfile section. **Fails Cap (iii), 2, 7.** Cost: advisor answers about "what content to create" are ungrounded relative to the volume/difficulty/opportunityScore data the slice already holds and the engine spent provider quota to fetch. *Direction:* add a `strategy.contentGaps` branch (top-N by opportunityScore) to `formatSeoContextSection`. **Impact: medium.**

**SI3 — Public quick-wins serializer strips computed `roiScore`; clients see only the LLM bucket.** `routes/public-content.ts:216-221`; client type lacks the field (`src/components/client/types.ts:137`); only the admin view renders ROI (`strategy/QuickWins.tsx`, imported by `KeywordStrategy.tsx`). **Fails 1,7,4.** Cost: the strongest evidence the product computes is withheld from the people paying for it. *Direction:* include `roiScore` in the public serialization + `ClientKeywordStrategy` type. **Impact: medium.**

**SI4 — `cannibalization_issues` (AI strategy actions: canonical/301/differentiate/noindex) reaches no intelligence slice.** `content-pipeline-slice.ts:107-126` builds warnings only from matrix lexical overlap; `listCannibalizationIssues` has no importer under `server/intelligence/`; the advisor separately sees a *third* GSC-ranking cannibalization source via insights. **Fails Cap (iii), 7.** Cost: advisor guidance on overlapping pages is incomplete and can contradict the strategy's concrete canonical/redirect prescriptions. *Direction:* have content-pipeline-slice (or seoContext) also read `listCannibalizationIssues`. **Impact: medium.**

**SI5 — Rec set + `topRecommendationId` is a frozen snapshot; scheduled audits, decay (no scheduler), and competitor alerts never re-rank it.** `routes/recommendations.ts:39-43`; regen wires `jobs.ts:238`, `keyword-strategy-follow-ons.ts:83`, POST; `scheduled-audits.ts:116-348` (no regen); `content-decay.ts` only at `routes/content-decay.ts:26`. **Fails 6 + Cap (i).** *Direction:* event-driven regen on decay/competitor/publish, or a periodic decay scan. **Impact: high.** *(Merged with Q5 — Top-5 #3.)*

**SI6 — Business fit is a degenerate within-tier boolean-token-overlap tiebreaker.** `recommendations.ts:518-540, 494-507`; `effectiveBusinessPriorities` sourced at `:916`. A higher impactScore (magic severity/traffic) always wins; alignment is lexical, not semantic. **Fails 5,3 + Cap (i).** Cost: stated goals almost never change the `#1` priority because exact tier+score ties are rare. *Direction:* fold business-fit in as a scoring multiplier/bonus, not a last-resort boolean. **Impact: medium.** **(Needs empirical: tie-frequency in the live fix_now tier.)** *(Duplicate of Q8.)*

### Configuration (CC)

**CC1 — Quick-win recs discard `roi_score`, score from the LLM bucket that then drives the ranked list + `topRecommendationId`.** `recommendations.ts:1118`; `quick-wins.ts:40-49,63,81`; `keyword-strategy-enrichment.ts:798`. **Fails 1,7 + Cap (i).** *Direction:* normalize `roi_score` to 0-100 as the impactScore, LLM bucket as no-metrics fallback. **Impact: high.** *(Top-5 #2 root cause.)*

**CC2 — `adjustKdImpactScore` (authority/winnability) applied to content-gap recs only; ranking-opp and quick-win branches never feed authority into the numeric score.** `recommendations.ts:919,1166` (applied) vs `:1118-1124`, `:1234-1235` (absent); `authority-context.ts:16-36`. **Fails 1.** Cost: see Top-5 #5. *Direction:* route ranking-opp + quick-win base scores through `adjustKdImpactScore(...domainStrength)`. **Impact: high.** *(Top-5 #5; shares cause with Q2.)*

**CC3 — `domainStrength` proxy is `organicKeywords`-count buckets (≥1000→80, ≥100→50, else 20); the available backlink-derived strength is wired only to prose.** `recommendations.ts:866-868, 1166`; `authority-context.ts:16-23` (magic gaps), `:50-55` (unused-for-score backlink strength). No real authority-score field exists on `DomainOverview`. **Fails 1,7.** Cost: two clients with very different real authority but both >1000 organic keywords get identical strength=80, collapsing winnability discrimination at the gap boundaries. *Direction:* source a real authority signal (referring-domains) or calibrate the buckets against observed outcomes. **Impact: medium.** **(Needs empirical: threshold calibration once outcome data exists.)**

**CC5 — Outcome-learning reweight is identity-multiply (×1.0) under shipped defaults.** `learnings-slice.ts:14-24` returns `availability:'disabled'` when `outcome-ai-injection` is off (default false); `outcome-learning-default-path.ts:46-48` short-circuits to `{multiplier:1}`; `outcome-tracking` (default false) also gates whether outcomes are even recorded. **Fails 7,6 + Cap (ii).** Cost: unless these flags are explicitly enabled per-client, the headline "we learn from outcomes" loop has **zero** effect on ranking — scores stay frozen at the magic-constant bases. *Direction:* confirm both live workspaces have `outcome-tracking` + `outcome-ai-injection` enabled (DB/env override), or flip the default once validated. **Impact: medium.** **(Needs empirical: live per-client flag state is not in source — `feature_flag_overrides` DB / env. Both flags carry `rolloutTarget:'tiered-client-rollout'`, so they may already be on for live clients.)**

**CC6 — keyword-strategy synthesis (deepest cross-context job) runs `gpt-5.4-mini`, a cheaper tier than the `gpt-5.4` used for lighter ops; `gpt-5.5` is wired to zero operations.** `ai-operation-registry.ts:178-195`; `keyword-strategy-ai-synthesis.ts:159-168`; CLAUDE.md documents `gpt-5.5` "for complex cross-context" — grep shows no op uses it. The mini-emitted `estimatedImpact` string then becomes the quick-win rec impactScore/priority (CC1). **Fails 3,7** (model-tier-to-job mismatch). Cost: the strategy quality ceiling for both clients is set by the cheap tier, and its low-confidence labels become the rec score. *Direction:* promote keyword-strategy to `gpt-5.4` (or `gpt-5.5` for the master-synthesis call). **Impact: medium.** **(Needs empirical: A/B strategy quality at higher tier.)**

---

## 5. Dedup notes (merged root causes)

- **roiScore-discarded-at-rec-engine** is reported four times: **Q6, MW1, IW1, CC1** — one root cause (quick-win impactScore = LLM `estimatedImpact` bucket, persisted `roi_score` ignored). Counted once for prioritization (Top-5 #2); the four citations corroborate from quality / wiring / incorrect-wiring / config angles.
- **opportunityScore/trendDirection-discarded** is reported three times: **Q3, MW2, IW2** — one root cause (content-gap impactScore = LLM `cg.priority` bucket, persisted trend-weighted composite ignored).
- **business-fit-is-tiebreaker-only** is reported twice: **Q8, SI6** — one root cause.
- **competitor/position-loss-event-blind** is reported twice: **Q4, MW3** — one root cause (timing-event → ranked-rec path absent).
- **rec-set-frozen-snapshot** is reported twice: **Q5, SI5** — one root cause (no event-driven / scheduled regen). Escalated to **high** on SI5's assessment.
- **CC2 + Q2** share the "authority/winnability not in striking-distance score" root cause (Top-5 #5).

---

## 6. Worker 6 — Client-Value Opportunities (ranked improvement map)

Every row traces to a confirmed finding above and names the rubric dimension / capability it raises. Ranked by client impact for the 2 live paying clients. **Diagnosis only — none applied.**

| # | Opportunity | Traces to | Rubric dimension / capability raised | Client impact |
|---|---|---|---|---|
| 1 | Make the technical/audit score winnability-, demand-, and effort-aware (it ranks the largest category and sets `topRecommendationId`) | Q1 | Winnability(1), Demand(2), Intent(3), Effort(4) + Cap(i) | **High** |
| 2 | Score quick wins from the persisted `roi_score` (with LLM bucket only as no-metrics fallback) | Q6 / MW1 / IW1 / CC1 | Winnability(1), Effort(4), Evidence(7) + Cap(i) | **High** |
| 3 | Add event-driven / scheduled rec regeneration so the `#1` priority is never stale (decay cron + publish/competitor triggers) | Q5 / SI5 | Timing(6) + Cap(i) | **High** |
| 4 | Route `adjustKdImpactScore` (authority vs KD) + volume into the striking-distance ranking-opportunity score | Q2 / CC2 | Winnability(1), Demand(2) | **High** |
| 5 | Surface the roiScore winnability composite to the admin advisor (seoContext slice and/or MCP) | SI1 | Cap(iii), Winnability(1), Demand(2) | **High** |
| 6 | Turn `competitor_alert` + tracked-keyword `positionChanges.declined` into ranked (defensive) recommendations | Q4 / MW3 | Timing(6) | Medium |
| 7 | Consume the trend-weighted `opportunityScore` in content-gap rec scoring | Q3 / MW2 / IW2 | Timing/seasonality(6), Demand(2), Evidence(7) | Medium |
| 8 | Ground client-facing `estimatedGain` % in real traffic-at-risk + accumulated outcomes, not static per-check constants | Q7 | Evidence(7) + Cap(ii) | Medium |
| 9 | Read `isRepeatDecay` in the decay rec to escalate / change tactic (close the loop on a failed refresh) | MW5 | Timing(6), Effort(4) + Cap(ii) | Medium |
| 10 | Weight decay impact by recoverability (position/KD/competitor-vs-market) instead of `previousClicks` magnitude | IW6 | Winnability(1), Effort(4) | Medium |
| 11 | Gate/scale freshness impact on real content-age + decay evidence, reconcile with content-decay double-counting | IW7 | Demand(2), Intent(3), Evidence(7) | Medium |
| 12 | Confirm/enable `outcome-tracking` + `outcome-ai-injection` for both live clients so the reweight loop is not inert | CC5 | Evidence(7), Timing(6) + Cap(ii) | Medium |
| 13 | Source a real authority signal (referring-domains) for `domainStrength`, or calibrate the count buckets | CC3 | Winnability(1), Evidence(7) | Medium |
| 14 | Include `roiScore` in the public quick-wins serializer + client type | SI3 | Winnability(1), Effort(4), Evidence(7) | Medium |
| 15 | Emit `strategy.contentGaps` (enriched) in `formatSeoContextSection` for the advisor | SI2 | Cap(iii), Demand(2), Evidence(7) | Medium |
| 16 | Read `listCannibalizationIssues` into an intelligence slice (reconcile both cannibalization sources for the advisor) | SI4 | Cap(iii), Evidence(7) | Medium |
| 17 | Promote keyword-strategy synthesis to `gpt-5.4` / `gpt-5.5` (deepest cross-context job currently on the cheap tier) | CC6 | Intent(3), Evidence(7) | Medium |
| 18 | Give `effectiveBusinessPriorities` graded scoring weight (or reuse the `rules.ts` business-fit deltas) instead of an equality tiebreaker | Q8 / SI6 | Business fit(5), Intent(3) + Cap(i) | Low–Medium |
| 19 | Pass `impactScore` + `topRecommendationId` into the admin advisor context | MW6 | Evidence(7) + Cap(iii) | Low |

---

## 7. Unclear / Needs Human

No findings landed in the *unclear* bucket — every confirmed finding's mechanical claim was verifiable from read-only source.

**Needs empirical validation post-outcome-loop** (the outcome loop was just built; no historical outcome data exists yet, so these cannot be quantified from source alone):

- **CC5 — live flag state.** Whether `outcome-tracking` and `outcome-ai-injection` are enabled for the 2 live workspaces lives in the `feature_flag_overrides` DB table / `FEATURE_OUTCOME_*` env vars, not in source. Both carry `rolloutTarget:'tiered-client-rollout'`, so they may already be on. The code-level identity-multiply gap is real; the client harm is conditional on flag state.
- **CC3 — `domainStrength` threshold calibration.** The `1000/100 → 80/50/20` and `±30/±15/−20` KD-gap constants have no empirical basis; calibrating them requires observed rank outcomes that don't yet exist.
- **CC6 — model-tier impact.** Whether promoting keyword-strategy off `gpt-5.4-mini` measurably improves contentGap/quick-win labeling needs an A/B once strategies regenerate.
- **MW5 / SI6 — outcome- and tie-frequency-dependent.** MW5 (`isRepeatDecay`) only fires once a page has accumulated a prior failed `content_refresh` outcome; SI6's "ties are rare" claim depends on the live distribution of `fix_now` tier scores. Both are mechanically confirmed but their *frequency of bite* needs live data.

---

## 8. Coverage & Method

- **Pipeline:** 6 mappers → 5 specialist workers (Quality, Missed-Wiring, Incorrect-Wiring, Slice-Integration, Configuration) → **35 candidates** → adversarial skeptic verification (one per candidate, default "refuted") → **28 confirmed, 0 unclear, 7 refuted**. 47 agents total. The synthesis lead independently re-verified the load-bearing anchors against tip `08d30739`: `computeImpactScore` (`recommendations.ts:577-592`), `sortRecommendations` intent-tiebreaker-only (`:518-541`, doc `:509-516`), quick-win `75/55/35` bucket discarding roiScore (`:1118-1122`), content-gap `cg.priority` bucket (`:1163-1206`), ranking-opp flat `60/40` with volume never read (`:1226-1275`), and the **zero-match grep** for `roiScore`/`opportunityScore`/`trendDirection`/`competitor_alert`/`isRepeatDecay` in `recommendations.ts`. The lead scout additionally re-confirmed Q1/Q2/Q6/CC2 against source before publishing.
- **Dedup:** 28 confirmed findings collapse to ~14 distinct root causes. Four findings describe the *roiScore-discarded* root cause; three describe the *opportunityScore-discarded* root cause; two each describe *business-fit-tiebreaker*, *competitor-event-blind*, and *frozen-snapshot*. Counts in §1 reflect distinct findings; §5 records the merges.
- **Refuted & dropped (7), summarized:** MW4 (business fit *is* a primary continuous signal — but in the keyword-recommendation path, not the rec engine; the technical-rec tiebreaker design is intentional). IW3 / CC7 (the provider-less `keyword_metrics_cache` does not actually collide cross-provider — SEMrush alpha-code vs DataForSEO numeric-code region keys are disjoint namespaces). IW4 (attributed-value CPC is explicitly labelled "~estimated value" on every surface, not presented as definitive). IW5 (business-intent tiebreaker is a deliberately bounded, documented, tested design — reachable, not "effectively dead"). SI7 (`FixRecommendations`'s totalClicks group-sort is in a component with **zero** live client mounts; the rendered surface `InsightsEngine` preserves server order). CC4 (freshness within-tier staleness-day ordering — staleness still drives the *primary* tier and is shown verbatim to clients). These were dropped because a closing wire, disjoint namespace, explicit hedge label, or non-mounted component refuted the harm.
- **What could NOT be verified from read-only source:** (1) **live feature-flag state** for the 2 paying clients (`feature_flag_overrides` DB / env — gates whether the outcome-learning reweight is active at all, CC5); (2) **live provider data** (actual KD/volume/authority values that determine how often a magic bucket diverges from the data-grounded number in practice); (3) **historical outcome data** — the rec→action→outcome→ROI loop and `attributed_value` column (migration 106) were just built, so there is no accumulated outcome history yet to validate the win-rate reweight, the repeat-decay escalation (MW5), or the `domainStrength` threshold calibration (CC3). These items are flagged in §7 as needing empirical validation once the loop has run against live workspaces.

---

*Prepared for the platform owner. Read-only diagnosis; no code changes were made. Generated by a multi-agent workflow orchestration (6 mappers → 5 graders → 35 adversarial skeptics → synthesis), independently spot-checked against source at tip `08d30739`.*
