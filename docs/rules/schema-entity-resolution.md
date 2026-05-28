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

## Phase B Acceptance (Slice Wiring)

- [x] `entityResolution` registered in intelligence slice registry/facade.
- [x] `assembleEntityResolution()` implemented with deterministic candidate assembly.
- [x] `buildSchemaIntelligence()` can request/return the entity-resolution slice.
- [x] Unit coverage added for slice assembly + schema wrapper wiring.

## Phase C Acceptance (Wikidata Resolution + Cache)

- [x] Wikidata/SPARQL disambiguation implemented under `server/intelligence/entity-resolution*`.
- [x] Per-entity cache strategy implemented to avoid repeated lookups.
- [x] Slice availability degrades safely on lookup errors (no hard failure).
- [x] Unit coverage added for resolver/cache behavior.

## Phase D Acceptance (Schema Emission Wiring)

- [x] Schema generation threads entity-resolution intelligence into template inputs.
- [x] `Organization.knowsAbout` supports typed Thing emission (with Wikidata `sameAs` when available).
- [x] `Article.about`/`Article.mentions` consume typed entity grounding when available.
- [x] `Service`/`LocalBusiness.areaServed` prefer typed Place emission from resolved entities.
- [x] Unit/contract coverage added for schema emission and schema-suggester threading.

## Cache Scope + Lifecycle

The `entity_resolution_cache` table (migration 104) is **workspace-global by design**: Wikidata QID resolutions are facts about the public web, not workspace-private data. The cache key is `<type>:<normalized-label>` (see `cacheKeyForCandidate` in `entity-resolution-wikidata.ts`). A label resolved once is reused across all workspaces.

TTLs by resolution status:

| Status | TTL | Reason |
|---|---|---|
| `resolved` | 30 days | Wikidata facts change slowly; long TTL minimizes load on the SPARQL endpoint. |
| `unresolved` | 7 days | Label may gain a Wikidata entry; recheck more often. |
| `error` | 1 day | Transient network/rate-limit failures should retry sooner. |

`invalidateIntelligenceCache(workspaceId)` only clears the in-memory intelligence cache — it does NOT purge the Wikidata cache (intentional). A background sweep for expired rows is **deferred**; the `expires_at` index exists for that future job. Until then, expired rows accumulate but are never read (the lookup query filters on `expires_at > now`).

## Foreground vs Bulk Resolution

Schema generation has two entry points with different Wikidata resolution defaults:

| Path | `resolveEntityReferences` | Reason |
|---|---|---|
| `generateSchemaForPage` (foreground, single page) | `false` | Avoid blocking the request on up to 8 sequential Wikidata fetches (~20s worst case). Reads warm cache entries written by the bulk job. |
| `generateSchemaSuggestions` (bulk, background job) | `true` | Populates the shared 30-day cache so subsequent foreground calls return enriched entities synchronously. |

Callers wiring new schema paths should default to `false` unless the call is already running in a background job.

## Wikidata HTTP Etiquette

`entity-resolution-wikidata.ts` sets a descriptive `User-Agent` per Wikimedia's [User-Agent policy](https://meta.wikimedia.org/wiki/User-Agent_policy). Default Node fetch UA can be rate-limited (`429`) or blocked (`403`). Network failures (`TypeError`, `AbortError`, `SyntaxError` on malformed JSON) are expected degradation and logged at `debug` — they must NOT route through `isProgrammingError()`.

## Deferred to Implementation Phases

- Confidence threshold tuning and fallback heuristics based on production telemetry.
- Background sweep job for expired `entity_resolution_cache` rows.
