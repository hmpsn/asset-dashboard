# Light Mode + Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every hardcoded dark color that bleeds through in light mode (148 instances across 42 files), plus remaining visual polish gaps (spacing, border radius).

**Architecture:** CSS-first approach — extend existing `.dashboard-light` override block in `index.css` for class-based fixes. For inline styles and chart props, extend `ui/constants.ts` with theme-aware helper functions that reuse the existing `document.querySelector('.dashboard-light')` detection pattern. Add pr-check rules to prevent recurrence.

**Tech Stack:** React 19, TailwindCSS 4, Recharts, CSS custom properties, Stripe Elements theming

**Audit:** `docs/superpowers/audits/2026-03-29-light-mode-and-polish-audit.md` (148 instances, 42 files)
**Spec:** `docs/superpowers/specs/2026-03-29-light-mode-audit-design.md`

---

## Dependency Graph

```
Phase 0 (sequential) ─── shared infrastructure commits first
  ├── Task 1: Chart theme helpers in constants.ts
  ├── Task 2: CSS gap overrides in index.css
  ├── Task 3: Skeleton shimmer fix
  └── Task 4: pr-check light mode rules
        │
Phase 1 (parallel, 3 agents) ─── critical UI components
  ├── Agent A: Task 5 — ScannerReveal + MetricRing
  ├── Agent B: Task 6 — AnnotatedTrendChart + ScoreTrendChart
  └── Agent C: Task 7 — client/helpers.tsx + client/AnalyticsTab.tsx
        │
Phase 2 (parallel, 4 agents) ─── inline style conversions
  ├── Agent A: Task 8 — RequestManager.tsx
  ├── Agent B: Task 9 — ClientDashboardTab.tsx + BrandHub.tsx
  ├── Agent C: Task 10 — RankTracker + Roadmap + WorkspaceOverview
  └── Agent D: Task 11 — DropZone + InternalLinks + RedirectManager + WorkspaceSettings
        │
Phase 3 (parallel, 3 agents) ─── visual polish
  ├── Agent A: Task 12 — Spacing batch 1
  ├── Agent B: Task 13 — Spacing batch 2
  └── Agent C: Task 14 — Border radius fixes
        │
Phase 4 (parallel, 2 agents) ─── edge cases
  ├── Agent A: Task 15 — StripePaymentForm
  └── Agent B: Task 16 — OverviewTab + HealthTab + CellDetailPanel + SiteArchitecture
        │
Phase 5 (sequential) ─── verification
  └── Task 17: Build, test, pr-check, docs, PR
```

## Model Assignments

| Task | Model | Reasoning |
|------|-------|-----------|
| Task 1 (chart helpers) | Sonnet | Logic for theme detection pattern |
| Task 2 (CSS gap overrides) | Haiku | Mechanical pattern matching |
| Task 3 (Skeleton shimmer) | Haiku | Single CSS addition |
| Task 4 (pr-check rules) | Haiku | Follows existing structure |
| Tasks 5 (ScannerReveal + MetricRing) | Haiku | CSS var swap, no logic |
| Task 6 (AnnotatedTrendChart + ScoreTrendChart) | Sonnet | Chart component logic, multiple props |
| Task 7 (client/helpers + AnalyticsTab) | Sonnet | Chart helper integration |
| Task 8 (RequestManager) | Sonnet | Multiple conditional inline styles |
| Task 9 (ClientDashboardTab + BrandHub) | Sonnet | Inline style conversion |
| Task 10 (RankTracker + Roadmap + WorkspaceOverview) | Sonnet | SVG + Recharts props |
| Task 11 (DropZone + InternalLinks + RedirectManager + WorkspaceSettings) | Haiku | 1-2 mechanical fixes each |
| Tasks 12-13 (spacing) | Haiku | Class name replacement |
| Task 14 (border radius) | Haiku | Style attribute additions |
| Task 15 (StripePaymentForm) | Sonnet | Stripe Elements theme API |
| Task 16 (iconColor fixes) | Sonnet | Theme helper integration |
| Task 17 (verification) | Opus | Full-context judgment |

---

## Phase 0 — Shared Infrastructure (Sequential)

### Task 1: Chart Theme Helpers in `ui/constants.ts`

**Files:**
- Modify: `src/components/ui/constants.ts`

**Model:** Sonnet

- [ ] **Step 1: Add `isLightMode()` helper and chart theme functions**

Add these functions after the existing `aeoScoreBgBarClass` function (after line 40):

```typescript
/** Detect light mode — reuses same check as scoreColor(). */
function isLightMode(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector('.dashboard-light');
}

/** Generic two-value theme switch. Returns `light` when .dashboard-light is active, `dark` otherwise. */
export function themeColor(dark: string, light: string): string {
  return isLightMode() ? light : dark;
}

/** Chart grid line color — subtle separator. */
export function chartGridColor(): string {
  return themeColor('#27272a', '#e2e8f0');
}

/** Chart axis label fill — muted text on axes. */
export function chartAxisColor(): string {
  return themeColor('#71717a', '#64748b');
}

/** Chart dot stroke — ring around active/annotation dots. */
export function chartDotStroke(): string {
  return themeColor('#18181b', '#f1f5f9');
}

/** Chart dot fill — center of data dots on area charts. */
export function chartDotFill(): string {
  return themeColor('#0f1219', '#ffffff');
}

/** Chart tooltip style — full contentStyle object for Recharts <Tooltip>. */
export function chartTooltipStyle(): React.CSSProperties {
  return isLightMode()
    ? { backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '0.5rem', fontSize: '11px', color: '#1e293b' }
    : { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '0.5rem', fontSize: '11px' };
}

/** Chart tooltip label style. */
export function chartTooltipLabelStyle(): React.CSSProperties {
  return isLightMode()
    ? { color: '#64748b', fontFamily: 'monospace' }
    : { color: '#a1a1aa', fontFamily: 'monospace' };
}
```

