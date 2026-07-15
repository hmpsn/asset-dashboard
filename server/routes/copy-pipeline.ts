// server/routes/copy-pipeline.ts
// Express routes for the Copy Pipeline (Phase 3 — Full Copy Pipeline).
// Covers: generation, regeneration, review, batch, export, and intelligence patterns.

import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { aiLimiter } from '../middleware.js';
import { getWorkspace } from '../workspaces.js';
import { validate } from '../middleware/validate.js';
import { addActivity } from '../activity-log.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { createLogger } from '../logger.js';
import db from '../db/index.js';
import {
  generateCopySchema,
  regenerateSectionSchema,
  updateSectionStatusSchema,
  updateSectionTextSchema,
  addSuggestionSchema,
  sendEntryToClientReviewSchema,
  updatePatternSchema,
  extractPatternsSchema,
  startBatchSchema,
  exportCopySchema,
} from '../schemas/copy-pipeline.js';
import {
  getSectionsForEntry,
  getSection,
  getMetadata,
  updateSectionStatus,
  updateCopyText,
  addClientSuggestion,
  CopySuggestionOriginalMismatchError,
  getEntryCopyStatus,
} from '../copy-review.js';
import { regenerateSection } from '../copy-generation.js';
import {
  getAllPatterns,
  getPatternsForPromotion,
  togglePattern,
  removePattern,
  updatePatternText,
  extractPatterns,
} from '../copy-intelligence.js';
import { exportCsv, exportCopyDeck, exportToWebflow } from '../copy-export.js';
import { invalidateContentPipelineIntelligence } from '../intelligence-freshness.js';
import { getBlueprint, getEntry } from '../page-strategy.js';
import {
  createCopyBatchGenerationJob,
  getCopyBatchJob,
  runCopyBatchGenerationJob,
} from '../copy-batch-jobs.js';
import {
  ActiveJobResourceConflict,
  createResourceScopedJob,
  getJob,
  runResourceScopedJobWorker,
  updateJob,
} from '../jobs.js';
import {
  BACKGROUND_JOB_TYPES,
  JOB_RESOURCE_TYPES,
} from '../../shared/types/background-jobs.js';
import { runCopyEntryGenerationJob } from '../copy-entry-generation-job.js';
import { GenerationRevisionConflictError } from '../generation-provenance.js';

const router = Router();
const log = createLogger('copy-pipeline-routes');

class CopyEntryRevisionConflictError extends Error {
  readonly code = 'generation_revision_conflict';

  constructor(entryId: string) {
    super(`Copy entry ${entryId} changed after it was read`);
    this.name = 'CopyEntryRevisionConflictError';
  }
}

class NoDraftCopySectionsError extends Error {
  constructor() {
    super('No draft sections to send');
    this.name = 'NoDraftCopySectionsError';
  }
}

function notifyCopyPipelineUpdated(workspaceId: string): void {
  invalidateContentPipelineIntelligence(workspaceId);
}

function runCopyPostCommitEffect(
  workspaceId: string,
  entryId: string,
  sectionId: string | undefined,
  effect: string,
  run: () => void,
): void {
  try {
    run();
  } catch (err) {
    log.warn(
      { err, workspaceId, entryId, sectionId, effect },
      'copy pipeline post-commit effect failed',
    );
  }
}

// ── Generation routes ────────────────────────────────────────────────────────

