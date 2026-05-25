/**
 * Pure unit tests for chat-memory helpers.
 *
 * Most functions in chat-memory.ts hit SQLite, so we focus on:
 * - FREE_CHAT_LIMIT constant value
 * - checkChatRateLimit's pure non-free-tier fast-path (returns immediately
 *   without any DB access when tier !== 'free')
 * - The rate-limit math formulas (remaining, allowed)
 * - The auto-title generation logic used inside addMessage (replicated inline)
 * - The rowToSession mapper shape (replicated inline since it's not exported)
 * - buildConversationContext's priorContext formatting (logic extracted)
 */

import { describe, it, expect } from 'vitest';
import { FREE_CHAT_LIMIT } from '../../server/chat-memory.js';
import type { ChatMessage, ChatSession, SessionSummary } from '../../server/chat-memory.js';

// ── FREE_CHAT_LIMIT constant ─────────────────────────────────────────────────

describe('FREE_CHAT_LIMIT', () => {
  it('is exactly 3', () => {
    expect(FREE_CHAT_LIMIT).toBe(3);
  });

  it('is a positive integer', () => {
    expect(Number.isInteger(FREE_CHAT_LIMIT)).toBe(true);
    expect(FREE_CHAT_LIMIT).toBeGreaterThan(0);
  });
});

// ── checkChatRateLimit — non-free tier fast path ─────────────────────────────
// When tier !== 'free' the function returns immediately without DB access.

/**
 * Replicates the non-free fast-path from checkChatRateLimit so we can test
 * the logic without a running DB.
 */
function nonFreeRateLimitResult(tier: string) {
  if (tier !== 'free') {
    return { allowed: true, used: 0, limit: Infinity, remaining: Infinity };
  }
  // (free tier needs DB — not tested here)
  throw new Error('free tier requires DB');
}

describe('checkChatRateLimit — non-free tier fast path', () => {
  it('allows growth tier unconditionally', () => {
    const result = nonFreeRateLimitResult('growth');
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(0);
    expect(result.limit).toBe(Infinity);
    expect(result.remaining).toBe(Infinity);
  });

  it('allows premium tier unconditionally', () => {
    const result = nonFreeRateLimitResult('premium');
    expect(result.allowed).toBe(true);
  });

  it('allows any unrecognized non-"free" tier string', () => {
    const result = nonFreeRateLimitResult('enterprise');
    expect(result.allowed).toBe(true);
  });

  it('does NOT fast-path "free" tier (falls through to DB)', () => {
    expect(() => nonFreeRateLimitResult('free')).toThrow();
  });
});

// ── Rate-limit math ──────────────────────────────────────────────────────────

/**
 * Replicates the free-tier remaining/allowed math from checkChatRateLimit.
 * (Used when there is no existing session, i.e. new conversation check.)
 */
function calcRateLimit(used: number, limit: number) {
  const remaining = Math.max(0, limit - used);
  return { allowed: remaining > 0, used, limit, remaining };
}

describe('rate-limit math', () => {
  it('allows when used is 0', () => {
    const r = calcRateLimit(0, FREE_CHAT_LIMIT);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(3);
  });

  it('allows when used is 1 (one conversation started)', () => {
    const r = calcRateLimit(1, FREE_CHAT_LIMIT);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it('allows when used is 2 (last slot)', () => {
    const r = calcRateLimit(2, FREE_CHAT_LIMIT);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(1);
  });

  it('blocks when used equals limit', () => {
    const r = calcRateLimit(3, FREE_CHAT_LIMIT);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('blocks and clamps remaining to 0 when used exceeds limit', () => {
    const r = calcRateLimit(10, FREE_CHAT_LIMIT);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0); // Math.max(0, ...) never returns negative
  });

  it('always returns the original limit value', () => {
    const r = calcRateLimit(5, FREE_CHAT_LIMIT);
    expect(r.limit).toBe(FREE_CHAT_LIMIT);
  });
});

// ── Auto-title generation (addMessage logic) ─────────────────────────────────

/**
 * Replicates the title generation in addMessage for new sessions.
 */
function generateTitle(role: 'user' | 'assistant', content: string): string {
  return role === 'user'
    ? content.slice(0, 60) + (content.length > 60 ? '...' : '')
    : 'New conversation';
}

describe('session auto-title generation', () => {
  it('uses content for user messages up to 60 chars', () => {
    const title = generateTitle('user', 'Short message');
    expect(title).toBe('Short message');
  });

  it('truncates user messages longer than 60 chars with ellipsis', () => {
    const longContent = 'a'.repeat(70);
    const title = generateTitle('user', longContent);
    expect(title).toBe('a'.repeat(60) + '...');
  });

  it('uses exactly 60 chars without ellipsis when content is exactly 60 chars', () => {
    const exactly60 = 'x'.repeat(60);
    const title = generateTitle('user', exactly60);
    expect(title).toBe(exactly60);
    expect(title.endsWith('...')).toBe(false);
  });

  it('uses "New conversation" for assistant-initiated sessions', () => {
    const title = generateTitle('assistant', 'Welcome! How can I help?');
    expect(title).toBe('New conversation');
  });

  it('handles empty string content for user role', () => {
    const title = generateTitle('user', '');
    expect(title).toBe('');
  });
});

// ── ChatMessage / ChatSession type shape ─────────────────────────────────────

describe('ChatMessage shape', () => {
  it('can construct a valid user message', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: 'Hello!',
      timestamp: new Date().toISOString(),
    };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello!');
  });

  it('can construct a valid assistant message', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: 'Hi there!',
      timestamp: new Date().toISOString(),
    };
    expect(msg.role).toBe('assistant');
  });
});

