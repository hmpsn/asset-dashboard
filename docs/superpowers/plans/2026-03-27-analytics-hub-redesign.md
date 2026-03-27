# Analytics Hub Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Search Console and Google Analytics into a hub + detail architecture with intelligence insights and annotated charts front-and-center.

**Architecture:** New `AnalyticsHub` shell renders a sub-nav (Overview / Search Performance / Site Traffic). The Overview tab combines headline metrics from both GSC and GA4, a unified trend chart with annotation markers and click-to-annotate, the InsightCards intelligence engine output, and the annotations CRUD section. Detail tabs are extracted from the existing SearchConsole and GoogleAnalytics components with their overview sections removed.

**Tech Stack:** React, Recharts (ReferenceLine for annotations), React Query, TailwindCSS, existing UI primitives (StatCard, TabBar, SectionCard, EmptyState).

---

## File Structure

### Created
- `src/components/AnalyticsHub.tsx` — shell: PageHeader + sub-nav TabBar + conditional rendering
- `src/components/AnalyticsOverview.tsx` — hub: metrics, chart, insights, annotations
- `src/components/SearchDetail.tsx` — GSC deep-dive (queries/pages tables + breakdowns)
- `src/components/TrafficDetail.tsx` — GA4 deep-dive (overview/events tabs)
- `src/components/charts/AnnotatedTrendChart.tsx` — Recharts wrapper with ReferenceLine markers + click popover
- `src/hooks/admin/useAnalyticsOverview.ts` — composition hook combining GSC + GA4 + annotations

### Modified
- `src/components/layout/Sidebar.tsx` — replace two entries with single "Analytics"
- `src/App.tsx` — replace two route cases with single `analytics-hub` case
- `src/routes.ts` — add `'analytics-hub'` to Page type, keep `'search'` and `'analytics'` for backwards compat

### Deleted
- `src/components/SearchConsole.tsx` — replaced by SearchDetail.tsx
- `src/components/GoogleAnalytics.tsx` — replaced by TrafficDetail.tsx

---

## Task 1: AnnotatedTrendChart Component

The shared chart component that renders dual Y-axis trend lines with annotation markers and click-to-annotate. Built first because it has no dependencies on other new components and can be tested in isolation.

**Files:**
- Create: `src/components/charts/AnnotatedTrendChart.tsx`

- [ ] **Step 1: Create the AnnotatedTrendChart component**

