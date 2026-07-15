# Outcome Intelligence Engine — Known Stubs & Limitations

> Last updated: 2026-07-02 (Reconcile R8-PR1 / Task B13)
> Branch: claude/zen-bell (PR #106); Reconcile section added on reconcile/b13-attribution-seams
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

## Phase 2 — ROI attribution migration (2026-05-xx)

### `roi_attributions` table and `server/roi-attribution.ts` are deprecated

ROI attribution now lives on `action_outcomes.attributed_value` (Phase 2 Outcome Intelligence Engine).

- **New source of truth:** `action_outcomes.attributed_value` (value in dollars, calculated as `clicks_delta × page CPC`) and `action_outcomes.value_basis` (calculation method, e.g. `clicks_delta_x_cpc`).
- **New read path:** `getROIHighlightsFromOutcomes(workspaceId, limit)` in `server/outcome-tracking.ts` — used by monthly digest and client dashboard.
- **New write path:** `recordAction()` + `recordOutcome()` in `server/outcome-tracking.ts`; value computation in `scoreActionAtCheckpoint()` in `server/outcome-measurement.ts`.
- **Old module:** `server/roi-attribution.ts` and the `roi_attributions` table are in the `deprecated` lifecycle state. All exported functions are marked `@deprecated`. Do NOT delete the table until historical data is reconciled.
- **Scheduled for removal:** est. 2026-Q3, after Phase 2 is validated on staging.

---

## Reconcile R8-PR1 — Attribution at the three seams + `gbp_review_reply` (Task B13, 2026-07-02)

### Attribution seams

An "attribution seam" is a place where the platform performs an external write on a
client's behalf (publishes to Webflow, replies to a Google review, generates a brief)
but historically did NOT call `recordAction()` — so the win, once measured, would be
invisible to outcome learnings and the client-facing wins surface. Three such seams were
wired up in B13. The pattern to copy for any FUTURE seam is `recordSchemaOutcomeAction`
in `server/domains/schema/publish-schema-to-live.ts` (the original worked example) —
every wired seam below follows the same shape:

1. Record the tracked action **at the moment the external write succeeds** — never
   before. A failed external call must record NOTHING (FM-2 — see the diagnostic
   checklist below and `docs/testing-plan.md`).
2. Set `attribution: 'platform_executed'`.
3. Pass a `source` snapshot (`{ label, snapshot: { title, type, page? } }`, the R6/B11
   pattern) when the write site holds a real title in scope — never fabricate one (an
   honest generic per-`ActionType` fallback label is always available downstream via
   `WIN_FALLBACK_LABELS` / `ACTION_LABELS`, so there is no need to invent a title).
4. Guard the whole recording block in `try/catch` — a tracking failure must never abort
   the external write's success path. Log a warning and move on.
5. Dedup via `getActionByWorkspaceAndSource(workspaceId, sourceType, sourceId)` so a
   retried/duplicate call never double-records.

| Seam | File | External write | ActionType | sourceType |
|---|---|---|---|---|
| Playbook brief creation | `server/playbooks.ts` (`recordPlaybookBriefOutcomeAction`) | `generateBrief()` succeeding inside `executeContentDecayPlaybook` | `brief_created` | `brief` |
| Bulk audit-fix apply | `server/webflow-seo-bulk-accept-fixes-job.ts` (`recordBulkAcceptFixOutcomeAction`) | `updatePageSeo()` succeeding per-fix | `meta_updated` | `audit` |
| GBP review reply publish | `server/google-business-profile-review-response-publish-job.ts` (`recordGbpReviewReplyOutcomeAction`) | `updateGbpReviewReply()` succeeding (confirmed via `completeGbpReviewResponsePublish`) | `gbp_review_reply` | `gbp_review_response` |

Note on the playbook seam: `applyClientActionFeedbackLoop` (called separately, on client
action completion) already stamped attribution for the **client action lifecycle**
(`sourceType: 'client_action'`) before B13. The gap B13 closed was the **brief itself**
never being recorded as its own tracked action (`sourceType: 'brief'`) — the two records
are deliberately separate rows: one for "the client action was completed," one for "a
brief was created," mirroring the two other `brief_created` producers in
`server/content-brief-generation-job.ts`.

### Ships-dark `ActionType` members

An `ActionType` can be minted before its producing seam can actually fire in
production, when the recording logic needs to exist and be test-verified ahead of an
external dependency landing. These members are real, lockstep-complete catalog/scoring
entries — they are simply never produced by live traffic yet.

#### `gbp_review_reply`

Added in Reconcile R8-PR1 (Task B13). Producer:
`server/google-business-profile-review-response-publish-job.ts`
(`runGbpReviewReplyPublishJob` → `recordGbpReviewReplyOutcomeAction`), recorded when
`updateGbpReviewReply` succeeds. **Cannot fire in production yet** — Google API access
for GBP review replies is not yet open for this platform's integration. The recording
logic is fully wired and covered by
`tests/unit/google-business-profile-review-response-publish-job.test.ts` so it is
correct from day one; there is nothing left to do here once Google API access opens
except verify the seam still fires end-to-end in a staging smoke test.

When adding a new ships-dark `ActionType`, follow the same lockstep lift B13 did — see
"Adding an ActionType member" below — and add a subsection here.

### Adding an `ActionType` member (the exhaustive lockstep)

Adding a member to the `ActionType` union in `shared/types/outcome-tracking.ts` breaks
every exhaustive `Record<ActionType, …>` map in the codebase — TypeScript will not
compile until every one of these is updated in the same commit. `npm run typecheck` is
the fastest way to find them all (a missed site is a compile error, not a silent gap):

- `shared/types/outcome-tracking.ts` — the `ActionType` union itself (source of truth)
- `shared/types/action-catalog.ts` — `OUTCOME_CATALOG` (`satisfies Record<ActionType, ActionCatalogEntry>`); verified by `tests/contract/action-catalog.test.ts`'s hand-copied `ACTION_TYPES` fixture list (also update that list)
- `server/outcome-scoring-defaults.ts` — `DEFAULT_SCORING_CONFIG` (`ScoringConfig = Record<ActionType, ScoringConfigEntry>`)
- `server/schemas/outcome-schemas.ts` — `actionTypeEnum` (zod enum gating the generic `POST /api/outcomes/:ws/actions` route)
- `server/routes/outcomes.ts` — `WIN_FALLBACK_LABELS` (`Record<ActionType, string>`, client-visible generic fallback text)
- `src/components/client/OutcomeSummary.tsx` — `ACTION_TYPE_LABELS` (`Record<ActionType, string>`, client-facing scorecard labels)
- `src/components/client/Briefing/WinsSurface.tsx` — `ACTION_LABELS` (`Record<ActionType, string>`, client-facing win-feed labels)
- `tests/unit/outcome-scoring-defaults.test.ts` — `ALL_ACTION_TYPES` pin (drives the `DEFAULT_SCORING_CONFIG` completeness assertions)
- `tests/contract/action-catalog.test.ts` — `ACTION_TYPES` pin (drives the catalog completeness assertions; keep the member-count comment in sync)

### NOT compile-enforced — must be checked manually

These consume `ActionType` values through a loose `Record<string, string>`, a `.includes()`
filter, or a `switch` with a `default` — so TypeScript will NOT flag a missing member.
`npm run typecheck` is silent here; each must be reviewed by hand when adding a member.

- **`server/outcome-tracking.ts` `getROIHighlightsFromOutcomes()` `actionLabel` map — CLIENT-FACING REACH.** Loose `Record<string, string>` with a `?? row.action_type` fallback. It is rendered into the **client monthly digest** (`server/monthly-digest.ts` — the `${r.action}` template), so an omitted member surfaces the raw snake_case type string to a client the moment a scored win of that type exists. **`gbp_review_reply` was added here in B13** (label kept identical to `WIN_FALLBACK_LABELS` / `WinsSurface`: "Replied to a Google Business Profile review"). Any future member with `clientVisible: true` MUST be added here too — a missing entry is a client-visible defect, not just a cosmetic gap.
- **`server/workspace-learnings.ts` `CONTENT_ACTION_TYPES` / `STRATEGY_ACTION_TYPES` / `TECHNICAL_ACTION_TYPES` — selective learnings buckets.** These are `.includes()` filters that partition scored actions into content/strategy/technical learnings breakdowns; they DELIBERATELY do not list every `ActionType`. **`gbp_review_reply` is intentionally OMITTED for now** — it ships dark, so there are no scored GBP outcomes to bucket, and a premature assignment would mis-categorize the breakdown. When GBP un-darks, a FUTURE ticket must consciously decide which learnings bucket (if any) `gbp_review_reply` belongs to — otherwise its live scored outcomes will be invisible in those learnings breakdowns. **Do not add it to a bucket speculatively.**
- `src/components/admin/outcomes/outcomeConstants.ts` `ACTION_TYPE_LABELS` — auto-derives from the catalog via `Object.keys(ACTION_CATALOG.outcome)`, so it needs no manual update.
- `src/components/admin/outcomes/OutcomeActionFeed.tsx` `ACTION_TYPE_OPTIONS` — admin-only filter dropdown (partial list; add for admin UX completeness).
- `server/intelligence/learnings-slice.ts` `ACTION_PHRASES` — loose map, falls back to the raw type string (admin/AI prompt text).
- `server/briefing-templates/we-called-it.ts` `interventionLabel()` switch — has a `default` case, so a missing member degrades to a generic phrase rather than breaking.

`OUTCOME_ACTION_TYPE_BY_SOURCE` in `server/domains/inbox/client-action-feedback-loop.ts`
is `Record<ClientActionSourceType, ActionType>` — keyed by `ClientActionSourceType`, not
`ActionType`, so adding an `ActionType` member does NOT require a new key there (only
adding a new `ClientActionSourceType` would).

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
3. **External wins never detected** → `checkExternalExecution` is wired (shipped 2026-03-29). Check that the workspace has GSC connected and the action has a baseline with `position` or `clicks` data — guard skips detection when baseline is absent.
4. **Playbooks section empty** → Route and detection are wired (shipped 2026-03-29). Check cron logs for `detectAllWorkspacePlaybooks`. Playbooks only generate after sufficient scored actions exist; a fresh workspace with few actions may legitimately have no patterns yet.
5. **Learnings not updating** → Check if `totalScoredActions` > 0. Learnings only compute when there are scored actions. With stub active, all actions score `neutral` but still count as "scored".
6. **Per-workspace scoring thresholds not working** → `scoring_config` column is never read (#5 above).
7. **No data after fresh deploy** → Cron jobs don't run on startup (#6 above). Wait up to 24h or restart after first cron interval.
8. **No `gbp_review_reply` actions ever appear** → Expected. This `ActionType` ships dark (see the Reconcile R8-PR1 section above) — the producing job cannot fire until Google API access opens for GBP review replies. Not a bug.
9. **A seam's win never shows up despite the external write clearly succeeding** → Check the seam is one of the three wired in Reconcile R8-PR1 (playbook briefs, bulk audit-fix apply, GBP review reply). If it's a DIFFERENT external-write seam, it may still be missing `recordAction()` — see the attribution-seam pattern above and grep for `recordSchemaOutcomeAction`-style helpers to confirm.
