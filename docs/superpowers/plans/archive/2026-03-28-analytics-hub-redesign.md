# Analytics Hub Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the admin Analytics Hub (Overview, Search, Traffic tabs) with GSC-style metric cards that double as chart toggles, independent Y-axes for different-scale metrics, and single-page layouts that eliminate sub-tab fragmentation.

**Architecture:** Frontend-only changes. No new API endpoints or server code. A new `MetricToggleCard` component replaces the chart's built-in toggle chips. The existing `AnnotatedTrendChart` gains dynamic Y-axis scaling. Each tab becomes a single scrollable page — no more internal sub-tabs hiding content.

**Tech Stack:** React 19, Recharts, TailwindCSS 4, existing React Query hooks (unchanged)

**Spec:** `docs/superpowers/specs/2026-03-28-analytics-hub-redesign.md`

---

## Task Dependencies

```
Task 1 (MetricToggleCard) ──┐
                             ├── Task 3 (Overview Tab)
Task 2 (AnnotatedTrendChart)┘         │
                                      ├── Task 6 (Verify on staging)
Task 4 (Search Tab) ─────────────────┘
Task 5 (Traffic Tab) ────────────────┘
```

- Tasks 1 and 2 are independent of each other (can run in parallel)
- Tasks 3, 4, 5 all depend on Tasks 1 + 2 being committed
- Tasks 3, 4, 5 each own different files (can run in parallel after 1+2)
- Task 6 depends on all prior tasks

## File Structure

### New Files
| File | Responsibility | Owner |
|------|---------------|-------|
| `src/components/ui/MetricToggleCard.tsx` | GSC-style metric card: label, value, delta, color, active/inactive states, click handler | Task 1 |

### Modified Files
| File | Changes | Owner |
|------|---------|-------|
| `src/components/charts/AnnotatedTrendChart.tsx` (303 lines) | Remove built-in toggle chips, add dynamic Y-axis scale assignment, add chart callout bubble support | Task 2 |
| `src/components/AnalyticsOverview.tsx` (217 lines) | Remove Insights/Metrics sub-tabs, add MetricToggleCards, single-page layout | Task 3 |
| `src/components/SearchDetail.tsx` (~300 lines) | Remove sub-tabs, add MetricToggleCards, add compact insight feed, add table row insight badges, move breakdowns to sidebar | Task 4 |
| `src/components/TrafficDetail.tsx` (~550 lines) | Remove sub-tabs, add MetricToggleCards, single-page layout, collapsible Events section | Task 5 |

### Unchanged Files (read-only dependencies)
- All hooks: `useAnalyticsOverview`, `useAdminSearch`, `useAdminGA4`, `useInsightFeed`, `useAnalyticsAnnotations`
- All API endpoints and server code
- `src/components/insights/InsightFeed.tsx` and `InsightFeedItem.tsx`
- `shared/types/insights.ts` (FeedInsight, SummaryCount)
- `src/components/ui/StatCard.tsx`, `SectionCard.tsx`, `DateRangeSelector.tsx`, `TabBar.tsx`

---

## Guardrails

Reference these CLAUDE.md rules during implementation:

1. **Three Laws of Color** — Teal for actions (card click), Blue for data (metric values), no Purple in client views
2. **UI Primitives** — use `SectionCard` for all container cards, never hand-roll card markup
3. **Imports at top of file** — never mid-file
4. **Design system** — check `BRAND_DESIGN_LANGUAGE.md` before writing JSX
5. **Build verify** — `npx tsc --noEmit --skipLibCheck && npx vite build` after every task

---

## Task 1: MetricToggleCard Component

**Model:** `sonnet` — straightforward React component following established patterns

**Files:**
- Create: `src/components/ui/MetricToggleCard.tsx`
- Modify: `src/components/ui/index.ts` (add export)

**Codebase conventions:**
- Follow `StatCard.tsx` pattern for structure (same directory, similar purpose)
- Use Tailwind classes, no inline styles
- Export from barrel `src/components/ui/index.ts`

