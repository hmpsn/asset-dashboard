# SEO Generation Quality — Cross-Phase Contracts

> Guardrail reference for the multi-phase SEO strategy + keyword-generation quality
> feature. Written **before** the first contract change (CLAUDE.md Session-Protocol #7).
> Plan: `docs/plans/2026-06-02-seo-generation-quality-plan.md`. Umbrella flag:
> `seo-generation-quality`. Per-phase sub-features stay individually flag-gated and
> roll out per-workspace via the P0 per-workspace flag dimension
> (`isFeatureEnabled(flag, workspaceId)`).

This feature changes four output contracts across phases P1–P6. The recurring failure
mode (the "inbox lesson") is that **the producer of a shape is easy to find but the full
set of readers is not — and the readers do not error, they quietly under-serve or
diverge.** Every PR that changes one of these contracts MUST enumerate and verify the
full reader list below (the Consumer Contract Check, plan §5.1) and add a **public**
read-path test (not the admin route).

P0 changes **none** of these contracts — it is pure additive infrastructure (telemetry +
per-workspace flag + these guardrails). The lists below are the forward map the later
phases must honor.

---

## Contract 1 — the recommendation `opportunity` shape (admin-money fields)

**Producer:** `computeOpportunityValue()` (`server/scoring/opportunity-value.ts`) →
`OpportunityScore` attached to each `Recommendation.opportunity`
(`shared/types/recommendations.ts`).

**Future change (P4):** add `predictedEmv` (TypeScript camelCase; the SQL column, when
persisted on the outcome row, is `predicted_emv`). It is a **CPC-proxy placeholder**, not
real money, until P6 threads GA4 `estimatedRevenue` — its JSDoc must say so. It is
**admin/AI-only**: clients never see a raw `$/wk` figure.

**Full reader list (every reader of `opportunity` / `OpportunityScore`):**
- `server/scoring/opportunity-value.ts` — producer; `predictedEmv` is computed *inside*
  `computeOpportunityValue` (it already multiplies by the module-private `HORIZON_WEEKS`),
  so the rec layer never reaches the private const.
- `server/schemas/workspace-schemas.ts` — `opportunityScoreSchema` is a closed `z.object`
  with **no `.passthrough()`**; any new field is **stripped on every reload** unless added
  here (CLAUDE.md "Schema vs stored shape"). Recs are a JSON blob
  (`recommendation_sets.recommendations` TEXT) — the lockstep is the **Zod schema**, not a
  DB column.
- `server/routes/recommendations.ts` → **`stripEmvFromPublicRecs`** — destructure-and-spread
  strip. A new admin-money field **LEAKS to clients** unless added to the destructure
  (and mirrored at the PATCH response). **This is enforced by pr-check rule
  `opportunity-money-field-must-be-stripped`.**
- `server/outcome-tracking.ts` — to **survive regen**, P4 snapshots `predictedEmv` onto the
  action/outcome row at `recordAction` time (new DB column → full migration + row interface
  + `rowToX` mapper + `RecordActionParams` field, threaded at both write sites in
  `routes/recommendations.ts` and `outcome-backfill.ts`, SELECTed in `getCalibrationOutcomes`).
  The regenerable rec row is NOT a safe home: P5 regenerates after every scheduled audit and
  `buildMergeKey` does not preserve the old `opportunity`.
- Client renderers (must never receive raw `$/wk`): `src/components/client/FixRecommendations.tsx`,
  `src/components/client/Briefing/RecommendedForYou.tsx`,
  `src/components/client/strategy/StrategyContentOpportunitiesSection.tsx`.

## Contract 2 — the priority-tier source

**Producer today:** a legacy heuristic feeds `sortRecommendations`
(`server/recommendations.ts`), which sorts by `priorityOrder[priority]` first, then
`impactScore`. So OV only re-orders *within* a tier.

**Future change (P4):** derive the priority tier from **OV bands** (keeping `fix_now`
reserved for genuine `CRITICAL_CHECKS`).

**Full reader list:**
- `server/recommendations.ts` — `sortRecommendations`, the `RecPriority` assignment in every
  rec-minting branch, and `computeRecommendationSummary` (`fixNow/fixSoon/fixLater/ongoing`
  counts + `topRecommendationId`). Keep numerator/denominator on one source (CLAUDE.md rate rule).
- `server/ov-divergence.ts` — `recordOvDivergence`'s `ovClone` today overrides only
  `impactScore`, keeping the legacy tier, so the canary is **blind to cross-tier reorder**.
  P4 must make `ovClone` apply the OV-derived tier too (G1).
- `src/components/admin/OvDivergencePanel.tsx` — must surface tier-level divergence.
- `server/meeting-brief-generator.ts` — the brief cache hash keys on top-10 insights +
  first-5 site keywords, **no rec/tier signal** → serves a stale "#1" after re-tiering (G8).
  P4 must add a rec/tier/gap signal to the cache hash.
- Client #1 card + `topRecommendationId` consumers (Health tab ordering).

## Contract 3 — the `estimatedGain` string

**Producer today:** `getRecoveryRate` legacy percent strings
(`server/recommendations.ts`) — static per-check constants, identical for every
workspace/page, while ranking already reads OV. A live client-facing incoherence (G5/G9).

**Future change (P4):** replace with the OV EMV figure when OV is on, **co-designed with
the client renderer** (CLAUDE.md AI↔frontend contract). Recompute
`content_gaps.opportunity_score` from OV EMV so recs, brief candidates, and the upsell
badge share one basis. The `estimatedGain` string is **not stripped today** — P4 must add
it to the public strip (no dollarized string may reach a client).

**Full reader list:**
- `server/recommendations.ts` — `estimatedGain` assignment + `computeRecommendationSummary`.
- `server/briefing-candidates.ts` — brief-candidate ranking; `server/content-gaps.ts`
  ordering (`opportunity_score`).
- Gain renderers: `src/components/client/FixRecommendations.tsx` (switch its hand-duplicated
  `ServerRecommendation` to the shared `Recommendation` type),
  `src/components/client/InsightsEngine.tsx`, `src/components/client/strategy/*`,
  `src/components/client/Briefing/RecommendedForYou.tsx` (kill its independent
  `volume × 0.103` clicks estimate + the legacy `/100` badge).
- `server/routes/recommendations.ts` → `stripEmvFromPublicRecs` (must add `estimatedGain`).

## Contract 4 — the keyword-universe sources

**Producer today:** two divergent pool builders — provider-fetch in
`server/keyword-strategy-seo-data.ts` and a synthesis-side builder in
`server/keyword-strategy-ai-synthesis.ts` (which also draws GSC / client-tracked /
client-requested candidates). The MCP path (`server/mcp/tools/job-actions.ts`) passes
`seoDataProvider` only — no real universe.

**Future change (P1):** introduce `buildKeywordUniverse(workspaceId, opts)` as the **one**
source of the candidate pool, with typed `KeywordUniverse` / `KeywordCandidate` interfaces
in `shared/types/` (consumed by MCP + UI + synthesis; P3 attaches per-candidate
`declined`/`requested`/`voteWeight`/`priority` annotations). Thread geo + `language_code`
everywhere (closes the whole-pool-US bug). Fold the synthesis-side builder in — do not
leave two builders.

**Full reader list / seams:**
- `server/keyword-strategy-generation.ts` — the orchestrator (where the pool + final
  content gaps are known; P0 telemetry is emitted here).
- `server/keyword-strategy-ai-synthesis.ts` — fold its pool builder in (do not drop the
  GSC/client candidates).
- `server/keyword-strategy-seo-data.ts` — provider fetch; gating moves from on/off to a
  credit-depth cap.
- `server/mcp/tools/job-actions.ts` — seed the MCP/chat path.
- `server/providers/dataforseo-provider.ts` — thread `database`/`locationCode`/`language_code`
  (DataForSEO defaults `2840`/US/`'en'` when omitted).
- `src/components/KeywordStrategy.tsx` — the `quick`/`full` toggle becomes a credit-depth cap.

---

## New rec types / sources (P5 — orphaned-subsystem wiring)

When P5 surfaces `keyword_gaps` / `topic_clusters` / `cannibalization_issues` as
first-class recs, a new `RecType`/`RecSource` value must NOT fall through the
non-exhaustive maps (G2 — silent mislabel + distorted calibration + false auto-resolve):
- `REC_SOURCE_CATEGORIES` + `getRecSourceCategory` (`server/recommendations.ts`) — a source
  with no category bypasses the auto-resolve safety check.
- `recommendationOutcomeActionType` (`server/recommendations.ts`) — a real `ActionType` case
  (define new `ActionType`s in `shared/types/outcome-tracking.ts`), **not** the
  `audit_fix_applied` fallback, which feeds `winRateByActionType` and distorts calibration.
- Frontend label maps: `src/components/admin/outcomes/outcomeConstants.ts`,
  `src/components/client/OutcomeSummary.tsx`, `src/components/client/Briefing/WinsSurface.tsx`.
- `FixRecommendations.tsx` `typeConfig` (+ `REC_TYPE_TAB`/`TYPE_ICONS` for new `RecType`s).
- A named intelligence slice (`shared/types/intelligence.ts` field + `assemble*()` read +
  `buildWorkspaceIntelligence()` routing) so AdminChat is not blind (Data-Flow #6).

**This is enforced by pr-check rule `new-rec-type-source-needs-category-and-action-type`.**
Both pr-check rules are **forward-looking** — they do not false-positive on current code
(`predictedEmv` and the new RecTypes/RecSources do not exist yet); they fire the moment a
later phase introduces the field/value without the lockstep.
