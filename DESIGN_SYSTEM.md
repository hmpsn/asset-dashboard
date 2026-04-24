# hmpsn.studio — Unified Design System

> This document is the single source of truth for all UI patterns across the admin dashboard
> and client dashboard. Every component should reference these specs. When in doubt, check here.
>
> **For color rules, per-component color map, admin vs. client decisions, and AI prompting
> guidelines, see `BRAND_DESIGN_LANGUAGE.md`.** This doc covers component specs and Tailwind
> classes; the brand doc covers *when and why* to use each color.

---

## Fonts

| Role | Font | Weight | Tracking |
|------|------|--------|----------|
| **Body text** | Inter | 450 | -0.01em |
| **Headings (h1–h6)** | DIN Pro | 600 | -0.02em |
| **Stat numbers** | DIN Pro | 700 | -0.03em |
| **Bold text (.font-bold)** | DIN Pro | 700 | inherit |
| **Nav / UI chrome** | DIN Pro | 500 | inherit |
| **Labels (uppercase)** | DIN Pro | 500 | 0.05em |
| **Tabular numbers** | DIN Pro | inherit | inherit |

### Font Files
Self-hosted OTF in `/public/fonts/`: D-DIN-PRO 400–900.
Inter loaded from Google Fonts: 300–700.

---

## Typography Scale

| Token | Size | Line-height | Usage |
|-------|------|-------------|-------|
| `stat-hero` | 34px (text-3xl) | 1.15 | Hero stat numbers in score rings, main KPIs |
| `stat-default` | 28px (text-2xl) | 1.2 | Standard stat card numbers |
| `stat-compact` | 24px (text-xl + font-bold) | 1.3 | Compact inline stat numbers |
| `page-title` | 18px (text-lg) | 1.35 | Page headers, section titles |
| `section-header` | 14px (text-sm) | 1.5 | Card section headers |
| `body` | 14px (text-sm) | 1.5 | Body text, descriptions |
| `label` | 12px (text-[11px] → 12px) | 1.5 | Uppercase labels, captions, metadata |
| `caption` | 12px (text-xs) | 1.45 | Secondary captions, timestamps |

### Rules
- **Minimum font size**: 12px (CSS overrides text-[11px] to 12px)
- **No grey text below zinc-500** on dark backgrounds
- **DIN Pro on all numbers** that represent metrics/stats

---

## Color System

### Dark Mode (default)

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| `--bg-base` | #0f1219 | — | Page background |
| `--bg-card` | #18181b | bg-zinc-900 | Card backgrounds |
| `--bg-elevated` | #27272a | bg-zinc-800 | Inputs, active tabs, hover states |
| `--border-default` | #27272a | border-zinc-800 | Card borders |
| `--border-hover` | #3f3f46 | border-zinc-700 | Hover border state |
| `--text-primary` | #f4f4f5 | text-zinc-100/200 | Headings, key content |
| `--text-secondary` | #b4b4bc | text-zinc-400 | Descriptions, supporting text |
| `--text-muted` | #a1a1aa | text-zinc-500 | Captions, timestamps, labels |
| `--text-subtle` | #71717a | text-zinc-600/700 | Disabled, dividers |

### Light Mode (.dashboard-light)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-base` | #ffffff | Page background |
| `--bg-card` | #ffffff | Card backgrounds |
| `--bg-elevated` | #f1f5f9 | Inputs, active tabs |
| `--border-default` | #e2e8f0 | Card borders |
| `--text-primary` | #0f172a | Dark navy — headings, key content |
| `--text-secondary` | #334155 | Descriptions |
| `--text-muted` | #475569 | Captions, labels |
| `--text-subtle` | #64748b | Disabled |

### Accent Colors

