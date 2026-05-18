import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13357); // port-ok: 13201-13356 already allocated in integration suite
const { postJson } = ctx;

let workspaceId = '';

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Admin Chat Route Validation').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  await ctx.stopServer();
});

describe('POST /api/admin-chat validation', () => {
  it('rejects days outside the supported range before provider checks', async () => {
    const res = await postJson('/api/admin-chat', {
      workspaceId,
      question: 'What changed this week?',
      days: 0,
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'days must be between 1 and 365' });
  });
});
