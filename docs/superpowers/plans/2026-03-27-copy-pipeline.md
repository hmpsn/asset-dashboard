# Full Copy Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full copy generation pipeline that sits on top of Phase 2 blueprint entries — generating, reviewing, steering, batch-processing, and exporting copy for every page in a client's site strategy. Integrates with every AI feature in the platform via seo-context.ts.

**Architecture:** The plan is split into two tiers. **Tier 1** (Tasks 1-15) is the core pipeline — it must ship as a unit. **Tier 2** (Tasks 16-25) contains platform integration features that ship incrementally after the core is working. Four new server-side modules (`copy-generation.ts`, `copy-review.ts`, `copy-intelligence.ts`, `copy-export.ts`) with one route file, a single new migration (`028-copy-pipeline.sql`), frontend API additions, and UI components extending the Phase 2 Blueprint Detail view.

**Tech Stack:** better-sqlite3, Express, React, Claude Sonnet 4 (creative), GPT-4.1-mini (structured), existing `callAnthropic`/`callOpenAI` wrappers, existing SEMrush + content brief + writing quality infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-27-copy-pipeline-design.md` (includes 21-enhancement addendum)

**Prerequisites:** Phase 1 AND Phase 2 must be **fully complete, committed, and verified** before starting Phase 3. All Phase 1 and Phase 2 tables, services, types, and context builders must be in place.

**Guardrails:** `docs/superpowers/plans/COPY_ENGINE_GUARDRAILS.md` — **READ BEFORE DISPATCHING AGENTS.** Contains file ownership maps, task dependency graphs, cross-phase contracts, and known gotchas.

**Coordination rules:** `.windsurf/rules/multi-agent-coordination.md`

---

## Task Dependencies (Tier 1 — Core Pipeline)

```
Sequential foundation:
  Task 1 (Migration 028) → Task 2 (Shared Types) → Task 3 (Export existing constants)

Parallel services (after Task 3):
  Task 4 (Copy Review Service) ∥ Task 5 (Copy Generation Engine) ∥ Task 6 (Copy Intelligence) ∥ Task 7 (Copy Export)

Sequential shared-file tasks (after parallel batch completes + diff review):
  Task 8 (SEO Context additions) — modifies server/seo-context.ts
  Task 9 (Routes) — creates server/routes/copy-pipeline.ts
  Task 10 (App.ts route registration) — modifies server/app.ts
  Task 11 (API client additions) — modifies src/api/brand-engine.ts

Parallel frontend (after Task 11):
  Task 12 (CopyReviewPanel) ∥ Task 13 (BatchGenerationPanel) ∥ Task 14 (CopyExportPanel) ∥ Task 15 (CopyIntelligenceManager)

Sequential integration:
  Task 16 (BlueprintDetail.tsx — add Copy tab)
```

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `server/db/migrations/028-copy-pipeline.sql` | Tables: copy_sections, copy_metadata, copy_intelligence; column additions to content_briefs |
| `server/copy-generation.ts` | Full-page copy generation with 8-layer context assembly, brief enrichment, quality rules |
| `server/copy-review.ts` | Copy section CRUD, status management, steering history, client suggestions |
| `server/copy-intelligence.ts` | Pattern extraction, frequency tracking, promotion detection, workspace-level learning |
| `server/copy-export.ts` | Webflow CMS push, CSV generation, copy deck document export |
| `server/routes/copy-pipeline.ts` | API routes for generation, review, batch, export, intelligence |
| `shared/types/copy-pipeline.ts` | Shared TypeScript types for copy sections, metadata, intelligence, batch jobs |
| `src/components/brand/CopyReviewPanel.tsx` | Section-by-section copy review with steering, approve, regenerate |
| `src/components/brand/BatchGenerationPanel.tsx` | Batch generation controls, mode selection, progress tracking |
| `src/components/brand/CopyExportPanel.tsx` | Export path selection, scope, Webflow connection |
| `src/components/brand/CopyIntelligenceManager.tsx` | View/edit/toggle learned patterns |

### Modified files

| File | Changes |
|------|---------|
| `server/app.ts` | Import and register copy-pipeline route file |
| `server/seo-context.ts` | Add `buildCopyIntelligenceContext()`, `buildBlueprintContext()`, include in `fullContext` |
| `src/api/brand-engine.ts` | Add copy generation, review, batch, export, intelligence API functions |
| `src/components/brand/BlueprintDetail.tsx` | Add Copy tab alongside section plan, integrate CopyReviewPanel |
| `server/content-posts-ai.ts` | Export `WRITING_QUALITY_RULES` constant (if not already exported) |
| `server/content-brief.ts` | Export `PAGE_TYPE_CONFIGS` constant (if not already exported) |

---

# TIER 1: Core Pipeline

## Task 1: Database Migration

**Files:**
- Create: `server/db/migrations/028-copy-pipeline.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 028-copy-pipeline.sql
-- Full Copy Pipeline tables (Phase 3)

-- ═══ COPY SECTIONS ═══
-- Each row = generated copy for one section of one blueprint entry