// POST /api/copy/:workspaceId/:blueprintId/:entryId/generate
// Enqueue copy generation for all sections of a blueprint entry.
// Returns { jobId } immediately; poll /api/jobs/:jobId for progress.
router.post(
  '/api/copy/:workspaceId/:blueprintId/:entryId/generate',
  requireWorkspaceAccess('workspaceId'),
  aiLimiter,
  validate(generateCopySchema),
  (req, res) => {
    const { workspaceId, blueprintId, entryId } = req.params;
    if (!getWorkspace(workspaceId)) return res.status(404).json({ error: 'Workspace not found' });
    if (!getEntry(workspaceId, blueprintId, entryId)) return res.status(404).json({ error: 'Entry not found' });
    const { accumulatedSteering } = req.body as { accumulatedSteering?: string[] };
    let job: ReturnType<typeof createResourceScopedJob>['job'];
    try {
      ({ job } = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
        workspaceId,
        resources: [{ resourceType: JOB_RESOURCE_TYPES.COPY_ENTRY, resourceId: entryId }],
      }));
    } catch (err) {
      if (err instanceof ActiveJobResourceConflict) {
        return res.status(409).json({
          error: 'Copy generation is already running for this entry',
          jobId: err.jobId,
        });
      }
      throw err;
    }
    setImmediate(() => {
      void runCopyEntryGenerationJob({
        jobId: job.id,
        workspaceId,
        blueprintId,
        entryId,
        accumulatedSteering,
      }).catch(err => {
        log.error({ err, jobId: job.id, workspaceId, blueprintId, entryId }, 'copy entry worker rejected after launch');
      });
    });
    return res.json({ jobId: job.id });
  },
);

