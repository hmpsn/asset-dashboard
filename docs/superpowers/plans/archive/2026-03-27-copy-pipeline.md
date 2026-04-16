# Full Copy Pipeline — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full copy generation pipeline on top of Phase 2 blueprint entries — generating, reviewing, steering, batch-processing, and exporting copy for every page in a client's site strategy. Integrates with every AI feature in the platform via seo-context.ts.

**Architecture:** Two tiers. **Tier 1** (Tasks 1–19) is the core pipeline — ships as a unit. **Tier 2** (Tasks 20–29) contains platform integration features that ship incrementally. Four new server modules (`copy-generation.ts`, `copy-review.ts`, `copy-intelligence.ts`, `copy-export.ts`), one route file, one migration (`058-copy-pipeline.sql`), Zod schemas, frontend API + hooks, and UI components extending the Phase 2 Blueprint Detail view.

**Tech Stack:** better-sqlite3, Express, React, Claude Sonnet 4 (creative), GPT-4.1-mini (structured), existing `callAnthropic`/`callOpenAI` wrappers, existing SEMrush + content brief + writing quality infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-27-copy-pipeline-design.md` (includes 21-enhancement addendum)

**Audit:** `docs/superpowers/audits/2026-04-12-copy-pipeline-audit.md` — verified every function signature, type, constant, and cross-phase contract

**Prerequisites:** Phase 1 AND Phase 2 must be **fully complete, committed, and verified** on staging before starting Phase 3.

**Guardrails:** `docs/superpowers/plans/COPY_ENGINE_GUARDRAILS.md` — **READ BEFORE DISPATCHING AGENTS.**

**Coordination rules:** `docs/rules/multi-agent-coordination.md`

**Feature flag:** `'copy-engine-pipeline'` (already defined in `shared/types/feature-flags.ts`)

---

## Verified Cross-Phase Contracts

> Every signature below was verified against the actual codebase on 2026-04-12. See the audit document for the full verification table.

### Functions Phase 3 Imports

| Function | Module | Verified Signature |
|----------|--------|--------------------|
| `getVoiceProfile` | `server/voice-calibration.ts` | `(wsId: string): (VoiceProfile & { samples: VoiceSample[] }) \| null` — samples included on return |
| `addVoiceSample` | `server/voice-calibration.ts` | `(wsId, content, contextTag?, source?): VoiceSample` |
| `buildVoiceCalibrationContext` | `server/voice-calibration.ts` | `(profile): { samplesText, dnaText, guardrailsText }` — guards on calibrated status |
| `listDeliverables` | `server/brand-identity.ts` | `(wsId, tier?): BrandDeliverable[]` — NOT `getDeliverables` |
| `getBrandscript` | `server/brandscript.ts` | `(wsId, id): Brandscript \| null` |
| `generateBrief` | `server/content-brief.ts` | `(wsId, targetKeyword, context): Promise<ContentBrief>` — targetKeyword is separate param |
| `getPageTypeConfig` | `server/content-brief.ts` | `(pageType?): PageTypeConfig` — accessor function; raw `PAGE_TYPE_CONFIGS` is NOT exported |
| `getBlueprint` | `server/page-strategy.ts` | `(wsId, blueprintId): SiteBlueprint \| null` |
| `listBlueprints` | `server/page-strategy.ts` | `(wsId): SiteBlueprint[]` |
| `getEntry` | `server/page-strategy.ts` | `(wsId, blueprintId, entryId): BlueprintEntry \| null` |
| `updateEntry` | `server/page-strategy.ts` | `(wsId, blueprintId, entryId, body): BlueprintEntry \| null` |
| `buildSystemPrompt` | `server/prompt-assembly.ts` | `(wsId, baseInstructions, customNotes?): string` — injects voice DNA (Layer 2) automatically |
| `buildSeoContext` | `server/seo-context.ts` | `(wsId?, pagePath?): SeoContext` |
| `createStmtCache` | `server/db/stmt-cache.ts` | `<T>(build: () => T): () => T` — returns thunk, called as `stmts().insert.run(...)` |
| `parseJsonSafe` | `server/db/json-validation.ts` | `<T, F>(raw, schema, fallback, context?): T \| F` |
| `parseJsonSafeArray` | `server/db/json-validation.ts` | `<T>(raw, itemSchema, context?): T[]` |
| `broadcastToWorkspace` | `server/broadcast.ts` | `(wsId, event, data): void` |
| `addActivity` | `server/activity-log.ts` | `(wsId, type, title, description?, metadata?, actor?)` |
| `validate` | `server/middleware/validate.ts` | `(schema: ZodType): RequestHandler` — import `{ validate, z }` |
| `callAnthropic` | `server/anthropic-helpers.ts` | Anthropic SDK wrapper |
| `callOpenAI` | `server/openai-helpers.ts` | OpenAI SDK wrapper |

### Types Phase 3 Imports

| Type | Module |
|------|--------|
| `SiteBlueprint`, `BlueprintEntry`, `SectionPlanItem` | `shared/types/page-strategy.ts` |
| `SectionType`, `NarrativeRole` | `shared/types/page-strategy.ts` |
| `ContentPageType` | `shared/types/content.ts` |
| `Brandscript` | `shared/types/brand-engine.ts` |
| `VoiceProfile`, `VoiceSample`, `VoiceDNA`, `VoiceGuardrails`, `ContextModifier` | `shared/types/brand-engine.ts` |
| `BrandDeliverable` | `shared/types/brand-engine.ts` |
| `ContentBrief` | `shared/types/content.ts` (or wherever defined) |

### Critical Type Details

- **VoiceProfile fields are parsed objects:** `voiceDNA?: VoiceDNA`, `guardrails?: VoiceGuardrails`, `contextModifiers?: ContextModifier[]` — NOT raw JSON strings
- **`getVoiceProfile` includes samples:** Return type is `(VoiceProfile & { samples: VoiceSample[] }) | null` — no separate `getVoiceSamples` call needed
- **`ContentPageType` has 10 values:** `'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource' | 'provider-profile' | 'procedure-guide' | 'pricing-page'`
- **Import extensions:** ALL server imports must use `.js` extension (ESM), e.g., `from '../shared/types/copy-pipeline.js'`

---

## Task Dependencies

```
Sequential foundation:
  Task 1 (WS_EVENTS) → Task 2 (Migration 058) → Task 3 (Shared Types + Zod Schemas) → Task 4 (Export constants)

  ─── COMMIT SHARED CONTRACTS ─── (all above must be committed before parallel dispatch)

Parallel services (after Task 4):
  Task 5 (Copy Review) ∥ Task 6 (Copy Generation) ∥ Task 7 (Copy Intelligence) ∥ Task 8 (Copy Export)

  ─── DIFF REVIEW CHECKPOINT 1 ─── (tsc, grep for duplicates, test suite)

Sequential integration (after checkpoint):
  Task 9 (SEO Context integration)
  Task 10 (Routes + Zod validation)
  Task 11 (App.ts route registration)
  Task 12 (API client additions)
  Task 13 (React Query hooks)

  ─── DIFF REVIEW CHECKPOINT 2 ─── (tsc, build, test suite)

Parallel frontend (after Task 13):
  Task 14 (CopyReviewPanel) ∥ Task 15 (BatchGenerationPanel) ∥ Task 16 (CopyExportPanel) ∥ Task 17 (CopyIntelligenceManager)

  ─── DIFF REVIEW CHECKPOINT 3 ─── (tsc, build, visual check)

Sequential integration:
  Task 18 (BlueprintDetail Copy tab + feature flag)
  Task 19 (Integration tests + broadcast handler pairs)

  ─── FULL VERIFICATION ─── (tsc, build, full test suite, pr-check)
