# Duplication Inventory (Read-Only Audit)

Date: 2026-05-27
Branch context: local branch with tree parity to `origin/staging`
Scope: server/, src/, shared/ (read-only audit; no behavior changes)

## Goal
Create a concrete inventory of duplicated features/callers/helpers so we can decide what to action before writing an implementation plan.

## Method
- Pattern scans for repeated function names and helper families
- Caller scans for multi-entry validation and normalization paths
- Hotspot counts for high-fanout patterns

## Prioritized Inventory

| Priority | Cluster | Evidence | Why This Is Risky | Existing Authority Candidate |
|---|---|---|---|---|
| High | Schema validation logic split across 3 engines | `server/schema/validator.ts`, `server/schema-validator.ts`, `server/schema/rich-results.ts` + callers in `server/schema/generator.ts` and `server/routes/webflow-schema.ts` | Same domain rules are implemented in multiple places with partially different intents; drift can produce contradictory "valid vs invalid" outcomes between generation diagnostics and publish gates | Keep separate profiles, but share a single rule primitive layer + canonical rule catalog |
| High | Same-name, different-behavior path normalizers | `shared/page-address-utils.ts:normalizePageUrl`, `server/helpers.ts:normalizePageUrl`, `server/analytics-intelligence.ts:normalizePageUrl` | Identical naming with different semantics is a regression trap; callers can import wrong helper and silently change joins/grouping | `shared/page-address-utils.ts` for canonical path identity; explicit differently named analytics helper |
| High | Path normalization fan-out + raw pathname extraction | 69 `new URL(...).pathname` callsites across server/src/shared/tests; many page-identity joins call normalizers directly | High fan-out means partial migrations are easy to miss; tiny inconsistencies create hard-to-debug page matching bugs | Page Address contract (`shared/page-address-utils.ts`) |
| High | Route query parser duplication | `parsePositiveIntQuery` duplicated in `server/routes/{ai,google,health,public-analytics,webflow-cms,workspace-home}.ts` | Slightly different parser behavior per route can produce inconsistent pagination/range defaults and edge-case bugs | Shared route query parser helper module |
| High | Mutation feedback-loop boilerplate repeated widely | 53 server files contain both `addActivity()` and `broadcastToWorkspace()` patterns | Repeated write-side effects are drift-prone (missing activity, wrong WS event, cache invalidation mismatches) | Shared mutation-side-effect utility by domain (or guarded helper wrappers) |
| Medium | Schema text sanitizer duplication | `isOpaqueIdentifier`/`safeText`/`cleanPublicText` variants in `server/schema/generator.ts`, `server/schema/templates/{service,local-business}.ts`, `server/schema/extractors/page-elements.ts` | Same sanitation concerns solved multiple times; likely to diverge on edge cases (IDs, empty strings, opaque tokens) | Shared schema text sanitizer utility |
| Medium | Schema role/type mapping duplication | `shared/types/schema-plan.ts:SCHEMA_ROLE_PRIMARY_TYPE`, `server/schema-suggester.ts:{PAGE_TYPE_SCHEMA_MAP,SCHEMA_ROLE_TO_PAGE_KIND}`, `server/schema/generator.ts:roleToDiagnosticsType` | Role/type drift can create mismatched diagnostics, plan expectations, and emitted schema types | Shared schema role registry (typed source of truth) |
| Medium | HTML-analysis helper duplication | `extractTag`, `extractMetaContent`, `extractLinks`, `extractImgTags`, etc. in `server/seo-audit-html.ts`, `server/sales-audit.ts`, `server/html-analysis-utils.ts` | Multiple parallel parsers increase bug surface and stale-fix risk | `server/html-analysis-utils.ts` |
| Medium | Numeric/text formatting helper duplication in UI | `formatSize` in `src/components/{AssetBrowser,AssetAudit,PageWeight,assets/AssetCard}.tsx`; `fmtNum` in multiple files | Low correctness risk but high repeated code and inconsistent UX formatting risk | Shared UI formatter utilities |
| Medium | Slug/url helper duplication in isolated domains | `slugify` in `server/intelligence/entity-resolution-slice.ts` and `server/mcp/tools/keyword-actions.ts`; `normalizeUrl` in `server/sales-audit.ts` and `server/diagnostic-probe.ts` | Hidden drift over time; especially risky when helpers gain domain assumptions later | Shared slug/url helper module with domain-specific wrappers |
| Medium | WS invalidation map is centralized but large and repetitive | `src/hooks/useWsInvalidation.ts` is 463 lines with ~57 event handlers | Centralization is good, but handler repetition still invites omission/drift when new events are added | Keep centralized map + generate/verify handler completeness |
| Low | Repeated mapper names across table modules (`rowToModel`, `modelToParams`, `migrateFromJsonBlob`) | Seen across keyword/table modules (`quick-wins`, `content-gaps`, `keyword-gaps`, `topic-clusters`, etc.) | Mostly intentional pattern reuse; low direct bug risk unless semantics diverge silently | Maintain pattern, optional generic helper extraction only if it reduces complexity |

## Notable Duplicate Name Collisions (High Signal)

1. `normalizePageUrl`
- `shared/page-address-utils.ts`
- `server/helpers.ts`
- `server/analytics-intelligence.ts`

2. `parsePositiveIntQuery`
- `server/routes/health.ts`
- `server/routes/ai.ts`
- `server/routes/workspace-home.ts`
- `server/routes/google.ts`
- `server/routes/webflow-cms.ts`
- `server/routes/public-analytics.ts`

3. Schema validator family
- `validateLeanSchema` (`server/schema/validator.ts`)
- `validateForGoogleRichResults` (`server/schema-validator.ts`)
- `checkRichResultsEligibility` (`server/schema/rich-results.ts`)
- `validateWholeSiteSchemaGraph` (`server/schema/whole-site-graph-validator.ts`)

## Quick Triage: What To Action First

1. Schema validator/rule unification boundary (highest confidence bug-prevention leverage)
2. `normalizePageUrl` naming/authority cleanup + caller audit
3. Shared route query parser extraction
4. Mutation side-effect helperization (`addActivity` + `broadcastToWorkspace` guardrails)
5. Schema sanitizer + role-map consolidation

## Notes
- This document is an inventory only. It is intentionally not an implementation plan.
- Several clusters are likely partially tracked by existing broad roadmap drift items, but this inventory adds explicit file-level targets and risk framing for prioritization.
