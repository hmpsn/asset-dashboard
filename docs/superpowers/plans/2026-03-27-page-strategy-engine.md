# Page Strategy Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a site blueprint system that generates, manages, and iterates on full page strategies for client projects, connecting brandscript context with SEMrush keyword data and existing Content Templates.

**Architecture:** Two new server-side modules (`page-strategy.ts`, `blueprint-generator.ts`) with one route file, a single new migration (`027-page-strategy-engine.sql`), frontend API layer additions to `src/api/brand-engine.ts`, and new Brand Hub sub-tab components. The blueprint generator uses Claude Sonnet 4 for strategic page recommendations and GPT-4.1-mini for keyword clustering. Builds on top of existing Content Templates, Content Matrices, and SEMrush integration.

**Tech Stack:** better-sqlite3, Express, React, Claude Sonnet 4 (creative), GPT-4.1-mini (structured), existing `callAnthropic`/`callOpenAI` wrappers, existing SEMrush integration.

**Spec:** `docs/superpowers/specs/2026-03-27-page-strategy-engine-design.md`

**Prerequisite:** Phase 1 (Brandscript Engine) must be **fully complete, committed, and verified** before starting Phase 2. Migration 026, all shared types, all services, and all context builders must be in place.

**Guardrails:** `docs/superpowers/plans/COPY_ENGINE_GUARDRAILS.md` — **READ BEFORE DISPATCHING AGENTS.** Contains file ownership maps, task dependency graphs, cross-phase contracts, and missing spec addendum items.

**Coordination rules:** `.windsurf/rules/multi-agent-coordination.md`

---

## Task Dependencies

```
Sequential foundation:
  Task 1 (Migration 027) → Task 2 (Shared Types + content.ts extension)

Parallel services (after Task 2):
  Task 3 (Blueprint CRUD) ∥ Task 4 (Blueprint Generator)

Sequential shared-file tasks (after parallel batch completes + diff review):
  Task 5 (Routes — reorder before param routes!) — creates server/routes/page-strategy.ts
  Task 6 (App.ts route registration) — modifies server/app.ts
  Task 7 (API client additions) — modifies src/api/brand-engine.ts

Parallel frontend (after Task 7):
  Task 8 (PageStrategyTab) ∥ Task 9 (BlueprintDetail) ∥ Task 10 (VersionHistory)

Sequential shared frontend (after parallel batch completes + diff review):
  Task 11 (BrandHub.tsx — add Page Strategy tab)
```

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `server/db/migrations/027-page-strategy-engine.sql` | Tables: site_blueprints, blueprint_entries, blueprint_versions |
| `server/page-strategy.ts` | Blueprint CRUD, entry management, versioning, section plan helpers |
| `server/blueprint-generator.ts` | AI blueprint generation, keyword mapping, section plan generation |
| `server/routes/page-strategy.ts` | API routes for blueprints, entries, versions, generation, client view |
| `shared/types/page-strategy.ts` | Shared TypeScript types for blueprints, entries, section plans |
| `src/components/brand/PageStrategyTab.tsx` | Blueprint overview — list, create, scope management |
| `src/components/brand/BlueprintDetail.tsx` | Entry detail — section plan editor, keyword assignments |
| `src/components/brand/BlueprintVersionHistory.tsx` | Version history timeline |

### Modified files

| File | Changes |
|------|---------|
| `server/app.ts` | Import and register page-strategy route file |
| `src/api/brand-engine.ts` | Add blueprint, entry, and generation API functions |
| `src/components/BrandHub.tsx` | Add Page Strategy section alongside existing Brand Hub sections |
| `shared/types/content.ts` | Extend `TemplateSection` with `narrativeRole`, `brandNote`, `seoNote` fields; extend `ContentPageType` with Phase 2 page types |

---

## Task 1: Database Migration

**Files:**
- Create: `server/db/migrations/027-page-strategy-engine.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 027-page-strategy-engine.sql
-- Page Strategy Engine tables (Phase 2)

-- ═══ SITE BLUEPRINTS ═══

CREATE TABLE IF NOT EXISTS site_blueprints (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  name              TEXT NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'draft',
  brandscript_id    TEXT,
  industry_type     TEXT,
  generation_inputs TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_blueprints_workspace ON site_blueprints(workspace_id);

-- ═══ BLUEPRINT ENTRIES ═══

CREATE TABLE IF NOT EXISTS blueprint_entries (
  id                  TEXT PRIMARY KEY,
  blueprint_id        TEXT NOT NULL REFERENCES site_blueprints(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  page_type           TEXT NOT NULL,
  scope               TEXT NOT NULL DEFAULT 'included',
  sort_order          INTEGER NOT NULL DEFAULT 0,
  is_collection       INTEGER NOT NULL DEFAULT 0,
  primary_keyword     TEXT,
  secondary_keywords  TEXT,
  keyword_source      TEXT,
  section_plan        TEXT NOT NULL DEFAULT '[]',
  template_id         TEXT,
  matrix_id           TEXT,
  brief_id            TEXT,  -- FK to content_briefs (populated by Phase 3 auto-brief generation)
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blueprint_entries_blueprint ON blueprint_entries(blueprint_id);

-- ═══ BLUEPRINT VERSIONS ═══

CREATE TABLE IF NOT EXISTS blueprint_versions (
  id              TEXT PRIMARY KEY,
  blueprint_id    TEXT NOT NULL REFERENCES site_blueprints(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  snapshot        TEXT NOT NULL,
  change_notes    TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blueprint_versions_blueprint ON blueprint_versions(blueprint_id);
```

- [ ] **Step 2: Verify migration runs on server start**

Run: `cd /Users/joshuahampson/CascadeProjects/asset-dashboard && npx tsx server/db/index.ts`
Expected: No errors, tables created. Check with: `sqlite3 data/app.db ".tables"` — should include `site_blueprints`, `blueprint_entries`, `blueprint_versions`.

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/027-page-strategy-engine.sql
git commit -m "feat(db): add page strategy engine tables — migration 027"
```

---

## Task 2: Shared Types

**Files:**
- Create: `shared/types/page-strategy.ts`
- Modify: `shared/types/content.ts`

- [ ] **Step 1: Write the shared types**

```typescript
// shared/types/page-strategy.ts

// ═══ SECTION PLAN ═══

export type SectionType =
  | 'hero' | 'problem' | 'solution' | 'social-proof' | 'process'
  | 'faq' | 'cta' | 'about-team' | 'testimonials' | 'features-benefits'
  | 'pricing' | 'gallery' | 'stats' | 'content-body' | 'contact-form'
  | 'location-info' | 'related-resources' | 'custom';

export type NarrativeRole =
  | 'hook' | 'problem' | 'guide' | 'plan' | 'call-to-action'
  | 'failure-stakes' | 'success-transformation' | 'authority'
  | 'objection-handling' | 'custom';

export interface SectionPlanItem {
  id: string;
  sectionType: SectionType;
  narrativeRole: NarrativeRole;
  brandNote: string;
  seoNote: string;
  wordCountTarget: number;
  order: number;
}

// ═══ BLUEPRINT ENTRY ═══

// SPEC ADDENDUM §2: Do NOT create a separate BlueprintPageType.
// Import ContentPageType from content.ts and use it everywhere.
// Step 2 of this task extends ContentPageType with the new values.
import type { ContentPageType } from './content';

// Re-export for convenience — all blueprint code uses ContentPageType
export type { ContentPageType as BlueprintPageType };

export type EntryScope = 'included' | 'recommended';
export type KeywordSource = 'ai_suggested' | 'semrush' | 'manual';