```

---

## File Ownership Map

### New Files

| File | Owner Task | Responsibility |
|------|------------|----------------|
| `server/db/migrations/058-copy-pipeline.sql` | Task 2 | Tables: copy_sections, copy_metadata, copy_intelligence, batch_jobs; ALTER content_briefs |
| `shared/types/copy-pipeline.ts` | Task 3 | All copy pipeline shared types |
| `server/schemas/copy-pipeline.ts` | Task 3 | Zod schemas for JSON columns + route validation |
| `server/copy-review.ts` | Task 5 | Copy section CRUD, status management, steering history |
| `server/copy-generation.ts` | Task 6 | 8-layer context assembly, AI generation, quality check |
| `server/copy-intelligence.ts` | Task 7 | Pattern extraction, frequency tracking, promotion detection |
| `server/copy-export.ts` | Task 8 | CSV, copy deck export, Webflow stub |
| `server/routes/copy-pipeline.ts` | Task 10 | All copy pipeline API routes |
| `src/hooks/admin/useCopyPipeline.ts` | Task 13 | React Query hooks for copy operations |
| `src/components/brand/CopyReviewPanel.tsx` | Task 14 | Section-by-section review with steering |
| `src/components/brand/BatchGenerationPanel.tsx` | Task 15 | Batch generation controls + progress |
| `src/components/brand/CopyExportPanel.tsx` | Task 16 | Export path selection + trigger |
| `src/components/brand/CopyIntelligenceManager.tsx` | Task 17 | Pattern management UI |
| `tests/integration/copy-pipeline-routes.test.ts` | Task 19 | Integration tests (port 13318) |

### Modified Files

| File | Owner Task | Changes |
|------|------------|---------|
| `server/ws-events.ts` | Task 1 | Add copy pipeline WS_EVENTS constants |
| `server/content-posts-ai.ts` | Task 4 | Add `export` to `WRITING_QUALITY_RULES` |
| `server/seo-context.ts` | Task 9 | Add `buildCopyIntelligenceContext()`, `buildBlueprintContext()`, wire into `fullContext` |
| `server/app.ts` | Task 11 | Import + mount copy pipeline routes |
| `src/api/brand-engine.ts` | Task 12 | Add copy generation, review, batch, export, intelligence API functions |
| `src/components/brand/BlueprintDetail.tsx` | Task 18 | Add Copy tab, feature flag gate |
| `tests/integration/broadcast-handler-pairs.test.ts` | Task 19 | Add new copy pipeline event pairs |

---

## Model Assignments

| Task | Model | Reasoning |
|------|-------|-----------|
| Task 1 (WS_EVENTS) | Haiku | Adding constants to existing file |
| Task 2 (Migration) | Haiku | Mechanical DDL |
| Task 3 (Types + Schemas) | Haiku | Type definitions from spec |
| Task 4 (Export constants) | Haiku | Adding `export` keyword |
| Task 5 (Copy Review) | Sonnet | CRUD + status transitions + row mappers |
| Task 6 (Copy Generation) | Sonnet | Prompt assembly + context building |
| Task 7 (Copy Intelligence) | Sonnet | Pattern extraction + AI call |
| Task 8 (Copy Export) | Sonnet | Multiple export formats |
| Task 9 (SEO Context) | Sonnet | Reading existing pattern, extending |
| Task 10 (Routes) | Sonnet | Zod schemas + handlers + broadcast + activity |
| Task 11 (App.ts) | Haiku | Mechanical route registration |
| Task 12 (API Client) | Haiku | Typed fetch wrappers |
| Task 13 (Hooks) | Sonnet | React Query patterns |
| Task 14 (CopyReviewPanel) | Sonnet | Complex UI with steering |
| Task 15 (BatchGenerationPanel) | Sonnet | Progress tracking UI |
| Task 16 (CopyExportPanel) | Sonnet | Export format UI |
| Task 17 (CopyIntelligenceManager) | Sonnet | Pattern management UI |
| Task 18 (BlueprintDetail) | Sonnet | Modifying existing component |
| Task 19 (Integration Tests) | Sonnet | Test logic + assertions |
| Diff review checkpoints | Opus | Full-context judgment |

---

# TIER 1: Core Pipeline

## Task 1: WebSocket Events + Activity Types

**Files:**
- Modify: `server/ws-events.ts`
- Modify: `server/activity-log.ts`

- [ ] **Step 1: Add copy pipeline events to `WS_EVENTS`**

Add after the `// Brand Engine` group:

```typescript
// Copy Pipeline (Phase 3 — copy generation, review, export, intelligence)
COPY_SECTION_UPDATED: 'copy:section_updated',
COPY_METADATA_UPDATED: 'copy:metadata_updated',
COPY_BATCH_PROGRESS: 'copy:batch_progress',
COPY_BATCH_COMPLETE: 'copy:batch_complete',
COPY_INTELLIGENCE_UPDATED: 'copy:intelligence_updated',
COPY_EXPORT_COMPLETE: 'copy:export_complete',

// Page Strategy — blueprint-level events for copy status
BLUEPRINT_UPDATED: 'blueprint:updated',
BLUEPRINT_GENERATED: 'blueprint:generated',
```

Note: `BLUEPRINT_UPDATED` and `BLUEPRINT_GENERATED` may already exist from Phase 2 — check before adding.

- [ ] **Step 2: Add copy pipeline ActivityType values**

In `server/activity-log.ts`, add to the `ActivityType` union (before the closing `;`):

```typescript
  | 'copy_generated'
  | 'copy_approved'
  | 'copy_batch_started'
  | 'copy_batch_complete'
  | 'copy_exported'
  | 'copy_suggestion_added'
  | 'blueprint_created'
  | 'blueprint_updated'
  | 'blueprint_deleted'
  | 'blueprint_generated'
  | 'blueprint_entry_added'
  | 'blueprint_entry_updated'
  | 'blueprint_entry_deleted'
```

Note: The `blueprint_*` types may already exist from Phase 2 — check before adding. Only add what's missing.

- [ ] **Step 3: Commit**

```bash
git add server/ws-events.ts server/activity-log.ts
git commit -m "feat: add copy pipeline WebSocket events and activity types"
```

---

## Task 2: Database Migration

**Files:** Create `server/db/migrations/058-copy-pipeline.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 058-copy-pipeline.sql
-- Full Copy Pipeline tables (Phase 3)

-- ═══ COPY SECTIONS ═══
-- Each row = generated copy for one section of one blueprint entry

CREATE TABLE IF NOT EXISTS copy_sections (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL,
  entry_id              TEXT NOT NULL REFERENCES blueprint_entries(id) ON DELETE CASCADE,
  section_plan_item_id  TEXT NOT NULL,
  generated_copy        TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  ai_annotation         TEXT,
  ai_reasoning          TEXT,
  steering_history      TEXT NOT NULL DEFAULT '[]',
  client_suggestions    TEXT,
  quality_flags         TEXT,
  version               INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_copy_sections_entry ON copy_sections(entry_id);
CREATE INDEX IF NOT EXISTS idx_copy_sections_status ON copy_sections(status);
CREATE INDEX IF NOT EXISTS idx_copy_sections_workspace ON copy_sections(workspace_id);

-- ═══ COPY METADATA ═══
-- SEO title, meta desc, OG tags per blueprint entry

CREATE TABLE IF NOT EXISTS copy_metadata (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  entry_id          TEXT NOT NULL REFERENCES blueprint_entries(id) ON DELETE CASCADE,
  seo_title         TEXT,
  meta_description  TEXT,
  og_title          TEXT,
  og_description    TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  steering_history  TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_copy_metadata_entry ON copy_metadata(entry_id);
CREATE INDEX IF NOT EXISTS idx_copy_metadata_workspace ON copy_metadata(workspace_id);

-- ═══ COPY INTELLIGENCE ═══
-- Workspace-level learned patterns from copy review

CREATE TABLE IF NOT EXISTS copy_intelligence (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  pattern_type    TEXT NOT NULL,
  pattern         TEXT NOT NULL,
  source          TEXT,
  frequency       INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_copy_intelligence_workspace ON copy_intelligence(workspace_id);
CREATE INDEX IF NOT EXISTS idx_copy_intelligence_active ON copy_intelligence(workspace_id, active);

-- ═══ BATCH JOBS ═══
-- Persistent batch generation tracking (survives browser close)

CREATE TABLE IF NOT EXISTS copy_batch_jobs (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL,
  blueprint_id          TEXT NOT NULL REFERENCES site_blueprints(id) ON DELETE CASCADE,
  mode                  TEXT NOT NULL DEFAULT 'review_inbox',
  entry_ids_json        TEXT NOT NULL DEFAULT '[]',
  batch_size            INTEGER NOT NULL DEFAULT 5,
  status                TEXT NOT NULL DEFAULT 'pending',
  progress_json         TEXT NOT NULL DEFAULT '{"total":0,"generated":0,"reviewed":0,"approved":0}',
  accumulated_steering  TEXT NOT NULL DEFAULT '[]',
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_copy_batch_workspace ON copy_batch_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_copy_batch_status ON copy_batch_jobs(status);

-- ═══ EXTEND CONTENT BRIEFS ═══
-- Track copy approval rate for brief quality feedback loop

ALTER TABLE content_briefs ADD COLUMN copy_approval_rate REAL;
```

**IMPORTANT:** The `ALTER TABLE content_briefs` may fail on re-run if column already exists. The migration runner handles idempotency via the `_migrations` table.

**IMPORTANT:** `workspace_id` is included on `copy_sections` and `copy_metadata` (not just relying on JOINs through `entry_id`) so that UPDATE/DELETE queries can be scoped by `workspace_id` directly — a CLAUDE.md rule.

