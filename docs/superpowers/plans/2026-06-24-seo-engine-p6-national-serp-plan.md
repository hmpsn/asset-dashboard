# SEO Decision Engine P6 — National Advanced-SERP Rank + AI-Overview Citation — Implementation Plan

> **For agentic workers:** verified scope lives in `docs/superpowers/audits/2026-06-24-seo-engine-p6-national-serp-audit.md` (U0–U8 unit breakdown, file:line ownership, dependency graph, dark-output checklist). This plan turns it into wave-by-wave executable tasks. The DataForSEO response shape is already de-risked: ground-truth fixture at `tests/fixtures/dataforseo-serp-advanced.ts` (validated against 2 live calls).

**Goal:** Track true national SERP rank + SERP features (AI Overview, featured snippet, PAA) per tracked keyword behind the `national-serp-tracking` flag, surface AI-Overview citation status in the keyword drawer, and fire a `serp_feature_opportunity` insight — Growth+Premium only, observe-only budget, no backfill.

**Architecture:** New `serp_snapshots` time-series table (parallel to GSC `rank_snapshots`, never conflated). New `getNationalSerp()` provider method parses the advanced-SERP response. A background job (ported from `runLocalSeoRefreshJob`: concurrency=1, memory-headroom-gated) refreshes snapshots. A new keyword-centric insight type mirrors `ranking_mover`'s 7-part lockstep. The drawer + public portal expose the new fields. Everything is dark behind the flag (OFF = byte-identical).

**Tech stack:** Express + better-sqlite3 + Zod + React Query + DataForSEO `serp/google/organic/live/advanced`.

---

## Owner decisions (LOCKED — roadmap notes)

- Tier gate: **Growth + Premium** (Free excluded — 0 budget).
- Backfill: **none** (start snapshots fresh; `historical_serps` deferred).
- Budget: **observe-only** (`assertCreditBudget` wired + logs would-block; `budgetEnforcementEnabled=false`, consistent with P5).
- Cadence: **weekly** default.
- Cap: **100 keywords** per refresh.
- Insight fires only when a SERP feature is present **and** a matched (ranking) URL exists for the keyword (real `pageId`, avoids null-pageId UNIQUE collapse; the "you don't rank at all" case stays owned by existing `ranking_opportunity`/`content_gap`).

---

## Wave 0 — U0 Contracts (sequential, SINGLE commit, blocks every parallel dispatch)

**Pre-commit shared contracts rule:** U0 lands and is committed before any Wave-1 agent starts.

**Files (exclusive to U0):**
- Create `server/db/migrations/153-serp-snapshots.sql`
- Edit `shared/types/keyword-command-center.ts` (extend `KeywordCommandCenterMetrics`)
- Edit `shared/types/analytics.ts` (`InsightType` union, `SerpFeatureOpportunityData`, `InsightDataMap`)
- Edit `server/schemas/insight-schemas.ts` (`serpFeatureOpportunityDataSchema` + map entry)
- Edit `shared/types/feature-flags.ts` (flag default + catalog + group)
- Edit `server/seo-data-provider.ts` (`NationalSerpResult` type + `getNationalSerp` method signature on the interface)

### Migration 153 (`position`/`matched_url` NULLable — refines the audit's NOT NULL draft; a keyword can have SERP features while the client doesn't rank)

```sql
-- 153-serp-snapshots.sql
-- SEO Decision Engine P6: true national SERP rank + SERP-feature time series.
-- Parallel to rank_snapshots (GSC); never conflated. clicks/impressions/ctr live
-- in rank_snapshots (GSC source) — join on (workspace_id, date, query) at read time.
CREATE TABLE IF NOT EXISTS serp_snapshots (
  workspace_id        TEXT NOT NULL,
  date                TEXT NOT NULL,
  query               TEXT NOT NULL,                 -- normalized via keywordComparisonKey
  position            INTEGER,                        -- client true SERP rank (1-based); NULL = not ranking
  matched_url         TEXT,                           -- client URL that ranks; NULL = not ranking
  features            TEXT NOT NULL DEFAULT '[]',     -- JSON string[] of SERP feature labels
  ai_overview_cited   INTEGER,                        -- tri-state NULL/0/1 (owner domain in ai_overview.references)
  ai_overview_present INTEGER,                        -- tri-state NULL/0/1 (ai_overview block present at all)
  PRIMARY KEY (workspace_id, date, query),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_serp_snapshots_query ON serp_snapshots(workspace_id, query);
```

### `KeywordCommandCenterMetrics` extension (additive, all optional)

```ts
  rankSource?: 'live_serp' | 'gsc_average' | 'tracking_baseline';
  matchedUrl?: string;
  serpFeatures?: string[];
  aiOverviewCited?: boolean;
  aiOverviewPresent?: boolean;
```

### `analytics.ts`

- Append to `InsightType`: `| 'serp_feature_opportunity'` (move the `;` off `local_visibility_shift`).
- Interface (keyword-centric per audit §3):
```ts
export interface SerpFeatureOpportunityData extends InsightDataBase {
  keyword: string;
  matchedUrl: string;            // the ranking page → becomes pageId; insight only fires when present
  currentPosition: number;       // client current SERP rank for the keyword
  presentFeatures: string[];     // e.g. ['ai_overview','featured_snippet','people_also_ask']
  aiOverviewPresent: boolean;
  aiOverviewCited: boolean;      // owner domain in ai_overview.references — false = the opportunity
  estimatedMonthlyCitations: number;
}
```
- `InsightDataMap`: `serp_feature_opportunity: SerpFeatureOpportunityData;`

### `insight-schemas.ts`