- [ ] **Step 2: Add React import for CSSProperties type**

Add at the top of the file:

```typescript
import type React from 'react';
```

- [ ] **Step 3: Refactor `scoreColor()` to use shared `isLightMode()`**

Replace the existing `scoreColor` function body:

```typescript
export function scoreColor(score: number): string {
  if (isLightMode()) {
    return score >= 80 ? '#047857' : score >= 60 ? '#b45309' : '#dc2626';
  }
  return score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
}
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/constants.ts
git commit -m "feat: add chart theme helpers to constants.ts for light mode support"
```

---

### Task 2: CSS Gap Overrides in `index.css`

**Files:**
- Modify: `src/index.css`

**Model:** Haiku

- [ ] **Step 1: Add missing `.dashboard-light` overrides**

Add the following rules at the end of the `.dashboard-light` block in `src/index.css` (before the closing of the light-mode section, after the last existing rule around line 569):

```css
/* ── Missing opacity variant backgrounds ── */
.dashboard-light .bg-zinc-800\/40 { background-color: rgba(241,245,249,0.6) !important; }
.dashboard-light .bg-zinc-800\/20 { background-color: rgba(241,245,249,0.3) !important; }
.dashboard-light .bg-zinc-700\/50 { background-color: rgba(226,232,240,0.7) !important; }
.dashboard-light .bg-zinc-500\/10 { background-color: rgba(148,163,184,0.1) !important; }
.dashboard-light .bg-zinc-500\/15 { background-color: rgba(148,163,184,0.15) !important; }

/* ── Missing opacity variant borders ── */
.dashboard-light .border-zinc-800\/30 { border-color: rgba(226,232,240,0.4) !important; }
.dashboard-light .border-zinc-800\/60 { border-color: rgba(226,232,240,0.7) !important; }
.dashboard-light .border-zinc-500\/20 { border-color: rgba(148,163,184,0.2) !important; }
.dashboard-light .border-zinc-500\/30 { border-color: rgba(148,163,184,0.3) !important; }

/* ── Missing dividers ── */
.dashboard-light .divide-zinc-800\/30 > * + * { border-color: rgba(226,232,240,0.4) !important; }

/* ── Missing ring ── */
.dashboard-light .ring-zinc-900 { --tw-ring-color: #e2e8f0 !important; }

/* ── Arbitrary hex text ── */
.dashboard-light .text-\[\#0f1219\] { color: #0f172a !important; }

/* ── Missing gradient stops ── */
.dashboard-light .from-zinc-900 { --tw-gradient-from: #ffffff !important; }
.dashboard-light .to-zinc-900\/50 { --tw-gradient-to: rgba(255,255,255,0.8) !important; }

/* ── MetricRing track color ── */
.dashboard-light { --metric-ring-track: #e2e8f0; }
```

- [ ] **Step 2: Verify build**

Run: `npx vite build`
Expected: builds successfully

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat: add 17 missing .dashboard-light CSS overrides for opacity variants, gradients, and MetricRing"
```

---

### Task 3: Skeleton Shimmer Fix

**Files:**
- Modify: `src/index.css`

**Model:** Haiku

- [ ] **Step 1: Add shimmer override**

Add after the MetricRing track rule from Task 2:

```css
/* ── Skeleton shimmer — visible pulse on light backgrounds ── */
.dashboard-light .animate-pulse.bg-zinc-800 {
  background-color: #e2e8f0 !important;
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/index.css
git commit -m "fix: make Skeleton shimmer visible in light mode"
```

---

### Task 4: pr-check Light Mode Rules

**Files:**
- Modify: `scripts/pr-check.ts`

**Model:** Haiku

- [ ] **Step 1: Add two new checks to the `CHECKS` array**

Add these two entries to the `CHECKS` array in `scripts/pr-check.ts` (after the existing `'Local prepared statement caching'` check, before the closing `];` on line 136):

```typescript
  {
    name: 'Hardcoded dark hex in inline styles',
    pattern: 'style=\\{[^}]*(#0f1219|#18181b|#27272a|#303036)',
    fileGlobs: ['*.tsx'],
    pathFilter: 'src/components/',
    exclude: 'Styleguide.tsx',
    message: 'Use CSS variables or chartColor helpers from ui/constants.ts. Hardcoded dark hex breaks light mode.',
    severity: 'warn',
  },
  {
    name: 'SVG with hardcoded dark fill/stroke',
    pattern: '(fill|stroke)="(#0f1219|#18181b|#27272a|#303036|#52525b)"',
    fileGlobs: ['*.tsx'],
    pathFilter: 'src/components/',
    exclude: 'Styleguide.tsx',
    message: 'Use chartDotStroke()/chartAxisColor() from ui/constants.ts for SVG colors. Dark hex breaks light mode.',
    severity: 'warn',
  },
