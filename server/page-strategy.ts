// server/page-strategy.ts
/**
 * Page Strategy — CRUD for site blueprints, blueprint entries, and versioning.
 */
import { randomUUID } from 'node:crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import type {
  SiteBlueprint,
  BlueprintEntry,
  BlueprintVersion,
  BlueprintStatus,
  SectionPlanItem,
  BlueprintGenerationInput,
  GeneratedBlueprintEntry,
} from '../shared/types/page-strategy.js';
import type { ContentPageType } from '../shared/types/content.js';
import type { EntryScope } from '../shared/types/page-strategy.js';
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
  generation_inputs_json: string | null;
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
  secondary_keywords_json: string | null;
  keyword_source: string | null;
  section_plan_json: string;
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
  snapshot_json: string;
  change_notes: string | null;
  created_at: string;
}

// ── Lazy prepared statements ──

const stmts = createStmtCache(() => ({
  // Blueprint statements
  listBlueprints: db.prepare(`
    SELECT * FROM site_blueprints WHERE workspace_id = ? ORDER BY updated_at DESC
  `),
  getBlueprint: db.prepare(`
    SELECT * FROM site_blueprints WHERE id = ? AND workspace_id = ?
  `),
  insertBlueprint: db.prepare(`
    INSERT INTO site_blueprints (
      id, workspace_id, name, version, status,
      brandscript_id, industry_type, generation_inputs_json, notes,
      created_at, updated_at
    ) VALUES (
      @id, @workspace_id, @name, @version, @status,
      @brandscript_id, @industry_type, @generation_inputs_json, @notes,
      @created_at, @updated_at
    )
  `),
  updateBlueprint: db.prepare(`
    UPDATE site_blueprints
    SET name = @name, status = @status, brandscript_id = @brandscript_id,
        industry_type = @industry_type, generation_inputs_json = @generation_inputs_json,
        notes = @notes, updated_at = @updated_at
    WHERE id = @id AND workspace_id = @workspace_id
  `),
  // ws-scope-ok: caller (createVersion) verifies workspace ownership via getBlueprint(workspaceId, blueprintId) before this runs
  bumpBlueprintVersion: db.prepare(`
    UPDATE site_blueprints SET version = version + 1, updated_at = ? WHERE id = ?
  `),
  deleteBlueprint: db.prepare(`
    DELETE FROM site_blueprints WHERE id = ? AND workspace_id = ?
  `),

  // Entry statements
  listEntries: db.prepare(`
    SELECT * FROM blueprint_entries WHERE blueprint_id = ? ORDER BY sort_order ASC
  `),
  getEntry: db.prepare(`
    SELECT * FROM blueprint_entries WHERE id = ? AND blueprint_id = ?
  `),
  insertEntry: db.prepare(`
    INSERT INTO blueprint_entries (
      id, blueprint_id, name, page_type, scope, sort_order, is_collection,
      primary_keyword, secondary_keywords_json, keyword_source,
      section_plan_json, template_id, matrix_id, brief_id, notes,
      created_at, updated_at
    ) VALUES (
      @id, @blueprint_id, @name, @page_type, @scope, @sort_order, @is_collection,
      @primary_keyword, @secondary_keywords_json, @keyword_source,
      @section_plan_json, @template_id, @matrix_id, @brief_id, @notes,
      @created_at, @updated_at
    )
  `),
  updateEntry: db.prepare(`
    UPDATE blueprint_entries
    SET name = @name, page_type = @page_type, scope = @scope,
        sort_order = @sort_order, is_collection = @is_collection,
        primary_keyword = @primary_keyword,
        secondary_keywords_json = @secondary_keywords_json,
        keyword_source = @keyword_source,
        section_plan_json = @section_plan_json,
        template_id = @template_id, matrix_id = @matrix_id,
        brief_id = @brief_id, notes = @notes, updated_at = @updated_at
    WHERE id = @id AND blueprint_id = @blueprint_id
  `),
  updateEntryOrder: db.prepare(`
    UPDATE blueprint_entries SET sort_order = @sort_order WHERE id = @id AND blueprint_id = @blueprint_id
  `),
  deleteEntry: db.prepare(`
    DELETE FROM blueprint_entries WHERE id = ? AND blueprint_id = ?
  `),
  deleteEntriesByBlueprint: db.prepare(`
    DELETE FROM blueprint_entries WHERE blueprint_id = ?
  `),
  maxSortOrder: db.prepare(`
    SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM blueprint_entries WHERE blueprint_id = ?
  `),

  // Version statements
  listVersions: db.prepare(`
    SELECT * FROM blueprint_versions WHERE blueprint_id = ? ORDER BY version DESC
  `),
  getVersion: db.prepare(`
    SELECT * FROM blueprint_versions WHERE id = ? AND blueprint_id = ?
  `),
  insertVersion: db.prepare(`
    INSERT INTO blueprint_versions (
      id, blueprint_id, version, snapshot_json, change_notes, created_at
    ) VALUES (
      @id, @blueprint_id, @version, @snapshot_json, @change_notes, @created_at
    )
  `),
}));

