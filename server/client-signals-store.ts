/**
 * DB store for client signals — intent-based signals detected in client chat.
 * Use createStmtCache/stmts() for prepared statement caching (never local vars).
 */
import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { createLogger } from './logger.js';
import type { ClientSignal, ClientSignalType, ClientSignalStatus } from '../shared/types/client-signals.js';
import { z } from './middleware/validate.js';

const log = createLogger('client-signals-store');

interface ClientSignalRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  type: string;
  status: string;
  chat_context: string;
  trigger_message: string;
  created_at: string;
  updated_at: string;
}

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

function rowToSignal(row: ClientSignalRow): ClientSignal {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    type: row.type as ClientSignalType,
    status: row.status as ClientSignalStatus,
    chatContext: parseJsonSafeArray(row.chat_context, chatMessageSchema, {
      table: 'client_signals',
      field: 'chat_context',
      workspaceId: row.workspace_id,
    }),
    triggerMessage: row.trigger_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO client_signals
      (id, workspace_id, workspace_name, type, status, chat_context, trigger_message, created_at, updated_at)
    VALUES
      (@id, @workspace_id, @workspace_name, @type, @status, @chat_context, @trigger_message, @created_at, @updated_at)
  `),
  selectByWorkspace: db.prepare(`
    SELECT * FROM client_signals
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `),
  selectAll: db.prepare(`
    SELECT * FROM client_signals
    ORDER BY created_at DESC
    LIMIT 200
  `),
  selectById: db.prepare(`
    SELECT * FROM client_signals WHERE id = ?
  `),
  updateStatus: db.prepare(`
    UPDATE client_signals
    SET status = ?, updated_at = ?
    WHERE id = ?
  `),
  countNewByWorkspace: db.prepare(`
    SELECT COALESCE(COUNT(*), 0) as count
    FROM client_signals
    WHERE workspace_id = ? AND status = 'new'
  `),
  countAllByWorkspace: db.prepare(`
    SELECT COALESCE(COUNT(*), 0) as count
    FROM client_signals
    WHERE workspace_id = ?
  `),
  selectRecentByType: db.prepare(`
    SELECT id FROM client_signals
    WHERE workspace_id = ? AND type = ? AND created_at > ?
    LIMIT 1
  `),
}));

export interface CreateClientSignalInput {
  workspaceId: string;
  workspaceName: string;
  type: ClientSignalType;
  chatContext: Array<{ role: 'user' | 'assistant'; content: string }>;
  triggerMessage: string;
}

export function createClientSignal(input: CreateClientSignalInput): ClientSignal {
  const now = new Date().toISOString();
  const id = randomUUID();
  stmts().insert.run({
    id,
    workspace_id: input.workspaceId,
    workspace_name: input.workspaceName,
    type: input.type,
    status: 'new',
    chat_context: JSON.stringify(input.chatContext),
    trigger_message: input.triggerMessage,
    created_at: now,
    updated_at: now,
  });
  const row = stmts().selectById.get(id) as ClientSignalRow;
  return rowToSignal(row);
}

export function listClientSignals(workspaceId?: string): ClientSignal[] {
  if (workspaceId) {
    const rows = stmts().selectByWorkspace.all(workspaceId) as ClientSignalRow[];
    return rows.map(rowToSignal);
  }
  const rows = stmts().selectAll.all() as ClientSignalRow[];
  return rows.map(rowToSignal);
}

export function getSignalById(id: string): ClientSignal | null {
  const row = stmts().selectById.get(id) as ClientSignalRow | undefined;
  return row ? rowToSignal(row) : null;
}

export function updateSignalStatus(id: string, status: ClientSignalStatus): boolean {
  const info = stmts().updateStatus.run(status, new Date().toISOString(), id);
  return info.changes > 0;
}

export function countNewSignals(workspaceId: string): number {
  const result = stmts().countNewByWorkspace.get(workspaceId) as { count: number };
  return result.count;
}

/**
 * Returns the total count of all signals for a workspace across all statuses.
 * Uses a COUNT(*) query — not capped by the LIMIT 100 on listClientSignals.
 */
export function countAllSignals(workspaceId: string): number {
  const result = stmts().countAllByWorkspace.get(workspaceId) as { count: number };
  return result.count;
}

/**
 * Returns true if a signal of the given type was created for this workspace
 * within the last `withinMs` milliseconds. Used to suppress duplicate signals
 * during an active chat session.
 */
export function hasRecentSignal(workspaceId: string, type: ClientSignalType, withinMs: number): boolean {
  const cutoff = new Date(Date.now() - withinMs).toISOString();
  const row = stmts().selectRecentByType.get(workspaceId, type, cutoff) as { id: string } | undefined;
  return !!row;
}
