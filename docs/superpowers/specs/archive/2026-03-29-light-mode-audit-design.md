# Light Mode Comprehensive Audit — Design Spec
**Date:** 2026-03-29
**Palette:** Cool Stone (existing values, no re-palette)
**Scope:** Full platform — client dashboard + admin dashboard

---

## Overview

The light mode toggle infrastructure is fully built and wired:
- `.dashboard-light` class applied to root `<div>` in `App.tsx`
- CSS `!important` overrides in `src/index.css` under `.dashboard-light`
- Toggle persisted to `localStorage`, lives in admin sidebar panel and client dashboard header

The work is not building a new system. It is a systematic audit to find every dark color in the platform that either:
(a) has no `.dashboard-light` override (coverage gap), or
(b) has an override that produces illegible, low-contrast, or visually broken results (legibility gap)

No new files. No infrastructure changes. No CSS token migration. Additions only to the `.dashboard-light` block in `src/index.css`, plus targeted fixes to inline styles in components.

---

## What We Are NOT Doing

- Re-paletting the cool stone color values (they are correct)
- Migrating to CSS custom properties / design tokens
- Changing the toggle UX or persistence mechanism
- Collapsing semantic color coding to black/zinc text — teal, blue, green, amber, red, orange, purple must all remain visually distinct in light mode

---

## Six Audit Categories

### 1. Missing Tailwind Class Overrides
The largest category. Any Tailwind color utility used in the codebase that has no `.dashboard-light` rule.

**Method:** Grep every `bg-*`, `text-*`, `border-*`, `divide-*`, `ring-*`, `shadow-*`, `outline-*`, `placeholder-*` color class across `src/`. Cross-reference against existing rules in `index.css`. Every unmatched class is a gap.

Pay special attention to:
- Opacity variants: `bg-zinc-900/50`, `text-zinc-400/60`, `border-zinc-800/30` — each variant needs its own rule or a close approximation
- Arbitrary values: `bg-[#0f1219]`, `text-[#27272a]` — any hardcoded hex in a class string
- `bg-zinc-900` used on the new asymmetric-radius inline-style cards (these use `style={{ borderRadius }}` but still have `bg-zinc-900` as a className — they ARE caught by the existing `.dashboard-light .bg-zinc-900` rule, so these are OK)

### 2. Hardcoded Hex / RGBA in Inline `style={}` Props
These bypass the CSS class system entirely and cannot be overridden by `.dashboard-light` rules.

**Examples to find:**
- `style={{ backgroundColor: '#27272a' }}` or similar zinc hex values
- `style={{ color: '#71717a' }}` or text color inline
- `style={{ borderColor: '...' }}`
- Chart tooltip `style` props (Recharts `<Tooltip contentStyle={{ ... }}>`)
- SVG `fill` and `stroke` attributes with hardcoded dark hex values

**Fix approach:** Replace hardcoded dark hex with either:
- A CSS variable reference: `style={{ backgroundColor: 'var(--brand-bg-card)' }}`
- Or conditionally pick the value based on a `theme` prop if one is already threaded through (check if `ClientDashboard.tsx` receives a `theme` prop — `App.tsx` does pass it down)

**Components most likely to have these:**
- `ScannerReveal.tsx` — overlay `backgroundColor: '#0f1219'` (dark base color, will show dark in light mode)
- Any Recharts chart component with `contentStyle`, `labelStyle`, `itemStyle` on tooltips
- `MetricRing.tsx` — SVG track color `#303036` hardcoded
- `AnomalyAlerts.tsx` — any inline background colors
- `WorkspaceHome.tsx` — inline chart or status colors

### 3. SVG and Chart Colors
Recharts area charts, line charts, pie charts, bar charts use hardcoded color values in JSX props (`stroke`, `fill`, `stroke="#2dd4bf"`). These are not CSS classes and not catchable by overrides.

