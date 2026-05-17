# Styleguide Rule Registry

This file is the human-readable source of truth for styleguide parity ratchet work.
The machine-readable companion is `data/styleguide-rule-registry.json`.

## Purpose

1. Track every style parity directive in one canonical registry.
2. Classify each directive as `error`, `warn`, or `manual`.
3. Record detector confidence and required fixtures before promotion.
4. Keep ownership and migration status explicit across waves.

## Registry Fields

- `id`: stable rule identifier used in plans and PRs.
- `sourceAnchor`: where the directive originates.
- `intent`: short contract summary.
- `scope`: code area covered.
- `detectability`: `deterministic | heuristic | manual`.
- `enforcementLevel`: `error | warn | manual`.
- `hatch`: allowed escape hatch comment if applicable.
- `fixtureRequirement`: required tests/evidence before promotion.
- `metricKey`: report metric name to track drift.
- `owner`: owning domain(s).
- `status`: `enforced | advisory | planned | manual-review`.

## Tier Policy

- `error`: deterministic rules with low false-positive risk and fixture coverage.
- `warn`: useful automated signal but not yet promotion-safe.
- `manual`: visual/editorial checks requiring reviewer judgment.

## Current Snapshot (2026-05-18)

- `error`: 19
- `warn`: 1
- `manual`: 3

## Promotion Contract

Before promoting any `warn` to `error`:

1. Advisory count reaches sustained zero on `staging`.
2. `tests/pr-check.test.ts` includes pass/fail fixtures for the rule.
3. `docs/rules/automated-rules.md` regenerated in same PR.
4. `docs/rules/verified-clean-rules.md` updated in same PR.
5. `data/style-drift-baseline.json` updated only after reviewed clean sweep.
