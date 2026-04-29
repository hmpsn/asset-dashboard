# Schema Yoast-Parity Fields PR1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six Yoast-baseline schema fields the platform already has data for, refactor the validator to a typed `ValidationFinding[]` API with a recommended/required tier system, and plant the slice-consumption migration pattern that locks `buildSchemaContext` onto a path toward Pattern B parity with the rest of the platform.

**Architecture:** Three layers in one PR. Layer 1 — typed boundary refactor in `server/schema/validator.ts` + `shared/types/schema-validation.ts`. Layer 2 — slice-migration starter in `server/helpers.ts:buildSchemaContext` reading two specific fields (`siteKeywords` and per-page `pageKeywords`) through `buildWorkspaceIntelligence`'s `seoContext` slice. Layer 3 — six new template fields wired through extended `WorkspaceSchemaInput`/`PageMetaInput` typed inputs. Forcing functions (pr-check rule + CLAUDE.md paragraph + roadmap entry) install the migration discipline.

**Tech Stack:** TypeScript strict, vitest (unit + integration), better-sqlite3 (one new migration: 078), `buildWorkspaceIntelligence({ slices: [...], pagePath? })` from `server/workspace-intelligence.ts` (5-min LRU cache), Cheerio (existing). No new dependencies.

**MVP scope (what this plan ships):** All six new fields (Service.areaServed + LocalBusiness.areaServed, Service.serviceType, Organization.knowsAbout, Article.keywords, gated WebSite.potentialAction). Validator refactored to return `ValidationFinding[]`; `LeanGeneratorOutput` carries both new typed `validationFindings` and backwards-compat `validationErrors: string[]`. `Workspace.siteHasSearch` field + DB migration shipped (admin UI toggle deferred to PR2). Two slice migrations land (`siteKeywords`, per-page `pageKeywords`). Five dead `SchemaContext._*` fields deleted. New pr-check rule + CLAUDE.md convention + roadmap entry committed.

**Out of scope (deferred, see spec §7):** PR2 (admin discoverability surfaces — completeness widget, BusinessProfileTab mirror, Logo URL microcopy, siteHasSearch toggle UI, enriched warning rendering). The remaining 5 `buildSchemaContext` legacy direct reads (`brandVoice`, `businessContext`, `knowledgeBase`, `_businessProfile`, `_personasBlock`) — opportunistically migrated per §6 of spec. Pillar 3 (compile-time + CI gates).

---

## Pre-requisites

- [x] Spec committed: `docs/superpowers/specs/2026-04-29-schema-yoast-parity-fields-design.md`
- [x] Pre-plan audit committed: `docs/superpowers/audits/2026-04-29-schema-yoast-parity-fields-audit.md`
- [x] Spec corrections applied (audit §1)
- [x] Branch `claude/schema-yoast-parity-fields` already created from latest staging; spec + audit + roadmap entry committed
- [ ] No additional shared contracts to pre-commit (the `ValidationFinding` type IS the shared contract; it ships in Task 1 before any consumer needs it)

---

## Task Dependencies

```
Phase 1 — Foundation (sequential):
  Task 1 (ValidationFinding type)
  → Task 2 (Validator refactor: returns ValidationFinding[])
  → Task 3 (LeanGeneratorOutput + leanToSuggestion: dual fields)

Phase 2 — Test fixture migration (sequential, must follow Phase 1):
  → Task 4 (validator.test.ts: 30 assertion migrations)
  → Task 5 (lean-schema-generator.test.ts: 1 assertion migration)

Phase 3 — Slice integration + new fields (sequential, all share buildSchemaContext or types):
  → Task 6 (Workspace.siteHasSearch field + migration 078)
  → Task 7 (buildSchemaContext slice migration: siteKeywords + per-page pageKeywords)
  → Task 8 (Extend WorkspaceSchemaInput/PageMetaInput/PageData; update extractPageData)
  → Task 9 (Templates: Organization.knowsAbout in homepage + local-business)
  → Task 10 (Templates: Service.areaServed/serviceType + LocalBusiness.areaServed)
  → Task 11 (Templates: Article.keywords + gated WebSite.potentialAction)

Phase 4 — Cleanup + forcing functions (parallel-safe; dispatch sequentially anyway since they share roadmap.json or similar):
  → Task 12 (Delete 5 dead SchemaContext._* fields)
  → Task 13 (pr-check rule)
  → Task 14 (CLAUDE.md paragraph + roadmap migration tracker entry)

Phase 5 — Frontend rendering + verification (sequential):
  → Task 15 (SchemaPageCard.tsx + SchemaSuggester.tsx render warnings)
  → Task 16 (Quality gates + open PR)

Phase 6 — Pre-existing test-failure investigation (sequential, runs after Task 16 lands):
  → Task 17 (Audit 8 pre-existing test failures, classify, file remediation roadmap entries)
```

**Why mostly sequential:** the validator API change cascades through fixtures and consumers. Audit §5 explicitly recommends not over-parallelizing — conflicts cost more than the saved time. Phase 6 is appended as a follow-up investigation only — output is an audit doc + roadmap entries, no production code changes.

## Model Assignments

| Task | Model | Rationale |
|---|---|---|
| 1 ValidationFinding type | haiku | Pure type definition transcribed from spec |
| 2 Validator refactor | sonnet | Threading typed shape through 6 helpers; consistency-critical |
| 3 LeanGeneratorOutput dual fields | sonnet | Backwards-compat coexistence requires care |
| 4 validator.test.ts migration | sonnet | 30 assertion edits — mechanical but volume + intent preservation |
| 5 lean-schema-generator.test.ts migration | haiku | 1 assertion edit |
| 6 siteHasSearch field + migration | haiku | Boilerplate (mimics existing `siteIntelligenceClientView`) |
| 7 buildSchemaContext slice migration | sonnet | Threads new pattern + must preserve declined-keyword filter at schema layer |
| 8 Extend Workspace/PageMeta/PageData types | sonnet | Cross-file types must stay aligned |
| 9 Organization.knowsAbout in 2 templates | haiku | Mechanical |
| 10 Service.areaServed/serviceType + LocalBusiness.areaServed | haiku | Mechanical |
| 11 Article.keywords + gated WebSite.potentialAction | sonnet | Gating logic + 2 emit sites |
| 12 Delete dead `_*` fields | haiku | Mechanical |
| 13 pr-check rule | sonnet | Function-body scanning + allow-list logic |
| 14 CLAUDE.md + roadmap | haiku | Pure transcription |
| 15 Frontend warning rendering | sonnet | JSX layout + Tailwind classes |
| 16 Quality gates + PR | haiku | CLAUDE.md checklist execution |

Reviewers (per task): spec-compliance reviewer = opus, code-quality reviewer = opus.

---

## File Map

### New files

| Path | Lines (est) | Responsibility |
|---|---|---|
| `shared/types/schema-validation.ts` | ~30 | `ValidationFinding` discriminated interface (the typed boundary). |
| `server/db/migrations/078-workspace-site-has-search.sql` | ~10 | Adds `site_has_search` INTEGER column to `workspaces` table. |
| `tests/unit/helpers.buildSchemaContext.test.ts` | ~80 | Slice-migration regression test: confirms `siteKeywords` reads from slice mock; declined-keyword filter applied at schema layer. |

### Modified files

| Path | Modification |
|---|---|
| `server/schema/validator.ts` | Tasks 2 + extend `RequiredFields` to `{ required, recommended }`; all 6 helpers return `ValidationFinding[]` instead of `string[]`. |
| `server/schema/generator.ts` | Task 3: add `validationFindings: ValidationFinding[]` to `LeanGeneratorOutput`; keep `validationErrors: string[]` (severity=error filtered, message-only). |
| `server/schema-suggester.ts` | Tasks 3 + 12: `leanToSuggestion` passthrough + add `validationFindings` field; delete 5 dead `SchemaContext._*` fields. |
| `server/helpers.ts` | Task 7: `buildSchemaContext` calls `buildWorkspaceIntelligence({ slices: ['seoContext'], pagePath? })`; migrates `siteKeywords` to slice; populates per-page `pageKeywords` from intel.seoContext.pageKeywords; preserves declined-keyword filter. |
| `server/schema/data-sources.ts` | Task 8: extend `WorkspaceSchemaInput` (`siteKeywordsForKnowsAbout?: string[]`); extend `PageMetaInput` (`pageKeywords?: { primary, secondary[] }`); extend `PageData` accordingly; update `extractPageData`. |
| `server/schema/templates/homepage.ts` | Tasks 9 + 11: add `knowsAbout` to Organization primary; add gated `potentialAction` to WebSite. |
| `server/schema/templates/local-business.ts` | Tasks 9 + 10 + 11: add `knowsAbout` to Organization sibling; add `areaServed` to LocalBusiness primary; add gated `potentialAction` to WebSite sibling. |
| `server/schema/templates/service.ts` | Task 10: add `areaServed` + `serviceType` to Service. |
| `server/schema/templates/article.ts` | Task 11: add `keywords` to Article + BlogPosting (single function `buildArticleSchema`). |
| `shared/types/workspace.ts` | Task 6: add `siteHasSearch?: boolean`. |
| `server/workspaces.ts` | Task 6: add `site_has_search` to `WorkspaceRow`, `rowToWorkspace`, `workspaceToParams`, `updateWorkspace` Pick<>. |
| `server/schemas/workspace-schemas.ts` | Task 6: extend Zod schema. |
| `tests/unit/schema/validator.test.ts` | Task 4: 30 `toContain('string')` → `toContainEqual({ ruleId, ... })`; 2 string-filter migrations. |
| `tests/unit/schema/templates.test.ts` | Tasks 9–11: 6 new tests for new fields (no existing tests need migration — all use `toEqual([])`). |
| `tests/integration/lean-schema-generator.test.ts` | Tasks 5 + 7: 1 substring filter → typed filter; new test for slice fetch dedup. |
| `scripts/pr-check.ts` | Task 13: add `schema-context-direct-read-not-on-allowlist` rule. |
| `CLAUDE.md` | Task 14: add convention paragraph under "Code Conventions". |
| `data/roadmap.json` | Task 14: add `schema-context-builder-pattern-b-migration` entry. Task 16: mark `schema-yoast-parity-fields-pr1` as done. |
| `FEATURE_AUDIT.md` | Task 16: append entry for parity-fields PR1. |
| `src/components/schema/SchemaPageCard.tsx` | Task 15: render `validationFindings` grouped by severity (errors red, warnings amber). |
| `src/components/SchemaSuggester.tsx` | Task 15: header stat reads `findings.filter(severity === 'warning').length`. |

### Files left untouched

- All other templates (`static.ts`) — no new fields apply.
- All other validators except `validateLeanSchema` — backwards-compat `validateForGoogleRichResults` (legacy) keeps its `string[]` return.
- All non-schema features (chat, briefs, content decay, etc.) — no consumers of `validationErrors` outside schema.

---

## Tasks

### Task 1: Create `ValidationFinding` shared type (haiku)

**Files:**
- Create: `shared/types/schema-validation.ts`

- [ ] **Step 1: Create `shared/types/schema-validation.ts`**

```typescript
/**
 * Typed validation findings emitted by the lean schema validator.
 *
 * Replaces the prior `string[]` return shape so consumers can filter by
 * severity, group by @type, deep-link to specific fields (PR2 completeness
 * widget), and integrate with future shape validators (e.g. schemarama in
 * Pillar 3) without re-parsing string messages.
 */
export interface ValidationFinding {
  /** error: schema is malformed or missing required Google rich-result data.
   *  warning: recommended-tier field missing; schema is still valid. */
  severity: 'error' | 'warning';
  /** Schema.org @type of the affected node, e.g. "Article", "BlogPosting", "BreadcrumbList". */
  type: string;
  /** Missing or malformed field (e.g. "publisher.logo", "image", "datePublished").
   *  Undefined for whole-graph issues like "missing @context". */
  field?: string;
  /** Stable rule id for filtering, disable lists, and future pr-check parity.
   *  Example values: "required-field-missing", "publisher-logo-shape", "iso-8601-date",
   *  "absolute-url", "breadcrumb-position-ordering". */
  ruleId: string;
  /** Human-readable message for admin UI rendering. */
  message: string;
}
```

- [ ] **Step 2: Verify file is parseable**

Run: `npx tsc --noEmit shared/types/schema-validation.ts`
Expected: zero output (passes).

- [ ] **Step 3: Commit**

