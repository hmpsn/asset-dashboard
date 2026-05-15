# Feature Flag Lifecycle Management

Every flag in `shared/types/feature-flags.ts` must include lifecycle metadata in `FEATURE_FLAG_CATALOG`.

Required lifecycle fields:
- `owner`
- `createdAt` (`YYYY-MM-DD`)
- `rolloutTarget`
- `removalCondition`
- `linkedRoadmapItemId`
- `staleAuditCadence`
- `lastReviewedAt`

## Source-of-truth contract

`shared/types/feature-flags.ts` is the only source of truth for:
- default values (`FEATURE_FLAGS`)
- labels + grouping (`FEATURE_FLAG_CATALOG`, `FEATURE_FLAG_GROUPS`)
- lifecycle metadata (`FEATURE_FLAG_CATALOG[key].lifecycle`)

Do not duplicate labels/groups/lifecycle metadata in component-local constants.

## Admin/API contract

`GET /api/admin/feature-flags` must return each flag with:
- value source metadata (`db`/`env`/`default`)
- catalog metadata (`label`, `group`)
- lifecycle metadata (`lifecycle`)

This keeps rollout and cleanup context visible where operators actually flip flags.

## Audit cadence

Run:

```bash
npm run verify:feature-flags
npm run verify:feature-flags -- --json
npm run verify:feature-flags -- --as-of 2026-05-15
```

The audit script validates:
- lifecycle metadata date integrity
- linked roadmap references (real roadmap item id or explicit `legacy-*` reference)
- review-due/stale-candidate queue based on cadence + last review date

Exit behavior:
- **fails** when lifecycle contract gaps exist (invalid dates, broken roadmap link)
- **passes with advisory output** when review-due flags are present
