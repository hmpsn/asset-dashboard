// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { saveStrategyPov as realSave } from '../../server/strategy-pov-store.js';
import type { StrategyPov } from '../../shared/types/strategy-pov.js';

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

import { generateStrategyPov as mockGenerate, POV_UNCHANGED } from '../../server/strategy-pov-generator.js';

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