- [ ] **Step 2: Verify migration runs**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard && npx tsx server/db/index.ts
sqlite3 data/app.db ".tables" | grep -E "copy_sections|copy_metadata|copy_intelligence|copy_batch_jobs"
```

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/058-copy-pipeline.sql
git commit -m "feat(db): add copy pipeline tables — migration 058"
```

---

## Task 3: Shared Types + Zod Schemas

**Files:**
- Create: `shared/types/copy-pipeline.ts`
- Create: `server/schemas/copy-pipeline.ts`

- [ ] **Step 1: Write the shared types**

See existing plan lines 176–337 for the full types file. The types themselves are correct. Key types:

- `CopySectionStatus`: `'pending' | 'draft' | 'client_review' | 'approved' | 'revision_requested'`
- `QualityFlag`: `{ type, message, severity }`
- `SteeringEntry`: `{ type, note, highlight?, resultVersion, timestamp }`
- `ClientSuggestion`: `{ originalText, suggestedText, status, reviewNote?, timestamp }`
- `CopySection`: Full section row shape
- `CopyMetadata`: SEO metadata row shape
- `CopyIntelligencePattern`: Intelligence pattern row shape
- `BatchMode`: `'review_inbox' | 'iterative'`
- `BatchJob`: Persistent batch job with `progress` object and `accumulatedSteering`
- `GeneratedPageCopy`, `GeneratedSectionCopy`: AI output shapes
- `ExportFormat`, `ExportScope`, `ExportRequest`, `ExportResult`: Export types
- `EntryCopyStatus`: Derived status for an entry

- [ ] **Step 2: Write Zod schemas for JSON columns and route validation**

Create `server/schemas/copy-pipeline.ts`:

```typescript
// server/schemas/copy-pipeline.ts
// Zod schemas for copy pipeline JSON columns (used by parseJsonSafe/parseJsonSafeArray)
// and route body validation (used by validate() middleware).
import { z } from '../middleware/validate.js';

// ── JSON column schemas (for parseJsonSafe / parseJsonSafeArray) ──

export const steeringEntrySchema = z.object({
  type: z.enum(['note', 'highlight', 'summary']),
  note: z.string(),
  highlight: z.string().optional(),
  resultVersion: z.number().int(),
  timestamp: z.string(),
});

export const clientSuggestionSchema = z.object({
  originalText: z.string(),
  suggestedText: z.string(),
  status: z.enum(['pending', 'accepted', 'rejected', 'modified']),
  reviewNote: z.string().optional(),
  timestamp: z.string(),
});

export const qualityFlagSchema = z.object({
  type: z.enum(['forbidden_phrase', 'keyword_stuffing', 'word_count_violation', 'missing_element', 'guardrail_violation']),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
});

export const batchProgressSchema = z.object({
  total: z.number().int(),
  generated: z.number().int(),
  reviewed: z.number().int(),
  approved: z.number().int(),
});

export const copySectionStatusSchema = z.enum([
  'pending', 'draft', 'client_review', 'approved', 'revision_requested',
]);

export const intelligencePatternTypeSchema = z.enum([
  'terminology', 'tone', 'structure', 'keyword_usage',
]);

// ── Route body validation schemas ──

export const generateCopySchema = z.object({
  accumulatedSteering: z.array(z.string()).optional(),
  force: z.boolean().optional(),
});

export const regenerateSectionSchema = z.object({
  note: z.string().min(1),
  highlight: z.string().optional(),
});

export const updateSectionStatusSchema = z.object({
  status: copySectionStatusSchema,
});

export const updateSectionTextSchema = z.object({
  copy: z.string().min(1),
});

export const addSuggestionSchema = z.object({
  originalText: z.string().min(1),
  suggestedText: z.string().min(1),
});

export const updatePatternSchema = z.object({
  active: z.boolean().optional(),
  pattern: z.string().optional(),
  patternType: intelligencePatternTypeSchema.optional(),
});

export const extractPatternsSchema = z.object({
  steeringNotes: z.array(z.string()).min(1),
});

export const startBatchSchema = z.object({
  entryIds: z.array(z.string()).min(1),
  mode: z.enum(['review_inbox', 'iterative']).optional(),
  batchSize: z.number().int().positive().optional(),
});

export const exportCopySchema = z.object({
  format: z.enum(['webflow_cms', 'csv', 'copy_deck']),
  scope: z.enum(['all', 'selected', 'single']),
  entryIds: z.array(z.string()).optional(),
  entryId: z.string().optional(),
  webflowSiteId: z.string().optional(),
  docFormat: z.enum(['google', 'word']).optional(),
});
```

- [ ] **Step 3: Commit**

```bash
git add shared/types/copy-pipeline.ts server/schemas/copy-pipeline.ts
git commit -m "feat(types): add copy pipeline shared types and Zod schemas"
```

---

## Task 4: Export Shared Constants

**Files:**
- Modify: `server/content-posts-ai.ts`

- [ ] **Step 1: Export WRITING_QUALITY_RULES**

In `server/content-posts-ai.ts`, line 221, change `const WRITING_QUALITY_RULES` to `export const WRITING_QUALITY_RULES`.

**Do NOT copy the string.** Just add the `export` keyword.

- [ ] **Step 2: Verify `getPageTypeConfig` is already exported**

In `server/content-brief.ts`, verify `getPageTypeConfig` is exported (line 495). It should already be. **Do NOT export the raw `PAGE_TYPE_CONFIGS` map** — use the accessor function.

- [ ] **Step 3: Commit**

```bash
git add server/content-posts-ai.ts
git commit -m "refactor: export WRITING_QUALITY_RULES for copy pipeline reuse"
```

**═══ COMMIT ALL SHARED CONTRACTS BEFORE DISPATCHING PARALLEL AGENTS ═══**

Verify: `npm run typecheck && npx vite build`

---

## Task 5: Copy Review Service (CRUD + Status)

**Files:** Create `server/copy-review.ts`

**Mandatory patterns (implementer MUST follow):**

1. **Prepared statements:** Use `createStmtCache` from `server/db/stmt-cache.ts`:
   ```typescript
   import { createStmtCache } from './db/stmt-cache.js';
   const stmts = createStmtCache(() => ({
     insertSection: db.prepare(`INSERT INTO copy_sections ...`),
     // ...
   }));
   ```
   Call as `stmts().insertSection.run(...)`.

2. **JSON parsing:** Use `parseJsonSafeArray` for array columns, `parseJsonSafe` for object columns:
   ```typescript
   import { parseJsonSafeArray } from './db/json-validation.js';
   import { steeringEntrySchema, clientSuggestionSchema, qualityFlagSchema } from './schemas/copy-pipeline.js';

   // In rowToSection():
   steeringHistory: parseJsonSafeArray(row.steering_history, steeringEntrySchema, 'copy-section.steeringHistory'),
   clientSuggestions: row.client_suggestions ? parseJsonSafeArray(row.client_suggestions, clientSuggestionSchema, 'copy-section.clientSuggestions') : null,
   qualityFlags: row.quality_flags ? parseJsonSafeArray(row.quality_flags, qualityFlagSchema, 'copy-section.qualityFlags') : null,
   ```

3. **Import extensions:** All `.js` (ESM).

4. **Logger:** `import { createLogger } from './logger.js';` → `const log = createLogger('copy-review');`

**Public API (must export these exact functions):**

| Function | Signature | Notes |
|----------|-----------|-------|
| `getSectionsForEntry` | `(entryId: string): CopySection[]` | |
| `getSection` | `(sectionId: string): CopySection \| null` | |
| `initializeSections` | `(workspaceId: string, entryId: string, sectionPlan: SectionPlanItem[]): CopySection[]` | Delete-then-insert in transaction; pass `workspaceId` for INSERT |
| `saveGeneratedCopy` | `(sectionId: string, data: { generatedCopy, aiAnnotation, aiReasoning, qualityFlags? }): CopySection \| null` | Sets status to `'draft'`, increments version |
| `updateSectionStatus` | `(sectionId: string, status: CopySectionStatus): CopySection \| null` | |
| `addSteeringEntry` | `(sectionId: string, entry: Omit<SteeringEntry, 'timestamp'>): CopySection \| null` | Appends to steering_history JSON |
| `addClientSuggestion` | `(sectionId: string, suggestion: Omit<ClientSuggestion, 'timestamp' \| 'status'>): CopySection \| null` | Sets status to `'revision_requested'` |
| `updateCopyText` | `(sectionId: string, newCopy: string): CopySection \| null` | Manual edit: status → `'draft'`, version++ |
| `getMetadata` | `(entryId: string): CopyMetadata \| null` | |
| `saveMetadata` | `(entryId: string, workspaceId: string, data: { seoTitle, metaDescription, ogTitle, ogDescription }): CopyMetadata` | Upsert pattern |
| `getEntryCopyStatus` | `(entryId: string): EntryCopyStatus` | Derives from section statuses |

