# Copy Pipeline (Phase 3) Pre-Plan Audit

**Date:** 2026-04-12
**Spec:** `docs/superpowers/specs/2026-03-27-copy-pipeline-design.md`
**Plan:** `docs/superpowers/plans/2026-03-27-copy-pipeline.md`
**Guardrails:** `docs/superpowers/plans/COPY_ENGINE_GUARDRAILS.md`
**Total findings:** 14 critical issues, 17 missing plan sections, 5 spec-plan gaps

---

## 1. Critical Issues in Inline Code

### C1 — Wrong migration number
- **Plan says:** `028-copy-pipeline.sql`
- **Actual next:** `058` (migrations go up to 056 on main; 057 added by page-strategy on staging)
- **Fix:** Renumber to `058-copy-pipeline.sql`

### C2 — Wrong prepared statement pattern
- **Plan uses:** `let _stmts: Stmts | null = null; function stmts(): Stmts { ... }`
- **Required pattern:** `createStmtCache()` from `server/db/stmt-cache.ts`
- **Signature:** `createStmtCache<T>(build: () => T): () => T` — returns a thunk, called as `stmts().insert.run(...)`
- **Files affected:** All 4 new server modules (copy-review.ts, copy-generation.ts, copy-intelligence.ts, copy-export.ts)

### C3 — Bare JSON.parse on DB columns (pr-check violation)
- **Plan uses:** `JSON.parse(row.steering_history)`, `JSON.parse(row.client_suggestions)`, etc.
- **Required pattern:** `parseJsonSafe(raw, schema, fallback, context?)` or `parseJsonSafeArray(raw, itemSchema, context?)` from `server/db/json-validation.ts`
- **Files affected:** All row mappers in copy-review.ts, copy-intelligence.ts
- **Requires:** Zod schemas for `SteeringEntry[]`, `ClientSuggestion[]`, `QualityFlag[]` in a new `server/schemas/copy-pipeline.ts`

### C4 — Wrong import extensions
- **Plan uses:** `from '../shared/types/copy-pipeline.ts'`
- **Required:** `from '../shared/types/copy-pipeline.js'` (ESM requires `.js` extensions)
- **Files affected:** All server modules

### C5 — `WRITING_QUALITY_RULES` not exported
- **Plan assumes:** `export const WRITING_QUALITY_RULES`
- **Actual state:** `const WRITING_QUALITY_RULES` (line 221, `server/content-posts-ai.ts`) — NOT exported
- **Fix:** Task 3 must add the `export` keyword

### C6 — `PAGE_TYPE_CONFIGS` not exported
- **Plan assumes:** Direct export of `PAGE_TYPE_CONFIGS`
- **Actual state:** `const PAGE_TYPE_CONFIGS` (line 320, `server/content-brief.ts`) — NOT exported. Only `getPageTypeConfig()` is exported (line 495).
- **Fix:** Export `getPageTypeConfig` (already done) — do NOT export the raw config object. Plan should use `getPageTypeConfig(pageType)` accessor instead of importing the raw map.

### C7 — Wrong function signatures in copy-generation.ts
- **`generateBrief`**: Plan uses `generateBrief(wsId, { targetKeyword, pageType, ... })` — actual signature is `generateBrief(wsId, targetKeyword, context)` (targetKeyword is a separate param)
- **`getVoiceProfile`**: Returns `(VoiceProfile & { samples: VoiceSample[] }) | null` — plan doesn't handle null or destructure samples
- **`listDeliverables`**: Plan references `getDeliverables` — actual name is `listDeliverables(workspaceId, tier?)`
- **`addVoiceSample`**: Plan may reference wrong params — actual: `(workspaceId, content, contextTag?, source?)`
- **`buildVoiceCalibrationContext`**: Returns `{ samplesText, dnaText, guardrailsText }` — plan doesn't use correct property names

### C8 — No WS_EVENTS constants for copy pipeline
- **Current state:** `server/ws-events.ts` has no copy-related events
- **Required events (minimum):**
  - `COPY_SECTION_UPDATED: 'copy:section_updated'`
  - `COPY_METADATA_UPDATED: 'copy:metadata_updated'`
  - `COPY_BATCH_PROGRESS: 'copy:batch_progress'`
  - `COPY_INTELLIGENCE_UPDATED: 'copy:intelligence_updated'`
