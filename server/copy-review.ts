// server/copy-review.ts
// CRUD service for copy sections, metadata, and status management.

import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import {
  steeringEntrySchema,
  clientSuggestionSchema,
  qualityFlagSchema,
  copySectionPlanIdentitySchema,
} from './schemas/copy-pipeline.js';
import {
  canonicalGenerationProvenanceSchema,
  generationProvenanceSchema,
} from './schemas/generation-provenance.js';
import { GenerationRevisionConflictError } from './generation-provenance.js';
import { createLogger } from './logger.js';
import { addVoiceSample, getVoiceProfile, deleteVoiceSample } from './voice-calibration.js';
import { getEntry } from './page-strategy.js';
import { addActivity } from './activity-log.js';
import { COPY_SECTION_TRANSITIONS, validateTransition, InvalidTransitionError } from './state-machines.js';
import type {
  CopySection,
  PersistedCopySection,
  CopyMetadata,
  CopySectionStatus,
  SteeringEntry,
  ClientSuggestion,
  QualityFlag,
  EntryCopyStatus,
} from '../shared/types/copy-pipeline.js';
import type { GenerationProvenance } from '../shared/types/ai-execution.js';
import type { SectionPlanItem } from '../shared/types/page-strategy.js';
import type { VoiceSampleContext } from '../shared/types/brand-engine.js';

const log = createLogger('copy-review');

export class CopySuggestionOriginalMismatchError extends Error {
  readonly code = 'copy_suggestion_original_mismatch';

  constructor(sectionId: string) {
    super(`Copy section ${sectionId} no longer matches the suggestion source text`);
    this.name = 'CopySuggestionOriginalMismatchError';
  }
}

/**
 * Public copy review uses `updatedAt` as its privacy-safe optimistic-lock token.
 * SQLite timestamps only have millisecond precision, so two mutations in the same
 * tick must still produce distinct tokens.
 */