```

- [ ] **Step 2: Verify pr-check runs**

Run: `npx tsx scripts/pr-check.ts --all`
Expected: the two new checks produce warnings for existing violations (expected — we'll fix them in subsequent phases)

- [ ] **Step 3: Commit**

```bash
git add scripts/pr-check.ts
git commit -m "feat: add pr-check rules for hardcoded dark hex in inline styles and SVG attributes"
```

---

## Phase 1 — Critical UI Components (Parallel, 3 Agents)

### Task 5: ScannerReveal + MetricRing

**Files:**
- Modify: `src/components/ui/ScannerReveal.tsx` — owns exclusively
- Modify: `src/components/ui/MetricRing.tsx` — owns exclusively

**Must not touch:** `constants.ts`, `index.css`, any other file

**Model:** Haiku

- [ ] **Step 1: Fix ScannerReveal overlay color**

In `src/components/ui/ScannerReveal.tsx`, line 69, replace:

```typescript
backgroundColor: '#0f1219',
```

with:

```typescript
backgroundColor: 'var(--brand-bg, #0f1219)',
```

- [ ] **Step 2: Fix MetricRing track color (main component)**

In `src/components/ui/MetricRing.tsx`, line 43, replace:

```typescript
stroke="#303036"
```

with:

```typescript
stroke="var(--metric-ring-track, #303036)"
```

- [ ] **Step 3: Fix MetricRingSvg track color**

In `src/components/ui/MetricRing.tsx`, line 79, replace:

```typescript
stroke="#303036"
```

with:

```typescript
stroke="var(--metric-ring-track, #303036)"
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ScannerReveal.tsx src/components/ui/MetricRing.tsx
git commit -m "fix: make ScannerReveal overlay and MetricRing track theme-aware via CSS vars"
```

---

### Task 6: AnnotatedTrendChart + ScoreTrendChart

**Files:**
- Modify: `src/components/charts/AnnotatedTrendChart.tsx` — owns exclusively
- Modify: `src/components/audit/ScoreTrendChart.tsx` — owns exclusively

**Must not touch:** `constants.ts`, `index.css`, `client/helpers.tsx`, any other file

**Model:** Sonnet

- [ ] **Step 1: Add import to AnnotatedTrendChart**

In `src/components/charts/AnnotatedTrendChart.tsx`, add this import at the top with existing imports:

```typescript
import { chartGridColor, chartAxisColor, chartDotStroke, chartTooltipStyle, chartTooltipLabelStyle, themeColor } from '../ui/constants';
```

- [ ] **Step 2: Fix AnnotatedTrendChart axis color defaults**

In `src/components/charts/AnnotatedTrendChart.tsx`, lines 287-288, replace:

```typescript
  const leftAxisColor = activeLines.find(l => axisAssignments.get(l.key) === 'left')?.color ?? '#71717a';
  const rightAxisColor = activeLines.find(l => axisAssignments.get(l.key) === 'right')?.color ?? '#71717a';
```

with:

```typescript
  const leftAxisColor = activeLines.find(l => axisAssignments.get(l.key) === 'left')?.color ?? chartAxisColor();
  const rightAxisColor = activeLines.find(l => axisAssignments.get(l.key) === 'right')?.color ?? chartAxisColor();
```

- [ ] **Step 3: Fix AnnotatedTrendChart CartesianGrid + XAxis**

In `src/components/charts/AnnotatedTrendChart.tsx`, line 294, replace:

```typescript
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
```

with:

```typescript
          <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor()} />
```

Lines 297-299, replace:

```typescript
            tick={{ fill: '#71717a', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: '#3f3f46' }}
```

with:

```typescript
            tick={{ fill: chartAxisColor(), fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: chartGridColor() }}
```

- [ ] **Step 4: Fix AnnotatedTrendChart Tooltip**

Lines 328-335, replace:

```typescript
          <Tooltip
            contentStyle={{
              backgroundColor: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: '0.5rem',
              fontSize: '11px',
            }}
            labelStyle={{ color: '#a1a1aa', fontFamily: 'monospace' }}
```

with:

```typescript
          <Tooltip
            contentStyle={chartTooltipStyle()}
            labelStyle={chartTooltipLabelStyle()}
```

- [ ] **Step 5: Fix AnnotatedTrendChart annotation dot stroke**

In `src/components/charts/AnnotatedTrendChart.tsx`, find the AnnotationDot component (around line 167) where `stroke="#18181b"` appears. Replace:

```typescript
stroke="#18181b"
```

with:

```typescript
stroke={chartDotStroke()}
```

Note: This requires importing `chartDotStroke` which was done in Step 1.

- [ ] **Step 6: Add import to ScoreTrendChart**

In `src/components/audit/ScoreTrendChart.tsx`, add this import at the top:

```typescript
import { chartGridColor, chartAxisColor, chartDotStroke, chartDotFill } from '../ui/constants';
```

- [ ] **Step 7: Fix ScoreTrendChart CartesianGrid**

In `src/components/audit/ScoreTrendChart.tsx`, line 30, replace:

```typescript
        <CartesianGrid stroke="rgba(255,255,255,0.04)" horizontal vertical={false} />
```

with:

```typescript
        <CartesianGrid stroke={chartGridColor()} strokeOpacity={0.15} horizontal vertical={false} />
```

- [ ] **Step 8: Fix ScoreTrendChart XAxis and YAxis tick colors**

Line 31 — the XAxis tick fill `#64748b` is already a valid light color, but standardize:

```typescript
        <XAxis dataKey="date" tick={{ fill: chartAxisColor(), fontSize: 8 }} tickLine={false} axisLine={false} interval={points.length <= 6 ? 0 : 'preserveStartEnd'} />
        <YAxis domain={[minS, maxS]} tick={{ fill: chartAxisColor(), fontSize: 9 }} tickLine={false} axisLine={false} width={28} />
```

- [ ] **Step 9: Fix ScoreTrendChart Area dot props**

Line 48, replace the dot and activeDot props:

```typescript
dot={{ r: 3.5, fill: '#0f1219', stroke: '#2ed9c3', strokeWidth: 2 }} activeDot={{ r: 4, fill: '#2ed9c3', stroke: '#18181b', strokeWidth: 2 }}
```

with:

```typescript
dot={{ r: 3.5, fill: chartDotFill(), stroke: '#2ed9c3', strokeWidth: 2 }} activeDot={{ r: 4, fill: '#2ed9c3', stroke: chartDotStroke(), strokeWidth: 2 }}
```

- [ ] **Step 10: Fix ScoreHistoryChart activeDot** (same file, around line 129)

Replace:

```typescript
activeDot={{ r: 3, fill: '#34d399', stroke: '#18181b', strokeWidth: 1.5 }}
```

with:

