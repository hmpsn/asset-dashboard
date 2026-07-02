/**
 * Suggested briefs API routes — CRUD for AI-generated content brief suggestions.
 */
import { Router } from 'express';
import { validate, z } from '../middleware/validate.js';
import { requireWorkspaceAccess } from '../auth.js';
import {
  listSuggestedBriefs,
  getSuggestedBrief,
  updateSuggestedBrief,
  dismissSuggestedBrief,
  snoozeSuggestedBrief,
  createSuggestedBrief,
} from '../suggested-briefs-store.js';
import { broadcastToWorkspace } from '../broadcast.js';
import { WS_EVENTS } from '../ws-events.js';
import { invalidateContentPipelineIntelligence } from '../intelligence-freshness.js';
import { addActivity } from '../activity-log.js';
import { buildPipelineSignals } from '../insight-feedback.js';
import { getInsights } from '../analytics-insights-store.js';
import { InvalidTransitionError } from '../state-machines.js';
import { createLogger } from '../logger.js';

const log = createLogger('suggested-briefs-route');

// Per-workspace last-seeded timestamp (in-process; resets on server restart).
// Prevents re-running expensive buildPipelineSignals on every panel poll.
// TTL of 4 hours — stale enough to not thrash, fresh enough to pick up new insights.
const SEEDING_TTL_MS = 4 * 60 * 60 * 1000;
const lastSeededAt = new Map<string, number>();

function seedRankingOpportunities(workspaceId: string): void {
  const now = Date.now();
  const last = lastSeededAt.get(workspaceId) ?? 0;
  if (now - last < SEEDING_TTL_MS) return; // already seeded recently — skip
  lastSeededAt.set(workspaceId, now);
  try {
    const insights = getInsights(workspaceId);
    const signals = buildPipelineSignals(insights);
    for (const signal of signals) {
      if (signal.type === 'suggested_brief' && signal.keyword) {
        createSuggestedBrief({
          workspaceId,
          keyword: signal.keyword,
          pageUrl: signal.pageUrl,
          source: 'ranking_opportunity',
          reason: signal.detail,
          priority: signal.impactScore >= 75 ? 'high' : signal.impactScore >= 50 ? 'medium' : 'low',
        });
      }
    }
  } catch (err) {
    log.warn({ err, workspaceId }, 'seedRankingOpportunities: signal build failed — skipping seeding');
  }
}

const router = Router();

// List suggested briefs for workspace.
// Seeds ranking_opportunity signals on first call (and every 4 h thereafter) so
// the panel always reflects the latest insights without a separate orphaned endpoint.
router.get(
  '/api/suggested-briefs/:workspaceId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const includeAll = req.query.all === 'true';
    // Seed before listing so the very first panel open includes current signals.
    seedRankingOpportunities(req.params.workspaceId);
    const briefs = listSuggestedBriefs(req.params.workspaceId, includeAll);
    res.json(briefs);
  },
);

// Get single suggested brief
router.get(
  '/api/suggested-briefs/:workspaceId/:briefId',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    const brief = getSuggestedBrief(req.params.briefId, req.params.workspaceId);
    if (!brief) return res.status(404).json({ error: 'Suggested brief not found' });
    res.json(brief);
  },
);

const updateSchema = z.object({
  status: z.enum(['accepted', 'dismissed']),
});

// Update status (accept/dismiss)
router.patch(
  '/api/suggested-briefs/:workspaceId/:briefId',
  requireWorkspaceAccess('workspaceId'),
  validate(updateSchema),
  (req, res) => {
    let updated;
    try {
      updated = updateSuggestedBrief(req.params.briefId, req.params.workspaceId, req.body.status);
    } catch (err) {
      if (err instanceof InvalidTransitionError) return res.status(409).json({ error: err.message });
      throw err;
    }
    if (!updated) return res.status(404).json({ error: 'Suggested brief not found' });
    invalidateContentPipelineIntelligence(req.params.workspaceId);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.SUGGESTED_BRIEF_UPDATED, { id: updated.id, status: updated.status });
    const activityType = req.body.status === 'accepted' ? 'suggested_brief_accepted' : 'suggested_brief_dismissed';
    addActivity(req.params.workspaceId, activityType, `Suggested brief ${req.body.status}: "${updated.keyword}"`);
    res.json(updated);
  },
);

const snoozeSchema = z.object({
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Snooze
router.post(
  '/api/suggested-briefs/:workspaceId/:briefId/snooze',
  requireWorkspaceAccess('workspaceId'),
  validate(snoozeSchema),
  (req, res) => {
    let snoozed;
    try {
      snoozed = snoozeSuggestedBrief(req.params.briefId, req.params.workspaceId, req.body.until);
    } catch (err) {
      if (err instanceof InvalidTransitionError) return res.status(409).json({ error: err.message });
      throw err;
    }
    if (!snoozed) return res.status(404).json({ error: 'Suggested brief not found' });
    invalidateContentPipelineIntelligence(req.params.workspaceId);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.SUGGESTED_BRIEF_UPDATED, { id: snoozed.id, status: snoozed.status });
    addActivity(req.params.workspaceId, 'suggested_brief_snoozed', `Suggested brief snoozed until ${req.body.until}: "${snoozed.keyword}"`);
    res.json(snoozed);
  },
);

// Dismiss
router.post(
  '/api/suggested-briefs/:workspaceId/:briefId/dismiss',
  requireWorkspaceAccess('workspaceId'),
  (req, res) => {
    let dismissed;
    try {
      dismissed = dismissSuggestedBrief(req.params.briefId, req.params.workspaceId);
    } catch (err) {
      if (err instanceof InvalidTransitionError) return res.status(409).json({ error: err.message });
      throw err;
    }
    if (!dismissed) return res.status(404).json({ error: 'Suggested brief not found' });
    invalidateContentPipelineIntelligence(req.params.workspaceId);
    broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.SUGGESTED_BRIEF_UPDATED, { id: dismissed.id, status: dismissed.status });
    addActivity(req.params.workspaceId, 'suggested_brief_dismissed', `Suggested brief dismissed: "${dismissed.keyword}"`);
    res.json(dismissed);
  },
);

export default router;
