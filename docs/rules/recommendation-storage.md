# Recommendation Storage

`recommendation_sets` owns per-workspace set metadata: `generated_at`, `summary`,
and a legacy `recommendations` JSON fallback. `recommendation_items` owns the
authoritative per-recommendation rows once rows exist for a workspace.

Domain owners:

- `server/domains/recommendations/storage.ts` owns normalized set/item persistence.
- `server/domains/recommendations/resolution-service.ts` owns in-place recommendation
  completion after SEO/content/work-order writes.
- `server/recommendations.ts` remains the compatibility facade plus generation
  orchestrator; new storage or resolution consumers should import the leaf modules.

Rules:

- Read recommendations through `loadRecommendations(workspaceId)`, not direct SQL.
- Write full regenerated sets through `saveRecommendations(set)`.
- Write one-rec lifecycle/status changes through the recommendation service helpers
  so only the target `recommendation_items` row and set summary update.
- Treat `recommendation_sets.recommendations` as fallback/seed data only after
  migration 158. It may be stale after row-level mutations.
- Keep indexed columns in `recommendation_items` in lockstep with `payload`:
  `type`, `priority`, `status`, `source`, `impact`, `impact_score`,
  `client_status`, `lifecycle`, `target_keyword`, `created_at`, and `updated_at`.
- Preserve existing public/admin response shapes by assembling through the service
  layer. Public client-safe projection remains an explicit allow-list.

New repeated/filterable arrays should be modeled as rows. `pr-check` blocks new
migration columns that look like `TEXT ... DEFAULT '[]'` unless the migration line
has `-- json-array-column-ok: <reason>`.
