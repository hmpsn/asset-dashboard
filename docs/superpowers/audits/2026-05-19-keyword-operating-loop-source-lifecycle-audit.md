# Keyword Operating Loop Source + Lifecycle Audit

Date: `2026-05-19`  
Owner: `analytics-intelligence`  
Secondary integrations: `seo-health`, `keyword-strategy`, `content-pipeline`, `client-signals`, `outcomes-roi`

## Goal

Ground the next keyword intelligence work in repo truth before changing production behavior.
This audit traces how keywords enter the platform, where they are normalized or mutated,
which product surfaces consume them, and what should update after a strategy refresh.

This is a read-only audit. It intentionally does not change routes, provider methods,
database schema, ranking behavior, or client payloads.

## Executive Summary

The platform already has the bones of a keyword operating loop:

- strategy generation persists page keywords, strategy history, content gaps, keyword gaps,
  topic clusters, and cannibalization tables
- strategy generation seeds strategy keywords into rank tracking
- strategy updates refresh recommendations, queue llms.txt regeneration, broadcast
  `STRATEGY_UPDATED`, and invalidate intelligence caches
- client/admin keyword feedback flows affect strategy prompts and approved terms can be
  tracked automatically
- workspace intelligence slices expose strategy, page map, rank tracking counts, client
  keyword feedback, content gap votes, and business priorities to AI/recommendation paths

The loop is not yet lifecycle-complete:

- rank tracking is append-only and stores only `query`, `pinned`, and `addedAt`
- strategy refreshes do not reconcile removed, stale, reassigned, or replaced keywords
- tracked keywords do not preserve source, page assignment, strategy version, baseline
  metrics, or lifecycle status
- strategy outcome tracking records one strategy-level action with `targetKeyword: null`,
  not keyword-level actions
- DataForSEO source coverage is useful but narrow, with major discovery endpoints not yet
  exposed through `SeoDataProvider`
- strategy diffs cover keywords, content gaps, and page primary-keyword changes, but do not
  yet include rank-tracking reconciliation or tracked-keyword lifecycle changes

## Current Keyword Sources

| Source | Owner | Current fields available | Current consumers | Gap |
|---|---|---|---|---|
| Google Search Console queries | `server/google.ts`, strategy/recommendation helpers | query, clicks, impressions, CTR, position, page URL | strategy inputs, recommendations, rank snapshots, page intelligence | not normalized into a reusable keyword evidence record |
| `page_keywords` table | `server/page-keywords.ts`, `server/keyword-strategy-persistence.ts` | page path/title, primary keyword, secondary keywords, intent, positions | strategy route, seoContext, pageProfile, briefs, ROI, Page Intelligence | page assignment changes are not carried into tracked keyword metadata |
| `workspace.keywordStrategy` blob | `server/keyword-strategy-persistence.ts` | site keywords, business context, generatedAt, legacy strategy fields | strategy route, llms.txt, recommendations, content/AI contexts | remaining blob fields coexist with table-backed normalized fields |
| Strategy normalized tables | migrations 088-090 plus persistence helpers | keyword gaps, topic clusters, cannibalization issues, content gaps | strategy route, recommendations, intelligence slices | no shared keyword candidate/evidence contract yet |
| DataForSEO provider | `server/providers/dataforseo-provider.ts` | volume, KD, CPC, competition, trend, related/question keywords, ranked keywords, competitors, backlinks | strategy source gathering, recommendations, authority posture | discovery endpoints are missing or underused |
| SEMRush provider | `server/semrush.ts` via `SeoDataProvider` | similar provider metrics depending on configuration | strategy/recommendation provider abstraction | source provenance is provider-local, not preserved into candidate lifecycle |
| Client keyword feedback | `keyword_feedback`, public/admin routes | keyword, status, reason, source, declined_by, timestamps | strategy prompt, recommendations, clientSignals | approved/declined state is consumed, but not represented as keyword lifecycle state |
| Tracked keywords | `server/rank-tracking.ts` | query, pinned, addedAt | rank tracker, public strategy tab, seoContext rank summary | lacks source, page, strategy, status, baseline metrics |
| Content gaps | strategy persistence/route tables | topic/target keyword, opportunity metrics, rationale, SERP features | strategy tab, recommendations, briefs/actions | gap-to-tracked-keyword linkage is implicit |
| Recommendation candidates | `server/keyword-recommendations.ts`, `server/recommendations.ts` | scored keyword, reasons, optional debug reasoning | admin recommendation surfaces | recommendations and strategy do not yet share one candidate engine |
| Client-entered tracked terms | public tracked-keyword routes | keyword text, tracked config entry, activity event | client Strategy tab, rank tracker | public flow prewarms metrics; admin flow does not mirror all side effects |

