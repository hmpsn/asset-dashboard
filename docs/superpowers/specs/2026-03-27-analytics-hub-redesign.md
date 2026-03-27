# Analytics Hub Redesign

Unify Search Console and Google Analytics into a hub + detail architecture. Surface intelligence insights and annotations prominently. Add annotation markers to timeline charts with click-to-annotate.

## Page Structure & Routing

**Sidebar:** Replace separate "Search Console" and "Google Analytics" items with a single **"Analytics"** item under the ANALYTICS group.

**Route:** `/analytics` → `AnalyticsHub.tsx`

**Sub-navigation** (horizontal TabBar at top, below PageHeader):
- **Overview** — hub with combined metrics, trend chart, insights, annotations
- **Search Performance** — refactored SearchConsole (queries/pages detail)
- **Site Traffic** — refactored GA4 (overview/events detail)

Default tab: Overview.

**Component tree:**
```
AnalyticsHub.tsx               — shell: PageHeader + sub-nav TabBar
  ├─ AnalyticsOverview.tsx     — hub content
  ├─ SearchDetail.tsx          — deep-dive GSC data
  └─ TrafficDetail.tsx         — deep-dive GA4 data
```

## Hub Layout (AnalyticsOverview)

Renders top to bottom:

### 1. Combined Headline Metrics

Single row of 6 StatCards:

| Clicks (GSC) | Impressions (GSC) | Avg Position (GSC) | Users (GA4) | Sessions (GA4) | Bounce Rate (GA4) |

Each card shows value + delta vs previous period. Subtle source badge ("GSC" or "GA4") in the corner. Uses existing `StatCard` component.

### 2. Unified Trend Chart

Single chart, two data sources:
- Left Y-axis: GSC Clicks (blue `#60a5fa`)
- Right Y-axis: GA4 Users (teal `#14b8a6`)
- Shared X-axis (date range)
- `DateRangeSelector` in chart header (7d/28d/90d/6mo/16mo)

**Annotation markers:** Recharts `ReferenceLine` at each annotation date. Vertical dashed line (`strokeDasharray="4 4"`), stroke color matches category:
- `site_change` → blue `#3b82f6`
- `algorithm_update` → amber `#f59e0b`
- `campaign` → purple `#a855f7`
- `other` → zinc `#71717a`

Small colored dot (8px) at the top of each line as hover target. Custom tooltip on hover shows: date (mono font), CategoryBadge, label text. Positioned above the chart.

**Noise reduction:** If >10 annotations visible in the current date range, render dots only (no lines).

**Click-to-annotate:** Clicking the X-axis (not on an existing annotation) opens an absolute-positioned popover anchored to that date:
- Date pre-filled (snapped to nearest data point)
- Label text input
- Category select dropdown
- Save button → `useCreateAnnotation` mutation
- Dismisses on save, click-outside, or Escape

Implemented as controlled state within AnalyticsOverview, not a modal or route.

### 3. Intelligence InsightCards

5-card grid (responsive 2-3 columns). Uses the existing `InsightCards` component from `src/components/client/InsightCards.tsx`:
- Page Health
- Quick Wins
- Content Decay
- Schema Health
- Top Performers

Each card shows count + severity breakdown. Clicking a card switches the sub-nav to the relevant detail tab (e.g., Quick Wins → Search Performance, Content Decay → Search Performance). No deep-link filtering in v1 — just tab switch.

Data source: `useClientInsights(workspaceId)` → `GET /api/public/insights/:workspaceId` (lazy intelligence engine, 6-hour cache).

### 4. Annotations Section

The existing `AnalyticsAnnotations` component, rendered as-is:
- Create form (date, label, category)
- Category filter pills (All / Site Change / Algorithm / Campaign / Other)
- Annotation list with inline edit (pencil) and delete (trash on hover)

Both the chart popover and this section use the same `useCreateAnnotation` hook, sharing the React Query cache key. Creating from either location updates both.

## Detail Pages

### Search Performance (SearchDetail.tsx)

