# PR12 Keyword Intelligence Consumer + Cache Contract

Date: `2026-05-20`
Owner: `analytics-intelligence`
Scope: PR12 shared keyword-intelligence engine

## Purpose

PR12 introduces a shared keyword-judgment substrate used by keyword recommendations and keyword strategy generation. This contract exists so the implementation starts from the full keyword operating loop instead of only the obvious strategy/recommendation files.

PR11 taught us that keyword state is consumed by many surfaces. PR12 must therefore lock consumers, stale-data risks, and review gates before broadening shared scoring/filter rules.

## Shared Engine Boundary

The shared engine may own deterministic keyword judgment rules:

- keyword normalization
- exact and near-duplicate matching
- declined keyword suppression
- requested/approved keyword boosts and preservation
- business-fit and business-mismatch posture
- low-actionability/noise suppression
- page-map conflict detection
- source-evidence confidence posture
- authority mismatch posture when authority data is available
- typed reasons/explanations for selected, down-ranked, and suppressed terms

The shared engine must not own product orchestration:

- keyword strategy remains a long-running strategy-generation workflow
- keyword recommendations remain a faster recommendation/reranking workflow
- no client UI or publishing side effect is triggered directly by keyword-intelligence rules
- provider-specific DataForSEO/SEMRush payloads stay behind provider/source collection modules

## Current Consumers To Keep In Sync

| Consumer | Current role | PR12 stale/drift risk | Required posture |
|---|---|---|---|
| `server/keyword-recommendations.ts` | Recommends candidate keywords for content matrix cells | Rules diverge from strategy filtering | Migrate deterministic candidate evaluation onto shared engine first |
| `server/keyword-strategy-ai-synthesis.ts` | Builds strategy keyword pool and prompts AI page assignment | Noisy provider candidates can enter the pool and get promoted | Apply shared candidate eligibility before prompt exposure |
| `server/keyword-strategy-generation.ts` | Orchestrates strategy generation and follow-ons | Strategy behavior drift without explicit tests | Keep orchestration separate; only consume shared guardrails |
| `server/keyword-strategy-persistence.ts` | Persists page keywords, strategy tables, history | Stored output could imply rejected terms are valid | Do not persist suppressed candidates as strategy-selected terms |
| `server/keyword-strategy-follow-ons.ts` | Reconciles rank tracking and refreshes downstream jobs | Rank tracking can faithfully propagate bad choices | PR12 should improve selection before PR11 propagation carries it onward |
| `server/routes/content-matrices.ts` | Recommendation API surface | Response shape drift | Keep optional reasoning/backward-compatible response shape |
| `src/components/KeywordStrategy.tsx` | Admin strategy display | Could show new scoring decisions without explanation | No required UI changes in PR12; explanations can remain admin/debug data |
| `src/components/RankTracker.tsx` | Tracks selected keywords after strategy refresh | Bad strategy candidates become tracked if selected | Suppress obvious noise before strategy persistence/reconciliation |
| `src/components/page-intelligence/*` | Shows tracking badges and page keyword state | Page assignment drift affects perceived analysis freshness | Keep page-map conflict rules typed and tested |
| `src/components/client/StrategyTab.tsx` | Client-safe strategy surface and feedback | Client could see noisy/non-business-fit terms | No new client payload required; prevent obvious noise upstream |
| `server/admin-chat-context.ts` and intelligence slices | AI/admin context consumers | Stale or noisy keyword state pollutes future AI answers | Preserve deterministic fallback and typed reasons for future explainability |
| Feedback routes (`server/routes/public-portal.ts`, `server/routes/keyword-strategy.ts`) | Requested/approved/declined keyword inputs | Feedback handled differently between recommendations and strategy | Shared engine must consume the same declined/requested/approved constraints |

## Cache + Broadcast Expectations

PR12 should not introduce new mutation events by itself unless it adds a new write path. Existing writes still flow through:

- strategy persistence broadcasts `WS_EVENTS.STRATEGY_UPDATED`
- PR11 rank reconciliation broadcasts `WS_EVENTS.RANK_TRACKING_UPDATED`
- recommendation refreshes use the existing recommendation update path
- intelligence cache invalidation remains owned by strategy/recommendation follow-ons

Review checklist for every PR12 code path:

- If a new write is added, it must broadcast and log activity according to existing data-flow rules.
- If only deterministic filtering/scoring changes, no new broadcast is required, but tests must prove the changed output is intentional.
- If a route response gains explanation/debug fields, the fields must be optional and shared/server-local as appropriate.
- If keyword strategy output changes intentionally, add a named fixture explaining the rule that caused the change.

## Required Fixtures

Observed staging noise that must become regression coverage:

- `paper tiger`
- `typing tiger`

For hmpsn studio-like business context, these should be rejected or heavily down-ranked with a typed reason such as `noise_pattern`, `business_mismatch`, or `low_actionability`. They should not be treated merely as duplicates because the problem is weak business fit despite lexical/provider evidence.

## Test Split

Correctness tests are hard gates:

- declined keyword suppression
- requested/approved keyword preservation
- exact and near-duplicate handling
- page-map conflict detection
- deterministic fallback without AI/provider/context
- source-evidence preservation
- authority unknown vs available authority posture

Quality tests are posture/relative-outcome gates:

- noisy adjacent terms are suppressed or down-ranked
- high-volume generic terms lose to better business-fit terms
- provider/discovery terms require enough relevance before strategy prompt exposure
- strategy and recommendation paths agree on equivalent candidate sets
