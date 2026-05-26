import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { addMessage } from '../../server/chat-memory.js';

const ctx = createTestContext(13729);
const { api, postJson, del, clearCookies } = ctx;

let openWs = '';
let protectedWs = '';

beforeAll(async () => {
  await ctx.startServer();
  openWs = createWorkspace('Fixture Public Chat Open').id;
  protectedWs = createWorkspace('Fixture Public Chat Protected').id;
  updateWorkspace(protectedWs, { clientPassword: 'chat-protected' });
});

beforeEach(() => {
  clearCookies();
});

afterAll(async () => {
  deleteWorkspace(openWs);
  deleteWorkspace(protectedWs);
  await ctx.stopServer();
});

describe('Fixture public chat routes', () => {
  it('returns 401 for protected workspace without auth', async () => {
    addMessage(protectedWs, 'fixture-chat-session', 'client', 'user', 'Need help');
    const res = await api(`/api/public/chat-sessions/${protectedWs}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown workspace/session routes', async () => {
    const list = await api('/api/public/chat-sessions/ws_fixture_chat_missing');
    expect(list.status).toBe(404);
    const detail = await api('/api/public/chat-sessions/ws_fixture_chat_missing/s1');
    expect(detail.status).toBe(404);
    const remove = await del('/api/public/chat-sessions/ws_fixture_chat_missing/s1');
    expect(remove.status).toBe(404);
  });

  it('validates channel query and supports authorized protected reads', async () => {
    const badChannel = await api(`/api/public/chat-sessions/${openWs}?channel=bad-channel`);
    expect(badChannel.status).toBe(400);

    const login = await postJson(`/api/public/auth/${protectedWs}`, { password: 'chat-protected' });
    expect(login.status).toBe(200);

    const ok = await api(`/api/public/chat-sessions/${protectedWs}`);
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual(expect.any(Array));
  });
});
