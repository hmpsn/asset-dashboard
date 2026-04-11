/**
 * Integration tests for health and admin storage endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/health (health check)
 * - GET /api/admin/storage-stats (storage report)
 * - POST /api/admin/storage/prune-chat (prune chat sessions)
 * - POST /api/admin/storage/prune-backups (prune backups)
 * - POST /api/admin/storage/prune-reports (prune report snapshots)
 * - POST /api/admin/storage/prune-activity (prune activity logs)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13217);
const { api, postJson } = ctx;

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(() => {
  ctx.stopServer();
});

describe('Health endpoint', () => {
  it('GET /api/health returns ok status', async () => {
    const res = await api('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('hasOpenAIKey');
    expect(body).toHaveProperty('hasWebflowToken');
    expect(body).toHaveProperty('hasGoogleAuth');
    expect(body).toHaveProperty('hasEmailConfig');
    expect(body).toHaveProperty('hasStripe');
    expect(body).toHaveProperty('emailQueue');
  });
});

describe('Admin storage stats', () => {
  it('GET /api/admin/storage-stats returns report', async () => {
    const res = await api('/api/admin/storage-stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('totalBytes');
    // 60s timeout: getStorageReport() does ~20k synchronous stat() syscalls on
    // a typical dev machine's ~/.asset-dashboard (1GB+ across 20k+ files). The
    // previous 15s bound passed in CI (empty data dir) but tripped on real dev
    // machines. The route itself is genuinely slow — the long-term fix is to
    // make `getStorageReport()` async or to expose a `?lite=true` summary mode
    // that skips the per-category breakdown. Until then, this generous bound
    // keeps the smoke test stable for any contributor running locally.
  }, 60_000);
});

describe('Admin storage pruning', () => {
  it('POST /api/admin/storage/prune-chat with default params', async () => {
    const res = await postJson('/api/admin/storage/prune-chat', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('maxAgeDays');
  });

  it('POST /api/admin/storage/prune-chat with custom maxAgeDays', async () => {
    const res = await postJson('/api/admin/storage/prune-chat', { maxAgeDays: 30 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.maxAgeDays).toBe(30);
  });

  it('POST /api/admin/storage/prune-backups with default params', async () => {
    const res = await postJson('/api/admin/storage/prune-backups', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('retainDays');
  });

  it('POST /api/admin/storage/prune-reports with default params', async () => {
    const res = await postJson('/api/admin/storage/prune-reports', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('keepPerSite');
  });

  it('POST /api/admin/storage/prune-activity with default params', async () => {
    const res = await postJson('/api/admin/storage/prune-activity', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('maxAgeDays');
  });
});
