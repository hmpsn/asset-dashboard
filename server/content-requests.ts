import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import { validateTransition, CONTENT_REQUEST_TRANSITIONS } from './state-machines.js';

export type { ContentRequestComment, ContentTopicRequest } from '../shared/types/content.ts';
import type { ContentRequestComment, ContentTopicRequest } from '../shared/types/content.ts';

// ── SQLite row shape ──

interface RequestRow {
  id: string;
  workspace_id: string;
  topic: string;
  target_keyword: string;
  intent: string;
  priority: string;
  rationale: string;
  status: string;
  brief_id: string | null;
  client_note: string | null;
  internal_note: string | null;
  decline_reason: string | null;
  client_feedback: string | null;
  source: string | null;
  service_type: string | null;
  page_type: string | null;
  upgraded_at: string | null;
  delivery_url: string | null;
  delivery_notes: string | null;
  target_page_id: string | null;
  target_page_slug: string | null;
  comments: string;
  requested_at: string;
  updated_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO content_topic_requests
           (id, workspace_id, topic, target_keyword, intent, priority, rationale, status,
            brief_id, client_note, internal_note, decline_reason, client_feedback,
            source, service_type, page_type, upgraded_at, delivery_url, delivery_notes,
            target_page_id, target_page_slug, comments, requested_at, updated_at)
         VALUES
           (@id, @workspace_id, @topic, @target_keyword, @intent, @priority, @rationale, @status,
            @brief_id, @client_note, @internal_note, @decline_reason, @client_feedback,
            @source, @service_type, @page_type, @upgraded_at, @delivery_url, @delivery_notes,
            @target_page_id, @target_page_slug, @comments, @requested_at, @updated_at)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM content_topic_requests WHERE workspace_id = ? ORDER BY requested_at DESC`,
  ),
  selectById: db.prepare(
    `SELECT * FROM content_topic_requests WHERE id = ? AND workspace_id = ?`,
  ),
  selectByKeyword: db.prepare(
    `SELECT * FROM content_topic_requests WHERE workspace_id = ? AND target_keyword = ? AND status != 'declined'`,
  ),
  update: db.prepare(
    `UPDATE content_topic_requests SET
           status = @status, brief_id = @brief_id, client_note = @client_note,
           internal_note = @internal_note, decline_reason = @decline_reason,
           client_feedback = @client_feedback, service_type = @service_type,
           upgraded_at = @upgraded_at, delivery_url = @delivery_url,
           delivery_notes = @delivery_notes, comments = @comments, updated_at = @updated_at
         WHERE id = @id`,
  ),
  deleteById: db.prepare(
    `DELETE FROM content_topic_requests WHERE id = ? AND workspace_id = ?`,
  ),
}));

function rowToRequest(row: RequestRow): ContentTopicRequest {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    topic: row.topic,
    targetKeyword: row.target_keyword,
    intent: row.intent,
    priority: row.priority,
    rationale: row.rationale,
    status: row.status as ContentTopicRequest['status'],
    briefId: row.brief_id ?? undefined,
    clientNote: row.client_note ?? undefined,
    internalNote: row.internal_note ?? undefined,
    declineReason: row.decline_reason ?? undefined,
    clientFeedback: row.client_feedback ?? undefined,
    source: (row.source as ContentTopicRequest['source']) ?? undefined,
    serviceType: (row.service_type as ContentTopicRequest['serviceType']) ?? undefined,
    pageType: (row.page_type as ContentTopicRequest['pageType']) ?? undefined,
    upgradedAt: row.upgraded_at ?? undefined,
    deliveryUrl: row.delivery_url ?? undefined,
    deliveryNotes: row.delivery_notes ?? undefined,
    targetPageId: row.target_page_id ?? undefined,
    targetPageSlug: row.target_page_slug ?? undefined,
    comments: parseJsonFallback(row.comments, []),
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
  };
}

export function listContentRequests(workspaceId: string): ContentTopicRequest[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as RequestRow[];
  return rows.map(rowToRequest);
}

export function getContentRequest(workspaceId: string, id: string): ContentTopicRequest | undefined {
  const row = stmts().selectById.get(id, workspaceId) as RequestRow | undefined;
  return row ? rowToRequest(row) : undefined;
}

export function createContentRequest(
  workspaceId: string,
  data: { topic: string; targetKeyword: string; intent: string; priority: string; rationale: string; clientNote?: string; source?: 'strategy' | 'client'; serviceType?: 'brief_only' | 'full_post'; pageType?: ContentTopicRequest['pageType']; initialStatus?: 'pending_payment' | 'requested'; targetPageId?: string; targetPageSlug?: string }
): ContentTopicRequest {
  // Prevent duplicate requests for the same keyword
  const existing = stmts().selectByKeyword.get(workspaceId, data.targetKeyword) as RequestRow | undefined;
  if (existing) return rowToRequest(existing);

  const request: ContentTopicRequest = {
    id: `creq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    topic: data.topic,
    targetKeyword: data.targetKeyword,
    intent: data.intent,
    priority: data.priority,
    rationale: data.rationale,
    clientNote: data.clientNote,
    source: data.source || 'strategy',
    serviceType: data.serviceType || 'brief_only',
    pageType: data.pageType || 'blog',
    targetPageId: data.targetPageId,
    targetPageSlug: data.targetPageSlug,
    comments: [],
    status: data.initialStatus || 'requested',
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  stmts().insert.run({
    id: request.id,
    workspace_id: workspaceId,
    topic: request.topic,
    target_keyword: request.targetKeyword,
    intent: request.intent,
    priority: request.priority,
    rationale: request.rationale,
    status: request.status,
    brief_id: request.briefId ?? null,
    client_note: request.clientNote ?? null,
    internal_note: request.internalNote ?? null,
    decline_reason: request.declineReason ?? null,
    client_feedback: request.clientFeedback ?? null,
    source: request.source ?? null,
    service_type: request.serviceType ?? null,
    page_type: request.pageType ?? null,
    upgraded_at: request.upgradedAt ?? null,
    delivery_url: request.deliveryUrl ?? null,
    delivery_notes: request.deliveryNotes ?? null,
    target_page_id: request.targetPageId ?? null,
    target_page_slug: request.targetPageSlug ?? null,
    comments: JSON.stringify(request.comments || []),
    requested_at: request.requestedAt,
    updated_at: request.updatedAt,
  });

