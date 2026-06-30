# SEO Decision Engine P7 — GBP + Reviews Local Layer (Design Spec)

**Date:** 2026-06-24
**Roadmap item:** `seo-engine-p7-gbp-reviews-local-layer`
**Pre-plan audit:** `docs/superpowers/audits/2026-06-24-seo-engine-p7-gbp-reviews-audit.md`
**Fixture (validated API shapes):** `tests/fixtures/dataforseo-business-listings.ts`
**Depends on:** P4 (geo threading), P5 (credit-budget-gate), existing local-SEO layer (migrations 096/099/101).

**Goal:** Turn local from local-pack-presence-only into a real local product by capturing Google Business Profile health + review counts/ratings (the client's own + competitors') and surfacing **review-gap** and **GBP-completeness** findings as actionable, curated recommendations. Growth+, paid, behind the `local-gbp` flag.

**Flag boundary (precise):** the `local-gbp` flag gates the **PAID** half — the `business_listings_search` fetch, the `local-gbp-refresh` job/route, the `business_listing_snapshots` data, the GBP/reviews admin panel, and the review-gap/GBP-completeness recs; with it OFF those are byte-identical to today. The **FREE** half (populating `rating`/`reviewCount` on the local-pack results already fetched) ships **unflagged**, following the P3 precedent (P3's free AI-Overview extraction shipped without a flag) — it is an additive, zero-cost enrichment of data already on hand.

---

## Locked decisions (from brainstorm, 2026-06-24)

1. **Scope = BOTH paths.** FREE: extract `rating.value` + `rating.votes_count` from the `local_pack` items the existing local refresh already fetches (parser drops them today) — $0 added cost. PAID: `business_data/business_listings_search` for the full category review landscape + the client's own GBP profile health.
2. **Deliverable = Recommendation** (no new insight type). Reuse the existing `local_visibility` RecType + the curate→send→greenlight→outcome spine. Two rec flavors: **review gap** and **GBP completeness**.
3. **Job = SEPARATE** `local-gbp-refresh` (the paid half), gated by `local-gbp` + Growth+. The free half rides the EXISTING `runLocalSeoRefreshJob` (no cost/behavior change there). Manual trigger for P7 (weekly cadence is a later follow-up).
4. **Tier = Growth + Premium** (Free excluded). **Budget = observe-only** `assertCreditBudget` (consistent with P5/P6).
5. **Competitor set = top ~10** businesses in the client's category + market sorted by `rating.votes_count desc` (paid), plus the local-pack winners (free). Client's own listing matched by `place_id` (`client_locations.gbp_place_id`) → `domain` fallback.
6. **Gap = review-count + star-rating + GBP-completeness**, computed **per-location** for multi-location workspaces (keyed to `client_locations`), workspace-level when a single confirmed location.
7. **Outcome ActionType = reuse `local_visibility_won`** (YAGNI; no new `review_gap_closed` value).

---

## Architecture

### A. Flag + gating (Wave 0)
- `local-gbp` in `FEATURE_FLAGS` + `FEATURE_FLAG_CATALOG` (lifecycle: owner `analytics-intelligence`, `createdAt`/`lastReviewedAt` = commit day, `rolloutTarget: staging-validation`, `linkedRoadmapItemId: seo-engine-p7-gbp-reviews-local-layer`, `staleAuditCadence: weekly`) + `FEATURE_FLAG_GROUPS['SEO Decision Engine']`. Lifecycle-anchor test entry.
- Route + UI gated Growth+ via `computeEffectiveTier` (server) and `<TierGate>` (UI). OFF = no fetch, no new UI, no rec.

### B. Free half — local-pack rating extraction (rides existing local refresh)
- Extend `LocalVisibilityBusinessResult` (`shared/types/local-seo.ts`) additively: `rating?: number` (star value), `reviewCount?: number`.
- New shared helper `parseListingRating(rating: unknown): { rating?: number; reviewCount?: number }` — the single source of rating parsing for BOTH halves. Gotcha (fixture-validated): a zero-review business returns `rating: { rating_type: 'Max5' }` with `value`/`votes_count` ABSENT, or omits `rating` entirely → return `undefined` for both, NEVER 0.
- `extractLocalPackItems`/`normalizeLocalResultItem` (`dataforseo-provider.ts`) populates the two fields via `parseListingRating`. No new endpoint, no cache/cost change. Surfaces in the admin local-pack competitor list as a cheap per-keyword reputation readout. This half is NOT flag-gated (it's free signal extraction; if we want it dark, gate the DISPLAY, not the parse — decide in plan, default: ungated parse like P3).

### C. Paid half — provider method (Wave 1)
- `getBusinessListings(request, workspaceId)` on `SeoDataProvider` (optional) + `DataForSeoProvider`, reusing `runDataForSeoOperation` (cache + `logCreditUsage` + credit/capability breakers), with a new `CACHE_TTL_BUSINESS_LISTINGS` (~24h — reviews move). Request from `NationalSerp`-style options: `{ category, locationCoordinate, limit?, isClaimed? }`. Build the endpoint body for `business_data/business_listings_search` with `categories`, `location_coordinate` (from the client location/market lat,lng,radius), `order_by: ['rating.votes_count,desc']`, `limit: 20`. Parse each `business_listing` via `parseListingRating` + the fixture-validated fields (`title`, `place_id`, `cid`, `domain`, `category`, `address_info`, `rating_distribution`, `attributes.available_attributes`, `total_photos`). Mark `isOwned` by matching `place_id`/`cid` (→ `client_locations.gbp_place_id`) then `domain` (→ `cleanDomain(workspace.liveDomain)`). Capability breaker on `40204`. Geo via P4 (`workspaceProviderGeo`) only to default the location code; the actual search uses the location's coordinate.
- **Return type** `BusinessListingResult[]`: `{ title, placeId, cid?, domain?, category?, addressInfo?, rating?, reviewCount?, ratingDistribution?: Record<'1'|'2'|'3'|'4'|'5', number>, attributes?: GbpAttributes, totalPhotos?, claimed?, isOwned }`. `GbpAttributes` = the normalized completeness set (accessibility/amenities/planning/payments/offerings → flattened string[] + a derived `completenessScore`).

### D. Data model — migration 154 (Wave 0)
- New `business_listing_snapshots` (time-series, mirrors `serp_snapshots`/`local_visibility_snapshots`):
  ```
  workspace_id TEXT NOT NULL,
  place_id     TEXT NOT NULL,            -- GBP CID/place id; the per-listing identity
  snapshot_date TEXT NOT NULL,
  is_owned     INTEGER,                  -- tri-state NULL/0/1 (client's own listing vs competitor)
  location_id  TEXT,                     -- FK client_locations (NULL = workspace-level / unmatched)
  market_id    TEXT,                     -- FK local_seo_markets
  title        TEXT,
  domain       TEXT,
  cid          TEXT,
  category     TEXT,
  rating_value REAL,                     -- star rating; NULL = no reviews yet (NEVER 0)
  review_count INTEGER,                  -- NULL = no reviews yet (NEVER 0)
  rating_distribution TEXT,              -- JSON {"1":..,"5":..} or NULL
  attributes   TEXT NOT NULL DEFAULT '[]', -- JSON string[] of completeness attributes
  total_photos INTEGER,
  claimed      INTEGER,                  -- tri-state NULL/0/1
  fetched_at   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, place_id, snapshot_date),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  -- indexes: (workspace_id, is_owned, snapshot_date DESC), (workspace_id, market_id, snapshot_date DESC)
  ```
  Own + competitor rows share the table, distinguished by `is_owned`. Store module `server/business-listings-store.ts`: `BusinessListingSnapshotRow` + `rowToBusinessListingSnapshot` (tri-state, `parseJsonSafeArray` for attributes, `parseJsonSafe` for distribution), `storeBusinessListingSnapshots` (transaction upsert), `getLatestBusinessListings(workspaceId)` / `getLatestOwnedListing(workspaceId, locationId?)`. Retention can follow the local-visibility prune later (not in P7 scope).

### E. Paid half — job + route (Wave 2)
- `LOCAL_GBP_REFRESH: 'local-gbp-refresh'` in `BACKGROUND_JOB_TYPES` + `BACKGROUND_JOB_METADATA` (`label: 'Refreshing GBP + reviews'`, `cancellable: true`, `resultBehavior: 'domain-store'`) + `tests/helpers/background-job-test-matrix.ts` entry → signal test file.
- `runLocalGbpRefreshJob(workspaceId, jobId)` ported from `runLocalSeoRefreshJob`: resolve owner domain + tier (defense-in-depth no-op if not Growth+), iterate active markets × confirmed client locations, build category (from `intelligenceProfile.industry` / business profile) + coordinate, call `getBusinessListings`, store own + top-N competitor snapshots. `assertCreditBudget(workspaceId, 'business_listings', tier)` per call (observe-only, logged-skip). Memory headroom, cancel checks, **incremental flush** (cancel keeps paid work), progress/broadcast.
- `POST /api/local-seo/:workspaceId/refresh-gbp` (in `server/routes/local-seo.ts`, `requireWorkspaceAccess` only): flag → workspace → Growth+ tier → observe-only budget → `hasActiveJob` (per-ws + global) → `createJob` → fire-and-forget → `{ jobId }`.
- `LOCAL_GBP_SNAPSHOTS_REFRESHED: 'local-gbp:snapshots_refreshed'` in `server/ws-events.ts` + `src/lib/wsEvents.ts` mirror + centralized `src/lib/wsInvalidation.ts` admin switch (→ `localSeo` + `keywordCommandCenter` keys) + `src/hooks/useWsInvalidation.ts` + `scripts/platform-domain-event-definitions.ts` `CONTEXT_BY_EVENT_KEY` (`seo-health`). Frontend trigger via a `useLocalGbpRefresh` mutation + `trackJob`.

### F. Recommendation generation — the deliverable (Wave 2)
- New block in `server/recommendations.ts` (after the B2 competitor-brand block) reading `getLatestBusinessListings(workspaceId)`:
  - **Review gap:** per location/market, compare the owned listing's `reviewCount`/`rating_value` to the top competitor(s). Fire when the gap is material (review-count gap ≥ ~10 OR star gap ≥ ~0.3, tunable consts). Title e.g. *"Close the review gap: 12 reviews / 3.9★ vs {competitor} 80 / 4.6★ in {market}"*.
  - **GBP completeness:** when the owned listing is unclaimed OR missing high-value attributes (hours, ≥N photos, key attributes). Title e.g. *"Complete your Google Business Profile — unclaimed / missing hours + photos"*.
  - Both via `RecSource.localVisibility('review_gap:<marketId|locationId>')` / `('gbp_completeness:<...>')`, `type: 'local_visibility'`, OV-scored (`branch: 'local'`, `intent: 'commercial'/'transactional'`, `localVisibilitySignal` scaled on gap), `deriveCanonicalRecommendationFields`. `actionType` reflects a manual review/GBP action; outcome `local_visibility_won`.
- Recs flow through the EXISTING curated-rec spine + public projection (`stripEmvFromPublicRecs`) — **no new client component**. Auto-resolve safety: source-category filtered like other local recs.

### G. Admin surface + intelligence (Wave 3)
- A compact **"Reviews vs competitors"** + **GBP completeness** readout in the local-SEO panel (`src/components/local-seo/`), `<TierGate required="growth">`, Four Laws (review counts/ratings = blue data; completeness state = emerald/amber/red via score helpers; **no purple**), AGGREGATES ONLY (never individual reviews/authors — PII rule). A "Refresh GBP & reviews" button (flag-gated, mirrors P6's national-rank trigger).
- Extend `LocalSeoSlice` (`server/intelligence/local-seo-slice.ts`) with a `reviewSummary` (own rating/count + top-competitor comparison + completeness) so AI context + AdminChat see it (the "wire new data into a slice" rule). Public/client exposure of the summary follows the existing local-slice serialization (aggregates only).

### H. Testing (Wave 4)
- Fixture-grounded unit tests for `parseListingRating` (zero-review/absent → undefined) + the `getBusinessListings` parser (own/competitor match, distribution, attributes) + the free local-pack rating extraction — against `dataforseo-business-listings.ts`.
- `business-listings-store` round-trip (tri-state, JSON, transaction, workspace-scoped).
- Integration: `tests/integration/local-gbp-routes.test.ts` — route gating (flag OFF→404, Free→403, Growth→jobId), seeded no-500, job-type assertion (lifecycle-matrix signal).
- Recommendation-generation unit test: seeded snapshots → review-gap + GBP-completeness recs minted with correct source/type.
- Full gate INCLUDING the contract project (`ws-invalidation-coverage`, `background-job-coverage`, `insight-renderer-coverage`), `verify:feature-flags`, pr-check — the registries P6's contract run caught.

---

## Scaffolding lockstep (anti-silent-CI checklist)
Flag (3 sites + lifecycle test) · job type (2 sites + matrix + signal test) · WS event (server + mirror + invalidation switch + hook + platform-domain-event) · migration 154 + store mapper + public/slice serialization · `LocalVisibilityBusinessResult` additive fields. No new insight type (rec-only), so no 7-part insight lockstep.

## Non-goals (deferred)
- Individual review text/sentiment analysis or author data (PII). Aggregates only.
- Weekly cron cadence (manual trigger in P7; cron is a follow-up).
- Review *response* drafting / reply automation.
- Third-party directories (Yelp/Trustpilot) — Google only for P7.
- Hard budget enforcement (stays observe-only).
- A dedicated `review_gap` RecType or `review_gap_closed` ActionType (reuse `local_visibility`/`local_visibility_won`).

## Success criteria
- Flag OFF = byte-identical PAID surface (no `business_listings` fetch, no `local-gbp-refresh` job, no GBP panel, no review-gap/GBP-completeness rec). The free pack-rating fields populate unflagged (P3 precedent) — an additive enrichment, no cost change.
- Free half: local-pack ratings/review-counts surface on the existing panel with no cost change.
- Paid half: `local-gbp-refresh` (Growth+, observe-only budget, serialized) populates `business_listing_snapshots`; admin sees own-vs-competitor reviews + GBP completeness.
- Review-gap + GBP-completeness recs generate, curate, send, and track through the existing spine.
- Full gate + contract project + feature-flags green; scaled review clean.
