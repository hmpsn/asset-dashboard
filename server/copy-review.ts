// server/copy-review.ts
// CRUD service for copy sections, metadata, and status management.

import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { steeringEntrySchema, clientSuggestionSchema, qualityFlagSchema } from './schemas/copy-pipeline.js';
import { createLogger } from './logger.js';
import type {
  CopySection,
  CopyMetadata,
  CopySectionStatus,
  SteeringEntry,
  ClientSuggestion,
  QualityFlag,
  EntryCopyStatus,
} from '../shared/types/copy-pipeline.js';
import type { SectionPlanItem } from '../shared/types/page-strategy.js';

const log = createLogger('copy-review');

// ── SQLite row shapes ──

interface CopySectionRow {
  id: string;
  workspace_id: string;
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
  workspace_id: string;
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

// ── Prepared statements ──

const stmts = createStmtCache(() => ({
  // copy_sections
  insertSection: db.prepare(
    `INSERT INTO copy_sections (id, workspace_id, entry_id, section_plan_item_id, generated_copy, status, ai_annotation, ai_reasoning, steering_history, client_suggestions, quality_flags, version, created_at, updated_at)
     VALUES (@id, @workspace_id, @entry_id, @section_plan_item_id, @generated_copy, @status, @ai_annotation, @ai_reasoning, @steering_history, @client_suggestions, @quality_flags, @version, @created_at, @updated_at)`,
  ),
  selectSectionsByEntry: db.prepare(
    `SELECT * FROM copy_sections WHERE entry_id = ? ORDER BY rowid ASC`,
  ),
  selectSectionById: db.prepare(
    `SELECT * FROM copy_sections WHERE id = ?`,
  ),
  deleteSectionsByEntry: db.prepare(
    `DELETE FROM copy_sections WHERE entry_id = ? AND workspace_id = ?`,
  ),
  updateSectionCopy: db.prepare(
    `UPDATE copy_sections
     SET generated_copy = @generated_copy, ai_annotation = @ai_annotation, ai_reasoning = @ai_reasoning, quality_flags = @quality_flags, status = @status, version = @version, updated_at = @updated_at
     WHERE id = @id AND workspace_id = @workspace_id`,
  ),
  updateSectionStatus: db.prepare(
    `UPDATE copy_sections
     SET status = @status, updated_at = @updated_at -- status-ok: validated by isValidTransition() before run()
     WHERE id = @id AND workspace_id = @workspace_id`,
  ),
  updateSectionSteering: db.prepare(
    `UPDATE copy_sections
     SET steering_history = @steering_history, updated_at = @updated_at
     WHERE id = @id AND workspace_id = @workspace_id`,
  ),
  updateSectionClientSuggestions: db.prepare(
    `UPDATE copy_sections
     SET client_suggestions = @client_suggestions, status = @status, updated_at = @updated_at
     WHERE id = @id AND workspace_id = @workspace_id`,
  ),
  updateSectionText: db.prepare(
    `UPDATE copy_sections
     SET generated_copy = @generated_copy, status = @status, version = @version, updated_at = @updated_at
     WHERE id = @id AND workspace_id = @workspace_id`,
  ),

  // copy_metadata
  upsertMetadata: db.prepare(
    `INSERT INTO copy_metadata (id, workspace_id, entry_id, seo_title, meta_description, og_title, og_description, status, steering_history, created_at, updated_at)
     VALUES (@id, @workspace_id, @entry_id, @seo_title, @meta_description, @og_title, @og_description, 'pending', '[]', @created_at, @updated_at)
     ON CONFLICT(entry_id) DO UPDATE SET
       seo_title = excluded.seo_title,
       meta_description = excluded.meta_description,
       og_title = excluded.og_title,
       og_description = excluded.og_description,
       updated_at = excluded.updated_at`,
  ),
  selectMetadataByEntry: db.prepare(
    `SELECT * FROM copy_metadata WHERE entry_id = ?`,
  ),
}));

// ── Row mappers ──

function rowToSection(row: CopySectionRow): CopySection {
  const r = row;
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    entryId: r.entry_id,
    sectionPlanItemId: r.section_plan_item_id,
    generatedCopy: r.generated_copy,
    status: r.status as CopySectionStatus,
    aiAnnotation: r.ai_annotation,
    aiReasoning: r.ai_reasoning,
    steeringHistory: parseJsonSafeArray(r.steering_history, steeringEntrySchema, { table: 'copy_sections', field: 'steering_history' }),
    clientSuggestions: r.client_suggestions != null
      ? parseJsonSafeArray(r.client_suggestions, clientSuggestionSchema, { table: 'copy_sections', field: 'client_suggestions' })
      : null,
    qualityFlags: r.quality_flags != null
      ? parseJsonSafeArray(r.quality_flags, qualityFlagSchema, { table: 'copy_sections', field: 'quality_flags' })
      : null,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToMetadata(row: CopyMetadataRow): CopyMetadata {
  const r = row;
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    entryId: r.entry_id,
    seoTitle: r.seo_title,
    metaDescription: r.meta_description,
    ogTitle: r.og_title,
    ogDescription: r.og_description,
    status: r.status as CopySectionStatus,
    steeringHistory: parseJsonSafeArray(r.steering_history, steeringEntrySchema, { table: 'copy_metadata', field: 'steering_history' }),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Status transition validation ──

const VALID_TRANSITIONS: Record<CopySectionStatus, CopySectionStatus[]> = {
  pending: ['draft'],
  draft: ['client_review', 'approved'],
  client_review: ['approved', 'revision_requested'],
  revision_requested: ['draft'],
  approved: [],
};

function isValidTransition(from: CopySectionStatus, to: CopySectionStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Section CRUD ──

export function getSectionsForEntry(entryId: string): CopySection[] {
  const rows = stmts().selectSectionsByEntry.all(entryId) as CopySectionRow[];
  return rows.map(r => rowToSection(r));
}

export function getSection(sectionId: string): CopySection | null {
  const row = stmts().selectSectionById.get(sectionId) as CopySectionRow | undefined;
  if (!row) return null;
  return rowToSection(row);
}

// Initialize sections from section plan (delete-then-insert in transaction)
export function initializeSections(
  workspaceId: string,
  entryId: string,
  sectionPlan: SectionPlanItem[],
): CopySection[] {
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    stmts().deleteSectionsByEntry.run(entryId, workspaceId);

    const sections: CopySection[] = [];
    for (const item of sectionPlan) {
      const id = `cs_${randomUUID().slice(0, 8)}`;
      stmts().insertSection.run({
        id,
        workspace_id: workspaceId,
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
      sections.push({
        id,
        workspaceId,
        entryId,
        sectionPlanItemId: item.id,
        generatedCopy: null,
        status: 'pending',
        aiAnnotation: null,
        aiReasoning: null,
        steeringHistory: [],
        clientSuggestions: null,
        qualityFlags: null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    return sections;
  });

  return run();
}

// Save AI-generated copy (sets status to 'draft', increments version)
export function saveGeneratedCopy(
  sectionId: string,
  workspaceId: string,
  data: { generatedCopy: string; aiAnnotation: string; aiReasoning: string; qualityFlags?: QualityFlag[] },
): CopySection | null {
  const existing = getSection(sectionId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'saveGeneratedCopy: section not found');
    return null;
  }
  if (existing.workspaceId !== workspaceId) {
    log.warn({ sectionId, workspaceId }, 'saveGeneratedCopy: workspace mismatch');
    return null;
  }

  // pending → draft (or re-generation: draft/revision_requested → draft)
  const targetStatus: CopySectionStatus = 'draft';
  if (!isValidTransition(existing.status, targetStatus) && existing.status !== 'draft' && existing.status !== 'revision_requested') {
    log.warn({ sectionId, currentStatus: existing.status }, 'saveGeneratedCopy: invalid status transition');
    return null;
  }

  const now = new Date().toISOString();
  const newVersion = existing.version + 1;

  stmts().updateSectionCopy.run({
    id: sectionId,
    workspace_id: workspaceId,
    generated_copy: data.generatedCopy,
    ai_annotation: data.aiAnnotation,
    ai_reasoning: data.aiReasoning,
    quality_flags: data.qualityFlags ? JSON.stringify(data.qualityFlags) : null,
    status: 'draft',
    version: newVersion,
    updated_at: now,
  });

  return getSection(sectionId);
}

// Status management
export function updateSectionStatus(
  sectionId: string,
  workspaceId: string,
  status: CopySectionStatus,
): CopySection | null {
  const existing = getSection(sectionId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'updateSectionStatus: section not found');
    return null;
  }
  if (existing.workspaceId !== workspaceId) {
    log.warn({ sectionId, workspaceId }, 'updateSectionStatus: workspace mismatch');
    return null;
  }
  if (!isValidTransition(existing.status, status)) {
    log.warn({ sectionId, from: existing.status, to: status }, 'updateSectionStatus: invalid status transition');
    return null;
  }

  const now = new Date().toISOString();
  stmts().updateSectionStatus.run({
    id: sectionId,
    workspace_id: workspaceId,
    status,
    updated_at: now,
  });

  return getSection(sectionId);
}

// Steering (appends to steering_history JSON array)
export function addSteeringEntry(
  sectionId: string,
  workspaceId: string,
  entry: Omit<SteeringEntry, 'timestamp'>,
): CopySection | null {
  const existing = getSection(sectionId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'addSteeringEntry: section not found');
    return null;
  }
  if (existing.workspaceId !== workspaceId) {
    log.warn({ sectionId, workspaceId }, 'addSteeringEntry: workspace mismatch');
    return null;
  }

  const newEntry: SteeringEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  const updated = [...existing.steeringHistory, newEntry];
  const now = new Date().toISOString();

  stmts().updateSectionSteering.run({
    id: sectionId,
    workspace_id: workspaceId,
    steering_history: JSON.stringify(updated),
    updated_at: now,
  });

  return getSection(sectionId);
}

// Client suggestions (appends, sets status to 'revision_requested')
export function addClientSuggestion(
  sectionId: string,
  workspaceId: string,
  suggestion: Omit<ClientSuggestion, 'timestamp' | 'status'>,
): CopySection | null {
  const existing = getSection(sectionId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'addClientSuggestion: section not found');
    return null;
  }
  if (existing.workspaceId !== workspaceId) {
    log.warn({ sectionId, workspaceId }, 'addClientSuggestion: workspace mismatch');
    return null;
  }

  const newSuggestion: ClientSuggestion = {
    ...suggestion,
    status: 'pending',
    timestamp: new Date().toISOString(),
  };

  const currentSuggestions = existing.clientSuggestions ?? [];
  const updatedSuggestions = [...currentSuggestions, newSuggestion];

  // Determine new status: client_review → revision_requested is valid
  let newStatus = existing.status;
  if (existing.status === 'client_review' || existing.status === 'draft') {
    newStatus = 'revision_requested';
  }

  const now = new Date().toISOString();

  stmts().updateSectionClientSuggestions.run({
    id: sectionId,
    workspace_id: workspaceId,
    client_suggestions: JSON.stringify(updatedSuggestions),
    status: newStatus,
    updated_at: now,
  });

  return getSection(sectionId);
}

// Manual edit (status → 'draft', version++)
export function updateCopyText(
  sectionId: string,
  workspaceId: string,
  newCopy: string,
): CopySection | null {
  const existing = getSection(sectionId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'updateCopyText: section not found');
    return null;
  }
  if (existing.workspaceId !== workspaceId) {
    log.warn({ sectionId, workspaceId }, 'updateCopyText: workspace mismatch');
    return null;
  }

  const now = new Date().toISOString();
  const newVersion = existing.version + 1;

  stmts().updateSectionText.run({
    id: sectionId,
    workspace_id: workspaceId,
    generated_copy: newCopy,
    status: 'draft',
    version: newVersion,
    updated_at: now,
  });

  return getSection(sectionId);
}

// ── Metadata ──

export function getMetadata(entryId: string): CopyMetadata | null {
  const row = stmts().selectMetadataByEntry.get(entryId) as CopyMetadataRow | undefined;
  if (!row) return null;
  return rowToMetadata(row);
}

export function saveMetadata(
  entryId: string,
  workspaceId: string,
  data: { seoTitle: string; metaDescription: string; ogTitle: string; ogDescription: string },
): CopyMetadata {
  const now = new Date().toISOString();
  const id = `cm_${randomUUID().slice(0, 8)}`;

  stmts().upsertMetadata.run({
    id,
    workspace_id: workspaceId,
    entry_id: entryId,
    seo_title: data.seoTitle,
    meta_description: data.metaDescription,
    og_title: data.ogTitle,
    og_description: data.ogDescription,
    created_at: now,
    updated_at: now,
  });

  const row = stmts().selectMetadataByEntry.get(entryId) as CopyMetadataRow;
  return rowToMetadata(row);
}

// ── Derived status ──

export function getEntryCopyStatus(entryId: string): EntryCopyStatus {
  const sections = getSectionsForEntry(entryId);
  const total = sections.length;
  const pending = sections.filter(s => s.status === 'pending').length;
  const draft = sections.filter(s => s.status === 'draft').length;
  const approved = sections.filter(s => s.status === 'approved').length;
  const revision = sections.filter(s => s.status === 'revision_requested').length;

  let overallStatus: CopySectionStatus = 'pending';
  if (total === 0) overallStatus = 'pending';
  else if (approved === total) overallStatus = 'approved';
  else if (revision > 0) overallStatus = 'revision_requested';
  else if (draft > 0 || approved > 0) overallStatus = 'draft';

  return {
    entryId,
    totalSections: total,
    pendingSections: pending,
    draftSections: draft,
    approvedSections: approved,
    revisionSections: revision,
    overallStatus,
    approvalPercentage: total > 0 ? Math.round((approved / total) * 100) : 0,
  };
}
