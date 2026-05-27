# AI Quality Eval Contracts

This project already has an AI reliability harness for pipeline wiring, provider failures, invalid output, and mutation hygiene. AI quality evals extend that system with deterministic fixture checks for prompt authority, output format, evidence grounding, and prose-quality instructions.

## Rules

- Keep deterministic checks first. CI may inspect prompts, fixtures, source contracts, and saved evidence, but must not depend on live model judgment for normal PR gates.
- Extend `scripts/ai-reliability-registry.ts`; do not create a disconnected eval registry for the same critical pipelines.
- Use `AiQualityFixture` entries for prompt/output contracts that affect response quality.
- Use `npm run verify:ai-quality` for the deterministic fixture report.
- Hard quality fixtures are reserved for authority, output-format, and evidence-contract breaks. Subjective prose quality stays advisory until a human has validated the signal.
- Voice checks must rely on `buildSystemPrompt()`, `buildEffectiveBrandVoiceBlock()`, and the voice quality harness. Do not recreate voice authority logic in eval scripts.
- Creative-copy checks should stay contract-level in CI: verify the intended writing-rule tier is present, duplicate prose layers are absent, and factual-safety/output-format rules remain intact. Judge "more creative" or "better voice" with human review or opt-in local evals, not default CI.
- Page-type copy checks should stay deterministic: verify service/location/landing prompts include density contracts, brand-context hierarchy, single-CTA guidance, and public-copy bans for SEO mechanics. Human review remains the gate for whether the resulting prose feels sharper.
- Outline-density checks should also stay deterministic: verify conversion-page briefs/outline regeneration carry compact section budgets, optional/capped H3 guidance, duplicate-close trimming, and no reader-facing local SEO operations. Human review remains the gate for whether the final page feels sufficiently complete.
- Generation-style checks should stay deterministic: verify `standard`, `concise`, and `hybrid` style contracts are prompt-visible where selected and that factual-safety, output-format, and page-type density contracts remain higher priority. Do not score which style "sounds best" in CI.
- Live model evals, when added, must be opt-in local/manual tooling and must not run in default CI.
- Local generation experiments may use live MCP context as long as they stay explicitly opt-in, write artifacts outside tracked source, and do not call persistence tools. `scripts/experiment-content-generation.ts` is the current read-only harness: it calls `prepare_brief_context`, generates candidate briefs and optional draft HTML locally, and scores/reports them without `save_brief`, `save_post`, or `send_to_client`. Batch mode may compare variants across page types, but its winner recommendations are advisory until human-reviewed.

## Current Quality Dimensions

- `voice_authority` — calibrated voice DNA/guardrails are present through the canonical layer and not duplicated.
- `output_format` — JSON, markdown, delimiter, or plain-prose contracts match the downstream parser/rendering path.
- `prose_quality` — universal anti-generic-writing rules remain available where the prompt path expects them.
- `page_type_density` — service/location/landing-style generation keeps page architecture and conversion density above generic SEO article habits.
- `generation_style` — admin-selected `standard`/`concise`/`hybrid` density guidance is present without overriding higher-priority safety, format, or page-type contracts.
- `evidence_grounding` — factual/provenance-sensitive paths preserve research/evidence/human-review requirements.
- `duplication_risk` — complete-style-system callers document intentional skips such as `skipProseRules`.

## PR Gate Policy

`scripts/report-ai-quality.ts --soft-gate` follows this policy:

- fail on missing fixture coverage, missing evidence files, or hard authority/format/evidence failures;
- warn on quality-score regressions or soft fixture failures;
- keep live model scoring out of CI.
