# Pre-Plan Audit — SEO Decision Engine P7: GBP + Reviews Local Layer

**Date:** 2026-06-24
**Seed:** roadmap `seo-engine-p7-gbp-reviews-local-layer` — "business_listings_search + capture ratings → review-gap recs. Group C (paid). Flag `local-gbp`. Depends on P4+P5. Turns local from local-pack-presence-only into a real local product."
**Method:** 5 parallel Explore scans (existing local surface · provider/paid infra · rec+insight plumbing · scaffolding registries · data model) + 2 LIVE DataForSEO calls validated into a ground-truth fixture (`tests/fixtures/dataforseo-business-listings.ts`).
**Status:** No spec yet — this audit grounds the brainstorm that follows. It is exhaustive on EXISTING surface (verified file:line) and de-risks the paid API shape; it does NOT pre-decide the product (that's the brainstorm).

---

## 0. The one finding that reframes the phase: FREE half + PAID half

The roadmap line conflates two data paths the live probes proved are distinct:

| | FREE half | PAID half |
|---|---|---|
| **Source** | `local_pack` items in `serp/google/organic/live/advanced` — **already fetched today** by `getLocalVisibility` | `business_data/business_listings_search` — net-new paid endpoint |
| **Carries** | per-pack-business `rating: { value, votes_count, rating_max }` (star + review count) + domain/cid/phone | full category landscape sorted by review count: `rating{value,votes_count}`, `rating_distribution`, `place_id/cid/domain`, GBP `attributes` (completeness), `total_photos`, claimed status, `people_also_search` competitors |
| **Cost** | $0 new (extraction only — the parser drops these fields today) | ~$0.002–0.01/call, one per category+market |
| **Reach** | only the 3 businesses IN the local pack (incl. the client if they rank) | top-N in the category regardless of pack rank; the client's own GBP profile health |
| **Precedent** | P3 (free AI-Overview extraction from data on hand) | P6 (paid national SERP) |

**Validated shapes** (fixture): `LOCAL_PACK_WITH_RATINGS` (`folsomstreetdental.com` → `votes_count: 987, value: 4.9`) and `BUSINESS_LISTINGS_SEARCH` (per-listing `rating`, `rating_distribution`, `place_id`, `attributes`, `people_also_search`). **Critical gotcha:** a zero-review business returns `rating: { rating_type: 'Max5' }` with `value`/`votes_count` ABSENT (not 0) — and some claimed listings omit the `rating` block entirely. The parser must treat missing as "no reviews yet" (undefined), never coerce to 0.

This split IS the central brainstorm decision (§7, Q1).

---

## 1. Existing local surface (what P7 extends — verified)

**Engine** — `server/local-seo.ts`: `runLocalSeoRefreshJob` (`:2775-3030`) — the exact job template (global+per-ws `hasActiveJob` serialization, `waitForMemoryHeadroom` `:171-181`, per-item progress, broadcast/20, pre/post cancel, retention prune, optional rec/strategy regen chain). `getLocalVisibility` (`dataforseo-provider.ts:1299-1385`) calls `serp/google/organic/live/advanced` and `extractLocalPackItems` → `LocalVisibilityBusinessResult` (`shared/types/local-seo.ts:232-240`) **which has NO rating/reviewCount field** (the free-half drop point). Business-match scrubbing (`isOwnedLocalResult` `:1773-1795` via domain/place_id/phone/street; `evaluateLocalBusinessMatch` `:1819-1895`).

**Data model** — migration 096 (`local_seo_markets`, `local_visibility_snapshots` — competitor list in `top_competitors` JSON), 099 (`client_locations` incl. **`gbp_place_id` already stored but never read for any GBP API**), 101 (market `is_primary`). Latest migration = **153** (P6) → P7 starts at **154**. Competitor snapshots/alerts exist for ORGANIC (`competitor_snapshots` mig 070) but reviews/ratings tables = **none** (confirmed: zero `review`/`rating` tables).

**Insight bridge** — `server/bridge-local-visibility-shift.ts:133-237` (`runLocalVisibilityShiftBridge`): pure prev-vs-new diff → `upsertInsight` with deterministic pageId + `bridgeSource`, suppress opposites, returns `{ modified }`, NO broadcast/resolve. The template for a review bridge.

**Intelligence slice** — `server/intelligence/local-seo-slice.ts:31-181` (`assembleLocalSeo` → `LocalSeoSlice`): locations/markets/candidates/visibility/serviceGaps/competitorBrands + `effectiveLocalSeoBlock`. P7 review data would extend this slice (the rule: new data → a slice).

**Client surface** — `src/components/local-seo/` (`LocalSeoVisibilityPanel.tsx`, `LocalSeoVisibilityTrend.tsx`, `LocalSeoMarketSetupDrawer.tsx`). Docs: `docs/rules/local-seo-visibility.md` explicitly lists "GBP health, Google reviews/reputation" as **deferred follow-up** — P7 is that item.

## 2. Provider / paid infra — ~85% reuse (verified)

`runDataForSeoOperation<T>` (`dataforseo-provider.ts:572-625`) is the hub a new `getBusinessListings`/`getGbpReviews` method reuses verbatim: per-workspace file cache (`getCachePath` workspace-isolated), `logCreditUsage` (auto), credit-exhausted breaker (402 → 5-min pause), capability breaker (40204 → 6h, `markCapabilityDisabled`), `getTaskResult`/`getTaskCost`. P4 geo (`workspaceProviderGeo` `seo-target-geo.ts:26-31`) threads location_code/language_code. P5 budget (`assertCreditBudget`, observe-only) is the same contract P6 wired. **Net-new:** the provider method(s) + cache-TTL constants + extending `LocalVisibilityBusinessResult` with `rating?/reviewCount?` (free half).

## 3. Review-gap modeling: Recommendation vs Insight vs both (decision input)

The rec engine (`server/recommendations.ts`) already has a `local_visibility` RecType + a competitor-brand→rec block (`:2153-2200`, B2) and `RecSource.localVisibility(...)`. The insight path has the full 7-part lockstep (P6 `serp_feature_opportunity` + `local_visibility_shift` as templates: `analytics.ts` union/interface/map, `insight-schemas.ts` Zod, `useInsightFeed.ts` admin, `InsightsDigest.tsx` icon+action, `insight-enrichment.ts` classifyDomain, `analytics-intelligence.ts` compute+stale-cleanup, `signal-story-registry.ts` narrative). `ActionType` (`outcome-tracking.ts`) would likely need a `review_*` value for outcome tracking. **Decision (§7, Q3):** Recommendation gives actionability + curation + send + outcome-tracking + "The Issue" loop; Insight gives narrative + bridge drift-tracking. P7.1's local recs are Recommendation-only; P6 was insight+rec. Recommended default: **Recommendation primary** (it's an actionable "go get reviews" ask), optionally an insight for the drawer/digest narrative.

