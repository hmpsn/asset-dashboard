// server/routes/briefing.ts
// Admin routes for the weekly client briefing pipeline.
//
// Endpoints:
//   GET  /api/briefing/:workspaceId/drafts
//   PATCH /api/briefing/:workspaceId/drafts/:draftId/stories
//   POST  /api/briefing/:workspaceId/drafts/:draftId/approve
//   POST  /api/briefing/:workspaceId/drafts/:draftId/publish
//   POST  /api/briefing/:workspaceId/drafts/:draftId/skip
//   POST  /api/briefing/:workspaceId/generate-now

import { Router } from 'express';
import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import {
  listBriefingDrafts,
  getBriefingById,
  updateBriefingStories,
  markApproved,
  markPublished,
  markSkipped,
  briefingStorySchema,
} from '../briefing-store.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { addActivity } from '../activity-log.js';
import { InvalidTransitionError } from '../state-machines.js';
import { createLogger } from '../logger.js';

const log = createLogger('routes:briefing');
const router = Router();

// ── GET /api/briefing/:workspaceId/drafts ─────────────────────────────────────

router.get(
  '/api/briefing/:workspaceId/drafts',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const drafts = listBriefingDrafts(req.params.workspaceId, 12);
    res.json({ drafts });
  },
);

// ── PATCH /api/briefing/:workspaceId/drafts/:draftId/stories ──────────────────

const patchStoriesSchema = z.object({
  stories: z.array(briefingStorySchema).min(1).max(5)
    .refine(
      arr => arr.filter(s => s.isHeadline).length === 1,
      'exactly one story must have isHeadline=true',
    ),
});

router.patch(
  '/api/briefing/:workspaceId/drafts/:draftId/stories',
  requireWorkspaceAccess('workspaceId'),
  validate(patchStoriesSchema),
  (req, res) => {
    const draft = getBriefingById(req.params.draftId);
    if (!draft || draft.workspaceId !== req.params.workspaceId) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    if (draft.status === 'published') {
      return res.status(409).json({ error: 'Cannot edit published briefing' });
    }
    const updated = updateBriefingStories(req.params.workspaceId, draft.id, req.body.stories);
    if (!updated) {
      return res.status(409).json({ error: 'Update rejected (status guard)' });
    }
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRIEFING_GENERATED, {
      briefingId: updated.id,
      action: 'edited',
    });
    return res.json({ draft: updated });
  },
);

// ── POST /api/briefing/:workspaceId/drafts/:draftId/approve ──────────────────

const approveSchema = z.object({
  adminNote: z.string().max(500).optional(),
});

router.post(
  '/api/briefing/:workspaceId/drafts/:draftId/approve',
  requireWorkspaceAccess('workspaceId'),
  validate(approveSchema),
  (req, res) => {
    try {
      const updated = markApproved(req.params.workspaceId, req.params.draftId, req.body.adminNote);
      if (!updated) {
        return res.status(404).json({ error: 'Draft not found' });
      }
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRIEFING_GENERATED, {
        briefingId: updated.id,
        action: 'approved',
      });
      return res.json({ draft: updated });
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        return res.status(409).json({ error: err.message });
      }
      throw err;
    }
  },
);

// ── POST /api/briefing/:workspaceId/drafts/:draftId/publish ──────────────────

const publishSchema = z.object({
  adminNote: z.string().max(500).optional(),
});

router.post(
  '/api/briefing/:workspaceId/drafts/:draftId/publish',
  requireWorkspaceAccess('workspaceId'),
  validate(publishSchema),
  (req, res) => {
    const draft = getBriefingById(req.params.draftId);
    if (!draft || draft.workspaceId !== req.params.workspaceId) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    if (draft.stories.length < 3) {
      return res.status(409).json({ error: 'Briefing needs at least 3 stories' });
    }

    try {
      const updated = markPublished(req.params.workspaceId, draft.id, {
        autoPublished: false,
        adminNote: req.body.adminNote,
      });
      if (!updated) {
        return res.status(404).json({ error: 'Draft not found' });
      }

      addActivity(
        req.params.workspaceId,
        'briefing_published',
        `Briefing published — ${updated.weekOf}`,
        `${updated.stories.length} stories`,
        { briefingId: updated.id, weekOf: updated.weekOf, autoPublished: false },
      );
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRIEFING_PUBLISHED, {
        briefingId: updated.id,
        weekOf: updated.weekOf,
      });
      return res.json({ draft: updated });
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        return res.status(409).json({ error: err.message });
      }
      throw err;
    }
  },
);

// ── POST /api/briefing/:workspaceId/drafts/:draftId/skip ─────────────────────

const skipSchema = z.object({
  adminNote: z.string().min(1).max(500),
});

router.post(
  '/api/briefing/:workspaceId/drafts/:draftId/skip',
  requireWorkspaceAccess('workspaceId'),
  validate(skipSchema),
  (req, res) => {
    try {
      const updated = markSkipped(req.params.workspaceId, req.params.draftId, req.body.adminNote);
      if (!updated) {
        return res.status(404).json({ error: 'Draft not found' });
      }
      addActivity(
        req.params.workspaceId,
        'briefing_skipped',
        `Briefing skipped — ${updated.weekOf}`,
        req.body.adminNote,
        { briefingId: updated.id },
      );
      broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.BRIEFING_GENERATED, {
        briefingId: updated.id,
        action: 'skipped',
      });
      return res.json({ draft: updated });
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        return res.status(409).json({ error: err.message });
      }
      throw err;
    }
  },
);

// ── POST /api/briefing/:workspaceId/generate-now ─────────────────────────────
// Admin manual trigger. Lazy-imports briefing-cron.ts (created in T1.14).
// Returns 202 immediately; the cron runs in the background.

router.post(
  '/api/briefing/:workspaceId/generate-now',
  requireWorkspaceAccess('workspaceId'),
  async (req, res) => {
    try {
      // Lazy import — briefing-cron.ts is created in T1.14.
      // Use a computed specifier so bundlers/Vite don't try to resolve it at build time.
      // The try/catch handles MODULE_NOT_FOUND at runtime until T1.14 lands.
      const cronSpecifier = `../briefing-cron.js`; // catch-ok: MODULE_NOT_FOUND expected until T1.14
      const cronModule = await import(/* @vite-ignore */ cronSpecifier); // dynamic-import-ok: T1.14 module not yet present
      const runFn = (cronModule as Record<string, unknown>).runBriefingForWorkspace as ((wsId: string, opts: { manual: boolean }) => Promise<void>);
      runFn(req.params.workspaceId, { manual: true })
        .then(() => log.info({ workspaceId: req.params.workspaceId }, 'manual briefing run complete'))
        .catch((err: unknown) => log.error({ err, workspaceId: req.params.workspaceId }, 'manual briefing run failed'));
      return res.status(202).json({ accepted: true });
    } catch (err) { // catch-ok: MODULE_NOT_FOUND when briefing-cron.ts doesn't exist yet (T1.14)
      log.warn({ err, workspaceId: req.params.workspaceId }, 'briefing cron module not yet available — accepting trigger as no-op');
      return res.status(202).json({ accepted: true, note: 'cron module pending' });
    }
  },
);

export default router;
