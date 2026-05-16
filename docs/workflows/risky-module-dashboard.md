---
description: Risk-based module ranking report for platform-health refactor prioritization
---

# Risky Module Health Dashboard

Wave 6 item: `platform-confidence-risky-module-dashboard`

## Goal

Rank modules by practical shipping risk so refactor effort lands where it most reduces regressions.

## Commands

- Markdown dashboard:

```bash
npm run verify:risky-modules -- --top 30 --since-days 180
```

- JSON artifact (for checkpoints/automation):

```bash
npm run report:risky-modules
```

## Scoring Inputs

Each module score combines:

- line count (oversized-module signal)
- git churn (recent touch frequency)
- import graph fan-in/fan-out
- TODO/FIXME/HACK and `*-ok` hatch density
- test linkage presence
- route write handlers without nearby integration tests
- pr-check warning concentration

## Usage Pattern

1. Run the dashboard at the start of a platform-health checkpoint.
2. Pick 1-3 highest-risk modules where cleanup has clear user-impact or regression-risk reduction.
3. Link chosen modules in the roadmap item notes and in PR summary.
4. Re-run after merge to confirm risk score and risk-signal counts trend downward.

## Interpretation Notes

- This report is advisory and intentionally heuristic.
- A high score does not prove bad code; it signals concentration of change risk.
- Use architectural context and live incident history to decide final prioritization.