function nextMutationTimestamp(previous: string): string {
  const previousMs = Date.parse(previous);
  const nowMs = Date.now();
  return new Date(Number.isFinite(previousMs) ? Math.max(nowMs, previousMs + 1) : nowMs).toISOString();
}

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
  generation_revision: number;
  generation_provenance: string | null;
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
    `INSERT INTO copy_sections (id, workspace_id, entry_id, section_plan_item_id, generated_copy, status, ai_annotation, ai_reasoning, steering_history, client_suggestions, quality_flags, version, generation_revision, generation_provenance, created_at, updated_at)
     VALUES (@id, @workspace_id, @entry_id, @section_plan_item_id, @generated_copy, @status, @ai_annotation, @ai_reasoning, @steering_history, @client_suggestions, @quality_flags, @version, @generation_revision, @generation_provenance, @created_at, @updated_at)`,
  ),
  selectSectionsByEntry: db.prepare(
    `SELECT * FROM copy_sections WHERE entry_id = ? AND workspace_id = ? ORDER BY rowid ASC`,
  ),
  selectSectionById: db.prepare(
    `SELECT * FROM copy_sections WHERE id = ? AND workspace_id = ?`,
  ),
  deleteSectionCas: db.prepare(
    `DELETE FROM copy_sections
     WHERE id = @id AND workspace_id = @workspace_id
       AND generation_revision = @expected_revision
       AND status NOT IN ('client_review', 'approved')`,
  ),
  updateSectionCopy: db.prepare(
    `UPDATE copy_sections
     SET generated_copy = @generated_copy, ai_annotation = @ai_annotation, ai_reasoning = @ai_reasoning,
       quality_flags = @quality_flags, status = @status, version = @version, -- status-ok: COPY_SECTION_TRANSITIONS guard runs in saveGeneratedCopy() before this write (pending→draft)
       generation_revision = generation_revision + 1,
       generation_provenance = @generation_provenance,
       updated_at = @updated_at
     WHERE id = @id AND workspace_id = @workspace_id
       AND generation_revision = @expected_revision
       AND status NOT IN ('client_review', 'approved')`,
  ),
  updateSectionStatus: db.prepare(
    `UPDATE copy_sections
     SET status = @status, generation_revision = generation_revision + 1, -- status-ok: COPY_SECTION_TRANSITIONS guard runs in updateSectionStatus() before this write
       updated_at = @updated_at
     WHERE id = @id AND workspace_id = @workspace_id
       AND generation_revision = @expected_revision`,
  ),
  updateSectionSteering: db.prepare(
    `UPDATE copy_sections
     SET steering_history = @steering_history,
       generation_revision = generation_revision + 1, updated_at = @updated_at
     WHERE id = @id AND workspace_id = @workspace_id
       AND generation_revision = @expected_revision`,
  ),
  updateSectionClientSuggestions: db.prepare(
    `UPDATE copy_sections
     SET client_suggestions = @client_suggestions, status = @status, -- status-ok: addClientSuggestion() only advances client_review→revision_requested; otherwise status is carried through unchanged
       generation_revision = generation_revision + 1, updated_at = @updated_at
     WHERE id = @id AND workspace_id = @workspace_id
       AND generation_revision = @expected_revision`,
  ),
  updateSectionText: db.prepare(
    `UPDATE copy_sections
     SET generated_copy = @generated_copy, status = @status, version = @version, -- status-ok: updateCopyText() is a manual content edit that resets to draft; approved sections are blocked
       generation_revision = generation_revision + 1, updated_at = @updated_at
     WHERE id = @id AND workspace_id = @workspace_id
       AND generation_revision = @expected_revision`,
  ),

  selectEntryGenerationAuthority: db.prepare(
    `SELECT be.section_plan_json, be.updated_at
     FROM blueprint_entries be
     JOIN site_blueprints sb ON sb.id = be.blueprint_id
     WHERE be.id = @entry_id AND sb.workspace_id = @workspace_id`,
  ),

  // blueprint entry lookup (for voice sample context tag resolution)
  // blueprint_entries has no workspace_id column; workspace isolation is via site_blueprints JOIN
  selectEntryBlueprintId: db.prepare(
    `SELECT be.blueprint_id FROM blueprint_entries be
     JOIN site_blueprints sb ON sb.id = be.blueprint_id
     WHERE be.id = ? AND sb.workspace_id = ?`,
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

function rowToSection(row: CopySectionRow): PersistedCopySection {
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
    generationRevision: r.generation_revision,
    generationProvenance: parseJsonSafe(
      r.generation_provenance,
      generationProvenanceSchema,
      null,
      { workspaceId: r.workspace_id, table: 'copy_sections', field: 'generation_provenance' },
    ),
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
// The copy-section transition table lives in server/state-machines.ts
// (COPY_SECTION_TRANSITIONS) — this module no longer owns a parallel map.
// isValidTransition is a boolean convenience wrapper over the shared table for the
// internal callers below; the write-boundary guard uses validateTransition() (throws).

export function isValidTransition(from: CopySectionStatus, to: CopySectionStatus): boolean {
  return COPY_SECTION_TRANSITIONS[from]?.includes(to) ?? false;
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
    // Note: blueprint_entries is a page-strategy table (migration 057), not a brand-engine
    // table — we use a direct call here and rely on the outer try-catch for error handling,
    // consistent with handleAllSectionsApproved.
    const entryRow = stmts().selectEntryBlueprintId.get(section.entryId, workspaceId) as { blueprint_id: string } | undefined;
    if (!entryRow) {
      log.warn({ sectionId: section.id, entryId: section.entryId }, 'voice sample: could not resolve blueprint_id for entry');
      return;
    }

    const entry = getEntry(workspaceId, entryRow.blueprint_id, section.entryId);
    if (!entry) {
      log.warn({ sectionId: section.id, entryId: section.entryId }, 'voice sample: entry not found');
      return;
    }

    // Find the matching section plan item to get the section type
    const planItem = entry.sectionPlan.find(sp => sp.id === section.sectionPlanItemId);
    const contextTag: VoiceSampleContext = planItem
      ? (SECTION_TYPE_TO_CONTEXT_TAG[planItem.sectionType] ?? 'body')
      : 'body';

    // FIFO cap: read + delete + add all inside one transaction to prevent:
    // 1. Crash between delete and add losing samples without replacement
    // 2. TOCTOU race where two concurrent approvals read the same stale count
    //    and both evict the same sample, overshooting the cap
    // Check voice table availability before entering the transaction.
    // If tables don't exist, skip entirely — no point wrapping a guaranteed failure.
    const profile = safeBrandEngineRead(
      'handleApprovedVoiceSample.getVoiceProfile', workspaceId,
      () => getVoiceProfile(workspaceId),
      null,
    );
    if (!profile) {
      log.debug({ workspaceId }, 'voice tables unavailable or no profile — skipping voice sample creation');
      return;
    }

    const addApprovedSample = db.transaction(() => {
      // Re-read inside transaction for TOCTOU safety on concurrent approvals
      const freshProfile = getVoiceProfile(workspaceId);
      const existingForTag = (freshProfile?.samples ?? [])
        .filter(s => s.source === 'copy_approved' && s.contextTag === contextTag)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest first

      if (existingForTag.length >= MAX_COPY_APPROVED_SAMPLES_PER_TAG) {
        // Delete oldest to make room (FIFO)
        const toDelete = existingForTag.slice(0, existingForTag.length - MAX_COPY_APPROVED_SAMPLES_PER_TAG + 1);
        for (const old of toDelete) {
          deleteVoiceSample(workspaceId, old.id);
        }
      }

      addVoiceSample(workspaceId, section.generatedCopy!, contextTag, 'copy_approved');
    });
    addApprovedSample.immediate();

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
    const entryRow = stmts().selectEntryBlueprintId.get(entryId, workspaceId) as { blueprint_id: string } | undefined;
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

function getPersistedSectionsForEntry(entryId: string, workspaceId: string): PersistedCopySection[] {
  const rows = stmts().selectSectionsByEntry.all(entryId, workspaceId) as CopySectionRow[];
  return rows.map(r => rowToSection(r));
}

export function getSectionsForEntry(entryId: string, workspaceId: string): CopySection[] {
  return getPersistedSectionsForEntry(entryId, workspaceId);
}

function getPersistedSection(sectionId: string, workspaceId: string): PersistedCopySection | null {
  const row = stmts().selectSectionById.get(sectionId, workspaceId) as CopySectionRow | undefined;
  if (!row) return null;
  return rowToSection(row);
}

export function getSection(sectionId: string, workspaceId: string): CopySection | null {
  return getPersistedSection(sectionId, workspaceId);
}

// Initialize missing sections from the section plan without replacing stable rows.
// Existing IDs, copy, review state, feedback, provenance, and timestamps remain authoritative.
export function initializeSections(
  workspaceId: string,
  entryId: string,
  sectionPlan: SectionPlanItem[],
): PersistedCopySection[] {
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    const existing = getPersistedSectionsForEntry(entryId, workspaceId);
    const existingByPlanItem = new Map(existing.map(section => [section.sectionPlanItemId, section]));
    if (new Set(sectionPlan.map(item => item.id)).size !== sectionPlan.length) {
      throw new Error('Cannot initialize copy sections from a plan with duplicate section ids');
    }

    const sections: PersistedCopySection[] = [];
    for (const item of sectionPlan) {
      const retained = existingByPlanItem.get(item.id);
      if (retained) {
        sections.push(retained);
        continue;
      }
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
        generation_revision: 0,
        generation_provenance: null,
        created_at: now,
        updated_at: now,
      });
      const inserted = getPersistedSection(id, workspaceId);
      if (!inserted) throw new Error(`Failed to initialize copy section: ${id}`);
      sections.push(inserted);
    }
    return sections;
  });

  return run();
}

