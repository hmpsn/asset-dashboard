/**
 * Chat Memory — persistent conversation history for AI chatbots.
 * Stores sessions in SQLite, supports cross-session summaries.
 */

import db from './db/index.js';
import { MODEL_ROLES } from './model-manifest.js';
import { callAI } from './ai.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';
import { checkUsageLimit, decrementUsage, incrementIfAllowed } from './usage-tracking.js';
import type { ChatLimitErrorResponse, ChatUsageResponse, UsageTier } from '../shared/types/usage.js';


const log = createLogger('chat-memory');
const SESSION_SUMMARY_STORAGE_PREFIX = 'hmpsn:chat-summary:v1:';

/**
 * Conversation summaries are intentionally refreshed only at these bounded
 * milestones. This keeps cross-session context current without adding an AI
 * call to every turn after the first summary.
 */
export const SESSION_SUMMARY_MESSAGE_MILESTONES = [6, 20, 40] as const;

interface StoredSessionSummary {
  text?: string;
  summarizedMessageCount: number;
  isLegacy: boolean;
}

const summaryRefreshesInFlight = new Map<string, Promise<string | null>>();

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

const stmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT OR REPLACE INTO chat_sessions
      (id, workspace_id, channel, title, messages, summary, created_at, updated_at)
    VALUES (@id, @workspace_id, @channel, @title, @messages, @summary, @created_at, @updated_at)
  `),
  getSession: db.prepare<[sessionId: string, workspaceId: string]>(
    `SELECT * FROM chat_sessions WHERE id = ? AND workspace_id = ?`,
  ),
  updateSummaryIfCurrent: db.prepare<[
    summary: string,
    sessionId: string,
    workspaceId: string,
    expectedSummary: string | null,
  ]>(
    `UPDATE chat_sessions
     SET summary = ?
     WHERE id = ? AND workspace_id = ? AND summary IS ?`,
  ),
  deleteSession: db.prepare<[sessionId: string, workspaceId: string]>(
    `DELETE FROM chat_sessions WHERE id = ? AND workspace_id = ?`,
  ),
  listSessions: db.prepare<[workspaceId: string]>(
    `SELECT * FROM chat_sessions WHERE workspace_id = ? ORDER BY updated_at DESC`,
  ),
  listSessionsByChannel: db.prepare<[workspaceId: string, channel: string]>(
    `SELECT * FROM chat_sessions WHERE workspace_id = ? AND channel = ? ORDER BY updated_at DESC`,
  ),
  cleanupOldSessions: db.prepare<[daysExpr: string]>(
    `DELETE FROM chat_sessions WHERE updated_at < datetime('now', ? || ' days')`,
  ),
}));

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

function parseStoredSessionSummary(raw: string | null): StoredSessionSummary {
  if (!raw) return { summarizedMessageCount: 0, isLegacy: false };
  if (!raw.startsWith(SESSION_SUMMARY_STORAGE_PREFIX)) {
    // Summaries written before cadence metadata existed were generated at the
    // original six-message threshold. Treating them as such lets them refresh
    // at 20 and 40 without a migration or exposing new API fields.
    return {
      text: raw,
      summarizedMessageCount: SESSION_SUMMARY_MESSAGE_MILESTONES[0],
      isLegacy: true,
    };
  }

  const countStart = SESSION_SUMMARY_STORAGE_PREFIX.length;
  const countEnd = raw.indexOf(':', countStart);
  if (countEnd < 0) {
    return {
      summarizedMessageCount: 0,
      isLegacy: true,
    };
  }
  const summarizedMessageCount = Number(raw.slice(countStart, countEnd));
  if (!Number.isSafeInteger(summarizedMessageCount) || summarizedMessageCount < 1) {
    return {
      text: raw.slice(countEnd + 1).trim() || undefined,
      summarizedMessageCount: 0,
      isLegacy: true,
    };
  }

  return {
    text: raw.slice(countEnd + 1),
    summarizedMessageCount,
    isLegacy: false,
  };
}

function serializeStoredSessionSummary(text: string, summarizedMessageCount: number): string {
  return `${SESSION_SUMMARY_STORAGE_PREFIX}${summarizedMessageCount}:${text}`;
}

function rowToSession(row: ChatRow): ChatSession {
  const storedSummary = parseStoredSessionSummary(row.summary);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    channel: row.channel,
    title: row.title,
    messages: parseJsonFallback<ChatMessage[]>(row.messages, []),
    summary: storedSummary.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── CRUD ──

export function cleanupOldChatSessions(maxAgeDays: number = 180): number {
  const info = stmts().cleanupOldSessions.run(`-${maxAgeDays}`);
  return info.changes;
}

export function getSession(workspaceId: string, sessionId: string): ChatSession | null {
  const row = stmts().getSession.get(sessionId, workspaceId) as ChatRow | undefined;
  return row ? rowToSession(row) : null;
}

export function saveSession(session: ChatSession): void {
  stmts().upsert.run({
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
  const info = stmts().deleteSession.run(sessionId, workspaceId);
  return info.changes > 0;
}

export function listSessions(workspaceId: string, channel?: string): SessionSummary[] {
  const rows = channel
    ? stmts().listSessionsByChannel.all(workspaceId, channel) as ChatRow[]
    : stmts().listSessions.all(workspaceId) as ChatRow[];

  return rows.map(row => {
    const messages: ChatMessage[] = parseJsonFallback<ChatMessage[]>(row.messages, []);
    const storedSummary = parseStoredSessionSummary(row.summary);
    return {
      id: row.id,
      title: row.title,
      channel: row.channel,
      messageCount: messages.length,
      summary: storedSummary.text,
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
  const existingRow = stmts().getSession.get(sessionId, workspaceId) as ChatRow | undefined;
  let session = existingRow ? rowToSession(existingRow) : null;
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
  // Preserve the stored summary envelope while appending messages. Public
  // ChatSession objects deliberately expose only the summary text, so writing
  // that parsed object through saveSession() would discard cadence metadata.
  stmts().upsert.run({
    id: session.id,
    workspace_id: session.workspaceId,
    channel: session.channel,
    title: session.title,
    messages: JSON.stringify(session.messages),
    summary: existingRow?.summary ?? null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  });
  return session;
}

// ── Rate limiting ──

export const FREE_CHAT_LIMIT = 3; // conversations per calendar month on free tier
const CHAT_USAGE_FEATURE = 'ai_chats';

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
export interface ChatRateLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

export interface ChatUsageReservation extends ChatRateLimitResult {
  reserved: boolean;
}

function normalizeUsageTier(tier: string): UsageTier {
  return tier === 'growth' || tier === 'premium' ? tier : 'free';
}

export function formatChatUsageResponse(result: ChatRateLimitResult, tier: string): ChatUsageResponse {
  return {
    allowed: result.allowed,
    used: result.used,
    limit: Number.isFinite(result.limit) ? result.limit : null,
    remaining: Number.isFinite(result.remaining) ? result.remaining : null,
    tier: normalizeUsageTier(tier),
  };
}

export function formatChatLimitError(result: ChatRateLimitResult, tier: string): ChatLimitErrorResponse {
  const response = formatChatUsageResponse(result, tier);
  const upgradeTier = response.tier === 'growth' ? 'Premium' : 'Growth';
  const limitText = response.limit ?? 'your';
  return {
    ...response,
    error: 'Chat limit reached',
    code: 'usage_limit',
    message: `You've used all ${limitText} ${response.tier} chat conversations this month. Upgrade to ${upgradeTier} for more chat access.`,
  };
}

