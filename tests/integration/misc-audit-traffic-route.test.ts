import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const TEST_SESSION_SECRET = 'test-misc-audit-traffic-secret';
process.env.SESSION_SECRET = TEST_SESSION_SECRET;

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

const ADMIN_HMAC_TOKEN = crypto
  .createHmac('sha256', TEST_SESSION_SECRET)
  .update('admin')
  .digest('hex');

function adminHeaders(): Record<string, string> {
  return { 'x-auth-token': ADMIN_HMAC_TOKEN };
}

let ws: ReturnType<typeof seedWorkspace>;

beforeAll(async () => {
  await ctx.startServer();
  ws = seedWorkspace();
}, 30_000);

afterAll(async () => {
  ws.cleanup();
  await ctx.stopServer();
  delete process.env.SESSION_SECRET;
});

describe('GET /api/audit-traffic/:siteId', () => {
  it('returns a stable empty traffic map when integrations are not configured', async () => {
    const res = await api(`/api/audit-traffic/${ws.webflowSiteId}?workspaceId=${ws.workspaceId}`, {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({});
  });
});
