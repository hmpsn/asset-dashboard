import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { savePageSpeed } from '../../server/performance-store.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13354); // port-ok: 13201-13353 already allocated in integration suite
const { api } = ctx;

let workspaceId = '';
let siteId = '';
let cleanupWorkspace: (() => void) | undefined;

beforeAll(async () => {
  await ctx.startServer();
  const seeded = seedWorkspace({ clientPassword: '' });
  workspaceId = seeded.workspaceId;
  siteId = seeded.webflowSiteId;
  cleanupWorkspace = seeded.cleanup;
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
  db.prepare('DELETE FROM performance_snapshots WHERE site_id = ?').run(siteId);
  cleanupWorkspace?.();
});

describe('GET /api/webflow/pagespeed-snapshot/:siteId', () => {
  it('returns the requested strategy-specific PageSpeed snapshot', async () => {
    savePageSpeed(siteId, 'mobile', { strategy: 'mobile', averageScore: 72 });
    savePageSpeed(siteId, 'desktop', { strategy: 'desktop', averageScore: 96 });

    const res = await api(`/api/webflow/pagespeed-snapshot/${siteId}?workspaceId=${workspaceId}&strategy=desktop`);
    expect(res.status).toBe(200);
    const body = await res.json() as { result?: { strategy?: string; averageScore?: number } };

    expect(body.result?.strategy).toBe('desktop');
    expect(body.result?.averageScore).toBe(96);
  });

  it('rejects non-positive maxPages on live pagespeed runs', async () => {
    const res = await api(`/api/webflow/pagespeed/${siteId}?workspaceId=${workspaceId}&maxPages=0`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'maxPages must be a positive integer' });
  });

  it('rejects out-of-range maxPages on live pagespeed runs', async () => {
    const res = await api(`/api/webflow/pagespeed/${siteId}?workspaceId=${workspaceId}&maxPages=26`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'maxPages must be between 1 and 25' });
  });

  it('rejects non-integer maxPages on live pagespeed runs', async () => {
    const res = await api(`/api/webflow/pagespeed/${siteId}?workspaceId=${workspaceId}&maxPages=2.5`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'maxPages must be a positive integer' });
  });
});