CREATE TABLE IF NOT EXISTS copy_sections (
  id                    TEXT PRIMARY KEY,
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

-- ═══ COPY METADATA ═══
-- SEO title, meta desc, OG tags per blueprint entry

CREATE TABLE IF NOT EXISTS copy_metadata (
  id                TEXT PRIMARY KEY,
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

-- ═══ EXTEND CONTENT BRIEFS ═══
-- Track copy approval rate for brief quality feedback loop

ALTER TABLE content_briefs ADD COLUMN copy_approval_rate REAL;
```

- [ ] **Step 2: Verify migration runs**

Run: `cd /Users/joshuahampson/CascadeProjects/asset-dashboard && npx tsx server/db/index.ts`
Expected: No errors. Check: `sqlite3 data/app.db ".tables"` — should include `copy_sections`, `copy_metadata`, `copy_intelligence`.

**IMPORTANT:** The `ALTER TABLE content_briefs` may fail if the column already exists (e.g., from a partial run). Wrap it in a try/catch or check for column existence first. The standard pattern in this codebase is `ALTER TABLE ... ADD COLUMN` without guards — if re-running migrations is an issue, the migration runner handles it via the `_migrations` table.

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/028-copy-pipeline.sql
git commit -m "feat(db): add copy pipeline tables — migration 028"
```

---

## Task 2: Shared Types

**Files:**
- Create: `shared/types/copy-pipeline.ts`

- [ ] **Step 1: Write the shared types**

```typescript
// shared/types/copy-pipeline.ts

// ═══ COPY SECTION STATUS ═══

export type CopySectionStatus =
  | 'pending'            // Not yet generated
  | 'draft'              // Generated, needs internal review
  | 'client_review'      // Sent to client for review
  | 'approved'           // Approved (by internal or client)
  | 'revision_requested'; // Client flagged, needs revision → goes back to draft

// ═══ QUALITY FLAGS ═══

export interface QualityFlag {
  type: 'forbidden_phrase' | 'keyword_stuffing' | 'word_count_violation' | 'missing_element' | 'guardrail_violation';
  message: string;
  severity: 'error' | 'warning';
}

// ═══ STEERING HISTORY ═══

export interface SteeringEntry {
  type: 'note' | 'highlight' | 'summary';
  note: string;
  highlight?: string;       // The text that was highlighted (if type === 'highlight')
  resultVersion: number;    // Which copy version this steering produced
  timestamp: string;
}

// ═══ CLIENT SUGGESTION ═══

export interface ClientSuggestion {
  originalText: string;
  suggestedText: string;
  status: 'pending' | 'accepted' | 'rejected' | 'modified';
  reviewNote?: string;
  timestamp: string;
}

// ═══ COPY SECTION ═══

export interface CopySection {
  id: string;
  entryId: string;
  sectionPlanItemId: string;
  generatedCopy: string | null;
  status: CopySectionStatus;
  aiAnnotation: string | null;
  aiReasoning: string | null;
  steeringHistory: SteeringEntry[];
  clientSuggestions: ClientSuggestion[] | null;
  qualityFlags: QualityFlag[] | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ═══ COPY METADATA ═══

export interface CopyMetadata {
  id: string;
  entryId: string;
  seoTitle: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  status: CopySectionStatus;
  steeringHistory: SteeringEntry[];
  createdAt: string;
  updatedAt: string;
}

// ═══ COPY INTELLIGENCE ═══

export type IntelligencePatternType = 'terminology' | 'tone' | 'structure' | 'keyword_usage';

export interface CopyIntelligencePattern {
  id: string;
  workspaceId: string;
  patternType: IntelligencePatternType;
  pattern: string;
  source: string | null;
  frequency: number;
  active: boolean;
  createdAt: string;
}

// ═══ GENERATION ═══

export interface GeneratedSectionCopy {
  sectionPlanItemId: string;
  copy: string;
  annotation: string;
  reasoning: string;
}

export interface GeneratedPageCopy {
  sections: GeneratedSectionCopy[];
  seoTitle: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
}

// ═══ BATCH ═══

export type BatchMode = 'review_inbox' | 'iterative';

export interface BatchJob {
  id: string;
  blueprintId: string;
  entryIds: string[];
  mode: BatchMode;
  batchSize: number;           // For iterative mode
  status: 'pending' | 'generating' | 'reviewing' | 'complete';
  progress: {
    total: number;
    generated: number;
    reviewed: number;
    approved: number;
  };
  accumulatedSteering: string[]; // For iterative mode — notes from prior batches
  createdAt: string;
  updatedAt: string;
}

// ═══ EXPORT ═══

export type ExportFormat = 'webflow_cms' | 'csv' | 'copy_deck';
export type ExportScope = 'all' | 'selected' | 'single';

export interface ExportRequest {
  format: ExportFormat;
  scope: ExportScope;
  entryIds?: string[];        // For 'selected' scope
  entryId?: string;           // For 'single' scope
  webflowSiteId?: string;     // For webflow_cms format
  docFormat?: 'google' | 'word'; // For copy_deck format
}

export interface ExportResult {
  format: ExportFormat;
  url?: string;               // Download URL for CSV/doc
  webflowCollectionId?: string; // For webflow_cms
  itemCount: number;
  errors?: string[];
}

// ═══ ENTRY COPY STATUS (derived) ═══

export interface EntryCopyStatus {
  entryId: string;
  totalSections: number;
  pending: number;
  draft: number;
  clientReview: number;
  approved: number;
  revisionRequested: number;
  overallStatus: 'not_started' | 'in_progress' | 'review' | 'approved';
  metadataStatus: CopySectionStatus;
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/types/copy-pipeline.ts
git commit -m "feat(types): add copy pipeline shared types"
```

---

## Task 3: Export Writing Quality Rules + Page Type Configs

**Files:**
- Modify: `server/content-posts-ai.ts`
- Modify: `server/content-brief.ts`

- [ ] **Step 1: Ensure WRITING_QUALITY_RULES is exported**

In `server/content-posts-ai.ts`, find the `WRITING_QUALITY_RULES` constant. If it's not already exported, add `export` to the declaration:

```typescript
export const WRITING_QUALITY_RULES = `...`;
```

Do NOT copy the string. Just add the `export` keyword.

- [ ] **Step 2: Ensure PAGE_TYPE_CONFIGS is exported**

In `server/content-brief.ts`, find the page type configuration object (may be named `PAGE_TYPE_CONFIGS`, `pageTypeConfigs`, or similar — search for a record/map keyed by page type strings like 'blog', 'service', 'location'). If not exported, add `export`.

If the configs are inline within a function rather than a standalone constant, extract them into an exported constant first, then reference the constant from the function.

- [ ] **Step 3: Commit**

```bash
git add server/content-posts-ai.ts server/content-brief.ts
git commit -m "refactor: export WRITING_QUALITY_RULES and PAGE_TYPE_CONFIGS for reuse"
```

---

## Task 4: Copy Review Service (CRUD + Status)

**Files:**
- Create: `server/copy-review.ts`

- [ ] **Step 1: Write the copy review service**

```typescript
// server/copy-review.ts
/**
 * Copy Review — CRUD for copy sections, status management, steering history.
 * Handles the review workflow: pending → draft → client_review → approved.
 */
import { randomUUID } from 'node:crypto';
import db from './db/index.js';
import type {
  CopySection,
  CopyMetadata,
  CopySectionStatus,
  SteeringEntry,
  ClientSuggestion,
  QualityFlag,
  EntryCopyStatus,
} from '../shared/types/copy-pipeline.ts';
import type { SectionPlanItem } from '../shared/types/page-strategy.ts';
import { createLogger } from './logger.js';

const log = createLogger('copy-review');

// ── SQLite row shapes ──

interface CopySectionRow {
  id: string;
  entry_id: string;
  section_plan_item_id: string;
  generated_copy: string | null;
  status: string;
  ai_annotation: string | null;
  ai_reasoning: string | null;
  steering_history: string;
  client_suggestions: string | null;
  quality_flags: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface CopyMetadataRow {
  id: string;
  entry_id: string;
  seo_title: string | null;
  meta_description: string | null;
  og_title: string | null;
  og_description: string | null;
  status: string;
  steering_history: string;
  created_at: string;
  updated_at: string;
}

// ── Lazy prepared statements ──

interface Stmts {
  insertSection: ReturnType<typeof db.prepare>;
  selectSectionsByEntry: ReturnType<typeof db.prepare>;
  selectSectionById: ReturnType<typeof db.prepare>;
  updateSection: ReturnType<typeof db.prepare>;
  deleteSectionsByEntry: ReturnType<typeof db.prepare>;
  insertMetadata: ReturnType<typeof db.prepare>;
  selectMetadataByEntry: ReturnType<typeof db.prepare>;
  updateMetadata: ReturnType<typeof db.prepare>;
  countSectionsByStatus: ReturnType<typeof db.prepare>;
}

let _stmts: Stmts | null = null;
function stmts(): Stmts {
  if (!_stmts) {
    _stmts = {
      insertSection: db.prepare(
        `INSERT INTO copy_sections
           (id, entry_id, section_plan_item_id, generated_copy, status,
            ai_annotation, ai_reasoning, steering_history, client_suggestions,
            quality_flags, version, created_at, updated_at)
         VALUES
           (@id, @entry_id, @section_plan_item_id, @generated_copy, @status,
            @ai_annotation, @ai_reasoning, @steering_history, @client_suggestions,
            @quality_flags, @version, @created_at, @updated_at)`,
      ),
      selectSectionsByEntry: db.prepare(
        `SELECT * FROM copy_sections WHERE entry_id = ? ORDER BY created_at ASC`,
      ),
      selectSectionById: db.prepare(
        `SELECT * FROM copy_sections WHERE id = ?`,
      ),
      updateSection: db.prepare(
        `UPDATE copy_sections SET
           generated_copy = @generated_copy, status = @status,
           ai_annotation = @ai_annotation, ai_reasoning = @ai_reasoning,
           steering_history = @steering_history, client_suggestions = @client_suggestions,
           quality_flags = @quality_flags, version = @version, updated_at = @updated_at
         WHERE id = @id`,
      ),
      deleteSectionsByEntry: db.prepare(
        `DELETE FROM copy_sections WHERE entry_id = ?`,
      ),
      insertMetadata: db.prepare(
        `INSERT INTO copy_metadata
           (id, entry_id, seo_title, meta_description, og_title, og_description,
            status, steering_history, created_at, updated_at)
         VALUES
           (@id, @entry_id, @seo_title, @meta_description, @og_title, @og_description,
            @status, @steering_history, @created_at, @updated_at)`,
      ),
      selectMetadataByEntry: db.prepare(
        `SELECT * FROM copy_metadata WHERE entry_id = ?`,
      ),
      updateMetadata: db.prepare(
        `UPDATE copy_metadata SET
           seo_title = @seo_title, meta_description = @meta_description,
           og_title = @og_title, og_description = @og_description,
           status = @status, steering_history = @steering_history,
           updated_at = @updated_at
         WHERE entry_id = @entry_id`,
      ),
      countSectionsByStatus: db.prepare(
        `SELECT status, COUNT(*) as count FROM copy_sections WHERE entry_id = ? GROUP BY status`,
      ),
    };
  }
  return _stmts;
}

// ── Row converters ──

function rowToSection(row: CopySectionRow): CopySection {
  return {
    id: row.id,
    entryId: row.entry_id,
    sectionPlanItemId: row.section_plan_item_id,
    generatedCopy: row.generated_copy,
    status: row.status as CopySectionStatus,
    aiAnnotation: row.ai_annotation,
    aiReasoning: row.ai_reasoning,
    steeringHistory: JSON.parse(row.steering_history) as SteeringEntry[],
    clientSuggestions: row.client_suggestions ? JSON.parse(row.client_suggestions) as ClientSuggestion[] : null,
    qualityFlags: row.quality_flags ? JSON.parse(row.quality_flags) as QualityFlag[] : null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMetadata(row: CopyMetadataRow): CopyMetadata {
  return {
    id: row.id,
    entryId: row.entry_id,
    seoTitle: row.seo_title,
    metaDescription: row.meta_description,
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    status: row.status as CopySectionStatus,
    steeringHistory: JSON.parse(row.steering_history) as SteeringEntry[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Public API ──

/** Get all copy sections for a blueprint entry */
export function getSectionsForEntry(entryId: string): CopySection[] {
  const rows = stmts().selectSectionsByEntry.all(entryId) as CopySectionRow[];
  return rows.map(rowToSection);
}

/** Get a single copy section by ID */
export function getSection(sectionId: string): CopySection | null {
  const row = stmts().selectSectionById.get(sectionId) as CopySectionRow | undefined;
  return row ? rowToSection(row) : null;
}

/** Initialize copy section rows for a blueprint entry (called after generation) */
export function initializeSections(
  entryId: string,
  sectionPlan: SectionPlanItem[],
): CopySection[] {
  const now = new Date().toISOString();
  // Delete existing sections for this entry (regeneration case)
  stmts().deleteSectionsByEntry.run(entryId);
  const insert = db.transaction(() => {
    for (const item of sectionPlan) {
      stmts().insertSection.run({
        id: randomUUID(),
        entry_id: entryId,
        section_plan_item_id: item.id,
        generated_copy: null,
        status: 'pending',
        ai_annotation: null,
        ai_reasoning: null,
        steering_history: '[]',
        client_suggestions: null,
        quality_flags: null,
        version: 0,
        created_at: now,
        updated_at: now,
      });
    }
  });
  insert();
  return getSectionsForEntry(entryId);
}

/** Save generated copy to a section */
export function saveGeneratedCopy(
  sectionId: string,
  data: {
    generatedCopy: string;
    aiAnnotation: string;
    aiReasoning: string;
    qualityFlags?: QualityFlag[];
  },
): CopySection | null {
  const existing = getSection(sectionId);
  if (!existing) return null;
  const now = new Date().toISOString();
  stmts().updateSection.run({
    id: sectionId,
    generated_copy: data.generatedCopy,
    status: 'draft',
    ai_annotation: data.aiAnnotation,
    ai_reasoning: data.aiReasoning,
    steering_history: JSON.stringify(existing.steeringHistory),
    client_suggestions: existing.clientSuggestions ? JSON.stringify(existing.clientSuggestions) : null,
    quality_flags: data.qualityFlags ? JSON.stringify(data.qualityFlags) : null,
    version: existing.version + 1,
    updated_at: now,
  });
  return getSection(sectionId);
}

/** Update section status */
export function updateSectionStatus(sectionId: string, status: CopySectionStatus): CopySection | null {
  const existing = getSection(sectionId);
  if (!existing) return null;
  const now = new Date().toISOString();
  stmts().updateSection.run({
    id: sectionId,
    generated_copy: existing.generatedCopy,
    status,
    ai_annotation: existing.aiAnnotation,
    ai_reasoning: existing.aiReasoning,
    steering_history: JSON.stringify(existing.steeringHistory),
    client_suggestions: existing.clientSuggestions ? JSON.stringify(existing.clientSuggestions) : null,
    quality_flags: existing.qualityFlags ? JSON.stringify(existing.qualityFlags) : null,
    version: existing.version,
    updated_at: now,
  });
  return getSection(sectionId);
}

/** Add a steering entry to a section's history */
export function addSteeringEntry(sectionId: string, entry: Omit<SteeringEntry, 'timestamp'>): CopySection | null {
  const existing = getSection(sectionId);
  if (!existing) return null;
  const history = [...existing.steeringHistory, { ...entry, timestamp: new Date().toISOString() }];
  const now = new Date().toISOString();
  stmts().updateSection.run({
    id: sectionId,
    generated_copy: existing.generatedCopy,
    status: existing.status,
    ai_annotation: existing.aiAnnotation,
    ai_reasoning: existing.aiReasoning,
    steering_history: JSON.stringify(history),
    client_suggestions: existing.clientSuggestions ? JSON.stringify(existing.clientSuggestions) : null,
    quality_flags: existing.qualityFlags ? JSON.stringify(existing.qualityFlags) : null,
    version: existing.version,
    updated_at: now,
  });
  return getSection(sectionId);
}

/** Save a client suggestion on a section */
export function addClientSuggestion(sectionId: string, suggestion: Omit<ClientSuggestion, 'timestamp' | 'status'>): CopySection | null {
  const existing = getSection(sectionId);
  if (!existing) return null;
  const suggestions = [...(existing.clientSuggestions ?? []), {
    ...suggestion,
    status: 'pending' as const,
    timestamp: new Date().toISOString(),
  }];
  const now = new Date().toISOString();
  stmts().updateSection.run({
    id: sectionId,
    generated_copy: existing.generatedCopy,
    status: 'revision_requested',
    ai_annotation: existing.aiAnnotation,
    ai_reasoning: existing.aiReasoning,
    steering_history: JSON.stringify(existing.steeringHistory),
    client_suggestions: JSON.stringify(suggestions),
    quality_flags: existing.qualityFlags ? JSON.stringify(existing.qualityFlags) : null,
    version: existing.version,
    updated_at: now,
  });
  return getSection(sectionId);
}

/** Update copy text directly (manual edit) */
export function updateCopyText(sectionId: string, newCopy: string): CopySection | null {
  const existing = getSection(sectionId);
  if (!existing) return null;
  const now = new Date().toISOString();
  stmts().updateSection.run({
    id: sectionId,
    generated_copy: newCopy,
    status: 'draft',
    ai_annotation: existing.aiAnnotation,
    ai_reasoning: existing.aiReasoning,
    steering_history: JSON.stringify([
      ...existing.steeringHistory,
      { type: 'note' as const, note: '[Manual edit]', resultVersion: existing.version + 1, timestamp: now },
    ]),
    client_suggestions: existing.clientSuggestions ? JSON.stringify(existing.clientSuggestions) : null,
    quality_flags: null, // Clear flags after manual edit
    version: existing.version + 1,
    updated_at: now,
  });
  return getSection(sectionId);
}

// ── Metadata CRUD ──

/** Get or create metadata for an entry */
export function getMetadata(entryId: string): CopyMetadata | null {
  const row = stmts().selectMetadataByEntry.get(entryId) as CopyMetadataRow | undefined;
  return row ? rowToMetadata(row) : null;
}

export function saveMetadata(entryId: string, data: {
  seoTitle: string; metaDescription: string; ogTitle: string; ogDescription: string;
}): CopyMetadata {
  const now = new Date().toISOString();
  const existing = getMetadata(entryId);
  if (existing) {
    stmts().updateMetadata.run({
      entry_id: entryId,
      seo_title: data.seoTitle,
      meta_description: data.metaDescription,
      og_title: data.ogTitle,
      og_description: data.ogDescription,
      status: 'draft',
      steering_history: JSON.stringify(existing.steeringHistory),
      updated_at: now,
    });
  } else {
    stmts().insertMetadata.run({
      id: randomUUID(),
      entry_id: entryId,
      seo_title: data.seoTitle,
      meta_description: data.metaDescription,
      og_title: data.ogTitle,
      og_description: data.ogDescription,
      status: 'draft',
      steering_history: '[]',
      created_at: now,
      updated_at: now,
    });
  }
  return getMetadata(entryId)!;
}

// ── Status derivation ──

/** Derive overall copy status for an entry from its sections */
export function getEntryCopyStatus(entryId: string): EntryCopyStatus {
  const sections = getSectionsForEntry(entryId);
  const metadata = getMetadata(entryId);
  const counts = { pending: 0, draft: 0, client_review: 0, approved: 0, revision_requested: 0 };
  for (const s of sections) {
    counts[s.status]++;
  }

  let overallStatus: EntryCopyStatus['overallStatus'];
  if (sections.length === 0 || counts.pending === sections.length) {
    overallStatus = 'not_started';
  } else if (counts.approved === sections.length) {
    overallStatus = 'approved';
  } else if (counts.client_review > 0 && counts.draft === 0 && counts.pending === 0) {
    overallStatus = 'review';
  } else {
    overallStatus = 'in_progress';
  }

  return {
    entryId,
    totalSections: sections.length,
    ...counts,
    overallStatus,
    metadataStatus: metadata?.status as CopySectionStatus ?? 'pending',
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/copy-review.ts
git commit -m "feat: add copy review service with section CRUD, steering, and status management"
```

---

## Task 5: Copy Generation Service

**Files:**
- Create: `server/copy-generation.ts`

- [ ] **Step 1: Write the copy generation service**

> **PATCH NOTE — WorkspaceIntelligence layer:** Use `buildWorkspaceIntelligence()` instead of separate builder calls in `buildCopyGenerationContext()`. The reference implementation below uses individual calls to `getBrandscript()`, `getVoiceProfile()`, `getDeliverables()`, etc. — **replace those** with a single `buildWorkspaceIntelligence()` call:
>
> ```typescript
> import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
>
> const intelligence = await buildWorkspaceIntelligence(workspaceId, {
>   slices: ['seoContext', 'insights', 'learnings', 'contentPipeline'],
>   pagePath: entry.pagePath, // enables per-page insight filtering
> });
> ```
>
> This replaces the separate calls to `getBrandscript()`, `getVoiceProfile()`, `getVoiceSamples()`, `getDeliverables()`, and `buildSeoContext()` in `buildCopyGenerationContext()`. Single DB round-trip, uses the LRU cache, consistent context. The `seoContext` slice (after Phase 1 ships) includes structured VoiceDNA, brandscript, and identity — no need to call those builders separately. Extract relevant fields from `intelligence.seoContext` wherever the reference implementation calls those functions directly.
>
> **Intelligence-Informed Copy Generation** — inject the following additional signals into the per-page AI prompt before `buildGenerationPrompt()`:
>
> 1. **Page-specific diagnostic insights → targeted copy direction**
>    Filter `intelligence.insights` for insights scoped to the current page path. For each matching insight, inject:
>    - `content_decay` → "This page has been losing ranking position for [keyword]. The copy should reinforce keyword focus and add depth on [topic]."
>    - `ctr_opportunity` → "This page ranks position [N] for [query] but has below-benchmark CTR. The opening section and headline need to be more compelling to improve click-through."
>    - `ranking_opportunity` → "This page is at position [N] for [query] with high impressions. A focused push on this keyword could yield significant traffic gains."
>
> 2. **SERP opportunity insights → copy structure**
>    If a `serp_opportunity` insight exists for this page (eligible for FAQ schema, HowTo schema, etc.):
>    - Inject: "Structure this content to support [schema type] markup. [For FAQ: use natural Q&A format with clear question headings. For HowTo: use numbered steps with clear action verbs.]"
>    - This makes copy structure and schema eligibility coordinated by design, not retrofitted.
>
> 3. **Client signal approval patterns → generation style**
>    From `intelligence.clientSignals`, extract approval pattern signals (what content the client has consistently approved vs. rejected). Inject a brief style guidance note: "Based on prior client approvals, this client responds best to [direct/formal/conversational] register with [short/longer] sentences. Avoid [rejected patterns]."
>
> 4. **Learnings → proven copy patterns**
>    From `intelligence.learnings`, extract outcome patterns related to content published for this workspace. Inject: "Content with these characteristics has produced measurable results for this workspace: [patterns]. Factor this into copy structure and keyword treatment."
>
> Add these signals as a new context layer (e.g., "Layer 8.5: Live Intelligence") in `buildCopyGenerationContext()`, inserted after the existing learned patterns layer and before the accumulated steering layer.
>
> **Prompt assembly:** After assembling intelligence context, pass it through `buildSystemPrompt(workspaceId, baseInstructions)` — do not concatenate intelligence directly into the system prompt string. `buildSystemPrompt()` wraps the base instructions and appends voice DNA (Layer 2) + custom notes (Layer 3) when available.

This is the core engine. It assembles the 8-layer context prompt, generates copy for all sections at once, runs the quality check, and saves results.

```typescript
// server/copy-generation.ts
/**
 * Copy Generation — 8-layer context assembly and full-page copy generation.
 * Integrates brief enrichment, writing quality rules, AEO principles.
 */
import { callAnthropic } from './anthropic-helpers.js';
import { callOpenAI } from './openai-helpers.js';
import { buildSeoContext } from './seo-context.js';
import { getBrandscript } from './brandscript.js';
import { getVoiceProfile, getVoiceSamples } from './voice-calibration.js';
import { getDeliverables } from './brand-identity.js';
import { getBlueprint } from './page-strategy.js';
import { generateBrief } from './content-brief.js';
import { WRITING_QUALITY_RULES } from './content-posts-ai.js';
import {
  initializeSections,
  saveGeneratedCopy,
  saveMetadata,
  getSectionsForEntry,
} from './copy-review.js';
import { getActivePatterns } from './copy-intelligence.js';
import type { SectionPlanItem } from '../shared/types/page-strategy.ts';
import type { BlueprintEntry, SiteBlueprint } from '../shared/types/page-strategy.ts';
import type { GeneratedPageCopy, QualityFlag } from '../shared/types/copy-pipeline.ts';
import { createLogger } from './logger.js';

const log = createLogger('copy-generation');

// ── Context emphasis by page type ──

type Emphasis = 'full' | 'summary' | 'minimal';

const PAGE_TYPE_EMPHASIS: Record<string, {
  brandscript: Emphasis; voice: Emphasis; identity: Emphasis; seo: Emphasis;
}> = {
  homepage:     { brandscript: 'full', voice: 'full', identity: 'full', seo: 'summary' },
  about:        { brandscript: 'full', voice: 'full', identity: 'full', seo: 'minimal' },
  service:      { brandscript: 'summary', voice: 'full', identity: 'summary', seo: 'full' },
  location:     { brandscript: 'minimal', voice: 'summary', identity: 'minimal', seo: 'full' },
  blog:         { brandscript: 'summary', voice: 'full', identity: 'minimal', seo: 'full' },
  faq:          { brandscript: 'summary', voice: 'summary', identity: 'minimal', seo: 'summary' },
  contact:      { brandscript: 'minimal', voice: 'summary', identity: 'minimal', seo: 'minimal' },
  testimonials: { brandscript: 'summary', voice: 'summary', identity: 'minimal', seo: 'minimal' },
  landing:      { brandscript: 'full', voice: 'full', identity: 'summary', seo: 'full' },
  product:      { brandscript: 'summary', voice: 'full', identity: 'summary', seo: 'full' },
};

// ── Quality check (no AI — regex/pattern matching) ──

export function runQualityCheck(
  copy: string,
  sectionPlan: SectionPlanItem,
  guardrails?: { forbiddenWords?: string[]; requiredTerms?: string[] },
): QualityFlag[] {
  const flags: QualityFlag[] = [];
  const lowerCopy = copy.toLowerCase();

  // Forbidden phrases from WRITING_QUALITY_RULES
  const FORBIDDEN_PHRASES = [
    'did you know', 'in today\'s world', 'have you ever wondered',
    'if you\'re like most', 'let\'s dive in', 'without further ado',
    'with that said', 'ready to', 'incredibly', 'absolutely',
    'game-changing', 'leverage', 'utilize', 'optimize', 'empower',
    'it\'s important to note', 'it goes without saying',
    'studies show', 'experts agree', 'growth engine', 'secret sauce',
    'move the needle', 'at the end of the day', 'in conclusion',
  ];

  for (const phrase of FORBIDDEN_PHRASES) {
    if (lowerCopy.includes(phrase)) {
      flags.push({
        type: 'forbidden_phrase',
        message: `Contains forbidden phrase: "${phrase}"`,
        severity: 'warning',
      });
    }
  }

  // Voice guardrail violations
  if (guardrails?.forbiddenWords) {
    for (const word of guardrails.forbiddenWords) {
      if (lowerCopy.includes(word.toLowerCase())) {
        flags.push({
          type: 'guardrail_violation',
          message: `Contains forbidden word from voice guardrails: "${word}"`,
          severity: 'error',
        });
      }
    }
  }

  // Word count check
  const wordCount = copy.split(/\s+/).length;
  const target = sectionPlan.wordCountTarget;
  if (target > 0) {
    if (wordCount > target * 1.5) {
      flags.push({
        type: 'word_count_violation',
        message: `Section is ${wordCount} words — ${Math.round((wordCount / target - 1) * 100)}% over the ${target}-word target`,
        severity: 'warning',
      });
    } else if (wordCount < target * 0.5) {
      flags.push({
        type: 'word_count_violation',
        message: `Section is ${wordCount} words — ${Math.round((1 - wordCount / target) * 100)}% under the ${target}-word target`,
        severity: 'warning',
      });
    }
  }

  // Keyword stuffing (same keyword 4+ times in one section)
  // Implementer: extract primary keyword from blueprint entry and check frequency here.
  // This is a placeholder pattern — adapt to actual keyword access:
  // if (primaryKeyword) {
  //   const keywordRegex = new RegExp(primaryKeyword.toLowerCase(), 'gi');
  //   const matches = copy.match(keywordRegex);
  //   if (matches && matches.length > 3) {
  //     flags.push({ type: 'keyword_stuffing', message: `Keyword "${primaryKeyword}" appears ${matches.length} times`, severity: 'warning' });
  //   }
  // }

  return flags;
}

// ── Context assembly ──

export async function buildCopyGenerationContext(
  workspaceId: string,
  blueprint: SiteBlueprint,
  entry: BlueprintEntry,
  accumulatedSteering?: string[],
): Promise<string> {
  const emphasis = PAGE_TYPE_EMPHASIS[entry.pageType] ?? PAGE_TYPE_EMPHASIS['service']!;
  const contextParts: string[] = [];

  // Layer 1: Brand Foundation (Brandscript)
  if (blueprint.brandscriptId) {
    const brandscript = getBrandscript(workspaceId, blueprint.brandscriptId);
    if (brandscript) {
      const sections = emphasis.brandscript === 'full'
        ? brandscript.sections.map((s) => `### ${s.title}\n${s.content ?? '(not filled in)'}`).join('\n\n')
        : emphasis.brandscript === 'summary'
          ? brandscript.sections.slice(0, 4).map((s) => `- ${s.title}: ${(s.content ?? '').slice(0, 200)}`).join('\n')
          : `Brand framework: ${brandscript.frameworkType}. ${brandscript.sections.length} sections defined.`;
      contextParts.push(`═══ BRAND FOUNDATION (BRANDSCRIPT) ═══\n${sections}`);
    }
  }

  // Layer 2: Voice Profile
  const voiceProfile = getVoiceProfile(workspaceId);
  if (voiceProfile) {
    const samples = getVoiceSamples(voiceProfile.id);
    const voiceDna = voiceProfile.voiceDnaJson ? JSON.parse(voiceProfile.voiceDnaJson) : null;
    const guardrails = voiceProfile.guardrailsJson ? JSON.parse(voiceProfile.guardrailsJson) : null;
    const contextModifiers = voiceProfile.contextModifiersJson ? JSON.parse(voiceProfile.contextModifiersJson) : null;

    let voiceBlock = '';
    if (emphasis.voice === 'full') {
      if (voiceDna) voiceBlock += `Voice DNA:\n${JSON.stringify(voiceDna, null, 2)}\n\n`;
      if (samples.length > 0) voiceBlock += `Voice Samples (write like these):\n${samples.map((s) => `[${s.contextTag ?? 'general'}] "${s.content}"`).join('\n')}\n\n`;
      if (guardrails) voiceBlock += `Guardrails (NEVER violate):\n${JSON.stringify(guardrails, null, 2)}\n\n`;
      if (contextModifiers) {
        const modifier = contextModifiers[entry.pageType] ?? contextModifiers['default'];
        if (modifier) voiceBlock += `Voice modifier for ${entry.pageType} pages: ${modifier}\n`;
      }
    } else if (emphasis.voice === 'summary') {
      if (samples.length > 0) voiceBlock += `Top voice samples:\n${samples.slice(0, 2).map((s) => `"${s.content}"`).join('\n')}\n`;
      if (guardrails) voiceBlock += `Key guardrails: ${JSON.stringify(guardrails).slice(0, 300)}\n`;
    } else {
      voiceBlock = 'Voice profile defined — follow calibrated tone.';
    }
    contextParts.push(`═══ VOICE PROFILE ═══\n${voiceBlock}`);
  }

  // Layer 3: Brand Identity
  const deliverables = getDeliverables(workspaceId);
  if (deliverables.length > 0) {
    const approvedDeliverables = deliverables.filter((d) => d.status === 'approved');
    if (emphasis.identity === 'full') {
      contextParts.push(`═══ BRAND IDENTITY ═══\n${approvedDeliverables.map((d) => `${d.deliverableType}: ${d.content}`).join('\n\n')}`);
    } else if (emphasis.identity === 'summary') {
      const key = approvedDeliverables.filter((d) => ['mission', 'messaging_pillars', 'tagline'].includes(d.deliverableType));
      contextParts.push(`═══ BRAND IDENTITY (KEY) ═══\n${key.map((d) => `${d.deliverableType}: ${d.content}`).join('\n')}`);
    } else {
      const mission = approvedDeliverables.find((d) => d.deliverableType === 'mission');
      if (mission) contextParts.push(`═══ BRAND IDENTITY ═══\nMission: ${mission.content}`);
    }
  }

  // Layer 4: Page Strategy
  contextParts.push(`═══ PAGE STRATEGY ═══
Page: ${entry.name} (${entry.pageType})
Primary keyword: ${entry.primaryKeyword ?? 'none assigned'}
Secondary keywords: ${(entry.secondaryKeywords ?? []).join(', ') || 'none'}
Collection: ${entry.isCollection ? 'Yes (CMS)' : 'No (static)'}

Section plan:
${entry.sectionPlan.map((s, i) => `${i + 1}. ${s.sectionType} [${s.narrativeRole}] — Brand: ${s.brandNote} | SEO: ${s.seoNote} | ~${s.wordCountTarget} words`).join('\n')}`);

  // Layer 4.5: Brief enrichment data (if available)
  // The brief is auto-generated before copy generation (see generateCopyForEntry).
  // Brief data is passed in via the entry's briefId — the calling function fetches and injects it.

  // Layer 5: Cross-page awareness
  if (blueprint.entries && blueprint.entries.length > 1) {
    const otherPages = (blueprint.entries ?? [])
      .filter((e) => e.id !== entry.id && e.scope === 'included')
      .map((e) => `- ${e.name} (${e.pageType}) — keyword: ${e.primaryKeyword ?? 'none'}`)
      .join('\n');
    contextParts.push(`═══ SITE MAP (for internal linking and CTA consistency) ═══\n${otherPages}`);

    // Include approved copy from other pages for consistency
    const approvedCopy: string[] = [];
    for (const other of (blueprint.entries ?? []).filter((e) => e.id !== entry.id)) {
      const sections = getSectionsForEntry(other.id);
      const approved = sections.filter((s) => s.status === 'approved' && s.generatedCopy);
      if (approved.length > 0) {
        approvedCopy.push(`${other.name}: ${approved.slice(0, 2).map((s) => `"${(s.generatedCopy ?? '').slice(0, 100)}..."`).join(', ')}`);
      }
    }
    if (approvedCopy.length > 0) {
      contextParts.push(`═══ APPROVED COPY FROM OTHER PAGES (maintain consistency) ═══\n${approvedCopy.join('\n')}`);
    }
  }

  // Layer 6: SEO Intelligence
  const seoContext = buildSeoContext(workspaceId);
  if (emphasis.seo === 'full') {
    contextParts.push(`═══ SEO INTELLIGENCE ═══\n${seoContext.keywordBlock}`);
  } else if (emphasis.seo === 'summary') {
    contextParts.push(`═══ SEO CONTEXT (summary) ═══\n${seoContext.keywordBlock.slice(0, 500)}`);
  }

  // Layer 7: Copy Intelligence (workspace-level learned patterns)
  const patterns = getActivePatterns(workspaceId);
  if (patterns.length > 0) {
    const grouped: Record<string, string[]> = {};
    for (const p of patterns) {
      (grouped[p.patternType] ??= []).push(p.pattern);
    }
    contextParts.push(`═══ LEARNED COPY PATTERNS (from previous reviews) ═══\n${
      Object.entries(grouped).map(([type, rules]) => `${type}: ${rules.join('; ')}`).join('\n')
    }`);
  }

  // Layer 8: Accumulated steering from iterative batch mode
  if (accumulatedSteering && accumulatedSteering.length > 0) {
    contextParts.push(`═══ STEERING FROM PRIOR BATCHES (apply these lessons) ═══\n${accumulatedSteering.map((s) => `- ${s}`).join('\n')}`);
  }

  return contextParts.join('\n\n');
}