interface CopyEntryAuthorityRow {
  section_plan_json: string;
  updated_at: string;
}

export interface CopyGenerationCensusSection {
  id: string;
  sectionPlanItemId: string;
  generationRevision: number;
  status: CopySectionStatus;
}

/** Durable identity/revision boundary captured before paid full-entry generation begins. */
export interface CopyEntryGenerationSnapshot {
  workspaceId: string;
  entryId: string;
  sectionPlanJson: string;
  entryUpdatedAt: string;
  plannedSections: Array<{ id: string; order: number }>;
  sections: CopyGenerationCensusSection[];
}

export interface GeneratedCopySectionCommit {
  sectionPlanItemId: string;
  generatedCopy: string;
  aiAnnotation: string;
  aiReasoning: string;
  qualityFlags?: QualityFlag[];
}

export interface GeneratedCopyMetadataCommit {
  seoTitle: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
}

function generationConflict(snapshot: CopyEntryGenerationSnapshot): GenerationRevisionConflictError {
  const first = snapshot.sections[0];
  return new GenerationRevisionConflictError(
    'copy_section',
    first?.id ?? snapshot.entryId,
    first?.generationRevision ?? 0,
  );
}

function censusOf(sections: PersistedCopySection[]): CopyGenerationCensusSection[] {
  return sections.map(section => ({
    id: section.id,
    sectionPlanItemId: section.sectionPlanItemId,
    generationRevision: section.generationRevision,
    status: section.status,
  }));
}

