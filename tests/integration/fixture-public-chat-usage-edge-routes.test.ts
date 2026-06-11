import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13752, { autoPublicAuth: true });
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Public Chat Usage Edge').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture public chat usage edge routes', () => {
  it('returns 404 for unknown usage workspace', async () => {
    const res = await api('/api/public/chat-usage/ws_fixture_chat_usage_missing');
    expect(res.status).toBe(404);
  });

  it('returns usage object for known workspace', async () => {
    const res = await api(`/api/public/usage/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.tier).toBe('string');
    expect(typeof body.usage).toBe('object');
  });

  it('validates chat session channel', async () => {
    const bad = await api(`/api/public/chat-sessions/${wsId}?channel=invalid`);
    expect(bad.status).toBe(400);
  });
});