```tsx
// src/components/charts/AnnotatedTrendChart.tsx
import { useState, useRef, useCallback } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  ReferenceLine, CartesianGrid,
} from 'recharts';
import { Plus, X } from 'lucide-react';
import type { Annotation } from '../../hooks/admin/useAnalyticsAnnotations';

// ── Category colors (matches AnalyticsAnnotations badges) ──
const ANNOTATION_COLORS: Record<string, string> = {
  site_change: '#3b82f6',
  algorithm_update: '#f59e0b',
  campaign: '#a855f7',
  other: '#71717a',
};

const CATEGORY_LABELS: Record<string, string> = {
  site_change: 'Site Change',
  algorithm_update: 'Algorithm',
  campaign: 'Campaign',
  other: 'Other',
};

// ── Types ──
export interface TrendLine {
  key: string;
  color: string;
  yAxisId: 'left' | 'right';
  label: string;
}

interface AnnotatedTrendChartProps {
  data: Record<string, unknown>[];
  lines: TrendLine[];
  annotations: Annotation[];
  dateKey?: string;
  height?: number;
  onCreateAnnotation?: (date: string, label: string, category: string) => void;
}

// ── Annotation dot (hover target at top of ReferenceLine) ──
function AnnotationDot({ x, annotation }: { x: number; annotation: Annotation }) {
  const [hovered, setHovered] = useState(false);
  const color = ANNOTATION_COLORS[annotation.category] ?? ANNOTATION_COLORS.other;
  const catLabel = CATEGORY_LABELS[annotation.category] ?? annotation.category;

  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <circle cx={x} cy={12} r={5} fill={color} stroke="#18181b" strokeWidth={2} style={{ cursor: 'pointer' }} />
      {hovered && (
        <foreignObject x={x - 100} y={20} width={200} height={80}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 shadow-lg text-center">
            <span className="text-[10px] font-mono text-zinc-500 block">{annotation.date}</span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-md font-medium inline-block mt-0.5"
              style={{ backgroundColor: `${color}33`, color }}
            >
              {catLabel}
            </span>
            <span className="text-[11px] text-zinc-200 block mt-1 truncate">{annotation.label}</span>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

// ── Click-to-annotate popover ──
interface PopoverState {
  date: string;
  x: number;
  y: number;
}

type Category = 'site_change' | 'algorithm_update' | 'campaign' | 'other';

function CreatePopover({
  state,
  onSave,
  onClose,
}: {
  state: PopoverState;
  onSave: (date: string, label: string, category: string) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<Category>('site_change');

  const handleSave = () => {
    if (!label.trim()) return;
    onSave(state.date, label.trim(), category);
    onClose();
  };

  return (
    <div
      className="absolute z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl p-3 w-64"
      style={{ left: Math.min(state.x, window.innerWidth - 280), top: state.y + 10 }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-mono text-zinc-500">{state.date}</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-0.5"><X className="w-3.5 h-3.5" /></button>
      </div>
      <input
        type="text"
        placeholder="e.g. Launched new pages"
        value={label}
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
        autoFocus
        className="w-full px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 mb-2"
      />
      <select
        value={category}
        onChange={e => setCategory(e.target.value as Category)}
        className="w-full px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 mb-2"
      >
        <option value="site_change">Site Change</option>
        <option value="algorithm_update">Algorithm</option>
        <option value="campaign">Campaign</option>
        <option value="other">Other</option>
      </select>
      <button
        onClick={handleSave}
        disabled={!label.trim()}
        className="flex items-center gap-1 w-full justify-center px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors"
      >
        <Plus className="w-3 h-3" /> Add
      </button>
    </div>
  );
}

// ── Main chart ──
export function AnnotatedTrendChart({
  data,
  lines,
  annotations,
  dateKey = 'date',
  height = 220,
  onCreateAnnotation,
}: AnnotatedTrendChartProps) {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine whether to show lines or dots-only (>10 visible = dots only)
  const showLines = annotations.length <= 10;

  const handleChartClick = useCallback(
    (chartState: { activeLabel?: string } | null, event?: React.MouseEvent) => {
      if (!onCreateAnnotation || !chartState?.activeLabel || !event) return;
      // Don't open popover if clicking on an existing annotation date
      const clickedDate = chartState.activeLabel;
      if (annotations.some(a => a.date === clickedDate)) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPopover({
        date: clickedDate,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    [onCreateAnnotation, annotations],
  );

  return (
    <div ref={containerRef} className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} onClick={handleChartClick as unknown as (state: unknown) => void}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey={dateKey}
            tick={{ fill: '#71717a', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: '#3f3f46' }}
            tickFormatter={v => {
              const d = new Date(v);
              return `${d.getMonth() + 1}/${d.getDate()}`;
            }}
          />
          {/* Left Y-axis */}
          <YAxis
            yAxisId="left"
            tick={{ fill: '#71717a', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={45}
          />
          {/* Right Y-axis (only if we have a right-axis line) */}
          {lines.some(l => l.yAxisId === 'right') && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: '#71717a', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={45}
            />
          )}
          <Tooltip
            contentStyle={{
              backgroundColor: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: '0.5rem',
              fontSize: '11px',
            }}
            labelStyle={{ color: '#a1a1aa', fontFamily: 'monospace' }}
          />
          {lines.map(line => (
            <Area
              key={line.key}
              type="monotone"
              dataKey={line.key}
              yAxisId={line.yAxisId}
              stroke={line.color}
              fill={`${line.color}15`}
              strokeWidth={2}
              dot={false}
              name={line.label}
            />
          ))}
          {/* Annotation reference lines */}
          {annotations.map(ann => (
            <ReferenceLine
              key={ann.id}
              x={ann.date}
              yAxisId="left"
              stroke={showLines ? (ANNOTATION_COLORS[ann.category] ?? ANNOTATION_COLORS.other) : 'transparent'}
              strokeDasharray="4 4"
              strokeWidth={1}
              label={({ viewBox }) => (
                <AnnotationDot x={(viewBox as { x: number }).x} annotation={ann} />
              )}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>

      {/* Click-to-annotate popover */}
      {popover && onCreateAnnotation && (
        <CreatePopover
          state={popover}
          onSave={onCreateAnnotation}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --skipLibCheck 2>&1 | grep -i 'AnnotatedTrendChart\|error' | head -10`
Expected: No errors referencing AnnotatedTrendChart

- [ ] **Step 3: Commit**

```bash
git add src/components/charts/AnnotatedTrendChart.tsx
git commit -m "feat: add AnnotatedTrendChart with ReferenceLine markers and click-to-annotate popover"
```

---

## Task 2: useAnalyticsOverview Composition Hook

Combines GSC + GA4 headline data + trend data + annotations into a single hook for the hub page.

**Files:**
- Create: `src/hooks/admin/useAnalyticsOverview.ts`

- [ ] **Step 1: Create the composition hook**