  return request;
}

export function updateContentRequest(
  workspaceId: string,
  id: string,
  updates: Partial<Pick<ContentTopicRequest, 'status' | 'briefId' | 'internalNote' | 'declineReason' | 'clientFeedback' | 'serviceType' | 'upgradedAt' | 'deliveryUrl' | 'deliveryNotes'>>
): ContentTopicRequest | null {
  const existing = getContentRequest(workspaceId, id);
  if (!existing) return null;

  // Validate status transition if status is being changed
  if (updates.status !== undefined && updates.status !== existing.status) {
    validateTransition('content_request', CONTENT_REQUEST_TRANSITIONS, existing.status, updates.status);
  }

  // Filter undefined values to avoid overwriting existing fields
  const cleanUpdates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) cleanUpdates[k] = v;
  }
  Object.assign(existing, cleanUpdates, { updatedAt: new Date().toISOString() });

  stmts().update.run({
    id: existing.id,
    status: existing.status,
    brief_id: existing.briefId ?? null,
    client_note: existing.clientNote ?? null,
    internal_note: existing.internalNote ?? null,
    decline_reason: existing.declineReason ?? null,
    client_feedback: existing.clientFeedback ?? null,
    service_type: existing.serviceType ?? null,
    upgraded_at: existing.upgradedAt ?? null,
    delivery_url: existing.deliveryUrl ?? null,
    delivery_notes: existing.deliveryNotes ?? null,
    comments: JSON.stringify(existing.comments || []),
    updated_at: existing.updatedAt,
  });
  return existing;
}

export function deleteContentRequest(workspaceId: string, id: string): boolean {
  const info = stmts().deleteById.run(id, workspaceId);
  return info.changes > 0;
}

export function addComment(
  workspaceId: string,
  requestId: string,
  author: 'client' | 'team',
  content: string
): ContentTopicRequest | null {
  const existing = getContentRequest(workspaceId, requestId);
  if (!existing) return null;
  if (!existing.comments) existing.comments = [];
  existing.comments.push({
    id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    author,
    content,
    createdAt: new Date().toISOString(),
  });
  existing.updatedAt = new Date().toISOString();

  stmts().update.run({
    id: existing.id,
    status: existing.status,
    brief_id: existing.briefId ?? null,
    client_note: existing.clientNote ?? null,
    internal_note: existing.internalNote ?? null,
    decline_reason: existing.declineReason ?? null,
    client_feedback: existing.clientFeedback ?? null,
    service_type: existing.serviceType ?? null,
    upgraded_at: existing.upgradedAt ?? null,
    delivery_url: existing.deliveryUrl ?? null,
    delivery_notes: existing.deliveryNotes ?? null,
    comments: JSON.stringify(existing.comments),
    updated_at: existing.updatedAt,
  });
  return existing;
}
