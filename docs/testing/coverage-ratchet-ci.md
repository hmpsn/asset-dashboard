# Coverage Ratchet + CI Guardrails

This document defines the Wave 2b coverage ratchet operating model.

Source of truth: `scripts/report-coverage-ratchet.ts`

Run:

```bash
npm run test:coverage
npm run verify:coverage-ratchet
npm run verify:coverage-ratchet -- --json
npx vitest run tests/unit/coverage-ratchet-report.test.ts
```

## Intent

1. Block meaningful **global coverage regression**.
2. Keep **critical-domain signal ownership** visible and machine-checked.
3. Stay practical while coverage climbs toward long-term targets.

This is not a sudden jump to 80-90% global coverage. It is a ratchet.

## Enforced Floors

`scripts/report-coverage-ratchet.ts` currently enforces:

- Lines: `52.95%`
- Statements: `50.65%`
- Branches: `42.68%`
- Functions: `43.90%`

These floors are intentionally set `2.00` points below the latest global baseline (`2026-05-25`) and should only move up.

## Domain Signal Guardrails (Advisory)

The ratchet also verifies that every canonical bounded context still has:

- a critical-domain coverage baseline entry, and
- a domain smoke-matrix test command + existing test signal.

Domain guardrail gaps are reported as advisory output so planning can continue without blocking unrelated feature delivery.

## CI Integration

The push coverage job in `.github/workflows/ci.yml` now runs:

1. `npm run test:coverage`
2. `npm run verify:coverage-ratchet`
3. uploads `coverage/coverage-summary.json` + `coverage/lcov.info` as artifacts

Any floor regression fails the coverage job.

## Ratchet Maintenance

When coverage improves and remains stable for multiple merges:

1. raise the floor values in `COVERAGE_RATCHET_FLOORS`,
2. run `npm run test:coverage`,
3. run `npm run verify:coverage-ratchet`,
4. update this document if thresholds changed.
