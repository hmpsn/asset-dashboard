import { Router } from 'express';
import { createFeedback, listFeedback, addFeedbackReply } from '../feedback.js';
import { getWorkspace } from '../workspaces.js';
import { notifyTeamNewFeedback } from '../email.js';
import { requireClientPortalAuth } from '../middleware.js';
import { validate, z } from '../middleware/validate.js';

const router = Router();

const feedbackTypeSchema = z.enum(['bug', 'feature', 'general'], {
  errorMap: () => ({ message: 'Invalid type. Must be bug, feature, or general.' }),
});

const publicFeedbackSchema = z.object({
  type: feedbackTypeSchema,
  title: z.string({
    required_error: 'Title is required.',
    invalid_type_error: 'Title is required.',
  }).trim().min(1, 'Title is required.').max(500),
  description: z.string({
    required_error: 'Description is required.',
    invalid_type_error: 'Description is required.',
  }).trim().min(1, 'Description is required.').max(5000),
  context: z.object({
    currentTab: z.string().trim().max(100).optional(),
    browser: z.string().trim().max(200).optional(),
    screenSize: z.string().trim().max(100).optional(),
    url: z.string().trim().max(1000).optional(),
    userAgent: z.string().trim().max(1000).optional(),
  }).optional(),
  submittedBy: z.string().trim().max(200).optional(),
});

const publicFeedbackReplySchema = z.object({
  content: z.string({
    required_error: 'Content required',
    invalid_type_error: 'Content required',
  }).trim().min(1, 'Content required').max(5000),
});

router.use('/api/public/feedback/:workspaceId', requireClientPortalAuth(), (req, res, next) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  next();
});

/** Client submits feedback */
router.post('/api/public/feedback/:workspaceId', validate(publicFeedbackSchema), (req, res) => {
  const { workspaceId } = req.params;
  const { type, title, description, context, submittedBy } = req.body;

  const item = createFeedback(workspaceId, {
    type,
    title,
    description,
    context,
    submittedBy,
  });

  // Email notification to admin
  const ws = getWorkspace(workspaceId);
  notifyTeamNewFeedback({
    workspaceName: ws?.name ?? workspaceId,
    workspaceId,
    feedbackType: type,
    title,
    description: description.slice(0, 200),
  });

  res.json(item);
});

/** Client views their feedback */
router.get('/api/public/feedback/:workspaceId', (req, res) => {
  const items = listFeedback(req.params.workspaceId);
  res.json(items);
});

/** Client adds a reply to their own feedback */
router.post('/api/public/feedback/:workspaceId/:id/reply', validate(publicFeedbackReplySchema), (req, res) => {
  const { content } = req.body;
  const item = addFeedbackReply(req.params.workspaceId, req.params.id, 'client', content);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

export default router;
