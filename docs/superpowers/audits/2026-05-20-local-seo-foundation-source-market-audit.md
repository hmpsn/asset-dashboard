# Local SEO Foundation, Source, And Market Audit

Date: 2026-05-20
Owner: `seo-health`
Secondary integrations: `analytics-intelligence`, `integrations`, `keyword-strategy`, `client-portal`, `content-pipeline`

## Executive Summary

This PR is a read-only PR14 audit before local SEO implementation. The platform is ready to add a local SEO visibility layer, but the safest implementation is a separate, feature-flagged local-pack visibility foundation rather than extending GSC Rank Tracker or running provider-heavy checks inside strategy generation.

Recommended sequence:

1. Finish the pending keyword normalization / route reliability hardening item before PR15, or explicitly include its local-keyword equality contract in PR15.
2. Implement local SEO as a bounded local visibility layer with explicit workspace posture and local markets.
3. Keep Google Business Profile health, Google reviews/reputation, geo-grid tracking, and local SEO recommendations as follow-on roadmap items.

No production behavior changes, routes, migrations, or client payload changes ship in this PR.

## Foundation Bug-Sniff

| Area | Current foundation | Finding | Blocks PR15? |
| --- | --- | --- | --- |
| Declined keyword suppression | `server/keyword-strategy-sanitizer.ts`, `server/strategy-filters.ts`, `server/keyword-intelligence/`, `server/keyword-feedback.ts` | Declined terms are now part of strategy filtering/sanitization and recommendation evaluation. Local SEO should consume the same keyword-intelligence rules rather than creating new local suppression logic. | No |
| Retired strategy-owned tracking | `server/rank-tracking.ts`, `server/rank-tracking-reconciliation.ts`, `server/keyword-command-center.ts` | Active rank reads hide paused/deprecated/replaced keywords by default; Command Center intentionally reads inactive rows for auditability. Local SEO should mirror this split: active visibility by default, historical snapshots preserved. | No |
| Raw provider evidence labels | `server/keyword-strategy-ux.ts`, `server/keyword-command-center.ts` | Competitor gaps and noisy provider terms are labeled as raw provider evidence and capped in Command Center. Local provider evidence must use the same language posture and never present raw local-pack data as selected strategy action. | No |
| Strategy Signals filtering | `server/routes/keyword-strategy.ts`, `server/insight-feedback.ts` | Strategy Signals build a keyword evaluation context from `seoContext` and `clientSignals`, then filter persisted insights through shared keyword-intelligence rules. Fallback returns unfiltered signals if context assembly fails; this is acceptable graceful degradation but should be noted if local signals join prompts later. | No |
| Rank Tracker boundary | `server/rank-tracking.ts`, `server/routes/rank-tracking.ts`, `src/components/RankTracker.tsx` | Rank Tracker is GSC snapshot measurement, not local-pack/maps measurement. It has no market/device/location fields today. Local visibility should not be stuffed into existing rank snapshots. | No |
| Keyword Command Center | `server/keyword-command-center.ts`, `shared/types/keyword-command-center.ts` | The new command center is the correct future surface for keyword lifecycle and can later receive local visibility annotations, but local SEO should not add a second lifecycle manager. | No |
| Page Intelligence | `src/components/PageIntelligence.tsx`, `src/components/page-intelligence/*` | Page Intelligence is page-first and already consumes strategy/page keyword state. Local posture can be added later as page annotation/handoff only. | No |
| Client Strategy | `server/routes/public-portal.ts`, `src/components/client/StrategyTab.tsx`, `shared/types/keyword-strategy-ux.ts` | Client strategy now receives client-safe strategy explanations. Local SEO should stay admin-only until staging data proves match quality and copy clarity. | No |
| Business profile contact data | `shared/types/workspace.ts`, `server/workspaces.ts`, `server/intelligence/seo-context-slice.ts`, `src/components/settings/BusinessProfileTab.tsx` | Verified contact fields are available and already merge into `seoContext.businessProfile`. Business profile currently lacks explicit local/non-local posture and service-area/market objects. | No |
| LocalBusiness schema evidence | `server/schema-suggester.ts`, `server/schema/templates/local-business.ts`, `server/helpers.ts` | Schema generation already treats verified business profile details as authoritative evidence for LocalBusiness output. Local SEO can reuse this as match evidence but must not mutate schema. | No |
| Existing `local_pack` feature evidence | `server/seo-provider-signals.ts`, `server/keyword-strategy-enrichment.ts`, `server/intelligence/seo-context-slice.ts` | Provider SERP feature code `11` maps to `local_pack`, stored on page/content keyword records, and aggregates into `seoContext.serpFeatures.localPack`. This is useful feature evidence, not market-specific visibility. | No |
| Page-level location rule | `server/content-brief.ts`, `server/routes/webflow-seo-rewrite.ts`, `server/routes/webflow-seo-bulk-rewrite.ts`, `server/admin-chat-context.ts` | Existing prompts already warn not to overwrite page-level city/region keywords with generic workspace location. PR15/PR16 should preserve this rule. | No |