```bash
git add shared/types/schema-validation.ts
git commit -m "$(cat <<'EOF'
feat(schema): add ValidationFinding shared type

Discriminated finding shape replaces the validator's prior string[]
return contract. Carries severity, type (@type), field?, ruleId, message.
Consumed by validator (server), generator output (server), frontend
rendering (PR1), completeness widget (PR2), and Pillar 3 schemarama
integration when reactivated.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Refactor validator to return `ValidationFinding[]` (sonnet)

**Files:**
- Modify: `server/schema/validator.ts`

The 6 internal helpers (`validateBreadcrumb`, `validateCrossRefs`, `isImageObjectWithUrl`, `validateArticleShape`, `validateLocalBusinessShape`, `validateBreadcrumbOrdering`, `validateAbsoluteUrls`) all currently return `string[]`. They must return `ValidationFinding[]`. The exported `validateLeanSchema` returns `ValidationFinding[]` instead of `string[]`.

`RequiredFields` interface gets a `recommended: string[]` field. PR1 leaves all `recommended` arrays empty (Pillar 1 already classifies fields correctly between required and recommended via the dropped `Organization.logo`, `LocalBusiness.address`, `LocalBusiness.telephone` removals); the recommended tier exists in code but is not actively used until the parity-field validator additions in Task 11.

- [ ] **Step 1: Rewrite the validator file**

Read the current file: `server/schema/validator.ts`. Apply these changes:

1. Add `import type { ValidationFinding } from '../../shared/types/schema-validation.js';` at the top (alongside existing imports).

2. Change `RequiredFields` interface to:

```typescript
interface RequiredFields {
  required: string[];
  /** Recommended fields surface as warnings (severity='warning') when missing. */
  recommended?: string[];
}
```

3. Each helper function changes its signature from `string[]` to `ValidationFinding[]`, and each `errors.push(...)` becomes a structured object. Example transformation for `validateBreadcrumb`:

```typescript
function validateBreadcrumb(node: Record<string, unknown>): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const items = node.itemListElement as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(items)) {
    findings.push({
      severity: 'error',
      type: 'BreadcrumbList',
      field: 'itemListElement',
      ruleId: 'breadcrumb-itemlist-shape',
      message: 'BreadcrumbList missing itemListElement array',
    });
    return findings;
  }
  for (const item of items) {
    if (typeof item.position !== 'number') {
      findings.push({
        severity: 'error',
        type: 'BreadcrumbList',
        field: 'itemListElement.position',
        ruleId: 'breadcrumb-listitem-position-missing',
        message: 'BreadcrumbList ListItem missing position',
      });
    }
    if (typeof item.name !== 'string' || !item.name.trim()) {
      findings.push({
        severity: 'error',
        type: 'BreadcrumbList',
        field: 'itemListElement.name',
        ruleId: 'breadcrumb-listitem-name-missing',
        message: 'BreadcrumbList ListItem missing name',
      });
    }
    if (typeof item.item !== 'string' || !item.item.trim()) {
      findings.push({
        severity: 'error',
        type: 'BreadcrumbList',
        field: 'itemListElement.item',
        ruleId: 'breadcrumb-listitem-item-missing',
        message: 'BreadcrumbList ListItem missing item URL',
      });
    }
  }
  return findings;
}
```

Apply the same pattern to the other helpers, preserving message text exactly so that frontend renderers don't lose information. Use these `ruleId` values (kept stable across helpers):

- `validateCrossRefs` → `cross-ref-ispartof-shape`, `cross-ref-breadcrumb-shape`, `cross-ref-breadcrumb-dangling`, `cross-ref-mainentityofpage-shape`
- `validateArticleShape` → `article-author-shape`, `article-author-type-invalid`, `article-author-name-missing`, `article-publisher-not-object`, `article-publisher-type-missing`, `article-publisher-name-missing`, `article-publisher-logo-missing`, `article-publisher-logo-not-imageobject`, `article-publisher-logo-url-missing`, `article-image-shape-invalid`, `article-image-array-item-shape`, `article-image-imageobject-url-missing`, `article-date-iso8601`
- `validateLocalBusinessShape` → `localbusiness-address-not-object`, `localbusiness-address-type-invalid`, `localbusiness-address-no-locator`
- `validateBreadcrumbOrdering` → `breadcrumb-position-ordering`
- `validateAbsoluteUrls` → `url-must-be-absolute`

4. Rewrite the main `validateLeanSchema` per-node loop to push findings instead of strings. The required-vs-recommended split lives here:

```typescript
export function validateLeanSchema(schema: Record<string, unknown>, _primaryType: string): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (schema['@context'] !== 'https://schema.org') {
    findings.push({
      severity: 'error',
      type: '@graph',
      ruleId: 'context-missing',
      message: 'Schema missing @context',
    });
  }
  const graph = schema['@graph'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(graph)) {
    findings.push({
      severity: 'error',
      type: '@graph',
      ruleId: 'graph-missing',
      message: 'Schema missing @graph array',
    });
    return findings;
  }

  // Duplicate @type detection — at most one node per @type, except ListItem.
  const typeCounts = new Map<string, number>();
  for (const node of graph) {
    const t = node['@type'] as string;
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
  }
  for (const [t, count] of typeCounts) {
    if (count > 1 && t !== 'ListItem') {
      findings.push({
        severity: 'error',
        type: t,
        ruleId: 'duplicate-type',
        message: `Duplicate @type in @graph: ${t} (lean output must emit exactly one primary node + optional BreadcrumbList)`,
      });
    }
  }

  for (const node of graph) {
    const t = node['@type'] as string;
    const rules = REQUIRED_BY_TYPE[t];
    if (rules) {
      for (const field of rules.required) {
        if (node[field] === undefined || node[field] === null) {
          findings.push({
            severity: 'error',
            type: t,
            field,
            ruleId: 'required-field-missing',
            message: `${t} missing required field: ${field}`,
          });
        }
      }
      for (const field of rules.recommended ?? []) {
        if (node[field] === undefined || node[field] === null) {
          findings.push({
            severity: 'warning',
            type: t,
            field,
            ruleId: 'recommended-field-missing',
            message: `${t} missing recommended field: ${field}`,
          });
        }
      }
    }
    if (t === 'BreadcrumbList') {
      findings.push(...validateBreadcrumb(node));
    }
    findings.push(...validateCrossRefs(node, graph));
    findings.push(...validateArticleShape(node));
    findings.push(...validateLocalBusinessShape(node));
    findings.push(...validateBreadcrumbOrdering(node));
    findings.push(...validateAbsoluteUrls(node));
  }

  return findings;
}
```

- [ ] **Step 2: Run typecheck — confirm validator file compiles cleanly**

Run: `npm run typecheck`
Expected: 30+ errors at consumer sites (`generator.ts`, `validator.test.ts`, etc.) where they expected `string[]`. The validator file itself should be clean.

- [ ] **Step 3: Commit (broken state — consumers fixed in Tasks 3-5)**

```bash
git add server/schema/validator.ts
git commit -m "$(cat <<'EOF'
refactor(schema): validateLeanSchema returns ValidationFinding[] (Pillar parity)

All 6 helpers and the main function now emit typed ValidationFinding objects
instead of strings. RequiredFields gains a recommended array (currently empty
for all types; populated by Task 11 when parity-field validator entries land).

Compile breaks at consumer sites intentionally; Tasks 3-5 fix them.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Update `LeanGeneratorOutput` and `leanToSuggestion` for dual-field shape (sonnet)

**Files:**
- Modify: `server/schema/generator.ts`
- Modify: `server/schema-suggester.ts`

`LeanGeneratorOutput` adds `validationFindings: ValidationFinding[]` (typed) and keeps `validationErrors: string[]` (the legacy field, now derived from `validationFindings.filter(severity === 'error').map(message)` — backwards-compat for snapshot storage).

- [ ] **Step 1: Update `server/schema/generator.ts`**

Add the import:
```typescript
import type { ValidationFinding } from '../../shared/types/schema-validation.js';
```

Update the `LeanGeneratorOutput` interface:
```typescript
export interface LeanGeneratorOutput {
  pageId: string;
  pageTitle: string;
  slug: string;
  url: string;
  existingSchemas: string[];
  suggestedSchemas: Array<{
    type: string;
    reason: string;
    priority: 'high' | 'medium' | 'low';
    template: Record<string, unknown>;
  }>;
  /** Typed validation findings — preferred consumer surface (PR2 completeness widget reads this). */
  validationFindings?: ValidationFinding[];
  /** Backwards-compat: severity=error findings flattened to messages. Snapshot storage + legacy frontend consume this. */
  validationErrors?: string[];
}
```

In the function body, where `validateLeanSchema` is called (around lines 179, 197, 207), the variable previously named `validationErrors` is now `validationFindings`. Build both fields:

```typescript
// Existing line 179 area:
const validationFindings = validateLeanSchema(schema, classified.primaryType);
// ...same for retry blocks at lines 197, 207...

// At line 230 in the return:
return {
  pageId: input.pageId,
  // ... existing fields ...
  validationFindings: validationFindings.length > 0 ? validationFindings : undefined,
  validationErrors: validationFindings.length > 0
    ? validationFindings.filter(f => f.severity === 'error').map(f => f.message)
    : undefined,
};
```

Note: `validationErrors` only contains severity=error messages, NOT warnings. This preserves the prior semantic ("validationErrors means schema is broken").

- [ ] **Step 2: Update `server/schema-suggester.ts`**

Find `SchemaPageSuggestion` interface (around line 20-50). Add `validationFindings?: ValidationFinding[];`:

```typescript
import type { ValidationFinding } from '../shared/types/schema-validation.js';

export interface SchemaPageSuggestion {
  // ... existing fields ...
  validationErrors?: string[];
  validationFindings?: ValidationFinding[];
}
```

Find `leanToSuggestion` (around line 280). Update to pass through both:

```typescript
function leanToSuggestion(lean: LeanGeneratorOutput): SchemaPageSuggestion {
  return {
    // ... existing fields ...
    validationErrors: lean.validationErrors,
    validationFindings: lean.validationFindings,
  };
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck 2>&1 | grep -E "validator\.ts|generator\.ts|schema-suggester\.ts"`
Expected: zero errors from these files. (Test files still error — fixed in Tasks 4–5.)

- [ ] **Step 4: Commit**

```bash
git add server/schema/generator.ts server/schema-suggester.ts
git commit -m "$(cat <<'EOF'
feat(schema): LeanGeneratorOutput emits validationFindings + validationErrors

validationFindings (typed, preferred): all severities for new consumers.
validationErrors (string[], backwards-compat): severity=error messages
flattened. Snapshot storage and legacy frontend continue reading the
flattened form. PR2 completeness widget reads typed findings.

leanToSuggestion passes both fields through SchemaPageSuggestion.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Migrate `tests/unit/schema/validator.test.ts` assertions (sonnet)

**Files:**
- Modify: `tests/unit/schema/validator.test.ts`

Per audit §2.1: 30 assertions need migration. The `toEqual([])` empty-array checks (6) stay unchanged. Migrate `toContain('string')` to `toContainEqual({ ruleId, type, field?, severity? })`. Migrate `.find(e => e.includes(...))` and `.find(e => e === ...)` to typed filters.

- [ ] **Step 1: Read the current file**

Read `tests/unit/schema/validator.test.ts` in full. Identify every assertion line per audit §2.1.

- [ ] **Step 2: Migrate each assertion using these rules**

Pattern A — `toContain('exact string')` → `toContainEqual({ ruleId, ... })`. Match by ruleId from Task 2's helper code. Example transformation for line 43:

Before:
```typescript
expect(validateLeanSchema(schema, 'BlogPosting')).toContain('BlogPosting missing required field: headline');
```

After:
```typescript
expect(validateLeanSchema(schema, 'BlogPosting')).toContainEqual(
  expect.objectContaining({
    severity: 'error',
    type: 'BlogPosting',
    field: 'headline',
    ruleId: 'required-field-missing',
  }),
);
```

For non-required-field assertions (cross-ref, shape, etc.), use the corresponding ruleId. Example for line 251 (cross-ref):

Before:
```typescript
expect(validateLeanSchema(broken, 'WebPage')).toContain('WebPage.isPartOf must be an @id reference (e.g. {"@id": "...#website"})');
```

After:
```typescript
expect(validateLeanSchema(broken, 'WebPage')).toContainEqual(
  expect.objectContaining({
    severity: 'error',
    type: 'WebPage',
    field: 'isPartOf',
    ruleId: 'cross-ref-ispartof-shape',
  }),
);
```

Pattern B — `.find(e => e.includes('logo'))` → `.find(f => f.field?.includes('logo'))`. Example for line 226:

Before:
```typescript
const errors = validateLeanSchema(org, 'Organization');
expect(errors.find(e => e.includes('logo'))).toBeUndefined();
```

After:
```typescript
const findings = validateLeanSchema(org, 'Organization');
expect(findings.find(f => f.field?.includes('logo') || f.message.includes('logo'))).toBeUndefined();
```

Pattern C — `.find(e => e === 'exact string')` → typed match. Example for line 235:

Before:
```typescript
expect(errors.find(e => e === 'LocalBusiness missing required field: address')).toBeUndefined();
```

After:
```typescript
expect(findings.find(f => f.type === 'LocalBusiness' && f.field === 'address' && f.ruleId === 'required-field-missing')).toBeUndefined();
```

The 6 `toEqual([])` assertions stay untouched — empty array means no findings of any severity, which is still the correct success condition for a clean schema.

Apply these patterns to all 30 affected assertions per audit §2.1 line numbers. Preserve the test descriptions verbatim — no test names change.

- [ ] **Step 3: Run the validator test file**

Run: `npx vitest run tests/unit/schema/validator.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/schema/validator.test.ts
git commit -m "$(cat <<'EOF'
test(schema): migrate validator.test.ts to ValidationFinding shape (Task 4)

