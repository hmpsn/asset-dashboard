# Unified Workspace Intelligence — Phase 3B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the three mini-builders (`buildSeoContext` ~25 callers, `buildPageAnalysisContext` ~6 callers, `buildKeywordMapContext` ~8 callers) plus `admin-chat-context`'s inline builder calls by migrating all ~39 call sites to `buildWorkspaceIntelligence()`. Add a structured business profile editor so `SeoContextSlice.businessProfile` can be populated. Bridge content gaps from the strategy layer to `PageProfileSlice`. Upgrade pr-check guards from `warn` to `error` once migration is complete.

**Architecture:** Phase 3B is a migration + extension phase — no new slice types, no new assembler logic. The intelligence layer is complete. This phase makes everything else use it instead of going around it.

### Critical: Sync → Async Migration

`buildSeoContext()`, `buildPageAnalysisContext()`, and `buildKeywordMapContext()` are **synchronous**. `buildWorkspaceIntelligence()` is **async**. Every caller needs `await`. All callers in this plan are already inside async functions (Express route handlers, async generators), but each migration task MUST verify the enclosing function is async before adding `await`.

### Critical: Pre-formatted Strings → Structured Data

The mini-builders return ready-to-inject prompt text (`keywordBlock`, `personasBlock`, etc.). The intelligence layer returns **structured data**. Callers that destructure individual blocks and place them at different prompt positions CANNOT simply use `formatForPrompt()` (which returns one combined blob). Instead:

| Mini-builder field | Intelligence layer equivalent | Type | Notes |
|---|---|---|---|
| `brandVoiceBlock` | `intel.seoContext.brandVoice` | `string` | Direct replacement |
| `businessContext` | `intel.seoContext.businessContext` | `string` | Direct replacement |
| `knowledgeBlock` | `intel.seoContext.knowledgeBase` | `string` | Direct replacement |
| `personasBlock` | Format from `intel.seoContext.personas` | `AudiencePersona[]` | **Needs formatting** — use `personas.map(p => \`${p.name}: ${p.description}\`).join('\\n')` or similar |
| `keywordBlock` | Format from `intel.seoContext.strategy?.siteKeywords` | `SiteKeyword[]` | **Needs formatting** — use `siteKeywords.map(k => \`${k.keyword} (vol: ${k.volume})\`).join('\\n')` or similar |
| `fullContext` | `formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] })` | `string` | Closest match but has `## SEO Context` header, not identical |
| `strategy` | `workspace.keywordStrategy` (read from workspace directly) | `KeywordStrategy` | **NOT** `seo.strategyHistory` which is a summary object |
| `kwMapContext` | Format from `intel.seoContext.strategy?.pageMap` | `PageKeywordMap[]` | **Needs formatting** — iterate page map, format per-page keyword data |
| Page analysis block | `formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] })` | `string` | Or access `intel.pageProfile.auditIssues`, `.recommendations`, `.optimizationScore` directly |

**For fields marked "Needs formatting"**: create a `formatPersonasForPrompt(personas)` and `formatKeywordsForPrompt(siteKeywords)` helper in `workspace-intelligence.ts` (exported) so callers don't each hand-roll formatting. These are Task 0 deliverables.

**Tech Stack:** TypeScript (strict), SQLite (better-sqlite3), Express, React 19 + Vite, TailwindCSS 4, React Router DOM 7

---

## Phase 3A Lessons (mandatory reading before implementing)

These bugs were found during Phase 3A code review. Every one was caused by guessing field names. Phase 3B touches many more files — the risk is higher.

| Bug | Root Cause | Rule |
|-----|-----------|------|
| `(learnings as any)?.byKdRange` | Guessed field, `as any` suppressed TS | **Never use `as any` on a module import result.** Use `import type { T }` and let TS verify every field. |
| `p.detectedAt` on `DecayingPage` | Field doesn't exist on the type | **Before accessing any field, read the interface definition.** One grep is cheaper than one bug review cycle. |
| `p.role` on `AudiencePersona` | Wrong type assumed; copied from another type | **Cross-reference every field name against its source interface.** Not the variable name — the actual type. |
| `profile.industry` on `Workspace.businessProfile` | Confused contact-info type with intelligence type | **Two types with similar names ≠ same shape.** `Workspace.businessProfile` = contact info. `BusinessProfile` in intelligence.ts = strategy info. |
| Exact-match keyword comparison | Case-sensitivity not considered | **Normalize to `.toLowerCase()` at every string comparison site.** |

**Additional guardrails for Phase 3B:**
- Every migrated caller must be tested to verify the intelligence slice returns equivalent data to what the mini-builder returned.
- No caller should call `buildWorkspaceIntelligence` and then access a slice field without reading `shared/types/intelligence.ts` first.
- `admin-chat-context.ts` is a shared file touched by many features. It is a **sequential task only** — never parallel with other file migrations.

---

## Dependency Graph

```
Task 0 (formatting helpers: formatPersonasForPrompt, formatKeywordsForPrompt, formatPageMapForPrompt)
    └──→ Tasks 4-10 depend on these helpers

Task 1 (businessProfile editor: DB + type + UI)
    └──→ Task 2 (businessProfile assembler wiring) — after Task 1 UI is committed

Task 3 (contentGaps bridge) — independent

Tasks 4-10 (mini-builder migration, parallel groups) — independent of each other, depend on Task 0
    └──→ Task 11 (admin-chat-context.ts migration) — after Tasks 4-10 committed

Task 12 (pr-check upgrade + cleanup) — after Task 11
Task 13 (equivalence test suite) — after Tasks 4-11, can run parallel with Task 12
Task 14 (docs: FEATURE_AUDIT + roadmap) — after Tasks 12+13
```

## Parallelization Strategy

| Batch | Tasks | Prerequisite |
|-------|-------|-------------|
| **Batch 0** | Task 0 (formatting helpers), Task 1 (businessProfile editor) | None — run in parallel |
| **Batch 1** | Task 2 (assembler wiring), Task 3 (contentGaps bridge) | Task 0 + Task 1 committed |
| **Batch 2** | Tasks 4-10 (mini-builder migration groups, all parallel) | Task 0 committed |
| **Batch 3** | Task 11 (admin-chat-context) | Batch 2 committed |
| **Batch 4** | Task 12 (pr-check upgrade), Task 13 (equivalence tests), Task 14 (docs) | Task 11 committed |

Note: Batches 0-1 and Batch 2 are **independent** and can run concurrently if desired. The businessProfile work does not block migration and vice versa.

## Model Assignments

