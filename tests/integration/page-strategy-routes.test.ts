/**
 * Integration tests for the Page Strategy Engine API routes.
 *
 * Covers:
 *   - Blueprint CRUD (POST /api/page-strategy/:wsId, GET list/single, PUT, DELETE)
 *   - Workspace isolation (blueprints in wsA must not appear in wsB)
 *   - Entry CRUD (POST/PUT/DELETE entries, PUT reorder)
 *   - Section plan defaults (GET /api/page-strategy/section-plan-defaults/:pageType)
 *   - Versioning (POST/GET versions, GET single version)
 *   - Route registration smoke test (not 404)
 *   - Zod validation rejection (missing required fields → 400)
 *
 * NOTE: The POST /api/page-strategy/:wsId/generate endpoint calls Claude
 * (Anthropic) and OpenAI for brief creation. Because this test file uses a
 * spawned server process, module-level vi.mock() cannot intercept the server's
 * in-process calls. The generate route is therefore verified only for
 * registration (returns non-404) — full generate testing lives in the
 * unit-style content-brief-generation.test.ts pattern.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext, assertWorkspaceIsolation } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SiteBlueprint, BlueprintEntry, BlueprintVersion, SectionPlanItem } from '../../shared/types/page-strategy.js';

const ctx = createTestContext(13318);
const { api, postJson, del } = ctx;

let wsId = '';
let wsOtherId = '';
let cleanupA: () => void;
let cleanupB: () => void;

beforeAll(async () => {
  await ctx.startServer();

  const wsA = seedWorkspace({ clientPassword: '' });
  const wsB = seedWorkspace({ clientPassword: '' });
  wsId = wsA.workspaceId;
  wsOtherId = wsB.workspaceId;
  cleanupA = wsA.cleanup;
  cleanupB = wsB.cleanup;
});

afterAll(() => {
  ctx.stopServer();
  cleanupA?.();
  cleanupB?.();
});

// ── Blueprint CRUD ────────────────────────────────────────────────────────────

describe('Blueprint CRUD', () => {
  let blueprintId = '';

  it('POST /api/page-strategy/:wsId — creates blueprint, returns 200 with id/name/status', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Test Blueprint',
      status: 'draft',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SiteBlueprint;
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Test Blueprint');
    expect(body.status).toBe('draft');
    expect(body.workspaceId).toBe(wsId);
    blueprintId = body.id;
  });

  it('GET /api/page-strategy/:wsId — returns array including created blueprint', async () => {
    const res = await api(`/api/page-strategy/${wsId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SiteBlueprint[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.find(b => b.id === blueprintId)).toBeDefined();
  });

  it('GET /api/page-strategy/:wsId/:blueprintId — returns correct blueprint by id', async () => {
    const res = await api(`/api/page-strategy/${wsId}/${blueprintId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SiteBlueprint;
    expect(body.id).toBe(blueprintId);
    expect(body.name).toBe('Test Blueprint');
  });

  it('PUT /api/page-strategy/:wsId/:blueprintId — updates name, returns 200', async () => {
    const res = await api(`/api/page-strategy/${wsId}/${blueprintId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Blueprint Name' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SiteBlueprint;
    expect(body.name).toBe('Updated Blueprint Name');
  });

  it('DELETE /api/page-strategy/:wsId/:blueprintId — returns 204, subsequent GET returns 404', async () => {
    const delRes = await del(`/api/page-strategy/${wsId}/${blueprintId}`);
    expect(delRes.status).toBe(204);

    const getRes = await api(`/api/page-strategy/${wsId}/${blueprintId}`);
    expect(getRes.status).toBe(404);
  });
});

// ── Workspace Isolation ───────────────────────────────────────────────────────

describe('Workspace isolation', () => {
  let blueprintA: SiteBlueprint;
  let blueprintB: SiteBlueprint;

  beforeAll(async () => {
    const resA = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Workspace A Blueprint',
    });
    blueprintA = (await resA.json()) as SiteBlueprint;

    const resB = await postJson(`/api/page-strategy/${wsOtherId}`, {
      name: 'Workspace B Blueprint',
    });
    blueprintB = (await resB.json()) as SiteBlueprint;
  });

  afterAll(async () => {
    // Cleanup — ignore 404 if already deleted
    await del(`/api/page-strategy/${wsId}/${blueprintA.id}`).catch(() => undefined);
    await del(`/api/page-strategy/${wsOtherId}/${blueprintB.id}`).catch(() => undefined);
  });

  it('GET list — each workspace only sees its own blueprints', async () => {
    await assertWorkspaceIsolation({
      ctx,
      wsA: wsId,
      wsB: wsOtherId,
      endpoint: (workspaceId) => `/api/page-strategy/${workspaceId}`,
      extractIds: (body) => (body as SiteBlueprint[]).map(b => b.id),
      seedAIds: [blueprintA.id],
      seedBIds: [blueprintB.id],
    });
  });

  it('GET by id — cross-workspace GET returns 404', async () => {
    // blueprintA accessed via wsOtherId must return 404
    const res = await api(`/api/page-strategy/${wsOtherId}/${blueprintA.id}`);
    expect(res.status).toBe(404);
  });
});

// ── Entry cross-workspace isolation ──────────────────────────────────────────

describe('Entry workspace isolation', () => {
  let bpA = '';
  let bpB = '';
  let entryA = '';

  beforeAll(async () => {
    // Blueprint in wsId
    const resA = await postJson(`/api/page-strategy/${wsId}`, { name: 'Entry Isolation Blueprint A' });
    bpA = ((await resA.json()) as SiteBlueprint).id;

    // Entry in wsId blueprint
    const resEntry = await postJson(`/api/page-strategy/${wsId}/${bpA}/entries`, {
      name: 'Isolation Page',
      pageType: 'service',
    });
    entryA = ((await resEntry.json()) as BlueprintEntry).id;

    // Blueprint in wsOtherId
    const resB = await postJson(`/api/page-strategy/${wsOtherId}`, { name: 'Entry Isolation Blueprint B' });
    bpB = ((await resB.json()) as SiteBlueprint).id;
  });

  afterAll(async () => {
    await del(`/api/page-strategy/${wsId}/${bpA}`).catch(() => undefined);
    await del(`/api/page-strategy/${wsOtherId}/${bpB}`).catch(() => undefined);
  });

  it('PUT entry via wrong workspace returns 404', async () => {
    // Attempt to update wsId entry via wsOtherId workspace param
    const res = await api(`/api/page-strategy/${wsOtherId}/${bpA}/entries/${entryA}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Should Not Update' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE entry via wrong workspace returns 404', async () => {
    // Attempt to delete wsId entry via wsOtherId workspace param
    const res = await del(`/api/page-strategy/${wsOtherId}/${bpA}/entries/${entryA}`);
    expect(res.status).toBe(404);
    // Confirm entry still exists in correct workspace
    const check = await api(`/api/page-strategy/${wsId}/${bpA}`);
    const bp = (await check.json()) as SiteBlueprint;
    expect(bp.entries?.find(e => e.id === entryA)).toBeDefined();
  });
});

// ── Entry CRUD ────────────────────────────────────────────────────────────────

describe('Entry CRUD', () => {
  let blueprintId = '';
  let entryId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Entry CRUD Blueprint',
    });
    const bp = (await res.json()) as SiteBlueprint;
    blueprintId = bp.id;
  });

  afterAll(async () => {
    await del(`/api/page-strategy/${wsId}/${blueprintId}`).catch(() => undefined);
  });

  it('POST .../entries — adds entry, returns 200 with pageType', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}/${blueprintId}/entries`, {
      name: 'Home',
      pageType: 'homepage',
      scope: 'included',
      isCollection: false,
      primaryKeyword: 'test keyword',
      secondaryKeywords: ['kw1', 'kw2'],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BlueprintEntry;
    expect(body.id).toBeDefined();
    expect(body.pageType).toBe('homepage');
    expect(body.name).toBe('Home');
    expect(body.blueprintId).toBe(blueprintId);
    entryId = body.id;
  });

  it('PUT .../entries/:entryId — updates entry', async () => {
    const res = await api(`/api/page-strategy/${wsId}/${blueprintId}/entries/${entryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Homepage Updated', primaryKeyword: 'updated keyword' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BlueprintEntry;
    expect(body.name).toBe('Homepage Updated');
    expect(body.primaryKeyword).toBe('updated keyword');
  });

  it('PUT .../entries/reorder — reorders entry list', async () => {
    // Add a second entry so we have 2 to reorder
    const res2 = await postJson(`/api/page-strategy/${wsId}/${blueprintId}/entries`, {
      name: 'Services',
      pageType: 'service',
    });
    const entry2 = (await res2.json()) as BlueprintEntry;

    const reorderRes = await api(`/api/page-strategy/${wsId}/${blueprintId}/entries/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: [entry2.id, entryId] }),
    });
    expect(reorderRes.status).toBe(200);
    const body = await reorderRes.json();
    expect(body.reordered).toBe(true);

    // Cleanup second entry
    await del(`/api/page-strategy/${wsId}/${blueprintId}/entries/${entry2.id}`);
  });

  it('DELETE .../entries/:entryId — removes entry', async () => {
    const delRes = await del(`/api/page-strategy/${wsId}/${blueprintId}/entries/${entryId}`);
    expect(delRes.status).toBe(204);

    // Adding a fresh entry then deleting it verifies the delete path works
    // (entryId was deleted above, subsequent reads would 404 — we just check status)
  });
});

// ── Section Plan Defaults ─────────────────────────────────────────────────────

describe('Section plan defaults', () => {
  it('GET /api/page-strategy/section-plan-defaults/service — returns non-empty SectionPlanItem array', async () => {
    const res = await api('/api/page-strategy/section-plan-defaults/service');
    expect(res.status).toBe(200);
    const body = (await res.json()) as SectionPlanItem[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty('sectionType');
    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('order');
  });

  it('GET /api/page-strategy/section-plan-defaults/location — returns non-empty array', async () => {
    const res = await api('/api/page-strategy/section-plan-defaults/location');
    expect(res.status).toBe(200);
    const body = (await res.json()) as SectionPlanItem[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('section-plan-defaults route is NOT shadowed by /:blueprintId param route', async () => {
    // If /section-plan-defaults were shadowed by /:blueprintId, it would return
    // 404 (no blueprint with id "section-plan-defaults") instead of the actual plan.
    const res = await api('/api/page-strategy/section-plan-defaults/homepage');
    // Must NOT be 404 — the literal prefix route must win over the param route
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SectionPlanItem[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});

// ── Versioning ────────────────────────────────────────────────────────────────

describe('Versioning', () => {
  let blueprintId = '';
  let versionId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Versioning Blueprint',
    });
    const bp = (await res.json()) as SiteBlueprint;
    blueprintId = bp.id;
  });

  afterAll(async () => {
    await del(`/api/page-strategy/${wsId}/${blueprintId}`).catch(() => undefined);
  });

  it('POST .../versions — creates version snapshot', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}/${blueprintId}/versions`, {
      changeNotes: 'Initial snapshot',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BlueprintVersion;
    expect(body.id).toBeDefined();
    expect(body.blueprintId).toBe(blueprintId);
    expect(body.changeNotes).toBe('Initial snapshot');
    expect(body.snapshot).toBeDefined();
    versionId = body.id;
  });

  it('GET .../versions — lists versions (includes created one)', async () => {
    const res = await api(`/api/page-strategy/${wsId}/${blueprintId}/versions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BlueprintVersion[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.find(v => v.id === versionId)).toBeDefined();
  });

  it('GET .../versions/:versionId — gets specific version', async () => {
    const res = await api(`/api/page-strategy/${wsId}/${blueprintId}/versions/${versionId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BlueprintVersion;
    expect(body.id).toBe(versionId);
    expect(body.blueprintId).toBe(blueprintId);
  });
});

// ── Route Registration Smoke Test ─────────────────────────────────────────────

describe('Route registration smoke test', () => {
  let tempBlueprintId = '';

  beforeAll(async () => {
    const res = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Smoke Test Blueprint',
    });
    const bp = (await res.json()) as SiteBlueprint;
    tempBlueprintId = bp.id;
  });

  afterAll(async () => {
    await del(`/api/page-strategy/${wsId}/${tempBlueprintId}`).catch(() => undefined);
  });

  it('routes are registered in app.ts — 404 means route was not registered', async () => {
    // A 404 on any of these means the route was NOT registered in app.ts
    const listRes = await api(`/api/page-strategy/${wsId}`);
    expect(listRes.status, 'GET list should not be 404').not.toBe(404);

    const getRes = await api(`/api/page-strategy/${wsId}/${tempBlueprintId}`);
    expect(getRes.status, 'GET by id should not be 404').not.toBe(404);

    const defaultsRes = await api('/api/page-strategy/section-plan-defaults/service');
    expect(defaultsRes.status, 'section-plan-defaults should not be 404').not.toBe(404);

    const versionsRes = await api(`/api/page-strategy/${wsId}/${tempBlueprintId}/versions`);
    expect(versionsRes.status, 'GET versions should not be 404').not.toBe(404);
  });

  it('POST /api/page-strategy/:wsId/generate — route is registered (returns non-404 even without API key)', async () => {
    // The generate endpoint requires ANTHROPIC_API_KEY, which is not set in CI.
    // We only assert the route exists (not 404); the actual AI output is tested
    // in the unit-style blueprint-generator tests.
    const res = await postJson(`/api/page-strategy/${wsId}/generate`, {
      industryType: 'healthcare',
    });
    // Any response except 404 confirms the route is registered
    expect(res.status, 'generate route must be registered — not 404').not.toBe(404);
  });
});

// ── Zod Validation ────────────────────────────────────────────────────────────

describe('Zod validation', () => {
  it('POST /api/page-strategy/:wsId with missing name — returns 400', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}`, {
      // name is required and missing
      status: 'draft',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/page-strategy/:wsId with empty name — returns 400', async () => {
    const res = await postJson(`/api/page-strategy/${wsId}`, {
      name: '',
    });
    expect(res.status).toBe(400);
  });

  it('POST entries with missing required name field — returns 400', async () => {
    // Create a blueprint first so we have a valid blueprintId
    const bpRes = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Validation Test Blueprint',
    });
    const bp = (await bpRes.json()) as SiteBlueprint;

    const res = await postJson(`/api/page-strategy/${wsId}/${bp.id}/entries`, {
      // name is required and missing
      pageType: 'homepage',
    });
    expect(res.status).toBe(400);

    // Cleanup
    await del(`/api/page-strategy/${wsId}/${bp.id}`);
  });

  it('POST entries with missing required pageType field — returns 400', async () => {
    const bpRes = await postJson(`/api/page-strategy/${wsId}`, {
      name: 'Validation Test Blueprint 2',
    });
    const bp = (await bpRes.json()) as SiteBlueprint;

    const res = await postJson(`/api/page-strategy/${wsId}/${bp.id}/entries`, {
      name: 'Valid Name',
      // pageType is required and missing
    });
    expect(res.status).toBe(400);

    // Cleanup
    await del(`/api/page-strategy/${wsId}/${bp.id}`);
  });
});
