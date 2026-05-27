# E-E-A-T Asset Library Contracts

## Purpose

The workspace E-E-A-T asset library is the canonical source of trust-proof inventory used by:
- content brief personalization,
- Page Intelligence trust-gap detection,
- schema author/credential enrichment.

## Data model

- Source table: `eeat_assets`
- Owner module: `server/eeat-assets.ts`
- Shared contracts: `shared/types/eeat-assets.ts`
- Supported asset types: testimonial, case_study, credential, before_after_gallery, team_bio, award, research, client_logo.

## Trust-gap evaluation

- Canonical evaluator: `server/eeat-trust-signals.ts`
- Do not duplicate page-type trust rules in routes, jobs, or components.
- All per-page trust-gap and recommendation derivation must call `evaluatePageTrustSignals(...)`.
- Current persisted outputs on `page_keywords`:
  - `missing_trust_signals`
  - `eeat_asset_recommendations`

## Intelligence wiring

- Intelligence slice: `eeatAssets`
- Slice assembler: `server/intelligence/eeat-assets-slice.ts`
- Prompt rendering: `server/intelligence/formatters.ts` (`## E-E-A-T Assets` section)
- AI consumers should prefer builder-backed prompt context over ad hoc asset reads.

## Schema usage

- Schema context may carry workspace E-E-A-T assets via `SchemaContext._eeatAssets`.
- Schema extraction (`server/schema/data-sources.ts`) may use this inventory for author identity/credential enrichment.
- Do not add direct route-level schema template mutations based on raw workspace JSON when the same data is available through schema intelligence/context.

## Mutation and freshness

- E-E-A-T asset create/update/delete routes must:
  - log activity,
  - invalidate workspace intelligence cache,
  - broadcast `WS_EVENTS.EEAT_ASSETS_UPDATED`.
- Frontend listeners must invalidate at least:
  - `queryKeys.admin.eeatAssets(workspaceId)`
  - `queryKeys.admin.intelligenceAll(workspaceId)`
  - `queryKeys.admin.keywordStrategy(workspaceId)`