| Task | Model | Rationale |
|------|-------|-----------|
| Task 0 (formatting helpers) | **Sonnet** | Needs judgment on formatting that matches existing mini-builder output |
| Task 1 (businessProfile UI) | **Sonnet** | React component + DB migration + type update |
| Task 2 (assembler wiring) | **Haiku** | Mechanical — read type, fill two fields in existing assembler |
| Task 3 (contentGaps bridge) | **Sonnet** | Data shape decision + bridge implementation |
| Tasks 4-10 (migration groups) | **Sonnet** | Each caller needs correct slice + field extraction |
| Task 11 (admin-chat) | **Sonnet** | Large orchestrator, surgical replacement |
| Task 12 (pr-check upgrade) | **Haiku** | Config change — remove exclusions, flip severity |
| Task 13 (equivalence tests) | **Sonnet** | Needs judgment on equivalence assertions, seeding test data |
| Task 14 (docs) | **Haiku** | Mechanical doc updates |

## PR Strategy (4 PRs)

> **IMPORTANT:** Each PR boundary below is a hard STOP. Do not start the next PR until the current one passes all quality gates and is merged to staging.

| PR | Tasks | Gate | Review Focus |
|----|-------|------|-------------|
| **PR 1: Formatting helpers + businessProfile + contentGaps** | Tasks 0-3 | Formatting helpers produce output matching mini-builder format. UI renders. businessProfile populated. contentGaps non-empty. | **Type shape correctness:** `Workspace.intelligenceProfile` vs `BusinessProfile` in intelligence.ts. **Format equivalence:** `formatKeywordsForPrompt` output compared against `buildSeoContext().keywordBlock` for same workspace. |
| **PR 2: Migration batch A** (server modules) | Tasks 4-6 | All migrated callers produce equivalent AI prompts. `npx tsx scripts/pr-check.ts` zero new warnings. | **No `as any` casts.** Verify each caller's prompt output against the pre-migration output. |
| **PR 3: Migration batch B** (routes + admin-chat) | Tasks 7-11 | All remaining callers migrated. Admin chat e2e works. `npx tsx scripts/pr-check.ts` zero new warnings. | **Route handlers async.** workspaceId variable name correct per handler. admin-chat context quality unchanged. |
| **PR 4: Enforcement + tests + docs** | Tasks 12-14 | `pr-check --all` zero buildSeoContext warnings. Equivalence test suite passes. Roadmap + FEATURE_AUDIT updated. | Guard severity is `error`. No false positives on full scan. |

---

## File Ownership Map

| File | Owner Task | Notes |
|------|-----------|-------|
| `server/db/migrations/0XX-intelligence-profile.sql` | Task 1 | New migration — number after latest |
| `shared/types/workspace.ts` | Task 1 | Add `intelligenceProfile?` field |
| `src/components/admin/WorkspaceSettings.tsx` (or equivalent) | Task 1 | Add businessProfile editor section |
| `server/routes/workspaces.ts` (or equivalent) | Task 1 | Add PUT handler for intelligenceProfile |
| `server/workspace-intelligence.ts` | Tasks 2, 3 | businessProfile wiring + contentGaps bridge |
| `server/content-brief.ts` | Task 4 | 3 buildSeoContext callers |
| `server/aeo-page-review.ts` | Task 5 | 1 buildSeoContext caller |
| `server/content-posts-ai.ts` | Task 5 | 1 buildSeoContext caller |
| `server/internal-links.ts` | Task 5 | 2 buildSeoContext callers |
| `server/seo-audit.ts` | Task 6 | 1 buildSeoContext + 1 buildPageAnalysisContext caller |
| `server/content-decay.ts` | Task 6 | 1 buildSeoContext + 1 buildPageAnalysisContext caller |
| `server/routes/webflow-seo.ts` | Task 7 | 4 buildSeoContext + 2 buildPageAnalysisContext + 1 buildKeywordMapContext callers |
| `server/routes/jobs.ts` | Task 8 | 2 buildSeoContext + 1 buildKeywordMapContext callers |
| `server/routes/webflow-alt-text.ts` | Task 8 | 2 buildSeoContext callers |
| `server/routes/google.ts` | Task 9 | 1 buildSeoContext + 1 buildKeywordMapContext callers |
| `server/routes/public-analytics.ts` | Task 9 | 1 buildSeoContext + 1 buildKeywordMapContext callers |
| `server/routes/content-posts.ts` | Task 9 | 1 buildSeoContext caller |
| `server/routes/webflow-keywords.ts` | Task 9 | 1 buildSeoContext + 1 buildKeywordMapContext callers |
| `server/routes/keyword-strategy.ts` | Task 10 | 1 buildSeoContext caller |
| `server/routes/rewrite-chat.ts` | Task 10 | 1 buildSeoContext + 1 buildPageAnalysisContext caller |
| `server/keyword-recommendations.ts` | Task 10 | 1 buildSeoContext caller |
| `server/admin-chat-context.ts` | Task 11 | SEQUENTIAL ONLY — 2 buildSeoContext + 1 buildKeywordMapContext callers + inline builder logic |
| `scripts/pr-check.ts` | Task 12 | Remove grandfathered exclusions, flip warn → error, add buildKeywordMapContext + buildPageAnalysisContext rules |
| `tests/migration-equivalence.test.ts` | Task 13 | New — equivalence test suite |
| `FEATURE_AUDIT.md` | Task 14 | Add Phase 3B entry |
| `data/roadmap.json` | Task 14 | Mark Phase 3B done |

**Files that must NOT be touched in parallel:**
- `server/workspace-intelligence.ts` — owned by Tasks 2 and 3 only. Tasks 4-11 read from it but must not modify it.
- `server/admin-chat-context.ts` — sequential only (Task 11).
- `shared/types/workspace.ts` — owned by Task 1 only.
- `shared/types/intelligence.ts` — read-only for all Phase 3B tasks; no modifications expected.

---

## Pre-Implementation Audit (run before writing any code)

Before starting any task, run these to understand the current baseline:

```bash
# Confirm all buildSeoContext callers (should be ~25 outside excluded files)
grep -rn "buildSeoContext\s*(" server/ --include="*.ts" | grep -v "seo-context.ts\|workspace-intelligence.ts\|admin-chat-context.ts"

# Confirm all buildPageAnalysisContext callers (should be ~6)
grep -rn "buildPageAnalysisContext\s*(" server/ --include="*.ts"

# Current pr-check state
npx tsx scripts/pr-check.ts --all 2>&1 | grep -E "⚠|✗|buildSeoContext|listPages"

# Confirm intelligenceProfile does NOT yet exist on Workspace type
grep -n "intelligenceProfile\|BusinessProfile" shared/types/workspace.ts
```

