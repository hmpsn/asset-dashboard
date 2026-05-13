# Critical Domain Coverage Baseline

This is the current Wave 2b test-coverage ownership baseline. It is a planning and review artifact, not a CI gate.

Source of truth: `scripts/report-critical-domain-coverage.ts`

Run:

```bash
npx tsx scripts/report-critical-domain-coverage.ts
npx tsx scripts/report-critical-domain-coverage.ts --json
npx vitest run tests/unit/critical-domain-coverage-report.test.ts
```

The report is advisory. Structural gaps are printed and tested, but the script exits successfully so coverage planning can happen without blocking feature branches.

## Current Global Baseline

Coverage run from 2026-05-13:

| Lines | Statements | Branches | Functions |
| --- | --- | --- | --- |
| 32.31% | 30.66% | 24.64% | 24.30% |

## Practical Targets

The immediate goal is not global 80-90% coverage. The first target is critical-domain confidence:

- Critical backend domains: 70-85% line coverage.
- Auth, billing, tenant boundaries, and state machines: 65-75% branch coverage.
- Client portal and inbox workflows: 60-75% workflow/component coverage on high-value journeys.
- Golden paths: at least one fast smoke signal per bounded context before broad refactors.

## Domain Matrix

Use the report output for the detailed matrix. Each entry records:

- bounded context,
- critical surfaces,
- existing test signals,
- known gaps,
- target coverage posture,
- and recommended next test slices.

## Completion Rule

`platform-test-coverage-domain-baseline` is complete when:

- every canonical bounded context has exactly one baseline entry,
- every entry names critical surfaces, existing test signals, known gaps, target posture, and next test slices,
- `tests/unit/critical-domain-coverage-report.test.ts` passes,
- and the roadmap item is marked done without marking the whole Wave 2b sprint complete.
