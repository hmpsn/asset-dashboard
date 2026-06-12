// server/routes/copy-pipeline.ts
// Express routes for the Copy Pipeline (Phase 3 — Full Copy Pipeline).
// Covers: generation, regeneration, review, batch, export, and intelligence patterns.

import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { aiLimiter } from '../middleware.js';
import { getWorkspace } from '../workspaces.js';
import { validate, z } from '../middleware/validate.js';
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
  updatePatternSchema,
  extractPatternsSchema,
  startBatchSchema,
  exportCopySchema,
} from '../schemas/copy-pipeline.js';
import {
  getSectionsForEntry,
  getMetadata,
  updateSectionStatus,
  updateCopyText,
  addClientSuggestion,
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
import { getBlueprint } from '../page-strategy.js';
import {
  createCopyBatchGenerationJob,
  getCopyBatchJob,
  runCopyBatchGenerationJob,
} from '../copy-batch-jobs.js';
import { hasActiveJob, createJob } from '../jobs.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { runCopyEntryGenerationJob } from '../copy-entry-generation-job.js';

const router = Router();
const log = createLogger('copy-pipeline-routes');

function notifyCopyPipelineUpdated(workspaceId: string): void {
  invalidateContentPipelineIntelligence(workspaceId);
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
    const { accumulatedSteering } = req.body as { accumulatedSteering?: string[] };
    const job = createJob(BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION, { workspaceId });
    setImmediate(() => {
      void runCopyEntryGenerationJob({
        jobId: job.id,
        workspaceId,
        blueprintId,
        entryId,
        accumulatedSteering,
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
    const { note, highlight } = req.body as { note: string; highlight?: string };
    try {
      const section = await regenerateSection(
        workspaceId,
        blueprintId,
        entryId,
        sectionId,
        note,
        highlight,
      );
      if (!section) return res.status(404).json({ error: 'Section not found or regeneration failed' });
      notifyCopyPipelineUpdated(workspaceId);
      broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, { sectionId, status: section.status });
      addActivity(workspaceId, 'copy_generated', `Regenerated copy section`);
      return res.json(section);
    } catch (err) {
      log.error({ err, workspaceId, sectionId }, 'Section regeneration failed');
      return res.status(500).json({ error: 'Section regeneration failed' });
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
    const { status } = req.body as { status: string };
    const section = updateSectionStatus(sectionId, workspaceId, status as Parameters<typeof updateSectionStatus>[2]);
    if (!section) return res.status(404).json({ error: 'Section not found or invalid status transition' });
    notifyCopyPipelineUpdated(workspaceId);
    broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, { sectionId, status: section.status });
    if (status === 'approved') {
      addActivity(workspaceId, 'copy_approved', `Approved copy section`);
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
    const { copy } = req.body as { copy: string };
    const section = updateCopyText(sectionId, workspaceId, copy);
    if (!section) return res.status(404).json({ error: 'Section not found' });
    notifyCopyPipelineUpdated(workspaceId);
    broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, { sectionId, status: section.status });
    addActivity(workspaceId, 'copy_section_edited', `Edited copy section text`);
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
    const { originalText, suggestedText } = req.body as { originalText: string; suggestedText: string };
    const section = addClientSuggestion(sectionId, workspaceId, { originalText, suggestedText });
    if (!section) return res.status(404).json({ error: 'Section not found' });
    notifyCopyPipelineUpdated(workspaceId);
    broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, { sectionId, status: section.status });
    addActivity(workspaceId, 'copy_suggestion_added', `Client suggestion added to section`);
    return res.json(section);
  },
);

// POST /api/copy/:workspaceId/:blueprintId/:entryId/send-to-client
// Bulk-transitions all draft sections for an entry to client_review.
router.post(
  '/api/copy/:workspaceId/:blueprintId/:entryId/send-to-client',
  requireWorkspaceAccess('workspaceId'),
  validate(z.object({})),
  (req, res) => {
    const { workspaceId, entryId } = req.params;
    const sections = getSectionsForEntry(entryId, workspaceId);
    const draftSections = sections.filter(s => s.status === 'draft');
    if (draftSections.length === 0) return res.status(400).json({ error: 'No draft sections to send' });
    // blueprintId is in the URL for API consistency with other entry-scoped routes but is
    // not needed here — sections are scoped by entryId + workspaceId.
    const bulkTransition = db.transaction((): number => {
      let count = 0;
      for (const s of draftSections) {
        if (updateSectionStatus(s.id, workspaceId, 'client_review')) count++;
      }
      return count;
    });
    const sent = bulkTransition();
    notifyCopyPipelineUpdated(workspaceId);
    broadcastToWorkspace(workspaceId, WS_EVENTS.COPY_SECTION_UPDATED, { entryId, action: 'sent_to_client' });
    addActivity(workspaceId, 'copy_sent_to_client', `Sent ${sent} section${sent !== 1 ? 's' : ''} for client review`);
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
    const activeCopyBatchJob = hasActiveJob(BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION, workspaceId);
    if (activeCopyBatchJob) {
      return res.status(409).json({ error: 'Copy batch generation is already running for this workspace', jobId: activeCopyBatchJob.id });
    }

    try {
      const started = createCopyBatchGenerationJob({ workspaceId, blueprintId, entryIds, mode, batchSize });
      res.json(started);
      setTimeout(() => {
        void runCopyBatchGenerationJob({ workspaceId, blueprintId, entryIds, mode, batchSize, ...started });
      }, 100);
    } catch (err) {
      if (err instanceof Error && err.message === 'Blueprint not found') {
        return res.status(404).json({ error: 'Blueprint not found' });
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
