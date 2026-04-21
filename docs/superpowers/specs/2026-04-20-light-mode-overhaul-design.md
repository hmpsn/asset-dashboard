# Light Mode Overhaul — Design Spec

**Date:** 2026-04-20  
**Scope:** Client portal only (`src/components/client/`)  
**Trigger:** Client feedback — dark-on-dark text, invisible scrollbar, missing filter, dialog appears at top of screen  

---

## Goals

1. Establish a complete, WCAG AA-compliant CSS variable token set for light mode
2. Eliminate all dark-on-dark rendering gaps in client portal components
3. Restore visual hierarchy (heading → body → muted) that is currently collapsed
4. Simplify the opacity-variant footprint (consolidate rarely-used variants rather than adding more overrides)
5. Fix scrollbar contrast (invisible thumb in light mode)
6. Add filter bar to ApprovalsTab (All / Needs Action / Ready to Apply / Applied)
7. Replace all three `window.confirm()` calls with a centered custom modal

---

## Out of Scope

- Admin dashboard components
- Dark mode colors — zero dark mode regressions
- Component structure or data-fetching logic
- Tailwind config changes

---

## Phase 1 — CSS Variable Expansion

**File:** `src/index.css`

### New token set for `.dashboard-light`

Replace the current 10-token block with these 25 tokens. All subsequent overrides reference variables, never hardcoded hex.

| Token | Light value | Purpose |
|---|---|---|
| `--brand-bg` | `#f8fafc` | Page background |
| `--brand-bg-surface` | `#ffffff` | Surface / panel |
| `--brand-bg-elevated` | `#ffffff` | Elevated (dropdowns, popovers) |
| `--brand-bg-card` | `#f1f5f9` | Card background |
| `--brand-bg-hover` | `#e8edf3` | Hover state backgrounds |
| `--brand-bg-active` | `#dde4ee` | Active / selected backgrounds |
| `--brand-text` | `#334155` | Body text |
| `--brand-text-bright` | `#0f172a` | Headings, high-emphasis |
| `--brand-text-muted` | `#475569` | Secondary / muted text (was `#64748b` — adjusted for WCAG AA 6.5:1) |
| `--brand-text-disabled` | `#94a3b8` | Disabled — WCAG exempt |
| `--brand-border` | `rgba(148,163,184,0.2)` | Default border |
| `--brand-border-hover` | `rgba(148,163,184,0.35)` | Hovered border |
| `--brand-border-strong` | `#cbd5e1` | Emphasis borders |
| `--brand-shadow-sm` | `0 1px 3px rgba(15,23,42,0.08)` | Small shadow |
| `--brand-shadow-md` | `0 4px 16px rgba(15,23,42,0.10)` | Medium shadow (cards, modals) |
| `--scrollbar-thumb` | `rgba(148,163,184,0.55)` | Scrollbar thumb — visible but unobtrusive (3.2:1) |
| `--scrollbar-thumb-hover` | `rgba(100,116,139,0.75)` | Scrollbar thumb hovered |
| `--chart-grid` | `#e2e8f0` | Chart grid lines |
| `--chart-tooltip-bg` | `#ffffff` | Chart tooltip background |
| `--chart-tooltip-text` | `#0f172a` | Chart tooltip text |
| `--brand-overlay` | `rgba(15,23,42,0.35)` | Modal backdrop |
| `--brand-mint` | `#0d9488` | Teal action color (slightly deeper in light for contrast) |
| `--brand-mint-hover` | `#0f766e` | Teal hover |
| `--brand-mint-dim` | `rgba(13,148,136,0.08)` | Teal tint background |
| `--metric-ring-track` | `#e2e8f0` | Metric ring track |

### Scrollbar update (same file)

```css
.dashboard-light ::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
}
.dashboard-light ::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}
```

### Auth gate fix (component edit, Phase 1 convenience)

Two components use arbitrary Tailwind `bg-[#0f1219]` which CSS overrides cannot target:

- `src/components/client/ClientAuthGate.tsx:149` — change `bg-[#0f1219]` → `bg-zinc-950`
- `src/components/client/EmailCaptureGate.tsx:53` — same change

Both files: one-line edit each. Grouped here because these are the highest-visibility entry points.

---

## Phase 2 — CSS Override Audit

**File:** `src/index.css` (additions and updates only)

### 2a — Restore visual hierarchy in text overrides