// ── Generation prompt ──

function buildGenerationPrompt(
  context: string,
  entry: BlueprintEntry,
  briefContext?: string,
): string {
  const sectionInstructions = entry.sectionPlan.map((s) => `
Section "${s.sectionType}" (narrative role: ${s.narrativeRole}):
- Brand purpose: ${s.brandNote}
- SEO purpose: ${s.seoNote}
- Target word count: ~${s.wordCountTarget} words
- Section plan item ID: ${s.id}
`).join('\n');

  return `You are a senior copywriter at a boutique web design studio. Generate copy for every section of a ${entry.pageType} page.

${context}

${briefContext ? `═══ CONTENT BRIEF (detailed SEO intelligence) ═══\n${briefContext}\n` : ''}

═══ SECTIONS TO WRITE ═══
${sectionInstructions}

═══ WRITING RULES ═══
${WRITING_QUALITY_RULES}

ADDITIONAL COPY RULES:
- Headlines: clarity and hook over cleverness. No clickbait.
- CTAs: always include a primary CTA + softer secondary option.
- FAQs: address real objections, not softballs. Each answer is self-contained.
- Write for AI citation-worthiness where appropriate (encyclopedic precision + brand voice).
- Replace superlatives with evidence. "Best" → specific proof point.
- Use "According to [source]..." framing for data claims. Never invent statistics.
- Consistent terminology across ALL sections — if "patients" is used once, use it everywhere.
- Do NOT repeat examples, metaphors, or case studies across sections.
- Natural internal links where relevant — reference other pages in the site map.
- Never stuff keywords. Weave them naturally per the SEO notes.

═══ OUTPUT FORMAT ═══
Return ONLY a JSON object with this structure (no markdown, no explanation outside JSON):
{
  "sections": [
    {
      "sectionPlanItemId": "the-id-from-above",
      "copy": "The generated copy text",
      "annotation": "Brief one-liner explaining the intent behind this section",
      "reasoning": "Detailed rationale: why this tone, why this keyword placement, what brand/SEO tradeoffs were made"
    }
  ],
  "seoTitle": "50-60 char SEO title with primary keyword front-loaded",
  "metaDescription": "150-160 char meta description with primary keyword and compelling hook",
  "ogTitle": "Open Graph title (can match seoTitle or be more engaging)",
  "ogDescription": "Open Graph description (can match metaDescription or be more social-friendly)"
}`;
}

