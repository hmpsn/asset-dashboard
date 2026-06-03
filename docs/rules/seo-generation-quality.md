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

## Contract 5 — the `content_gaps.backfilled` honesty flag (P2)

**Producer (P2):** the deterministic backfill floor in `server/keyword-strategy-generation.ts`
(`backfillContentGapsToFloor`, `STRATEGY_CONTENT_GAP_FLOOR = 6`) tags re-admitted pruned gaps
`backfilled = true`. Gated behind `isFeatureEnabled('seo-generation-quality', ws.id)` (threaded
once as `relaxConservatism`). The column is additive (default `0`) and NOT itself gated — only
the WRITE of `1` is. It distinguishes deterministic backfill from organically-strong gaps so the
client renderer can sort/label honestly and the email count is not padded.

**Full reader chain (DB column + mapper lockstep — all must move in lockstep; the column is a
real `content_gaps` table since #365, NOT a JSON blob):**
- `server/db/migrations/115-content-gap-backfilled.sql` — `ALTER TABLE … ADD COLUMN backfilled`.
- `server/content-gaps.ts` — `ContentGapRow.backfilled`, `rowToModel()` + `modelToParams()`,
  and the `INSERT … ON CONFLICT` column list (a mapper or INSERT that ignores it silently drops
  the flag — TypeScript will not catch it).
- `server/routes/public-content.ts` — the **explicit public field whitelist** on
  `GET /api/public/seo-strategy/:id` (an unlisted field is silently dropped on the client read
  path; this is the spot a §5.1 public-read test must cover).
- `src/components/client/types.ts` — the client `ContentGap` type.
- `src/components/client/strategy/StrategyContentOpportunitiesSection.tsx` — the sort (backfilled
  gaps after organically-strong ones) + the subtle "Expanded pick" affordance (zinc, never purple).
- `server/routes/jobs.ts` — the `recommendations_ready` email count subtracts backfilled gaps so
  the headline is honest (a backfilled gap produces one content rec).
- `shared/types/generation-quality.ts` — `backfilledCount` + `floorHit` telemetry, populated from
  the real run (0/false on flag-OFF).

`contentGaps` are deleted from the legacy `keywordStrategy` JSON blob in persistence (normalized
to the table at #365), so `keywordStrategySchema` needs **no** `.optional()` change for `backfilled`.

## Contract 6 — the closed-set membership guarantee + client-signal hard guarantees (P3)

All of Contract 6 is **flag-ON only** (`isFeatureEnabled('seo-generation-quality', ws.id)`). The
flag-OFF legacy path (`callKeywordStrategyAI` + `parseJsonFallback` batch/master prompts and the
master throw) is byte-identical to pre-P3 and must stay so.

**Closed-set membership (I1) — the actual guarantee P3's grounded prompting promises.** The OP1
(`keyword-page-assignment`) and OP2 (`keyword-site-synthesis`) prompts instruct the AI to SELECT a
`*SourceId` from the enumerated closed candidate set, but the model can hallucinate an id/keyword
that is not in the set. Trusting it is unsafe because flag-ON `relaxConservatism` disables the
`business_mismatch` hard-suppressor, so a plausible-but-invented phrase would otherwise survive the
downstream eligibility filter — and the `sourceId || keyword` preference could let a hallucinated id
override a correct in-set keyword. The fix, in `server/keyword-strategy-ai-synthesis.ts`:
- Build `candidateIds = new Set(universeCandidates.map(c => normalizeKeyword(c.keyword)))` ONCE
  (the candidate id == the normalized keyword == the pool Map key).
- `resolveClosedSetKeyword(sourceId, keyword)`: accept the AI's `sourceId` only if its normalized
  form is in `candidateIds`; else fall back to `keyword` only if THAT is in the set; else return
  `null`.
- **OP1:** when `resolveClosedSetKeyword` returns `null`, pass the raw keyword through to
  `postProcessBatch`, whose existing eligibility + per-page-fallback path rejects the hallucination
  (never admits it, never lets a hallucinated id override a valid in-set keyword).
- **OP2:** when it returns `null`, DROP the content gap. The synthesis-internal never-emit-empty
  backfill re-fills `contentGaps` from the universe candidates, so dropping never silently empties
  the strategy.

**Requested "MUST appear" survives enrichment (M2).** The requested-re-add hard guarantee (Contract
4 / G4: a client-requested candidate not covered by the page map AND absent from the content gaps is
injected as a `priority: high` content gap) was silently undone later by
`enrichKeywordStrategy._removePageCoveredContentGaps` (`server/keyword-strategy-enrichment.ts`),
which fuzzy-token-subset-prunes gaps whose topic looks "covered" by a page title/slug/keyword. The
fix: re-added requested gaps carry a **transient `requested: true` marker** on `StrategyContentGap`,
and `_removePageCoveredContentGaps` SKIPS marked gaps. The marker is **never persisted** — the
`content_gaps` write path (`server/content-gaps.ts:modelToParams` + the explicit `INSERT` column
list) omits it, and `contentGaps` are stripped from the `keywordStrategy` JSON blob in persistence —
so it only survives in-memory through enrichment's prune step. Because the marker is only ever set on
the flag-ON synthesis path, flag-OFF gaps never carry it and the prune branch is inert there
(flag-OFF prune byte-identical).

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
  This function is an **exhaustive `switch` over `RecType` with a `never` default**, so adding
  a `RecType` to the union is a **compile error** until it gets an explicit outcome case.
- Frontend label maps: `src/components/admin/outcomes/outcomeConstants.ts`,
  `src/components/client/OutcomeSummary.tsx`, `src/components/client/Briefing/WinsSurface.tsx`.
- `FixRecommendations.tsx` `typeConfig` (+ `REC_TYPE_TAB`/`TYPE_ICONS` for new `RecType`s).
- A named intelligence slice (`shared/types/intelligence.ts` field + `assemble*()` read +
  `buildWorkspaceIntelligence()` routing) so AdminChat is not blind (Data-Flow #6).

**Enforcement is split by mechanism:** the **source-category lockstep** (RecSourceCategory
union ↔ `REC_SOURCE_CATEGORIES` array) is enforced by the pr-check rule
`new-rec-type-source-needs-category-and-action-type`; the **RecType→ActionType** half is
enforced at compile time by the exhaustive `never` `switch` in `recommendationOutcomeActionType`
(stronger than a regex). The remaining readers above (frontend label maps, `typeConfig`,
the intelligence slice) are caught by the §5.1 Consumer Contract Check grep in the P5 PR.
Both pr-check rules are **forward-looking** — they do not false-positive on current code
(`predictedEmv` and the new RecTypes/RecSources do not exist yet); they fire the moment a
later phase introduces the field/value without the lockstep.
