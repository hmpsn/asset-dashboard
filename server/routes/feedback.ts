import { Router } from 'express';
import { listFeedback, listAllFeedback, updateFeedbackStatus, addFeedbackReply, deleteFeedback } from '../feedback.js';
import { validate, z } from '../middleware/validate.js';

import { requireWorkspaceAccess } from '../auth.js';
const router = Router();

const updateFeedbackStatusSchema = z.object({
  status: z.enum(['new', 'acknowledged', 'fixed', 'wontfix'], {
    errorMap: () => ({ message: 'Invalid status' }),
  }),
});

const feedbackReplySchema = z.object({
  content: z.string({
    required_error: 'Content required',
    invalid_type_error: 'Content required',
  }).trim().min(1, 'Content required').max(5000),
});

/** List all feedback across all workspaces (admin command center) */
router.get('/api/feedback', (_req, res) => {
  try {
    const all = listAllFeedback();
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/** List feedback for a specific workspace */
router.get('/api/feedback/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {
  try {
    const items = listFeedback(req.params.workspaceId);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/** Update feedback status (admin) */
router.patch('/api/feedback/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), validate(updateFeedbackStatusSchema), (req, res) => {
  const { status } = req.body;
  const item = updateFeedbackStatus(req.params.workspaceId, req.params.id, status);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

/** Add admin reply to feedback */
router.post('/api/feedback/:workspaceId/:id/reply', requireWorkspaceAccess('workspaceId'), validate(feedbackReplySchema), (req, res) => {
  const { content } = req.body;
  const item = addFeedbackReply(req.params.workspaceId, req.params.id, 'team', content);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

/** Delete feedback item */
router.delete('/api/feedback/:workspaceId/:id', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const ok = deleteFeedback(req.params.workspaceId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

export default router;
