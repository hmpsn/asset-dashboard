# Pass 1 — UI Primitives Audit (`src/components/ui/**`)

**Audit date:** 2026-04-24  
**Scope:** `src/components/ui/*.tsx`, `src/components/ui/*.ts`  
**Auditor:** Parallel audit agent (pass 1, domain: ui-primitives)

## Summary

The UI primitive layer itself has minimal violations — it is the reference implementation. Violations here are exceptions to document, not patterns to follow.

## Findings

### Badge.tsx — forbidden purple variant

**Count:** 1  
**File:** `src/components/ui/Badge.tsx`  
**Violation:** `BADGE_COLORS` map exposes a `purple` key (`bg-purple-500/10 text-purple-400`). The `BadgeProps.color` union includes `'purple'`. This makes purple reachable from any consumer, including client-facing views.  
**Fix (Task 0.5):** Delete the `purple` key from `BADGE_COLORS`. Update the `color` union type to remove `'purple'`.  
**Representative code:**
```ts
// VIOLATION — remove in Task 0.5
purple: 'bg-purple-500/10 text-purple-400',
```

### statusConfig.ts — 'in-review' uses purple

**Count:** 1  
**File:** `src/components/ui/statusConfig.ts`  
**Violation:** `statusConfig['in-review']` uses `border-purple-500/30`, `bg-purple-500/10`, `text-purple-400`, `bg-purple-400`. "In review" is a data state, not admin-AI — it should use blue.  
**Fix (Task 0.5):** Change to `border-blue-500/30`, `bg-blue-500/10`, `text-blue-400`, `bg-blue-400`.

### constants.ts — scoreColorClass returns green-400 for score >=80

**Count:** 1 (function), 38+ callsites  
**File:** `src/components/ui/constants.ts`  
**Violation:** `scoreColorClass` returns `'text-green-400'` for `score >= 80`. But `scoreColor()` returns `'#34d399'` (emerald-400 hex), not `#4ade80` (green-400 hex). The class and hex are mismatched color families.  
**Fix (Task 0.4):** Change `scoreColorClass` return for `>= 80` to `'text-emerald-400'`.

## Clean areas

- `SectionCard.tsx` — uses `var(--brand-border)`, `var(--brand-bg-card)` correctly
- `StatCard.tsx` — token-clean
- `TrendBadge.tsx` — Phase 4 output; emerald + red per Law 03
- `ChartCard.tsx` — Phase 4 output; uses chart CSS vars
- `Badge.tsx` (non-purple variants) — teal/blue/emerald/amber/red/orange/zinc all correct
