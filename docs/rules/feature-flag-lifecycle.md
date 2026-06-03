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

## Per-workspace resolution

`isFeatureEnabled(flag, workspaceId?)` resolves a flag. The `workspaceId` is
**optional** and **backward-compatible** — omitting it is byte-identical to the
pre-P0 behavior:

Resolution priority (highest → lowest):
1. **Per-workspace DB override** — only consulted when a `workspaceId` is passed
   (`feature_flag_workspace_overrides`, migration 114). Set/clear via
   `setWorkspaceFlagOverride(key, workspaceId, enabled | null)` (pass `null` to remove).
2. **Global DB override** (`feature_flag_overrides`) — set via `setFlagOverride`.
3. **Env var** (`FEATURE_<FLAG>=true`).
4. **Hardcoded default** in `FEATURE_FLAGS`.

When no `workspaceId` is passed, the per-workspace layer is skipped entirely and
resolution is the global chain (steps 2–4) — the hot path is unchanged. This is the
runtime substrate for `rolloutTarget` staged rollout: `rolloutTarget` is static catalog
metadata, and the per-workspace override is the mechanism that actually enables a flag for
one client (canary) before all (e.g. the Opportunity Value scorer / SEO generation-quality
phases). Both override layers are cached in-memory (10s TTL) and invalidated immediately on
write.

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