// POST /api/copy/:workspaceId/:blueprintId/:entryId/regenerate/:sectionId
// Regenerate a single section with a steering note.
router.post(
  '/api/copy/:workspaceId/:blueprintId/:entryId/regenerate/:sectionId',
  requireWorkspaceAccess('workspaceId'),
  aiLimiter,
  validate(regenerateSectionSchema),
  async (req, res) => {
    const { workspaceId, blueprintId, entryId, sectionId } = req.params;
    const { note, highlight, expectedRevision } = req.body as {
      note: string;
      highlight?: string;
      expectedRevision: number;
    };
    const targetSection = getSection(sectionId, workspaceId);
    const entry = getEntry(workspaceId, blueprintId, entryId);
    if (!targetSection || targetSection.entryId !== entryId || !entry) {
      return res.status(404).json({ error: 'Section not found or regeneration failed' });
    }
    let jobId: string | undefined;
    let steeringAccepted = false;
    const committedState: { section: ReturnType<typeof getSection> } = { section: null };
    let completionTrackingError: unknown;
    try {
      const started = createResourceScopedJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, {
        workspaceId,
        message: 'Regenerating copy section...',
        resources: [{ resourceType: JOB_RESOURCE_TYPES.COPY_ENTRY, resourceId: entryId }],
        accept: () => {
          const current = getSection(sectionId, workspaceId);
          if (!current || current.generationRevision !== expectedRevision) {
            throw new GenerationRevisionConflictError('copy_section', sectionId, expectedRevision);
          }
          return current;
        },
      });
      jobId = started.job.id;
      const section = await runResourceScopedJobWorker(started.job.id, async () => {
        updateJob(started.job.id, { status: 'running', message: 'Regenerating copy section...' });
        let result: Awaited<ReturnType<typeof regenerateSection>>;
        try {
          result = await regenerateSection(
            workspaceId,
            blueprintId,
            entryId,
            sectionId,
            note,
            highlight,
            {
              expectedRevision,
              onSteeringAccepted: steered => {
                steeringAccepted = true;
                runCopyPostCommitEffect(workspaceId, entryId, sectionId, 'steering-intelligence-cache', () => {
                  notifyCopyPipelineUpdated(workspaceId);
                });
                runCopyPostCommitEffect(workspaceId, entryId, sectionId, 'steering-broadcast', () => {
                  broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, {
                    sectionId,
                    status: steered.status,
                    generationRevision: steered.generationRevision,
                    action: 'regeneration_steering_saved',
                  });
                });
                runCopyPostCommitEffect(workspaceId, entryId, sectionId, 'steering-activity', () => {
                  addActivity(
                    workspaceId,
                    'copy_section_edited',
                    'Saved copy regeneration steering',
                    undefined,
                    { entryId, sectionId, action: 'regeneration_steering_saved' },
                  );
                });
              },
            },
          );
          if (!result) {
            updateJob(started.job.id, {
              status: 'error',
              message: 'Copy section regeneration failed',
              error: 'Section not found or regeneration failed',
              result: { entryId, sectionId, status: 'error' },
            });
            return null;
          }
        } catch (err) {
          updateJob(started.job.id, {
            status: 'error',
            message: 'Copy section regeneration failed',
            error: err instanceof Error ? err.message : String(err),
            result: { entryId, sectionId, status: 'error' },
          });
          throw err;
        }

        // regenerateSection returns only after the section CAS commit. From
        // this point onward, terminal bookkeeping failures are infrastructure
        // failures and must never be presented as another paid-generation
        // failure or trigger the success-semantic post-commit effects below.
        committedState.section = result;
        try {
          updateJob(started.job.id, {
            status: 'done',
            message: 'Copy section regenerated',
            result: { entryId, sectionId },
          });
          if (getJob(started.job.id)?.status !== 'done') {
            throw new Error('Copy section completion state was not persisted');
          }
        } catch (err) {
          completionTrackingError = err;
          const errorMessage = err instanceof Error ? err.message : String(err);
          log.error(
            {
              err,
              workspaceId,
              entryId,
              sectionId,
              jobId: started.job.id,
              artifactCommitted: true,
              generationRevision: result.generationRevision,
            },
            'copy section artifact committed but completion tracking failed',
          );
          try {
            updateJob(started.job.id, {
              status: 'error',
              message: 'Copy section committed, but completion tracking failed',
              error: errorMessage,
              result: {
                entryId,
                sectionId,
                status: result.status,
                code: 'completion_tracking_failed',
                artifactCommitted: true,
                generationRevision: result.generationRevision,
              },
            });
          } catch (trackingErr) {
            log.error(
              { err: trackingErr, workspaceId, entryId, sectionId, jobId: started.job.id },
              'copy section completion-tracking failure could not be recorded',
            );
          }
        }
        return result;
      });
      if (!section) {
        return res.status(502).json({
          error: 'Copy regeneration failed after the steering note was saved',
          code: 'generation_failed_after_steering',
          section: getSection(sectionId, workspaceId),
          ...(jobId ? { jobId } : {}),
        });
      }
      if (completionTrackingError) {
        const errorMessage = completionTrackingError instanceof Error
          ? completionTrackingError.message
          : String(completionTrackingError);
        return res.json({
          ...section,
          completionTracking: {
            status: 'failed',
            code: 'completion_tracking_failed',
            artifactCommitted: true,
            message: 'The copy was saved, but completion tracking failed',
            error: errorMessage,
            ...(jobId ? { jobId } : {}),
          },
        });
      }
      runCopyPostCommitEffect(workspaceId, entryId, sectionId, 'intelligence-cache', () => {
        notifyCopyPipelineUpdated(workspaceId);
      });
      runCopyPostCommitEffect(workspaceId, entryId, sectionId, 'section-updated-broadcast', () => {
        broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, {
          sectionId,
          status: section.status,
        });
      });
      runCopyPostCommitEffect(workspaceId, entryId, sectionId, 'activity', () => {
        addActivity(workspaceId, 'copy_generated', 'Regenerated copy section');
      });
      return res.json(section);
    } catch (err) {
      if (err instanceof GenerationRevisionConflictError) {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      if (err instanceof ActiveJobResourceConflict) {
        return res.status(409).json({
          error: 'Copy generation is already running for this entry',
          code: err.code,
          jobId: err.jobId,
        });
      }
      const committedSection = committedState.section;
      if (committedSection) {
        const errorMessage = completionTrackingError instanceof Error
          ? completionTrackingError.message
          : String(completionTrackingError ?? err);
        return res.json({
          ...committedSection,
          completionTracking: {
            status: 'failed',
            code: 'completion_tracking_failed',
            artifactCommitted: true,
            message: 'The copy was saved, but completion tracking failed',
            error: errorMessage,
            ...(jobId ? { jobId } : {}),
          },
        });
      }
      if (steeringAccepted) {
        return res.status(502).json({
          error: 'Copy regeneration failed after the steering note was saved',
          code: 'generation_failed_after_steering',
          section: getSection(sectionId, workspaceId),
          ...(jobId ? { jobId } : {}),
        });
      }
      log.error({ err, workspaceId, sectionId }, 'Section regeneration failed');
      return res.status(500).json({
        error: 'Section regeneration failed',
        ...(jobId ? { jobId } : {}),
      });
    }
  },
);

