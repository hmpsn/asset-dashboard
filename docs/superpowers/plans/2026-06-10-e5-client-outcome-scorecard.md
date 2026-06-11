# E5 — Mount OutcomeSummary + dollar attribution (audit #5)

**Branch:** `claude/core-e5-client-outcome-scorecard` (off `origin/staging` @ 413b3918, A1+A2 merged)
**Lane:** E (gated on A1 ∧ A2 — both verified merged at base)

## Citation re-verification (staging has moved)

| Master-plan citation | Current state | Adaptation |
|---|---|---|
| `routes/outcomes.ts:395` fabricated `'<action_type> action'` | Drifted to **`server/routes/outcomes.ts:418`** (`recommendation: \`${w.actionType.replace(/_/g, ' ')} action\``) inside the `/api/public/outcomes/:workspaceId/wins` handler (:409–428) | Fix at the current location |
| `OutcomeSummary.tsx` (revive/trim) | Exists at `src/components/client/OutcomeSummary.tsx` (277 lines), **zero importers** — confirmed dead/unmounted | Mount + trim |
| `WinsSurface.tsx` | Live only inside `InsightsBriefingPage` (briefing-v2 flag, dark) | Backport mount to legacy `OverviewTab` |
| `OverviewTab.tsx` mount region | Legacy body renders when `client-briefing-v2` flag is OFF; neighbors use `(betaMode ? 'premium' : (ws.tier as Tier)) \|\| 'free'` | Mount after `IntelligenceSummaryCard`, before `PredictionShowcaseCard` |
| `attributed_value` | Lives on `action_outcomes.attributed_value`, surfaced as `ActionOutcome.attributedValue`; **not** carried by `TopWin`/`OutcomeWinEntry` | Extend both types (additive) + populate in `getTopWinsFromActions` |
| WS refresh wiring | Already complete: `OUTCOME_SCORED`/`OUTCOME_EXTERNAL_DETECTED` → `wsInvalidation.ts:283/569` invalidates `client-outcome-summary` + `client-outcome-wins`; `ClientDashboard.tsx:367-371` handles the events | No new wiring needed |

## Found bug (fix in this PR, per CLAUDE.md decision framework)

`clientOutcomesApi.getSummary` is typed `OutcomeScorecard | null`, but the public
summary endpoint omits `strongWinRate` and `pendingMeasurement` — both rendered by
`OutcomeSummary` (`Math.round(undefined * 100)` → NaN%). Fix: serialize the full
scorecard on the public endpoint (nothing sensitive — same aggregate win-rate data).

## Changes

1. **`shared/types/outcome-tracking.ts`** — `TopWin` += `sourceType`, `sourceId`,
   `attributedValue` (JSDoc: realized dollar value); `OutcomeWinEntry` += `attributedValue`.
   `TopWin` is only constructed in `getTopWinsFromActions` (verified by grep), so
   required fields are safe.
2. **`server/outcome-tracking.ts`** — populate the three new fields in
   `getTopWinsFromActions` (from `action.sourceType/sourceId`, `outcome.attributedValue`).
3. **`server/routes/outcomes.ts`** —
   - public summary: return full scorecard (adds `strongWinRate`, `pendingMeasurement`).
   - public wins: resolve the REAL source title per sourceType/sourceId
     (`recommendation` → `loadRecommendations().recommendations[].title`,
     `client_action` → `getClientAction().title`, `post|content_post` → `getPost().title`,
     `brief|content_brief` → `getBrief().suggestedTitle`, `content_request` →
     `getContentRequest().topic`); fall back to an honest generic per-ActionType label
     (exhaustive `Record<ActionType, string>`). Pass through `attributedValue`.
4. **`src/components/client/Briefing/WinsSurface.tsx`** — heading renders the resolved
   `entry.recommendation` (fallback: action-type label); formatted `attributedValue`
   line (blue — data, Four Laws) when present and > 0.
5. **`src/components/admin/outcomes/OutcomeTopWins.tsx`** — formatted attributed value
   per win row.
6. **`src/components/client/OutcomeSummary.tsx`** (trim) — show the EmptyState until
   `totalScored > 0` (a 0% win rate on a fresh workspace is noise, not signal).
7. **`src/components/client/OverviewTab.tsx`** — mount `OutcomeSummary` + `WinsSurface`
   in the legacy body (ErrorBoundary-wrapped, briefing-v2 path untouched).
8. **`src/hooks/client/useClientOutcomes.ts`** — no behavior change needed (verified);
   owned file listed for completeness.

## Tests (TDD)

- `tests/integration/e5-client-outcome-scorecard.test.ts`
  (`createEphemeralTestContext(import.meta.url)`, **public** read paths):
  summary includes `strongWinRate`/`pendingMeasurement`; recommendation-sourced win
  resolves the real rec title; unresolvable source gets the honest generic (and never
  the legacy `"<action_type> action"` fabrication); `attributedValue` passes through;
  null when the outcome has no attributed value.
- `tests/unit/WinsSurface.test.tsx` (existing) — update mock + add: resolved title
  rendered, attributed value formatted, hidden when null.
- `tests/component/OutcomeSummary.test.tsx` (new) — per-tier render with TierGate
  (free teaser / growth scorecard / premium breakdown), empty state when nothing scored.

## Gates

`npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts`,
new/touched test files + `npm run test:component`,
`grep -r "purple-" src/components/client/` clean.
