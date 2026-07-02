# Recommendation Storage

`recommendation_sets` owns per-workspace set metadata: `generated_at` and
`summary`. `recommendation_items` owns the authoritative per-recommendation
rows — it is the SOLE store after the R7 blob→rows cutover.

The `recommendation_sets.recommendations` JSON column is a retired **archive
placeholder**: `saveRecommendationSet` writes `'[]'` to it and no read path
consults it. `loadRecommendationSet` reads rows only; the legacy blob fallback
is GONE. A workspace with a non-empty archive blob but zero rows now yields an
empty set plus a loud `recommendation-storage` warn (the visible signal that a
would-be data loss was averted, not silently masked). The only remaining
blob→rows path is the idempotent boot-time sweep
`materializeAllRecommendationItems()` (wired in `server/index.ts` before
`runOutcomeRemediation`), which seeds rows from any still-populated legacy blob
until the delayed column-drop migration retires the column entirely.

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
- NEVER read `recommendation_sets.recommendations` at runtime — it is a `'[]'`
  archive placeholder after the R7 cutover, not a fallback. Rows are the sole
  store. (The boot-time backfill sweep is the one exception; it seeds rows FROM
  the blob at startup and is retired at the delayed column drop.)
- Keep indexed columns in `recommendation_items` in lockstep with `payload`:
  `type`, `priority`, `status`, `source`, `impact`, `impact_score`,
  `client_status`, `lifecycle`, `target_keyword`, `created_at`, and `updated_at`.
- Preserve existing public/admin response shapes by assembling through the service
  layer. Public client-safe projection remains an explicit allow-list.

New repeated/filterable arrays should be modeled as rows. `pr-check` blocks new
migration columns that look like `TEXT ... DEFAULT '[]'` unless the migration line
has `-- json-array-column-ok: <reason>`.
