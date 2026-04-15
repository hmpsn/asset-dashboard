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
import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

// Use an isolated temp data dir so the synchronous storage-stats/pruning
// functions operate on an empty directory rather than ~/.asset-dashboard
// (which can contain tens-of-thousands of files on a dev machine and causes
// multi-minute timeouts). DATA_DIR is picked up by createTestContext via
// process.env spread into the spawned server process.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'health-routes-test-'));
process.env.DATA_DIR = TEST_DATA_DIR;

const ctx = createTestContext(13217);
const { api, postJson } = ctx;

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(() => {
  ctx.stopServer();
  // Clean up isolated temp data dir
  try { fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
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
  }, 120_000);
});

describe('Admin storage pruning', () => {
  it('POST /api/admin/storage/prune-chat with default params', async () => {
    const res = await postJson('/api/admin/storage/prune-chat', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('maxAgeDays');
  }, 15_000);

  it('POST /api/admin/storage/prune-chat with custom maxAgeDays', async () => {
    const res = await postJson('/api/admin/storage/prune-chat', { maxAgeDays: 30 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.maxAgeDays).toBe(30);
  }, 15_000);

  it('POST /api/admin/storage/prune-backups with default params', async () => {
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
