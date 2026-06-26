# Local SEO Visibility

> Rollout note: the `local-seo-visibility` feature flag has been retired. Local SEO
> behavior described here is now canonical runtime behavior; historical flag references
> elsewhere in this document are archival rollout context only.

Local SEO visibility is a market-specific evidence layer for service-area and physical-location businesses. It complements the keyword operating loop; it does not replace the Keyword Hub, Keyword Strategy, or Page Intelligence.

## Product Boundary

- **Local SEO owns market-specific visibility evidence:** local pack presence, possible business appearance, market identity, local competitors, and local-intent keyword posture.
- **The Keyword Hub owns GSC measurement:** query positions, clicks, impressions, CTR, and snapshots from Search Console stay separate from map/local-pack visibility (surfaced in the Hub's detail drawer since the Rank Tracker fold-in).
- **The Keyword Hub owns lifecycle management:** track, retire, decline, restore, and promote keywords there; local visibility can annotate rows but should not become a second keyword manager.
- **Strategy remains generation/explanation:** local visibility can influence future strategy posture, but strategy generation must not run provider-heavy local checks inline.
- **Schema remains structured data delivery:** LocalBusiness schema can provide verified contact/location evidence, but local SEO should not publish or mutate schema automatically.

## Workspace Posture

Workspace local posture must be explicit and overrideable:

- `local`: physical-location or service-area business where local pack visibility matters.
- `non_local`: SaaS, national, global, ecommerce, or content-led businesses where local SEO is not primary.
- `hybrid`: both local markets and broader/national SEO goals matter.
- `unknown`: insufficient evidence; prompt admin before local visibility claims.

Derived suggestions can use business profile address, local schema, location/service pages, city/state keywords, industry, and service-area language, but manual admin posture is authoritative.

## Market Contract

A local market is not just a keyword modifier. It should resolve to a clear market identity before provider calls:

- label, city, state/region, country
- optional latitude/longitude
- provider location identifier when available
- source: `business_profile`, `admin_override`, `inferred`, or `unknown`

PR15 should keep v1 bounded to a small number of explicit markets and should not infer a broad geo-grid from keyword text alone.

## Evidence And Match Confidence

Local SEO copy must be conservative. Use `possible match` unless evidence supports stronger wording.

Business matching should consider:

- exact domain or same-site URL match
- business name match
- phone or address match from verified business profile/schema evidence
- provider `cid` when available

Never say "verified local rank" unless the source and match confidence support it. Prefer "visible in local results", "business appears in the local pack", or "possible business match".

## Provider And Cost Guardrails

- Local provider calls must run through `SeoDataProvider` or a bounded local SEO provider seam; do not import DataForSEO directly from strategy/recommendation/UI code.
- Local visibility refreshes that fan out across keywords or markets must use the background job platform.
- Cache keys must include keyword, market, endpoint/source, device, and language.
- Provider telemetry and credit labels must identify local endpoints separately from keyword discovery/rank tracking.
- v1 caps should be explicit before launch, e.g. max markets and max keywords per refresh.

## Domain Ownership

- `server/local-seo.ts` is a compatibility facade. Keep public exports there, but do not add new storage, provider, job, or read-model logic to it.
- `server/domains/local-seo/configuration-service.ts` owns settings, markets, target geo resolution, and transactional market updates.
- `server/domains/local-seo/configuration-actions.ts` owns activity/broadcast wrappers around admin configuration mutations.
- `server/domains/local-seo/candidate-pipeline.ts` owns deterministic candidate enumeration and scoring from an already-loaded context.
- `server/domains/local-seo/candidate-service.ts` owns candidate context loading, cheap/evaluated candidate entry points, local-intent selection, and refresh-plan construction.
- `server/domains/local-seo/snapshot-store.ts` owns `local_visibility_snapshots` persistence, snapshot mapping, latest reads, trend reads, and retention pruning.
- `server/domains/local-seo/visibility-read-model.ts` owns competitor/service-gap projections and report caps/summary assembly.
- `server/domains/local-seo/read-service.ts` owns the public/admin local SEO read model assembled from settings, markets, snapshots, and projections.
- `server/domains/local-seo/refresh-runner.ts` owns provider selection, local visibility refresh jobs, chained non-fatal recommendation/strategy regeneration, and location-match backfill jobs.
- `server/domains/local-seo/events.ts` owns `LOCAL_SEO_UPDATED` broadcasts plus intelligence-cache invalidation.

## Intelligence Boundary

If local visibility feeds prompts, recommendations, or strategy scoring, add a `localSeo` intelligence slice rather than direct reads from callers. Missing local visibility should degrade to `local posture unknown`, not fabricated confidence.

## Reporting Surfaces

Local SEO reporting should annotate the existing keyword operating loop instead of creating a second lifecycle manager.

- **Keyword Hub:** primary admin surface for keyword-level local visibility, local evidence posture, and safe actions.
- **Keyword Strategy:** may show market visibility summaries, but must not imply local visibility changes the selected strategy unless a later scoring PR explicitly does that work.
- **Page Intelligence:** may annotate local-intent page keywords with local visibility evidence when stored snapshots exist.
- **Rank Tracker:** should explain that GSC query measurement and local pack visibility are separate evidence layers.
- **Client Portal:** should stay unchanged until admin staging QA proves local data quality and copy clarity.

Reporting copy must distinguish "raw local evidence" from "recommended action". Do not call raw provider evidence a selected strategy action.

## Deferred Work

Google Business Profile health, Google reviews/reputation, geo-grid tracking, and local SEO recommendation automation are separate follow-up roadmap items. Do not fold them into the first local-pack visibility foundation unless a later plan explicitly expands scope.