---

## Task 0: Formatting helpers (MUST be committed before any migration task)

**Goal:** Create exported helper functions that produce prompt-ready text from intelligence slice data, matching the existing mini-builder output format. Without these, every migration task will hand-roll its own formatting — leading to inconsistency and bugs.

**Read before writing:**
- `server/seo-context.ts` lines 58-160 — understand EXACTLY what `buildSeoContext` returns for `keywordBlock`, `personasBlock`, and how `fullContext` is assembled
- `server/seo-context.ts` lines 390+ — understand `buildKeywordMapContext` output format
- `shared/types/intelligence.ts` — `SeoContextSlice` and `SiteKeyword`, `AudiencePersona` types

### Steps

- [ ] **0a. Read mini-builder output format**
  Read `server/seo-context.ts` end-to-end. Document what each block contains and its formatting conventions.

- [ ] **0b. Add formatting helpers to `server/workspace-intelligence.ts`**
  Export these functions:
  ```typescript
  /** Format site keywords into a prompt block matching buildSeoContext().keywordBlock */
  export function formatKeywordsForPrompt(seo: SeoContextSlice): string

  /** Format audience personas into a prompt block matching buildSeoContext().personasBlock */
  export function formatPersonasForPrompt(personas: AudiencePersona[]): string

  /** Format page keyword map into a prompt block matching buildKeywordMapContext() */
  export function formatPageMapForPrompt(seo: SeoContextSlice, pagePath?: string): string
  ```

- [ ] **0c. Equivalence snapshot test**
  Create `tests/formatting-equivalence.test.ts`:
  - For a test workspace, call `buildSeoContext()` and capture `keywordBlock`, `personasBlock`
  - Call the new formatting helpers with the equivalent intelligence data
  - Assert the output contains the same substantive content (exact string match is too brittle — assert same keywords appear, same persona names, same structure)

**Acceptance criteria:**
- [ ] Helpers exported and typed
- [ ] Snapshot test confirms formatting matches mini-builder output
- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors

---

## Task 1: Structured businessProfile editor

**Goal:** Add `intelligenceProfile` to the Workspace type and build an admin UI to edit industry, goals, and target audience.

**Why this comes first:** The intelligence assembler (`assembleSeoContext`) has a Phase 3B deferral at `server/workspace-intelligence.ts:249` — it needs this data before it can populate `SeoContextSlice.businessProfile`. The UI and DB migration must be committed before Task 2.

**CRITICAL — type shape:** Read both of these before writing anything:
- `shared/types/workspace.ts` — find the existing `businessProfile` field (contact info: phone/email/address). Do NOT modify it.
- `shared/types/intelligence.ts` — find `BusinessProfile` interface (industry, goals, targetAudience). This is what the assembler expects.
- Add a **new, separate field** `intelligenceProfile` to the Workspace type. Do not conflate it with `businessProfile`.

### Steps

- [ ] **1a. Read existing types**
  - Read `shared/types/workspace.ts` — understand full `Workspace` interface
  - Read `shared/types/intelligence.ts` — find `BusinessProfile` interface (lines ~193-197)
  - Confirm `intelligenceProfile` does not already exist on `Workspace`

- [ ] **1b. DB migration**
  - Create `server/db/migrations/0XX-intelligence-profile.sql` (number after latest migration)
  - Add `intelligence_profile TEXT` column to `workspaces` table with `ALTER TABLE ... ADD COLUMN`
  - Use `IF NOT EXISTS` guard pattern matching existing migrations

- [ ] **1c. Workspace type update**
  - In `shared/types/workspace.ts`, add to the `Workspace` interface:
    ```typescript
    intelligenceProfile?: {
      industry?: string;
      goals?: string[];
      targetAudience?: string;
    };
    ```
  - This mirrors the `BusinessProfile` shape in intelligence.ts but uses all-optional fields since it's user-entered data

- [ ] **1d. Server: read/write**
  - Find where workspaces are fetched from DB — add `intelligence_profile` to the SELECT and parse with `parseJsonFallback(row.intelligence_profile, {})` from `server/db/json-validation.ts`
  - Find the workspace update route — add `intelligenceProfile` to the accepted body fields, serialize as JSON string before storing
  - Add Zod validation schema for the new field

- [ ] **1e. Admin UI**
  - Find the workspace settings component (grep for "WorkspaceSettings" or "workspace settings")
  - Add a new "Business Intelligence Profile" section with three fields:
    - **Industry** — text input (placeholder: "e.g. dental practice, B2B SaaS, ecommerce")
    - **Goals** — tag/chip input for array of strings, or comma-separated textarea
    - **Target Audience** — textarea (placeholder: "Describe your ideal client/customer")
  - Use existing `<SectionCard>` primitive
  - Wire to existing workspace update mutation

- [ ] **1f. API client update**
  - Add `intelligenceProfile` to the workspace update API client type if applicable

**Acceptance criteria:**
- [ ] DB migration runs cleanly
- [ ] `Workspace.intelligenceProfile` type compiles with strict TS
- [ ] Admin can save industry/goals/targetAudience via the UI
- [ ] Saved values persist on page reload
- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors

---

## Task 2: Wire businessProfile into assembleSeoContext

**Goal:** Remove the Phase 3B deferral comment at `server/workspace-intelligence.ts:249` and populate `seoContext.businessProfile` from `workspace.intelligenceProfile`.

**Prerequisite:** Task 1 committed and deployed.

**Read before writing:**
- `shared/types/workspace.ts` — confirm `intelligenceProfile` shape from Task 1
- `shared/types/intelligence.ts` — confirm `BusinessProfile` shape (`industry: string, goals: string[], targetAudience: string`)
- `server/workspace-intelligence.ts` around line 249 — find the exact deferral block

### Steps

- [ ] **2a. Read the deferral block**
  ```
  grep -n "Phase 3B\|intelligenceProfile\|businessProfile" server/workspace-intelligence.ts
  ```

- [ ] **2b. Replace the deferral comment** with:
  ```typescript
  // Business profile from structured editor (added Phase 3B)
  const iProfile = workspace?.intelligenceProfile;
  if (iProfile && (iProfile.industry || (iProfile.goals && iProfile.goals.length > 0) || iProfile.targetAudience)) {
    base.businessProfile = {
      industry: iProfile.industry ?? '',
      goals: Array.isArray(iProfile.goals) ? iProfile.goals : [],
      targetAudience: iProfile.targetAudience ?? '',
    };
  }
  ```

