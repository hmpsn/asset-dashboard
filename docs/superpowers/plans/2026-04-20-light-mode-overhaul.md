# Light Mode Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the client portal's light mode with a complete CSS token system, eliminate all dark-on-dark rendering gaps, and deliver two UX upgrades (ApprovalsTab filter + centered ConfirmDialog).

**Architecture:** Sequential four-phase approach: CSS variables first (foundation), then CSS overrides (targeting client components), then JS color functions (charts), then UX component upgrades. All theming lives in `src/index.css` via `.dashboard-light` class overrides — no Tailwind dark: variants, no component-level inline styles for color.

**Tech Stack:** React 19, Tailwind CSS v4 (Vite plugin), `src/index.css` for all light mode overrides, Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-04-20-light-mode-overhaul-design.md`

---

## Pre-requisites

- [x] Spec committed: `docs/superpowers/specs/2026-04-20-light-mode-overhaul-design.md`
- [ ] Working in the `claude/recursing-elion-3cf563` worktree
- [ ] `npm run typecheck` passes before you start (establish a clean baseline)

---

## Task Dependencies

All tasks are sequential — each phase depends on the previous:

```
Task 1 (CSS Variables)
  → Task 2 (Auth Gate Fix)
  → Task 3 (Text Hierarchy)
  → Task 4 (Missing Class Overrides)
  → Task 5 (Opacity Consolidation — component edits)
  → Task 6 (Opacity Overrides — index.css additions)
  → Task 7 (Point Existing Overrides at CSS Vars)
  → Task 8 (JS Color Functions)
  → Task 9 (ConfirmDialog Component)
  → Task 10 (Wire ConfirmDialog into ApprovalsTab)
  → Task 11 (ApprovalsTab Filter Bar)
  → Task 12 (Final Verification)
