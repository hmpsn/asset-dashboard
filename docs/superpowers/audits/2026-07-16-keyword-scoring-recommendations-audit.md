# Keyword Scoring and Recommendation Audit

**Date:** 2026-07-16
**Status:** Verified pre-plan evidence and execution-order seed
**Scope:** Keyword Value, Opportunity Value, organic and local keyword selection, recommendation production, outcome learning, data wiring, and AI model posture

## Purpose and decision boundary

This document banks the 2026-07-16 scoring audit so its evidence and dependency order can seed the next cross-platform master plan. It is not an implementation plan and does not authorize ranking changes, production model changes, or broad refactors.

The central conclusion is that the platform's scoring architecture is strong. The largest quality gains now come from repairing market identity, source semantics, measurement, provenance, and cross-system wiring before tuning weights or replacing models.

## Foundations to preserve

- Layer 1, `computeKeywordValueScore`, measures a keyword's intrinsic worth using commercial value, demand, winnability, and local relevance.
- Layer 2, `computeOpportunityValue`, measures an action's expected ROI using click lift, value per click, effort, confidence, timing, calibration, and local urgency.
- Keyword discovery already combines provider rankings, GSC, competitors, gaps, tracked/requested terms, feedback, and local candidates.
- Keyword AI is closed-set, schema-validated, retry-bounded, and deterministically recoverable.
- Local evidence preserves market, device, language, provider, match confidence, and degraded/possible/verified states.
- Recommendation producers converge on the canonical Opportunity Value scorer.
- Pure scoring coverage is strong. The 2026-07-16 focused verification passed 4 test files and 180 tests.

## Verified findings

### K1. Local refresh loses market identity

Local candidates retain `marketId`, but refresh selection returns plain keyword strings and the runner executes every market × every keyword. Market-specific terms can therefore be queried in unrelated markets, wasting credits and producing misleading evidence.

Required direction: carry market-scoped work items; fan out only genuinely market-agnostic terms.

### K2. Local recommendations are not outcome-measurable

Local recommendations generally persist neither a page nor target keyword, while completion records `targetKeyword: null`. Search actions without a page, keyword, or metric baseline are permanently unmeasurable under the current outcome engine.

Required direction: persist target keyword, market, snapshot identity, observed-at time, pack presence, business-found state, local rank, and match confidence; measure against subsequent local snapshots.

### K3. Demand sources lose their native meaning and period

GSC impressions are sometimes carried as `volume` and later labeled monthly volume. Another path derives volume from 90-day impressions and fabricates KD/CPC placeholders. Opportunity Value then calls values weekly without normalizing monthly provider demand and multi-month GSC observations.

Required direction: preserve `monthlySearchVolume`, `gscImpressions`, `observationDays`, provider KD, CPC, and provenance as separate authority fields; normalize to a common time basis before EMV.

### K4. Keyword-gap scoring uses competitor position as client position

The keyword-gap producer passes `competitorPosition` into the client's `currentPosition` slot. This understates gaps where the competitor ranks and the client does not.

Required direction: retain competitor position as evidence; use the client's actual position or `null` for Opportunity Value.

### K5. Generic organic intent defaults too aggressively

The shared fallback classifier is local-service-oriented and defaults unmatched queries to transactional. That is acceptable after local qualification, but it inflates unknown generic organic terms.

Required direction: introduce an organic `unknown`/neutral fallback while retaining transactional-by-default only in prequalified local paths.

### K6. Local classification has two vocabularies

Layer 1 uses a small fixed industry regex while the local candidate engine uses workspace-derived service terms. A term can qualify for local tracking but miss the local value multiplier.

Required direction: persist or pass one canonical local-intent decision instead of reclassifying downstream.

### K7. Content-gap Opportunity Value is calculated twice

Content-gap enrichment converts Layer 1 through Opportunity Value, stores the result in `opportunityScore`, and the recommendation producer later feeds that value through Opportunity Value again.

