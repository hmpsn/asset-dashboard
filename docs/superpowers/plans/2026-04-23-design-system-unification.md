# Design System Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a formal 3-tier CSS surface token system, wire it into the shared primitives, add automated pr-check enforcement, audit all 47 affected files, then migrate them by subsystem cluster.

**Architecture:** Phase 0 adds surface tokens and wires them into SectionCard/StatCard/Skeleton (the linchpin — without this, migrations don't advance the token system). Phase 1 adds enforcement rules. Phase 2 produces a categorized migration inventory. Phase 3 executes six subsystem-cluster PRs. Phase 4 adds primitives identified as missing during Phase 3.

**Brand framing:** Phase 3 is an intentional brand upgrade, not a neutral refactor. Cards migrated to SectionCard default get the brand asymmetric radius (`10px 24px 10px 24px`). This is correct and desired. Document it in each PR description.

**Tech stack:** React 19, TailwindCSS 4, `src/index.css` CSS custom properties, `scripts/pr-check.ts` grep/customCheck harness, `src/components/ui/` shared primitives.

**Known scope:** 92 hand-rolled card instances across 47 files (confirmed via `grep`). Six cluster PRs. Not one-page-per-PR — that would be 47 PRs.

---

## Prerequisites

- [ ] v9 Styleguide HTML available for Task 0.3 — Tasks 0.1, 0.2, 0.5 can start without it
- [ ] `npm run typecheck` passes on current branch
- [ ] `npx tsx scripts/pr-check.ts` passes on current branch

---

## Phase 0 — Ground Truth (one PR)

> Additive only. Zero visual change. Every later phase depends on this landing first.

### Task 0.1 — Add `--surface-N` and `--radius-*` tokens to `src/index.css` (Model: haiku)

**Owns:** `src/index.css`
**Must not touch:** any `.tsx` file, design docs

- [ ] **Step 1: Replace the `:root` block (lines 12–29)**

The existing block defines `--brand-bg-*` with raw hex. Replace entirely with:

```css
:root {
  /* ─── 3-tier surface system (canonical — use in new code) ─── */
  --surface-1: #0f1219;       /* page background / absolute base */
  --surface-2: #18181b;       /* primary card surfaces (bg-zinc-900 equivalent) */
  --surface-3: #27272a;       /* elevated: inputs, active tabs, hover (bg-zinc-800 equivalent) */

  /* ─── Radius scale ─── */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;          /* cards, panels — use rounded-[var(--radius-lg)] in new code */
  --radius-xl: 16px;          /* modals, large overlays */

  /* ─── Legacy background aliases (do not use in new code) ─── */
  --brand-bg: var(--surface-1);
  --brand-bg-surface: var(--surface-2);
  --brand-bg-elevated: var(--surface-2);
  --brand-bg-card: var(--surface-3);

  /* ─── Text ─── */
  --brand-text: #a1a1aa;
  --brand-text-bright: #e4e4e7;
  --brand-text-muted: #71717a;

  /* ─── Brand accent ─── */
  --brand-mint: #2dd4bf;
  --brand-mint-hover: #5eead4;
  --brand-mint-dim: rgba(45, 212, 191, 0.1);
  --brand-mint-glow: rgba(45, 212, 191, 0.18);
  --brand-yellow: #ffb600;
  --brand-yellow-dim: rgba(255, 182, 0, 0.1);
  --brand-border: #27272a;
  --brand-border-hover: #3f3f46;
  --radius: 10px; /* legacy — prefer --radius-* scale */
}
```

- [ ] **Step 2: Add light-mode surface overrides inside the `.dashboard-light` block**

Find `.dashboard-light {` (around line 278 after your edits). Add immediately after the opening brace, before the existing `/* Backgrounds */` comment:

```css
  /* ─── Surface tokens (light-mode overrides) ─── */
  --surface-1: #f8fafc;
  --surface-2: #ffffff;
  --surface-3: #f1f5f9;
```

- [ ] **Step 3: Confirm computed values are identical**

```bash
npm run dev
```

Open `/styleguide`. All cards, inputs, page backgrounds must look visually identical to before. The tokens are purely additive aliases at this point.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat(tokens): introduce --surface-1/2/3 and --radius-* CSS variables

Adds a formal 3-tier surface system. --brand-bg-* are now var() aliases
so computed values are unchanged — zero visual difference.
--radius-sm/md/lg/xl give a named scale to replace hardcoded Tailwind
radius classes on new card elements."
```

---

### Task 0.2 — Update design docs to reference canonical token names (Model: haiku)

**Owns:** `DESIGN_SYSTEM.md`, `BRAND_DESIGN_LANGUAGE.md`
**Must not touch:** `src/index.css`, any `.tsx` file

- [ ] **Step 1: Replace the Surface Colors section in `BRAND_DESIGN_LANGUAGE.md`**

Find `### Surface Colors (Dark Mode — Default)` (around line 71). Replace the section through the end of the Light Mode table with:

```markdown
### Surface Colors

> **Canonical tokens are `--surface-N`.** The `--brand-bg-*` names are legacy aliases kept for backward compatibility — do not use them in new code.

#### Dark Mode (default)

| Canonical Token | Value | Tailwind Equivalent | Legacy Alias | Usage |
|-----------------|-------|---------------------|--------------|-------|
| `--surface-1` | `#0f1219` | body background | `--brand-bg` | Page background / absolute base |
| `--surface-2` | `#18181b` | `bg-zinc-900` | `--brand-bg-surface`, `--brand-bg-elevated` | Primary card surfaces |
| `--surface-3` | `#27272a` | `bg-zinc-800` | `--brand-bg-card` | Elevated: inputs, active tabs, hover states |
| `--border-default` | `#27272a` | `border-zinc-800` | `--brand-border` | Card borders |
| `--border-hover` | `#3f3f46` | `border-zinc-700` | `--brand-border-hover` | Hover border state |
| `--text-primary` | `#f4f4f5` | `text-zinc-100` | — | Headings, key content |
| `--text-secondary` | `#b4b4bc` | `text-zinc-400` | — | Descriptions, supporting text |
| `--text-muted` | `#a1a1aa` | `text-zinc-500` | — | Captions, timestamps, labels |
| `--text-subtle` | `#71717a` | `text-zinc-600/700` | — | Disabled, dividers |

#### Light Mode (`.dashboard-light`)

| Canonical Token | Value | Usage |
|-----------------|-------|-------|
| `--surface-1` | `#f8fafc` | Page background |
| `--surface-2` | `#ffffff` | Card backgrounds |
| `--surface-3` | `#f1f5f9` | Inputs, active tabs |
| `--border-default` | `#e2e8f0` | Card borders |
| `--text-primary` | `#0f172a` | Dark navy — headings, key content |
| `--text-secondary` | `#334155` | Descriptions |
| `--text-muted` | `#475569` | Captions, labels |
| `--text-subtle` | `#64748b` | Disabled |
```

- [ ] **Step 2: Add radius scale table to `DESIGN_SYSTEM.md`**

After the Typography Scale table, insert:

```markdown
---

## Radius Scale

| Token | Value | Tailwind Equivalent | Usage |
|-------|-------|---------------------|-------|
| `--radius-sm` | `6px` | `rounded` | Small controls, pills, badges |
| `--radius-md` | `8px` | `rounded-md` | Buttons, inputs |
| `--radius-lg` | `12px` | `rounded-xl` | Cards, panels — new code uses `rounded-[var(--radius-lg)]` |
| `--radius-xl` | `16px` | `rounded-2xl` | Modals, large overlays |

**Brand asymmetric radius:** `SectionCard` default variant uses `10px 24px 10px 24px` (the brand signature). This is intentional and correct. The `--radius-lg` token governs new generic cards; the asymmetric radius is a SectionCard-specific design decision, not a token.

**Rule for new card elements:** use `rounded-[var(--radius-lg)]` not the hardcoded Tailwind class `rounded-xl`. This makes the radius system themeable.
```

- [ ] **Step 3: Update the Color System table in `DESIGN_SYSTEM.md`**

Find `### Dark Mode (default)` around line 52. Replace its table to add the Canonical Token column:

```markdown
### Dark Mode (default)

| Canonical Token | Legacy Name | Value | Tailwind | Usage |
|-----------------|-------------|-------|----------|-------|
| `--surface-1` | `--brand-bg` | #0f1219 | — | Page background |
| `--surface-2` | `--brand-bg-surface/elevated` | #18181b | bg-zinc-900 | Card backgrounds |
| `--surface-3` | `--brand-bg-card` | #27272a | bg-zinc-800 | Inputs, active tabs, hover states |
| — | `--brand-border` | #27272a | border-zinc-800 | Card borders |
| — | `--brand-border-hover` | #3f3f46 | border-zinc-700 | Hover border state |
| — | — | #f4f4f5 | text-zinc-100/200 | Headings, key content |
| — | — | #b4b4bc | text-zinc-400 | Descriptions, supporting text |
| — | — | #a1a1aa | text-zinc-500 | Captions, timestamps, labels |
| — | — | #71717a | text-zinc-600/700 | Disabled, dividers |
```

- [ ] **Step 4: Commit**

```bash
git add DESIGN_SYSTEM.md BRAND_DESIGN_LANGUAGE.md
git commit -m "docs(design-system): document --surface-N as canonical surface tokens

Marks --brand-bg-* as legacy aliases. Adds radius scale table with
brand asymmetric-radius note. Updates both design docs."
```

---

### Task 0.3 — Port Styleguide v9 content into `src/components/Styleguide.tsx` (Model: sonnet)

**Prerequisite:** v9 Styleguide HTML must be pasted/available.

**Owns:** `src/components/Styleguide.tsx`
**Must not touch:** `src/index.css`, design docs

The v9 adds four things missing from the current file: manifesto section, scroll-spy TOC, motion section, and surface/radius documentation.

- [ ] **Step 1: Add `useRef` to the React import**

Current first import line:
```tsx
import { useState } from 'react';
```
Replace with:
```tsx
import { useState, useEffect, useRef } from 'react';
```

- [ ] **Step 2: Add scroll-spy state after the existing `useState` declarations**

After `const [activeNav, setActiveNav] = useState('overview');`, add:

```tsx
const [activeSection, setActiveSection] = useState('manifesto');
const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

useEffect(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setActiveSection(entry.target.id);
      }
    },
    { rootMargin: '-20% 0px -70% 0px' }
  );
  Object.values(sectionRefs.current).forEach(el => { if (el) observer.observe(el); });
  return () => observer.disconnect();
}, []);
```

- [ ] **Step 3: Add `TOC_SECTIONS` constant after `NAV_ITEMS`**

```tsx
const TOC_SECTIONS = [
  { id: 'manifesto', label: 'Manifesto' },
  { id: 'typography', label: 'Typography' },
  { id: 'colors', label: 'Color Palette' },
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'metric-rings', label: 'MetricRing' },
  { id: 'stat-cards', label: 'StatCard' },
  { id: 'page-header', label: 'PageHeader' },
  { id: 'section-card', label: 'SectionCard' },
  { id: 'date-range', label: 'DateRange' },
  { id: 'tab-bar', label: 'TabBar' },
  { id: 'badges', label: 'Badge' },
  { id: 'empty-state', label: 'EmptyState' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'data-list', label: 'DataList' },
  { id: 'charts', label: 'Charts' },
  { id: 'tables', label: 'Tables' },
  { id: 'modals', label: 'Modals' },
  { id: 'toasts', label: 'Toasts' },
  { id: 'forms', label: 'Forms' },
  { id: 'loading', label: 'Loading' },
  { id: 'motion', label: 'Motion' },
  { id: 'navigation', label: 'Navigation' },
];
```

- [ ] **Step 4: Wrap the main layout in a two-column flex with sticky TOC**

Replace:
```tsx
<div className="max-w-6xl mx-auto px-6 py-8 space-y-10">
```
With:
```tsx
<div className="max-w-7xl mx-auto px-6 py-8 flex gap-8">
  {/* Scroll-spy TOC */}
  <aside className="hidden xl:block w-44 shrink-0">
    <div className="sticky top-8 space-y-0.5">
      <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-3 px-2">Sections</div>
      {TOC_SECTIONS.map(s => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className={`block px-2 py-1 rounded text-xs transition-colors ${
            activeSection === s.id
              ? 'text-teal-400 bg-teal-500/10'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {s.label}
        </a>
      ))}
    </div>
  </aside>
  {/* Content */}
  <div className="flex-1 min-w-0 space-y-10">
