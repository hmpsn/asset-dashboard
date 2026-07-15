import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callAI: vi.fn(),
}));

vi.mock('../../server/ai.js', () => ({
  callAI: mocks.callAI,
}));

import {
  addMessage,
  deleteSession,
  generateSessionSummary,
  getSession,
  isSessionSummaryMilestone,
  listSessions,
  saveSession,
  shouldAttemptSessionSummary,
  type ChatMessage,
  type ChatSession,
} from '../../server/chat-memory.js';

const sessionsToClean: Array<{ workspaceId: string; sessionId: string }> = [];

function messages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `Message ${index + 1}`,
    timestamp: new Date(2026, 0, 1, 0, index).toISOString(),
  }));
}

function createSession(messageCount: number, summary?: string): ChatSession {
  const workspaceId = `ws-summary-cadence-${randomUUID()}`;
  const sessionId = `session-${randomUUID()}`;
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: sessionId,
    workspaceId,
    channel: 'client',
    title: 'Summary cadence test',
    messages: messages(messageCount),
    summary,
    createdAt: now,
    updatedAt: now,
  };
  saveSession(session);
  sessionsToClean.push({ workspaceId, sessionId });
  return session;
}

afterEach(() => {
  for (const session of sessionsToClean.splice(0)) {
    deleteSession(session.workspaceId, session.sessionId);
  }
  mocks.callAI.mockReset();
});