```ts
// src/hooks/admin/useAnalyticsOverview.ts
import { useMemo } from 'react';
import { useAdminSearch, type AdminSearchData } from './useAdminSearch';
import { useAdminGA4, type AdminGA4Data } from './useAdminGA4';
import { useAnalyticsAnnotations, useCreateAnnotation } from './useAnalyticsAnnotations';
import type { Annotation } from './useAnalyticsAnnotations';

export interface AnalyticsOverviewData {
  // GSC headline
  gscClicks: number;
  gscImpressions: number;
  gscPosition: number;
  gscClicksDelta: number | null;
  gscImpressionsDelta: number | null;
  gscPositionDelta: number | null;
  // GA4 headline
  ga4Users: number;
  ga4Sessions: number;
  ga4BounceRate: number;
  ga4UsersDelta: number | null;
  ga4SessionsDelta: number | null;
  ga4BounceRateDelta: number | null;
  // Trend data (merged for chart)
  trendData: Array<{
    date: string;
    clicks: number;
    impressions: number;
    users: number;
    sessions: number;
  }>;
  // Annotations
  annotations: Annotation[];
  createAnnotation: ReturnType<typeof useCreateAnnotation>;
  // Loading state
  isLoading: boolean;
  hasGsc: boolean;
  hasGa4: boolean;
}

export function useAnalyticsOverview(
  workspaceId: string,
  siteId: string | undefined,
  gscPropertyUrl: string | undefined,
  ga4PropertyId: string | undefined,
  days: number,
): AnalyticsOverviewData {
  const gsc = useAdminSearch(siteId ?? '', gscPropertyUrl, days);
  const ga4 = useAdminGA4(workspaceId, days, !!ga4PropertyId);
  const { data: annotations = [] } = useAnalyticsAnnotations(workspaceId);
  const createAnnotation = useCreateAnnotation(workspaceId);

  const hasGsc = !!gscPropertyUrl && !!gsc.overview;
  const hasGa4 = !!ga4PropertyId && !!ga4.overview;

  // Merge GSC trend + GA4 trend into unified date-keyed array
  const trendData = useMemo(() => {
    const byDate = new Map<string, { date: string; clicks: number; impressions: number; users: number; sessions: number }>();

    for (const t of gsc.trend) {
      byDate.set(t.date, { date: t.date, clicks: t.clicks, impressions: t.impressions, users: 0, sessions: 0 });
    }
    for (const t of ga4.trend) {
      const existing = byDate.get(t.date);
      if (existing) {
        existing.users = t.users;
        existing.sessions = t.sessions;
      } else {
        byDate.set(t.date, { date: t.date, clicks: 0, impressions: 0, users: t.users, sessions: t.sessions });
      }
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [gsc.trend, ga4.trend]);

  return {
    gscClicks: gsc.overview?.totalClicks ?? 0,
    gscImpressions: gsc.overview?.totalImpressions ?? 0,
    gscPosition: gsc.overview?.avgPosition ?? 0,
    gscClicksDelta: gsc.comparison?.changePercent.clicks ?? null,
    gscImpressionsDelta: gsc.comparison?.changePercent.impressions ?? null,
    gscPositionDelta: gsc.comparison?.changePercent.position ?? null,
    ga4Users: ga4.overview?.totalUsers ?? 0,
    ga4Sessions: ga4.overview?.totalSessions ?? 0,
    ga4BounceRate: ga4.overview?.bounceRate ?? 0,
    ga4UsersDelta: ga4.comparison ? ((ga4.comparison.current.bounceRate - ga4.comparison.previous.bounceRate) / (ga4.comparison.previous.bounceRate || 1)) * 100 : null,
    ga4SessionsDelta: ga4.comparison ? ((ga4.comparison.current.totalSessions - ga4.comparison.previous.totalSessions) / (ga4.comparison.previous.totalSessions || 1)) * 100 : null,
    ga4BounceRateDelta: ga4.comparison ? ((ga4.comparison.current.bounceRate - ga4.comparison.previous.bounceRate) / (ga4.comparison.previous.bounceRate || 1)) * 100 : null,
    trendData,
    annotations,
    createAnnotation,
    isLoading: gsc.isLoading || ga4.isLoading,
    hasGsc,
    hasGa4,
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --skipLibCheck 2>&1 | grep -i 'useAnalyticsOverview\|error' | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/admin/useAnalyticsOverview.ts
git commit -m "feat: add useAnalyticsOverview composition hook merging GSC + GA4 + annotations"
```

---

## Task 3: AnalyticsOverview Hub Page

The main hub content — metrics, annotated chart, InsightCards, annotations section.

**Files:**
- Create: `src/components/AnalyticsOverview.tsx`

- [ ] **Step 1: Create the hub component**