function sameCensus(
  expected: CopyGenerationCensusSection[],
  actual: CopyGenerationCensusSection[],
): boolean {
  return expected.length === actual.length && expected.every((section, index) => {
    const candidate = actual[index];
    return candidate?.id === section.id
      && candidate.sectionPlanItemId === section.sectionPlanItemId
      && candidate.generationRevision === section.generationRevision
      && candidate.status === section.status;
  });
}

/**
 * Captures the exact section census and blueprint plan authority before AI work.
 * Client-review and approved copy are authoritative and cannot be auto-replaced.
 */
export function snapshotCopyEntryGeneration(
  workspaceId: string,
  entryId: string,
  expectedSectionPlan: SectionPlanItem[],
): CopyEntryGenerationSnapshot {
  const authority = stmts().selectEntryGenerationAuthority.get({
    workspace_id: workspaceId,
    entry_id: entryId,
  }) as CopyEntryAuthorityRow | undefined;
  if (!authority) throw new Error(`Blueprint entry not found: ${entryId}`);

  const plannedSections = parseJsonSafeArray(
    authority.section_plan_json,
    copySectionPlanIdentitySchema,
    { workspaceId, table: 'blueprint_entries', field: 'section_plan_json' },
  ).map(section => ({ id: section.id, order: section.order }));
  const expected = expectedSectionPlan.map(section => ({ id: section.id, order: section.order }));
  if (JSON.stringify(plannedSections) !== JSON.stringify(expected)) {
    throw new GenerationRevisionConflictError('copy_section', entryId, 0);
  }
  if (new Set(plannedSections.map(section => section.id)).size !== plannedSections.length) {
    throw new Error('Cannot generate copy from a plan with duplicate section ids');
  }

  const sections = getPersistedSectionsForEntry(entryId, workspaceId);
  const protectedSection = sections.find(section => (
    section.status === 'client_review' || section.status === 'approved'
  ));
  if (protectedSection) {
    throw new GenerationRevisionConflictError(
      'copy_section',
      protectedSection.id,
      protectedSection.generationRevision,
    );
  }

  return {
    workspaceId,
    entryId,
    sectionPlanJson: authority.section_plan_json,
    entryUpdatedAt: authority.updated_at,
    plannedSections,
    sections: censusOf(sections),
  };
}

