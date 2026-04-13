// server/copy-review.ts
// CRUD service for copy sections, metadata, and status management.

import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { steeringEntrySchema, clientSuggestionSchema, qualityFlagSchema } from './schemas/copy-pipeline.js';
import { createLogger } from './logger.js';
import { addVoiceSample, getVoiceProfile, deleteVoiceSample } from './voice-calibration.js';
import { getEntry } from './page-strategy.js';
import { addActivity } from './activity-log.js';
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
import type { VoiceSampleContext } from '../shared/types/brand-engine.js';

const log = createLogger('copy-review');

// ── Voice sample auto-add on approve ──

/** Max `copy_approved` voice samples per context_tag per workspace (FIFO). */
const MAX_COPY_APPROVED_SAMPLES_PER_TAG = 3;

const MISSING_SCHEMA_ERROR_RE = /no such (table|column)/i;

/** Gracefully degrade when voice_profiles / voice_samples tables don't exist (test envs). */
function safeBrandEngineRead<T>(context: string, workspaceId: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!MISSING_SCHEMA_ERROR_RE.test(message)) {
      throw err;
    }
    log.warn({ context, workspaceId, error: message }, 'brand-engine read failed — graceful degradation');
    return fallback;
  }
}

/**
 * Map section types to voice context tags.
 * Only valid VoiceSampleContext values are used.
 * 'faq' maps to 'body' since 'faq' is not a valid VoiceSampleContext.
 */
