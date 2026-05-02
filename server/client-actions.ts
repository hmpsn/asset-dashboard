import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import type { ClientAction, ClientActionPayload, ClientActionSourceType, ClientActionStatus } from '../shared/types/client-actions.js';
import { CLIENT_ACTION_TRANSITIONS, validateTransition } from './state-machines.js';

interface ClientActionRow {
  id: string;
  workspace_id: string;
  source_type: string;
  source_id: string | null;
  title: string;
  summary: string;
  payload: string;
  status: string;
  priority: string;
  client_note: string | null;
  created_at: string;
  updated_at: string;
}

const validStatuses: ClientActionStatus[] = ['pending', 'approved', 'changes_requested', 'completed', 'archived'];
const validSources: ClientActionSourceType[] = ['aeo_change', 'internal_link', 'keyword_strategy', 'redirect_proposal', 'content_decay'];

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO client_actions
      (id, workspace_id, source_type, source_id, title, summary, payload, status, priority, client_note, created_at, updated_at)
    VALUES
      (@id, @workspace_id, @source_type, @source_id, @title, @summary, @payload, @status, @priority, @client_note, @created_at, @updated_at)
  `),
  selectByWorkspace: db.prepare(`
    SELECT * FROM client_actions
    WHERE workspace_id = ?
    ORDER BY
      CASE status
        WHEN 'pending' THEN 0
        WHEN 'changes_requested' THEN 1
        WHEN 'approved' THEN 2
        WHEN 'completed' THEN 3
        ELSE 4
      END,
      created_at DESC
  `),
  selectById: db.prepare(`
    SELECT * FROM client_actions
    WHERE workspace_id = ? AND id = ?
  `),
  update: db.prepare(`
    UPDATE client_actions
    SET title = @title,
        summary = @summary,
        payload = @payload,
        status = @status,
        priority = @priority,
        client_note = @client_note,
        updated_at = @updated_at
    WHERE workspace_id = @workspace_id AND id = @id
  `),
  countPending: db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM client_actions
    WHERE workspace_id = ? AND status = 'pending'
  `),
}));

function rowToAction(row: ClientActionRow): ClientAction {
  const sourceType = validSources.includes(row.source_type as ClientActionSourceType)
    ? row.source_type as ClientActionSourceType
    : 'keyword_strategy';
  const status = validStatuses.includes(row.status as ClientActionStatus)
    ? row.status as ClientActionStatus
    : 'pending';
  const priority = row.priority === 'high' || row.priority === 'low' ? row.priority : 'medium';
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceType,
    sourceId: row.source_id ?? undefined,
    title: row.title,
    summary: row.summary,
    payload: parseJsonFallback<ClientActionPayload>(row.payload, {}),
    status,
    priority,
    clientNote: row.client_note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateClientActionInput {
  workspaceId: string;
  sourceType: ClientActionSourceType;
  sourceId?: string;
  title: string;
  summary: string;
  payload?: ClientActionPayload;
  priority?: 'high' | 'medium' | 'low';
}

export function createClientAction(input: CreateClientActionInput): ClientAction {
  const now = new Date().toISOString();
  const action: ClientAction = {
    id: `ca_${randomUUID().slice(0, 8)}`,
    workspaceId: input.workspaceId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    title: input.title,
    summary: input.summary,
    payload: input.payload ?? {},
    status: 'pending',
    priority: input.priority ?? 'medium',
    createdAt: now,
    updatedAt: now,
  };
  stmts().insert.run({
    id: action.id,
    workspace_id: action.workspaceId,
    source_type: action.sourceType,
    source_id: action.sourceId ?? null,
    title: action.title,
    summary: action.summary,
    payload: JSON.stringify(action.payload),
    status: action.status,
    priority: action.priority,
    client_note: null,
    created_at: now,
    updated_at: now,
  });
  return action;
}

export function listClientActions(workspaceId: string): ClientAction[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as ClientActionRow[];
  return rows.map(rowToAction);
}

export function getClientAction(workspaceId: string, actionId: string): ClientAction | null {
  const row = stmts().selectById.get(workspaceId, actionId) as ClientActionRow | undefined;
  return row ? rowToAction(row) : null;
}

export function updateClientAction(
  workspaceId: string,
  actionId: string,
  updates: Partial<Pick<ClientAction, 'title' | 'summary' | 'payload' | 'status' | 'priority' | 'clientNote'>>,
): ClientAction | null {
  const existing = getClientAction(workspaceId, actionId);
  if (!existing) return null;
  if (updates.status && updates.status !== existing.status) {
    validateTransition('client action', CLIENT_ACTION_TRANSITIONS, existing.status, updates.status);
  }
  const next: ClientAction = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  stmts().update.run({
    id: next.id,
    workspace_id: next.workspaceId,
    title: next.title,
    summary: next.summary,
    payload: JSON.stringify(next.payload ?? {}),
    status: next.status,
    priority: next.priority,
    client_note: next.clientNote ?? null,
    updated_at: next.updatedAt,
  });
  return getClientAction(workspaceId, actionId);
}

export function countPendingClientActions(workspaceId: string): number {
  const row = stmts().countPending.get(workspaceId) as { count: number };
  return row.count;
}