/** Atomically adopts a full generated page only if the plan and section census are unchanged. */
export function commitGeneratedEntryCopy(
  snapshot: CopyEntryGenerationSnapshot,
  generatedSections: GeneratedCopySectionCommit[],
  metadata: GeneratedCopyMetadataCommit,
  provenance: GenerationProvenance,
): { sections: PersistedCopySection[]; metadata: CopyMetadata } {
  const validatedProvenance = canonicalGenerationProvenanceSchema.parse(provenance);
  const generatedByPlan = new Map(generatedSections.map(section => [section.sectionPlanItemId, section]));
  const plannedIds = snapshot.plannedSections.map(section => section.id);
  if (generatedByPlan.size !== generatedSections.length
    || generatedSections.length !== plannedIds.length
    || plannedIds.some(id => !generatedByPlan.has(id))) {
    throw new Error('Generated copy does not match the authoritative section plan');
  }

  return db.transaction(() => {
    const authority = stmts().selectEntryGenerationAuthority.get({
      workspace_id: snapshot.workspaceId,
      entry_id: snapshot.entryId,
    }) as CopyEntryAuthorityRow | undefined;
    const current = getPersistedSectionsForEntry(snapshot.entryId, snapshot.workspaceId);
    if (!authority
      || authority.section_plan_json !== snapshot.sectionPlanJson
      || authority.updated_at !== snapshot.entryUpdatedAt
      || !sameCensus(snapshot.sections, censusOf(current))
      || current.some(section => section.status === 'client_review' || section.status === 'approved')) {
      throw generationConflict(snapshot);
    }

    const planned = new Set(plannedIds);
    for (const existing of current) {
      if (planned.has(existing.sectionPlanItemId)) continue;
      const deleted = stmts().deleteSectionCas.run({
        id: existing.id,
        workspace_id: snapshot.workspaceId,
        expected_revision: existing.generationRevision,
      }).changes;
      if (deleted !== 1) throw generationConflict(snapshot);
    }

    const now = new Date().toISOString();
    const provenanceJson = JSON.stringify(validatedProvenance);
    const existingByPlan = new Map(current.map(section => [section.sectionPlanItemId, section]));
    for (const planId of plannedIds) {
      const generated = generatedByPlan.get(planId)!;
      const existing = existingByPlan.get(planId);
      if (existing) {
        const updated = stmts().updateSectionCopy.run({
          id: existing.id,
          workspace_id: snapshot.workspaceId,
          generated_copy: generated.generatedCopy,
          ai_annotation: generated.aiAnnotation,
          ai_reasoning: generated.aiReasoning,
          quality_flags: generated.qualityFlags?.length ? JSON.stringify(generated.qualityFlags) : null,
          status: 'draft',
          version: existing.version + 1,
          generation_provenance: provenanceJson,
          expected_revision: existing.generationRevision,
          updated_at: nextMutationTimestamp(existing.updatedAt),
        }).changes;
        if (updated !== 1) throw generationConflict(snapshot);
        continue;
      }

      stmts().insertSection.run({
        id: `cs_${randomUUID().slice(0, 8)}`,
        workspace_id: snapshot.workspaceId,
        entry_id: snapshot.entryId,
        section_plan_item_id: planId,
        generated_copy: generated.generatedCopy,
        status: 'draft',
        ai_annotation: generated.aiAnnotation,
        ai_reasoning: generated.aiReasoning,
        steering_history: '[]',
        client_suggestions: null,
        quality_flags: generated.qualityFlags?.length ? JSON.stringify(generated.qualityFlags) : null,
        version: 1,
        generation_revision: 1,
        generation_provenance: provenanceJson,
        created_at: now,
        updated_at: now,
      });
    }

    const savedMetadata = saveMetadata(snapshot.entryId, snapshot.workspaceId, metadata);
    const savedByPlan = new Map(
      getPersistedSectionsForEntry(snapshot.entryId, snapshot.workspaceId)
        .map(section => [section.sectionPlanItemId, section]),
    );
    return {
      sections: plannedIds.map(id => savedByPlan.get(id)!),
      metadata: savedMetadata,
    };
  }).immediate();
}

