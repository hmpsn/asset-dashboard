import { Router } from 'express';
import { listFeedback, listAllFeedback, updateFeedbackStatus, addFeedbackReply, deleteFeedback } from '../feedback.js';
import type { FeedbackStatus } from '../feedback.js';

const router = Router();

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
router.get('/api/feedback/:workspaceId', (req, res) => {
  try {
    const items = listFeedback(req.params.workspaceId);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/** Update feedback status (admin) */
router.patch('/api/feedback/:workspaceId/:id', (req, res) => {
  const { status } = req.body as { status?: FeedbackStatus };
  if (!status || !['new', 'acknowledged', 'fixed', 'wontfix'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const item = updateFeedbackStatus(req.params.workspaceId, req.params.id, status);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

/** Add admin reply to feedback */
router.post('/api/feedback/:workspaceId/:id/reply', (req, res) => {
  const { content } = req.body as { content?: string };
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
  const item = addFeedbackReply(req.params.workspaceId, req.params.id, 'team', content.trim());
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

/** Delete feedback item */
router.delete('/api/feedback/:workspaceId/:id', (req, res) => {
  const ok = deleteFeedback(req.params.workspaceId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

export default router;