```tsx
// src/components/AnalyticsOverview.tsx
import { useState } from 'react';
import { BarChart3, MousePointer, Eye, ArrowUpDown, Users, Activity, TrendingDown, Loader2 } from 'lucide-react';
import { StatCard, SectionCard, DateRangeSelector, EmptyState } from './ui';
import { DATE_PRESETS_SEARCH } from './ui/constants';
import { AnnotatedTrendChart, type TrendLine } from './charts/AnnotatedTrendChart';
import { AnalyticsAnnotations } from './AnalyticsAnnotations';
import { InsightCards } from './client/InsightCards';
import { useAnalyticsOverview } from '../hooks/admin/useAnalyticsOverview';
import { useClientInsights } from '../hooks/client/useClientQueries';

interface Props {
  workspaceId: string;
  siteId?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
}

const TREND_LINES: TrendLine[] = [
  { key: 'clicks', color: '#60a5fa', yAxisId: 'left', label: 'Clicks (GSC)' },
  { key: 'users', color: '#14b8a6', yAxisId: 'right', label: 'Users (GA4)' },
];

export function AnalyticsOverview({ workspaceId, siteId, gscPropertyUrl, ga4PropertyId }: Props) {
  const [days, setDays] = useState(28);
  const overview = useAnalyticsOverview(workspaceId, siteId, gscPropertyUrl, ga4PropertyId, days);
  const { data: insights = [], isLoading: insightsLoading } = useClientInsights(workspaceId, true);

  if (overview.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
        <span className="ml-2 text-sm text-zinc-500">Loading analytics...</span>
      </div>
    );
  }

  if (!overview.hasGsc && !overview.hasGa4) {
    return <EmptyState icon={BarChart3} title="No analytics connected" description="Connect Google Search Console or Google Analytics in workspace settings to see data here." />;
  }

  const handleCreateAnnotation = (date: string, label: string, category: string) => {
    overview.createAnnotation.mutate({ date, label, category });
  };

  // Format delta for StatCard
  const fmtDelta = (val: number | null) => (val != null ? `${val >= 0 ? '+' : ''}${val.toFixed(1)}%` : undefined);

  return (
    <div className="space-y-6">
      {/* Date range selector */}
      <div className="flex justify-end">
        <DateRangeSelector presets={DATE_PRESETS_SEARCH} value={days} onChange={setDays} />
      </div>

      {/* Headline metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {overview.hasGsc && (
          <>
            <StatCard label="Clicks" value={overview.gscClicks.toLocaleString()} delta={fmtDelta(overview.gscClicksDelta)} icon={MousePointer} color="#60a5fa" badge="GSC" />
            <StatCard label="Impressions" value={overview.gscImpressions.toLocaleString()} delta={fmtDelta(overview.gscImpressionsDelta)} icon={Eye} color="#22d3ee" badge="GSC" />
            <StatCard label="Avg Position" value={overview.gscPosition.toFixed(1)} delta={fmtDelta(overview.gscPositionDelta)} icon={ArrowUpDown} color="#fbbf24" badge="GSC" invertDelta />
          </>
        )}
        {overview.hasGa4 && (
          <>
            <StatCard label="Users" value={overview.ga4Users.toLocaleString()} delta={fmtDelta(overview.ga4SessionsDelta)} icon={Users} color="#14b8a6" badge="GA4" />
            <StatCard label="Sessions" value={overview.ga4Sessions.toLocaleString()} delta={fmtDelta(overview.ga4SessionsDelta)} icon={Activity} color="#3b82f6" badge="GA4" />
            <StatCard label="Bounce Rate" value={`${overview.ga4BounceRate.toFixed(1)}%`} delta={fmtDelta(overview.ga4BounceRateDelta)} icon={TrendingDown} color="#ef4444" badge="GA4" invertDelta />
          </>
        )}
      </div>

      {/* Unified trend chart with annotations */}
      {overview.trendData.length > 0 && (
        <SectionCard title="Performance Trend" titleExtra={<span className="text-[11px] text-zinc-500">{days}d</span>}>
          <AnnotatedTrendChart
            data={overview.trendData}
            lines={TREND_LINES.filter(l =>
              (l.key === 'clicks' && overview.hasGsc) || (l.key === 'users' && overview.hasGa4)
            )}
            annotations={overview.annotations}
            onCreateAnnotation={handleCreateAnnotation}
            height={260}
          />
        </SectionCard>
      )}

      {/* Intelligence InsightCards */}
      <InsightCards
        workspaceId={workspaceId}
        insights={insights}
        tier="growth"
        loading={insightsLoading}
      />

      {/* Annotations CRUD */}
      <AnalyticsAnnotations workspaceId={workspaceId} />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --skipLibCheck 2>&1 | grep -i 'AnalyticsOverview\|error' | head -10`

Note: The `StatCard` `badge` and `invertDelta` props may not exist yet. If TypeScript errors on these, remove them for now — they are nice-to-have enhancements that can be added to the StatCard component later. The core layout will work without them.

- [ ] **Step 3: Commit**

```bash
git add src/components/AnalyticsOverview.tsx
git commit -m "feat: add AnalyticsOverview hub page with metrics, chart, insights, annotations"
```

---

## Task 4: SearchDetail — Extract from SearchConsole

Strip SearchConsole down to just the queries/pages tables + breakdowns.

**Files:**
- Create: `src/components/SearchDetail.tsx`
- Reference: `src/components/SearchConsole.tsx` (will be deleted in Task 7)

- [ ] **Step 1: Create SearchDetail**

Extract the queries/pages tab content and device/country/searchType breakdowns from SearchConsole.tsx. Remove:
- PageHeader (hub provides it)
- StatCards (lines 168-173 in SearchConsole)
- Period comparison section (lines 176-204)
- Trend chart (lines 207-223)
- Insights tab content (lines 315-415)
- Annotations tab and old collapsible panel (lines 528-542)

Keep:
- `useAdminSearch` hook call
- DateRangeSelector (detail page has its own date range)
- TabBar with only: Queries | Pages
- Queries table (sortable, with position color coding)
- Pages table (sortable, with position color coding)
- Device/Country/SearchType breakdowns in a collapsible section below

