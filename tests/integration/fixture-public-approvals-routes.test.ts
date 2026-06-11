import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedApprovalData, type SeededApprovals } from '../fixtures/approval-seed.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13719, { autoPublicAuth: true });
const { api } = ctx;

let seeded: SeededApprovals | null = null;

beforeAll(async () => {
  await ctx.startServer();
  seeded = seedApprovalData();
});

afterAll(async () => {
  seeded?.cleanup();
  await ctx.stopServer();
});

describe('Fixture public approvals routes', () => {
  it('GET /api/public/approvals/:workspaceId returns 200 and includes seeded batch', async () => {
    const res = await api(`/api/public/approvals/${seeded!.workspaceId}`);
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

  it('GET /api/public/approvals/:workspaceId/:batchId returns seeded batch with seeded item ids', async () => {
    const res = await api(`/api/public/approvals/${seeded!.workspaceId}/${seeded!.batchId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(seeded!.batchId);
    expect(body.workspaceId).toBe(seeded!.workspaceId);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(seeded!.itemIds.length);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(seeded!.itemIds);
  });

  it('GET /api/public/approvals/:workspaceId/:batchId returns 404 for unknown batch id', async () => {
    const res = await api(`/api/public/approvals/${seeded!.workspaceId}/batch_missing_fixture_public`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Batch not found' });
  });
});