// ── Main generation function ──

/** Generate copy for a single blueprint entry */
export async function generateCopyForEntry(
  workspaceId: string,
  blueprintId: string,
  entryId: string,
  accumulatedSteering?: string[],
): Promise<{ sections: CopySection[]; metadata: CopyMetadata }> {
  const blueprint = getBlueprint(workspaceId, blueprintId);
  if (!blueprint) throw new Error('Blueprint not found');
  const entry = (blueprint.entries ?? []).find((e) => e.id === entryId);
  if (!entry) throw new Error('Entry not found');

  log.info({ workspaceId, blueprintId, entryId, pageType: entry.pageType }, 'Generating copy');

  // Step 1: Auto-generate brief for enrichment (if not already linked)
  let briefContext = '';
  if (!entry.briefId && entry.primaryKeyword) {
    try {
      const brief = await generateBrief(workspaceId, {
        targetKeyword: entry.primaryKeyword,
        secondaryKeywords: entry.secondaryKeywords ?? [],
        pageType: entry.pageType,
      });
      // Update entry with brief ID (via page-strategy service)
      // Implementer: call updateEntry(blueprintId, entryId, { briefId: brief.id })
      briefContext = formatBriefForCopy(brief);
      log.info({ entryId, briefId: brief.id }, 'Auto-generated brief for enrichment');
    } catch (err) {
      log.warn({ err, entryId }, 'Brief enrichment failed — proceeding without');
    }
  }

  // Step 2: Assemble context
  const context = await buildCopyGenerationContext(workspaceId, blueprint, entry, accumulatedSteering);

  // Step 3: Generate
  const prompt = buildGenerationPrompt(context, entry, briefContext);
  const aiResponse = await callAnthropic({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  let generated: GeneratedPageCopy;
  try {
    const text = aiResponse.content[0].type === 'text' ? aiResponse.content[0].text : '';
    const jsonStr = text.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    generated = JSON.parse(jsonStr);
  } catch (err) {
    log.error({ err }, 'Failed to parse AI copy generation response');
    throw new Error('Copy generation failed — AI response was not valid JSON');
  }

  // Step 4: Initialize section rows and save generated copy
  const sections = initializeSections(entryId, entry.sectionPlan);

  // Get voice guardrails for quality check
  const voiceProfile = getVoiceProfile(workspaceId);
  const guardrails = voiceProfile?.guardrailsJson ? JSON.parse(voiceProfile.guardrailsJson) : undefined;

  for (const genSection of generated.sections) {
    const section = sections.find((s) => s.sectionPlanItemId === genSection.sectionPlanItemId);
    if (!section) {
      log.warn({ sectionPlanItemId: genSection.sectionPlanItemId }, 'Generated section has no matching plan item — skipping');
      continue;
    }

    // Run quality check
    const planItem = entry.sectionPlan.find((sp) => sp.id === genSection.sectionPlanItemId);
    const qualityFlags = planItem
      ? runQualityCheck(genSection.copy, planItem, guardrails)
      : [];

    saveGeneratedCopy(section.id, {
      generatedCopy: genSection.copy,
      aiAnnotation: genSection.annotation,
      aiReasoning: genSection.reasoning,
      qualityFlags: qualityFlags.length > 0 ? qualityFlags : undefined,
    });
  }

  // Step 5: Save metadata
  const metadata = saveMetadata(entryId, {
    seoTitle: generated.seoTitle,
    metaDescription: generated.metaDescription,
    ogTitle: generated.ogTitle,
    ogDescription: generated.ogDescription,
  });

  // Step 6: Return fresh data
  return {
    sections: getSectionsForEntry(entryId),
    metadata,
  };
}

/** Regenerate a single section with steering note */
export async function regenerateSection(
  workspaceId: string,
  blueprintId: string,
  entryId: string,
  sectionId: string,
  steeringNote: string,
  highlight?: string,
): Promise<CopySection | null> {
  const blueprint = getBlueprint(workspaceId, blueprintId);
  if (!blueprint) return null;
  const entry = (blueprint.entries ?? []).find((e) => e.id === entryId);
  if (!entry) return null;

  const section = getSection(sectionId);
  if (!section) return null;

  const planItem = entry.sectionPlan.find((sp) => sp.id === section.sectionPlanItemId);
  if (!planItem) return null;

  // Build context with steering history
  const context = await buildCopyGenerationContext(workspaceId, blueprint, entry);

  // Get all sections for continuity context
  const allSections = getSectionsForEntry(entryId);
  const otherSections = allSections
    .filter((s) => s.id !== sectionId && s.generatedCopy)
    .map((s) => {
      const sp = entry.sectionPlan.find((p) => p.id === s.sectionPlanItemId);
      return `[${sp?.sectionType ?? 'section'}]: ${(s.generatedCopy ?? '').slice(0, 200)}...`;
    })
    .join('\n');

  const steeringContext = section.steeringHistory.length > 0
    ? `Previous steering for this section:\n${section.steeringHistory.map((h) => `- ${h.note}`).join('\n')}`
    : '';

  const prompt = `You are a senior copywriter refining a single section. Regenerate ONLY this section.

${context}

OTHER SECTIONS ON THIS PAGE (for continuity — do NOT repeat their content):
${otherSections}

SECTION TO REGENERATE: ${planItem.sectionType} (${planItem.narrativeRole})
- Brand purpose: ${planItem.brandNote}
- SEO purpose: ${planItem.seoNote}
- Target: ~${planItem.wordCountTarget} words

CURRENT COPY:
${section.generatedCopy}

${highlight ? `HIGHLIGHTED TEXT: "${highlight}"` : ''}
STEERING DIRECTION: ${steeringNote}
${steeringContext}

${WRITING_QUALITY_RULES}

Return ONLY a JSON object:
{
  "copy": "The regenerated copy text",
  "annotation": "Updated annotation",
  "reasoning": "What changed and why"
}`;

  const aiResponse = await callAnthropic({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  let result: { copy: string; annotation: string; reasoning: string };
  try {
    const text = aiResponse.content[0].type === 'text' ? aiResponse.content[0].text : '';
    const jsonStr = text.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    result = JSON.parse(jsonStr);
  } catch (err) {
    log.error({ err }, 'Failed to parse regeneration response');
    throw new Error('Section regeneration failed');
  }

  // Add steering entry
  addSteeringEntry(sectionId, {
    type: highlight ? 'highlight' : 'note',
    note: steeringNote,
    highlight,
    resultVersion: section.version + 1,
  });

  // Run quality check
  const voiceProfile = getVoiceProfile(workspaceId);
  const guardrails = voiceProfile?.guardrailsJson ? JSON.parse(voiceProfile.guardrailsJson) : undefined;
  const qualityFlags = runQualityCheck(result.copy, planItem, guardrails);

  // Save
  return saveGeneratedCopy(sectionId, {
    generatedCopy: result.copy,
    aiAnnotation: result.annotation,
    aiReasoning: result.reasoning,
    qualityFlags: qualityFlags.length > 0 ? qualityFlags : undefined,
  });
}

// ── Helper: format brief data for copy generation context ──

function formatBriefForCopy(brief: any): string {
  const parts: string[] = [];
  if (brief.outline?.length > 0) {
    parts.push(`Outline: ${brief.outline.map((s: any) => s.heading).join(', ')}`);
  }
  if (brief.realPeopleAlsoAsk?.length > 0) {
    parts.push(`People Also Ask:\n${brief.realPeopleAlsoAsk.map((q: any) => `- ${q}`).join('\n')}`);
  }
  if (brief.realTopResults?.length > 0) {
    parts.push(`Top ranking competitors:\n${brief.realTopResults.slice(0, 3).map((r: any) => `- ${r.title} (position ${r.position})`).join('\n')}`);
  }
  if (brief.eeatGuidance) {
    parts.push(`E-E-A-T guidance: ${brief.eeatGuidance}`);
  }
  if (brief.internalLinkSuggestions?.length > 0) {
    parts.push(`Internal link suggestions: ${brief.internalLinkSuggestions.join(', ')}`);
  }
  if (brief.ctaRecommendations?.length > 0) {
    parts.push(`CTA recommendations: ${brief.ctaRecommendations.join(', ')}`);
  }
  return parts.join('\n\n');
}

// Re-export for convenience
import { addSteeringEntry, getSection, getSectionsForEntry } from './copy-review.js';
import type { CopySection, CopyMetadata } from '../shared/types/copy-pipeline.ts';
```

**IMPORTANT NOTES FOR IMPLEMENTER:**

1. The `generateBrief()` function call signature may differ from what's shown. Read the actual function in `server/content-brief.ts` and adapt the call. The key parameters are: `targetKeyword`, `secondaryKeywords`, and `pageType`.

2. The `getVoiceProfile()`, `getVoiceSamples()`, `getBrandscript()`, `getDeliverables()` functions are from Phase 1. If Phase 1 is not yet implemented, stub them to return `null` / `[]` and the generation degrades gracefully.

3. The `WRITING_QUALITY_RULES` import must work. If it's not exported from `content-posts-ai.ts`, Task 3 handles that.

4. Token budget: The full context prompt with all 8 layers can be 4000-6000 tokens. Claude Sonnet 4 has a 200K context window — no concern. But set `max_tokens: 8000` for generation to ensure long pages aren't truncated.

- [ ] **Step 2: Commit**

```bash
git add server/copy-generation.ts
git commit -m "feat: add copy generation engine with 8-layer context assembly and quality check"
```

---

## Task 6: Copy Intelligence Service

**Files:**
- Create: `server/copy-intelligence.ts`

- [ ] **Step 1: Write the copy intelligence service**

```typescript
// server/copy-intelligence.ts
/**
 * Copy Intelligence — workspace-level learning from copy review.
 * Extracts patterns from steering notes, tracks frequency, suggests promotion.
 */
import { randomUUID } from 'node:crypto';
import db from './db/index.js';
import { callOpenAI } from './openai-helpers.js';
import type { CopyIntelligencePattern, IntelligencePatternType } from '../shared/types/copy-pipeline.ts';
import { createLogger } from './logger.js';

const log = createLogger('copy-intelligence');

// ── Row shape ──

interface IntelligenceRow {
  id: string;
  workspace_id: string;
  pattern_type: string;
  pattern: string;
  source: string | null;
  frequency: number;
  active: number;
  created_at: string;
}

// ── Prepared statements ──

interface Stmts {
  insert: ReturnType<typeof db.prepare>;
  selectByWorkspace: ReturnType<typeof db.prepare>;
  selectActive: ReturnType<typeof db.prepare>;
  selectByPattern: ReturnType<typeof db.prepare>;
  updateFrequency: ReturnType<typeof db.prepare>;
  toggleActive: ReturnType<typeof db.prepare>;
  deleteById: ReturnType<typeof db.prepare>;
  updatePattern: ReturnType<typeof db.prepare>;
}

let _stmts: Stmts | null = null;
function stmts(): Stmts {
  if (!_stmts) {
    _stmts = {
      insert: db.prepare(
        `INSERT INTO copy_intelligence (id, workspace_id, pattern_type, pattern, source, frequency, active, created_at)
         VALUES (@id, @workspace_id, @pattern_type, @pattern, @source, @frequency, @active, @created_at)`,
      ),
      selectByWorkspace: db.prepare(
        `SELECT * FROM copy_intelligence WHERE workspace_id = ? ORDER BY frequency DESC, created_at DESC`,
      ),
      selectActive: db.prepare(
        `SELECT * FROM copy_intelligence WHERE workspace_id = ? AND active = 1 ORDER BY frequency DESC`,
      ),
      selectByPattern: db.prepare(
        `SELECT * FROM copy_intelligence WHERE workspace_id = ? AND pattern = ?`,
      ),
      updateFrequency: db.prepare(
        `UPDATE copy_intelligence SET frequency = frequency + 1 WHERE id = ?`,
      ),
      toggleActive: db.prepare(
        `UPDATE copy_intelligence SET active = @active WHERE id = ?`,
      ),
      deleteById: db.prepare(
        `DELETE FROM copy_intelligence WHERE id = ?`,
      ),
      updatePattern: db.prepare(
        `UPDATE copy_intelligence SET pattern = @pattern, pattern_type = @pattern_type WHERE id = @id`,
      ),
    };
  }
  return _stmts;
}

function rowToPattern(row: IntelligenceRow): CopyIntelligencePattern {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    patternType: row.pattern_type as IntelligencePatternType,
    pattern: row.pattern,
    source: row.source,
    frequency: row.frequency,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

// ── Public API ──

export function getAllPatterns(workspaceId: string): CopyIntelligencePattern[] {
  return (stmts().selectByWorkspace.all(workspaceId) as IntelligenceRow[]).map(rowToPattern);
}

export function getActivePatterns(workspaceId: string): CopyIntelligencePattern[] {
  return (stmts().selectActive.all(workspaceId) as IntelligenceRow[]).map(rowToPattern);
}

export function addPattern(
  workspaceId: string,
  data: { patternType: IntelligencePatternType; pattern: string; source?: string },
): CopyIntelligencePattern {
  // Check for duplicate
  const existing = stmts().selectByPattern.get(workspaceId, data.pattern) as IntelligenceRow | undefined;
  if (existing) {
    stmts().updateFrequency.run(existing.id);
    return rowToPattern(stmts().selectByPattern.get(workspaceId, data.pattern) as IntelligenceRow);
  }

  const id = randomUUID();
  stmts().insert.run({
    id,
    workspace_id: workspaceId,
    pattern_type: data.patternType,
    pattern: data.pattern,
    source: data.source ?? null,
    frequency: 1,
    active: 1,
    created_at: new Date().toISOString(),
  });
  return rowToPattern(stmts().selectByPattern.get(workspaceId, data.pattern) as IntelligenceRow);
}

export function togglePattern(patternId: string, active: boolean): void {
  stmts().toggleActive.run({ active: active ? 1 : 0 }, patternId);
}

export function removePattern(patternId: string): void {
  stmts().deleteById.run(patternId);
}

export function updatePatternText(patternId: string, pattern: string, patternType: IntelligencePatternType): void {
  stmts().updatePattern.run({ id: patternId, pattern, pattern_type: patternType });
}

/** Extract intelligence patterns from a set of steering notes */
export async function extractPatterns(
  workspaceId: string,
  steeringNotes: string[],
): Promise<CopyIntelligencePattern[]> {
  if (steeringNotes.length === 0) return [];

  const prompt = `Analyze these copy steering notes from a web design studio. Extract reusable patterns that should apply to ALL future copy generation for this client.

STEERING NOTES:
${steeringNotes.map((n, i) => `${i + 1}. ${n}`).join('\n')}

For each pattern, classify as one of:
- terminology: word/phrase preferences ("use X not Y")
- tone: style/voice adjustments ("shorter headlines", "more conversational")
- structure: structural patterns ("lead with transformation", "avoid passive voice")
- keyword_usage: SEO-specific patterns ("keyword in first sentence")

Return ONLY a JSON array:
[{ "patternType": "...", "pattern": "..." }]

Only extract patterns that are generalizable — skip one-off content-specific feedback. If no generalizable patterns exist, return [].`;

  try {
    const response = await callOpenAI({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const text = response.choices[0]?.message?.content ?? '[]';
    const parsed = JSON.parse(text);
    const patterns = Array.isArray(parsed) ? parsed : parsed.patterns ?? [];

    const results: CopyIntelligencePattern[] = [];
    for (const p of patterns) {
      if (p.patternType && p.pattern) {
        results.push(addPattern(workspaceId, {
          patternType: p.patternType,
          pattern: p.pattern,
          source: `Extracted from ${steeringNotes.length} steering notes`,
        }));
      }
    }
    return results;
  } catch (err) {
    log.error({ err }, 'Failed to extract intelligence patterns');
    return [];
  }
}

/** Get patterns ready for promotion to voice guardrails (frequency >= 3) */
export function getPatternsForPromotion(workspaceId: string): CopyIntelligencePattern[] {
  return getAllPatterns(workspaceId).filter((p) => p.frequency >= 3 && p.active);
}
```

- [ ] **Step 2: Expose `buildCopyIntelligenceContext()` for use in generation prompts**

> **PATCH NOTE — wire the learning loop:** The service above extracts patterns and stores them, but they must also be explicitly fed back into Task 5's generation prompts to close the loop. Without this wiring, copy intelligence is write-only.
>
> Add a `buildCopyIntelligenceContext(workspaceId, pageType)` function to `server/seo-context.ts` (following the pattern of other builder functions in that file). Task 5 (`copy-generation.ts`) must call this function before generating copy for each page, and inject the result into the generation prompt:
>
> ```
> PATTERNS FROM SUCCESSFUL COPY FOR THIS WORKSPACE:
> [extracted patterns: vocabulary themes, structural approaches, tone markers that client approved]
>
> Generate copy that incorporates these learned patterns while remaining unique to this page.
> ```
>
> This function is already partially specified in Task 7 below (`buildCopyIntelligenceContext`) — ensure Task 5 imports and calls it. The call in Task 5's Layer 7 context block (using `getActivePatterns()` directly) should be replaced with a call to `buildCopyIntelligenceContext()` once Task 7 ships it via `seo-context.ts`.
>
> **Acceptance criterion:** Approved copy for workspace B reflects learned patterns from workspace B's prior approved copy. Verify by: (1) approving copy with a distinctive steering note, (2) triggering pattern extraction, (3) generating new copy for a different entry in the same workspace, (4) confirming the AI prompt includes the extracted pattern.

- [ ] **Step 3: Commit**

```bash
git add server/copy-intelligence.ts
git commit -m "feat: add copy intelligence service with pattern extraction and promotion detection"
```

---

## Task 7: seo-context.ts Integration (Enhancement 15)

**Files:**
- Modify: `server/seo-context.ts`

- [ ] **Step 1: Add copy intelligence context builder**

Add to the end of `server/seo-context.ts`, before the main `buildSeoContext()` function's return statement:

```typescript
import { getActivePatterns } from './copy-intelligence.js';
import { listBlueprints, getBlueprint } from './page-strategy.js';
import { getSectionsForEntry } from './copy-review.js';

/** Build workspace-level copy intelligence context for AI prompts */
export function buildCopyIntelligenceContext(workspaceId: string): string {
  const patterns = getActivePatterns(workspaceId);
  if (patterns.length === 0) return '';

  const grouped: Record<string, string[]> = {};
  for (const p of patterns) {
    (grouped[p.patternType] ??= []).push(p.pattern);
  }

  return `LEARNED COPY PATTERNS (apply to all content):\n${
    Object.entries(grouped)
      .map(([type, rules]) => `  ${type}: ${rules.join('; ')}`)
      .join('\n')
  }`;
}

/** Build blueprint context for AI prompts — page strategy awareness */
export function buildBlueprintContext(
  workspaceId: string,
  pagePath?: string,
  pageKeyword?: string,
): string {
  const blueprints = listBlueprints(workspaceId);
  if (blueprints.length === 0) return '';

  const active = blueprints.find((b) => b.status === 'active') ?? blueprints[0];
  const full = getBlueprint(workspaceId, active.id);
  if (!full || !full.entries || full.entries.length === 0) return '';

  // Try to match a specific entry
  let matchedEntry = null;
  if (pageKeyword) {
    matchedEntry = full.entries.find((e) =>
      e.primaryKeyword?.toLowerCase() === pageKeyword.toLowerCase()
    );
  }

  if (matchedEntry) {
    // Include specific entry context + approved copy for reference
    const sections = getSectionsForEntry(matchedEntry.id);
    const approved = sections.filter((s) => s.status === 'approved' && s.generatedCopy);
    const approvedCopyStr = approved.length > 0
      ? `\nApproved copy for this page:\n${approved.map((s) => `  "${(s.generatedCopy ?? '').slice(0, 150)}..."`).join('\n')}`
      : '';

    return `PAGE STRATEGY (from blueprint "${active.name}"):\n` +
      `Page: ${matchedEntry.name} (${matchedEntry.pageType})\n` +
      `Target keyword: ${matchedEntry.primaryKeyword}\n` +
      `Narrative approach: ${matchedEntry.sectionPlan.map((s) => s.narrativeRole).join(' → ')}` +
      approvedCopyStr;
  }

  // No specific match — include blueprint overview for internal linking context
  return `SITE BLUEPRINT ("${active.name}" — ${full.entries.length} pages):\n` +
    full.entries
      .filter((e) => e.scope === 'included')
      .map((e) => `  - ${e.name} (${e.pageType}) → ${e.primaryKeyword ?? 'no keyword'}`)
      .join('\n');
}
```

- [ ] **Step 2: Wire into buildSeoContext()**

Find the `buildSeoContext()` function. Add the new blocks to the return object and `fullContext` assembly:

```typescript
// In the buildSeoContext function, add:
const copyIntelligenceBlock = workspaceId ? buildCopyIntelligenceContext(workspaceId) : '';
const blueprintBlock = workspaceId ? buildBlueprintContext(workspaceId, pagePath) : '';

// In the return object, add:
return {
  // ... existing fields ...
  copyIntelligenceBlock,
  blueprintBlock,
  fullContext: [
    keywordBlock, brandVoiceBlock, businessContext,
    personasBlock, knowledgeBlock,
    copyIntelligenceBlock, blueprintBlock,
  ].filter(Boolean).join('\n\n'),
};
```

**Update the `SeoContext` type** (wherever it's defined) to include the new optional fields:
```typescript
copyIntelligenceBlock?: string;
blueprintBlock?: string;
```

- [ ] **Step 3: Commit**

```bash
git add server/seo-context.ts
git commit -m "feat: wire copy intelligence + blueprint context into seo-context.ts for all AI features"
```

---

## Task 8: API Routes

**Files:**
- Create: `server/routes/copy-pipeline.ts`

- [ ] **Step 1: Write the route file**

```typescript
// server/routes/copy-pipeline.ts
/**
 * Copy Pipeline routes — generation, review, batch, export, intelligence.
 */
import { Router } from 'express';
import {
  getSectionsForEntry,
  getSection,
  updateSectionStatus,
  addSteeringEntry,
  addClientSuggestion,
  updateCopyText,
  getMetadata,
  getEntryCopyStatus,
} from '../copy-review.js';
import {
  generateCopyForEntry,
  regenerateSection,
} from '../copy-generation.js';
import {
  getAllPatterns,
  togglePattern,
  removePattern,
  updatePatternText,
  extractPatterns,
  getPatternsForPromotion,
} from '../copy-intelligence.js';
import { requireWorkspaceAccess } from '../auth.js';
import { createLogger } from '../logger.js';

const router = Router();
const log = createLogger('copy-pipeline-routes');

// ── Generation ──

router.post('/api/copy/:workspaceId/:blueprintId/:entryId/generate', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const { accumulatedSteering } = req.body;
    const result = await generateCopyForEntry(
      req.params.workspaceId,
      req.params.blueprintId,
      req.params.entryId,
      accumulatedSteering,
    );
    res.status(201).json(result);
  } catch (err) {
    log.error({ err }, 'Failed to generate copy');
    res.status(500).json({ error: 'Failed to generate copy' });
  }
});

router.post('/api/copy/:workspaceId/:blueprintId/:entryId/regenerate/:sectionId', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const { note, highlight } = req.body;
    if (!note) return res.status(400).json({ error: 'Steering note is required' });
    const section = await regenerateSection(
      req.params.workspaceId,
      req.params.blueprintId,
      req.params.entryId,
      req.params.sectionId,
      note,
      highlight,
    );
    if (!section) return res.status(404).json({ error: 'Section not found' });
    res.json(section);
  } catch (err) {
    log.error({ err }, 'Failed to regenerate section');
    res.status(500).json({ error: 'Failed to regenerate section' });
  }
});

// ── Review ──

router.get('/api/copy/:workspaceId/entry/:entryId/sections', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const sections = getSectionsForEntry(req.params.entryId);
  res.json(sections);
});

router.get('/api/copy/:workspaceId/entry/:entryId/status', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const status = getEntryCopyStatus(req.params.entryId);
  res.json(status);
});

router.get('/api/copy/:workspaceId/entry/:entryId/metadata', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const metadata = getMetadata(req.params.entryId);
  if (!metadata) return res.status(404).json({ error: 'No metadata found' });
  res.json(metadata);
});

