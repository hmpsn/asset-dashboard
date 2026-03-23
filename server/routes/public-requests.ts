/**
 * public-requests routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import fs from 'fs';
import path from 'path';
import { broadcast, broadcastToWorkspace } from '../broadcast.js';
import { notifyTeamNewRequest } from '../email.js';
import { upload } from '../middleware.js';
import {
  listRequests,
  createRequest,
  addNote,
  getRequest,
  addAttachmentsToRequest,
  getAttachmentsDir,
  type RequestAttachment,
} from '../requests.js';
import { getWorkspace } from '../workspaces.js';
import { validate, z } from '../middleware/validate.js';

const createRequestSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  description: z.string().min(1, 'Description is required').max(5000),
  category: z.string().min(1, 'Category is required'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  pageUrl: z.string().url().optional().or(z.literal('')),
  submittedBy: z.string().max(200).optional(),
});

// --- Request Attachments ---
function processUploadedAttachments(files: Express.Multer.File[]): RequestAttachment[] {
  const dir = getAttachmentsDir();
  return files.map(f => {
    const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const ext = path.extname(f.originalname) || '';
    const filename = `${id}${ext}`;
    fs.renameSync(f.path, path.join(dir, filename));
    return { id, filename, originalName: f.originalname, mimeType: f.mimetype, size: f.size };
  });
}

// --- Client Requests ---
// Public: client creates a request
router.post('/api/public/requests/:workspaceId', validate(createRequestSchema), (req, res) => {
  const { title, description, category, priority, pageUrl, submittedBy } = req.body;
  const request = createRequest(req.params.workspaceId, { title, description, category, priority, pageUrl, submittedBy });
  broadcast('request:created', request);
  broadcastToWorkspace(req.params.workspaceId, 'request:created', { id: request.id });
  // Email team
  const ws = getWorkspace(req.params.workspaceId);
  if (ws) {
    notifyTeamNewRequest({ workspaceName: ws.name, workspaceId: req.params.workspaceId, title, description, category, submittedBy, pageUrl });
  }
  res.json(request);
});

// Public: client lists their requests
router.get('/api/public/requests/:workspaceId', (req, res) => {
  res.json(listRequests(req.params.workspaceId));
});

// Public: client views a single request (with notes)
router.get('/api/public/requests/:workspaceId/:requestId', (req, res) => {
  const r = getRequest(req.params.requestId);
  if (!r || r.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

// Public: client adds a note
router.post('/api/public/requests/:workspaceId/:requestId/notes', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const r = getRequest(req.params.requestId);
  if (!r || r.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: 'Not found' });
  const updated = addNote(req.params.requestId, 'client', content);
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  broadcast('request:updated', updated);
  broadcastToWorkspace(req.params.workspaceId, 'request:update', { id: updated.id });
  res.json(updated);
});

// Upload attachments to an existing request (client or team)
router.post('/api/public/requests/:workspaceId/:requestId/attachments', upload.array('files', 5), (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files?.length) return res.status(400).json({ error: 'No files' });
  const r = getRequest(req.params.requestId);
  if (!r || r.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: 'Not found' });
  const atts = processUploadedAttachments(files);
  const updated = addAttachmentsToRequest(req.params.requestId, atts);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  broadcast('request:updated', updated);
  broadcastToWorkspace(req.params.workspaceId, 'request:update', { id: updated.id });
  res.json(updated);
});

// Upload attachments with a note (public client)
router.post('/api/public/requests/:workspaceId/:requestId/notes-with-files', upload.array('files', 5), (req, res) => {
  const content = req.body.content || '';
  const files = req.files as Express.Multer.File[];
  if (!content && !files?.length) return res.status(400).json({ error: 'content or files required' });
  const r = getRequest(req.params.requestId);
  if (!r || r.workspaceId !== req.params.workspaceId) return res.status(404).json({ error: 'Not found' });
  const atts = files?.length ? processUploadedAttachments(files) : undefined;
  const updated = addNote(req.params.requestId, 'client', content, atts);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  broadcast('request:updated', updated);
  broadcastToWorkspace(req.params.workspaceId, 'request:update', { id: updated.id });
  res.json(updated);
});

export default router;
