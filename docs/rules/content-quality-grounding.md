# Content Quality Grounding

Use this rule for content-generation paths that make factual claims, cite competitors, summarize SERP evidence, or review generated posts for publish readiness.

## Contracts

- Use `callAI({ researchMode: true })` for factual strategy or content outputs. Do not use it for creative-only rewrites, keyword brainstorming, or short stylistic variations.
- Keep output-format contracts explicit. HTML paths must still request clean HTML; JSON paths must still use `responseFormat: { type: 'json_object' }` or `callCreativeAI({ json: true })`.
- Treat stored SERP fields as observed evidence. `realPeopleAlsoAsk` and `realTopResults` may guide structure and coverage, but they are not citation proof unless source content was supplied.
- Preserve provenance-sensitive review semantics. AI may surface claims to verify, but `factual_accuracy` and `no_hallucinations` require human review and must not auto-check.

## Review Expectations

- Numeric/statistical claims should be surfaced as `claimsToVerify` when possible.
- The reviewer remains responsible for confirming the source; the platform must not present deterministic extraction as automated fact-checking.