**Status transition rules (encode in function guards):**
- `pending` → `draft` (via generation)
- `draft` → `client_review` (via send to client), `draft` → `approved` (internal approve)
- `client_review` → `approved` (client approve), `client_review` → `revision_requested` (client flags)
- `revision_requested` → `draft` (after revision)

- [ ] **Step 1: Implement the service following the patterns above**
- [ ] **Step 2: Commit**

```bash
git add server/copy-review.ts
git commit -m "feat: add copy review service with section CRUD, steering, and status management"
```

---

## Task 6: Copy Generation Service

**Files:** Create `server/copy-generation.ts`

**Critical requirements:**

1. **Use `buildSystemPrompt`** for all AI calls:
   ```typescript
   import { buildSystemPrompt } from './prompt-assembly.js';
   // ✅ Correct:
   const systemPrompt = buildSystemPrompt(workspaceId, baseInstructions);
   // ❌ Wrong: manually concatenating voice DNA into prompt
   ```

2. **VoiceProfile fields are parsed objects** — access directly:
   ```typescript
   const profile = getVoiceProfile(workspaceId);
   if (profile) {
     const { voiceDNA, guardrails, contextModifiers, samples } = profile;
     // voiceDNA is already a VoiceDNA object, NOT a JSON string
     // samples are already included on the profile return
   }
   ```

3. **`generateBrief` signature** — targetKeyword is a separate param:
   ```typescript
   const brief = await generateBrief(workspaceId, entry.primaryKeyword, {
     secondaryKeywords: entry.secondaryKeywords ?? [],
     pageType: entry.pageType,
   });
   ```

4. **`listDeliverables`** — NOT `getDeliverables`:
   ```typescript
   import { listDeliverables } from './brand-identity.js';
   const deliverables = listDeliverables(workspaceId);
   ```

5. **`getPageTypeConfig` accessor** — NOT raw config import:
   ```typescript
   import { getPageTypeConfig } from './content-brief.js';
   const config = getPageTypeConfig(entry.pageType);
   ```

6. **Handle all 10 `ContentPageType` values** in the emphasis mapping.

7. **`createStmtCache` pattern** (same as Task 5).

8. **`parseJsonSafe`/`parseJsonSafeArray`** for any JSON column reads.

**Public API:**

| Function | Signature |
|----------|-----------|
| `generateCopyForEntry` | `(wsId, blueprintId, entryId, accumulatedSteering?): Promise<{ sections: CopySection[]; metadata: CopyMetadata }>` |
| `regenerateSection` | `(wsId, blueprintId, entryId, sectionId, steeringNote, highlight?): Promise<CopySection \| null>` |
| `runQualityCheck` | `(copy, sectionPlan, guardrails?): QualityFlag[]` — pure function, no AI call |
| `buildCopyGenerationContext` | `(wsId, blueprint, entry, accumulatedSteering?): Promise<string>` |

**8-Layer Context Assembly:**
1. Brand Foundation (brandscript sections)
2. Voice (voice DNA + samples + guardrails + context modifiers) — via `buildSystemPrompt` for voice DNA injection
3. Brand Identity (approved deliverables)
4. Page Strategy (entry section plan, keywords, narrative roles)
4.5. Brief enrichment (auto-generate via `generateBrief` if no `briefId`)
5. Cross-Page Awareness (other entries, approved copy from other pages)
6. SEO Intelligence (keyword metrics, PAA, competitors from brief)
7. Copy Intelligence (workspace-level learned patterns)
8. Generation Rules (`WRITING_QUALITY_RULES` + copy-specific rules + AEO rules)
8.5. Live Intelligence (from `buildWorkspaceIntelligence` — insights, client signals, learnings)
9. Accumulated steering (for iterative batch mode)

**AI Model:** Claude Sonnet 4 (`claude-sonnet-4-20250514`) for generation and regeneration. `max_tokens: 8000`.

**Quality check:** `runQualityCheck()` is pure regex/pattern matching — no AI call. Runs synchronously after generation. Checks: forbidden phrases from `WRITING_QUALITY_RULES`, voice guardrail violations, word count violations (50% over/under target), keyword stuffing (4+ of same keyword).

- [ ] **Step 1: Implement following the patterns above**
- [ ] **Step 2: Commit**

```bash
git add server/copy-generation.ts
git commit -m "feat: add copy generation engine with 8-layer context assembly and quality check"
```

---

## Task 7: Copy Intelligence Service

**Files:** Create `server/copy-intelligence.ts`

**Mandatory patterns:** `createStmtCache`, `parseJsonSafe`/`parseJsonSafeArray` (if reading JSON columns), `.js` import extensions, `createLogger('copy-intelligence')`.

**Public API:**

| Function | Signature |
|----------|-----------|
| `getAllPatterns` | `(wsId): CopyIntelligencePattern[]` |
| `getActivePatterns` | `(wsId): CopyIntelligencePattern[]` |
| `addPattern` | `(wsId, data: { patternType, pattern, source? }): CopyIntelligencePattern` — dedup by pattern text, increment frequency if exists |
| `togglePattern` | `(patternId, active): void` |
| `removePattern` | `(patternId): void` |
| `updatePatternText` | `(patternId, pattern, patternType): void` |
| `extractPatterns` | `(wsId, steeringNotes: string[]): Promise<CopyIntelligencePattern[]>` — GPT-4.1-mini classification |
| `getPatternsForPromotion` | `(wsId): CopyIntelligencePattern[]` — frequency >= 3 |

**AI Model for extraction:** GPT-4.1-mini (`gpt-4.1-mini`).

**Extraction trigger:** Called by the route handler when steering notes accumulate. NOT a cron — explicit trigger via POST endpoint. Future: could also trigger on approval.

- [ ] **Step 1: Implement**
- [ ] **Step 2: Commit**

```bash
git add server/copy-intelligence.ts
git commit -m "feat: add copy intelligence service with pattern extraction and promotion detection"
```

---

## Task 8: Copy Export Service

**Files:** Create `server/copy-export.ts`

**Mandatory patterns:** `createStmtCache`, `createLogger('copy-export')`.

**Public API:**

| Function | Signature |
|----------|-----------|
| `exportCsv` | `(wsId, blueprintId, entryIds?): { csv: string; filename: string }` |
| `exportCopyDeck` | `(wsId, blueprintId, entryIds?): { markdown: string; filename: string }` |
| `exportToWebflow` | `(wsId, blueprintId, entryIds?, webflowSiteId?): Promise<ExportResult>` — stub for now, returns error if no Webflow connection |

**CSV format:** Matches Webflow CMS import format. Column headers: `name`, `page_type`, `primary_keyword`, then one column per section type (`hero_headline`, `hero_body`, `problem_body`, etc.), plus `seo_title`, `meta_description`, `og_title`, `og_description`.

**Copy deck format:** Markdown document. Organized by page → section. Each section shows: section name, narrative role, copy text, annotation. Approved sections marked ✓, drafts marked "pending."

**Webflow export:** Stub that checks for Webflow connection and returns appropriate error. Full implementation deferred to Tier 2 or later.

- [ ] **Step 1: Implement**
- [ ] **Step 2: Commit**

```bash
git add server/copy-export.ts
git commit -m "feat: add copy export service with CSV and copy deck generation"
```

**═══ DIFF REVIEW CHECKPOINT 1 ═══**

Run:
```bash
npm run typecheck
npx vite build
npx vitest run
git diff --stat HEAD~4
# Grep for duplicate function names across new files:
grep -rn 'export function' server/copy-review.ts server/copy-generation.ts server/copy-intelligence.ts server/copy-export.ts | sort
```

Fix any issues before proceeding.

---

## Task 9: SEO Context Integration

**Files:** Modify `server/seo-context.ts`

- [ ] **Step 1: Add `buildCopyIntelligenceContext()`**

```typescript
import { getActivePatterns } from './copy-intelligence.js';

export function buildCopyIntelligenceContext(workspaceId: string): string {
  const patterns = getActivePatterns(workspaceId);
  if (patterns.length === 0) return '';
  const grouped: Record<string, string[]> = {};
  for (const p of patterns) {
    (grouped[p.patternType] ??= []).push(p.pattern);
  }
  return `LEARNED COPY PATTERNS (apply to all content):\n${
    Object.entries(grouped).map(([type, rules]) => `  ${type}: ${rules.join('; ')}`).join('\n')
  }`;
}
```

- [ ] **Step 2: Add `buildBlueprintContext()`**