30 assertions migrated: toContain('string') → toContainEqual({ ruleId, ... })
+ 2 string-filter assertions → typed-field filters. The 6 toEqual([])
empty-array checks unchanged (empty array still means no findings).

Test descriptions preserved verbatim. Schema-test suite green.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migrate the integration test substring filter (haiku)

**Files:**
- Modify: `tests/integration/lean-schema-generator.test.ts`

Per audit §2.1: 1 assertion (`out.validationErrors!.some(e => e.includes('datePublished'))`).

Per Task 3, `validationErrors: string[]` IS still populated (severity=error messages flattened). So `out.validationErrors!.some(e => e.includes('datePublished'))` still works as-is.

But for clarity and to take advantage of the new typed surface, migrate it to read `validationFindings`:

- [ ] **Step 1: Find and update line 151–152**

Before:
```typescript
expect(out.validationErrors!.some(e => e.includes('datePublished'))).toBe(true);
```

After:
```typescript
expect(out.validationFindings!.some(f => f.field === 'datePublished')).toBe(true);
```

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run tests/integration/lean-schema-generator.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/lean-schema-generator.test.ts
git commit -m "$(cat <<'EOF'
test(schema): migrate integration test datePublished assertion to typed filter

One assertion: out.validationErrors!.some(e =&gt; e.includes('datePublished'))
→ out.validationFindings!.some(f =&gt; f.field === 'datePublished').

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Add `Workspace.siteHasSearch` field (haiku)

**Files:**
- Create: `server/db/migrations/078-workspace-site-has-search.sql`
- Modify: `shared/types/workspace.ts`
- Modify: `server/workspaces.ts`
- Modify: `server/schemas/workspace-schemas.ts`

Mimics the existing `siteIntelligenceClientView` pattern.

- [ ] **Step 1: Create migration file**

Create `server/db/migrations/078-workspace-site-has-search.sql`:

```sql
-- 078-workspace-site-has-search.sql
-- Adds siteHasSearch flag to workspaces. When true, schema generation emits
-- WebSite.potentialAction (sitelinks SearchAction). Default 0 (false) so
-- existing workspaces don't suddenly emit the action without admin opt-in.
-- Tracked: schema-yoast-parity-fields PR1.

ALTER TABLE workspaces ADD COLUMN site_has_search INTEGER DEFAULT 0;
```

- [ ] **Step 2: Update `shared/types/workspace.ts`**

Find the `Workspace` interface. Add the field near other boolean flags (around line 230 alongside `siteIntelligenceClientView`):

```typescript
  /** When true, schema generation emits WebSite.potentialAction (sitelinks SearchAction).
   *  Site must actually expose ?s={query} or equivalent search endpoint. */
  siteHasSearch?: boolean;
```

- [ ] **Step 3: Update `server/workspaces.ts`**

Three locations need updating, mimicking the `site_intelligence_client_view` pattern:

(a) `WorkspaceRow` interface (around line 90):
```typescript
  site_has_search: number | null;
```

(b) `rowToWorkspace` (around line 215):
```typescript
  if (row.site_has_search != null) ws.siteHasSearch = !!row.site_has_search;
```

(c) `workspaceToParams` (around line 327):
```typescript
    site_has_search: ws.siteHasSearch === undefined ? null : (ws.siteHasSearch ? 1 : 0),
```

(d) The INSERT statement (around line 274) needs `@site_has_search` parameter and the `INSERT INTO workspaces (...)` column list around line 264 needs `site_has_search`.

(e) `updateWorkspace` Pick<> at the bottom (around line 418): add `'siteHasSearch'` to the union.

(f) The camel→snake mapping object (around line 438): add `siteHasSearch: 'site_has_search'`.

- [ ] **Step 4: Update `server/schemas/workspace-schemas.ts`**

Find the workspace schema. Add `siteHasSearch: z.boolean().optional()` alongside other booleans.

- [ ] **Step 5: Run migrations + typecheck**

Run: `npm run typecheck`
Expected: zero errors from these files.

(The migration runs automatically on next dev-server start; manual run not required for typecheck.)

- [ ] **Step 6: Run unit tests for workspace mapping**

Run: `npx vitest run tests/unit/row-mapper-completeness.test.ts`
Expected: PASS — the new column maps correctly to a camelCase Workspace field.

- [ ] **Step 7: Commit**

```bash
git add server/db/migrations/078-workspace-site-has-search.sql shared/types/workspace.ts server/workspaces.ts server/schemas/workspace-schemas.ts
git commit -m "$(cat <<'EOF'
feat(schema): add Workspace.siteHasSearch field (gates SearchAction emission)

Migration 078 adds site_has_search INTEGER column (default 0). Workspace
type, row mapper, params builder, updateWorkspace Pick&lt;&gt; all extended.
PR2 will add the admin toggle UI in the Settings → Features tab; PR1 ships
the field+plumbing only so existing workspaces default to false (no
behavioral change to emitted schema until admin opts in).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Migrate `buildSchemaContext` to slice consumption for `siteKeywords` + per-page `pageKeywords` (sonnet)

**Files:**
- Modify: `server/helpers.ts`
- Create: `tests/unit/helpers.buildSchemaContext.test.ts`

Per spec §4.4 (corrected by audit Correction 3): the slice does NOT apply the declined-keyword filter. Schema layer must continue calling `getDeclinedKeywords(ws.id)` and applying the filter post-slice.

Per audit Correction 4: `Article.keywords` reads from `intel.seoContext.pageKeywords` (a `PageKeywordMap`), populated when `buildWorkspaceIntelligence` is called with `opts.pagePath`.

- [ ] **Step 1: Write a failing unit test**

Create `tests/unit/helpers.buildSchemaContext.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: vi.fn(),
}));

vi.mock('../../server/keyword-feedback.js', () => ({
  getDeclinedKeywords: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/workspaces.js', () => ({
  listWorkspaces: vi.fn().mockReturnValue([]),
}));

import { buildSchemaContext } from '../../server/helpers.js';
import { buildWorkspaceIntelligence } from '../../server/workspace-intelligence.js';
import { getDeclinedKeywords } from '../../server/keyword-feedback.js';