Required direction: persist distinct `keywordValueScore` and action-level `opportunityValue`; calculate the latter once from raw canonical inputs.

### K8. Business priorities do not affect scoring

Opportunity Value supports `businessFitAlignment`, but production recommendation producers do not supply it. Resolved client priorities act mainly as a tie-break.

Required direction: derive deterministic topic/page/keyword alignment and pass it into relevant producers.

### K9. Local evidence can appear fresher than it is

Cached local SERPs can be returned with a new capture timestamp. This can make old provider evidence look newly observed and reset trend freshness.

Required direction: separate requested time, provider-observed time, and cache provenance; freshness-gate client-facing conclusions.

### K10. Some local proxy scores are mislabeled as grounded

Local service gaps commonly use a fixed `opportunityScore = 60`, which the Opportunity Value provenance logic treats as a high-confidence grounded composite.

Required direction: give proxy inputs explicit provenance/confidence or replace them with measured local demand and visibility data.

### K11. Outcome difficulty learning is disabled by a unit mismatch

The producer bins GSC position while the consumer expects provider KD. The consumer correctly disables the multiplier, but keyword difficulty is therefore not part of realized learning.

Required direction: snapshot actual KD on tracked actions, rebuild the bins on KD, and carry difficulty through recommendation finalization.

### K12. Closed-set truncation happens before requested/voted preservation

The synthesis candidate set sorts and truncates by raw volume before requested, voted, priority, source, intent, or market diversity can reserve capacity.

Required direction: reserve mandatory requested/voted candidates and diversity quotas, then fill remaining capacity by value.

## High-value connections still available

1. Conversion-grounded value per click using GA4 conversion/revenue evidence with CPC as an explicit-confidence fallback.
2. Local snapshot-based outcome calibration by market, service, and keyword.
3. Internal-link weighting using keyword value, page optimization score, and current rank.
4. Verified service-offering authority before minting local service-gap recommendations.
5. Keyword/domain timing events and preserved seasonality series.
6. A workspace-level intent-mix rollup using existing classified keywords.
7. Recommendation integrity and ordered mutation → intelligence → recommendation convergence.

## AI model posture

The named registry currently uses `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.5`, and `claude-sonnet-4-6`, with `gpt-image-2` used for images. Model IDs also remain in hard-coded call sites and duplicate pricing tables.

The 2026-07-16 provider check found GPT-5.6 Sol/Terra/Luna and Claude Sonnet 5/Fable 5 available. Migration should be operation-specific and evaluation-led, not a global string replacement. Required migration groundwork:

- one typed model/capability/pricing catalog;
- provider-aware model resolution;
- explicit reasoning-effort policy and an evaluated Responses API path for OpenAI;
- removal of incompatible temperature parameters before Sonnet 5;
- keyword-specific quality, cost, and latency evals;
- per-operation canaries and rollback evidence.

## Banked execution order

1. Repair local market-scoped refresh work items.
2. Correct competitor-position and intent-classification semantics.
3. Preserve signal names and normalize observation periods.
4. Make local actions measurable.
5. Remove double Opportunity Value scoring and false-grounded proxies.
6. Wire business priorities and verified offerings.
7. Complete recommendation integrity and ordered convergence.
8. Add conversion-grounded value, internal-link value, seasonality, and intent-mix rollups.
9. Build model evals, then canary GPT-5.6 and Sonnet 5 by operation.

## Master-plan guidance

When this becomes a master plan, preserve the dependency order above and split it into phase-per-PR delivery. Integrity and measurement repairs precede output/ranking changes; model experiments follow deterministic quality fixtures and runtime cost/latency baselines. Existing roadmap owners should be reused rather than duplicated, especially `genq-recommendation-integrity`, `genq-keyword-synthesis-quality`, `genq-ordered-recommendation-convergence`, `genq-runtime-quality-governance`, `genq-provider-performance`, `kwv-conversion-grounded-vpc`, `kwv-intent-branded-split`, and `kwv-internal-linking-value-priority`.
