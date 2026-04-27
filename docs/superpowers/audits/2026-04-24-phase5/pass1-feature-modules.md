# Pass 1 — Feature Modules Audit (audit, post-editor, revenue, settings)

**Audit date:** 2026-04-24  
**Scope:** `src/components/audit/**`, `src/components/post-editor/**`, `src/components/revenue/**`, settings panels  
**Auditor:** Parallel audit agent (pass 1, domain: feature-modules)

## Summary

Feature modules contain rose violations in guide components and standard zinc/arbitrary-size violations throughout.

## Key findings

### Rose/pink violations

**Count:** 3 hits  

**`src/components/audit/SeoAuditGuide.tsx`** (lines 70–71):
```ts
color: 'text-rose-400',
bg: 'bg-rose-500/10 border-rose-500/20',
```
Context: Used for "Error" tier in a severity legend. Replace with red (error law):
```ts
color: 'text-red-400',
bg: 'bg-red-500/10 border-red-500/20',
```

**`src/components/SettingsPanel.tsx`** (lines 308, 318):
```ts
const colors = ['bg-amber-500', 'bg-teal-500', 'bg-blue-500', 'bg-purple-500', 'bg-rose-500', 'bg-emerald-500'];
const colors = ['text-amber-400', 'text-teal-400', 'text-blue-400', 'text-purple-400', 'text-rose-400', 'text-emerald-400'];
```
Context: Color palette demonstration for workspace branding. This is an intentional color swatch — the rose here is displayed TO the user as a palette option, not used as a UI color.  
**Decision:** Leave these as-is with a `// pr-check-disable-next-line` hatch — they are a color picker, not UI color usage.  
Purple appears here too in the same swatch context; same rationale applies.

### Hand-rolled modals (fixed inset-0)

**Count:** 4 in feature modules  
`src/components/audit/SeoAudit.tsx` has 2 inline modal constructions.  
`src/components/revenue/RevenueDashboard.tsx` has 1.  
`src/components/post-editor/PostEditor.tsx` has 1.

**Fix (Phase 2):** Migrate to `<Modal>` primitive after Task 1.6 lands.

### PageIntelligenceGuide.tsx rose violation

**Count:** 2 hits  
**File:** `src/components/PageIntelligenceGuide.tsx` (lines 130–131):
```ts
color: 'text-rose-400',
bg: 'bg-rose-500/10 border-rose-500/20',
```
Same severity-legend pattern as SeoAuditGuide. Fix: → red.

### ContentPerformance.tsx pink violation

**Count:** 1 hit  
**File:** `src/components/ContentPerformance.tsx` (line 116):
```ts
resource: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
```
Context: Content type badge. Fix: → amber or orange (content categorization, not error).

## Files with highest violation density (non-rose)

1. `src/components/audit/SeoAudit.tsx` — ~200 violations (largest single file)
2. `src/components/post-editor/PostEditor.tsx` — ~120 violations
3. `src/components/SettingsPanel.tsx` — ~100 violations
