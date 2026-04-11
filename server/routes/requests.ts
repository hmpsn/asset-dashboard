/**
 * requests routes — extracted from server/index.ts
 */
import { Router } from 'express';

const router = Router();

import fs from 'fs';
import path from 'path';
import { addActivity } from '../activity-log.js';
import { broadcast, broadcastToWorkspace } from '../broadcast.js';
import { STUDIO_NAME } from '../constants.js';
import { notifyClientTeamResponse, notifyClientStatusChange } from '../email.js';
import { upload } from '../middleware.js';
import {
  listRequests,
  createRequest,
  updateRequest,
  addNote,
  deleteRequest,
  getRequest,
  getAttachmentsDir,
  type RequestAttachment,
} from '../requests.js';
import { getWorkspace, getClientPortalUrl, updatePageState } from '../workspaces.js';

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

// Internal: create request (e.g. from audit finding)
router.post('/api/requests', (req, res) => {
  const { workspaceId, title, description, category, priority, pageUrl, pageId } = req.body;
  if (!workspaceId || !title || !description) return res.status(400).json({ error: 'workspaceId, title, and description required' });
  const request = createRequest(workspaceId, { title, description, category: category || 'seo', priority, pageUrl, pageId, submittedBy: STUDIO_NAME });
  broadcast('request:created', request);
  broadcastToWorkspace(workspaceId, 'request:created', { id: request.id });
  res.json(request);
});

// Internal: batch create requests (from audit findings)
router.post('/api/requests/batch', (req, res) => {
  const { workspaceId, items } = req.body as { workspaceId: string; items: Array<{ title: string; description: string; category?: string; priority?: string; pageUrl?: string }> };
  if (!workspaceId || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'workspaceId and items[] required' });
  const created = items.map(item =>
    createRequest(workspaceId, { title: item.title, description: item.description, category: (item.category as 'seo') || 'seo', priority: (item.priority as 'high') || 'medium', pageUrl: item.pageUrl, submittedBy: STUDIO_NAME })
  );
  broadcast('request:batch_created', { count: created.length });
  broadcastToWorkspace(workspaceId, 'request:created', { ids: created.map(r => r.id), batch: true });
  res.json({ created: created.length, ids: created.map(r => r.id) });
});

// Internal: bulk update request status
router.patch('/api/requests/bulk', (req, res) => {
  const { ids, status, priority } = req.body as { ids: string[]; status?: string; priority?: string };
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids[] required' });
  const updates: Record<string, string> = {};
  if (status) updates.status = status;
  if (priority) updates.priority = priority;
  // Look up each request's workspace before mutating so the update is workspace-scoped.
  const results = ids.map(id => {
    const existing = getRequest(id);
    if (!existing) return null;
    return updateRequest(existing.workspaceId, id, updates);
  });
  const succeeded = results.filter(Boolean).length;
  broadcast('request:bulk_updated', { count: succeeded, status });
  // Broadcast to each affected workspace
  const wsIds = new Set(results.filter(Boolean).map(r => r!.workspaceId));
  for (const wsId of wsIds) broadcastToWorkspace(wsId, 'request:update', { bulk: true, status });
  res.json({ updated: succeeded, total: ids.length });
});

// Internal: list all requests (optionally filtered by workspace)
router.get('/api/requests', (req, res) => {
  const wsId = req.query.workspaceId as string | undefined;
  res.json(listRequests(wsId));
});

// Internal: get single request
router.get('/api/requests/:id', (req, res) => {
  const r = getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

// Internal: update request status/priority/category
router.patch('/api/requests/:id', (req, res) => {
  const { status, priority, category } = req.body;
  const prev = getRequest(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Not found' });
  const updated = updateRequest(prev.workspaceId, req.params.id, { status, priority, category });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  broadcast('request:updated', updated);
  broadcastToWorkspace(updated.workspaceId, 'request:update', { id: updated.id, status: updated.status });
  // Email client on status change
  if (status && prev && status !== prev.status) {
    const ws = getWorkspace(updated.workspaceId);
    if (ws?.clientEmail) {
      const dashUrl = getClientPortalUrl(ws);
      notifyClientStatusChange({ clientEmail: ws.clientEmail, workspaceName: ws.name, workspaceId: updated.workspaceId, requestTitle: updated.title, newStatus: status, dashboardUrl: dashUrl });
    }
    // Log activity for completed/closed
    if (status === 'completed' || status === 'closed') {
      addActivity(updated.workspaceId, 'request_resolved', `Resolved request: ${updated.title}`,
        updated.description?.slice(0, 120), { requestId: updated.id, category: updated.category });
      // Update page state if request has a pageId
      if (updated.pageId) {
        updatePageState(updated.workspaceId, updated.pageId, { status: 'live', source: 'request-resolved', updatedBy: 'admin' });
      }
    }
  }
  res.json(updated);
});

// Internal: team adds a note
router.post('/api/requests/:id/notes', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const existing = getRequest(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const updated = addNote(existing.workspaceId, req.params.id, 'team', content);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  broadcast('request:updated', updated);
  broadcastToWorkspace(updated.workspaceId, 'request:update', { id: updated.id });
  // Email client
  const ws = getWorkspace(updated.workspaceId);
  if (ws?.clientEmail) {
    const dashUrl = getClientPortalUrl(ws);
    notifyClientTeamResponse({ clientEmail: ws.clientEmail, workspaceName: ws.name, workspaceId: updated.workspaceId, requestTitle: updated.title, noteContent: content, dashboardUrl: dashUrl });
  }
  res.json(updated);
});

// Internal: delete request
router.delete('/api/requests/:id', (req, res) => {
  const existing = getRequest(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const ok = deleteRequest(existing.workspaceId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  broadcast('request:deleted', { id: req.params.id });
  broadcastToWorkspace(existing.workspaceId, 'request:update', { id: req.params.id, deleted: true });
  res.json({ ok: true });
});

// Serve attachment files (public — needed for client dashboard)
router.get('/api/request-attachments/:filename', (req, res) => {
  const filePath = path.join(getAttachmentsDir(), path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filePath);
});

// Upload attachments with a note (internal team)
router.post('/api/requests/:id/notes-with-files', upload.array('files', 5), (req, res) => {
  const content = req.body.content || '';
  const files = req.files as Express.Multer.File[];
  if (!content && !files?.length) return res.status(400).json({ error: 'content or files required' });
  const atts = files?.length ? processUploadedAttachments(files) : undefined;
  const existing = getRequest(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const updated = addNote(existing.workspaceId, req.params.id, 'team', content, atts);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  broadcast('request:updated', updated);
  broadcastToWorkspace(updated.workspaceId, 'request:update', { id: updated.id });
  // Email client
  const ws = getWorkspace(updated.workspaceId);
  if (ws?.clientEmail && content) {
    const dashUrl = getClientPortalUrl(ws);
    notifyClientTeamResponse({ clientEmail: ws.clientEmail, workspaceName: ws.name, workspaceId: updated.workspaceId, requestTitle: updated.title, noteContent: content, dashboardUrl: dashUrl });
  }
  res.json(updated);
});

export default router;