## 4. Scaffolding checklist (the anti-silent-CI map — same registries P6 touched)

Flag `local-gbp` → `FEATURE_FLAGS` + `FEATURE_FLAG_CATALOG` (lifecycle) + `FEATURE_FLAG_GROUPS['SEO Decision Engine']` (`feature-flags.ts`), lifecycle-anchor test. If a job: `BACKGROUND_JOB_TYPES` + `BACKGROUND_JOB_METADATA` + `tests/helpers/background-job-test-matrix.ts` + a signal integration test. If a WS event: `server/ws-events.ts` + `src/lib/wsEvents.ts` mirror + centralized `src/lib/wsInvalidation.ts` (admin switch) + `src/hooks/useWsInvalidation.ts` + `scripts/platform-domain-event-definitions.ts` (`CONTEXT_BY_EVENT_KEY`). If an insight type: the 7-part lockstep + `insight-renderer-coverage` contract (auto-exhaustive). Tier: `computeEffectiveTier` (server, trial-promotes-free→growth) + `<TierGate>` (UI). Budget: `assertCreditBudget` observe-only. **These are exactly the registries that produced P6's two contract-test catches — pre-commit them.**

## 5. Data model — what P7 needs (observation only)

Reuse: `business_profile` (workspace NAP), `local_seo_markets`, `local_visibility_snapshots` (+ extend the in-JSON `LocalVisibilityBusinessResult` with rating for the free half), `client_locations.gbp_place_id` (finally read it). Net-new tables (mig 154+), time-series to match `serp_snapshots`/`local_visibility_snapshots`/retention pattern: a **`business_listing_snapshots`** (per place_id: rating value, votes_count, rating_distribution JSON, attributes/completeness, claimed, is_owned tri-state, fetched_at) keyed `(workspace_id, place_id, snapshot_date)`. Whether competitor reviews need a separate table vs. rows in the same table with an `is_owned` flag is a §7 decision. Canonical store template: `server/serp-snapshots-store.ts` (P6) / `server/competitor-snapshot-store.ts` (rowToX + parseJsonFallback). Public exposure via the `LocalSeoSlice` (aggregates only — **never individual reviews/authors**, PII rule).

