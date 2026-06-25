# Pre-Plan Audit — SEO Decision Engine P8: AI-Visibility / LLM Citation

**Date:** 2026-06-24
**Seed:** roadmap `seo-engine-p8-ai-visibility-llm-citation` — "ai_optimization/llm_mentions_* → 'are we cited by LLMs' KPI + AEO before/after proof. Group C (paid). Flag `ai-visibility`. Closes the open-loop AEO program with measurement."
**Method:** 4 parallel Explore scans (existing AEO surface · provider/paid infra · deliverable/KPI surfacing · scaffolding+data-model) + 3 LIVE DataForSEO AI-optimization calls validated into a fixture (`tests/fixtures/dataforseo-llm-mentions.ts`).
**Status:** Final program phase. No spec yet — this audit grounds the brainstorm. Exhaustive on existing surface (file:line) + de-risks the paid API shape; does NOT pre-decide the product.

---

## 0. The reframe: AEO content side EXISTS — P8 is the MEASUREMENT side

The platform already does a lot of AEO **production** (P3 + the AEO audit engine): SERP-feature detection (`serp_feature_opportunity`, `serpOpportunities` count), the `aeo-page-review` engine + `aeo-author`/`aeo-answer-first`/`aeo-trust-pages` recs, content-brief AEO directives ("lead with a citable answer"), outbound-citation extraction. What is **completely absent** (confirmed: zero grep hits for `llm_mention`/`ai_citation`/`ai_search_volume`): any **measurement of whether the client is actually cited/mentioned by LLMs**. P8 closes that loop — it MEASURES the payoff of all that AEO work.

**Two paid data models (both live-validated):**

| | Mentions DATABASE | Direct PROMPT |
|---|---|---|
| **Endpoint** | `ai_optimization/.../llm_mentions/aggregated_metrics` (+ `/search`) | `ai_optimization/{llm}/llm_responses/live` |
| **Input** | `{ domain }` (or `{ keyword }`) + platform (`chat_gpt`\|`google`) | a `user_prompt` + model + optional `web_search` |
| **Returns** | `total.platform[].mentions` + `ai_search_volume` (the KPI); `brand_entities_title` (co-mentioned COMPETITORS = share-of-voice); `sources_domain` (content LLMs cite when mentioning you = AEO targets) | answer `text` + `annotations` (citations, often null) |
| **Citation detection** | clean aggregate numbers from the DB | FUZZY — brand-name in `text` and/or `annotations[].url` |
| **Cost** | one DB query per domain (cheap) | ~$0.0008/prompt (live) |
| **Best for** | the headline "are we cited" KPI + competitive share-of-voice + AEO source targeting | controlled before/after proof on SPECIFIC questions |

Validated values (squareup.com, chat_gpt, US): `mentions: 2704`, `ai_search_volume: 58439`; competitors co-mentioned = Square/Apple Pay/Stripe/PayPal; top source domains = squareup.com/reddit/wikipedia/nerdwallet/forbes. **This split IS the central brainstorm decision (§7, Q1).** The mentions DB is the obvious primary; direct-prompt is an optional add for question-level before/after proof.

---

## 1. Existing surface (verified)

