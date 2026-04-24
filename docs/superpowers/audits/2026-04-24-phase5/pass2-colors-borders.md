# Pass 2 — Colors & Borders Audit (raw zinc colors + forbidden hues, repo-wide)

**Audit date:** 2026-04-24  
**Scope:** All `src/components/**/*.tsx`  
**Auditor:** Parallel audit agent (pass 2, domain: colors-borders)

## Violation class A: Raw `text-zinc-*`

**Total count:** 2,844 hits  
**Grep command:** `grep -rn 'text-zinc-' src/components/`

### Token mapping

| Raw class | Semantic replacement | Context |
|---|---|---|
| `text-zinc-100` | `var(--brand-text-bright)` | Headings, primary labels |
| `text-zinc-200` | `var(--brand-text-bright)` | Strong secondary text |
| `text-zinc-300` | `var(--brand-text-bright)` | Slightly softer headings |
| `text-zinc-400` | `var(--brand-text)` | Body text, descriptions |
| `text-zinc-500` | `var(--brand-text-muted)` | Muted/secondary text |
| `text-zinc-600` | `var(--brand-text-muted)` | Disabled/very muted text |

## Violation class B: Raw `bg-zinc-*`

**Total count:** 1,730 hits  
**Grep command:** `grep -rn 'bg-zinc-' src/components/`

### Token mapping

| Raw class | Semantic replacement | Context |
|---|---|---|
| `bg-zinc-950` | `var(--surface-1)` | Page/app background |
| `bg-zinc-900` | `var(--surface-2)` | Card surfaces |
| `bg-zinc-800` | `var(--surface-3)` | Elevated/inner panels |

## Violation class C: Raw `border-zinc-*`

**Total count:** 1,363 hits  
**Grep command:** `grep -rn 'border-zinc-' src/components/`

### Token mapping

| Raw class | Semantic replacement |
|---|---|
| `border-zinc-700` | `var(--brand-border-hover)` |
| `border-zinc-800` | `var(--brand-border)` |

## Violation class D: Forbidden hues

### Purple in non-admin-AI contexts

**Count:** 26 hits (post-dedup — 0 in `src/components/client/`)  
Distribution: `Badge.tsx` (1 variant), `statusConfig.ts` (1), admin pages (~24 indirect via Badge)  
**Fix (Task 0.5):** Remove purple from Badge + statusConfig; audit indirect callsites.

### Rose/pink (not in styleguide palette)

**Count:** 14 direct hits  
Files: `ContentPerformance.tsx`, `SettingsPanel.tsx` (swatch - hatch), `PageIntelligenceGuide.tsx`, `SchemaPlanPanel.tsx`, `SchemaWorkflowGuide.tsx`, `SeoAuditGuide.tsx`, `KeywordStrategyGuide.tsx`, `SchemaReviewTab.tsx`  
**Fix (Task 0.5):** Replace with red (error) or amber (warning/info) per context.

## `rounded-lg` violations (law: use radius tokens)

**Total count:** 1,104 hits  
**Grep command:** `grep -rn 'rounded-lg\|rounded-xl\|rounded-md\|rounded-sm\|rounded-full' src/components/`

### Mapping

| Class | Replacement |
|---|---|
| `rounded-sm` | `rounded-[var(--radius-sm)]` |
| `rounded-md` | `rounded-[var(--radius-md)]` |
| `rounded-lg` | `rounded-[var(--radius-lg)]` |
| `rounded-xl` | `rounded-[var(--radius-xl)]` |
| `rounded-full` | `rounded-[var(--radius-pill)]` |

These replacements are Phase 2 work — the radius tokens must land in `src/tokens.css` (Task 0.2) before codemods can reference them.