- [ ] **2c. Update the test in `tests/enrich-seo-context.test.ts`**
  - The test currently asserts `expect(result.seoContext!.businessProfile).toBeUndefined()` (added in Phase 3A)
  - Update the test to verify that when `workspace.intelligenceProfile` is set, `businessProfile` is populated
  - Keep the existing test as a second case: when `intelligenceProfile` is absent, `businessProfile` remains undefined

**Acceptance criteria:**
- [ ] `businessProfile` is populated in the slice when `intelligenceProfile` is set on the workspace
- [ ] `businessProfile` is `undefined` when `intelligenceProfile` is absent (matches existing behavior)
- [ ] `formatForPrompt()` at `standard` verbosity includes the businessProfile section
- [ ] `npx vitest run tests/enrich-seo-context.test.ts` — all tests pass

---

## Task 3: contentGaps bridge — strategy → pageProfile

**Goal:** Populate `PageProfileSlice.contentGaps` (currently hardcoded `[]`) from strategy-level content gap data filtered to the relevant page.

**Design decision (resolved):** Expose `topic` strings from `KeywordStrategy.contentGaps` filtered by page association, capped at 5. The `PageProfileSlice.contentGaps` type is `string[]` — this matches. Full structured gap data is already available in `clientSignals.contentGapVotes` for consumers that need it.

**Read before writing:**
- `shared/types/workspace.ts` — find `ContentGap` interface and `KeywordStrategy.contentGaps` field
- `shared/types/intelligence.ts` — confirm `PageProfileSlice.contentGaps: string[]`
- `server/workspace-intelligence.ts` — find `assemblePageProfile()` and the `contentGaps: []` placeholder (around line 1741)
- `server/workspace-intelligence.ts` — find `stmts()` factory at the top of the file — understand how to add a new prepared statement

### Steps

- [ ] **3a. Read type definitions**
  ```
  grep -n "contentGaps\|ContentGap\|KeywordStrategy" shared/types/workspace.ts | head -20
  grep -n "contentGaps" shared/types/intelligence.ts
  grep -n "contentGaps\|content_gap" server/workspace-intelligence.ts | head -20
  ```

- [ ] **3b. Understand strategy storage**
  - Find where `KeywordStrategy` is stored in the DB — grep for `keyword_strategies` or `keywordStrategy` in `server/routes/keyword-strategy.ts`
  - Confirm whether `contentGaps` is stored as a JSON column

- [ ] **3c. Add prepared statement to `stmts()` factory**
  - Add a query that reads `contentGaps` JSON from the strategy store for a given workspace
  - Use `parseJsonSafeArray` from `server/db/json-validation.ts` to parse the result safely

- [ ] **3d. Replace the placeholder in `assemblePageProfile()`**
  - Query the strategy for content gaps, filter to gaps relevant to the page (by `targetKeyword` matching `pageKw?.primaryKeyword` case-insensitively, or all gaps if no page keyword)
  - Extract `.topic` strings, cap at 5, assign to `contentGaps`
  - Wrap in try/catch — content gaps are non-critical

- [ ] **3e. Add test coverage**
  - Add a test in `tests/intelligence-integration.test.ts` (or new file) that seeds strategy data with content gaps and verifies they appear in the pageProfile slice

**Acceptance criteria:**
- [ ] `contentGaps` is non-empty for workspaces that have strategy data with content gaps
- [ ] `contentGaps` remains `[]` for workspaces with no strategy data (graceful degradation)
- [ ] `formatForPrompt()` at `detailed` verbosity includes content gaps in the pageProfile section
- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors

---

---

## ⛔ PR 1 BOUNDARY — STOP HERE

**Gate:** Formatting helpers pass equivalence tests. businessProfile UI saves + loads. contentGaps non-empty for workspaces with strategy. All quality gates pass.

**Merge PR 1 to staging before continuing.**

---

## Tasks 4-10: Mini-builder migration (parallel groups)

### ⚠️ Batch 2 Recurring Bug Patterns (from PR 1 retrospective)

These exact patterns caused bugs in PR 1. Check each one at every new call site.

| Pattern | What went wrong | Rule |
|---------|----------------|------|
| **Verbosity-blind section guards** | `formatLearningsSection` guard passed for `weCalledIt` data but that field only renders at standard/detailed — produced empty `## Outcome Learnings` at compact | If you write a section guard that checks for data existence, only count fields that actually render at the requested verbosity. |
| **Case-sensitive string comparisons** | `pagePath` filter matched `/About` but not `/about` | Normalize every URL/keyword/path comparison with `.toLowerCase()` on both sides. No exceptions for pagePath, keyword, or domain comparisons. |
| **Missing `invalidateIntelligenceCache`** | Intelligence-profile route saved data consumed by assembler without cache invalidation — stale data served for up to 5 min | Any route that mutates workspace data used by an assembler slice must call `invalidateIntelligenceCache(workspaceId)`. |
| **Optional chaining on "typed" fields** | `g.targetKeyword.toLowerCase()` threw for null values from malformed DB data even though TypeScript typed it non-optional | Add `?.` for any field read from `keywordStrategy`, `intelligenceProfile`, or any DB JSON column — TypeScript types don't guarantee runtime shape. |
| **`parseJsonFallback` instead of `parseJsonSafe` + Zod** | `intelligenceProfile` used `parseJsonFallback`, silently returning stale data instead of validated data | New JSON columns: always define a Zod schema in `server/schemas/workspace-schemas.ts` and use `parseJsonSafe` in the mapper. |

**CRITICAL rules for all migration tasks:**
1. **Verify the enclosing function is async** before adding `await buildWorkspaceIntelligence()`. All known callers are in async functions, but verify per-callsite.
2. **Read the mini-builder's return type before writing.** For `buildSeoContext`: read `server/seo-context.ts` to see what it returns. For `buildPageAnalysisContext`: same file. For `buildKeywordMapContext`: same file.
3. **Read `shared/types/intelligence.ts` for the slice type** before accessing any field on the result.
4. **Never access a field that doesn't exist on the slice type.** If you need data that's not in the slice, it stays as a mini-builder call (flag it in a comment).
5. **No `as any` casts.** Use `import type` for type-only imports. The pr-check `as-any` guard will catch violations.
6. **The intelligence layer uses LRU caching.** Replacing `buildSeoContext()` with `buildWorkspaceIntelligence()` means the second call in the same request is free. Don't add manual caching.
7. **Use the formatting helpers from Task 0.** Do NOT hand-roll formatting of keywords, personas, or page maps.

**Migration pattern for each caller:**