## Key Risk Before PR15

The pending `intel-quality-keyword-normalization-route-reliability-hardening` item remains important before local implementation. Local SEO multiplies city, neighborhood, `near me`, punctuation, and service-area variants. If keyword equality is not shared first, local visibility can reintroduce duplicate tracked rows, missed declined-keyword matches, stale strategy terms, and mismatched Command Center joins.

PR14 can merge independently because it is read-only. PR15 should either wait for that hardening PR or include a local-specific equality contract that explicitly uses the shared normalizer.

## Current Local-Relevant Data Sources

| Source | Current owner | Available today | Gap for local SEO |
| --- | --- | --- | --- |
| Workspace business profile contact data | `workspace-platform`, `schema`, `analytics-intelligence` | phone, email, address parts, social profiles, hours, founded date, employee count | no workspace local posture, no service-area list, no market objects, no GBP identity |
| Intelligence profile and business priorities | `analytics-intelligence` | industry, goals, target audience, business priorities | not enough to distinguish local vs non-local without explicit posture |
| Page keywords and content gaps | `keyword-strategy`, `seo-health` | primary/secondary keywords, metrics, GSC queries, `serpFeatures` including `local_pack` | no per-market visibility or local rank source |
| Keyword Command Center | `seo-health` | lifecycle rows, feedback, tracking, raw provider evidence, strategy explanations | no local visibility columns yet |
| Rank Tracker | `seo-health` | GSC query snapshots and latest ranks | no market/device/local-pack measurement; should stay separate |
| Schema LocalBusiness evidence | `schema` | verified business profile details and semantic extraction can support LocalBusiness schema | evidence is for schema generation, not visibility measurement |
| GSC queries | `analytics-intelligence`, `seo-health` | local-intent query text can be detected | GSC is not local-pack/maps visibility and has no market source |
| DataForSEO keyword/organic data | `integrations`, `keyword-strategy` | keyword metrics, ranked keywords, related/suggested/ideas, SERP feature codes | current provider contract has no local-pack/local-finder/maps methods |

## Workspace Local SEO Posture Contract

Posture should be explicit and overrideable:

- `local`: physical-location or service-area business where local pack visibility matters.
- `non_local`: SaaS, national/global, ecommerce, or content-led workspace where local SEO should stay hidden or secondary.
- `hybrid`: both local markets and broader SEO goals matter.
- `unknown`: insufficient data; show setup guidance, not local claims.

Derived suggestions can use:

- workspace business profile address and phone
- LocalBusiness schema eligibility or existing local-business structured data
- location/service pages in paths and titles
- city/state/neighborhood keywords in page map, GSC queries, and strategy terms
- industry/service-area language such as dental, med spa, home services, legal, restaurant, clinic, contractor

Manual admin override should be authoritative.

## Local Market Identity Contract

A v1 local market should include:

- `id`
- `label`
- `city`
- `stateOrRegion`
- `country`
- optional `latitude` / `longitude`
- optional provider `locationCode` or `locationName`
- `source`: `business_profile`, `admin_override`, `inferred`, `unknown`
- `status`: `active`, `inactive`, `needs_review`

Defaults for PR15:

- Seed one primary market from business profile address when city/state/country are present.
- Cap v1 to three active markets.
- Do not infer geo-grid points.
- Treat ambiguous or missing location data as `needs_review`.

## Business Match Confidence Contract

Local result matching should be conservative:

- `verified`: strong provider identity such as exact domain plus name/address/phone, or stable provider `cid` already associated with the workspace.
- `strong_match`: same domain or highly confident name plus address/phone match.
- `possible_match`: name-only, partial address, or uncertain provider result.
- `not_found`: no likely result in the local pack/maps result set.
- `unknown`: provider failed or source data missing.

User-facing copy should default to `possible match` unless evidence is strong. Avoid "verified local rank" until the match confidence supports it.

## DataForSEO Local Capability Audit

Official DataForSEO docs show the relevant local source options:

| Candidate endpoint | Use in this platform | Notes |
| --- | --- | --- |
| Google Organic SERP live advanced | Best PR15 default for detecting whether a keyword triggers `local_pack` and collecting local-pack items from a standard SERP. | Supports location/language/device and `local_pack` item types. Live calls are per request and should run behind background-job/cost caps. |
| Google Local Finder live advanced | Useful for deeper local business result detail when standard SERP local pack is insufficient. | One live task per call; should be used selectively, not as the default for every keyword/market. |
| Google Maps live advanced | Useful for future maps-oriented rank/competitor data and possible geo-grid work. | Default depth can be high and cost can grow quickly by keyword x market x device. Keep out of PR15 unless needed for match confidence. |
| Google Business Data overview | Good source family for future GBP health and business profile intelligence. | Follow-on item; not part of local-pack v1. |
| Google Reviews | Good source for future local reputation/review intelligence. | Charged by review depth; follow-on item, not PR15. |

Provider guardrails for PR15:

- Extend `SeoDataProvider` with optional local methods rather than importing DataForSEO from strategy/UI code.
- Cache by keyword, market, provider endpoint, device, language, and match mode.
- Emit provider telemetry and credit labels specific to local endpoints.
- Background job fan-out only; no local provider fan-out during synchronous strategy generation.
- V1 caps: max three markets and max twenty-five local-intent keywords per refresh.

## Local Intent Selection For PR15

Keyword candidates for local visibility should come from active selected terms, not every raw provider term:

1. Active strategy page keywords and site keywords with local/service intent.
2. Active tracked keywords with local modifiers or mapped service/location pages.
3. GSC queries with local modifiers where they map to existing service/location intent.
4. Content gaps with `suggestedPageType: 'location' | 'service'` or `local_pack` SERP feature evidence.

Exclude by default:

- retired/deprecated/replaced tracked keywords
- declined feedback terms
- raw provider evidence not promoted into the operating loop
- broad SaaS/global terms unless workspace posture is `hybrid` and market is explicit

## Proposed PR15 Read Model

Local visibility snapshots should be stored separately from GSC rank snapshots:

- keyword
- normalized keyword key
- market id and label
- captured at
- provider and source endpoint
- device and language
- local pack present
- business found
- business match confidence
- local rank if applicable
- top competitors or top local results
- evidence URL/check URL if safe to store
- failure or degraded reason when provider data is unavailable

## Proposed PR16 Surface Contract

Admin surfaces:

- Keyword Command Center: local visibility posture chips and market filter.
- Strategy: local evidence for selected local-intent strategy terms.
- Page Intelligence: local posture for mapped service/location pages.
- Rank Tracker: explanatory handoff copy only, preserving GSC measurement boundary.

Client surfaces:

- Keep off by default until staging proves match quality.
- If enabled, use client-safe language: "where we are visible", "what we are watching", "what local action comes next".
- Do not expose provider jargon, raw local result uncertainty, or unverified GBP claims.

## Deferred Roadmap Items

- Google Business Profile health: profile completeness, categories, services, photos, posts, website/call/direction actions if available.
- Google reviews/local reputation: rating, count, velocity, review themes, competitor review gaps, response workflow.
- Geo-grid tracking: coordinate-point maps, radius/market grids, scheduled maps visibility snapshots, cost controls.
- Local SEO recommendations: recommendations that combine local visibility, GBP/reviews, local pages, schema, content, and outcomes.

## Acceptance For PR14

- The local SEO plan is grounded in current keyword, rank, strategy, schema, intelligence, and provider code paths.
- No foundation blocker was found that requires changing production behavior in PR14.
- The pending keyword-normalization/route-hardening item is explicitly called out as the main prerequisite before provider implementation.
- DataForSEO local source options are documented with cost/fan-out cautions.
- Workspace posture, local market identity, and business match confidence contracts are decision-ready for PR15.