- **Impact:** Every POST/PUT/PATCH/DELETE route must broadcast; no events = no real-time updates

### C9 — No `addActivity()` calls in plan
- **Plan's route handlers:** None include `addActivity()` calls
- **CLAUDE.md rule:** "All significant operations must call `addActivity()`"
- **Required for:** generate, approve, steer, batch start/complete, export, intelligence pattern CRUD

### C10 — No Zod schemas file for runtime validation
- **Plan references:** No `server/schemas/copy-pipeline.ts`
- **Required by CLAUDE.md:** "Typed data contracts at boundaries" — DB JSON columns need Zod schemas
- **Schemas needed:** `steeringEntrySchema`, `clientSuggestionSchema`, `qualityFlagSchema`, `copySectionStatusSchema`, `intelligencePatternTypeSchema`

### C11 — No `useWorkspaceEvents` handlers in frontend
- **CLAUDE.md rule:** "Every workspace-scoped broadcast needs a `useWorkspaceEvents()` handler that invalidates the relevant React Query caches"
- **Plan's frontend tasks:** Create 4 panels but none include `useWorkspaceEvents` setup
- **Must use:** `useWorkspaceEvents(workspaceId, ...)` — NOT `useGlobalAdminEvents`

### C12 — `buildSystemPrompt` not used for AI calls
- **Plan's generation module:** Assembles prompt manually
- **Required:** Use `buildSystemPrompt(workspaceId, baseInstructions, customNotes?)` from `server/prompt-assembly.ts` — it handles voice DNA injection (Layer 2) automatically
- **Risk without:** Duplicate voice injection, missing guardrails

### C13 — VoiceProfile field types wrong
- **Plan treats:** `voiceDNA`, `guardrails`, `contextModifiers` as raw strings
- **Actual types:** `voiceDNA?: VoiceDNA` (parsed object), `guardrails?: VoiceGuardrails` (parsed object), `contextModifiers?: ContextModifier[]` (parsed array)
- **Impact:** Code that calls `.split()` or `JSON.parse()` on these fields will crash

### C14 — `ContentPageType` values may be incomplete
- **Actual union:** `'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource' | 'provider-profile' | 'procedure-guide' | 'pricing-page'`
- **Plan assumption:** References "page types" without exhaustive handling
- **Fix:** Generation module must handle all 10 page types in section plan defaults

---

## 2. Missing Plan Sections

### M1 — No testing tasks
The plan has zero test tasks. Required:
- Integration tests for all copy-pipeline routes (port 13318+)
- Contract tests for shared types
- Unit tests for row mappers and status transitions
- Broadcast handler pair test updates

### M2 — No feature flag task
Feature flag `'copy-engine-pipeline'` exists in `shared/types/feature-flags.ts` but the plan never wires it into the UI. Need a task to wrap the Copy tab in `<FeatureFlag flag="copy-engine-pipeline">`.

### M3 — No FEATURE_AUDIT.md update task
CLAUDE.md requires updating `FEATURE_AUDIT.md` after feature work.

### M4 — No roadmap.json update task
CLAUDE.md requires marking completed items and running `npx tsx scripts/sort-roadmap.ts`.

### M5 — No BRAND_DESIGN_LANGUAGE.md update task
New UI components need design system documentation if they introduce patterns.

### M6 — No diff review checkpoints
CLAUDE.md + multi-agent coordination rules require diff review after every parallel batch. Plan has parallel tasks 4-7 and 12-15 with no checkpoint between them.

### M7 — No pr-check rule additions
Plan introduces 4 new server modules with patterns that could regress. Should add rules preventing:
- Bare `JSON.parse` in copy pipeline files
- Direct `broadcastToWorkspace` without matching `useWorkspaceEvents`
- Manual voice injection bypassing `buildSystemPrompt`

### M8 — No Zod validation schemas for route handlers
Routes in `copy-pipeline.ts` need Zod schemas via `validate()` middleware. Plan mentions routes but has no schema definitions.

