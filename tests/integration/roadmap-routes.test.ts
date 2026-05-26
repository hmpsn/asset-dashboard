/**
 * Integration tests for roadmap API routes.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET  /api/roadmap         — returns full roadmap (sprints + items)
 * - PUT  /api/roadmap         — replace entire roadmap structure
 * - PATCH /api/roadmap/item/:id?sprintId=X — update a single item's status/notes/shippedAt
 *
 * Uses an isolated DATA_DIR so mutations don't touch the real roadmap.json.
 * Each test group that mutates state PUTs a known fixture first so sprint/item
 * IDs are fully controlled.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

// ── Isolated data directory ───────────────────────────────────────────────────
// Ensures mutations in this test file don't touch the real data/roadmap.json
// and don't interfere with other concurrently-running test servers.
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-routes-test-'));
process.env.DATA_DIR = TEST_DATA_DIR;

const ctx = createTestContext(13563);
const { api, postJson, patchJson } = ctx;

// ── Fixture ───────────────────────────────────────────────────────────────────

/** A minimal but well-shaped roadmap we can PUT to control IDs deterministically. */
const FIXTURE_ROADMAP = {
  sprints: [
    {
      id: 'sprint-test-alpha',
      name: 'Alpha Sprint',
      status: 'active',
      items: [
        { id: 101, title: 'First item', status: 'pending' },
        { id: 102, title: 'Second item', status: 'in_progress' },
        { id: 103, title: 'Done item', status: 'done' },
      ],
    },
    {
      id: 'sprint-test-beta',
      name: 'Beta Sprint',
      status: 'upcoming',
      items: [
        { id: 201, title: 'Beta item one', status: 'pending' },
      ],
    },
  ],
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
  // Remove the isolated temp data dir.
  try { fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  // Restore DATA_DIR so other test processes sharing this environment are unaffected.
  if (ORIGINAL_DATA_DIR === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = ORIGINAL_DATA_DIR;
  }
});

// ── GET /api/roadmap ──────────────────────────────────────────────────────────

describe('GET /api/roadmap', () => {
  it('returns 200 with a sprints array (smoke test)', async () => {
    const res = await api('/api/roadmap');
    expect(res.status).toBe(200);
    const body = await res.json() as { sprints: unknown };
    expect(Array.isArray(body.sprints)).toBe(true);
  });

  it('each sprint in the response has id and items array', async () => {
    const res = await api('/api/roadmap');
    expect(res.status).toBe(200);
    const body = await res.json() as { sprints: Array<{ id: unknown; items: unknown }> };
    // The real roadmap.json may have zero sprints in a clean test environment,
    // but if sprints exist they must conform to the expected shape.
    for (const sprint of body.sprints) {
      expect(sprint).toHaveProperty('id');
      expect(typeof sprint.id).toBe('string');
      expect(Array.isArray(sprint.items)).toBe(true);
    }
  });
});

// ── PUT /api/roadmap ──────────────────────────────────────────────────────────

describe('PUT /api/roadmap', () => {
  it('stores a custom roadmap and GET returns the saved structure', async () => {
    const putRes = await api('/api/roadmap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FIXTURE_ROADMAP),
    });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json() as { ok: boolean };
    expect(putBody.ok).toBe(true);

    // Verify the GET returns the exact roadmap we PUT.
    const getRes = await api('/api/roadmap');
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json() as typeof FIXTURE_ROADMAP;

    expect(getBody.sprints).toHaveLength(FIXTURE_ROADMAP.sprints.length);
    expect(getBody.sprints[0].id).toBe('sprint-test-alpha');
    expect(getBody.sprints[0].items).toHaveLength(3);
    expect(getBody.sprints[1].id).toBe('sprint-test-beta');
    expect(getBody.sprints[1].items).toHaveLength(1);
  });
});

// ── PATCH /api/roadmap/item/:id ───────────────────────────────────────────────
//
// Each test group starts by PUTting the fixture so it controls sprint/item IDs.