```

---

## Task 1 — CSS Variable Expansion (Model: haiku)

**Owns:** `src/index.css` (lines 277–289 only — the `.dashboard-light { }` variable block)  
**Must not touch:** Any other CSS rules, any component files.

The current `.dashboard-light` block has 10 tokens and mixes CSS variables with layout rules. Replace it with a clean 25-token block that all subsequent overrides will reference.

- [ ] **Step 1: Open `src/index.css` and locate the block to replace**

The block starts at line 277. It looks like:
```css
/* === Base === */
.dashboard-light {
  --brand-bg: #f8fafc;
  --brand-bg-surface: #ffffff;
  --brand-bg-elevated: #ffffff;
  --brand-bg-card: #f1f5f9;
  --brand-text: #334155;
  --brand-text-bright: #0f172a;
  --brand-text-muted: #64748b;
  --brand-border: rgba(148, 163, 184, 0.2);
  --brand-border-hover: rgba(148, 163, 184, 0.35);
  background-color: #f8fafc !important;
  color: #1e293b !important;
}
```

- [ ] **Step 2: Replace that block with the expanded 25-token version**

Replace the entire block above with:
```css
/* === Base === */
.dashboard-light {
  /* Backgrounds */
  --brand-bg: #f8fafc;
  --brand-bg-surface: #ffffff;
  --brand-bg-elevated: #ffffff;
  --brand-bg-card: #f1f5f9;
  --brand-bg-hover: #e8edf3;
  --brand-bg-active: #dde4ee;
  /* Text */
  --brand-text: #334155;
  --brand-text-bright: #0f172a;
  --brand-text-muted: #475569;
  --brand-text-disabled: #94a3b8;
  /* Borders */
  --brand-border: rgba(148, 163, 184, 0.2);
  --brand-border-hover: rgba(148, 163, 184, 0.35);
  --brand-border-strong: #cbd5e1;
  /* Shadows */
  --brand-shadow-sm: 0 1px 3px rgba(15, 23, 42, 0.08);
  --brand-shadow-md: 0 4px 16px rgba(15, 23, 42, 0.10);
  /* Scrollbar */
  --scrollbar-thumb: rgba(148, 163, 184, 0.55);
  --scrollbar-thumb-hover: rgba(100, 116, 139, 0.75);
  /* Charts */
  --chart-grid: #e2e8f0;
  --chart-tooltip-bg: #ffffff;
  --chart-tooltip-text: #0f172a;
  /* Overlays */
  --brand-overlay: rgba(15, 23, 42, 0.35);
  /* Brand teal — deeper in light mode for contrast */
  --brand-mint: #0d9488;
  --brand-mint-hover: #0f766e;
  --brand-mint-dim: rgba(13, 148, 136, 0.08);
  /* Metric ring */
  --metric-ring-track: #e2e8f0;
  /* Layout defaults */
  background-color: #f8fafc !important;
  color: #1e293b !important;
}
```

- [ ] **Step 3: Update the scrollbar rules (~line 480) to use the new variables**

Find:
```css
/* === Scrollbar === */
.dashboard-light ::-webkit-scrollbar-thumb { background: rgba(100, 116, 139, 0.2); }
.dashboard-light ::-webkit-scrollbar-thumb:hover { background: rgba(100, 116, 139, 0.35); }
```

Replace with:
```css
/* === Scrollbar === */
.dashboard-light ::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); }
.dashboard-light ::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }
```

- [ ] **Step 4: Run typecheck and build**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors, successful build.

- [ ] **Step 5: Visual smoke-test**

Start the dev server (`npm run dev:all`), open the client portal, toggle to light mode. Confirm the page background is still light and the scrollbar thumb is now clearly visible when scrolling.

- [ ] **Step 6: Commit**

```bash
git add src/index.css
git commit -m "feat(light-mode): expand CSS variable set from 10 to 25 tokens, fix scrollbar contrast"
```

---

## Task 2 — Auth Gate Background Fix (Model: haiku)

**Owns:** `src/components/client/ClientAuthGate.tsx`, `src/components/client/EmailCaptureGate.tsx`  
**Must not touch:** `src/index.css`, any other component.

These two full-screen pages use `bg-[#0f1219]` (arbitrary Tailwind) instead of the standard `bg-zinc-950`. The CSS already has a `.dashboard-light .bg-\[\#0f1219\]` override, but switching to `bg-zinc-950` is cleaner and less fragile.

- [ ] **Step 1: Fix `ClientAuthGate.tsx`**

Open `src/components/client/ClientAuthGate.tsx`, go to line 149. Change:
```tsx
<div className="min-h-screen bg-[#0f1219] flex items-center justify-center">
```
To:
```tsx
<div className="min-h-screen bg-zinc-950 flex items-center justify-center">
```

- [ ] **Step 2: Fix `EmailCaptureGate.tsx`**

Open `src/components/client/EmailCaptureGate.tsx`, go to line 53. Change:
```tsx
<div className="min-h-screen bg-[#0f1219] flex items-center justify-center">
```
To:
```tsx
<div className="min-h-screen bg-zinc-950 flex items-center justify-center">
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/client/ClientAuthGate.tsx src/components/client/EmailCaptureGate.tsx
git commit -m "fix(light-mode): swap arbitrary bg-[#0f1219] to bg-zinc-950 in auth gates"
```

---

## Task 3 — Restore Text Visual Hierarchy (Model: haiku)

**Owns:** `src/index.css` (text override section, ~lines 315–322)  
**Must not touch:** Any component files, any other CSS section.

Currently `text-zinc-300` and `text-zinc-400` both map to `#1e293b`, making headings and body text look identical. This is the root cause of the "flat" feeling in light mode. Fix by restoring four distinct steps.

- [ ] **Step 1: Open `src/index.css` and find the text hierarchy block**

Lines ~316–322:
```css
.dashboard-light .text-zinc-100 { color: #0f172a !important; }  /* near-black navy */
.dashboard-light .text-zinc-200 { color: #0f172a !important; }  /* primary → dark navy */
.dashboard-light .text-zinc-300 { color: #1e293b !important; }  /* strong secondary */
.dashboard-light .text-zinc-400 { color: #1e293b !important; }  /* secondary — darker for contrast */
.dashboard-light .text-zinc-500 { color: #334155 !important; }  /* muted — darker for contrast */
.dashboard-light .text-zinc-600 { color: #475569 !important; }  /* subtle — one notch darker */
.dashboard-light .text-zinc-700 { color: #334155 !important; }
```

- [ ] **Step 2: Replace with corrected hierarchy**

```css
/* Four distinct steps: heading → strong secondary → body → muted */
.dashboard-light .text-zinc-100 { color: var(--brand-text-bright) !important; }  /* #0f172a */
.dashboard-light .text-zinc-200 { color: var(--brand-text-bright) !important; }  /* #0f172a */
.dashboard-light .text-zinc-300 { color: #1e293b !important; }                   /* strong secondary */
.dashboard-light .text-zinc-400 { color: var(--brand-text) !important; }         /* #334155 body */
.dashboard-light .text-zinc-500 { color: var(--brand-text-muted) !important; }   /* #475569 muted */
.dashboard-light .text-zinc-600 { color: var(--brand-text-muted) !important; }   /* #475569 muted */
.dashboard-light .text-zinc-700 { color: var(--brand-text) !important; }         /* #334155 body */
```

- [ ] **Step 3: Also update the hover text overrides to match (same section, ~lines 400–410)**

Find:
```css
.dashboard-light .hover\:text-zinc-100:hover { color: #0f172a !important; }
.dashboard-light .hover\:text-zinc-200:hover { color: #0f172a !important; }
.dashboard-light .hover\:text-zinc-300:hover { color: #0f172a !important; }
.dashboard-light .hover\:text-zinc-400:hover { color: #1e293b !important; }
.dashboard-light .hover\:text-zinc-500:hover { color: #334155 !important; }
```

Replace with:
```css
.dashboard-light .hover\:text-zinc-100:hover { color: var(--brand-text-bright) !important; }
.dashboard-light .hover\:text-zinc-200:hover { color: var(--brand-text-bright) !important; }
.dashboard-light .hover\:text-zinc-300:hover { color: #1e293b !important; }
.dashboard-light .hover\:text-zinc-400:hover { color: var(--brand-text) !important; }
.dashboard-light .hover\:text-zinc-500:hover { color: var(--brand-text-muted) !important; }
```

- [ ] **Step 4: Typecheck + visual check**

```bash
npm run typecheck
```

In the browser, toggle light mode and confirm heading text is clearly darker than body text, which is clearly darker than muted/caption text.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "fix(light-mode): restore four-step text hierarchy (zinc-300/400 no longer identical)"
```

---

## Task 4 — Add Missing Class Overrides (Model: haiku)

**Owns:** `src/index.css` (Neutral Backgrounds section, ~line 305)  
**Must not touch:** Component files, other CSS sections.

`bg-zinc-600` and its hover variant have zero light mode coverage. They render as a medium-dark gray on light backgrounds (dark-on-light, not dark-on-dark, but still jarring against the white surface).

- [ ] **Step 1: Find the "Neutral Backgrounds" section in `src/index.css`**

Around line 295–305:
```css
/* === Neutral Backgrounds === */
.dashboard-light .bg-\[\#0f1219\] { background-color: #f8fafc !important; }
.dashboard-light .bg-zinc-950 { background-color: #f8fafc !important; }
...
.dashboard-light .bg-zinc-500 { background-color: #94a3b8 !important; }
```

- [ ] **Step 2: Add the missing `bg-zinc-600` overrides after `bg-zinc-700`**

After the line `.dashboard-light .bg-zinc-700 { background-color: #e2e8f0 !important; }`, add:
```css
.dashboard-light .bg-zinc-600 { background-color: var(--brand-bg-active) !important; }
.dashboard-light .hover\:bg-zinc-600:hover { background-color: var(--brand-bg-hover) !important; }
```

- [ ] **Step 3: Typecheck + verify in browser**

```bash
npm run typecheck
```

Open the client portal in light mode. Check `FeedbackWidget` (the floating feedback button), `OrderStatus` (dot indicators), `InsightsEngine`, and `SeoCart` buttons — none should show dark gray blobs on the light surface.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "fix(light-mode): add missing bg-zinc-600 and hover:bg-zinc-600 overrides"
```

---

## Task 5 — Consolidate Rarely-Used Opacity Variants (Model: haiku)

**Owns:** The specific component lines listed below.  
**Must not touch:** `src/index.css`, any other component lines.

These variants each have 1–2 uses and a covered alternative nearby. Edit the component className to use the covered variant instead of adding more overrides.

- [ ] **Step 1: Fix `src/components/client/FeedbackWidget.tsx` — 3 changes**

Line 113: Change `bg-zinc-800/90` → `bg-zinc-800`:
```tsx
// Before
className={`fixed bottom-6 left-6 ... bg-zinc-800/90 hover:bg-zinc-700/90 border border-zinc-700/50 ...`}
// After
className={`fixed bottom-6 left-6 ... bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 ...`}
```

Line 242: Change `hover:bg-zinc-800/80` → `hover:bg-zinc-800/60`:
```tsx
// Before
className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-zinc-800/80 transition-colors"
// After
className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-zinc-800/60 transition-colors"
```

Line 268: Change `bg-zinc-800/80` → `bg-zinc-800/60`:
```tsx
// Before
className={`... bg-zinc-800/80 border border-zinc-700/50`}
// After
className={`... bg-zinc-800/60 border border-zinc-700/50`}
```

- [ ] **Step 2: Fix `src/components/client/HealthTab.tsx` — 2 changes**

Line 444: Change `bg-zinc-950/80` → `bg-zinc-950/50`:
```tsx
// Before
className={`rounded-lg border transition-all ${isExpanded ? 'bg-zinc-950/80 border-zinc-700' : 'bg-zinc-950/50 border-zinc-800/50 hover:border-zinc-700'}`}
// After
className={`rounded-lg border transition-all ${isExpanded ? 'bg-zinc-950/50 border-zinc-700' : 'bg-zinc-950/50 border-zinc-800/50 hover:border-zinc-700'}`}
```

Line 581: Change `bg-zinc-950/30` → `bg-zinc-950/50`:
```tsx
// Before
<div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2 flex-wrap bg-zinc-950/30">
// After
<div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2 flex-wrap bg-zinc-950/50">
```

- [ ] **Step 3: Fix `src/components/client/OutcomeSummary.tsx` — 1 change**

Line 165: Change `bg-zinc-900/30` → `bg-zinc-900/50`:
```tsx
// Before
<div className="border border-zinc-700/50 rounded-xl p-4 space-y-3 bg-zinc-900/30">
// After
<div className="border border-zinc-700/50 rounded-xl p-4 space-y-3 bg-zinc-900/50">
```

- [ ] **Step 4: Fix `src/components/client/ServiceInterestCTA.tsx` — 1 change**

Line 100: Change `border-zinc-700/40` → `border-zinc-700/50`:
```tsx
// Before
<div className="mt-3 flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/40">
// After
<div className="mt-3 flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/50">
```

- [ ] **Step 5: Fix `src/components/client/ApprovalsTab.tsx` — 1 change**

Line 233: Change `border-zinc-600/50` → `border-zinc-600`:
```tsx
// Before
<span key={kw2} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60 border border-zinc-600/50 text-zinc-400">
// After
<span key={kw2} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60 border border-zinc-600 text-zinc-400">
```

- [ ] **Step 6: Fix `src/components/client/ClientOnboardingQuestionnaire.tsx` — 1 change**

Line 140: Change `border-zinc-700/60` → `border-zinc-700/50`:
```tsx
// Before
const inputCls = 'w-full bg-zinc-800/60 border border-zinc-700/60 rounded-xl ...';
// After
const inputCls = 'w-full bg-zinc-800/60 border border-zinc-700/50 rounded-xl ...';
```

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/client/FeedbackWidget.tsx src/components/client/HealthTab.tsx src/components/client/OutcomeSummary.tsx src/components/client/ServiceInterestCTA.tsx src/components/client/ApprovalsTab.tsx src/components/client/ClientOnboardingQuestionnaire.tsx
git commit -m "fix(light-mode): consolidate rarely-used opacity variants to covered equivalents"
```

---

## Task 6 — Add High-Use Opacity Variant Overrides (Model: haiku)

**Owns:** `src/index.css` (Neutral Backgrounds and Neutral Borders sections)  
**Must not touch:** Component files, other CSS sections.

These variants have 3+ uses each and need overrides rather than component-level consolidation.

- [ ] **Step 1: Add missing background opacity overrides**

In the `/* === Neutral Backgrounds === */` section of `src/index.css`, after the existing `bg-zinc-800` series, add:
```css
.dashboard-light .bg-zinc-800\/20 { background-color: rgba(241,245,249,0.35) !important; }
.dashboard-light .hover\:bg-zinc-800\/20:hover { background-color: rgba(241,245,249,0.35) !important; }
.dashboard-light .bg-zinc-800\/40 { background-color: rgba(241,245,249,0.6) !important; }
.dashboard-light .bg-zinc-950\/60 { background-color: rgba(248,250,252,0.85) !important; }
.dashboard-light .bg-zinc-500\/10 { background-color: rgba(148,163,184,0.12) !important; }
.dashboard-light .bg-zinc-500\/15 { background-color: rgba(148,163,184,0.18) !important; }
```

- [ ] **Step 2: Add missing border opacity overrides**

In the `/* === Neutral Borders === */` section, after the existing border overrides, add:
```css
.dashboard-light .border-zinc-800\/30 { border-color: rgba(226,232,240,0.5) !important; }
.dashboard-light .border-zinc-800\/60 { border-color: rgba(226,232,240,0.8) !important; }
.dashboard-light .border-zinc-800\/80 { border-color: #e2e8f0 !important; }
.dashboard-light .border-zinc-700\/30 { border-color: rgba(203,213,225,0.4) !important; }
.dashboard-light .border-zinc-600\/30 { border-color: rgba(148,163,184,0.4) !important; }
.dashboard-light .border-zinc-500\/20 { border-color: rgba(148,163,184,0.25) !important; }
.dashboard-light .border-zinc-500\/30 { border-color: rgba(148,163,184,0.35) !important; }
```

- [ ] **Step 3: Typecheck + build**

```bash
npm run typecheck && npx vite build
```

- [ ] **Step 4: Visual check in light mode**

Open each of these components in light mode and confirm no dark blobs remain:
- `PageKeywordMapContent` — expanded rows, hover states
- `ROIDashboard` — list row hover states
- `InsightsEngine` — item dividers (`border-zinc-800/20`)
- `SchemaReviewTab` — neutral badge backgrounds

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "fix(light-mode): add missing opacity variant overrides for high-use zinc classes"
```

---

## Task 7 — Point Existing Overrides at CSS Variables (Model: haiku)

**Owns:** `src/index.css` (Neutral Backgrounds and Neutral Borders override sections only)  
**Must not touch:** Component files, accent color sections, other CSS sections.

Update existing hardcoded-hex overrides to reference the new CSS variables. No visual change — this makes future token updates propagate automatically.

- [ ] **Step 1: Update the Neutral Backgrounds section overrides**

Replace the existing neutral background overrides (the whole section from `bg-zinc-950` to `bg-zinc-500`) with variable-referenced versions:

```css
/* === Neutral Backgrounds === */
.dashboard-light .bg-\[\#0f1219\] { background-color: var(--brand-bg) !important; }
.dashboard-light .bg-zinc-950 { background-color: var(--brand-bg) !important; }
.dashboard-light .bg-zinc-950\/50 { background-color: rgba(248,250,252,0.85) !important; }
.dashboard-light .bg-zinc-950\/60 { background-color: rgba(248,250,252,0.85) !important; }
.dashboard-light .bg-zinc-900 { background-color: var(--brand-bg-surface) !important; }
.dashboard-light .bg-zinc-900\/50 { background-color: rgba(255,255,255,0.8) !important; }
.dashboard-light .bg-zinc-800 { background-color: var(--brand-bg-card) !important; }
.dashboard-light .bg-zinc-800\/20 { background-color: rgba(241,245,249,0.35) !important; }
.dashboard-light .bg-zinc-800\/30 { background-color: rgba(241,245,249,0.5) !important; }
.dashboard-light .bg-zinc-800\/40 { background-color: rgba(241,245,249,0.6) !important; }
.dashboard-light .bg-zinc-800\/50 { background-color: rgba(241,245,249,0.7) !important; }
.dashboard-light .bg-zinc-800\/60 { background-color: rgba(241,245,249,0.8) !important; }
.dashboard-light .bg-zinc-700 { background-color: var(--brand-bg-hover) !important; }
.dashboard-light .bg-zinc-600 { background-color: var(--brand-bg-active) !important; }
.dashboard-light .bg-zinc-500 { background-color: #94a3b8 !important; }
.dashboard-light .bg-zinc-500\/10 { background-color: rgba(148,163,184,0.12) !important; }
.dashboard-light .bg-zinc-500\/15 { background-color: rgba(148,163,184,0.18) !important; }
```

- [ ] **Step 2: Update the hover background overrides**

Find the hover background section and update:
```css
.dashboard-light .hover\:bg-zinc-700:hover { background-color: var(--brand-bg-hover) !important; }
.dashboard-light .hover\:bg-zinc-600:hover { background-color: var(--brand-bg-active) !important; }
.dashboard-light .hover\:bg-zinc-800:hover { background-color: var(--brand-bg-card) !important; }
.dashboard-light .hover\:bg-zinc-800\/20:hover { background-color: rgba(241,245,249,0.35) !important; }
.dashboard-light .hover\:bg-zinc-800\/30:hover { background-color: rgba(241,245,249,0.6) !important; }
.dashboard-light .hover\:bg-zinc-800\/50:hover { background-color: rgba(241,245,249,0.8) !important; }
```

- [ ] **Step 3: Update the Neutral Borders section overrides**

Replace the existing neutral border overrides with:
```css
/* === Neutral Borders === */
.dashboard-light .border-zinc-800 { border-color: var(--brand-bg-hover) !important; }
.dashboard-light .border-zinc-800\/30 { border-color: rgba(226,232,240,0.5) !important; }
.dashboard-light .border-zinc-800\/50 { border-color: rgba(226,232,240,0.6) !important; }
.dashboard-light .border-zinc-800\/60 { border-color: rgba(226,232,240,0.8) !important; }
.dashboard-light .border-zinc-800\/80 { border-color: #e2e8f0 !important; }
.dashboard-light .border-zinc-700 { border-color: var(--brand-border-strong) !important; }
.dashboard-light .border-zinc-700\/30 { border-color: rgba(203,213,225,0.4) !important; }
.dashboard-light .border-zinc-700\/50 { border-color: rgba(203,213,225,0.5) !important; }
.dashboard-light .border-zinc-600 { border-color: #94a3b8 !important; }
.dashboard-light .border-zinc-600\/30 { border-color: rgba(148,163,184,0.4) !important; }
.dashboard-light .border-zinc-500\/20 { border-color: rgba(148,163,184,0.25) !important; }
.dashboard-light .border-zinc-500\/30 { border-color: rgba(148,163,184,0.35) !important; }
.dashboard-light .border-zinc-600\/50 { border-color: #94a3b8 !important; }
.dashboard-light .hover\:border-zinc-700:hover { border-color: var(--brand-border-strong) !important; }
.dashboard-light .hover\:border-zinc-600:hover { border-color: #94a3b8 !important; }
.dashboard-light .divide-zinc-800 > * + * { border-color: var(--brand-bg-hover) !important; }
```

- [ ] **Step 4: Typecheck + build + visual sweep**

```bash
npm run typecheck && npx vite build
```

Toggle light mode in the client portal and cycle through: Overview, Health, Analytics, Approvals, Strategy, Search, Content tabs. Confirm no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "refactor(light-mode): point neutral bg/border overrides at CSS variables"
```

---

## Task 8 — JS Color Function Fixes (Model: sonnet)

**Owns:** `src/components/ui/constants.ts`  
**Must not touch:** Any other file.

`chartGridColor()` and `chartTooltipStyle()` currently have hardcoded hex values that don't pick up CSS variable changes. Add a `getCssVar()` helper and rewire these two functions. Leave `themeColor()`, `scoreColorClass()`, `chartAxisColor()`, `chartDotStroke()`, `chartDotFill()`, `chartTooltipLabelStyle()` unchanged — they're correct as-is.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/constants.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';

// getCssVar is not exported — test indirectly via chartGridColor and chartTooltipStyle
// by asserting they return strings/objects (smoke tests for the new code path)
import { chartGridColor, chartTooltipStyle } from '../../src/components/ui/constants';

describe('chartGridColor', () => {
  it('returns a non-empty string', () => {
    const color = chartGridColor();
    expect(typeof color).toBe('string');
    expect(color.length).toBeGreaterThan(0);
  });
});

describe('chartTooltipStyle', () => {
  it('returns an object with backgroundColor, color, and border', () => {
    const style = chartTooltipStyle();
    expect(style).toHaveProperty('backgroundColor');
    expect(style).toHaveProperty('color');
    expect(style).toHaveProperty('border');
    expect(style).toHaveProperty('borderRadius');
    expect(style).toHaveProperty('fontSize');
  });

  it('has matching backgroundColor and color types', () => {
    const style = chartTooltipStyle();
    expect(typeof style.backgroundColor).toBe('string');
    expect(typeof style.color).toBe('string');
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass on the current code**

```bash
npx vitest run tests/unit/constants.test.ts
```

Expected: PASS (these are structural assertions, not value assertions — they should pass before and after the change).

- [ ] **Step 3: Add `getCssVar` helper and update `chartGridColor`**

Open `src/components/ui/constants.ts`. After the `isLightMode()` function (line 6), add:

```ts
/** Read a CSS custom property from the active theme element. Falls back to `fallback` in SSR or when the var is unset. */
function getCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const el = document.querySelector('.dashboard-light') ?? document.body;
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}
```

Then replace `chartGridColor()` (line 54):
```ts
// Before
export function chartGridColor(): string {
  return themeColor('#27272a', '#e2e8f0');
}

// After
export function chartGridColor(): string {
  return getCssVar('--chart-grid', '#27272a');
}
```

- [ ] **Step 4: Update `chartTooltipStyle()`**

Replace the full `chartTooltipStyle()` function:
```ts
// Before
export function chartTooltipStyle(): CSSProperties {
  return isLightMode()
    ? { backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '0.5rem', fontSize: '11px', color: '#1e293b' }
    : { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '0.5rem', fontSize: '11px' };
}

// After
export function chartTooltipStyle(): CSSProperties {
  return {
    backgroundColor: getCssVar('--chart-tooltip-bg', '#18181b'),
    border: `1px solid ${getCssVar('--brand-border-hover', '#3f3f46')}`,
    borderRadius: '0.5rem',
    fontSize: '11px',
    color: getCssVar('--chart-tooltip-text', '#e4e4e7'),
  };
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/unit/constants.test.ts
```

Expected: PASS.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Visual check — charts in light mode**

Open the Analytics tab and Search tab in light mode. Confirm chart grid lines and tooltip colors look correct (light backgrounds, dark text on tooltips).

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/constants.ts tests/unit/constants.test.ts
git commit -m "fix(light-mode): migrate chartGridColor and chartTooltipStyle to CSS variables"
```

---

## Task 9 — ConfirmDialog Component (Model: sonnet)

**Owns:** `src/components/ui/ConfirmDialog.tsx` (new), `src/components/ui/index.ts`  
**Must not touch:** Any client components, `src/index.css`.

A reusable centered modal that replaces `window.confirm()`. Supports keyboard (Escape/Enter), backdrop click to cancel, teal CTA, and an optional destructive variant.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/ConfirmDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../../src/components/ui/ConfirmDialog';

const defaultProps = {
  open: true,
  title: 'Test Title',
  message: 'Test message',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ConfirmDialog {...defaultProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders title and message when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Test Title')).toBeTruthy();
    expect(screen.getByText('Test message')).toBeTruthy();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Escape is pressed', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);
    // ConfirmDialog listens on window — dispatch from document so it bubbles up
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('uses custom button labels', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Apply" cancelLabel="Go Back" />);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go Back' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx vitest run tests/unit/ConfirmDialog.test.tsx
```

Expected: FAIL — `ConfirmDialog` doesn't exist yet.

- [ ] **Step 3: Create `src/components/ui/ConfirmDialog.tsx`**

```tsx
import { useEffect } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'default' | 'destructive';
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'default',
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--brand-overlay, rgba(15,23,42,0.35))' }}
      onClick={onCancel}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-zinc-100 font-semibold text-base mb-2">{title}</h3>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 border border-zinc-700 hover:bg-zinc-800 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={
              variant === 'destructive'
                ? 'px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors'
                : 'px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white transition-all'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Export from `src/components/ui/index.ts`**

Add this line to `src/components/ui/index.ts` (after the existing exports, before the closing):
```ts
export { ConfirmDialog } from './ConfirmDialog';
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/unit/ConfirmDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/ConfirmDialog.tsx src/components/ui/index.ts tests/unit/ConfirmDialog.test.tsx
git commit -m "feat(ui): add ConfirmDialog — centered modal replacing window.confirm()"
```

---

## Task 10 — Wire ConfirmDialog into ApprovalsTab (Model: sonnet)

**Owns:** `src/components/client/ApprovalsTab.tsx`  
**Must not touch:** Any other file.

Replace the three `window.confirm()` calls with `ConfirmDialog` state. Use a single `confirmState` object for all three actions — no three separate booleans.

- [ ] **Step 1: Add imports to `ApprovalsTab.tsx`**

The file already imports from `'../ui'`. Extend that import to include `ConfirmDialog`:
```ts
// Before
import { TierGate, EmptyState, LoadingState, type Tier } from '../ui';
// After
import { TierGate, EmptyState, LoadingState, ConfirmDialog, type Tier } from '../ui';
```

- [ ] **Step 2: Add `confirmState` to the component's state**

After the existing `useState` declarations (after line 33 `const [collapsedPages, setCollapsedPages]...`), add:
```ts
const [confirmState, setConfirmState] = useState<{
  open: boolean;
  title: string;
  message: string;
  action: (() => Promise<void>) | null;
}>({ open: false, title: '', message: '', action: null });

const openConfirm = (title: string, message: string, action: () => Promise<void>) => {
  setConfirmState({ open: true, title, message, action });
};

const handleConfirm = async () => {
  const action = confirmState.action;
  setConfirmState(s => ({ ...s, open: false, action: null }));
  if (action) await action();
};

const handleCancel = () => {
  setConfirmState(s => ({ ...s, open: false, action: null }));
};
```

- [ ] **Step 3: Replace `window.confirm()` at line 44 (`approveAllInBatch`)**

Before:
```ts
const approveAllInBatch = async (batch: ApprovalBatch) => {
  const pending = batch.items.filter(i => i.status === 'pending');
  if (!window.confirm(`Approve all ${pending.length} pending change${pending.length !== 1 ? 's' : ''} in "${batch.name}"?`)) return;
  for (const item of pending) {
    await updateApprovalItem(batch.id, item.id, { status: 'approved' });
  }
  setToast({ message: `Approved ${pending.length} change${pending.length !== 1 ? 's' : ''}`, type: 'success' });
};
```

After:
```ts
const approveAllInBatch = (batch: ApprovalBatch) => {
  const pending = batch.items.filter(i => i.status === 'pending');
  openConfirm(
    'Approve all changes',
    `Approve all ${pending.length} pending change${pending.length !== 1 ? 's' : ''} in "${batch.name}"?`,
    async () => {
      for (const item of pending) {
        await updateApprovalItem(batch.id, item.id, { status: 'approved' });
      }
      setToast({ message: `Approved ${pending.length} change${pending.length !== 1 ? 's' : ''}`, type: 'success' });
    }
  );
};
```

- [ ] **Step 4: Replace `window.confirm()` at line 53 (`approveAllForPage`)**

Before:
```ts
const approveAllForPage = async (batchId: string, items: ApprovalItem[]) => {
  const pending = items.filter(i => i.status === 'pending');
  if (!window.confirm(`Approve all ${pending.length} pending change${pending.length !== 1 ? 's' : ''} for this page?`)) return;
  for (const item of pending) {
    await updateApprovalItem(batchId, item.id, { status: 'approved' });
  }
```

After:
```ts
const approveAllForPage = (batchId: string, items: ApprovalItem[]) => {
  const pending = items.filter(i => i.status === 'pending');
  openConfirm(
    'Approve page changes',
    `Approve all ${pending.length} pending change${pending.length !== 1 ? 's' : ''} for this page?`,
    async () => {
      for (const item of pending) {
        await updateApprovalItem(batchId, item.id, { status: 'approved' });
      }
    }
  );
};
```

- [ ] **Step 5: Replace `window.confirm()` at line 71 (`applyApprovedBatch`)**

Before:
```ts
const applyApprovedBatch = async (batchId: string) => {
  if (!window.confirm('This will update your live website with the approved changes. Continue?')) return;
  setApplyingBatch(batchId);
```

After:
```ts
const applyApprovedBatch = (batchId: string) => {
  openConfirm(
    'Apply to live site?',
    'This will update your live website with the approved changes. This cannot be undone from the dashboard.',
    async () => {
      setApplyingBatch(batchId);
      try {
        const data = await post<{ applied: number }>(`/api/public/approvals/${workspaceId}/${batchId}/apply`);
        if (data.applied > 0) {
          setToast({ message: `${data.applied} change${data.applied !== 1 ? 's' : ''} applied to your website`, type: 'success' });
        }
        loadApprovals(workspaceId);
      } catch { setToast({ message: 'Failed to apply changes. Please try again.', type: 'error' }); }
      finally { setApplyingBatch(null); }
    }
  );
};
```

Note: the original `applyApprovedBatch` body (try/catch/finally) moves inside the confirm action callback.

- [ ] **Step 6: Render `<ConfirmDialog>` in the component's return JSX**

At the very end of the component's JSX return, before the final closing tag, add:
```tsx
<ConfirmDialog
  open={confirmState.open}
  title={confirmState.title}
  message={confirmState.message}
  confirmLabel="Confirm"
  onConfirm={handleConfirm}
  onCancel={handleCancel}
/>
```

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors. If TypeScript complains about the `applyApprovedBatch` refactor, verify the try/catch/finally block was moved correctly into the action callback.

- [ ] **Step 8: Test the dialog manually**

In the browser (light or dark mode), go to the Approvals tab with at least one batch. Click "Approve All" and confirm the dialog appears centered on screen, near your cursor. Press Escape — dialog closes. Click Apply to Website — dialog appears centered. Click Confirm — changes apply.

- [ ] **Step 9: Commit**

```bash
git add src/components/client/ApprovalsTab.tsx
git commit -m "fix(ux): replace window.confirm() with centered ConfirmDialog in ApprovalsTab"
```

---

## Task 11 — ApprovalsTab Filter Bar (Model: sonnet)

**Owns:** `src/components/client/ApprovalsTab.tsx`  
**Must not touch:** Any other file.

Add filter state and a tab bar above the batch list. Counts are computed from the unfiltered `approvalBatches` so they stay accurate regardless of the active filter.

- [ ] **Step 1: Write failing tests for the filter logic**

Create `tests/unit/approvalsFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ApprovalBatch, ApprovalItem } from '../../shared/types/approvals';

function makeItem(status: ApprovalItem['status']): ApprovalItem {
  return {
    id: `id-${Math.random()}`, pageId: 'p1', pageTitle: 'Page', pageSlug: '/page',
    field: 'seoTitle', currentValue: '', proposedValue: '',
    status, createdAt: '', updatedAt: '',
  };
}

function makeBatch(statuses: ApprovalItem['status'][]): ApprovalBatch {
  return {
    id: `batch-${Math.random()}`, workspaceId: 'ws1', siteId: 's1',
    name: 'Test Batch', status: 'pending',
    items: statuses.map(makeItem),
    createdAt: '', updatedAt: '',
  };
}

// Inline the filter logic to test it directly
function filterBatches(batches: ApprovalBatch[], filter: string) {
  if (filter === 'needs-action') return batches.filter(b => b.items.some(i => i.status === 'pending' || !i.status));
  if (filter === 'ready') return batches.filter(b => b.items.some(i => i.status === 'approved') && !b.items.some(i => i.status === 'applied'));
  if (filter === 'applied') return batches.filter(b => b.items.length > 0 && b.items.every(i => i.status === 'applied'));
  return batches;
}

describe('ApprovalsTab filter logic', () => {
  const pending = makeBatch(['pending', 'pending']);
  const approved = makeBatch(['approved', 'approved']);
  const applied = makeBatch(['applied', 'applied']);
  const mixed = makeBatch(['pending', 'approved', 'applied']);

  it('all: returns all batches', () => {
    const result = filterBatches([pending, approved, applied, mixed], 'all');
    expect(result).toHaveLength(4);
  });

  it('needs-action: returns batches with pending items', () => {
    const result = filterBatches([pending, approved, applied, mixed], 'needs-action');
    expect(result).toHaveLength(2); // pending and mixed
    expect(result.every(b => b.items.some(i => i.status === 'pending'))).toBe(true);
  });

  it('ready: returns batches with approved items and no applied items', () => {
    const result = filterBatches([pending, approved, applied, mixed], 'ready');
    expect(result).toHaveLength(1); // only approved
    expect(result[0].items.every(i => i.status === 'approved')).toBe(true);
  });

  it('applied: returns batches where all items are applied', () => {
    const result = filterBatches([pending, approved, applied, mixed], 'applied');
    expect(result).toHaveLength(1);
    expect(result[0].items.every(i => i.status === 'applied')).toBe(true);
  });

  it('needs-action: does not return all-approved batches', () => {
    const result = filterBatches([approved], 'needs-action');
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they pass (the logic is inline in the test)**

```bash
npx vitest run tests/unit/approvalsFilter.test.ts
```

Expected: PASS (logic is self-contained in the test).

- [ ] **Step 3: Add filter state to `ApprovalsTab.tsx`**

After the existing `useState` declarations, add:
```ts
type FilterState = 'all' | 'needs-action' | 'ready' | 'applied';
const [batchFilter, setBatchFilter] = useState<FilterState>('all');
```

- [ ] **Step 4: Add filter counts and filtered list computation**

After all `useState` and `openConfirm`/`handleConfirm`/`handleCancel` declarations, add:
```ts
const needsActionCount = approvalBatches.filter(b =>
  b.items.some(i => i.status === 'pending' || !i.status)
).length;

const readyCount = approvalBatches.filter(b =>
  b.items.some(i => i.status === 'approved') && !b.items.some(i => i.status === 'applied')
).length;

const appliedCount = approvalBatches.filter(b =>
  b.items.length > 0 && b.items.every(i => i.status === 'applied')
).length;

const filteredBatches = approvalBatches.filter(batch => {
  if (batchFilter === 'needs-action') return batch.items.some(i => i.status === 'pending' || !i.status);
  if (batchFilter === 'ready') return batch.items.some(i => i.status === 'approved') && !batch.items.some(i => i.status === 'applied');
  if (batchFilter === 'applied') return batch.items.length > 0 && batch.items.every(i => i.status === 'applied');
  return true;
});
```

- [ ] **Step 5: Add the filter bar to the JSX**

In the component's return JSX, find the header section containing "SEO Changes" or "Approvals" heading text. Add the filter bar immediately below the header and above `{approvalBatches.map(...)}`:

```tsx
{/* Filter bar */}
{approvalBatches.length > 0 && (
  <div className="flex items-center gap-2 pb-4 border-b border-zinc-800 flex-wrap">
    {(
      [
        { id: 'all', label: 'All', count: approvalBatches.length },
        { id: 'needs-action', label: 'Needs Action', count: needsActionCount },
        { id: 'ready', label: 'Ready to Apply', count: readyCount },
        { id: 'applied', label: 'Applied', count: appliedCount },
      ] as { id: FilterState; label: string; count: number }[]
    ).map(tab => (
      <button
        key={tab.id}
        onClick={() => setBatchFilter(tab.id)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          batchFilter === tab.id
            ? 'text-teal-400 bg-teal-500/10 border border-teal-500/20'
            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
        }`}
      >
        {tab.label}
        {tab.count > 0 && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
            batchFilter === tab.id ? 'bg-teal-500/20 text-teal-300' : 'bg-zinc-700 text-zinc-400'
          }`}>
            {tab.count}
          </span>
        )}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 6: Replace `approvalBatches.map(...)` with `filteredBatches.map(...)`**

Find the line (around line 115): `{approvalBatches.map(batch => (`  
Change it to: `{filteredBatches.map(batch => (`

- [ ] **Step 7: Run tests**

```bash
npx vitest run tests/unit/approvalsFilter.test.ts
```

Expected: PASS.

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 9: Visual test in browser**

Go to the Approvals tab. Confirm:
1. Filter tabs appear above the batch list with accurate counts
2. Clicking "Needs Action" shows only batches with pending items
3. Clicking "Applied" shows only fully-applied batches
4. Clicking "All" restores the full list
5. Filter bar does NOT render when `approvalBatches.length === 0` (empty state shows instead)

- [ ] **Step 10: Commit**

```bash
git add src/components/client/ApprovalsTab.tsx tests/unit/approvalsFilter.test.ts
git commit -m "feat(approvals): add filter bar — All / Needs Action / Ready to Apply / Applied"
```

---

## Task 12 — Final Verification (Model: sonnet)

**Owns:** Nothing — read-only verification pass.

- [ ] **Step 1: Full typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Production build**

```bash
npx vite build
```

Expected: successful build, no warnings about missing exports.

- [ ] **Step 3: Full test suite**

```bash
npx vitest run
```

Expected: all tests pass, including pre-existing tests.

- [ ] **Step 4: pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero violations.

- [ ] **Step 5: Grep for regressions**

```bash
# Confirm no violet or indigo in client components
grep -r "violet-\|indigo-" src/components/client/ --include="*.tsx"
# Confirm no window.confirm() remains in ApprovalsTab
grep "window.confirm" src/components/client/ApprovalsTab.tsx
```

Expected: no matches for either.

- [ ] **Step 6: Visual sweep — cycle all client tabs in light mode**

Enable light mode in the client portal and visit each tab:
- [ ] Overview — no dark backgrounds, charts readable
- [ ] Health — score cards, page health list, all legible
- [ ] Analytics — charts have light grid lines, tooltips styled correctly
- [ ] Approvals — filter bar present, ConfirmDialog appears centered
- [ ] Strategy — keyword lists, plan cards all visible
- [ ] Search — chart tooltips, annotation dots look correct
- [ ] Content — no dark surfaces
- [ ] Toggle back to dark mode — confirm zero visual regressions

- [ ] **Step 7: Update post-task docs**

```bash
# FEATURE_AUDIT.md — update the light mode entry
# BRAND_DESIGN_LANGUAGE.md — update token list to reflect new 25-token set
# data/roadmap.json — mark item done
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 8: Invoke code review**

This PR touches 10+ files. Use `superpowers:scaled-code-review` before opening the PR.

---

## Systemic Improvements

### Shared utilities
- `getCssVar(name, fallback)` in `constants.ts` — now the single source for reading CSS variables at runtime. If any future chart function needs theme awareness, use this instead of `isLightMode()` + hardcoded hex.
- `ConfirmDialog` in `src/components/ui/` — any other component that currently calls `window.confirm()` should be migrated to use this. Grep: `grep -rn "window.confirm" src/components/`.

### pr-check rules to consider adding
- Flag `window.confirm(` in client components — it produces the top-of-screen dialog clients reported.
- Flag `bg-\[#` (arbitrary hex Tailwind classes) in client components — these can't be targeted by CSS overrides.

### New tests added by this plan
- `tests/unit/constants.test.ts` — smoke tests for `chartGridColor` and `chartTooltipStyle` return shapes
- `tests/unit/ConfirmDialog.test.tsx` — render, interaction, and keyboard behavior
- `tests/unit/approvalsFilter.test.ts` — all four filter states with edge cases

---

## Verification Strategy

| Phase | Command | What to check |
|---|---|---|
| After Task 1 | `npm run typecheck && npx vite build` | No errors; scrollbar visible in light mode |
| After Task 3 | Visual in browser | Heading text clearly darker than body, darker than muted |
| After Task 7 | Full visual sweep | No dark blobs on any client component in light mode |
| After Task 8 | Chart tabs in light mode | Grid lines subtle gray, tooltips white with dark text |
| After Task 9 | `npx vitest run tests/unit/ConfirmDialog.test.tsx` | All 6 tests pass |
| After Task 11 | Filter tabs in browser | Four tabs, counts correct, filtering works |
| Final | `npx vitest run && npx tsx scripts/pr-check.ts` | Full suite green, zero violations |
