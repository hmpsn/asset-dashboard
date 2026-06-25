# Keyword Strategy Synthesis

`synthesizeKeywordStrategy()` is the AI-facing strategy pipeline. Its job is to transform workspace intelligence, search evidence, client feedback, and provider keyword data into a `StrategyOutput` that later persistence code writes into normalized strategy tables.

## Stage Order

Keep the pipeline in this order:

1. Assemble workspace intelligence, client feedback, business context, and outcome-learning notes.
2. Build the keyword pool and closed candidate set before any AI prompt is assembled.
3. Run page assignment batches before site-level synthesis.
4. Validate/provider-enrich page assignments before detecting keyword conflicts.
5. Run site-level synthesis and conflict fixes.
6. Apply hard filters for declined, branded, and shared-intelligence-ineligible keywords.
7. Re-add uncovered client-requested candidates before the deterministic content-gap floor backfill.
8. Apply the final declined page-map filter last.

Do not move persistence into synthesis. `server/keyword-strategy-generation.ts` remains the owner of enrichment and `persistKeywordStrategy()`.

## Data Survival Contracts

Page assignment rows must preserve page identity, primary/secondary keywords, search intent, provider metrics, validation state, and any enrichment fields later written to `page_keywords`.

Content gaps must preserve topic, target keyword, intent, priority, rationale, suggested page type, provider metrics, trend/SERP/question fields, opportunity score, CPC, and `backfilled`.

The `requested` marker on `StrategyContentGap` is synthesis-only. It protects client-requested gaps from in-memory pruning during enrichment and must not be added to DB schemas or persistence column lists.

## AI Operation Contracts

The named operations stay authoritative:

- `keyword-page-assignment` returns `{ assignments: [...] }` and is validated with `pageAssignmentResponseSchema`.
- `keyword-site-synthesis` returns site-level strategy fields and is validated with `siteSynthesisResponseSchema`.

Closed-set IDs are the normalized keyword strings from the candidate set. A model-supplied `*SourceId` is trusted only when it is present in that set. Out-of-set page-assignment keywords must fall through to deterministic fallback; out-of-set content-gap targets must be dropped and backfilled from valid candidates.

## Extraction Rules

`server/keyword-strategy-ai-synthesis.ts` is the public facade and orchestration shell. Stage contracts, prompt builders, pool builders, parse/repair helpers, and finalization helpers belong under `server/keyword-strategy-synthesis/`.

Do not reintroduce local synthesis-only type aliases such as `PageMapping` into the facade. Shared stage payloads belong in `server/keyword-strategy-synthesis/types.ts`.