// Save AI-generated copy (sets status to 'draft', increments version)
export function saveGeneratedCopy(
  sectionId: string,
  workspaceId: string,
  data: {
    generatedCopy: string;
    aiAnnotation: string;
    aiReasoning: string;
    qualityFlags?: QualityFlag[];
    expectedRevision?: number;
    generationProvenance?: GenerationProvenance | null;
  },
): PersistedCopySection | null {
  const existing = getPersistedSection(sectionId, workspaceId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'saveGeneratedCopy: section not found');
    return null;
  }

  // pending → draft (or re-generation: draft/revision_requested → draft, both no-op
  // self-edges handled here since generation legitimately re-writes an existing draft).
  const targetStatus: CopySectionStatus = 'draft';
  if (existing.status === 'client_review' || existing.status === 'approved') {
    log.warn({ sectionId, currentStatus: existing.status }, 'saveGeneratedCopy: protected review state');
    return null;
  }
  if (existing.status !== 'draft' && existing.status !== 'revision_requested') {
    try {
      validateTransition('copy_section', COPY_SECTION_TRANSITIONS, existing.status, targetStatus);
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        log.warn({ sectionId, currentStatus: existing.status }, 'saveGeneratedCopy: invalid status transition');
        return null;
      }
      throw err;
    }
  }

  const now = nextMutationTimestamp(existing.updatedAt);
  const newVersion = existing.version + 1;

  const expectedRevision = data.expectedRevision ?? existing.generationRevision;
  const provenance = data.generationProvenance === undefined
    ? existing.generationProvenance
    : data.generationProvenance;
  if (provenance) canonicalGenerationProvenanceSchema.parse(provenance);
  const changed = stmts().updateSectionCopy.run({
    id: sectionId,
    workspace_id: workspaceId,
    generated_copy: data.generatedCopy,
    ai_annotation: data.aiAnnotation,
    ai_reasoning: data.aiReasoning,
    quality_flags: data.qualityFlags ? JSON.stringify(data.qualityFlags) : null,
    status: 'draft',
    version: newVersion,
    generation_provenance: provenance ? JSON.stringify(provenance) : null,
    expected_revision: expectedRevision,
    updated_at: now,
  }).changes;
  if (changed !== 1) {
    throw new GenerationRevisionConflictError('copy_section', sectionId, expectedRevision);
  }

  return getPersistedSection(sectionId, workspaceId);
}

// Status management
export function updateSectionStatus(
  sectionId: string,
  workspaceId: string,
  status: CopySectionStatus,
  expectedRevision?: number,
): PersistedCopySection | null {
  const existing = getPersistedSection(sectionId, workspaceId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'updateSectionStatus: section not found');
    return null;
  }
  // Conflict classification is part of the public mutation contract. A caller
  // that observed an older revision gets a deterministic 409 even when the
  // newer state would also make the requested lifecycle transition invalid.
  if (expectedRevision !== undefined && expectedRevision !== existing.generationRevision) {
    throw new GenerationRevisionConflictError('copy_section', sectionId, expectedRevision);
  }
  // Route through the shared state machine. Preserve the historical return-null-on-
  // invalid contract (the route maps null → 404) by catching InvalidTransitionError
  // rather than propagating it — a bulk send-to-client transaction must not abort on
  // one illegal section.
  try {
    validateTransition('copy_section', COPY_SECTION_TRANSITIONS, existing.status, status);
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      log.warn({ sectionId, from: existing.status, to: status }, 'updateSectionStatus: invalid status transition');
      return null;
    }
    throw err;
  }

  const now = nextMutationTimestamp(existing.updatedAt);
  const changed = stmts().updateSectionStatus.run({
    id: sectionId,
    workspace_id: workspaceId,
    status,
    expected_revision: expectedRevision ?? existing.generationRevision,
    updated_at: now,
  }).changes;
  if (changed !== 1) {
    if (expectedRevision !== undefined) {
      throw new GenerationRevisionConflictError('copy_section', sectionId, expectedRevision);
    }
    return null;
  }

  const updated = getPersistedSection(sectionId, workspaceId);

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
  expectedRevision?: number,
): PersistedCopySection | null {
  const existing = getPersistedSection(sectionId, workspaceId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'addSteeringEntry: section not found');
    return null;
  }

  const now = nextMutationTimestamp(existing.updatedAt);
  const newEntry: SteeringEntry = {
    ...entry,
    timestamp: now,
  };

  const updated = [...existing.steeringHistory, newEntry];

  const changed = stmts().updateSectionSteering.run({
    id: sectionId,
    workspace_id: workspaceId,
    steering_history: JSON.stringify(updated),
    expected_revision: expectedRevision ?? existing.generationRevision,
    updated_at: now,
  }).changes;
  if (changed !== 1) {
    if (expectedRevision !== undefined) {
      throw new GenerationRevisionConflictError('copy_section', sectionId, expectedRevision);
    }
    return null;
  }

  return getPersistedSection(sectionId, workspaceId);
}

