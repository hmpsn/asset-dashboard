// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { saveStrategyPov as realSave } from '../../server/strategy-pov-store.js';
import { saveRecommendations, computeRecommendationSummary } from '../../server/recommendations.js';
import type { StrategyPov } from '../../shared/types/strategy-pov.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

// Mock the generator so the route's generate/regenerate paths are deterministic and never call AI.
// The store is REAL — GET/PATCH exercise the override∪draft resolution + version bump against SQLite.
const generatedPov: StrategyPov = {
  situation: 'A drafted situation.',
  leadMoveRecId: 'rec-a',
  leadSentence: 'Bring the authority bet on pricing pages.',
  wins: ['Win one'],
  flags: ['Flag one'],
  version: 0,
  generatedAt: '2026-06-19T00:00:00.000Z',
  editedAt: null,
};

vi.mock('../../server/strategy-pov-generator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/strategy-pov-generator.js')>();
  return {
    ...actual,
    POV_UNCHANGED: actual.POV_UNCHANGED,
    generateStrategyPov: vi.fn(),
  };
});

import { generateStrategyPov as mockGenerate, POV_UNCHANGED, loadPovRecs } from '../../server/strategy-pov-generator.js';

const REQUEST_TIMEOUT_MS = 20_000;

async function startTestServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js'); // dynamic-import-ok
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('integration: strategy POV routes', () => {
  let seeded: SeededFullWorkspace;
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    const server = await startTestServer();
    baseUrl = server.baseUrl;
    closeServer = server.close;
  }, REQUEST_TIMEOUT_MS);

  afterAll(async () => {
    await closeServer?.();
  }, REQUEST_TIMEOUT_MS);

  beforeEach(() => {
    seeded = seedWorkspace();
    vi.clearAllMocks();
    // The generator mock persists via the real store + returns the saved POV (mirrors real behavior).
    vi.mocked(mockGenerate).mockImplementation(async (workspaceId: string) => {
      const pov = { ...generatedPov };
      realSave(workspaceId, pov, 'hash-v1');
      return pov;
    });
  });

  afterEach(() => {
    db.prepare('DELETE FROM strategy_pov WHERE workspace_id = ?').run(seeded.workspaceId);
    seeded.cleanup();
  });

  it('GET returns null before any POV exists', async () => {
    const res = await fetch(`${baseUrl}/api/workspaces/${seeded.workspaceId}/strategy-pov`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.pov).toBeNull();
  });

  it('generate persists the POV; GET returns it', async () => {
    const gen = await fetch(`${baseUrl}/api/workspaces/${seeded.workspaceId}/strategy-pov/generate`, { method: 'POST' });
    expect(gen.status).toBe(200);

    const res = await fetch(`${baseUrl}/api/workspaces/${seeded.workspaceId}/strategy-pov`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.pov).toMatchObject({
      situation: 'A drafted situation.',
      leadSentence: 'Bring the authority bet on pricing pages.',
      leadMoveRecId: 'rec-a',
      version: 0,
    });
  });

  it('PATCH a field returns the edited override + bumped version; GET reflects it (override beats draft)', async () => {
    await fetch(`${baseUrl}/api/workspaces/${seeded.workspaceId}/strategy-pov/generate`, { method: 'POST' });

    const patch = await fetch(`${baseUrl}/api/workspaces/${seeded.workspaceId}/strategy-pov`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leadSentence: 'OPERATOR EDIT: ship the cluster.' }),
    });
    const patchBody = await patch.json();
    expect(patch.status).toBe(200);
    expect(patchBody.pov.leadSentence).toBe('OPERATOR EDIT: ship the cluster.');
    expect(patchBody.pov.version).toBe(1);
    expect(patchBody.pov.editedAt).not.toBeNull();
    // Untouched field survives.
    expect(patchBody.pov.situation).toBe('A drafted situation.');

    const res = await fetch(`${baseUrl}/api/workspaces/${seeded.workspaceId}/strategy-pov`);
    const body = await res.json();
    expect(body.pov.leadSentence).toBe('OPERATOR EDIT: ship the cluster.');
    expect(body.pov.version).toBe(1);
  });

  it('PATCH with no existing POV returns 404', async () => {
    const patch = await fetch(`${baseUrl}/api/workspaces/${seeded.workspaceId}/strategy-pov`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ situation: 'nope' }),
    });
    expect(patch.status).toBe(404);
  });

  it('second generate with no change returns the cached POV (unchanged=true, 200)', async () => {
    // First generate persists hash-v1.
    await fetch(`${baseUrl}/api/workspaces/${seeded.workspaceId}/strategy-pov/generate`, { method: 'POST' });
    // Second generate: the generator reports POV_UNCHANGED — the route must return the cached POV.
    vi.mocked(mockGenerate).mockRejectedValueOnce(new Error(POV_UNCHANGED));

    const res = await fetch(`${baseUrl}/api/workspaces/${seeded.workspaceId}/strategy-pov/generate`, { method: 'POST' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.unchanged).toBe(true);
    expect(body.pov).toMatchObject({ situation: 'A drafted situation.' });
  });

  it('generate returns 500 when POV_UNCHANGED is reported but no cached POV exists', async () => {
    vi.mocked(mockGenerate).mockRejectedValueOnce(new Error(POV_UNCHANGED));
    const res = await fetch(`${baseUrl}/api/workspaces/${seeded.workspaceId}/strategy-pov/generate`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to generate strategy POV' });
  });
});