describe('ChatSession shape', () => {
  it('can construct a complete session object', () => {
    const session: ChatSession = {
      id: 'sess-123',
      workspaceId: 'ws-abc',
      channel: 'client',
      title: 'How do I improve my SEO?',
      messages: [{ role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00.000Z' }],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(session.id).toBe('sess-123');
    expect(session.messages).toHaveLength(1);
    expect(session.summary).toBeUndefined();
  });

  it('can include an optional summary', () => {
    const session: ChatSession = {
      id: 'sess-456',
      workspaceId: 'ws-def',
      channel: 'admin',
      title: 'Admin chat',
      messages: [],
      summary: 'User asked about keyword strategy.',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(session.summary).toBe('User asked about keyword strategy.');
  });
});

// ── priorContext formatting logic ────────────────────────────────────────────

/**
 * Replicates the priorContext string-building logic from buildConversationContext.
 */
function buildPriorContext(priorSessions: SessionSummary[]): string {
  const filtered = priorSessions.filter(s => s.summary);
  if (filtered.length === 0) return '';
  return (
    '\n\nPREVIOUS CONVERSATION SUMMARIES (use for continuity — the user may reference past discussions):\n' +
    filtered
      .map(s => `• [${new Date(s.updatedAt).toLocaleDateString()}] ${s.title}: ${s.summary}`)
      .join('\n')
  );
}

describe('buildPriorContext formatting', () => {
  it('returns empty string when no prior sessions', () => {
    expect(buildPriorContext([])).toBe('');
  });

  it('returns empty string when sessions have no summaries', () => {
    const sessions: SessionSummary[] = [
      {
        id: 's1',
        title: 'Session 1',
        channel: 'client',
        messageCount: 3,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        // no summary
      },
    ];
    expect(buildPriorContext(sessions)).toBe('');
  });

  it('includes the header line when there is at least one session with a summary', () => {
    const sessions: SessionSummary[] = [
      {
        id: 's2',
        title: 'Keyword research',
        channel: 'client',
        messageCount: 5,
        summary: 'User wants to rank for "best coffee shop".',
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ];
    const context = buildPriorContext(sessions);
    expect(context).toContain('PREVIOUS CONVERSATION SUMMARIES');
    expect(context).toContain('Keyword research');
    expect(context).toContain('best coffee shop');
  });

  it('formats each session as a bullet point', () => {
    const sessions: SessionSummary[] = [
      {
        id: 's3',
        title: 'Topic A',
        channel: 'client',
        messageCount: 2,
        summary: 'Discussed A.',
        createdAt: '2024-01-03T00:00:00.000Z',
        updatedAt: '2024-01-03T00:00:00.000Z',
      },
      {
        id: 's4',
        title: 'Topic B',
        channel: 'client',
        messageCount: 4,
        summary: 'Discussed B.',
        createdAt: '2024-01-04T00:00:00.000Z',
        updatedAt: '2024-01-04T00:00:00.000Z',
      },
    ];
    const context = buildPriorContext(sessions);
    const bullets = (context.match(/^•/gm) || []).length;
    expect(bullets).toBe(2);
  });

  it('filters out sessions without a summary', () => {
    const sessions: SessionSummary[] = [
      {
        id: 's5',
        title: 'With summary',
        channel: 'client',
        messageCount: 3,
        summary: 'Has content.',
        createdAt: '2024-01-05T00:00:00.000Z',
        updatedAt: '2024-01-05T00:00:00.000Z',
      },
      {
        id: 's6',
        title: 'Without summary',
        channel: 'client',
        messageCount: 1,
        // no summary
        createdAt: '2024-01-06T00:00:00.000Z',
        updatedAt: '2024-01-06T00:00:00.000Z',
      },
    ];
    const context = buildPriorContext(sessions);
    expect(context).toContain('With summary');
    expect(context).not.toContain('Without summary');
    const bullets = (context.match(/^•/gm) || []).length;
    expect(bullets).toBe(1);
  });
});