## 6. Infrastructure recommendations (prevention)

1. **Shared rating parser** — one `parseListingRating(rating)` helper (handles `{rating_type}`-only / absent → undefined, never 0) reused by BOTH the free local-pack extraction and the paid listings parser. Build it test-first against the fixture (the P6 pattern that yielded a zero-bug parser).
2. **Fixture-grounded parser tests** before any provider code (`dataforseo-business-listings.ts` is already captured).
3. **pr-check**: none net-new needed; existing rules (workspace-scoped SQL, parseJsonSafe, transaction, flag grouping, insight lockstep, job matrix, ws-invalidation) cover P7 — the lesson is to RUN the contract project locally (P6's gap).
4. **Reuse `runLocalSeoRefreshJob` shape** rather than a parallel job if the GBP/review fetch piggybacks the local refresh cadence (a §7 decision: extend vs separate job).

## 7. OWNER DECISIONS (the brainstorm agenda — highest leverage first)

1. **Scope: free / paid / both?** (a) FREE only — extract ratings + review counts from local-pack we already fetch → review-gap vs the 3 pack winners (cheap, ships fast, in-pack only); (b) PAID `business_listings_search` — full category review landscape + the client's GBP profile completeness (richer, costs credits, new method+table); (c) BOTH — free baseline trend + paid deep competitive/GBP-health. *Recommend (b)/(c): the sellable "real local product" the roadmap wants is the GBP-health + full-competitor-review-gap, not just the pack-3; but the free half is nearly-zero-cost and worth folding in.*
2. **The deliverable's shape** — "review-gap" = star-rating gap, review-COUNT gap, or both? Plus GBP-completeness gaps (missing hours/photos/attributes)? Per-location (multi-location) or workspace-level?
3. **Recommendation vs Insight vs both** (§3) — does this generate an actionable curated Recommendation ("launch a review campaign"), a narrative Insight, or both?
4. **Cadence + job** — extend `runLocalSeoRefreshJob` (one local refresh does pack + GBP + reviews) or a separate `local-gbp-refresh` job? Weekly?
5. **Tier + budget** — Growth+ (mirror P6), observe-only budget? Free tier excluded?
6. **Competitor set** — derive from local-pack winners (free), `people_also_search` (paid), the existing `competitorBrands`, or admin-specified? How many?

---

## 8. Parallelization strategy (for the eventual plan — after brainstorm)

**Wave 0 (contracts, single commit):** flag `local-gbp` + catalog/group; migration 154 table(s); `LocalVisibilityBusinessResult` rating extension + any new shared types; (if insight) the 7-part type lockstep; (if job) job-type + metadata + matrix entry; (if WS event) event + mirror + invalidation. **Wave 1 (parallel):** provider method(s) + the shared `parseListingRating` (fixture-grounded, test-first) ‖ store ‖ (free) local-pack rating extraction in `extractLocalPackItems`. **Wave 2:** job/route (extend or new) + budget/tier gating ‖ rec/insight compute. **Wave 3:** client surface (review-gap panel + rec/insight rendering, TierGate, no purple) + WS handler. **Wave 4:** tests (parser, store, route gating, client narrative) + full gate INCLUDING the contract project.

## 9. Model assignments

| Task | Model | Why |
|---|---|---|
| Provider parser + shared rating helper | Sonnet | fixture-grounded logic, the highest-risk unit |
| Store + mappers | Sonnet | pattern-following with tri-state/JSON care |
| Job/route gating | Sonnet | reuse `runLocalSeoRefreshJob`, budget/tier wiring |
| Rec/insight compute + lockstep | Sonnet | cross-file lockstep |
| Client panel + rendering | Sonnet | Four Laws + TierGate |
| Mechanical registry edits (flag/job/event lockstep) | Haiku | pattern-matching |
| Contracts (Wave 0) + review + orchestration | Opus | full-context judgment |

---

**Single biggest pre-implementation risk:** ALREADY mitigated — both DataForSEO shapes are validated into a fixture, and the zero-review `rating` gotcha is captured. The remaining risk is product scope (§7), which the brainstorm resolves.
