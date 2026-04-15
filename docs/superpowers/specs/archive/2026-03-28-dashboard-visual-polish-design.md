# Dashboard Visual Polish — Design Spec

**Date:** 2026-03-28
**Purpose:** Eliminate "AI-generated" aesthetic tells across the hmpsn.studio dashboard. 10 targeted visual refinements applied primarily at the primitive/token level to cascade across 100+ files with minimal per-file edits.

---

## Problem

The dashboard looks competent but generic — uniform `rounded-xl` on every card, uniform `space-y-5` between every section, uppercase on every heading, no motion, no texture. These are hallmarks of AI-generated UI. The platform needs a distinctive visual identity that matches the crafted feel of hmpsn.studio's marketing site.

---

## Changes

### 1. Asymmetric Card Radius

**What:** Replace uniform `rounded-xl` (12px) with a diagonal asymmetric radius — tight top-left/bottom-right, rounded top-right/bottom-left. This is the platform's signature shape, inspired by the marketing website's card treatments.

**Radius scale (proportional to component size):**

| Component | Radius | CSS |
|-----------|--------|-----|
| SectionCard (page-level) | `10px 24px 10px 24px` | `border-radius: 10px 24px 10px 24px` |
| Insight cards (standalone) | `8px 16px 8px 16px` | `border-radius: 8px 16px 8px 16px` |
| StatCard | `6px 12px 6px 12px` | `border-radius: 6px 12px 6px 12px` |
| Nested cards (inside SectionCard) | `8px` uniform | `rounded-lg` |
| Badges, pills | `4px` uniform | `rounded` |
| Buttons | unchanged | `rounded-lg` (8px) |

**Where to change:**
- `SectionCard.tsx` — replace `rounded-xl` with inline style or Tailwind arbitrary value `rounded-[10px_24px_10px_24px]`
- `StatCard.tsx` — `rounded-[6px_12px_6px_12px]`
- `Skeleton.tsx` — match the component it's shimming for
- `TierGate.tsx`, `ErrorState.tsx` — follow SectionCard radius
- Consumer files with hand-rolled card markup — audit and migrate to primitives or apply matching radius

**Light mode:** Same radius values apply.

---

### 2. MetricRing Glow + Charge-Up Animation

**What:** Transform the flat SVG ring into a premium element with outward glow, refined proportions, and a theatrical charge-up animation.

**Visual changes:**
- Ring diameter: 120px (up from current)
- Stroke width: 8px (up from 6px)
- Track color: `#303036` (up from current darker track)
- Number font size: 40px (up from 32px)
- Outward-only glow via `box-shadow` on a pseudo-element behind the SVG (not `filter: drop-shadow` which bleeds inward)
- Glow color: inner emerald (`rgba(52, 211, 153, 0.15)`) → outer teal (`rgba(45, 212, 191, 0.1)`)

**Charge-up animation sequence:**
1. `0s` — Ring sweep begins (existing stroke-dashoffset animation)
2. `0.8s` — Number fades in (`opacity: 0 → 1` over 0.4s)
3. `2.0s` — Edge ring (1px teal border at 15% opacity) AND glow bloom fade in together over 0.8s

**Implementation:**
- Wrap `MetricRingSvg` in a container with `position: relative`
- Add `.metric-ring-glow` pseudo-element behind the SVG with `box-shadow` for the glow
- Add `.metric-ring-edge` element (or pseudo) for the subtle 1px border ring
- CSS keyframes: `@keyframes ringGlowIn` (opacity 0→1, delay 2s, duration 0.8s)
- Number animation: `@keyframes numberFadeIn` (opacity 0→1, delay 0.8s, duration 0.4s)
- Animation plays once on mount (not on every re-render). Use `animation-fill-mode: both`.

**Where to change:**
- `MetricRingSvg.tsx` — add glow container, edge ring, animation classes
- `MetricRing.tsx` — pass through animation props
- `src/index.css` — add keyframes

---

### 3. Noise Overlay

**What:** Subtle 2% opacity noise texture on the page background to break digital perfection and add tactile depth.

**Implementation:**
```css
body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  opacity: 0.02;
  background-image: url("data:image/svg+xml,..."); /* SVG feTurbulence */
}
```

The SVG uses `<feTurbulence type="fractal" baseFrequency="0.8" numOctaves="4"/>` to generate the noise pattern.

**Where to change:**
- `src/index.css` — add `body::after` rule with the SVG noise
- Light mode: same 2% opacity (works on both backgrounds)

---

### 4. Scanner Sweep (Page Transition)

**What:** A muted teal beam sweeps top-to-bottom on page navigation, revealing content beneath. Plays once per navigation, not on re-renders.

