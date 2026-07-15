/**
 * Reconcile R4-PR1 — mirror-failure OBSERVABILITY (the core of B6).
 *
 * The whole point of the ticket: a dual-write mirror failure is OBSERVABLE (a durable admin-only
 * activity + a Pino error), NEVER silently swallowed, and NEVER rolls back the primary write. The
 * autosend-cron path is covered elsewhere; this file closes the two remaining seams:
 *
 *   - the SHARED `observeRecMirror` helper on the recommendation per-row `/send` route
 *     (server/routes/recommendations.ts) — force the mirror to return { ok:false } and assert exactly
 *     one rec_status_updated "mirror failed" activity is written AND the send itself still 200s (the
 *     rec is flipped to clientStatus=sent — primary write not rolled back)
 *   - the client-action caller `createAdminClientAction` (server/domains/inbox/client-actions-
 *     mutations.ts) — force the mirror to return { ok:false } and assert the failure activity is
 *     recorded AND the action is still created
 *
 * In-process pattern (mirrors admin-recommendations-surface.test.ts): vi.mock the two dual-write
 * modules BEFORE importing app.js so the route + caller resolve the mocked mirror on the SAME module
 * graph (same db, same activity log). The mocks are "real by default, fail on demand" so nothing else
 * regresses.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ── "real by default, fail on demand" mirror mocks (before app import) ──
const recMirrorState = vi.hoisted(() => ({ override: null as { ok: false; error: string } | null }));
const caMirrorState = vi.hoisted(() => ({ override: null as { ok: false; error: string } | null }));

vi.mock('../../server/domains/inbox/recommendation-dual-write.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/domains/inbox/recommendation-dual-write.js')>(
    '../../server/domains/inbox/recommendation-dual-write.js',
  );
  return {
    ...actual,
    mirrorRecommendationToDeliverable: (workspaceId: string, rec: unknown) =>
      recMirrorState.override ?? actual.mirrorRecommendationToDeliverable(workspaceId, rec as never),
  };
});

vi.mock('../../server/domains/inbox/client-action-dual-write.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/domains/inbox/client-action-dual-write.js')>(
    '../../server/domains/inbox/client-action-dual-write.js',
  );
  return {
    ...actual,
    mirrorClientActionToDeliverable: (workspaceId: string, action: unknown) =>
      caMirrorState.override ?? actual.mirrorClientActionToDeliverable(workspaceId, action as never),
  };
});

// ── Imports (after mock registration) ──
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations } from '../../server/recommendations.js';
import { createAdminClientAction } from '../../server/domains/inbox/client-actions-mutations.js';
import { listActivity } from '../../server/activity-log.js';
import { setBroadcast } from '../../server/broadcast.js';
import db from '../../server/db/index.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';
import type { ClientAction, ClientActionPayload } from '../../shared/types/client-actions.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD; // requireWorkspaceAccess passes through (no HMAC gate)
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

function patchJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function seedRec(recId: string, overrides: Partial<Recommendation> = {}): void {
  const now = new Date().toISOString();
  const rec: Recommendation = {
    id: recId, workspaceId: wsId, priority: 'fix_now', type: 'metadata',
    title: `Rec ${recId}`, description: 'desc', insight: 'why it matters', impact: 'high', effort: 'low',
    impactScore: 50, source: 'test', affectedPages: [], trafficAtRisk: 0, impressionsAtRisk: 0,
    estimatedGain: '+10 clicks/mo', actionType: 'manual', status: 'pending',
    clientStatus: 'curated', lifecycle: 'active', createdAt: now, updatedAt: now, ...overrides,
  };
  const set: RecommendationSet = {
    workspaceId: wsId, generatedAt: now, recommendations: [rec],
    summary: { fixNow: 1, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 50, trafficAtRisk: 0, estimatedRecoverableClicks: 0, estimatedRecoverableImpressions: 0 },
  };
  saveRecommendations(set);
}

function makeAction(over: Partial<ClientAction> = {}): ClientAction {
  return {
    id: `ca_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: wsId,
    sourceType: 'redirect_proposal',
    sourceId: `redirects:${Math.random().toString(36).slice(2)}`,
    title: 'Redirect recommendations (1)',
    summary: 'Review 1 redirect proposal.',
    payload: { redirects: [{ source: '/a', target: '/b' }] } as ClientActionPayload,
    status: 'pending', priority: 'medium',
    createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

function mirrorFailureActivities(): ReturnType<typeof listActivity> {
  return listActivity(wsId, 100).filter(
    (a) => a.type === 'rec_status_updated' && typeof a.title === 'string' && a.title.includes('mirror failed'),
  );
}

beforeAll(async () => {
  await startTestServer();
  // In-process caller path (createAdminClientAction) broadcasts — init a no-op broadcast.
  setBroadcast(() => {}, () => {});
  wsId = createWorkspace('Mirror Failure Observation Test', 'site-mfo-1').id;
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  if (server) await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
});

beforeEach(() => {
  recMirrorState.override = null;
  caMirrorState.override = null;
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
});

describe('observeRecMirror — recommendation /send route failure branch', () => {
  it('records exactly one rec_status_updated mirror-failure activity AND the send still succeeds', async () => {
    seedRec('rec_send_fail', { clientStatus: 'curated' });
    recMirrorState.override = { ok: false, error: 'simulated store write failure' };

    const res = await patchJson(`/api/recommendations/${wsId}/rec_send_fail/send`, {});
    // Primary write NOT rolled back — the send itself succeeds and flips clientStatus → sent.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clientStatus?: string };
    expect(body.clientStatus).toBe('sent');

    // The failure is OBSERVED via the shared observeRecMirror helper.
    const failures = mirrorFailureActivities();
    expect(failures).toHaveLength(1);
    expect(failures[0].metadata).toEqual(
      expect.objectContaining({ recId: 'rec_send_fail', mirrorError: 'simulated store write failure' }),
    );
  });

  it('does NOT record a mirror-failure activity when the mirror succeeds (control)', async () => {
    seedRec('rec_send_ok', { clientStatus: 'curated' });
    // override stays null → real mirror runs (succeeds).
    const res = await patchJson(`/api/recommendations/${wsId}/rec_send_ok/send`, {});
    expect(res.status).toBe(200);
    expect(mirrorFailureActivities()).toHaveLength(0);
  });
});

describe('createAdminClientAction — client-action caller failure branch', () => {
  it('records a mirror-failure activity AND the action is still created', () => {
    caMirrorState.override = { ok: false, error: 'simulated CA store write failure' };

    const action = createAdminClientAction(wsId, {
      sourceType: 'redirect_proposal',
      title: 'Redirect recommendations (1)',
      summary: 'Review 1 redirect proposal.',
      payload: makeAction().payload,
    });
    // Primary write NOT rolled back — the legacy action was created.
    expect(action.id).toBeTruthy();
    expect(action.title).toBe('Redirect recommendations (1)');

    // The failure is OBSERVED by the caller.
    const failures = listActivity(wsId, 100).filter(
      (a) => a.type === 'rec_status_updated' && typeof a.title === 'string' && a.title.includes('mirror failed'),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].metadata).toEqual(
      expect.objectContaining({ actionId: action.id, mirrorError: 'simulated CA store write failure' }),
    );
  });

  it('does NOT record a mirror-failure activity when the mirror succeeds (control)', () => {
    // override stays null → real mirror runs (succeeds).
    const action = createAdminClientAction(wsId, {
      sourceType: 'redirect_proposal',
      title: 'Redirect recommendations (1)',
      summary: 'Review 1 redirect proposal.',
      payload: makeAction().payload,
    });
    expect(action.id).toBeTruthy();
    const failures = listActivity(wsId, 100).filter(
      (a) => a.type === 'rec_status_updated' && typeof a.title === 'string' && a.title.includes('mirror failed'),
    );
    expect(failures).toHaveLength(0);
  });
});