```typescript
import { listBlueprints, getBlueprint } from './page-strategy.js';
import { getSectionsForEntry } from './copy-review.js';

export function buildBlueprintContext(workspaceId: string, pagePath?: string, pageKeyword?: string): string {
  // Find active blueprint, match entry by keyword if provided, include approved copy for consistency
  // See spec Enhancement 15 for full logic
}
```

- [ ] **Step 3: Wire into `buildSeoContext()` return**

Add `copyIntelligenceBlock` and `blueprintBlock` to the return object and `fullContext` array (appended to END for backwards compatibility).

Update the `SeoContext` interface (line 118 of `seo-context.ts`) to include the new optional fields:
```typescript
copyIntelligenceBlock?: string;
blueprintBlock?: string;
```

**IMPORTANT: Cache invalidation.** `buildSeoContext()` has a 5-minute TTL cache (`seoContextCache`, line 150). After copy intelligence patterns are extracted or toggled, the caller must call `clearSeoContextCache(workspaceId)` (exported from the same file, line 154) to ensure the new patterns appear in the next AI call. The route handlers in Task 10 that modify intelligence patterns must call this.

- [ ] **Step 4: Commit**

```bash
git add server/seo-context.ts
git commit -m "feat: wire copy intelligence + blueprint context into seo-context.ts"
```

---

## Task 10: API Routes

**Files:** Create `server/routes/copy-pipeline.ts`

**Mandatory patterns:**

1. **Zod validation on ALL mutation routes:** Import `{ validate, z }` from `'../middleware/validate.js'` and schemas from `'../schemas/copy-pipeline.js'`.

2. **`broadcastToWorkspace`** on EVERY mutation route:
   ```typescript
   import { broadcastToWorkspace } from '../broadcast.js';
   import { WS_EVENTS } from '../ws-events.js';
   // After mutation:
   broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, { sectionId, status });
   ```

3. **`addActivity`** on significant operations:
   ```typescript
   import { addActivity } from '../activity-log.js';
   // After generation:
   addActivity(workspaceId, 'copy_generated', `Generated copy for "${entry.name}"`);
   // After approval:
   addActivity(workspaceId, 'copy_approved', `Approved section in "${entry.name}"`);
   ```

4. **`requireWorkspaceAccess('workspaceId')`** on ALL routes.

5. **Route ordering:** Literal paths before param routes (e.g., `/intelligence/promotable` before `/intelligence/:patternId`).

**Routes to implement:**

| Method | Path | Schema | Broadcast | Activity |
|--------|------|--------|-----------|----------|
| POST | `/api/copy/:workspaceId/:blueprintId/:entryId/generate` | `generateCopySchema` | `COPY_SECTION_UPDATED` | `copy_generated` |
| POST | `/api/copy/:workspaceId/:blueprintId/:entryId/regenerate/:sectionId` | `regenerateSectionSchema` | `COPY_SECTION_UPDATED` | — |
| GET | `/api/copy/:workspaceId/entry/:entryId/sections` | — | — | — |
| GET | `/api/copy/:workspaceId/entry/:entryId/status` | — | — | — |
| GET | `/api/copy/:workspaceId/entry/:entryId/metadata` | — | — | — |
| PATCH | `/api/copy/:workspaceId/section/:sectionId/status` | `updateSectionStatusSchema` | `COPY_SECTION_UPDATED` | `copy_approved` (when status=approved) |
| PATCH | `/api/copy/:workspaceId/section/:sectionId/text` | `updateSectionTextSchema` | `COPY_SECTION_UPDATED` | — |
| POST | `/api/copy/:workspaceId/section/:sectionId/suggest` | `addSuggestionSchema` | `COPY_SECTION_UPDATED` | `copy_suggestion_added` |
| POST | `/api/copy/:workspaceId/:blueprintId/batch` | `startBatchSchema` | `COPY_BATCH_PROGRESS` | `copy_batch_started` |
| GET | `/api/copy/:workspaceId/batch/:batchId` | — | — | — |
| POST | `/api/copy/:workspaceId/:blueprintId/export` | `exportCopySchema` | `COPY_EXPORT_COMPLETE` | `copy_exported` |
| GET | `/api/copy/:workspaceId/intelligence` | — | — | — |
| GET | `/api/copy/:workspaceId/intelligence/promotable` | — | — | — |
| PATCH | `/api/copy/:workspaceId/intelligence/:patternId` | `updatePatternSchema` | `COPY_INTELLIGENCE_UPDATED` | — |
| DELETE | `/api/copy/:workspaceId/intelligence/:patternId` | — | `COPY_INTELLIGENCE_UPDATED` | — |
| POST | `/api/copy/:workspaceId/intelligence/extract` | `extractPatternsSchema` | `COPY_INTELLIGENCE_UPDATED` | — |

**Cache invalidation:** The PATCH, DELETE, and POST `/intelligence/*` handlers must call `clearSeoContextCache(workspaceId)` (from `server/seo-context.ts`) after mutating intelligence patterns. Otherwise the 5-minute TTL cache will serve stale patterns to all AI features.

- [ ] **Step 1: Implement all routes with validate, broadcast, and activity**
- [ ] **Step 2: Commit**

```bash
git add server/routes/copy-pipeline.ts
git commit -m "feat: add copy pipeline routes with Zod validation, broadcast, and activity logging"
```

---

## Task 11: Register Routes in App.ts

**Files:** Modify `server/app.ts`

- [ ] **Step 1: Add import and mount**

```typescript
import copyPipelineRoutes from './routes/copy-pipeline.js';
// In route mounting section:
app.use(copyPipelineRoutes);
```

- [ ] **Step 2: Commit**

```bash
git add server/app.ts
git commit -m "feat: register copy pipeline routes in app.ts"
```

---

## Task 12: Frontend API Client

**Files:** Modify `src/api/brand-engine.ts`

- [ ] **Step 1: Add copy pipeline API functions**

Add imports at the TOP of the file (with existing imports):
```typescript
import type {
  CopySection, CopyMetadata, CopySectionStatus,
  CopyIntelligencePattern, EntryCopyStatus, BatchJob,
  ExportRequest, ExportResult,
} from '../../shared/types/copy-pipeline';
```

Add API namespaces: `copyGeneration`, `copyReview`, `copyBatch`, `copyExport`, `copyIntelligence` — following the existing pattern of `blueprints`, `blueprintEntries`, etc.

See existing plan lines 1948–2001 for the API shape (those are correct).

- [ ] **Step 2: Commit**

```bash
git add src/api/brand-engine.ts
git commit -m "feat: add copy pipeline frontend API client"
```

---

## Task 13: React Query Hooks

**Files:** Create `src/hooks/admin/useCopyPipeline.ts`

**Pattern:** Follow existing hooks in `src/hooks/admin/`. Use `useQuery`/`useMutation` from `@tanstack/react-query`. Query key prefix: `admin-copy-*`.

**Required hooks:**

```typescript
// Queries
export function useCopySections(wsId: string, entryId: string)  // → CopySection[]
export function useCopyStatus(wsId: string, entryId: string)     // → EntryCopyStatus
export function useCopyMetadata(wsId: string, entryId: string)   // → CopyMetadata | null
export function useCopyIntelligence(wsId: string)                 // → CopyIntelligencePattern[]
export function usePromotablePatterns(wsId: string)               // → CopyIntelligencePattern[]
export function useBatchJob(wsId: string, batchId: string)        // → BatchJob | null

// Mutations
export function useGenerateCopy(wsId: string, blueprintId: string)        // → mutate(entryId)
export function useRegenerateCopySection(wsId: string, blueprintId: string)  // → mutate({ entryId, sectionId, note, highlight? })
export function useUpdateSectionStatus(wsId: string)               // → mutate({ sectionId, status })
export function useUpdateSectionText(wsId: string)                 // → mutate({ sectionId, copy })
export function useAddSuggestion(wsId: string)                     // → mutate({ sectionId, originalText, suggestedText })
export function useStartBatch(wsId: string, blueprintId: string)   // → mutate({ entryIds, mode?, batchSize? })
export function useExportCopy(wsId: string, blueprintId: string)   // → mutate(ExportRequest)
export function useTogglePattern(wsId: string)                     // → mutate({ patternId, active })
export function useDeletePattern(wsId: string)                     // → mutate(patternId)
export function useExtractPatterns(wsId: string)                   // → mutate(steeringNotes[])
```

**WebSocket invalidation:** Each hook file must include `useWorkspaceEvents` to invalidate relevant caches:

