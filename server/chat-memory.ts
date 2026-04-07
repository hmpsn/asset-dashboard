/**
 * Chat Memory — persistent conversation history for AI chatbots.
 * Stores sessions in SQLite, supports cross-session summaries.
 */

import db from './db/index.js';
import { callOpenAI } from './openai-helpers.js';
import { parseJsonFallback } from './db/json-validation.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  workspaceId: string;
  channel: 'client' | 'admin' | 'search';
  title: string;
  messages: ChatMessage[];
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  channel: 'client' | 'admin' | 'search';
  messageCount: number;
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Prepared statements (lazy) ──

let _upsert: ReturnType<typeof db.prepare> | null = null;
function upsertStmt() {
  if (!_upsert) {
    _upsert = db.prepare(`
      INSERT OR REPLACE INTO chat_sessions
        (id, workspace_id, channel, title, messages, summary, created_at, updated_at)
      VALUES (@id, @workspace_id, @channel, @title, @messages, @summary, @created_at, @updated_at)
    `);
  }
  return _upsert;
}

let _getSession: ReturnType<typeof db.prepare> | null = null;
function getSessionStmt() {
  if (!_getSession) {
    _getSession = db.prepare(`SELECT * FROM chat_sessions WHERE id = ? AND workspace_id = ?`);
  }
  return _getSession;
}

let _deleteSession: ReturnType<typeof db.prepare> | null = null;
function deleteSessionStmt() {
  if (!_deleteSession) {
    _deleteSession = db.prepare(`DELETE FROM chat_sessions WHERE id = ? AND workspace_id = ?`);
  }
  return _deleteSession;
}

let _listSessions: ReturnType<typeof db.prepare> | null = null;
function listSessionsStmt() {
  if (!_listSessions) {
    _listSessions = db.prepare(`
      SELECT * FROM chat_sessions WHERE workspace_id = ? ORDER BY updated_at DESC
    `);
  }
  return _listSessions;
}

let _listSessionsByChannel: ReturnType<typeof db.prepare> | null = null;
function listSessionsByChannelStmt() {
  if (!_listSessionsByChannel) {
    _listSessionsByChannel = db.prepare(`
      SELECT * FROM chat_sessions WHERE workspace_id = ? AND channel = ? ORDER BY updated_at DESC
    `);
  }
  return _listSessionsByChannel;
}

let _cleanupOldSessions: ReturnType<typeof db.prepare> | null = null;
function cleanupOldSessionsStmt() {
  if (!_cleanupOldSessions) {
    _cleanupOldSessions = db.prepare(`
      DELETE FROM chat_sessions WHERE updated_at < datetime('now', ? || ' days')
    `);
  }
  return _cleanupOldSessions;
}