**Beam spec:**
- Height: 1px
- Peak opacity: 30% (`rgba(45, 212, 191, 0.3)` at center)
- Gradient: transparent edges → 30% teal center
- Glow: `box-shadow: 0 0 8px 2px rgba(45,212,191,0.12), 0 0 24px 4px rgba(45,212,191,0.06)`
- Duration: 850ms
- Easing: `cubic-bezier(0.22, 0.61, 0.36, 1)` (ease-out feel)

**Implementation:**
- Overlay div with `clip-path: inset(0 0 0 0)` → `inset(100% 0 0 0)` reveals content
- Beam div animates `top: -1px` → `top: 100%` synchronized with the clip-path
- Triggered by React Router navigation (wrap in layout component)
- Use a `key` prop tied to route path so the animation replays on navigation
- Skip on initial page load (only on subsequent navigations) — or play on first load too (TBD during implementation, test both)

**Keyframes:**
```css
@keyframes scanReveal {
  from { clip-path: inset(0 0 0 0); }
  to { clip-path: inset(100% 0 0 0); }
}
@keyframes scanBeam {
  0% { top: -1px; opacity: 1; }
  85% { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}
```

**Where to change:**
- New component: `src/components/ui/ScannerReveal.tsx`
- Wrap page content in the layout (likely in `App.tsx` or the layout wrapper)
- `src/index.css` — keyframes

---

### 5. Section Spacing Variation

**What:** Break uniform `space-y-5` (20px). Use tighter gaps for related items and wider breaks between major sections.

**Spacing rules:**
| Context | Gap | Tailwind |
|---------|-----|----------|
| Related items within a section (e.g., stat cards in a row) | 12px | `gap-3` |
| Between cards within the same section | 16px | `gap-4` |
| Between major page sections | 32px | `gap-8` |
| Page top padding to first section | 24px | existing |

**Where to change:**
- Page-level layouts: replace `space-y-5` with `space-y-8` or explicit `gap-8`
- Within-section grids: `gap-3` for stat rows, `gap-4` for card grids
- This is a per-page change, not a primitive change. Each of the ~45 files with `space-y-5` needs review.

---

### 6. Drop Uppercase on Section Headers

**What:** Remove `uppercase` from section/card titles. Keep `uppercase` only on:
- StatCard labels (e.g., "USERS", "SESSIONS")
- Badges and pills
- Navigation labels where already uppercase

**Where to change:**
- `SectionCard.tsx` — if it applies `uppercase` to its title slot, remove it
- 52 files with uppercase headers — audit each. Many will be section titles that should drop it, some will be stat labels that keep it.
- The `section-label` / `text-[11px] uppercase tracking-wider` pattern on stat card labels stays.

---

### 7. Hero Stat Sizing

**What:** New `size="hero"` prop on StatCard for top-of-page hero metrics with larger, more impactful numbers.

**Hero size spec:**
| Property | Default | Hero |
|----------|---------|------|
| Number font size | 28px (`text-2xl`) | 36px (`text-4xl`) |
| Label font size | 13.5px | 13.5px (unchanged) |
| Card padding | `p-3` (12px) | `p-4` (16px) |
| Card min-height | auto | auto |

**Where to change:**
- `StatCard.tsx` — add `size?: 'default' | 'hero'` prop, conditionally apply larger classes
- Consumer pages — apply `size="hero"` to top-of-page stat rows (typically the first `StatCard` grid on each page). ~17 consumers to review; likely 8-10 pages will use hero sizing on their primary stats.

---

### 8. Stagger-Fade Animations

**What:** Cards fade in and slide up on page load with staggered delays, creating a choreographed reveal.

**Animation spec:**
```css
@keyframes staggerFadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```
- Duration: 0.4s
- Easing: `cubic-bezier(0.22, 0.61, 0.36, 1)`
- Stagger: 60ms between siblings
- `animation-fill-mode: both` (start invisible, stay visible)

**Implementation:**
- Add a `staggerIndex` prop to `SectionCard` and `StatCard`
- Component applies `animation-delay: calc(var(--stagger-index) * 60ms)`
- Alternatively, use a parent `StaggerGroup` component that injects delay via CSS custom properties on children
- Prefer the CSS custom property approach to avoid prop drilling

**Where to change:**
- `SectionCard.tsx`, `StatCard.tsx` — accept stagger index, apply animation
- `src/index.css` — keyframes
- Consumer pages — wrap card groups in stagger containers or pass index props

---

### 9. Hover Border Accents