```tsx
// src/components/SearchDetail.tsx
import { useState } from 'react';
import {
  Loader2, Search, TrendingUp, TrendingDown, Eye, MousePointer,
  ExternalLink, ArrowUpDown,
} from 'lucide-react';
import { SectionCard, TabBar, DateRangeSelector, EmptyState } from './ui';
import { DATE_PRESETS_SEARCH } from './ui/constants';
import type { SearchQuery, SearchPage } from '../../shared/types/analytics';
import { useAdminSearch } from '../hooks/admin';

interface Props {
  siteId: string;
  workspaceId: string;
  gscPropertyUrl?: string;
}

type DetailTab = 'queries' | 'pages';

export function SearchDetail({ siteId, gscPropertyUrl }: Props) {
  const [days, setDays] = useState(28);
  const [tab, setTab] = useState<DetailTab>('queries');
  const [sortCol, setSortCol] = useState<string>('clicks');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const { overview, devices, countries, searchTypes, isLoading, error } = useAdminSearch(siteId, gscPropertyUrl, days);

  if (!gscPropertyUrl) {
    return <EmptyState icon={Search} title="Search Console not connected" description="Connect Google Search Console in workspace settings to see query and page data." />;
  }

  if (error) {
    return <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">{error}</div>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
        <span className="ml-2 text-sm text-zinc-500">Loading search data...</span>
      </div>
    );
  }

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('desc'); }
  };

  const sortRows = <T extends Record<string, unknown>>(rows: T[]) =>
    [...rows].sort((a, b) => {
      const va = (a[sortCol] as number) ?? 0;
      const vb = (b[sortCol] as number) ?? 0;
      return sortDir === 'asc' ? va - vb : vb - va;
    });

  const posColor = (pos: number) => pos <= 10 ? 'text-emerald-400' : pos <= 20 ? 'text-amber-400' : 'text-red-400';

  const SortHeader = ({ col, label }: { col: string; label: string }) => (
    <th className="text-right px-3 py-2 cursor-pointer hover:text-zinc-200 select-none" onClick={() => toggleSort(col)}>
      <span className="inline-flex items-center gap-1">{label} {sortCol === col && <ArrowUpDown className="w-3 h-3" />}</span>
    </th>
  );

  const queries = overview?.topQueries ?? [];
  const pages = overview?.topPages ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <DateRangeSelector presets={DATE_PRESETS_SEARCH} value={days} onChange={setDays} />
      </div>

      <TabBar
        tabs={[
          { id: 'queries', label: 'Top Queries', icon: Search },
          { id: 'pages', label: 'Top Pages', icon: ExternalLink },
        ]}
        active={tab}
        onChange={id => setTab(id as DetailTab)}
      />

      {tab === 'queries' && (
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-zinc-500 border-b border-zinc-800">
                <tr>
                  <th className="text-left px-4 py-2">Query</th>
                  <SortHeader col="clicks" label="Clicks" />
                  <SortHeader col="impressions" label="Impressions" />
                  <SortHeader col="ctr" label="CTR" />
                  <SortHeader col="position" label="Position" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {sortRows(queries).map((q: SearchQuery, i: number) => (
                  <tr key={i} className="hover:bg-zinc-800/30">
                    <td className="px-4 py-2 text-zinc-200 font-medium max-w-xs truncate">{q.query}</td>
                    <td className="text-right px-3 py-2 text-zinc-300">{q.clicks.toLocaleString()}</td>
                    <td className="text-right px-3 py-2 text-zinc-400">{q.impressions.toLocaleString()}</td>
                    <td className="text-right px-3 py-2 text-zinc-400">{q.ctr}%</td>
                    <td className={`text-right px-3 py-2 font-medium ${posColor(q.position)}`}>{q.position.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {tab === 'pages' && (
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-zinc-500 border-b border-zinc-800">
                <tr>
                  <th className="text-left px-4 py-2">Page</th>
                  <SortHeader col="clicks" label="Clicks" />
                  <SortHeader col="impressions" label="Impressions" />
                  <SortHeader col="ctr" label="CTR" />
                  <SortHeader col="position" label="Position" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {sortRows(pages).map((p: SearchPage, i: number) => (
                  <tr key={i} className="hover:bg-zinc-800/30">
                    <td className="px-4 py-2 text-zinc-200 max-w-sm truncate">{p.page.replace(/^https?:\/\/[^/]+/, '')}</td>
                    <td className="text-right px-3 py-2 text-zinc-300">{p.clicks.toLocaleString()}</td>
                    <td className="text-right px-3 py-2 text-zinc-400">{p.impressions.toLocaleString()}</td>
                    <td className="text-right px-3 py-2 text-zinc-400">{p.ctr}%</td>
                    <td className={`text-right px-3 py-2 font-medium ${posColor(p.position)}`}>{p.position.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Device / Country / Search Type breakdowns */}
      {(devices.length > 0 || countries.length > 0 || searchTypes.length > 0) && (
        <details className="group">
          <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors py-2">
            Show breakdowns (devices, countries, search types)
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
            {devices.length > 0 && (
              <SectionCard title="Devices">
                <div className="space-y-2">
                  {devices.map(d => (
                    <div key={d.device} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-300 capitalize">{d.device}</span>
                      <span className="text-zinc-500">{((d.clicks / (overview?.totalClicks || 1)) * 100).toFixed(0)}% · pos {d.position.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}
            {countries.length > 0 && (
              <SectionCard title="Top Countries">
                <div className="space-y-2">
                  {countries.slice(0, 8).map((c, i) => (
                    <div key={c.country} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">{i + 1}</span>
                      <span className="text-zinc-300 flex-1 ml-2">{c.country}</span>
                      <span className="text-zinc-500">{c.clicks.toLocaleString()} clicks</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}
            {searchTypes.length > 0 && (
              <SectionCard title="Search Types">
                <div className="space-y-2">
                  {searchTypes.map(s => (
                    <div key={s.searchType} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-300 capitalize">{s.searchType}</span>
                      <span className="text-zinc-500">{((s.clicks / (overview?.totalClicks || 1)) * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --skipLibCheck 2>&1 | grep -i 'SearchDetail\|error' | head -10`

