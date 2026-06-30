/**
 * Integration tests for the trust-ladder auto-send policy routes (The Issue, Phase 4).
 *
 *   GET   /api/auto-send-policy/:workspaceId            → AutoSendPolicyResponse (2 eligible rows + threshold)
 *   PATCH /api/auto-send-policy/:workspaceId/:archetype  → { enabled: boolean } (only once earned; eligible-only)
 *
 * Admin-HMAC-gated (requireWorkspaceAccess — NOT requireAuth). The route delegates to the autosend
 * store's eligibility + earn enforcement (defence in depth: the store ALSO throws). These assert:
 *   - GET returns exactly the 2 eligible archetypes + threshold = 3, defaulted when no rows exist;
 *   - PATCH enable on a NOT-earned archetype → 400 (the toggle is the reward for earned trust);
 *   - PATCH on an INELIGIBLE archetype → 4xx (never auto-send-capable);
 *   - PATCH enable on an EARNED archetype (seeded cycles = 3) → 200 with enabled:true in the response.
 *
 * In-process server pattern (http.createServer(createApp()) on port 0, APP_PASSWORD unset).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// The in-process createApp() harness never runs index.ts's setBroadcast(), so the real
// broadcastToWorkspace throws "called before init" on the PATCH success path (the 400 reject paths
// never reach it). Mock the broadcast singleton — the PATCH success contract is the response shape +
// persistence, not the WS fanout (ws-invalidation-coverage already pins the event's handler).
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
}));

import db from '../../server/db/index.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { broadcastToWorkspace } from '../../server/broadcast.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { AUTOSEND_TRUST_THRESHOLD } from '../../shared/types/strategy-autosend.js';
import type { AutoSendPolicyResponse } from '../../shared/types/strategy-autosend.js';

let baseUrl = '';
let server: http.Server | undefined;
let seeded: SeededFullWorkspace;
let wsId = '';

/** Directly seed/overwrite a policy row so earn-state is deterministic (no need to climb the ladder). */
function seedPolicy(archetype: 'quick_win' | 'technical', cycles: number, enabled = false): void {
  db.prepare(
    `INSERT INTO strategy_autosend_policy
       (workspace_id, archetype, enabled, consecutive_cycles, last_credited_week, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, archetype) DO UPDATE SET
       enabled = excluded.enabled,
       consecutive_cycles = excluded.consecutive_cycles,
       updated_at = excluded.updated_at`,
  ).run(wsId, archetype, enabled ? 1 : 0, cycles, null, new Date().toISOString());
}

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js'); // dynamic-import-ok
  server = http.createServer(createApp());
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  seeded = seedWorkspace();
  wsId = seeded.workspaceId;
}, 30_000);

afterEach(() => {
  db.prepare('DELETE FROM strategy_autosend_policy WHERE workspace_id = ?').run(wsId);
  vi.mocked(broadcastToWorkspace).mockClear();
});

afterAll(async () => {
  seeded.cleanup();
  if (server) await new Promise<void>((resolve, reject) => server!.close(err => (err ? reject(err) : resolve())));
});

describe('GET /api/auto-send-policy/:workspaceId', () => {
  it('returns exactly the 2 eligible archetypes + threshold = 3, defaulted when no rows exist', async () => {
    const res = await fetch(`${baseUrl}/api/auto-send-policy/${wsId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AutoSendPolicyResponse;
    expect(body.workspaceId).toBe(wsId);
    expect(body.threshold).toBe(AUTOSEND_TRUST_THRESHOLD);
    expect(body.policies.map(p => p.archetype).sort()).toEqual(['quick_win', 'technical']);
    for (const p of body.policies) {
      expect(p.enabled).toBe(false);
      expect(p.consecutiveCycles).toBe(0);
      expect(p.earned).toBe(false);
    }
  });

  it('reflects a seeded earned policy (earned = true once cycles >= threshold)', async () => {
    seedPolicy('quick_win', 3);
    const res = await fetch(`${baseUrl}/api/auto-send-policy/${wsId}`);
    const body = (await res.json()) as AutoSendPolicyResponse;
    const qw = body.policies.find(p => p.archetype === 'quick_win');
    expect(qw?.consecutiveCycles).toBe(3);
    expect(qw?.earned).toBe(true);
  });
});

describe('PATCH /api/auto-send-policy/:workspaceId/:archetype', () => {
  it('rejects enabling a NOT-earned archetype with 400 (the toggle is gated on earned trust)', async () => {
    seedPolicy('quick_win', 2); // not earned
    const res = await fetch(`${baseUrl}/api/auto-send-policy/${wsId}/quick_win`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    expect(typeof body.error).toBe('string');
    // The row must NOT have been flipped on.
    const after = db
      .prepare('SELECT enabled FROM strategy_autosend_policy WHERE workspace_id = ? AND archetype = ?')
      .get(wsId, 'quick_win') as { enabled: number } | undefined;
    expect(after?.enabled ?? 0).toBe(0);
    // A rejected PATCH must NOT broadcast.
    expect(broadcastToWorkspace).not.toHaveBeenCalled();
  });

  it('rejects an INELIGIBLE archetype with a 4xx (never auto-send-capable)', async () => {
    const res = await fetch(`${baseUrl}/api/auto-send-policy/${wsId}/authority_bet`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    expect(typeof body.error).toBe('string');
    // The reject must not broadcast and must not persist a row for the ineligible archetype.
    expect(broadcastToWorkspace).not.toHaveBeenCalled();
    const row = db
      .prepare('SELECT 1 FROM strategy_autosend_policy WHERE workspace_id = ? AND archetype = ?')
      .get(wsId, 'authority_bet');
    expect(row).toBeUndefined();
  });

  it('enables an EARNED archetype → 200 with enabled:true in the returned response', async () => {
    seedPolicy('quick_win', 3); // earned
    const res = await fetch(`${baseUrl}/api/auto-send-policy/${wsId}/quick_win`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AutoSendPolicyResponse;
    // The route returns the full updated response; the quick_win row is now enabled + earned.
    const qw = body.policies.find(p => p.archetype === 'quick_win');
    expect(qw?.enabled).toBe(true);
    expect(qw?.earned).toBe(true);
    // Persisted.
    const after = db
      .prepare('SELECT enabled FROM strategy_autosend_policy WHERE workspace_id = ? AND archetype = ?')
      .get(wsId, 'quick_win') as { enabled: number };
    expect(after.enabled).toBe(1);
    // Broadcasts the policy-updated event so the cockpit's TrustLadderPanel refreshes.
    expect(broadcastToWorkspace).toHaveBeenCalledWith(
      wsId,
      WS_EVENTS.STRATEGY_AUTOSEND_POLICY_UPDATED,
      expect.objectContaining({ archetype: 'quick_win', enabled: true }),
    );
  });

  it('can DISABLE an earned + enabled archetype back to off → 200, enabled:false', async () => {
    seedPolicy('quick_win', 3, true); // earned + enabled
    const res = await fetch(`${baseUrl}/api/auto-send-policy/${wsId}/quick_win`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AutoSendPolicyResponse;
    expect(body.policies.find(p => p.archetype === 'quick_win')?.enabled).toBe(false);
  });
});