```typescript
activeDot={{ r: 3, fill: '#34d399', stroke: chartDotStroke(), strokeWidth: 1.5 }}
```

- [ ] **Step 11: Verify build**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 12: Commit**

```bash
git add src/components/charts/AnnotatedTrendChart.tsx src/components/audit/ScoreTrendChart.tsx
git commit -m "fix: make AnnotatedTrendChart and ScoreTrendChart theme-aware using chart helpers"
```

---

### Task 7: Client Chart Helpers — `helpers.tsx` + `AnalyticsTab.tsx`

**Files:**
- Modify: `src/components/client/helpers.tsx` — owns exclusively
- Modify: `src/components/client/AnalyticsTab.tsx` — owns exclusively

**Must not touch:** `constants.ts`, `AnnotatedTrendChart.tsx`, `ScoreTrendChart.tsx`, any other file

**Model:** Sonnet

- [ ] **Step 1: Add import to helpers.tsx**

In `src/components/client/helpers.tsx`, add import at top:

```typescript
import { chartDotStroke } from '../ui/constants';
```

- [ ] **Step 2: Fix TrendChart activeDot (line 44)**

Replace:

```typescript
activeDot={{ r: 3, fill: color, stroke: '#18181b', strokeWidth: 1.5 }}
```

with:

```typescript
activeDot={{ r: 3, fill: color, stroke: chartDotStroke(), strokeWidth: 1.5 }}
```

- [ ] **Step 3: Fix DualTrendChart activeDots (lines 79-80)**

Replace both activeDot props:

```typescript
activeDot={{ r: 3, fill: '#2dd4bf', stroke: '#18181b', strokeWidth: 1.5 }}
```

with:

```typescript
activeDot={{ r: 3, fill: '#2dd4bf', stroke: chartDotStroke(), strokeWidth: 1.5 }}
```

And:

```typescript
activeDot={{ r: 3, fill: '#60a5fa', stroke: '#18181b', strokeWidth: 1.5 }}
```

with:

```typescript
activeDot={{ r: 3, fill: '#60a5fa', stroke: chartDotStroke(), strokeWidth: 1.5 }}
```

- [ ] **Step 4: Fix SiteHealthTrendChart activeDot (line 129)**

Replace:

```typescript
activeDot={{ r: 3, fill: '#34d399', stroke: '#18181b', strokeWidth: 1.5 }}
```

with:

```typescript
activeDot={{ r: 3, fill: '#34d399', stroke: chartDotStroke(), strokeWidth: 1.5 }}
```

- [ ] **Step 5: Add import to AnalyticsTab.tsx**

In `src/components/client/AnalyticsTab.tsx`, add import at top:

```typescript
import { chartDotStroke } from '../ui/constants';
```

- [ ] **Step 6: Fix AnalyticsTab activeDot on GA4 chart (line 206)**

Replace:

```typescript
stroke: '#18181b'
```

with:

```typescript
stroke: chartDotStroke()
```

- [ ] **Step 7: Fix AnalyticsTab activeDot on Events chart (line 425)**

Same replacement as Step 6.

- [ ] **Step 8: Verify build**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 9: Commit**

```bash
git add src/components/client/helpers.tsx src/components/client/AnalyticsTab.tsx
git commit -m "fix: make client chart activeDot strokes theme-aware"
```

---

## Phase 2 — Inline Style Conversions (Parallel, 4 Agents)

### Task 8: RequestManager Inline Styles

**Files:**
- Modify: `src/components/RequestManager.tsx` — owns exclusively

**Must not touch:** Any other file

**Model:** Sonnet

- [ ] **Step 1: Add import**

```typescript
import { themeColor } from './ui/constants';
```

- [ ] **Step 2: Fix line 342 — conditional borderColor**

Replace:

```typescript
borderColor: '#27272a'
```

with:

```typescript
borderColor: themeColor('#27272a', '#e2e8f0')
```

- [ ] **Step 3: Fix lines 360 — backgroundColor + border**

Replace:

```typescript
backgroundColor: '#18181b', border: '1px solid #27272a'
```

with:

```typescript
backgroundColor: themeColor('#18181b', '#ffffff'), border: `1px solid ${themeColor('#27272a', '#e2e8f0')}`
```

- [ ] **Step 4: Fix line 369 — conditional borderColor**

Replace:

```typescript
borderColor: '#27272a'
```

with:

```typescript
borderColor: themeColor('#27272a', '#e2e8f0')
```

- [ ] **Step 5: Fix line 487 — backgroundColor + border**

Replace:

```typescript
backgroundColor: '#0f1219', border: '1px solid #27272a'
```

with:

```typescript
backgroundColor: themeColor('#0f1219', '#f8fafc'), border: `1px solid ${themeColor('#27272a', '#e2e8f0')}`
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 7: Commit**

```bash
git add src/components/RequestManager.tsx
git commit -m "fix: make RequestManager inline styles theme-aware"
```

---

### Task 9: ClientDashboardTab + BrandHub Inline Styles

**Files:**
- Modify: `src/components/settings/ClientDashboardTab.tsx` — owns exclusively
- Modify: `src/components/BrandHub.tsx` — owns exclusively

**Must not touch:** Any other file

**Model:** Sonnet

- [ ] **Step 1: Add import to ClientDashboardTab**

```typescript
import { themeColor } from '../ui/constants';
```

- [ ] **Step 2: Fix ClientDashboardTab line 259**

Replace all three inline hex values:

```typescript
backgroundColor: '#18181b'
```
→ `backgroundColor: themeColor('#18181b', '#ffffff')`

```typescript
color: '#a1a1aa'
```
→ `color: themeColor('#a1a1aa', '#64748b')`

```typescript
border...#27272a
```
→ border with `themeColor('#27272a', '#e2e8f0')`

- [ ] **Step 3: Fix ClientDashboardTab line 505**

Replace:

```typescript
backgroundColor: '#27272a', color: '#a1a1aa'
```

with:

```typescript
backgroundColor: themeColor('#27272a', '#e2e8f0'), color: themeColor('#a1a1aa', '#64748b')
```

- [ ] **Step 4: Fix ClientDashboardTab line 626**

Same pattern as Step 3:

```typescript
backgroundColor: themeColor('#27272a', '#e2e8f0'), color: themeColor('#a1a1aa', '#64748b')
```

- [ ] **Step 5: Add import to BrandHub**

```typescript
import { themeColor } from './ui/constants';
```

- [ ] **Step 6: Fix BrandHub line 219**

Replace:

```typescript
backgroundColor: '#27272a', color: '#a1a1aa'
```

with:

```typescript
backgroundColor: themeColor('#27272a', '#e2e8f0'), color: themeColor('#a1a1aa', '#64748b')
```

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 8: Commit**

```bash
git add src/components/settings/ClientDashboardTab.tsx src/components/BrandHub.tsx
git commit -m "fix: make ClientDashboardTab and BrandHub inline styles theme-aware"
```

---

### Task 10: RankTracker + Roadmap + WorkspaceOverview SVG/Chart Props

**Files:**
- Modify: `src/components/RankTracker.tsx` — owns exclusively
- Modify: `src/components/Roadmap.tsx` — owns exclusively
- Modify: `src/components/WorkspaceOverview.tsx` — owns exclusively

**Must not touch:** Any other file

**Model:** Sonnet

- [ ] **Step 1: Add imports to RankTracker**

```typescript
import { chartGridColor, chartAxisColor } from './ui/constants';
```

- [ ] **Step 2: Fix RankTracker SVG attrs (lines 101-102, 123)**

Line 101 — replace:
```typescript
stroke="#27272a"
```
with:
```typescript
stroke={chartGridColor()}
```

Lines 102, 123 — replace:
```typescript
fill="#52525b"
```
with:
```typescript
fill={chartAxisColor()}
```

- [ ] **Step 3: Add imports to Roadmap**

```typescript
import { chartGridColor, chartDotFill } from './ui/constants';
```

- [ ] **Step 4: Fix Roadmap SVG attrs (lines 89, 102)**

Line 89 — replace:
```typescript
stroke="#27272a"
```
with:
```typescript
stroke={chartGridColor()}
```

Line 102 — replace:
```typescript
fill="#0f0f0f"
```
with:
```typescript
fill={chartDotFill()}
```

- [ ] **Step 5: Add import to WorkspaceOverview**

```typescript
import { chartAxisColor, themeColor } from './ui/constants';
```

- [ ] **Step 6: Fix WorkspaceOverview XAxis tick (line 666)**

Replace:
```typescript
fill="#52525b"
```
with:
```typescript
fill={chartAxisColor()}
```

- [ ] **Step 7: Fix WorkspaceOverview StatCard iconColor props (lines 152-157)**

Replace all 6 instances of:
```typescript
iconColor: '...some-color...' || '#71717a'
```

For the fallback `'#71717a'`, replace with:
```typescript
themeColor('#71717a', '#94a3b8')
```

Only change the `#71717a` fallback — the primary color (when truthy) stays as-is.

- [ ] **Step 8: Verify build**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 9: Commit**

```bash
git add src/components/RankTracker.tsx src/components/Roadmap.tsx src/components/WorkspaceOverview.tsx
git commit -m "fix: make RankTracker, Roadmap, and WorkspaceOverview chart/SVG colors theme-aware"
```

---

### Task 11: DropZone + InternalLinks + RedirectManager + WorkspaceSettings

**Files:**
- Modify: `src/components/DropZone.tsx` — owns exclusively
- Modify: `src/components/InternalLinks.tsx` — owns exclusively
- Modify: `src/components/RedirectManager.tsx` — owns exclusively
- Modify: `src/components/WorkspaceSettings.tsx` — owns exclusively

**Must not touch:** Any other file

**Model:** Haiku

- [ ] **Step 1: Add import to DropZone**

```typescript
import { themeColor } from './ui/constants';
```

- [ ] **Step 2: Fix DropZone inline styles (lines 86-87)**

Replace:
```typescript
borderColor: '#3f3f46'
```
with:
```typescript
borderColor: themeColor('#3f3f46', '#cbd5e1')
```

Replace:
```typescript
backgroundColor: '#18181b'
```
with:
```typescript
backgroundColor: themeColor('#18181b', '#ffffff')
```

- [ ] **Step 3: Add import to InternalLinks**

```typescript
import { themeColor } from './ui/constants';
```

- [ ] **Step 4: Fix InternalLinks line 222**

Replace:
```typescript
color: '#71717a'
```
with:
```typescript
color: themeColor('#71717a', '#94a3b8')
```

- [ ] **Step 5: Add import to RedirectManager**

```typescript
import { themeColor } from './ui/constants';
```

- [ ] **Step 6: Fix RedirectManager line 408**

Replace:
```typescript
color: '#71717a'
```
with:
```typescript
color: themeColor('#71717a', '#94a3b8')
```

- [ ] **Step 7: Add import to WorkspaceSettings**

```typescript
import { themeColor } from './ui/constants';
```

- [ ] **Step 8: Fix WorkspaceSettings line 176**

Replace:
```typescript
color: '#71717a'
```
with:
```typescript
color: themeColor('#71717a', '#94a3b8')
```

- [ ] **Step 9: Verify build**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 10: Commit**

```bash
git add src/components/DropZone.tsx src/components/InternalLinks.tsx src/components/RedirectManager.tsx src/components/WorkspaceSettings.tsx
git commit -m "fix: make DropZone, InternalLinks, RedirectManager, WorkspaceSettings inline colors theme-aware"
```

---

## Phase 3 — Visual Polish Gaps (Parallel, 3 Agents)