- [ ] **Step 3: Commit**

```bash
git add src/components/SearchDetail.tsx
git commit -m "feat: add SearchDetail — extracted GSC queries/pages deep-dive from SearchConsole"
```

---

## Task 5: TrafficDetail — Extract from GoogleAnalytics

Strip GoogleAnalytics down to overview/events tabs only.

**Files:**
- Create: `src/components/TrafficDetail.tsx`
- Reference: `src/components/GoogleAnalytics.tsx` (will be deleted in Task 7)

- [ ] **Step 1: Create TrafficDetail**

Extract the overview and events tab content from GoogleAnalytics.tsx. Remove:
- PageHeader
- StatCards (headline metrics)
- Period comparison section
- Insights tab

Keep:
- `useAdminGA4` hook call
- DateRangeSelector
- TabBar with: Overview | Events
- Overview tab: daily trend (metric selector), top pages, traffic sources, device/country, new vs returning, organic
- Events tab: key events grid, landing pages table

This is a large extraction. Read `src/components/GoogleAnalytics.tsx` fully during implementation and extract lines that render the overview and events tab content. The component should follow the same pattern as SearchDetail: own date range, own hook call, starts with TabBar.

```tsx
// src/components/TrafficDetail.tsx
// This file extracts the Overview and Events tab content from GoogleAnalytics.tsx.
// The exact JSX is too large to duplicate inline — during implementation, copy the
// tab content sections from GoogleAnalytics.tsx (the overview tab: daily trend,
// top pages, traffic sources, devices, countries, new vs returning, organic section;
// and the events tab: key events grid, landing pages table).
//
// Key structural changes from GoogleAnalytics.tsx:
// 1. No PageHeader — hub provides it
// 2. No StatCards row — moved to hub
// 3. No period comparison section — moved to hub
// 4. No 'insights' tab — replaced by hub InsightCards
// 5. TabBar starts with just: Overview | Events
// 6. Component accepts same props as GoogleAnalytics minus the ones the hub handles

import { useState } from 'react';
import { BarChart3, Zap, Loader2 } from 'lucide-react';
import { SectionCard, TabBar, DateRangeSelector, EmptyState } from './ui';
import { DATE_PRESETS_SEARCH } from './ui/constants';
import { useAdminGA4 } from '../hooks/admin/useAdminGA4';

interface Props {
  workspaceId: string;
  ga4PropertyId?: string;
}

type DetailTab = 'overview' | 'events';

export function TrafficDetail({ workspaceId, ga4PropertyId }: Props) {
  const [days, setDays] = useState(28);
  const [tab, setTab] = useState<DetailTab>('overview');
  const ga4 = useAdminGA4(workspaceId, days, !!ga4PropertyId);

  if (!ga4PropertyId) {
    return <EmptyState icon={BarChart3} title="Google Analytics not connected" description="Connect GA4 in workspace settings to see traffic data." />;
  }

  if (ga4.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
        <span className="ml-2 text-sm text-zinc-500">Loading traffic data...</span>
      </div>
    );
  }

  // IMPLEMENTATION NOTE: Copy the overview and events tab JSX from GoogleAnalytics.tsx.
  // The overview tab renders: daily trend chart (with metric selector), top pages list,
  // traffic sources, devices, countries, new vs returning, organic section.
  // The events tab renders: key events 4-column card grid, landing pages table.
  // All the rendering code can be copied directly — only the wrapper and removed sections change.

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <DateRangeSelector presets={DATE_PRESETS_SEARCH} value={days} onChange={setDays} />
      </div>

      <TabBar
        tabs={[
          { id: 'overview', label: 'Overview', icon: BarChart3 },
          { id: 'events', label: 'Events', icon: Zap },
        ]}
        active={tab}
        onChange={id => setTab(id as DetailTab)}
      />

      {/* Tab content — copy from GoogleAnalytics.tsx overview and events sections */}
      {tab === 'overview' && ga4.overview && (
        <div className="space-y-4">
          {/* Copy the overview tab content from GoogleAnalytics.tsx here:
              - Daily trend chart with metric selector (Users/Sessions/Pageviews)
              - 2-column grid: Top Pages + Traffic Sources
              - 3-column grid: Devices + Countries + New vs Returning
              - Organic Search section (if organic data exists)
          */}
          <SectionCard title="Traffic Overview">
            <p className="text-xs text-zinc-500">GA4 detail view — extract from GoogleAnalytics.tsx during implementation</p>
          </SectionCard>
        </div>
      )}

      {tab === 'events' && (
        <div className="space-y-4">
          {/* Copy the events tab content from GoogleAnalytics.tsx here:
              - Key Events 4-column card grid
              - Top Landing Pages sortable table
          */}
          <SectionCard title="Events">
            <p className="text-xs text-zinc-500">Events detail view — extract from GoogleAnalytics.tsx during implementation</p>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
```