```typescript
// BEFORE
import { buildSeoContext, buildKeywordMapContext } from './seo-context.js';
const { keywordBlock, brandVoiceBlock, personasBlock } = buildSeoContext(workspaceId);
const kwMapBlock = buildKeywordMapContext(workspaceId);

// AFTER
import { buildWorkspaceIntelligence, formatKeywordsForPrompt, formatPersonasForPrompt, formatPageMapForPrompt } from './workspace-intelligence.js';
const intel = await buildWorkspaceIntelligence(workspaceId, { slices: ['seoContext'] });
const seo = intel.seoContext;
const keywordBlock = formatKeywordsForPrompt(seo!);
const brandVoiceBlock = seo?.brandVoice ?? '';
const personasBlock = formatPersonasForPrompt(seo?.personas ?? []);
const knowledgeBlock = seo?.knowledgeBase ?? '';
const kwMapBlock = formatPageMapForPrompt(seo!);
```

**Key field mappings** (mini-builder output → intelligence layer):

| buildSeoContext field | Replacement | Notes |
|----------------------|-------------|-------|
| `keywordBlock` | `formatKeywordsForPrompt(seo)` | Task 0 helper |
| `brandVoiceBlock` | `seo.brandVoice ?? ''` | Direct string |
| `businessContext` | `seo.businessContext ?? ''` | Direct string |
| `personasBlock` | `formatPersonasForPrompt(seo.personas ?? [])` | Task 0 helper |
| `knowledgeBlock` | `seo.knowledgeBase ?? ''` | Direct string |
| `fullContext` | `formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] })` | Combined block with `## SEO Context` header |
| `strategy` | `workspace.keywordStrategy` (read from workspace, NOT `seo.strategyHistory`) | ⚠️ `strategyHistory` is a summary, NOT the full strategy object. Only `content-brief.ts:767` uses this. |

| buildKeywordMapContext output | Replacement | Notes |
|------|-------------|-------|
| `kwMapContext` | `formatPageMapForPrompt(seo)` | Task 0 helper |

| buildPageAnalysisContext field | Replacement | Notes |
|------|-------------|-------|
| Full page analysis block | `formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] })` | Or access individual fields below |
| Optimization issues | `intel.pageProfile.auditIssues` | Array |
| Recommendations | `intel.pageProfile.recommendations` | Array |
| Optimization score | `intel.pageProfile.optimizationScore` | number \| null |

---

### Task 4: content-brief.ts (5 callers: 3 buildSeoContext + 1 buildKeywordMapContext + 1 buildPageAnalysisContext)

**File:** `server/content-brief.ts`
**Callers:** Lines ~487, ~657, ~762 (buildSeoContext) + ~763 (buildKeywordMapContext) + ~772 (buildPageAnalysisContext)

- [ ] **Read before touching:**
  - Read `server/content-brief.ts` lines 480-800 to understand all call sites in context
  - Read `shared/types/intelligence.ts` — `SeoContextSlice` and `PageProfileSlice` fields
  - Run `grep -n "buildSeoContext\|buildPageAnalysisContext\|buildKeywordMapContext" server/content-brief.ts`

- [ ] **Migrate each caller:**
  - Line ~487: extracts `keywordBlock, brandVoiceBlock, knowledgeBlock` → use Task 0 formatting helpers
  - Line ~657: extracts `keywordBlock, brandVoiceBlock` → same
  - Line ~762: extracts most fields + `strategy` object → use helpers for keyword/persona/knowledge blocks. **⚠️ `strategy?.pageMap?.find()` at line ~767**: read `workspace.keywordStrategy` directly (via `getWorkspace()`) — the intelligence `strategyHistory` is a summary, NOT the full strategy.
  - Line ~763: `buildKeywordMapContext` → use `formatPageMapForPrompt(seo)`
  - Line ~772: `buildPageAnalysisContext` → use `buildWorkspaceIntelligence({ slices: ['pageProfile'], pagePath: ... })`
  - Brief generation is async — `buildWorkspaceIntelligence` is already async, no change needed

- [ ] **Verify equivalence:** The AI-facing prompt string must contain the same data as before. Add or update existing brief-generation tests to verify.

- [ ] **Prompt enrichment (stretch goal):** Since `buildWorkspaceIntelligence` can return multiple slices in one cached call, request `slices: ['seoContext', 'learnings', 'contentPipeline']` and inject:
  - **`learnings.topPatterns`** — "your highest-performing content format is X" helps the AI recommend outline structure
  - **`contentPipeline.cannibalizationWarnings`** — if the target keyword is cannibalized, the brief should note "differentiate from [competing page]" rather than writing a generic page
  - Format as an optional `## Workspace Learnings` block appended to the prompt — callers that don't benefit can omit it

**Acceptance criteria:**
- [ ] All 5 callers migrated — no `buildSeoContext`, `buildKeywordMapContext`, or `buildPageAnalysisContext` imports remain
- [ ] `npx tsx scripts/pr-check.ts` shows no buildSeoContext warning for `content-brief.ts`
- [ ] Existing brief generation tests pass

---

### Task 5: internal-links.ts, aeo-page-review.ts, content-posts-ai.ts (6 callers total)

**Files:** `server/internal-links.ts` (2 buildSeoContext), `server/aeo-page-review.ts` (1 buildSeoContext), `server/content-posts-ai.ts` (1 buildSeoContext + 1 buildKeywordMapContext)

- [ ] **Read before touching:**
  - Run `grep -n "buildSeoContext\|buildKeywordMapContext" server/internal-links.ts server/aeo-page-review.ts server/content-posts-ai.ts`
  - Read each call site in context (±20 lines)
  - Read `shared/types/intelligence.ts` — `SeoContextSlice` fields

- [ ] **Migrate each caller:**
  - `internal-links.ts:275` — extracts `brandVoiceBlock` → `seo?.brandVoice ?? ''`
  - `internal-links.ts:313` — extracts `knowledgeBlock, personasBlock` → `seo?.knowledgeBase ?? ''`, `formatPersonasForPrompt(seo?.personas ?? [])`
  - `aeo-page-review.ts:157` — extracts 5 fields → replace with `buildWorkspaceIntelligence({ slices: ['seoContext'] })` + individual field access
  - `content-posts-ai.ts:73` — extracts `fullContext` → use `formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] })`
  - `content-posts-ai.ts:74` — `buildKeywordMapContext` → use `formatPageMapForPrompt(seo!)`

- [ ] **Prompt enrichment (stretch goal) for `aeo-page-review.ts`:** Request `slices: ['seoContext', 'learnings']` and inject `learnings.topPatterns` as a `## Data-Backed Patterns` block. AEO recommendations become more credible when backed by "pages with author bylines and 3+ sources rank higher in your workspace."