**AEO production (exists — P8 measures it, doesn't rebuild):** `server/seo-provider-signals.ts` (`hasSerpOpportunity`, `parseSerpFeatures`); `shared/types/intelligence.ts` `SerpFeatures` + `seoContext.serpFeatures`; `server/routes/client-intelligence.ts` `countSerpOpportunities` → client `serpOpportunities`; `server/aeo-page-review.ts` + `server/aeo-site-review-job.ts` (the AEO audit); `aeo-*` recs in `server/recommendations.ts`; content-brief AEO directives (`server/content-brief.ts`); outbound-citation extractor (`server/schema/extractors/page-elements/citation.ts` — note: extracts who the CLIENT cites, NOT inbound). Client framing today: `health-tab` copy mentions "ChatGPT, Google AI Overviews"; SeoAuditGuide "AI Search Ready" — all education, **no measurement displayed**.
**Measurement (net-new):** nothing. `llms.txt` cache (migrations 062/130) is unrelated infra.

## 2. Provider / paid infra — ~85% reuse (verified)

`runDataForSeoOperation<T>` (the hub P6/P7 reused) + `readCache`/`writeCache` (workspace-isolated) + `logCreditUsage` + credit-exhausted breaker + `markCapabilityDisabled` on 40204 + `getTaskResult` + P4 `workspaceProviderGeo` (the agg_metrics endpoint takes `location_name`/`language_code`). **Net-new:** a `getLlmMentions` (+ optional `getLlmResponse`) method + `parseLlmMentions` pure parser (fixture-grounded) + a `CACHE_TTL_LLM_MENTIONS` constant (~168–336h — DB data is slow-moving). The `ai_optimization` family is entirely unused today → net-new, plugs into the same scaffolding as `getNationalSerp`/`getBusinessListings`.

## 3. Deliverable: KPI primary (time-series), insight/rec supporting

Unlike P6 (insight) and P7 (rec), P8's headline output is a **KPI/metric**: LLM mention volume + trend + competitor share-of-voice + source domains. Surfacing options (decision §7, Q3):
- **(A) KPI metric** — `StatCard`/`MetricRing` on admin WorkspaceHome + client Overview, backed by a **time series** (mirror `workspace_metrics_snapshots` or a new `llm_mention_snapshots` table) for the "before/after" trend. *The primary.*
- **(B) Insight** (`serp_feature_opportunity`-style 7-part lockstep) — "you're under-cited vs competitors" change detection. Supporting.
- **(C) Recommendation** (reuse `aeo` RecType) — "close the AI-citation gap: get cited by {source domain}". Supporting; ties to outcome tracking for the before/after proof.
Intelligence slice: a new `aiVisibility` summary (or extend `seoContext`) so AdminChat/AI context see it (the "wire new data into a slice" rule). The **before/after AEO proof** = baseline snapshot at P8 launch → weekly snapshots → trend delta (the roadmap's explicit ask).

## 4. Scaffolding checklist (anti-silent-CI — same registries P6/P7 touched)

Flag `ai-visibility` → `FEATURE_FLAGS` + `FEATURE_FLAG_CATALOG` (lifecycle) + `FEATURE_FLAG_GROUPS['SEO Decision Engine']` (currently geo-targeting/national-serp-tracking/local-gbp) + lifecycle-anchor test. Job `llm-mentions-refresh` → `BACKGROUND_JOB_TYPES` + `BACKGROUND_JOB_METADATA` + `tests/helpers/background-job-test-matrix.ts` (+ a signal integration test). WS event `LLM_MENTIONS_SNAPSHOTS_REFRESHED` → `ws-events.ts` + `src/lib/wsEvents.ts` mirror + centralized `src/lib/wsInvalidation.ts` admin switch (→ the KPI's query key, NOT just a sibling — the P7 lesson) + `useWsInvalidation.ts` + `scripts/platform-domain-event-definitions.ts`. Tier `computeEffectiveTier` Growth+ + `<TierGate>`/`<FeatureFlag>`. (If a new insight type is chosen: the full 7-part lockstep + `insight-renderer-coverage`. If KPI/rec-only: no insight lockstep.)

## 5. Data model — migration 155 (next free; P7 = 154)

Time-series, mirroring `serp_snapshots`/`business_listing_snapshots`. A `llm_mention_snapshots` table keyed `(workspace_id, snapshot_date, platform)`: `domain`, `mentions` (INTEGER), `ai_search_volume` (INTEGER), `competitor_brands` (JSON — `brand_entities_title`), `source_domains` (JSON — `sources_domain`), `share_of_voice` (REAL — derived: own mentions ÷ (own + competitor) ), `fetched_at`. Store `server/llm-mentions-store.ts` (rowToX + `parseJsonSafeArray` + `createStmtCache` + transaction upsert + workspace-scoped). Public/client serialization: aggregates only (counts/volume/share/competitor brands/source domains — no raw LLM transcripts). The brand-name to match for "is the client mentioned" = the workspace's brand/business name + liveDomain.

## 6. Validated shapes + gotchas (fixture)

`LLM_MENTIONS_AGG` (+ `_EMPTY`), `LLM_RESPONSE`. Gotchas: agg groups are arrays of `{type:'group_element', key, mentions, ai_search_volume}`; a zero-presence target returns EMPTY arrays → 0 mentions, never invented. `llm_response.annotations` is often `null` even when `web_search` requested (model decides) → brand-name-in-`text` is the reliable citation signal for the direct-prompt path.

## 7. OWNER DECISIONS (brainstorm agenda — highest leverage first)

1. **Data model: mentions-DB / direct-prompt / both?** (a) **Mentions DB only** — clean KPI (mention volume + share-of-voice + source domains) per the client's domain, cheap, broad; (b) **+ direct prompt** — also run a small set of the client's target questions through ChatGPT/Perplexity for explicit "named or not" before/after proof (fuzzier, ~$0.0008 each); (c) both. *Recommend (a) for the KPI core, optionally (b) for a few hero questions. The mentions DB is the sellable headline.*
2. **What's the headline KPI + framing?** mention count? `ai_search_volume`? a 0–100 "AI visibility score"? **Share-of-voice vs the co-mentioned competitor brands** is the most compelling ("you're 14% of the AI conversation in your category vs the leader's 40%"). Plus the **AEO source-targeting** angle (which domains to get cited by).
3. **Deliverable shape (§3):** KPI metric (primary) + which supporting layer — an insight (change detection), a rec (reuse `aeo` — "get cited by X"), both, or neither for v1?
4. **Platforms:** chat_gpt only, or chat_gpt + google (the agg endpoint supports both)? Multiple LLMs via direct-prompt (claude/gemini/perplexity)?
5. **Cadence + job:** a `llm-mentions-refresh` job, weekly (the before/after trend needs regular snapshots). Manual trigger for the phase + the weekly cron?
6. **Tier + budget:** Growth+ (mirror P6/P7), observe-only budget?
7. **Competitor set for share-of-voice:** the `brand_entities_title` the API returns (automatic), the workspace's configured competitors, or both?

---

## 8. Parallelization + model assignments

**Wave 0 (contracts, single commit):** flag `ai-visibility` + catalog/group; migration 155 `llm_mention_snapshots`; `LlmMentionsRequest`/`LlmMentionsResult` types; job type + metadata + matrix; WS event + mirror + all registries; (if insight) the 7-part type lockstep. **Wave 1 (parallel):** provider `getLlmMentions` + `parseLlmMentions` (fixture-grounded, test-first) ‖ store ‖ (if direct-prompt) `getLlmResponse`+parser. **Wave 2:** `llm-mentions-refresh` job+route (gating, incremental flush) + KPI/snapshot compute + (supporting) insight/rec. **Wave 3:** admin KPI card + trend + client Overview surfacing + intelligence slice. **Wave 4:** tests incl. the contract project + full gate + scaled review.

| Task | Model | Why |
|---|---|---|
| Provider parser + KPI/share-of-voice compute | Sonnet | fixture-grounded, the highest-risk units |
| Store + job + route | Sonnet | pattern-following (P6/P7), gating |
| KPI card + trend + client framing | Sonnet | UI + Four Laws |
| Mechanical registry lockstep | Haiku | pattern-matching |
| Contracts (Wave 0) + review + orchestration | Opus | full-context judgment |

---

**Single biggest pre-implementation risk:** ALREADY mitigated — both AI-optimization shapes are validated into a fixture, with the empty-array and null-annotations gotchas captured. The remaining risk is product scope (§7), which the brainstorm resolves — notably the KPI framing (share-of-voice is the compelling angle) and whether direct-prompt before/after proof is in v1.