### Task 12: Spacing Fixes — Batch 1

**Files:**
- Modify: `src/components/AnalyticsAnnotations.tsx` — owns exclusively
- Modify: `src/components/Annotations.tsx` — owns exclusively
- Modify: `src/components/AssetBrowser.tsx` — owns exclusively
- Modify: `src/components/CmsEditor.tsx` — owns exclusively
- Modify: `src/components/ContentPlanner.tsx` — owns exclusively
- Modify: `src/components/LinksPanel.tsx` — owns exclusively

**Must not touch:** Any other file

**Model:** Haiku

- [ ] **Step 1: Fix AnalyticsAnnotations (line 81)**

Replace `space-y-4` with `space-y-8` on the page-level outer wrapper div.

- [ ] **Step 2: Fix Annotations (line 55)**

Replace `space-y-4` with `space-y-8` on the page-level outer wrapper div.

- [ ] **Step 3: Fix AssetBrowser (line 527)**

Replace `space-y-4` with `space-y-8` on the page-level outer wrapper div.

- [ ] **Step 4: Fix CmsEditor (line 450)**

Replace `space-y-4` with `space-y-8` on the page-level outer wrapper div.

- [ ] **Step 5: Fix ContentPlanner (line 180)**

Replace `space-y-4` with `space-y-8` on the page-level outer wrapper div.

- [ ] **Step 6: Fix LinksPanel (line 22)**

Replace `space-y-4` with `space-y-8` on the page-level outer wrapper div.

- [ ] **Step 7: Verify build**

Run: `npx vite build`
Expected: builds successfully

- [ ] **Step 8: Commit**

```bash
git add src/components/AnalyticsAnnotations.tsx src/components/Annotations.tsx src/components/AssetBrowser.tsx src/components/CmsEditor.tsx src/components/ContentPlanner.tsx src/components/LinksPanel.tsx
git commit -m "fix: standardize page-level spacing to space-y-8 (batch 1)"
```

---

### Task 13: Spacing Fixes — Batch 2

**Files:**
- Modify: `src/components/LlmsTxtGenerator.tsx` — owns exclusively
- Modify: `src/components/PostEditor.tsx` — owns exclusively
- Modify: `src/components/PublishSettings.tsx` — owns exclusively
- Modify: `src/components/FeatureLibrary.tsx` — owns exclusively
- Modify: `src/components/RequestManager.tsx` — **spacing only** (line 218)
- Modify: `src/components/RevenueDashboard.tsx` — owns exclusively

**Must not touch:** Any other file. **Note:** RequestManager inline style fixes are in Task 8 (Phase 2). This task only touches the `space-y-6` → `space-y-8` class on line 218. If Task 8 has not yet committed, coordinate: this task changes ONLY the className, not the inline styles.

**Model:** Haiku

- [ ] **Step 1: Fix LlmsTxtGenerator (line 97)**

Replace `space-y-4` with `space-y-8`.

- [ ] **Step 2: Fix PostEditor (line 256)**

Replace `space-y-4` with `space-y-8`.

- [ ] **Step 3: Fix PublishSettings (line 164)**

Replace `space-y-4` with `space-y-8`.

- [ ] **Step 4: Fix FeatureLibrary (~top)**

Replace `space-y-6` with `space-y-8`.

- [ ] **Step 5: Fix RequestManager (line 218)**

Replace `space-y-6` with `space-y-8`.

- [ ] **Step 6: Fix RevenueDashboard (line 79)**

Replace `space-y-6` with `space-y-8`.

- [ ] **Step 7: Verify build**

Run: `npx vite build`
Expected: builds successfully

- [ ] **Step 8: Commit**

```bash
git add src/components/LlmsTxtGenerator.tsx src/components/PostEditor.tsx src/components/PublishSettings.tsx src/components/FeatureLibrary.tsx src/components/RequestManager.tsx src/components/RevenueDashboard.tsx
git commit -m "fix: standardize page-level spacing to space-y-8 (batch 2)"
```

---

### Task 14: Border Radius Fixes

**Files:**
- Modify: `src/components/AnalyticsAnnotations.tsx` — border radius only (spacing is Task 12)
- Modify: `src/components/Annotations.tsx` — border radius only (spacing is Task 12)
- Modify: `src/components/RequestManager.tsx` — border radius only (line 231)
- Modify: `src/components/PageRewriteChat.tsx` — owns exclusively
- Modify: `src/components/FeatureLibrary.tsx` — border radius only (line 32)
- Modify: `src/components/LinkChecker.tsx` — owns exclusively
- Modify: `src/components/LandingPage.tsx` — owns exclusively

**Must not touch:** Any other file. **Coordinate with Tasks 12/13** — if running in parallel, this task only changes `rounded-xl` → inline `style={{ borderRadius }}`, not the spacing classes.

**Model:** Haiku

- [ ] **Step 1: Fix section cards (10px 24px 10px 24px)**

For each of these locations, replace `rounded-xl` with `style={{ borderRadius: '10px 24px 10px 24px' }}` (and remove `rounded-xl` from className):

| File | Line |
|------|------|
| `AnalyticsAnnotations.tsx` | 90 |
| `Annotations.tsx` | 64 |
| `RequestManager.tsx` | 231 |
| `PageRewriteChat.tsx` | 334 |
| `PageRewriteChat.tsx` | 368 |
| `PageRewriteChat.tsx` | 381 |

If the element already has a `style` prop, merge the `borderRadius` into it. If it has no `style` prop, add `style={{ borderRadius: '10px 24px 10px 24px' }}`.

- [ ] **Step 2: Fix compact/stat cards (6px 12px 6px 12px)**

For each of these locations, replace `rounded-xl` with `style={{ borderRadius: '6px 12px 6px 12px' }}`:

