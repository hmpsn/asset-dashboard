import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedApprovalData, type SeededApprovals } from '../fixtures/approval-seed.js';

const ctx = createTestContext(13718); // port-ok: unique in integration suite

let seeded: SeededApprovals | null = null;

beforeAll(async () => {
  await ctx.startServer();
  seeded = seedApprovalData();
});

afterAll(async () => {
  seeded?.cleanup();
  await ctx.stopServer();
});

describe('Fixture approval remind route', () => {
  it('POST /api/approvals/:workspaceId/:batchId/remind returns 400 when no client email is configured', async () => {
    const res = await ctx.postJson(`/api/approvals/${seeded!.workspaceId}/${seeded!.batchId}/remind`, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No client email configured for this workspace' });
  });
});
