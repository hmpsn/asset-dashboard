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
  applyKeywordCommandCenterBulkAction,
  buildKeywordCommandCenterDetail,
  buildKeywordCommandCenterRows,
  buildKeywordCommandCenterSummary,
  deleteKeywordHard,
} from '../keyword-command-center.js';
import { InvalidTransitionError } from '../state-machines.js';
import { getWorkspace } from '../workspaces.js';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  KEYWORD_COMMAND_CENTER_BULK_ACTIONS,
  KEYWORD_COMMAND_CENTER_FILTERS,
} from '../../shared/types/keyword-command-center.js';

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

const bulkActionSchema = z.object({
  action: z.enum(KEYWORD_COMMAND_CENTER_BULK_ACTIONS),
  keywords: z.array(z.string().min(1).max(200)).min(1).max(50),
  reason: z.string().max(500).optional(),
  force: z.boolean().optional(),
}).strict();

const rowsQuerySchema = z.object({
  filter: z.enum([
    KEYWORD_COMMAND_CENTER_FILTERS.ALL,
    KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY,
    KEYWORD_COMMAND_CENTER_FILTERS.TRACKED,
    KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW,
    KEYWORD_COMMAND_CENTER_FILTERS.CONTENT,
    KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED,
    KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE,
    KEYWORD_COMMAND_CENTER_FILTERS.LOCAL,
    KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES,
    KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY,
    KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH,
    KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE,
    KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED,
    KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED,
    KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED,
    KEYWORD_COMMAND_CENTER_FILTERS.DECLINED,
    KEYWORD_COMMAND_CENTER_FILTERS.RETIRED,
    KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY,
    KEYWORD_COMMAND_CENTER_FILTERS.STRIKING_DISTANCE,
  ]).optional(),
  search: z.string().optional(),
  sort: z.enum(['priority', 'keyword', 'demand', 'rank', 'clicks', 'difficulty', 'opportunity']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

const detailQuerySchema = z.object({
  keyword: z.string().min(1),
}).strict();

router.get('/api/webflow/keyword-command-center/:workspaceId/summary', requireWorkspaceAccess('workspaceId'), async (req, res, next) => {
  try {
    const payload = await buildKeywordCommandCenterSummary(req.params.workspaceId, {
      includeLocalSeo: true,
    });
    if (!payload) return res.status(404).json({ error: 'Workspace not found' });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get('/api/webflow/keyword-command-center/:workspaceId/rows', requireWorkspaceAccess('workspaceId'), async (req, res, next) => {
  try {
    const parsed = rowsQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid query' });
    const payload = await buildKeywordCommandCenterRows(req.params.workspaceId, parsed.data, {
      includeLocalSeo: true,
    });
    if (!payload) return res.status(404).json({ error: 'Workspace not found' });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get('/api/webflow/keyword-command-center/:workspaceId/detail', requireWorkspaceAccess('workspaceId'), async (req, res, next) => {
  try {
    const parsed = detailQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid query' });
    if (!getWorkspace(req.params.workspaceId)) return res.status(404).json({ error: 'Workspace not found' });
    const payload = await buildKeywordCommandCenterDetail(req.params.workspaceId, parsed.data.keyword, {
      includeLocalSeo: true,
    });
    if (!payload) return res.status(404).json({ error: 'Keyword not found' });
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
    if (message === 'Keyword is not tracked') return res.status(404).json({ error: message });
    if (message === 'keyword required') return res.status(400).json({ error: message });
    // Illegal lifecycle move (e.g. retire an already-retired keyword) — 409 Conflict.
    if (err instanceof InvalidTransitionError) return res.status(409).json({ error: message });
    if (message.includes('requires explicit confirmation')) return res.status(409).json({ error: message });
    next(err);
  }
});

// Hard-delete a tracked keyword — its OWN channel, deliberately NOT a lifecycle action
// (never in actionSchema / the bulk set). Ineligible (pinned / client / gap provenance)
// without ?force=true → 403; retire is the soft alternative. Drops rank history too.
router.delete('/api/webflow/keyword-command-center/:workspaceId/keywords/:keyword', requireWorkspaceAccess('workspaceId'), (req, res, next) => {
  try {
    const keyword = req.params.keyword;
    const force = req.query.force === 'true';
    const result = deleteKeywordHard(req.params.workspaceId, keyword, { force });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Keyword delete failed';
    if (message === 'Workspace not found') return res.status(404).json({ error: message });
    if (message === 'Keyword is not tracked') return res.status(404).json({ error: message });
    if (message === 'keyword required') return res.status(400).json({ error: message });
    if (message.includes('not eligible for permanent deletion')) return res.status(403).json({ error: message });
    next(err);
  }
});

router.post('/api/webflow/keyword-command-center/:workspaceId/actions/bulk', requireWorkspaceAccess('workspaceId'), validate(bulkActionSchema), (req, res, next) => {
  try {
    const result = applyKeywordCommandCenterBulkAction(req.params.workspaceId, req.body);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bulk keyword action failed';
    if (message === 'Workspace not found') return res.status(404).json({ error: message });
    if (message === 'keywords required') return res.status(400).json({ error: message });
    next(err);
  }
});

export default router;
