import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson, del } = ctx;

let wsId = '';
let bpId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Page Strategy Edge').id;
});

afterAll(async () => {
  if (bpId) await del(`/api/page-strategy/${wsId}/${bpId}`);
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture page strategy edge routes', () => {
  it('validates blueprint create payload', async () => {
    const missing = await postJson(`/api/page-strategy/${wsId}`, {});
    expect(missing.status).toBe(400);
  });

  it('creates blueprint and rejects unknown entry lookups', async () => {
    const create = await postJson(`/api/page-strategy/${wsId}`, { name: 'Edge Blueprint' });
    expect(create.status).toBe(200);
    const body = await create.json();
    bpId = body.id;

    const missingEntry = await api(`/api/page-strategy/${wsId}/${bpId}/entries/entry_missing`);
    expect(missingEntry.status).toBe(404);
  });

  it('defaults endpoint is resilient for unknown page type', async () => {
    const res = await api('/api/page-strategy/section-plan-defaults/not-real');
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });
});
