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
  selectActiveBySource: db.prepare(`
    SELECT * FROM client_actions
    WHERE workspace_id = @workspace_id
      AND source_type = @source_type
      AND source_id = @source_id
      AND status IN ('pending', 'approved', 'changes_requested')
    ORDER BY updated_at DESC
    LIMIT 1
  `),
  countByStatus: db.prepare(`
    SELECT status, COALESCE(COUNT(*), 0) AS count
    FROM client_actions
    WHERE workspace_id = ?
    GROUP BY status
  `),
  selectRecentDecisions: db.prepare(`
    SELECT * FROM client_actions
    WHERE workspace_id = ? AND status != 'pending'
    ORDER BY updated_at DESC
    LIMIT 5
  `),
  pendingQueueStats: db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count, MIN(created_at) AS oldest_created_at
    FROM client_actions
    WHERE workspace_id = ? AND status = 'pending'
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

export interface ClientActionDecisionSummary {
  title: string;
  status: ClientActionStatus;
  sourceType: ClientActionSourceType;
  updatedAt: string;
}

export interface ClientActionSummary {
  pending: number;
  approved: number;
  changesRequested: number;
  completed: number;
  recentDecisions: ClientActionDecisionSummary[];
}

export interface ClientActionQueueStats {
  pending: number;
  oldestAge: number | null;
}

export function createClientAction(input: CreateClientActionInput): ClientAction {
  const now = new Date().toISOString();
  if (input.sourceId) {
    const existing = getActiveClientActionBySource(input.workspaceId, input.sourceType, input.sourceId);
    if (existing) return existing;
  }

  const action: ClientAction = {
    id: `ca_${Date.now()}_${randomUUID().slice(0, 8)}`,
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

export function getActiveClientActionBySource(
  workspaceId: string,
  sourceType: ClientActionSourceType,
  sourceId: string,
): ClientAction | null {
  const row = stmts().selectActiveBySource.get({
    workspace_id: workspaceId,
    source_type: sourceType,
    source_id: sourceId,
  }) as ClientActionRow | undefined;
  return row ? rowToAction(row) : null;
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

export function summarizeClientActions(workspaceId: string): ClientActionSummary {
  const rows = stmts().countByStatus.all(workspaceId) as Array<{ status: string; count: number }>;
  const counts = new Map(rows.map(row => [row.status, row.count]));
  const recentRows = stmts().selectRecentDecisions.all(workspaceId) as ClientActionRow[];
  return {
    pending: counts.get('pending') ?? 0,
    approved: counts.get('approved') ?? 0,
    changesRequested: counts.get('changes_requested') ?? 0,
    completed: counts.get('completed') ?? 0,
    recentDecisions: recentRows.map(row => {
      const action = rowToAction(row);
      return {
        title: action.title,
        status: action.status,
        sourceType: action.sourceType,
        updatedAt: action.updatedAt,
      };
    }),
  };
}

export function getClientActionQueueStats(workspaceId: string): ClientActionQueueStats {
  const row = stmts().pendingQueueStats.get(workspaceId) as {
    count: number;
    oldest_created_at: string | null;
  };
  const pending = row.count;
  const oldestAge = pending > 0 && row.oldest_created_at
    ? Math.floor((Date.now() - new Date(row.oldest_created_at).getTime()) / (60 * 60 * 1000))
    : null;
  return { pending, oldestAge };
}
