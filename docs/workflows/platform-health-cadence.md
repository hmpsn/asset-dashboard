---
description: Recurring platform-health checkpoint cadence every 4-6 product sprints
---

# Platform Health Cadence

Wave 5 item: `platform-org-recurring-health-sprint`

## Goal

Run a measurable platform-health checkpoint every **4-6 product sprints** so platform quality improves on a predictable rhythm instead of opportunistic cleanups.

## Cadence Contract

- Source of truth: `data/platform-health-cadence.json`
- Verification command: `npm run verify:platform-health-cadence`
- Cadence window:
  - opens at sprint 4 from last checkpoint
  - closes at sprint 6 from last checkpoint

## Required Measurable Dimensions

Every checkpoint must record these six dimensions:

- `oversizedModules`: before/after count
- `ownershipGaps`: before/after count
- `docsUpdated`: count
- `contractTestsAdded`: count
- `duplicationFixes`: count
- `prCheckWarningsClosed`: count

## Checkpoint Entry Requirements

Each checkpoint in `data/platform-health-cadence.json` must include:

- `id`, `label`, `completedAt`, `owner`
- `roadmapSprintId` + linked `roadmapItemIds`
- metric payload for all six dimensions
- `evidencePaths` to code/docs/tests proving the checkpoint work

## Execution Flow

1. Run `npm run verify:platform-health-cadence`.
2. If due window is open (or overdue), scope the checkpoint with 1-3 high-impact platform-health items.
3. Ship the items as normal PRs to `staging`.
4. Add/update checkpoint metrics and evidence in `data/platform-health-cadence.json`.
5. Re-run `npm run verify:platform-health-cadence` and include the output summary in PR notes.

## Escalation Rules

- If `overdue: yes`, open/priority-tag a platform-health roadmap item in the current sprint.
- If `oversizedModulesAfter > oversizedModulesBefore` or `ownershipGapsAfter > ownershipGapsBefore`, do not close the checkpoint without explicit owner sign-off and corrective follow-up items.

