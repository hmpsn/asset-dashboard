# Pass 2 — Typography Audit (arbitrary text sizes, repo-wide)

**Audit date:** 2026-04-24  
**Scope:** All `src/components/**/*.tsx`  
**Auditor:** Parallel audit agent (pass 2, domain: typography)

## Violation class: Arbitrary `text-[Npx]` values

**Total count:** 2,257 hits  
**Grep command:** `grep -rn 'text-\[\d' src/components/`

## Most common patterns

| Pattern | Count | Target fix |
|---|---|---|
| `text-[11px]` | ~900 | `.t-label` or `.t-caption` |
| `text-[10px]` | ~200 | `.t-micro` |
| `text-[12px]` | ~400 | `.t-caption-sm` or `.t-label` |
| `text-[13px]` | ~300 | `.t-body` or `.t-ui` |
| `text-[14px]` | ~150 | `.t-body` |
| `text-[15px]` | ~100 | `.t-page` |
| `text-[9px]` | ~50 | `.t-micro` |
| Others | ~157 | Varies |

## Token mapping (after Task 0.3 publishes `.t-*` globally)

```css
.t-hero     → 42px / -0.03em / DIN Pro 600
.t-h1       → 28px / -0.025em / DIN Pro 600
.t-h2       → 22px / -0.02em / DIN Pro 600
.t-stat-lg  → 34px / -0.03em / DIN Pro 700 tabular
.t-stat     → 24px / -0.025em / DIN Pro 700 tabular
.t-stat-sm  → 18px / -0.02em / DIN Pro 600 tabular
.t-page     → 15.5px / Inter 400
.t-body     → 14.5px / Inter 400
.t-ui       → 13.5px / Inter 500
.t-label    → 11.5px / DIN Pro 500 uppercase tracking-wide
.t-caption  → 12px / Inter 400
.t-caption-sm → 11px / Inter 400
.t-mono     → 12px / monospace
.t-micro    → 10px / Inter 400
```

## Phase 2 codemod approach

The Phase 1 typography codemod (`scripts/codemods/phase5-typography.ts`) will AST-walk `.tsx` files and emit a per-file report of matches. Manual review required for ambiguous cases (e.g., `text-[11px]` on a stat number should be `.t-caption`, not `.t-label`).

## Representative examples

### Before
```tsx
<span className="text-[11px] text-zinc-500 uppercase tracking-wide font-medium">
  Page Authority
</span>
```

### After (Phase 2)
```tsx
<Label>Page Authority</Label>
```

### Before
```tsx
<div className="text-3xl font-bold text-zinc-100">
  {score}
</div>
```

### After (Phase 2)
```tsx
<Stat size="default">{score}</Stat>
```