export interface BlueprintEntry {
  id: string;
  blueprintId: string;
  name: string;
  pageType: BlueprintPageType;
  scope: EntryScope;
  sortOrder: number;
  isCollection: boolean;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  keywordSource?: KeywordSource;
  sectionPlan: SectionPlanItem[];
  templateId?: string;
  matrixId?: string;
  briefId?: string;   // Populated by Phase 3 auto-brief generation
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ═══ SITE BLUEPRINT ═══

export type BlueprintStatus = 'draft' | 'active' | 'archived';

export interface SiteBlueprint {
  id: string;
  workspaceId: string;
  name: string;
  version: number;
  status: BlueprintStatus;
  brandscriptId?: string;
  industryType?: string;
  generationInputs?: Record<string, unknown>;
  notes?: string;
  entries?: BlueprintEntry[];
  createdAt: string;
  updatedAt: string;
}

// ═══ BLUEPRINT VERSION ═══

export interface BlueprintVersion {
  id: string;
  blueprintId: string;
  version: number;
  snapshot: {
    blueprint: Omit<SiteBlueprint, 'entries'>;
    entries: BlueprintEntry[];
  };
  changeNotes?: string;
  createdAt: string;
}

// ═══ GENERATION ═══

export interface BlueprintGenerationInput {
  brandscriptId?: string;
  industryType: string;
  domain?: string;
  targetPageCount?: number;
  includeContentPages?: boolean;
  includeLocationPages?: boolean;
  locationCount?: number;
}

export interface GeneratedBlueprintEntry {
  name: string;
  pageType: BlueprintPageType;
  scope: EntryScope;
  isCollection: boolean;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  sectionPlan: Omit<SectionPlanItem, 'id'>[];
  rationale: string;
}
```

- [ ] **Step 2: Extend TemplateSection in content.ts**

Add three optional fields to the existing `TemplateSection` interface in `shared/types/content.ts`:

```typescript
export interface TemplateSection {
  id: string;
  name: string;
  headingTemplate: string;
  guidance: string;
  wordCountTarget: number;
  order: number;
  cmsFieldSlug?: string;
  narrativeRole?: string;   // NEW — StoryBrand or custom narrative role
  brandNote?: string;        // NEW — one-line brand purpose
  seoNote?: string;          // NEW — one-line SEO purpose
}
```

- [ ] **Step 3: Commit**

```bash
git add shared/types/page-strategy.ts shared/types/content.ts
git commit -m "feat(types): add page strategy shared types, extend TemplateSection with narrative fields"
```

---

## Task 3: Blueprint CRUD Service

**Files:**
- Create: `server/page-strategy.ts`

- [ ] **Step 1: Write the blueprint service**

```typescript
// server/page-strategy.ts
/**
 * Page Strategy — CRUD for site blueprints, blueprint entries, and versioning.
 */
import { randomUUID } from 'node:crypto';
import db from './db/index.js';
import type {
  SiteBlueprint,
  BlueprintEntry,
  BlueprintVersion,
  BlueprintStatus,
  SectionPlanItem,
  BlueprintPageType,
  EntryScope,
} from '../shared/types/page-strategy.ts';
import { createLogger } from './logger.js';

const log = createLogger('page-strategy');

// ── SQLite row shapes ──

interface BlueprintRow {
  id: string;
  workspace_id: string;
  name: string;
  version: number;
  status: string;
  brandscript_id: string | null;
  industry_type: string | null;
  generation_inputs: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface EntryRow {
  id: string;
  blueprint_id: string;
  name: string;
  page_type: string;
  scope: string;
  sort_order: number;
  is_collection: number;
  primary_keyword: string | null;
  secondary_keywords: string | null;
  keyword_source: string | null;
  section_plan: string;
  template_id: string | null;
  matrix_id: string | null;
  brief_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  blueprint_id: string;
  version: number;
  snapshot: string;
  change_notes: string | null;
  created_at: string;
}

// ── Lazy prepared statements ──

interface Stmts {
  insertBlueprint: ReturnType<typeof db.prepare>;
  selectBlueprintsByWorkspace: ReturnType<typeof db.prepare>;
  selectBlueprintById: ReturnType<typeof db.prepare>;
  updateBlueprint: ReturnType<typeof db.prepare>;
  deleteBlueprint: ReturnType<typeof db.prepare>;
  insertEntry: ReturnType<typeof db.prepare>;
  selectEntriesByBlueprint: ReturnType<typeof db.prepare>;
  selectEntryById: ReturnType<typeof db.prepare>;
  updateEntry: ReturnType<typeof db.prepare>;
  deleteEntry: ReturnType<typeof db.prepare>;
  reorderEntries: ReturnType<typeof db.prepare>;
  insertVersion: ReturnType<typeof db.prepare>;
  selectVersionsByBlueprint: ReturnType<typeof db.prepare>;
  selectVersionById: ReturnType<typeof db.prepare>;
}

let _stmts: Stmts | null = null;
function stmts(): Stmts {
  if (!_stmts) {
    _stmts = {
      insertBlueprint: db.prepare(
        `INSERT INTO site_blueprints
           (id, workspace_id, name, version, status, brandscript_id, industry_type,
            generation_inputs, notes, created_at, updated_at)
         VALUES
           (@id, @workspace_id, @name, @version, @status, @brandscript_id, @industry_type,
            @generation_inputs, @notes, @created_at, @updated_at)`,
      ),
      selectBlueprintsByWorkspace: db.prepare(
        `SELECT * FROM site_blueprints WHERE workspace_id = ? ORDER BY updated_at DESC`,
      ),
      selectBlueprintById: db.prepare(
        `SELECT * FROM site_blueprints WHERE id = ? AND workspace_id = ?`,
      ),
      updateBlueprint: db.prepare(
        `UPDATE site_blueprints SET
           name = @name, version = @version, status = @status,
           brandscript_id = @brandscript_id, industry_type = @industry_type,
           notes = @notes, updated_at = @updated_at
         WHERE id = @id AND workspace_id = @workspace_id`,
      ),
      deleteBlueprint: db.prepare(
        `DELETE FROM site_blueprints WHERE id = ? AND workspace_id = ?`,
      ),
      insertEntry: db.prepare(
        `INSERT INTO blueprint_entries
           (id, blueprint_id, name, page_type, scope, sort_order, is_collection,
            primary_keyword, secondary_keywords, keyword_source, section_plan,
            template_id, matrix_id, brief_id, notes, created_at, updated_at)
         VALUES
           (@id, @blueprint_id, @name, @page_type, @scope, @sort_order, @is_collection,
            @primary_keyword, @secondary_keywords, @keyword_source, @section_plan,
            @template_id, @matrix_id, @brief_id, @notes, @created_at, @updated_at)`,
      ),
      selectEntriesByBlueprint: db.prepare(
        `SELECT * FROM blueprint_entries WHERE blueprint_id = ? ORDER BY sort_order ASC`,
      ),
      selectEntryById: db.prepare(
        `SELECT * FROM blueprint_entries WHERE id = ? AND blueprint_id = ?`,
      ),
      updateEntry: db.prepare(
        `UPDATE blueprint_entries SET
           name = @name, page_type = @page_type, scope = @scope, sort_order = @sort_order,
           is_collection = @is_collection, primary_keyword = @primary_keyword,
           secondary_keywords = @secondary_keywords, keyword_source = @keyword_source,
           section_plan = @section_plan, template_id = @template_id, matrix_id = @matrix_id,
           brief_id = @brief_id, notes = @notes, updated_at = @updated_at
         WHERE id = @id AND blueprint_id = @blueprint_id`,
      ),
      deleteEntry: db.prepare(
        `DELETE FROM blueprint_entries WHERE id = ? AND blueprint_id = ?`,
      ),
      reorderEntries: db.prepare(
        `UPDATE blueprint_entries SET sort_order = @sort_order, updated_at = @updated_at
         WHERE id = @id AND blueprint_id = @blueprint_id`,
      ),
      insertVersion: db.prepare(
        `INSERT INTO blueprint_versions (id, blueprint_id, version, snapshot, change_notes, created_at)
         VALUES (@id, @blueprint_id, @version, @snapshot, @change_notes, @created_at)`,
      ),
      selectVersionsByBlueprint: db.prepare(
        `SELECT * FROM blueprint_versions WHERE blueprint_id = ? ORDER BY version DESC`,
      ),
      selectVersionById: db.prepare(
        `SELECT * FROM blueprint_versions WHERE id = ? AND blueprint_id = ?`,
      ),
    };
  }
  return _stmts;
}

// ── Row converters ──

function rowToBlueprint(row: BlueprintRow, entries?: BlueprintEntry[]): SiteBlueprint {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    version: row.version,
    status: row.status as BlueprintStatus,
    brandscriptId: row.brandscript_id ?? undefined,
    industryType: row.industry_type ?? undefined,
    generationInputs: row.generation_inputs ? JSON.parse(row.generation_inputs) : undefined,
    notes: row.notes ?? undefined,
    entries,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEntry(row: EntryRow): BlueprintEntry {
  return {
    id: row.id,
    blueprintId: row.blueprint_id,
    name: row.name,
    pageType: row.page_type as BlueprintPageType,
    scope: row.scope as EntryScope,
    sortOrder: row.sort_order,
    isCollection: row.is_collection === 1,
    primaryKeyword: row.primary_keyword ?? undefined,
    secondaryKeywords: row.secondary_keywords ? JSON.parse(row.secondary_keywords) : undefined,
    keywordSource: row.keyword_source as BlueprintEntry['keywordSource'],
    sectionPlan: JSON.parse(row.section_plan) as SectionPlanItem[],
    templateId: row.template_id ?? undefined,
    matrixId: row.matrix_id ?? undefined,
    briefId: row.brief_id ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToVersion(row: VersionRow): BlueprintVersion {
  return {
    id: row.id,
    blueprintId: row.blueprint_id,
    version: row.version,
    snapshot: JSON.parse(row.snapshot),
    changeNotes: row.change_notes ?? undefined,
    createdAt: row.created_at,
  };
}

// ── Blueprint CRUD ──

export function listBlueprints(workspaceId: string): SiteBlueprint[] {
  const rows = stmts().selectBlueprintsByWorkspace.all(workspaceId) as BlueprintRow[];
  return rows.map((r) => rowToBlueprint(r));
}

export function getBlueprint(workspaceId: string, blueprintId: string): SiteBlueprint | null {
  const row = stmts().selectBlueprintById.get(blueprintId, workspaceId) as BlueprintRow | undefined;
  if (!row) return null;
  const entryRows = stmts().selectEntriesByBlueprint.all(blueprintId) as EntryRow[];
  return rowToBlueprint(row, entryRows.map(rowToEntry));
}

export function createBlueprint(
  workspaceId: string,
  data: { name: string; brandscriptId?: string; industryType?: string; notes?: string },
): SiteBlueprint {
  const now = new Date().toISOString();
  const id = randomUUID();
  stmts().insertBlueprint.run({
    id,
    workspace_id: workspaceId,
    name: data.name,
    version: 1,
    status: 'draft',
    brandscript_id: data.brandscriptId ?? null,
    industry_type: data.industryType ?? null,
    generation_inputs: null,
    notes: data.notes ?? null,
    created_at: now,
    updated_at: now,
  });
  return getBlueprint(workspaceId, id)!;
}

export function updateBlueprint(
  workspaceId: string,
  blueprintId: string,
  data: Partial<Pick<SiteBlueprint, 'name' | 'status' | 'brandscriptId' | 'industryType' | 'notes'>>,
): SiteBlueprint | null {
  const existing = getBlueprint(workspaceId, blueprintId);
  if (!existing) return null;
  const now = new Date().toISOString();
  stmts().updateBlueprint.run({
    id: blueprintId,
    workspace_id: workspaceId,
    name: data.name ?? existing.name,
    version: existing.version,
    status: data.status ?? existing.status,
    brandscript_id: data.brandscriptId ?? existing.brandscriptId ?? null,
    industry_type: data.industryType ?? existing.industryType ?? null,
    notes: data.notes ?? existing.notes ?? null,
    updated_at: now,
  });
  return getBlueprint(workspaceId, blueprintId);
}

export function deleteBlueprint(workspaceId: string, blueprintId: string): boolean {
  const result = stmts().deleteBlueprint.run(blueprintId, workspaceId);
  return result.changes > 0;
}

// ── Entry CRUD ──

export function addEntry(
  blueprintId: string,
  data: {
    name: string;
    pageType: BlueprintPageType;
    scope?: EntryScope;
    isCollection?: boolean;
    primaryKeyword?: string;
    secondaryKeywords?: string[];
    keywordSource?: string;
    sectionPlan?: SectionPlanItem[];
    templateId?: string;
    notes?: string;
  },
): BlueprintEntry {
  const now = new Date().toISOString();
  const id = randomUUID();
  // Get current max sort_order
  const entries = stmts().selectEntriesByBlueprint.all(blueprintId) as EntryRow[];
  const maxOrder = entries.length > 0 ? Math.max(...entries.map((e) => e.sort_order)) : -1;

  // SPEC ADDENDUM §6: Section plan item IDs must be stable UUIDs.
  // Generate UUIDs for any section plan items that don't already have one.
  // Phase 3's copy_sections.section_plan_item_id references these — if they change,
  // approved copy becomes orphaned.
  const sectionPlan = (data.sectionPlan ?? []).map((item) => ({
    ...item,
    id: item.id || randomUUID(),
  }));

  stmts().insertEntry.run({
    id,
    blueprint_id: blueprintId,
    name: data.name,
    page_type: data.pageType,
    scope: data.scope ?? 'included',
    sort_order: maxOrder + 1,
    is_collection: data.isCollection ? 1 : 0,
    primary_keyword: data.primaryKeyword ?? null,
    secondary_keywords: data.secondaryKeywords ? JSON.stringify(data.secondaryKeywords) : null,
    keyword_source: data.keywordSource ?? null,
    section_plan: JSON.stringify(sectionPlan),
    template_id: data.templateId ?? null,
    matrix_id: null,
    brief_id: null,
    notes: data.notes ?? null,
    created_at: now,
    updated_at: now,
  });
  return rowToEntry(stmts().selectEntryById.get(id, blueprintId) as EntryRow);
}

export function updateEntry(
  blueprintId: string,
  entryId: string,
  data: Partial<Omit<BlueprintEntry, 'id' | 'blueprintId' | 'createdAt' | 'updatedAt'>>,
): BlueprintEntry | null {
  const row = stmts().selectEntryById.get(entryId, blueprintId) as EntryRow | undefined;
  if (!row) return null;
  const existing = rowToEntry(row);
  const now = new Date().toISOString();

  // SPEC ADDENDUM §6: Preserve existing section plan item IDs on update.
  // Only generate new UUIDs for newly added sections. Never regenerate IDs
  // for existing sections even if their content, order, or type changes.
  let sectionPlan = data.sectionPlan;
  if (sectionPlan) {
    const existingIds = new Set(existing.sectionPlan.map((s) => s.id));
    sectionPlan = sectionPlan.map((item) => ({
      ...item,
      id: item.id && existingIds.has(item.id) ? item.id : item.id || randomUUID(),
    }));
  }

  stmts().updateEntry.run({
    id: entryId,
    blueprint_id: blueprintId,
    name: data.name ?? existing.name,
    page_type: data.pageType ?? existing.pageType,
    scope: data.scope ?? existing.scope,
    sort_order: data.sortOrder ?? existing.sortOrder,
    is_collection: (data.isCollection ?? existing.isCollection) ? 1 : 0,
    primary_keyword: data.primaryKeyword ?? existing.primaryKeyword ?? null,
    secondary_keywords: data.secondaryKeywords
      ? JSON.stringify(data.secondaryKeywords)
      : existing.secondaryKeywords
        ? JSON.stringify(existing.secondaryKeywords)
        : null,
    keyword_source: data.keywordSource ?? existing.keywordSource ?? null,
    section_plan: sectionPlan
      ? JSON.stringify(sectionPlan)
      : JSON.stringify(existing.sectionPlan),
    template_id: data.templateId ?? existing.templateId ?? null,
    matrix_id: data.matrixId ?? existing.matrixId ?? null,
    brief_id: data.briefId ?? existing.briefId ?? null,
    notes: data.notes ?? existing.notes ?? null,
    updated_at: now,
  });
  return rowToEntry(stmts().selectEntryById.get(entryId, blueprintId) as EntryRow);
}

export function removeEntry(blueprintId: string, entryId: string): boolean {
  const result = stmts().deleteEntry.run(entryId, blueprintId);
  return result.changes > 0;
}

export function reorderEntries(
  blueprintId: string,
  orderedIds: string[],
): BlueprintEntry[] {
  const now = new Date().toISOString();
  const reorder = db.transaction(() => {
    orderedIds.forEach((id, index) => {
      stmts().reorderEntries.run({ id, blueprint_id: blueprintId, sort_order: index, updated_at: now });
    });
  });
  reorder();
  const rows = stmts().selectEntriesByBlueprint.all(blueprintId) as EntryRow[];
  return rows.map(rowToEntry);
}

// ── Versioning ──

export function createVersion(
  workspaceId: string,
  blueprintId: string,
  changeNotes?: string,
): BlueprintVersion | null {
  const blueprint = getBlueprint(workspaceId, blueprintId);
  if (!blueprint) return null;

  const now = new Date().toISOString();
  const id = randomUUID();
  const { entries, ...blueprintMeta } = blueprint;

  stmts().insertVersion.run({
    id,
    blueprint_id: blueprintId,
    version: blueprint.version,
    snapshot: JSON.stringify({ blueprint: blueprintMeta, entries: entries ?? [] }),
    change_notes: changeNotes ?? null,
    created_at: now,
  });

  // Increment blueprint version
  stmts().updateBlueprint.run({
    id: blueprintId,
    workspace_id: workspaceId,
    name: blueprint.name,
    version: blueprint.version + 1,
    status: blueprint.status,
    brandscript_id: blueprint.brandscriptId ?? null,
    industry_type: blueprint.industryType ?? null,
    notes: blueprint.notes ?? null,
    updated_at: now,
  });

  return rowToVersion(stmts().selectVersionById.get(id, blueprintId) as VersionRow);
}

export function listVersions(blueprintId: string): BlueprintVersion[] {
  const rows = stmts().selectVersionsByBlueprint.all(blueprintId) as VersionRow[];
  return rows.map(rowToVersion);
}

export function getVersion(blueprintId: string, versionId: string): BlueprintVersion | null {
  const row = stmts().selectVersionById.get(versionId, blueprintId) as VersionRow | undefined;
  return row ? rowToVersion(row) : null;
}

// ── Bulk entry insert (used by generator) ──

export function bulkAddEntries(
  blueprintId: string,
  entries: Array<{
    name: string;
    pageType: BlueprintPageType;
    scope: EntryScope;
    isCollection: boolean;
    primaryKeyword?: string;
    secondaryKeywords?: string[];
    keywordSource?: string;
    sectionPlan: SectionPlanItem[];
  }>,
): BlueprintEntry[] {
  const now = new Date().toISOString();
  const insert = db.transaction(() => {
    entries.forEach((entry, index) => {
      const id = randomUUID();
      const sectionPlanWithIds = entry.sectionPlan.map((s, si) => ({
        ...s,
        id: s.id || randomUUID(),
        order: si,
      }));
      stmts().insertEntry.run({
        id,
        blueprint_id: blueprintId,
        name: entry.name,
        page_type: entry.pageType,
        scope: entry.scope,
        sort_order: index,
        is_collection: entry.isCollection ? 1 : 0,
        primary_keyword: entry.primaryKeyword ?? null,
        secondary_keywords: entry.secondaryKeywords ? JSON.stringify(entry.secondaryKeywords) : null,
        keyword_source: entry.keywordSource ?? null,
        section_plan: JSON.stringify(sectionPlanWithIds),
        template_id: null,
        matrix_id: null,
        notes: null,
        created_at: now,
        updated_at: now,
      });
    });
  });
  insert();
  const rows = stmts().selectEntriesByBlueprint.all(blueprintId) as EntryRow[];
  return rows.map(rowToEntry);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/page-strategy.ts
git commit -m "feat: add page strategy CRUD service with blueprint, entry, and versioning support"
```

---

## Task 4: Blueprint Generator Service

**Files:**
- Create: `server/blueprint-generator.ts`

- [ ] **Step 1: Write the blueprint generator**

```typescript
// server/blueprint-generator.ts
/**
 * Blueprint Generator — AI-powered site blueprint generation.
 *
 * Uses Claude Sonnet 4 for strategic page recommendations and
 * GPT-4.1-mini for keyword clustering/assignment.
 */
import { randomUUID } from 'node:crypto';
import { callAnthropic } from './anthropic-helpers.js';
import { callOpenAI } from './openai-helpers.js';
import { getKeywordOverview, getRelatedKeywords, getDomainOrganicKeywords } from './semrush.js';
import { getBrandscript } from './brandscript.js';
import {
  createBlueprint,
  bulkAddEntries,
  updateBlueprint,
} from './page-strategy.js';
import type {
  SiteBlueprint,
  BlueprintGenerationInput,
  GeneratedBlueprintEntry,
  SectionPlanItem,
  BlueprintPageType,
} from '../shared/types/page-strategy.ts';
import { createLogger } from './logger.js';

const log = createLogger('blueprint-generator');

// ── Default section plans per page type ──

const DEFAULT_SECTION_PLANS: Record<string, Omit<SectionPlanItem, 'id'>[]> = {
  homepage: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Lead with the transformation the customer wants', seoNote: 'Primary keyword in H1', wordCountTarget: 150, order: 0 },
    { sectionType: 'problem', narrativeRole: 'problem', brandNote: 'Name the external and internal problems your customer faces', seoNote: 'Secondary keywords naturally woven in', wordCountTarget: 200, order: 1 },
    { sectionType: 'solution', narrativeRole: 'guide', brandNote: 'Position as the guide — empathy + authority', seoNote: 'Service-related keywords', wordCountTarget: 200, order: 2 },
    { sectionType: 'process', narrativeRole: 'plan', brandNote: 'Show simple steps to engage — make it easy', seoNote: 'How-it-works related terms', wordCountTarget: 150, order: 3 },
    { sectionType: 'social-proof', narrativeRole: 'success-transformation', brandNote: 'Show the transformation through customer stories', seoNote: 'Location + service keywords in testimonial context', wordCountTarget: 200, order: 4 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Clear primary CTA + softer secondary option', seoNote: 'Branded terms', wordCountTarget: 100, order: 5 },
  ],
  service: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Service-specific hook — what transformation does this service deliver', seoNote: 'Primary service keyword in H1', wordCountTarget: 150, order: 0 },
    { sectionType: 'problem', narrativeRole: 'problem', brandNote: 'Pain points specific to this service need', seoNote: 'Problem-aware keywords', wordCountTarget: 200, order: 1 },
    { sectionType: 'features-benefits', narrativeRole: 'guide', brandNote: 'What you offer and why it matters — benefits over features', seoNote: 'Feature and benefit keywords', wordCountTarget: 300, order: 2 },
    { sectionType: 'process', narrativeRole: 'plan', brandNote: 'Step-by-step process for this service', seoNote: 'Process-related long-tail keywords', wordCountTarget: 200, order: 3 },
    { sectionType: 'faq', narrativeRole: 'objection-handling', brandNote: 'Address top objections and questions', seoNote: 'Question keywords — people also ask', wordCountTarget: 300, order: 4 },
    { sectionType: 'social-proof', narrativeRole: 'success-transformation', brandNote: 'Service-specific testimonials or case studies', seoNote: 'Service + location keywords in social proof', wordCountTarget: 200, order: 5 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Service-specific call to action', seoNote: 'Branded + service terms', wordCountTarget: 100, order: 6 },
  ],
  about: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Who are you and why should they trust you', seoNote: 'Brand name + location keywords', wordCountTarget: 150, order: 0 },
    { sectionType: 'content-body', narrativeRole: 'guide', brandNote: 'Origin story — why this business exists', seoNote: 'Brand story keywords', wordCountTarget: 300, order: 1 },
    { sectionType: 'about-team', narrativeRole: 'authority', brandNote: 'Team credentials and personalities', seoNote: 'Team member names + titles for E-E-A-T', wordCountTarget: 200, order: 2 },
    { sectionType: 'social-proof', narrativeRole: 'success-transformation', brandNote: 'Trust signals — awards, certifications, testimonials', seoNote: 'Authority keywords', wordCountTarget: 150, order: 3 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Invite them to take the next step', seoNote: 'Branded terms', wordCountTarget: 100, order: 4 },
  ],
  location: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Location-specific hook — serving this community', seoNote: 'Service + city keyword in H1', wordCountTarget: 150, order: 0 },
    { sectionType: 'features-benefits', narrativeRole: 'guide', brandNote: 'Services available at this location', seoNote: 'Location-specific service keywords', wordCountTarget: 250, order: 1 },
    { sectionType: 'location-info', narrativeRole: 'plan', brandNote: 'Address, hours, directions, parking — make it easy', seoNote: 'NAP consistency, local keywords', wordCountTarget: 150, order: 2 },
    { sectionType: 'social-proof', narrativeRole: 'success-transformation', brandNote: 'Location-specific reviews', seoNote: 'Location + review keywords', wordCountTarget: 200, order: 3 },
    { sectionType: 'faq', narrativeRole: 'objection-handling', brandNote: 'Location-specific FAQs', seoNote: 'Local question keywords', wordCountTarget: 250, order: 4 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Location-specific CTA — book at this location', seoNote: 'Location + action keywords', wordCountTarget: 100, order: 5 },
  ],
  contact: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Welcoming, low-friction — make reaching out feel easy', seoNote: 'Contact + brand keywords', wordCountTarget: 100, order: 0 },
    { sectionType: 'contact-form', narrativeRole: 'call-to-action', brandNote: 'Simple form — name, email, message at minimum', seoNote: 'Contact page structured data', wordCountTarget: 50, order: 1 },
    { sectionType: 'location-info', narrativeRole: 'plan', brandNote: 'Address, phone, email, hours', seoNote: 'NAP consistency', wordCountTarget: 100, order: 2 },
    { sectionType: 'faq', narrativeRole: 'objection-handling', brandNote: 'Quick answers to common questions before they ask', seoNote: 'FAQ schema keywords', wordCountTarget: 200, order: 3 },
  ],
  faq: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Helpful framing — we have answers', seoNote: 'FAQ + brand keywords', wordCountTarget: 100, order: 0 },
    { sectionType: 'faq', narrativeRole: 'objection-handling', brandNote: 'Grouped by topic — address real objections, not just softballs', seoNote: 'Question keywords — people also ask', wordCountTarget: 500, order: 1 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Still have questions? Reach out.', seoNote: 'Contact keywords', wordCountTarget: 100, order: 2 },
  ],
  testimonials: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Social proof headline — real results', seoNote: 'Reviews + brand keywords', wordCountTarget: 100, order: 0 },
    { sectionType: 'testimonials', narrativeRole: 'success-transformation', brandNote: 'Curated testimonials showing diverse transformations', seoNote: 'Service + result keywords in testimonial context', wordCountTarget: 400, order: 1 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Ready to be our next success story?', seoNote: 'Branded CTA terms', wordCountTarget: 100, order: 2 },
  ],
  blog: [
    { sectionType: 'hero', narrativeRole: 'hook', brandNote: 'Article headline and intro — hook the reader', seoNote: 'Primary keyword in H1 and first paragraph', wordCountTarget: 150, order: 0 },
    { sectionType: 'content-body', narrativeRole: 'guide', brandNote: 'Main article content — informative, authoritative, on-brand', seoNote: 'Primary + secondary keywords distributed through headings and body', wordCountTarget: 1200, order: 1 },
    { sectionType: 'related-resources', narrativeRole: 'plan', brandNote: 'Guide them to related content or next steps', seoNote: 'Internal link keywords', wordCountTarget: 100, order: 2 },
    { sectionType: 'cta', narrativeRole: 'call-to-action', brandNote: 'Convert readers to leads', seoNote: 'Branded CTA terms', wordCountTarget: 100, order: 3 },
  ],
};

/** Get default section plan for a page type */
export function getDefaultSectionPlan(pageType: string): SectionPlanItem[] {
  const template = DEFAULT_SECTION_PLANS[pageType] ?? DEFAULT_SECTION_PLANS['service']!;
  return template.map((s, i) => ({ ...s, id: randomUUID(), order: i }));
}

/** Generate a full site blueprint using AI + SEMrush */
export async function generateBlueprint(
  workspaceId: string,
  input: BlueprintGenerationInput,
): Promise<SiteBlueprint> {
  log.info({ workspaceId, input }, 'Generating blueprint');

  // 1. Gather context
  let brandContext = '';
  if (input.brandscriptId) {
    const brandscript = getBrandscript(workspaceId, input.brandscriptId);
    if (brandscript) {
      brandContext = brandscript.sections
        .map((s) => `## ${s.title}\n${s.content ?? '(not yet filled in)'}`)
        .join('\n\n');
    }
  }

  // 2. Gather keyword data from SEMrush (if domain provided)
  let keywordContext = '';
  if (input.domain) {
    try {
      const organicKeywords = await getDomainOrganicKeywords(input.domain, workspaceId, 50);
      if (organicKeywords.length > 0) {
        keywordContext = `\n\nExisting organic keywords for ${input.domain}:\n` +
          organicKeywords.map((k) => `- "${k.keyword}" (vol: ${k.volume}, diff: ${k.difficulty})`).join('\n');
      }
    } catch (err) {
      log.warn({ err }, 'Failed to fetch domain keywords — continuing without');
    }
  }

  // 3. Ask Claude to recommend pages
  const prompt = `You are a web strategist for a design studio. Based on the following business context, recommend a complete list of pages for a new website.

INDUSTRY: ${input.industryType}
${input.targetPageCount ? `TARGET PAGE COUNT: approximately ${input.targetPageCount} pages (client scope)` : ''}
${input.includeLocationPages ? `LOCATIONS: This is a multi-location business with ${input.locationCount ?? 'multiple'} locations. Include location pages.` : ''}
${input.includeContentPages ? 'Include content/blog pages for SEO opportunity.' : ''}

${brandContext ? `BRAND CONTEXT (from discovery):\n${brandContext}` : ''}
${keywordContext}

For each recommended page, provide:
1. name — human-readable page name
2. pageType — one of: homepage, about, contact, faq, testimonials, blog, service, location, product, pillar, resource, pricing-page, custom
3. scope — "included" for essential pages, "recommended" for nice-to-have / upsell opportunities
4. isCollection — true if this is a CMS collection (e.g., individual service pages, blog posts, locations), false for static pages
5. primaryKeyword — suggested primary SEO keyword for this page
6. secondaryKeywords — 2-4 secondary keywords
7. rationale — brief explanation of why this page is recommended

Return ONLY a JSON array of objects with these fields. No markdown, no explanation outside the JSON.`;

  const aiResponse = await callAnthropic({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  let generatedEntries: GeneratedBlueprintEntry[];
  try {
    const text = aiResponse.content[0].type === 'text' ? aiResponse.content[0].text : '';
    // Strip markdown code fences if present
    const jsonStr = text.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    generatedEntries = JSON.parse(jsonStr);
  } catch (err) {
    log.error({ err, aiResponse }, 'Failed to parse AI blueprint response');
    throw new Error('Failed to generate blueprint — AI response was not valid JSON');
  }

  // 4. Create blueprint and add entries
  const blueprint = createBlueprint(workspaceId, {
    name: `${input.industryType} Site Blueprint`,
    brandscriptId: input.brandscriptId,
    industryType: input.industryType,
  });

  // Store generation inputs for reference
  const bpRow = updateBlueprint(workspaceId, blueprint.id, {});

  // 5. Add entries with default section plans
  const entriesToInsert = generatedEntries.map((entry) => ({
    name: entry.name,
    pageType: entry.pageType as BlueprintPageType,
    scope: entry.scope as 'included' | 'recommended',
    isCollection: entry.isCollection,
    primaryKeyword: entry.primaryKeyword,
    secondaryKeywords: entry.secondaryKeywords,
    keywordSource: 'ai_suggested' as const,
    sectionPlan: getDefaultSectionPlan(entry.pageType),
  }));

  bulkAddEntries(blueprint.id, entriesToInsert);

  // 6. Validate keywords via SEMrush (non-blocking enrichment)
  enrichKeywords(workspaceId, blueprint.id, generatedEntries).catch((err) => {
    log.warn({ err, blueprintId: blueprint.id }, 'Keyword enrichment failed — blueprint still usable');
  });

  return getBlueprint(workspaceId, blueprint.id)!;
}

/** Enrich AI-suggested keywords with SEMrush metrics (background) */
async function enrichKeywords(
  workspaceId: string,
  blueprintId: string,
  entries: GeneratedBlueprintEntry[],
): Promise<void> {
  const allKeywords = entries
    .map((e) => e.primaryKeyword)
    .filter((k): k is string => !!k);

  if (allKeywords.length === 0) return;

  try {
    await getKeywordOverview(allKeywords, workspaceId);
    log.info({ blueprintId, count: allKeywords.length }, 'Enriched blueprint keywords with SEMrush data');
  } catch (err) {
    log.warn({ err }, 'SEMrush keyword enrichment failed');
  }
}

// Re-export for convenience
export { getBlueprint } from './page-strategy.js';
```

- [ ] **Step 2: Commit**

```bash
git add server/blueprint-generator.ts
git commit -m "feat: add AI blueprint generator with SEMrush keyword integration"
```

---

## Task 5: API Routes

**Files:**
- Create: `server/routes/page-strategy.ts`

- [ ] **Step 1: Write the route file**

```typescript
// server/routes/page-strategy.ts
/**
 * Page Strategy routes — blueprints, entries, versions, generation.
 */
import { Router } from 'express';
import {
  listBlueprints,
  getBlueprint,
  createBlueprint,
  updateBlueprint,
  deleteBlueprint,
  addEntry,
  updateEntry,
  removeEntry,
  reorderEntries,
  createVersion,
  listVersions,
  getVersion,
} from '../page-strategy.js';
import { generateBlueprint, getDefaultSectionPlan } from '../blueprint-generator.js';
import { requireWorkspaceAccess } from '../auth.js';
import { createLogger } from '../logger.js';

const router = Router();
const log = createLogger('page-strategy-routes');

// ── Blueprints ──

router.get('/api/page-strategy/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const blueprints = listBlueprints(req.params.workspaceId);
  res.json(blueprints);
});

router.get('/api/page-strategy/:workspaceId/:blueprintId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const blueprint = getBlueprint(req.params.workspaceId, req.params.blueprintId);
  if (!blueprint) return res.status(404).json({ error: 'Blueprint not found' });
  res.json(blueprint);
});

router.post('/api/page-strategy/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const { name, brandscriptId, industryType, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const blueprint = createBlueprint(req.params.workspaceId, { name, brandscriptId, industryType, notes });
    res.status(201).json(blueprint);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to create blueprint');
    res.status(500).json({ error: 'Failed to create blueprint' });
  }
});

router.put('/api/page-strategy/:workspaceId/:blueprintId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const updated = updateBlueprint(req.params.workspaceId, req.params.blueprintId, req.body);
    if (!updated) return res.status(404).json({ error: 'Blueprint not found' });
    res.json(updated);
  } catch (err) {
    log.error({ err }, 'Failed to update blueprint');
    res.status(500).json({ error: 'Failed to update blueprint' });
  }
});

router.delete('/api/page-strategy/:workspaceId/:blueprintId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const deleted = deleteBlueprint(req.params.workspaceId, req.params.blueprintId);
  if (!deleted) return res.status(404).json({ error: 'Blueprint not found' });
  res.json({ ok: true });
});