// ── Row converters ──

function rowToBlueprint(row: BlueprintRow): Omit<SiteBlueprint, 'entries'> {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    version: row.version,
    status: row.status as BlueprintStatus,
    brandscriptId: row.brandscript_id ?? undefined,
    industryType: row.industry_type ?? undefined,
    generationInputs: parseJsonFallback<BlueprintGenerationInput | undefined>(
      row.generation_inputs_json,
      undefined,
    ),
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEntry(row: EntryRow): BlueprintEntry {
  return {
    id: row.id,
    blueprintId: row.blueprint_id,
    name: row.name,
    pageType: row.page_type as ContentPageType,
    scope: row.scope as EntryScope,
    sortOrder: row.sort_order,
    isCollection: row.is_collection === 1,
    primaryKeyword: row.primary_keyword ?? undefined,
    secondaryKeywords: parseJsonFallback<string[] | undefined>(
      row.secondary_keywords_json,
      undefined,
    ),
    keywordSource: row.keyword_source as BlueprintEntry['keywordSource'] ?? undefined,
    sectionPlan: parseJsonFallback<SectionPlanItem[]>(
      row.section_plan_json,
      [],
    ),
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
    snapshot: parseJsonFallback<BlueprintVersion['snapshot']>(
      row.snapshot_json,
      { blueprint: {} as Omit<SiteBlueprint, 'entries'>, entries: [] },
    ),
    changeNotes: row.change_notes ?? undefined,
    createdAt: row.created_at,
  };
}

// ── Blueprint CRUD ──

export function listBlueprints(workspaceId: string): SiteBlueprint[] {
  const rows = stmts().listBlueprints.all(workspaceId) as BlueprintRow[];
  return rows.map(row => {
    const base = rowToBlueprint(row);
    const entryRows = stmts().listEntries.all(row.id) as EntryRow[];
    return { ...base, entries: entryRows.map(rowToEntry) };
  });
}

export function getBlueprint(workspaceId: string, id: string): SiteBlueprint | null {
  const row = stmts().getBlueprint.get(id, workspaceId) as BlueprintRow | undefined;
  if (!row) return null;
  const base = rowToBlueprint(row);
  const entryRows = stmts().listEntries.all(id) as EntryRow[];
  return { ...base, entries: entryRows.map(rowToEntry) };
}

export interface CreateBlueprintInput {
  workspaceId: string;
  name: string;
  status?: BlueprintStatus;
  brandscriptId?: string;
  industryType?: string;
  generationInputs?: BlueprintGenerationInput;
  notes?: string;
}

export function createBlueprint(input: CreateBlueprintInput): SiteBlueprint {
  const now = new Date().toISOString();
  const id = randomUUID();
  stmts().insertBlueprint.run({
    id,
    workspace_id: input.workspaceId,
    name: input.name,
    version: 1,
    status: input.status ?? 'draft',
    brandscript_id: input.brandscriptId ?? null,
    industry_type: input.industryType ?? null,
    generation_inputs_json: input.generationInputs ? JSON.stringify(input.generationInputs) : null,
    notes: input.notes ?? null,
    created_at: now,
    updated_at: now,
  });
  log.info({ id, workspaceId: input.workspaceId }, 'Blueprint created');
  return { id, workspaceId: input.workspaceId, name: input.name, version: 1, status: input.status ?? 'draft', brandscriptId: input.brandscriptId, industryType: input.industryType, generationInputs: input.generationInputs, notes: input.notes, entries: [], createdAt: now, updatedAt: now };
}

export interface UpdateBlueprintInput {
  name?: string;
  status?: BlueprintStatus;
  brandscriptId?: string | null;
  industryType?: string | null;
  generationInputs?: BlueprintGenerationInput | null;
  notes?: string | null;
}

export function updateBlueprint(
  workspaceId: string,
  id: string,
  input: UpdateBlueprintInput,
): SiteBlueprint | null {
  const existing = getBlueprint(workspaceId, id);
  if (!existing) return null;
  const now = new Date().toISOString();
  stmts().updateBlueprint.run({
    id,
    workspace_id: workspaceId,
    name: input.name ?? existing.name,
    status: input.status ?? existing.status,
    brandscript_id: 'brandscriptId' in input ? (input.brandscriptId ?? null) : (existing.brandscriptId ?? null),
    industry_type: 'industryType' in input ? (input.industryType ?? null) : (existing.industryType ?? null),
    generation_inputs_json: 'generationInputs' in input
      ? (input.generationInputs ? JSON.stringify(input.generationInputs) : null)
      : (existing.generationInputs ? JSON.stringify(existing.generationInputs) : null),
    notes: 'notes' in input ? (input.notes ?? null) : (existing.notes ?? null),
    updated_at: now,
  });
  log.info({ id, workspaceId }, 'Blueprint updated');
  return getBlueprint(workspaceId, id);
}

export function deleteBlueprint(workspaceId: string, id: string): boolean {
  const row = stmts().getBlueprint.get(id, workspaceId) as BlueprintRow | undefined;
  if (!row) return false;
  // Delete entries first (FK cascade may handle this, but be explicit)
  stmts().deleteEntriesByBlueprint.run(id);
  const result = stmts().deleteBlueprint.run(id, workspaceId);
  log.info({ id, workspaceId }, 'Blueprint deleted');
  return result.changes > 0;
}

// ── Entry CRUD ──

export interface AddEntryInput {
  name: string;
  pageType: ContentPageType;
  scope?: EntryScope;
  isCollection?: boolean;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  keywordSource?: BlueprintEntry['keywordSource'];
  sectionPlan?: SectionPlanItem[];
  templateId?: string;
  matrixId?: string;
  notes?: string;
}

export function addEntry(
  workspaceId: string,
  blueprintId: string,
  input: AddEntryInput,
): BlueprintEntry | null {
  const blueprintRow = stmts().getBlueprint.get(blueprintId, workspaceId) as BlueprintRow | undefined;
  if (!blueprintRow) return null;

  const now = new Date().toISOString();
  const id = randomUUID();
  const maxRow = stmts().maxSortOrder.get(blueprintId) as { max_order: number };
  const sortOrder = maxRow.max_order + 1;

  stmts().insertEntry.run({
    id,
    blueprint_id: blueprintId,
    name: input.name,
    page_type: input.pageType,
    scope: input.scope ?? 'included',
    sort_order: sortOrder,
    is_collection: input.isCollection ? 1 : 0,
    primary_keyword: input.primaryKeyword ?? null,
    secondary_keywords_json: input.secondaryKeywords ? JSON.stringify(input.secondaryKeywords) : null,
    keyword_source: input.keywordSource ?? null,
    section_plan_json: JSON.stringify(input.sectionPlan ?? []),
    template_id: input.templateId ?? null,
    matrix_id: input.matrixId ?? null,
    brief_id: null,
    notes: input.notes ?? null,
    created_at: now,
    updated_at: now,
  });

  log.info({ id, blueprintId }, 'Blueprint entry added');
  const row = stmts().getEntry.get(id, blueprintId) as EntryRow;
  return rowToEntry(row);
}

export interface UpdateEntryInput {
  name?: string;
  pageType?: ContentPageType;
  scope?: EntryScope;
  isCollection?: boolean;
  primaryKeyword?: string | null;
  secondaryKeywords?: string[] | null;
  keywordSource?: BlueprintEntry['keywordSource'] | null;
  sectionPlan?: SectionPlanItem[];
  templateId?: string | null;
  matrixId?: string | null;
  briefId?: string | null;
  notes?: string | null;
}

export function updateEntry(
  workspaceId: string,
  blueprintId: string,
  entryId: string,
  input: UpdateEntryInput,
): BlueprintEntry | null {
  // Verify blueprint belongs to workspace
  const blueprintRow = stmts().getBlueprint.get(blueprintId, workspaceId) as BlueprintRow | undefined;
  if (!blueprintRow) return null;

  const existing = stmts().getEntry.get(entryId, blueprintId) as EntryRow | undefined;
  if (!existing) return null;

  const now = new Date().toISOString();
  stmts().updateEntry.run({
    id: entryId,
    blueprint_id: blueprintId,
    name: input.name ?? existing.name,
    page_type: input.pageType ?? existing.page_type,
    scope: input.scope ?? existing.scope,
    sort_order: existing.sort_order,
    is_collection: input.isCollection !== undefined ? (input.isCollection ? 1 : 0) : existing.is_collection,
    primary_keyword: 'primaryKeyword' in input ? (input.primaryKeyword ?? null) : existing.primary_keyword,
    secondary_keywords_json: 'secondaryKeywords' in input
      ? (input.secondaryKeywords ? JSON.stringify(input.secondaryKeywords) : null)
      : existing.secondary_keywords_json,
    keyword_source: 'keywordSource' in input ? (input.keywordSource ?? null) : existing.keyword_source,
    section_plan_json: input.sectionPlan ? JSON.stringify(input.sectionPlan) : existing.section_plan_json,
    template_id: 'templateId' in input ? (input.templateId ?? null) : existing.template_id,
    matrix_id: 'matrixId' in input ? (input.matrixId ?? null) : existing.matrix_id,
    brief_id: 'briefId' in input ? (input.briefId ?? null) : existing.brief_id,
    notes: 'notes' in input ? (input.notes ?? null) : existing.notes,
    updated_at: now,
  });

  log.info({ entryId, blueprintId }, 'Blueprint entry updated');
  const updated = stmts().getEntry.get(entryId, blueprintId) as EntryRow;
  return rowToEntry(updated);
}

export function removeEntry(
  workspaceId: string,
  blueprintId: string,
  entryId: string,
): boolean {
  const blueprintRow = stmts().getBlueprint.get(blueprintId, workspaceId) as BlueprintRow | undefined;
  if (!blueprintRow) return false;

  const result = stmts().deleteEntry.run(entryId, blueprintId);
  if (result.changes > 0) {
    log.info({ entryId, blueprintId }, 'Blueprint entry removed');
  }
  return result.changes > 0;
}

/**
 * Reorder entries within a blueprint.
 * orderedIds: array of entry IDs in desired order (all must belong to this blueprint).
 * NOTE: The /reorder route must be registered BEFORE /:entryId routes in the Express
 * router to avoid "reorder" being interpreted as an entryId param.
 */
export function reorderEntries(
  workspaceId: string,
  blueprintId: string,
  orderedIds: string[],
): boolean {
  const blueprintRow = stmts().getBlueprint.get(blueprintId, workspaceId) as BlueprintRow | undefined;
  if (!blueprintRow) return false;

  const reorderTx = db.transaction((ids: string[]) => {
    ids.forEach((id, index) => {
      stmts().updateEntryOrder.run({ id, blueprint_id: blueprintId, sort_order: index + 1 });
    });
  });

  reorderTx(orderedIds);
  log.info({ blueprintId, count: orderedIds.length }, 'Blueprint entries reordered');
  return true;
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
  const { entries, ...blueprintBase } = blueprint;

  const snapshot: BlueprintVersion['snapshot'] = {
    blueprint: blueprintBase,
    entries: entries ?? [],
  };

  stmts().insertVersion.run({
    id,
    blueprint_id: blueprintId,
    version: blueprint.version,
    snapshot_json: JSON.stringify(snapshot),
    change_notes: changeNotes ?? null,
    created_at: now,
  });

  // Bump the blueprint version number
  stmts().bumpBlueprintVersion.run(now, blueprintId);

  log.info({ id, blueprintId, version: blueprint.version }, 'Blueprint version created');
  return {
    id,
    blueprintId,
    version: blueprint.version,
    snapshot,
    changeNotes: changeNotes ?? undefined,
    createdAt: now,
  };
}

export function listVersions(workspaceId: string, blueprintId: string): BlueprintVersion[] {
  const blueprintRow = stmts().getBlueprint.get(blueprintId, workspaceId) as BlueprintRow | undefined;
  if (!blueprintRow) return [];

  const rows = stmts().listVersions.all(blueprintId) as VersionRow[];
  return rows.map(rowToVersion);
}

export function getVersion(
  workspaceId: string,
  blueprintId: string,
  versionId: string,
): BlueprintVersion | null {
  const blueprintRow = stmts().getBlueprint.get(blueprintId, workspaceId) as BlueprintRow | undefined;
  if (!blueprintRow) return null;

  const row = stmts().getVersion.get(versionId, blueprintId) as VersionRow | undefined;
  if (!row) return null;
  return rowToVersion(row);
}

// ── Bulk operations (used by generator) ──

/**
 * Insert multiple entries at once inside a single transaction for atomicity.
 * Assigns sort_order starting after any existing entries.
 */
export function bulkAddEntries(
  workspaceId: string,
  blueprintId: string,
  entries: GeneratedBlueprintEntry[],
): BlueprintEntry[] {
  const blueprintRow = stmts().getBlueprint.get(blueprintId, workspaceId) as BlueprintRow | undefined;
  if (!blueprintRow) return [];

  const maxRow = stmts().maxSortOrder.get(blueprintId) as { max_order: number };
  let sortOrder = maxRow.max_order;

  const now = new Date().toISOString();
  const inserted: BlueprintEntry[] = [];

  const bulkTx = db.transaction((items: GeneratedBlueprintEntry[]) => {
    for (const item of items) {
      sortOrder += 1;
      const id = randomUUID();
      // Assign IDs to section plan items
      const sectionPlan: SectionPlanItem[] = item.sectionPlan.map((s, i) => ({
        ...s,
        id: randomUUID(),
        order: i + 1,
      }));

      stmts().insertEntry.run({
        id,
        blueprint_id: blueprintId,
        name: item.name,
        page_type: item.pageType,
        scope: item.scope,
        sort_order: sortOrder,
        is_collection: item.isCollection ? 1 : 0,
        primary_keyword: item.primaryKeyword ?? null,
        secondary_keywords_json: item.secondaryKeywords ? JSON.stringify(item.secondaryKeywords) : null,
        keyword_source: 'ai_suggested',
        section_plan_json: JSON.stringify(sectionPlan),
        template_id: null,
        matrix_id: null,
        brief_id: null,
        notes: item.rationale ?? null,
        created_at: now,
        updated_at: now,
      });

      inserted.push({
        id,
        blueprintId,
        name: item.name,
        pageType: item.pageType,
        scope: item.scope,
        sortOrder,
        isCollection: item.isCollection,
        primaryKeyword: item.primaryKeyword,
        secondaryKeywords: item.secondaryKeywords,
        keywordSource: 'ai_suggested',
        sectionPlan,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  bulkTx(entries);
  log.info({ blueprintId, count: inserted.length }, 'Bulk entries added');
  return inserted;
}
