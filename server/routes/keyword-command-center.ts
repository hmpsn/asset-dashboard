/**
 * Keyword Command Center routes.
 *
 * @reads workspaces, keyword_strategy, page_keywords, content_gaps, keyword_gaps, keyword_feedback, rank_tracking_config, rank_snapshots
 * @writes rank_tracking_config, keyword_feedback, activities, intelligence_cache
 */
import { Router } from 'express';

import { requireWorkspaceAccess } from '../auth.js';
import { validate, z } from '../middleware/validate.js';
import {
  applyKeywordCommandCenterAction,
  buildKeywordCommandCenter,
} from '../keyword-command-center.js';
import { KEYWORD_COMMAND_CENTER_ACTIONS } from '../../shared/types/keyword-command-center.js';

const router = Router();

const actionSchema = z.object({
  action: z.enum([
    KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
    KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE,
    KEYWORD_COMMAND_CENTER_ACTIONS.TRACK,
    KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
    KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
    KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
    KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE,
  ]),
  keyword: z.string().min(1),
  pagePath: z.string().optional(),
  reason: z.string().optional(),
  force: z.boolean().optional(),
}).strict();

router.get('/api/webflow/keyword-command-center/:workspaceId', requireWorkspaceAccess('workspaceId'), async (req, res, next) => {
  try {
    const payload = await buildKeywordCommandCenter(req.params.workspaceId);
    if (!payload) return res.status(404).json({ error: 'Workspace not found' });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/api/webflow/keyword-command-center/:workspaceId/actions', requireWorkspaceAccess('workspaceId'), validate(actionSchema), (req, res, next) => {
  try {
    const result = applyKeywordCommandCenterAction(req.params.workspaceId, req.body);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Keyword action failed';
    if (message === 'Workspace not found') return res.status(404).json({ error: message });
    if (message === 'keyword required') return res.status(400).json({ error: message });
    if (message.includes('requires explicit confirmation')) return res.status(409).json({ error: message });
    next(err);
  }
});

export default router;
