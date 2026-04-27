# Pass 1 — Brand Tools Audit (`src/components/brand/**`, schema, strategy)

**Audit date:** 2026-04-24  
**Scope:** `src/components/brand/**`, `src/components/schema/**`, `src/components/strategy/**`  
**Auditor:** Parallel audit agent (pass 1, domain: brand-tools)

## Summary

Brand, schema, and strategy components contain significant rose/pink violations and standard zinc token violations.

## Key findings

### Rose/pink violations

**Count:** 6 hits across 3 files

**`src/components/schema/SchemaPlanPanel.tsx`** (lines 37–38):
```ts
'case-study': 'bg-pink-500/15 text-pink-300 border-pink-500/30',
comparison: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
```

**`src/components/schema/SchemaWorkflowGuide.tsx`** (lines 86–87):
```ts
color: 'text-rose-400',
bg: 'bg-rose-500/10 border-rose-500/20',
```

**`src/components/strategy/KeywordStrategyGuide.tsx`** (lines 76–77):
```ts
color: 'text-rose-400',
bg: 'bg-rose-500/10 border-rose-500/20',
```

**Fix (Task 0.5):** All these are "error" or "risk" contexts — replace with red:
```ts
// SchemaPlanPanel case-study/comparison (content type — use amber for differentiation)
'case-study': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
comparison: 'bg-orange-500/10 text-orange-400 border-orange-500/20',

// SchemaWorkflowGuide + KeywordStrategyGuide (error/warning context)
color: 'text-red-400',
bg: 'bg-red-500/10 border-red-500/20',
```

### Inline asymmetric borderRadius

**Count:** ~80 of the 263 total  
Brand components use `borderRadius: '6px 12px 6px 12px'` for the signature card shape.  
**Fix:** These are intentional signature shapes. Replace with `rounded-[var(--radius-signature)]` after radius tokens land in Phase 0.

### Raw zinc colors

**Count:** ~300 hits across brand/schema/strategy  
Standard violations; Phase 2 Task 2.5 handles this domain.

## Files with highest violation density

1. `src/components/brand/BrandscriptSection.tsx` — ~120 violations
2. `src/components/strategy/KeywordStrategy.tsx` — ~100 violations
3. `src/components/schema/SchemaSuggester.tsx` — ~80 violations