describe('buildSchemaContext — slice migration (Pillar B starter)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('reads siteKeywords from intel.seoContext.strategy.siteKeywords (not direct ws read)', async () => {
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue({
      seoContext: {
        strategy: { siteKeywords: ['from-slice-1', 'from-slice-2', 'from-slice-3'] },
        brandVoice: '',
        effectiveBrandVoiceBlock: '',
        businessContext: '',
        personas: [],
        knowledgeBase: '',
      } as never,
    } as never);

    // Mock workspace lookup
    const mockWs = {
      id: 'ws_test',
      name: 'Test',
      keywordStrategy: { siteKeywords: ['LEGACY-DIRECT-READ'] }, // should NOT appear in result
    } as never;
    vi.mocked((await import('../../server/workspaces.js')).listWorkspaces).mockReturnValue([mockWs]);

    const { ctx } = await buildSchemaContext('site_test_123');

    // Slice value present, legacy direct value absent.
    expect(ctx.siteKeywords).toEqual(['from-slice-1', 'from-slice-2', 'from-slice-3']);
    expect(ctx.siteKeywords).not.toContain('LEGACY-DIRECT-READ');
  });

  it('applies declined-keyword filter at schema layer (slice does NOT apply it per audit Correction 3)', async () => {
    vi.mocked(buildWorkspaceIntelligence).mockResolvedValue({
      seoContext: {
        strategy: { siteKeywords: ['keep-this', 'declined-this', 'keep-that'] },
        brandVoice: '',
        effectiveBrandVoiceBlock: '',
        businessContext: '',
        personas: [],
        knowledgeBase: '',
      } as never,
    } as never);

    vi.mocked(getDeclinedKeywords).mockReturnValue(['declined-this']);

    const mockWs = { id: 'ws_test', name: 'Test', keywordStrategy: { siteKeywords: [] } } as never;
    vi.mocked((await import('../../server/workspaces.js')).listWorkspaces).mockReturnValue([mockWs]);

    const { ctx } = await buildSchemaContext('site_test_123');

    expect(ctx.siteKeywords).toEqual(['keep-this', 'keep-that']);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

Run: `npx vitest run tests/unit/helpers.buildSchemaContext.test.ts`
Expected: FAIL — `buildSchemaContext` still reads `ws.keywordStrategy?.siteKeywords` directly.

- [ ] **Step 3: Update `server/helpers.ts:buildSchemaContext`**

Read the function (around line 319 onwards). Apply these targeted changes:

(a) Add the import alongside existing imports at the top:
```typescript
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
```

(b) Inside `buildSchemaContext`, after the workspace lookup but before any direct `siteKeywords` read, add the slice fetch:

```typescript
// Slice-migration starter (Trajectory 3 → 1; tracked in
// data/roadmap.json:schema-context-builder-pattern-b-migration).
// PR1 migrates `siteKeywords` and per-page `pageKeywords` to slice consumption.
// Other direct reads in this function are tracked for opportunistic migration.
const intel = await buildWorkspaceIntelligence(ws.id, { slices: ['seoContext'] });
```

(c) Find the existing `siteKeywords` direct-read block:
```typescript
const rawSiteKeywords = ws.keywordStrategy?.siteKeywords;
if (rawSiteKeywords?.length) {
  const declined = getDeclinedKeywords(ws.id);
  if (declined.length > 0) {
    const declinedSet = new Set(declined.map(k => k.toLowerCase()));
    ctx.siteKeywords = rawSiteKeywords.filter(k => !declinedSet.has(k.toLowerCase()));
  } else {
    ctx.siteKeywords = rawSiteKeywords;
  }
}
```

Replace with the slice-consumed version (preserving the declined-filter at the schema layer):
```typescript
const rawSiteKeywords = intel.seoContext?.strategy?.siteKeywords;
if (rawSiteKeywords?.length) {
  // Audit Correction 3: slice does NOT apply the declined filter — schema layer must.
  const declined = getDeclinedKeywords(ws.id);
  if (declined.length > 0) {
    const declinedSet = new Set(declined.map(k => k.toLowerCase()));
    ctx.siteKeywords = rawSiteKeywords.filter(k => !declinedSet.has(k.toLowerCase()));
  } else {
    ctx.siteKeywords = rawSiteKeywords;
  }
}
```

(d) Add a per-page `pageKeywords` populator OUTSIDE the function (in the calling code in `server/schema-suggester.ts`, see below) — but `buildSchemaContext` itself must expose enough information for the per-page loop to call `buildWorkspaceIntelligence({ slices: ['seoContext'], pagePath })` cheaply. The 5-min LRU cache makes per-page calls inexpensive.

In `server/schema-suggester.ts`, find `generateSchemaSuggestions` per-page loop (around line 376 and the CMS loop around line 405). For each page, before calling `generateLeanSchema`, fetch per-page intelligence and add `pageKeywords` to `pageMeta`:

```typescript
// In generateSchemaSuggestions per-page loops, before generateLeanSchema call:
const perPageIntel = ctx.workspaceId
  ? await buildWorkspaceIntelligence(ctx.workspaceId, { slices: ['seoContext'], pagePath: page.publishedPath })
  : null;
const pageKeywords = perPageIntel?.seoContext?.pageKeywords
  ? {
      primary: (perPageIntel.seoContext.pageKeywords.primaryKeyword as string) || '',
      secondary: (perPageIntel.seoContext.pageKeywords.secondaryKeywords as string[] | undefined) || [],
    }
  : undefined;

const lean = await generateLeanSchema({
  pageId: page.id,
  pageMeta: {
    title: page.title || '',
    slug: page.slug || '',
    publishedPath: page.publishedPath || (page.slug ? `/${page.slug}` : '/'),
    seo: page.seo,
    pageKeywords, // NEW
  },
  // ...rest unchanged...
});
```

Apply the same pattern to the CMS loop at line 405. The 5-min cache means duplicate fetches across the per-page loop are cheap (single-flight dedup).

- [ ] **Step 4: Run unit test**

Run: `npx vitest run tests/unit/helpers.buildSchemaContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Run wider schema test suite**

Run: `npx vitest run tests/unit/schema tests/integration/lean-schema-generator.test.ts`
Expected: PASS — slice migration is non-behavioural for current consumers (siteKeywords still produces same final value).

- [ ] **Step 6: Commit**

```bash
git add server/helpers.ts server/schema-suggester.ts tests/unit/helpers.buildSchemaContext.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): migrate siteKeywords + per-page pageKeywords to seoContext slice

buildSchemaContext now reads ws.keywordStrategy.siteKeywords via
intel.seoContext.strategy.siteKeywords (slice consumption — Trajectory 3 →
Trajectory 1 migration starter). Declined-keyword filter still applied at
schema layer per audit Correction 3 (slice does not apply the filter).

Per-page schema generation in generateSchemaSuggestions now fetches
intel.seoContext.pageKeywords (PageKeywordMap, populated when pagePath is
passed) and threads { primary, secondary[] } through PageMetaInput.pageKeywords.
5-min LRU cache + single-flight dedup makes per-page slice calls cheap.

This is the first of 6 migrations queued under
data/roadmap.json:schema-context-builder-pattern-b-migration. The new
pr-check rule (Task 13) will fire on any future direct read added to
buildSchemaContext outside the identity allow-list.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Extend typed boundaries (`WorkspaceSchemaInput`/`PageMetaInput`/`PageData`) (sonnet)

**Files:**
- Modify: `server/schema/data-sources.ts`

Add the new fields to the typed boundary; thread them through `extractPageData`.

- [ ] **Step 1: Update interfaces in `server/schema/data-sources.ts`**

Find `PageMetaInput` (around line 8). Add new field:
```typescript
  /** Per-page keyword strategy from seoContext slice. Populated when buildWorkspaceIntelligence
   *  is called with opts.pagePath. Drives Article.keywords schema field emission. */
  pageKeywords?: { primary: string; secondary: string[] };
```

Find `WorkspaceSchemaInput` (around line 20). Add:
```typescript
  /** Top-N siteKeywords (deduped, lowercased, declined-filter applied) for Organization.knowsAbout emission. */
  siteKeywordsForKnowsAbout?: string[];
```

Find `PageData` (around line 41). Add:
```typescript
  /** Comma-joined keywords string for Article.keywords schema field. Empty when no pageMap entry. */
  keywords?: string;
  /** AreaServed value derived from BusinessProfile.address.city/state for Service+LocalBusiness. */
  areaServed?: string;
  /** ServiceType derived from URL slug for Service template. */
  serviceType?: string;
  /** Top-N siteKeywords for Organization.knowsAbout — passed through from workspace. */
  knowsAbout?: string[];
```

- [ ] **Step 2: Update `extractPageData` to populate the new fields**

Add helper functions before `extractPageData`:

```typescript
/** Capitalize a slug segment for human-readable output. */
function capitalizeSlugSegment(slug: string): string {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Derive the leaf URL slug (e.g. "/services/development" → "development"). */
function leafSlug(publishedPath: string): string | undefined {
  const segs = publishedPath.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  if (segs.length === 0) return undefined;
  return segs[segs.length - 1];
}

/** Format a Place name for areaServed. Returns "City, State" when both present, "City" or "State" if only one, undefined if neither. */
function formatAreaServed(address: { city?: string; state?: string } | undefined): string | undefined {
  if (!address) return undefined;
  const city = address.city?.trim();
  const state = address.state?.trim();
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  if (state) return state;
  return undefined;
}
```

Update the `extractPageData` function body to compute the new PageData fields:

```typescript
export function extractPageData(input: ExtractInput): PageData {
  // ... existing logic computing title, cleanTitle, description, image, dates, breadcrumbs ...

  // Derive Article.keywords (comma-joined) from per-page keywords.
  const pageKeywords = input.pageMeta.pageKeywords;
  const keywords = pageKeywords?.primary
    ? [pageKeywords.primary, ...(pageKeywords.secondary ?? [])].filter(Boolean).join(', ')
    : undefined;

  // Derive Service.areaServed + LocalBusiness.areaServed from BusinessProfile address.
  const areaServed = formatAreaServed(input.workspace.businessProfile?.address);

  // Derive Service.serviceType from URL slug.
  const slug = leafSlug(input.pageMeta.publishedPath);
  const serviceType = slug ? capitalizeSlugSegment(slug) : undefined;

  return {
    // ... existing fields ...
    keywords,
    areaServed,
    serviceType,
    knowsAbout: input.workspace.siteKeywordsForKnowsAbout?.slice(0, 5).map(s => s.toLowerCase()),
  };
}
```

- [ ] **Step 3: Update the call site in `server/schema-suggester.ts`**

The `WorkspaceSchemaInput` argument passed to `generateLeanSchema` (around lines 340 + 395 + 425) gains `siteKeywordsForKnowsAbout`. Set it from `ctx.siteKeywords`:

```typescript
workspace: {
  name: ctx.companyName || '',
  publisherLogoUrl: ctx.logoUrl ?? null,
  businessProfile: ctx._businessProfile ?? null,
  defaultLocale: ctx._defaultLocale ?? 'en',
  siteKeywordsForKnowsAbout: ctx.siteKeywords, // NEW
},
```

Apply this at all THREE call sites (per-page loop, CMS loop, single-page generateSchemaForPage).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: zero errors. Existing template tests may now have stale fixtures — they're addressed by Tasks 9–11.

- [ ] **Step 5: Commit**

```bash
git add server/schema/data-sources.ts server/schema-suggester.ts
git commit -m "$(cat <<'EOF'
feat(schema): extend typed boundaries for parity-fields

PageMetaInput gains pageKeywords?: { primary, secondary[] }.
WorkspaceSchemaInput gains siteKeywordsForKnowsAbout?: string[].
PageData gains keywords?, areaServed?, serviceType?, knowsAbout?.

extractPageData populates each from the typed input + helpers
(formatAreaServed for "City, State" composition, capitalizeSlugSegment
for serviceType derivation). All three generator call sites threaded
through. No template emits the new fields yet — Tasks 9-11 wire them.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Add `Organization.knowsAbout` to homepage + local-business templates (haiku)

**Files:**
- Modify: `server/schema/templates/homepage.ts`
- Modify: `server/schema/templates/local-business.ts`
- Modify: `tests/unit/schema/templates.test.ts`

Both templates emit Organization (homepage as primary, local-business as sibling).

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/schema/templates.test.ts` inside the `buildHomepageSchema` describe block:

```typescript
  it('Organization emits knowsAbout when siteKeywordsForKnowsAbout is populated (top 5, lowercased)', () => {
    const withKeywords = {
      ...homepageInput,
      pageData: { ...homepageInput.pageData, knowsAbout: ['web design', 'webflow', 'brand strategy'] },
    };
    const schema = buildHomepageSchema(withKeywords);
    const org = (schema['@graph'] as Array<Record<string, unknown>>)[0];
    expect(org.knowsAbout).toEqual(['web design', 'webflow', 'brand strategy']);
  });

  it('Organization omits knowsAbout when knowsAbout is undefined or empty', () => {
    const noKeywords = {
      ...homepageInput,
      pageData: { ...homepageInput.pageData, knowsAbout: undefined },
    };
    const org = (buildHomepageSchema(noKeywords)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(org.knowsAbout).toBeUndefined();
  });
```

Append to the `buildLocalBusinessSchema` describe block:

```typescript
  it('LocalBusiness sibling Organization emits knowsAbout when populated', () => {
    const withKeywords = {
      ...localInput,
      pageData: { ...localInput.pageData, knowsAbout: ['dental care', 'cosmetic dentistry'] },
    };
    const schema = buildLocalBusinessSchema(withKeywords);
    const org = (schema['@graph'] as Array<Record<string, unknown>>).find(n => n['@type'] === 'Organization');
    expect(org?.knowsAbout).toEqual(['dental care', 'cosmetic dentistry']);
  });
```

- [ ] **Step 2: Run, confirm fail**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'knowsAbout'`
Expected: FAIL — `knowsAbout` not emitted.

- [ ] **Step 3: Update `server/schema/templates/homepage.ts`**

Find the `organization` object inside `dropUndefined({...})` (around line 18). Add:

```typescript
const organization = dropUndefined({
  '@type': 'Organization',
  '@id': `${baseUrl}/#organization`,
  'name': pageData.publisher.name,
  'url': baseUrl,
  'description': pageData.description,
  'image': pageData.image,
  'logo': pageData.publisher.logoUrl
    ? { '@type': 'ImageObject', 'url': pageData.publisher.logoUrl }
    : undefined,
  'sameAs': businessProfile?.socialProfiles?.length ? businessProfile.socialProfiles : undefined,
  'foundedDate': businessProfile?.foundedDate,
  'knowsAbout': pageData.knowsAbout?.length ? pageData.knowsAbout : undefined,  // NEW
});
```

- [ ] **Step 4: Update `server/schema/templates/local-business.ts`**

Find the `organization` sibling node (around line 31). Add the same `knowsAbout` field:

```typescript
const organization = dropUndefined({
  '@type': 'Organization',
  '@id': `${baseUrl}/#organization`,
  'name': pageData.publisher.name,
  'url': baseUrl,
  'logo': pageData.publisher.logoUrl
    ? { '@type': 'ImageObject', 'url': pageData.publisher.logoUrl }
    : undefined,
  'knowsAbout': pageData.knowsAbout?.length ? pageData.knowsAbout : undefined,  // NEW
});
```

- [ ] **Step 5: Run tests, confirm pass**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'knowsAbout'`
Expected: PASS.

Run wider: `npx vitest run tests/unit/schema/templates.test.ts`
Expected: All previously-green tests still green.

- [ ] **Step 6: Commit**

```bash
git add server/schema/templates/homepage.ts server/schema/templates/local-business.ts tests/unit/schema/templates.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): emit Organization.knowsAbout from siteKeywords

Both homepage Organization (primary) and local-business Organization
(sibling) now emit knowsAbout when pageData.knowsAbout has entries.
Lower-cased + top-5 capped at the data-sources layer (Task 8).

dropUndefined gracefully omits the field when knowsAbout is undefined or
empty (workspace hasn't run keyword strategy work yet).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Add `Service.areaServed` + `Service.serviceType` + `LocalBusiness.areaServed` (haiku)

**Files:**
- Modify: `server/schema/templates/service.ts`
- Modify: `server/schema/templates/local-business.ts`
- Modify: `tests/unit/schema/templates.test.ts`

`areaServed` is emitted as a `Place` node when populated. Same shape on Service primary + LocalBusiness primary.

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/schema/templates.test.ts` inside the `buildServiceSchema` describe block:

```typescript
  it('Service emits areaServed as Place when populated', () => {
    const withArea = {
      ...serviceInput,
      pageData: { ...serviceInput.pageData, areaServed: 'Austin, TX' },
    };
    const node = (buildServiceSchema(withArea)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.areaServed).toEqual({ '@type': 'Place', name: 'Austin, TX' });
  });

  it('Service omits areaServed when undefined', () => {
    const node = (buildServiceSchema(serviceInput)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.areaServed).toBeUndefined();
  });

  it('Service emits serviceType from URL-derived slug', () => {
    const withType = {
      ...serviceInput,
      pageData: { ...serviceInput.pageData, serviceType: 'Web Design' },
    };
    const node = (buildServiceSchema(withType)['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.serviceType).toBe('Web Design');
  });
```

Append to the `buildLocalBusinessSchema` describe block:

```typescript
  it('LocalBusiness emits areaServed as Place when populated', () => {
    const withArea = {
      ...localInput,
      pageData: { ...localInput.pageData, areaServed: 'Austin, TX' },
    };
    const lb = (buildLocalBusinessSchema(withArea)['@graph'] as Array<Record<string, unknown>>).find(n => n['@type'] === 'LocalBusiness');
    expect(lb?.areaServed).toEqual({ '@type': 'Place', name: 'Austin, TX' });
  });
```

- [ ] **Step 2: Run, confirm fail**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'areaServed|serviceType'`
Expected: FAIL.

- [ ] **Step 3: Update `server/schema/templates/service.ts`**

Find `buildServiceSchema` (around line 14). In the `dropUndefined({...})` call for the `primary` Service node, add:

```typescript
'areaServed': pageData.areaServed ? { '@type': 'Place' as const, name: pageData.areaServed } : undefined,
'serviceType': pageData.serviceType,
```

- [ ] **Step 4: Update `server/schema/templates/local-business.ts`**

Find the `localBusiness` primary node (around line 41). In the `dropUndefined({...})` call, add:

```typescript
'areaServed': pageData.areaServed ? { '@type': 'Place' as const, name: pageData.areaServed } : undefined,
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'areaServed|serviceType'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/schema/templates/service.ts server/schema/templates/local-business.ts tests/unit/schema/templates.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): emit Service.areaServed/serviceType + LocalBusiness.areaServed

areaServed emitted as { @type: 'Place', name: 'City, State' } when
BusinessProfile.address has city or state. serviceType emitted as a
URL-slug-derived string (e.g. /services/web-design → 'Web Design').
dropUndefined omits both when source data is missing.

Free local-SEO win for geo-targeted agencies — was previously invisible
to schema even though the address was in the BusinessProfile.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Add `Article.keywords` + gated `WebSite.potentialAction` (sonnet)

