# A5 — predictedEmv snapshots + effort priors + P6 calibration cron (audit #20)

Branch: `claude/core-a5-predicted-emv-snapshots` (off `origin/staging` @ 5d56e590, post-#1185/#1186/#1187).
Lane A serial: A1 (learnings integrity) and A3 (per-keyword strategy actions) are merged; this PR reads their
merged state (`outcome-remediation.ts`, `strategyPageKeywordSourceId` at `outcome-tracking.ts:248`) and regresses neither.

## Citation re-verification (audit line numbers predate merges)

| Audit claim | Verified location (current staging) | Status |
|---|---|---|
| predictedEmv nulled on backfill paths | `server/outcome-backfill.ts:227` — explicit `predictedEmv: null` on the completed-recommendations pass; posts/insights passes omit it (defaults null — correct, they carry no rec opportunity) | confirmed |
| Live completion path snapshots it | `server/routes/recommendations.ts:223` — `rec.opportunity?.predictedEmv ?? null` on PATCH → completed | confirmed (keep) |
| Recs completed WITHOUT a live action | `server/recommendations.ts:464 resolveRecommendationsForChange` marks recs completed in-place with NO `recordAction`; the weekly backfill cron (`outcome-crons.ts:202`) is the designed catch-up — so the backfill null IS the dominant loss path | confirmed |
| Calibration consumer expects pairing | `server/scoring/ov-calibration.ts:32-36` — P4 shipped the snapshot; P6 flips basis to `median(attributedValue / predictedEmv)` per actionType | confirmed |
| Effort prior seam | `server/scoring/opportunity-value.ts:40` `DEFAULT_EFFORT_DAYS` — "P5 derives real time-to-implement from action_outcomes once history accrues" | confirmed |

## Changes (files owned: outcome-backfill.ts, outcome-tracking.ts, new calibration module + migration, outcome-crons.ts registration seam, tests)

1. **`server/outcome-backfill.ts`** — snapshot on the backfill completion path:
   - Extend the rec blob schema with `opportunity: { predictedEmv? }` (`.catch(undefined)` so a malformed
     opportunity never drops the rec item).
   - `backfillCompletedRecommendations` passes `predictedEmv: rec.opportunity?.predictedEmv ?? null`
     (mirrors the live PATCH path exactly).
   - New repair pass `backfillPredictedEmvSnapshots(workspaceId)`: fills `predicted_emv IS NULL` on existing
     `source_type='recommendation'` actions from the rec blob's current `opportunity.predictedEmv` (only when
     `> 0` — filling 0 adds no calibration signal and would destroy the "never captured" NULL). Best-effort:
     the blob value is the rec's CURRENT prediction, which may postdate action time for regenerated sets —
     acceptable estimate, never overwrites a non-NULL snapshot. Idempotent by construction (filled rows stop
     matching). Wired into `runBackfill`.
2. **`server/outcome-tracking.ts`** — `fillPredictedEmvIfNull(actionId, workspaceId, predictedEmv)` write
   path (workspace-scoped UPDATE guarded by `predicted_emv IS NULL`). No change to A3's idempotency key
   (`strategyPageKeywordSourceId`) or E5's `getTopWinsFromActions`.
3. **`server/db/migrations/131-outcome-emv-calibration.sql`** — `outcome_emv_calibration` table, PK
   `(workspace_id, action_type)`: `status` ('conclusive'|'inconclusive'), `pair_count`,
   `median_realization_ratio` (NULL when inconclusive — never fabricated), `effort_sample_count`,
   `median_effort_days` (NULL below sample floor), `computed_at`. Internal-only (no public-portal field list).
4. **`server/outcome-emv-calibration.ts`** (new calibration cron module, lockstep row interface + mapper +
   write path):
   - Realized-vs-predicted pairs: highest conclusive checkpoint per action (same dedup shape as
     `getCalibrationOutcomesByWorkspace`), requiring `predicted_emv > 0`, `attributed_value IS NOT NULL`,
     conclusive score, and `attribution != 'not_acted_on'` (A1: unexecuted suggestions are not realized
     value). `status='conclusive'` + median ratio only at >= 5 pairs (`MIN_CALIBRATION_PAIRS`, mirrors
     ov-calibration's MIN_OUTCOMES); below floor → `'inconclusive'`, ratio NULL (FM-2 honest).
   - Effort priors: per actionType median of `(action.created_at − rec.createdAt)` in days over
     `source_type='recommendation'`, `source_flag='live'`, `attribution='platform_executed'` actions
     (backfilled actions' created_at is backfill-run time — meaningless for effort, excluded). Floor:
     >= 3 samples (`MIN_EFFORT_SAMPLES`); negatives skipped.
   - Per-workspace delete + reinsert in one `db.transaction()` (derived snapshot table — full recompute, no
     user metadata to preserve). Rows written only when there is any signal.
   - Exports `runEmvCalibration()`, `getEmvCalibrationForWorkspace()`, `getEffortPriorDays()` — the P6
     ov-calibration basis flip and the P5 OV effort override consume these (consumer wiring is explicitly
     out of A5 scope: `ov-calibration.ts` / `recommendations.ts` are other lanes' files).
5. **`server/outcome-crons.ts`** — register the calibration job per the existing pattern: weekly interval +
   55s startup timeout, dynamic import, try/catch + log. Stays a server cron (scheduled, not user-triggered)
   → no `BACKGROUND_JOB_TYPES` entry. No broadcast/invalidate: the table has no UI or intelligence-slice
   consumer yet.
6. **Tests** — `tests/integration/a5-predicted-emv-snapshots.test.ts` (`createEphemeralTestContext`):
   live PATCH completion snapshots predictedEmv; backfill pass snapshots from blob (non-null when the rec
   carried one); repair pass fills NULL and never overwrites non-NULL; effortDays median correct and
   backfill-flagged actions excluded; calibration conclusive at >= 5 pairs with correct median, honest
   `inconclusive` below floor / when snapshots are missing; cron-entry idempotency (second run no-op diff).

## Out of scope
- Flipping `computeOvCalibration` to the ratio basis (P6 proper — needs GA4 estimatedRevenue in
  attributed_value per ov-calibration.ts:35).
- Feeding `getEffortPriorDays` into `OpportunityInput.effortDays` (touches recommendations.ts — Lane D/PR-later).
- Cross-workspace priors (A6).

## Gates
`npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts`, new test file, targeted outcome suites
(`npx vitest run tests/integration/a5-* tests/integration/a1-* tests/integration/outcome* server/__tests__/outcome*`).