// ── Generation ──

router.post('/api/page-strategy/:workspaceId/generate', requireWorkspaceAccess('workspaceId'), async (req, res) => {
  try {
    const blueprint = await generateBlueprint(req.params.workspaceId, req.body);
    res.status(201).json(blueprint);
  } catch (err) {
    log.error({ err, workspaceId: req.params.workspaceId }, 'Failed to generate blueprint');
    res.status(500).json({ error: 'Failed to generate blueprint' });
  }
});

// ── Entries ──

router.post('/api/page-strategy/:workspaceId/:blueprintId/entries', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const entry = addEntry(req.params.blueprintId, req.body);
    res.status(201).json(entry);
  } catch (err) {
    log.error({ err }, 'Failed to add entry');
    res.status(500).json({ error: 'Failed to add entry' });
  }
});

router.put('/api/page-strategy/:workspaceId/:blueprintId/entries/:entryId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const updated = updateEntry(req.params.blueprintId, req.params.entryId, req.body);
    if (!updated) return res.status(404).json({ error: 'Entry not found' });
    res.json(updated);
  } catch (err) {
    log.error({ err }, 'Failed to update entry');
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

// NOTE: reorder route MUST come before :entryId to avoid param conflict
router.put('/api/page-strategy/:workspaceId/:blueprintId/entries/reorder', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds array required' });
    const entries = reorderEntries(req.params.blueprintId, orderedIds);
    res.json(entries);
  } catch (err) {
    log.error({ err }, 'Failed to reorder entries');
    res.status(500).json({ error: 'Failed to reorder entries' });
  }
});

