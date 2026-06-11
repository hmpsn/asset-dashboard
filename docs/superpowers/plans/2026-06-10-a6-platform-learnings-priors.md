# A6 — Cross-workspace platform_learnings priors (audit #22)

Final PR of the 2026-06-10 core-features remediation run. Single-agent (Opus), single bounded
context (Outcome Intelligence). Base: `origin/staging` after #1192 (A4) + #1193 (G3).

## Goal

Anonymized cross-workspace win-rate priors as the FALLBACK tier when a workspace's own
`LearningsSlice.availability` is `no_data` or `degraded`. Today those workspaces get nothing
(multiplier 1, no prompt note). The platform now has aggregate evidence across all workspaces;
expose it as a clearly-labeled cross-workspace benchmark — never as the workspace's own results.

## Pattern precedents (read, mirror)

- `keyword_metrics_cache` (migration) — shared cross-workspace store, anonymized by construction
  (no workspace ids in the row; the key is the keyword, not a workspace).
- `server/outcome-emv-calibration.ts` + migration 131 + the cron block in `server/outcome-crons.ts`
  (A5) — DERIVED snapshot table, delete+reinsert per run inside one transaction, FM-2 honest
  `inconclusive`/NULL below a floor, weekly cron with a startup-timeout warmup.

## Design decisions

- **Aggregation grain: per `action_type`.** Directly consumable in the `winRateByActionType` shape
  `buildOutcomeAdjustment` already reads. Category grain is NOT cheap (no category column on
  `tracked_actions`; would need a mapping table) — deferred, documented as out of scope.
- **Cohort floor: ≥ 3 distinct contributing workspaces** for a prior to be PUBLISHED. Below that a
  single workspace's data could be reverse-identified — anonymization is the review axis.
- **Sample floor: ≥ 5 scored actions** total (mirrors EMV `MIN_CALIBRATION_PAIRS`) so a prior is
  statistically meaningful, not a coin flip.
- **Anonymization by construction:** the stored row is
  `(action_type, contributing_workspaces, scored_actions, win_count, computed_at)` — there is NO
  workspace_id column, no title, no URL. A prior that fails either floor is simply NOT inserted
  (FM-2: absence, never a fabricated baseline).
- **A1 honesty inputs:** aggregation excludes `attribution = 'not_acted_on'` and only counts
  outcomes at checkpoint 30/60/90 with a conclusive `score` (not `insufficient_data` /
  `inconclusive`) — the exact `computeWorkspaceLearnings` filter, applied cross-workspace. Latest
  qualifying checkpoint per action (MAX dedup) so a 30+60+90 action contributes one win/loss.
- **Fallback seam stays availability-authoritative.** `buildOutcomeAdjustment` still returns
  multiplier 1 / reasons [] for non-`ready`. A NEW pure helper layers the platform prior ON TOP
  only when the workspace's own availability is `no_data`/`degraded`, producing a SMALLER nudge
  (cross-workspace evidence is weaker than own-history) and a reason string explicitly labeled
  "across all clients on the platform". No feature-flag re-check in callers.

## Files owned

1. `server/db/migrations/133-platform-learnings-priors.sql` — NEW table `platform_learnings_priors`
   (no workspace_id; PK = action_type).
2. `server/platform-learnings-priors.ts` — NEW store: row interface, `rowToEntry` mapper,
   `recomputePlatformPriors()` (delete+reinsert in one txn), `getPlatformPriors()`,
   `getPlatformPriorWinRate(actionType)`. Floors exported.
3. `shared/types/intelligence.ts` — additive: `LearningsSlice.platformPriors?` (labeled
   cross-workspace benchmark, optional, populated by the assembler only when own availability is
   no_data/degraded). Plus a typed `PlatformPriorEntry`.
4. `server/intelligence/learnings-slice.ts` — populate `platformPriors` when availability is
   no_data/degraded (read store, never workspace-specific).
5. `server/outcome-learning-default-path.ts` — `buildPlatformPriorAdjustment()` (pure helper) +
   extend `buildOutcomeLearningStatusNote` so no_data/degraded can carry the labeled prior note.
6. `server/outcome-crons.ts` — additive cron registration (coexist with A5's EMV block).
7. `scripts/pr-check.ts` — add `platformPriors` to `KNOWN_UNRENDERED_FIELDS` IF the slice formatter
   does not render it directly (it's surfaced via the default-path status note, not the slice
   formatter section).
8. Tests: `tests/integration/a6-platform-learnings-priors.test.ts`.
9. `FEATURE_AUDIT.md` entry 486.

## Tests (TDD — write first)

- cohort ≥ floor (3 ws, ≥5 actions) → prior published with correct win rate.
- cohort < floor (2 ws) → prior ABSENT (FM-2).
- sample < floor (3 ws but only 4 scored) → absent.
- fallback reaches a no_data workspace through the default-path helper WITH the cross-workspace
  label string; a `ready` workspace is UNAFFECTED (own multiplier path, no platform prior).
- anonymization: stored rows contain no workspace ids/titles/urls (schema + row-shape assertion).
- `not_acted_on` actions excluded from the aggregate inputs.

## Verification

`npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts` + the new test file +
outcome/intelligence test shards.
