# Phase 5 Audit Outputs — 2026-04-24

These 10 files are the frozen scope-reference outputs from the 10 parallel audit agents run on April 23–24, 2026, prior to Phase 5 implementation. They define the full violation backlog that Phase 1 (primitives) and Phase 2 (codemods) are committed to eliminating.

**Do not edit these files.** They are a snapshot of the codebase state at audit time. If a subsequent pass reveals additional violations not captured here, create a new dated audit directory (`docs/superpowers/audits/YYYY-MM-DD-<context>/`) — do not amend this one.

## File index

| File | Domain | Pass |
|---|---|---|
| `pass1-ui-primitives.md` | `src/components/ui/**` | Pass 1 — primitive violations |
| `pass1-admin-pages.md` | `src/components/*.tsx` (admin) | Pass 1 — admin page violations |
| `pass1-client-pages.md` | `src/components/client/**` | Pass 1 — client violations + law checks |
| `pass1-brand-tools.md` | `src/components/brand/**`, schema, strategy | Pass 1 — brand/schema/strategy violations |
| `pass1-feature-modules.md` | audit, post-editor, revenue, settings | Pass 1 — feature module violations |
| `pass1-shared-components.md` | remaining `src/components/**` | Pass 1 — shared component violations |
| `pass2-typography.md` | repo-wide | Pass 2 — arbitrary text sizes |
| `pass2-buttons-forms.md` | repo-wide | Pass 2 — hand-rolled buttons + forms |
| `pass2-colors-borders.md` | repo-wide | Pass 2 — raw zinc colors + borders |
| `pass2-spacing-icons-layout.md` | repo-wide | Pass 2 — spacing, icons, layout violations |

## Ground-truth counts (verified via grep at audit time)

| Violation class | Count |
|---|---|
| Arbitrary `text-[Npx]` values | 2,257 |
| Raw `text-zinc-*` | 2,844 |
| Raw `bg-zinc-*` | 1,730 |
| Raw `border-zinc-*` | 1,363 |
| `rounded-lg` (zero uses of `--radius-*`) | 1,104 |
| Hand-rolled buttons | 1,132 |
| Hand-rolled form controls | 303 |
| Inline `flex items-center gap-*` | ~1,200 |
| Inline asymmetric `borderRadius: '...'` | 263 |
| Hand-rolled modals (`fixed inset-0`) | 21 |
| Hand-rolled dropdowns | 15+ |
| Hand-rolled pills bypassing Badge | 30+ |
| Hand-rolled dividers | 50+ |
| Trend icon imports outside TrendBadge | 55 files |
| Purple in non-admin-AI contexts | 26 |
| Rose / pink (no styleguide hue) | 14 |
| `text-green-400` (should be emerald) | 10 |
| `scoreColorClass` returns green, `scoreColor` returns emerald hex | 38+ callsites |
| `Badge.tsx` exposes `purple` variant | 1 |
| `statusConfig.ts` `'in-review'` = purple | 1 |
