import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import db from '../../server/db/index.js';
import { addMessage, getSession } from '../../server/chat-memory.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13350); // port-ok: 13201-13349 already allocated in integration suite
const { api, postJson, del, clearCookies } = ctx;

let workspaceId = '';
let otherWorkspaceId = '';
let protectedWorkspaceId = '';

function clearChatSessions(): void {
  db.prepare('DELETE FROM chat_sessions WHERE workspace_id IN (?, ?, ?)').run(workspaceId, otherWorkspaceId, protectedWorkspaceId);
}

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Public Chat Route Coverage Workspace').id;
  otherWorkspaceId = createWorkspace('Public Chat Route Coverage Other Workspace').id;
  protectedWorkspaceId = createWorkspace('Public Chat Route Coverage Protected Workspace').id;
  updateWorkspace(protectedWorkspaceId, { clientPassword: 'chat-session-secret' });
}, 25_000);

beforeEach(() => {
  clearCookies();
  clearChatSessions();
});

afterAll(async () => {
  clearChatSessions();
  deleteWorkspace(workspaceId);
  deleteWorkspace(otherWorkspaceId);
  deleteWorkspace(protectedWorkspaceId);
  await ctx.stopServer();
});

describe('public chat session routes', () => {
  it('requires client auth before reading or mutating protected workspace chat sessions', async () => {
    addMessage(protectedWorkspaceId, 'protected-chat-session', 'client', 'user', 'Protected question');

    const listRes = await api(`/api/public/chat-sessions/${protectedWorkspaceId}`);
    expect(listRes.status).toBe(401);

    const getRes = await api(`/api/public/chat-sessions/${protectedWorkspaceId}/protected-chat-session`);
    expect(getRes.status).toBe(401);

    const deleteRes = await del(`/api/public/chat-sessions/${protectedWorkspaceId}/protected-chat-session`);
    expect(deleteRes.status).toBe(401);

    const summarizeRes = await postJson(`/api/public/chat-sessions/${protectedWorkspaceId}/protected-chat-session/summarize`, {});
    expect(summarizeRes.status).toBe(401);
    expect(getSession(protectedWorkspaceId, 'protected-chat-session')).not.toBeNull();

    const loginRes = await postJson(`/api/public/auth/${protectedWorkspaceId}`, {
      password: 'chat-session-secret',
    });
    expect(loginRes.status).toBe(200);

    const authedListRes = await api(`/api/public/chat-sessions/${protectedWorkspaceId}`);
    expect(authedListRes.status).toBe(200);
    const sessions = await authedListRes.json();
    expect(sessions).toEqual([
      expect.objectContaining({
        id: 'protected-chat-session',
        channel: 'client',
        messageCount: 1,
      }),
    ]);
  });

  it('returns 404 for unknown public chat session workspaces', async () => {
    const listRes = await api('/api/public/chat-sessions/ws_missing_chat');
    expect(listRes.status).toBe(404);

    const getRes = await api('/api/public/chat-sessions/ws_missing_chat/session_missing');
    expect(getRes.status).toBe(404);

    const deleteRes = await del('/api/public/chat-sessions/ws_missing_chat/session_missing');
    expect(deleteRes.status).toBe(404);

    const summarizeRes = await postJson('/api/public/chat-sessions/ws_missing_chat/session_missing/summarize', {});
    expect(summarizeRes.status).toBe(404);
  });

  it('validates public chat session channel filters', async () => {
    addMessage(workspaceId, 'client-session', 'client', 'user', 'Client question');
    addMessage(workspaceId, 'search-session', 'search', 'user', 'Search question');

    const invalidRes = await api(`/api/public/chat-sessions/${workspaceId}?channel=not-a-channel`);
    expect(invalidRes.status).toBe(400);

    const clientRes = await api(`/api/public/chat-sessions/${workspaceId}?channel=client`);
    expect(clientRes.status).toBe(200);
    const sessions = await clientRes.json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: 'client-session', channel: 'client' });
  });

  it('does not read, summarize, or delete chat sessions through the wrong workspace', async () => {
    addMessage(otherWorkspaceId, 'other-chat-session', 'client', 'user', 'Other workspace question');

    const getRes = await api(`/api/public/chat-sessions/${workspaceId}/other-chat-session`);
    expect(getRes.status).toBe(404);

    const summarizeRes = await postJson(`/api/public/chat-sessions/${workspaceId}/other-chat-session/summarize`, {});
    expect(summarizeRes.status).toBe(404);

    const deleteRes = await del(`/api/public/chat-sessions/${workspaceId}/other-chat-session`);
    expect(deleteRes.status).toBe(404);
    expect(getSession(otherWorkspaceId, 'other-chat-session')).not.toBeNull();
  });

  it('deletes an owned public chat session and reports missing sessions as 404', async () => {
    addMessage(workspaceId, 'owned-chat-session', 'client', 'user', 'Owned workspace question');

    const deleteRes = await del(`/api/public/chat-sessions/${workspaceId}/owned-chat-session`);
    expect(deleteRes.status).toBe(200);
    expect(getSession(workspaceId, 'owned-chat-session')).toBeNull();

    const secondDeleteRes = await del(`/api/public/chat-sessions/${workspaceId}/owned-chat-session`);
    expect(secondDeleteRes.status).toBe(404);
  });
});