| File | Line |
|------|------|
| `FeatureLibrary.tsx` | 32 |
| `AnalyticsAnnotations.tsx` | 134 |
| `Annotations.tsx` | 102 |
| `LinkChecker.tsx` | 229 |
| `LandingPage.tsx` | 144 |

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add src/components/AnalyticsAnnotations.tsx src/components/Annotations.tsx src/components/RequestManager.tsx src/components/PageRewriteChat.tsx src/components/FeatureLibrary.tsx src/components/LinkChecker.tsx src/components/LandingPage.tsx
git commit -m "fix: apply asymmetric border radius to remaining section and compact cards"
```

---

## Phase 4 — Edge Cases (Parallel, 2 Agents)

### Task 15: StripePaymentForm Theming

**Files:**
- Modify: `src/components/StripePaymentForm.tsx` — owns exclusively

**Must not touch:** Any other file

**Model:** Sonnet

- [ ] **Step 1: Add import**

```typescript
import { themeColor } from './ui/constants';
```

- [ ] **Step 2: Make Stripe Elements theme conditional**

The Stripe Elements `appearance` object (around lines 190-264) contains hardcoded dark colors for backgrounds, borders, and text. Wrap the appearance in a theme-aware conditional:

Find the Stripe Elements options/appearance object and update all dark hex values:

- `#a1a1aa` (text) → `themeColor('#a1a1aa', '#334155')`
- `#52525b` (placeholder) → `themeColor('#52525b', '#94a3b8')`
- `#71717a` (labels) → `themeColor('#71717a', '#64748b')`
- `rgba(24,24,27,0.8)` (background) → `themeColor('rgba(24,24,27,0.8)', 'rgba(255,255,255,0.9)')`
- `rgba(63,63,70,*)` (borders) → `themeColor('rgba(63,63,70,0.5)', 'rgba(203,213,225,0.5)')`
- `rgba(39,39,42,0.5)` (input bg) → `themeColor('rgba(39,39,42,0.5)', 'rgba(241,245,249,0.7)')`

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add src/components/StripePaymentForm.tsx
git commit -m "fix: make Stripe Elements theme colors responsive to light mode"
```

---

### Task 16: OverviewTab + HealthTab + CellDetailPanel + SiteArchitecture

**Files:**
- Modify: `src/components/client/OverviewTab.tsx` — owns exclusively
- Modify: `src/components/client/HealthTab.tsx` — owns exclusively
- Modify: `src/components/matrix/CellDetailPanel.tsx` — owns exclusively
- Modify: `src/components/SiteArchitecture.tsx` — owns exclusively
- Modify: `src/components/WorkspaceHome.tsx` — owns exclusively

**Must not touch:** Any other file

**Model:** Sonnet

- [ ] **Step 1: Add import to OverviewTab**

```typescript
import { themeColor } from '../ui/constants';
```

- [ ] **Step 2: Fix OverviewTab timeline dot (line 434)**

Replace:
```typescript
backgroundColor: '#0f1219'
```
with:
```typescript
backgroundColor: themeColor('#0f1219', '#f8fafc')
```

- [ ] **Step 3: Add import to HealthTab**

```typescript
import { themeColor } from '../ui/constants';
```

- [ ] **Step 4: Fix HealthTab CAT_LABELS fallback (line 807)**

Replace the `#71717a` fallback with:
```typescript
themeColor('#71717a', '#94a3b8')
```

- [ ] **Step 5: Add import to CellDetailPanel**

```typescript
import { themeColor } from '../../ui/constants';
```

Note: verify the relative path from `src/components/matrix/` to `src/components/ui/`.

- [ ] **Step 6: Fix CellDetailPanel timeline dot (line 239)**

Replace:
```typescript
'#71717a'
```
with:
```typescript
themeColor('#71717a', '#94a3b8')
```

- [ ] **Step 7: Add import to SiteArchitecture**

```typescript
import { themeColor } from './ui/constants';
```

- [ ] **Step 8: Fix SiteArchitecture iconColor (line 334)**

Replace the `#71717a` conditional fallback with:
```typescript
themeColor('#71717a', '#94a3b8')
```

- [ ] **Step 9: Add import to WorkspaceHome**

```typescript
import { themeColor } from './ui/constants';
```

- [ ] **Step 10: Fix WorkspaceHome StatCard iconColor props (lines 253, 270, 277, 317)**

Replace all 4 instances of `#71717a` fallback with:
```typescript
themeColor('#71717a', '#94a3b8')
```

- [ ] **Step 11: Verify build**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: zero errors

- [ ] **Step 12: Commit**

```bash
git add src/components/client/OverviewTab.tsx src/components/client/HealthTab.tsx src/components/matrix/CellDetailPanel.tsx src/components/SiteArchitecture.tsx src/components/WorkspaceHome.tsx
git commit -m "fix: make iconColor fallbacks and timeline dots theme-aware"
```

---

## Phase 5 — Verification (Sequential)

### Task 17: Build, Test, Verify, Docs

**Files:**
- Verify: entire codebase
- Modify: `BRAND_DESIGN_LANGUAGE.md` (update with chart helper docs)

**Model:** Opus

- [ ] **Step 1: Run full build + type check**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

Expected: zero errors

- [ ] **Step 2: Run test suite**

```bash
npx vitest run
```

Expected: all tests pass

- [ ] **Step 3: Run pr-check (full scan)**

```bash
npx tsx scripts/pr-check.ts --all
```

Expected: The two new light-mode rules should produce **zero warnings** (all violations fixed). All existing checks pass.

- [ ] **Step 4: Preview light mode screenshots**

Start dev server and toggle light mode. Take screenshots of:
1. Admin dashboard — WorkspaceOverview (StatCards, chart)
2. Client dashboard — OverviewTab (charts, timeline)
3. Any page with ScannerReveal transition
4. MetricRing in light mode
5. Skeleton loading states
6. StripePaymentForm (if accessible)
7. RequestManager (inline style cards)

