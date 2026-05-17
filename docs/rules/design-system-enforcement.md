# Design System Enforcement Rules

> This file documents the automated and manual rules that enforce the design system
> across the codebase. For the token authority contract, see the "Token authority"
> section below. For pr-check rule authoring, see
> `docs/rules/pr-check-rule-authoring.md`.

The active rule list is generated in [automated-rules.md](./automated-rules.md)
from `scripts/pr-check.ts`; treat that generated file as the live severity table.
This document explains the design-system contract, ratchet strategy, and manual
backlog that is not yet safe to fail in CI.

For the active lock-in contract (authority order, invariants, scorecard schema,
and ratchet gates), see [styleguide-lockdown-contract.md](./styleguide-lockdown-contract.md).
For canonical rule inventory and tier/status tracking, see
[styleguide-rule-registry.md](./styleguide-rule-registry.md) and
`data/styleguide-rule-registry.json`.

---

## Active Rules (pr-check)

Do not maintain a hand-copied rule table here. Run `npm run rules:generate`
and read [automated-rules.md](./automated-rules.md) for current names,
severities, hatches, and scopes. CI fails if the generated document drifts
from the `CHECKS` array.

## Migration path

- Error rules lock zero-hit invariants, such as forbidden hues, token parity,
  raw action primitives, and signature-radius exclusivity.
- Warning/report-only rules identify known backlog that still needs migration.
- New drift categories should land as advisory metrics or warnings first unless
  an audit proves they are already zero-hit and fixture-covered.
- Promote warnings to errors only after the backlog reaches zero and the rule has
  tests in `tests/pr-check.test.ts`.
- Every style directive under migration must be represented in the styleguide
  rule registry with owner, metric key, and promotion prerequisites.
- Current advisory detector wave also tracks: required `/tokens.css` import in
  `public/styleguide.css`, stale extra `.t-*` classes in static styleguide CSS,
  and token declarations outside canonical token files.

## Escape hatch

Add `// pr-check-disable-next-line` above the offending line with a justification comment.
Only use for modals, non-card elements, or intentional design exceptions.

Per-rule hatch comments (preferred over the generic form):

| Rule | Hatch comment |
|------|---------------|
| styleguide-token-parity | `// token-parity-ok` |
| Purple in client components | `// purple-ok` (not yet implemented) |
| Forbidden hues (violet/indigo) | `// hue-ok` (not yet implemented) |

See [automated-rules.md](./automated-rules.md) for the current hatch per rule.

---

## Phase 5 Migration Window (2026-04-24)

Phase 5 is a Total Unification Sweep. Several items from the original plan are
now hard errors in `pr-check`; the remaining items below are still backlog or
advisory because the repo has known legitimate/native usage that needs a focused
backfill before CI can fail on it.

| Planned rule | Status | What it blocks |
|---|---|---|
| Hand-rolled form controls | error | Inline visible `<input>`, `<select>`, `<textarea>` — use `<FormInput>`, `<FormSelect>`, `<FormTextarea>`, `<Checkbox>`, or `<Toggle>`. Native `hidden`, `file`, and `color` inputs are allowed. |
| Static styleguide inline note chrome | error | Inline note typography/spacing in `public/styleguide.html` — use `.spec-note` / `.sg-note` |
| Static styleguide radius prose drift | error | Raw or stale pixel radius prose — name `--radius-*` tokens and primitive ownership |
| Hand-rolled badge-like spans | advisory | Inline rounded status/category/count pills — use `<Badge>` or `<StatusBadge>` |
| Static styleguide raw controls/specimens | manual review | Static examples may intentionally show raw HTML; label bad examples clearly |
| `flex items-center gap-*` without layout primitive | manual review | Inline flex layouts — use `<Row>`, `<Stack>`, `<Column>` when the abstraction adds value |

`scripts/report-style-drift.ts` includes advisory counts for raw form controls,
client purple, static styleguide debt, and badge-like spans. Raw visible form
controls and static styleguide note/radius debt are now also enforced by
`pr-check` after the May 2026 ratchet sweep drove both counts to zero. Badge-like
spans remain advisory until the shared `Badge`/`StatusBadge` migration reaches
zero and fixtures cover allowed exceptions.

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

**Phase 3 author note — `src/index.css` gap:** The `styleguide-token-parity` rule currently
only checks `public/styleguide.css` for stray `--*` declarations. A matching rule for
`src/index.css` (ensuring it stays token-free beyond the `@import`) is not yet mechanized.
Phase 3 should add a `customCheck` that scans `src/index.css` for `--*` lines outside the
import statement. Until then, `verify-styleguide-parity.ts` check #3 provides a manual gate.

### Outstanding hatches to migrate

The `// pr-check-disable-next-line` comment form predates per-rule hatches. When any
existing site using that form is touched in Phase 2 or 3, migrate it to the per-rule
form (`// <rule-name>-ok`) in the same commit.
