# Dashboard Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate AI-generated aesthetic tells across the hmpsn.studio dashboard with 10 targeted visual refinements.

**Architecture:** Changes cascade from 5 UI primitives (SectionCard, StatCard, MetricRing, Skeleton, Badge) + global CSS (index.css) outward to ~50-60 consumer files. Phase 1 lays CSS foundations, Phase 2 updates primitives, Phase 3 adds the scanner component, Phase 4 sweeps consumer pages.

**Tech Stack:** React 19, TailwindCSS 4, CSS keyframes, SVG (MetricRing), React Router DOM 7 (scanner integration)

**Spec:** `docs/superpowers/specs/2026-03-28-dashboard-visual-polish-design.md`

---

## Guardrails & Agentic Rules

### Multi-Agent Coordination (from CLAUDE.md)

1. **Pre-commit shared contracts** — Phase 1 (CSS keyframes) and Phase 2 (primitive changes) MUST be committed before any Phase 4 consumer work begins. Agents read from committed code.
2. **Exclusive file ownership** — every file has exactly one owner per parallel batch. File ownership tables are included in each task.
3. **Diff review checkpoint** — after each parallel batch, run `git diff HEAD~N`, grep for duplicate imports, run `npx tsc --noEmit --skipLibCheck && npx vite build`.
4. **Sequential shared files** — `src/index.css`, `src/App.tsx`, barrel exports (`src/components/ui/index.ts`) are touched by one agent at a time, never in parallel.

### Quality Gates (every task)

After each commit, verify:
```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```
After final commit, also run:
```bash
npx vitest run
npx tsx scripts/pr-check.ts
```

### File Change Rules

- **Never** add imports mid-file — always at top, grouped with existing imports
- **Never** introduce `violet`, `indigo`, or new hue families
- **Never** hand-roll card markup — use `SectionCard` or apply matching radius
- All `rounded-xl` in primitives gets replaced; `rounded-xl` in consumer files only matters for hand-rolled cards (not inside primitives)
- Status colors: `green-400` → `emerald-400/80`, `amber-400` → `amber-400/80`, `red-400` → `red-400/80`
- `uppercase` is KEPT on: StatCard labels, Badge text, nav labels, `tracking-wider` label patterns
- `uppercase` is REMOVED on: SectionCard titles, page section headings, card `<h3>`/`<h4>` titles

### Post-Completion Checklist

- [ ] Update `BRAND_DESIGN_LANGUAGE.md` — add asymmetric radius scale, noise overlay, scanner sweep, stagger animation, ring glow, hover accent, status color refinements
- [ ] Update `DESIGN_SYSTEM.md` — add new radius tokens, animation specs, hero stat size
- [ ] `npx tsx scripts/pr-check.ts` — zero errors
- [ ] No `violet` or `indigo` in `src/components/`

---

## File Structure

### Files to CREATE
| File | Responsibility |
|------|---------------|
| `src/components/ui/ScannerReveal.tsx` | Page transition scanner sweep overlay |

### Files to MODIFY (Primitives — Phase 1-2)
| File | Changes |
|------|---------|
| `src/index.css` | Noise overlay, scanner keyframes, stagger keyframes, ring glow keyframes |
| `src/components/ui/SectionCard.tsx` | Asymmetric radius, stagger animation, interactive hover accent |
| `src/components/ui/StatCard.tsx` | Asymmetric radius, hero size prop, stagger animation |
| `src/components/ui/MetricRing.tsx` | Glow container, edge ring, charge-up animation, proportions |
| `src/components/ui/Skeleton.tsx` | Match new radius on StatCardSkeleton, SectionCardSkeleton |
| `src/components/ui/TierGate.tsx` | Match SectionCard radius |
| `src/components/ui/ErrorState.tsx` | Match SectionCard radius on icon container |
| `src/components/ui/Badge.tsx` | Muted status colors in BADGE_COLORS |
| `src/components/ui/statusConfig.ts` | Muted status dot/text/bg colors |
| `src/App.tsx` | Integrate ScannerReveal in layout |

### Files to MODIFY (Consumer Sweep — Phase 4)
~25 files for spacing, ~59 files for uppercase, ~16 StatCard consumers for hero sizing, ~140 files for status colors. Many overlap. Actual unique file count after deduplication: ~50-60 files with single-class changes.

---

## Phase 1: CSS Foundation

### Task 1: Add keyframes and noise overlay to index.css

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add noise overlay rule**

Add after the `/* ─── Animations ─── */` section, before `.animate-fade-in`:

```css
/* ─── Noise texture overlay ─── */
body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  opacity: 0.02;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
  background-repeat: repeat;
}
```

- [ ] **Step 2: Add stagger-fade keyframes**

Add after the existing `@keyframes pulse` block:

```css
@keyframes staggerFadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 3: Add scanner sweep keyframes**

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

- [ ] **Step 4: Add ring glow keyframes**

```css
@keyframes ringGlowIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes numberFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Both pass (CSS-only changes, no TS impact)