**Affected components (likely):**
- `AnalyticsTab.tsx` — AreaChart with teal/blue gradients (`linearGradient` stop colors)
- `PageSpeedPanel.tsx` — any chart components
- `ROIDashboard.tsx` — chart fills
- `SalesReport.tsx` — chart colors
- Any component with `<defs><linearGradient>` — gradient stop `stopColor` values are hardcoded

**Fix approach:**
- Teal chart colors (`#2dd4bf`) stay teal — they're brand-appropriate on both backgrounds
- Dark zinc chart backgrounds or tooltip backgrounds need conditional values or CSS var
- Axis label `fill` colors (typically `#71717a`) need a light-mode aware value
- Grid line colors (`#27272a` or `#3f3f46`) need to be lightened for light mode

### 4. Gradient Backgrounds
Complex `bg-gradient-to-*` utilities mix zinc base with teal/blue/amber tints. Some look fine on light; others produce washed-out results.

**Pattern to find:** `from-teal-600/10 via-zinc-900 to-zinc-900` — the `via-zinc-900` and `to-zinc-900` will map to white in light mode (correct), but the gradient blend may look odd or too subtle.

**Approach:** These mostly need additional `.dashboard-light` overrides for the gradient utility itself, adjusting tint strengths (e.g., `from-teal-600/10` → `from-teal-600/8` in light mode, or adding a `.dashboard-light .from-zinc-900 { --tw-gradient-from: #f8fafc }` rule).

### 5. New Components Since Last Light Mode Pass
Components added or significantly modified during the visual polish work that may not have been in scope when light mode was first built.

**Components to check:**
- `ScannerReveal.tsx` — overlay `backgroundColor: '#0f1219'` is the biggest issue (it will flash dark in light mode during page transitions)
- `MetricRing.tsx` — SVG track `#303036` will be invisible on light background; ring arc colors are computed from `scoreColor()` — verify those hex values are readable on `#f8fafc`
- Skeleton shimmer colors in `Skeleton.tsx` — `bg-zinc-800` shimmer on `bg-zinc-900` base → light mode maps both to very similar values, shimmer may disappear
- Any component using `staggerFadeIn` animation — opacity-based, fine in both modes
- Asymmetric-radius card containers — use `style={{ borderRadius }}` only, `bg-zinc-900` class is caught by existing rule

### 6. Legibility Audit of Existing Overrides
Verify that existing `.dashboard-light` overrides produce readable, high-contrast results in practice — not just that a rule exists.

**Key contrast ratios to verify (WCAG AA = 4.5:1 for normal text, 3:1 for large text):**

| Element | Light mode color | Background | Target ratio |
|---|---|---|---|
| Primary text (`text-zinc-100` → `#0f172a`) | `#0f172a` | `#f8fafc` | ≥ 7:1 ✓ |
| Secondary text (`text-zinc-400` → `#1e293b`) | `#1e293b` | `#f8fafc` | ≥ 4.5:1 — verify |
| Muted text (`text-zinc-500` → `#334155`) | `#334155` | `#f8fafc` | ≥ 4.5:1 — verify |
| Teal text (`text-teal-400` → `#0d9488`) | `#0d9488` | `#f8fafc` | ≥ 4.5:1 — verify |
| Teal on teal-tinted bg | `#0d9488` | `rgba(13,148,136,0.08)` | ≥ 4.5:1 — verify |
| Amber warning text | `#b45309` | `#f8fafc` | ≥ 4.5:1 — verify |
| Red error text | `#dc2626` | `#f8fafc` | ≥ 4.5:1 — verify |

**Specific places known to be "dicey":**
- Muted/subtle text at `text-zinc-600` level — the override may map to a color that's still too light
- Teal text on teal-tinted card backgrounds (gradient cards, AI insight cards)
- Amber warning text on amber-tinted backgrounds
- Any text using `text-zinc-700` or `text-zinc-800` (originally designed to be nearly invisible in dark mode — their light mode mapping may actually make them too prominent or still too subtle)
- `text-[11px]` small text at reduced opacity — harder to read at small sizes in any mode

---

## Color Coding Preservation Contract

These semantic colors must remain visually distinct in light mode. Auditors must verify each one looks purposeful (not muddy or washed out):

