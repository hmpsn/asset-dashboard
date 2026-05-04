# Platform Consolidation Audit - 2026-05-04

## Purpose

Find places where rapid product expansion left the platform straddling two implementations, partially migrated to a newer pattern, or carrying large feature modules that should be split before more work lands on top.

This is an audit-only artifact. Roadmap follow-ups live in `data/roadmap.json` under `sprint-platform-consolidation`.

## Highest-priority split implementations

| Area | Evidence | Risk | Recommended direction |
| --- | --- | --- | --- |
| Billing flow | `server/routes/stripe.ts` exposes both `/api/stripe/create-payment-intent` for Stripe Elements and Checkout endpoints. `src/components/StripePaymentForm.tsx` still supports inline PaymentIntent payment while `src/hooks/usePayments.ts`, `src/components/client/SeoCart.tsx`, and `src/components/client/PlansTab.tsx` use Checkout. | Payment behavior, webhook expectations, and test coverage can drift. This is especially risky because `MONETIZATION.md` names Checkout as the intended architecture. | Pick Checkout as the only client purchase path, retire PaymentIntent UI/API/test coverage, and keep any needed test-mode visual QA as a separate follow-up. |
| Client portal data migration | `src/hooks/useClientData.ts` wraps React Query hooks but still owns legacy local state, compatibility setters, no-op setters, and a query-cache subscription bridge for pricing. | The client dashboard has two mental models for data ownership, which makes stale-cache and loading-state bugs harder to reason about. | Replace the compatibility facade with smaller feature hooks and update call sites to consume React Query outputs directly. |
| Deep-link tab contract | `src/components/client/Briefing/InsightsBriefingPage.tsx` navigates to `?tab=content-gaps`, but `src/components/client/StrategyTab.tsx` does not read `useSearchParams` to initialize the requested tab/section. | The URL expresses intent that the receiving component silently ignores. This violates the documented two-halves `?tab=` contract. | Wire `StrategyTab` to read the param or change the sender to a route/anchor the receiver actually honors. Add contract coverage. |
| Keyword strategy streaming | `src/components/KeywordStrategy.tsx` hand-parses SSE from `/api/webflow/keyword-strategy/:workspaceId`; `src/api/seo.ts` already has `streamKeywordStrategy()` with the same parsing contract. | Error handling, abort behavior, and event parsing can diverge. | Move the component to `streamKeywordStrategy()` and make the helper the only SSE implementation for this endpoint. |
| AI dispatch migration | `server/ai.ts` exists as the unified dispatcher, but many server routes still import `callOpenAI` directly, especially high-churn strategy/SEO routes. | Provider choice and retry/guard behavior can drift from the platform standard. | Audit direct `callOpenAI`/`callAnthropic` usage, keep explicit Anthropic creative-prose exceptions where intended, and migrate general generation paths to `callAI()`. |
| SEO provider abstraction | `server/seo-data-provider.ts` provides the Semrush/DataForSEO interface, while `server/semrush.ts` remains a large direct provider surface and strategy UI still exposes provider mode details. | Provider-specific assumptions can leak into feature code, making the DataForSEO migration more expensive to finish. | Move remaining feature-facing provider behavior behind `SeoDataProvider` capabilities and document any intended provider-specific controls. |

## Monolith candidates

| Module | Current shape | Split direction |
| --- | --- | --- |
| `src/components/client/StrategyTab.tsx` | 2,000+ lines combining content gaps, tracked keywords, business priorities, keyword feedback, drawers, tier gates, and request flows. | Extract feature hooks (`useKeywordFeedback`, `useTrackedKeywords`, `useBusinessPriorities`) and presentational sections before adding new strategy work. |
| `server/routes/keyword-strategy.ts` | 2,700+ lines mixing route handlers, provider orchestration, page analysis, strategy generation, feedback endpoints, history diff, and broadcasts. | Split into controller routes plus service modules for generation, page analysis, feedback, signals, and history. |
| `server/workspace-intelligence.ts` | 3,000+ lines assembling many intelligence slices and formatters. Central by design, but too broad for ongoing growth. | Keep public API stable, move slice assemblers into `server/intelligence-slices/*`, and preserve formatter behavior with tests. |
| `server/routes/webflow-seo.ts` | 1,900+ lines covering audit, suggestions, rewrite, bulk jobs, fix acceptance, AI copy, and Webflow persistence. | Split audit, suggestions, rewrite/bulk jobs, and apply/publish handlers behind shared services. |
| `src/components/SchemaSuggester.tsx` | 1,300+ lines combining generator, page picker, CMS template mapping, diff/publish, job recovery, and impact panel. | Extract generator, CMS template, publishing, and impact subflows with shared schema job state. |
| `src/components/PageIntelligence.tsx` | 1,100+ lines combining page join, analysis, keyword editing, SEO copy generation, and rank tracking. | Extract rank tracking and SEO copy state into shared hooks; keep the component as composition only. |
| `src/components/SeoEditor.tsx` | 1,000+ lines combining editor state, session recovery, bulk jobs, WebSocket progress, and approvals. | Extract bulk job recovery/progress and draft persistence into reusable hooks shared with nearby SEO tools. |
| `src/components/brand/VoiceTab.tsx` | 1,100+ lines across samples, DNA, guardrails, calibration, mutation wiring, and section UI. | Split section components and keep mutations/query invalidation in a small container. |

## Existing roadmap overlap

- `503` already covers notification fragmentation. Keep it, but implementation should include inline client/admin toasts in the audit scope.
- `587` already covers shared WebSocket event bus. Keep it as a platform health dependency for future large-client dashboards.
- `365`, `367`, `368`, `369`, and `370` already cover keyword strategy blob normalization. Do not duplicate those items; instead, sequence the keyword strategy route split around them.
- `schema-context-builder-pattern-b-migration` already tracks schema context direct-read cleanup. Keep it separate from the broader monolith split.

## Suggested sequencing

1. Remove or consolidate duplicate implementations first: billing, client data facade, tab deep links, SSE helper, AI dispatcher.
2. Split the highest-churn monoliths after their data contracts are clearer: `StrategyTab`, `keyword-strategy.ts`, `webflow-seo.ts`.
3. Split broad feature tools opportunistically when adjacent feature work touches them: `SchemaSuggester`, `PageIntelligence`, `SeoEditor`, `VoiceTab`.
4. Treat `workspace-intelligence.ts` carefully: split slice internals only after formatter and cache behavior are covered by tests.
