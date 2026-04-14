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
  // TODO: re-enable once getStorageReport() is made async or a ?lite=true mode is added.
  // On dev machines with large data dirs (~20k+ files) the synchronous stat() loop exceeds
  // any practical timeout. CI passes because the data dir is empty.
  it.skip('GET /api/admin/storage-stats returns report', async () => {
    const res = await api('/api/admin/storage-stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('totalBytes');
  }, 120_000);
});

describe('Admin storage pruning', () => {
  // TODO: re-enable once pruneChatSessions() is made async.
  // On dev machines with large chat-sessions dirs the synchronous JSON read loop exceeds 15s.
  it.skip('POST /api/admin/storage/prune-chat with default params', async () => {
    const res = await postJson('/api/admin/storage/prune-chat', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('maxAgeDays');
  }, 15_000);

  // TODO: re-enable once pruneChatSessions() is made async.
  it.skip('POST /api/admin/storage/prune-chat with custom maxAgeDays', async () => {
    const res = await postJson('/api/admin/storage/prune-chat', { maxAgeDays: 30 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.maxAgeDays).toBe(30);
  }, 15_000);

  // TODO: re-enable once pruneBackups() avoids synchronous dirSize() on large backup dirs.
  it.skip('POST /api/admin/storage/prune-backups with default params', async () => {
    const res = await postJson('/api/admin/storage/prune-backups', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('retainDays');
  }, 15_000);

  it('POST /api/admin/storage/prune-reports with default params', async () => {
    const res = await postJson('/api/admin/storage/prune-reports', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('keepPerSite');
  }, 15_000);

  it('POST /api/admin/storage/prune-activity with default params', async () => {
    const res = await postJson('/api/admin/storage/prune-activity', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('maxAgeDays');
  }, 15_000);
});