```ts
export const serpFeatureOpportunityDataSchema = z.object({
  keyword: z.string(),
  matchedUrl: z.string(),
  currentPosition: z.number(),
  presentFeatures: z.array(z.string()),
  aiOverviewPresent: z.boolean(),
  aiOverviewCited: z.boolean(),
  estimatedMonthlyCitations: z.number(),
});
```
Map: `serp_feature_opportunity: serpFeatureOpportunityDataSchema.partial().passthrough(),`

### `feature-flags.ts`

- Default: `'national-serp-tracking': false,` (after `geo-targeting`).
- Catalog entry (after `geo-targeting`): group `'SEO Decision Engine'`, owner `analytics-intelligence`, `createdAt`/`lastReviewedAt` = commit day, `rolloutTarget: 'staging-validation'`, `linkedRoadmapItemId: 'seo-engine-p6-national-serp-rank-ai-overview'`, `staleAuditCadence: 'weekly'`.
- Group: add `'national-serp-tracking'` to `SEO Decision Engine` `keys`.

### `seo-data-provider.ts`

```ts
export interface NationalSerpResult {
  query: string;
  position: number | null;          // client best organic rank_group, null if not ranking
  matchedUrl: string | null;        // that result's URL, null if not ranking
  features: string[];               // distinct SERP item types present
  aiOverviewPresent: boolean;
  aiOverviewCited: boolean | null;  // owner domain ∈ ai_overview.references[].domain; null if no AI overview
}
```
Add to `SeoDataProvider`: `getNationalSerp?(keyword: string, opts?: { locationCode?: number; languageCode?: string; device?: 'desktop' | 'mobile' }): Promise<NationalSerpResult>;` (optional method — fakes may omit).

**U0 gate:** `npm run typecheck && npx tsx scripts/pr-check.ts && npm run verify:feature-flags`. Commit `feat(seo): P6 U0 contracts — serp_snapshots migration + national-serp types/flag`.

---

## Wave 1 — Backend fan-out (3 parallel agents, exclusive ownership) — after U0 commit

- **U1 Provider** — owns `server/providers/dataforseo-provider.ts` + any Fake/stub provider impls. Implement `getNationalSerp` parsing the advanced-SERP response against the committed fixture. Reuse `runDataForSeoOperation`, `readCache`/`writeCache` (168h TTL), `logCreditUsage`. Build the parser test-first against `tests/fixtures/dataforseo-serp-advanced.ts`.
- **U2 Storage** — owns new `server/serp-snapshots-store.ts`. Row + `rowToSerpSnapshot` mapper (tri-state, `parseJsonSafeArray` for features), `storeSerpSnapshots` (transaction upsert), `getLatestSerpSnapshots`, `getSerpSnapshotsByQuery`.
- **U7 Public serialization** — owns the new-field allow-list in `server/routes/public-portal.ts` (`rankSource, aiOverviewCited, matchedUrl, serpFeatures`; strip admin-only provenance).

**Diff-review checkpoint** after Wave 1 (grep duplicates, `tsc`, full suite).

---

## Wave 2 — Integration (sequential) — after Wave 1

- **U3 Job + route** — owns `shared/types/background-jobs.ts` (`national_serp_refresh`), new job fn in `server/national-serp.ts`, `server/routes/rank-tracking.ts`. Port `runLocalSeoRefreshJob`. `assertCreditBudget` at route entry + per-keyword. 100-keyword cap. Growth+ tier gate. (needs U1 + U2)
- **U4 Insight** — owns `computeSerpFeatureOpportunities()` in `server/analytics-intelligence.ts` + `classifyDomain` in `server/insight-enrichment.ts`. Reads `serp_snapshots`. Broadcast + `deleteStaleInsightsByType`. Fires only when feature present AND matchedUrl present. (needs U2)

**Diff-review checkpoint** after Wave 2.

---

## Wave 3 — Frontend fan-out (2 parallel) — after U0 (types) + U4 (renderer contract)

- **U5 Insight renderers** — owns `src/hooks/admin/useInsightFeed.ts` (admin case) + `src/components/client/InsightsDigest.tsx` (icon + action). No purple.
- **U6 Drawer UI** — owns `src/components/keyword-command-center/KeywordDetailDrawer.tsx`. Rank-source badge, matched-URL line, `serpBadges` import, AI-Overview citation badge (emerald cited / zinc not-cited; **never purple**). Thread fields via props.

**Diff-review checkpoint** after Wave 3 (incl. `grep "purple-\|violet-\|indigo-"` on the drawer = empty).

---

## Wave 4 — Tests + flag verification — after all code

- **U8** — unit (`tests/unit/national-serp-tracking.test.ts`: parser against both fixtures, FM-2 fetch-error, budget would-block), integration (`tests/integration/national-serp-routes.test.ts`: route + budget OFF/ON + **public** read path), contract augment (`insight-renderer-coverage`), flag lifecycle anchor (`feature-flag-lifecycle.test.ts`).

**Final gate:** `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run verify:feature-flags && npm run verify:coverage-ratchet`. Then `scaled-code-review` (multi-agent), fix Critical/Important, PR → staging, CI green, merge.

---

## Definition of done

- [ ] Flag OFF = byte-identical (no fetch, no new UI, no insight).
- [ ] `serp_snapshots` written only via the gated job; read joins to `rank_snapshots` on `(workspace_id, date, query)`.
- [ ] `serp_feature_opportunity` 7-part lockstep complete (`grep -rn serp_feature_opportunity shared/ server/ src/` hits all expected locations).
- [ ] AI-Overview citation badge visible in drawer (emerald/zinc), public portal serializes the new client-facing fields, admin-only provenance stripped.
- [ ] `assertCreditBudget` wired (observe-only), Growth+ gate on route + UI.
- [ ] Full gate + feature-flags + coverage-ratchet green; scaled-code-review issues fixed.