### M9 — No `shared/types/copy-pipeline.ts` barrel export
Must add to `shared/types/index.ts` or ensure all imports reference the file directly.

### M10 — No workspace-intelligence wiring
CLAUDE.md: "any new table or store that captures workspace activity must be surfaced in `server/workspace-intelligence.ts`". Copy sections + intelligence patterns need a new slice or additions to an existing one.

### M11 — No broadcast handler pair test updates
`tests/integration/broadcast-handler-pairs.test.ts` tracks all broadcast/handler pairs. New events need entries or they'll be flagged as `KNOWN_UNHANDLED_BROADCASTS`.

### M12 — No client-facing hooks
Frontend needs React Query hooks in `src/hooks/admin/` for copy operations. Plan creates API functions but no `useQuery`/`useMutation` hooks.

### M13 — No error boundary wrapping
CLAUDE.md: "Wrap major sections in `<ErrorBoundary>`". Plan's 4 new panels need error boundaries.

### M14 — No loading/empty states
CLAUDE.md: "Use contextual messages" for loading, "action-oriented with a CTA" for empty. Plan's panels have none.

### M15 — No accessibility considerations
CLAUDE.md: "proper ARIA labels, keyboard navigation, focus management". Plan's inline text editing (steering, client suggestions) needs this.

### M16 — No SEO context integration task
Plan mentions `seo-context.ts` modifications but has no dedicated task for adding `buildCopyIntelligenceContext()` and `buildBlueprintContext()`.

### M17 — No prompt-assembly integration
Copy generation must use `buildSystemPrompt()` for voice DNA injection. Plan assembles prompts manually.

---

## 3. Spec-Plan Gaps

### S1 — System 3 (Client Review) entirely missing from plan
The spec defines a complete client review system:
- Client-facing copy view extending the client portal
- Approve/suggest-edit actions
- `revision_requested` status flow
- Doc-based review alternative

The plan has zero tasks covering this. This is a significant feature gap.

### S2 — SteeringChat reuse not addressed
Spec says: "Uses the same `SteeringChat` component from Phase 1" for highlight+steer. Plan creates a new `CopyReviewPanel` but doesn't reference the existing SteeringChat pattern.

### S3 — Cross-page awareness context (Layer 5) not implemented
Spec defines Layer 5: "All other pages in the blueprint... Already-approved copy from other pages... CTA strategy". Plan's generation module doesn't query other entries' approved copy.

### S4 — Batch job persistence not implemented
Spec says: "Progress persists across sessions — close browser, come back, see exactly where you left off." Plan has no batch_jobs table, only in-memory state.

### S5 — Copy intelligence extraction timing vague
Spec says: "extracted by GPT-4.1-mini from steering notes periodically". Plan's `copy-intelligence.ts` has `extractPatterns()` but no trigger mechanism (cron? on-approval? manual?).

---

## 4. Verified Codebase State

### Function Signatures (verified against actual code)

| Function | Module | Verified Signature |
|----------|--------|--------------------|
| `getVoiceProfile` | `server/voice-calibration.ts` | `(wsId: string): (VoiceProfile & { samples: VoiceSample[] }) \| null` |
| `addVoiceSample` | `server/voice-calibration.ts` | `(wsId, content, contextTag?, source?): VoiceSample` |
| `listDeliverables` | `server/brand-identity.ts` | `(wsId, tier?): BrandDeliverable[]` |
| `generateBrief` | `server/content-brief.ts` | `(wsId, targetKeyword, context): Promise<ContentBrief>` |
| `getPageTypeConfig` | `server/content-brief.ts` | `(pageType?): PageTypeConfig` |
| `buildVoiceCalibrationContext` | `server/voice-calibration.ts` | `(profile): { samplesText, dnaText, guardrailsText }` |
| `createStmtCache` | `server/db/stmt-cache.ts` | `<T>(build: () => T): () => T` |
| `parseJsonSafe` | `server/db/json-validation.ts` | `<T, F>(raw, schema, fallback, context?): T \| F` |
| `parseJsonSafeArray` | `server/db/json-validation.ts` | `<T>(raw, itemSchema, context?): T[]` |
| `broadcastToWorkspace` | `server/broadcast.ts` | `(wsId, event, data): void` |
| `addActivity` | `server/activity-log.ts` | `(wsId, type, title, description?, metadata?, actor?)` |
| `buildSystemPrompt` | `server/prompt-assembly.ts` | `(wsId, baseInstructions, customNotes?): string` |
| `validate` | `server/middleware/validate.ts` | `(schema: ZodType): RequestHandler` |

