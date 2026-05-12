# Phase B Migration Map

> **Single source of truth for `text-*` → `.t-*` class migrations.**
> Consult this table before migrating ANY `text-[Npx]` or Tailwind text utility.
> Last updated: Phase A (PR #329).

---

## Boosted vs Non-Boosted — Critical Distinction

Three Tailwind classes are silently boosted by `!important` overrides in `src/index.css:117-119`:

| Class | Native size | Boosted size | Override rule |
|-------|-------------|--------------|---------------|
| `text-[11px]` | 11px | **13.5px** | `.text-\[11px\] { font-size: 13.5px !important }` |
| `text-xs` | 12px | **13.5px** | `.text-xs { font-size: 13.5px !important }` |
| `text-sm` | 14px | **15.5px** | `.text-sm { font-size: 15.5px !important }` |

**Everything else renders at face value.** Common traps:

| Class | Actual rendered size | Common mistake | Why it's wrong |
|-------|---------------------|----------------|----------------|
| `text-[10px]` | **10px** (NOT boosted) | → `t-caption-sm` (13.5px) | 35% size increase |
| `text-[10px]` | **10px** (NOT boosted) | → `t-micro` (10px) | Adds unwanted monospace + uppercase |
| `text-[12px]` | **12px** (NOT boosted) | → `t-caption` (13.5px) | 12.5% increase (intentional normalization — see note below) |
| `text-[13px]` | **13px** (NOT boosted) | → `t-caption` (13.5px) | Close match, acceptable |
| `text-base` | **16px** (NOT boosted) | — | Already close to `t-page` (15.5px) |

> **Note on `text-[12px]`:** The user's mapping table maps `text-[12px]` → `.t-caption` (Inter 400).
> This is an intentional normalization to consolidate caption-level text. Accept the 12→13.5px change.

---

## Complete Migration Lookup Table

### Size-Preserving Migrations (boosted classes)

These migrations produce **zero visual change** because the `.t-*` class matches the boosted size:

| Old class | Rendered size | → New class | `.t-*` size | Delta | Context rule |
|-----------|--------------|-------------|-------------|-------|-------------|
| `text-[11px]` (non-uppercase) | 13.5px | → `.t-caption-sm` | 13.5px | **0** | Default for `text-[11px]` |
| `text-[11px]` (uppercase + tracked) | 13.5px | → `.t-label` | 11.5px | **−2px** | Semantic: DIN Pro uppercase labels (intentional) |
| `text-xs` | 13.5px | → `.t-caption` | 13.5px | **0** | |
| `text-sm` | 15.5px | → `.t-body` | 15.5px | **0** | **NOT `t-ui`** (13.5px) — this is the #1 mistake |

### Non-Boosted Migrations

| Old class | Rendered size | → New class | `.t-*` size | Notes |
|-----------|--------------|-------------|-------------|-------|
| `text-[10px]` | 10px | → **keep `text-[10px]`** | — | Add `/* arbitrary-text-ok */`. NOT `t-micro` (adds monospace + uppercase). NOT `t-caption-sm` (13.5px). |
| `text-[12px]` | 12px | → `.t-caption` | 13.5px | Intentional normalization per mapping table |
| `text-[13px]` / `text-[13.5px]` | 13-13.5px | → `.t-ui` | 13.5px | |
| `text-[14px]` / `text-[14.5px]` | 14-14.5px | → `.t-body` | 15.5px | Slight increase, acceptable |
| `text-[15.5px]` / `text-[16px]` | 15.5-16px | → `.t-page` | 15.5px | |
| `text-[18px]` | 18px | → `.t-stat-sm` | 18px | DIN Pro 600, tabular-nums |
| `text-[22px]` | 22px | → `.t-h2` | 22px | DIN Pro 600 |
| `text-[24px]` | 24px | → `.t-stat` | 24px | DIN Pro 700, tabular-nums |
| `text-[28px]` | 28px | → `.t-h1` | 28px | DIN Pro 600 |
| `text-[34px]` | 34px | → `.t-stat-lg` | 34px | DIN Pro 700, tabular-nums |
| `text-[42px]` | 42px | → `.t-hero` | 42px | DIN Pro 700 |

### Primitives That Own Their Size (use `arbitrary-text-ok`)

These primitives define their own size scale and should NOT be migrated to `.t-*`:

| Component | Class | Reason |
|-----------|-------|--------|
| `Badge.tsx` | `text-[11px]` | Badge owns this size |
| `TrendBadge.tsx` | `text-[11px]` / `text-xs` | TrendBadge owns this size scale |
| `StatusBadge.tsx` | `text-[11px]` / `text-xs` | StatusBadge owns this size scale |
| `TierGate.tsx` badges | `text-[10px]` | Plan/tier names are UI labels, not mono content |
| `AIContextIndicator.tsx` button | `text-[10px]` | Action button, t-micro would add uppercase+monospace |

---

## The Three Traps (learned from Phase A review rounds)

### Trap 1: `text-sm` → `t-ui` instead of `t-body`

`text-sm` is boosted to **15.5px**. `.t-ui` is **13.5px**. `.t-body` is **15.5px**.

- **Wrong:** `text-sm font-semibold` → `t-ui font-semibold` (13% size regression)
- **Right:** `text-sm font-semibold` → `t-body font-semibold` (size preserved)

The confusion: `t-ui` and `text-sm` are semantically close ("small UI text"), but their sizes diverge after the boost.

### Trap 2: `text-[10px]` → any `.t-*` class

`text-[10px]` is **NOT boosted**. It renders at exactly 10px. There is no `.t-*` class at 10px that doesn't add unwanted styles:

- `t-micro` = 10px but adds **Fira Code monospace + uppercase + tracking** (wrong for plan names, buttons, ROI text)
- `t-caption-sm` = 13.5px (35% size increase)

**Always keep `text-[10px]` as-is with `/* arbitrary-text-ok */`**, unless the content is genuinely monospace (timestamps, IDs, code snippets).

### Trap 3: `t-label` is a semantic mapping, not size-preserving

`text-[11px]` (uppercase, tracked) → `.t-label` changes the font from Inter to **DIN Pro** and the size from 13.5px (boosted) to **11.5px**. This is intentional — DIN Pro uppercase labels have their own design scale. But be aware it's not size-preserving.

**Rule of thumb:** If the element has `uppercase` + `tracking-wider` + `font-medium/500`, it's a label → use `.t-label`. Otherwise, it's caption text → use `.t-caption-sm`.

---

## Tailwind → Token Mapping (non-typography)

| Raw Tailwind | Token replacement |
|---|---|
| `bg-zinc-950`, `bg-[#0f1219]` | `bg-[var(--surface-1)]` |
| `bg-zinc-900` | `bg-[var(--surface-2)]` |
| `bg-zinc-800` | `bg-[var(--surface-3)]` |
| `text-zinc-100`, `text-zinc-200` | `text-[var(--brand-text-bright)]` |
| `text-zinc-300`, `text-zinc-400` | `text-[var(--brand-text)]` |
| `text-zinc-500` | `text-[var(--brand-text-muted)]` |
| `text-zinc-600`, `text-zinc-700` | `text-[var(--brand-text-dim)]` |
| `border-zinc-700`, `border-zinc-800` | `border-[var(--brand-border)]` |
| `rounded-lg`, `rounded-xl` | `rounded-[var(--radius-lg)]` |
| `rounded-2xl` | `rounded-[var(--radius-xl)]` |
| `rounded-md` | `rounded-[var(--radius-md)]` |
| `rounded` / `rounded-sm` | `rounded-[var(--radius-sm)]` |

---

## Hatch Comments

| Comment | When to use |
|---------|-------------|
| `// arbitrary-text-ok` | Primitive owns its size, or size genuinely outside the type scale |
| `// raw-zinc-ok` | Intentional raw zinc (e.g., Badge zinc variant, TierGate free-tier muted palette) |
| `// asymmetric-radius-ok` | Non-card surface with one-off asymmetric corners |
| `/* arbitrary-text-ok — reason */` | JSX attribute-level comment (use when `//` isn't valid in JSX) |

---

## After Phase B Completes

Once all Phase B domain sweeps have merged:
1. Remove the `!important` overrides at `src/index.css:256-258`
2. Restore `.t-*` classes to their target sizes:
   - `.t-caption-sm`: 13.5px → 12px
   - `.t-caption`: 13.5px → 13px
   - `.t-body`: 15.5px → 16px (or keep at 15.5px if preferred)
3. This diverges the collapsed type hierarchy back to distinct levels
