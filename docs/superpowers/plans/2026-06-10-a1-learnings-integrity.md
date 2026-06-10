# A1 — Fix learnings corruption (audit #1)

> Lane A · THE CRITICAL PATH · gates A4 (#15), A6 (#22), E5 (#5) and the run-wide
> learnings-consumer freeze. Branch: `claude/core-a1-learnings-integrity`.

## Problem

Every AI prompt and recommendation-score multiplier downstream is calibrated on
**noise** today. Five distinct corruptions feed fabricated wins/losses into
`workspace_learnings` and the outcome-adjustment seam:

1. **Backfill mislabeling** — `backfillCompletedRecommendations` hardcodes
   `actionType: 'audit_fix_applied'` for *every* completed recommendation
   (`server/outcome-backfill.ts:197`). A completed `content` rec, a `metadata`
   rec, a `schema` rec — all get filed under `audit_fix_applied`, so
   `winRateByActionType` and `winRateByFixType` are calibrated on the wrong
   action types.
2. **`not_acted_on` pollution** — actions with `attribution: 'not_acted_on'`
   (suggestions the workspace never executed) flow into the learnings
   aggregation and are scored as if they were executed.
3. **Phantom-metric scoring** — scoring configs name primary metrics that do
   not exist in a GSC `BaselineSnapshot` (`content_refreshed → click_recovery`,
   `internal_link_added → target_improvement`, `brief_created →
   content_produced`). `computeDelta` reads the missing key as `0`, the delta is
   `0`, and the action scores `neutral` (or `loss` if noise tips it) — a
   fabricated verdict for a metric that was never measured.
4. **Difficulty-multiplier unit mismatch** — `computeStrategyLearnings` bins by
   GSC **position** (`workspace-learnings.ts:216-226`: `pos >= 51 → '0-20'`)
   while `buildOutcomeAdjustment` matches the same bin labels against provider
   **keyword difficulty** (`outcome-learning-default-path.ts:65-79`:
   `difficulty <= 20 → '0-20'`). A KD-15 (easy) keyword is matched against a bin
   that actually holds position-≥51 (hard-to-rank) keywords. The multiplier is
   applied to the wrong cohort.
5. **`disabled` availability unreachable** — `LearningsSlice.availability`
   includes `'disabled'` (`shared/types/intelligence.ts:239`) but nothing ever
   sets it, so learnings cannot be administratively turned off.

## Contracts (Rule 1 — exported for downstream A4/A5/A6/E5)

### Metric-presence guard (new export, `server/outcome-measurement.ts`)

```ts
/**
 * Generic phantom-metric guard. A scoring config may name a primary_metric that
 * was never captured in the GSC/analytics snapshot (e.g. click_recovery,
 * target_improvement, content_produced). When the metric key is absent (undefined
 * OR null) from BOTH the baseline and the current snapshot, the delta is
 * unmeasurable and the action MUST score `inconclusive` — never neutral/loss.
 *
 * Generic over any actionType and any metric: the guard inspects the snapshots,
 * not a per-type allow-list.
 *
 * @returns true when the metric IS present in at least one snapshot (scoring may
 *          proceed); false when it is phantom (caller must record `inconclusive`).
 */
export function isMetricPresent(
  primaryMetric: string,
  baseline: BaselineSnapshot,
  current: BaselineSnapshot,
): boolean
```

Downstream consumers (A4 keyword bridge, A6 cross-workspace priors, E5 display)
rely on the invariant: **no `neutral`/`loss` outcome exists for a phantom metric.**

### `not_acted_on` exclusion (behavioral contract)

`computeWorkspaceLearnings` excludes every action whose
`attribution === 'not_acted_on'` from the scored set BEFORE any aggregation.
`not_acted_on` actions never contribute to win rates, trends, or playbooks.

### Difficulty multiplier disabled (seam contract)

`buildOutcomeAdjustment` returns multiplier `1.0` for the difficulty dimension
until the position-bin vs KD-bin unit mismatch is resolved. A clearly-marked
`DIFFICULTY_MULTIPLIER_ENABLED = false` seam + comment documents the unit
mismatch. The action-type multiplier is unaffected.

### `disabled` availability read path (new export, `server/workspace-learnings.ts`)

```ts
/**
 * Administrative kill-switch for outcome learnings. Disabled workspaces report
 * `availability: 'disabled'` through the learnings slice so consumers degrade to
 * general best practices (per the LearningsSlice.availability contract).
 *
 * Backed by the OUTCOME_LEARNINGS_DISABLED_WORKSPACES env allow-list (CSV of
 * workspace ids) PLUS a process-local override registry (setLearningsDisabled)
 * for tests and future admin routes. Migration-free; a future PR can swap the
 * backing store to a DB column without changing this signature.
 */
export function isLearningsDisabled(workspaceId: string): boolean
export function setLearningsDisabled(workspaceId: string, disabled: boolean): void
```

`assembleLearnings` (`server/intelligence/learnings-slice.ts`) consults
`isLearningsDisabled` first and short-circuits to `availability: 'disabled'`
before computing/loading any summary. This is the single out-of-OWNS edit
(the file is unassigned to any lane); flagged in the PR body.

## Test assertions (TDD — red first)

### Unit

- `outcome-backfill`: a completed `content` rec → `content_published` (≠
  `audit_fix_applied`); `metadata` → `meta_updated`; `schema` → `schema_deployed`;
  `technical` → `audit_fix_applied` (correct family); a rec missing `type`
  defaults safely without throwing.
- `workspace-learnings`: a scored `not_acted_on` action is excluded from
  `computeWorkspaceLearnings` / win-rate aggregation; a `platform_executed`
  action with the same outcome IS included.
- `outcome-measurement`: `isMetricPresent('click_recovery', …)` is `false` when
  absent from both snapshots, `true` when present in either; a phantom-metric
  action scores `inconclusive` (not `neutral`/`loss`).
- `outcome-learning-default-path`: `buildOutcomeAdjustment` returns difficulty
  multiplier `1.0` while disabled even when `winRateByDifficultyRange` has a
  matching bin; the action-type multiplier still applies.

### Integration (`createEphemeralTestContext`)

- Learnings summary over seeded mixed fixtures (executed + `not_acted_on` +
  phantom-metric + completed-rec-of-various-types) produces **no fabricated loss
  lines** and the correct per-action-type win rates.
- `availability: 'disabled'` propagates through `buildContentGenerationContext`
  → `learningsAvailability === 'disabled'`.

## Before/after (for PR body)

A workspace whose only "completed" history is N `content` recs + M
`not_acted_on` suggestions currently reports a non-trivial
`audit_fix_applied` win rate and a fabricated overall trend. After A1: those
recs are correctly attributed to `content_published`, the `not_acted_on`
suggestions vanish from the denominator, and phantom-metric actions are
`inconclusive` rather than padding the neutral count.

## File ownership

OWNS: `server/outcome-backfill.ts`, `server/outcome-measurement.ts`,
`server/outcome-scoring-defaults.ts`, `server/workspace-learnings.ts`,
`server/outcome-learning-default-path.ts`, `shared/types/intelligence.ts`
(availability semantics only), unit + integration tests, this plan.
One-line consult edit in `server/intelligence/learnings-slice.ts` (unassigned;
flagged). READS: `server/recommendations.ts` (mapping fn — import only),
`server/intelligence/generation-context-builders.ts`, `server/routes/outcomes.ts`.