### Infrastructure State

| Item | Value |
|------|-------|
| Next migration number | **058** |
| Next test port | **13318** |
| Feature flag | `'copy-engine-pipeline'` (already defined) |
| Highest WS_EVENT group | Brand Engine (Phase 1) |
| WRITING_QUALITY_RULES | NOT exported (needs `export` keyword) |
| PAGE_TYPE_CONFIGS | NOT exported (use `getPageTypeConfig()` accessor) |
| VoiceProfile fields | Parsed objects (`VoiceDNA`, `VoiceGuardrails`, `ContextModifier[]`) |
| ContentPageType values | 10 types (blog, landing, service, location, product, pillar, resource, provider-profile, procedure-guide, pricing-page) |

### Existing Copy-Related Files

None exist yet — Phase 3 is greenfield. All 4 server modules, 4 UI components, types file, schemas file, and route file are new.

---

## 5. Parallelization Strategy

### Phase 0 — Sequential Foundation (Tasks 1-3)
1. Migration 058 (creates tables)
2. Shared types + Zod schemas (defines contracts)
3. WS_EVENTS additions + export constants
4. **Commit all shared contracts before dispatching parallel agents**

### Phase 1 — Parallel Services (4 agents, Sonnet)
- Agent A: `copy-review.ts` (CRUD, status, steering)
- Agent B: `copy-generation.ts` (8-layer context, AI call, quality check)
- Agent C: `copy-intelligence.ts` (pattern CRUD, extraction)
- Agent D: `copy-export.ts` (CSV, copy deck, Webflow stub)

**Diff review checkpoint after Phase 1**

### Phase 2 — Sequential Integration (Tasks 8-11)
- SEO context additions → Routes → App.ts registration → API client
- Must be sequential (each depends on prior)

### Phase 3 — Parallel Frontend (4 agents, Sonnet)
- Agent E: `CopyReviewPanel.tsx` + hooks
- Agent F: `BatchGenerationPanel.tsx` + hooks
- Agent G: `CopyExportPanel.tsx` + hooks
- Agent H: `CopyIntelligenceManager.tsx` + hooks

**Diff review checkpoint after Phase 3**

### Phase 4 — Integration + Testing (Sequential)
- BlueprintDetail.tsx Copy tab integration
- Feature flag wiring
- Integration tests (port 13318)
- Broadcast handler pair test updates

### Phase 5 — Documentation + Prevention
- FEATURE_AUDIT.md update
- roadmap.json update
- pr-check rule additions (if warranted)

---

## 6. Model Assignments

| Task Type | Recommended Model | Reasoning |
|-----------|------------------|-----------|
| Migration SQL | Haiku | Mechanical DDL, no logic |
| Shared types + Zod schemas | Haiku | Type definitions from spec |
| WS_EVENTS additions | Haiku | Adding constants to existing file |
| Server module CRUD (copy-review) | Sonnet | Row mappers + status logic |
| Server module AI (copy-generation) | Sonnet | Prompt assembly + context building |
| Server module (copy-intelligence) | Sonnet | Pattern extraction logic |
| Server module (copy-export) | Sonnet | Multiple export formats |
| Route file + Zod schemas | Sonnet | Request validation + handler logic |
| SEO context integration | Sonnet | Reading existing patterns, extending |
| Frontend panels | Sonnet | Component logic + hooks |
| BlueprintDetail integration | Sonnet | Modifying existing component |
| Integration tests | Sonnet | Test logic + assertions |
| Diff review checkpoints | Opus | Full-context judgment across files |
| Final review | Opus | Cross-module coherence check |
