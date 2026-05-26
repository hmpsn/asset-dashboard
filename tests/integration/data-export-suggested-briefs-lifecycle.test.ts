/**
 * Integration tests for:
 *  - GET /api/export/:workspaceId/<type>   (7 export endpoints)
 *  - GET/PATCH/POST /api/suggested-briefs/:workspaceId[/:briefId][/snooze|dismiss]
 *
 * Uses in-process Express (port 0) + vi.hoisted broadcast capture.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({ sendEmail: vi.fn() }));

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createSuggestedBrief } from '../../server/suggested-briefs-store.js';
import { WS_EVENTS } from '../../server/ws-events.js';

let server: http.Server | null = null;
let baseUrl = '';
let wsId = '';
let wsIdB = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = null;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await startTestServer();
  wsId = createWorkspace('Export+SuggestedBriefs Primary WS').id;
  wsIdB = createWorkspace('Export+SuggestedBriefs Isolation WS').id;
}, 25_000);

afterAll(async () => {
  if (wsId) deleteWorkspace(wsId);
  if (wsIdB) deleteWorkspace(wsIdB);
  await stopTestServer();
}, 15_000);

beforeEach(() => {
  broadcastState.calls = [];
});

// ── Data Export — JSON format (default) ────────────────────────────────────────

describe('GET /api/export/:workspaceId/briefs', () => {
  it('returns 200 with a JSON array for a fresh workspace', async () => {
    const res = await api(`/api/export/${wsId}/briefs`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns CSV when format=csv query param is set', async () => {
    const res = await api(`/api/export/${wsId}/briefs?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    const text = await res.text();
    // CSV must at least include the header row
    expect(text).toMatch(/targetKeyword/);
  });
});

describe('GET /api/export/:workspaceId/requests', () => {
  it('returns 200 with a JSON array', async () => {
    const res = await api(`/api/export/${wsId}/requests`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns CSV when format=csv', async () => {
    const res = await api(`/api/export/${wsId}/requests?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    const text = await res.text();
    expect(text).toMatch(/topic/);
  });
});

describe('GET /api/export/:workspaceId/activity', () => {
  it('returns 200 with a JSON array', async () => {
    const res = await api(`/api/export/${wsId}/activity`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('GET /api/export/:workspaceId/strategy', () => {
  it('returns 200 with a JSON array (empty for fresh workspace)', async () => {
    const res = await api(`/api/export/${wsId}/strategy`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await api('/api/export/ws_nonexistent_xyz/strategy');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('GET /api/export/:workspaceId/payments', () => {
  it('returns 200 with a JSON array', async () => {
    const res = await api(`/api/export/${wsId}/payments`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('GET /api/export/:workspaceId/matrices', () => {
  it('returns 200 with a JSON array of flattened cells', async () => {
    const res = await api(`/api/export/${wsId}/matrices`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('GET /api/export/:workspaceId/templates', () => {
  it('returns 200 with a JSON array', async () => {
    const res = await api(`/api/export/${wsId}/templates`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ── Data Export — Content-Disposition header ───────────────────────────────────

describe('Data export Content-Disposition header', () => {
  it('sets attachment filename with workspace id for JSON', async () => {
    const res = await api(`/api/export/${wsId}/briefs`);
    expect(res.status).toBe(200);
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/attachment/);
    expect(disposition).toMatch(/briefs-/);
    expect(disposition).toMatch(/\.json/);
  });

  it('sets attachment filename with .csv extension for CSV format', async () => {
    const res = await api(`/api/export/${wsId}/activity?format=csv`);
    expect(res.status).toBe(200);
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/attachment/);
    expect(disposition).toMatch(/\.csv/);
  });
});

// ── Suggested Briefs — lifecycle ───────────────────────────────────────────────

describe('GET /api/suggested-briefs/:workspaceId', () => {
  it('returns 200 with an empty array for a fresh workspace', async () => {
    const freshWs = createWorkspace('SuggestedBriefs Empty WS');
    try {
      const res = await api(`/api/suggested-briefs/${freshWs.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('returns pending briefs after one is seeded', async () => {
    createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'seo for small business',
      reason: 'High potential keyword gap',
      priority: 'high',
    });

    const res = await api(`/api/suggested-briefs/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((b: { keyword: string }) => b.keyword === 'seo for small business');
    expect(found).toBeDefined();
    expect(found.status).toBe('pending');
    expect(found.priority).toBe('high');
  });

  it('includes dismissed/accepted briefs when ?all=true', async () => {
    // Seed a brief and dismiss it via the store directly
    const brief = createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'local seo tips all-param',
      reason: 'Gap analysis',
      priority: 'low',
    });

    // Dismiss it via API so it's excluded from default list
    await patchJson(`/api/suggested-briefs/${wsId}/${brief.id}`, { status: 'dismissed' });

    const defaultRes = await api(`/api/suggested-briefs/${wsId}`);
    const defaultBody = await defaultRes.json();
    const inDefault = defaultBody.some((b: { id: string }) => b.id === brief.id);

    const allRes = await api(`/api/suggested-briefs/${wsId}?all=true`);
    expect(allRes.status).toBe(200);
    const allBody = await allRes.json();
    const inAll = allBody.some((b: { id: string }) => b.id === brief.id);

    // Dismissed brief must appear only in the all=true list
    expect(inDefault).toBe(false);
    expect(inAll).toBe(true);
  });
});

describe('GET /api/suggested-briefs/:workspaceId/:briefId', () => {
  it('returns 200 with the brief when it exists', async () => {
    const brief = createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'content marketing ROI',
      reason: 'Content gap',
      priority: 'medium',
    });

    const res = await api(`/api/suggested-briefs/${wsId}/${brief.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(brief.id);
    expect(body.keyword).toBe('content marketing ROI');
    expect(body.workspaceId).toBe(wsId);
  });

  it('returns 404 for a non-existent brief id', async () => {
    const res = await api(`/api/suggested-briefs/${wsId}/nonexistent-brief-id-xyz`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 404 when brief belongs to a different workspace (isolation)', async () => {
    const briefForWsA = createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'isolation-test-keyword',
      reason: 'Cross-workspace test',
      priority: 'low',
    });

    // Attempt to fetch wsA's brief via wsB's route
    const res = await api(`/api/suggested-briefs/${wsIdB}/${briefForWsA.id}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/suggested-briefs/:workspaceId/:briefId — status update', () => {
  it('accepts a brief (status → accepted) and returns updated brief', async () => {
    const brief = createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'ecommerce seo checklist',
      reason: 'High traffic opportunity',
      priority: 'high',
    });

    const res = await patchJson(`/api/suggested-briefs/${wsId}/${brief.id}`, {
      status: 'accepted',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(brief.id);
    expect(body.status).toBe('accepted');
    expect(body.resolvedAt).toBeTruthy();
  });

  it('dismisses a brief (status → dismissed) and returns updated brief', async () => {
    const brief = createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'dismiss test keyword unique',
      reason: 'Gap found',
      priority: 'medium',
    });

    const res = await patchJson(`/api/suggested-briefs/${wsId}/${brief.id}`, {
      status: 'dismissed',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('dismissed');
  });

  it('broadcasts SUGGESTED_BRIEF_UPDATED after accept', async () => {
    const brief = createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'broadcast accept keyword',
      reason: 'Testing broadcast',
      priority: 'medium',
    });

    broadcastState.calls = [];
    await patchJson(`/api/suggested-briefs/${wsId}/${brief.id}`, { status: 'accepted' });

    const relevant = broadcastState.calls.filter(c => c.event === WS_EVENTS.SUGGESTED_BRIEF_UPDATED);
    expect(relevant).toHaveLength(1);
    expect(relevant[0].workspaceId).toBe(wsId);
    expect((relevant[0].payload as { id: string; status: string }).id).toBe(brief.id);
    expect((relevant[0].payload as { id: string; status: string }).status).toBe('accepted');
  });

  it('returns 404 when patching a non-existent brief', async () => {
    const res = await patchJson(`/api/suggested-briefs/${wsId}/no-such-brief-id`, {
      status: 'accepted',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid status value', async () => {
    const brief = createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'validation test keyword patch',
      reason: 'Validation check',
      priority: 'low',
    });

    const res = await patchJson(`/api/suggested-briefs/${wsId}/${brief.id}`, {
      status: 'invalid-status-value',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/suggested-briefs/:workspaceId/:briefId/snooze', () => {
  it('snoozes a brief until the given date and returns updated brief', async () => {
    const brief = createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'snooze me keyword',
      reason: 'Will revisit later',
      priority: 'low',
    });

    const until = '2099-12-31';
    const res = await postJson(`/api/suggested-briefs/${wsId}/${brief.id}/snooze`, { until });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(brief.id);
    expect(body.status).toBe('snoozed');
    expect(body.snoozedUntil).toBe(until);
  });

  it('broadcasts SUGGESTED_BRIEF_UPDATED after snooze', async () => {
    const brief = createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'broadcast snooze keyword',
      reason: 'Broadcast test',
      priority: 'medium',
    });

    broadcastState.calls = [];
    await postJson(`/api/suggested-briefs/${wsId}/${brief.id}/snooze`, {
      until: '2099-06-01',
    });

    const relevant = broadcastState.calls.filter(c => c.event === WS_EVENTS.SUGGESTED_BRIEF_UPDATED);
    expect(relevant).toHaveLength(1);
    expect(relevant[0].workspaceId).toBe(wsId);
  });

  it('returns 400 for a malformed snooze date', async () => {
    const brief = createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'snooze validation keyword',
      reason: 'Bad date test',
      priority: 'low',
    });

    const res = await postJson(`/api/suggested-briefs/${wsId}/${brief.id}/snooze`, {
      until: 'not-a-date',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent brief', async () => {
    const res = await postJson(`/api/suggested-briefs/${wsId}/no-such-brief/snooze`, {
      until: '2099-01-01',
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/suggested-briefs/:workspaceId/:briefId/dismiss', () => {
  it('dismisses a brief via the dedicated dismiss endpoint', async () => {
    const brief = createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'dismiss endpoint keyword',
      reason: 'Dismiss test',
      priority: 'medium',
    });

    const res = await postJson(`/api/suggested-briefs/${wsId}/${brief.id}/dismiss`, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(brief.id);
    expect(body.status).toBe('dismissed');
  });

  it('broadcasts SUGGESTED_BRIEF_UPDATED after dismiss', async () => {
    const brief = createSuggestedBrief({
      workspaceId: wsId,
      keyword: 'broadcast dismiss keyword',
      reason: 'Broadcast dismiss test',
      priority: 'low',
    });

    broadcastState.calls = [];
    await postJson(`/api/suggested-briefs/${wsId}/${brief.id}/dismiss`, {});

    const relevant = broadcastState.calls.filter(c => c.event === WS_EVENTS.SUGGESTED_BRIEF_UPDATED);
    expect(relevant).toHaveLength(1);
    expect((relevant[0].payload as { status: string }).status).toBe('dismissed');
  });

  it('returns 404 when dismissing a non-existent brief', async () => {
    const res = await postJson(`/api/suggested-briefs/${wsId}/no-such-brief-dismiss/dismiss`, {});
    expect(res.status).toBe(404);
  });
});
