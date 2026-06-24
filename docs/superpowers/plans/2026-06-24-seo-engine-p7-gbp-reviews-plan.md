# SEO Decision Engine P7 — GBP + Reviews Local Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Read these THREE first: spec `docs/superpowers/specs/2026-06-24-seo-engine-p7-gbp-reviews-design.md`, audit `docs/superpowers/audits/2026-06-24-seo-engine-p7-gbp-reviews-audit.md` (file:line surface), fixture `tests/fixtures/dataforseo-business-listings.ts` (the ground-truth API shapes — build parsers against these, never guess field names; it is the #1 bug class in this repo).

**Goal:** Capture Google Business Profile health + review counts/ratings (client's own + competitors') and surface review-gap + GBP-completeness findings as actionable curated recommendations, behind the `local-gbp` flag (Growth+, observe-only budget).

**Architecture:** Two data paths. FREE: extract `rating`/`reviewCount` from `local_pack` items the existing local refresh already fetches (unflagged, P3 precedent). PAID: a new `getBusinessListings` provider method (`business_data/business_listings_search`) → a new time-series `business_listing_snapshots` table → a separate `local-gbp-refresh` job → a recommendation-generation block reusing the `local_visibility` RecType. Mirrors P6's proven wave structure exactly.

**Tech stack:** Express + better-sqlite3 + Zod + React Query + DataForSEO. Branch `seo-engine-p7-gbp-reviews` (off staging, includes P6).

---

## File Structure

**Create:**
- `server/db/migrations/154-business-listing-snapshots.sql` — the snapshots table.
- `server/business-listings-store.ts` — row/mapper/store (mirror `server/serp-snapshots-store.ts`).
- `server/listing-rating.ts` — the shared `parseListingRating` helper (one source for both halves).
- `server/local-gbp.ts` — `runLocalGbpRefreshJob` (mirror `server/national-serp.ts`).
- `src/components/local-seo/GbpReviewsPanel.tsx` — admin GBP/reviews readout.
- Tests: `tests/unit/listing-rating.test.ts`, `tests/unit/business-listings-parser.test.ts`, `tests/unit/business-listings-store.test.ts`, `tests/unit/local-gbp-review-recs.test.ts`, `tests/integration/local-gbp-routes.test.ts`, `tests/component/GbpReviewsPanel.test.tsx`.

**Modify (exclusive ownership noted per task):**
- `shared/types/feature-flags.ts`, `shared/types/background-jobs.ts`, `shared/types/local-seo.ts`, `shared/types/intelligence.ts`
- `server/seo-data-provider.ts`, `server/providers/dataforseo-provider.ts`
- `server/routes/local-seo.ts`, `server/recommendations.ts`, `server/intelligence/local-seo-slice.ts`
- `server/ws-events.ts`, `scripts/platform-domain-event-definitions.ts`
- `src/lib/wsEvents.ts`, `src/lib/wsInvalidation.ts`, `src/hooks/useWsInvalidation.ts`, `src/hooks/admin/useLocalSeo.ts`, `src/api/localSeo.ts`, `src/components/local-seo/LocalSeoVisibilityPanel.tsx`
- `tests/helpers/background-job-test-matrix.ts`, `tests/unit/feature-flag-lifecycle.test.ts`

---

## Dependency graph

```
U0 (contracts, single commit) ──► everything
U1 provider+parser ─┐
U2 store ───────────┼─► U4 job+route ─► U5 recs ─► U6 panel ─► U8 tests ─► gate+review+PR
U3 free extraction ─┘                   U7 slice ─┘
```
**Waves:** U0 (sequential) → {U1, U2, U3} parallel → {U4} → {U5, U7} parallel → {U6} → U8 → gate.
**Diff-review checkpoints:** after Wave 1 and Wave 3 (grep duplicates, tsc, contract project).