describe('PATCH /api/roadmap/item/:id — error cases', () => {
  it('without ?sprintId= returns 400 with "sprintId query param is required"', async () => {
    const res = await patchJson('/api/roadmap/item/101', { status: 'done' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/sprintId query param is required/);
  });

  it('with ?sprintId=nonexistent returns 404 with "Sprint not found"', async () => {
    const res = await patchJson('/api/roadmap/item/101?sprintId=no-such-sprint', { status: 'done' });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Sprint not found/);
  });

  it('with real sprintId but nonexistent item id returns 404 with "Item not found"', async () => {
    // Ensure the fixture is present so sprint-test-alpha exists.
    await api('/api/roadmap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FIXTURE_ROADMAP),
    });

    const res = await patchJson('/api/roadmap/item/99999?sprintId=sprint-test-alpha', { status: 'done' });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Item not found/);
  });
});

describe('PATCH /api/roadmap/item/:id — Zod validation', () => {
  beforeAll(async () => {
    // Seed a known roadmap so sprint/item IDs are deterministic.
    await api('/api/roadmap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FIXTURE_ROADMAP),
    });
  });

  it('with invalid status value returns 400 (enum validation)', async () => {
    const res = await patchJson(
      '/api/roadmap/item/101?sprintId=sprint-test-alpha',
      { status: 'not-a-valid-status' },
    );
    expect(res.status).toBe(400);
  });

  it('with extra field (title) returns 400 (strict schema)', async () => {
    const res = await patchJson(
      '/api/roadmap/item/101?sprintId=sprint-test-alpha',
      { title: 'hacked title', status: 'done' },
    );
    expect(res.status).toBe(400);
  });

  it('with extra field (id) returns 400 (strict schema)', async () => {
    const res = await patchJson(
      '/api/roadmap/item/101?sprintId=sprint-test-alpha',
      { id: 999, status: 'done' },
    );
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/roadmap/item/:id — successful updates', () => {
  beforeAll(async () => {
    // Seed a known roadmap so sprint/item IDs are deterministic.
    await api('/api/roadmap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(FIXTURE_ROADMAP),
    });
  });

  it('updates item status and returns ok:true with updated item', async () => {
    const res = await patchJson(
      '/api/roadmap/item/101?sprintId=sprint-test-alpha',
      { status: 'done' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; item: { id: number | string; status: string } };
    expect(body.ok).toBe(true);
    expect(body.item.status).toBe('done');
  });

  it('status change persists — subsequent GET reflects the updated value', async () => {
    // Set item 102 to done
    await patchJson(
      '/api/roadmap/item/102?sprintId=sprint-test-alpha',
      { status: 'done' },
    );

    const getRes = await api('/api/roadmap');
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as typeof FIXTURE_ROADMAP;

    const alpha = body.sprints.find(s => s.id === 'sprint-test-alpha');
    expect(alpha).toBeDefined();
    const item102 = alpha!.items.find(i => String(i.id) === '102') as { status: string } | undefined;
    expect(item102).toBeDefined();
    expect(item102!.status).toBe('done');
  });

  it('updates notes field', async () => {
    const res = await patchJson(
      '/api/roadmap/item/103?sprintId=sprint-test-alpha',
      { notes: 'shipped in v2.1' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; item: { notes?: string } };
    expect(body.ok).toBe(true);
    expect(body.item.notes).toBe('shipped in v2.1');
  });

  it('updates shippedAt field', async () => {
    const shippedAt = '2026-05-26';
    const res = await patchJson(
      '/api/roadmap/item/201?sprintId=sprint-test-beta',
      { shippedAt },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; item: { shippedAt?: string } };
    expect(body.ok).toBe(true);
    expect(body.item.shippedAt).toBe(shippedAt);
  });

  it('PATCH accepts all three allowed fields simultaneously', async () => {
    const res = await patchJson(
      '/api/roadmap/item/101?sprintId=sprint-test-alpha',
      { status: 'in_progress', notes: 'WIP', shippedAt: '2026-06-01' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; item: { status: string; notes?: string; shippedAt?: string } };
    expect(body.ok).toBe(true);
    expect(body.item.status).toBe('in_progress');
    expect(body.item.notes).toBe('WIP');
    expect(body.item.shippedAt).toBe('2026-06-01');
  });
});