/**
 * Check current chat usage. Usage tracking is authoritative for all tiers.
 * The legacy session counter remains exported for historical tests/diagnostics,
 * but monthly limits now come from usage_tracking.ai_chats.
 */
export function checkChatRateLimit(workspaceId: string, tier: string, sessionId?: string): ChatRateLimitResult {
  const usage = checkUsageLimit(workspaceId, tier, CHAT_USAGE_FEATURE);

  // If continuing an existing session, always allow
  if (sessionId) {
    const existing = getSession(workspaceId, sessionId);
    if (existing?.channel === 'client' && existing.messages.length > 0) {
      return { ...usage, allowed: true };
    }
  }

  return usage;
}

/**
 * Reserve a monthly chat slot for a new conversation before calling AI.
 * Existing conversations do not consume additional slots, which keeps the
 * monthly limit scoped to new conversations while still allowing follow-ups.
 */
export function reserveChatUsageIfNeeded(workspaceId: string, tier: string, sessionId?: string): ChatUsageReservation {
  if (sessionId) {
    const existing = getSession(workspaceId, sessionId);
    if (existing?.channel === 'client' && existing.messages.length > 0) {
      return { ...checkChatRateLimit(workspaceId, tier, sessionId), reserved: false };
    }
  }

  if (!incrementIfAllowed(workspaceId, tier, CHAT_USAGE_FEATURE)) {
    return { ...checkUsageLimit(workspaceId, tier, CHAT_USAGE_FEATURE), allowed: false, reserved: false };
  }

  return { ...checkUsageLimit(workspaceId, tier, CHAT_USAGE_FEATURE), allowed: true, reserved: true };
}