// ── Entry read routes ────────────────────────────────────────────────────────
// IMPORTANT: /entry/:entryId/* routes must be registered before any
// /:sectionId param routes to avoid shadowing.

// GET /api/copy/:workspaceId/entry/:entryId/sections
router.get(
  '/api/copy/:workspaceId/entry/:entryId/sections',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId, entryId } = req.params;
    const sections = getSectionsForEntry(entryId, workspaceId);
    return res.json(sections);
  },
);

// GET /api/copy/:workspaceId/entry/:entryId/status
router.get(
  '/api/copy/:workspaceId/entry/:entryId/status',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId, entryId } = req.params;
    const status = getEntryCopyStatus(entryId, workspaceId);
    return res.json(status);
  },
);

// GET /api/copy/:workspaceId/entry/:entryId/metadata
router.get(
  '/api/copy/:workspaceId/entry/:entryId/metadata',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId, entryId } = req.params;
    const metadata = getMetadata(entryId, workspaceId);
    if (!metadata) return res.status(404).json({ error: 'Metadata not found' });
    return res.json(metadata);
  },
);

// ── Section mutation routes ──────────────────────────────────────────────────

// PATCH /api/copy/:workspaceId/section/:sectionId/status
router.patch(
  '/api/copy/:workspaceId/section/:sectionId/status',
  requireWorkspaceAccess('workspaceId'),
  validate(updateSectionStatusSchema),
  (req, res) => {
    const { workspaceId, sectionId } = req.params;
    const { status, expectedRevision } = req.body as { status: string; expectedRevision: number };
    let section: ReturnType<typeof updateSectionStatus>;
    try {
      section = updateSectionStatus(
        sectionId,
        workspaceId,
        status as Parameters<typeof updateSectionStatus>[2],
        expectedRevision,
      );
    } catch (err) {
      if (err instanceof GenerationRevisionConflictError) {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      throw err;
    }
    if (!section) return res.status(404).json({ error: 'Section not found or invalid status transition' });
    runCopyPostCommitEffect(workspaceId, section.entryId, sectionId, 'intelligence-cache', () => {
      notifyCopyPipelineUpdated(workspaceId);
    });
    runCopyPostCommitEffect(workspaceId, section.entryId, sectionId, 'section-updated-broadcast', () => {
      broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, {
        sectionId,
        status: section.status,
      });
    });
    if (status === 'approved') {
      runCopyPostCommitEffect(workspaceId, section.entryId, sectionId, 'activity', () => {
        addActivity(workspaceId, 'copy_approved', 'Approved copy section');
      });
    }
    return res.json(section);
  },
);

// PATCH /api/copy/:workspaceId/section/:sectionId/text
router.patch(
  '/api/copy/:workspaceId/section/:sectionId/text',
  requireWorkspaceAccess('workspaceId'),
  validate(updateSectionTextSchema),
  (req, res) => {
    const { workspaceId, sectionId } = req.params;
    const { copy, expectedRevision } = req.body as { copy: string; expectedRevision: number };
    let section: ReturnType<typeof updateCopyText>;
    try {
      section = updateCopyText(sectionId, workspaceId, copy, expectedRevision);
    } catch (err) {
      if (err instanceof GenerationRevisionConflictError) {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      throw err;
    }
    if (!section) return res.status(404).json({ error: 'Section not found' });
    if (section.generationRevision === expectedRevision) {
      return res.json(section);
    }
    runCopyPostCommitEffect(workspaceId, section.entryId, sectionId, 'intelligence-cache', () => {
      notifyCopyPipelineUpdated(workspaceId);
    });
    runCopyPostCommitEffect(workspaceId, section.entryId, sectionId, 'section-updated-broadcast', () => {
      broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, {
        sectionId,
        status: section.status,
      });
    });
    runCopyPostCommitEffect(workspaceId, section.entryId, sectionId, 'activity', () => {
      addActivity(workspaceId, 'copy_section_edited', 'Edited copy section text');
    });
    return res.json(section);
  },
);