describe('conversation summary refresh cadence', () => {
  it('recognizes only the bounded 6, 20, and 40 message milestones', () => {
    expect(isSessionSummaryMilestone(5)).toBe(false);
    expect(isSessionSummaryMilestone(6)).toBe(true);
    expect(isSessionSummaryMilestone(19)).toBe(false);
    expect(isSessionSummaryMilestone(20)).toBe(true);
    expect(isSessionSummaryMilestone(39)).toBe(false);
    expect(isSessionSummaryMilestone(40)).toBe(true);
    expect(isSessionSummaryMilestone(41)).toBe(false);
    expect(shouldAttemptSessionSummary(5)).toBe(false);
    expect(shouldAttemptSessionSummary(6)).toBe(true);
    expect(shouldAttemptSessionSummary(7)).toBe(true);
  });

  it('recovers a crossed milestone after an odd-count or failed-turn gap', async () => {
    mocks.callAI
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({ text: 'Recovered after crossing six' });
    const session = createSession(6);

    expect(await generateSessionSummary(session.workspaceId, session.id)).toBeNull();
    addMessage(session.workspaceId, session.id, 'client', 'user', 'Message 7');
    expect(await generateSessionSummary(session.workspaceId, session.id)).toBe('Recovered after crossing six');
    expect(mocks.callAI).toHaveBeenCalledTimes(2);
    expect(getSession(session.workspaceId, session.id)?.summary).toBe('Recovered after crossing six');
  });

  it('summarizes at 6, 20, and 40 without refreshing between milestones', async () => {
    mocks.callAI.mockImplementation(async () => ({
      text: `Summary ${mocks.callAI.mock.calls.length}`,
    }));
    const session = createSession(0);

    for (let count = 0; count < 6; count += 1) {
      expect(await generateSessionSummary(session.workspaceId, session.id)).toBeNull();
      expect(mocks.callAI).not.toHaveBeenCalled();
      if (count < 5) addMessage(session.workspaceId, session.id, 'client', 'user', `Before ${count + 1}`);
    }

    addMessage(session.workspaceId, session.id, 'client', 'assistant', 'Message 6');
    expect(await generateSessionSummary(session.workspaceId, session.id)).toBe('Summary 1');
    expect(mocks.callAI).toHaveBeenCalledTimes(1);
    expect(getSession(session.workspaceId, session.id)?.summary).toBe('Summary 1');

    for (let count = 7; count < 20; count += 1) {
      addMessage(session.workspaceId, session.id, 'client', count % 2 === 0 ? 'assistant' : 'user', `Message ${count}`);
      expect(await generateSessionSummary(session.workspaceId, session.id)).toBe('Summary 1');
    }
    expect(mocks.callAI).toHaveBeenCalledTimes(1);

    addMessage(session.workspaceId, session.id, 'client', 'assistant', 'Message 20');
    expect(await generateSessionSummary(session.workspaceId, session.id)).toBe('Summary 2');
    expect(mocks.callAI).toHaveBeenCalledTimes(2);

    for (let count = 21; count < 40; count += 1) {
      addMessage(session.workspaceId, session.id, 'client', count % 2 === 0 ? 'assistant' : 'user', `Message ${count}`);
      expect(await generateSessionSummary(session.workspaceId, session.id)).toBe('Summary 2');
    }
    expect(mocks.callAI).toHaveBeenCalledTimes(2);

    addMessage(session.workspaceId, session.id, 'client', 'assistant', 'Message 40');
    expect(await generateSessionSummary(session.workspaceId, session.id)).toBe('Summary 3');
    expect(await generateSessionSummary(session.workspaceId, session.id)).toBe('Summary 3');
    expect(mocks.callAI).toHaveBeenCalledTimes(3);

    addMessage(session.workspaceId, session.id, 'client', 'user', 'Message 41');
    expect(await generateSessionSummary(session.workspaceId, session.id)).toBe('Summary 3');
    expect(mocks.callAI).toHaveBeenCalledTimes(3);

    expect(getSession(session.workspaceId, session.id)?.summary).toBe('Summary 3');
    expect(listSessions(session.workspaceId)[0]?.summary).toBe('Summary 3');
  });

  it('deduplicates concurrent requests for the same summary milestone', async () => {
    let releaseSummary: ((value: { text: string }) => void) | undefined;
    mocks.callAI.mockImplementation(() => new Promise<{ text: string }>(resolve => {
      releaseSummary = resolve;
    }));
    const session = createSession(6);

    const first = generateSessionSummary(session.workspaceId, session.id);
    const second = generateSessionSummary(session.workspaceId, session.id);

    expect(mocks.callAI).toHaveBeenCalledTimes(1);
    releaseSummary?.({ text: 'Concurrent summary' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      'Concurrent summary',
      'Concurrent summary',
    ]);
    expect(mocks.callAI).toHaveBeenCalledTimes(1);

    expect(await generateSessionSummary(session.workspaceId, session.id)).toBe('Concurrent summary');
    expect(mocks.callAI).toHaveBeenCalledTimes(1);
  });

  it('does not let an older in-flight milestone overwrite a newer summary', async () => {
    const releases: Array<(value: { text: string }) => void> = [];
    mocks.callAI.mockImplementation(() => new Promise<{ text: string }>(resolve => {
      releases.push(resolve);
    }));
    const session = createSession(6);

    const sixMessageRefresh = generateSessionSummary(session.workspaceId, session.id);
    for (let count = 7; count <= 20; count += 1) {
      addMessage(session.workspaceId, session.id, 'client', count % 2 === 0 ? 'assistant' : 'user', `Message ${count}`);
    }
    const twentyMessageRefresh = generateSessionSummary(session.workspaceId, session.id);
    expect(mocks.callAI).toHaveBeenCalledTimes(2);

    releases[1]?.({ text: 'Newer 20-message summary' });
    await expect(twentyMessageRefresh).resolves.toBe('Newer 20-message summary');
    releases[0]?.({ text: 'Stale six-message summary' });
    await expect(sixMessageRefresh).resolves.toBe('Newer 20-message summary');

    expect(getSession(session.workspaceId, session.id)?.summary).toBe('Newer 20-message summary');
  });

  it('isolates an in-flight refresh from a deleted and recreated session id', async () => {
    const releases: Array<(value: { text: string }) => void> = [];
    mocks.callAI.mockImplementation(() => new Promise<{ text: string }>(resolve => {
      releases.push(resolve);
    }));
    const original = createSession(6);
    const staleRefresh = generateSessionSummary(original.workspaceId, original.id);

    deleteSession(original.workspaceId, original.id);
    const replacementCreatedAt = new Date(Date.parse(original.createdAt) + 1_000).toISOString();
    saveSession({
      ...original,
      messages: messages(6),
      summary: undefined,
      createdAt: replacementCreatedAt,
      updatedAt: replacementCreatedAt,
    });
    const replacementRefresh = generateSessionSummary(original.workspaceId, original.id);

    expect(mocks.callAI).toHaveBeenCalledTimes(2);
    releases[1]?.({ text: 'Replacement session summary' });
    await expect(replacementRefresh).resolves.toBe('Replacement session summary');
    releases[0]?.({ text: 'Deleted session summary' });
    await expect(staleRefresh).resolves.toBe('Replacement session summary');
    expect(getSession(original.workspaceId, original.id)?.summary).toBe('Replacement session summary');
  });

  it('upgrades a legacy summary at the next milestone without exposing storage metadata', async () => {
    mocks.callAI.mockResolvedValue({ text: 'Refreshed legacy summary' });
    const session = createSession(20, 'Legacy six-message summary');

    expect(await generateSessionSummary(session.workspaceId, session.id)).toBe('Refreshed legacy summary');
    expect(mocks.callAI).toHaveBeenCalledTimes(1);
    expect(getSession(session.workspaceId, session.id)?.summary).toBe('Refreshed legacy summary');
    expect(listSessions(session.workspaceId)[0]?.summary).toBe('Refreshed legacy summary');
  });

  it('keeps the last good summary when a scheduled refresh fails', async () => {
    mocks.callAI.mockRejectedValue(new Error('provider unavailable'));
    const session = createSession(20, 'Last good summary');

    expect(await generateSessionSummary(session.workspaceId, session.id)).toBe('Last good summary');
    expect(getSession(session.workspaceId, session.id)?.summary).toBe('Last good summary');
  });

  it('keeps the last good summary when the provider returns blank text', async () => {
    mocks.callAI.mockResolvedValue({ text: '   \n  ' });
    const session = createSession(20, 'Last good non-empty summary');

    expect(await generateSessionSummary(session.workspaceId, session.id)).toBe('Last good non-empty summary');
    expect(getSession(session.workspaceId, session.id)?.summary).toBe('Last good non-empty summary');
  });

  it('preserves explicit summarization at arbitrary counts without duplicate AI work', async () => {
    mocks.callAI
      .mockResolvedValueOnce({ text: 'Manual four-message summary' })
      .mockResolvedValueOnce({ text: 'Manual five-message summary' });
    const session = createSession(4);

    expect(await generateSessionSummary(session.workspaceId, session.id)).toBeNull();
    expect(mocks.callAI).not.toHaveBeenCalled();

    expect(await generateSessionSummary(
      session.workspaceId,
      session.id,
      { trigger: 'manual' },
    )).toBe('Manual four-message summary');
    expect(mocks.callAI).toHaveBeenCalledTimes(1);

    expect(await generateSessionSummary(
      session.workspaceId,
      session.id,
      { trigger: 'manual' },
    )).toBe('Manual four-message summary');
    expect(mocks.callAI).toHaveBeenCalledTimes(1);

    addMessage(session.workspaceId, session.id, 'client', 'user', 'Message 5');
    expect(await generateSessionSummary(
      session.workspaceId,
      session.id,
      { trigger: 'manual' },
    )).toBe('Manual five-message summary');
    expect(mocks.callAI).toHaveBeenCalledTimes(2);
  });

  it('upgrades an unversioned legacy summary once when explicitly requested', async () => {
    mocks.callAI.mockResolvedValue({ text: 'Versioned manual summary' });
    const session = createSession(10, 'Legacy unversioned summary');

    expect(await generateSessionSummary(
      session.workspaceId,
      session.id,
      { trigger: 'manual' },
    )).toBe('Versioned manual summary');
    expect(await generateSessionSummary(
      session.workspaceId,
      session.id,
      { trigger: 'manual' },
    )).toBe('Versioned manual summary');
    expect(mocks.callAI).toHaveBeenCalledTimes(1);
  });

  it('never exposes malformed internal storage prefixes through public session models', () => {
    const session = createSession(10, 'hmpsn:chat-summary:v1:not-a-count:Readable fallback summary');

    expect(getSession(session.workspaceId, session.id)?.summary).toBe('Readable fallback summary');
    expect(listSessions(session.workspaceId)[0]?.summary).toBe('Readable fallback summary');
  });
});
