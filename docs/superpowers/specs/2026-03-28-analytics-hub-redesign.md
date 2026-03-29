# Analytics Hub Redesign — Admin Dashboard UI/UX Overhaul

**Date:** 2026-03-28
**Scope:** Admin Analytics Hub — Overview, Search Performance, Site Traffic tabs
**Goal:** Make data immediately readable, fix chart scaling, eliminate sub-tab fragmentation

---

## Problem Statement

The admin Analytics Hub has three usability issues:

1. **Charts lack context.** Toggle chips above charts show no numbers. Admins see trend shapes but can't get the 10,000-foot view without hovering or switching to a Metrics sub-tab.
2. **Shared Y-axis crushes smaller metrics.** When impressions (300K) and clicks (4K) share the same Y-axis, clicks appear as a flat line at zero. GSC solved this with independent axes per metric.
3. **Sub-tabs fragment the experience.** Each tab (Overview, Search, Traffic) has internal sub-tabs (Insights/Metrics, Insights/Queries/Pages, Insights/Breakdown/Events) that hide the chart when viewing data and hide data when viewing insights.

## Design Principle

**Google Search Console pattern:** Metric cards ARE the chart legend. Each card shows the headline number + trend delta. Click a card to toggle that metric's line on/off in the chart. Active cards have a colored border; inactive cards dim but still show numbers. Each active metric gets its own Y-axis scale so all lines are readable regardless of magnitude differences.

---

## Overview Tab

**Layout (top to bottom, single scrollable page — no sub-tabs):**

### 1. GSC-Style Metric Cards + Unified Chart

Two grouped card rows feeding one chart:

**Search Performance row (4 cards):**
- Clicks — `#60a5fa` (blue)
- Impressions — `#8b5cf6` (purple)
- Avg CTR — `#f59e0b` (amber)
- Avg Position — `#ef4444` (red), inverted delta (lower = better)

**Site Traffic row (2 cards):**
- Users — `#14b8a6` (teal)
- Sessions — `#3b82f6` (blue)

**Card anatomy:**
```
┌──────────────────┐
│ CLICKS           │  ← 8px uppercase label in metric color
│ 4,182            │  ← 18px bold white number
│ +2.2% vs prev    │  ← 8px delta (green if positive, red if negative)
└──────────────────┘
```

**Active state:** colored background tint + solid colored border
**Inactive state:** no background, dim border (`rgba(255,255,255,0.08)`), 50% opacity on the whole card
**Numbers always visible** regardless of active/inactive state (just dimmed)

**Chart behavior:**
- Default active on load: Clicks + Impressions
- Max 3 active lines at once — clicking a 4th deactivates the oldest
- Each active line gets its own Y-axis (left or right) auto-assigned based on scale
- Annotations visible as dashed vertical lines with colored dots
- Click chart to add annotation (existing behavior preserved)
- Chart height: 220px

**Bounce Rate, Pageviews, Avg Duration are NOT on the Overview.** They live on the Site Traffic detail tab where they have context.

### 2. Priority Insights Feed

Compact insight list below the chart. Shows all domains (search + traffic + cross).

- Severity badges: CRITICAL (red), OPPORTUNITY (amber), WIN (green)
- Impact score (blue monospace) on the right
- Summary pill counts above the list: "3 drops · 5 opportunities · 2 wins"
- "Show N more insights" expand button
- Replaces the current InsightFeed component (same data, tighter layout)

### 3. Annotations

Compact row of date-tagged annotation chips below insights. "+ Add" button. Same CRUD as current `AnalyticsAnnotations` component.

### What's removed from Overview

- **Insights/Metrics sub-tabs** — everything on one page
- **InsightCards from Metrics tab** — redundant with the InsightFeed
- **Bounce rate / Avg Duration / New User % stat cards** — moved to Traffic tab

---

## Search Performance Tab

**Layout (top to bottom, single scrollable page — no sub-tabs):**

### 1. GSC-Style Metric Cards (Search Only)

4 cards in one row:
- Clicks — `#60a5fa`
- Impressions — `#8b5cf6`
- Avg CTR — `#f59e0b`
- Avg Position — `#ef4444`

Same card anatomy, toggle behavior, and independent Y-axes as Overview.

### 2. Search Trend Chart (Always Visible)

Same `AnnotatedTrendChart` component, always rendered (not behind a sub-tab). Default active: Clicks + Impressions. Supports annotations.

### 3. Chart Callout Bubbles

When a ranking drop or significant position change is detected (from `ranking_mover` insights), a callout bubble appears on the chart at the relevant date range:
```
┌─────────────────────────┐
│ ⚠ Ranking drop detected │
│ 3 pages lost position   │
│ around Mar 18            │
└─────────────────────────┘
```
Driven by insight data — no additional API calls. Positioned at the date of the detected change.