// POST /api/copy/:workspaceId/section/:sectionId/suggest
router.post(
  '/api/copy/:workspaceId/section/:sectionId/suggest',
  requireWorkspaceAccess('workspaceId'),
  validate(addSuggestionSchema),
  (req, res) => {
    const { workspaceId, sectionId } = req.params;
    const { originalText, suggestedText, expectedRevision } = req.body as {
      originalText: string;
      suggestedText: string;
      expectedRevision: number;
    };
    let section: ReturnType<typeof addClientSuggestion>;
    try {
      section = addClientSuggestion(
        sectionId,
        workspaceId,
        { originalText, suggestedText },
        expectedRevision,
      );
    } catch (err) {
      if (err instanceof GenerationRevisionConflictError) {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      if (err instanceof CopySuggestionOriginalMismatchError) {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      throw err;
    }
    if (!section) return res.status(404).json({ error: 'Section not found' });
    runCopyPostCommitEffect(workspaceId, section.entryId, sectionId, 'intelligence-cache', () => {
      notifyCopyPipelineUpdated(workspaceId);
    });
    runCopyPostCommitEffect(workspaceId, section.entryId, sectionId, 'section-updated-broadcast', () => {
      broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, {
        sectionId,
        status: section.status,
      });
    });
    runCopyPostCommitEffect(workspaceId, section.entryId, sectionId, 'activity', () => {
      addActivity(workspaceId, 'copy_suggestion_added', 'Client suggestion added to section');
    });
    return res.json(section);
  },
);

// POST /api/copy/:workspaceId/:blueprintId/:entryId/send-to-client
// Bulk-transitions all draft sections for an entry to client_review.
router.post(
  '/api/copy/:workspaceId/:blueprintId/:entryId/send-to-client',
  requireWorkspaceAccess('workspaceId'),
  validate(sendEntryToClientReviewSchema),
  (req, res) => {
    const { workspaceId, blueprintId, entryId } = req.params;
    const { sectionRevisions } = req.body as {
      sectionRevisions: Array<{ sectionId: string; expectedRevision: number }>;
    };
    if (!getEntry(workspaceId, blueprintId, entryId)) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    const expectedById = new Map(
      sectionRevisions.map(section => [section.sectionId, section.expectedRevision]),
    );
    const bulkTransition = db.transaction((): number => {
      const draftSections = getSectionsForEntry(entryId, workspaceId)
        .filter(section => section.status === 'draft');
      if (draftSections.length === 0) {
        if (expectedById.size === 0) throw new NoDraftCopySectionsError();
        throw new CopyEntryRevisionConflictError(entryId);
      }
      const exactCensus = draftSections.length === expectedById.size
        && draftSections.every(section => (
          section.generationRevision !== undefined
          && expectedById.get(section.id) === section.generationRevision
        ));
      if (!exactCensus) throw new CopyEntryRevisionConflictError(entryId);

      for (const section of draftSections) {
        const expectedRevision = expectedById.get(section.id);
        if (expectedRevision === undefined
          || !updateSectionStatus(section.id, workspaceId, 'client_review', expectedRevision)) {
          throw new CopyEntryRevisionConflictError(entryId);
        }
      }
      return draftSections.length;
    });

    let sent: number;
    try {
      sent = bulkTransition.immediate();
    } catch (err) {
      if (err instanceof NoDraftCopySectionsError) {
        return res.status(400).json({ error: err.message });
      }
      if (err instanceof CopyEntryRevisionConflictError
        || err instanceof GenerationRevisionConflictError) {
        return res.status(409).json({
          error: err.message,
          code: 'generation_revision_conflict',
        });
      }
      throw err;
    }
    runCopyPostCommitEffect(workspaceId, entryId, undefined, 'intelligence-cache', () => {
      notifyCopyPipelineUpdated(workspaceId);
    });
    runCopyPostCommitEffect(workspaceId, entryId, undefined, 'entry-sent-broadcast', () => {
      broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, {
        entryId,
        action: 'sent_to_client',
      });
    });
    runCopyPostCommitEffect(workspaceId, entryId, undefined, 'activity', () => {
      addActivity(
        workspaceId,
        'copy_sent_to_client',
        `Sent ${sent} section${sent !== 1 ? 's' : ''} for client review`,
      );
    });
    return res.json({ sent });
  },
);

