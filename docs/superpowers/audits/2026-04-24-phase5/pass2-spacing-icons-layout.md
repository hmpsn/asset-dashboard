# Pass 2 — Spacing, Icons & Layout Audit (repo-wide)

**Audit date:** 2026-04-24  
**Scope:** All `src/components/**/*.tsx`  
**Auditor:** Parallel audit agent (pass 2, domain: spacing-icons-layout)

## Violation class A: Inline flex layouts

**Total count:** ~1,200 hits  
**Key patterns:**

| Pattern | Count | Fix |
|---|---|---|
| `flex items-center gap-1` | ~200 | `<Row gap="xs">` |
| `flex items-center gap-2` | ~350 | `<Row gap="sm">` |
| `flex items-center gap-3` | ~200 | `<Row gap="md">` |
| `flex items-center gap-4` | ~150 | `<Row gap="lg">` |
| `flex flex-col gap-2` | ~100 | `<Stack gap="sm">` |
| `flex flex-col gap-3` | ~100 | `<Stack gap="md">` |
| `flex flex-col gap-4` | ~100 | `<Stack gap="lg">` |

## Violation class B: Trend icons imported outside TrendBadge

**Total count:** 55 files importing `TrendingUp` or `TrendingDown` from lucide-react  
**Grep command:** `grep -rn 'TrendingUp\|TrendingDown' src/components/ | grep -v 'TrendBadge\|__tests__'`

### Representative pattern (admin pages)

```tsx
// BEFORE
import { TrendingUp, TrendingDown } from 'lucide-react';
// ...
{trend > 0 ? (
  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
) : (
  <TrendingDown className="w-3.5 h-3.5 text-red-400" />
)}
<span className={trend > 0 ? 'text-emerald-400' : 'text-red-400'}>
  {Math.abs(trend)}%
</span>
```

```tsx
// AFTER (Phase 2)
<TrendBadge value={trend} />
```

## Violation class C: Inline asymmetric borderRadius

**Total count:** 263 hits  
**Grep command:** `grep -rn "borderRadius:" src/components/`

### Pattern

```tsx
// BEFORE
style={{ borderRadius: '6px 12px 6px 12px' }}
// or
style={{ borderRadius: '10px 24px 10px 24px' }}
```

```tsx
// AFTER (Phase 2 — after radius tokens land in Task 0.2)
className="rounded-[var(--radius-signature)]"
// or
className="rounded-[var(--radius-signature-lg)]"
```

### Note on asymmetric radius

These are the brand "signature" shapes — intentional per design law. The token must exist before the codemod can reference it. Task 0.2 adds `--radius-signature` and `--radius-signature-lg` to `src/tokens.css`.

## Violation class D: Hand-rolled modals (fixed inset-0)

**Total count:** 21 modal constructions  
**Grep command:** `grep -rn 'fixed inset-0' src/components/ | grep -v overlay`

Most are in admin pages (`SeoAudit.tsx` has 4, `Approvals.tsx` has 3, `ContentPipeline.tsx` has 2).  
**Fix (Phase 2):** Migrate to `<Modal>` primitive after Task 1.6 lands.

## Icon size inventory

Existing Lucide icon usage sizes:
- `w-3 h-3` (12px) → `<Icon size="sm">`
- `w-3.5 h-3.5` (14px) → closest: `<Icon size="sm">` (12px) or raw `w-3.5 h-3.5`
- `w-4 h-4` (16px) → `<Icon size="md">`
- `w-5 h-5` (20px) → `<Icon size="lg">`
- `w-6 h-6` (24px) → `<Icon size="xl">`

The `w-3.5 h-3.5` case (14px) doesn't have an exact enum match. The Icon primitive spec defines `xs=8, sm=12, md=16, lg=20, xl=24, 2xl=32`. For 14px icons the codemod should emit a comment requesting manual review.
