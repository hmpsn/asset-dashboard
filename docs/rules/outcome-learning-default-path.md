# Outcome Learning Default Path

Purpose: make workspace outcome learnings a first-class input to recommendation scoring and content-generation context without forcing a production rollout before the platform is ready.

## Core contract

1. Learnings availability is typed, not implied.
   - `shared/types/intelligence.ts` exposes `LearningsSlice.availability` as `'ready' | 'disabled' | 'no_data' | 'degraded'`.
   - Shared generation builders may also return `'not_requested'` when a caller intentionally omitted the `learnings` slice. That state is builder-local control-plane metadata, not a slice state.
   - Callers must distinguish:
     - `ready`: real learnings exist and may influence scoring/prompts
     - `no_data`: the workspace has not accumulated enough measured outcomes yet
     - `degraded`: the learnings subsystem failed for this run and callers should continue safely
     - `not_requested`: the caller chose not to request learnings, so no fallback note or scoring adjustment should be inferred from that omission

2. Shared builders are the default read path.
   - Content/recommendation consumers should prefer:
     - `buildContentGenerationContext()`
     - `buildRecommendationGenerationContext()`
   - These builders now return `learningsAvailability` alongside `promptContext` so callers can explain why learnings are absent without ad hoc helpers.

3. Outcome-based scoring must flow through the typed seam.
   - Recommendation engines should use:
     - `buildOutcomeAdjustment(...)`
     - `applyOutcomeAdjustmentScore(...)`
   - Do not open-code per-call multipliers from `winRateByActionType` or `winRateByDifficultyRange` inside recommendation modules. That logic belongs in the shared helper so calibration changes happen in one place.

4. Absence of learnings must be explicit in prompts when it matters.
   - When a content/recommendation prompt normally benefits from learnings but the builder returns no learnings block, callers should add a short status note from `buildOutcomeLearningStatusNote(...)`.
   - This keeps the model from over-assuming prior wins while preserving a graceful fallback to general best practices.

## Scope

This path intentionally does **not**:
- change tier gating
- promise that every workspace has learnings
- rebuild the full outcome engine

This path **does**:
- make learnings availability visible to shared builders
- route high-value recommendation scoring through a typed outcome-adjustment seam
- remove ad hoc learnings injection from builder-backed content brief paths
- standardize fallback messaging for disabled / empty / degraded learnings

## Implementation boundaries

- Shared intelligence slice ownership stays in `server/intelligence/learnings-slice.ts`
- Shared scoring/fallback helpers live in `server/outcome-learning-default-path.ts`
- Content-specific caller enrichments still belong to the caller, not the builder
- Recommendation prioritization logic remains in domain owners such as `server/recommendations.ts` and `server/keyword-recommendations.ts`; the shared helper only adjusts score posture

## Cross-workspace platform priors (A6, audit #22)

The `no_data` / `degraded` tiers now have an optional FALLBACK below "general best
practices": anonymized cross-workspace win-rate priors.

- **Store:** `server/platform-learnings-priors.ts` (+ migration `133-platform-learnings-priors.sql`).
  One aggregate row per `actionType` across ALL workspaces, recomputed by the weekly cron in
  `server/outcome-crons.ts`. Anonymized **by construction** — the row holds only
  `(action_type, win_rate, contributing_workspaces, scored_actions, computed_at)`. No workspace
  id, URL, title, or keyword is ever stored. Pattern precedent: `keyword_metrics_cache`.
- **Floors (privacy + honesty):** a prior is published only above BOTH `MIN_COHORT_WORKSPACES`
  (≥3 distinct contributing workspaces — below this a single workspace's data could be
  reverse-identified) and `MIN_PRIOR_SAMPLES` (≥5 scored actions). Below either floor the prior is
  **absent**, never a fabricated baseline (FM-2). Inputs apply the A1 `not_acted_on` exclusion and
  count one conclusive 30/60/90-day outcome per action.
- **The availability switch stays authoritative.** `buildPlatformPriorAdjustment()` and the
  platform-prior prompt note act ONLY when the workspace's own `availability` is `no_data` or
  `degraded`. A `ready` workspace runs `buildOutcomeAdjustment` (own history) and never sees a
  prior; a `disabled` workspace suppresses priors too (admin kill-switch intent extends to them);
  `not_requested` is a no-op. Do NOT re-check feature flags in callers — switch on the availability
  the builders already returned.
- **Honesty labeling is mandatory.** Any surface that renders a platform prior MUST label it as a
  cross-workspace benchmark ("across all clients on the platform"), never as the workspace's own
  result. The helpers (`buildPlatformPriorPromptNote`, the extended `buildOutcomeLearningStatusNote`)
  bake this label in; callers inject the helper output directly. A client must never see platform
  stats presented as their stats.
- **Smaller nudge.** `platformPriorMultiplier` is deliberately weaker than `actionTypeMultiplier`
  and clamped to a tighter band — a cross-workspace benchmark is weaker evidence for this workspace
  than its own measured history.
- **Slice field:** `LearningsSlice.platformPriors` is populated by the assembler only on the
  fallback condition; it is not rendered by the slice formatter (it is in `KNOWN_UNRENDERED_FIELDS`)
  and is surfaced exclusively through the default-path helpers so labeling stays caller-controlled.

## Testing expectations

At minimum, PRs touching this path should prove:

1. builder-backed contexts surface `learningsAvailability`
2. disabled / empty / degraded states do not crash prompt assembly
3. recommendation scoring uses the shared outcome-adjustment seam
4. strong prior wins can boost scores and weak history can down-rank them
5. no rollout behavior changes unless a separate PR explicitly changes the outcome-learning availability contract
6. (A6) platform priors are published only above both floors, contain no workspace-identifying data,
   reach only `no_data`/`degraded` workspaces, are labeled cross-workspace, and leave `ready`
   workspaces unaffected
