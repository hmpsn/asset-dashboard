// tests/unit/outcomes-route-attribution-default.test.ts
// R8-PR2 (B14): the external HTTP write surface (POST /api/outcomes/:ws/actions) is
// TOLERATE-OLD. A request that OMITS attribution must NOT be rejected — it stores the HONEST
// `not_acted_on` default (never the old silent `platform_executed`) and logs a deprecation
// warn. A request that PASSES attribution stores exactly that value. This is a NON-breaking
// change for external callers (MCP holders of persistent API keys, programmatic recorders).
//
// In-process: mounts ONLY the outcomes router on a bare Express app with auth/broadcast/bridge
// mocked out, so the route logic (not the network/auth stack) is under test. recordAction
// writes to the real test SQLite DB, so the stored attribution is asserted by reading it back.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

// ── Mocks (must be declared before importing the router) ──────────────────────

// Auth: pass-through so the route body logic is exercised without an auth stack.
vi.mock('../../server/auth.js', () => ({
  requireWorkspaceAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../server/middleware.js', () => ({
  requireClientPortalAuth: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));
vi.mock('../../server/bridge-infrastructure.js', () => ({
  withWorkspaceLock: async (_wsId: string, fn: () => unknown) => fn(),
  fireBridge: vi.fn(),
  debouncedOutcomeReweight: vi.fn(),
}));
vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: vi.fn(),
}));

// Logger: spy on warn so we can assert the deprecation nudge fires exactly when attribution
// is omitted (and NOT when it is supplied). `vi.hoisted` so the spy exists before the hoisted
// vi.mock factory runs.
const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: warnSpy,
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Imports under test (after mocks) ──────────────────────────────────────────
import outcomesRouter from '../../server/routes/outcomes.js';
import { getAction } from '../../server/outcome-tracking.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';

let server: Server;
let baseUrl = '';
let ws: SeededFullWorkspace;

async function postAction(body: unknown): Promise<{ status: number; json: { success?: boolean; action?: { id: string; attribution: string } } }> {
  const res = await fetch(`${baseUrl}/api/outcomes/${ws.workspaceId}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { success?: boolean; action?: { id: string; attribution: string } } };
}

beforeAll(async () => {
  ws = seedWorkspace();
  const app = express();
  app.use(express.json());
  app.use(outcomesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(ws.workspaceId);
  ws.cleanup();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  warnSpy.mockClear();
  db.prepare('DELETE FROM tracked_actions WHERE workspace_id = ?').run(ws.workspaceId);
});

describe('POST /api/outcomes/:ws/actions — tolerate-old honest attribution default (B14)', () => {
  it('a request WITHOUT attribution is accepted (200), stored as not_acted_on, and logs a deprecation warn', async () => {
    const { status, json } = await postAction({
      actionType: 'content_refreshed',
      sourceType: 'external-recorder',
      sourceId: `no-attr-${Date.now()}`,
      baselineSnapshot: { position: 12 },
    });

    // Tolerate-old: NOT a 400 — external callers keep working.
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    // Honest default — never the silent platform_executed.
    expect(json.action!.attribution).toBe('not_acted_on');
    // Durable: read back from the DB confirms the stored value.
    expect(getAction(json.action!.id)!.attribution).toBe('not_acted_on');

    // Deprecation nudge fired.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [, message] = warnSpy.mock.calls[0];
    expect(String(message)).toContain('DEPRECATION');
    expect(String(message)).toContain('not_acted_on');
  });

  it('a request WITH attribution stores exactly that value and does NOT log the deprecation warn', async () => {
    const { status, json } = await postAction({
      actionType: 'content_published',
      sourceType: 'external-recorder',
      sourceId: `with-attr-${Date.now()}`,
      baselineSnapshot: { position: 8 },
      attribution: 'platform_executed',
    });

    expect(status).toBe(200);
    expect(json.action!.attribution).toBe('platform_executed');
    expect(getAction(json.action!.id)!.attribution).toBe('platform_executed');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('never silently stores platform_executed for a missing attribution (the closed hazard)', async () => {
    const { json } = await postAction({
      actionType: 'internal_link_added',
      sourceType: 'external-recorder',
      sourceId: `never-platform-${Date.now()}`,
      baselineSnapshot: { clicks: 3 },
    });
    expect(json.action!.attribution).not.toBe('platform_executed');
    expect(json.action!.attribution).toBe('not_acted_on');
  });
});