**Acceptance criteria:**
- [ ] All 4 callers migrated
- [ ] `npx tsx scripts/pr-check.ts` shows no warnings for these files
- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors

---

### Task 6: seo-audit.ts, content-decay.ts (2 files, 4 callers total)

**Files:** `server/seo-audit.ts` (1 buildSeoContext + 1 buildPageAnalysisContext), `server/content-decay.ts` (1 buildSeoContext + 1 buildPageAnalysisContext)

Note: `content-decay.ts` is already in the pr-check exclude list from Phase 3A. After migration, remove it from the exclude list (Task 12 handles this).

- [ ] **Read before touching:**
  - Run `grep -n "buildSeoContext\|buildPageAnalysisContext" server/seo-audit.ts server/content-decay.ts`
  - Read each call site in context

- [ ] **Migrate each caller:**
  - `seo-audit.ts:592` — `fullContext` → `formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] })`
  - `seo-audit.ts:601` — page analysis block → `formatForPrompt(intel, { verbosity: 'detailed', sections: ['pageProfile'] })`
  - `content-decay.ts:228` — `fullContext` → same pattern
  - `content-decay.ts:229` — page analysis → same pattern

- [ ] **Both files have async contexts** — `buildWorkspaceIntelligence` is async, verify the calling function is already async or make it so

**Acceptance criteria:**
- [ ] All 4 callers migrated
- [ ] No `buildSeoContext` or `buildPageAnalysisContext` imports remain in these files
- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors

---

---

## ⛔ PR 2 BOUNDARY — STOP HERE

**Gate:** All server module callers (content-brief, internal-links, aeo-page-review, content-posts-ai, seo-audit, content-decay) migrated. No `buildSeoContext`, `buildPageAnalysisContext`, or `buildKeywordMapContext` imports remain in these 6 files. `npx tsx scripts/pr-check.ts` zero new warnings. Full test suite passes.

**Merge PR 2 to staging before continuing.**

---

### Task 7: routes/webflow-seo.ts (7 callers)

**File:** `server/routes/webflow-seo.ts`
**Callers:** Lines ~72, ~400, ~608, ~922 (buildSeoContext ×4) + ~209, ~668 (buildPageAnalysisContext ×2) + ~923 (buildKeywordMapContext ×1)

This is the highest-density file. Read it carefully before touching.

- [ ] **Read before touching:**
  - Run `grep -n "buildSeoContext\|buildPageAnalysisContext" server/routes/webflow-seo.ts`
  - Read each call site ±30 lines — these are in large route handlers

- [ ] **Migrate each caller:**
  - Lines ~72, ~400, ~608, ~922: all extract keyword/brand voice/personas/knowledge → `buildWorkspaceIntelligence({ slices: ['seoContext'] })`
  - Lines ~209, ~668: page analysis → `buildWorkspaceIntelligence({ slices: ['pageProfile'], pagePath: ... })`
  - Line ~923: `buildKeywordMapContext` → `formatPageMapForPrompt(seo!)`
  - Multiple calls in the same handler can share one `buildWorkspaceIntelligence` call — the LRU cache makes deduplication free, but a single call per handler is cleaner

- [ ] **Check for `workspaceId` vs `wsId` vs `resolvedWsId`** — these routes use different variable names for the workspace ID. Verify the correct ID variable is passed to `buildWorkspaceIntelligence`.

**Acceptance criteria:**
- [ ] All 7 callers migrated
- [ ] No `buildSeoContext` or `buildPageAnalysisContext` imports remain
- [ ] `npx tsx scripts/pr-check.ts` shows no warnings for `webflow-seo.ts`
- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors

---

### Task 8: routes/jobs.ts, routes/webflow-alt-text.ts (5 callers)

**Files:** `server/routes/jobs.ts` (2 buildSeoContext at ~410 and ~696 + 1 buildKeywordMapContext at ~697), `server/routes/webflow-alt-text.ts` (2 buildSeoContext at ~80 and ~139)

- [ ] **Read before touching:**
  - Run `grep -n "buildSeoContext\|buildKeywordMapContext" server/routes/jobs.ts server/routes/webflow-alt-text.ts`
  - Read each call site in context — jobs.ts callers are inside nested async callbacks; verify correct workspaceId variable

- [ ] **Migrate each caller:**
  - `jobs.ts:410` — extracts `keywordBlock, brandVoiceBlock` → seoContext slice
  - `jobs.ts:696` — extracts `fullContext` → formatForPrompt
  - `jobs.ts:697` — `buildKeywordMapContext(paWsId)` → `formatPageMapForPrompt(seo!)`. **⚠️ Note the variable is `paWsId` not `workspaceId`** — verify the correct ID is passed to `buildWorkspaceIntelligence`.
  - `webflow-alt-text.ts:80` — extracts `businessContext` → `intel.seoContext?.businessContext`
  - `webflow-alt-text.ts:139` — same pattern

**Acceptance criteria:**
- [ ] All 5 callers migrated
- [ ] `npx tsx scripts/pr-check.ts` shows no warnings for these files

---

### Task 9: routes/google.ts, routes/public-analytics.ts, routes/content-posts.ts, routes/webflow-keywords.ts (7 callers)

**Files:** `routes/google.ts` (1 buildSeoContext + 1 buildKeywordMapContext), `routes/public-analytics.ts` (1 buildSeoContext + 1 buildKeywordMapContext), `routes/content-posts.ts` (1 buildSeoContext), `routes/webflow-keywords.ts` (1 buildSeoContext + 1 buildKeywordMapContext)

- [ ] **Read before touching:**
  ```bash
  grep -n "buildSeoContext\|buildKeywordMapContext" server/routes/google.ts server/routes/public-analytics.ts server/routes/content-posts.ts server/routes/webflow-keywords.ts
  ```
  - Read each call site in context

- [ ] **Migrate each caller:**
  - `google.ts:~140` — buildSeoContext → seoContext slice + formatForPrompt
  - `google.ts:~142` — `buildKeywordMapContext(wsId)` → `formatPageMapForPrompt(seo!)`
  - `public-analytics.ts:~248` — `seoCtx.fullContext + buildKeywordMapContext(ws.id)` → `formatForPrompt(intel, { verbosity: 'detailed', sections: ['seoContext'] }) + formatPageMapForPrompt(seo!)`
  - `content-posts.ts` — buildSeoContext → seoContext slice
  - `webflow-keywords.ts:~29` — `buildKeywordMapContext(workspaceId)` → `formatPageMapForPrompt(seo!)`

- [ ] **Note for `routes/public-analytics.ts`:** This may be a public (unauthenticated) route — verify the workspaceId is available and accessible before calling `buildWorkspaceIntelligence`. If the route is called without a valid workspaceId, the intelligence layer should gracefully return empty slices (it already does).