router.patch('/api/copy/:workspaceId/section/:sectionId/status', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { status } = req.body;
  const section = updateSectionStatus(req.params.sectionId, status);
  if (!section) return res.status(404).json({ error: 'Section not found' });
  res.json(section);
});

router.patch('/api/copy/:workspaceId/section/:sectionId/text', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { copy } = req.body;
  if (!copy) return res.status(400).json({ error: 'Copy text is required' });
  const section = updateCopyText(req.params.sectionId, copy);
  if (!section) return res.status(404).json({ error: 'Section not found' });
  res.json(section);
});

// ── Client suggestions ──

router.post('/api/copy/:workspaceId/section/:sectionId/suggest', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { originalText, suggestedText } = req.body;
  if (!originalText || !suggestedText) return res.status(400).json({ error: 'originalText and suggestedText required' });
  const section = addClientSuggestion(req.params.sectionId, { originalText, suggestedText });
  if (!section) return res.status(404).json({ error: 'Section not found' });
  res.json(section);
});

// ── Intelligence ──

router.get('/api/copy/:workspaceId/intelligence', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const patterns = getAllPatterns(req.params.workspaceId);
  res.json(patterns);
});

router.get('/api/copy/:workspaceId/intelligence/promotable', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const patterns = getPatternsForPromotion(req.params.workspaceId);
  res.json(patterns);
});