interface ChatRow {
  id: string;
  workspace_id: string;
  channel: 'client' | 'admin' | 'search';
  title: string;
  messages: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSession(row: ChatRow): ChatSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    channel: row.channel,
    title: row.title,
    messages: parseJsonFallback<ChatMessage[]>(row.messages, []),
    summary: row.summary ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── CRUD ──

export function cleanupOldChatSessions(maxAgeDays: number = 180): number {
  const info = cleanupOldSessionsStmt().run(`-${maxAgeDays}`);
  return info.changes;
}

export function getSession(workspaceId: string, sessionId: string): ChatSession | null {
  const row = getSessionStmt().get(sessionId, workspaceId) as ChatRow | undefined;
  return row ? rowToSession(row) : null;
}

export function saveSession(session: ChatSession): void {
  upsertStmt().run({
    id: session.id,
    workspace_id: session.workspaceId,
    channel: session.channel,
    title: session.title,
    messages: JSON.stringify(session.messages),
    summary: session.summary ?? null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  });
}

export function deleteSession(workspaceId: string, sessionId: string): boolean {
  const info = deleteSessionStmt().run(sessionId, workspaceId);
  return info.changes > 0;
}

export function listSessions(workspaceId: string, channel?: string): SessionSummary[] {
  const rows = channel
    ? listSessionsByChannelStmt().all(workspaceId, channel) as ChatRow[]
    : listSessionsStmt().all(workspaceId) as ChatRow[];

  return rows.map(row => {
    const messages: ChatMessage[] = parseJsonFallback<ChatMessage[]>(row.messages, []);
    return {
      id: row.id,
      title: row.title,
      channel: row.channel,
      messageCount: messages.length,
      summary: row.summary ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

// ── Message helpers ──

export function addMessage(
  workspaceId: string,
  sessionId: string,
  channel: 'client' | 'admin' | 'search',
  role: 'user' | 'assistant',
  content: string,
): ChatSession {
  let session = getSession(workspaceId, sessionId);
  const now = new Date().toISOString();

  if (!session) {
    // Auto-generate title from first user message
    const title = role === 'user' ? content.slice(0, 60) + (content.length > 60 ? '...' : '') : 'New conversation';
    session = {
      id: sessionId,
      workspaceId,
      channel,
      title,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  session.messages.push({ role, content, timestamp: now });
  session.updatedAt = now;
  saveSession(session);
  return session;
}

// ── Rate limiting ──

export const FREE_CHAT_LIMIT = 3; // conversations per calendar month on free tier

/**
 * Count the number of unique conversations (sessions with >=1 user message)
 * in the current calendar month for a workspace on a given channel.
 */
export function getMonthlyConversationCount(workspaceId: string, channel: 'client' | 'admin' | 'search' = 'client'): number {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const sessions = listSessions(workspaceId, channel);
  return sessions.filter(s => {
    return s.createdAt >= monthStart && s.messageCount >= 1;
  }).length;
}

/**
 * Check if a workspace on free tier can start/continue a conversation.
 * Returns { allowed, used, limit, remaining }.
 */
export function checkChatRateLimit(workspaceId: string, tier: string, sessionId?: string): {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
} {
  if (tier !== 'free') return { allowed: true, used: 0, limit: Infinity, remaining: Infinity };

  const used = getMonthlyConversationCount(workspaceId, 'client');

  // If continuing an existing session, always allow
  if (sessionId) {
    const existing = getSession(workspaceId, sessionId);
    if (existing && existing.messages.length > 0) {
      return { allowed: true, used, limit: FREE_CHAT_LIMIT, remaining: Math.max(0, FREE_CHAT_LIMIT - used) };
    }
  }

  // New conversation — check limit
  const remaining = Math.max(0, FREE_CHAT_LIMIT - used);
  return { allowed: remaining > 0, used, limit: FREE_CHAT_LIMIT, remaining };
}

// ── Cross-session context ──

/**
 * Build a conversation context block from previous sessions.
 * Returns a summary of recent sessions + the current session's history.
 */
export function buildConversationContext(
  workspaceId: string,
  sessionId: string,
  channel: 'client' | 'admin' | 'search',
): { historyMessages: Array<{ role: 'user' | 'assistant'; content: string }>; priorContext: string } {
  const current = getSession(workspaceId, sessionId);
  const historyMessages = (current?.messages || []).map(m => ({
    role: m.role,
    content: m.content,
  }));

  // Get summaries from recent other sessions (up to 3)
  const allSessions = listSessions(workspaceId, channel);
  const priorSessions = allSessions
    .filter(s => s.id !== sessionId && s.summary)
    .slice(0, 3);

  let priorContext = '';
  if (priorSessions.length > 0) {
    priorContext = '\n\nPREVIOUS CONVERSATION SUMMARIES (use for continuity — the user may reference past discussions):\n' +
      priorSessions.map(s => `• [${new Date(s.updatedAt).toLocaleDateString()}] ${s.title}: ${s.summary}`).join('\n');
  }

  return { historyMessages, priorContext };
}

/**
 * Generate a session summary using AI. Called when a session reaches
 * a threshold of messages or when the user starts a new session.
 */
export async function generateSessionSummary(
  workspaceId: string,
  sessionId: string,
): Promise<string | null> {
  const session = getSession(workspaceId, sessionId);
  if (!session || session.messages.length < 2) return null;

  // Don't regenerate if we already have a summary and few messages
  if (session.summary && session.messages.length < 6) return session.summary;

  try {
    const transcript = session.messages
      .slice(-20) // last 20 messages max
      .map(m => `${m.role}: ${m.content.slice(0, 300)}`)
      .join('\n');

    const result = await callOpenAI({
      model: 'gpt-4.1-nano',
      messages: [
        { role: 'system', content: 'Summarize this conversation in 1-2 sentences. Focus on the key topics discussed, questions asked, and any preferences or concerns the user expressed. Be concise.' },
        { role: 'user', content: transcript },
      ],
      maxTokens: 150,
      temperature: 0.3,
      feature: 'chat-summary',
      workspaceId,
    });

    session.summary = result.text;
    saveSession(session);
    return result.text;
  } catch {
    return null;
  }
}
