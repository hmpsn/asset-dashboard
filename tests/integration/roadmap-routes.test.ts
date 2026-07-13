/**
 * Integration tests for roadmap API routes.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/roadmap (list sprints + items)
 * - PUT /api/roadmap (replace full roadmap)
 * - PATCH /api/roadmap/item/:id (update single item status)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, patchJson } = ctx;

beforeAll(async () => {
  await ctx.startServer();
}, 30_000);

afterAll(async () => {
  await ctx.stopServer();
});

// ─── GET /api/roadmap ──────────────────────────────────────────────────────────

describe('GET /api/roadmap', () => {
  it('returns 200 with sprints array', async () => {
    const res = await api('/api/roadmap');
    expect(res.status).toBe(200);
    const body = await res.json() as { sprints: unknown[] };
    expect(body).toHaveProperty('sprints');
    expect(Array.isArray(body.sprints)).toBe(true);
  });

  it('sprints contain items arrays', async () => {
    const res = await api('/api/roadmap');
    expect(res.status).toBe(200);
    const body = await res.json() as { sprints: Array<{ id: string; items: unknown[] }> };
    if (body.sprints.length > 0) {
      const firstSprint = body.sprints[0];
      expect(firstSprint).toHaveProperty('id');
      expect(firstSprint).toHaveProperty('items');
      expect(Array.isArray(firstSprint.items)).toBe(true);
    }
  });

  it('items have expected shape — id and status are always present', async () => {
    const res = await api('/api/roadmap');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      sprints: Array<{ items: Array<Record<string, unknown>> }>;
    };
    for (const sprint of body.sprints) {
      for (const item of sprint.items) {
        // Every item must have an id
        expect(item).toHaveProperty('id');
        // Every item must have a status (string, length > 0)
        expect(item).toHaveProperty('status');
        expect(typeof item.status).toBe('string');
        expect((item.status as string).length).toBeGreaterThan(0);
        // Items use either "title" or "name" as a label field — at least one must be present
        const hasLabel = 'title' in item || 'name' in item;
        expect(hasLabel).toBe(true);
      }
    }
  });
});

// ─── PUT /api/roadmap ──────────────────────────────────────────────────────────

describe('PUT /api/roadmap', () => {
  it('replaces the roadmap and returns { ok: true }', async () => {
    // Snapshot current state to restore after test
    const getRes = await api('/api/roadmap');
    expect(getRes.status).toBe(200);
    const original = await getRes.json() as object;

    const newRoadmap = {
      sprints: [
        {
          id: 'sprint-test-put',
          name: 'Test Sprint',
          items: [
            { id: 9001, title: 'Test item A', status: 'pending' },
          ],
        },
      ],
    };

    const putRes = await ctx.api('/api/roadmap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newRoadmap),
    });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json() as { ok: boolean };
    expect(putBody.ok).toBe(true);

    // Verify data was persisted
    const verifyRes = await api('/api/roadmap');
    expect(verifyRes.status).toBe(200);
    const verified = await verifyRes.json() as typeof newRoadmap;
    expect(verified.sprints).toHaveLength(1);
    expect(verified.sprints[0].id).toBe('sprint-test-put');
    expect(verified.sprints[0].items[0].id).toBe(9001);

    // Restore original roadmap
    await ctx.api('/api/roadmap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(original),
    });
  });
});

// ─── PATCH /api/roadmap/item/:id ──────────────────────────────────────────────

describe('PATCH /api/roadmap/item/:id', () => {
  const SPRINT_ID = 'sprint-patch-test';
  const ITEM_ID = '9999';

  // Seed a known roadmap structure before patch tests
  beforeAll(async () => {
    const testRoadmap = {
      sprints: [
        {
          id: SPRINT_ID,
          name: 'Patch Test Sprint',
          items: [
            { id: 9999, title: 'Patch Test Item', status: 'pending' },
          ],
        },
      ],
    };
    await ctx.api('/api/roadmap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testRoadmap),
    });
  });

  it('returns 400 when sprintId query param is missing', async () => {
    const res = await patchJson('/api/roadmap/item/9999', { status: 'done' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('sprintId');
  });

  it('returns 404 for unknown sprintId', async () => {
    const res = await patchJson('/api/roadmap/item/9999?sprintId=nonexistent-sprint', { status: 'done' });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Sprint not found');
  });

  it('returns 404 for unknown itemId within a valid sprint', async () => {
    const res = await patchJson(`/api/roadmap/item/00000?sprintId=${SPRINT_ID}`, { status: 'done' });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Item not found');
  });

  it('returns 400 for invalid status value', async () => {
    const res = await patchJson(`/api/roadmap/item/${ITEM_ID}?sprintId=${SPRINT_ID}`, {
      status: 'bogus_status',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for extra fields not in schema (strict mode)', async () => {
    const res = await patchJson(`/api/roadmap/item/${ITEM_ID}?sprintId=${SPRINT_ID}`, {
      status: 'done',
      title: 'Trying to overwrite title — should be rejected',
    });
    expect(res.status).toBe(400);
  });

  it('updates status to "done" successfully and returns updated item', async () => {
    const res = await patchJson(`/api/roadmap/item/${ITEM_ID}?sprintId=${SPRINT_ID}`, {
      status: 'done',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; item: { status: string; id: number } };
    expect(body.ok).toBe(true);
    expect(body.item.status).toBe('done');
    expect(String(body.item.id)).toBe(ITEM_ID);
  });

  it('updates status to "in_progress" successfully', async () => {
    const res = await patchJson(`/api/roadmap/item/${ITEM_ID}?sprintId=${SPRINT_ID}`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; item: { status: string } };
    expect(body.ok).toBe(true);
    expect(body.item.status).toBe('in_progress');
  });

  it('updates status back to "pending" successfully', async () => {
    const res = await patchJson(`/api/roadmap/item/${ITEM_ID}?sprintId=${SPRINT_ID}`, {
      status: 'pending',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; item: { status: string } };
    expect(body.ok).toBe(true);
    expect(body.item.status).toBe('pending');
  });

  it('updates status to "deferred" successfully', async () => {
    const res = await patchJson(`/api/roadmap/item/${ITEM_ID}?sprintId=${SPRINT_ID}`, {
      status: 'deferred',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; item: { status: string } };
    expect(body.ok).toBe(true);
    expect(body.item.status).toBe('deferred');
  });

  it('updates notes field without touching status', async () => {
    const res = await patchJson(`/api/roadmap/item/${ITEM_ID}?sprintId=${SPRINT_ID}`, {
      notes: 'Integration test note',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; item: { notes: string } };
    expect(body.ok).toBe(true);
    expect(body.item.notes).toBe('Integration test note');
  });

  it('updates shippedAt field successfully', async () => {
    const res = await patchJson(`/api/roadmap/item/${ITEM_ID}?sprintId=${SPRINT_ID}`, {
      shippedAt: '2026-05-25',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; item: { shippedAt: string } };
    expect(body.ok).toBe(true);
    expect(body.item.shippedAt).toBe('2026-05-25');
  });

  it('persisted status is reflected in subsequent GET /api/roadmap', async () => {
    // Set a known status
    await patchJson(`/api/roadmap/item/${ITEM_ID}?sprintId=${SPRINT_ID}`, { status: 'done' });

    const res = await api('/api/roadmap');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      sprints: Array<{ id: string; items: Array<{ id: number; status: string }> }>;
    };
    const sprint = body.sprints.find(s => s.id === SPRINT_ID);
    expect(sprint).toBeDefined();
    const item = sprint!.items.find(i => String(i.id) === ITEM_ID);
    expect(item).toBeDefined();
    expect(item!.status).toBe('done');
  });
});