## DataForSEO Coverage

Current wrapper coverage in `server/providers/dataforseo-provider.ts`:

| Provider method | DataForSEO endpoint | Role | Notes |
|---|---|---|---|
| `getKeywordMetrics()` | `keywords_data/google_ads/search_volume/live` + `dataforseo_labs/google/keyword_difficulty/live` | metrics enrichment | batch-cached and credit tracked |
| `getRelatedKeywords()` | `dataforseo_labs/google/related_keywords/live` | seed expansion | useful, but anchored to an existing seed |
| `getQuestionKeywords()` | `dataforseo_labs/google/keyword_suggestions/live` | question discovery | currently filters suggestions to question patterns only |
| `getDomainKeywords()` | `dataforseo_labs/google/ranked_keywords/live` | domain/page evidence | main source for existing organic footprint |
| `getUrlKeywords()` | `dataforseo_labs/google/ranked_keywords/live` | URL evidence | page-level ranked terms |
| `getDomainOverview()` | `dataforseo_labs/google/ranked_keywords/live` limit 1 | domain evidence | reads aggregate metrics from ranked keyword response |
| `getCompetitors()` | `dataforseo_labs/google/competitors_domain/live` | competitor discovery | used before keyword-gap synthesis |
| `getKeywordGap()` | synthesized from `ranked_keywords` | competitor/gap evidence | no dedicated DataForSEO intersection endpoint yet |
| `getBacklinksOverview()` | `backlinks/summary/live` | authority enrichment | optional, subscription-aware |
| `getReferringDomains()` | `backlinks/referring_domains/live` | authority enrichment | optional, subscription-aware |

Official DataForSEO docs reviewed:

- `keyword_ideas/live`: https://docs.dataforseo.com/v3/dataforseo_labs-google-keyword_ideas-live/
- `keywords_for_site/live`: https://docs.dataforseo.com/v3/dataforseo_labs-google-keywords_for_site-live/
- `keyword_suggestions/live`: https://docs.dataforseo.com/v3/dataforseo_labs-google-keyword_suggestions-live/
- `ranked_keywords/live`: https://docs.dataforseo.com/v3/dataforseo_labs-google-ranked_keywords-live/
- Google Ads `keywords_for_keywords/live`: https://docs.dataforseo.com/v3/keywords_data-google_ads-keywords_for_keywords-live/
- `domain_intersection/live`: https://docs.dataforseo.com/v3/dataforseo_labs-google-domain_intersection-live/
- `page_intersection/live`: https://docs.dataforseo.com/v3/dataforseo_labs-google-page_intersection-live/
- `keyword_overview/live`: https://docs.dataforseo.com/v3/dataforseo_labs-google-keyword_overview-live/

Recommended endpoint classification for PR10:

| Candidate endpoint | Primary role | Why it matters | Suggested posture |
|---|---|---|---|
| `keyword_ideas/live` | candidate discovery | expands from multiple seed terms, helpful when current rankings are thin | add as opt-in provider capability with strict seed/result caps |
| `keywords_for_site/live` | page/domain discovery | can discover site-relevant ideas beyond existing ranked keywords | add for cold-start and low-footprint workspaces |
| non-question `keyword_suggestions/live` | long-tail discovery | current wrapper discards non-question suggestions | expose as a separate general suggestion method |
| Google Ads `keywords_for_keywords/live` | alternative seed expansion | gives planner-style ideas and may complement Labs data | evaluate cost/quality in PR10 before default use |
| `domain_intersection/live` | competitor/gap evidence | provider-native competitor overlap/gap comparison | consider after normalized candidate contracts exist |
| `page_intersection/live` | page-level competitor/gap evidence | useful for page assignment and cannibalization decisions | consider for strategy/page-map refinement |
| `keyword_overview/live` | SERP/intent/metrics enrichment | richer per-keyword evidence for explanation/debug | add only if it improves explanation quality enough to justify cost |

## Strategy Refresh Propagation

Current successful generation path:

1. `server/keyword-strategy-generation.ts` builds provider/GSC/page data and AI synthesis inputs.
2. `persistKeywordStrategy()` writes strategy state:
   - snapshots previous strategy into `strategy_history`
   - writes `page_keywords`
   - replaces table-backed content gaps, keyword gaps, topic clusters, and cannibalization
   - updates `workspace.keywordStrategy`
   - records `strategy_generated` activity
   - records one `strategy_keyword_added` outcome action when no strategy source action exists
   - broadcasts `WS_EVENTS.STRATEGY_UPDATED`
   - invalidates workspace intelligence and relevant subcache prefixes
3. `seedKeywordStrategyTrackedKeywords()` adds `siteKeywords` and page primary keywords through `addTrackedKeyword()`.
4. `queueKeywordStrategyPostUpdateFollowOns()` queues llms.txt regeneration and a recommendation refresh.

