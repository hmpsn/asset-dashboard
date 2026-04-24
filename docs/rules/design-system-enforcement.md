# Design System Enforcement Rules

> This file documents the automated and manual rules that enforce the design system
> across the codebase. For the token authority contract, see the "Token authority"
> section below. For pr-check rule authoring, see
> `docs/rules/pr-check-rule-authoring.md`.

These rules are mechanized in `scripts/pr-check.ts` and enforced on every PR diff.
All rules are scoped to files changed in the diff (not the full repo) during the Phase 1–3 migration window.

---

## Active Rules (pr-check)

| Rule | Severity | Pattern | Scope |
|------|----------|---------|-------|
| Legacy surface token | warn | `var(--brand-bg-*)` | `*.tsx`, `*.css` |
| Hand-rolled card div | warn | `bg-zinc-9xx + rounded-xl` | `*.tsx` (excl. `ui/`) |
| Page component missing PageHeader | warn | customCheck curated list | page components |
| Hardcoded card radius | warn | `rounded-xl` outside `ui/` | `*.tsx` (excl. `ui/`) |
| radius-signature-lg exclusivity | **error** | `--radius-signature-lg` | all, excl. SectionCard + styleguide |
| Non-standard transition duration | warn | duration not 120/180/400ms | `*.tsx`, `*.css` |
| Purple in client components | error | `purple-` Tailwind class | `src/components/client/` |
| Forbidden hues (violet/indigo) | error | `violet-` or `indigo-` | `src/components/` |
| Hardcoded dark hex in inline styles | error | `#0f1219` and related dark hex | `src/` |
| SVG with hardcoded dark fill/stroke | warn | Dark hex in SVG `fill=` / `stroke=` | `src/` |
| styleguide-token-parity | warn | Any `--*` token in `styleguide.css` | `public/styleguide.css` |

## Migration path

- Phase 1: All rules ship as `warn` (except `radius-signature-lg exclusivity`, `Purple in client`, `Forbidden hues`, and `Hardcoded dark hex` which are `error` immediately).
- Phase 3f: Rules A, B, D promoted to `error` once all 47 files are migrated.
- Phase 4+: Rule F promoted to `error` once `--motion-*` tokens land.
- Phase 3: `styleguide-token-parity` promoted to `error` after parity verified.

## Escape hatch

Add `// pr-check-disable-next-line` above the offending line with a justification comment.
Only use for modals, non-card elements, or intentional design exceptions.

Per-rule hatch comments (preferred over the generic form):

| Rule | Hatch comment |
|------|---------------|
| styleguide-token-parity | `// token-parity-ok` |
| Purple in client components | `// purple-ok` (not yet implemented) |
| Forbidden hues (violet/indigo) | `// hue-ok` (not yet implemented) |

Phase 3 will add hatch support to all new rules as they land.

---

## Phase 5 Migration Window (2026-04-24)

Phase 5 is a Total Unification Sweep. The following rules are **planned for Phase 3**
(after Phase 2 codemod execution), at which point they will be added to `pr-check.ts`
as `error`-severity customCheck rules. During Phase 0 and Phase 1, they are manual
guidelines enforced by code review.

| Planned rule | Status | What it blocks |
|---|---|---|
| Arbitrary `text-[Npx]` values | planned (Phase 3) | Raw pixel font sizes — use `.t-*` utility class |
| Raw `text-zinc-*` in components | planned (Phase 3) | Direct zinc text colors — use `var(--brand-text/bright/muted/dim)` |
| Raw `bg-zinc-*` in components | planned (Phase 3) | Direct zinc backgrounds — use `var(--surface-1/2/3)` |
| Raw `border-zinc-*` in components | planned (Phase 3) | Direct zinc borders — use `var(--brand-border)` |
| `rounded-lg` without `var(--radius-*)` | planned (Phase 3) | Literal border-radius class — use `rounded-[var(--radius-lg)]` |
| Hand-rolled buttons | planned (Phase 3) | Inline `px-* py-* rounded-* bg-* text-*` button patterns — use `<Button>` or `<IconButton>` |
| Hand-rolled form controls | planned (Phase 3) | Inline `<input>`, `<select>`, `<textarea>` — use `<FormInput>`, `<FormSelect>`, `<FormTextarea>` |
| `flex items-center gap-*` without layout primitive | planned (Phase 3) | Inline flex layouts — use `<Row>`, `<Stack>`, `<Column>` |
| `fixed inset-0` modal pattern | planned (Phase 3) | Hand-rolled modals — use `<Modal>` |
| `rose-` or `pink-` hues | planned (Phase 3) | Non-system hues eliminated in Phase 0; rule catches regressions |
| `text-green-400` for success/score | planned (Phase 3) | Success color must be `text-emerald-400` (emerald, not green) |

All Phase 3 rules will report `warn` initially and be promoted to `error` after a
2-sprint stabilization period.

---

## Token Authority

| File | Role |
|------|------|
| `src/tokens.css` | **Canonical source** — ALL `--*` CSS custom properties. Only file that may declare tokens. |
| `src/index.css` | `@import './tokens.css'` + global resets + `.t-*` typography classes + animations. Zero `--*` declarations. |
| `public/tokens.css` | Build mirror — copied from `src/tokens.css` by `copyTokensPlugin()` in `vite.config.ts`. Used by `public/styleguide.css`. |
| `public/styleguide.css` | `@import url('/tokens.css')` + styleguide chrome only. Zero `--*` declarations. |

Verification: `npx tsx scripts/verify-styleguide-parity.ts`
pr-check rule: `styleguide-token-parity` (warn → error in Phase 3)

### Outstanding hatches to migrate

The `// pr-check-disable-next-line` comment form predates per-rule hatches. When any
existing site using that form is touched in Phase 2 or 3, migrate it to the per-rule
form (`// <rule-name>-ok`) in the same commit.
