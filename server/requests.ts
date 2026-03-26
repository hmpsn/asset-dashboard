/**
 * Client Requests — content & service requests submitted through the client portal.
 * Notes and attachments are stored as JSON arrays in the SQLite row.
 */

import fs from 'fs';
import path from 'path';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { getUploadRoot } from './data-dir.js';

const UPLOAD_ROOT = getUploadRoot();

export type { RequestPriority, RequestStatus, RequestCategory, RequestAttachment, RequestNote, ClientRequest } from '../shared/types/requests.ts';
import type { RequestPriority, RequestStatus, RequestCategory, RequestAttachment, RequestNote, ClientRequest } from '../shared/types/requests.ts';

// --- SQLite row shape ---

interface RequestRow {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  submitted_by: string | null;
  page_url: string | null;
  page_id: string | null;
  attachments: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

function rowToRequest(row: RequestRow): ClientRequest {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    category: row.category as RequestCategory,
    priority: row.priority as RequestPriority,
    status: row.status as RequestStatus,
    submittedBy: row.submitted_by ?? undefined,
    pageUrl: row.page_url ?? undefined,
    pageId: row.page_id ?? undefined,
    attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
    notes: JSON.parse(row.notes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Prepared statements (lazily initialized after migrations run) ---

const stmts = createStmtCache(() => ({
  selectAll: db.prepare(
    'SELECT * FROM requests ORDER BY created_at DESC',
  ),
  selectByWorkspace: db.prepare(
    'SELECT * FROM requests WHERE workspace_id = ? ORDER BY created_at DESC',
  ),
  selectById: db.prepare('SELECT * FROM requests WHERE id = ?'),
  insert: db.prepare(`
        INSERT INTO requests (id, workspace_id, title, description, category, priority,
          status, submitted_by, page_url, page_id, attachments, notes, created_at, updated_at)
        VALUES (@id, @workspace_id, @title, @description, @category, @priority,
          @status, @submitted_by, @page_url, @page_id, @attachments, @notes, @created_at, @updated_at)
      `),
  update: db.prepare(`
        UPDATE requests SET title = @title, description = @description, category = @category,
          priority = @priority, status = @status, submitted_by = @submitted_by,
          page_url = @page_url, page_id = @page_id, attachments = @attachments,
          notes = @notes, updated_at = @updated_at
        WHERE id = @id
      `),
  deleteById: db.prepare('DELETE FROM requests WHERE id = ?'),
}));

// ── CRUD ──

export function listRequests(workspaceId?: string): ClientRequest[] {
  let rows: RequestRow[];
  if (workspaceId) {
    rows = stmts().selectByWorkspace.all(workspaceId) as RequestRow[];
  } else {
    rows = stmts().selectAll.all() as RequestRow[];
  }
  return rows.map(rowToRequest);
}

export function getRequest(id: string): ClientRequest | undefined {
  const row = stmts().selectById.get(id) as RequestRow | undefined;
  return row ? rowToRequest(row) : undefined;
}

export function createRequest(workspaceId: string, data: {
  title: string;
  description: string;
  category: RequestCategory;
  priority?: RequestPriority;
  submittedBy?: string;
  pageUrl?: string;
  pageId?: string;
}): ClientRequest {
  const now = new Date().toISOString();
  const request: ClientRequest = {
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    title: data.title,
    description: data.description,
    category: data.category,
    priority: data.priority || 'medium',
    status: 'new',
    submittedBy: data.submittedBy,
    pageUrl: data.pageUrl,
    pageId: data.pageId,
    notes: [],
    createdAt: now,
    updatedAt: now,
  };

  stmts().insert.run({
    id: request.id,
    workspace_id: request.workspaceId,
    title: request.title,
    description: request.description,
    category: request.category,
    priority: request.priority,
    status: request.status,
    submitted_by: request.submittedBy ?? null,
    page_url: request.pageUrl ?? null,
    page_id: request.pageId ?? null,
    attachments: request.attachments ? JSON.stringify(request.attachments) : null,
    notes: JSON.stringify(request.notes),
    created_at: request.createdAt,
    updated_at: request.updatedAt,
  });

  return request;
}

export function updateRequest(id: string, updates: Partial<Pick<ClientRequest, 'status' | 'priority' | 'category'>>): ClientRequest | null {
  const existing = getRequest(id);
  if (!existing) return null;

  // Filter out undefined values so we don't overwrite existing fields with NULL
  const cleanUpdates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) cleanUpdates[k] = v;
  }
  const merged = { ...existing, ...cleanUpdates, updatedAt: new Date().toISOString() };

  stmts().update.run({
    id: merged.id,
    title: merged.title,
    description: merged.description,
    category: merged.category,
    priority: merged.priority,
    status: merged.status,
    submitted_by: merged.submittedBy ?? null,
    page_url: merged.pageUrl ?? null,
    page_id: merged.pageId ?? null,
    attachments: merged.attachments ? JSON.stringify(merged.attachments) : null,
    notes: JSON.stringify(merged.notes),
    updated_at: merged.updatedAt,
  });

  return merged;
}

export function getAttachmentsDir(): string {
  const dir = path.join(UPLOAD_ROOT, '.request-attachments');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function addAttachmentsToRequest(requestId: string, attachments: RequestAttachment[]): ClientRequest | null {
  const existing = getRequest(requestId);
  if (!existing) return null;

  if (!existing.attachments) existing.attachments = [];
  existing.attachments.push(...attachments);
  existing.updatedAt = new Date().toISOString();

  stmts().update.run({
    id: existing.id,
    title: existing.title,
    description: existing.description,
    category: existing.category,
    priority: existing.priority,
    status: existing.status,
    submitted_by: existing.submittedBy ?? null,
    page_url: existing.pageUrl ?? null,
    page_id: existing.pageId ?? null,
    attachments: existing.attachments ? JSON.stringify(existing.attachments) : null,
    notes: JSON.stringify(existing.notes),
    updated_at: existing.updatedAt,
  });

  return existing;
}

export function addNote(requestId: string, author: 'client' | 'team', content: string, attachments?: RequestAttachment[]): ClientRequest | null {
  const existing = getRequest(requestId);
  if (!existing) return null;

  const note: RequestNote = {
    id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    author,
    content,
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
    createdAt: new Date().toISOString(),
  };

  existing.notes.push(note);
  existing.updatedAt = new Date().toISOString();

  stmts().update.run({
    id: existing.id,
    title: existing.title,
    description: existing.description,
    category: existing.category,
    priority: existing.priority,
    status: existing.status,
    submitted_by: existing.submittedBy ?? null,
    page_url: existing.pageUrl ?? null,
    page_id: existing.pageId ?? null,
    attachments: existing.attachments ? JSON.stringify(existing.attachments) : null,
    notes: JSON.stringify(existing.notes),
    updated_at: existing.updatedAt,
  });

  return existing;
}

export function deleteRequest(id: string): boolean {
  const info = stmts().deleteById.run(id);
  return info.changes > 0;
}
