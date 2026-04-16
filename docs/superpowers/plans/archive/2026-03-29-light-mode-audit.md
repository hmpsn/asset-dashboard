# Light Mode Comprehensive Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Systematically fix every dark-mode color that bleeds through in light mode — coverage gaps in Tailwind classes, hardcoded hex in inline styles, SVG/chart colors, and Skeleton shimmer.

**Architecture:** All class-based fixes go into the single `.dashboard-light` block in `src/index.css`. Inline-style fixes are targeted edits to individual component files. No new files, no new infrastructure.

**Tech Stack:** TailwindCSS 4, React 19, Recharts, inline SVG, CSS `!important` overrides under `.dashboard-light`

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Modify | `src/index.css` | Add missing `.dashboard-light` overrides for opacity variants and gap classes |
| Modify | `src/components/ui/ScannerReveal.tsx` | `backgroundColor: '#0f1219'` → `var(--brand-bg)` |
| Modify | `src/components/ui/MetricRing.tsx` | `stroke="#303036"` → `stroke="var(--metric-ring-track, #303036)"` (×2) |
| Modify | `src/components/ui/Skeleton.tsx` | Add `.dashboard-light .bg-zinc-800` note (already covered) — add shimmer animation override |
| Modify | `src/components/charts/AnnotatedTrendChart.tsx` | CartesianGrid stroke, axis tick fill, tooltip contentStyle/labelStyle |
| Modify | `src/components/audit/ScoreTrendChart.tsx` | CartesianGrid stroke, axis tick fill, active dot stroke |
| Modify | `src/components/client/helpers.tsx` | `DarkTooltip` bg/border classes, activeDot strokes |
| Modify | `src/components/RankTracker.tsx` | Grid line stroke, axis text fill |
| Modify | `src/components/Roadmap.tsx` | Grid line stroke, data dot fill |

---

## Task 1: CSS Coverage Gaps — Opacity Variants

**Files:**
- Modify: `src/index.css` (inside `.dashboard-light { }` block)

The existing `.dashboard-light` block covers base zinc classes but not opacity variants like `bg-zinc-800/40`. These appear throughout the codebase (493 matches across 125 files per grep). This task adds overrides for all identified gap variants.

- [ ] **Step 1: Confirm the gap classes still exist in the codebase**

```bash
grep -rn "bg-zinc-800/\|bg-zinc-900/\|bg-zinc-950/\|bg-zinc-700/\|bg-zinc-600[^/]" src/ --include="*.tsx" | grep -v "node_modules" | wc -l
```
Expected: non-zero count. Note which variants appear most.

- [ ] **Step 2: Locate the end of the `.dashboard-light` block in `src/index.css`**

Search for the last rule inside `.dashboard-light {` — it's at the bottom of the file. The new rules go inside this same block.

Run: `grep -n "dashboard-light" src/index.css | tail -5`

- [ ] **Step 3: Add coverage for opacity variants and gap classes**

Find the closing `}` of `.dashboard-light` in `src/index.css` and append these rules **before** that closing brace:

```css
/* ── Opacity variant coverage gaps ── */
.dashboard-light .bg-zinc-800\/40 { background-color: rgba(241, 245, 249, 0.7) !important; }
.dashboard-light .bg-zinc-800\/20 { background-color: rgba(241, 245, 249, 0.5) !important; }
.dashboard-light .bg-zinc-800\/80 { background-color: rgba(226, 232, 240, 0.85) !important; }
.dashboard-light .bg-zinc-900\/60 { background-color: rgba(248, 250, 252, 0.85) !important; }
.dashboard-light .bg-zinc-950\/50 { background-color: rgba(248, 250, 252, 0.8) !important; }
.dashboard-light .bg-zinc-950\/60 { background-color: rgba(248, 250, 252, 0.9) !important; }
.dashboard-light .bg-zinc-700\/50 { background-color: rgba(226, 232, 240, 0.6) !important; }
.dashboard-light .bg-zinc-700\/30 { background-color: rgba(226, 232, 240, 0.4) !important; }
.dashboard-light .bg-zinc-600 { background-color: #cbd5e1 !important; }
.dashboard-light .border-zinc-800\/30 { border-color: rgba(148, 163, 184, 0.3) !important; }
.dashboard-light .border-zinc-800\/60 { border-color: rgba(148, 163, 184, 0.5) !important; }
.dashboard-light .border-zinc-500\/20 { border-color: rgba(100, 116, 139, 0.2) !important; }
.dashboard-light .border-zinc-500\/30 { border-color: rgba(100, 116, 139, 0.3) !important; }
.dashboard-light .border-zinc-600\/20 { border-color: rgba(71, 85, 105, 0.2) !important; }
.dashboard-light .bg-zinc-500\/10 { background-color: rgba(100, 116, 139, 0.08) !important; }
.dashboard-light .bg-zinc-500\/15 { background-color: rgba(100, 116, 139, 0.12) !important; }

/* ── MetricRing track CSS variable ── */
.dashboard-light { --metric-ring-track: #e2e8f0; }
```