- [ ] **Step 6: Commit**

```bash
git add src/index.css
git commit -m "style: add noise overlay, stagger-fade, scanner, and ring glow keyframes"
```

---

## Phase 2: Primitive Updates

### Task 2: SectionCard — radius, stagger, hover accent

**Files:**
- Modify: `src/components/ui/SectionCard.tsx`

- [ ] **Step 1: Update SectionCard with all three changes**

Replace the entire file with:

```tsx
import type { ReactNode } from 'react';

interface SectionCardProps {
  title?: string;
  titleIcon?: ReactNode;
  titleExtra?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
  /** Enables teal left-border accent on hover for clickable cards */
  interactive?: boolean;
  /** Stagger animation index (0-based). Each index adds 60ms delay. */
  staggerIndex?: number;
}

export function SectionCard({ title, titleIcon, titleExtra, action, children, className, noPadding, interactive, staggerIndex }: SectionCardProps) {
  const hasHeader = title || action;

  const staggerStyle = staggerIndex !== undefined
    ? { animation: 'staggerFadeIn 0.4s cubic-bezier(0.22,0.61,0.36,1) both', animationDelay: `${staggerIndex * 60}ms` }
    : undefined;

  return (
    <div
      className={`bg-zinc-900 border border-zinc-800 transition-colors duration-200 ${interactive ? 'hover:border-zinc-700 hover:border-l-teal-500/40 cursor-pointer' : ''} ${className ?? ''}`}
      style={{ borderRadius: '10px 24px 10px 24px', ...staggerStyle }}
    >
      {hasHeader && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800" style={{ borderRadius: '10px 24px 0 0' }}>
          <div className="flex items-center gap-2 min-w-0">
            {titleIcon}
            <span className="text-sm font-semibold text-zinc-200">{title}</span>
            {titleExtra}
          </div>
          {action}
        </div>
      )}
      <div className={noPadding ? '' : 'p-4'}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Both pass

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/SectionCard.tsx
git commit -m "style: SectionCard — asymmetric radius, stagger animation, hover accent"
```

---

### Task 3: StatCard — radius, hero size, stagger

**Files:**
- Modify: `src/components/ui/StatCard.tsx`

- [ ] **Step 1: Update StatCard with radius, hero size, and stagger**

Replace the entire file with:

```tsx
import type { LucideIcon } from 'lucide-react';

/* ── Stat Card: Default ── */
interface StatCardProps {
  label: React.ReactNode;
  value: string | number;
  icon?: LucideIcon;
  iconColor?: string;
  valueColor?: string;
  sub?: string;
  delta?: number;
  deltaLabel?: string;
  /** When true, negative delta = green (improvement), positive = red (regression). Use for metrics like bounce rate, avg position. */
  invertDelta?: boolean;
  onClick?: () => void;
  className?: string;
  /** Display size: 'default' for standard, 'hero' for top-of-page impact metrics */
  size?: 'default' | 'hero';
  /** Stagger animation index (0-based). Each index adds 60ms delay. */
  staggerIndex?: number;
}

export function StatCard({
  label, value, icon: Icon, iconColor, valueColor, sub,
  delta, deltaLabel, invertDelta, onClick, className,
  size = 'default', staggerIndex,
}: StatCardProps) {
  const Tag = onClick ? 'button' : 'div';
  const isHero = size === 'hero';

  const staggerStyle = staggerIndex !== undefined
    ? { animationDelay: `${staggerIndex * 60}ms` }
    : undefined;

  const baseStyle = {
    borderRadius: '6px 12px 6px 12px',
    animation: staggerIndex !== undefined ? 'staggerFadeIn 0.4s cubic-bezier(0.22,0.61,0.36,1) both' : undefined,
    ...staggerStyle,
  };

  return (
    <Tag
      onClick={onClick}
      className={`bg-zinc-900 ${isHero ? 'p-4' : 'p-3'} border border-zinc-800 text-left ${onClick ? 'hover:border-zinc-700 transition-colors cursor-pointer group' : ''} ${className ?? ''}`}
      style={baseStyle}
    >
      <div className="flex items-center gap-1.5 mb-2">
        {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" style={iconColor ? { color: iconColor } : undefined} />}
        <span className="inline-flex items-center gap-0.5 text-[11px] text-zinc-500 uppercase tracking-wider font-medium leading-none">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <div
          className={`${isHero ? 'text-4xl' : 'text-2xl'} font-bold leading-none ${valueColor ?? 'text-zinc-100'}`}
          style={valueColor?.startsWith('#') ? { color: valueColor } : undefined}
        >
          {value}
        </div>
        {delta !== undefined && delta !== 0 && (
          <span className={`text-[11px] font-medium ${(invertDelta ? delta < 0 : delta > 0) ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
            {delta > 0 ? '+' : ''}{delta}{deltaLabel ?? ''}
          </span>
        )}
      </div>
      {sub && <div className="text-[11px] text-zinc-500 mt-1">{sub}</div>}
    </Tag>
  );
}