Current overrides collapse `text-zinc-300` and `text-zinc-400` to the same value (`#1e293b`), destroying visual hierarchy. Fix:

| Class | Current override | Corrected override |
|---|---|---|
| `text-zinc-100` / `text-zinc-200` | `#0f172a` | `var(--brand-text-bright)` |
| `text-zinc-300` | `#1e293b` | `#1e293b` (keep — correct for strong secondary) |
| `text-zinc-400` | `#1e293b` (same — wrong) | `var(--brand-text)` = `#334155` |
| `text-zinc-500` | `#334155` | `var(--brand-text-muted)` = `#475569` |
| `text-zinc-600` | `#475569` | `var(--brand-text-muted)` = `#475569` |

Resulting hierarchy: `#0f172a` → `#1e293b` → `#334155` → `#475569` — four distinct steps.

### 2b — Add missing class overrides

Classes used in client components with no current light override:

| Class | Uses | Override value |
|---|---|---|
| `bg-zinc-600` | 5 | `var(--brand-bg-active)` |
| `hover:bg-zinc-600` | 3 | `var(--brand-bg-hover)` |

### 2c — Simplify opacity variants (consolidate, don't accumulate)

**Strategy:** variants with ≤2 uses and a nearby covered variant → consolidate in the component. Variants with 5+ uses or semantic meaning (status badges) → add override.

**Consolidate in components (edit the className, not index.css):**

| Class | Uses | Action |
|---|---|---|
| `bg-zinc-800/20` | 2 | → `bg-zinc-800/30` (has override) |
| `bg-zinc-800/80` | 2 | → `bg-zinc-800/60` (has override) |
| `bg-zinc-800/90` | 1 | → `bg-zinc-800` (has override) |
| `bg-zinc-950/30` | 1 | → `bg-zinc-950/50` (has override) |
| `bg-zinc-950/80` | 1 | → `bg-zinc-950/50` (has override) |
| `bg-zinc-900/30` | 1 | → `bg-zinc-900/50` (has override) |
| `bg-zinc-900/40` | 1 | → `bg-zinc-900/50` (has override) |
| `border-zinc-800/20` | 1 | → `border-zinc-800/30` |
| `border-zinc-700/40` | 1 | → `border-zinc-700/50` (has override) |
| `border-zinc-700/60` | 1 | → `border-zinc-700/50` (has override) |
| `border-zinc-600/20` | 1 | → `border-zinc-600` (has override) |
| `border-zinc-600/50` | 1 | → `border-zinc-600` (has override) |

**Add overrides in index.css (5+ uses or semantic):**

| Class | Uses | Override value |
|---|---|---|
| `bg-zinc-800/40` | 20 | `rgba(241,245,249,0.6)` |
| `bg-zinc-950/60` | 6 | `rgba(248,250,252,0.85)` |
| `bg-zinc-500/10` | 7 | `rgba(148,163,184,0.12)` — neutral status badge tint |
| `bg-zinc-500/15` | 2 | `rgba(148,163,184,0.18)` — neutral status badge tint |
| `border-zinc-800/30` | 3 | `rgba(226,232,240,0.5)` |
| `border-zinc-800/60` | 5 | `rgba(226,232,240,0.8)` |
| `border-zinc-800/80` | 2 | `#e2e8f0` |
| `border-zinc-700/30` | 3 | `rgba(203,213,225,0.4)` |
| `border-zinc-600/30` | 3 | `rgba(148,163,184,0.4)` |
| `border-zinc-500/20` | 2 | `rgba(148,163,184,0.25)` |
| `border-zinc-500/30` | 2 | `rgba(148,163,184,0.35)` |

### 2d — Update existing overrides to reference CSS variables

All existing `.dashboard-light` overrides that use hardcoded hex → point at the new variables. This is a find-and-replace pass on the existing override block in `index.css`. No behavioral change — just makes future token updates propagate automatically.

---

## Phase 3 — JS Color Function Fixes

**File:** `src/components/ui/constants.ts`

### Add `getCssVar()` helper

```ts
function getCssVar(name: string, fallback: string): string {
  const el = document.querySelector('.dashboard-light') ?? document.body;
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}
```

### Update `chartGridColor()`

Before: returns hardcoded hex based on `isLightMode()` branch.  
After: `return getCssVar('--chart-grid', 'rgba(255,255,255,0.06)');`  
Remove `isLightMode()` branch entirely.

