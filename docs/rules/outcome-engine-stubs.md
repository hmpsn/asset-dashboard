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

### 2. ~~`checkExternalExecution` is a stub~~ — SHIPPED 2026-03-29
**File:** `server/external-detection.ts`
**Wired:** Calls `fetchGscSnapshot(workspaceId, pageUrl, 14)` and returns `true` when position improved ≥3 places OR clicks improved ≥20% (with ≥5 absolute clicks). Guard: only runs when action has a real GSC baseline (`position` or `clicks` captured). Falls back to `false` for unconnected workspaces.
**Roadmap item:** #231 ✓

---

### 3. ~~`detectPlaybookPatterns` is never called~~ — SHIPPED 2026-03-29
**Files:** `server/outcome-playbooks.ts`, `server/routes/outcomes.ts`, `src/api/outcomes.ts`, `src/hooks/admin/useOutcomes.ts`, `src/components/admin/outcomes/OutcomePlaybooks.tsx`
**Wired:** `detectAllWorkspacePlaybooks()` added; called on startup (30s delay) and weekly. `GET /api/outcomes/:workspaceId/playbooks` route serves results. `useOutcomePlaybooks` hook + `OutcomePlaybooks` component wired into Outcomes dashboard as a new "Playbooks" tab.
**Roadmap item:** #232 ✓

---

### 4. ~~`insight_acted_on` primary metric~~ — Already `clicks`, resolved
**File:** `server/outcome-scoring-defaults.ts`
**Status:** `primary_metric` is `clicks`, not `varies`. The stubs doc described a prior state. `insights.ts` already captures baseline clicks/position/impressions/ctr from the insight data at action time. Scoring is functional.
**Roadmap item:** #233 ✓ (no further work needed)

---

## MEDIUM — Feature works but with gaps

### 5. ~~`scoring_config` never read~~ — SHIPPED 2026-03-29
**File:** `server/workspaces.ts`, `server/outcome-measurement.ts`
**Wired:** `scoring_config` added to `WorkspaceRow` + `rowToWorkspace` mapper. `Workspace.scoringConfig` field added. `measurePendingOutcomes` now caches per-workspace config, reads `ws.scoringConfig` as `Partial<ScoringConfig>` override (explicit param still wins for tests).
**Roadmap item:** #234 ✓

### 6. ~~Cron jobs don't run on first startup~~ — SHIPPED 2026-03-29
**File:** `server/outcome-crons.ts`
**Wired:** All cron functions extracted as named `runX()` functions. Each fires once at startup with staggered `setTimeout` delays (15-30s to let migrations complete). Playbooks added as a new weekly cron.
**Roadmap item:** #235 ✓

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