```

Before `</ErrorBoundary>`, add the two closing divs:
```tsx
  </div>{/* content */}
</div>{/* flex */}
```

- [ ] **Step 5: Add Manifesto section as the first section inside the content div**

```tsx
{/* ═══════════ MANIFESTO ═══════════ */}
<section
  id="manifesto"
  ref={el => { sectionRefs.current['manifesto'] = el; }}
  className="space-y-4"
>
  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8">
    <div className="text-[11px] text-teal-400 uppercase tracking-widest font-medium mb-3">Design Manifesto</div>
    <h1 className="text-2xl font-bold text-zinc-100 mb-4 leading-tight">
      Every pixel earns its place.<br />Every interaction has intent.
    </h1>
    <p className="text-sm text-zinc-400 leading-relaxed max-w-2xl">
      This design system exists for one reason: clients should understand their SEO performance
      at a glance. Data-dense layouts use hierarchy, not decoration. Color carries semantic meaning —
      teal for action, blue for data, never gratuitous. The system enforces this so the product
      stays coherent as it grows.
    </p>
    <div className="mt-6 grid grid-cols-3 gap-4 max-w-lg">
      {[
        { label: 'Teal', desc: 'Action', color: 'bg-teal-500' },
        { label: 'Blue', desc: 'Data', color: 'bg-blue-500' },
        { label: 'Purple', desc: 'Admin AI only', color: 'bg-purple-500' },
      ].map(item => (
        <div key={item.label} className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${item.color}`} />
          <div>
            <div className="text-xs font-medium text-zinc-300">{item.label}</div>
            <div className="text-[11px] text-zinc-500">{item.desc}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
</section>
```

- [ ] **Step 6: Add Surface System section between Color Palette and MetricRing**

```tsx
{/* ═══════════ SURFACE SYSTEM ═══════════ */}
<section
  id="surfaces"
  ref={el => { sectionRefs.current['surfaces'] = el; }}
  className="space-y-4"
>
  <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Surface System</h2>
  <p className="text-xs text-zinc-400">
    Three tiers of elevation. New primitives use <code className="text-teal-300 bg-zinc-800 px-1 rounded">{'bg-[var(--surface-2)]'}</code> internally.
    Hand-rolled code must do the same. The <code className="text-zinc-500 bg-zinc-800 px-1 rounded">{'--brand-bg-*'}</code> names are legacy aliases.
  </p>
  <div className="grid grid-cols-3 gap-3">
    {[
      { token: '--surface-1', value: '#0f1219', label: 'Surface 1 — Base', desc: 'Page background only. Never use directly on cards.' },
      { token: '--surface-2', value: '#18181b', label: 'Surface 2 — Card', desc: 'SectionCard, StatCard, Skeleton backgrounds.' },
      { token: '--surface-3', value: '#27272a', label: 'Surface 3 — Elevated', desc: 'Inputs, active tabs, hover states.' },
    ].map(s => (
      <div key={s.token} className="rounded-xl border border-zinc-700 p-4" style={{ backgroundColor: s.value }}>
        <div className="text-[11px] text-teal-400 font-mono mb-1">{s.token}</div>
        <div className="text-xs font-medium text-zinc-200">{s.label}</div>
        <div className="text-[11px] text-zinc-500 mt-1">{s.desc}</div>
        <div className="text-[11px] text-zinc-600 mt-2 font-mono">{s.value}</div>
      </div>
    ))}
  </div>
  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
    <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Card Variant Decision</div>
    <div className="grid grid-cols-3 gap-3 text-xs">
      <div className="space-y-1">
        <div className="text-teal-300 font-medium">SectionCard default</div>
        <div className="text-zinc-400">Asymmetric radius<br/><code className="text-zinc-500">10px 24px 10px 24px</code></div>
        <div className="text-zinc-500">Page-level content sections</div>
      </div>
      <div className="space-y-1">
        <div className="text-blue-300 font-medium">SectionCard subtle</div>
        <div className="text-zinc-400">Symmetric radius<br/><code className="text-zinc-500">rounded-lg (8px)</code></div>
        <div className="text-zinc-500">Dense tables, nested cards, inside another SectionCard</div>
      </div>
      <div className="space-y-1">
        <div className="text-zinc-400 font-medium">Hatch (keep as-is)</div>
        <div className="text-zinc-400">Any radius<br/><code className="text-zinc-500">// pr-check-disable</code></div>
        <div className="text-zinc-500">Modals, dialogs, controls that aren't cards</div>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 7: Add Motion section before Sidebar Navigation**

```tsx
{/* ═══════════ MOTION ═══════════ */}
<section
  id="motion"
  ref={el => { sectionRefs.current['motion'] = el; }}
  className="space-y-4"
>
  <h2 className="text-lg font-semibold text-zinc-200 border-b border-zinc-800 pb-2">Motion</h2>
  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
    <p className="text-xs text-zinc-400 mb-4">All animations are defined in <code className="text-teal-300 bg-zinc-800 px-1 rounded">src/index.css</code>. Duration: 150ms for micro-interactions, 300–400ms for entrance animations.</p>
    <div className="grid grid-cols-2 gap-4">
      {[
        { name: 'fadeInUp', usage: 'Cards, page sections entering viewport', css: 'animation: fadeInUp 0.3s ease' },
        { name: 'staggerFadeIn', usage: 'SectionCard staggerIndex prop (60ms per index)', css: 'animationDelay: N * 60ms' },
        { name: 'scaleIn', usage: 'Modals and overlays (scale 0.95 → 1)', css: 'animation: scaleIn 0.2s ease' },
        { name: 'slideUp', usage: 'Toast notifications entering from below', css: 'animation: slideUp 0.25s ease' },
        { name: 'Card hover', usage: 'Applied globally via index.css selector', css: 'transition: border-color 0.2s, box-shadow 0.2s' },
        { name: 'Teal button', usage: 'from-teal-*/to-emerald-* gradient shift', css: 'background-position 0.4s ease' },
      ].map(m => (
        <div key={m.name} className="space-y-1">
          <div className="text-xs font-medium text-zinc-300">{m.name}</div>
          <div className="text-[11px] text-zinc-400 font-mono bg-zinc-800 px-2 py-1 rounded">{m.css}</div>
          <div className="text-[11px] text-zinc-500">{m.usage}</div>
        </div>
      ))}
    </div>
  </div>
</section>
```

- [ ] **Step 8: Add `id` and `ref` to every existing section**

Apply `id="<value>"` and `ref={el => { sectionRefs.current['<value>'] = el; }}` to every existing `<section>`:

| Heading text | id value |
|---|---|
| Typography | `typography` |
| Color Palette | `colors` |
| MetricRing | `metric-rings` |
| StatCard | `stat-cards` |
| PageHeader | `page-header` |
| SectionCard | `section-card` |
| DateRangeSelector | `date-range` |
| TabBar | `tab-bar` |
| Badge | `badges` |
| EmptyState | `empty-state` |
| Buttons | `buttons` |
| DataList | `data-list` |
| Line / Area Charts | `charts` |
| ChartPointDetail | (merge into charts section, no separate id) |
| Tables | `tables` |
| Modal / Dialog | `modals` |
| Toast Notifications | `toasts` |
| Form Inputs | `forms` |
| Loading States | `loading` |
| Sidebar Navigation | `navigation` |

- [ ] **Step 9: Typecheck and visual verify**

```bash
npm run typecheck
```

Open browser `/styleguide`. Verify: TOC visible at xl+ width, highlights active section on scroll, Surface System and Motion sections present, Manifesto at top.

- [ ] **Step 10: Commit**

```bash
git add src/components/Styleguide.tsx
git commit -m "feat(styleguide): add scroll-spy TOC, manifesto, surface system, motion sections

Ports v9 additions: sticky IntersectionObserver TOC, manifesto intro,
3-tier surface system with variant decision guide, and motion reference.
All sections wired with id + ref for TOC tracking."
```

---

### Task 0.5 — Wire `--surface-2` into SectionCard, StatCard, and Skeleton (Model: haiku)

**This is the architectural linchpin.** Without this, Phase 3 migrations adopt SectionCard but SectionCard still themes via Tailwind class overrides, not `--surface-N`. The token system stays cosmetic.

**Why this is safe:** Phase 0.1 adds `.dashboard-light { --surface-2: #ffffff; }`. The Tailwind class override `.dashboard-light .bg-zinc-900 { background-color: ...; }` remains in `src/index.css` for all other components that haven't migrated yet. So light-mode theming works for both old and new code simultaneously.

**Owns:** `src/components/ui/SectionCard.tsx`, `src/components/ui/StatCard.tsx`, `src/components/ui/Skeleton.tsx`
**Must not touch:** any page component file, `src/index.css`

- [ ] **Step 1: Update SectionCard.tsx**

In `SectionCard.tsx` lines 35–37, replace the `containerClasses` assignment:

```tsx
// Before:
const containerClasses = isSubtle
    ? 'bg-zinc-900/40 border border-zinc-800 rounded-lg overflow-hidden transition-colors duration-200'
    : 'bg-zinc-900 border border-zinc-800 transition-colors duration-200';

// After:
const containerClasses = isSubtle
    ? 'bg-[var(--surface-2)]/40 border border-zinc-800 rounded-lg overflow-hidden transition-colors duration-200'
    : 'bg-[var(--surface-2)] border border-zinc-800 transition-colors duration-200';
```

Also update the JSDoc comment on line 17 to reflect the new token:
```tsx
// Before: — solid `bg-zinc-900` with the brand asymmetric...
// After:  — solid `bg-[var(--surface-2)]` with the brand asymmetric...
```

- [ ] **Step 2: Update StatCard.tsx**

Line 42 (StatCard card wrapper):
```tsx
// Before:
className={`bg-zinc-900 ${isHero ? 'p-4' : 'p-3'} border border-zinc-800 ...`}

// After:
className={`bg-[var(--surface-2)] ${isHero ? 'p-4' : 'p-3'} border border-zinc-800 ...`}
```

Line 79 (CompactStatBar wrapper):
```tsx
// Before:
className={`bg-zinc-900 border border-zinc-800 px-5 py-3 ...`}

// After:
className={`bg-[var(--surface-2)] border border-zinc-800 px-5 py-3 ...`}
```

- [ ] **Step 3: Update Skeleton.tsx**

Three instances — all are card-mimicking wrappers (they mimic SectionCard's look):

Line 19:
```tsx
// Before: `bg-zinc-900 p-4 border border-zinc-800 ${className ?? ''}`
// After:  `bg-[var(--surface-2)] p-4 border border-zinc-800 ${className ?? ''}`
```

Line 33:
```tsx
// Before: `bg-zinc-900 border border-zinc-800 p-5 space-y-3 ${className ?? ''}`
// After:  `bg-[var(--surface-2)] border border-zinc-800 p-5 space-y-3 ${className ?? ''}`
```

Line 86:
```tsx
// Before: "bg-zinc-900 border border-zinc-800 p-5"
// After:  "bg-[var(--surface-2)] border border-zinc-800 p-5"
```

- [ ] **Step 4: Verify light mode still works**

```bash
npm run dev
```

Open `/styleguide`, toggle to Light Mode. SectionCard, StatCard, CompactStatBar, and Skeleton wrappers must all show white backgrounds. If any are dark, the `.dashboard-light { --surface-2: #ffffff; }` override from Task 0.1 is not being applied — check that it was added inside the `.dashboard-light` block, not outside.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/SectionCard.tsx src/components/ui/StatCard.tsx src/components/ui/Skeleton.tsx
git commit -m "feat(primitives): wire --surface-2 into SectionCard, StatCard, Skeleton

Replaces hardcoded bg-zinc-900 with bg-[var(--surface-2)] in the three
card-surface primitives. Light-mode theming now works via the CSS var
override in .dashboard-light rather than a Tailwind class override.
Zero visual change — --surface-2 resolves to #18181b in dark mode and
#ffffff in light mode, same as the previous class-based overrides."
```

---

### Task 0.4 — Phase 0 PR gate (Model: haiku)

- [ ] **Step 1: Full quality gate**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

All must pass. Zero errors.

- [ ] **Step 2: Open PR targeting `staging`**

PR title: `feat(design-system): Phase 0 — surface tokens, primitive token wiring, styleguide v9`

PR description must include:
- Screenshot of styleguide in dark mode showing TOC + new Surface System section
- Screenshot of styleguide in light mode showing cards correctly white (confirms Task 0.5 wiring)

---

## Phase 1 — Enforcement Rules (one PR, after Phase 0 merged)

> Rules that prevent new drift. Must ship before Phase 3 so migrated code is verified clean on every commit.

### Task 1.1 — Add six pr-check rules to `scripts/pr-check.ts` + enforcement doc (Model: sonnet)

**Owns:** `scripts/pr-check.ts`, `docs/rules/design-system-enforcement.md` (new)
**Must not touch:** `src/`

All six rules must scope violations to **git-diff'd files only** (not the entire repo) so existing code isn't flagged en masse during the migration period. Use the `fileGlobs` + `exclude` mechanism for pattern-based rules; for `customCheck` rules, filter against `files` (the diff'd file list passed as the first argument).

Add these six entries at the END of the `CHECKS` array before the closing `];` (line 783+).

- [ ] **Step 1: Add Rule A — Legacy surface token in new code**

```typescript
  {
    name: 'Legacy surface token in new code',
    pattern: 'var\\(--brand-bg-',
    fileGlobs: ['*.tsx', '*.css'],
    exclude: ['src/index.css', 'src/components/Styleguide.tsx'],
    message: 'Use var(--surface-1/2/3) instead of var(--brand-bg-*). The --brand-bg-* names are legacy aliases — see DESIGN_SYSTEM.md.',
    severity: 'warn',
    rationale: 'Prevents new code from using deprecated token names that bypass the 3-tier surface system.',
    claudeMdRef: '#design-system--the-three-laws-of-color',
  },
```

- [ ] **Step 2: Add Rule B — Hand-rolled card pattern**

```typescript
  {
    name: 'Hand-rolled card div (use SectionCard)',
    pattern: 'className="[^"]*bg-zinc-9[0-9]{2}[^"]*rounded-xl',
    fileGlobs: ['*.tsx'],
    exclude: [
      'src/components/Styleguide.tsx',
      'src/components/ui/', // ConfirmDialog (modal), ProgressIndicator (not a card) — correct use of rounded-xl
    ],
    message: 'Use <SectionCard> or <SectionCard variant="subtle"> instead of hand-rolling bg-zinc-9xx + rounded-xl. Add a // pr-check-disable-next-line comment with justification for modals and non-card elements.',
    severity: 'warn',
    rationale: 'Prevents hand-rolled card divs that bypass the SectionCard primitive and the --surface-N token system.',
    claudeMdRef: '#ui-primitives--always-check-before-hand-rolling',
  },
```

- [ ] **Step 3: Add Rule C — PageHeader required on page components**

This rule maintains a curated list of page-level components. New pages are added to the list when they're created. The list is self-documenting: if a file is on it, it's a page component that must have `<PageHeader`.

```typescript
  {
    name: 'Page component missing PageHeader',
    fileGlobs: [],
    message: 'Top-level page components must use <PageHeader>. Add <PageHeader title="..." subtitle="..." /> or add this file to the exclude list in pr-check.ts with a justification comment.',
    severity: 'warn',
    rationale: 'Enforces consistent page-level header structure across all navigable views.',
    claudeMdRef: '#ui-primitives--always-check-before-hand-rolling',
    customCheck: (_files) => {
      // Curated list of page-level components that must have <PageHeader.
      // Add new page components here when they're created.
      // Files marked "needs migration" will be cleaned up in Phase 3.
      const PAGE_COMPONENTS = [
        // Currently missing PageHeader (Phase 3 migration targets):
        'src/components/ContentPipeline.tsx',
        'src/components/ContentManager.tsx',
        'src/components/SeoAudit.tsx',
        'src/components/KeywordStrategy.tsx',
        'src/components/Performance.tsx',
        'src/components/PageSpeedPanel.tsx',
        'src/components/RankTracker.tsx',
        'src/components/ContentBriefs.tsx',
        'src/components/RevenueDashboard.tsx',
        'src/components/ClientDashboard.tsx',
        'src/components/KeywordAnalysis.tsx',
        // Already have PageHeader (guard against regression):
        'src/components/WorkspaceHome.tsx',
        'src/components/WorkspaceOverview.tsx',
        'src/components/AnalyticsHub.tsx',
        'src/components/BrandHub.tsx',
        'src/components/InternalLinks.tsx',
        'src/components/RedirectManager.tsx',
        'src/components/SiteArchitecture.tsx',
        'src/components/Roadmap.tsx',
        'src/components/LlmsTxtGenerator.tsx',
        'src/components/ContentPerformance.tsx',
        'src/components/ContentPlanner.tsx',
        'src/components/ContentSubscriptions.tsx',
        'src/components/FeatureLibrary.tsx',
      ];
      return PAGE_COMPONENTS
        .filter(p => {
          try {
            const content = readFileSync(path.join(ROOT, p), 'utf-8');
            return !content.includes('<PageHeader');
          } catch {
            return false; // file doesn't exist — not a violation
          }
        })
        .map(p => ({ file: p, line: 1, text: 'Missing <PageHeader>' }));
    },
  },
```

- [ ] **Step 4: Add Rule D — Hardcoded card radius outside ui/***

```typescript
  {
    name: 'Hardcoded card radius outside ui primitives',
    pattern: 'className="[^"]*rounded-xl',
    fileGlobs: ['*.tsx'],
    exclude: [
      'src/components/ui/',        // primitives own their own radius
      'public/styleguide.html',    // static reference doc
    ],
    message: 'Use rounded-[var(--radius-lg)] instead of rounded-xl so the radius is themeable. Add a // pr-check-disable-next-line comment with justification for modals or non-card elements.',
    severity: 'warn',
    rationale: 'Prevents hardcoded Tailwind radius classes that bypass the --radius-* token system.',
    claudeMdRef: '#design-system--the-three-laws-of-color',
  },
```

- [ ] **Step 5: Add Rule E — --radius-signature-lg exclusivity**

```typescript
  {
    name: 'radius-signature-lg used outside SectionCard',
    pattern: '--radius-signature-lg',
    fileGlobs: ['*.tsx', '*.css'],
    exclude: [
      'src/components/ui/SectionCard.tsx',
      'public/styleguide.html',
      'public/styleguide.css',
    ],
    message: '--radius-signature-lg is the brand asymmetric radius (10px 24px 10px 24px) and is only permitted inside SectionCard.tsx. Use --radius-lg for other card elements.',
    severity: 'error',
    rationale: 'The asymmetric corner is a SectionCard-only brand signature. Other components adopting it would dilute the design intent.',
    claudeMdRef: '#design-system--the-three-laws-of-color',
  },
```

- [ ] **Step 6: Add Rule F — Non-standard transition-duration**

```typescript
  {
    name: 'Non-standard transition duration',
    pattern: 'transition-duration-\\[(?!120ms|180ms|400ms)',
    fileGlobs: ['*.tsx', '*.css'],
    exclude: [
      'src/components/ui/',
      'public/styleguide.html',
      'public/styleguide.css',
    ],
    message: 'Use transition-duration-[120ms], transition-duration-[180ms], or transition-duration-[400ms] (or var(--motion-*) when the token system ships). Non-standard durations break motion consistency.',
    severity: 'warn',
    rationale: 'Enforces the three-speed motion system: 120ms (micro), 180ms (standard), 400ms (entrance).',
    claudeMdRef: '#design-system--the-three-laws-of-color',
  },
```

- [ ] **Step 7: Verify all six rules fire correctly**

```bash
# Rule A
echo '.test { background: var(--brand-bg-card); }' > /tmp/test-a.css
npx tsx scripts/pr-check.ts --all 2>&1 | grep "Legacy surface token"
rm /tmp/test-a.css

# Rule B
echo '<div className="bg-zinc-900 rounded-xl border p-4">card</div>' > /tmp/test-b.tsx
npx tsx scripts/pr-check.ts --all 2>&1 | grep "Hand-rolled card"
rm /tmp/test-b.tsx

# Rule C
npx tsx scripts/pr-check.ts --all 2>&1 | grep "Page component missing PageHeader" | head -5

# Rule D
echo '<div className="rounded-xl border p-4">card</div>' > /tmp/test-d.tsx
npx tsx scripts/pr-check.ts --all 2>&1 | grep "Hardcoded card radius"
rm /tmp/test-d.tsx

# Rule E
echo '.x { border-radius: var(--radius-signature-lg); }' > /tmp/test-e.css
npx tsx scripts/pr-check.ts --all 2>&1 | grep "radius-signature-lg"
rm /tmp/test-e.css

# Rule F
echo '<div className="transition-duration-[300ms]">x</div>' > /tmp/test-f.tsx
npx tsx scripts/pr-check.ts --all 2>&1 | grep "Non-standard transition"
rm /tmp/test-f.tsx
```

All six must fire. If Rule B or D doesn't fire, check the regex escaping.

- [ ] **Step 8: Create `docs/rules/design-system-enforcement.md`**

```markdown
# Design System Enforcement Rules

These rules are mechanized in `scripts/pr-check.ts` and enforced on every PR diff.
All rules are scoped to files changed in the diff (not the full repo) during the Phase 1–3 migration window.

| Rule | Severity | Pattern | Scope |
|------|----------|---------|-------|
| Legacy surface token | warn | `var(--brand-bg-*)` | `*.tsx`, `*.css` |
| Hand-rolled card div | warn | `bg-zinc-9xx + rounded-xl` | `*.tsx` (excl. `ui/`) |
| Page component missing PageHeader | warn | customCheck curated list | page components |
| Hardcoded card radius | warn | `rounded-xl` outside `ui/` | `*.tsx` (excl. `ui/`) |
| radius-signature-lg exclusivity | **error** | `--radius-signature-lg` | all, excl. SectionCard + styleguide |
| Non-standard transition duration | warn | duration not 120/180/400ms | `*.tsx`, `*.css` |

## Migration path

- Phase 1: All rules ship as `warn` (except Rule E which is `error` immediately).
- Phase 3f: Rules A, B, D promoted to `error` once all 47 files are migrated.
- Phase 4+: Rule F promoted to `error` once `--motion-*` tokens land.

## Escape hatch

Add `// pr-check-disable-next-line` above the offending line with a justification comment.
Only use for modals, non-card elements, or intentional design exceptions.
```

- [ ] **Step 9: Count baseline violations (save for Phase 3 tracking)**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -E "(Hand-rolled|Legacy surface|Missing .PageHeader|Hardcoded card radius|Non-standard transition)" | wc -l
```

Record this number. Phase 3 goal: reduce to zero across migrated clusters.

- [ ] **Step 10: Commit**

```bash
git add scripts/pr-check.ts docs/rules/design-system-enforcement.md
git commit -m "feat(pr-check): Phase 1 — six design system enforcement rules

Rules A–F (all scoped to diff'd files):
- A: Legacy surface token var(--brand-bg-*) → warn
- B: Hand-rolled bg-zinc-9xx + rounded-xl card → warn
- C: Page component missing <PageHeader> → warn (curated list)
- D: Hardcoded rounded-xl outside ui/ → warn
- E: --radius-signature-lg outside SectionCard → error
- F: Non-standard transition-duration → warn

Severity warn during Phase 1-3 migration; A/B/D promote to error in Phase 3f.
Documents rule rationale in docs/rules/design-system-enforcement.md."
```

---

### Task 1.2 — Regenerate `docs/rules/automated-rules.md` (Model: haiku)

**Owns:** `docs/rules/automated-rules.md`
**Must not touch:** `scripts/pr-check.ts`

- [ ] **Step 1: Run the generator**

```bash
npm run rules:generate
```

- [ ] **Step 2: Verify all six new rules appear**

```bash
grep -A 2 "Legacy surface token\|Hand-rolled card\|Page component missing PageHeader\|Hardcoded card radius\|radius-signature-lg\|Non-standard transition" docs/rules/automated-rules.md
```

Expected: all six rules listed with severity, rationale, and file scope.

- [ ] **Step 3: Commit and open PR**

```bash
git add docs/rules/automated-rules.md
git commit -m "docs(rules): regenerate automated-rules.md with Phase 1 enforcement rules"
```

PR title: `feat(pr-check): Phase 1 — surface token, hand-rolled card, and PageHeader enforcement`

---

## Phase 2 — Categorized Component Audit (one PR, after Phase 1 merged)

> Inventory-only. No code changes. The audit produces a migration checklist with a decision for each card instance.

### Task 2.1 — Generate `docs/UI_AUDIT.md` (Model: opus)

**Owns:** `docs/UI_AUDIT.md` (new file)
**Must not touch:** any source file

For each of the 47 affected files, inspect every hand-rolled card instance and assign it one of three migration decisions:

| Decision | When to use | Migration action |
|---|---|---|
| **default** | Main page-level content section | Replace with `<SectionCard>` (gets asymmetric brand corners — intentional upgrade) |
| **subtle** | Dense data, nested inside another card, table wrapper | Replace with `<SectionCard variant="subtle">` |
| **hatch** | Modal, dialog, control (not a card), one-off layout | Add `// pr-check-disable-next-line` with justification, keep as-is |

Files to audit (47 total, confirmed via grep):

**brand/ cluster (5 files):** `brand/BrandscriptTab.tsx`, `brand/DiscoveryTab.tsx`, `brand/VoiceTab.tsx`, `brand/PageStrategyTab.tsx`, `brand/CopyReviewPanel.tsx`

**client/ cluster (10 files):** `client/DataSnapshots.tsx`, `client/HealthTab.tsx`, `client/PlansTab.tsx`, `client/SearchTab.tsx`, `client/StrategyTab.tsx`, `client/FixRecommendations.tsx`, `client/SeoGlossary.tsx`, `client/OutcomeSummary.tsx`, `client/OrderStatus.tsx`, `client/ClientHeader.tsx`

**settings/ cluster (5 files):** `settings/ConnectionsTab.tsx`, `settings/FeaturesTab.tsx`, `settings/ClientDashboardTab.tsx`, `settings/BusinessProfileTab.tsx`, `settings/IntelligenceProfileTab.tsx`

**post-editor/ cluster (5 files):** `post-editor/PostPreview.tsx`, `post-editor/ReviewChecklist.tsx`, `post-editor/SectionEditor.tsx`, `post-editor/VersionHistory.tsx`, `PostEditor.tsx`

**Content / top-level cluster (9 files):** `ContentPipeline.tsx`, `ContentBriefs.tsx`, `CmsEditor.tsx`, `RankTracker.tsx`, `RevenueDashboard.tsx`, `SalesReport.tsx`, `MediaTab.tsx`, `PublishSettings.tsx`, `RequestManager.tsx`

**Scattered cluster (10 files):** `audit/AuditReportExport.tsx`, `charts/AnnotatedTrendChart.tsx`, `editor/BulkOperations.tsx`, `editor/PageEditRow.tsx`, `schema/PagePicker.tsx`, `briefs/RequestList.tsx`, `shared/RankTable.tsx`, `Toast.tsx`, `WorkspaceSelector.tsx`, `CommandPalette.tsx`

**Confirmed hatches (already in ui/):** `ui/ConfirmDialog.tsx` (modal — keep `rounded-xl`), `ui/ProgressIndicator.tsx` (status bar — keep `rounded-xl`)

- [ ] **Step 1: For each file, grep the hand-rolled card instances with line numbers**

```bash
grep -n 'bg-zinc-9[0-9]*.*rounded-xl\|rounded-xl.*bg-zinc-9' src/components/<file>.tsx
```

- [ ] **Step 2: Read each line in context (±5 lines) to classify as default / subtle / hatch**

Heuristics:
- Is it a top-level section container with a title? → **default**
- Is it wrapping a table, list, or dense data? → **subtle**
- Is it a modal, popover, tooltip, select, toast? → **hatch**
- Is it nested inside another card? → **subtle**

- [ ] **Step 3: Write `docs/UI_AUDIT.md`**

```markdown
# UI Primitive Audit — Phase 2 Findings

> Generated 2026-04-23. Migration checklist for Phase 3.
> Decision key: **default** = SectionCard default, **subtle** = SectionCard subtle, **hatch** = keep with justification comment.

## Summary

| Cluster | Files | Default | Subtle | Hatch | Total instances |
|---------|-------|---------|--------|-------|----------------|
| brand/ | 5 | N | N | N | N |
| client/ | 10 | N | N | N | N |
| settings/ | 5 | N | N | N | N |
| post-editor/ | 5 | N | N | N | N |
| content/top-level | 9 | N | N | N | N |
| scattered | 10 | N | N | N | N |
| **Total** | **47** | | | | **92** |

## Per-File Detail

### brand/BrandscriptTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 45 | `<div className="bg-zinc-900 rounded-xl border...">Content sections</div>` | default | Top-level section wrapper |
| ... | | | |

[Repeat for all 47 files]
```

- [ ] **Step 4: Commit and open PR**

```bash
git add docs/UI_AUDIT.md
git commit -m "docs(audit): Phase 2 — categorized UI primitive migration inventory

Catalogs 92 hand-rolled card instances across 47 files.
Each instance classified as default/subtle/hatch for Phase 3 execution."
```

PR title: `docs(audit): Phase 2 — categorized UI primitive inventory`

---

## Phase 3 — Cluster Migrations (six PRs, after Phase 2 merged)

> One PR per subsystem cluster. Do not start cluster N+1 until cluster N is merged and green on staging. Use `docs/UI_AUDIT.md` decisions for every card.

### Per-cluster checklist (apply to every Phase 3 PR)

For each file in the cluster:
- [ ] Read `docs/UI_AUDIT.md` for the file — get each card's decision (default / subtle / hatch)
- [ ] For **default** cards: replace `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">` wrapper with `<SectionCard title="..." titleIcon={<Icon />}>`. Remove the inner title element (SectionCard renders it). Use `noPadding` if the inner content is a table or full-bleed.
- [ ] For **subtle** cards: replace with `<SectionCard variant="subtle" title="...">`. No title prop if the card has no header.
- [ ] For **hatch** cards: add `{/* pr-check-disable-next-line -- [justification] */}` on the line above the className. Do not restructure the element.
- [ ] Verify SectionCard is imported: `grep -n 'SectionCard' <file>`. If not present, add to the existing `import { ... } from './ui'` or `import { ... } from '../ui'` line — never mid-file.
- [ ] If the page file is on the PageHeader curated list and is missing `<PageHeader>`: add it. Locate where the page title/subtitle is currently rendered and replace with `<PageHeader title="..." subtitle="..." />`.
- [ ] Run: `npx tsx scripts/pr-check.ts` — zero new errors, hand-rolled card warnings for this file must be gone.
- [ ] Run: `npm run typecheck`
- [ ] Take browser screenshots before and after (dark mode and light mode for any client/ files).
- [ ] Include the before/after screenshots and the audit decision summary in the PR description.

### Phase 3a — brand/ cluster

**Files:** `brand/BrandscriptTab.tsx`, `brand/DiscoveryTab.tsx`, `brand/VoiceTab.tsx`, `brand/PageStrategyTab.tsx`, `brand/CopyReviewPanel.tsx`
**Owns:** all five files listed above
**Must not touch:** any file outside `src/components/brand/`

- [ ] Apply per-cluster checklist to all five files
- [ ] `npx vitest run` — full suite, not just brand tests
- [ ] `npx vite build`
- [ ] Open PR: `refactor(brand): Phase 3a — migrate brand/ cards to SectionCard primitive`

### Phase 3b — client/ cluster

**Files:** `client/DataSnapshots.tsx`, `client/HealthTab.tsx`, `client/PlansTab.tsx`, `client/SearchTab.tsx`, `client/StrategyTab.tsx`, `client/FixRecommendations.tsx`, `client/SeoGlossary.tsx`, `client/OutcomeSummary.tsx`, `client/OrderStatus.tsx`, `client/ClientHeader.tsx`
**Owns:** all ten files listed above
**Must not touch:** any file outside `src/components/client/`

⚠️ **Light-mode extra check:** All client/ files render under `.dashboard-light`. After migration, toggle to light mode and verify every migrated card shows a white background. If any card stays dark, the SectionCard token wiring from Task 0.5 is not applying — investigate before merging.

- [ ] Apply per-cluster checklist to all ten files
- [ ] Light-mode screenshot for each file in the PR description
- [ ] `npx vitest run && npx vite build`
- [ ] Open PR: `refactor(client): Phase 3b — migrate client/ cards to SectionCard primitive`

### Phase 3c — settings/ cluster

**Files:** `settings/ConnectionsTab.tsx`, `settings/FeaturesTab.tsx`, `settings/ClientDashboardTab.tsx`, `settings/BusinessProfileTab.tsx`, `settings/IntelligenceProfileTab.tsx`
**Owns:** all five files listed above
**Must not touch:** any file outside `src/components/settings/`

- [ ] Apply per-cluster checklist to all five files
- [ ] `npx vitest run && npx vite build`
- [ ] Open PR: `refactor(settings): Phase 3c — migrate settings/ cards to SectionCard primitive`

### Phase 3d — post-editor/ cluster

**Files:** `post-editor/PostPreview.tsx`, `post-editor/ReviewChecklist.tsx`, `post-editor/SectionEditor.tsx`, `post-editor/VersionHistory.tsx`, `PostEditor.tsx`
**Owns:** all five files listed above
**Must not touch:** any file outside `src/components/post-editor/` or `PostEditor.tsx`

- [ ] Apply per-cluster checklist to all five files
- [ ] `npx vitest run && npx vite build`
- [ ] Open PR: `refactor(post-editor): Phase 3d — migrate post-editor cards to SectionCard primitive`

### Phase 3e — Content / top-level cluster

**Files:** `ContentPipeline.tsx`, `ContentBriefs.tsx`, `CmsEditor.tsx`, `RankTracker.tsx`, `RevenueDashboard.tsx`, `SalesReport.tsx`, `MediaTab.tsx`, `PublishSettings.tsx`, `RequestManager.tsx`
**Owns:** all nine files listed above
**Must not touch:** any other file

Note: several of these are on the PageHeader curated list and are missing `<PageHeader>`. Add it for each.

- [ ] Apply per-cluster checklist to all nine files
- [ ] `npx vitest run && npx vite build`
- [ ] Open PR: `refactor(content): Phase 3e — migrate content/top-level cards to SectionCard primitive`

### Phase 3f — Scattered cluster + promote rules to error severity

**Files:** `audit/AuditReportExport.tsx`, `charts/AnnotatedTrendChart.tsx`, `editor/BulkOperations.tsx`, `editor/PageEditRow.tsx`, `schema/PagePicker.tsx`, `briefs/RequestList.tsx`, `shared/RankTable.tsx`, `Toast.tsx`, `WorkspaceSelector.tsx`, `CommandPalette.tsx`
**Also owns:** `scripts/pr-check.ts` (for severity promotion)
**Must not touch:** any file not in the list above

After migrating the final cluster, promote the three Phase 1 rules from `warn` to `error` in `scripts/pr-check.ts`:

```typescript
// Change severity from 'warn' to 'error' for all three rules:
// - 'Legacy surface token in new code'
// - 'Hand-rolled card div (use SectionCard)'
// - 'Page component missing PageHeader'
```

- [ ] Apply per-cluster checklist to all ten files
- [ ] Promote rules to `error` severity in `scripts/pr-check.ts`
- [ ] Run `npm run rules:generate` to update `docs/rules/automated-rules.md`
- [ ] `npx tsx scripts/pr-check.ts --all` — zero violations in any src/components/ file
- [ ] `npx vitest run && npx vite build`
- [ ] Open PR: `refactor(scattered): Phase 3f — final cluster migration + promote rules to error`

---

## Phase 4 — Primitive Hardening (one PR, after Phase 3 complete)

> Add primitives revealed as missing during Phase 3. Exact specs depend on Phase 3 findings. Anticipated below.

### Anticipated primitives (confirm against Phase 3 learnings)

**`<Surface tier={1|2|3}>`** — a lightweight div with `var(--surface-N)` background for one-off surfaces that aren't SectionCard:

```tsx
// src/components/ui/Surface.tsx
import type { ReactNode } from 'react';

interface SurfaceProps {
  tier?: 1 | 2 | 3;
  children: ReactNode;
  className?: string;
}

export function Surface({ tier = 2, children, className }: SurfaceProps) {
  const bg = {
    1: 'bg-[var(--surface-1)]',
    2: 'bg-[var(--surface-2)]',
    3: 'bg-[var(--surface-3)]',
  }[tier];
  return (
    <div className={`${bg} ${className ?? ''}`}>
      {children}
    </div>
  );
}
```

**`<Toolbar>`** — standardized filter/action bar with consistent padding, replaces ad-hoc filter rows discovered during Phase 3.

**`<DataCard>`** — SectionCard variant with an annotated-trend chart slot baked in, if Phase 3 reveals 3+ hand-rolled instances of "chart card" pattern.

### Per-primitive checklist

- [ ] Create `src/components/ui/<Name>.tsx`
- [ ] Export from `src/components/ui/index.ts` barrel
- [ ] Add demonstration section + TOC entry to `src/components/Styleguide.tsx`
- [ ] Add pr-check rule (warn → error after adoption period)
- [ ] `npm run rules:generate`
- [ ] `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts`
- [ ] Open PR: `feat(primitives): Phase 4 — Surface, Toolbar, DataCard primitives`

---

## Task Dependencies

```
Phase 0.1 (index.css tokens)  ─┐
Phase 0.2 (design docs)        ├─→ all can run in parallel
Phase 0.3 (styleguide v9)*     ┘   *0.3 requires v9 HTML
                ↓ (all committed)
Phase 0.5 (wire primitives)   ─→ depends on 0.1 (--surface-2 must exist)
                ↓
Phase 0.4 (PR gate)           ─→ all Phase 0 tasks committed

Phase 0 merged to staging
                ↓
Phase 1.1 (pr-check rules)    ─→ sequential
Phase 1.2 (regenerate docs)   ─→ after 1.1

Phase 1 merged to staging
                ↓
Phase 2.1 (audit)             ─→ single task

Phase 2 merged to staging
                ↓
Phase 3a (brand/)             ─→ sequential, one PR per cluster
Phase 3b (client/)            ─→ after 3a
Phase 3c (settings/)          ─→ after 3b
Phase 3d (post-editor/)       ─→ after 3c
Phase 3e (content/top-level)  ─→ after 3d
Phase 3f (scattered + error)  ─→ after 3e

Phase 3 complete
                ↓
Phase 4 (new primitives)      ─→ informed by Phase 3 findings
```

---

## Systemic Improvements

**Shared utilities added:** `Surface` component (Phase 4). SectionCard/StatCard/Skeleton already adopt `--surface-2` in Phase 0.5.

**pr-check rules added:**
- `Legacy surface token in new code` (Phase 1, warn → error in Phase 3f)
- `Hand-rolled card div` (Phase 1, warn → error in Phase 3f)
- `Page component missing PageHeader` (Phase 1, warn → error in Phase 3f)
- Per-primitive rules for Phase 4 additions

**Tests required:** No new vitest tests (CSS and design-pattern work). Add a pr-check test fixture for each of the three new rules in `tests/pr-check.test.ts` — the existing harness supports this. One fixture per rule: a file that triggers the violation and a file that doesn't.

---

## Verification Strategy

| Phase | Verification |
|---|---|
| Phase 0 | `/styleguide` dark mode: zero visual change, TOC + new sections visible. Light mode: all primitive cards white (confirms Task 0.5). |
| Phase 1 | `npx tsx scripts/pr-check.ts --all` fires on known violations; clean on Styleguide.tsx and ui/ directory. |
| Phase 2 | `docs/UI_AUDIT.md` covers all 47 files, each instance has a decision (default/subtle/hatch). |
| Phase 3 (each cluster) | Before/after browser screenshots in PR (dark + light). `npx tsx scripts/pr-check.ts` shows zero hand-rolled card warnings for the cluster's files. |
| Phase 3f | `npx tsx scripts/pr-check.ts --all` zero violations anywhere in `src/components/`. |
| Phase 4 | New primitives render in `/styleguide`. pr-check rule fires on synthetic test. |

---

## Quality Gates (each PR before opening)

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — production build succeeds
- [ ] `npx vitest run` — full test suite passes (not just changed files)
- [ ] `npx tsx scripts/pr-check.ts` — zero errors (warns acceptable during Phases 0–3e)
- [ ] `BRAND_DESIGN_LANGUAGE.md` updated if any color/surface semantics changed
- [ ] `data/roadmap.json` updated when a phase is marked done
- [ ] Phase N+1 does not start until Phase N is merged and green on staging
