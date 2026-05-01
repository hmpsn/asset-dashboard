# schema-yoast-parity-fields PR1 — Pre-Plan Audit

**Date:** 2026-04-29
**Spec:** `docs/superpowers/specs/2026-04-29-schema-yoast-parity-fields-design.md`
**Branch:** `claude/schema-yoast-parity-fields`

**Total findings:**
- 47 test assertions across 3 files (36 require migration, 11 stay)
- 9 consumer sites for `validationErrors` (all backwards-compat, no breaking changes)
- 5 of 8 unused `SchemaContext._*` fields safe to delete (3 must be preserved — spec correction)
- 6 emit points across 4 template files for new field additions
- 3 spec corrections required (slice paths + declined-keyword filter handling)

---

## 1. Spec corrections (apply before plan-writing)

These three corrections should be patched into `docs/superpowers/specs/2026-04-29-schema-yoast-parity-fields-design.md` before plan-writing — keeping the spec the single source of truth.

### Correction 1: §4.2 SchemaContext cleanup — 5 fields, not 8

The spec lists 8 unused `SchemaContext._*` fields for deletion. Audit Q3 found three are actively used somewhere:

| Field | Status | Reason | Action |
|---|---|---|---|
| `_planContext` | **DELETE** | No write, no read anywhere in repo | Delete in PR1 |
| `_pageNode` | **DELETE** | No write, no read | Delete in PR1 |
| `_ancestors` | **DELETE** | No write, no read | Delete in PR1 |
| `_briefId` | **DELETE** | No write, no read | Delete in PR1 |
| `_pageAnalysis` | **DELETE** | No write, no read | Delete in PR1 |
| `_architectureTree` | **PRESERVE** | Written 3 times: `server/jobs.ts:645`, `server/routes/webflow-schema.ts:123` and one other site. Reads not found via grep but writers indicate intentional staging for future use. Defer cleanup to a separate audit. | Keep declaration; no action |
| `_existingErrors` | **PRESERVE** | Written once in `server/routes/webflow-schema.ts:116`. Test fixture references in `tests/integration/page-identity-pr2.test.ts`. Likely staged for a planned validator-error-deduplication feature. | Keep declaration; no action |
| `_faqOpportunities` | **PRESERVE** | **Actively consumed** in `server/schema-suggester.ts:188–190` (FAQ enrichment branch). Tests reference it 5 times in `schema-intelligence-enrichment.test.ts`. Cannot delete. | Keep declaration; no action |

### Correction 2: Migration tracker slice paths

The spec's §6.1 migration tracker references slice paths that don't match the actual `SeoContextSlice` interface in `shared/types/intelligence.ts:68-102`. Audit Q6 mapped the real shape:

| Spec assumed path | Actual path | Notes |
|---|---|---|
| `seoContext.brandVoice` | `seoContext.brandVoice` | ✓ Correct as written |
| `seoContext.keywordStrategy.businessContext` | `seoContext.strategy.businessContext` | ✗ Slice field is `strategy`, not `keywordStrategy` |
| `seoContext.keywordStrategy.siteKeywords` | `seoContext.strategy.siteKeywords` | ✗ Same correction |
| `seoContext.knowledgeBase` | `seoContext.knowledgeBase` | ✓ Correct |
| `seoContext.businessProfile` | `seoContext.businessProfile` | ✓ Correct (optional field) |
| `seoContext.personas` | `seoContext.personas` (`AudiencePersona[]`) | ✓ Correct; type is array of personas, not pre-formatted block |

### Correction 3: Declined-keyword filter handling on `siteKeywords`

The spec's §4.4 says: "The slice already applies the declined-keyword filter; remove the separate `getDeclinedKeywords` call from helpers.ts."

**This is wrong.** Audit Q6 confirmed the SeoContextSlice assembler (line 590 of `server/workspace-intelligence.ts`) reads `ws?.keywordStrategy?.siteKeywords` directly from the Workspace blob. The declined-keyword filter is only applied at the keyword-feedback layer — never by the slice itself.

