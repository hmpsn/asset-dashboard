/**
 * Chat Memory — persistent conversation history for AI chatbots.
 * Stores sessions to disk as JSON, supports cross-session summaries.
 */

import fs from 'fs';
import path from 'path';
import { getDataDir } from './data-dir.js';
import { callOpenAI } from './openai-helpers.js';

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

function sessionsDir(workspaceId: string): string {
  return getDataDir(path.join('chat-sessions', workspaceId));
}

function sessionPath(workspaceId: string, sessionId: string): string {
  return path.join(sessionsDir(workspaceId), `${sessionId}.json`);
}

// ── CRUD ──

export function getSession(workspaceId: string, sessionId: string): ChatSession | null {
  const fp = sessionPath(workspaceId, sessionId);
  try {
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch { return null; }
}

export function saveSession(session: ChatSession): void {
  const dir = sessionsDir(session.workspaceId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionPath(session.workspaceId, session.id), JSON.stringify(session, null, 2));
}

export function deleteSession(workspaceId: string, sessionId: string): boolean {
  const fp = sessionPath(workspaceId, sessionId);
  try {
    if (fs.existsSync(fp)) { fs.unlinkSync(fp); return true; }
  } catch { /* ignore */ }
  return false;
}

export function listSessions(workspaceId: string, channel?: string): SessionSummary[] {
  const dir = sessionsDir(workspaceId);
  if (!fs.existsSync(dir)) return [];
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const sessions: SessionSummary[] = [];
    for (const file of files) {
      try {
        const data: ChatSession = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        if (channel && data.channel !== channel) continue;
        sessions.push({
          id: data.id,
          title: data.title,
          channel: data.channel,
          messageCount: data.messages.length,
          summary: data.summary,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
      } catch { /* skip corrupt files */ }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch { return []; }
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
 * Count the number of unique conversations (sessions with ≥1 user message)
 * in the current calendar month for a workspace on a given channel.
 */
export function getMonthlyConversationCount(workspaceId: string, channel: 'client' | 'admin' | 'search' = 'client'): number {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const sessions = listSessions(workspaceId, channel);
  return sessions.filter(s => {
    // Session must have been created this month and have at least 1 message (from user)
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
      model: 'gpt-4o-mini',
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