- [ ] **Step 4: Verify build still passes**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "feat(light-mode): add coverage for opacity variant gap classes"
```

---

## Task 2: ScannerReveal Overlay Fix

**Files:**
- Modify: `src/components/ui/ScannerReveal.tsx`

The overlay div uses `backgroundColor: '#0f1219'` hardcoded. In light mode this flashes a dark overlay on every page transition. The CSS variable `--brand-bg` is already defined and updates to `#f8fafc` under `.dashboard-light`.

- [ ] **Step 1: Open `src/components/ui/ScannerReveal.tsx` and find line 69**

The overlay div currently reads:
```tsx
backgroundColor: '#0f1219',
```

- [ ] **Step 2: Replace with CSS variable**

Change line 69 from:
```tsx
backgroundColor: '#0f1219',
```
to:
```tsx
backgroundColor: 'var(--brand-bg)',
```

The full overlay div style block should now read:
```tsx
style={{
  position: 'fixed',
  top: rect.top,
  left: rect.left,
  right: rect.right,
  bottom: rect.bottom,
  zIndex: 9998,
  backgroundColor: 'var(--brand-bg)',
  animation: 'scanReveal 0.85s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
  pointerEvents: 'none',
}}
```

- [ ] **Step 3: Verify build passes**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/ScannerReveal.tsx
git commit -m "fix(light-mode): ScannerReveal overlay uses CSS var(--brand-bg)"
```

---

## Task 3: MetricRing Track Color Fix

**Files:**
- Modify: `src/components/ui/MetricRing.tsx`

`MetricRing` and `MetricRingSvg` both have `stroke="#303036"` for the background track circle. In dark mode this is a near-invisible dark ring. In light mode it renders as a harsh dark circle on white. The CSS variable `--metric-ring-track` was added in Task 1 with a light-mode value of `#e2e8f0`.

- [ ] **Step 1: Find both `stroke="#303036"` occurrences in `src/components/ui/MetricRing.tsx`**

They are at lines 43 and 79:
```tsx
<circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#303036" strokeWidth={sw} />
```
(line 43 — MetricRing)

```tsx
<circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#303036" strokeWidth={sw} />
```
(line 79 — MetricRingSvg)

- [ ] **Step 2: Replace both occurrences**

Line 43 — change `stroke="#303036"` to `stroke="var(--metric-ring-track, #303036)"`:
```tsx
<circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--metric-ring-track, #303036)" strokeWidth={sw} />
```

Line 79 — same change:
```tsx
<circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--metric-ring-track, #303036)" strokeWidth={sw} />
```

- [ ] **Step 3: Verify build passes**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/MetricRing.tsx
git commit -m "fix(light-mode): MetricRing track uses CSS var(--metric-ring-track)"
```

---

## Task 4: Skeleton Shimmer Fix

**Files:**
- Modify: `src/index.css`

`Skeleton.tsx` uses `bg-zinc-800` (which maps to white in light mode) with `animate-pulse`. Both the shimmer and its container become near-white — the shimmer effect disappears. The fix adds a light-mode override that gives the shimmer a visible slate tint.

- [ ] **Step 1: Locate the animate-pulse override in `src/index.css`**

```bash
grep -n "animate-pulse\|shimmer\|Skeleton" src/index.css
```

Check if `.dashboard-light .animate-pulse` or `.dashboard-light .bg-zinc-800` already has a color override that would make the shimmer visible (i.e., something other than white).

- [ ] **Step 2: Add Skeleton-specific light mode rules inside `.dashboard-light`**

The `Skeleton` component applies `bg-zinc-800` directly. The base `.dashboard-light .bg-zinc-800` rule already maps this to a light color. The issue is that `animate-pulse` pulses opacity on that same element — on a white page, pulsing from white to slightly-lighter-white is invisible.

Add this rule inside `.dashboard-light { }`:

```css
/* ── Skeleton shimmer — make pulse visible on light backgrounds ── */
.dashboard-light .bg-zinc-800.animate-pulse {
  background-color: #e2e8f0 !important;
}
.dashboard-light .bg-zinc-800.animate-pulse:hover {
  background-color: #e2e8f0 !important;
}
```

Also ensure the skeleton container classes (`bg-zinc-900` on `StatCardSkeleton`, `SectionCardSkeleton`) have good contrast in light mode (they use the existing `.dashboard-light .bg-zinc-900` rule mapping to `#f1f5f9` — this is fine as a slightly differentiated card background).