// ── Batch routes ─────────────────────────────────────────────────────────────

// POST /api/copy/:workspaceId/:blueprintId/batch
// Start a batch generation job; returns immediately with { batchId }.
router.post(
  '/api/copy/:workspaceId/:blueprintId/batch',
  requireWorkspaceAccess('workspaceId'),
  validate(startBatchSchema),
  (req, res) => {
    const { workspaceId, blueprintId } = req.params;
    const { entryIds, mode, batchSize } = req.body as { entryIds: string[]; mode?: string; batchSize?: number };
    const blueprint = getBlueprint(workspaceId, blueprintId);
    if (!blueprint) {
      return res.status(404).json({ error: 'Blueprint not found' });
    }
    try {
      const started = createCopyBatchGenerationJob({ workspaceId, blueprintId, entryIds, mode, batchSize });
      res.json(started);
      setTimeout(() => {
        void runCopyBatchGenerationJob({ workspaceId, blueprintId, entryIds, mode, batchSize, ...started }).catch(err => {
          log.error({ err, jobId: started.jobId, batchId: started.batchId, workspaceId, blueprintId }, 'copy batch worker rejected after launch');
        });
      }, 100);
    } catch (err) {
      if (err instanceof Error && err.message === 'Blueprint not found') {
        return res.status(404).json({ error: 'Blueprint not found' });
      }
      if (err instanceof ActiveJobResourceConflict) {
        return res.status(409).json({
          error: 'Copy generation is already running for one or more entries',
          jobId: err.jobId,
          conflicts: err.conflicts,
        });
      }
      log.error({ err, workspaceId, blueprintId }, 'Failed to start batch job');
      return res.status(500).json({ error: 'Failed to start batch job' });
    }
  },
);

// GET /api/copy/:workspaceId/batch/:batchId
router.get(
  '/api/copy/:workspaceId/batch/:batchId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId, batchId } = req.params;
    const job = getCopyBatchJob(workspaceId, batchId);
    if (!job) return res.status(404).json({ error: 'Batch job not found' });
    return res.json(job);
  },
);

// ── Export route ─────────────────────────────────────────────────────────────

// POST /api/copy/:workspaceId/:blueprintId/export
router.post(
  '/api/copy/:workspaceId/:blueprintId/export',
  requireWorkspaceAccess('workspaceId'),
  validate(exportCopySchema),
  async (req, res) => {
    const { workspaceId, blueprintId } = req.params;
    const { format, scope, entryIds, entryId, webflowSiteId } = req.body as {
      format: 'webflow_cms' | 'csv' | 'copy_deck';
      scope: 'all' | 'selected' | 'single';
      entryIds?: string[];
      entryId?: string;
      webflowSiteId?: string;
    };

    try {
      if (format === 'webflow_cms') {
        const ids = scope === 'selected' ? entryIds : scope === 'single' && entryId ? [entryId] : undefined;
        const result = await exportToWebflow(workspaceId, blueprintId, ids, webflowSiteId);
        broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_EXPORT_COMPLETE, { format, success: result.success });
        addActivity(workspaceId, 'copy_exported', `Exported copy as Webflow CMS`);
        return res.json(result);
      } else if (format === 'csv') {
        const ids = scope === 'single' ? (entryId ? [entryId] : undefined) : scope === 'selected' ? entryIds : undefined;
        const { csv, filename } = exportCsv(workspaceId, blueprintId, ids);
        broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_EXPORT_COMPLETE, { format, filename });
        addActivity(workspaceId, 'copy_exported', `Exported copy as CSV: ${filename}`);
        return res.json({ success: true, format: 'csv', filename, content: csv });
      } else {
        const ids = scope === 'single' ? (entryId ? [entryId] : undefined) : scope === 'selected' ? entryIds : undefined;
        const { markdown, filename } = exportCopyDeck(workspaceId, blueprintId, ids);
        broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_EXPORT_COMPLETE, { format, filename });
        addActivity(workspaceId, 'copy_exported', `Exported copy deck: ${filename}`);
        return res.json({ success: true, format: 'copy_deck', filename, content: markdown });
      }
    } catch (err) {
      log.error({ err, workspaceId, blueprintId, format }, 'Export failed');
      return res.status(500).json({ error: 'Export failed' });
    }
  },
);

