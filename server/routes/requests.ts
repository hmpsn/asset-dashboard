/**
 * requests routes — extracted from server/index.ts
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { addActivity } from '../activity-log.js';
import { broadcast, broadcastToWorkspace } from '../broadcast.js';
import { STUDIO_NAME } from '../constants.js';
import { notifyClientTeamResponse, notifyClientStatusChange } from '../email.js';
import { requestUserCanAccessWorkspace, upload } from '../middleware.js';
import { validate, z } from '../middleware/validate.js';
import { ADMIN_EVENTS, WS_EVENTS } from '../ws-events.js';
import { sanitizePlainText } from '../html-sanitize.js';
import {
  listRequests,
  createRequest,
  updateRequest,
  addNote,
  deleteRequest,
  getRequest,
  getAttachmentsDir,
  type RequestAttachment,
  type RequestCategory,
  type RequestPriority,
  type RequestStatus,
} from '../requests.js';
import { getWorkspace, getClientPortalUrl, updatePageState } from '../workspaces.js';

const router = Router();

const requestCategorySchema = z.enum(['bug', 'content', 'design', 'seo', 'feature', 'other']);
const requestPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
const requestStatusSchema = z.enum(['new', 'in_review', 'in_progress', 'on_hold', 'completed', 'closed']);

const createRequestSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  title: z.string().trim().min(1, 'title is required').max(500),
  description: z.string().trim().min(1, 'description is required').max(5000),
  category: requestCategorySchema.optional().default('seo'),
  priority: requestPrioritySchema.optional(),
  pageUrl: z.string().optional(),
  pageId: z.string().optional(),
});

const batchCreateRequestSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  items: z.array(z.object({
    title: z.string().trim().min(1, 'title is required').max(500),
    description: z.string().trim().min(1, 'description is required').max(5000),
    category: requestCategorySchema.optional().default('seo'),
    priority: requestPrioritySchema.optional().default('medium'),
    pageUrl: z.string().optional(),
  })).min(1, 'items[] required'),
});

const bulkUpdateRequestSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'ids[] required'),
  status: requestStatusSchema.optional(),
  priority: requestPrioritySchema.optional(),
}).refine(data => data.status !== undefined || data.priority !== undefined, {
  message: 'status or priority required',
});

const updateRequestSchema = z.object({
  status: requestStatusSchema.optional(),
  priority: requestPrioritySchema.optional(),
  category: requestCategorySchema.optional(),
}).refine(data => data.status !== undefined || data.priority !== undefined || data.category !== undefined, {
  message: 'status, priority, or category required',
});

// --- Request Attachments ---
function canAccessRequest(req: import('express').Request, workspaceId: string, res: import('express').Response): boolean {
  if (requestUserCanAccessWorkspace(req, workspaceId)) return true;
  res.status(403).json({ error: 'You do not have access to this workspace' });
  return false;
}

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
router.post('/api/requests', validate(createRequestSchema), (req, res) => {
  const { workspaceId, title, description, category, priority, pageUrl, pageId } = req.body as {
    workspaceId: string;
    title: string;
    description: string;
    category: RequestCategory;
    priority?: RequestPriority;
    pageUrl?: string;
    pageId?: string;
  };
  if (!canAccessRequest(req, workspaceId, res)) return;
  const request = createRequest(workspaceId, {
    title: sanitizePlainText(title).trim(),
    description: sanitizePlainText(description).trim(),
    category,
    priority,
    pageUrl: pageUrl ? sanitizePlainText(pageUrl).trim() : undefined,
    pageId: pageId ? sanitizePlainText(pageId).trim() : undefined,
    submittedBy: STUDIO_NAME,
  });
  broadcast(ADMIN_EVENTS.REQUEST_CREATED, request);
  broadcastToWorkspace(workspaceId, WS_EVENTS.REQUEST_CREATED, { id: request.id });
  res.json(request);
});

// Internal: batch create requests (from audit findings)
router.post('/api/requests/batch', validate(batchCreateRequestSchema), (req, res) => {
  const { workspaceId, items } = req.body as {
    workspaceId: string;
    items: Array<{ title: string; description: string; category: RequestCategory; priority: RequestPriority; pageUrl?: string }>;
  };
  if (!canAccessRequest(req, workspaceId, res)) return;
  const created = items.map(item =>
    createRequest(workspaceId, {
      title: sanitizePlainText(item.title).trim(),
      description: sanitizePlainText(item.description).trim(),
      category: item.category,
      priority: item.priority,
      pageUrl: item.pageUrl ? sanitizePlainText(item.pageUrl).trim() : undefined,
      submittedBy: STUDIO_NAME,
    })
  );
  broadcast(ADMIN_EVENTS.REQUEST_BATCH_CREATED, { count: created.length });
  broadcastToWorkspace(workspaceId, WS_EVENTS.REQUEST_CREATED, { ids: created.map(r => r.id), batch: true });
  res.json({ created: created.length, ids: created.map(r => r.id) });
});

// Internal: bulk update request status
router.patch('/api/requests/bulk', validate(bulkUpdateRequestSchema), (req, res) => {
  const { ids, status, priority } = req.body as { ids: string[]; status?: RequestStatus; priority?: RequestPriority };
  const updates: { status?: RequestStatus; priority?: RequestPriority } = {};
  if (status) updates.status = status;
  if (priority) updates.priority = priority;
  // Look up each request's workspace before mutating so the update is workspace-scoped.
  const existingRequests = ids.map(id => getRequest(id));
  if (existingRequests.some(existing => existing && !requestUserCanAccessWorkspace(req, existing.workspaceId))) {
    return res.status(403).json({ error: 'You do not have access to this workspace' });
  }
  const succeededRequests = existingRequests
    .map((existing, index) => existing ? updateRequest(existing.workspaceId, ids[index], updates) : null)
    .filter((r): r is NonNullable<ReturnType<typeof updateRequest>> => r !== null);
  const succeeded = succeededRequests.length;
  broadcast(ADMIN_EVENTS.REQUEST_BULK_UPDATED, { count: succeeded, status });
  // Broadcast to each affected workspace
  const wsIds = new Set(succeededRequests.map(r => r.workspaceId));
  for (const wsId of wsIds) broadcastToWorkspace(wsId, WS_EVENTS.REQUEST_UPDATE, { bulk: true, status });
  res.json({ updated: succeeded, total: ids.length });
});

// Internal: list all requests (optionally filtered by workspace)
router.get('/api/requests', (req, res) => {
  const wsId = req.query.workspaceId as string | undefined;
  if (wsId && !canAccessRequest(req, wsId, res)) return;
  if (!wsId && req.user && req.user.role !== 'owner') {
    const scoped = (req.user.workspaceIds || []).flatMap(id => listRequests(id));
    return res.json(scoped);
  }
  res.json(listRequests(wsId));
});

// Internal: get single request
router.get('/api/requests/:id', (req, res) => {
  const r = getRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (!canAccessRequest(req, r.workspaceId, res)) return;
  res.json(r);
});

// Internal: update request status/priority/category
router.patch('/api/requests/:id', validate(updateRequestSchema), (req, res) => {
  const { status, priority, category } = req.body as {
    status?: RequestStatus;
    priority?: RequestPriority;
    category?: RequestCategory;
  };
  const prev = getRequest(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Not found' });
  if (!canAccessRequest(req, prev.workspaceId, res)) return;
  const updated = updateRequest(prev.workspaceId, req.params.id, { status, priority, category });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  broadcast(ADMIN_EVENTS.REQUEST_UPDATED, updated);
  broadcastToWorkspace(updated.workspaceId, WS_EVENTS.REQUEST_UPDATE, { id: updated.id, status: updated.status });
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
  const content = sanitizePlainText((req.body?.content ?? '').toString()).trim();
  if (!content) return res.status(400).json({ error: 'content required' });
  const existing = getRequest(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!canAccessRequest(req, existing.workspaceId, res)) return;
  const updated = addNote(existing.workspaceId, req.params.id, 'team', content);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  broadcast(ADMIN_EVENTS.REQUEST_UPDATED, updated);
  broadcastToWorkspace(updated.workspaceId, WS_EVENTS.REQUEST_UPDATE, { id: updated.id });
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
  if (!canAccessRequest(req, existing.workspaceId, res)) return;
  const ok = deleteRequest(existing.workspaceId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  broadcast(ADMIN_EVENTS.REQUEST_DELETED, { id: req.params.id });
  broadcastToWorkspace(existing.workspaceId, WS_EVENTS.REQUEST_UPDATE, { id: req.params.id, deleted: true });
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
  const content = sanitizePlainText((req.body?.content ?? '').toString()).trim();
  const files = req.files as Express.Multer.File[];
  if (!content && !files?.length) return res.status(400).json({ error: 'content or files required' });
  const atts = files?.length ? processUploadedAttachments(files) : undefined;
  const existing = getRequest(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!canAccessRequest(req, existing.workspaceId, res)) return;
  const updated = addNote(existing.workspaceId, req.params.id, 'team', content, atts);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  broadcast(ADMIN_EVENTS.REQUEST_UPDATED, updated);
  broadcastToWorkspace(updated.workspaceId, WS_EVENTS.REQUEST_UPDATE, { id: updated.id });
  // Email client
  const ws = getWorkspace(updated.workspaceId);
  if (ws?.clientEmail && content) {
    const dashUrl = getClientPortalUrl(ws);
    notifyClientTeamResponse({ clientEmail: ws.clientEmail, workspaceName: ws.name, workspaceId: updated.workspaceId, requestTitle: updated.title, noteContent: content, dashboardUrl: dashUrl });
  }
  res.json(updated);
});

export default router;
