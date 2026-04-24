# Design System Enforcement Rules

> This file documents the automated and manual rules that enforce the design system
> across the codebase. For the token authority contract, see the "Token authority"
> section of `CLAUDE.md`. For pr-check rule authoring, see
> `docs/rules/pr-check-rule-authoring.md`.

---

## Enforced Rules (pr-check)

| Rule name | Scope | Severity | What it catches |
|-----------|-------|----------|-----------------|
| Purple in client components | `src/components/client/` | error | `purple-` Tailwind class — purple is admin-AI only |
| Forbidden hues (violet/indigo) in components | `src/components/` | error | `violet-` or `indigo-` — not in design system |
| Hardcoded dark hex in inline styles | `src/` | error | `#0f1219` and related dark hex in `style={...}` |
| SVG with hardcoded dark fill/stroke | `src/` | warn | Dark hex in SVG `fill=` / `stroke=` attributes |
| styleguide-token-parity | `public/styleguide.css` | warn | Any `--*` token declaration in styleguide.css (must use `@import url('/tokens.css')`) |

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
pr-check rule: `styleguide-token-parity` (warn, Phase 3 → error)

### Outstanding hatches to migrate

The `// pr-check-disable-next-line` comment form predates per-rule hatches. When any
existing site using that form is touched in Phase 2 or 3, migrate it to the per-rule
form (`// <rule-name>-ok`) in the same commit.

---

## Escape Hatches

Each automated rule has a per-rule hatch comment. Hatch comments suppress the rule
for the line they appear on OR the line immediately below (above-line style). Both
are valid; above-line is preferred for readability.

| Rule | Hatch comment |
|------|---------------|
| styleguide-token-parity | `// token-parity-ok` |
| Purple in client components | `// purple-ok` (not yet implemented) |
| Forbidden hues (violet/indigo) | `// hue-ok` (not yet implemented) |

Phase 3 will add hatch support to all new rules as they land.