**IMPORTANT:** The placeholder `SectionCard` elements above are for the plan only. During implementation, the engineer MUST read `src/components/GoogleAnalytics.tsx` and copy the actual JSX for the overview and events tabs. The overview tab runs from approximately line 203-440 in GoogleAnalytics.tsx, and the events tab from approximately line 442-540.

- [ ] **Step 2: Copy actual JSX from GoogleAnalytics.tsx**

Read `src/components/GoogleAnalytics.tsx` and replace the placeholder SectionCard elements with the actual tab content. Keep all the same rendering logic, local variables, and helper functions (like the GaTooltip component). Only remove the PageHeader, StatCards, comparison section, and insights tab.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit --skipLibCheck 2>&1 | grep -i 'TrafficDetail\|error' | head -10`

- [ ] **Step 4: Commit**

```bash
git add src/components/TrafficDetail.tsx
git commit -m "feat: add TrafficDetail — extracted GA4 overview/events deep-dive from GoogleAnalytics"
```

---

## Task 6: AnalyticsHub Shell

The shell component with PageHeader + sub-nav TabBar that renders the three sub-views.

**Files:**
- Create: `src/components/AnalyticsHub.tsx`

- [ ] **Step 1: Create the hub shell**

```tsx
// src/components/AnalyticsHub.tsx
import { useState } from 'react';
import { BarChart3, Search, Activity } from 'lucide-react';
import { PageHeader, TabBar } from './ui';
import { AnalyticsOverview } from './AnalyticsOverview';
import { SearchDetail } from './SearchDetail';
import { TrafficDetail } from './TrafficDetail';

interface Props {
  workspaceId: string;
  siteId?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
}

type HubTab = 'overview' | 'search-performance' | 'site-traffic';

const HUB_TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'search-performance', label: 'Search Performance', icon: Search },
  { id: 'site-traffic', label: 'Site Traffic', icon: Activity },
] as const;