router.delete('/api/page-strategy/:workspaceId/:blueprintId/entries/:entryId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const deleted = removeEntry(req.params.blueprintId, req.params.entryId);
  if (!deleted) return res.status(404).json({ error: 'Entry not found' });
  res.json({ ok: true });
});

// ── Default section plans ──

router.get('/api/page-strategy/section-plan-defaults/:pageType', (req, res) => {
  const plan = getDefaultSectionPlan(req.params.pageType);
  res.json(plan);
});

// ── Versions ──

router.post('/api/page-strategy/:workspaceId/:blueprintId/versions', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const { changeNotes } = req.body;
    const version = createVersion(req.params.workspaceId, req.params.blueprintId, changeNotes);
    if (!version) return res.status(404).json({ error: 'Blueprint not found' });
    res.status(201).json(version);
  } catch (err) {
    log.error({ err }, 'Failed to create version');
    res.status(500).json({ error: 'Failed to create version' });
  }
});

router.get('/api/page-strategy/:workspaceId/:blueprintId/versions', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const versions = listVersions(req.params.blueprintId);
  res.json(versions);
});

router.get('/api/page-strategy/:workspaceId/:blueprintId/versions/:versionId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const version = getVersion(req.params.blueprintId, req.params.versionId);
  if (!version) return res.status(404).json({ error: 'Version not found' });
  res.json(version);
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/page-strategy.ts
git commit -m "feat: add page strategy API routes"
```

---

## Task 6: Register Routes

**Files:**
- Modify: `server/app.ts`

- [ ] **Step 1: Add import**

Add this import near the other route imports (around line 87 in app.ts, after the `competitorSchemaRoutes` import):

```typescript
import pageStrategyRoutes from './routes/page-strategy.js';
```

- [ ] **Step 2: Mount the route**

Add this line in the route mounting section (around line 316, after `app.use(competitorSchemaRoutes)`):

```typescript
app.use(pageStrategyRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add server/app.ts
git commit -m "feat: register page strategy routes in app.ts"
```

---

## Task 7: Frontend API Client

**Files:**
- Modify: `src/api/brand-engine.ts`

- [ ] **Step 1: Add page strategy API functions**

Add the following to the end of `src/api/brand-engine.ts`, using the same pattern as existing API objects in the file:

```typescript
import type {
  SiteBlueprint,
  BlueprintEntry,
  BlueprintVersion,
  BlueprintGenerationInput,
  SectionPlanItem,
} from '../../shared/types/page-strategy';

// ═══ PAGE STRATEGY ═══

export const blueprints = {
  list: (wsId: string) =>
    get<SiteBlueprint[]>(`/api/page-strategy/${wsId}`),

  getById: (wsId: string, blueprintId: string) =>
    get<SiteBlueprint>(`/api/page-strategy/${wsId}/${blueprintId}`),

  create: (wsId: string, body: { name: string; brandscriptId?: string; industryType?: string; notes?: string }) =>
    post<SiteBlueprint>(`/api/page-strategy/${wsId}`, body),

  update: (wsId: string, blueprintId: string, body: Partial<SiteBlueprint>) =>
    put<SiteBlueprint>(`/api/page-strategy/${wsId}/${blueprintId}`, body),

  remove: (wsId: string, blueprintId: string) =>
    del(`/api/page-strategy/${wsId}/${blueprintId}`),

  generate: (wsId: string, body: BlueprintGenerationInput) =>
    post<SiteBlueprint>(`/api/page-strategy/${wsId}/generate`, body),
};

export const blueprintEntries = {
  add: (wsId: string, blueprintId: string, body: Partial<BlueprintEntry>) =>
    post<BlueprintEntry>(`/api/page-strategy/${wsId}/${blueprintId}/entries`, body),

  update: (wsId: string, blueprintId: string, entryId: string, body: Partial<BlueprintEntry>) =>
    put<BlueprintEntry>(`/api/page-strategy/${wsId}/${blueprintId}/entries/${entryId}`, body),

  remove: (wsId: string, blueprintId: string, entryId: string) =>
    del(`/api/page-strategy/${wsId}/${blueprintId}/entries/${entryId}`),

  reorder: (wsId: string, blueprintId: string, orderedIds: string[]) =>
    put<BlueprintEntry[]>(`/api/page-strategy/${wsId}/${blueprintId}/entries/reorder`, { orderedIds }),

  getDefaultSectionPlan: (pageType: string) =>
    get<SectionPlanItem[]>(`/api/page-strategy/section-plan-defaults/${pageType}`),
};

export const blueprintVersions = {
  list: (wsId: string, blueprintId: string) =>
    get<BlueprintVersion[]>(`/api/page-strategy/${wsId}/${blueprintId}/versions`),

  create: (wsId: string, blueprintId: string, changeNotes?: string) =>
    post<BlueprintVersion>(`/api/page-strategy/${wsId}/${blueprintId}/versions`, { changeNotes }),

  getById: (wsId: string, blueprintId: string, versionId: string) =>
    get<BlueprintVersion>(`/api/page-strategy/${wsId}/${blueprintId}/versions/${versionId}`),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/api/brand-engine.ts
git commit -m "feat: add page strategy frontend API client"
```

---

## Task 8: Blueprint Overview UI

**Files:**
- Create: `src/components/brand/PageStrategyTab.tsx`

- [ ] **Step 1: Write the PageStrategyTab component**

```tsx
// src/components/brand/PageStrategyTab.tsx
/**
 * Page Strategy tab — blueprint list, create, and scope management.
 * Lives inside Brand Hub as a section.
 */
import { useState, useEffect, useCallback } from 'react';
import { Map, Plus, Sparkles, ChevronRight, Trash2, MoreVertical, ArrowUpDown } from 'lucide-react';
import { blueprints } from '../../api/brand-engine';
import type { SiteBlueprint, BlueprintGenerationInput } from '../../../shared/types/page-strategy';
import { useToast } from '../ui/Toasts';

interface Props {
  workspaceId: string;
  onSelectBlueprint: (blueprintId: string) => void;
}

export function PageStrategyTab({ workspaceId, onSelectBlueprint }: Props) {
  const { toast } = useToast();
  const [items, setItems] = useState<SiteBlueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [industryType, setIndustryType] = useState('');

  const loadBlueprints = useCallback(async () => {
    try {
      const data = await blueprints.list(workspaceId);
      setItems(data);
    } catch (err) {
      toast({ title: 'Failed to load blueprints', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [workspaceId, toast]);

  useEffect(() => { loadBlueprints(); }, [loadBlueprints]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const bp = await blueprints.create(workspaceId, { name: newName, industryType: industryType || undefined });
      setItems((prev) => [bp, ...prev]);
      setShowCreateForm(false);
      setNewName('');
      setIndustryType('');
      toast({ title: 'Blueprint created' });
    } catch (err) {
      toast({ title: 'Failed to create blueprint', variant: 'destructive' });
    }
  };

  const handleGenerate = async () => {
    if (!industryType.trim()) {
      toast({ title: 'Industry type is required for generation', variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      const input: BlueprintGenerationInput = {
        industryType,
        includeContentPages: true,
      };
      const bp = await blueprints.generate(workspaceId, input);
      setItems((prev) => [bp, ...prev]);
      setShowCreateForm(false);
      setNewName('');
      setIndustryType('');
      toast({ title: 'Blueprint generated with AI recommendations' });
      onSelectBlueprint(bp.id);
    } catch (err) {
      toast({ title: 'Failed to generate blueprint', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await blueprints.remove(workspaceId, id);
      setItems((prev) => prev.filter((b) => b.id !== id));
      toast({ title: 'Blueprint deleted' });
    } catch (err) {
      toast({ title: 'Failed to delete blueprint', variant: 'destructive' });
    }
  };

  if (loading) {
    return <div className="text-sm text-zinc-500 py-8 text-center">Loading blueprints...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Site Blueprints</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Plan your site's pages, sections, and keyword strategy
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Blueprint
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 space-y-3">
          <input
            type="text"
            placeholder="Blueprint name (e.g., Rinse Dental Site Strategy)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500"
          />
          <input
            type="text"
            placeholder="Industry type (e.g., dental practice, SaaS, restaurant)"
            value={industryType}
            onChange={(e) => setIndustryType(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={!newName.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors disabled:opacity-50"
            >
              Create Empty
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating || !industryType.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 transition-colors disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {generating ? 'Generating...' : 'Generate with AI'}
            </button>
            <button
              onClick={() => { setShowCreateForm(false); setNewName(''); setIndustryType(''); }}
              className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Blueprint list */}
      {items.length === 0 && !showCreateForm ? (
        <div className="text-center py-8 text-zinc-500 text-sm">
          No blueprints yet. Create one to start planning your site strategy.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((bp) => (
            <div
              key={bp.id}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 transition-colors cursor-pointer group"
              onClick={() => onSelectBlueprint(bp.id)}
            >
              <Map className="w-4 h-4 text-teal-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-200 truncate">{bp.name}</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  v{bp.version} · {bp.status} · {bp.industryType ?? 'No industry set'}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(bp.id); }}
                  className="p-1 rounded text-zinc-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <ChevronRight className="w-4 h-4 text-zinc-500" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/brand/PageStrategyTab.tsx
git commit -m "feat: add PageStrategyTab blueprint overview component"
```

---

## Task 9: Blueprint Detail UI

**Files:**
- Create: `src/components/brand/BlueprintDetail.tsx`

- [ ] **Step 1: Write the BlueprintDetail component**

```tsx
// src/components/brand/BlueprintDetail.tsx
/**
 * Blueprint detail view — entry list with section plan editing,
 * keyword display, and scope management.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Plus, GripVertical, ChevronDown, ChevronRight,
  Tag, FileText, Trash2, Check, Star, Layout,
} from 'lucide-react';
import { blueprints, blueprintEntries, blueprintVersions } from '../../api/brand-engine';
import type { SiteBlueprint, BlueprintEntry, SectionPlanItem, BlueprintPageType } from '../../../shared/types/page-strategy';
import { useToast } from '../ui/Toasts';

interface Props {
  workspaceId: string;
  blueprintId: string;
  onBack: () => void;
}

const PAGE_TYPE_LABELS: Record<string, string> = {
  homepage: 'Homepage', about: 'About', contact: 'Contact', faq: 'FAQ',
  testimonials: 'Testimonials', blog: 'Blog', service: 'Service',
  location: 'Location', product: 'Product', pillar: 'Pillar',
  resource: 'Resource', 'pricing-page': 'Pricing', custom: 'Custom',
  'provider-profile': 'Provider Profile', 'procedure-guide': 'Procedure Guide',
  landing: 'Landing Page',
};

export function BlueprintDetail({ workspaceId, blueprintId, onBack }: Props) {
  const { toast } = useToast();
  const [blueprint, setBlueprint] = useState<SiteBlueprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [addingEntry, setAddingEntry] = useState(false);
  const [newEntryName, setNewEntryName] = useState('');
  const [newEntryType, setNewEntryType] = useState<BlueprintPageType>('service');

  const loadBlueprint = useCallback(async () => {
    try {
      const data = await blueprints.getById(workspaceId, blueprintId);
      setBlueprint(data);
    } catch (err) {
      toast({ title: 'Failed to load blueprint', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [workspaceId, blueprintId, toast]);

  useEffect(() => { loadBlueprint(); }, [loadBlueprint]);

  const handleScopeToggle = async (entry: BlueprintEntry) => {
    const newScope = entry.scope === 'included' ? 'recommended' : 'included';
    try {
      await blueprintEntries.update(workspaceId, blueprintId, entry.id, { scope: newScope });
      await loadBlueprint();
    } catch (err) {
      toast({ title: 'Failed to update scope', variant: 'destructive' });
    }
  };

  const handleAddEntry = async () => {
    if (!newEntryName.trim()) return;
    try {
      const defaultPlan = await blueprintEntries.getDefaultSectionPlan(newEntryType);
      await blueprintEntries.add(workspaceId, blueprintId, {
        name: newEntryName,
        pageType: newEntryType,
        sectionPlan: defaultPlan,
      });
      setAddingEntry(false);
      setNewEntryName('');
      await loadBlueprint();
      toast({ title: 'Page added' });
    } catch (err) {
      toast({ title: 'Failed to add page', variant: 'destructive' });
    }
  };

  const handleRemoveEntry = async (entryId: string) => {
    try {
      await blueprintEntries.remove(workspaceId, blueprintId, entryId);
      await loadBlueprint();
      toast({ title: 'Page removed' });
    } catch (err) {
      toast({ title: 'Failed to remove page', variant: 'destructive' });
    }
  };

  const handleSaveVersion = async () => {
    try {
      await blueprintVersions.create(workspaceId, blueprintId, 'Manual save');
      await loadBlueprint();
      toast({ title: `Saved as v${(blueprint?.version ?? 0) + 1}` });
    } catch (err) {
      toast({ title: 'Failed to save version', variant: 'destructive' });
    }
  };

  if (loading || !blueprint) {
    return <div className="text-sm text-zinc-500 py-8 text-center">Loading blueprint...</div>;
  }

  const included = (blueprint.entries ?? []).filter((e) => e.scope === 'included');
  const recommended = (blueprint.entries ?? []).filter((e) => e.scope === 'recommended');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1 rounded hover:bg-zinc-800 transition-colors">
          <ArrowLeft className="w-4 h-4 text-zinc-400" />
        </button>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-zinc-200">{blueprint.name}</h3>
          <p className="text-xs text-zinc-500">
            v{blueprint.version} · {included.length} pages in scope
            {recommended.length > 0 && ` · ${recommended.length} recommended`}
          </p>
        </div>
        <button
          onClick={handleSaveVersion}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
        >
          Save Version
        </button>
      </div>

      {/* Included pages */}
      <div>
        <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          In Scope ({included.length})
        </div>
        <div className="space-y-1">
          {included.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              expanded={expandedEntry === entry.id}
              onToggle={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
              onScopeToggle={() => handleScopeToggle(entry)}
              onRemove={() => handleRemoveEntry(entry.id)}
            />
          ))}
        </div>
      </div>

      {/* Recommended / upsell pages */}
      {recommended.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-amber-400/70 uppercase tracking-wider mb-2">
            Recommended — Upsell Opportunities ({recommended.length})
          </div>
          <div className="space-y-1">
            {recommended.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                expanded={expandedEntry === entry.id}
                onToggle={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                onScopeToggle={() => handleScopeToggle(entry)}
                onRemove={() => handleRemoveEntry(entry.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Add page */}
      {addingEntry ? (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 space-y-2">
          <input
            type="text"
            placeholder="Page name"
            value={newEntryName}
            onChange={(e) => setNewEntryName(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500"
          />
          <select
            value={newEntryType}
            onChange={(e) => setNewEntryType(e.target.value as BlueprintPageType)}
            className="w-full px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200"
          >
            {Object.entries(PAGE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button onClick={handleAddEntry} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/20">
              Add Page
            </button>
            <button onClick={() => setAddingEntry(false)} className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingEntry(true)}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-teal-400 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add page
        </button>
      )}
    </div>
  );
}

// ── Entry Card sub-component ──

function EntryCard({
  entry,
  expanded,
  onToggle,
  onScopeToggle,
  onRemove,
}: {
  entry: BlueprintEntry;
  expanded: boolean;
  onToggle: () => void;
  onScopeToggle: () => void;
  onRemove: () => void;
}) {
  const PAGE_TYPE_LABELS: Record<string, string> = {
    homepage: 'Homepage', about: 'About', contact: 'Contact', faq: 'FAQ',
    testimonials: 'Testimonials', blog: 'Blog', service: 'Service',
    location: 'Location', product: 'Product', pillar: 'Pillar',
    resource: 'Resource', 'pricing-page': 'Pricing', custom: 'Custom',
    'provider-profile': 'Provider', 'procedure-guide': 'Procedure',
    landing: 'Landing',
  };

  return (
    <div className={`rounded-lg border ${entry.scope === 'included' ? 'border-zinc-800' : 'border-amber-900/30'} bg-zinc-900/50`}>
      {/* Header row */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800/50 transition-colors"
        onClick={onToggle}
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
        <Layout className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-sm text-zinc-200 flex-1">{entry.name}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
          {PAGE_TYPE_LABELS[entry.pageType] ?? entry.pageType}
        </span>
        {entry.isCollection && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400">CMS</span>
        )}
        {entry.primaryKeyword && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 flex items-center gap-1">
            <Tag className="w-2.5 h-2.5" /> {entry.primaryKeyword}
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onScopeToggle(); }}
          className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
            entry.scope === 'included'
              ? 'bg-emerald-500/10 text-emerald-400 hover:bg-amber-500/10 hover:text-amber-400'
              : 'bg-amber-500/10 text-amber-400 hover:bg-emerald-500/10 hover:text-emerald-400'
          }`}
          title={entry.scope === 'included' ? 'Move to recommended' : 'Move to in scope'}
        >
          {entry.scope === 'included' ? 'In Scope' : 'Upsell'}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-1 rounded text-zinc-500 hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Expanded section plan */}
      {expanded && (
        <div className="border-t border-zinc-800 px-3 py-2 space-y-1">
          <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Section Plan ({entry.sectionPlan.length} sections)
          </div>
          {entry.sectionPlan.map((section, i) => (
            <div key={section.id} className="flex items-start gap-2 py-1 text-xs">
              <span className="text-zinc-600 w-4 text-right flex-shrink-0">{i + 1}.</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-200 font-medium capitalize">
                    {section.sectionType.replace(/-/g, ' ')}
                  </span>
                  <span className="text-[10px] text-violet-400/70 capitalize">
                    {section.narrativeRole.replace(/-/g, ' ')}
                  </span>
                  <span className="text-[10px] text-zinc-600">{section.wordCountTarget}w</span>
                </div>
                {section.brandNote && (
                  <div className="text-zinc-500 mt-0.5">Brand: {section.brandNote}</div>
                )}
                {section.seoNote && (
                  <div className="text-teal-400/50 mt-0.5">SEO: {section.seoNote}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/brand/BlueprintDetail.tsx
git commit -m "feat: add BlueprintDetail component with entry list and section plan display"
```

---

## Task 10: Version History UI

**Files:**
- Create: `src/components/brand/BlueprintVersionHistory.tsx`

- [ ] **Step 1: Write the version history component**

```tsx
// src/components/brand/BlueprintVersionHistory.tsx
/**
 * Blueprint version history — timeline of saved versions.
 */
import { useState, useEffect, useCallback } from 'react';
import { Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { blueprintVersions } from '../../api/brand-engine';
import type { BlueprintVersion } from '../../../shared/types/page-strategy';
import { useToast } from '../ui/Toasts';

interface Props {
  workspaceId: string;
  blueprintId: string;
}

export function BlueprintVersionHistory({ workspaceId, blueprintId }: Props) {
  const { toast } = useToast();
  const [versions, setVersions] = useState<BlueprintVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    try {
      const data = await blueprintVersions.list(workspaceId, blueprintId);
      setVersions(data);
    } catch (err) {
      toast({ title: 'Failed to load versions', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [workspaceId, blueprintId, toast]);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  if (loading) return <div className="text-xs text-zinc-500 py-4 text-center">Loading history...</div>;
  if (versions.length === 0) return <div className="text-xs text-zinc-500 py-4 text-center">No version history yet.</div>;

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
        Version History
      </div>
      {versions.map((v) => {
        const expanded = expandedVersion === v.id;
        const entryCount = v.snapshot?.entries?.length ?? 0;
        const includedCount = v.snapshot?.entries?.filter((e) => e.scope === 'included').length ?? 0;
        const date = new Date(v.createdAt);
        const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
          ' at ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

        return (
          <div key={v.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50">
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800/50 transition-colors"
              onClick={() => setExpandedVersion(expanded ? null : v.id)}
            >
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-sm text-zinc-200 font-medium">v{v.version}</span>
              <span className="text-xs text-zinc-500 flex-1">{timeStr}</span>
              <span className="text-[10px] text-zinc-500">{includedCount}/{entryCount} pages</span>
              {expanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
            </div>
            {expanded && (
              <div className="border-t border-zinc-800 px-3 py-2 space-y-1">
                {v.changeNotes && (
                  <div className="text-xs text-zinc-400 mb-2">{v.changeNotes}</div>
                )}
                {v.snapshot?.entries?.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 text-xs">
                    <span className={entry.scope === 'included' ? 'text-zinc-300' : 'text-amber-400/70'}>
                      {entry.name}
                    </span>
                    <span className="text-zinc-600">
                      {entry.sectionPlan.length} sections
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/brand/BlueprintVersionHistory.tsx
git commit -m "feat: add BlueprintVersionHistory component"
```

---

## Task 11: Brand Hub Integration

**Files:**
- Modify: `src/components/BrandHub.tsx`

- [ ] **Step 1: Add imports**

Add at the top of BrandHub.tsx with the other imports:

```typescript
import { PageStrategyTab } from './brand/PageStrategyTab';
import { BlueprintDetail } from './brand/BlueprintDetail';
import { BlueprintVersionHistory } from './brand/BlueprintVersionHistory';
```

- [ ] **Step 2: Add state**

Add inside the `BrandHub` component, alongside existing state:

```typescript
const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null);
```

- [ ] **Step 3: Add Page Strategy section**

Add a new section block in the BrandHub JSX, following the existing section pattern (after the last existing section, before the info footer):

```tsx
{/* ═══ PAGE STRATEGY ═══ */}
<section className="rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800">
  <div className="px-5 py-4 flex items-center gap-3 border-b border-zinc-800">
    <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
      <Map className="w-4 h-4 text-teal-400" />
    </div>
    <div className="flex-1">
      <h3 className="text-sm font-semibold text-zinc-200">Page Strategy</h3>
      <p className="text-xs text-zinc-500">Plan your site's pages, sections, and keyword strategy</p>
    </div>
  </div>
  <div className="p-5">
    {selectedBlueprintId ? (
      <div className="space-y-6">
        <BlueprintDetail
          workspaceId={workspaceId}
          blueprintId={selectedBlueprintId}
          onBack={() => setSelectedBlueprintId(null)}
        />
        <BlueprintVersionHistory
          workspaceId={workspaceId}
          blueprintId={selectedBlueprintId}
        />
      </div>
    ) : (
      <PageStrategyTab
        workspaceId={workspaceId}
        onSelectBlueprint={setSelectedBlueprintId}
      />
    )}
  </div>
</section>
```

- [ ] **Step 4: Add Map import**

Ensure `Map` is in the lucide-react import at the top of BrandHub.tsx:

```typescript
import { Sparkles, MessageSquare, BookOpen, Users, Map } from 'lucide-react';
```

- [ ] **Step 5: Commit**

```bash
git add src/components/BrandHub.tsx
git commit -m "feat: integrate Page Strategy section into Brand Hub"
```

---

## Task 12: Extend Content Template Sections

**Files:**
- Modify: `server/content-templates.ts`

- [ ] **Step 1: Update the rowToTemplate converter**

The `TemplateSection` type already has the new optional fields from Task 2. The existing `sections` JSON column in SQLite will automatically support the new fields since they're optional — older templates just won't have them. No migration needed.

Verify the `rowToTemplate` function in `server/content-templates.ts` already parses `sections` as `TemplateSection[]` without filtering fields. It should — the existing code does `JSON.parse(row.sections) as TemplateSection[]` which passes through all fields.

No code change needed — just verify this works by checking that creating a template with the new fields round-trips correctly.

- [ ] **Step 2: Commit (skip if no changes needed)**

If no code changes were needed, skip this commit.

---

## Task 13: Final Verification

- [ ] **Step 1: Start the dev server**

Run: `cd /Users/joshuahampson/CascadeProjects/asset-dashboard && npm run dev`
Expected: Server starts without errors, migration 027 runs successfully.

- [ ] **Step 2: Test blueprint CRUD via API**

```bash
# Create a blueprint
curl -X POST http://localhost:3000/api/page-strategy/YOUR_WORKSPACE_ID \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Blueprint", "industryType": "dental practice"}'

# List blueprints
curl http://localhost:3000/api/page-strategy/YOUR_WORKSPACE_ID

# Get default section plan
curl http://localhost:3000/api/page-strategy/section-plan-defaults/service
```

Expected: 201 response with blueprint JSON, 200 with array, 200 with section plan array.

- [ ] **Step 3: Verify UI renders**

Navigate to the Brand Hub page in the browser. The Page Strategy section should appear with the "New Blueprint" button.

- [ ] **Step 4: Final commit (if any adjustments needed)**

```bash
git add -A
git commit -m "fix: address any issues found during verification"
```
