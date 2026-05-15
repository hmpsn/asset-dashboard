---
description: Practical release-safety layer for staged shipping, smoke checks, rollback readiness, and post-release monitoring.
---

# Release Safety

Use this workflow when a PR is preparing to merge into `staging` and again before `staging` merges into `main`.

## 1. Generate release notes from roadmap items

The release-safety report pulls shipped roadmap notes into a deploy summary and prints the operational checklist in one place.

```bash
npm run verify:release-safety -- --days 14
npm run verify:release-safety -- --since 2026-05-01 --until 2026-05-15
npm run verify:release-safety -- --sprint sprint-platform-health-wave4-runtime-operability
npm run report:release-safety -- --json
```

What this gives you:
- Deploy notes derived from `data/roadmap.json` shipped items
- Feature-class release checklist
- Staging smoke suite checklist
- Rollback checklist
- Feature-flag rollout checklist
- Post-release monitoring checklist

## 2. Feature-class release checklist

Before merge, confirm the applicable classes in:
- `docs/workflows/feature-class-definition-of-done.md`
- `docs/workflows/pr-readiness-checklist.md`

Minimum validation commands:

```bash
npm run typecheck
npx vite build
npx vitest run
npx tsx scripts/pr-check.ts
```

## 3. Staging smoke suite

Run these after merge to `staging` and before any `staging` → `main` release:

```bash
curl https://<STAGING_URL>/api/health
npx tsx scripts/verify-platform.ts --quick
npx tsx scripts/platform-domain-smoke-matrix.ts
```

Manual smoke expectations:
- One critical admin path touched by the release works end-to-end.
- One critical client/public path touched by the release works end-to-end.
- For integration-heavy work: verify Integration Health and Observability surfaces on at least one real workspace.

## 4. Rollback readiness checklist

Before production merge, confirm:
- Rollback trigger conditions are explicit (error budget, user-impact threshold, data integrity signal).
- Revert path is known (revert PR in `staging`, then promote if needed).
- Migration safety constraints are documented.
- Provider failure behavior is safe (no phantom success).
- Owner and communication path are assigned for rollback execution.

## 5. Feature-flag rollout checklist

If flags are involved:
- Enumerate touched flags in `shared/types/feature-flags.ts`.
- Define staged enablement criteria for staging and production.
- Confirm kill-switch path (disable without redeploy where possible).
- Document removal condition to prevent stale flags.
- Validate safe behavior with flag disabled.

## 6. Post-release monitoring window

Monitor the first 30-60 minutes after production release:

```bash
npm run verify:observability -- --workspace <workspaceId> --days 1
npm run verify:data-integrity
```

Watch for:
- error spikes
- integration/provider failure rates
- stuck or failing background jobs
- regressions in critical admin/client flows

Log follow-up actions immediately and link them to the release PR.