```typescript
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';

// Inside the hooks file or a wrapper:
useWorkspaceEvents(workspaceId, {
  'copy:section_updated': () => {
    queryClient.invalidateQueries({ queryKey: ['admin-copy-sections'] });
    queryClient.invalidateQueries({ queryKey: ['admin-copy-status'] });
  },
  'copy:metadata_updated': () => {
    queryClient.invalidateQueries({ queryKey: ['admin-copy-metadata'] });
  },
  'copy:batch_progress': () => {
    queryClient.invalidateQueries({ queryKey: ['admin-copy-batch'] });
  },
  'copy:intelligence_updated': () => {
    queryClient.invalidateQueries({ queryKey: ['admin-copy-intelligence'] });
  },
});
```

**IMPORTANT:** Use `useWorkspaceEvents`, NOT `useGlobalAdminEvents`. The latter doesn't send `subscribe` so workspace-scoped events are never received.

- [ ] **Step 1: Implement hooks with WebSocket invalidation**
- [ ] **Step 2: Commit**

```bash
git add src/hooks/admin/useCopyPipeline.ts
git commit -m "feat: add copy pipeline React Query hooks with WebSocket invalidation"
```

**═══ DIFF REVIEW CHECKPOINT 2 ═══**

```bash
npm run typecheck
npx vite build
npx vitest run
```

---

## Task 14: CopyReviewPanel Component

**Files:** Create `src/components/brand/CopyReviewPanel.tsx`

**Props:** `{ workspaceId: string; blueprintId: string; entryId: string }`

**Key requirements:**
- Use hooks from `useCopyPipeline.ts`
- Display each section: section type label, narrative role badge, generated copy, AI annotation, quality flags (if any)
- Action buttons per section: Approve, Regenerate, Send to Client Review
- "Regenerate with note" — text input → `useRegenerateCopySection` mutation
- "Highlight + steer" — text selection popover → same mutation with `highlight` param. Reference existing `SteeringChat` component from Phase 1 for the pattern.
- Manual edit mode — click to edit, save via `useUpdateSectionText`
- SEO metadata section at top with same review controls
- Status badge per section
- Overall progress: "5/8 sections approved"
- **Error boundary:** Wrap in `<ErrorBoundary>`
- **Loading state:** Use `<Skeleton>` for layout-preserving shimmer with contextual message "Loading copy sections..."
- **Empty state:** Use `<EmptyState>` with CTA "Generate Copy" when no sections exist
- **Accessibility:** ARIA labels on action buttons, keyboard navigation between sections

**UI primitives to use:** `SectionCard`, `Badge`, `EmptyState`, `Skeleton` from `src/components/ui/`.

- [ ] **Step 1: Implement**
- [ ] **Step 2: Commit**

```bash
git add src/components/brand/CopyReviewPanel.tsx
git commit -m "feat: add CopyReviewPanel with section review, steering, and status management"
```

---

## Task 15: BatchGenerationPanel Component

**Files:** Create `src/components/brand/BatchGenerationPanel.tsx`

**Props:** `{ workspaceId: string; blueprintId: string; entries: BlueprintEntry[] }`

**Key requirements:**
- Checkbox list of entries with page type badges and current copy status
- Mode selector: "Review Inbox" vs "Iterative Batch"
- Batch size input for iterative mode (default 5)
- Generate button → `useStartBatch` mutation
- Progress tracking via `useBatchJob` — "Generating: 3/15 done"
- Accumulated steering notes visible for iterative mode
- Pause/resume: stop generating next batch (not cancel in-progress)
- **Error boundary, loading state, empty state** (same patterns as Task 14)

- [ ] **Step 1: Implement**
- [ ] **Step 2: Commit**

```bash
git add src/components/brand/BatchGenerationPanel.tsx
git commit -m "feat: add BatchGenerationPanel with mode selection and progress tracking"
```

---

## Task 16: CopyExportPanel Component

**Files:** Create `src/components/brand/CopyExportPanel.tsx`

**Props:** `{ workspaceId: string; blueprintId: string; entries: BlueprintEntry[] }`

**Key requirements:**
- Format selector: CSV, Copy Deck (Webflow CMS grayed out / disabled until connection exists)
- Scope selector: All approved, Selected entries, Single entry
- Only show entries with approved copy as exportable
- Export button → `useExportCopy` mutation → show download link or success message
- **Error boundary, loading state**

- [ ] **Step 1: Implement**
- [ ] **Step 2: Commit**

```bash
git add src/components/brand/CopyExportPanel.tsx
git commit -m "feat: add CopyExportPanel with format and scope selection"
```

---

## Task 17: CopyIntelligenceManager Component

**Files:** Create `src/components/brand/CopyIntelligenceManager.tsx`

**Props:** `{ workspaceId: string }`

**Key requirements:**
- List patterns grouped by type (terminology, tone, structure, keyword_usage)
- Toggle switch per pattern (active/inactive) via `useTogglePattern`
- Inline edit pattern text
- Delete pattern via `useDeletePattern`
- "Promotable" section: patterns with frequency >= 3, with "Promote to Voice Guardrail" button
- **Error boundary, loading state, empty state** ("No patterns learned yet")

- [ ] **Step 1: Implement**
- [ ] **Step 2: Commit**

```bash
git add src/components/brand/CopyIntelligenceManager.tsx
git commit -m "feat: add CopyIntelligenceManager with pattern CRUD and promotion"
```

**═══ DIFF REVIEW CHECKPOINT 3 ═══**

```bash
npm run typecheck
npx vite build
npx vitest run
```

---

## Task 18: BlueprintDetail Integration + Feature Flag

**Files:** Modify `src/components/brand/BlueprintDetail.tsx`

- [ ] **Step 1: Add Copy tab to entry detail view**

- Add a tab/toggle for "Copy" alongside the existing section plan view
- When in Copy view, show `CopyReviewPanel` for the selected entry
- Add copy status badge on each entry card in the list
- Add "Generate Copy" teal button on entries without copy
- Add batch generation controls at the blueprint level (show `BatchGenerationPanel`)
- Add export panel at the blueprint level (show `CopyExportPanel`)
- Copy intelligence manager accessible from blueprint header

- [ ] **Step 2: Wrap in feature flag**

```typescript
import { FeatureFlag } from '../ui/FeatureFlag';

// Wrap the Copy tab and all copy-related UI:
<FeatureFlag flag="copy-engine-pipeline">
  {/* Copy tab content */}
</FeatureFlag>
```

- [ ] **Step 3: Add `useWorkspaceEvents` handler for copy events**

The component should have a `useWorkspaceEvents` handler that invalidates copy-related queries when copy events are received.

- [ ] **Step 4: Commit**

```bash
git add src/components/brand/BlueprintDetail.tsx
git commit -m "feat: add Copy tab to BlueprintDetail with feature flag gate"
```

---

## Task 19: Integration Tests + Broadcast Handler Pairs

**Files:**
- Create: `tests/integration/copy-pipeline-routes.test.ts` (port **13318**)
- Modify: `tests/integration/broadcast-handler-pairs.test.ts`

- [ ] **Step 1: Write integration tests**

**Port:** 13318 (next available after 13317).

**Seed requirements:** Need a workspace with a blueprint and entries. Use `seedWorkspace()` from test fixtures, then create a blueprint + entry via API.

**Required test cases:**

1. **Smoke — route registration:** GET any copy endpoint for fresh workspace → 200 or 404 (never "Cannot GET")
2. **Copy section CRUD:** GET sections for fresh entry → empty array; after generation, GET returns sections
3. **Status updates:** PATCH status → validates against allowed values (400 for invalid), updates on valid
4. **Text updates:** PATCH text → saves new copy, sets status to draft
5. **Client suggestion:** POST suggest → creates suggestion, sets status to revision_requested
6. **Intelligence CRUD:** GET → empty array for fresh workspace; manual add → appears in list; toggle → updates active; delete → removes
7. **Zod validation:** Bad payloads return 400 (invalid status, missing required fields)
8. **Workspace isolation:** Sections from wsA not visible from wsB; cross-workspace PATCH → 403 or 404
9. **Export:** POST export with scope=all → returns CSV/markdown content

**Cleanup:** `afterAll` must clean up seeded data.

- [ ] **Step 2: Update broadcast handler pairs test**

In `tests/integration/broadcast-handler-pairs.test.ts`, add the new copy pipeline events to the expected broadcast/handler pairs. Each new WS_EVENT must have a corresponding `useWorkspaceEvents` handler.

Events to add:
- `copy:section_updated` ↔ handler in CopyReviewPanel/useCopyPipeline
- `copy:metadata_updated` ↔ handler in useCopyPipeline
- `copy:batch_progress` ↔ handler in BatchGenerationPanel/useCopyPipeline
- `copy:batch_complete` ↔ handler in useCopyPipeline
- `copy:intelligence_updated` ↔ handler in CopyIntelligenceManager/useCopyPipeline
- `copy:export_complete` ↔ handler in CopyExportPanel/useCopyPipeline