/* ── Stat Card: Compact (horizontal inline bar) ── */
interface CompactStatProps {
  label: string;
  value: string | number;
  valueColor?: string;
  sub?: string;
  subColor?: string;
}

export function CompactStatBar({ items, className }: { items: CompactStatProps[]; className?: string }) {
  return (
    <div
      className={`bg-zinc-900 border border-zinc-800 px-5 py-3 flex items-center justify-between flex-wrap gap-3 ${className ?? ''}`}
      style={{ borderRadius: '6px 12px 6px 12px' }}
    >
      {items.map(m => (
        <div key={m.label} className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">{m.label}</span>
          <span className={`text-base font-bold ${m.valueColor ?? 'text-zinc-200'}`}>{m.value}</span>
          {m.sub && <span className={`text-[11px] font-medium ${m.subColor ?? 'text-zinc-500'}`}>{m.sub}</span>}
        </div>
      ))}
    </div>
  );
}
```

Note: The delta colors are already updated to `text-emerald-400/80` and `text-red-400/80` (status color refinement).

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Both pass

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/StatCard.tsx
git commit -m "style: StatCard — asymmetric radius, hero size prop, stagger, muted delta colors"
```

---

### Task 4: MetricRing — glow, charge-up animation, proportions

**Files:**
- Modify: `src/components/ui/MetricRing.tsx`

- [ ] **Step 1: Update MetricRing with glow and charge-up animation**

Replace the entire file with:

```tsx
import { scoreColor } from './constants';

interface MetricRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** Disable charge-up animation (for compact/inline usage) */
  noAnimation?: boolean;
}

export function MetricRing({ score, size = 120, strokeWidth, className, noAnimation }: MetricRingProps) {
  const sw = strokeWidth ?? (size >= 100 ? 8 : size >= 48 ? 6 : 4);
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = scoreColor(score);
  const showGlow = !noAnimation && size >= 80;

  return (
    <div className={`relative ${className ?? ''}`} style={{ width: size, height: size }}>
      {/* Glow layer — outward-only via box-shadow behind the ring */}
      {showGlow && (
        <div
          className="absolute inset-0 rounded-full"
          style={{
            boxShadow: `0 0 20px 8px rgba(52, 211, 153, 0.15), 0 0 40px 16px rgba(45, 212, 191, 0.1)`,
            animation: 'ringGlowIn 0.8s ease-out 2s both',
          }}
        />
      )}
      {/* Edge ring — subtle 1px border */}
      {showGlow && (
        <div
          className="absolute inset-0 rounded-full"
          style={{
            border: '1px solid rgba(45, 212, 191, 0.15)',
            animation: 'ringGlowIn 0.8s ease-out 2s both',
          }}
        />
      )}
      <svg width={size} height={size} className="transform -rotate-90 relative z-10">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#303036" strokeWidth={sw} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center z-10">
        <span
          className="font-bold"
          style={{
            color,
            fontSize: size >= 100 ? 40 : size * 0.38,
            fontFamily: "'DIN Pro', 'Inter', sans-serif",
            fontWeight: 700,
            letterSpacing: '-0.03em',
            animation: showGlow ? 'numberFadeIn 0.4s ease-out 0.8s both' : undefined,
          }}
        >
          {score}
        </span>
      </div>
    </div>
  );
}

/** Small SVG-only ring for use inside tight spaces (workspace overview, list items) */
export function MetricRingSvg({ score, size = 48, strokeWidth }: Omit<MetricRingProps, 'noAnimation'>) {
  const sw = strokeWidth ?? (size >= 48 ? 4 : 3);
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = scoreColor(score);

  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#303036" strokeWidth={sw} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all duration-700"
      />
      <text
        x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
        fontSize={size * 0.38} fontWeight="700" fill={color}
        fontFamily="'DIN Pro', 'Inter', sans-serif" letterSpacing="-0.03em"
      >
        {score}
      </text>
    </svg>
  );
}
```

