# Design System Enforcement Rules

These rules are mechanized in `scripts/pr-check.ts` and enforced on every PR diff.
All rules are scoped to files changed in the diff (not the full repo) during the Phase 1–3 migration window.

| Rule | Severity | Pattern | Scope |
|------|----------|---------|-------|
| Legacy surface token | warn | `var(--brand-bg-*)` | `*.tsx`, `*.css` |
| Hand-rolled card div | warn | `bg-zinc-9xx + rounded-xl` | `*.tsx` (excl. `ui/`) |
| Page component missing PageHeader | warn | customCheck curated list | page components |
| Hardcoded card radius | warn | `rounded-xl` outside `ui/` | `*.tsx` (excl. `ui/`) |
| radius-signature-lg exclusivity | **error** | `--radius-signature-lg` | all, excl. SectionCard + styleguide |
| Non-standard transition duration | warn | duration not 120/180/400ms | `*.tsx`, `*.css` |

## Migration path

- Phase 1: All rules ship as `warn` (except Rule E which is `error` immediately).
- Phase 3f: Rules A, B, D promoted to `error` once all 47 files are migrated.
- Phase 4+: Rule F promoted to `error` once `--motion-*` tokens land.

## Escape hatch

Add `// pr-check-disable-next-line` above the offending line with a justification comment.
Only use for modals, non-card elements, or intentional design exceptions.