// Client suggestions (appends, sets status to 'revision_requested')
export function addClientSuggestion(
  sectionId: string,
  workspaceId: string,
  suggestion: Omit<ClientSuggestion, 'timestamp' | 'status'>,
  expectedRevision?: number,
): PersistedCopySection | null {
  const existing = getPersistedSection(sectionId, workspaceId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'addClientSuggestion: section not found');
    return null;
  }
  if (expectedRevision !== undefined && expectedRevision !== existing.generationRevision) {
    throw new GenerationRevisionConflictError('copy_section', sectionId, expectedRevision);
  }
  if (existing.generatedCopy === null || suggestion.originalText !== existing.generatedCopy) {
    throw new CopySuggestionOriginalMismatchError(sectionId);
  }

  const now = nextMutationTimestamp(existing.updatedAt);
  const newSuggestion: ClientSuggestion = {
    ...suggestion,
    status: 'pending',
    timestamp: now,
  };

  const currentSuggestions = existing.clientSuggestions ?? [];
  const updatedSuggestions = [...currentSuggestions, newSuggestion];

  // Determine new status: only client_review → revision_requested is a valid transition.
  // draft sections receive a suggestion but stay in draft until sent for client review.
  let newStatus = existing.status;
  if (existing.status === 'client_review') {
    newStatus = 'revision_requested';
  }

  const changed = stmts().updateSectionClientSuggestions.run({
    id: sectionId,
    workspace_id: workspaceId,
    client_suggestions: JSON.stringify(updatedSuggestions),
    status: newStatus,
    expected_revision: expectedRevision ?? existing.generationRevision,
    updated_at: now,
  }).changes;
  if (changed !== 1) {
    if (expectedRevision !== undefined) {
      throw new GenerationRevisionConflictError('copy_section', sectionId, expectedRevision);
    }
    return null;
  }

  return getPersistedSection(sectionId, workspaceId);
}

// Manual edit (status → 'draft', version++)
export function updateCopyText(
  sectionId: string,
  workspaceId: string,
  newCopy: string,
  expectedRevision?: number,
): PersistedCopySection | null {
  const existing = getPersistedSection(sectionId, workspaceId);
  if (!existing) {
    log.warn({ sectionId, workspaceId }, 'updateCopyText: section not found');
    return null;
  }
  if (expectedRevision !== undefined && expectedRevision !== existing.generationRevision) {
    throw new GenerationRevisionConflictError('copy_section', sectionId, expectedRevision);
  }
  if (existing.status === 'approved') {
    log.warn({ sectionId, workspaceId }, 'updateCopyText: cannot edit approved section');
    return null;
  }
  if (existing.status === 'draft' && existing.generatedCopy === newCopy) {
    return existing;
  }

  const now = nextMutationTimestamp(existing.updatedAt);
  const newVersion = existing.version + 1;

  const changed = stmts().updateSectionText.run({
    id: sectionId,
    workspace_id: workspaceId,
    generated_copy: newCopy,
    status: 'draft',
    version: newVersion,
    expected_revision: expectedRevision ?? existing.generationRevision,
    updated_at: now,
  }).changes;
  if (changed !== 1) {
    if (expectedRevision !== undefined) {
      throw new GenerationRevisionConflictError('copy_section', sectionId, expectedRevision);
    }
    return null;
  }

  return getPersistedSection(sectionId, workspaceId);
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