router.patch('/api/copy/:workspaceId/intelligence/:patternId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { active, pattern, patternType } = req.body;
  if (active !== undefined) togglePattern(req.params.patternId, active);
  if (pattern && patternType) updatePatternText(req.params.patternId, pattern, patternType);
  res.json({ ok: true });
});

router.delete('/api/copy/:workspaceId/intelligence/:patternId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  removePattern(req.params.patternId);
  res.json({ ok: true });
});

router.post('/api/copy/:workspaceId/intelligence/extract', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const { steeringNotes } = req.body;
    const patterns = await extractPatterns(req.params.workspaceId, steeringNotes ?? []);
    res.json(patterns);
  } catch (err) {
    log.error({ err }, 'Failed to extract patterns');
    res.status(500).json({ error: 'Failed to extract patterns' });
  }
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/copy-pipeline.ts
git commit -m "feat: add copy pipeline API routes for generation, review, and intelligence"
```

---

## Task 9: Register Routes + App.ts

**Files:**
- Modify: `server/app.ts`

- [ ] **Step 1: Add import and mount**

```typescript
// Add import near other route imports:
import copyPipelineRoutes from './routes/copy-pipeline.js';

// Add mount in the route mounting section:
app.use(copyPipelineRoutes);
```

- [ ] **Step 2: Commit**

```bash
git add server/app.ts
git commit -m "feat: register copy pipeline routes in app.ts"
```

---

## Task 10: Frontend API Client

**Files:**
- Modify: `src/api/brand-engine.ts`

- [ ] **Step 1: Add copy pipeline API functions**

Add to the end of `src/api/brand-engine.ts`:

```typescript
import type {
  CopySection,
  CopyMetadata,
  CopySectionStatus,
  CopyIntelligencePattern,
  EntryCopyStatus,
} from '../../shared/types/copy-pipeline';