export function AnalyticsHub({ workspaceId, siteId, gscPropertyUrl, ga4PropertyId }: Props) {
  const [tab, setTab] = useState<HubTab>('overview');

  return (
    <div>
      <PageHeader title="Analytics" icon={BarChart3} subtitle="Search performance, traffic insights, and annotations" />

      <TabBar
        tabs={[...HUB_TABS]}
        active={tab}
        onChange={id => setTab(id as HubTab)}
        className="mb-6"
      />

      {tab === 'overview' && (
        <AnalyticsOverview
          workspaceId={workspaceId}
          siteId={siteId}
          gscPropertyUrl={gscPropertyUrl}
          ga4PropertyId={ga4PropertyId}
        />
      )}

      {tab === 'search-performance' && (
        <SearchDetail
          siteId={siteId ?? ''}
          workspaceId={workspaceId}
          gscPropertyUrl={gscPropertyUrl}
        />
      )}

      {tab === 'site-traffic' && (
        <TrafficDetail
          workspaceId={workspaceId}
          ga4PropertyId={ga4PropertyId}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --skipLibCheck 2>&1 | grep -i 'AnalyticsHub\|error' | head -10`

- [ ] **Step 3: Commit**

```bash
git add src/components/AnalyticsHub.tsx
git commit -m "feat: add AnalyticsHub shell with sub-nav for overview, search, traffic"
```

---

## Task 7: Wire Into App — Sidebar + Routing + Cleanup

Update sidebar, routing, and delete old files.

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/routes.ts`
- Delete: `src/components/SearchConsole.tsx`
- Delete: `src/components/GoogleAnalytics.tsx`

- [ ] **Step 1: Update Sidebar.tsx**

In `src/components/layout/Sidebar.tsx`, find the ANALYTICS group items array (around line 60-64). Replace the three items:

```tsx
// BEFORE:
items: [
  { id: 'search', label: 'Search Console', icon: Search, needsSite: true, desc: 'Google Search Console queries, pages, and click data' },
  { id: 'analytics', label: 'Google Analytics', icon: BarChart3, needsSite: true, desc: 'GA4 traffic, events, sources, and user behavior' },
  { id: 'seo-ranks', label: 'Rank Tracker', icon: TrendingUp, needsSite: true, desc: 'Track keyword rankings over time' },
]

// AFTER:
items: [
  { id: 'analytics-hub', label: 'Analytics', icon: BarChart3, needsSite: true, desc: 'Unified analytics: search performance, traffic, insights, and annotations' },
  { id: 'seo-ranks', label: 'Rank Tracker', icon: TrendingUp, needsSite: true, desc: 'Track keyword rankings over time' },
]
```

- [ ] **Step 2: Update routes.ts**

In `src/routes.ts`, add `'analytics-hub'` to the Page type union. Keep `'search'` and `'analytics'` for now (other code may reference them):

```ts
// Add 'analytics-hub' to the Page type
export type Page =
  | 'home'
  | 'media'
  | 'seo-audit' | 'seo-editor'
  | 'links'
  | 'seo-strategy' | 'page-intelligence' | 'seo-schema' | 'seo-briefs' | 'seo-ranks'
  | 'content' | 'calendar' | 'brand' | 'subscriptions' | 'content-pipeline'
  | 'search' | 'analytics' | 'analytics-hub' | 'annotations'
  | 'performance'
  | 'content-perf'
  | 'rewrite'
  | 'workspace-settings'
  | 'prospect'
  | 'roadmap'
  | 'ai-usage'
  | 'requests'
  | 'settings'
  | 'revenue';
```

- [ ] **Step 3: Update App.tsx**

In `src/App.tsx`:

1. Replace the SearchConsole and GoogleAnalytics imports with AnalyticsHub:

```tsx
// Remove:
import SearchConsole from './components/SearchConsole';
import GoogleAnalytics from './components/GoogleAnalytics';

// Add:
import { AnalyticsHub } from './components/AnalyticsHub';
```

2. Update the `needsSite` check (line 296) — replace `tab === 'search' || tab === 'analytics'` with `tab === 'analytics-hub'`:

```tsx
const needsSite = !!(SEO_TABS.has(tab) || tab === 'analytics-hub' || tab === 'performance');
```

3. Replace the two route cases (lines 340 and 342) with one:

```tsx
// Remove:
if (tab === 'search') return <SearchConsole key={...} ... />;
if (tab === 'analytics') return <GoogleAnalytics key={...} ... />;

// Add:
if (tab === 'analytics-hub') return <AnalyticsHub key={`analytics-${selected.id}`} workspaceId={selected.id} siteId={selected.webflowSiteId} gscPropertyUrl={selected.gscPropertyUrl} ga4PropertyId={selected.ga4PropertyId} />;
```

4. Update keyboard shortcut tabMap (line 194) — map `'3'` to `'analytics-hub'` instead of `'search'`, remove `'4': 'analytics'`:

```tsx
const tabMap: Record<string, Page> = { '1': 'home', '2': 'seo-audit', '3': 'analytics-hub' };
```

- [ ] **Step 4: Delete old files**

```bash
rm src/components/SearchConsole.tsx src/components/GoogleAnalytics.tsx
```

- [ ] **Step 5: Grep for remaining references**

```bash
grep -rn "SearchConsole\|GoogleAnalytics\|tab === 'search'\|tab === 'analytics'" src/ --include='*.tsx' --include='*.ts' | grep -v node_modules | grep -v '.test.'
```

Fix any remaining references. Common ones:
- Any component that imports SearchConsole or GoogleAnalytics
- Any navigation call like `navigate(adminPath(id, 'search'))` — change to `'analytics-hub'`

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```

Expected: 858+ tests pass. Some tests may import SearchConsole or GoogleAnalytics — those tests need their imports updated or removed if they test deleted components.

- [ ] **Step 7: Verify the app builds**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: wire AnalyticsHub into sidebar and routing, remove old SearchConsole + GoogleAnalytics"
```

---

## Task 8: StatCard Badge Enhancement (Optional)

The AnalyticsOverview uses a `badge` prop on StatCard to show "GSC" or "GA4" source labels. If StatCard doesn't support this prop yet, add it.

**Files:**
- Modify: `src/components/ui/StatCard.tsx`

- [ ] **Step 1: Check if StatCard already has a badge prop**

```bash
grep -n 'badge\|Badge' src/components/ui/StatCard.tsx
```

- [ ] **Step 2: If not, add badge support**

Add an optional `badge?: string` prop to the StatCard interface. Render it as a small label in the top-right corner:

```tsx
// In the StatCard props interface, add:
badge?: string;

// In the render, add after the label or in the card header:
{badge && (
  <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-medium uppercase tracking-wider">
    {badge}
  </span>
)}
```

- [ ] **Step 3: Also add invertDelta prop if needed**

Some metrics like Position and Bounce Rate are "lower is better" — the delta color should be inverted. Add:

```tsx
// In props:
invertDelta?: boolean;

// In delta rendering, flip the color logic when invertDelta is true
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/StatCard.tsx
git commit -m "feat: add badge and invertDelta props to StatCard"
```

---

## Task 9: Final Verification & Cleanup

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 2: Build the app**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Manual smoke test**

Start the dev server and verify:
1. Sidebar shows single "Analytics" item (not Search Console + Google Analytics)
2. Clicking it opens the hub with Overview tab active
3. Overview shows: StatCards → Trend Chart → InsightCards → Annotations
4. Clicking a date on the trend chart opens the create-annotation popover
5. Annotation vertical lines appear on chart for existing annotations
6. Sub-nav tabs switch between Overview / Search Performance / Site Traffic
7. Search Performance shows queries/pages tables with collapsible breakdowns
8. Site Traffic shows GA4 overview/events tabs
9. Keyboard shortcut Cmd+3 opens Analytics hub

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "fix: final cleanup and verification for analytics hub redesign"
```