### 4. Compact Search Insights Feed

Search-domain insights only. 3-5 items max. Same compact single-line format as Overview but filtered to `domain === 'search'`. Shows summary pill counts.

### 5. Two-Column: Data Table + Breakdowns Sidebar

**Left (2/3 width): Queries/Pages table**
- Inline toggle in the table header: `Queries | Pages` (not a separate tab)
- Sortable columns: Query/Page, Clicks, Impressions, CTR, Position
- Position color coding: green (1-10), amber (11-20), red (21+)

**Inline insight badges on table rows:**
Queries or pages that have active insights get inline badges next to the name:

| Badge | Color | Triggered by |
|-------|-------|-------------|
| `LOW CTR` | Red | `ctr_opportunity` insight matching this query/page |
| `NEAR P1` | Amber | `ranking_opportunity` insight (position 11-20) |
| `CANNIBAL` | Amber | `cannibalization` insight matching this query |
| `RANK UP` | Green | `ranking_mover` insight (positive direction) |
| `DECAY` | Red | `content_decay` insight matching this page |

Rows with badges get a subtle severity-colored background tint.

Badge matching: join insight `data.query` or `data.pageUrl` with table row `query` or `page`. Client-side join — no additional API calls.

**Right (1/3 width): Breakdowns sidebar**
Compact panels stacked vertically:
1. Devices — horizontal progress bars with percentage + click count
2. Top Countries — ranked list with click count
3. Search Types — horizontal progress bars

### What's removed from Search

- **Insights/Queries/Pages sub-tabs** — chart always visible, table always visible, inline toggle for Queries/Pages
- **Full-width 3-column breakdown row at top** — demoted to sidebar

### What's new on Search

- Chart callout bubbles
- Inline insight badges on table rows

---

## Site Traffic Tab

**Layout (top to bottom, single scrollable page — no sub-tabs):**

### 1. GSC-Style Metric Cards (Traffic Only)

4 cards in one row:
- Users — `#14b8a6` (teal)
- Sessions — `#3b82f6` (blue)
- Bounce Rate — `#f97316` (orange), inverted delta (lower = better)
- Avg Duration — `#a78bfa` (purple)

Same card anatomy and toggle behavior.

### 2. Traffic Trend Chart (Always Visible)

`AnnotatedTrendChart` with toggleable lines. Default active: Users + Sessions.

### 3. Compact Traffic Insights Feed

Traffic-domain insights only. Same compact format.

### 4. Growth Signals + Engagement Analysis (Side by Side)

Kept from current layout. Two panels in a 2-column grid:
- **Growth Signals:** User growth %, Session growth %, Pageview growth %, Bounce rate change
- **Engagement Analysis:** New user engagement rate, Returning user engagement rate, Top page avg engagement, Organic avg engagement

### 5. Organic vs All Traffic

Kept from current layout. 3-column comparison: Users (organic share bar), Bounce Rate (organic vs all), Engagement (organic vs new users).

### 6. New vs Returning Users

Kept from current Breakdown tab. Side-by-side bars showing new vs returning user split with engagement rates and avg engagement time per segment.

### 7. Next Steps Suggestions

Kept from current layout. Contextual action chips: "Organic share is low — build a Keyword Strategy", "High bounce rate — review landing pages", "No events tracked — set up conversion tracking".

### 8. Two-Column: Top Pages + Breakdowns Sidebar

**Left (2/3 width): Top Pages table**
- Page path, Pageviews, Users, Avg Engagement Time
- Scrollable, max 15 rows

**Right (1/3 width): Breakdowns sidebar**
Compact panels stacked vertically:
1. **Top Sources** — source/medium with session count and percentage (above devices per user preference)
2. **Devices** — horizontal progress bars with percentage
3. **Top Countries** — ranked list

### 9. Events & Conversions (Collapsible)

Collapsed by default, expands on click. Contains:
- Key Events grid (conversion cards with event name, count, users, rate)
- Landing Pages table (landing page, sessions, users, bounce rate, conversions)

### What's removed from Traffic

- **Insights/Breakdown/Events sub-tabs** — everything on one page
- **Traffic Health Summary 4-stat grid** — replaced by the more functional GSC-style metric cards
- **Duplicate trend chart** on Breakdown tab (was identical to Insights tab chart)

### What's kept from Traffic

Every data section that exists today has a home. Organic Search overview, New vs Returning, Landing Pages, all breakdowns — all present.

---

## Shared Component: MetricToggleCard

New reusable component used by all three tabs.