## Model assignments
U0/review/orchestration = **Opus** (full-context judgment). U1 parser, U2 store, U4 job, U5 recs, U6 panel, U7 slice = **Sonnet**. Mechanical registry edits inside U0 = **Haiku** acceptable. (Codex ladder: GPT-5.5 / GPT-5.4 / GPT-5.4-Mini respectively.)

---

# Wave 0 — Task U0: Shared contracts (SINGLE commit, blocks all parallel work)

**Files (exclusive to U0):** all of: `shared/types/feature-flags.ts`, `server/db/migrations/154-business-listing-snapshots.sql`, `shared/types/local-seo.ts`, `shared/types/background-jobs.ts`, `server/ws-events.ts`, `src/lib/wsEvents.ts`, `src/lib/wsInvalidation.ts`, `src/hooks/useWsInvalidation.ts`, `scripts/platform-domain-event-definitions.ts`, `server/seo-data-provider.ts`.

- [ ] **Step 1: Migration 154.** Create `server/db/migrations/154-business-listing-snapshots.sql`:
```sql
-- 154-business-listing-snapshots.sql
-- SEO Decision Engine P7: GBP profile + reviews time series (client's own + competitors).
-- Time-series, parallel to serp_snapshots / local_visibility_snapshots. rating_value /
-- review_count are NULLable: a business with zero reviews has NO rating (never 0).
CREATE TABLE IF NOT EXISTS business_listing_snapshots (
  workspace_id        TEXT NOT NULL,
  place_id            TEXT NOT NULL,                 -- GBP place id / CID; per-listing identity
  snapshot_date       TEXT NOT NULL,
  is_owned            INTEGER,                        -- tri-state NULL/0/1 (client's own vs competitor)
  location_id         TEXT,                           -- FK client_locations (NULL = unmatched/workspace-level)
  market_id           TEXT,                           -- FK local_seo_markets
  title               TEXT,
  domain              TEXT,
  cid                 TEXT,
  category            TEXT,
  rating_value        REAL,                           -- star rating; NULL = no reviews (NEVER 0)
  review_count        INTEGER,                        -- NULL = no reviews (NEVER 0)
  rating_distribution TEXT,                           -- JSON {"1":..,"5":..} or NULL
  attributes          TEXT NOT NULL DEFAULT '[]',     -- JSON string[] completeness attributes
  total_photos        INTEGER,
  claimed             INTEGER,                        -- tri-state NULL/0/1
  fetched_at          TEXT NOT NULL,
  PRIMARY KEY (workspace_id, place_id, snapshot_date),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_business_listings_owned ON business_listing_snapshots(workspace_id, is_owned, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_business_listings_market ON business_listing_snapshots(workspace_id, market_id, snapshot_date);
```

- [ ] **Step 2: Provider types.** In `server/seo-data-provider.ts`, add (near the National SERP types added in P6):
```ts
export interface GbpAttributes {
  /** Flattened completeness attribute keys (e.g. 'has_wheelchair_accessible_entrance', 'recommends_appointment'). */
  items: string[];
  /** 0..100 derived completeness signal (presence of hours/photos/attributes/claimed — computed by the parser). */
  completenessScore: number;
}
export interface BusinessListingResult {
  title: string;
  placeId: string;
  cid?: string;
  domain?: string;
  category?: string;
  city?: string;
  rating?: number;            // star value; undefined = no reviews (NEVER 0)
  reviewCount?: number;       // undefined = no reviews (NEVER 0)
  ratingDistribution?: Record<'1' | '2' | '3' | '4' | '5', number>;
  attributes?: GbpAttributes;
  totalPhotos?: number;
  claimed?: boolean;
  /** True when this listing matches the client (place_id/cid → client_locations, else domain). */
  isOwned: boolean;
}
export interface BusinessListingsRequest {
  category: string;
  /** "lat,lng,radiusKm" per DataForSEO. */
  locationCoordinate: string;
  ownerDomain: string;
  ownerPlaceIds?: string[];   // client_locations.gbp_place_id values for isOwned matching
  limit?: number;
}
```
Add to the `SeoDataProvider` interface (optional, like `getNationalSerp`): `getBusinessListings?(request: BusinessListingsRequest, workspaceId: string): Promise<BusinessListingResult[]>;`