**Acceptance criteria:**
- [ ] All 7 callers migrated
- [ ] `npx tsx scripts/pr-check.ts` shows no warnings for these files

---

### Task 10: routes/keyword-strategy.ts, routes/rewrite-chat.ts, keyword-recommendations.ts (3 callers)

**Files:** One caller each.

- [ ] **Read before touching:**
  ```bash
  grep -n "buildSeoContext\|buildPageAnalysisContext" server/routes/keyword-strategy.ts server/routes/rewrite-chat.ts server/keyword-recommendations.ts
  ```

- [ ] **Migrate each caller:**
  - `keyword-strategy.ts:652` — extracts `knowledgeBlock, personasBlock` → seoContext slice
  - `rewrite-chat.ts:126` — full SeoContext + `buildPageAnalysisContext` at line ~174 → `buildWorkspaceIntelligence({ slices: ['seoContext', 'pageProfile'], pagePath: slug })`
  - `keyword-recommendations.ts:161` — already had Bridge #9 work; verify the existing `getWorkspaceLearnings` call coexists cleanly with the new intelligence call

**Acceptance criteria:**
- [ ] All 3 callers migrated
- [ ] No import of `buildSeoContext` or `buildPageAnalysisContext` remains in these files

---

## Task 11: admin-chat-context.ts migration (SEQUENTIAL)

**File:** `server/admin-chat-context.ts`
**Why sequential:** This is a large (~750 line) orchestrator touched by many features. It must not be modified while Tasks 4-10 are in flight.

**Scope:** Two `buildSeoContext()` calls (lines ~314 and ~375), one `buildKeywordMapContext()` call (line ~315), and any inline mini-builder logic. The rest of the orchestrator (GSC/GA4 parallel fetching, question classification, churn, anomalies, audit) stays untouched.

- [ ] **Read the entire file before touching:**
  ```bash
  wc -l server/admin-chat-context.ts
  grep -n "buildSeoContext\|buildPageAnalysisContext\|buildInsightsContext" server/admin-chat-context.ts
  ```
  Read the surrounding 50 lines for each hit to understand data flow.

- [ ] **Identify what data each call currently uses:**
  - Line ~314 call: which fields are destructured from the result?
  - Line ~375 call: is this page-specific? What `pagePath` would it use?

- [ ] **Replace the two calls:**
  - If both calls use the same `workspaceId` with no `pagePath`, replace both with a **single** `buildWorkspaceIntelligence({ slices: ['seoContext'] })` call at the top of the context assembly function
  - If one call is page-specific (with a `pagePath`), replace with `buildWorkspaceIntelligence({ slices: ['seoContext', 'pageProfile'], pagePath: ... })`

- [ ] **Remove `buildInsightsContext` if it's still called separately** — the intelligence `insights` slice contains this data. Verify it's now redundant.

- [ ] **Remove from pr-check exclude list** (handled in Task 12)

- [ ] **Prompt enrichment (stretch goal):** The admin chat orchestrator already fetches learnings separately — but after migration, a single `buildWorkspaceIntelligence({ slices: ['seoContext', 'learnings', 'clientSignals'] })` call replaces both. Inject `clientSignals.compositeHealthScore` as a headline metric so the AI can say "your workspace health is 72/100 (engagement down, ROI up)" when asked for a status update.

**Acceptance criteria:**
- [ ] No `buildSeoContext` or `buildPageAnalysisContext` imports remain in `admin-chat-context.ts`
- [ ] Admin chat still works end-to-end (test by asking a question that triggers strategy/SEO context)
- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors

---

---

## ⛔ PR 3 BOUNDARY — STOP HERE

**Gate:** All route callers + admin-chat-context migrated. Zero `buildSeoContext`, `buildPageAnalysisContext`, or `buildKeywordMapContext` imports remain outside of `seo-context.ts` and `workspace-intelligence.ts`. Admin chat works end-to-end. `npx tsx scripts/pr-check.ts` zero new warnings.

**Merge PR 3 to staging before continuing.**

---

## Task 12: pr-check cleanup and guard upgrade

**Goal:** Remove all grandfathered exclusions from pr-check and upgrade the `buildSeoContext` rule from `warn` to `error`.

**Prerequisite:** Task 11 committed and CI green.

- [ ] **Read `scripts/pr-check.ts`** — find the `buildSeoContext` check and its current exclude list

- [ ] **Remove grandfathered files from the `buildSeoContext` exclude list:**
  - Remove: `server/content-decay.ts` (migrated in Task 6)
  - Remove: `server/keyword-recommendations.ts` (migrated in Task 10)
  - Remove: `server/admin-chat-context.ts` (migrated in Task 11)
  - Keep: `server/seo-context.ts` (the definition itself — always excluded)
  - Keep: `server/workspace-intelligence.ts` (the assembler that calls it internally — always excluded)

- [ ] **Upgrade severity from `warn` to `error`:**
  ```typescript
  severity: 'error',  // was 'warn'
  ```

- [ ] **Add `buildKeywordMapContext` pr-check rule:**
  Add a new rule (severity `error`) that flags any `buildKeywordMapContext(` call outside of `server/seo-context.ts` and `server/workspace-intelligence.ts`. Pattern: `buildKeywordMapContext\s*\(`. This prevents new callers from bypassing the intelligence layer.

- [ ] **Add `buildPageAnalysisContext` pr-check rule:**
  Same pattern — flag any `buildPageAnalysisContext(` call outside the two core files.

- [ ] **Verify no false positives:**
  ```bash
  npx tsx scripts/pr-check.ts --all 2>&1 | grep -E "buildSeoContext|buildKeywordMapContext|buildPageAnalysisContext"
  ```
  Should show only `✓` lines for all three rules.

