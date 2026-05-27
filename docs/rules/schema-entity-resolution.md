# Schema Entity Resolution

Use this rule for schema entity grounding work (`schema-entity-grounding-wikidata`) and any follow-on schema intelligence phases.

## Purpose

Entity disambiguation is high-leverage but high-drift. If different modules infer `Thing`/`Place` entities and `sameAs` links independently, the platform produces contradictory schema output and uncacheable lookup behavior.

This document defines one boundary for Wikidata-backed resolution so schema generation, intelligence slices, and prompt consumers stay consistent.

Primary owner: `analytics-intelligence`  
Secondary owners: `seo-health`, `brand-engine`

## Boundary

All Wikidata/SPARQL lookups and confidence scoring must live under:

- `server/intelligence/entity-resolution*`

Callers in schema routes/helpers/templates consume resolved results through intelligence contracts. They must not perform direct Wikidata fetches.

## Contracts

1. Shared types live in `shared/types/entity-resolution.ts`.
2. `EntityResolutionSlice` is the canonical output shape for `Thing`/`Place` entity grounding.
3. Schema surfaces (`Organization.knowsAbout`, `Article.about`, `Article.mentions`, `areaServed`) use resolved entities from the slice boundary, not ad hoc per-template extraction.
4. If data is unavailable, return explicit availability states (`ready | disabled | degraded | no_data | not_requested`) rather than silently omitting behavior.

## Guardrails

1. `scripts/pr-check.ts` rule `Wikidata disambiguation outside entity-resolution intelligence modules` blocks direct Wikidata/SPARQL references outside `server/intelligence/entity-resolution*` modules.
2. Escape hatch is allowed only with inline rationale: `// entity-resolution-ok: <reason>`.
3. Hatch usage must be temporary and tracked in roadmap/PR notes.

## Phase A Acceptance (Contract + Guardrails)

- [x] Shared entity-resolution types added.
- [x] Rule document added.
- [x] pr-check guardrail rule + fixture coverage added.
- [x] No runtime schema behavior change required in this phase.

## Deferred to Implementation Phases

- Assembler implementation (`assembleEntityResolution`) and slice wiring.
- Cache strategy for repeated entity candidates.
- Confidence threshold tuning and fallback heuristics.
- Schema template emission upgrades for typed entity arrays.
