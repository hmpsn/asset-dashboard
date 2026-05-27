# HTML Extraction Consolidation Audit (2026-05-27)

## Scope

Target roadmap item: `audit-drift-html-extraction-utility-consolidation`

Goal: consolidate duplicated server-side HTML extraction helpers into one canonical authority and prevent reintroduction drift.

## Source Inventory

1. `server/seo-audit-html.ts`
- Local helper cluster: `extractTag`, `extractMetaContent`, `countWords`, `extractLinks`, `extractImgTags`, `extractStyleBlocks`, `extractInlineScripts`, `countExternalResources`.
- Behavioral nuance: `extractLinks` includes `rel`; `extractImgTags` includes `hasAlt`.

2. `server/sales-audit.ts`
- Near-identical helper cluster with projection drift.
- Behavioral nuance: `extractLinks` omits `rel`; `extractImgTags` omits `hasAlt`.

3. `server/link-checker.ts`
- Richer link extraction behavior (onclick URL capture, form action capture, dedupe, URL filtering).
- Implemented as local parsing logic prior to this migration.

## Drift Points Confirmed

1. Multiple helper authorities implemented similar parsing regexes in separate modules.
2. Link extraction contracts drifted by surface (`rel`, dedupe behavior, onclick/form support).
3. Risk of future mini-parser reintroduction was not mechanized in `pr-check`.

## Migration Boundary

1. Canonical authority: `server/html-analysis-utils.ts`.
2. Compatibility wrappers retained:
- `server/seo-audit-html.ts`
- `server/sales-audit.ts`
3. Link-checker keeps richer behavior via canonical options (not local parser implementation).

## Guardrail Boundary

New `pr-check` rule: `Ad hoc HTML extraction helper outside canonical authority`

- Blocks new local helper declarations for HTML extraction primitives in `server/` outside:
  - `server/html-analysis-utils.ts`
  - `server/seo-audit-html.ts`
  - `server/sales-audit.ts`
- Supports documented escape hatch: `// html-extraction-ok`.