Main propagation gaps:

- seeding uses `addTrackedKeyword()` only; it does not update metadata for retained keywords
- removed strategy-owned keywords remain tracked with no stale/deprecated state
- reassigned page keywords do not update tracked keyword ownership
- manual/pinned/client-entered keywords are preserved accidentally by append-only behavior, not by an explicit lifecycle rule
- no rank-tracking broadcast is emitted by the admin rank-tracking route after add/remove/pin mutations
- public tracked-keyword routes broadcast `STRATEGY_UPDATED`, add activity, and prewarm provider metrics; admin rank-tracking routes do not mirror those richer side effects

## Strategy History + Diff

Current diff route: `/api/webflow/keyword-strategy/:workspaceId/diff`

The route compares current strategy state with the latest `strategy_history` row and reports:

- `newKeywords`
- `lostKeywords`
- `newGaps`
- `resolvedGaps`
- `keywordChanges` for page primary-keyword changes

This is a good foundation for the future "what changed?" UX, but PR11/PR13 should extend
or complement it with rank-tracking lifecycle changes:

- added tracked keywords
- retained tracked keywords with updated strategy metadata
- reassigned keywords
- deprecated/replaced strategy-owned keywords
- manually preserved keywords
- skipped/suppressed keywords with reasons

## Outcome Tracking Loop

Current strategy persistence records one outcome action:

- `actionType`: `strategy_keyword_added`
- `sourceType`: `strategy`
- `sourceId`: workspace id
- `targetKeyword`: `null`

This gives outcome learning a strategy-level hook, but it cannot yet attribute learning to
individual keywords, page assignments, or strategy refresh decisions. PR11 should decide
whether to add keyword-level outcome actions for selected strategy terms or a lower-noise
aggregated change-set action that includes keyword-level metadata.

Recommended default: start with a strategy refresh change-set action or metadata payload,
then add per-keyword actions only for high-intent terms that become tracked, approved,
or content-actioned.

## Client Feedback Loop

Client and admin feedback paths already matter:

- requested/approved/declined keywords are read into strategy synthesis
- declined keywords are filtered from the keyword pool
- approved keywords are added to rank tracking
- client business priorities and content gap votes feed clientSignals and strategy prompt context
- public feedback routes broadcast `STRATEGY_UPDATED` and add activity

Remaining work:

- represent feedback status as part of keyword lifecycle, not just prompt context
- preserve why a requested keyword was accepted, deferred, or rejected
- ensure declined keywords suppress both strategy and recommendation paths through the future shared engine
- distinguish client-requested tracked keywords from strategy-generated tracked keywords

## Events, Query Invalidation, And Cache Lifecycle

Server state:

- strategy writes broadcast `WS_EVENTS.STRATEGY_UPDATED`
- workspace intelligence invalidation broadcasts `WS_EVENTS.INTELLIGENCE_CACHE_UPDATED`
- public feedback/tracked-keyword routes broadcast strategy updates
- public tracked-keyword add prewarms provider metrics in the background

Client state:

- `ClientDashboard` handles `STRATEGY_UPDATED` by refetching client strategy and page keywords
- shared invalidation hooks cover broad platform events, including intelligence and outcome events
- recommendations update through their own event path after recommendation refreshes

Gaps to close later:

- admin rank-tracking route mutations should broadcast and log activity consistently
- rank-tracking query keys should be invalidated when strategy-owned tracking changes
- recommendation refresh and strategy refresh should expose enough metadata for UI change summaries

## Source-To-Surface Matrix

| Keyword lifecycle point | Where it starts | Where it should appear | Current update behavior | Next PR target |
|---|---|---|---|---|
| Existing ranked keyword | DataForSEO/SEMRush ranked keywords, GSC queries | strategy pool, page map, recommendations, Page Intelligence | enters strategy/recs through local source gathering | PR10 normalize source evidence |
| New idea keyword | related/question keywords today; `keyword_ideas`/`keywords_for_site` later | strategy pool, content gaps, recommendations | weak for sparse workspaces | PR10 source expansion |
| Strategy site keyword | AI synthesis output | strategy tab, tracked keywords, llms.txt, recommendations | appended to rank tracking | PR11 reconciliation metadata |
| Page primary keyword | page map / `page_keywords` | Page Intelligence, content briefs, rank tracking, seoContext | table-backed and seeded into tracking | PR11 page assignment tracking |
| Client-requested keyword | public/admin feedback | strategy prompt, clientSignals, tracked keywords if approved | prompt-aware; lifecycle-thin | PR11 lifecycle state, PR12 shared constraints |
| Declined keyword | feedback routes | strategy/recommendation suppression | consumed in strategy and recommendations separately | PR12 shared suppression |
| Content gap keyword | strategy content gaps table | Strategy tab, recommendations, brief CTAs | visible, but tracking/action linkage implicit | PR13 action handoff |
| Recommendation keyword | `keyword-recommendations.ts` / recommendations | admin recommendation cards, optional reasoning | improved in PR3, still separate from strategy engine | PR12 shared engine |
| Deprecated/replaced keyword | strategy refresh diff in future | rank tracker, Strategy tab change summary | not represented today | PR11 reconciliation |

