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
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'health-routes-test-'));
process.env.DATA_DIR = TEST_DATA_DIR;

const ctx = createTestContext(13217);
const { api, postJson, setAuthToken, authApi, authPostJson, authDel, clearCookies } = ctx;

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  setAuthToken('');
  await ctx.stopServer();
  // Clean up isolated temp data dir
  try { fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  // Restore DATA_DIR so other tests sharing this process (if any) see the original value.
  if (ORIGINAL_DATA_DIR === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = ORIGINAL_DATA_DIR;
  }
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

describe('Integration health center endpoint', () => {
  let workspaceId = '';
  let restrictedWorkspaceId = '';
  let forbiddenWorkspaceId = '';
  let ownerToken = '';
  let memberToken = '';
  let memberUserId = '';

  it('creates a workspace for integration health checks', async () => {
    const res = await postJson('/api/workspaces', { name: 'Integration Health Test Workspace' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    workspaceId = body.id;
  });

  it('creates two workspaces for access-boundary checks', async () => {
    const [allowedRes, forbiddenRes] = await Promise.all([
      postJson('/api/workspaces', { name: 'Integration Health Allowed Workspace' }),
      postJson('/api/workspaces', { name: 'Integration Health Forbidden Workspace' }),
    ]);
    expect(allowedRes.status).toBe(200);
    expect(forbiddenRes.status).toBe(200);
    const allowedBody = await allowedRes.json();
    const forbiddenBody = await forbiddenRes.json();
    restrictedWorkspaceId = allowedBody.id;
    forbiddenWorkspaceId = forbiddenBody.id;
  });

  it('returns 403 when JWT user lacks access to requested workspace', async () => {
    const ownerEmail = `integration_health_owner_${Date.now()}@test.local`;
    const memberEmail = `integration_health_member_${Date.now()}@test.local`;
    const memberPassword = 'testpassword123';

    const setupRes = await postJson('/api/auth/setup', {
      email: ownerEmail,
      password: 'ownerpassword123',
      name: 'Integration Health Owner',
    });
    expect(setupRes.status).toBe(200);
    const setupBody = await setupRes.json();
    ownerToken = setupBody.token;
    setAuthToken(ownerToken);

    const createMemberRes = await authPostJson('/api/users', {
      email: memberEmail,
      password: memberPassword,
      name: 'Integration Health Member',
      role: 'member',
      workspaceIds: [restrictedWorkspaceId],
    });
    expect(createMemberRes.status).toBe(200);
    const createMemberBody = await createMemberRes.json();
    memberUserId = createMemberBody.id;

    setAuthToken('');
    const loginRes = await postJson('/api/auth/user-login', {
      email: memberEmail,
      password: memberPassword,
    });
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    memberToken = loginBody.token;
    setAuthToken(memberToken);

    const res = await authApi(`/api/integrations/health/${forbiddenWorkspaceId}`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('You do not have access to this workspace');

    setAuthToken('');
    clearCookies();
  });

  it('GET /api/observability/:workspaceId returns 403 when JWT user lacks access to workspace', async () => {
    expect(memberToken).toBeTruthy();
    setAuthToken(memberToken);

    const res = await authApi(`/api/observability/${forbiddenWorkspaceId}`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('You do not have access to this workspace');

    setAuthToken('');
    clearCookies();
  });

  it('GET /api/integrations/health/:workspaceId returns integration summary and items', async () => {
    const res = await api(`/api/integrations/health/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(workspaceId);
    expect(body).toHaveProperty('generatedAt');
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('integrations');
    expect(Array.isArray(body.integrations)).toBe(true);
    expect(body.integrations.length).toBeGreaterThan(0);

    const keys = new Set((body.integrations as Array<{ key: string }>).map(item => item.key));
    expect(keys.has('webflow')).toBe(true);
    expect(keys.has('google')).toBe(true);
    expect(keys.has('openai')).toBe(true);
    expect(keys.has('email')).toBe(true);
  });

  it('GET /api/integrations/health/:workspaceId with unknown workspace returns 404', async () => {
    const res = await api('/api/integrations/health/ws_missing_health_test');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });

  it('GET /api/observability/:workspaceId returns workspace observability report shape', async () => {
    const res = await api(`/api/observability/${workspaceId}?days=7`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(workspaceId);
    expect(body).toHaveProperty('generatedAt');
    expect(body).toHaveProperty('window');
    expect(body).toHaveProperty('failedJobs');
    expect(body).toHaveProperty('operationTraces');
    expect(body).toHaveProperty('externalApiFailureRates');
    expect(body).toHaveProperty('aiByFeature');
    expect(body).toHaveProperty('slowRoutes');
    expect(body).toHaveProperty('criticalSyncs');
    expect(Array.isArray(body.failedJobs)).toBe(true);
    expect(Array.isArray(body.operationTraces)).toBe(true);
    expect(Array.isArray(body.externalApiFailureRates)).toBe(true);
  });

  it('GET /api/observability/:workspaceId with unknown workspace returns 404', async () => {
    const res = await api('/api/observability/ws_missing_observability_test');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });

  it('GET /api/observability/:workspaceId with out-of-range days returns 400', async () => {
    const res = await api(`/api/observability/${workspaceId}?days=9999`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('days must be between');
  });

  it('GET /api/observability/:workspaceId with non-positive days returns 400', async () => {
    const res = await api(`/api/observability/${workspaceId}?days=0`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'days must be a positive integer' });
  });

  it('GET /api/observability/:workspaceId with non-integer days returns 400', async () => {
    const res = await api(`/api/observability/${workspaceId}?days=7.5`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'days must be a positive integer' });
  });

  afterAll(async () => {
    if (memberUserId && ownerToken) {
      setAuthToken(ownerToken);
      await authDel(`/api/users/${memberUserId}`);
    }
    setAuthToken('');
    clearCookies();
  });
});

describe('Admin storage stats', () => {
  it('GET /api/admin/storage-stats returns report', async () => {
    const res = await api('/api/admin/storage-stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('totalBytes');
    expect(body).toHaveProperty('breakdown');
    expect(body).toHaveProperty('timestamp');
  }, 30_000);
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

  it('POST /api/admin/storage/prune-chat rejects non-positive maxAgeDays', async () => {
    const res = await postJson('/api/admin/storage/prune-chat', { maxAgeDays: 0 });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'maxAgeDays must be a positive integer' });
  }, 15_000);

  it('POST /api/admin/storage/prune-chat rejects non-integer maxAgeDays', async () => {
    const res = await postJson('/api/admin/storage/prune-chat', { maxAgeDays: 30.5 });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'maxAgeDays must be a positive integer' });
  }, 15_000);

  it('POST /api/admin/storage/prune-backups with default params', async () => {
    const res = await postJson('/api/admin/storage/prune-backups', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('retainDays');
  }, 15_000);

  it('POST /api/admin/storage/prune-backups rejects non-positive retainDays', async () => {
    const res = await postJson('/api/admin/storage/prune-backups', { retainDays: 0 });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'retainDays must be a positive integer' });
  }, 15_000);

  it('POST /api/admin/storage/prune-backups rejects non-integer retainDays', async () => {
    const res = await postJson('/api/admin/storage/prune-backups', { retainDays: 1.1 });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'retainDays must be a positive integer' });
  }, 15_000);

  it('POST /api/admin/storage/prune-reports with default params', async () => {
    const res = await postJson('/api/admin/storage/prune-reports', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('keepPerSite');
  }, 15_000);

  it('POST /api/admin/storage/prune-reports rejects non-positive keepPerSite', async () => {
    const res = await postJson('/api/admin/storage/prune-reports', { keepPerSite: 0 });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'keepPerSite must be a positive integer' });
  }, 15_000);

  it('POST /api/admin/storage/prune-reports rejects non-integer keepPerSite', async () => {
    const res = await postJson('/api/admin/storage/prune-reports', { keepPerSite: 2.2 });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'keepPerSite must be a positive integer' });
  }, 15_000);

  it('POST /api/admin/storage/prune-activity with default params', async () => {
    const res = await postJson('/api/admin/storage/prune-activity', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('maxAgeDays');
  }, 15_000);

  it('POST /api/admin/storage/prune-activity rejects non-positive maxAgeDays', async () => {
    const res = await postJson('/api/admin/storage/prune-activity', { maxAgeDays: 0 });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'maxAgeDays must be a positive integer' });
  }, 15_000);

  it('POST /api/admin/storage/prune-activity rejects non-integer maxAgeDays', async () => {
    const res = await postJson('/api/admin/storage/prune-activity', { maxAgeDays: 7.7 });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'maxAgeDays must be a positive integer' });
  }, 15_000);
});