| Name | Dark Mode | Light Mode | Contrast | Usage |
|------|-----------|------------|----------|-------|
| Teal (brand) | #2dd4bf | #0d9488 | 4.5:1 | Primary accent, active states, CTAs |
| Blue | #60a5fa | #2563eb | 4.6:1 | Clicks, links, info |
| Emerald | #34d399 | #047857 | 5.5:1 | Success, good scores (80+) |
| Green | #4ade80 | #15803d | 5.2:1 | Positive deltas |
| Amber | #fbbf24 | #b45309 | 5.4:1 | Warnings, medium scores (60-79) |
| Red | #f87171 | #dc2626 | 4.6:1 | Errors, bad scores (<60) |
| Orange | #fb923c | #c2410c | 5.2:1 | Attention, urgent |
| Cyan | #22d3ee | #0e7490 | 5.6:1 | Asset tools, social, navigational intent |
| Sky | #38bdf8 | #0369a1 | 7.0:1 | Accessibility category |
| Yellow | #eab308 | #a16207 | 5.2:1 | Warnings (SalesReport, AssetAudit) |
| Purple | #a78bfa | #7c3aed | 4.6:1 | **Admin AI chat only** (AdminChat, SeoAudit "Flag for Client"). Never client-facing. See `BRAND_DESIGN_LANGUAGE.md` § 2 |