- [ ] **Step 3: Free-half type fields.** In `shared/types/local-seo.ts`, extend `LocalVisibilityBusinessResult` additively:
```ts
  /** Star rating from the local_pack item (P7 free half); undefined = no reviews / absent. */
  rating?: number;
  /** Review count (rating.votes_count) from the local_pack item; undefined = no reviews / absent. */
  reviewCount?: number;
```

- [ ] **Step 4: Flag.** In `shared/types/feature-flags.ts`: add `'local-gbp': false,` to `FEATURE_FLAGS` (after `'national-serp-tracking'`); add the catalog entry (mirror the `national-serp-tracking` block, `createdAt`/`lastReviewedAt` = TODAY's commit date, `linkedRoadmapItemId: 'seo-engine-p7-gbp-reviews-local-layer'`, group `'SEO Decision Engine'`, label `'Local GBP + reviews — profile health + review-gap vs competitors'`); add `'local-gbp'` to `FEATURE_FLAG_GROUPS['SEO Decision Engine'].keys`.

- [ ] **Step 5: Job type.** In `shared/types/background-jobs.ts`: add `LOCAL_GBP_REFRESH: 'local-gbp-refresh',` to `BACKGROUND_JOB_TYPES`; add the `BACKGROUND_JOB_METADATA[BACKGROUND_JOB_TYPES.LOCAL_GBP_REFRESH]` entry `{ label: 'Refreshing GBP + reviews', description: 'Reads Google Business Profile health + review counts for the client and local competitors.', cancellable: true, resultBehavior: 'domain-store' }`.

- [ ] **Step 6: WS event + all registries.** `server/ws-events.ts`: `LOCAL_GBP_SNAPSHOTS_REFRESHED: 'local-gbp:snapshots_refreshed',` (after `LOCAL_SEO_UPDATED`). `src/lib/wsEvents.ts`: mirror the same constant. `src/lib/wsInvalidation.ts` `adminInvalidationKeys` switch: add `case WS_EVENTS.LOCAL_GBP_SNAPSHOTS_REFRESHED: return [queryKeys.admin.localSeo(workspaceId), queryKeys.admin.keywordCommandCenter(workspaceId)] as const;`. `src/hooks/useWsInvalidation.ts`: add `[WS_EVENTS.LOCAL_GBP_SNAPSHOTS_REFRESHED]: () => invalidateRegistry(WS_EVENTS.LOCAL_GBP_SNAPSHOTS_REFRESHED),`. `scripts/platform-domain-event-definitions.ts`: add `LOCAL_GBP_SNAPSHOTS_REFRESHED: 'seo-health',` to `CONTEXT_BY_EVENT_KEY` + a `PAYLOAD_NOTE_BY_EVENT_KEY` entry.

- [ ] **Step 7: Gate + commit.** Run `npm run typecheck` (zero errors), `npm run verify:feature-flags` (exit 0), `npx tsx scripts/pr-check.ts` (zero errors). Then:
```bash
pkill -f "tsx server/index.ts" 2>/dev/null
git add server/db/migrations/154-business-listing-snapshots.sql shared/types/feature-flags.ts shared/types/local-seo.ts shared/types/background-jobs.ts server/seo-data-provider.ts server/ws-events.ts src/lib/wsEvents.ts src/lib/wsInvalidation.ts src/hooks/useWsInvalidation.ts scripts/platform-domain-event-definitions.ts
git commit --no-verify -m "feat(seo): P7 U0 contracts — business_listing_snapshots + local-gbp flag/job/event"
```
> NOTE: the lifecycle-anchor test (`tests/unit/feature-flag-lifecycle.test.ts`) anchor is already `2026-06-24`; if the commit day differs, bump it (U8 covers the explicit assertion). The `insight-renderer-coverage` contract does NOT apply (no new insight type).

---

# Wave 1 (parallel, exclusive ownership) — after U0 commit

## Task U1: `parseListingRating` + `getBusinessListings` provider (fixture-grounded)
**Files:** Create `server/listing-rating.ts`, `tests/unit/listing-rating.test.ts`, `tests/unit/business-listings-parser.test.ts`. Modify `server/providers/dataforseo-provider.ts`. **Read first:** the fixture, `getNationalSerp`/`parseNationalSerp` (P6) + `runDataForSeoOperation`/`cleanDomain`/`getTaskResult` in `dataforseo-provider.ts`.

- [ ] **Step 1: Failing test for `parseListingRating`** (`tests/unit/listing-rating.test.ts`): a `{ rating_type: 'Max5', value: 5, votes_count: 1 }` → `{ rating: 5, reviewCount: 1 }`; a `{ rating_type: 'Max5' }` (zero-review) → `{ rating: undefined, reviewCount: undefined }`; `undefined`/`null`/`{}` → both undefined. Run, see it fail.
- [ ] **Step 2: Implement** `server/listing-rating.ts`: `export function parseListingRating(rating: unknown): { rating?: number; reviewCount?: number }` — guard typeof, read `value`/`votes_count` only when numbers, NEVER coerce missing → 0. Run test → pass. Commit.
- [ ] **Step 3: Failing test for the listings parser** (`tests/unit/business-listings-parser.test.ts`) against `BUSINESS_LISTINGS_SEARCH`: with `ownerDomain='www.sfdentalgroup.com'` → the matching item has `isOwned===true`; the first item (Bridges, no domain) `isOwned===false`, `rating===5`, `reviewCount===1`, `ratingDistribution['5']===1`, `attributes.items` includes `'recommends_appointment'`, `completenessScore>0`; the claimed item with no `rating` block → `rating===undefined`. Export a pure `parseBusinessListings(items, request)` from the provider module like `parseNationalSerp`.
- [ ] **Step 4: Implement** `parseBusinessListings` (pure, exported) + `getBusinessListings` method (reuse `runDataForSeoOperation`, endpoint `business_data/business_listings_search`, body `[{ categories:[request.category], location_coordinate, order_by:['rating.votes_count,desc'], limit: request.limit ?? 20 }]`, `CACHE_TTL_BUSINESS_LISTINGS = 24`). `isOwned` = `request.ownerPlaceIds?.includes(place_id||cid)` OR `domainMatches(domain, request.ownerDomain)`. Use `parseListingRating`. Capability-breaker on 40204 like backlinks. Run tests → pass.
- [ ] **Step 5: typecheck + commit.** `npm run typecheck`; commit U1.

## Task U2: `business-listings-store`
**Files:** Create `server/business-listings-store.ts`, `tests/unit/business-listings-store.test.ts`. **Read first:** `server/serp-snapshots-store.ts` (the exact template), `server/db/json-validation.ts`, `server/db/stmt-cache.ts`.
- [ ] **Step 1: Failing round-trip test** mirroring `serp-snapshots-store.test.ts` (reuse its `createWorkspace`/`deleteWorkspace` harness; migration 154 auto-applies): store an owned listing + a competitor for `(ws,'2026-06-24')`; `getLatestBusinessListings(ws)` returns both; `rating_value`/`review_count` round-trip (undefined → undefined, never 0); `attributes` via `parseJsonSafeArray`; `is_owned`/`claimed` tri-state; upsert-not-duplicate; workspace-scoped.
- [ ] **Step 2: Implement** `BusinessListingSnapshotRow` + `BusinessListingSnapshot` + `rowToBusinessListingSnapshot` (tri-state helpers, `parseJsonSafeArray` for attributes, `parseJsonSafe`+a small Zod object for `rating_distribution`), `storeBusinessListingSnapshots(workspaceId, date, rows[])` (transaction upsert on `(workspace_id, place_id, snapshot_date)`), `getLatestBusinessListings(workspaceId)`, `getLatestOwnedListing(workspaceId, locationId?)`. `createStmtCache`, all statements workspace-scoped. Run → pass. typecheck + commit.

## Task U3: Free local-pack rating extraction (unflagged)
**Files:** Modify `server/providers/dataforseo-provider.ts` (the `extractLocalPackItems`/`normalizeLocalResultItem` path only). Add a case to `tests/unit/business-listings-parser.test.ts` (or a small new test) using `LOCAL_PACK_WITH_RATINGS`.
- [ ] **Step 1: Failing test** — parsing `LOCAL_PACK_WITH_RATINGS` items yields `LocalVisibilityBusinessResult` with `rating===4.9, reviewCount===987` for Folsom Street Dental.
- [ ] **Step 2: Implement** — in the local-pack normalizer, set `rating`/`reviewCount` via `parseListingRating(item.rating)` (import from `server/listing-rating.ts`). Additive, unflagged. Run → pass. typecheck + commit.

**→ Wave 1 diff-review checkpoint:** `git status` (only U1/U2/U3 files), `npm run typecheck`, run the three new unit test files, grep for duplicate `parseListingRating` definitions (must be one).

---

# Wave 2 — after Wave 1

## Task U4: `local-gbp-refresh` job + route
**Files:** Create `server/local-gbp.ts`. Modify `server/routes/local-seo.ts`, `src/api/localSeo.ts`, `src/hooks/admin/useLocalSeo.ts`. Modify `tests/helpers/background-job-test-matrix.ts`. **Read first:** `server/national-serp.ts` (the exact job template incl. incremental flush), `server/routes/rank-tracking.ts` P6 route, `server/local-seo.ts` market/location/category resolution (`activeMarkets`, `getClientLocations`, `resolveWorkspaceTargetGeo`, business-profile category/industry), `useLocalSeoRefresh` hook.
- [ ] **Step 1:** `runLocalGbpRefreshJob(workspaceId, jobId)` — resolve owner domain + tier (Growth+ defense no-op), gather active markets × confirmed locations, derive category (from `intelligenceProfile.industry`/business profile; fall back to the location/business `name` via the `title` search param) + coordinate (`lat,lng,radiusKm`), `assertCreditBudget(workspaceId,'business_listings',tier)` per call (observe-only logged-skip), `getBusinessListings(...)`, collect own + top-N competitor `BusinessListingSnapshot`s, **incremental `flushSnapshots`** (cancel keeps work), `storeBusinessListingSnapshots`, broadcast `LOCAL_GBP_SNAPSHOTS_REFRESHED`, `addActivity`, summary `{ listingsProcessed, reviewGapsFound }`.
- [ ] **Step 2:** Route `POST /api/local-seo/:workspaceId/refresh-gbp` (`requireWorkspaceAccess` only): flag `local-gbp` → 404; workspace → 404; `computeEffectiveTier` Growth+ → 403; `assertCreditBudget` (observe-only try/catch); `hasActiveJob(LOCAL_GBP_REFRESH, ws)` + global → 409; `createJob` → `registerAbort` → fire-and-forget `.catch` marks job error → `{ jobId }`.
- [ ] **Step 3:** Frontend `rankTracking`-style: `localSeo.refreshGbp(wsId)` in `src/api/localSeo.ts` (POST, returns `{jobId}`); `useLocalGbpRefresh(workspaceId)` hook in `src/hooks/admin/useLocalSeo.ts` (mutation + `trackJob(BACKGROUND_JOB_TYPES.LOCAL_GBP_REFRESH, …)` + invalidate `localSeo`).
- [ ] **Step 4:** Add the matrix entry in `tests/helpers/background-job-test-matrix.ts`: `[BACKGROUND_JOB_TYPES.LOCAL_GBP_REFRESH]: entry('LOCAL_GBP_REFRESH', { expectedLabel: 'Refreshing GBP + reviews', expectedCancellable: true, expectedResultBehavior: 'domain-store' }, 'tests/integration/local-gbp-routes.test.ts')`.
- [ ] **Step 5:** `npm run typecheck` + `npx tsx scripts/pr-check.ts` (watch: workspace-scoped SQL, transaction, no requireAuth). Commit U4.

## Task U5: Recommendation generation (the deliverable)
**Files:** Modify `server/recommendations.ts` only. Create `tests/unit/local-gbp-review-recs.test.ts`. **Read first:** the B2 competitor-brand block (`:2153-2200`), `RecSource.localVisibility`, `computeOpportunityValue`, `deriveCanonicalRecommendationFields`, `getLatestBusinessListings`/`getLatestOwnedListing` (U2).
- [ ] **Step 1: Failing test** — seed an owned listing (12 reviews / 3.9★, unclaimed) + a competitor (80 / 4.6★) via `storeBusinessListingSnapshots`; call the rec generation; assert a `local_visibility` rec with `source` `local_visibility:review_gap:*` (count-gap ≥ threshold) AND a `local_visibility:gbp_completeness:*` rec (unclaimed). Flag OFF → none.
- [ ] **Step 2: Implement** the B3 block (after B2): if `!isFeatureEnabled('local-gbp', ws.id)` skip; read latest listings, per owned location compute review-count gap + star gap vs the top-review competitor; mint review-gap rec when `reviewCountGap >= REVIEW_COUNT_GAP_MIN (10)` OR `ratingGap >= STAR_GAP_MIN (0.3)`; mint GBP-completeness rec when owned `claimed===false` OR `completenessScore < GBP_COMPLETENESS_MIN (60)`. `type:'local_visibility'`, `RecSource.localVisibility('review_gap:'+key)` / `('gbp_completeness:'+key)`, OV `branch:'local'`, `localVisibilitySignal` scaled on gap, `deriveCanonicalRecommendationFields`. Titles per spec §F. Wrap in try/catch → `failedCategories.add('local_visibility')`.
- [ ] **Step 3:** typecheck + run the rec test → pass. Commit U5.

**→ Wave 2 diff-review checkpoint.**

---

# Wave 3 (parallel) — after U4/U5

## Task U6: Admin GBP/reviews panel
**Files:** Create `src/components/local-seo/GbpReviewsPanel.tsx`, `tests/component/GbpReviewsPanel.test.tsx`. Modify `src/components/local-seo/LocalSeoVisibilityPanel.tsx` (mount it), `src/api/localSeo.ts` (read endpoint if needed — or reuse the local-seo read model extended in U7). **Read first:** `LocalSeoVisibilityPanel.tsx`, `<TierGate>`, `Badge`/score helpers, P6's `KeywordDetailDrawer` national section for the trigger-button pattern.
- [ ] **Step 1:** Build `GbpReviewsPanel` — own rating/review-count vs top competitor(s) (blue data), GBP-completeness state (emerald/amber/red via `scoreColorClass`, **never purple**), aggregates only (no individual reviews). A `<FeatureFlag flag="local-gbp">`-gated "Refresh GBP & reviews" button wired to `useLocalGbpRefresh`. Render only when data present.
- [ ] **Step 2:** Component test (mock `useFeatureFlag`, mock the data hook): renders own-vs-competitor counts, the completeness state, the "Cited"-style copy; cited/gap variants. Four Laws grep clean.
- [ ] **Step 3:** Mount in `LocalSeoVisibilityPanel`. typecheck + vite build + pr-check. Commit U6.

## Task U7: Intelligence slice
**Files:** Modify `server/intelligence/local-seo-slice.ts`, `shared/types/intelligence.ts`. **Read first:** `assembleLocalSeo`, `LocalSeoSlice`.
- [ ] **Step 1:** Extend `LocalSeoSlice` with `reviewSummary?: { ownRating?, ownReviewCount?, topCompetitor?: { name, rating?, reviewCount? }, completenessScore?, claimed? }` (aggregates only).
- [ ] **Step 2:** Populate it in `assembleLocalSeo` from `getLatestOwnedListing` + `getLatestBusinessListings` (top competitor by review count). Include in `effectiveLocalSeoBlock` prose. typecheck + commit U7.

**→ Wave 3 diff-review checkpoint** (incl. `grep "purple-\|violet-\|indigo-" src/components/local-seo/GbpReviewsPanel.tsx` = empty).

---

# Wave 4 — Task U8: Tests + full gate

**Files:** Create `tests/integration/local-gbp-routes.test.ts`. Modify `tests/unit/feature-flag-lifecycle.test.ts` (only if commit day ≠ anchor). **Read first:** `tests/integration/national-serp-routes.test.ts` (the exact template — flag override + tier + ephemeral context + job-type assertion).
- [ ] **Step 1:** Integration `local-gbp-routes.test.ts`: flag OFF → 404; flag ON + Free → 403; flag ON + Growth → `{ jobId }`, poll `GET /api/jobs/:id` to `done`, assert `job.type === BACKGROUND_JOB_TYPES.LOCAL_GBP_REFRESH` (the lifecycle-matrix signal); seeded `storeBusinessListingSnapshots` → no 500.
- [ ] **Step 2:** If KeywordHub/LocalSeoVisibilityPanel component tests now mount `<FeatureFlag flag="local-gbp">` or the new hook → add the `useFeatureFlag`/`useLocalGbpRefresh` mock to those test files (the P6 gotcha — new hook in a mounted component breaks existing mocks).
- [ ] **Step 3: Full gate (sequential, never two `vitest run` at once):** `npm run typecheck` → `npx vite build` → `npx vitest run --project unit` → `--project component` → `--project contract` (MUST run — P6's contract gaps were caught here) → `npx tsx scripts/pr-check.ts` → `npm run verify:feature-flags`. Fix any failure. Commit U8.

---

# Verification + handoff

- [ ] **Scaled review** (multiple parallel agents were used): invoke `scaled-code-review` over `git diff origin/staging...HEAD`. Concern split: logic/data-loss (parser rating gotcha, isOwned matching, rec thresholds) · security (route gating, workspace-scoped SQL, PII — no individual reviews leak) · compliance (flag/job/event/migration lockstep, Four Laws, no requireAuth) · edge cases (zero-review undefined-not-0, no owned listing, no competitors, cancel mid-job). Fix all Critical/Important.
- [ ] **PR → staging:** push, open PR (base `staging`), watch CI to green (fail+pending 0, MERGEABLE/CLEAN), merge.
- [ ] **Docs:** `FEATURE_AUDIT.md` (#532), `data/roadmap.json` (`seo-engine-p7-gbp-reviews-local-layer` → done + notes, `sort-roadmap`), `BRAND_DESIGN_LANGUAGE.md` (only if a new pattern — none expected; reuses Badge/score colors).

---

## Self-review (plan vs spec)

**Spec coverage:** §A flag→U0/Step4; §B free half→U0/Step3 + U3; §C provider→U1; §D table/store→U0/Step1 + U2; §E job/route/event→U0/Step5-6 + U4; §F recs→U5; §G panel+slice→U6+U7; §H testing→U8. All covered.
**Placeholder scan:** thresholds are named consts with values (REVIEW_COUNT_GAP_MIN=10, STAR_GAP_MIN=0.3, GBP_COMPLETENESS_MIN=60, limit=20, TTL=24h); no TBD/TODO.
**Type consistency:** `BusinessListingResult`/`BusinessListingsRequest`/`GbpAttributes` (U0) consumed by U1; `BusinessListingSnapshot`/`getLatestBusinessListings`/`getLatestOwnedListing` (U2) consumed by U4/U5/U7; `parseListingRating` (U1) consumed by U3; `LOCAL_GBP_REFRESH`/`LOCAL_GBP_SNAPSHOTS_REFRESHED` (U0) consumed by U4. Names consistent across tasks.