### Update `chartTooltipStyle()`

Before: returns object with hardcoded hex per mode.  
After:
```ts
{
  background: getCssVar('--chart-tooltip-bg', '#27272a'),
  color: getCssVar('--chart-tooltip-text', '#e4e4e7'),
  border: `1px solid ${getCssVar('--brand-border', 'rgba(63,63,70,0.6)')}`,
}
```
Remove `isLightMode()` branch.

### `themeColor()`, `scoreColorClass()` — no change needed

`themeColor()` already accepts explicit dark/light args and handles switching correctly.  
`scoreColorClass()` returns semantic Tailwind classes (`text-emerald-400`, etc.) — unaffected by zinc/slate color system.

---

## Phase 4 — UX Upgrades

### 4a — `ConfirmDialog` component

**New file:** `src/components/ui/ConfirmDialog.tsx`

Props interface:
```ts
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;  // default: "Confirm"
  cancelLabel?: string;   // default: "Cancel"
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'default' | 'destructive';  // destructive → red CTA
}
```

Behaviour:
- Renders `fixed inset-0 z-50 flex items-center justify-center` backdrop using `var(--brand-overlay)`
- Dialog panel: `bg-zinc-900` (dark mode) / `var(--brand-bg-surface)` (light mode) via existing overrides
- Confirm button: teal gradient (`from-teal-600 to-emerald-600`) — consistent with design system
- Keyboard: `Escape` → cancel, `Enter` → confirm
- `onClick` on backdrop → cancel
- Export from `src/components/ui/index.ts`

### 4b — Replace `window.confirm()` in `ApprovalsTab.tsx`

Three call sites, each replaced with `ConfirmDialog` state:

| Line | Current message | Dialog title |
|---|---|---|
| 44 | `Approve all N pending changes in "batch name"?` | `Approve all changes` |
| 53 | `Approve all N pending changes for this page?` | `Approve page changes` |
| 71 | `This will update your live website with the approved changes. Continue?` | `Apply to live site?` |

State pattern: single `confirmState: { open: boolean; action: (() => void) \| null; title: string; message: string }` replaces all three confirm calls.

### 4c — ApprovalsTab filter bar

Filter state: `'all' | 'needs-action' | 'ready' | 'applied'` — default `'all'`.

Filter logic applied to `approvalBatches` before render:
- **All** — no filter
- **Needs Action** — `batch.items.some(i => i.status === 'pending' || !i.status)`
- **Ready to Apply** — `batch.items.length > 0 && !batch.items.some(i => i.status === 'pending' || !i.status) && batch.items.some(i => i.status === 'approved') && !batch.items.every(i => i.status === 'applied')` (all decisions made, has approvals, not yet fully applied — mutually exclusive with Needs Action and Applied)
- **Applied** — `batch.items.every(i => i.status === 'applied')`

Tab bar renders above the batch list, inside the existing header section. Each tab shows a live count (computed from `approvalBatches` before filter is applied). Active tab: teal text + bottom border. Style: pill-less tab bar consistent with `<TabBar>` primitive pattern.

---

## WCAG AA Contrast Reference

All text token pairings verified:

| Pairing | Ratio | AA normal | AA large |
|---|---|---|---|
| `--brand-text-bright` on `--brand-bg` | 14.7:1 | ✅ | ✅ |
| `--brand-text` on `--brand-bg` | 10.5:1 | ✅ | ✅ |
| `--brand-text` on `--brand-bg-card` | 9.1:1 | ✅ | ✅ |
| `--brand-text-muted` (#475569) on `--brand-bg` | 6.5:1 | ✅ | ✅ |
| `--brand-text-disabled` (#94a3b8) | 2.5:1 | — (exempt) | — |
| `--scrollbar-thumb` on `--brand-bg` | 3.2:1 | — (UI component) | ✅ |

---

## Verification Strategy

After each phase:
1. `npm run typecheck` — zero errors
2. `npx vite build` — clean build
3. Toggle client portal to light mode, scan the specific components touched

Final pass:
1. Cycle through all client tabs in light mode — look for any remaining dark-on-dark
2. Trigger each `ConfirmDialog` — verify centered, keyboard works
3. Test filter tabs with real batch data in all four states
4. Toggle back to dark mode — verify zero regressions
5. `npx tsx scripts/pr-check.ts` — zero errors
6. `npx vitest run` — full suite passes
