import { Router } from 'express';
import { createFeedback, listFeedback, addFeedbackReply } from '../feedback.js';
import { getWorkspace } from '../workspaces.js';
import { notifyTeamNewFeedback } from '../email.js';
import type { FeedbackType } from '../feedback.js';

const router = Router();

const VALID_TYPES: FeedbackType[] = ['bug', 'feature', 'general'];

/** Client submits feedback */
router.post('/api/public/feedback/:workspaceId', (req, res) => {
  const { workspaceId } = req.params;
  const { type, title, description, context, submittedBy } = req.body as {
    type?: string;
    title?: string;
    description?: string;
    context?: { currentTab?: string; browser?: string; screenSize?: string; url?: string; userAgent?: string };
    submittedBy?: string;
  };

  if (!type || !VALID_TYPES.includes(type as FeedbackType)) {
    return res.status(400).json({ error: 'Invalid type. Must be bug, feature, or general.' });
  }
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' });
  if (!description?.trim()) return res.status(400).json({ error: 'Description is required.' });

  const item = createFeedback(workspaceId, {
    type: type as FeedbackType,
    title: title.trim(),
    description: description.trim(),
    context,
    submittedBy: submittedBy?.trim(),
  });

  // Email notification to admin
  const ws = getWorkspace(workspaceId);
  if (ws) {
    notifyTeamNewFeedback({
      workspaceName: ws.name,
      workspaceId,
      feedbackType: type,
      title: title.trim(),
      description: description.trim().slice(0, 200),
    });
  }

  res.json(item);
});

/** Client views their feedback */
router.get('/api/public/feedback/:workspaceId', (req, res) => {
  const items = listFeedback(req.params.workspaceId);
  res.json(items);
});

/** Client adds a reply to their own feedback */
router.post('/api/public/feedback/:workspaceId/:id/reply', (req, res) => {
  const { content } = req.body as { content?: string };
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
  const item = addFeedbackReply(req.params.workspaceId, req.params.id, 'client', content.trim());
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

export default router;
