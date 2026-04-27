# Pass 1 — Shared Components Audit (remaining `src/components/**`)

**Audit date:** 2026-04-24  
**Scope:** All `src/components/` files not covered by other pass-1 domains  
**Auditor:** Parallel audit agent (pass 1, domain: shared-components)

## Summary

Shared components (matrix, onboarding, content pipeline, link checker, redirect manager) follow similar patterns to admin pages. No additional law violations beyond what other passes found.

## Key findings

### Hand-rolled trend icons (TrendingUp/TrendingDown outside TrendBadge)

**Count:** 55 files importing from lucide-react  
Most prominent: `src/components/AnalyticsHub.tsx`, `src/components/Performance.tsx`, `src/components/Rankings.tsx`

**Fix (Phase 2):** Replace with `<TrendBadge value={n} />` which encodes direction + color automatically.

### Hand-rolled dividers

**Count:** 50+ (`<hr>` or `<div className="border-t border-zinc-800">`)  
**Fix (Phase 2):** Replace with `<Divider>` primitive after Task 1.5 lands.

### Hand-rolled pills bypassing Badge

**Count:** 30+  
Pattern: `<span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">Label</span>`  
**Fix (Phase 2):** Replace with `<Badge label="..." color="amber" />`.

### Inline flex layouts

**Count:** ~1,200 of the total  
`<div className="flex items-center gap-2">` → `<Row gap="sm">`  
`<div className="flex flex-col gap-3">` → `<Stack gap="md">`  
**Fix (Phase 2):** Apply layout codemod.

### text-green-400 (success/positive contexts)

**Count:** ~10 additional hits (beyond PageIntelligence.tsx)  
- `src/components/RedirectManager.tsx` — line 359 (redirect destination)  
- `src/components/LinkChecker.tsx` — lines 156, 171, 174

**Fix (Task 0.4 + Phase 2):** scoreColorClass auto-fixes after Task 0.4. Direct `text-green-400` usage in non-score contexts gets reviewed in Phase 2.

## Files with highest violation density

1. `src/components/ContentPipeline.tsx` — ~120 violations
2. `src/components/Approvals.tsx` — ~100 violations  
3. `src/components/Requests.tsx` — ~90 violations
4. `src/components/matrix/PageMatrix.tsx` — ~80 violations
5. `src/components/LinkChecker.tsx` — ~60 violations