Key changes: track color `#303036`, glow via box-shadow on pseudo div, edge ring, number fade-in at 0.8s, glow bloom at 2.0s, number font size 40px for rings ≥100px.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Both pass

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/MetricRing.tsx
git commit -m "style: MetricRing — outward glow, charge-up animation, refined proportions"
```

---

### Task 5: Skeleton, TierGate, ErrorState — match new radius

**Files:**
- Modify: `src/components/ui/Skeleton.tsx`
- Modify: `src/components/ui/TierGate.tsx`
- Modify: `src/components/ui/ErrorState.tsx`

- [ ] **Step 1: Update Skeleton.tsx radius**

In `StatCardSkeleton`, replace:
```tsx
<div className={`bg-zinc-900 rounded-xl p-4 border border-zinc-800 ${className ?? ''}`}>
```
with:
```tsx
<div className={`bg-zinc-900 p-4 border border-zinc-800 ${className ?? ''}`} style={{ borderRadius: '6px 12px 6px 12px' }}>
```

In `SectionCardSkeleton`, replace:
```tsx
<div className={`bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-3 ${className ?? ''}`}>
```
with:
```tsx
<div className={`bg-zinc-900 border border-zinc-800 p-5 space-y-3 ${className ?? ''}`} style={{ borderRadius: '10px 24px 10px 24px' }}>
```

In `OverviewSkeleton` and `AnalyticsSkeleton`, the skeletons use `StatCardSkeleton` and `SectionCardSkeleton` which will inherit the new radius. No changes needed on those wrapper functions.

- [ ] **Step 2: Update TierGate.tsx radius**

In `TierGate`, for the compact variant, replace:
```tsx
<div className={`relative rounded-xl border ${colors.border} ${colors.bg} p-3 ${className ?? ''}`}>
```
with:
```tsx
<div className={`relative border ${colors.border} ${colors.bg} p-3 ${className ?? ''}`} style={{ borderRadius: '10px 24px 10px 24px' }}>
```

For the full overlay, replace:
```tsx
<div className={`flex flex-col items-center gap-3 max-w-xs text-center px-6 py-5 rounded-2xl border backdrop-blur-sm ${colors.bg} ${colors.border}`}>
```
with:
```tsx
<div className={`flex flex-col items-center gap-3 max-w-xs text-center px-6 py-5 border backdrop-blur-sm ${colors.bg} ${colors.border}`} style={{ borderRadius: '10px 24px 10px 24px' }}>
```

- [ ] **Step 3: Update ErrorState.tsx icon container radius**

The `ErrorState` component uses `rounded-xl` on the icon container. This is a small decorative element, not a card — keep it as-is. No change needed.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Both pass

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Skeleton.tsx src/components/ui/TierGate.tsx
git commit -m "style: Skeleton + TierGate — match asymmetric card radius"
```

---

### Task 6: Badge and statusConfig — muted status colors

**Files:**
- Modify: `src/components/ui/Badge.tsx`
- Modify: `src/components/ui/statusConfig.ts`

- [ ] **Step 1: Update Badge.tsx colors**

Replace the `BADGE_COLORS` object:

```tsx
const BADGE_COLORS: Record<string, string> = {
  teal: 'bg-teal-500/10 text-teal-400',
  blue: 'bg-blue-500/10 text-blue-400',
  emerald: 'bg-emerald-500/8 text-emerald-400/80',
  green: 'bg-emerald-500/8 text-emerald-400/80',
  amber: 'bg-amber-500/8 text-amber-400/80',
  red: 'bg-red-500/8 text-red-400/80',
  orange: 'bg-orange-500/10 text-orange-400',
  purple: 'bg-purple-500/10 text-purple-400',
  zinc: 'bg-zinc-800 text-zinc-500',
};
```

Key changes: `green` now maps to emerald/80, `amber` to amber/80, `red` to red/80. Background opacity reduced to `/8`.

- [ ] **Step 2: Update statusConfig.ts colors**

Replace the `statusConfig` entries for `approved` and `rejected`:

```typescript
approved: { label: 'Approved', border: 'border-emerald-500/30', bg: 'bg-emerald-500/8', text: 'text-emerald-400/80', dot: 'bg-emerald-400/80' },
rejected: { label: 'Rejected', border: 'border-red-500/30', bg: 'bg-red-500/8', text: 'text-red-400/80', dot: 'bg-red-400/80' },
```

Also update `issue-detected`:
```typescript
'issue-detected': { label: 'Issue Detected', border: 'border-amber-500/30', bg: 'bg-amber-500/8', text: 'text-amber-400/80', dot: 'bg-amber-400/80' },
```

Leave `fix-proposed` (blue), `in-review` (purple), and `live` (teal) unchanged — these are action/data colors, not status colors.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Both pass

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Badge.tsx src/components/ui/statusConfig.ts
git commit -m "style: Badge + statusConfig — muted status colors (emerald/80, amber/80, red/80)"
```

---

### Task 7: Diff review checkpoint — Phase 2

- [ ] **Step 1: Review all primitive changes**

```bash
git diff HEAD~5 -- src/components/ui/
```

Check for:
- No duplicate imports
- No conflicting function signatures
- All `rounded-xl` replaced in primitives (SectionCard, StatCard, Skeleton, TierGate)
- `text-green-400` → `text-emerald-400/80` in StatCard deltas
- Badge colors correctly muted
- MetricRing track color is `#303036`
- No `violet` or `indigo` introduced