**Plan implication:** When migrating `siteKeywords` to slice consumption, the schema layer (`buildSchemaContext`) must continue to call `getDeclinedKeywords(ws.id)` and apply the filter. Spec correction:

> When porting `siteKeywords` to slice consumption: read from `intel.seoContext.strategy.siteKeywords`, then apply `getDeclinedKeywords(ws.id)` filter at the schema layer (preserving today's behavior). A future improvement would push the declined-filter into the slice itself, but that's out of scope for this PR — file as a roadmap item.

### Correction 4: `Article.keywords` source path

The spec's §4.3 says `Article.keywords` reads from `pageMap[].primaryKeyword + secondaryKeywords` from `pageProfile` slice. Audit Q6 finding:

- `PageProfileSlice` has `primaryKeyword: string | null`. **No `secondaryKeywords` field** on PageProfileSlice.
- `SeoContextSlice` has `pageKeywords?: PageKeywordMap` (populated when `buildWorkspaceIntelligence({ pagePath })` is called). `PageKeywordMap.secondaryKeywords: string[]` lives there.

**Correct source:** call `buildWorkspaceIntelligence({ slices: ['seoContext'], pagePath })` and read `intel.seoContext.pageKeywords.{primaryKeyword, secondaryKeywords}`. Use `seoContext` slice exclusively, not `pageProfile`. The spec also drops to one slice fetch (the integration-test guard for "one fetch per generation pass" still applies — workspace-wide fetch, indexed by path).

---

## 2. Findings by category

### 2.1 Test assertion migration (Q1)

47 assertions across 3 test files. 36 require migration when `validateLeanSchema` returns `ValidationFinding[]` instead of `string[]`.

**By migration complexity:**

| Pattern | Count | Effort each | Total |
|---|---|---|---|
| `toEqual([])` empty-array check | 6 | 0 min (no change) | 0 min |
| `toBeUndefined()` on validationErrors | 1 | 0 min (no change) | 0 min |
| `expect(validateLeanSchema(buildX())).toEqual([])` (in templates.test.ts) | 4 | 0 min (no change) | 0 min |
| `toContain('exact string')` → `toContainEqual({ ruleId, ... })` | 33 | 2-3 min | 66-99 min |
| `.find(e => e.includes(...))` → `.find(f => f.field === ...)` | 2 | 3-5 min | 6-10 min |
| `.some(e => e.includes(...))` (in integration test) | 1 | 3-5 min | 3-5 min |

**Total estimated effort:** 75-114 minutes (1.5-2 hours of subagent time).

**Files affected:**

| File | Assertions | Migration count |
|---|---|---|
| `tests/unit/schema/validator.test.ts` | 41 | 30 |
| `tests/unit/schema/templates.test.ts` | 4 | 0 |
| `tests/integration/lean-schema-generator.test.ts` | 2 | 1 |

### 2.2 `validationErrors` consumer surface (Q2)

9 code sites. **All disposition: KEEP_STRING_ARRAY** (backwards-compat per spec §4.1).

| File | Line(s) | Type |
|---|---|---|
| `server/schema/generator.ts` | 44 | Type definition (`LeanGeneratorOutput`) |
| `server/schema/generator.ts` | 179, 197, 207, 230 | Validator-call assignment + return |
| `server/schema-suggester.ts` | 31 | Type definition (`SchemaPageSuggestion`) |
| `server/schema-suggester.ts` | 283 | Passthrough mapping (`leanToSuggestion`) |
| `scripts/poc-lean-schema.ts` | 1-2 | Debug iteration |
| `src/components/SchemaSuggester.tsx` | 49 | Type definition |
| `src/components/schema/SchemaPageCard.tsx` | 39, 110, 233-234 | UI rendering (string list) |
| `src/hooks/admin/useAdminSeo.ts` | 66 | Type definition |
| `shared/types/` | none | No centralized type — duplicated per file |

**Zero consumers outside the schema feature.** No admin-chat / reports / webhooks / activity-log dependencies.

### 2.3 Dead-code confirmation (Q3) — 5 of 8 fields safe to delete

See §1 Correction 1. PR1 deletes:
- `_planContext`, `_pageNode`, `_ancestors`, `_briefId`, `_pageAnalysis`

Preserves:
- `_architectureTree`, `_existingErrors`, `_faqOpportunities`

### 2.4 Template emission map (Q4) — 6 emit points across 4 files

| Field | Emit points |
|---|---|
| `Organization.knowsAbout` | `homepage.ts:19` (Organization primary) + `local-business.ts:32` (Organization sibling) |
| `WebSite.potentialAction` (gated) | `homepage.ts:39` + `local-business.ts:63` |
| `LocalBusiness.areaServed` | `local-business.ts:42` |
| `Service.areaServed` | `service.ts:18` |
| `Service.serviceType` | `service.ts:18` |
| `Article.keywords` (Article + BlogPosting) | `article.ts:23` (single function `buildArticleSchema(input, kind)` handles both) |

**Files modified:** `server/schema/templates/{homepage,local-business,service,article}.ts`. `static.ts` and the Product branch of `service.ts` unaffected.

### 2.5 pr-check rule precedent (Q5)

Three close matches in `scripts/pr-check.ts`. Implementer combines patterns 1 + 2:

1. **`getOrCreate* function returns nullable`** (lines 1703-1771) — function-body scanning via brace-walk + inline hatch (`// getorcreate-nullable-ok`).
2. **`Assembled-but-never-rendered slice fields`** (lines 2025-2055) — allow-list as `Set<string>` constant + helper function.
3. **`requireAuth in brand-engine route files`** (lines 2118-2168) — basename-Set filter + `// auth-ok` hatch.

The new rule combines: path-filter to `server/helpers.ts`, brace-walk inside `buildSchemaContext`, allow-list `Set<string>` constant `SCHEMA_CONTEXT_DIRECT_READ_ALLOWLIST = new Set(['ws.name', 'ws.id', 'ws.liveDomain', 'ws.brandLogoUrl', 'siteId'])`, hatch `// schema-context-direct-read-ok`.

### 2.6 Slice field shapes (Q6)

`SeoContextSlice` (`shared/types/intelligence.ts:68-102`):
- Top-level fields: `strategy: KeywordStrategy | undefined`, `brandVoice: string`, `effectiveBrandVoiceBlock: string`, `businessContext: string`, `personas: AudiencePersona[]`, `knowledgeBase: string`
- Optional: `pageKeywords?: PageKeywordMap` (populated when `opts.pagePath` is set), `businessProfile?`, `backlinkProfile?`, `serpFeatures?`, `rankTracking?`, `strategyHistory?`

`PageProfileSlice` (lines 136-164):
- `pagePath: string`, `primaryKeyword: string | null`, `searchIntent: string | null`, etc.
- **No `secondaryKeywords` field.** Use `seoContext.pageKeywords.secondaryKeywords` instead.

`buildWorkspaceIntelligence(workspaceId, opts?)` returns `Promise<WorkspaceIntelligence>`. Cache: 5-min TTL via LRU(200) with stale-while-revalidate + single-flight dedup. Cache key = `(workspaceId, opts)`.

---

## 3. Existing coverage

**Pillar 1 already enforces:**
- Required-field validators per `@type` (`REQUIRED_BY_TYPE` in `validator.ts`)
- Cross-reference shape (`validateCrossRefs`)
- Article shape (author/publisher/image, ISO 8601 dates)
- BreadcrumbList ordering
- Absolute URLs on primary nodes

**No existing pr-check rule** scans `buildSchemaContext` direct reads — this is net-new in PR1.

**No existing test infrastructure** for `ValidationFinding` shape — net-new (will be ~38 fixture migrations).

**Existing typed boundary** (`WorkspaceSchemaInput`, `PageMetaInput`) is clean and extensible — new fields land cleanly.

---

## 4. Infrastructure recommendations

### 4.1 Shared utilities (extract during PR1)

- **`SchemaValidationFinding` type** in `shared/types/schema-validation.ts` — used by validator (server) + frontend rendering (PR1) + completeness widget (PR2). Single source of truth.
- **`isImageObjectWithUrl()` helper** already exists in `validator.ts` from Pillar 1; reuse for `Article.image` shape check (no extraction needed).

### 4.2 pr-check rule (added in PR1)

Single new rule: **`schema-context-direct-read-not-on-allowlist`** in `scripts/pr-check.ts`. Models after the three matches in §2.5.

### 4.3 Test coverage additions

- 6 new template tests (one per new field × emit point). Estimated 60 LOC each.
- 1 new integration test: "workspace-wide `pageProfile` slice fetch happens once per generation pass, not 28 times" (perf regression guard).
- 1 new slice-migration unit test: "`buildSchemaContext` reads `siteKeywords` from `seoContext` slice mock with declined-keyword filter applied at schema layer."
- 38 existing test assertion migrations (per §2.1).

### 4.4 Root cause / systemic concerns

The schema feature accumulated direct workspace reads in `buildSchemaContext` over multiple iterations (lean rewrite, Pillar 2). The pattern was easy to extend ad-hoc, no mechanical pressure existed to migrate to slices. The new pr-check rule installs that pressure — net-new direct reads now require justification.

---

## 5. Parallelization strategy

PR1 has tight sequential dependencies (validator API change cascades through fixtures and consumers). **Most tasks must be sequential.** The plan should NOT attempt aggressive parallelization — it causes more conflict resolution than it saves.

### Phase 0 — Spec corrections (sequential, before any code)

- Update spec with the 4 corrections from §1 of this audit.
- Commit spec patch first.

### Phase 1 — Foundation (sequential, ~3 tasks)

1. Define `ValidationFinding` type in `shared/types/schema-validation.ts` (haiku — pure type definition).
2. Refactor `validateLeanSchema` to return `ValidationFinding[]`; update all 6 internal helpers to return findings instead of strings (sonnet — needs to thread typed shape through 6 functions consistently).
3. Update `LeanGeneratorOutput` to add `validationFindings` (typed) alongside `validationErrors` (backwards-compat string[]) (sonnet).

### Phase 2 — Test fixture migration (sequential, ~2 tasks)

4. Migrate `tests/unit/schema/validator.test.ts` (30 assertions) (sonnet — repetitive but needs care to preserve intent of each assertion).
5. Migrate the 1 integration test assertion (haiku).

### Phase 3 — Slice integration + new fields (parallel-safe within one task each, ~5 tasks)

These can run **conceptually in parallel** but they all touch `buildSchemaContext` (shared file), so dispatch sequentially. Each is small.

6. Add `Workspace.siteHasSearch` field + DB migration + Zod schema (haiku — mechanical).
7. Update `buildSchemaContext` to call `buildWorkspaceIntelligence({ slices: ['seoContext', 'pageProfile'], pagePath? })`; migrate `siteKeywords` direct read; add per-page `pageKeywords` map (sonnet — needs to thread the new pattern carefully + apply declined-keyword filter at schema layer per Correction 3).
8. Extend `WorkspaceSchemaInput` + `PageMetaInput` with new fields; extend `PageData` accordingly; update `extractPageData` (sonnet).
9. Add `knowsAbout` to `homepage.ts` + `local-business.ts` (haiku).
10. Add `areaServed` + `serviceType` to `service.ts` and `areaServed` to `local-business.ts` (haiku).
11. Add `keywords` to `article.ts`; add gated `potentialAction` to `homepage.ts` + `local-business.ts` (sonnet — gate logic).

### Phase 4 — Cleanup + forcing functions (parallel-safe, ~3 tasks)

12. Delete the 5 confirmed-dead `SchemaContext._*` fields (haiku — mechanical).
13. Add `schema-context-direct-read-not-on-allowlist` pr-check rule (sonnet — function-body brace-walk + allow-list).
14. Add CLAUDE.md paragraph + `data/roadmap.json:schema-context-builder-pattern-b-migration` entry (haiku).

### Phase 5 — Frontend rendering + verification (sequential, ~2 tasks)

15. Update `src/components/schema/SchemaPageCard.tsx` to render findings grouped by severity (red errors / amber warnings) (sonnet — JSX layout update).
16. Quality gates + integration test run + open PR (haiku — mechanical execution of CLAUDE.md checklist).

---

## 6. Model assignments

| Phase / Task type | Model | Reasoning |
|---|---|---|
| Type definitions (Phase 1.1) | haiku | Pure transcription from spec |
| Validator refactor (Phase 1.2) | sonnet | Threading typed shape through 6 helpers; needs consistency |
| Generator output extension (Phase 1.3) | sonnet | Backwards-compat field coexistence requires care |
| Test fixture migration (Phase 2) | sonnet | Mechanical but volume + intent preservation |
| siteHasSearch + DB migration (Phase 3.6) | haiku | Pure boilerplate |
| `buildSchemaContext` slice migration (Phase 3.7) | sonnet | Threads the slice pattern + applies declined-filter; subtle |
| Type extensions (Phase 3.8) | sonnet | Cross-file types must stay aligned |
| Field additions to templates (Phase 3.9-3.11) | haiku for simple emit, sonnet for gated potentialAction | Most are mechanical; gated emission needs judgment |
| Dead-code deletion (Phase 4.12) | haiku | Mechanical |
| pr-check rule (Phase 4.13) | sonnet | Function-body scanning + allow-list logic |
| CLAUDE.md + roadmap (Phase 4.14) | haiku | Pure transcription |
| Frontend rendering (Phase 5.15) | sonnet | JSX layout + Tailwind classes; needs aesthetic judgment |
| Quality gates / PR open (Phase 5.16) | haiku | Mechanical CLAUDE.md checklist |

**Reviewers per task** (per `superpowers:subagent-driven-development`): spec-compliance reviewer = opus, code-quality reviewer = opus.

---

## 7. Risks not yet captured in spec

- **Cache cold-start**: `buildWorkspaceIntelligence` first call per workspace can take seconds (assembles all requested slices). Schema generation might serialize this latency. Mitigation: integration test confirms one slice-fetch per generation pass (workspace-wide, not per-page).
- **Slice assembler crashes propagate**: if `buildWorkspaceIntelligence` throws (e.g. workspace has corrupt data), schema generation fails entirely. Today's `buildSchemaContext` reads are defensive (each in its own try/catch). Mitigation: wrap the slice call in try/catch with fallback to direct workspace reads (preserves today's resilience). Add to plan as defensive measure.
- **Pillar 2's existing `_serpFeatures` + `_backlinkReferringDomains`** already use `buildWorkspaceIntelligence({ slices: ['seoContext'] })`. The Phase 3.7 migration shouldn't double-call — refactor to combine into one call. Verify in implementation.

---

## 8. Verdict

The audit confirms PR1's scope is well-defined and tractable:
- 16 tasks, mostly sequential
- ~2 days of subagent-driven implementation as estimated in spec
- Three spec corrections required (above) — apply before plan-writing
- No surprises blocking the work
- Forcing functions (pr-check rule, CLAUDE.md, migration tracker) are the leverage that makes Trajectory 3 → 1 actually happen

**Plan-writing can proceed after the four spec corrections (§1) are applied to the design doc.**
