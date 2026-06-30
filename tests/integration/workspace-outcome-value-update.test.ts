/**
 * Integration tests for the PATCH /api/workspaces/:id boundary validation of the
 * The Issue (Client) P0 fields `outcomeValue` and `segmentConfig`.
 *
 * Tests (exercise the admin PATCH + admin GET — these fields are admin-edited):
 * - valid outcomeValue round-trips on admin GET
 * - invalid `basis` → 400 (NOT a silent drop)
 * - outcomeValue: null clears it
 * - valid segmentConfig round-trips
 * - invalid `segment` → 400
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api, postJson, patchJson } = ctx;

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
});

let workspaceId = '';

async function getAdminWorkspace() {
  const res = await api(`/api/workspaces/${workspaceId}`);
  expect(res.status).toBe(200);
  return res.json();
}

beforeAll(async () => {
  const res = await postJson('/api/workspaces', { name: 'Outcome Value Patch Test' });
  const body = await res.json();
  workspaceId = body.id;
});

describe('PATCH /api/workspaces/:id — outcomeValue boundary validation', () => {
  it('round-trips a valid outcomeValue on the admin GET', async () => {
    const res = await patchJson(`/api/workspaces/${workspaceId}`, {
      outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'agency_estimate' },
    });
    expect(res.status).toBe(200);
    const ws = await getAdminWorkspace();
    expect(ws.outcomeValue.valuePerOutcome).toBe(800);
    expect(ws.outcomeValue.unitLabel).toBe('new patient');
    expect(ws.outcomeValue.basis).toBe('agency_estimate');
  });

  it('rejects an invalid basis with 400 (not a silent drop)', async () => {
    const before = await getAdminWorkspace();
    const res = await patchJson(`/api/workspaces/${workspaceId}`, {
      outcomeValue: { valuePerOutcome: 800, unitLabel: 'new patient', currency: 'USD', basis: 'guesswork' },
    });
    expect(res.status).toBe(400);
    // Stored value unchanged.
    const after = await getAdminWorkspace();
    expect(after.outcomeValue).toEqual(before.outcomeValue);
  });

  it('clears outcomeValue when set to null', async () => {
    const res = await patchJson(`/api/workspaces/${workspaceId}`, { outcomeValue: null });
    expect(res.status).toBe(200);
    const ws = await getAdminWorkspace();
    expect(ws.outcomeValue == null).toBe(true);
  });
});

describe('PATCH /api/workspaces/:id — segmentConfig boundary validation', () => {
  it('round-trips a valid segmentConfig on the admin GET', async () => {
    const res = await patchJson(`/api/workspaces/${workspaceId}`, {
      segmentConfig: { segment: 'b2b_saas', outcomeNounSingular: 'qualified lead' },
    });
    expect(res.status).toBe(200);
    const ws = await getAdminWorkspace();
    expect(ws.segmentConfig.segment).toBe('b2b_saas');
    expect(ws.segmentConfig.outcomeNounSingular).toBe('qualified lead');
  });

  it('rejects an invalid segment with 400 (not a silent drop)', async () => {
    const before = await getAdminWorkspace();
    const res = await patchJson(`/api/workspaces/${workspaceId}`, {
      segmentConfig: { segment: 'enterprise_whale' },
    });
    expect(res.status).toBe(400);
    const after = await getAdminWorkspace();
    expect(after.segmentConfig).toEqual(before.segmentConfig);
  });
});
