# Model Manifest — LLM Model IDs, Pricing, and Param Rules

> Source of truth: [`server/model-manifest.ts`](../../server/model-manifest.ts). This doc explains the contract; the file holds the values.

## Why this exists

The 2026-07 model upgrade (Sonnet 4.6 → Opus 4.8 on the Claude side, GPT-5.4/5.5 → GPT-5.6 on the OpenAI side) had to touch ~70 files because model IDs, pricing rows, and per-model request-parameter knowledge were scattered across call sites, the operation registry, two duplicated pricing tables, and provider helpers. Two **retired** Claude 3.5 IDs sat live in `server/anthropic-helpers.ts` for ~9 months because nothing ever asked the providers whether those models still existed.

The manifest collapses all of that into one module so the next upgrade is an edit to one file plus prompt re-tuning.

## The contract

1. **Semantic roles, not inline IDs.** Call sites and `server/ai-operation-registry.ts` reference `MODEL_ROLES.*` (or the `DEFAULT_*_MODEL` constants). Never write a model-ID string literal at a call site. Current roles: `creativeWriter` (all Claude-side creative generation — uniform, no per-op split), `structuredSynthesis`, `utilityExtraction` (OpenAI) / `utilityExtractionAnthropic` (Haiku tool-use), `creativeRecovery` (the OpenAI-side fallback of the Claude-preferred creative dispatch — deliberately cross-provider for outage protection), `image`.
2. **One pricing table.** `estimateModelCostUsd()` is the only cost estimator. `server/openai-helpers.ts` (`estimateCost`) and `server/platform-observability-report.ts` (`estimateAiCostUsd`) delegate to it. **Historical rows are never deleted** — cost dashboards re-price usage entries logged under old model IDs, so `gpt-5.4`, `claude-sonnet-4-6`, `claude-3-5-*`, `gpt-4.1*` rows stay as `status: 'historical'`.
3. **Per-family param rules live in the manifest, consulted by the helpers.** `getAnthropicRequestPolicy()` / `getOpenAIRequestPolicy()` answer: does this family accept sampling params (`temperature` 400s on Opus 4.7+/Sonnet 5; `gpt-5.6-sol` accepts only its default), what thinking config to send (Opus creative calls get explicit `thinking: {type: 'adaptive'}` + `output_config: {effort: 'high'}` — omitted means OFF on Opus 4.8), and how much thinking-token headroom to add on top of the caller's content-sized `maxTokens`. Call sites and `callCreativeAI*` carry **zero** model-specific param knowledge.
4. **The tripwire keeps the manifest honest.** `npm run verify:model-currency` (script: `scripts/verify-model-currency.ts`, shared checker: `server/model-currency.ts`) iterates `ACTIVE_MODEL_IDS` against each provider's models API — **fails on 404/retired**, warns loudly on deprecation metadata, skips gracefully without API keys. Wired into the nightly workflow (`.github/workflows/pr-check-nightly.yml`, with repo secrets) and as a non-blocking startup check (`runStartupModelCurrencyCheck()` in `server/startup.ts` — alerts via Sentry + error log; never blocks boot). Governance class: `secret-backed`.

## How to do the next model upgrade

1. Edit the role → ID mapping (and `*_CHAT_MODELS` catalogs + `ACTIVE_MODEL_IDS`) in `server/model-manifest.ts`.
2. Add the new pricing rows as `current`; demote the replaced rows to `historical`. Do not delete them.
3. Update/extend the param-policy functions if the new family changes the request surface (consult the claude-api skill's migration guide for the per-target breaking-change checklist).
4. Re-baseline tokens with `count_tokens()` on representative IE prompts; revisit `thinkingHeadroomTokens` and the creative op timeouts in the registry if the new family's latency profile shifts.
5. Run `npm run verify:model-currency` against the finished manifest, then the full test suite.
6. Validate on real outputs before merging (fast-follow, not auto-latest — see the monthly model-currency check in the ops vault).

## Anti-patterns

- ❌ Adding a `model: 'gpt-…'` / `model: 'claude-…'` string literal to a server call site (tests may pin literals to assert wiring).
- ❌ Forking pricing logic anywhere outside `estimateModelCostUsd()`.
- ❌ Passing `temperature` (or any sampling param) from a call site "because this model supports it" — the helper consults the policy; if a call site needs variance on a family that rejects sampling params, steer via the prompt.
- ❌ Deleting historical pricing rows when a model is upgraded.