- [ ] **Step 1: Create MetricToggleCard component**

```tsx
// src/components/ui/MetricToggleCard.tsx
interface MetricToggleCardProps {
  label: string;
  value: string;
  delta: string;
  deltaPositive: boolean;
  color: string;           // hex color, e.g. '#60a5fa'
  active: boolean;
  onClick: () => void;
  invertDelta?: boolean;   // for "lower is better" metrics
}

export function MetricToggleCard({
  label, value, delta, deltaPositive, color, active, onClick, invertDelta,
}: MetricToggleCardProps) {
  const isPositive = invertDelta ? !deltaPositive : deltaPositive;

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg p-2.5 transition-all border-2 cursor-pointer ${
        active
          ? 'border-current bg-current/8'
          : 'border-zinc-800 opacity-50 hover:opacity-70'
      }`}
      style={active ? { borderColor: color, backgroundColor: `${color}10` } : undefined}
    >
      <div className="text-[9px] font-medium uppercase tracking-wider" style={{ color }}>
        {label}
      </div>
      <div className="text-lg font-bold text-zinc-200 leading-tight mt-0.5">
        {value}
      </div>
      <div className={`text-[9px] mt-0.5 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
        {delta}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Add export to barrel**

Add to `src/components/ui/index.ts`:
```ts
export { MetricToggleCard } from './MetricToggleCard';
```

- [ ] **Step 3: Build verify**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```
Expected: clean build, no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/MetricToggleCard.tsx src/components/ui/index.ts
git commit -m "feat: add MetricToggleCard — GSC-style metric card with chart toggle"
```

---

## Task 2: Upgrade AnnotatedTrendChart — Remove Chips, Dynamic Axes

**Model:** `opus` — complex shared component with high reuse surface. Dynamic axis assignment requires careful logic. This component is consumed by all three tabs.

**Files:**
- Modify: `src/components/charts/AnnotatedTrendChart.tsx`

**Known gotchas:**
- The chart currently renders toggle chips at lines 190-217. These must be removed — the parent now provides `MetricToggleCard` components.
- Y-axis assignment is currently static (`yAxisId: 'left' | 'right'` on TrendLine). We need dynamic assignment based on data scale.
- Recharts `YAxis` requires a unique `yAxisId`. When metrics share an axis, they use the same id.
- Keep the `onToggleLine` callback in props — parents still need it for MetricToggleCard click handlers.
- Keep `maxActiveLines` in props — parents still enforce this constraint.
- The annotation rendering (lines 275-287) must stay untouched.

**What to change:**

1. **Remove the toggle chip JSX** (lines 190-217) — the flex row of buttons. Keep the `activeLines` filtering logic (line 186) since the chart still needs to know which lines are active.

2. **Add dynamic Y-axis assignment** — replace the static `l.yAxisId` with a function that groups metrics by scale:
   - Compute `maxValue` for each active line from the `data` prop
   - If two metrics have `max(a) / max(b) < 10`, they share an axis
   - Otherwise they get independent axes (left + right)
   - When 3 lines are active, group the two closest-scale metrics together

3. **Add optional `callouts` prop** for chart callout bubbles (Search tab will use this):
   ```ts
   interface ChartCallout {
     date: string;
     label: string;
     detail: string;
     color: string;   // severity color
   }
   ```
   Render as positioned divs over the chart area, anchored to x-position by date.

4. **Color-code Y-axis labels** to match the metric using that axis.

- [ ] **Step 1: Remove toggle chips from AnnotatedTrendChart**

Remove the chip rendering JSX (the `<div className="flex flex-wrap gap-1.5 mb-3">` block at lines 190-217). Keep the `activeLines` computation at line 186. Keep `onToggleLine` and `maxActiveLines` in the props interface (parents still use them).

- [ ] **Step 2: Add dynamic Y-axis scale assignment**

Add a function above the component:

```tsx
/**
 * Dynamically assign Y-axes based on data scale.
 * Metrics with similar magnitudes share an axis; different magnitudes get independent axes.
 */
function assignAxes(
  activeLines: TrendLine[],
  data: Record<string, unknown>[],
): Map<string, 'left' | 'right'> {
  const assignments = new Map<string, 'left' | 'right'>();
  if (activeLines.length === 0) return assignments;

  // Compute max value for each active line
  const maxValues = new Map<string, number>();
  for (const line of activeLines) {
    let max = 0;
    for (const row of data) {
      const v = Number(row[line.key]) || 0;
      if (v > max) max = v;
    }
    maxValues.set(line.key, max || 1);
  }

  if (activeLines.length === 1) {
    assignments.set(activeLines[0].key, 'left');
    return assignments;
  }

  // Sort by max value descending
  const sorted = [...activeLines].sort(
    (a, b) => (maxValues.get(b.key) ?? 0) - (maxValues.get(a.key) ?? 0),
  );

  // First metric always gets left axis
  assignments.set(sorted[0].key, 'left');

  // Second metric: share left if similar scale, otherwise right
  const ratio = (maxValues.get(sorted[0].key) ?? 1) / (maxValues.get(sorted[1].key) ?? 1);
  assignments.set(sorted[1].key, ratio < 10 ? 'left' : 'right');

  // Third metric (if present): assign to whichever axis it's closer to
  if (sorted.length >= 3) {
    const leftMax = maxValues.get(sorted[0].key) ?? 1;
    const rightMax = assignments.get(sorted[1].key) === 'right'
      ? (maxValues.get(sorted[1].key) ?? 1)
      : 0;
    const thirdMax = maxValues.get(sorted[2].key) ?? 1;

    if (rightMax === 0) {
      // No right axis yet — put third on right if different scale
      const ratioToLeft = leftMax / thirdMax;
      assignments.set(sorted[2].key, ratioToLeft < 10 ? 'left' : 'right');
    } else {
      // Both axes exist — assign to closer one
      const leftRatio = leftMax / thirdMax;
      const rightRatio = rightMax > thirdMax ? rightMax / thirdMax : thirdMax / rightMax;
      assignments.set(sorted[2].key, leftRatio < rightRatio ? 'left' : 'right');
    }
  }

  return assignments;
}
```

Replace the static `l.yAxisId` references in the chart rendering. Where the current code uses `line.yAxisId`, look up `axisAssignments.get(line.key)` instead.

In the component body, compute assignments:
```tsx
const axisAssignments = assignAxes(activeLines, data);
```

- [ ] **Step 3: Color-code Y-axis labels**

Set the `stroke` prop on each `<YAxis>` to match the color of the first active line using that axis:
```tsx
const leftColor = activeLines.find(l => axisAssignments.get(l.key) === 'left')?.color ?? '#71717a';
const rightColor = activeLines.find(l => axisAssignments.get(l.key) === 'right')?.color ?? '#71717a';
```

Apply to `<YAxis stroke={leftColor} ...>` and `<YAxis stroke={rightColor} ...>`.

- [ ] **Step 4: Add callouts prop and rendering**

Add to props interface:
```tsx
interface ChartCallout {
  date: string;
  label: string;
  detail: string;
  color: string;
}

// In AnnotatedTrendChartProps:
callouts?: ChartCallout[];
```

Render callouts as Recharts `ReferenceLine` components with custom labels (similar to annotation rendering at lines 275-287), but with a positioned tooltip-style label showing `label` and `detail` text.

- [ ] **Step 5: Build verify**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add src/components/charts/AnnotatedTrendChart.tsx
git commit -m "feat: AnnotatedTrendChart — remove chips, dynamic Y-axis scaling, callout support"
```

---

## Task 3: Overview Tab — Single Page Layout with MetricToggleCards

**Model:** `sonnet` — pattern-following with the new MetricToggleCard, restructuring existing JSX

**Files:**
- Modify: `src/components/AnalyticsOverview.tsx`

**File ownership:**
- OWNS: `src/components/AnalyticsOverview.tsx`
- READS (must not modify): `MetricToggleCard.tsx`, `AnnotatedTrendChart.tsx`, `InsightFeed.tsx`, all hooks

**Known gotchas:**
- Remove the `subTab` state and the `TabBar` rendering (Insights/Metrics). Everything goes on one page.
- The `useAnalyticsOverview` hook returns `overview.hasGsc` and `overview.hasGa4` — use these to conditionally show card groups.
- The current `ALL_OVERVIEW_LINES` assigns static `yAxisId`. Remove `yAxisId` from the line definitions — the chart now assigns dynamically. Actually, keep `yAxisId` in the `TrendLine` type for backward compatibility but the chart will override it via `assignAxes`.
- `fmtNum` from `src/utils/formatNumbers` should be used for card values.
- Overview has 6 cards: Clicks, Impressions, CTR, Position (Search) + Users, Sessions (Traffic). NOT bounce rate or pageviews.

**Layout (top to bottom):**
1. Search Performance label + 4 MetricToggleCards
2. Site Traffic label + 2 MetricToggleCards
3. Unified chart (AnnotatedTrendChart, no chips — cards above serve as toggles)
4. Priority Insights (InsightFeed with SummaryPills, no domain filter)
5. Annotations section

- [ ] **Step 1: Remove sub-tab state and TabBar**

Delete the `subTab` state, the `TabBar` component usage, and the conditional `{subTab === 'insights' && ...}` / `{subTab === 'metrics' && ...}` wrappers. Keep all the content — just remove the gating.

- [ ] **Step 2: Add MetricToggleCard imports and card config**

```tsx
import { MetricToggleCard } from './ui';
import { fmtNum } from '../utils/formatNumbers';
```

Define card configurations:
```tsx
const SEARCH_CARDS = [
  { key: 'clicks', label: 'Clicks', color: '#60a5fa' },
  { key: 'impressions', label: 'Impressions', color: '#8b5cf6' },
  { key: 'ctr', label: 'Avg CTR', color: '#f59e0b', format: 'pct' },
  { key: 'position', label: 'Avg Position', color: '#ef4444', invertDelta: true },
] as const;

const TRAFFIC_CARDS = [
  { key: 'users', label: 'Users', color: '#14b8a6' },
  { key: 'sessions', label: 'Sessions', color: '#3b82f6' },
] as const;
```

- [ ] **Step 3: Replace stat cards with MetricToggleCard grid**

Replace the 6-column StatCard grid (current lines 137-203) with two labeled rows of MetricToggleCards:

```tsx
{/* Search Performance cards */}
{overview.hasGsc && (
  <div>
    <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1.5 pl-0.5">
      Search Performance
    </div>
    <div className="grid grid-cols-4 gap-2">
      {SEARCH_CARDS.map(card => (
        <MetricToggleCard
          key={card.key}
          label={card.label}
          value={formatCardValue(card.key, overview)}
          delta={formatCardDelta(card.key, overview)}
          deltaPositive={isDeltaPositive(card.key, overview)}
          color={card.color}
          active={activeLines.has(card.key)}
          onClick={() => handleToggleLine(card.key)}
          invertDelta={card.invertDelta}
        />
      ))}
    </div>
  </div>
)}

{/* Site Traffic cards */}
{overview.hasGa4 && (
  <div>
    <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1.5 pl-0.5">
      Site Traffic
    </div>
    <div className="grid grid-cols-4 gap-2">
      {TRAFFIC_CARDS.map(card => (
        <MetricToggleCard
          key={card.key}
          label={card.label}
          value={formatCardValue(card.key, overview)}
          delta={formatCardDelta(card.key, overview)}
          deltaPositive={isDeltaPositive(card.key, overview)}
          color={card.color}
          active={activeLines.has(card.key)}
          onClick={() => handleToggleLine(card.key)}
        />
      ))}
    </div>
  </div>
)}
```

Implement `formatCardValue`, `formatCardDelta`, `isDeltaPositive` helper functions that extract the right values from the `overview` object returned by `useAnalyticsOverview`. These pull from `overview.gscOverview` (clicks, impressions, avgCtr, avgPosition) and `overview.ga4Overview` (totalUsers, totalSessions). Deltas come from `overview.gscComparison` and `overview.ga4Comparison`.

- [ ] **Step 4: Restructure to single-page layout**

Order:
1. MetricToggleCards (from step 3)
2. `<AnnotatedTrendChart>` (always visible, no conditional)
3. `<InsightFeed>` with `showPills` and no domain filter
4. `<AnalyticsAnnotations>`

Remove the `Insights` sub-tab wrapper. Remove the `Metrics` sub-tab content entirely (StatCards are replaced by MetricToggleCards, InsightCards section removed as redundant with InsightFeed).

- [ ] **Step 5: Build verify**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add src/components/AnalyticsOverview.tsx
git commit -m "feat: Overview tab — GSC-style metric cards, single-page layout, no sub-tabs"
```

---

## Task 4: Search Performance Tab — Cards, Always-Visible Chart, Insight Badges

**Model:** `opus` — most complex task. Requires inline insight badge matching (client-side join), chart callout bubbles, sidebar layout restructure, and table row annotation logic. Multiple interacting features.

**Files:**
- Modify: `src/components/SearchDetail.tsx`

**File ownership:**
- OWNS: `src/components/SearchDetail.tsx`
- READS: `MetricToggleCard.tsx`, `AnnotatedTrendChart.tsx`, `InsightFeed.tsx`, `useInsightFeed`, `useAdminSearch`

**Known gotchas:**
- The current `SEARCH_LINES` constant (line 22-27) defines 4 metrics. Keep this — it feeds into `AnnotatedTrendChart`. But remove `yAxisId` reliance for display (chart handles it dynamically now).
- `useAdminSearch` returns `overview` with headline metrics + comparison data.
- InsightFeed needs `domain="search"` filter.
- Badge matching: `useInsightFeed` returns `FeedInsight[]` with `pageUrl` and type info. Build a lookup Map keyed by normalized query or URL.
- The `DataTab` type and `tab` state should be removed (no more sub-tabs). Replace with a simple `tableView: 'queries' | 'pages'` state for the inline toggle.

**Layout (top to bottom):**
1. 4 MetricToggleCards (Clicks, Impressions, CTR, Position)
2. Chart (always visible) with callout bubbles for ranking drops
3. Compact search insights feed (domain='search', limit=5)
4. Two-column: Queries/Pages table (left 2/3) + Breakdowns sidebar (right 1/3)

- [ ] **Step 1: Remove sub-tabs, add MetricToggleCards**

Delete the `DataTab` type, `tab` state, and `TabBar` component. Add `tableView` state (`'queries' | 'pages'`).

Add MetricToggleCard imports and render 4 cards using `overview` data from `useAdminSearch`:
- Clicks: `overview.totalClicks`, delta from comparison
- Impressions: `overview.totalImpressions`, delta from comparison
- CTR: `overview.avgCtr`, delta from comparison
- Position: `overview.avgPosition`, delta from comparison (inverted)

- [ ] **Step 2: Make chart always visible**

Move the `AnnotatedTrendChart` rendering outside of any conditional tab check. It should render directly after the MetricToggleCards.

- [ ] **Step 3: Add chart callout bubbles**

Build callouts from `useInsightFeed` data:
```tsx
const searchFeed = feed.filter(f => f.domain === 'search' || f.domain === 'cross');
const callouts: ChartCallout[] = searchFeed
  .filter(f => f.type === 'ranking_mover' && f.severity === 'critical')
  .slice(0, 2)  // max 2 callouts to avoid clutter
  .map(f => ({
    date: /* extract from trend data — find nearest date to insight */,
    label: f.headline,
    detail: f.title,
    color: '#ef4444',
  }));
```

Pass to chart: `<AnnotatedTrendChart callouts={callouts} ... />`

Note: The callout date matching is approximate — use the last date in the trend data as a fallback since insights don't carry a specific date field. This is a v1 approximation.

- [ ] **Step 4: Add compact search insights feed**

Below the chart, render:
```tsx
<InsightFeed
  feed={feed}
  loading={feedLoading}
  domain="search"
  showFilterChips
  limit={5}
/>
```

This uses the existing `InsightFeed` component with domain filtering.

- [ ] **Step 5: Restructure data table with inline Queries/Pages toggle**

Replace the TabBar-driven table switching with an inline toggle in the table header:

```tsx
<div className="flex items-center gap-4 px-4 py-2.5 border-b border-zinc-800">
  <button
    className={`text-xs font-semibold pb-1 ${tableView === 'queries' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-zinc-500'}`}
    onClick={() => setTableView('queries')}
  >
    Queries
  </button>
  <button
    className={`text-xs font-semibold pb-1 ${tableView === 'pages' ? 'text-teal-400 border-b-2 border-teal-400' : 'text-zinc-500'}`}
    onClick={() => setTableView('pages')}
  >
    Pages
  </button>
</div>
```

Table renders below this toggle, showing either queries or pages.

- [ ] **Step 6: Add inline insight badges to table rows**

Build a badge lookup map from `useInsightFeed`:

```tsx
type InsightBadge = { label: string; color: string; bgColor: string };

function buildBadgeMap(feed: FeedInsight[]): Map<string, InsightBadge> {
  const map = new Map<string, InsightBadge>();
  for (const f of feed) {
    if (f.domain !== 'search' && f.domain !== 'cross') continue;
    const url = f.pageUrl;
    if (!url) continue;

    let badge: InsightBadge | null = null;
    switch (f.type) {
      case 'ctr_opportunity':
        badge = { label: 'LOW CTR', color: 'text-red-400', bgColor: 'bg-red-500/10' };
        break;
      case 'ranking_opportunity':
        badge = { label: 'NEAR P1', color: 'text-amber-400', bgColor: 'bg-amber-500/10' };
        break;
      case 'cannibalization':
        badge = { label: 'CANNIBAL', color: 'text-amber-400', bgColor: 'bg-amber-500/10' };
        break;
      case 'ranking_mover':
        badge = f.severity === 'positive'
          ? { label: 'RANK UP', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10' }
          : { label: 'RANK DROP', color: 'text-red-400', bgColor: 'bg-red-500/10' };
        break;
      case 'content_decay':
        badge = { label: 'DECAY', color: 'text-red-400', bgColor: 'bg-red-500/10' };
        break;
    }
    if (badge && !map.has(url)) map.set(url, badge);
  }
  return map;
}
```

In the table row rendering, look up each query/page in the badge map. Render the badge as:
```tsx
{badge && (
  <span className={`text-[7px] font-semibold px-1 py-0.5 rounded ${badge.color} ${badge.bgColor} ml-1 whitespace-nowrap`}>
    {badge.label}
  </span>
)}
```

Apply a severity tint to the table row: `className={badge ? 'bg-red-500/[0.02]' : ''}` (adjust color per badge type).

- [ ] **Step 7: Move breakdowns to sidebar**

Restructure the layout to a 2-column grid:
```tsx
<div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3">
  {/* Left: Data table */}
  <SectionCard noPadding>
    {/* inline toggle + table from steps 5-6 */}
  </SectionCard>

  {/* Right: Breakdowns sidebar */}
  <div className="space-y-3">
    {devices.length > 0 && (
      <SectionCard title="Devices">
        {/* existing device breakdown, compacted */}
      </SectionCard>
    )}
    {countries.length > 0 && (
      <SectionCard title="Top Countries">
        {/* existing country breakdown, compacted */}
      </SectionCard>
    )}
    {searchTypes.length > 0 && (
      <SectionCard title="Search Types">
        {/* existing search type breakdown, compacted */}
      </SectionCard>
    )}
  </div>
</div>
```

- [ ] **Step 8: Build verify**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 9: Commit**

```bash
git add src/components/SearchDetail.tsx
git commit -m "feat: Search tab — GSC-style cards, always-visible chart, insight badges, sidebar breakdowns"
```

---

## Task 5: Site Traffic Tab — Single Page Layout

**Model:** `sonnet` — pattern-following from Task 3 (Overview restructure). The structure changes are similar but with more sections to reflow. No new interaction patterns.

**Files:**
- Modify: `src/components/TrafficDetail.tsx`

**File ownership:**
- OWNS: `src/components/TrafficDetail.tsx`
- READS: `MetricToggleCard.tsx`, `AnnotatedTrendChart.tsx`, `InsightFeed.tsx`, all GA4 hooks

**Known gotchas:**
- This file is ~550 lines. The sub-tab structure (Insights/Breakdown/Events) gates large sections. Removing the gates means all content renders on one page — watch for performance with many sections.
- The Breakdown tab duplicates the trend chart from the Insights tab. Remove the duplicate.
- Events section should be collapsible (collapsed by default). Use a simple `eventsExpanded` state.
- Sources should render above Devices in the sidebar (per user preference).
- Keep the "Next Steps" suggestions section.
- Keep the "New vs Returning" section (currently on Breakdown tab).
- Keep the "Organic Search" overview (currently on Breakdown tab).
- `useAdminGA4` returns all the data we need: overview, topPages, sources, devices, countries, comparison, newVsReturning, organic, landingPages, conversions.

**Layout (top to bottom):**
1. 4 MetricToggleCards (Users, Sessions, Bounce Rate, Avg Duration)
2. Traffic trend chart (always visible)
3. Compact traffic insights feed (domain='traffic')
4. Growth Signals + Engagement Analysis (side by side)
5. Organic vs All Traffic
6. New vs Returning Users
7. Next Steps suggestions
8. Two-column: Top Pages (left) + Breakdowns sidebar (right, Sources above Devices above Countries)
9. Events & Conversions (collapsible)

- [ ] **Step 1: Remove sub-tab state and TabBar**

Delete `DataTab` type, `tab` state, and `TabBar`. Add `eventsExpanded` state for the collapsible Events section.

- [ ] **Step 2: Add MetricToggleCards**

4 cards:
- Users: `overview.totalUsers`, delta from `comparison.changePercent.users`
- Sessions: `overview.totalSessions`, delta from `comparison.changePercent.sessions`
- Bounce Rate: `overview.bounceRate`, delta from `comparison.change.bounceRate` (inverted)
- Avg Duration: formatted `overview.avgSessionDuration`, delta from `comparison.change.avgSessionDuration`

Use existing `formatDuration()` helper (line 33-38) for duration values.

- [ ] **Step 3: Make chart always visible, remove duplicate**

Render `AnnotatedTrendChart` once, directly after the cards. Delete the second chart rendering that was in the Breakdown tab.

- [ ] **Step 4: Add compact traffic insights feed**

```tsx
<InsightFeed
  feed={feed}
  loading={feedLoading}
  domain="traffic"
  showFilterChips
  limit={5}
/>
```

- [ ] **Step 5: Merge Insights + Breakdown tab content into single flow**

Remove the `{tab === 'insights' && ...}` and `{tab === 'breakdown' && ...}` wrappers. Render all sections sequentially:
1. Growth Signals + Engagement (existing 2-column grid)
2. Organic vs All Traffic (existing section)
3. New vs Returning Users (move from Breakdown tab)
4. Next Steps suggestions (existing section)

- [ ] **Step 6: Restructure Top Pages + Breakdowns as two-column**

```tsx
<div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3">
  {/* Left: Top Pages table */}
  <SectionCard title="Top Pages">
    {/* existing topPages rendering */}
  </SectionCard>

  {/* Right: Breakdowns sidebar */}
  <div className="space-y-3">
    {/* Sources FIRST (per user preference) */}
    <SectionCard title="Traffic Sources">
      {/* existing sources rendering, compacted */}
    </SectionCard>
    <SectionCard title="Devices">
      {/* existing devices rendering */}
    </SectionCard>
    <SectionCard title="Top Countries">
      {/* existing countries rendering */}
    </SectionCard>
  </div>
</div>
```

- [ ] **Step 7: Make Events section collapsible**

```tsx
<SectionCard>
  <button
    onClick={() => setEventsExpanded(!eventsExpanded)}
    className="w-full flex items-center justify-between text-sm font-semibold text-zinc-200"
  >
    <span>Events & Conversions</span>
    <span className="text-xs text-zinc-500">
      {conversions.length} tracked event{conversions.length !== 1 ? 's' : ''} {eventsExpanded ? '▴' : '▾'}
    </span>
  </button>
  {eventsExpanded && (
    <div className="mt-4 space-y-4">
      {/* Key Events grid (existing) */}
      {/* Landing Pages table (existing) */}
    </div>
  )}
</SectionCard>
```

- [ ] **Step 8: Build verify**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 9: Commit**

```bash
git add src/components/TrafficDetail.tsx
git commit -m "feat: Traffic tab — GSC-style cards, single-page layout, collapsible events"
```

---

## Task 6: Staging Verification

**Model:** N/A — manual verification + browser tools

**Files:**
- No code changes

- [ ] **Step 1: Push to staging**

```bash
git push origin HEAD:staging --force
```

- [ ] **Step 2: Wait for deploy (~2 minutes)**

```bash
sleep 120 && curl -s -w "\nHTTP: %{http_code}" https://asset-dashboard-staging.onrender.com/api/health | tail -1
```

- [ ] **Step 3: Verify Overview tab**

Open admin dashboard → Analytics Hub → Overview:
- 6 metric cards in 2 labeled rows (Search + Traffic)
- Chart below with Clicks + Impressions active by default
- Click Users card — third line appears with independent Y-axis
- Scroll down: insights feed with summary pills, then annotations
- No sub-tabs visible

- [ ] **Step 4: Verify Search Performance tab**

Switch to Search Performance:
- 4 metric cards, chart always visible
- Click CTR card — line appears on right Y-axis (different scale)
- Compact search insights feed below chart
- Queries table with inline badges (LOW CTR, NEAR P1, etc.)
- Breakdowns in right sidebar
- No sub-tabs visible

- [ ] **Step 5: Verify Site Traffic tab**

Switch to Site Traffic:
- 4 metric cards, chart always visible
- Scroll through: insights, Growth Signals + Engagement, Organic vs Total, New vs Returning, Next Steps
- Top Pages + breakdowns (Sources above Devices)
- Events collapsed, expands on click
- No sub-tabs visible

- [ ] **Step 6: Check console for errors**

No React errors, no network failures, no TypeScript runtime errors.

- [ ] **Step 7: Update docs**

Update `FEATURE_AUDIT.md` with Analytics Hub redesign entry. Update `BRAND_DESIGN_LANGUAGE.md` with MetricToggleCard component entry. Update `data/roadmap.json` if applicable.

- [ ] **Step 8: Commit docs**

```bash
git add FEATURE_AUDIT.md BRAND_DESIGN_LANGUAGE.md data/roadmap.json
git commit -m "docs: Analytics Hub redesign — feature audit, design language, roadmap"
```

---

## Model Selection Summary

| Task | Model | Rationale |
|------|-------|-----------|
| Task 1: MetricToggleCard | `sonnet` | Straightforward component, follows StatCard pattern |
| Task 2: AnnotatedTrendChart | `opus` | Complex shared component, dynamic axis logic, high reuse surface |
| Task 3: Overview Tab | `sonnet` | Pattern-following restructure using new components |
| Task 4: Search Tab | `opus` | Most complex task — insight badge matching, callout bubbles, sidebar restructure |
| Task 5: Traffic Tab | `sonnet` | Pattern-following from Task 3, more sections but same approach |
| Task 6: Staging Verify | N/A | Manual verification with browser tools |
| Code review (after each task) | `opus` | Never downgrade reviewers |
