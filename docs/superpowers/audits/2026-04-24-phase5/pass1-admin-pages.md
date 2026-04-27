# Pass 1 — Admin Pages Audit (`src/components/*.tsx`)

**Audit date:** 2026-04-24  
**Scope:** Top-level `src/components/*.tsx` (admin-facing pages and shared page components)  
**Auditor:** Parallel audit agent (pass 1, domain: admin-pages)

## Summary

Admin pages are the heaviest violation domain. They predate the design system and use raw Tailwind zinc classes throughout. Phase 2 Task 2.1 and 2.2 own most of these.

## Key findings

### Arbitrary text sizes

**Count:** ~800 of the 2,257 total  
`text-[11px]`, `text-[10px]`, `text-[12px]`, `text-[13px]` throughout. Concentrated in `PageIntelligence.tsx`, `Dashboard.tsx`, `Rankings.tsx`.

**Fix pattern:**
```tsx
// BEFORE
<span className="text-[11px] text-zinc-500">Label</span>
// AFTER
<span className="t-label text-zinc-500">Label</span>  // then Task 2.x replaces text-zinc-500
```

### Raw text-zinc-* 

**Count:** ~900 of the 2,844 total  
Representative: `text-zinc-400` for body text, `text-zinc-500` for muted text, `text-zinc-300` for headings.

**Fix pattern:**
```tsx
// BEFORE
<p className="text-zinc-400">Body text</p>
// AFTER
<p style={{ color: 'var(--brand-text)' }}>Body text</p>
// or via .t-body class
<p className="t-body">Body text</p>
```

### Raw bg-zinc-* 

**Count:** ~600 of the 1,730 total  
Representative: `bg-zinc-900` for card surfaces, `bg-zinc-800` for inner panels.

### Raw border-zinc-*

**Count:** ~500 of the 1,363 total

### scoreColorClass callsites

**Count:** 38+ callsites across admin pages that call `scoreColorClass()` and render `text-green-400` output (currently). These will auto-fix after Task 0.4 changes the function.

### text-green-400 direct usage

**Count:** ~15 hits in admin pages (PageIntelligence.tsx is the main source)  
**File highlights:**
- `src/components/PageIntelligence.tsx` — ~12 instances used as success/position indicator
- `src/components/LinkChecker.tsx` — 2 instances (healthy count, check icon)

**Fix:** Replace `text-green-400` with `text-emerald-400` in success/positive contexts.

## Files with highest violation density

1. `src/components/PageIntelligence.tsx` — 200+ violations
2. `src/components/Dashboard.tsx` — 150+ violations  
3. `src/components/Rankings.tsx` — 120+ violations
4. `src/components/Competitors.tsx` — 100+ violations
5. `src/components/ContentPipeline.tsx` — 80+ violations