## Read-Only Lifecycle Trace: Rich Workspace Profile

Representative profile: `tests/fixtures/rich-intelligence.ts` (`ws-rich`)

Trace keyword: `enterprise seo`

1. Source discovery:
   - appears in `seoContext.strategy.siteKeywords`
   - appears as `/features` primary keyword
   - has page-level position movement and backlink/rank context in the rich intelligence fixture
   - clientSignals include approved related terms such as `enterprise seo`
2. Strategy assignment:
   - page map assigns `enterprise seo` to `/features`
   - strategy history records generatedAt and revisions count
3. Rank tracking:
   - rich fixture reports aggregate rank tracking state, but the tracked keyword model would only store query/pinned/addedAt if seeded
4. Recommendation/content action:
   - pageProfile can feed briefs, recommendations, and Page Intelligence with primary keyword and opportunities
5. Client/admin surface:
   - Strategy tab can show strategy rows and feedback state
   - client dashboard refetches strategy/page keywords on `STRATEGY_UPDATED`
6. Intelligence context:
   - `seoContext`, `pageProfile`, `clientSignals`, and `learnings` can all carry supporting context

Observed gap:

- the keyword can be visible in many places, but no single lifecycle record can answer:
  "why is this tracked, what strategy version chose it, which page owns it, and what changed
  after the latest refresh?"

## Read-Only Lifecycle Trace: Sparse Workspace Profile

Representative profile: cold-start/minimal intelligence cases in `tests/format-for-prompt.test.ts`

Trace keyword: a client-entered service keyword with no existing ranking data

1. Source discovery:
   - may enter through client tracked-keyword add, requested keyword feedback, or manual/admin input
   - existing DataForSEO ranked-keyword sources may return little or nothing for a low-footprint site
2. Strategy assignment:
   - strategy generation can use client requests and business context, but source expansion is limited when domain rankings are thin
3. Rank tracking:
   - public tracked-keyword add stores the keyword and prewarms provider metrics
   - admin rank-tracking add stores the keyword but lacks equivalent broadcast/activity/provider prewarm behavior
4. Recommendation/content action:
   - recommendations can score the term if present in input/context, but source evidence may be thin
5. Client/admin surface:
   - keyword can appear tracked before rank snapshots have meaningful history
6. Intelligence context:
   - cold-start formatting handles missing data safely, but does not explain source weakness or next best provider source

Observed gap:

- sparse workspaces need DataForSEO discovery endpoints such as `keyword_ideas` and
  `keywords_for_site` so strategy generation does not depend mainly on existing rankings.

## PR Boundaries

PR10 - Keyword source data expansion:

- add provider capabilities for selected DataForSEO discovery endpoints
- normalize provider/GSC/client/strategy candidate evidence
- preserve source provenance and cost/cache posture
- do not rewrite strategy scoring yet

PR11 - Strategy refresh propagation and rank-tracking reconciliation:

- introduce a strategy-aware tracking reconciliation service
- preserve manual/pinned/client-requested keywords
- mark removed strategy-owned keywords as deprecated/replaced instead of silently leaving them unclassified
- emit broadcasts/activity/change sets for tracking lifecycle changes

PR12 - Shared keyword intelligence engine:

- centralize duplicate suppression, declined-keyword suppression, business fit, client feedback,
  authority posture, page-map conflicts, cannibalization negatives, and explanation records
- migrate keyword recommendations first, then strategy pool/filtering behavior

PR13 - Strategy quality and UX loop:

- expose "what changed", "why this keyword", "what we are tracking", and "what action comes next"
- connect selected keywords to brief/action/recommendation CTAs without auto-publishing

## Acceptance Check

- Every important keyword source, consumer, mutation path, and lifecycle handoff has an owner named above.
- Current DataForSEO endpoint usage is mapped to provider methods, and missing discovery/intersection endpoints are classified for PR10.
- Strategy regeneration follow-ons are documented, including rank-tracking seeding, recommendation refresh, llms.txt regeneration, broadcasts, and cache invalidation.
- Strategy history/diff, rank tracking, client feedback, outcomes, broadcasts, intelligence cache, and content/action handoff are explicitly covered.
- The next PRs are decision-ready and scoped separately.