- [ ] **Step 3: Verify build passes**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "fix(light-mode): Skeleton shimmer visible on light backgrounds"
```

---

## Task 5: AnnotatedTrendChart Light Mode

**Files:**
- Modify: `src/components/charts/AnnotatedTrendChart.tsx`

Three hardcoded dark values in this chart:
1. `CartesianGrid stroke="#27272a"` — nearly invisible on light
2. `XAxis tick={{ fill: '#71717a' }}` — may be OK (slate-500 ≈ acceptable) but verify
3. `axisLine={{ stroke: '#3f3f46' }}` — too dark for light
4. `Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46' }}` — dark tooltip on light background
5. Annotation dot `stroke="#18181b"` — near-black stroke on colored dot, fine in both modes

The fix threads a `lightMode` boolean from a CSS-variable probe, OR uses a hook. Simplest: read `document.documentElement` or the parent element. But since this is a chart, it's easier to just use a conditional prop approach — pass `lightMode` as a prop from the parent. However, checking the parent is complex. Better approach: use `useTheme()` hook if one exists, otherwise read `localStorage`.

Check if there's an existing theme hook: `grep -rn "useTheme\|useDarkMode\|localStorage.*theme" src/hooks/`

If no hook exists, the cleanest approach for charts is to use a CSS variable probe inside the component:

```tsx
// At top of component, inside the component function:
const isLight = typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dashboard-light') === false &&
  document.querySelector('.dashboard-light') !== null;
```

Actually, the best approach per the spec: replace hardcoded hex strings with conditionally selected values. Since `ClientDashboard.tsx` receives a `theme` prop (per the spec), check if `AnnotatedTrendChart` is called from a component that has access to `theme`.

- [ ] **Step 1: Check if theme is available at the call site**

```bash
grep -n "AnnotatedTrendChart" src/components/ -r
```

Check what props it receives and whether `theme` flows through.

- [ ] **Step 2: Add a `useIsLightMode` utility hook**

Create the hook inline at the top of `AnnotatedTrendChart.tsx` (not a separate file — single use):

```tsx
function useIsLightMode() {
  const [light, setLight] = React.useState(() =>
    typeof document !== 'undefined' &&
    document.querySelector('.dashboard-light') !== null
  );
  React.useEffect(() => {
    const el = document.querySelector('[class*="dashboard-light"]') ?? document.body;
    const obs = new MutationObserver(() =>
      setLight(document.querySelector('.dashboard-light') !== null)
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return light;
}
```

- [ ] **Step 3: Use `useIsLightMode` to set chart colors**

Inside the `AnnotatedTrendChart` component function, add:

```tsx
const isLight = useIsLightMode();
const gridColor = isLight ? 'rgba(0,0,0,0.08)' : '#27272a';
const axisTickColor = isLight ? '#64748b' : '#71717a';
const axisLineColor = isLight ? '#cbd5e1' : '#3f3f46';
const tooltipBg = isLight ? '#ffffff' : '#18181b';
const tooltipBorder = isLight ? '#e2e8f0' : '#3f3f46';
const tooltipLabelColor = isLight ? '#475569' : '#a1a1aa';
```

- [ ] **Step 4: Apply the variables to the chart props**

Replace the hardcoded values in the JSX:

```tsx
<CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
```

```tsx
tick={{ fill: axisTickColor, fontSize: 10 }}
```

```tsx
axisLine={{ stroke: axisLineColor }}
```