**Files:**
- Modify: `server/schema/templates/article.ts`
- Modify: `server/schema/templates/homepage.ts`
- Modify: `server/schema/templates/local-business.ts`
- Modify: `server/schema/data-sources.ts` (extend `WorkspaceSchemaInput` with `siteHasSearch`)
- Modify: `server/schema-suggester.ts` (thread `siteHasSearch` to generator)
- Modify: `tests/unit/schema/templates.test.ts`

Article+BlogPosting share the same template function `buildArticleSchema(input, kind)`. The keywords field is added once. The gated SearchAction needs the workspace's `siteHasSearch` flag plumbed through `WorkspaceSchemaInput`.

- [ ] **Step 1: Extend `WorkspaceSchemaInput` with `siteHasSearch`**

In `server/schema/data-sources.ts`, find the `WorkspaceSchemaInput` interface. Add:

```typescript
  /** When true, schema generator emits WebSite.potentialAction (sitelinks SearchAction).
   *  Mirrors Workspace.siteHasSearch DB column. PR2 ships the admin toggle UI. */
  siteHasSearch?: boolean;
```

- [ ] **Step 2: Thread `siteHasSearch` through `server/schema-suggester.ts`**

At the THREE call sites for `generateLeanSchema` (per-page loop, CMS loop, single-page), the `workspace` object gains:

```typescript
workspace: {
  name: ctx.companyName || '',
  publisherLogoUrl: ctx.logoUrl ?? null,
  businessProfile: ctx._businessProfile ?? null,
  defaultLocale: ctx._defaultLocale ?? 'en',
  siteKeywordsForKnowsAbout: ctx.siteKeywords,
  siteHasSearch: ctx._siteHasSearch ?? false, // NEW — Pillar 2.1 dropped unconditional emission; PR2 surfaces admin toggle
},
```

Add `_siteHasSearch?: boolean` to `SchemaContext` interface (around line 100-148, near `_defaultLocale`):

```typescript
  /** When true, WebSite.potentialAction (sitelinks SearchAction) is emitted.
   *  Source: Workspace.siteHasSearch DB column. PR1 always reads as undefined
   *  (DB column defaults to 0 / false); PR2 ships the admin toggle UI. */
  _siteHasSearch?: boolean;
```

In `buildSchemaContext`, populate it:

```typescript
ctx._siteHasSearch = ws.siteHasSearch === true;
// schema-context-direct-read-ok: Workspace identity field (DB-stored boolean flag, not on a slice).
```

The `// schema-context-direct-read-ok` hatch is documentation per the spec; the pr-check rule (Task 13) will look for it.

- [ ] **Step 3: Write failing tests**

Append to `tests/unit/schema/templates.test.ts` inside the `buildArticleSchema (BlogPosting)` describe block:

```typescript
  it('emits keywords as comma-joined string from pageData.keywords', () => {
    const withKeywords = {
      ...baseInput,
      pageData: { ...baseInput.pageData, keywords: 'webflow development, brand strategy, web design' },
    };
    const node = (buildArticleSchema(withKeywords, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.keywords).toBe('webflow development, brand strategy, web design');
  });

  it('omits keywords when pageData.keywords is undefined', () => {
    const noKeywords = {
      ...baseInput,
      pageData: { ...baseInput.pageData, keywords: undefined },
    };
    const node = (buildArticleSchema(noKeywords, 'BlogPosting')['@graph'] as Array<Record<string, unknown>>)[0];
    expect(node.keywords).toBeUndefined();
  });
```

Append to the `buildHomepageSchema` describe block:

```typescript
  it('WebSite emits potentialAction when siteHasSearch is true', () => {
    const withSearch = {
      ...homepageInput,
      siteHasSearch: true,
    };
    const schema = buildHomepageSchema(withSearch);
    const website = (schema['@graph'] as Array<Record<string, unknown>>)[1];
    expect((website?.potentialAction as Record<string, unknown>)?.['@type']).toBe('SearchAction');
  });

  it('WebSite omits potentialAction when siteHasSearch is false or undefined', () => {
    const noSearch = { ...homepageInput, siteHasSearch: false };
    const website = (buildHomepageSchema(noSearch)['@graph'] as Array<Record<string, unknown>>)[1];
    expect(website.potentialAction).toBeUndefined();
  });
```

`HomepageInput` needs `siteHasSearch?: boolean` for the test to compile — see step 5.

- [ ] **Step 4: Run, confirm fail**

Run: `npx vitest run tests/unit/schema/templates.test.ts -t 'keywords|potentialAction'`
Expected: FAIL.

- [ ] **Step 5: Update templates**

In `server/schema/templates/article.ts`, find the `dropUndefined({...})` call (around line 22). Add:

```typescript
'keywords': pageData.keywords,
```

In `server/schema/templates/homepage.ts`:

(a) Update `HomepageInput`:
```typescript
export interface HomepageInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile?: BusinessProfile | null;
  /** Per Pillar 2.1: only emit WebSite.potentialAction (sitelinks SearchAction) when this is true. */
  siteHasSearch?: boolean;
}
```

