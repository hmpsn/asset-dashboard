import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedApprovalData, type SeededApprovals } from '../fixtures/approval-seed.js';

const ctx = createEphemeralTestContext(import.meta.url);

let seeded: SeededApprovals | null = null;

beforeAll(async () => {
  await ctx.startServer();
  seeded = seedApprovalData();
});

afterAll(async () => {
  seeded?.cleanup();
  await ctx.stopServer();
});

describe('Fixture approval routes', () => {
  it('GET /api/approvals/:workspaceId returns at least the seeded batch', async () => {
    const res = await ctx.api(`/api/approvals/${seeded!.workspaceId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: seeded!.batchId,
          workspaceId: seeded!.workspaceId,
          status: 'pending',
        }),
      ]),
    );
  });

  it('GET /api/approvals/:workspaceId/:batchId returns seeded batch with seeded items', async () => {
    const res = await ctx.api(`/api/approvals/${seeded!.workspaceId}/${seeded!.batchId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(seeded!.batchId);
    expect(body.workspaceId).toBe(seeded!.workspaceId);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(seeded!.itemIds.length);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(seeded!.itemIds);
  });

  it('DELETE /api/approvals/:workspaceId/:batchId returns ok and follow-up GET is 404', async () => {
    const delRes = await ctx.del(`/api/approvals/${seeded!.workspaceId}/${seeded!.batchId}`);
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ ok: true });

    const getRes = await ctx.api(`/api/approvals/${seeded!.workspaceId}/${seeded!.batchId}`);
    expect(getRes.status).toBe(404);
    expect(await getRes.json()).toEqual({ error: 'Batch not found' });
  });
});