**Props:**
```typescript
interface MetricToggleCardProps {
  label: string;           // "Clicks", "Users"
  value: string;           // "4,182", "46.7K"
  delta: string;           // "+2.2%", "-5.2%"
  deltaPositive: boolean;  // controls green vs red
  color: string;           // hex color for the metric
  active: boolean;         // controls border + background tint
  onClick: () => void;     // toggle this metric's chart line
  invertDelta?: boolean;   // for "lower is better" metrics (position, bounce rate)
}
```

Replaces the current small toggle chips in `AnnotatedTrendChart`. The chart component no longer renders its own toggle UI — the parent page renders `MetricToggleCard` components above it and controls which lines are active.

---

## Chart Y-Axis Strategy

**Problem:** Clicks (4K) and Impressions (300K) on the same axis makes clicks invisible.

**Solution:** Each active metric gets independent scaling.

**Implementation:** The existing `AnnotatedTrendChart` already supports `yAxisId: 'left' | 'right'` per line. We extend this to support dynamic axis assignment:

- When 1 line is active: single left axis
- When 2 lines are active with similar scales (e.g., clicks + users): shared left axis
- When 2 lines are active with different scales (e.g., clicks + impressions): left + right axes
- When 3 lines are active: group similar-scale metrics on one axis, outlier on the other

**Scale similarity heuristic:** Two metrics share an axis if `max(a) / max(b) < 10`. Otherwise they get independent axes.

The axis label color matches the metric color so the admin can visually associate which axis belongs to which line.

---

## Data Flow

No new API endpoints. All data already exists in the current hooks:

| Tab | Hook | Data |
|-----|------|------|
| Overview | `useAnalyticsOverview` | merged GSC+GA4 trend data, headline metrics |
| Overview | `useInsightFeed` | priority insights with summary counts |
| Overview | `useAnalyticsAnnotations` | annotation CRUD |
| Search | `useAdminSearch` | overview, trend, devices, countries, searchTypes |
| Search | `useInsightFeed` (filtered) | search-domain insights for feed + badges |
| Traffic | `useAdminGA4` | all GA4 data (overview, topPages, sources, devices, etc.) |
| Traffic | `useAnalyticsOverview` | traffic trend data for chart |
| Traffic | `useInsightFeed` (filtered) | traffic-domain insights |

**Insight badge matching (Search tab):**
- Load insights via existing `useInsightFeed`
- Build a `Map<string, InsightBadge>` keyed by normalized query or page URL
- For each table row, look up the map to find a matching badge
- This is a client-side join — O(n) map build, O(1) per-row lookup

---

## Files to Modify

### New Components
- `src/components/ui/MetricToggleCard.tsx` — reusable GSC-style metric card

### Modified Components
- `src/components/AnalyticsOverview.tsx` — replace Insights/Metrics sub-tabs with single-page layout, add MetricToggleCards
- `src/components/SearchDetail.tsx` — remove sub-tabs, add MetricToggleCards, add compact insight feed, add table row badges, move breakdowns to sidebar
- `src/components/TrafficDetail.tsx` — remove sub-tabs, add MetricToggleCards, add compact insight feed, restructure to single-page layout, make Events collapsible
- `src/components/charts/AnnotatedTrendChart.tsx` — remove built-in toggle chips (parent now provides MetricToggleCards), add dynamic Y-axis scale assignment, add chart callout bubble support

### Unchanged
- All hooks (`useAnalyticsOverview`, `useAdminSearch`, `useAdminGA4`, `useInsightFeed`, `useAnalyticsAnnotations`)
- All API endpoints
- All server-side code
- `InsightFeed` component (still used, just positioned differently)
- All data types

---

## Verification

1. **Overview:** Open admin workspace → Analytics Hub → Overview. See 6 metric cards in 2 rows, chart below with Clicks + Impressions active by default. Click Users card — third line appears on an independent right axis. Scroll down to see insights feed, then annotations.
2. **Search:** Switch to Search Performance tab. See 4 metric cards, chart always visible. Scroll to see compact search insights, then Queries table with inline badges (LOW CTR, NEAR P1, etc.). Click "Pages" toggle in table header — table switches to pages view. Breakdowns in right sidebar.
3. **Traffic:** Switch to Site Traffic tab. See 4 metric cards, chart always visible. Scroll through insights, Growth Signals + Engagement, Organic vs Total, Top Pages + breakdowns (Sources above Devices), then collapsible Events section.
4. **Chart scaling:** Activate Clicks + Impressions simultaneously. Both lines should be clearly visible with independent Y-axes. Neither should appear flat.
5. **No data loss:** Every data section from the current layout exists in the redesign. Nothing is deleted — only repositioned or upgraded.