```tsx
<Tooltip
  contentStyle={{
    backgroundColor: tooltipBg,
    border: `1px solid ${tooltipBorder}`,
    borderRadius: '0.5rem',
    fontSize: '11px',
  }}
  labelStyle={{ color: tooltipLabelColor, fontFamily: 'monospace' }}
/>
```

- [ ] **Step 5: Verify TypeScript and build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/charts/AnnotatedTrendChart.tsx
git commit -m "fix(light-mode): AnnotatedTrendChart grid, axis, tooltip colors"
```

---

## Task 6: ScoreTrendChart Light Mode

**Files:**
- Modify: `src/components/audit/ScoreTrendChart.tsx`

Hardcoded values:
1. `CartesianGrid stroke="rgba(255,255,255,0.04)"` — invisible on any background in light mode (near-zero white)
2. `XAxis tick={{ fill: '#64748b' }}` — slate-500, readable on light (OK, leave)
3. `YAxis tick={{ fill: '#64748b' }}` — same (OK, leave)
4. `dot={{ fill: '#0f1219' }}` and `activeDot={{ stroke: '#18181b' }}` — dot fill is dark bg color, visible in dark but will be wrong in light

- [ ] **Step 1: Add `useIsLightMode` to `ScoreTrendChart.tsx`**

Add the same utility function used in Task 5 (copy it into this file — it's a self-contained helper):

```tsx
function useIsLightMode() {
  const [light, setLight] = React.useState(() =>
    typeof document !== 'undefined' &&
    document.querySelector('.dashboard-light') !== null
  );
  React.useEffect(() => {
    const obs = new MutationObserver(() =>
      setLight(document.querySelector('.dashboard-light') !== null)
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return light;
}
```

- [ ] **Step 2: Apply conditional colors**

Inside the `ScoreTrendChart` component:

```tsx
const isLight = useIsLightMode();
const gridColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.04)';
const dotFill = isLight ? '#f8fafc' : '#0f1219';
const activeDotStroke = isLight ? '#e2e8f0' : '#18181b';
```

Then update JSX:
```tsx
<CartesianGrid stroke={gridColor} horizontal vertical={false} />
```

```tsx
dot={{ r: 3.5, fill: dotFill, stroke: '#2ed9c3', strokeWidth: 2 }}
activeDot={{ r: 4, fill: '#2ed9c3', stroke: activeDotStroke, strokeWidth: 2 }}
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/audit/ScoreTrendChart.tsx
git commit -m "fix(light-mode): ScoreTrendChart grid and dot colors"
```

---

## Task 7: DarkTooltip and client/helpers.tsx

**Files:**
- Modify: `src/components/client/helpers.tsx`

`DarkTooltip` uses hardcoded `bg-zinc-900 border-zinc-700 border-zinc-800` Tailwind classes — these ARE caught by the existing `.dashboard-light` overrides (zinc-900 → slate-50, zinc-700 → slate-200, zinc-800 → slate-100). So `DarkTooltip` itself is already handled by CSS overrides. ✓

The `activeDot={{ stroke: '#18181b' }}` values in `TrendChart` and `DualTrendChart` use near-black. In light mode this will be a dark ring around the active dot, which is acceptable but slightly harsh.

- [ ] **Step 1: Add `useIsLightMode` to `helpers.tsx`**

```tsx
import React from 'react';

function useIsLightMode() {
  const [light, setLight] = React.useState(() =>
    typeof document !== 'undefined' &&
    document.querySelector('.dashboard-light') !== null
  );
  React.useEffect(() => {
    const obs = new MutationObserver(() =>
      setLight(document.querySelector('.dashboard-light') !== null)
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return light;
}
```

- [ ] **Step 2: Update TrendChart activeDot stroke**

Inside `TrendChart`:
```tsx
const isLight = useIsLightMode();
const dotStroke = isLight ? '#f1f5f9' : '#18181b';
```

Apply to the `activeDot` prop:
```tsx
activeDot={{ r: 3, fill: color, stroke: dotStroke, strokeWidth: 1.5 }}
```

- [ ] **Step 3: Update DualTrendChart activeDot strokes (lines 79, 80)**

```tsx
const isLight = useIsLightMode();
const dotStroke = isLight ? '#f1f5f9' : '#18181b';
```

Apply to both `activeDot` props on lines ~79 and ~80:
```tsx
activeDot={{ r: 3, fill: '#2dd4bf', stroke: dotStroke, strokeWidth: 1.5 }}
activeDot={{ r: 3, fill: '#60a5fa', stroke: dotStroke, strokeWidth: 1.5 }}
```

- [ ] **Step 4: Update SiteHealthTrendChart activeDot stroke (line ~129)**

```tsx
activeDot={{ r: 3, fill: '#34d399', stroke: dotStroke, strokeWidth: 1.5 }}
```

- [ ] **Step 5: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add src/components/client/helpers.tsx
git commit -m "fix(light-mode): client chart activeDot strokes theme-aware"
```

---

## Task 8: RankTracker + WorkspaceOverview SVG Lines

**Files:**
- Modify: `src/components/RankTracker.tsx`
- Modify: `src/components/WorkspaceOverview.tsx`

Hardcoded values across both files:
1. `stroke="#27272a"` on grid lines (line 101) — dark zinc, visible as dark lines in light mode
2. `fill="#52525b"` on axis text (lines 102, 123) — zinc-600, slightly too dark-themed for light

- [ ] **Step 1: Locate the hardcoded values in `src/components/RankTracker.tsx`**

Line 101:
```tsx
<line x1={padL} y1={toY(v)} x2={W - padR} y2={toY(v)} stroke="#27272a" strokeDasharray="3,3" />
```
Line 102:
```tsx
<text x={padL - 6} y={toY(v) + 3} textAnchor="end" fill="#52525b" fontSize="9">#{v}</text>
```
Line 123:
```tsx
<text key={idx} x={toX(idx)} y={H - 6} textAnchor="middle" fill="#52525b" fontSize="9">
```

- [ ] **Step 2: Add a useIsLightMode hook and derive colors**

Add `useIsLightMode` (same as previous tasks) and derive:

```tsx
const isLight = useIsLightMode();
const gridLineColor = isLight ? '#e2e8f0' : '#27272a';
const axisTextColor = isLight ? '#94a3b8' : '#52525b';
```

- [ ] **Step 3: Apply to the SVG elements**

```tsx
<line x1={padL} y1={toY(v)} x2={W - padR} y2={toY(v)} stroke={gridLineColor} strokeDasharray="3,3" />
<text x={padL - 6} y={toY(v) + 3} textAnchor="end" fill={axisTextColor} fontSize="9">#{v}</text>
```

```tsx
<text key={idx} x={toX(idx)} y={H - 6} textAnchor="middle" fill={axisTextColor} fontSize="9">
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 5: Update WorkspaceOverview.tsx axis tick color**

`src/components/WorkspaceOverview.tsx` line 666 has:
```tsx
<XAxis dataKey="date" tick={{ fill: '#52525b', fontSize: 9 }} ... />
```

Add the same `isLight` + `axisTextColor` pattern (same values: `isLight ? '#94a3b8' : '#52525b'`):

```tsx
const isLight = useIsLightMode();
const axisTextColor = isLight ? '#94a3b8' : '#52525b';
// ...
<XAxis dataKey="date" tick={{ fill: axisTextColor, fontSize: 9 }} ... />
```

Bar fills (`#059669` emerald, `#ea580c` orange) are brand semantic colors — leave them unchanged.

- [ ] **Step 6: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 7: Commit**

```bash
git add src/components/RankTracker.tsx src/components/WorkspaceOverview.tsx
git commit -m "fix(light-mode): RankTracker and WorkspaceOverview SVG colors theme-aware"
```

---

## Task 9: Roadmap SVG Lines

**Files:**
- Modify: `src/components/Roadmap.tsx`

Hardcoded values:
1. `stroke="#27272a"` on horizontal grid lines (line 89)
2. `fill="#0f0f0f"` on data point dots (line 102) — data points use `fill="#0f0f0f"` (near-black dot center), which will be very dark on a light background

- [ ] **Step 1: Add `useIsLightMode` to `Roadmap.tsx` and derive colors**

```tsx
const isLight = useIsLightMode();
const gridLineColor = isLight ? '#e2e8f0' : '#27272a';
const dotFill = isLight ? '#f8fafc' : '#0f0f0f';
```

- [ ] **Step 2: Apply to SVG elements**

Line 89:
```tsx
<line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={gridLineColor} strokeWidth="1" />
```

Line 102:
```tsx
<circle cx={p.x} cy={p.y} r="3.5" fill={dotFill} stroke="#2dd4bf" strokeWidth="2" />
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Roadmap.tsx
git commit -m "fix(light-mode): Roadmap SVG grid and dot colors theme-aware"
```

---

## Task 10: Full Test Suite + PR

**Files:**
- No file changes — validation only

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```
Expected: all tests pass. If failures, investigate and fix before proceeding.

- [ ] **Step 2: Run PR check**

```bash
npx tsx scripts/pr-check.ts
```
Expected: zero errors, zero warnings.

- [ ] **Step 3: Run type check and build**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```
Expected: zero errors.

- [ ] **Step 4: Manual light mode verification pass**

Toggle light mode and navigate these critical paths:
- Client dashboard: Overview, Analytics, Health, Strategy, Requests tabs
- Admin dashboard: Workspace Overview, SEO Audit (ScoreTrendChart), Analytics (AnnotatedTrendChart), Rank Tracker
- Any page with MetricRing (SeoAudit, WorkspaceHome)
- Navigate between tabs to verify ScannerReveal no longer flashes dark

Zero instances of:
- Dark zinc backgrounds bleeding through
- Invisible Skeleton shimmers
- Dark overlay flash on page transitions
- Harsh dark SVG grid lines on light backgrounds
- Dark tooltips on light backgrounds

- [ ] **Step 5: Commit docs**

```bash
git add BRAND_DESIGN_LANGUAGE.md FEATURE_AUDIT.md data/roadmap.json
git commit -m "docs: update post light-mode audit completion"
```

- [ ] **Step 6: Push to staging**

```bash
git push origin claude/inspiring-agnesi
gh pr create --base staging --title "fix(light-mode): comprehensive audit — coverage gaps, inline styles, charts" --body "$(cat <<'EOF'
## Summary
- Adds `.dashboard-light` overrides for 16 opacity-variant gap classes (`bg-zinc-800/40`, `bg-zinc-900/60`, etc.)
- Fixes `ScannerReveal` dark overlay flash in light mode (`var(--brand-bg)`)
- Fixes `MetricRing` track color via CSS variable (`var(--metric-ring-track)`)
- Fixes `Skeleton` shimmer visibility in light mode
- Adds theme-aware colors to `AnnotatedTrendChart`, `ScoreTrendChart`, `RankTracker`, `Roadmap` SVG charts
- Fixes `DarkTooltip` activeDot strokes in `client/helpers.tsx`

## Test plan
- [ ] Toggle light mode — zero dark bleed-through on any tab
- [ ] ScannerReveal: navigate between tabs in light mode — no dark flash
- [ ] MetricRing: visible on light background with `#e2e8f0` track
- [ ] Skeleton: shimmer visible (slate-200 pulse)
- [ ] AnnotatedTrendChart / ScoreTrendChart: readable axis labels and grid lines
- [ ] RankTracker / Roadmap: light grid lines
- [ ] All semantic colors (teal/blue/green/amber/red/purple) remain distinct
- [ ] Dark mode: zero regressions (CSS var fallbacks preserve original values)
- [ ] `npx vitest run` passes
- [ ] `npx tsc --noEmit --skipLibCheck && npx vite build` passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage check:**
- ✓ Category 1 (Missing Tailwind class overrides) — Task 1
- ✓ Category 2 (Hardcoded hex in inline styles) — Tasks 2, 3, 5–9
- ✓ Category 3 (SVG/Chart colors) — Tasks 5–9
- ✓ Category 4 (Gradient backgrounds) — partially covered by Task 1 opacity variants; gradient utilities themselves (from-zinc-900) are already caught by base rules
- ✓ Category 5 (New components) — Tasks 2 (ScannerReveal), 3 (MetricRing), 4 (Skeleton)
- ✓ Category 6 (Legibility audit) — Task 10 Step 4 manual verification

**`useIsLightMode` type consistency:** Same implementation used in Tasks 5–9. All five files get an identical copy of the function — no cross-file import, no abstraction needed (single-use per spec).

**Missing components identified in spec but not in plan:**
- `WorkspaceOverview.tsx` axis tick `fill="#52525b"` — addressed in Task 8 Step 5.
- Bar fills (`#059669` emerald, `#ea580c` orange) are brand semantic colors — intentionally left unchanged per spec (semantic colors must remain visually distinct).