// ═══ COPY GENERATION ═══

export const copyGeneration = {
  generate: (wsId: string, blueprintId: string, entryId: string, accumulatedSteering?: string[]) =>
    post<{ sections: CopySection[]; metadata: CopyMetadata }>(
      `/api/copy/${wsId}/${blueprintId}/${entryId}/generate`,
      { accumulatedSteering },
    ),

  regenerate: (wsId: string, blueprintId: string, entryId: string, sectionId: string, note: string, highlight?: string) =>
    post<CopySection>(
      `/api/copy/${wsId}/${blueprintId}/${entryId}/regenerate/${sectionId}`,
      { note, highlight },
    ),
};

// ═══ COPY REVIEW ═══

export const copyReview = {
  getSections: (wsId: string, entryId: string) =>
    get<CopySection[]>(`/api/copy/${wsId}/entry/${entryId}/sections`),

  getStatus: (wsId: string, entryId: string) =>
    get<EntryCopyStatus>(`/api/copy/${wsId}/entry/${entryId}/status`),

  getMetadata: (wsId: string, entryId: string) =>
    get<CopyMetadata>(`/api/copy/${wsId}/entry/${entryId}/metadata`),

  updateStatus: (wsId: string, sectionId: string, status: CopySectionStatus) =>
    patch<CopySection>(`/api/copy/${wsId}/section/${sectionId}/status`, { status }),

  updateText: (wsId: string, sectionId: string, copy: string) =>
    patch<CopySection>(`/api/copy/${wsId}/section/${sectionId}/text`, { copy }),

  addSuggestion: (wsId: string, sectionId: string, originalText: string, suggestedText: string) =>
    post<CopySection>(`/api/copy/${wsId}/section/${sectionId}/suggest`, { originalText, suggestedText }),
};

// ═══ COPY INTELLIGENCE ═══