- [ ] **Remove all `clearSeoContextCache` calls (now dead code):**
  After migration, the mini-builder cache is no longer used. Remove:
  - `routes/workspaces.ts:211` — remove `clearSeoContextCache(req.params.id)` (keep the `invalidateIntelligenceCache` call that's already there)
  - `routes/webflow-keywords.ts:185` — remove `clearSeoContextCache(workspaceId)` (keep `invalidateIntelligenceCache`)
  - `routes/keyword-strategy.ts:1745,1782,1928,1938` — remove all 4 `clearSeoContextCache` calls (keep `invalidateIntelligenceCache`)
  - `routes/jobs.ts:854` — remove `clearSeoContextCache(paWsId)` (keep `invalidateIntelligenceCache`)
  - `routes/public-portal.ts:483` — remove `clearSeoContextCache(wsId)` (keep `invalidateIntelligenceCache`)
  - Remove the `clearSeoContextCache` import from each of these files
  - Do NOT remove the function definition in `seo-context.ts` yet — it will be removed when the file itself is deprecated

- [ ] **Consider upgrading `listPages` rule to `error` as well** — all 20 callers were migrated in Phase 1. Check if any remain:
  ```bash
  grep -rn "listPages\s*(" server/ --include="*.ts" | grep -v "workspace-data.ts\|webflow-pages.ts"
  ```
  If zero results, upgrade to `error`. If any remain, leave as `warn`.

**Acceptance criteria:**
- [ ] `npx tsx scripts/pr-check.ts --all` — zero `buildSeoContext` warnings
- [ ] The rule is `severity: 'error'`
- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors

---

## Task 13: Equivalence test suite

**Goal:** Verify that migrated callers produce equivalent prompt content to the old mini-builders. This catches silent regressions where the intelligence layer returns different data shapes or missing fields.

**Prerequisite:** Tasks 4-11 committed (all callers migrated).

- [ ] **Create `tests/migration-equivalence.test.ts`:**

  The test strategy is:
  1. For a seeded workspace with keywords, personas, strategy, and page data:
     - Call the old mini-builder (`buildSeoContext`, `buildKeywordMapContext`, `buildPageAnalysisContext`)
     - Call the new intelligence layer + formatting helpers
     - Assert the new output contains the same substantive content

  **Test cases:**

  ```typescript
  describe('mini-builder → intelligence equivalence', () => {
    // Seed a workspace with keywords, personas, brand voice, strategy, pages

    it('formatKeywordsForPrompt matches buildSeoContext().keywordBlock content', () => {
      const old = buildSeoContext(wsId);
      const intel = await buildWorkspaceIntelligence(wsId, { slices: ['seoContext'] });
      const newBlock = formatKeywordsForPrompt(intel.seoContext!);
      // Assert same keywords appear (not exact string match — formatting may differ)
      for (const kw of intel.seoContext!.strategy!.siteKeywords!) {
        expect(newBlock).toContain(kw.keyword);
      }
      // Assert old block contained the same keywords
      for (const kw of intel.seoContext!.strategy!.siteKeywords!) {
        expect(old.keywordBlock).toContain(kw.keyword);
      }
    });

    it('formatPersonasForPrompt matches buildSeoContext().personasBlock content', () => {
      // Same pattern — assert persona names appear in both old and new
    });

    it('formatPageMapForPrompt matches buildKeywordMapContext content', () => {
      // Assert page paths and primary keywords appear in both
    });

    it('seoContext direct fields match mini-builder fields', () => {
      // brandVoice === brandVoiceBlock
      // businessContext === businessContext
      // knowledgeBase === knowledgeBlock
    });

    it('pageProfile formatForPrompt contains audit issues and recommendations', () => {
      // Compare buildPageAnalysisContext output against pageProfile formatted output
    });
  });
  ```

- [ ] **Run the equivalence tests:**
  ```bash
  npx vitest run tests/migration-equivalence.test.ts
  ```

**Acceptance criteria:**
- [ ] All equivalence tests pass
- [ ] Tests cover all 3 mini-builders: `buildSeoContext`, `buildKeywordMapContext`, `buildPageAnalysisContext`
- [ ] No false passes on empty data (tests seed real workspace data first)

---

## Task 14: Doc updates

- [ ] **`FEATURE_AUDIT.md`** — Add Phase 3B entry (Feature #202):
  - What it does: mini-builder retirement, businessProfile editor, contentGaps bridge
  - Files touched
  - Agency/client/mutual value

- [ ] **`data/roadmap.json`** — Mark Phase 3B `"status": "done"` with `"shippedAt"` and notes

- [ ] **Run `npx tsx scripts/sort-roadmap.ts`**

---

## Quality Gates (must ALL pass before each PR)

- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors
- [ ] `npx vite build` — builds successfully
- [ ] `npx vitest run` — full test suite passes (not just new tests)
- [ ] `npx tsx scripts/pr-check.ts` — zero errors
- [ ] No `buildSeoContext`, `buildPageAnalysisContext`, or `buildKeywordMapContext` imports in migrated files (grep to verify)
- [ ] No `as any` casts introduced in any migrated file
- [ ] For PR 2: spot-check one migrated caller end-to-end (e.g., generate a brief, verify it contains keyword/brand voice context)
- [ ] For PR 3: `npx tsx scripts/pr-check.ts --all` shows zero `buildSeoContext` / `buildKeywordMapContext` / `buildPageAnalysisContext` warnings
- [ ] For PR 4: equivalence test suite passes (`npx vitest run tests/migration-equivalence.test.ts`)

---

## Systemic Improvements

**New pr-check rule to add in Phase 3B (Task 12):**
Once `buildSeoContext` is error-severity, consider adding a complementary positive enforcement rule:
- Any new file in `server/` that does AI prompt assembly should call `buildWorkspaceIntelligence` (detectable via pattern like `buildWorkspaceIntelligence\s*\(`)
- This would be a documentation note, not an automated check — too hard to make it precise

**Test coverage additions:**
- Each migrated file group should have at least one integration test verifying the intelligence slice produces equivalent prompt content to the old mini-builder
- The existing `tests/mini-builder-extraction.test.ts` (Phase 3A) verifies data coverage — update it to reflect that mini-builders are now retired (invert the assertion: verify callers use intelligence layer, not mini-builders)

---

## Spec Compliance Checklist

| Phase 3B requirement | Task | Status |
|---------------------|------|--------|
| Formatting helpers (keywords, personas, pageMap) | Task 0 | — |
| businessProfile editor in workspace settings | Task 1 | — |
| businessProfile populated in SeoContextSlice | Task 2 | — |
| contentGaps bridged from strategy to pageProfile | Task 3 | — |
| All buildSeoContext callers migrated (~25) | Tasks 4-11 | — |
| All buildPageAnalysisContext callers migrated (~6) | Tasks 4-11 | — |
| All buildKeywordMapContext callers migrated (~8) | Tasks 4-11 | — |
| admin-chat-context uses intelligence layer | Task 11 | — |
| pr-check buildSeoContext rule → error | Task 12 | — |
| pr-check buildKeywordMapContext + buildPageAnalysisContext rules added | Task 12 | — |
| Grandfathered exclusions removed | Task 12 | — |
| clearSeoContextCache dead code removed (8 call sites) | Task 12 | — |
| Equivalence test suite passes | Task 13 | — |
| FEATURE_AUDIT + roadmap updated | Task 14 | — |