If any of these don't have handlers yet, add them to `KNOWN_UNHANDLED_BROADCASTS` with a comment explaining why (e.g., "Tier 2 — client portal handler pending").

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/integration/copy-pipeline-routes.test.ts
npx vitest run tests/integration/broadcast-handler-pairs.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add tests/integration/copy-pipeline-routes.test.ts tests/integration/broadcast-handler-pairs.test.ts
git commit -m "test: add copy pipeline integration tests and broadcast handler pairs"
```

**═══ FULL VERIFICATION ═══**

```bash
npm run typecheck
npx vite build
npx vitest run
npx tsx scripts/pr-check.ts
```

ALL must pass. Fix any failures before proceeding to Tier 2.

---

# TIER 2: Platform Integration Features

> These tasks ship incrementally after Tier 1 is working and verified. Each is independently deployable.

## Task 20: Approved Copy → Voice Samples (Enhancement 10)

**File:** Modify `server/copy-review.ts`

When `updateSectionStatus()` changes a section to `approved`, auto-add the copy as a voice sample.

```typescript
import { addVoiceSample } from './voice-calibration.js';

const SECTION_TYPE_TO_CONTEXT_TAG: Record<string, string> = {
  'hero': 'headline', 'problem': 'body', 'solution': 'body',
  'features-benefits': 'body', 'process': 'body', 'faq': 'faq',
  'cta': 'cta', 'about-team': 'about', 'content-body': 'body',
};
```

Rules: cap 3 `copy_approved` samples per context_tag per workspace (FIFO), only save on `approved` status.

---

## Task 21: Voice Feedback Loop (Enhancement 9)

**File:** Create `server/copy-voice-feedback.ts`

Classify steering notes as `content_feedback` vs `voice_feedback` via GPT-4.1-mini. Voice feedback → suggest voice profile updates (flag for review, don't auto-apply).

---

## Task 22: Quality Rules Evolution (Enhancement 12)

**File:** Modify `server/copy-intelligence.ts`

When pattern frequency >= 3, surface "Promote to Voice Guardrail" suggestion. The UI (CopyIntelligenceManager) already has the button (Task 17).

---

## Task 23: Brief Quality Feedback Loop (Enhancement 11)

**File:** Modify `server/copy-review.ts`

When all sections for an entry are approved, calculate `copy_approval_rate` (% approved on first try — version === 1) and update linked content brief.

---

## Task 24: Client Copy Review (Spec System 3)

**Files:**
- Create: `src/components/client/ClientCopyReview.tsx`
- Modify: `server/routes/copy-pipeline.ts` (add client-facing routes)

The spec defines a complete client review system:
- Client sees copy organized by page → section, with annotations and status badges
- Approve action → marks section as `approved`
- Suggest edit action → inline text editing in suggesting mode
- Client's suggested text stored alongside original
- Studio sees both versions and can accept/reject/modify

Extends the existing client portal pattern from Phase 2.

---

## Task 25: Questionnaire → Brandscript Auto-Population (Enhancement 16)

**File:** Modify `server/brandscript.ts`

Add `prefillFromQuestionnaire()` that maps questionnaire fields to brandscript sections.

---

## Task 26: Admin Chat → Blueprint + Copy Awareness (Enhancement 18)

**File:** Modify `server/admin-chat-context.ts`

Add blueprint and copy status as data sources for the admin chat AI context.

---

## Task 27: Content Decay → Copy Refresh (Enhancement 17)

**File:** Modify `server/content-decay.ts` or create `server/copy-refresh.ts`

When decay is detected, match to blueprint entries and suggest section-specific refresh.

---

## Task 28: Workspace Intelligence Wiring

**File:** Modify `server/workspace-intelligence.ts`

CLAUDE.md rule: "any new table or store that captures workspace activity must be surfaced in `server/workspace-intelligence.ts`."

Add copy pipeline data to the intelligence assembly:
- Copy section approval rates → `ContentPipelineSlice` or new `CopyPipelineSlice`
- Copy intelligence patterns → intelligence context
- Batch job status → workspace overview

---

## Task 29: Documentation + Roadmap Updates

**Files:**
- Modify: `FEATURE_AUDIT.md`
- Modify: `data/roadmap.json`
- Modify: `BRAND_DESIGN_LANGUAGE.md` (if new UI patterns introduced)

- [ ] **Step 1: Update FEATURE_AUDIT.md**

Add entries for:
- Copy Generation Pipeline (core)
- Copy Review & Steering
- Batch Copy Generation
- Copy Export (CSV, Copy Deck)
- Copy Intelligence (pattern learning)
- Client Copy Review

- [ ] **Step 2: Update roadmap.json**

Mark Copy Pipeline tasks as done, add notes. Run `npx tsx scripts/sort-roadmap.ts`.

- [ ] **Step 3: Update BRAND_DESIGN_LANGUAGE.md**

If the CopyReviewPanel introduced new color patterns or UI conventions, document them.

- [ ] **Step 4: Final pr-check**

```bash
npx tsx scripts/pr-check.ts
```

---

## Systemic Improvements

### Shared utilities to extract

- **Copy status derivation** — `getEntryCopyStatus()` is used by both `copy-review.ts` (server) and the frontend hooks. If the derivation logic is also needed by the client portal (Task 24), extract to a shared utility in `shared/utils/copy-status.ts`.
- **Section type → context tag mapping** — `SECTION_TYPE_TO_CONTEXT_TAG` is needed by both the voice sample feedback (Task 20) and the copy intelligence extraction (Task 7). Define once in `shared/types/copy-pipeline.ts`.

### pr-check rules to consider

- **Bare `JSON.parse` in `server/copy-*.ts`** — enforce `parseJsonSafe`/`parseJsonSafeArray` usage in all copy pipeline files. This may already be caught by the existing pr-check rule; verify after implementation.
- **`broadcastToWorkspace` without matching `useWorkspaceEvents`** — this is a recurring completeness issue. Consider a pr-check rule that scans for new `broadcastToWorkspace` calls and warns if no `useWorkspaceEvents` handler exists for the event name.
- **Direct voice DNA injection in copy-generation.ts** — if anyone bypasses `buildSystemPrompt()` and manually inlines voice DNA, it duplicates Layer 2. A pr-check rule scanning for `voiceDNA` or `voiceDnaJson` in `copy-generation.ts` outside of context-building functions would catch this.

### Test coverage additions

| Test | Port | What it covers |
|------|------|---------------|
| `tests/integration/copy-pipeline-routes.test.ts` | 13318 | All copy routes: CRUD, generation, status, export, intelligence |
| `tests/integration/broadcast-handler-pairs.test.ts` | existing | Updated with 6 new copy event pairs |

**Not in Tier 1 but needed for Tier 2:**
- Client portal copy review routes (when Task 24 ships)
- Voice sample feedback loop (Task 20 — verify sample is created on approval)
- Brief quality feedback loop (Task 23 — verify `copy_approval_rate` is set)

---

## Implementer Dispatch Requirements

When dispatching subagents for parallel tasks (Tasks 5-8, Tasks 14-17), each implementer prompt MUST include:

1. **Full task text** from this plan
2. **File ownership list** — files they own, files they must not touch
3. **Cross-phase contracts** — the "Verified Cross-Phase Contracts" table above (functions to import, NOT recreate)
4. **CLAUDE.md conventions relevant to the task:**
   - `createStmtCache()` pattern for prepared statements (not `let _stmts`)
   - `parseJsonSafe`/`parseJsonSafeArray` for DB JSON columns (not bare `JSON.parse`)
   - `.js` import extensions (ESM)
   - `createLogger(module)` for structured logging
   - `{ error: string }` API error shape
   - `admin-*` query key prefix for React Query hooks
   - `useWorkspaceEvents` for broadcast handlers (NOT `useGlobalAdminEvents`)
   - TypeScript strict — no `any` unless unavoidable
   - Imports at top of file, never mid-file
5. **Known gotchas:**
   - VoiceProfile fields are parsed objects, not JSON strings
   - `generateBrief(wsId, targetKeyword, context)` — targetKeyword is separate param
   - `listDeliverables` not `getDeliverables`
   - `getPageTypeConfig()` accessor, not raw config map
   - Literal routes before param routes in Express
   - `buildSystemPrompt()` handles voice DNA — don't inject it manually
   - AI-call-before-DB-write needs transaction guard (CLAUDE.md + pr-check enforced)
   - UPDATE/DELETE must include `workspace_id` scoping (pr-check enforced)
6. **Model assignment** for the task

---

## PR Gates & Review Strategy

### PR boundary: Tier 1 = one PR, Tier 2 = follow-up PRs

This plan covers Phase 3 of the Copy & Brand Engine. **Tier 1 (Tasks 1–19)** ships as one PR targeting `staging`. After Tier 1 is merged and verified on staging, Tier 2 tasks ship as individual or small-batch follow-up PRs.

Phase 3 does NOT start until Phase 2 is merged and CI is green on `staging`.

### Worktree base branch: `staging` (not `main`)

Phase 2 (page-strategy) is merged to `staging` but not yet to `main`. The implementation worktree **must** branch from `staging` so Phase 2 tables, types, and functions exist. Branching from `main` will cause immediate import failures.

### Pre-commit checklist (STOP before claiming done)

```
[ ] npm run typecheck                          — zero type errors (uses tsc -b)
[ ] npx vite build                             — production build succeeds
[ ] npx vitest run                             — full test suite green (not just new tests)
[ ] npx tsx scripts/pr-check.ts               — zero violations
[ ] FEATURE_AUDIT.md updated                  — copy pipeline features documented
[ ] data/roadmap.json updated                 — items marked done with notes
[ ] BRAND_DESIGN_LANGUAGE.md updated         — if any UI colors/patterns changed
[ ] grep -r "violet\|indigo" src/components/ — zero matches (Three Laws of Color)
[ ] grep -r "purple-" src/components/client/ — zero matches (no purple in client views)
[ ] No any casts in new files                 — grep -rn ': any\|as any' server/copy-*.ts
```

### Code review (mandatory before merge)

This plan uses parallel agents and touches 10+ files → **invoke `scaled-code-review` skill**.

Review timing:
- After Tier 1 completion (Tasks 1-19): invoke `scaled-code-review` on all Tier 1 commits
- Fix all Critical and Important issues before proceeding to Tier 2
- After Tier 2 completion: invoke `scaled-code-review` on Tier 2 commits
- Fix all issues before opening the PR

For individual task reviews during implementation (per subagent-driven-development flow), use `superpowers:requesting-code-review` after each task.

### Staging gate

1. Open PR targeting `staging` (not `main`)
2. CI must pass on the PR
3. Merge to `staging`
4. Verify on staging deploy (test end-to-end: generate → review → approve → export)
5. Only then merge `staging` → `main`

See `docs/workflows/deploy.md` for the full branch model.

---

## Verification Strategy

### After Tier 1 (Tasks 1-19)

**Type + Build:**
```bash
npm run typecheck && npx vite build
```

**Full test suite:**
```bash
npx vitest run
npx vitest run tests/integration/copy-pipeline-routes.test.ts --reporter=verbose
```

**pr-check:**
```bash
npx tsx scripts/pr-check.ts
```

**Migration verification:**
```bash
sqlite3 data/app.db ".tables" | grep -E "copy_sections|copy_metadata|copy_intelligence|copy_batch_jobs"
sqlite3 data/app.db "PRAGMA table_info(copy_sections);"
```

**Route registration smoke test:**
```bash
# Start dev server, then:
curl -s http://localhost:3001/api/copy/test-workspace/intelligence -H "x-auth-token: $TOKEN" | head -20
# Should return [] or 401 — never "Cannot GET" (which means route not registered)
```

**Color violation check:**
```bash
grep -rn "violet\|indigo" src/components/brand/Copy*.tsx src/components/brand/Batch*.tsx
# Should return zero matches
```

**UI verification (via preview tools):**
- Navigate to a workspace with a blueprint
- Verify Copy tab appears on BlueprintDetail (behind feature flag)
- Enable feature flag → verify tab shows empty state with "Generate Copy" CTA
- Verify loading skeleton renders while data loads

### After Tier 2 (Tasks 20-29)

- Verify approved copy creates voice sample (Task 20)
- Verify intelligence patterns accumulate across entries (Task 22)
- Verify client copy review renders in client portal (Task 24)
- Verify workspace intelligence includes copy data (Task 28)

---

## CLAUDE.md Rules Checklist

Every rule below applies to this plan. Cross-referenced against CLAUDE.md on 2026-04-12.

| Rule | How plan addresses it |
|------|----------------------|
| `createStmtCache()` for prepared statements | Mandated in Tasks 5-8, in "Mandatory patterns" |
| `parseJsonSafe`/`parseJsonSafeArray` for JSON columns | Mandated in Tasks 5-8, Zod schemas in Task 3 |
| `broadcastToWorkspace()` on every mutation | Task 10 route table lists broadcast per endpoint |
| `useWorkspaceEvents` (not `useGlobalAdminEvents`) | Task 13 hooks file includes WS handler setup |
| `addActivity()` on significant operations | Task 10 route table lists activity per endpoint |
| `validate(schema)` Zod middleware on mutations | Task 3 creates schemas, Task 10 applies them |
| `buildSystemPrompt()` for AI calls | Amendment 1 + Task 6 requirements |
| No bare `JSON.parse` on DB columns | Task 3 Zod schemas + `parseJsonSafeArray` in row mappers |
| Feedback loop completeness (broadcast + handler) | Task 13 (hooks) + Task 19 (broadcast handler pair tests) |
| Feature flag for dark-launch | Task 18 wraps Copy tab in `<FeatureFlag>` |
| Phase-per-PR | PR Gates section explicitly states one PR for Phase 3 |
| Staging before main | PR Gates → Staging gate section |
| `requireWorkspaceAccess` (not `requireAuth`) | Task 10 uses `requireWorkspaceAccess('workspaceId')` on all routes |
| UI primitives before hand-rolling | Tasks 14-17 list which primitives to use |
| Error boundaries on major sections | Tasks 14-17 require `<ErrorBoundary>` wrapping |
| Loading states with contextual messages | Tasks 14-17 require `<Skeleton>` with descriptive messages |
| Empty states with CTA | Tasks 14-17 require `<EmptyState>` |
| Three Laws of Color | Verification strategy includes grep for violet/indigo |
| No purple in client views | Verification strategy includes grep for purple- in client/ |
| TypeScript strict — no `any` | Implementer dispatch requirements note this |
| Imports at top of file | Implementer dispatch requirements note this |
| DB column + mapper lockstep | Task 2 (migration) + Task 5 (row mappers) + Task 3 (types) ship together |
| AI-call-before-DB-write transaction guard | Implementer dispatch gotchas note this |
| UPDATE/DELETE with workspace_id scoping | Migration includes workspace_id on all tables |
| Workspace intelligence wiring | Task 28 |
| Delete-then-reinsert preserves metadata | Task 5 `initializeSections` must preserve created_at on re-generation |
| Prompt assembly duplication guard | Amendment 1 — `buildSystemPrompt` handles Layer 2 |
| Read-before-write for cross-module consumption | Verified Cross-Phase Contracts table provides exact signatures |
| Collection assertions on empty arrays | Task 19 test task must assert `length > 0` before `.every()` |
| ActivityType is a closed union | Task 1 adds new values before any route uses them |
| SeoContext TTL cache invalidation | Task 10 intelligence handlers call `clearSeoContextCache()` |
| Worktree branches from staging (not main) | PR Gates section specifies `staging` base |

---

## Post-Phase 3 Follow-ups

These are documented but NOT part of this plan:

1. **Wire Blueprint into Meeting Brief** — single-file change to `server/meeting-brief-generator.ts` (see existing plan for full spec)
2. **GSC → Keyword Drift Detection** — weekly function comparing blueprint keywords vs GSC queries
3. **Site Architecture ↔ Blueprint** — import URL tree into blueprint entries
4. **Persona ← Brandscript Sync** — auto-populate personas from brandscript data

---

## Amendments

### Amendment 1: Use buildSystemPrompt() for all AI calls

Every AI call must use `buildSystemPrompt(workspaceId, baseInstructions)` from `server/prompt-assembly.js`. This injects voice DNA (Layer 2) and custom notes (Layer 3) automatically. Do NOT manually concatenate voice DNA into prompts.

### Amendment 2: VoiceProfile fields are parsed objects

`voiceDNA`, `guardrails`, `contextModifiers` are already parsed by the Phase 1 row mapper. Access them directly as objects/arrays. Do NOT call `JSON.parse()` on these fields.

### Amendment 3: Batch job persistence

Spec requires "Progress persists across sessions." The `copy_batch_jobs` table (Task 2) stores batch state in the DB. The frontend polls via `useBatchJob` hook. Browser close → reopen → batch resumes from where it left off.

### Amendment 4: SteeringChat reuse

The highlight+steer feature in CopyReviewPanel should reuse the `SteeringChat` component pattern from Phase 1 (`src/components/brand/SteeringChat.tsx`). Reference it for the text selection popover and steering note input pattern. Include auto-summarization after 6 steering exchanges (per spec Enhancement 13).

No phase may start implementation until the prior phase is merged and CI is green on staging.
