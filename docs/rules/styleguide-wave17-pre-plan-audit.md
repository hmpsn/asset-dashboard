# Styleguide Parity Wave 17 Pre-Plan Audit

Date: 2026-05-17

## Objective

Identify remaining styleguide directives and live-surface drift candidates not yet
fully represented by blocking enforcement, then register them with ownership and
promotion path.

## Findings Summary

1. `staging` baseline after Wave 16 cherry-pick is clean for existing drift
   advisories (`verify:style-drift` all zero).
2. Additional parity directives exist that should be tracked as planned
   warn/manual contracts before enforcement rollout.
3. Highest-confidence next detector candidates are infrastructure-oriented:
   report metric parity and raw inline z-index usage.

## Ownership Matrix

| Slice | Primary Paths | Top Findings |
|---|---|---|
| Static styleguide/docs | `public/styleguide.*`, `DESIGN_SYSTEM.md`, `BRAND_DESIGN_LANGUAGE.md` | Focus-ring contract, reduced-motion contract, muted-tier discipline, specimen labeling requirements |
| Client surfaces | `src/components/client/**`, `src/components/ClientDashboard.tsx` | Embedded tab header duplication, local status map stragglers, overflow/wrapping hotspots, ad-hoc badge/status wording |
| Admin/editor/settings/schema | `src/components/{admin,editor,settings,schema,brand}/**` | Local status maps, repeated settings section chrome, dense nested surfaces, token-bypass literals |
| Enforcement plumbing | `scripts/pr-check.ts`, `scripts/report-style-drift.ts`, `tests/pr-check.test.ts` | Registry metric parity gap, missing fixture coverage for select pattern checks, hatch consistency opportunities |

## Candidate Rule Backlog (Registered in Registry)

- Warn (planned):
  - `focus-visible-ring-contract`
  - `reduced-motion-global-contract`
  - `embedded-tab-pageheader-duplication`
  - `muted-text-two-tier-only`
  - `raw-z-index-inline-literal`
  - `report-style-drift-metric-parity`
  - `stat-primitive-bypass-signal`
- Manual (manual-review):
  - `styleguide-specimen-bad-example-labeling`
  - `spacing-rhythm-mix-signal`
  - `chart-semantic-hue-contract`
  - `chart-missing-data-gap-contract`

## Ratchet Order

1. Add/expand fixtures for detector coverage and metric-parity contracts.
2. Ship non-blocking warn detectors for low-noise deterministic contracts.
3. Burn advisory backlog by ownership slice in parallel.
4. Promote zero-hit warn rules to error with docs + baseline sync in same PR.