| Role | Dark value | Light target | Min contrast on `#f8fafc` |
|---|---|---|---|
| **Teal** — interactive, CTA, active | `#2dd4bf` | `#0d9488` (teal-600) | 4.5:1 |
| **Blue** — data metrics, read-only | `#60a5fa` | `#2563eb` (blue-600) | 4.6:1 |
| **Emerald** — success, positive delta | `#34d399` at 80% | `#047857` (emerald-700) | 5.5:1 |
| **Amber** — warning, change | `#fbbf24` at 80% | `#b45309` (amber-700) | 5.4:1 |
| **Red** — error, negative delta | `#f87171` at 80% | `#dc2626` (red-600) | 4.6:1 |
| **Orange** — change-requested | `#fb923c` | `#c2410c` (orange-700) | 5.2:1 |
| **Purple** — admin AI only | `#c084fc` | `#7c3aed` (violet-600) | 4.6:1 |

Background tints must also remain visually distinct — `bg-teal-500/10` in light mode should produce a noticeably teal-tinted card, not a near-white blob.

---

## Critical Fix: ScannerReveal in Light Mode

`ScannerReveal.tsx` has a hardcoded `backgroundColor: '#0f1219'` on the overlay div. In light mode this flashes a dark overlay during every page transition — visible and jarring.

**Required fix:** Make the overlay color theme-aware. Two options:
1. Replace with `backgroundColor: 'var(--brand-bg)'` — the CSS variable already updates in light mode
2. Accept a `theme` prop and conditionally set the color

Option 1 is preferred (no prop threading needed, CSS var already defined correctly in `.dashboard-light`).

---

## Critical Fix: MetricRing Track Color

`MetricRing.tsx` has a hardcoded SVG track color `#303036` (near-invisible dark gray). On a `#f8fafc` light background, this will render as a dark circle — actually fine, but visually harsh and inconsistent with the light aesthetic. Should be `#e2e8f0` (light border color) in light mode.

**Fix:** Replace hardcoded `#303036` with `var(--metric-ring-track, #303036)` and add `.dashboard-light { --metric-ring-track: #e2e8f0; }`.

---

## Skeleton Shimmer Fix

`Skeleton.tsx` shimmer effect uses `bg-zinc-800` animating over `bg-zinc-900`. In light mode both map to white/near-white — shimmer becomes invisible.

**Fix:** Add `.dashboard-light .animate-shimmer` (or the relevant animation class) with adjusted light-mode shimmer colors (`bg-slate-200` over `bg-slate-100`).

---

## Implementation Approach

**Phase 1 — Grep audit:** Systematically extract every Tailwind color class in use across `src/`, diff against existing `.dashboard-light` rules, build a gap list.

**Phase 2 — Coverage fixes:** Add missing `.dashboard-light` rules to `src/index.css`. Touch only the CSS file for class-based fixes.

**Phase 3 — Inline style fixes:** Fix the three critical inline-style issues (ScannerReveal overlay, MetricRing track, chart tooltip backgrounds). These require edits to the component files.

**Phase 4 — Legibility review:** Manual toggle-and-scan pass across every tab in both dashboards. Fix any contrast issues found. Verify all semantic colors are distinct.

**Phase 5 — Chart audit:** Check each Recharts chart component in light mode. Fix axis label fills, grid line colors, tooltip backgrounds.

---

## Definition of Done

Toggle light mode → manually navigate every page/tab in both dashboards → zero instances of:
- Dark zinc backgrounds bleeding through (remaining dark in light mode)
- Text with insufficient contrast (< 4.5:1 for body text, < 3:1 for large text)
- A semantic color (teal/blue/green/amber/red/orange/purple) rendering as black or zinc instead of its colored variant
- Charts that are unreadable (dark tooltips, invisible grid lines, dark axis labels)
- Skeleton shimmers that have disappeared
- ScannerReveal flashing dark on page transition in light mode
- Gradients that look broken or completely flat

All existing automated tests still pass. No dark mode regressions.
