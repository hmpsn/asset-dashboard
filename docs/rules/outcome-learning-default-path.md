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

## Testing expectations

At minimum, PRs touching this path should prove:

1. builder-backed contexts surface `learningsAvailability`
2. disabled / empty / degraded states do not crash prompt assembly
3. recommendation scoring uses the shared outcome-adjustment seam
4. strong prior wins can boost scores and weak history can down-rank them
5. no rollout behavior changes unless a separate PR explicitly changes the outcome-learning availability contract