const SECTION_TYPE_TO_CONTEXT_TAG: Record<string, VoiceSampleContext> = {
  'hero': 'headline',
  'problem': 'body',
  'solution': 'body',
  'features-benefits': 'body',
  'process': 'body',
  'faq': 'body',
  'cta': 'cta',
  'about-team': 'about',
  'content-body': 'body',
};

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
    `SELECT * FROM copy_sections WHERE entry_id = ? AND workspace_id = ? ORDER BY rowid ASC`,
  ),
  selectSectionById: db.prepare(
    `SELECT * FROM copy_sections WHERE id = ? AND workspace_id = ?`,
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

  // blueprint entry lookup (for voice sample context tag resolution)
  selectEntryBlueprintId: db.prepare(
    `SELECT blueprint_id FROM blueprint_entries WHERE id = ?`,
  ),

  // copy_metadata
  upsertMetadata: db.prepare(
    `INSERT INTO copy_metadata (id, workspace_id, entry_id, seo_title, meta_description, og_title, og_description, status, steering_history, created_at, updated_at)
     VALUES (@id, @workspace_id, @entry_id, @seo_title, @meta_description, @og_title, @og_description, 'pending', '[]', @created_at, @updated_at)
     ON CONFLICT(workspace_id, entry_id) DO UPDATE SET
       seo_title = excluded.seo_title,
       meta_description = excluded.meta_description,
       og_title = excluded.og_title,
       og_description = excluded.og_description,
       updated_at = excluded.updated_at`,
  ),
  selectMetadataByEntry: db.prepare(
    `SELECT * FROM copy_metadata WHERE entry_id = ? AND workspace_id = ?`,
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

// ── Approve side-effects ──

/**
 * Task 20: When a section is approved, auto-add its copy as a voice sample.
 * Resolves section type → context tag, enforces FIFO cap of 3 per tag per workspace.
 */
function handleApprovedVoiceSample(section: CopySection, workspaceId: string): void {
  try {
    if (!section.generatedCopy) return;

    // Look up the entry to get the section plan and resolve the section type.
    const entryRow = safeBrandEngineRead(
      'handleApprovedVoiceSample.selectEntryBlueprintId', workspaceId,
      () => stmts().selectEntryBlueprintId.get(section.entryId) as { blueprint_id: string } | undefined,
      undefined,
    );
    if (!entryRow) {
      log.warn({ sectionId: section.id, entryId: section.entryId }, 'voice sample: could not resolve blueprint_id for entry');
      return;
    }

    const entry = safeBrandEngineRead(
      'handleApprovedVoiceSample.getEntry', workspaceId,
      () => getEntry(workspaceId, entryRow.blueprint_id, section.entryId),
      null,
    );
    if (!entry) {
      log.warn({ sectionId: section.id, entryId: section.entryId }, 'voice sample: entry not found');
      return;
    }

    // Find the matching section plan item to get the section type
    const planItem = entry.sectionPlan.find(sp => sp.id === section.sectionPlanItemId);
    const contextTag: VoiceSampleContext = planItem
      ? (SECTION_TYPE_TO_CONTEXT_TAG[planItem.sectionType] ?? 'body')
      : 'body';

    // FIFO cap: delete oldest copy_approved samples for this context_tag if at limit
    const profile = safeBrandEngineRead(
      'handleApprovedVoiceSample.getVoiceProfile', workspaceId,
      () => getVoiceProfile(workspaceId),
      null,
    );
    if (profile) {
      const existingForTag = profile.samples
        .filter(s => s.source === 'copy_approved' && s.contextTag === contextTag)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest first

      if (existingForTag.length >= MAX_COPY_APPROVED_SAMPLES_PER_TAG) {
        // Delete oldest to make room (FIFO)
        const toDelete = existingForTag.slice(0, existingForTag.length - MAX_COPY_APPROVED_SAMPLES_PER_TAG + 1);
        for (const old of toDelete) {
          safeBrandEngineRead(
            'handleApprovedVoiceSample.deleteVoiceSample', workspaceId,
            () => deleteVoiceSample(workspaceId, old.id),
            false,
          );
        }
      }
    }

    safeBrandEngineRead(
      'handleApprovedVoiceSample.addVoiceSample', workspaceId,
      () => addVoiceSample(workspaceId, section.generatedCopy!, contextTag, 'copy_approved'),
      undefined as unknown as ReturnType<typeof addVoiceSample>,
    );

    log.info({ sectionId: section.id, workspaceId, contextTag }, 'auto-added approved copy as voice sample');
  } catch (err) {
    log.error({ sectionId: section.id, workspaceId, error: err }, 'failed to add voice sample for approved section — non-critical');
  }
}

/**
 * Task 23: When ALL sections for an entry are approved, calculate copy_approval_rate
 * (% approved on first try — version === 1) and log it via addActivity.
 */
function handleAllSectionsApproved(entryId: string, workspaceId: string): void {
  try {
    const sections = getSectionsForEntry(entryId, workspaceId);
    if (sections.length === 0) return;

    const allApproved = sections.every(s => s.status === 'approved');
    if (!allApproved) return;

    // Calculate first-try approval rate: sections where version === 1
    const firstTryCount = sections.filter(s => s.version === 1).length;
    const approvalRate = Math.round((firstTryCount / sections.length) * 100);

    // Look up entry name for a meaningful activity title
    const entryRow = stmts().selectEntryBlueprintId.get(entryId) as { blueprint_id: string } | undefined;
    let entryName = entryId;
    if (entryRow) {
      const entry = getEntry(workspaceId, entryRow.blueprint_id, entryId);
      if (entry) entryName = entry.name;
    }

    addActivity(
      workspaceId,
      'copy_approved',
      `All copy approved: ${entryName}`,
      `${sections.length} sections fully approved. First-try approval rate: ${approvalRate}% (${firstTryCount}/${sections.length} approved on first generation).`,
      {
        entryId,
        entryName,
        totalSections: sections.length,
        firstTryCount,
        approvalRate,
        allSectionsApproved: true,
      },
    );

    log.info({ entryId, workspaceId, approvalRate, firstTryCount, totalSections: sections.length }, 'all sections approved — logged approval rate');
  } catch (err) {
    log.error({ entryId, workspaceId, error: err }, 'failed to handle all-sections-approved feedback loop — non-critical');
  }
}

// ── Section CRUD ──

export function getSectionsForEntry(entryId: string, workspaceId: string): CopySection[] {
  const rows = stmts().selectSectionsByEntry.all(entryId, workspaceId) as CopySectionRow[];
  return rows.map(r => rowToSection(r));
}

export function getSection(sectionId: string, workspaceId: string): CopySection | null {
  const row = stmts().selectSectionById.get(sectionId, workspaceId) as CopySectionRow | undefined;
  if (!row) return null;
  return rowToSection(row);
}

// Initialize sections from section plan (delete-then-insert in transaction).
// Preserves steering_history, client_suggestions, and created_at from any
// existing sections so that re-generation doesn't wipe accumulated review data.
export function initializeSections(
  workspaceId: string,
  entryId: string,
  sectionPlan: SectionPlanItem[],
): CopySection[] {
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    // Read before delete so steering history / client feedback survive re-generation
    const existing = getSectionsForEntry(entryId, workspaceId);
    const prevByPlanItem = new Map(
      existing.map(s => [s.sectionPlanItemId, {
        steeringHistory: s.steeringHistory,
        clientSuggestions: s.clientSuggestions,
        createdAt: s.createdAt,
      }]),
    );

    stmts().deleteSectionsByEntry.run(entryId, workspaceId);

    const sections: CopySection[] = [];
    for (const item of sectionPlan) {
      const id = `cs_${randomUUID().slice(0, 8)}`;
      const prev = prevByPlanItem.get(item.id);
      stmts().insertSection.run({
        id,
        workspace_id: workspaceId,
        entry_id: entryId,
        section_plan_item_id: item.id,
        generated_copy: null,
        status: 'pending',
        ai_annotation: null,
        ai_reasoning: null,
        steering_history: prev ? JSON.stringify(prev.steeringHistory) : '[]',
        client_suggestions: prev?.clientSuggestions ? JSON.stringify(prev.clientSuggestions) : null,
        quality_flags: null,  // reset — AI re-scores on generation
        version: 0,
        created_at: prev?.createdAt ?? now,
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
        steeringHistory: prev?.steeringHistory ?? [],
        clientSuggestions: prev?.clientSuggestions ?? null,
        qualityFlags: null,
        version: 0,
        createdAt: prev?.createdAt ?? now,
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
  const existing = getSection(sectionId, workspaceId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'saveGeneratedCopy: section not found');
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

  return getSection(sectionId, workspaceId);
}

// Status management
export function updateSectionStatus(
  sectionId: string,
  workspaceId: string,
  status: CopySectionStatus,
): CopySection | null {
  const existing = getSection(sectionId, workspaceId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'updateSectionStatus: section not found');
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

  const updated = getSection(sectionId, workspaceId);

  // ── Side effects on transition to 'approved' ──
  if (status === 'approved' && updated) {
    // Task 20: Auto-add approved copy as a voice sample
    handleApprovedVoiceSample(updated, workspaceId);

    // Task 23: Check if all sections for entry are now approved → log approval rate
    handleAllSectionsApproved(updated.entryId, workspaceId);
  }

  return updated;
}

// Steering (appends to steering_history JSON array)
export function addSteeringEntry(
  sectionId: string,
  workspaceId: string,
  entry: Omit<SteeringEntry, 'timestamp'>,
): CopySection | null {
  const existing = getSection(sectionId, workspaceId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'addSteeringEntry: section not found');
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

  return getSection(sectionId, workspaceId);
}

// Client suggestions (appends, sets status to 'revision_requested')
export function addClientSuggestion(
  sectionId: string,
  workspaceId: string,
  suggestion: Omit<ClientSuggestion, 'timestamp' | 'status'>,
): CopySection | null {
  const existing = getSection(sectionId, workspaceId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'addClientSuggestion: section not found');
    return null;
  }

  const newSuggestion: ClientSuggestion = {
    ...suggestion,
    status: 'pending',
    timestamp: new Date().toISOString(),
  };

  const currentSuggestions = existing.clientSuggestions ?? [];
  const updatedSuggestions = [...currentSuggestions, newSuggestion];

  // Determine new status: only client_review → revision_requested is a valid transition.
  // draft sections receive a suggestion but stay in draft until sent for client review.
  let newStatus = existing.status;
  if (existing.status === 'client_review') {
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

  return getSection(sectionId, workspaceId);
}

// Manual edit (status → 'draft', version++)
export function updateCopyText(
  sectionId: string,
  workspaceId: string,
  newCopy: string,
): CopySection | null {
  const existing = getSection(sectionId, workspaceId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'updateCopyText: section not found');
    return null;
  }
  if (existing.status === 'approved') {
    log.warn({ sectionId, workspaceId }, 'updateCopyText: cannot edit approved section');
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

  return getSection(sectionId, workspaceId);
}

// ── Metadata ──

export function getMetadata(entryId: string, workspaceId: string): CopyMetadata | null {
  const row = stmts().selectMetadataByEntry.get(entryId, workspaceId) as CopyMetadataRow | undefined;
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

  const row = stmts().selectMetadataByEntry.get(entryId, workspaceId) as CopyMetadataRow;
  return rowToMetadata(row);
}

// ── Derived status ──

export function getEntryCopyStatus(entryId: string, workspaceId: string): EntryCopyStatus {
  const sections = getSectionsForEntry(entryId, workspaceId);
  const total = sections.length;
  const pending = sections.filter(s => s.status === 'pending').length;
  const draft = sections.filter(s => s.status === 'draft').length;
  const clientReview = sections.filter(s => s.status === 'client_review').length;
  const approved = sections.filter(s => s.status === 'approved').length;
  const revision = sections.filter(s => s.status === 'revision_requested').length;

  let overallStatus: CopySectionStatus = 'pending';
  if (total === 0) overallStatus = 'pending';
  else if (approved === total) overallStatus = 'approved';
  else if (revision > 0) overallStatus = 'revision_requested';
  else if (clientReview > 0 && pending === 0 && draft === 0) overallStatus = 'client_review';
  else if (draft > 0 || approved > 0 || clientReview > 0) overallStatus = 'draft';

  return {
    entryId,
    totalSections: total,
    pendingSections: pending,
    draftSections: draft,
    clientReviewSections: clientReview,
    approvedSections: approved,
    revisionSections: revision,
    overallStatus,
    approvalPercentage: total > 0 ? Math.round((approved / total) * 100) : 0,
  };
}