> **Contrast column** = ratio against white (#fff) in light mode. All meet WCAG AA (≥4.5:1).

---

## Component Specs

### 1. StatCard

The primary data display component. Three variants based on context.

#### Variant: `default` (most common)
```
┌─────────────────────────────┐
│ [Icon] Label                │  ← 12px uppercase tracking-wider text-zinc-500, DIN Pro 500
│                             │
│ 1,234                       │  ← 28px (text-2xl) DIN Pro 700, colored or text-zinc-100
│ optional sub-text           │  ← 12px text-zinc-500
└─────────────────────────────┘
```
- Container: `bg-zinc-900 border border-zinc-800 p-3` with `style={{ borderRadius: '6px 12px 6px 12px' }}`
- Icon: `w-4 h-4` in accent color, left of label
- Optional: delta indicator next to value (emerald-400/80 positive, red-400/80 negative)
- Stagger entrance: `staggerIndex` prop (0-based, adds 60ms delay per index)

#### Variant: `size="hero"` (top-of-page impact stats)
```
┌─────────────────────────────┐
│ [Icon] Label                │  ← 12px uppercase text-zinc-500
│                             │
│ 12,400                      │  ← 36px (text-4xl) DIN Pro 700
│ optional sub-text           │
└─────────────────────────────┘
```
- Container: `p-4` (vs `p-3` default) with same asymmetric radius
- Number: `text-4xl` (36px) for impact. Use `size="hero"` on the first StatCard row of each page.

#### Variant: `compact` (`CompactStatBar`)
```
┌──────────────────────────────────────────────────────┐
│  CLICKS  1,234  │  IMPRESSIONS  45,678  │  CTR  3.2% │
└──────────────────────────────────────────────────────┘
```
- Container: `bg-zinc-900 border border-zinc-800 px-5 py-3` with `style={{ borderRadius: '6px 12px 6px 12px' }}`
- Horizontal flex layout
- Label: 12px uppercase tracking-wider text-zinc-500
- Value: DIN Pro 700, colored

### 2. MetricRing (unified — replaces 3 implementations)

Single component for all score ring displays.

```tsx
<MetricRing score={81} size={140} />
```

- SVG circle with stroke animation
- Score number: DIN Pro 700, `size * 0.38` fontSize (40px at default 120px), `-0.03em` tracking. Number fades in at 0.8s.
- Color: auto from `scoreColor()` (≥80 emerald, ≥60 amber, <60 red)
- Stroke width: 8px for large (≥100), 6px for medium, 4px for small (≤48)
- Background track: `#303036`
- Outward glow: `box-shadow` on pseudo-element behind SVG (emerald inner → teal outer). Bloom fades in at 2s.
- Edge ring: 1px teal border at 15% opacity, fades in with glow.
- `noAnimation` prop: disables all animations for compact/inline usage (size < 80 also auto-disables)

### 3. PageHeader

Consistent top section for every page/tab.

```
┌──────────────────────────────────────────────────────┐
│ Page Title                          [Actions] [Filter]│
│ Optional subtitle / date range                        │
└──────────────────────────────────────────────────────┘
```

- Title: `text-lg font-semibold text-zinc-200` (DIN Pro 600)
- Subtitle: `text-xs text-zinc-500 mt-0.5`
- Actions area: right-aligned flex row
- No container (sits directly in page flow with `space-y-5` gap)

### 4. SectionCard

Standard card container for content sections.

```
┌──────────────────────────────────────────────────────┐
│ Section Title                        [optional action]│  ← header row (optional)
│──────────────────────────────────────────────────────│
│ Content                                               │
└──────────────────────────────────────────────────────┘
```

- Container: `bg-zinc-900 border border-zinc-800` with `style={{ borderRadius: '10px 24px 10px 24px' }}`
- With header: `px-4 py-3 border-b border-zinc-800` top row (radius: `10px 24px 0 0`), content in `p-4`
- Without header: `p-4`
- Section title: `text-sm font-semibold text-zinc-200` (NOT uppercase)
- Action buttons: `text-xs font-medium text-teal-400`
- `interactive` prop: adds teal left-border accent on hover (`hover:border-l-teal-500/40`) for clickable cards
- `staggerIndex` prop: entrance animation delay (0-based, 60ms per index)

### 4a. ChartCard

Thin `SectionCard` wrapper with chart-friendly defaults. Used for sparkline/mini-chart panels where the header needs to fit a title plus a directional trend indicator inline.

```
┌──────────────────────────────────────────────────────┐
│ Title  ↗ +12.4%                        [optional action]│  ← inline title + TrendBadge
│ <chart body>                                          │
└──────────────────────────────────────────────────────┘
```

- Container: same `bg-[var(--surface-2)] border-zinc-800` + signature `10px 24px 10px 24px` radius as SectionCard
- Tighter padding than SectionCard: header `px-4 py-3`, body `px-4 pb-3`
- No `border-b` separator — chart visuals flow directly under header
- `trend?: number` prop renders an inline `<TrendBadge>` next to the title; `trendProps` passes through (`invert`, `showSign`, `label`, etc.)
- Omit all header props → header row doesn't render, body gets `px-4 py-3`

### 4b. TrendBadge

Canonical directional delta indicator. Replaces hand-rolled `TrendingUp/Down + emerald/red-400` ternaries across the app.

```
↗ +12.4%        ↘ -3.2%        — 0%
```

- Positive (or negative with `invert`): `text-emerald-400` + `TrendingUp` icon
- Negative (or positive with `invert`): `text-red-400` + `TrendingDown` icon
- Zero (only when `hideOnZero={false}`): `text-zinc-400` + `Minus` icon
- Props:
  - `value: number` — raw delta (e.g. `-12.4` or `3`)
  - `suffix='%'` — unit string appended after the number
  - `invert=false` — flip color mapping (use when lower = better, e.g. position, error count)
  - `showSign=false` — show `+`/`-` sign prefix (default shows `Math.abs(value)`)
  - `label?: string` — optional trailing context string (e.g. `"vs last month"`)
  - `size='sm' | 'md'` — `sm` = `text-[11px]` + `w-3 h-3` icon (default), `md` = `text-xs` + `w-3.5 h-3.5`
  - `hideOnZero=true` — return `null` when `value === 0` (override to `false` to keep a neutral Minus visible)
- Always use `<TrendBadge>` instead of inlining `TrendingUp/Down` + emerald/red. Enforced by the pr-check `Hand-rolled trend badge` warn rule.

### 5. DateRangeSelector

**ONE pattern** for all date/period selectors (replaces 3 current styles).

```
┌────────────────────────────────────┐
│ [7d] [28d] [90d] [6mo] [1y]       │
└────────────────────────────────────┘
```

- Container: `flex items-center gap-1 bg-zinc-900 rounded-lg border border-zinc-800 p-0.5`
- Active: `bg-zinc-700 text-zinc-200 rounded-md`
- Inactive: `text-zinc-500 hover:text-zinc-300 rounded-md`
- Button padding: `px-3 py-1.5`
- Text: `text-xs font-medium`

### 6. DataList

For ranked lists (top pages, keywords, sources).

```
┌──────────────────────────────────────────────────────┐
│  1  Page title or keyword              1,234          │
│  2  Another item                         987          │
│  3  Third item                           654          │
└──────────────────────────────────────────────────────┘
```

- Row: `flex items-center gap-2 text-xs py-1.5`
- Rank: `text-zinc-500 w-5 text-right flex-shrink-0 tabular-nums`
- Label: `text-zinc-300 truncate flex-1 min-w-0`
- Value: `text-zinc-400 flex-shrink-0 tabular-nums`

### 7. Badge

```
┌────────────┐
│ Label text  │
└────────────┘
```

- Standard: `text-[11px] px-1.5 py-0.5 rounded font-medium bg-{color}-500/10 text-{color}-400`
- Muted: `text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500`

### 8. EmptyState

Centered placeholder when data isn't available.

```
        ┌───────┐
        │ Icon  │
        └───────┘
     Primary message
   Secondary description
      [Optional CTA]
```

- Icon container: `w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center`
- Icon: `w-8 h-8 text-zinc-500`
- Primary: `text-sm text-zinc-400`
- Secondary: `text-xs text-zinc-500 max-w-md text-center`
- Layout: `flex flex-col items-center justify-center py-16 gap-3`

### 9. TabBar (sub-navigation)

For switching between sub-views within a page.

- Style: Underline tabs (border-b-2)
- Active: `border-teal-500 text-teal-300`
- Inactive: `border-transparent text-zinc-500 hover:text-zinc-300`
- Container: `flex items-center gap-1 border-b border-zinc-800`
- Button: `flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px`

### 10. Table

```
┌──────────────────────────────────────────────────────┐
│ Header 1          Header 2         Header 3          │
│──────────────────────────────────────────────────────│
│ Cell              Cell             Cell               │
│ Cell              Cell             Cell               │
└──────────────────────────────────────────────────────┘
```

- Container: `bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden`
- Header: `text-[11px] text-zinc-500 uppercase tracking-wider font-medium`
- Header cell: `py-3 px-4` (first col), `py-3 px-3` (others)
- Body row: `border-b border-zinc-800/50 hover:bg-zinc-800/30`
- Body cell: `py-2.5 px-3/4 text-xs`
- Primary column: `text-zinc-300 font-medium`
- Numeric columns: `text-right tabular-nums`

### 11. OnboardingChecklist

Full-screen modal overlay guiding users through initial workspace setup. Shown on first workspace visit until dismissed or all steps complete.

- Overlay: `fixed inset-0 z-50 bg-black/60 backdrop-blur-sm`
- Panel: `relative w-full max-w-lg bg-zinc-900 border border-zinc-800 shadow-2xl`, `borderRadius: '10px 24px 10px 24px'`
- Progress bar: `bg-blue-500` (data color — read-only metric)
- Completed step icon: `text-teal-400 CheckCircle` (action/completion)
- Pending step icon: `text-zinc-600 Circle`
- Celebration state: full-panel centered layout with `text-teal-400` checkmark, auto-dismisses after 2s
- Accessibility: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus trap, Escape key handler
- Dismiss: backdrop click, Escape key, "Dismiss for now" footer link, or auto-dismiss on completion
- Workspace scope: dismissed state stored in `localStorage` per workspace (`onboarding_checklist_dismissed_${workspaceId}`)
- Props: `steps: OnboardingStep[]`, `onDismiss`, `onComplete?`, `title?`

### 12. WorkflowStepper

Horizontal numbered step indicator showing progress through a multi-step workflow. Read-only; steps with `onClick` are clickable to navigate.

- Variants: default (`w-8 h-8` circles) and `compact` (`w-6 h-6`)
- Current step: `bg-teal-500/10 border-2 border-teal-500 text-teal-400` + ring glow
- Completed step: `bg-green-500/10 border-2 border-green-500/40 text-green-400` + `CheckCircle` icon
- Future step: `bg-zinc-800/50 border-2 border-zinc-700 text-zinc-500`
- Connector line: `h-px bg-zinc-700` between steps
- Clickable steps show teal hover feedback (`group-hover:border-teal-500`)
- Accessibility: `<nav aria-label="Workflow steps">`, `<ol role="list">`, `aria-current="step"` on current clickable step
- Props: `steps: WorkflowStep[]`, `compact?: boolean`

### 13. WorkspaceHealthBar

Dashboard widget showing progress metrics for workspace health dimensions (SEO score, setup completion, content pipeline) with actionable recommendations.

- Wraps `<SectionCard title="Workspace Health">`
- Metric rows: `<button type="button">` with `cursor-pointer group` for clickable metrics
- Progress bars: `bg-blue-500` fill (data color — read-only metrics), clamped to 0–100
- Metric label hover: `group-hover:text-zinc-200` (on clickable rows)
- Recommendations section: teal arrow `→` with `hover:text-teal-400` on each item
- Accessibility: `role="progressbar"` on bar, `aria-valuenow/min/max`, `aria-label` on metric button
- Props: `metrics: HealthMetric[]`, `recommendations?: { label, onClick, estimatedTime? }[]`

### 14. ConfirmDialog

Centered modal overlay for confirming destructive or irreversible actions. Replaces `window.confirm()` throughout the client portal.

- Overlay: `fixed inset-0 z-50 flex items-center justify-center`, backdrop `var(--brand-overlay, rgba(15,23,42,0.35))`, click dismisses
- Panel: `bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl`
- Title: `text-zinc-100 font-semibold text-base`
- Message: `text-zinc-400 text-sm leading-relaxed`
- Cancel button: `text-zinc-400 border border-zinc-700 hover:bg-zinc-800`
- Confirm button (default variant): teal gradient (`from-teal-600 to-emerald-600`)
- Confirm button (destructive variant): `bg-red-600 hover:bg-red-500`
- Keyboard: Escape → cancel, Enter → confirm (skipped when a button already has focus to avoid double-fire)
- Props: `open`, `title`, `message`, `confirmLabel?`, `cancelLabel?`, `onConfirm`, `onCancel`, `variant?: 'default' | 'destructive'`

### 15. Button

| Variant | Classes |
|---------|---------|
| **Primary** | `bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-lg px-3 py-2 text-xs font-medium` |
| **Secondary** | `bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg px-3 py-1.5 text-xs font-medium` |
| **Ghost** | `text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md px-2 py-1 text-xs font-medium` |
| **Accent text** | `text-teal-400 hover:bg-zinc-800 rounded-md px-2 py-1 text-xs font-medium` |

---

## Spacing

| Context | Value |
|---------|-------|
| Page-level gap between sections | `space-y-5` (20px) |
| Card internal padding | `p-4` (16px) standard, `p-3` (12px) compact stat cards |
| Card header padding | `px-4 py-3` |
| Grid gap | `gap-3` (12px) for stat cards, `gap-4/5` for content sections |
| Stat card grid | `grid-cols-2 sm:grid-cols-4` (4-col default), adapt to data count |

---

## Interaction Patterns

| Pattern | Spec |
|---------|------|
| Card hover | `border-color → zinc-700, box-shadow: 0 4px 24px -4px rgba(0,0,0,0.3)` |
| Button transition | `transition-colors` (0.15s ease) |
| Active tab | `bg-zinc-700 text-zinc-200` (segmented) or `border-teal-500 text-teal-300` (underline) |
| Loading spinner | `Loader2` icon with `animate-spin text-zinc-500` or `text-teal-400` |
| Skeleton loading | `Skeleton` primitive: `animate-pulse rounded-md bg-zinc-800`. Composed variants: `StatCardSkeleton`, `SectionCardSkeleton`, `OverviewSkeleton`, `AnalyticsSkeleton` |

---

## File Structure

```
src/components/ui/
├── StatCard.tsx            # Default, hero, and compact stat displays
├── MetricRing.tsx          # Unified score ring (replaces 3 implementations)
├── MetricRingSvg.tsx       # SVG-only sub-component used by MetricRing
├── MetricToggleCard.tsx    # Toggleable stat card for chart series visibility (active/inactive states)
├── PageHeader.tsx          # Consistent page header
├── SectionCard.tsx         # Standard card container
├── DateRangeSelector.tsx   # Unified date/period picker
├── DataList.tsx            # Ranked list display
├── Badge.tsx               # Status/category pill
├── EmptyState.tsx          # Placeholder for empty/unconfigured states
├── ErrorState.tsx          # Error display with retry action; includes NetworkError, DataError, PermissionError helpers
├── LoadingState.tsx        # Spinner + contextual message; also exports Skeleton and TableSkeleton
├── TabBar.tsx              # Sub-navigation tabs
├── Skeleton.tsx            # Shimmer/skeleton loading placeholders (5 variants)
├── AIContextIndicator.tsx  # AI data source completeness bar
├── StatusBadge.tsx         # Unified status badges with statusConfig color map
├── TierGate.tsx            # Tier lock overlay + TierBadge
├── OnboardingChecklist.tsx # Full-screen modal guiding users through initial workspace setup
├── WorkflowStepper.tsx     # Horizontal numbered step indicator for multi-step workflows
├── WorkspaceHealthBar.tsx  # Dashboard widget showing workspace health metrics with recommendations
├── ConfirmDialog.tsx       # Centered modal for confirming destructive/irreversible actions
├── NextStepsCard.tsx       # Card listing actionable next steps with teal hover CTA rows
├── ProgressIndicator.tsx   # Running/complete/idle progress bar with indeterminate support
├── CharacterCounter.tsx    # Inline character count (current/max) with color thresholds at 80%/95%
├── FeatureFlag.tsx         # Conditionally renders children based on a FeatureFlagKey
├── ScannerReveal.tsx       # Page-transition overlay: teal beam sweeps content container on route change
├── SerpPreview.tsx         # Google SERP result preview (title, URL, description) for SEO editors
├── SocialPreview.tsx       # Social sharing card preview for Facebook and Twitter/X
├── constants.ts            # scoreColor, scoreColorClass, scoreBgBarClass, DATE_PRESETS
├── statusConfig.ts         # Status→color mapping for StatusBadge
├── index.ts                # Barrel export
```

---

## § 17 Form Primitives (Phase 5 — 2026-04-24)

Thin wrappers over dark-theme inputs with mint focus ring + error states.
Live in `src/components/ui/forms/`. Each forwards refs and merges `className`
via `cn()`. FormField generates a `useId()` and pipes it to child inputs via
Context so `<label htmlFor>` ↔ `<input id>` is wired automatically.

| Primitive | API | Behavior |
|-----------|-----|----------|
| **FormField** | `label`, `error?`, `hint?`, `required?`, `children` | Wraps input with label above + error/hint below. Generates `inputId` + `descriptionId` via Context for a11y. forwardRef to the wrapping div. |
| **FormInput** | `value`, `onChange(value)`, `type?`, `placeholder?`, plus HTMLInput attrs (minus `onChange`) | Native input with mint focus ring. Reads error state + id from FormFieldContext. |
| **FormSelect** | `options={[{value,label}]}`, `value`, `onChange(value)`, `placeholder?`, plus HTMLSelect attrs (minus `onChange`, `children`, `multiple`) | Select with the same dark-theme styling. Accepts `size`, `autoFocus`, `form`, `name`, etc. through rest spread. `multiple` is intentionally Omit'd — the single-string onChange can't represent multi-select; build a dedicated MultiSelect primitive if needed. |
| **FormTextarea** | `value`, `onChange(value)`, `rows?`, `maxLength?` | Textarea with optional character counter (turns red at ≥90% of limit). |
| **Checkbox** | `checked`, `onChange(boolean)`, `label` (required), `disabled?` | Custom visual checkbox over hidden native input — Space-key + a11y preserved. Mint on checked (Law 01). |
| **Toggle** | `checked`, `onChange(boolean)`, `label` (required), `disabled?` | `role="switch"` with implicit aria-checked. Mint track on (Law 01), knob slides with transition. |

### Validation states

- **Default**: `border-zinc-700`, `focus:border-[var(--brand-mint)]` + `focus:ring-2 focus:ring-[var(--brand-mint-glow)]`
- **Error** (FormField `error="…"` set): `border-red-500/50`, `aria-invalid="true"`, `aria-describedby` → error id. Error message `text-red-400 role="alert"`.
- **Hint** (FormField `hint="…"` set, no error): `aria-describedby` → hint id. Hint `text-zinc-500`.
- **Disabled**: `opacity-50`, `cursor-not-allowed` on the wrapping label and the input.

### `required` flag

Adds a visible red asterisk after the label text and propagates `required` into the Context. Does NOT set the native `required` attribute automatically — callers pass it to the input as needed.

---

## Text Casing Conventions

| Context | Casing | CSS Classes |
|---------|--------|-------------|
| **Stat card labels** | ALL CAPS (via CSS) | `uppercase tracking-wider font-medium` |
| **Table column headers** | ALL CAPS (via CSS) | `uppercase tracking-wider font-medium` |
| **Section card titles** | Title Case | (no uppercase class) |
| **Tab labels** | Title Case | (no uppercase class) |
| **Badge text** | As-provided | (no uppercase class) |
| **Button text** | Title Case | (no uppercase class) |
| **Page headers** | Title Case | (no uppercase class) |

**Rule**: If it's a small label beneath or beside a metric number, use `uppercase tracking-wider`. If it's a section header, tab, or button, use Title Case.

---

## WCAG Accessibility

### Text Contrast (AA = ≥4.5:1 for normal text, ≥3:1 for large text)

- All accent text colors in light mode are mapped to darker shades that meet AA on white
- Dark mode text is boosted (zinc-500 → #a1a1aa, zinc-400 → #b4b4bc) for readability
- Minimum font size enforced at 12px (text-[11px] overridden to 12px)

### Interactive Elements

- All buttons have `transition-colors` for hover feedback
- Focus rings: `2px solid teal` with `2px offset` on `:focus-visible`
- Clickable cards: `hover:border-zinc-700` + subtle shadow lift
- Tinted pill buttons (bg-X-600/20 text-X-300): text color maps to ≥4.5:1 shade in light mode

### Color-Only Indicators

- Score rings use both color AND numeric value
- Severity badges use both color AND icon (AlertTriangle, Info, CheckCircle)
- Delta indicators use both color AND directional arrow (↑/↓)

---

## Migration Checklist

When refactoring a component:
1. Replace ad-hoc page headers with `<PageHeader>`
2. Replace stat card markup with `<StatCard>` (choose variant)
3. Replace score rings with `<MetricRing>`
4. Replace date selectors with `<DateRangeSelector>`
5. Replace card wrappers with `<SectionCard>`
6. Replace ranked lists with `<DataList>`
7. Replace empty states with `<EmptyState>`
8. Verify text hierarchy matches the Typography Scale above
9. Verify colors match the Color System above
10. Test in both dark and light mode
