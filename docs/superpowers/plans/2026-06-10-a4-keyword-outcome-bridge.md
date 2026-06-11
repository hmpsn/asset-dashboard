# A4 — Keyword-level outcome bridge (audit #15)

> 2026-06-10 core-features remediation run, Lane A. Single PR, single agent (Sonnet-class).
> Branch `claude/core-a4-keyword-outcome-bridge` from `origin/staging` (post #1188 A5, #1189 D2).

## Citations (re-verified on this base)

- **B2 contract (merged, PR #1178):** `applyKeywordCommandCenterAction` is the exported contract
  function (`server/keyword-command-center.ts:3397`). `ADD_TO_STRATEGY` writes the strategy artifact
  via `addKeywordToPageInTxn` inside the action transaction (`:3306`). B2's plan §"Cross-PR contract
  out (to A4)" says A4 goes through this function — no new B2 export needed. The recordAction seam
  therefore lands at this contract point (`applyKeywordCommandCenterActionInternal`, post-txn) as a
  single helper call; no other edits to keyword-command-center.ts.
- **A3 exports (merged):** `STRATEGY_PAGE_KEYWORD_SOURCE_TYPE` (`server/outcome-tracking.ts:240`)
  and `strategyPageKeywordSourceId(pagePath, primaryKeyword)` (`:252`). A3's JSDoc explicitly
  instructs Hub-side recording (A4 track/promote) to reuse this sourceType + key shape so both
  write sites share one dedup space. Idempotency = `getActionByWorkspaceAndSource()` check before
  `recordAction()` (same as `keyword-strategy-persistence.ts:232`).
- **Inherited finding 1 (partial baseline):** `server/outcome-measurement.ts:454-478` —
  `baselineLacksData` only fires when ALL of position/clicks/impressions/ctr are absent. A baseline
  with clicks but no position passes the guard; `computeDelta` (`:221-225`) reads the missing
  baseline position as 0 and fabricates a loss (position 0 → N looks like a decline). Verified.
- **Inherited finding 2 (permanently-inconclusive strategy actions):** strategy-level actions
  (`keyword-strategy-persistence.ts:199-208`) carry baseline `{captured_at}` only, `pageUrl: null`,
  `targetKeyword: null`. Today they score `inconclusive` at each due checkpoint via the
  `isMetricPresent` guard (`outcome-measurement.ts:378`) and exit the queue at the 90-day
  checkpoint (`recordOutcome` marks complete at 90d, `outcome-tracking.ts:480-485`). Bounded ✓.
  Cheap short-circuit exists: when the action has no pageUrl AND no targetKeyword AND the baseline
  lacks every search field, nothing can ever become measurable (baseline repair via
  `captureBaselineFromGsc` requires a pageUrl; current fetch requires pageUrl or targetKeyword).
- **Rank snapshots:** `rank_snapshots` table (migration 003), max 180 days retained
  (`deleteOldSnapshots`, `server/rank-tracking.ts:88-92`). Readers: `getRankHistory(wsId,
  queryFilter?, limit)` → `[{date, positions}]`, `storeRankSnapshot(wsId, date, queries)` (test
  seeding). Public client read path already exists: `GET /api/public/rank-tracking/:id/history`
  (`server/routes/rank-tracking.ts:153`, `requireAuthenticatedClientPortalAuth`, `limit` +
  repeated `query` params).
- **Client surface:** requested keywords = `TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED`
  (written by `POST /api/public/tracked-keywords/:id`, `server/routes/public-content.ts:631`).
  Client strategy tab: `src/components/client/StrategyTab.tsx` (sections in
  `src/components/client/strategy/`). Shared chart primitive: `RankHistoryChart`
  (`src/components/shared/RankTable.tsx`) + `ChartCard` (`src/components/ui/ChartCard.tsx`).
- **Citation drift found:** task prompt said FEATURE_AUDIT next entry is 483; the file's latest
  entry on this base is **481** → this PR adds **482**.

## Scope / tasks

1. **`server/outcome-measurement-keywords.ts` (new, owned)** — the rank-snapshot reader + the Hub
   recording helper:
   - `readKeywordRankSnapshot(workspaceId, keyword)` → `BaselineSnapshot | null` from
     `getRankHistory(wsId, [keyword], …)`; returns `{ position, captured_at }` from the most
     recent snapshot that contains the keyword, `null` when absent or **stale (>14 days)** —
     FM-2: stale/missing rank data is never presented as current.
   - `recordKeywordTrackingAction({ workspaceId, keyword, pagePath? })` — idempotent
     (`getActionByWorkspaceAndSource` on `strategyPageKeywordSourceId(pagePath ?? '', keyword)`),
     `actionType: 'strategy_keyword_added'`, `sourceType: STRATEGY_PAGE_KEYWORD_SOURCE_TYPE`,
     baseline from the reader (else `{captured_at}` + `baselineConfidence: 'estimated'`),
     `attribution: 'platform_executed'`, `sourceFlag: 'live'`. `pageUrl` only when a real
     (non-`/planned/`) path exists, mirroring A3's planned-page rule.
2. **Minimal seam in `server/keyword-command-center.ts`** — after the action transaction in
   `applyKeywordCommandCenterActionInternal`, for `ADD_TO_STRATEGY | TRACK | PROMOTE_EVIDENCE`
   call `recordKeywordTrackingAction(…, pagePath: request.pagePath ?? existing?.pagePath)`.
   Covers single, bulk, route and MCP paths in one place. No other edits.
3. **`server/outcome-measurement.ts` fixes + keyword scoring path:**
   - Extract shared `recordInconclusiveOutcome()` helper (the record+log+broadcast block is
     currently copy-pasted 4×; the new paths would make it 6×).
   - **Keyword path:** actions with `actionType === 'strategy_keyword_added'` AND a
     `targetKeyword` score against `readKeywordRankSnapshot` (keyword-level position), NOT page
     aggregate GSC — the stored baselines (A3's `pm.currentPosition`, A4's snapshot position) are
     keyword-level, so page-aggregate comparison was apples-to-oranges. Missing/stale snapshot →
     `inconclusive` (FM-2 — no GSC page fallback, that would mix measurement bases).
   - **Finding 1 fix:** for SEARCH_METRICS actions, if the baseline lacks the PRIMARY metric →
     `inconclusive`, regardless of other baseline fields (subsumes `baselineLacksData`).
   - **Finding 2 fix:** when a search-metric action has no pageUrl, no targetKeyword, and a
     baseline with no search fields, record `inconclusive` at the first due checkpoint, mark the
     action complete (`markActionComplete`), and skip remaining checkpoints for that action.
4. **Client requested-keyword rank-trend card (180d):**
   - `queryKeys.client.requestedKeywordTrend(wsId)` in `src/lib/queryKeys.ts`.
   - API wrapper in `src/api/seo.ts` for the existing public history endpoint with
     `limit=180` + `query` filters.
   - `src/components/client/strategy/useRequestedKeywordRankTrend.ts` — React Query hook
     (client-* key) + `useWorkspaceEvents` invalidation on `RANK_TRACKING_UPDATED` (feedback-loop
     second half; the server already broadcasts this event on snapshot + lifecycle writes).
   - `src/components/client/strategy/StrategyRequestedKeywordTrendSection.tsx` — renders nothing
     when the client has no requested keywords; `ChartCard` + shared `RankHistoryChart` for the
     series; `EmptyState` when keywords exist but no snapshot data yet. No purple; chart colors
     from `CHART_SERIES_ORDER`. Mounted in `StrategyTab.tsx` after the keywords section inside a
     `TierGate required="growth"` (same gate tier as the surrounding keyword sections).

## Tests (TDD)

- `tests/integration/a4-keyword-outcome-bridge.test.ts` (`createEphemeralTestContext`):
  - Hub TRACK records a tracked action with A3's key shape; re-track is a no-op (no duplicate).
  - ADD_TO_STRATEGY records (and stays idempotent across decline→re-add).
  - Track + seeded `rank_snapshots` + backdated `created_at` → `measurePendingOutcomes` scores a
    real outcome on schedule (position improvement → win).
  - FM-2: no snapshots → `inconclusive`; stale (>14d) snapshot → `inconclusive`.
  - Partial baseline (clicks present, position absent) → `inconclusive`, NOT a loss.
  - Strategy-level `{captured_at}`-only action exits the queue at its first due checkpoint
    (`measurement_complete = 1`, single inconclusive outcome).
  - The card's actual read path: `GET /api/public/rank-tracking/:id/history?limit=180&query=…`
    returns the requested keyword's series (admin HMAC auth per existing public-endpoint tests).
- `tests/component/StrategyRequestedKeywordTrendSection.test.tsx`: renders the 180d series;
  empty state when no snapshots; renders nothing without requested keywords.

## File ownership (exclusive)

`server/outcome-measurement.ts`, `server/outcome-measurement-keywords.ts` (new), the seam lines in
`server/keyword-command-center.ts`, `src/components/client/strategy/StrategyRequestedKeywordTrendSection.tsx`
(new), `src/components/client/strategy/useRequestedKeywordRankTrend.ts` (new), `src/api/seo.ts`
(additive), `src/lib/queryKeys.ts` (additive), `src/components/client/StrategyTab.tsx` (mount only),
tests, FEATURE_AUDIT.md.

## Gates

`npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts`, new test files, plus shards:
`a3-strategy-outcome-visibility`, `b2-client-keyword-loop`, `outcome-pipeline`, `outcomes-*`,
`keyword-hub-actions`, `keyword-command-center-routes`, `a1-outcome-remediation`. Pre-commit hook
runs the full suite. Push only (no PR creation).