// ── Variant-aware POV rec-set selection (scaled-review fix #1) ────────────────
// loadPovRecs is the REAL implementation here (the module mock spreads ...actual and only replaces
// generateStrategyPov), so this exercises the genuine isActiveRec / isCuratedForClient split.
describe('loadPovRecs — variant-aware rec set', () => {
  let seeded: SeededFullWorkspace;

  function recOf(over: Partial<Recommendation>): Recommendation {
    const ts = '2026-06-19T00:00:00.000Z';
    return {
      id: 'r',
      workspaceId: seeded.workspaceId,
      priority: 'fix_now',
      type: 'content',
      title: 't',
      description: 'd',
      insight: 'i',
      impact: 'high',
      effort: 'low',
      impactScore: 50,
      source: 's',
      affectedPages: [],
      trafficAtRisk: 0,
      impressionsAtRisk: 0,
      estimatedGain: 'g',
      actionType: 'manual',
      status: 'pending',
      clientStatus: 'system',
      lifecycle: 'active',
      createdAt: ts,
      updatedAt: ts,
      ...over,
    } as Recommendation;
  }

  beforeEach(() => {
    seeded = seedWorkspace();
    // active-for-admin: clientStatus not in {sent,approved,declined}, status not terminal, not struck.
    // curated-for-client: clientStatus in {sent,approved,discussing}, not struck.
    const recs = [
      recOf({ id: 'active-only', clientStatus: 'curated', lifecycle: 'active' }),   // admin-active, NOT curated
      recOf({ id: 'sent-only', clientStatus: 'sent', lifecycle: 'active' }),         // client-curated, NOT admin-active
      recOf({ id: 'discussing-both', clientStatus: 'discussing', lifecycle: 'active' }), // BOTH (deliberate overlap)
      recOf({ id: 'declined-neither', clientStatus: 'declined', lifecycle: 'active' }),  // neither
    ];
    const set: RecommendationSet = {
      workspaceId: seeded.workspaceId,
      generatedAt: '2026-06-19T00:00:00.000Z',
      recommendations: recs,
      summary: computeRecommendationSummary(recs),
    };
    saveRecommendations(set);
  });

  afterEach(() => {
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(seeded.workspaceId);
    seeded.cleanup();
  });

  it('admin variant draws from the ACTIVE (proposable) set, not the sent set', () => {
    const ids = loadPovRecs(seeded.workspaceId, 'admin').map(r => r.id).sort();
    // active-only + discussing-both are active; sent-only + declined-neither are excluded.
    expect(ids).toEqual(['active-only', 'discussing-both']);
  });

  it('client variant draws from the CURATED/sent set, not the active set', () => {
    const ids = loadPovRecs(seeded.workspaceId, 'client').map(r => r.id).sort();
    // sent-only + discussing-both are curated; active-only + declined-neither are excluded.
    expect(ids).toEqual(['discussing-both', 'sent-only']);
  });

  it('returns [] for both variants when no rec set is cached', () => {
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(seeded.workspaceId);
    expect(loadPovRecs(seeded.workspaceId, 'admin')).toEqual([]);
    expect(loadPovRecs(seeded.workspaceId, 'client')).toEqual([]);
  });
});
