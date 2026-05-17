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
- Wave 8 ratchet (2026-05-18) promoted these zero-hit checks to error:
  `styleguide-css-must-import-public-tokens`,
  `styleguide-typography-extra-class-drift`,
  `global-token-declaration-outside-canonical-token-files`,
  `hardcoded card radius outside ui primitives`, and
  `badge-like-span-outside-primitives`.
- Wave 9 ratchet (2026-05-18) promoted these zero-hit checks to error:
  `badge-color-prop-deprecation` and
  `interactive-div-role-button`.
- Wave 10 ratchet (2026-05-18) promoted this zero-hit check to error:
  `primitive-override-drift-on-form-controls`.
- Wave 12 ratchet prep (2026-05-17) added three new warn-tier advisory
  detectors with fixture coverage and drift-report breakdowns:
  `duplicate-heading-signal`, `nested-card-density-signal`, and
  `blue-action-semantic-drift`.
- Wave 14 ratchet (2026-05-17) promoted these zero-hit checks to error:
  `duplicate-heading-signal`,
  `nested-card-density-signal`, and
  `blue-action-semantic-drift`.
- Wave 15 ratchet (2026-05-17) promoted `src-index-css-no-token-declarations`
  to error after sustained zero-hit verification and added
  `status-semantic-mapping-drift` as a new warn-tier advisory detector with
  file-level reporting.
- Wave 16 ratchet (2026-05-17) migrated remaining local status tone maps to
  `StatusBadge` domain mappings (`request` + `job`) and promoted
  `status-semantic-mapping-drift` to error after advisory backlog reached zero.
- Current advisory backlog is warn-tier and intentionally non-blocking:
  none.

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
| Hand-rolled badge-like spans | error | Inline rounded status/category/count pills — use `<Badge>` or `<StatusBadge>` |
| Static styleguide raw controls/specimens | manual review | Static examples may intentionally show raw HTML; label bad examples clearly |
| `flex items-center gap-*` without layout primitive | manual review | Inline flex layouts — use `<Row>`, `<Stack>`, `<Column>` when the abstraction adds value |

`scripts/report-style-drift.ts` includes advisory counts for raw form controls,
client purple, static styleguide debt, and badge-like spans. Raw visible form
controls and static styleguide note/radius debt are now also enforced by
`pr-check` after the May 2026 ratchet sweep drove both counts to zero. Badge-like
spans are now enforced as error after the Wave 8 client sweep removed the final
violations and fixture coverage was added.

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

`src/index.css` token declaration gap is now mechanized via
`src-index-css-no-token-declarations` (error tier). `verify-styleguide-parity.ts`
remains as an additional parity gate.

Route-level cleanliness heuristics for duplicate headings, nested `SectionCard`
density, and blue-styled action controls are now enforced as `error` in
`pr-check`, with `report-style-drift.ts` retaining file-level breakdowns for
monitoring and cleanup targeting.

### Outstanding hatches to migrate

The `// pr-check-disable-next-line` comment form predates per-rule hatches. When any
existing site using that form is touched in Phase 2 or 3, migrate it to the per-rule
form (`// <rule-name>-ok`) in the same commit.