// ── Intelligence routes ──────────────────────────────────────────────────────
// IMPORTANT: literal sub-paths (/promotable, /extract) MUST be registered
// before the param route (/:patternId).

// GET /api/copy/:workspaceId/intelligence — list all patterns
router.get(
  '/api/copy/:workspaceId/intelligence',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId } = req.params;
    const patterns = getAllPatterns(workspaceId);
    return res.json(patterns);
  },
);

// GET /api/copy/:workspaceId/intelligence/promotable — patterns with freq >= 3
// MUST be before /:patternId
router.get(
  '/api/copy/:workspaceId/intelligence/promotable',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId } = req.params;
    const patterns = getPatternsForPromotion(workspaceId);
    return res.json(patterns);
  },
);

// POST /api/copy/:workspaceId/intelligence/extract — extract patterns from steering notes
// MUST be before /:patternId
router.post(
  '/api/copy/:workspaceId/intelligence/extract',
  requireWorkspaceAccess('workspaceId'),
  aiLimiter,
  validate(extractPatternsSchema),
  async (req, res) => {
    const { workspaceId } = req.params;
    const { steeringNotes } = req.body as { steeringNotes: string[] };
    try {
      const patterns = await extractPatterns(workspaceId, steeringNotes);
      notifyCopyPipelineUpdated(workspaceId);
      broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_INTELLIGENCE_UPDATED, {
        extracted: patterns.length,
      });
      return res.json(patterns);
    } catch (err) {
      log.error({ err, workspaceId }, 'Pattern extraction failed');
      return res.status(500).json({ error: 'Pattern extraction failed' });
    }
  },
);

// PATCH /api/copy/:workspaceId/intelligence/:patternId — update pattern
router.patch(
  '/api/copy/:workspaceId/intelligence/:patternId',
  requireWorkspaceAccess('workspaceId'),
  validate(updatePatternSchema),
  (req, res) => {
    const { workspaceId, patternId } = req.params;
    const { active, pattern, patternType } = req.body as {
      active?: boolean;
      pattern?: string;
      patternType?: Parameters<typeof updatePatternText>[3];
    };
    try {
      if (active !== undefined) {
        togglePattern(patternId, workspaceId, active);
      }
      if (pattern !== undefined && patternType !== undefined) {
        updatePatternText(patternId, workspaceId, pattern, patternType);
      } else if (pattern !== undefined || patternType !== undefined) {
        return res.status(400).json({ error: 'Both pattern and patternType are required to update pattern text' });
      }
      notifyCopyPipelineUpdated(workspaceId);
      broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_INTELLIGENCE_UPDATED, { patternId });
      return res.json({ updated: true });
    } catch (err) {
      log.error({ err, workspaceId, patternId }, 'Pattern update failed');
      return res.status(500).json({ error: 'Pattern update failed' });
    }
  },
);

// DELETE /api/copy/:workspaceId/intelligence/:patternId — remove pattern
router.delete(
  '/api/copy/:workspaceId/intelligence/:patternId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const { workspaceId, patternId } = req.params;
    try {
      removePattern(patternId, workspaceId);
      notifyCopyPipelineUpdated(workspaceId);
      broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_INTELLIGENCE_UPDATED, { patternId, deleted: true });
      addActivity(workspaceId, 'copy_pattern_removed', `Removed copy intelligence pattern`);
      return res.status(204).send();
    } catch (err) {
      log.error({ err, workspaceId, patternId }, 'Pattern delete failed');
      return res.status(500).json({ error: 'Pattern delete failed' });
    }
  },
);

export default router;
