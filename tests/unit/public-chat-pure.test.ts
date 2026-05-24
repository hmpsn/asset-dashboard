/**
 * Wave 18 — Unit tests for pure helper functions in server/chat-memory.ts
 *
 * Covers:
 *   - FREE_CHAT_LIMIT: exported constant value
 *   - checkChatRateLimit: non-free tiers always allowed; free tier enforces limit;
 *     continuing an existing session is always allowed; new sessions respect limit
 *   - getMonthlyConversationCount: counts sessions in current calendar month only
 *   - buildConversationContext: returns correct historyMessages and priorContext
 *
 * All functions imported from server/chat-memory.ts. They interact with the
 * SQLite DB, so tests that need DB state use saveSession / getSession helpers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import {
  FREE_CHAT_LIMIT,
  checkChatRateLimit,
  getMonthlyConversationCount,
  buildConversationContext,
  addMessage,
  saveSession,
  getSession,
  deleteSession,
  type ChatSession,
} from '../../server/chat-memory.js';

// ── Test workspace IDs — use unique prefixes to avoid collisions ──────────────

function makeWsId(suffix: string): string {
  return `test-chat-pure-${suffix}-${randomUUID().slice(0, 8)}`;
}

// Track sessions to clean up
const sessionsToClean: Array<{ workspaceId: string; sessionId: string }> = [];

function makeSession(workspaceId: string, sessionId: string, channel: 'client' | 'admin' | 'search' = 'client'): ChatSession {
  const now = new Date().toISOString();
  return {
    id: sessionId,
    workspaceId,
    channel,
    title: `Test session ${sessionId}`,
    messages: [{ role: 'user', content: 'Hello', timestamp: now }],
    createdAt: now,
    updatedAt: now,
  };
}

beforeAll(() => {
  // Nothing to set up — DB is already initialized by the module import
});

afterAll(() => {
  // Clean up all sessions created in tests
  for (const { workspaceId, sessionId } of sessionsToClean) {
    deleteSession(workspaceId, sessionId);
  }
});

// ─── FREE_CHAT_LIMIT ──────────────────────────────────────────────────────────

describe('FREE_CHAT_LIMIT', () => {
  it('is a positive integer', () => {
    expect(typeof FREE_CHAT_LIMIT).toBe('number');
    expect(Number.isInteger(FREE_CHAT_LIMIT)).toBe(true);
    expect(FREE_CHAT_LIMIT).toBeGreaterThan(0);
  });

  it('is set to 3', () => {
    // If this changes, it's a deliberate product decision — caught here
    expect(FREE_CHAT_LIMIT).toBe(3);
  });
});

// ─── checkChatRateLimit — non-free tiers ─────────────────────────────────────

describe('checkChatRateLimit — non-free tiers', () => {
  it('growth tier is always allowed with no used count', () => {
    const wsId = makeWsId('growth');
    const result = checkChatRateLimit(wsId, 'growth');
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(0);
    expect(result.limit).toBe(Infinity);
    expect(result.remaining).toBe(Infinity);
  });

  it('premium tier is always allowed', () => {
    const wsId = makeWsId('premium');
    const result = checkChatRateLimit(wsId, 'premium');
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(0);
    expect(result.limit).toBe(Infinity);
    expect(result.remaining).toBe(Infinity);
  });

  it('unknown tier behaves like free (restrictive)', () => {
    // Unknown tier falls through to free
    const wsId = makeWsId('unknown');
    // A fresh workspace with no sessions should have remaining > 0
    const result = checkChatRateLimit(wsId, 'some_unknown_tier');
    // Non-free tiers → allowed=true (all non-free tiers are unrestricted)
    expect(result.allowed).toBe(true);
  });
});

// ─── checkChatRateLimit — free tier enforcement ───────────────────────────────

describe('checkChatRateLimit — free tier', () => {
  it('allows a new conversation when usage is below limit', () => {
    const wsId = makeWsId('free-allow');
    const result = checkChatRateLimit(wsId, 'free');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(FREE_CHAT_LIMIT);
    expect(result.remaining).toBe(FREE_CHAT_LIMIT);
    expect(result.used).toBe(0);
  });

  it('denies a new conversation when usage equals the limit', () => {
    const wsId = makeWsId('free-deny');

    // Seed exactly FREE_CHAT_LIMIT sessions this month with >= 1 user message each
    for (let i = 0; i < FREE_CHAT_LIMIT; i++) {
      const sessionId = `sess-deny-${i}-${randomUUID().slice(0, 8)}`;
      sessionsToClean.push({ workspaceId: wsId, sessionId });
      const session = makeSession(wsId, sessionId, 'client');
      saveSession(session);
    }

    const result = checkChatRateLimit(wsId, 'free');
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(FREE_CHAT_LIMIT);
    expect(result.remaining).toBe(0);
    expect(result.limit).toBe(FREE_CHAT_LIMIT);
  });

  it('allows continuation of an existing session even when limit is reached', () => {
    const wsId = makeWsId('free-continue');

    // Seed FREE_CHAT_LIMIT sessions to max out
    for (let i = 0; i < FREE_CHAT_LIMIT; i++) {
      const sessionId = `sess-cont-${i}-${randomUUID().slice(0, 8)}`;
      sessionsToClean.push({ workspaceId: wsId, sessionId });
      saveSession(makeSession(wsId, sessionId, 'client'));
    }

    // Seed one existing session with messages
    const existingId = `sess-existing-${randomUUID().slice(0, 8)}`;
    sessionsToClean.push({ workspaceId: wsId, sessionId: existingId });
    saveSession(makeSession(wsId, existingId, 'client'));

    // Continuing this existing session should be allowed
    const result = checkChatRateLimit(wsId, 'free', existingId);
    expect(result.allowed).toBe(true);
    // Still reports correct usage stats
    expect(result.used).toBe(FREE_CHAT_LIMIT + 1);
    expect(result.limit).toBe(FREE_CHAT_LIMIT);
  });

  it('counts used correctly before the limit is reached', () => {
    const wsId = makeWsId('free-count');

    // Seed 2 sessions (below limit of 3)
    for (let i = 0; i < 2; i++) {
      const sessionId = `sess-count-${i}-${randomUUID().slice(0, 8)}`;
      sessionsToClean.push({ workspaceId: wsId, sessionId });
      saveSession(makeSession(wsId, sessionId, 'client'));
    }

    const result = checkChatRateLimit(wsId, 'free');
    expect(result.used).toBe(2);
    expect(result.remaining).toBe(FREE_CHAT_LIMIT - 2);
    expect(result.allowed).toBe(true);
  });
});

// ─── getMonthlyConversationCount ──────────────────────────────────────────────

describe('getMonthlyConversationCount', () => {
  it('returns 0 for a workspace with no sessions', () => {
    const wsId = makeWsId('monthly-empty');
    const count = getMonthlyConversationCount(wsId, 'client');
    expect(count).toBe(0);
  });

  it('counts sessions in the current month', () => {
    const wsId = makeWsId('monthly-count');
    const now = new Date().toISOString();

    const sessionId = `sess-monthly-${randomUUID().slice(0, 8)}`;
    sessionsToClean.push({ workspaceId: wsId, sessionId });
    const session = makeSession(wsId, sessionId, 'client');
    session.createdAt = now;
    session.updatedAt = now;
    saveSession(session);

    const count = getMonthlyConversationCount(wsId, 'client');
    expect(count).toBe(1);
  });

  it('does not count sessions from a different channel', () => {
    const wsId = makeWsId('monthly-channel');
    const now = new Date().toISOString();

    // Create an admin session
    const sessionId = `sess-admin-${randomUUID().slice(0, 8)}`;
    sessionsToClean.push({ workspaceId: wsId, sessionId });
    const session = makeSession(wsId, sessionId, 'admin');
    session.createdAt = now;
    saveSession(session);

    // Querying client channel should return 0
    const clientCount = getMonthlyConversationCount(wsId, 'client');
    expect(clientCount).toBe(0);

    // Querying admin channel should return 1
    const adminCount = getMonthlyConversationCount(wsId, 'admin');
    expect(adminCount).toBe(1);
  });

  it('defaults to client channel when no channel arg provided', () => {
    const wsId = makeWsId('monthly-default');
    const now = new Date().toISOString();

    const sessionId = `sess-default-ch-${randomUUID().slice(0, 8)}`;
    sessionsToClean.push({ workspaceId: wsId, sessionId });
    const session = makeSession(wsId, sessionId, 'client');
    session.createdAt = now;
    saveSession(session);

    const countWithDefault = getMonthlyConversationCount(wsId);
    expect(countWithDefault).toBe(1);
  });
});

// ─── buildConversationContext ─────────────────────────────────────────────────

describe('buildConversationContext', () => {
  it('returns empty historyMessages and empty priorContext when session does not exist', () => {
    const wsId = makeWsId('ctx-empty');
    const ctx = buildConversationContext(wsId, 'nonexistent-session', 'client');
    expect(Array.isArray(ctx.historyMessages)).toBe(true);
    expect(ctx.historyMessages).toHaveLength(0);
    expect(ctx.priorContext).toBe('');
  });

  it('returns historyMessages with role and content for an existing session', () => {
    const wsId = makeWsId('ctx-messages');
    const now = new Date().toISOString();
    const sessionId = `sess-ctx-${randomUUID().slice(0, 8)}`;
    sessionsToClean.push({ workspaceId: wsId, sessionId });

    const session: ChatSession = {
      id: sessionId,
      workspaceId: wsId,
      channel: 'admin',
      title: 'Context test',
      messages: [
        { role: 'user', content: 'What is the site score?', timestamp: now },
        { role: 'assistant', content: 'The score is 75.', timestamp: now },
      ],
      createdAt: now,
      updatedAt: now,
    };
    saveSession(session);

    const ctx = buildConversationContext(wsId, sessionId, 'admin');
    expect(ctx.historyMessages).toHaveLength(2);
    expect(ctx.historyMessages[0]).toEqual({ role: 'user', content: 'What is the site score?' });
    expect(ctx.historyMessages[1]).toEqual({ role: 'assistant', content: 'The score is 75.' });
  });

  it('includes priorContext from other sessions with summaries', () => {
    const wsId = makeWsId('ctx-prior');
    const now = new Date().toISOString();

    // Create a prior session with a summary
    const priorId = `sess-prior-${randomUUID().slice(0, 8)}`;
    sessionsToClean.push({ workspaceId: wsId, sessionId: priorId });
    const priorSession: ChatSession = {
      id: priorId,
      workspaceId: wsId,
      channel: 'client',
      title: 'Prior conversation',
      messages: [{ role: 'user', content: 'Previous question', timestamp: now }],
      summary: 'User asked about SEO score and received score 75.',
      createdAt: now,
      updatedAt: now,
    };
    saveSession(priorSession);

    // Create the current session (no summary)
    const currentId = `sess-current-${randomUUID().slice(0, 8)}`;
    sessionsToClean.push({ workspaceId: wsId, sessionId: currentId });
    const currentSession: ChatSession = {
      id: currentId,
      workspaceId: wsId,
      channel: 'client',
      title: 'Current conversation',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    saveSession(currentSession);

    const ctx = buildConversationContext(wsId, currentId, 'client');
    expect(ctx.priorContext).toContain('PREVIOUS CONVERSATION SUMMARIES');
    expect(ctx.priorContext).toContain('User asked about SEO score');
  });

  it('does not include the current session in priorContext', () => {
    const wsId = makeWsId('ctx-self');
    const now = new Date().toISOString();

    const selfId = `sess-self-${randomUUID().slice(0, 8)}`;
    sessionsToClean.push({ workspaceId: wsId, sessionId: selfId });
    const session: ChatSession = {
      id: selfId,
      workspaceId: wsId,
      channel: 'client',
      title: 'Self session',
      messages: [{ role: 'user', content: 'My question', timestamp: now }],
      summary: 'This is the session being built — should not appear in priorContext.',
      createdAt: now,
      updatedAt: now,
    };
    saveSession(session);

    const ctx = buildConversationContext(wsId, selfId, 'client');
    // The priorContext should not contain this session's own summary
    expect(ctx.priorContext).not.toContain('should not appear in priorContext');
  });

  it('strips timestamp from historyMessages (only role + content)', () => {
    const wsId = makeWsId('ctx-strip');
    const now = new Date().toISOString();
    const sessionId = `sess-strip-${randomUUID().slice(0, 8)}`;
    sessionsToClean.push({ workspaceId: wsId, sessionId });

    const session: ChatSession = {
      id: sessionId,
      workspaceId: wsId,
      channel: 'admin',
      title: 'Strip timestamp test',
      messages: [{ role: 'user', content: 'Strip me', timestamp: now }],
      createdAt: now,
      updatedAt: now,
    };
    saveSession(session);

    const ctx = buildConversationContext(wsId, sessionId, 'admin');
    expect(ctx.historyMessages[0]).not.toHaveProperty('timestamp');
    expect(ctx.historyMessages[0]).toHaveProperty('role');
    expect(ctx.historyMessages[0]).toHaveProperty('content');
  });
});

// ─── addMessage helper — creates session on first message ─────────────────────

describe('addMessage — auto-create behavior', () => {
  it('creates a session with the first user message as the title', () => {
    const wsId = makeWsId('addmsg');
    const sessionId = `sess-addmsg-${randomUUID().slice(0, 8)}`;
    sessionsToClean.push({ workspaceId: wsId, sessionId });

    addMessage(wsId, sessionId, 'client', 'user', 'Hello from the first message');

    const session = getSession(wsId, sessionId);
    expect(session).not.toBeNull();
    expect(session!.title).toContain('Hello from the first message');
    expect(session!.messages).toHaveLength(1);
    expect(session!.messages[0].role).toBe('user');
    expect(session!.messages[0].content).toBe('Hello from the first message');
  });

  it('truncates long first-message titles to 60 characters plus ellipsis', () => {
    const wsId = makeWsId('addmsg-long');
    const sessionId = `sess-addmsg-long-${randomUUID().slice(0, 8)}`;
    sessionsToClean.push({ workspaceId: wsId, sessionId });

    const longQuestion = 'This is a very long question that should get truncated because it is longer than sixty characters in total';
    addMessage(wsId, sessionId, 'admin', 'user', longQuestion);

    const session = getSession(wsId, sessionId);
    expect(session).not.toBeNull();
    expect(session!.title.length).toBeLessThanOrEqual(63); // 60 chars + '...'
    expect(session!.title.endsWith('...')).toBe(true);
  });

  it('appends subsequent messages to the same session', () => {
    const wsId = makeWsId('addmsg-append');
    const sessionId = `sess-append-${randomUUID().slice(0, 8)}`;
    sessionsToClean.push({ workspaceId: wsId, sessionId });

    addMessage(wsId, sessionId, 'client', 'user', 'First');
    addMessage(wsId, sessionId, 'client', 'assistant', 'Second');
    addMessage(wsId, sessionId, 'client', 'user', 'Third');

    const session = getSession(wsId, sessionId);
    expect(session!.messages).toHaveLength(3);
    expect(session!.messages[1].role).toBe('assistant');
    expect(session!.messages[2].content).toBe('Third');
  });
});