export const copyIntelligence = {
  list: (wsId: string) =>
    get<CopyIntelligencePattern[]>(`/api/copy/${wsId}/intelligence`),

  getPromotable: (wsId: string) =>
    get<CopyIntelligencePattern[]>(`/api/copy/${wsId}/intelligence/promotable`),

  update: (wsId: string, patternId: string, body: Partial<CopyIntelligencePattern>) =>
    patch(`/api/copy/${wsId}/intelligence/${patternId}`, body),

  remove: (wsId: string, patternId: string) =>
    del(`/api/copy/${wsId}/intelligence/${patternId}`),

  extract: (wsId: string, steeringNotes: string[]) =>
    post<CopyIntelligencePattern[]>(`/api/copy/${wsId}/intelligence/extract`, { steeringNotes }),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/api/brand-engine.ts
git commit -m "feat: add copy pipeline frontend API client"
```

---

## Tasks 11-15: UI Components + Integration

> **Implementation note:** Tasks 11-15 follow the exact same React patterns established in Phase 2 (BlueprintDetail.tsx, PageStrategyTab.tsx). The implementer should reference those components for state management, styling, and layout patterns. Rather than duplicating 500+ lines of JSX, these tasks describe the key components, their props, state, and behavior.

### Task 11: CopyReviewPanel Component

**File:** `src/components/brand/CopyReviewPanel.tsx`

**Purpose:** Section-by-section copy review with approve, regenerate, steer, and manual edit.

**Props:** `{ workspaceId, blueprintId, entryId }`

**Key behavior:**
- Fetch sections via `copyReview.getSections(wsId, entryId)` on mount
- Display each section with: section type label, narrative role badge, generated copy text, AI annotation, quality flag warnings (if any)
- Action buttons per section: Approve, Regenerate, Send to Client Review
- "Regenerate with note" — text input that calls `copyGeneration.regenerate()` with the note
- "Highlight + steer" — user selects text in the copy, a popover appears with text input, calls `copyGeneration.regenerate()` with the highlight + note
- Manual edit mode — click copy text to make it editable, save calls `copyReview.updateText()`
- SEO metadata section at top: seo_title, meta_description, og_title, og_description with same review controls
- Copy status badge per section (pending/draft/client_review/approved/revision_requested)
- Overall progress: "5/8 sections approved"

**Styling:** Follow the Phase 2 `BlueprintDetail.tsx` patterns — zinc-900 backgrounds, teal accents, compact text.

### Task 12: BatchGenerationPanel Component

**File:** `src/components/brand/BatchGenerationPanel.tsx`

**Purpose:** Select entries, choose batch mode, track generation progress.

**Props:** `{ workspaceId, blueprintId, entries: BlueprintEntry[] }`

**Key behavior:**
- Checkbox list of entries with page type badges and copy status
- Mode selector: "Review Inbox" (generate all) vs. "Iterative" (batch of 3-5)
- "Generate" button — triggers generation for selected entries
- Progress tracking: "Generating: 3/15 done" with per-entry status
- For iterative mode: after each batch completes, show review prompt before generating next batch
- Accumulated steering notes visible for iterative mode
- Pause/resume capability (just stops generating next batch)

### Task 13: CopyExportPanel Component

**File:** `src/components/brand/CopyExportPanel.tsx`

**Purpose:** Choose export format and scope, trigger export.

**Props:** `{ workspaceId, blueprintId, entries: BlueprintEntry[] }`

**Key behavior:**
- Format selector: Webflow CMS, CSV, Copy Deck (Google Doc / Word)
- Scope selector: All approved, Selected entries, Single entry
- For Webflow CMS: show connection status, collection name input
- Export button → calls export API → shows download link or success message
- Only show entries with `approved` copy status as exportable

### Task 14: CopyIntelligenceManager Component

**File:** `src/components/brand/CopyIntelligenceManager.tsx`

**Purpose:** View, edit, toggle, and promote learned patterns.

**Props:** `{ workspaceId }`

**Key behavior:**
- List all patterns grouped by type (terminology, tone, structure, keyword_usage)
- Toggle switch per pattern (active/inactive)
- Edit pattern text inline
- Delete pattern
- "Promotable" section: patterns with frequency >= 3, with "Promote to Voice Guardrail" button
- Promote action: calls voice-calibration API to add pattern as a guardrail

### Task 15: BlueprintDetail Integration

**File:** Modify `src/components/brand/BlueprintDetail.tsx`

**Changes:**
- Add a "Copy" tab/view alongside the existing section plan view per entry
- When expanded, show `CopyReviewPanel` for the selected entry
- Add copy status badge on each entry card in the list view
- Add "Generate Copy" button on entries without copy
- Add batch generation controls at the blueprint level
- Add export panel at the blueprint level
- Wire up the copy intelligence manager (accessible from blueprint header)

---

**Commit Tasks 11-15 individually as each component is completed.**

---

# TIER 2: Platform Integration Features

> These tasks ship incrementally after the core pipeline (Tier 1) is working. Each is independently deployable.

## Task 16: Approved Copy → Voice Samples (Enhancement 10)

**File:** Modify `server/copy-review.ts`

Add a post-approval hook: when `updateSectionStatus()` changes a section to `approved`, save the approved copy as a voice sample with `source: 'copy_approved'` and `context_tag` mapped from section type.

```typescript
import { addVoiceSample } from './voice-calibration.js';

const SECTION_TYPE_TO_CONTEXT_TAG: Record<string, string> = {
  'hero': 'headline', 'problem': 'body', 'solution': 'body',
  'features-benefits': 'body', 'process': 'body', 'faq': 'faq',
  'cta': 'cta', 'about-team': 'about', 'content-body': 'body',
  'social-proof': 'body', 'testimonials': 'body',
};

// In updateSectionStatus(), after updating to 'approved':
// 1. Get the section plan item to find sectionType
// 2. Map to context_tag
// 3. Check if 3 copy_approved samples already exist for this context_tag
// 4. If yes, replace the oldest one (FIFO)
// 5. If no, add the new sample
```

**Cap:** Max 3 copy_approved samples per context_tag per voice profile.

> **PATCH NOTE — close the full loop:** After calling `addVoiceSample()`, also call `clearSeoContextCache(workspaceId)` to invalidate the LRU cache so future copy generations pick up the new voice sample immediately. Without this cache bust, the voice profile doesn't update for the current session.
>
> This task closes the complete learning loop:
> **Discovery → Voice Calibration → Blueprint → Copy Generation → Approval → Voice Sample → better future Copy Generation**
>
> Without this task, the voice profile never grows from real-world copy work.
>
> **Implementation requirement:** Phase 1's `addVoiceSample()` must be importable from `server/voice-calibration.ts`. Phase 3 agents must NOT implement their own voice sample storage logic — import from Phase 1 only.

---

## Task 17: Voice Feedback Loop (Enhancement 9)

**File:** Create `server/copy-voice-feedback.ts`

After copy intelligence extraction runs, classify each steering note as `content_feedback` or `voice_feedback` using GPT-4.1-mini. Voice feedback gets routed to voice profile updates:

- Tone language ("too formal") → adjust voice DNA trait scores (flag for review, don't auto-apply)
- Forbidden word reference → add to voice guardrails (flag for review)
- Notification pattern: "Based on copy feedback, suggest adding 'never use synergy' to guardrails. [Apply] [Dismiss]"

---

## Task 18: Quality Rules Evolution (Enhancement 12)

**File:** Modify `server/copy-intelligence.ts`

When a pattern reaches `frequency >= 3`, flag it for promotion. Add an API endpoint that returns promotable patterns. The UI (CopyIntelligenceManager) shows a "Promote to Guardrail" button that calls the voice profile service to add the pattern as a guardrail.

---

## Task 19: Brief Quality Feedback Loop (Enhancement 11)

**File:** Modify `server/copy-review.ts`

When all sections for an entry are approved, calculate `copy_approval_rate` (% approved on first try — version === 1) and update the linked content brief.

```sql
UPDATE content_briefs SET copy_approval_rate = ? WHERE id = ?
```

After 10+ briefs in a workspace, surface patterns via the admin chat or intelligence manager.

---

## Task 20: Questionnaire → Brandscript (Enhancement 16)

**File:** Modify `server/brandscript.ts`

Add `prefillFromQuestionnaire(workspaceId, brandscriptId)` function that:
1. Reads workspace questionnaire responses
2. Maps fields to brandscript sections (Character, Problem, Guide)
3. Uses GPT-4.1-mini to structure raw data into section content
4. Also auto-populates voice guardrails from `avoidWords` field

Trigger: When creating a new brandscript, check for questionnaire data and offer pre-fill.

---

## Task 21: Admin Chat → Blueprint + Copy Awareness (Enhancement 18)

**File:** Modify `server/admin-chat-context.ts`

Add blueprint and copy status as data sources:
- Add `'blueprint'` and `'copy'` to the question category classifier
- When category matches, assemble blueprint overview + copy pipeline status + copy intelligence patterns
- Add to the `sections` array in `assembleAdminContext()`

---

## Task 22: Content Decay → Copy Refresh (Enhancement 17)

**File:** Modify `server/content-decay.ts` (or create `server/copy-refresh.ts`)

When decay is detected for a page:
1. Query blueprint_entries for matching keyword/URL
2. If found, suggest section-specific refresh based on decay type
3. Offer "Refresh Copy" action that navigates to blueprint entry copy view

---

## Task 23: GSC → Keyword Drift Detection (Enhancement 19)

**File:** Create `server/keyword-drift.ts`

Weekly or on-demand function:
1. Get all blueprint entries with published copy
2. Fetch GSC top queries for each page
3. Compare against blueprint primary keyword
4. Flag drift where GSC #1 query !== primary keyword

---

## Task 24: Site Architecture ↔ Blueprint (Enhancement 20)

**File:** Modify `server/blueprint-generator.ts`

Add `importFromSiteArchitecture(workspaceId, blueprintId)`:
1. Fetch URL tree from site architecture
2. Auto-detect page types from URL patterns
3. Pull GSC keywords per page
4. Create blueprint entries

Also add planned pages to site architecture view.

---

## Task 25: Persona ← Brandscript Sync (Enhancement 21)

**File:** Create `server/persona-sync.ts`

When brandscript is approved:
1. Extract persona-relevant fields (Character → goals, Problem → pain points)
2. Use GPT-4.1-mini to structure into persona format
3. Merge additively into existing workspace personas
4. Show confirmation prompt before syncing

---

## Final Verification

- [ ] **Step 1: Start dev server and verify migration 028 runs**
- [ ] **Step 2: Test copy generation for a single blueprint entry via API**
- [ ] **Step 3: Test section status updates and steering history**
- [ ] **Step 4: Test copy intelligence pattern extraction**
- [ ] **Step 5: Verify seo-context.ts includes copy intelligence in fullContext**
- [ ] **Step 6: Verify UI renders — copy review panel, batch controls, export panel**
- [ ] **Step 7: End-to-end test: generate → review → approve → export CSV**
- [ ] **Step 8 (intelligence loop): Approve a copy section → confirm voice sample was added → generate new copy for a different entry → confirm AI prompt includes learned patterns**

---

## Intelligence Layer Integration Notes

> These notes document how Phase 3 depends on the WorkspaceIntelligence layer and prior phases. Read before dispatching implementation agents.

**WorkspaceIntelligence dependency:**
- Copy generation (`copy-generation.ts`) uses `buildWorkspaceIntelligence()` from `server/workspace-intelligence.ts`
- Requires Phase 1 (Brandscript) to be shipped and merged so `seoContext` includes VoiceDNA, brandscript, and identity
- Requires Phase 2 (Page Strategy) to be shipped and merged so blueprint entries and briefs exist and are queryable
- Do NOT start Phase 3 implementation until both Phase 1 and Phase 2 are merged and green on staging

**Per-page insight injection (Patch 2 above):**
- Requires `pagePath` to be stored on blueprint entries — Phase 2 must write the target page path onto each `blueprint_entries` row
- If `pagePath` is missing from Phase 2 entries, per-page insight filtering will not work; fall back to injecting all workspace-level insights unfiltered

**Approved copy → voice sample feedback (Task 16 / Patch 4):**
- Requires Phase 1's `addVoiceSample()` to be importable from `server/voice-calibration.ts`
- Phase 3 agents must NOT implement their own voice sample storage logic — import from Phase 1 only
- Also requires `clearSeoContextCache(workspaceId)` to be exported from `server/workspace-intelligence.ts` or `server/seo-context.ts`

**Copy Intelligence context builder (Patch 3):**
- `buildCopyIntelligenceContext(workspaceId, pageType)` should be added to `server/seo-context.ts`, following the pattern of `buildBlueprintContext()` and other builder functions in that file
- Once added, Task 5's Layer 7 context block should call this function rather than calling `getActivePatterns()` directly

**Dependency chain (strict order):**

```
Phase 1 (Brandscript + Voice Calibration) — must be merged + green on staging
  ↓
Phase 2 (Page Strategy + Blueprint) — must be merged + green on staging
  ↓
Phase 3 (Copy Pipeline) — this plan
```

---

## Post-Phase 3 Reminder: Wire Blueprint into Meeting Brief

> **Context:** The Meeting Brief (shipped before this plan) was designed as a two-phase Strategic Intelligence Layer. Phase 1 = Meeting Brief. Phase 2 = Site Architecture Intelligence. The Site Blueprint (this plan, Phase 2) is the first piece of data that makes the Meeting Brief's "Blueprint Progress" section come alive. Once Phase 3 ships, all three phases of the Copy Engine are done and the blueprint tables are stable — that's the right time to close this loop.

### Why this matters

The Meeting Brief shows clients a screen-shareable narrative before every call. Section 5 is "Blueprint Progress" — how many blueprint pages are live vs. in-progress vs. planned. Right now it's hardcoded `null` (hidden). Wiring it in makes every client meeting brief tell the story of how the site is progressing against the agreed plan. This is a high-value, high-visibility connection between two major features.

### What's already done (no changes needed)

- `meeting_briefs.blueprint_progress` column exists in the DB
- `MeetingBrief.blueprintProgress: string | null` in shared types
- `<BlueprintProgress>` component renders when the value is non-null, hidden when null
- `buildBriefPrompt()` already asks the AI to generate `blueprintProgress` in its JSON output — it just currently instructs the AI to always set it to null

### What needs to change (single file: `server/meeting-brief-generator.ts`)

**Step 1 — Add `getBlueprintSummary()`:**

```typescript
async function getBlueprintSummary(workspaceId: string): Promise<{ raw: string; total: number; live: number; inProgress: number; planned: number } | null> {
  try {
    const rows = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM blueprint_entries
      WHERE workspace_id = ?
      GROUP BY status
    `).all(workspaceId) as Array<{ status: string; count: number }>;

    if (rows.length === 0) return null;

    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const live = rows.find(r => r.status === 'live')?.count ?? 0;
    const inProgress = rows.find(r => r.status === 'in_progress')?.count ?? 0;
    const planned = total - live - inProgress;

    return {
      raw: `${live} of ${total} blueprint pages live, ${inProgress} in progress, ${planned} planned`,
      total, live, inProgress, planned,
    };
  } catch {
    // Blueprint feature not yet shipped or no blueprint for this workspace
    return null;
  }
}
```

**Step 2 — Pass blueprint data into `buildBriefPrompt()`:**

Update the function signature:
```typescript
export function buildBriefPrompt(intel: WorkspaceIntelligence, blueprintSummary: { raw: string; total: number } | null): string {
```

Add a `BLUEPRINT` section to the prompt context:
```
${blueprintSummary ? `BLUEPRINT PROGRESS:\n${blueprintSummary.raw}\nTotal pages in plan: ${blueprintSummary.total}` : 'BLUEPRINT PROGRESS:\nNo site blueprint has been created for this workspace yet.'}
```

Update the AI instructions — replace:
```
- blueprintProgress is always null in this version (Phase 1)
```
With:
```
- blueprintProgress: if blueprint data is present above, write 1-2 sentences on progress toward the plan, framed as momentum (not deficit). If no blueprint data, set to null.
```

**Step 3 — Call in `generateMeetingBrief()`:**

```typescript
const [intel, blueprintSummary] = await Promise.all([
  buildWorkspaceIntelligence(workspaceId, { slices: BRIEF_SLICES }),
  getBlueprintSummary(workspaceId),
]);
```

Pass `blueprintSummary` to `buildBriefPrompt(intel, blueprintSummary)`.

### Acceptance criteria for this follow-up task

- [ ] Workspace with an active blueprint shows Section 5 ("Blueprint Progress") in the brief
- [ ] Workspace without a blueprint still renders correctly (section hidden)
- [ ] `getBlueprintSummary()` does not throw if `blueprint_entries` table doesn't exist
- [ ] `npx tsc --noEmit --skipLibCheck` passes
- [ ] `npx vitest run` passes

> This is a ~1-hour task, not a full plan. It's a single-file change to `server/meeting-brief-generator.ts` plus a brief test addition.

No phase may start implementation until the prior phase is merged and CI is green on staging. Use `<FeatureFlag flag="copyPipeline">` to dark-launch Phase 3 UI until the full pipeline is verified end-to-end.

---

## Amendments

### Amendment 1: Use buildSystemPrompt() for all AI calls

Every AI call in the copy generator and related services must use `buildSystemPrompt(workspaceId, baseInstructions)` from `server/prompt-assembly.ts`.

**Import to add** to every server file that makes an AI call:
```typescript
import { buildSystemPrompt } from './prompt-assembly.js';
```

**Usage pattern:**
```typescript
// ❌ Wrong — inline string, misses voice DNA
const systemPrompt = `You are writing copy for ${brandName}. Voice: ${voiceNotes}.`;

// ✅ Correct — layered assembly (voice DNA from Layer 2 + custom notes from Layer 3)
const systemPrompt = buildSystemPrompt(workspaceId, `
You are writing copy for ${brandName}.
Page type: ${pageType}
Target audience: ${targetAudience}
`.trim());
```

By Phase 3, when a workspace has a calibrated voice profile (Brandscript Phase 1), Layer 2 activates automatically — the copy generator gets voice-calibrated framing with zero code changes.

**Token budget:** Before injecting intelligence context into any prompt, select the top 3 per-page insights (not all of them) to avoid lost-in-the-middle degradation:
```typescript
const pageInsights = (intelligence.insights ?? [])
  .filter(i => i.pagePath === targetPagePath)
  .sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0))
  .slice(0, 3)
  .map(i => `- ${i.title}: ${i.summary ?? ''}`)
  .join('\n');
```

### Amendment 2: Temperature settings for copy generation

All AI calls in the copy pipeline must specify explicit temperature values.

| Call type | Model | Temperature | Reason |
|-----------|-------|-------------|--------|
| Page copy generation (first draft) | Claude | 0.7 | Creative — needs variation to iterate on |
| Page copy refinement / rewrite | Claude | 0.5 | Smaller variance — steering adjustments only |
| Brief → outline generation | GPT-4.1 | 0.4 | Structured output — controlled |
| Bulk copy generation | Claude | 0.65 | Slight reduction vs single-page — consistency across pages |
| Meta description generation | GPT-4.1 | 0.3 | Near-deterministic — SEO-constrained |

Pattern for copy generation:
```typescript
const result = await callAnthropic(messages, {
  system: systemPrompt,
  maxTokens: 2500,
  temperature: 0.7,
});
```

Pattern for structured outline:
```typescript
const result = await callOpenAI(messages, {
  system: systemPrompt,
  maxTokens: 1500,
  temperature: 0.4,
  response_format: { type: 'json_object' },
});
```

### Amendment 3: Structured JSON output reliability

Any AI call that returns structured JSON must include `response_format: { type: 'json_object' }` (OpenAI) or XML-tagged sections with explicit parsing (Anthropic). Add retry-once logic for any JSON parse failure:

```typescript
let parsed: YourOutputType;
try {
  parsed = JSON.parse(raw) as YourOutputType;
} catch {
  const retryRaw = await callOpenAI(
    [
      ...messages,
      { role: 'assistant' as const, content: raw },
      { role: 'user' as const, content: 'Your response was not valid JSON. Return only the JSON object.' },
    ],
    {
      system: systemPrompt,
      maxTokens: 1500,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }
  );
  parsed = JSON.parse(retryRaw) as YourOutputType;
}
```
