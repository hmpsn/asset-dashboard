import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createClientSignal } from '../../server/client-signals-store.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, patchJson, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Client Signals').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture client signals routes', () => {
  it('lists signals and includes seeded entries', async () => {
    createClientSignal({
      workspaceId: wsId,
      workspaceName: 'Fixture Client Signals',
      type: 'service_interest',
      triggerMessage: 'Please contact me',
      chatContext: [{ role: 'user', content: 'Please contact me' }],
    });

    const res = await api(`/api/client-signals/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(typeof body[0].id).toBe('string');
  });

  it('rejects invalid status patch values', async () => {
    const signal = createClientSignal({
      workspaceId: wsId,
      workspaceName: 'Fixture Client Signals',
      type: 'service_interest',
      triggerMessage: 'bad patch',
      chatContext: [],
    });
    const res = await patchJson(`/api/client-signals/${signal.id}/status`, { status: 'not-valid' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown workspace public signal', async () => {
    const res = await postJson('/api/public/signal/ws_fixture_signal_missing', {
      type: 'service_interest',
      triggerMessage: 'test',
      chatContext: [],
    });
    expect(res.status).toBe(404);
  });
});