**What:** Actionable cards get a teal left-border accent on hover, reinforcing "teal = interactive" from the Three Laws of Color. Non-actionable/data-only cards keep the neutral border hover.

**Spec:**
- Actionable cards (clickable SectionCards, cards with CTAs): on hover, add `border-left-color: rgba(45, 212, 191, 0.4)` with the existing border-color transition
- Data-only cards (StatCards, read-only displays): neutral hover unchanged (`#3f3f46`)
- Transition: `border-color 0.2s ease` (already exists)

**Where to change:**
- `SectionCard.tsx` — add `interactive?: boolean` prop (or detect from `onClick`). When interactive, hover adds teal left border.
- Existing hover rule (`hover:border-zinc-700`) stays for the other three sides.
- Light mode: `rgba(13, 148, 136, 0.3)` (teal-600 at 30%)

---

### 10. Status Color Refinement

**What:** Mute the raw Tailwind status colors to match the refined dark palette. Pure `green-400`/`amber-400`/`red-400` are too saturated against the muted zinc surfaces.

**Color mapping:**

| Status | Current | Refined (dark) | Refined (light) |
|--------|---------|----------------|-----------------|
| Success/positive | `text-green-400` | `text-emerald-400/80` | `text-emerald-700/80` |
| Warning | `text-amber-400` | `text-amber-400/80` | `text-amber-600/80` |
| Error/negative | `text-red-400` | `text-red-400/80` | `text-red-600/80` |
| Success bg | `bg-green-500/10` | `bg-emerald-500/8` | `bg-emerald-500/8` |
| Warning bg | `bg-amber-500/10` | `bg-amber-500/8` | `bg-amber-500/8` |
| Error bg | `bg-red-500/10` | `bg-red-500/8` | `bg-red-500/8` |

**Where to change:**
- Status dots/indicators across insight cards, stat deltas, badge backgrounds
- `StatusBadge.tsx` — update color classes
- `Badge.tsx` — update variant colors
- Per-file audit for raw `green-400`/`amber-400`/`red-400` usage outside of primitives

---

## Scope & Impact

| Primitive | Files affected | Change type |
|-----------|---------------|-------------|
| `SectionCard.tsx` | 1 + 50+ consumers | Radius, stagger, hover accent |
| `StatCard.tsx` | 1 + 17 consumers | Radius, hero size, stagger |
| `MetricRingSvg.tsx` | 1 + consumers | Glow, animation, proportions |
| `Skeleton.tsx` | 1 | Match new radius |
| `TierGate.tsx` | 1 | Match new radius |
| `ErrorState.tsx` | 1 | Match new radius |
| `StatusBadge.tsx` | 1 | Muted colors |
| `Badge.tsx` | 1 | Muted colors |
| `src/index.css` | 1 | Keyframes, noise, scanner |
| New: `ScannerReveal.tsx` | 1 | Scanner sweep component |
| Page layouts | ~20 pages | Spacing, hero stats, uppercase |
| Status color consumers | ~30 files | Color class updates |

**Total estimated file touches:** ~50-60 files (many are single-class changes)

---

## What We're NOT Doing

- ~~Ghost/watermark section headers~~ — declined
- ~~Gradient text on PageHeader~~ — declined
- ~~Score Aura (ambient background glow)~~ — declined
- ~~Font changes~~ — Inter is a brand font, stays
- ~~Grid/dot pattern backgrounds~~ — declined
- ~~New color families~~ — no violet, indigo, or new hues

---

## Light Mode Considerations

All 10 changes must work in both dark and light mode:
- Card radius: same values
- Ring glow: reduce glow intensity by ~50% in light mode (less contrast needed)
- Noise overlay: same 2% opacity
- Scanner sweep: use darker teal in light mode (`rgba(13, 148, 136, 0.25)`)
- Spacing/uppercase/hero: identical
- Stagger animations: identical
- Hover accent: `rgba(13, 148, 136, 0.3)` teal-600 in light mode
- Status colors: use `/80` opacity variants of the `-600`/`-700` dark equivalents

---

## Testing Checklist

- [ ] All 10 changes render correctly in dark mode
- [ ] All 10 changes render correctly in light mode
- [ ] Scanner sweep plays on route navigation, not on re-render
- [ ] Ring charge-up animation plays on mount, not on data refetch
- [ ] Stagger animations don't replay on React Query refetch
- [ ] No layout shift from radius changes
- [ ] Mobile responsive — all changes work at 375px width
- [ ] `npx tsc --noEmit --skipLibCheck` passes
- [ ] `npx vite build` succeeds
- [ ] `npx vitest run` passes
- [ ] `npx tsx scripts/pr-check.ts` passes