export function refundReservedChatUsage(workspaceId: string): void {
  decrementUsage(workspaceId, CHAT_USAGE_FEATURE);
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
  const historyMessages = (current?.channel === channel ? current.messages : []).map(m => ({
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

export function isSessionSummaryMilestone(messageCount: number): boolean {
  return SESSION_SUMMARY_MESSAGE_MILESTONES.some(milestone => milestone === messageCount);
}

export function shouldAttemptSessionSummary(messageCount: number): boolean {
  return messageCount >= SESSION_SUMMARY_MESSAGE_MILESTONES[0];
}

function summaryMilestoneDue(messageCount: number, summarizedMessageCount: number): number | null {
  for (let index = SESSION_SUMMARY_MESSAGE_MILESTONES.length - 1; index >= 0; index -= 1) {
    const milestone = SESSION_SUMMARY_MESSAGE_MILESTONES[index];
    if (messageCount >= milestone && summarizedMessageCount < milestone) return milestone;
  }
  return null;
}

export interface GenerateSessionSummaryOptions {
  /** Automatic callers are bounded to 6/20/40; manual callers summarize on demand. */
  trigger?: 'automatic' | 'manual';
}

/**
 * Generate or refresh once after crossing each bounded 6/20/40 threshold.
 * Later automatic attempts reuse the stored summary until the next threshold;
 * a missed or failed exact-count attempt can recover on the following turn.
 */
export async function generateSessionSummary(
  workspaceId: string,
  sessionId: string,
  options: GenerateSessionSummaryOptions = {},
): Promise<string | null> {
  const row = stmts().getSession.get(sessionId, workspaceId) as ChatRow | undefined;
  if (!row) return null;

  const session = rowToSession(row);
  const storedSummary = parseStoredSessionSummary(row.summary);
  const trigger = options.trigger ?? 'automatic';
  const dueMilestone = trigger === 'manual'
    ? (
        session.messages.length >= 2 &&
        (storedSummary.isLegacy || session.messages.length > storedSummary.summarizedMessageCount)
          ? session.messages.length
          : null
      )
    : summaryMilestoneDue(session.messages.length, storedSummary.summarizedMessageCount);
  if (dueMilestone == null) return storedSummary.text ?? null;

  const targetMessageCount = session.messages.length;
  const refreshKey = `${workspaceId}\u0000${sessionId}\u0000${row.created_at}\u0000${trigger}\u0000${dueMilestone}`;
  const existingRefresh = summaryRefreshesInFlight.get(refreshKey);
  if (existingRefresh) return existingRefresh;

  const refresh = (async (): Promise<string | null> => {
    try {
      const transcript = session.messages
        .slice(-20) // last 20 messages max
        .map(m => `${m.role}: ${m.content.slice(0, 300)}`)
        .join('\n');

      const result = await callAI({
        model: MODEL_ROLES.utilityExtraction,
        system: 'Summarize this conversation in 1-2 sentences. Focus on the key topics discussed, questions asked, and any preferences or concerns the user expressed. Be concise.',
        messages: [{ role: 'user', content: transcript }],
        maxTokens: 150,
        temperature: 0.3,
        feature: 'chat-summary',
        workspaceId,
      });
      const nextSummary = result.text.trim();
      if (!nextSummary) return storedSummary.text ?? null;

      // A newer milestone may finish first under concurrent requests. Re-read
      // before writing so an older in-flight summary can never overwrite it.
      const latestRow = stmts().getSession.get(sessionId, workspaceId) as ChatRow | undefined;
      if (!latestRow) return null;
      const latestSummary = parseStoredSessionSummary(latestRow.summary);
      const latestMessageCount = rowToSession(latestRow).messages.length;
      if (latestRow.created_at !== row.created_at || latestMessageCount < targetMessageCount) {
        return latestSummary.text ?? null;
      }
      if (latestSummary.summarizedMessageCount >= targetMessageCount) {
        return latestSummary.text ?? null;
      }

      const update = stmts().updateSummaryIfCurrent.run(
        serializeStoredSessionSummary(nextSummary, targetMessageCount),
        sessionId,
        workspaceId,
        latestRow.summary,
      );
      if (update.changes === 0) {
        const currentRow = stmts().getSession.get(sessionId, workspaceId) as ChatRow | undefined;
        return currentRow ? parseStoredSessionSummary(currentRow.summary).text ?? null : null;
      }
      return nextSummary;
    } catch (err) {
      if (isProgrammingError(err)) log.warn({ err }, 'chat-memory/generateSessionSummary: programming error');
      return storedSummary.text ?? null;
    }
  })();

  summaryRefreshesInFlight.set(refreshKey, refresh);
  void refresh.finally(() => {
    if (summaryRefreshesInFlight.get(refreshKey) === refresh) {
      summaryRefreshesInFlight.delete(refreshKey);
    }
  });
  return refresh;
}
