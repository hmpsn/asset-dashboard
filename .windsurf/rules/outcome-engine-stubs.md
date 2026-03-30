# Outcome Intelligence Engine — Known Stubs & Limitations

> Last updated: 2026-03-29
> Branch: claude/zen-bell (PR #106)
> Purpose: Document every stub, placeholder, and known limitation so you can diagnose "why isn't this working?" when the feature goes live.

---

## CRITICAL — Feature is non-functional until these are wired

### 1. ~~`fetchCurrentMetrics` is a stub~~ — SHIPPED 2026-03-29
**File:** `server/outcome-measurement.ts`
**Wired:** Calls `getPageTrend(ws.webflowSiteId, ws.gscPropertyUrl, action.pageUrl, 14)` and averages the last 14 days. Falls back gracefully when workspace has no GSC connection or no page URL. Three call sites (approvals, webflow-schema, content-posts) fire-and-forget `captureBaselineFromGsc` after `recordAction`. Baseline-unavailable guard added: if a search-metric action has no GSC baseline data, it scores `inconclusive` rather than computing a misleading delta from 0.
**Roadmap item:** #230 ✓

---

### 2. `checkExternalExecution` is a stub
**File:** `server/external-detection.ts` (the `checkExternalExecution` function)
**What it does now:** Always returns `false` — external detection never confirms any action.
**Effect:** Actions recorded with `attribution: 'not_acted_on'` (content decay, internal links) never flip to `externally_executed`. External win detection is completely disabled.
**What needs to happen:** Implement GSC-based detection — compare current GSC snapshot to `action.baselineSnapshot`. If position/clicks improved by threshold, return `true`.
**Roadmap item:** #231

---

### 3. `detectPlaybookPatterns` is never called from any route or cron
**File:** `server/outcome-playbooks.ts`
**What it does now:** Function exists, computes patterns, writes to `action_playbooks` table — but is never invoked.
**Effect:** Playbooks are never generated. The frontend `queryKeys.admin.outcomePlaybooks` key is wired but there are no API routes to serve it.
**What needs to happen:** (a) Add a cron job call in `outcome-crons.ts`; (b) Add `GET /api/outcomes/:workspaceId/playbooks` route; (c) Add API client function; (d) Add React Query hook.
**Roadmap item:** #232

---

### 4. `insight_acted_on` action type always scores neutral
**File:** `server/outcome-scoring-defaults.ts:12`
**What it does now:** `primary_metric: 'varies'` — `computeDelta` looks up `baseline['varies']` which is always `undefined`, producing a 0% delta.
**Effect:** Every "act on insight" action will score `neutral` regardless of real-world metric changes.
**What needs to happen:** At insight record time, capture which metric was affected (e.g., if it was a title change, track `clicks`; if a position fix, track `position`). Store the relevant metric in `action.context` and use it in scoring config lookup.
**Roadmap item:** #233

---

## MEDIUM — Feature works but with gaps

### 5. `scoring_config` DB column exists but is never read
**File:** `server/db/migrations/041-outcome-tracking.sql:114` | `server/outcome-scoring-defaults.ts:49-53`
**What it does now:** Column added to `workspaces` table for per-workspace scoring thresholds. `resolveScoringConfig` only accepts an explicit parameter — no code reads the column.
**Effect:** Per-workspace scoring customization (e.g., setting a higher win threshold for a competitive client) is completely non-functional.
**What needs to happen:** In `measurePendingOutcomes()`, call `getWorkspace(workspaceId)`, parse `workspace.scoring_config`, and pass it as `scoringConfigOverride`.
**Roadmap item:** #234

### 6. Cron jobs don't run on first startup
**File:** `server/outcome-crons.ts:26-60`
**What it does now:** All four intervals (`measure`, `learnings`, `detection`, `archive`) use `setInterval` with no immediate invocation.
**Effect:** After a fresh deploy or server restart with backfilled data, outcomes won't be scored for up to 24 hours, learnings won't compute for 24h, external detection won't run for 12h.
**What needs to happen:** Either add initial `setTimeout(() => fn(), 5_000)` calls, or document that the admin should manually trigger via `/api/outcomes/admin/trigger` (if that route exists) after deploy.
**Roadmap item:** #235

### 7. Overview endpoint is N+1 SQLite queries
**File:** `server/routes/outcomes.ts:158-206`
**What it does now:** For each workspace, runs multiple full scans: `getWorkspaceCounts`, `getTopWinsForWorkspace` (per-action outcome queries), `computeScorecard` (another scan), 30-day filter scan.
**Effect:** Acceptable at ≤10 workspaces. At 20+ workspaces with 100+ actions each, this becomes a noticeable bottleneck (hundreds of synchronous SQLite queries per request).
**What needs to happen:** Replace with a SQL join that computes aggregates in one pass. Not urgent for launch.
**Roadmap item:** #236

---

## LOW — Known design choices, not bugs

### `totalScored + pendingMeasurement` can exceed `totalTracked`
**File:** `src/components/admin/outcomes/OutcomeScorecard.tsx:103-128`
An action at day 35 has a 30-day outcome (counted in `totalScored`) but `measurement_complete = 0` (counted in `pendingMeasurement`). The three stat cards can sum to more than total — add a tooltip or note if this causes user confusion.

### `not_acted_on` actions are scored while stub is active
Content decay and internal link suggestions are recorded with `attribution: 'not_acted_on'`. The measurement engine scores these against stub metrics, producing `neutral` scores. Once `fetchCurrentMetrics` (#230) is live, these will produce real scores regardless of whether the recommendation was implemented. External detection (#231) is the mechanism to distinguish "acted on externally" from "never done". Until #231 is wired, all `not_acted_on` actions produce noise.

### `EMPTY_BASELINE.captured_at` is server start time
**File:** `server/db/outcome-mappers.ts:87`
The fallback `EMPTY_BASELINE` uses `new Date().toISOString()` at module load. Only affects error paths where baseline JSON is malformed. Negligible practical impact.

---

## Diagnostic checklist — "Why is outcome tracking not working?"

1. **No outcomes being scored** → Verify GSC is connected for the workspace (`gscPropertyUrl` + `webflowSiteId` set). Check cron logs for `outcome-measurement`. Confirm the page URL on tracked actions matches the URL format GSC reports.
2. **Win rate always 0%** → Check if `fetchCurrentMetrics` is returning data (non-empty GSC rows). If workspace has no GSC, all checkpoints will score `inconclusive`.
3. **External wins never detected** → `checkExternalExecution` stub (#2 above). External detection runs but never returns `true`.
4. **Playbooks section empty** → No route exists to serve playbooks (#3 above). Also `detectPlaybookPatterns` is never called.
5. **Learnings not updating** → Check if `totalScoredActions` > 0. Learnings only compute when there are scored actions. With stub active, all actions score `neutral` but still count as "scored".
6. **Per-workspace scoring thresholds not working** → `scoring_config` column is never read (#5 above).
7. **No data after fresh deploy** → Cron jobs don't run on startup (#6 above). Wait up to 24h or restart after first cron interval.