(b) Update the function body to conditionally emit potentialAction:
```typescript
const website = {
  '@type': 'WebSite',
  '@id': `${baseUrl}/#website`,
  'name': pageData.publisher.name,
  'url': baseUrl,
  'publisher': { '@id': `${baseUrl}/#organization` },
  'inLanguage': pageData.inLanguage,
  ...(input.siteHasSearch ? {
    'potentialAction': {
      '@type': 'SearchAction',
      'target': { '@type': 'EntryPoint', 'urlTemplate': `${baseUrl}/?s={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  } : {}),
};
```

In `server/schema/templates/local-business.ts`:

(a) Update `LocalBusinessInput`:
```typescript
export interface LocalBusinessInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile: BusinessProfile | null;
  siteHasSearch?: boolean;
}
```

(b) The `website` sibling at the end of the function gets the same conditional `potentialAction` spread.

- [ ] **Step 6: Update generator.ts to pass `siteHasSearch` to templates**

In `server/schema/generator.ts`, find the `case 'Homepage':` branch. Update the `buildHomepageSchema` call:

```typescript
schema = buildHomepageSchema({
  baseUrl: input.baseUrl,
  pageData,
  businessProfile: input.workspace.businessProfile,
  siteHasSearch: input.workspace.siteHasSearch,
});
```

And for the LocalBusiness branch:

```typescript
schema = buildLocalBusinessSchema({
  baseUrl: input.baseUrl,
  pageData,
  businessProfile: input.workspace.businessProfile,
  siteHasSearch: input.workspace.siteHasSearch,
});
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/unit/schema/templates.test.ts`
Expected: PASS — all template tests including the 4 new assertions.

Run integration:
```bash
npx vitest run tests/integration/lean-schema-generator.test.ts
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/schema/templates/article.ts server/schema/templates/homepage.ts server/schema/templates/local-business.ts server/schema/data-sources.ts server/schema/generator.ts server/schema-suggester.ts tests/unit/schema/templates.test.ts
git commit -m "$(cat <<'EOF'
feat(schema): emit Article.keywords + gated WebSite.potentialAction

Article + BlogPosting templates emit `keywords` as comma-joined string
from pageData.keywords (populated from PageMetaInput.pageKeywords via
data-sources.ts). Omitted when no pageMap entry.

WebSite.potentialAction (sitelinks SearchAction) emission is now gated
on Workspace.siteHasSearch flag, threaded from DB → SchemaContext._siteHasSearch
→ WorkspaceSchemaInput.siteHasSearch → HomepageInput/LocalBusinessInput.
Default false (per Pillar 2.1 correctness fix). PR2 ships the admin
toggle UI in Settings → Features.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Delete 5 dead `SchemaContext._*` fields (haiku)

**Files:**
- Modify: `server/schema-suggester.ts`

Per audit Q3: `_planContext`, `_pageNode`, `_ancestors`, `_briefId`, `_pageAnalysis` are dead. Preserve `_architectureTree`, `_existingErrors`, `_faqOpportunities`.

- [ ] **Step 1: Find and remove the 5 field declarations from `SchemaContext`**

Read `server/schema-suggester.ts`. Find the `SchemaContext` interface (around line 100-148). Locate and DELETE these lines (exact text shown — match and remove):

```typescript
  _planContext?: { /* ... */ };  // delete this line
  _architectureTree?: SiteNode;  // KEEP — written elsewhere
  _pageNode?: SiteNode;          // delete this line
  _ancestors?: SiteNode[];       // delete this line
  _briefId?: string;             // delete this line
  _pageAnalysis?: { topicCluster?: string; contentGaps?: string[]; optimizationScore?: number };  // delete this line
```

(Approximate line numbers; verify by reading the file. The actual definitions may differ slightly in syntax — the spec / audit Correction 1 reflects the right list.)

- [ ] **Step 2: Verify no consumers**

Run a grep across the repo to verify each deleted field is unreferenced:
```bash
grep -rn "_planContext\|_pageNode\|_ancestors\|_briefId\|_pageAnalysis" server/ src/ shared/ tests/ scripts/ --include='*.ts' --include='*.tsx' | grep -v "schema-suggester.ts" | head -10
```
Expected: zero matches outside `schema-suggester.ts` (the declarations there get deleted in Step 1). Audit Q3 already verified this.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 4: Run schema test suite**

Run: `npx vitest run tests/unit/schema tests/integration/lean-schema-generator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schema-suggester.ts
git commit -m "$(cat <<'EOF'
refactor(schema): delete 5 dead SchemaContext._* fields

_planContext, _pageNode, _ancestors, _briefId, _pageAnalysis are leftover
scaffolding from earlier iterations. Pre-plan audit (§2.3, audit Q3) verified
no writes or reads anywhere in repo.

Preserved: _architectureTree (written 3x in jobs.ts + webflow-schema.ts),
_existingErrors (written 1x + test fixtures), _faqOpportunities (actively
consumed by FAQ enrichment branch in schema-suggester.ts).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Add pr-check rule `schema-context-direct-read-not-on-allowlist` (sonnet)

**Files:**
- Modify: `scripts/pr-check.ts`

The new rule scans `buildSchemaContext` for `ctx.X = ws.Y` or helper-call assignments outside the identity allow-list. Models after the three precedents found in audit Q5: `getOrCreate-nullable` (function-body brace-walk), `unrendered-fields` (allow-list constant), `requireAuth-brand-engine` (basename filter + hatch).

- [ ] **Step 1: Read the existing pr-check.ts to find the right insertion point**

Open `scripts/pr-check.ts`. The CHECKS array contains all rules. Find a logical place to insert (e.g. near other server/-specific rules around line 2000+).

- [ ] **Step 2: Add the new rule**

Insert into the `CHECKS` array:

```typescript
{
  name: 'no new direct reads in buildSchemaContext outside identity allow-list',
  fileGlobs: ['*.ts'],
  pathFilter: 'server/helpers.ts',
  message: 'Net-new direct reads in buildSchemaContext must use buildWorkspaceIntelligence({ slices: [...] }) per docs/superpowers/specs/2026-04-29-schema-yoast-parity-fields-design.md §6. Identity fields (ws.name, ws.id, ws.liveDomain, ws.brandLogoUrl, ws.siteHasSearch, siteId) allowed. Add // schema-context-direct-read-ok: <reason> for justified exceptions.',
  severity: 'error',
  rationale: 'Schema generation reads from workspace+intelligence data. Trajectory 3 → 1 migration (data/roadmap.json:schema-context-builder-pattern-b-migration) ports legacy direct reads to slice consumption. New direct reads bypass that migration; flag them at PR time.',
  claudeMdRef: '#code-conventions',
  customCheck: (files) => {
    const SCHEMA_CONTEXT_ALLOWLIST = new Set([
      'ws.name',
      'ws.id',
      'ws.liveDomain',
      'ws.brandLogoUrl',
      'ws.siteHasSearch',
      'siteId',
    ]);
    const hits: CustomCheckMatch[] = [];
    for (const file of files) {
      if (!file.endsWith('server/helpers.ts')) continue;
      const content = readFileOrEmpty(file);
      if (!content) continue;
      const lines = content.split('\n');

      // Find buildSchemaContext function start.
      let funcStart = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/export\s+async\s+function\s+buildSchemaContext\s*\(/.test(lines[i])) {
          funcStart = i;
          break;
        }
      }
      if (funcStart === -1) continue;

      // Walk forward, brace-counting, until we exit the function.
      let depth = 0;
      let started = false;
      for (let i = funcStart; i < lines.length; i++) {
        const line = lines[i];
        for (const ch of line) {
          if (ch === '{') { depth++; started = true; }
          else if (ch === '}') { depth--; }
        }
        if (started && depth === 0 && i > funcStart) break; // exit

        // Inside function body — check for ctx.X = SOURCE assignments.
        // Skip the function declaration line itself.
        if (i === funcStart) continue;

        // Skip lines with the inline hatch.
        if (line.includes('// schema-context-direct-read-ok')) continue;
        // Also accept hatch on the line directly above (precedent: getOrCreate-nullable rule).
        if (i > funcStart && lines[i - 1].includes('// schema-context-direct-read-ok')) continue;

        const m = line.match(/ctx\.\w+\s*=\s*(ws\.\w+|getRawKnowledge|buildPersonasContext|getInsights|getDeclinedKeywords|listSites|listSitesCached)\b/);
        if (!m) continue;

        // Extract right-hand side (e.g. "ws.name", "getRawKnowledge", "siteId").
        const rhs = m[1];
        if (SCHEMA_CONTEXT_ALLOWLIST.has(rhs)) continue;

        hits.push({ file, line: i + 1, snippet: line.trim() });
      }
    }
    return hits;
  },
},
```

- [ ] **Step 3: Regenerate the auto-generated rules table**

Run: `npm run rules:generate`
Expected: `docs/rules/automated-rules.md` updated to include the new rule.

- [ ] **Step 4: Run pr-check on the current state to verify zero violations**

The legacy direct reads in `buildSchemaContext` (`brandVoice`, `businessContext`, `knowledgeBase`, `personas`, `businessProfile`) all need inline `// schema-context-direct-read-ok: <reason>` hatches added in this task to grandfather them in. Find each direct read line in `server/helpers.ts:buildSchemaContext` and add a comment on the line above:

```typescript
// schema-context-direct-read-ok: legacy; tracked in roadmap schema-context-builder-pattern-b-migration
ctx.brandVoice = ws.brandVoice;

// schema-context-direct-read-ok: legacy; tracked in roadmap schema-context-builder-pattern-b-migration
ctx.businessContext = ws.keywordStrategy?.businessContext;

// schema-context-direct-read-ok: legacy; tracked in roadmap schema-context-builder-pattern-b-migration
const rawKB = getRawKnowledge(ws.id);

// schema-context-direct-read-ok: legacy; tracked in roadmap schema-context-builder-pattern-b-migration
const personasBlock = buildPersonasContext(ws.id);

// schema-context-direct-read-ok: legacy; tracked in roadmap schema-context-builder-pattern-b-migration
if (ws.businessProfile) ctx._businessProfile = ws.businessProfile;
```

(Adjust based on the actual code shape — match line by line during implementation.)

- [ ] **Step 5: Run pr-check**

Run: `npx tsx scripts/pr-check.ts`
Expected: zero errors. The rule is now active and grandfathers in existing reads via hatches. The `getDeclinedKeywords(ws.id)` call within the slice-migrated `siteKeywords` block (Task 7) is NOT a `ctx.X = ...` assignment — it's a local computation — so it's not flagged. Verify that's the case.

- [ ] **Step 6: Sanity-check the rule fires when violated**

Manual test: temporarily add an unhatched line `ctx.foo = ws.bar;` to `buildSchemaContext`. Run pr-check, confirm it flags. Then remove the test line.

- [ ] **Step 7: Commit**

```bash
git add scripts/pr-check.ts docs/rules/automated-rules.md server/helpers.ts
git commit -m "$(cat <<'EOF'
feat(pr-check): assert no new direct reads in buildSchemaContext outside allow-list

Plants the Trajectory 3 → 1 forcing function. Identity fields (ws.name,
ws.id, ws.liveDomain, ws.brandLogoUrl, ws.siteHasSearch, siteId) allowed
freely. Other reads require // schema-context-direct-read-ok hatch with
justification.

Existing legacy reads (brandVoice, businessContext, knowledgeBase,
personas, businessProfile) grandfathered in via inline hatches; they're
tracked in data/roadmap.json:schema-context-builder-pattern-b-migration
for opportunistic migration to seoContext slice consumption.

Models after audit Q5 precedents: getOrCreate-nullable (function-body
brace-walk), unrendered-fields (allow-list constant), requireAuth-brand-engine
(hatch syntax).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Add CLAUDE.md paragraph + roadmap migration tracker entry (haiku)

**Files:**
- Modify: `CLAUDE.md`
- Modify: `data/roadmap.json`

- [ ] **Step 1: Add CLAUDE.md paragraph**

Open `CLAUDE.md`. Find the "Code Conventions" section. Add this paragraph (place near other schema-related conventions if any exist; otherwise at end of section):

```markdown
- **`buildSchemaContext` reads must use intelligence slices.** New data sources for schema generation are read via `buildWorkspaceIntelligence({ slices: [...] })` inside `server/helpers.ts:buildSchemaContext`. Direct workspace reads (`ctx.X = ws.Y`) are reserved for identity fields (`name`, `id`, `liveDomain`, `brandLogoUrl`, `siteHasSearch`, plus `siteId`). All other fields must come from a slice. Five remaining direct reads (`brandVoice`, `businessContext`, `knowledgeBase`, `_businessProfile`, `_personasBlock`) are tracked in `data/roadmap.json:schema-context-builder-pattern-b-migration` for opportunistic migration when adjacent code is touched. Net-new direct reads outside the identity allow-list require an inline `// schema-context-direct-read-ok: <reason>` hatch. Enforced by pr-check.
```

- [ ] **Step 2: Add migration tracker entry to `data/roadmap.json`**

Open `data/roadmap.json`. Find the `sprint-future` items array. Add this entry at a sensible location (e.g. just after the `schema-page-element-catalog-v1` entry that already exists):

```json
{
  "id": "schema-context-builder-pattern-b-migration",
  "title": "Migrate buildSchemaContext direct reads to intelligence slices",
  "source": "docs/superpowers/specs/2026-04-29-schema-yoast-parity-fields-design.md §6",
  "est": "2-3h cumulative across opportunistic PRs",
  "priority": "P1",
  "sprint": "I",
  "status": "in-progress",
  "notes": "Trajectory 3 → 1 migration. Direct reads in server/helpers.ts:buildSchemaContext → corresponding seoContext slice fields. Each migration is opportunistic — done when adjacent code is touched for other reasons. Completion gates Pillar 3 reactivation.\n\nRemaining queue (5 fields):\n  1. brandVoice            → seoContext.brandVoice\n  2. businessContext       → seoContext.strategy.businessContext  (NB: NOT keywordStrategy)\n  3. knowledgeBase         → seoContext.knowledgeBase\n  4. _businessProfile      → seoContext.businessProfile\n  5. _personasBlock        → seoContext.personas (AudiencePersona[]; formatting moves to schema layer)\n\nPR1 (schema-yoast-parity-fields) ports siteKeywords as the pattern anchor (committed outside this queue since it shipped with the PR). Identity fields (ws.name, ws.id, ws.liveDomain, ws.brandLogoUrl, ws.siteHasSearch, siteId) intentionally stay as direct reads — they're per-entity DB fields, not on a slice.\n\nMigration completion criterion: zero non-allowlisted direct reads in buildSchemaContext (verified by pr-check rule schema-context-direct-read-not-on-allowlist). At that point, Pillar 3 (compile-time + CI gates) reactivates."
}
```

- [ ] **Step 3: Validate JSON + sort**

Run: `node -e "JSON.parse(require('fs').readFileSync('data/roadmap.json','utf8')); console.log('valid')"`
Expected: `valid`

Run: `npx tsx scripts/sort-roadmap.ts`
Expected: file re-sorted (or already sorted).

- [ ] **Step 4: Run roadmap test**

Run: `npx vitest run tests/unit/roadmapMigration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md data/roadmap.json
git commit -m "$(cat <<'EOF'
docs(claude+roadmap): formalize Trajectory 3 → 1 migration discipline

CLAUDE.md gains a 'Code Conventions' paragraph documenting the
buildSchemaContext slice-consumption convention + identity-field
allow-list + // schema-context-direct-read-ok hatch syntax. Refers to
the pr-check rule (Task 13) and the migration tracker.

data/roadmap.json gains the schema-context-builder-pattern-b-migration
entry (status: in-progress) listing the 5 remaining direct reads to
port and the corresponding seoContext slice paths (corrected per pre-plan
audit: businessContext is at seoContext.strategy.businessContext, NOT
keywordStrategy).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Frontend warning rendering (sonnet)

**Files:**
- Modify: `src/components/schema/SchemaPageCard.tsx`
- Modify: `src/components/SchemaSuggester.tsx`

Render `validationFindings` grouped by severity. Errors keep red styling (existing); warnings get a new amber "Recommended" badge. Header stat reads `findings.filter(severity === 'warning').length`.

- [ ] **Step 1: Update `src/components/schema/SchemaPageCard.tsx`**

Read the file. Find the existing validation-errors rendering block (around lines 39, 110, 233-234 per audit Q2).

Add the import for `ValidationFinding`:

```typescript
import type { ValidationFinding } from '../../../shared/types/schema-validation';
```

Update `SchemaPageSuggestion` interface (around line 39) to include `validationFindings?: ValidationFinding[];`.

Update the rendering block. Replace the existing string-only list with grouped rendering:

```tsx
{(page.validationFindings && page.validationFindings.length > 0) && (
  <div className="mt-2 space-y-1">
    {/* Errors first, red styling */}
    {page.validationFindings
      .filter(f => f.severity === 'error')
      .map((f, i) => (
        <div key={`err-${i}`} className="text-xs text-red-400 flex items-start gap-2">
          <span className="font-semibold uppercase tracking-wide text-[10px]">Error</span>
          <span>{f.message}</span>
        </div>
      ))}
    {/* Warnings second, amber styling */}
    {page.validationFindings
      .filter(f => f.severity === 'warning')
      .map((f, i) => (
        <div key={`warn-${i}`} className="text-xs text-amber-400 flex items-start gap-2">
          <span className="font-semibold uppercase tracking-wide text-[10px]">Recommended</span>
          <span>{f.message}</span>
        </div>
      ))}
  </div>
)}
```

Keep `hasErrors` defined as before (`(page.validationErrors?.length || 0) > 0`) for the existing card-border-color logic — backwards-compat preserves visual continuity.

- [ ] **Step 2: Update `src/components/SchemaSuggester.tsx`**

Find the header stat row (the section that reads "X validated / Y warnings"). Update to compute from findings:

```typescript
import type { ValidationFinding } from '../../shared/types/schema-validation';

// Inside the component, replace any prior `warningsCount` derivation:
const totalWarnings = data.reduce((sum, page) => {
  return sum + (page.validationFindings?.filter(f => f.severity === 'warning').length ?? 0);
}, 0);
const totalValidated = data.length - data.filter(page => (page.validationErrors?.length ?? 0) > 0).length;
```

Render in the existing stat row:
```tsx
<div className="text-2xl font-bold text-[var(--brand-text-bright)]">{totalValidated}/{data.length}</div>
<div className="t-caption text-[var(--brand-text-muted)]">
  {totalWarnings > 0 ? `${totalWarnings} with warnings` : 'all passing'}
</div>
```

(Match the existing JSX structure — read the file before editing.)

- [ ] **Step 3: Build + run frontend tests**

Run: `npm run typecheck`
Expected: zero errors.

Run: `npx vitest run` (only frontend tests touching schema):
```bash
npx vitest run src/ -t 'SchemaPageCard|SchemaSuggester'
```
Expected: existing tests pass; if any test asserts on `warningsCount` or similar, it should still pass since the values still resolve from data.

- [ ] **Step 4: Commit**

```bash
git add src/components/schema/SchemaPageCard.tsx src/components/SchemaSuggester.tsx
git commit -m "$(cat <<'EOF'
feat(schema/ui): render validation findings grouped by severity

SchemaPageCard renders errors with red 'Error' badge + warnings with
amber 'Recommended' badge, both reading from typed validationFindings.
Existing red card-border for hasErrors preserved (backwards-compat).

SchemaSuggester header stat counts warnings from validationFindings
filtered by severity = 'warning'. The 'X with warnings' annotation
returns to the UI when any page has recommended-tier issues.

PR2 will add the rich completeness widget + deep-link buttons + grouped
fix-by-field collapsing on top of this minimal foundation.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Quality gates + open PR (haiku)

**Files:**
- Modify: `FEATURE_AUDIT.md`
- Modify: `data/roadmap.json` (mark parity-fields PR1 done)

- [ ] **Step 1: Run all CLAUDE.md quality gates**

```bash
npm run typecheck
```
Expected: zero errors.

```bash
npx vite build
```
Expected: builds successfully.

```bash
npx vitest run
```
Expected: all schema tests green; pre-existing flaky tests (`bulk-analysis-semrush-prefetch`, `deep-diagnostic-jobs`, `tier-gate-enforcement`, `content-decay-routes`) may still fail in full-suite mode but pass in isolation — same baseline as Pillar 1.

```bash
npx tsx scripts/pr-check.ts
```
Expected: zero errors. Pre-existing PageHeader warning persists.

- [ ] **Step 2: Update `FEATURE_AUDIT.md`**

Open `FEATURE_AUDIT.md`. Find entry #319 (lean schema rewrite, with the prior pillars appended). Append a new paragraph:

```markdown
**Schema Yoast-Parity Fields PR1 (PR #TBD, 2026-04-29):** Six new template fields ship: Service.areaServed (Place node from BusinessProfile.address.city/state), LocalBusiness.areaServed (same source), Service.serviceType (URL-slug-derived), Organization.knowsAbout (top-5 siteKeywords lowercased), Article.keywords (comma-joined from pageMap.primary + secondary), gated WebSite.potentialAction (sitelinks SearchAction; emitted only when Workspace.siteHasSearch flag is true). New `Workspace.siteHasSearch` field + DB migration 078 + Zod schema + row mapper. Validator API refactored to return typed `ValidationFinding[]` (severity / type / field? / ruleId / message); `LeanGeneratorOutput` carries both new typed `validationFindings` and backwards-compat `validationErrors: string[]`. RequiredFields gains `recommended: string[]` (currently empty for all types — populated when fields move to recommended tier in future). **Slice-migration starter (Trajectory 3 → 1):** `siteKeywords` and per-page `pageKeywords` migrated from direct workspace reads to `seoContext` slice consumption via `buildWorkspaceIntelligence({ slices: ['seoContext'], pagePath? })`. Declined-keyword filter still applied at schema layer (slice does not apply it). Five other direct reads in `buildSchemaContext` (`brandVoice`, `businessContext`, `knowledgeBase`, `_businessProfile`, `_personasBlock`) tracked for opportunistic migration in `data/roadmap.json:schema-context-builder-pattern-b-migration`. Identity fields (`ws.name`, `ws.id`, `ws.liveDomain`, `ws.brandLogoUrl`, `ws.siteHasSearch`, `siteId`) intentionally stay as direct reads. New pr-check rule `schema-context-direct-read-not-on-allowlist` enforces the migration discipline. CLAUDE.md gains the convention paragraph. Five dead `SchemaContext._*` fields deleted (`_planContext`, `_pageNode`, `_ancestors`, `_briefId`, `_pageAnalysis`); three preserved (`_architectureTree` written elsewhere, `_existingErrors` written elsewhere, `_faqOpportunities` actively consumed). Frontend renders findings grouped by severity (red errors + amber 'Recommended' badges). PR2 ships admin discoverability surfaces (completeness widget, BusinessProfileTab mirror, microcopy, siteHasSearch toggle, enriched warning rendering). **Files:** `shared/types/schema-validation.ts` (new), `server/db/migrations/078-workspace-site-has-search.sql` (new), `tests/unit/helpers.buildSchemaContext.test.ts` (new — slice-migration regression test), `server/schema/validator.ts` (typed return), `server/schema/generator.ts` (dual fields), `server/schema-suggester.ts` (passthrough + dead-code deletion + siteHasSearch threading), `server/helpers.ts` (slice migration + grandfather hatches), `server/schema/data-sources.ts` (extended types + extractPageData updates), `server/schema/templates/{homepage,local-business,service,article}.ts` (new field emissions + gating), `shared/types/workspace.ts` + `server/workspaces.ts` + `server/schemas/workspace-schemas.ts` (siteHasSearch field plumbing), `tests/unit/schema/{validator,templates}.test.ts` (assertion migration + new tests), `tests/integration/lean-schema-generator.test.ts` (1 assertion migration), `scripts/pr-check.ts` (new rule), `CLAUDE.md` + `data/roadmap.json` (forcing functions), `src/components/schema/SchemaPageCard.tsx` + `src/components/SchemaSuggester.tsx` (warning rendering).
```

- [ ] **Step 3: Mark parity-fields PR1 done in `data/roadmap.json`**

Find the existing entry `schema-yoast-parity-fields` in `sprint-future`. Update its status:

```json
{
  "id": "schema-yoast-parity-fields-pr1",
  "title": "Schema Yoast-Parity Fields PR1 — validator API + 6 fields + slice-migration starter",
  "source": "docs/superpowers/plans/2026-04-29-schema-yoast-parity-fields-pr1.md",
  "est": "2d",
  "priority": "P0",
  "sprint": "I",
  "status": "done",
  "shippedAt": "2026-04-29",
  "notes": "ValidationFinding API + 6 new template fields + Workspace.siteHasSearch + slice-migration starter (siteKeywords + pageKeywords) + pr-check rule + CLAUDE.md convention + roadmap migration tracker. PR2 ships admin discoverability surfaces. Spec: docs/superpowers/specs/2026-04-29-schema-yoast-parity-fields-design.md. Audit: docs/superpowers/audits/2026-04-29-schema-yoast-parity-fields-audit.md."
}
```

If the existing entry is named `schema-yoast-parity-fields` rather than `-pr1`, rename it (PR2 will get its own entry).

Run: `npx tsx scripts/sort-roadmap.ts`
Expected: roadmap re-sorted; the done entry moves to a shipped sprint (or stays if already in one).

- [ ] **Step 4: Push branch and open PR**

```bash
git add FEATURE_AUDIT.md data/roadmap.json
git commit -m "$(cat <<'EOF'
docs: mark schema-yoast-parity-fields-pr1 done

FEATURE_AUDIT.md gains the comprehensive PR1 paragraph; data/roadmap.json
flips status to done with shippedAt 2026-04-29.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"

git push -u origin claude/schema-yoast-parity-fields
```

```bash
gh pr create --base staging --title "feat(schema): Yoast-parity fields PR1 — validator API + 6 fields + slice-migration starter" --body "$(cat <<'EOF'
## Summary
Closes the substantive-thinness gap surfaced after Pillars 2 + 2.1 + 1 by:

- Six new schema fields admin workspaces already have data for:
  - `Service.areaServed` + `LocalBusiness.areaServed` (Place node from `BusinessProfile.address.city/state`)
  - `Service.serviceType` (URL-slug-derived)
  - `Organization.knowsAbout` (top-5 `siteKeywords` lowercased; on both homepage primary + local-business sibling)
  - `Article.keywords` (comma-joined from per-page primary + secondary keywords)
  - Gated `WebSite.potentialAction` (sitelinks SearchAction; emitted only when new `Workspace.siteHasSearch` flag is true)

- Validator API refactored to typed `ValidationFinding[]` (severity / type / field? / ruleId / message). `LeanGeneratorOutput` carries both new typed `validationFindings` AND backwards-compat `validationErrors: string[]`. `RequiredFields` gains `recommended: string[]` for the recommended-tier surfacing.

- Slice-migration starter (Trajectory 3 → 1): `siteKeywords` and per-page `pageKeywords` migrated from direct workspace reads to `buildWorkspaceIntelligence({ slices: ['seoContext'], pagePath? })`. Declined-keyword filter preserved at schema layer (slice doesn't apply it). Five remaining legacy direct reads grandfathered with inline hatches; tracked for opportunistic migration.

- Forcing functions: new pr-check rule `schema-context-direct-read-not-on-allowlist`, CLAUDE.md convention paragraph, roadmap migration tracker.

- Cleanup: 5 dead `SchemaContext._*` fields deleted (3 preserved per audit).

- Frontend: errors render red, warnings render amber 'Recommended' (rich completeness widget deferred to PR2).

## Spec + audit
- `docs/superpowers/specs/2026-04-29-schema-yoast-parity-fields-design.md`
- `docs/superpowers/audits/2026-04-29-schema-yoast-parity-fields-audit.md`
- `docs/superpowers/plans/2026-04-29-schema-yoast-parity-fields-pr1.md`

## Test plan
- [ ] CI green on staging
- [ ] After staging deploy: regenerate hmpsn studio schema in Chrome MCP. Verify:
  - [ ] Homepage Organization includes `knowsAbout` array
  - [ ] Service pages emit `areaServed` (when BusinessProfile.address.city set) + `serviceType` (URL-derived)
  - [ ] Article/BlogPosting include `keywords` (when pageMap entry exists for that page)
  - [ ] WebSite does NOT emit `potentialAction` (siteHasSearch defaults to false; PR2 ships toggle)
  - [ ] Validator stat reads `28/28 with N warnings` where N is the count of recommended-tier misses
  - [ ] Snapshot storage compatibility: existing snapshot reads `validationErrors: string[]` correctly (backwards-compat preserved)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

---

### Task 17: Investigate pre-existing test failures (haiku → sonnet escalation if needed)

**Files:**
- Create: `docs/superpowers/audits/2026-04-29-pre-existing-test-failures-audit.md`
- Modify: `data/roadmap.json` (file new tasks for any actionable findings)

**Context:** During PR1a (parity-fields validator + siteHasSearch plumbing), the full vitest suite reported 8 failures across 4 test files unrelated to schema work. The failures appear to predate this branch (last touch to the relevant modules was `b2c9dd65`/PR #357), but no one has formally diagnosed them. This task produces a structured audit so we can decide whether to fix, suppress, delete, or knowingly accept each failure.

**Failing test files (from full-suite run on commit `67d68bef`):**

| File | Failure signature(s) |
|---|---|
| `tests/integration/bulk-analysis-semrush-prefetch.test.ts` | Simulated external API errors (`SEMRush API unavailable`, `GSC API down`), mock incompletion (`No "listPageKeywords" export is defined on the "../server/page-keywords.js" mock`) |
| `tests/integration/deep-diagnostic-jobs.test.ts` | Mock incompletion (`No "getActionsByWorkspace" export` / `No "getPendingActions" export` / `No "getTopWinsFromActions" export` on `outcome-tracking.js` mock), `Workspace not found`, `SEO context failed` |
| `tests/integration/tier-gate-enforcement.test.ts` | Port collisions (`listen EADDRINUSE 0.0.0.0:13312`, `13261`, `13327`), test cleanup failures |
| `tests/integration/content-decay-routes.test.ts` (per Pillar 1 baseline note) | Same baseline as Pillar 1 — confirm signature |

**Hypothesis to test (don't assume true):**
1. **Mock incompletion errors** — module exports were extended but `vi.mock()` call sites weren't updated. Fix is mechanical: add the missing exports to the mock factory.
2. **Port collisions** — tests don't use unique ports per CLAUDE.md "Port uniqueness" rule, OR `afterAll` cleanup isn't releasing the port before the next test grabs it.
3. **Simulated API errors** — these MAY be intentional (the test asserts behavior when the API is down). Verify by reading the test description and the assertion that follows the error.
4. **`Workspace not found` / `SEO context failed`** — likely flaky test seeding. Verify by checking whether `seedWorkspace()` is called in `beforeAll` and cleaned up in `afterAll`.

- [ ] **Step 1: Re-run failing tests in isolation**

```bash
npx vitest run tests/integration/bulk-analysis-semrush-prefetch.test.ts 2>&1 | tail -40
npx vitest run tests/integration/deep-diagnostic-jobs.test.ts 2>&1 | tail -40
npx vitest run tests/integration/tier-gate-enforcement.test.ts 2>&1 | tail -40
npx vitest run tests/integration/content-decay-routes.test.ts 2>&1 | tail -40
```

For each file, record:
- Whether the failure reproduces in isolation (vs only in full-suite mode — some flakes only appear when port pressure is real)
- The exact failing test name(s) (not just the file)
- The first error line for each failure (which is usually the root cause; subsequent errors are cascade)

- [ ] **Step 2: Classify each failure**

For every failing test, assign one category:

| Category | Definition | Action |
|---|---|---|
| **MOCK_INCOMPLETE** | `vi.mock('X', () => ({...}))` call lacks an export the SUT now reads | Fix: add the missing export to the mock factory |
| **MOCK_DRIFT** | Mock structure has shifted but assertion still references old shape | Fix: update assertion + mock together |
| **PORT_COLLISION** | `EADDRINUSE` in isolation OR in suite | Fix: assign a unique port per CLAUDE.md, OR audit teardown |
| **API_SIMULATION_OK** | Error string is from a deliberate `mockImplementation(() => { throw new Error(...) })` and the test asserts the failure path correctly | No action — confirm with assertion read |
| **API_SIMULATION_BROKEN** | Test simulates an API failure but asserts something the SUT no longer does | Fix: update assertion to current SUT behavior |
| **SEED_FLAKE** | `Workspace not found` / "No rank data" / similar — fixture wasn't seeded or was cleaned up too eagerly | Fix: align `beforeAll` / `afterAll` / shared fixture references |
| **REAL_BUG** | Test correctly identifies a regression in production code | Fix: file as a P0 bug |
| **DELETE_TEST** | Test exercises a feature that no longer exists or has been replaced | Delete the test |

- [ ] **Step 3: Read the test descriptions and assertions for each failing test**

For each failing test name from Step 1, open the file and read:
- The `describe(...)` and `it(...)` text — what behavior is the test claiming to verify?
- The `expect(...)` calls — what does it assert?
- The setup (`beforeAll`, `vi.mock(...)`) — what mocks/fixtures are in play?

Document this in the audit doc per failing test.

- [ ] **Step 4: Cross-reference with `git log` for staleness**

For each failing test file:

```bash
git log -5 --oneline -- <file>
git log -5 --oneline -- $(grep -oE "from ['\"][./][^'\"]+['\"]" <file> | sed -E "s/from ['\"]//;s/['\"]//" | head -3)
```

Identify whether the SUT modules have been modified more recently than the test/mock — that's the typical drift signature. Note the last touch SHA per file.

- [ ] **Step 5: Produce the audit document**

Write `docs/superpowers/audits/2026-04-29-pre-existing-test-failures-audit.md` with this structure:

```markdown
# Pre-Existing Test Failures Audit

**Date:** 2026-04-29
**Triggered by:** schema-yoast-parity-fields PR1 full-suite run on commit `67d68bef`
**Scope:** 8 failures across 4 test files unrelated to schema work

## Summary
- Total failing tests: N
- Reproducible in isolation: M
- Reproducible only in full-suite: K

## Per-failure findings

### `tests/integration/bulk-analysis-semrush-prefetch.test.ts`

| Test name | Category | Root cause | Recommended action | Estimated effort |
|---|---|---|---|---|
| `<test 1>` | MOCK_INCOMPLETE | `listPageKeywords` not exported on `page-keywords.js` mock; SUT reads it via `<file:line>` | Add `listPageKeywords: vi.fn()` to mock factory | 5 min |
| ... | ... | ... | ... | ... |

(Repeat per file.)

## Aggregate root causes
- N × MOCK_INCOMPLETE on `page-keywords.js` mock
- N × MOCK_INCOMPLETE on `outcome-tracking.js` mock
- N × PORT_COLLISION
- N × API_SIMULATION_OK (no action)

## Recommended remediation
1. **Quick wins (mechanical, ~30 min):** [list MOCK_INCOMPLETE fixes]
2. **Infrastructure (~1-2h):** [list PORT_COLLISION fixes — may need a port allocator helper]
3. **Investigation needed (~4h):** [list REAL_BUG candidates that warrant their own PR]
4. **Confirm-and-document (no code change):** [list API_SIMULATION_OK that just need a comment]

## Roadmap entries to file
- `<id-1>` — fix N MOCK_INCOMPLETE failures, P1
- `<id-2>` — fix port collision strategy across integration tests, P2
- `<id-N>` — REAL_BUG investigation (if any)
```

- [ ] **Step 6: File roadmap entries for actionable findings**

Open `data/roadmap.json`. For each "Recommended remediation" group in the audit:

```json
{
  "id": "test-flake-mock-page-keywords",
  "title": "Fix MOCK_INCOMPLETE failures: page-keywords.js mock + outcome-tracking.js mock",
  "source": "docs/superpowers/audits/2026-04-29-pre-existing-test-failures-audit.md",
  "est": "30m",
  "priority": "P1",
  "sprint": "future",
  "status": "pending",
  "notes": "Add missing exports to vi.mock factories. Identified during schema-yoast-parity-fields PR1 full-suite run."
}
```

(Customize the entries based on what Step 5 surfaces. If the audit identifies REAL_BUG cases, file at P0.)

Run: `npx tsx scripts/sort-roadmap.ts`

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/audits/2026-04-29-pre-existing-test-failures-audit.md data/roadmap.json
git commit -m "$(cat <<'EOF'
docs(audit): pre-existing test failures audit + remediation roadmap entries

Diagnoses 8 test failures unrelated to schema work that surfaced during
the parity-fields PR1 full-suite run. Categorizes each as MOCK_INCOMPLETE,
PORT_COLLISION, API_SIMULATION_OK, SEED_FLAKE, REAL_BUG, or DELETE_TEST.
Files roadmap entries for actionable groups.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

## Discipline

- **Do NOT fix any test in this task.** Output is investigation + filing only. Fixes happen in dedicated PRs whose scope is exactly the audit's recommended remediation groups.
- If a failure turns out to be REAL_BUG (production regression), report it immediately and pause — that may need a hotfix before continuing.
- If you find a failure that's caused by THIS branch's changes (the schema work), STOP and report — it shouldn't be in this audit, it should be in PR1 fixup.

## Self-Review

- [ ] Every failing test from Step 1 appears in the audit doc with a Category, root cause, and recommended action
- [ ] No "TBD" categories — every test classified
- [ ] Roadmap entries filed for every Category that needs work (MOCK_INCOMPLETE, MOCK_DRIFT, PORT_COLLISION, SEED_FLAKE, REAL_BUG, DELETE_TEST). API_SIMULATION_OK gets no entry.
- [ ] Audit doc commits cleanly; roadmap re-sorts cleanly

## Report

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commit SHA
- Audit doc path
- Categorization summary (N MOCK_INCOMPLETE, N PORT_COLLISION, ... totals)
- Roadmap entries filed (count + IDs)
- Any REAL_BUG findings — flag prominently
- Any failure caused by THIS branch — flag prominently (BLOCKER if true)

---

## Cross-Phase Contracts (PR1 → PR2)

### Exported from PR1 (PR2 will read)

- **`ValidationFinding`** type at `shared/types/schema-validation.ts` — PR2's completeness widget reads this directly.
- **`LeanGeneratorOutput.validationFindings`** + **`SchemaPageSuggestion.validationFindings`** — typed surface for the widget + grouped warning rendering.
- **`Workspace.siteHasSearch`** field — PR2 adds the admin toggle UI; PR1 ships the field + DB column + Zod schema.
- **`PageData.{areaServed, serviceType, keywords, knowsAbout}`** — established as the typed boundary; PR2 doesn't extend further.
- **pr-check rule + CLAUDE.md convention + migration tracker** — PR2 builds atop these without adding new ones.

### Not exported (internal to PR1)

- `formatAreaServed`, `capitalizeSlugSegment`, `leafSlug` helpers in `data-sources.ts` — internal.
- `SchemaContext._siteHasSearch` internal field — only the schema feature reads.

---

## Systemic Improvements

### Shared utilities extracted

- `formatAreaServed(address)` — single source of truth for "City, State" composition. Reused by Service + LocalBusiness templates via `pageData.areaServed`.
- `capitalizeSlugSegment(slug)` — humanizes URL slug for `serviceType` derivation. Internal to `data-sources.ts`.
- `ValidationFinding` type — single source of truth for the typed validator return shape. Future Pillar 3 schemarama integration consumes this.

### pr-check rules added

- `schema-context-direct-read-not-on-allowlist` — Task 13. Locks the Trajectory 3 → 1 migration.

### New tests required

- `tests/unit/helpers.buildSchemaContext.test.ts` — new file, 2 assertions (slice consumption + declined-filter preservation).
- 6 new template assertions in `tests/unit/schema/templates.test.ts` (one per new field).
- 30 assertion migrations in `tests/unit/schema/validator.test.ts` (typed shape).
- 1 assertion migration in `tests/integration/lean-schema-generator.test.ts`.

---

## Verification Strategy

| What | How |
|---|---|
| Validator returns typed findings | `npx vitest run tests/unit/schema/validator.test.ts` |
| Templates emit new fields correctly | `npx vitest run tests/unit/schema/templates.test.ts -t 'knowsAbout|areaServed|serviceType|keywords|potentialAction'` |
| Slice migration preserves siteKeywords behavior | `npx vitest run tests/unit/helpers.buildSchemaContext.test.ts` |
| Generator carries dual fields (typed + backwards-compat) | `npx vitest run tests/integration/lean-schema-generator.test.ts` |
| pr-check rule fires on direct-read violations | Manual: temporarily add `ctx.foo = ws.bar;` to `buildSchemaContext` (no hatch), run `npx tsx scripts/pr-check.ts`, expect violation; remove test line. |
| Workspace.siteHasSearch DB roundtrip | `npx vitest run tests/unit/row-mapper-completeness.test.ts` |
| End-to-end on real workspace | After staging deploy: regenerate hmpsn studio schema in Chrome MCP. Verify per the test plan in Task 16. |
| Validator stat 28/28 + N warnings | UI inspection on Schema page. `N` should equal recommended-tier misses (e.g. workspaces missing logo or social profiles). |
| No snapshot breakage | Existing snapshot reads `validationErrors: string[]` — should continue to work (Task 3 derives this from filtered findings). Verify by loading a pre-PR1 snapshot in the admin UI. |

---

## Self-Review

**1. Spec coverage:**
- Spec §4.1 (Validator API refactor) — Tasks 1, 2, 3 ✓
- Spec §4.2 (SchemaContext cleanup, 5 fields per audit Correction 1) — Task 12 ✓
- Spec §4.3 (six new template fields) — Tasks 9, 10, 11 ✓
- Spec §4.4 (slice-migration starter, with audit Correction 3 declined-filter handling) — Task 7 ✓
- Spec §4.5 (forcing functions: pr-check rule, CLAUDE.md, roadmap entry) — Tasks 13, 14 ✓
- Spec §4.6 (frontend warning rendering) — Task 15 ✓
- Spec §4.7 (tests) — Tasks 4, 5, 9, 10, 11, plus Task 7's new test file ✓
- Workspace.siteHasSearch field — Task 6 ✓
- All 4 audit corrections applied: cleanup count (Task 12), Article.keywords source (Task 7's pageKeywords + Task 8's data-sources), `seoContext.strategy` path (Task 7), declined-filter preservation (Task 7). ✓

**2. Placeholder scan:** No "TBD", "implement later", "similar to Task N", or undefined-by-the-time-they're-needed types. The exact code blocks in each step provide complete context.

**3. Type consistency:**
- `ValidationFinding` shape (Task 1) matches its use in Task 2, 3, 4, 5, 15.
- `pageKeywords: { primary, secondary[] }` shape consistent across Task 7 (suggester), Task 8 (PageMetaInput), Task 8 (extractPageData computation).
- `siteHasSearch: boolean` consistent across Task 6 (Workspace), Task 11 (WorkspaceSchemaInput, HomepageInput, LocalBusinessInput), Task 11 (SchemaContext._siteHasSearch).
- `areaServed: string` (the formatted "City, State" string) consistent in Task 8 (PageData), Task 10 (templates emit Place node from it).
- `knowsAbout: string[]` shape consistent in Task 8 (PageData), Task 9 (templates emit array directly).
- `keywords: string` (comma-joined) consistent in Task 8 (PageData), Task 11 (article.ts emits string).

**4. Sequencing:**
- Task 1 (type) before Task 2 (uses type) before Task 3 (uses type). ✓
- Task 6 (Workspace.siteHasSearch field) before Task 11 (consumes it). ✓
- Task 7 (slice migration) before Task 8 (extends PageMetaInput which Task 7 populates). Actually wait — Task 7's `pageKeywords` field doesn't exist on `PageMetaInput` until Task 8 adds it. Task 7 calls `pageMeta: { ..., pageKeywords }` before the type allows it.

  **Fix:** Reorder — Task 8 (extend types) must come BEFORE Task 7 (populate them). Adjusting the dependency graph: Task 1 → 2 → 3 → 4 → 5 → 6 → **8 → 7** → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16.

  Actually closer inspection — Task 7's edits to `server/schema-suggester.ts` populate `pageMeta.pageKeywords`. If Task 8 hasn't extended `PageMetaInput` yet, the typecheck breaks. So Task 8 MUST precede Task 7.

  Fixing this in the dependency graph and below:

**Task ordering correction:**

```
Phase 1 — Foundation (sequential):
  Task 1 → Task 2 → Task 3

Phase 2 — Test fixture migration (sequential, must follow Phase 1):
  → Task 4 → Task 5

Phase 3 — Slice integration + new fields (sequential):
  → Task 6 (siteHasSearch field + migration)
  → Task 8 (Extend types — MOVED BEFORE Task 7 because Task 7 populates these new fields)
  → Task 7 (buildSchemaContext slice migration + per-page pageKeywords plumbing)
  → Task 9 (Templates: knowsAbout)
  → Task 10 (Templates: areaServed/serviceType)
  → Task 11 (Templates: keywords + gated potentialAction)

Phase 4 — Cleanup + forcing functions (sequential, share roadmap.json):
  → Task 12 → Task 13 → Task 14

Phase 5 — Frontend rendering + verification (sequential):
  → Task 15 → Task 16

Phase 6 — Pre-existing test-failure investigation (sequential, after Task 16):
  → Task 17
```

(Task numbering preserved for stability of references; ordering in execution is what matters.)

This is the correct dependency order. The implementer should execute Tasks 1, 2, 3, 4, 5, 6, 8, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17 in that order.

---

## Estimates

| Phase | Tasks | Estimated time |
|---|---|---|
| Phase 1 | 1, 2, 3 | 4 hours |
| Phase 2 | 4, 5 | 2 hours |
| Phase 3 | 6, 8, 7, 9, 10, 11 | 6-7 hours |
| Phase 4 | 12, 13, 14 | 2 hours |
| Phase 5 | 15, 16 | 2 hours |
| Phase 6 | 17 | 1-2 hours (audit + roadmap entries; no code) |
| **Total** | 17 | **~2 days subagent-driven** |

Reviewer overhead (per subagent-driven-development): ~30% on top, mostly absorbed by Phase 5 verification. Phase 6 is review-light (audit doc only).

---

**End of plan.** Plan-writing complete. Ready for execution via `superpowers:subagent-driven-development`.