Refactored from `SearchConsole.tsx`. Removed:
- PageHeader (hub provides it)
- StatCards, comparison section, trend chart (moved to hub)
- "Insights" tab (replaced by hub InsightCards)
- Old collapsible `<Annotations />` panel

Starts directly with TabBar: **Queries | Pages**
- Queries: sortable table (query, clicks, impressions, CTR, position)
- Pages: sortable table (page URL, clicks, impressions, CTR, position)

Device/Country/SearchType breakdowns remain as a collapsible section below the active table.

### Site Traffic (TrafficDetail.tsx)

Refactored from `GoogleAnalytics.tsx`. Removed:
- PageHeader, StatCards, comparison section, trend chart
- "Insights" tab

Starts directly with TabBar: **Overview | Events**
- Overview: daily trend (metric selector), top pages, traffic sources, device/country, new vs returning, organic section
- Events: key events grid, top landing pages table

## Data Flow & Hooks

### useAnalyticsOverview (new)

Composition hook — calls existing hooks internally:

```ts
useAnalyticsOverview(workspaceId, siteId, gscPropertyUrl, days)
  ├─ GSC overview (clicks, impressions, CTR, position + deltas)
  ├─ GA4 overview (users, sessions, bounce rate + deltas)
  ├─ GSC trend (daily clicks/impressions)
  ├─ GA4 trend (daily users/sessions)
  └─ Analytics annotations (list for chart markers)
```

No new API endpoints. Internally uses `useAdminSearch` and `useAdminGA4` (destructures only hub-relevant fields). Detail pages continue using those same hooks directly.

### Query key reuse

Hub and detail pages share React Query cache keys (same underlying hooks). Switching sub-nav tabs doesn't re-fetch. Annotation mutations invalidate `queryKeys.admin.analyticsAnnotations(wsId)`, updating chart markers and annotations section simultaneously.

### InsightCards data

Uses existing `useClientInsights(workspaceId)` from `src/hooks/client/useClientQueries.ts`. Calls `GET /api/public/insights/:workspaceId` which triggers the lazy intelligence engine (6-hour cache).

## New Shared Component

### AnnotatedTrendChart

`src/components/charts/AnnotatedTrendChart.tsx`

Recharts AreaChart wrapper that accepts:
- `data` — array of date-keyed data points
- `lines` — config for each data line (key, color, yAxisId)
- `annotations` — array of Annotation objects
- `onDateClick` — callback when X-axis is clicked (for popover)

Renders ReferenceLine + dot per annotation, dual Y-axes, custom tooltip. Reusable if we want annotation markers on detail page charts later.

## Files

### Created
- `src/components/AnalyticsHub.tsx`
- `src/components/AnalyticsOverview.tsx`
- `src/components/SearchDetail.tsx`
- `src/components/TrafficDetail.tsx`
- `src/components/charts/AnnotatedTrendChart.tsx`
- `src/hooks/admin/useAnalyticsOverview.ts`

### Modified
- `src/components/layout/Sidebar.tsx` — replace two entries with single "Analytics"
- `src/App.tsx` — replace two routes with `/analytics` → `AnalyticsHub`

### Deleted
- `src/components/SearchConsole.tsx` — content extracted to `SearchDetail.tsx`
- `src/components/GoogleAnalytics.tsx` — content extracted to `TrafficDetail.tsx`

### Untouched
- All backend routes and APIs — no server changes
- `src/components/AnalyticsAnnotations.tsx` — reused as-is on hub
- `src/components/client/InsightCards.tsx` — imported and rendered, no changes
- Old annotations system (`server/annotations.ts`, `src/components/Annotations.tsx`) — stays for client dashboard, removed from admin only
- All existing hooks (`useAdminSearch`, `useAdminGA4`, `useAnalyticsAnnotations`, `useClientInsights`)

## Migration Risks

Any code that links directly to `/search-console` or `/google-analytics` paths will break. Grep for these references during implementation and redirect to `/analytics` with the appropriate sub-nav tab pre-selected.
