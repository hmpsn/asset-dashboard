# PR 1.3 — Insights / Wins Surface

**Date:** 2026-05-10
**Parent spec:** `docs/superpowers/specs/2026-05-09-client-ia-redesign-design.md` §3.4, §4.4, §5.7
**Feature flag:** `client-wins-surface` (already in `shared/types/feature-flags.ts`, default `false`)
**Phase:** Phase 1, PR 1.3 (after PR 1.1 merged)

---

## Goal

Add a **"What we shipped"** wins ledger to the Insights page (InsightsBriefingPage), sourced
from `tracked_actions + action_outcomes`. Simultaneously hide the legacy "We Called It"
`PredictionShowcaseCard` on the Overview tab behind the same feature flag so both surfaces
are not active at the same time.

---

## What already exists (do NOT rebuild)

| Item | Status |
|------|--------|
| `client-wins-surface` feature flag | ✅ Added in PR 1.1 |
| `GET /api/public/outcomes/:workspaceId/wins` | ✅ Exists in `server/routes/outcomes.ts:372` |
| `clientOutcomesApi.getWins()` | ✅ Exists in `src/api/outcomes.ts` |
| `useClientOutcomeWins()` hook | ✅ Exists in `src/hooks/client/useClientOutcomes.ts` |
| `OutcomeWinEntry` type | ✅ Exists in `shared/types/outcome-tracking.ts:243` |
| `WeCalledIt.tsx` existing component | ✅ Retained — used on OverviewTab, do NOT delete |

---

## What this PR adds

### 1. Add `score` field to `OutcomeWinEntry` (shared type + route)

The wins endpoint currently strips the `score` from `TopWin` when transforming to
`OutcomeWinEntry`. WinsSurface needs it to render the badge.

**`shared/types/outcome-tracking.ts`** — add `score: OutcomeScore` to `OutcomeWinEntry`:
```ts
export interface OutcomeWinEntry {
  actionId: string;
  actionType: ActionType;
  pageUrl: string | null;
  targetKeyword: string | null;
  recommendation: string;
  delta: DeltaSummary;
  score: OutcomeScore;          // ← add this
  detectedAt: string;
}
```

**`server/routes/outcomes.ts`** — add `score: w.score` to the mapping at line ~384:
```ts
const entries: OutcomeWinEntry[] = wins.map(w => ({
  actionId: w.actionId,
  actionType: w.actionType,
  pageUrl: w.pageUrl,
  targetKeyword: w.targetKeyword,
  recommendation: `${w.actionType.replace(/_/g, ' ')} action`,
  delta: w.delta,
  score: w.score,               // ← add this
  detectedAt: w.scoredAt,
}));
```

### 2. Create `src/components/client/Briefing/WinsSurface.tsx`

A compact ledger component placed on the Insights page.

**Props:**
```ts
interface WinsSurfaceProps {
  workspaceId: string;
  effectiveTier: Tier;
}
```

**Action type → human label map** (all 10 values):
```ts
const ACTION_LABELS: Record<ActionType, string> = {
  meta_updated:          'Updated meta description',
  content_published:     'Published new post',
  content_refreshed:     'Refreshed existing content',
  schema_deployed:       'Added structured data',
  internal_link_added:   'Added internal links',
  audit_fix_applied:     'Fixed audit issue',
  brief_created:         'Created content brief',
  strategy_keyword_added:'Added keyword to strategy',
  voice_calibrated:      'Calibrated brand voice',
  insight_acted_on:      'Acted on a recommendation',
};
```

**Win quality badge:**
- `strong_win` → `bg-emerald-500/15 text-accent-success border-emerald-500/30` + label "Strong win"
- `win` → `bg-[var(--surface-3)] text-accent-brand border-[var(--brand-border)]` + label "Win"

**Page label** (same pattern as WeCalledIt):
```ts
const pageLabel = entry.targetKeyword
  ? `"${entry.targetKeyword}"`
  : entry.pageUrl
    ? entry.pageUrl.replace(/^https?:\/\/[^/]+/, '') || '/'
    : null;
```

**Shipped date format:** `"3 days ago"` via `Intl.RelativeTimeFormat`.

**Card per win layout:**
```
[action label]       [Strong win / Win badge]
[page / keyword — if present]
[primary_metric: +delta_absolute (±delta_percent%)]    [X days ago]
```

**Empty state:** `"We're working — wins appear here once your changes start showing measurable impact."`

**Tier gate:** Growth+ required. Free tier sees a teaser:
```ts
"N wins shipped this month — upgrade to see what we built."
```
Where N is the count of wins returned (still fetches; count is harmless).

**"See full history →" link:** render only when the backend returned exactly 10 items (cap indicator). Deferred target — a simple `href="#"` with `title="Coming soon"` is acceptable in Phase 1 per the spec.

**Loading state:** 3 skeleton rows (h-12 each).

**SectionCard wrapper:** title "What we shipped", no icon needed.

### 3. Insert into `InsightsBriefingPage`

**Placement:** Between the paid `<MonthlyDigestContent>` block and `<DataSpread>`.

```tsx
// After MonthlyDigestContent, before DataSpread:
{winsEnabled && <WinsSurface workspaceId={workspaceId} effectiveTier={effectiveTier} />}
```

Where `winsEnabled = useFeatureFlag('client-wins-surface')` (called at the top of the component).

**Which path:** The paid briefing path only (the `else` branch that has MonthlyDigestContent on
line ~253 and DataSpread on line ~255). The free tier path does NOT get WinsSurface.

### 4. Hide `PredictionShowcaseCard` in `OverviewTab.tsx`

```tsx
// current (line 331):
{clientIntel?.weCalledIt !== undefined && <PredictionShowcaseCard predictions={clientIntel.weCalledIt} />}

// replace with:
{!winsEnabled && clientIntel?.weCalledIt !== undefined && <PredictionShowcaseCard predictions={clientIntel.weCalledIt} />}
```

Where `winsEnabled = useFeatureFlag('client-wins-surface')` (OverviewTab already imports this hook).

---

## Files touched

| File | Action |
|------|--------|
| `shared/types/outcome-tracking.ts` | Modify — add `score: OutcomeScore` to `OutcomeWinEntry` |
| `server/routes/outcomes.ts` | Modify — populate `score` in the client wins mapping |
| `src/components/client/Briefing/WinsSurface.tsx` | Create |
| `src/components/client/Briefing/InsightsBriefingPage.tsx` | Modify — insert WinsSurface |
| `src/components/client/OverviewTab.tsx` | Modify — gate PredictionShowcaseCard |
| `tests/unit/WinsSurface.test.tsx` | Create |

---

## Test coverage

`tests/unit/WinsSurface.test.tsx` tests:
1. Renders "What we shipped" heading
2. Renders action labels correctly (meta_updated → "Updated meta description")
3. Renders Strong win badge for `strong_win` score
4. Renders Win badge for `win` score
5. Shows empty state when wins is []
6. Shows N skeletons when loading
7. Shows "See full history" link when wins.length === 10

---

## What does NOT change

- `WeCalledIt.tsx` — untouched. It stays gated behind `outcome-client-reporting` feature flag
  (separate flag). When `client-wins-surface` is OFF, PredictionShowcaseCard still shows on
  Overview via the existing `outcome-client-reporting` gate; WeCalledIt is unaffected.
- `useClientOutcomeWins` hook — used by both WinsSurface and WeCalledIt. No changes.
- Backend wins endpoint URL — stays at `/api/public/outcomes/:workspaceId/wins`.
- `InsightsBriefingPage` free-tier path — no WinsSurface on free.