Verify: no dark backgrounds bleeding through, all charts readable, shimmer visible.

- [ ] **Step 5: Update BRAND_DESIGN_LANGUAGE.md**

Add a section documenting the chart theme helpers:

```markdown
### Chart Theme Helpers (`ui/constants.ts`)

For inline styles and Recharts props that can't use CSS class overrides:

| Helper | Dark | Light | Usage |
|--------|------|-------|-------|
| `chartGridColor()` | `#27272a` | `#e2e8f0` | `<CartesianGrid stroke={chartGridColor()} />` |
| `chartAxisColor()` | `#71717a` | `#64748b` | `<XAxis tick={{ fill: chartAxisColor() }} />` |
| `chartDotStroke()` | `#18181b` | `#f1f5f9` | `activeDot={{ stroke: chartDotStroke() }}` |
| `chartDotFill()` | `#0f1219` | `#ffffff` | `dot={{ fill: chartDotFill() }}` |
| `chartTooltipStyle()` | dark bg/border | white bg/border | `<Tooltip contentStyle={chartTooltipStyle()} />` |
| `themeColor(dark, light)` | returns `dark` | returns `light` | Generic — any two-value switch |

**Rule:** Never use hardcoded dark hex (`#0f1219`, `#18181b`, `#27272a`, `#303036`) in inline styles or SVG attributes. Use these helpers or CSS variables (`var(--brand-bg)`, `var(--brand-bg-card)`).
```

- [ ] **Step 6: Commit docs**

```bash
git add BRAND_DESIGN_LANGUAGE.md
git commit -m "docs: add chart theme helpers to BRAND_DESIGN_LANGUAGE.md"
```

---

## Systemic Improvements Summary

| Improvement | What | Prevents |
|-------------|------|----------|
| Chart theme helpers | 7 functions in `constants.ts` | Future chart components using hardcoded dark hex |
| pr-check rules | 2 new warns in `pr-check.ts` | New inline style / SVG dark hex violations |
| CSS gap overrides | 17 new rules in `index.css` | Opacity variants, gradients, and arbitrary classes breaking in light mode |
| Skeleton shimmer | 1 new CSS rule | Invisible loading states in light mode |
| `--metric-ring-track` CSS var | 1 new variable | MetricRing track color hardcoding |
| BRAND_DESIGN_LANGUAGE docs | Chart helper reference table | Engineers not knowing the helpers exist |

## File Ownership Matrix

| File | Task | Phase |
|------|------|-------|
| `ui/constants.ts` | 1 | 0 |
| `index.css` | 2, 3 | 0 |
| `scripts/pr-check.ts` | 4 | 0 |
| `ScannerReveal.tsx` | 5 | 1 |
| `MetricRing.tsx` | 5 | 1 |
| `AnnotatedTrendChart.tsx` | 6 | 1 |
| `ScoreTrendChart.tsx` | 6 | 1 |
| `client/helpers.tsx` | 7 | 1 |
| `client/AnalyticsTab.tsx` | 7 | 1 |
| `RequestManager.tsx` | 8 (styles) + 13 (spacing) | 2 + 3 |
| `ClientDashboardTab.tsx` | 9 | 2 |
| `BrandHub.tsx` | 9 | 2 |
| `RankTracker.tsx` | 10 | 2 |
| `Roadmap.tsx` | 10 | 2 |
| `WorkspaceOverview.tsx` | 10 | 2 |
| `DropZone.tsx` | 11 | 2 |
| `InternalLinks.tsx` | 11 | 2 |
| `RedirectManager.tsx` | 11 | 2 |
| `WorkspaceSettings.tsx` | 11 | 2 |
| `AnalyticsAnnotations.tsx` | 12 (spacing) + 14 (radius) | 3 |
| `Annotations.tsx` | 12 (spacing) + 14 (radius) | 3 |
| `AssetBrowser.tsx` | 12 | 3 |
| `CmsEditor.tsx` | 12 | 3 |
| `ContentPlanner.tsx` | 12 | 3 |
| `LinksPanel.tsx` | 12 | 3 |
| `LlmsTxtGenerator.tsx` | 13 | 3 |
| `PostEditor.tsx` | 13 | 3 |
| `PublishSettings.tsx` | 13 | 3 |
| `FeatureLibrary.tsx` | 13 (spacing) + 14 (radius) | 3 |
| `RevenueDashboard.tsx` | 13 | 3 |
| `PageRewriteChat.tsx` | 14 | 3 |
| `LinkChecker.tsx` | 14 | 3 |
| `LandingPage.tsx` | 14 | 3 |
| `StripePaymentForm.tsx` | 15 | 4 |
| `client/OverviewTab.tsx` | 16 | 4 |
| `client/HealthTab.tsx` | 16 | 4 |
| `matrix/CellDetailPanel.tsx` | 16 | 4 |
| `SiteArchitecture.tsx` | 16 | 4 |
| `WorkspaceHome.tsx` | 16 | 4 |
| `BRAND_DESIGN_LANGUAGE.md` | 17 | 5 |

**Shared file conflicts:** `RequestManager.tsx` is touched by Task 8 (inline styles, Phase 2) and Task 13 (spacing, Phase 3). Since Phase 2 completes before Phase 3 starts, this is safe — no parallel conflict. Similarly, `AnalyticsAnnotations.tsx`, `Annotations.tsx`, and `FeatureLibrary.tsx` are touched by both spacing (Task 12/13) and radius (Task 14) in Phase 3. Within Phase 3, Tasks 12 and 14 both touch `AnalyticsAnnotations.tsx` and `Annotations.tsx` — **these must be coordinated**: Task 12 changes only `space-y-4` → `space-y-8` on the outer wrapper, Task 14 changes only `rounded-xl` on inner cards. Different lines, but agents should verify no merge conflicts.