- [ ] **Step 2: Full build verification**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run
```

---

## Phase 3: Scanner Sweep Component

### Task 8: Create ScannerReveal component

**Files:**
- Create: `src/components/ui/ScannerReveal.tsx`

- [ ] **Step 1: Create the scanner sweep component**

```tsx
import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface ScannerRevealProps {
  /** Unique key that changes on navigation to trigger replay */
  triggerKey: string;
  children: ReactNode;
}

export function ScannerReveal({ triggerKey, children }: ScannerRevealProps) {
  const [playing, setPlaying] = useState(false);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip animation on initial mount
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setPlaying(true);
    const timer = setTimeout(() => setPlaying(false), 900);
    return () => clearTimeout(timer);
  }, [triggerKey]);

  return (
    <div className="relative">
      {children}
      {playing && (
        <>
          <div
            className="absolute inset-0 z-40 pointer-events-none"
            style={{
              background: 'var(--brand-bg)',
              animation: 'scanReveal 0.85s cubic-bezier(0.22,0.61,0.36,1) forwards',
            }}
          />
          <div
            className="absolute left-0 right-0 z-50 pointer-events-none"
            style={{
              top: '-1px',
              height: '1px',
              background: 'linear-gradient(90deg, transparent 8%, rgba(45,212,191,0.15) 25%, rgba(45,212,191,0.25) 45%, rgba(45,212,191,0.3) 50%, rgba(45,212,191,0.25) 55%, rgba(45,212,191,0.15) 75%, transparent 92%)',
              boxShadow: '0 0 8px 2px rgba(45,212,191,0.12), 0 0 24px 4px rgba(45,212,191,0.06)',
              animation: 'scanBeam 0.85s cubic-bezier(0.22,0.61,0.36,1) forwards',
            }}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Both pass

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/ScannerReveal.tsx
git commit -m "feat: add ScannerReveal page transition component"
```

---

### Task 9: Integrate ScannerReveal into App.tsx layout

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add ScannerReveal import**

Add to the existing imports at the top of App.tsx (with the other UI component imports):

```tsx
import { ScannerReveal } from './components/ui/ScannerReveal';
```

- [ ] **Step 2: Wrap page content in ScannerReveal**

In the `Dashboard` function, find the main content area (around line 380):

```tsx
<main className="flex-1 overflow-auto p-6">
  <div className="max-w-5xl mx-auto">
```

Wrap the content inside `<main>` with `ScannerReveal`, using `tab` as the trigger key:

```tsx
<main className="flex-1 overflow-auto p-6">
  <ScannerReveal triggerKey={tab}>
    <div className="max-w-5xl mx-auto">
```

And close the `ScannerReveal` after the closing `</div>` of `max-w-5xl`:

```tsx
    </div>
  </ScannerReveal>
</main>
```

The `tab` variable (from React Router) changes on every page navigation, which triggers the scanner animation.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`
Expected: Both pass

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: integrate ScannerReveal into admin layout for page transitions"
```

---

## Phase 4: Consumer Sweep

> **Agentic workers:** Phase 4 tasks can be parallelized across agents. Each task lists its **owned files** — no two tasks share a file. Before starting Phase 4, ensure all Phase 1-3 commits are pushed and available.

### Task 10: Spacing + uppercase sweep — Admin pages (A-K)

**Files owned by this task (modify):**
- `src/components/AnalyticsOverview.tsx`
- `src/components/AeoReview.tsx`
- `src/components/AssetAudit.tsx`
- `src/components/BrandHub.tsx`
- `src/components/ContentBriefs.tsx`
- `src/components/ContentCalendar.tsx`
- `src/components/ContentDecay.tsx`
- `src/components/ContentManager.tsx`
- `src/components/ContentPerformance.tsx`
- `src/components/ContentPipeline.tsx`
- `src/components/ContentPlanner.tsx`
- `src/components/ContentSubscriptions.tsx`
- `src/components/InternalLinks.tsx`
- `src/components/KeywordAnalysis.tsx`
- `src/components/KeywordStrategy.tsx`

**Must NOT touch:** Any file not in the list above.

- [ ] **Step 1: For each file, apply these transformations**

In each file:

1. **Spacing:** Replace `space-y-5` with `space-y-8` for page-level containers (the outermost wrapper divs). Replace `gap-5` with `gap-4` for within-section card grids. Keep `gap-3` for stat card rows.

2. **Uppercase:** Find section-level headings (`<h3>`, `<h4>`, card title text with `uppercase`) and remove `uppercase` class. **KEEP** `uppercase` on:
   - StatCard label spans (the `text-[11px] text-zinc-500 uppercase tracking-wider` pattern)
   - Badge text
   - Any `tracking-wider` + `text-[11px]` label pattern

3. **Hero stats:** If the file renders a top-of-page StatCard row (typically the first grid of StatCards), add `size="hero"` to the first row's StatCards.

Example transformation for a typical page:
```tsx
// BEFORE:
<div className="space-y-5">
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <StatCard label="Users" value="12.4k" />

// AFTER:
<div className="space-y-8">
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <StatCard label="Users" value="12.4k" size="hero" />
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 3: Commit**

```bash
git add src/components/AnalyticsOverview.tsx src/components/AeoReview.tsx src/components/AssetAudit.tsx src/components/BrandHub.tsx src/components/ContentBriefs.tsx src/components/ContentCalendar.tsx src/components/ContentDecay.tsx src/components/ContentManager.tsx src/components/ContentPerformance.tsx src/components/ContentPipeline.tsx src/components/ContentPlanner.tsx src/components/ContentSubscriptions.tsx src/components/InternalLinks.tsx src/components/KeywordAnalysis.tsx src/components/KeywordStrategy.tsx
git commit -m "style: spacing + uppercase + hero stats sweep — admin pages A-K"
```

---

### Task 11: Spacing + uppercase sweep — Admin pages (L-Z)

**Files owned by this task (modify):**
- `src/components/LlmsTxtGenerator.tsx`
- `src/components/LinkChecker.tsx`
- `src/components/MediaTab.tsx`
- `src/components/PageIntelligence.tsx`
- `src/components/PageSpeedPanel.tsx`
- `src/components/PageWeight.tsx`
- `src/components/PendingApprovals.tsx`
- `src/components/PostEditor.tsx`
- `src/components/ProcessingQueue.tsx`
- `src/components/RankTracker.tsx`
- `src/components/RedirectManager.tsx`
- `src/components/RequestManager.tsx`
- `src/components/Roadmap.tsx`
- `src/components/SalesReport.tsx`
- `src/components/SeoAudit.tsx`
- `src/components/SearchDetail.tsx`
- `src/components/SiteArchitecture.tsx`
- `src/components/TrafficDetail.tsx`
- `src/components/WorkspaceHome.tsx`
- `src/components/WorkspaceOverview.tsx`

**Must NOT touch:** Any file not in the list above.

- [ ] **Step 1: Apply spacing, uppercase, and hero stat transformations**

Same rules as Task 10:
1. `space-y-5` → `space-y-8` for page-level containers
2. Remove `uppercase` from section headings (keep on stat labels, badges)
3. Add `size="hero"` to top-of-page StatCard rows

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 3: Commit**

```bash
git add src/components/LlmsTxtGenerator.tsx src/components/LinkChecker.tsx src/components/MediaTab.tsx src/components/PageIntelligence.tsx src/components/PageSpeedPanel.tsx src/components/PageWeight.tsx src/components/PendingApprovals.tsx src/components/PostEditor.tsx src/components/ProcessingQueue.tsx src/components/RankTracker.tsx src/components/RedirectManager.tsx src/components/RequestManager.tsx src/components/Roadmap.tsx src/components/SalesReport.tsx src/components/SeoAudit.tsx src/components/SearchDetail.tsx src/components/SiteArchitecture.tsx src/components/TrafficDetail.tsx src/components/WorkspaceHome.tsx src/components/WorkspaceOverview.tsx
git commit -m "style: spacing + uppercase + hero stats sweep — admin pages L-Z"
```

---

### Task 12: Spacing + uppercase sweep — Client pages

**Files owned by this task (modify):**
- `src/components/client/OverviewTab.tsx`
- `src/components/client/AnalyticsTab.tsx`
- `src/components/client/SearchTab.tsx`
- `src/components/client/HealthTab.tsx`
- `src/components/client/ContentTab.tsx`
- `src/components/client/StrategyTab.tsx`
- `src/components/client/PlansTab.tsx`
- `src/components/client/InsightsEngine.tsx`
- `src/components/client/InsightsDigest.tsx`
- `src/components/client/InsightCards.tsx`
- `src/components/client/InsightNarrative.tsx`
- `src/components/client/PerformanceTab.tsx`
- `src/components/client/ApprovalsTab.tsx`
- `src/components/client/RequestsTab.tsx`
- `src/components/client/InboxTab.tsx`
- `src/components/client/DataSnapshots.tsx`
- `src/components/client/ROIDashboard.tsx`
- `src/components/client/MonthlyDigest.tsx`
- `src/components/client/FixRecommendations.tsx`
- `src/components/client/MatrixProgressView.tsx`
- `src/components/client/SchemaReviewTab.tsx`
- `src/components/client/ContentPlanTab.tsx`

**Must NOT touch:** Any file not in the list above.

- [ ] **Step 1: Apply spacing, uppercase, and hero stat transformations**

Same rules as Tasks 10-11. Additionally for client pages:
- Verify no `purple` classes are introduced (client-facing pages must never use purple)
- If a file uses `SectionCard`, the radius is already handled by the primitive — no per-file radius changes needed

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 3: Commit**

```bash
git add src/components/client/
git commit -m "style: spacing + uppercase + hero stats sweep — client pages"
```

---

### Task 13: Spacing + uppercase sweep — Settings, strategy, schema, editor, audit, briefs, matrix

**Files owned by this task (modify):**
- `src/components/settings/BusinessProfileTab.tsx`
- `src/components/settings/ClientDashboardTab.tsx`
- `src/components/settings/ConnectionsTab.tsx`
- `src/components/settings/FeaturesTab.tsx`
- `src/components/strategy/BacklinkProfile.tsx`
- `src/components/strategy/CompetitiveIntel.tsx`
- `src/components/strategy/ContentGaps.tsx`
- `src/components/strategy/IntelligenceSignals.tsx`
- `src/components/strategy/PageKeywordMap.tsx`
- `src/components/strategy/QuickWins.tsx`
- `src/components/strategy/TopicClusters.tsx`
- `src/components/schema/SchemaHealthDashboard.tsx`
- `src/components/schema/SchemaWorkflowGuide.tsx`
- `src/components/editor/PageEditRow.tsx`
- `src/components/editor/BulkOperations.tsx`
- `src/components/audit/AuditHistory.tsx`
- `src/components/audit/AuditFilters.tsx`
- `src/components/audit/AuditIssueRow.tsx`
- `src/components/audit/ActionItemsPanel.tsx`
- `src/components/briefs/BriefDetail.tsx`
- `src/components/briefs/BriefGenerator.tsx`
- `src/components/briefs/BriefList.tsx`
- `src/components/briefs/RequestList.tsx`
- `src/components/matrix/MatrixBuilder.tsx`
- `src/components/matrix/MatrixGrid.tsx`
- `src/components/matrix/CellDetailPanel.tsx`
- `src/components/matrix/TemplateEditor.tsx`

**Must NOT touch:** Any file not in the list above.

- [ ] **Step 1: Apply spacing and uppercase transformations**

Same rules as previous tasks. These subdirectory components are often sub-views (not full pages), so:
- Only change `space-y-5` to `space-y-8` if it's the component's outermost wrapper
- For nested components, keep tighter spacing (`gap-3` or `gap-4`)
- Hero stats only apply to full-page views, not sub-panels

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/ src/components/strategy/ src/components/schema/SchemaHealthDashboard.tsx src/components/schema/SchemaWorkflowGuide.tsx src/components/editor/ src/components/audit/ src/components/briefs/ src/components/matrix/
git commit -m "style: spacing + uppercase sweep — settings, strategy, schema, editor, audit, briefs, matrix"
```

---

### Task 14: Status color sweep — mute green-400/amber-400/red-400 across consumers

**Files owned by this task:** All files in the grep results for `text-green-400|text-amber-400|text-red-400` that are NOT already modified by Tasks 2-6 (primitives).

This is a high-volume find-and-replace task.

- [ ] **Step 1: Run targeted replacements**

For each consumer file (not primitives), apply these replacements:

| Find | Replace |
|------|---------|
| `text-green-400` | `text-emerald-400/80` |
| `text-red-400` (in status/delta contexts) | `text-red-400/80` |
| `text-amber-400` (in status/warning contexts) | `text-amber-400/80` |
| `bg-green-500/10` | `bg-emerald-500/8` |
| `bg-amber-500/10` (in status contexts) | `bg-amber-500/8` |
| `bg-red-500/10` (in status contexts) | `bg-red-500/8` |

**IMPORTANT:** Do NOT blindly replace all instances. Check context:
- `text-green-400` used for positive deltas → replace with `text-emerald-400/80`
- `text-green-400` used for active/success indicators → replace with `text-emerald-400/80`
- `text-red-400` used for error display → replace with `text-red-400/80`
- Do NOT change teal, blue, or purple colors — those follow the Three Laws
- Do NOT change colors inside `scoreColor()` or `scoreColorClass()` — those are managed by `constants.ts`

**Scope:** The 140 files from the grep include many that use these colors. Focus on status indicators, delta displays, and badge-like elements. Skip files where the color is used as a data visualization color (charts, graphs).

- [ ] **Step 2: Verify no purple in client components**

```bash
grep -r "purple-" src/components/client/
```

Expected: Only pre-existing instances (if any) — no new purple introduced.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "style: mute status colors — green→emerald/80, amber/80, red/80 across consumers"
```

---

### Task 15: Hand-rolled card radius audit

**Purpose:** Find consumer files that hand-roll card markup with `rounded-xl` instead of using `SectionCard`/`StatCard` primitives, and update their radius to match the new asymmetric system.

- [ ] **Step 1: Identify hand-rolled cards**

From the 116 files with `rounded-xl`, the 5 primitives are already handled. The remaining ~111 files need auditing. Many of these will be using `rounded-xl` on non-card elements (modals, dropdowns, icon containers, buttons) that should NOT change.

Only change `rounded-xl` to `style={{ borderRadius: '10px 24px 10px 24px' }}` on elements that are **card-like containers** — divs with `bg-zinc-900 border border-zinc-800` that look/act like SectionCards but don't use the component.

- [ ] **Step 2: Apply radius to confirmed hand-rolled cards**

For each hand-rolled card, either:
1. **Migrate to `<SectionCard>`** if the markup is simple enough (preferred)
2. **Apply inline style** `style={{ borderRadius: '10px 24px 10px 24px' }}` and remove `rounded-xl` if migration isn't feasible

**Do NOT change `rounded-xl` on:**
- Modal overlays (`.modal`, `rounded-2xl` on dialogs)
- Button containers
- Icon wrappers (`rounded-xl` on small icon backgrounds)
- Dropdown menus
- Toast notifications
- The notification banner in App.tsx (~line 387)

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --skipLibCheck && npx vite build`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "style: audit hand-rolled cards — apply asymmetric radius where appropriate"
```

---

## Phase 5: Final Verification & Docs

### Task 16: Diff review checkpoint — full sweep

- [ ] **Step 1: Review all changes since Phase 1 start**

```bash
git log --oneline HEAD~15..HEAD
git diff main..HEAD --stat
```

Check for:
- No duplicate imports across files
- No files modified by multiple tasks (file ownership violation)
- Consistent use of new radius values
- No `violet` or `indigo` introduced
- No `purple` in client components

- [ ] **Step 2: Full quality gate**

```bash
npx tsc --noEmit --skipLibCheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

All four must pass.

---

### Task 17: Update design documentation

**Files:**
- Modify: `BRAND_DESIGN_LANGUAGE.md`
- Modify: `DESIGN_SYSTEM.md`

- [ ] **Step 1: Update BRAND_DESIGN_LANGUAGE.md**

Add a new section for the asymmetric radius scale:

```markdown
### Card Radius — Signature Shape

The platform uses a diagonal asymmetric radius as its signature shape:

| Component | Radius |
|-----------|--------|
| SectionCard | `10px 24px 10px 24px` |
| Insight cards | `8px 16px 8px 16px` |
| StatCard | `6px 12px 6px 12px` |
| Nested cards | `8px` uniform |
| Badges | `4px` uniform |
```

Add notes about:
- Noise overlay (2% opacity SVG feTurbulence on `body::after`)
- Scanner sweep (muted teal beam on page navigation, 850ms)
- Stagger-fade animation (cards fade+slide up with 60ms stagger delay)
- MetricRing glow (outward box-shadow, charge-up sequence)
- Hover accent (teal left-border on interactive SectionCards)
- Status color refinement (emerald-400/80, amber-400/80, red-400/80)

- [ ] **Step 2: Update DESIGN_SYSTEM.md**

Add to the spacing section:
```markdown
### Spacing Variation
- Related items within section: `gap-3` (12px)
- Cards within section: `gap-4` (16px)
- Between major sections: `space-y-8` (32px)
```

Add to the typography section:
```markdown
### Uppercase Rules
- KEEP on: StatCard labels, badges, nav labels
- REMOVE from: Section titles, card headings
```

Add StatCard hero size spec:
```markdown
### Hero Stats
Use `size="hero"` on StatCard for top-of-page metrics.
Number: text-4xl (36px). Padding: p-4.
```

- [ ] **Step 3: Commit**

```bash
git add BRAND_DESIGN_LANGUAGE.md DESIGN_SYSTEM.md
git commit -m "docs: update design system with visual polish changes"
```

---

### Task 18: Visual verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev:all
```

- [ ] **Step 2: Verify in browser**

Check these pages visually:
1. Admin overview page — hero stats, section spacing, asymmetric radius
2. Any page with MetricRing — glow effect, charge-up animation
3. Navigate between tabs — scanner sweep plays
4. Hover over interactive SectionCards — teal left border appears
5. Check a client page — no purple, proper spacing
6. Toggle light mode — all effects work
7. Resize to mobile (375px) — no layout breaks

- [ ] **Step 3: Check noise overlay**

The noise texture should be barely visible at 2% opacity. If it looks "dusty" or too prominent, adjust in `src/index.css` (`opacity: 0.02`).

---

## Dependency Graph

```
Phase 1 (Task 1: CSS keyframes/noise)
  ↓
Phase 2 (Tasks 2-6: primitives — sequential, each builds on committed CSS)
  ↓
Task 7: Diff review checkpoint
  ↓
Phase 3 (Tasks 8-9: ScannerReveal — sequential)
  ↓
Phase 4 (Tasks 10-15: consumer sweep — PARALLELIZABLE across agents)
  ↓
Phase 5 (Tasks 16-18: verification + docs — sequential)
```

**Parallel batch in Phase 4:**
- Tasks 10, 11, 12, 13 can run in parallel (different file sets, no overlap)
- Task 14 (status colors) can run in parallel with Tasks 10-13 IF it skips files owned by other tasks
- Task 15 (hand-rolled radius) must run AFTER Tasks 10-13 complete (needs their committed changes to avoid conflicts)
