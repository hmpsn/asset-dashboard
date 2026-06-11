import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13728, { autoPublicAuth: true });
const { api, postJson } = ctx;

let openWs = '';
let protectedWs = '';

beforeAll(async () => {
  await ctx.startServer();
  openWs = createWorkspace('Fixture Public Auth Open').id;
  protectedWs = createWorkspace('Fixture Public Auth Protected').id;
  updateWorkspace(protectedWs, { clientPassword: 'fixture-auth-password' });
});

afterAll(async () => {
  deleteWorkspace(openWs);
  deleteWorkspace(protectedWs);
  await ctx.stopServer();
});

describe('Fixture public auth routes', () => {
  it('returns 404 for unknown auth workspace', async () => {
    const res = await postJson('/api/public/auth/ws_fixture_auth_missing', { password: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns ok:true for passwordless workspace', async () => {
    const res = await postJson(`/api/public/auth/${openWs}`, {});
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ ok: true }));
  });

  it('rejects wrong password and accepts correct password for protected workspace', async () => {
    const wrong = await postJson(`/api/public/auth/${protectedWs}`, { password: 'wrong' });
    expect(wrong.status).toBe(401);

    const right = await postJson(`/api/public/auth/${protectedWs}`, { password: 'fixture-auth-password' });
    expect(right.status).toBe(200);
    await expect(right.json()).resolves.toEqual(expect.objectContaining({ ok: true }));
  });

  it('returns auth mode metadata', async () => {
    const res = await api(`/api/public/auth-mode/${protectedWs}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ hasSharedPassword: true }));
  });
});
