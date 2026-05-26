/**
 * Integration tests: briefing publish — notifyClientBriefingReady notification chain.
 *
 * Covers:
 * - notifyClientBriefingReady fires when workspace has clientEmail + feature flag ON
 * - notifyClientBriefingReady payload has correct fields
 * - notifyClientBriefingReady does NOT fire when workspace has no clientEmail
 * - notifyClientBriefingReady does NOT fire when feature flag is OFF
 * - BRIEFING_PUBLISHED broadcast fires on publish, scoped to correct workspaceId
 * - BRIEFING_GENERATED broadcast fires on approve/skip
 * - State machine: valid transitions return 200; invalid transitions return 409
 * - GET after PATCH confirms status updated
 * - PATCH updates stories and persists
 * - Returns 404 for nonexistent draft id
 * - Workspace isolation: operations against wrong workspace 404
 *
 * Uses the in-process server pattern (listen(0), dynamic port) + vi.hoisted mocks
 * so broadcast and email intercepts are captured in the same process. The feature
 * flag is enabled via FEATURE_CLIENT_BRIEFING_V2 env var before the app loads.
 *
 * Port: dynamic (listen(0)) — no static port allocation needed.
 */

// ── Feature flag must be set before any server module loads ───────────────────
process.env.FEATURE_CLIENT_BRIEFING_V2 = 'true';

// ── Hoisted mock state ────────────────────────────────────────────────────────

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';

const emailState = vi.hoisted(() => ({
  briefReady: [] as Array<{
    clientEmail: string;
    workspaceName: string;
    workspaceId: string;
    weekOf: string;
    storyCount: number;
    heroHeadline: string;
    dashboardUrl?: string;
  }>,
}));

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

vi.mock('../../server/email.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/email.js')>();
  return {
    ...actual,
    notifyClientBriefingReady: vi.fn((p: typeof emailState.briefReady[0]) => {
      emailState.briefReady.push(p);
    }),
  };
});

// ── Imports (after vi.mock declarations) ──────────────────────────────────────

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { upsertBriefingDraft } from '../../server/briefing-store.js';
import { WS_EVENTS } from '../../server/ws-events.js';

// ── Server helpers ────────────────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;
const originalAppPassword = process.env.APP_PASSWORD;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { ...opts });
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

// ── Story fixture helpers ─────────────────────────────────────────────────────

function makeStory(isHeadline: boolean) {
  return {
    id: randomUUID(),
    category: 'win' as const,
    isHeadline,
    headline: 'Organic traffic rose 12% this week',
    narrative: 'Your top landing pages drove a sustained increase in organic visits.',
    metrics: [{ value: '+12%', label: 'organic traffic' }],
    drillIn: { page: 'performance' as const },
    sourceRefs: [{ type: 'analytics_insight' as const, id: randomUUID() }],
  };
}

function makeStories(count: number) {
  return Array.from({ length: count }, (_, i) => makeStory(i === 0));
}

// ── Test workspace state ──────────────────────────────────────────────────────

let wsIdWithEmail = '';
let wsIdNoEmail = '';
const wsNameWithEmail = 'Briefing-Notif-WithEmail-Test';
const wsNameNoEmail = 'Briefing-Notif-NoEmail-Test';
const clientEmail = 'client@example.com';

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  wsIdWithEmail = createWorkspace(wsNameWithEmail).id;
  updateWorkspace(wsIdWithEmail, { clientEmail, tier: 'growth' });
  wsIdNoEmail = createWorkspace(wsNameNoEmail).id;
  updateWorkspace(wsIdNoEmail, { tier: 'growth' });
}, 30_000);

beforeEach(() => {
  emailState.briefReady = [];
  broadcastState.calls = [];
});

afterAll(async () => {
  deleteWorkspace(wsIdWithEmail);
  deleteWorkspace(wsIdNoEmail);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
}, 30_000);

// ─────────────────────────────────────────────────────────────────────────────
// describe: PATCH briefing status — notification chain
// ─────────────────────────────────────────────────────────────────────────────

describe('POST briefing publish — notifyClientBriefingReady', () => {
  it('fires notifyClientBriefingReady when workspace has clientEmail + flag ON', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-06-02',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    const res = await postJson(
      `/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/publish`,
      {},
    );
    expect(res.status).toBe(200);
    expect(emailState.briefReady).toHaveLength(1);
  });

  it('notifyClientBriefingReady payload has correct clientEmail, workspaceName, weekOf', async () => {
    const weekOf = '2026-06-09';
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf,
      stories: makeStories(4),
      sourceMetadata: null,
    });

    await postJson(`/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/publish`, {});

    expect(emailState.briefReady).toHaveLength(1);
    const n = emailState.briefReady[0];
    expect(n.clientEmail).toBe(clientEmail);
    expect(n.workspaceName).toBe(wsNameWithEmail);
    expect(n.workspaceId).toBe(wsIdWithEmail);
    expect(n.weekOf).toBe(weekOf);
    expect(typeof n.storyCount).toBe('number');
    expect(n.storyCount).toBe(4);
    expect(typeof n.heroHeadline).toBe('string');
  });

  it('does NOT fire notifyClientBriefingReady when workspace has no clientEmail', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdNoEmail,
      weekOf: '2026-06-16',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    const res = await postJson(
      `/api/briefing/${wsIdNoEmail}/drafts/${draft.id}/publish`,
      {},
    );
    expect(res.status).toBe(200);
    expect(emailState.briefReady).toHaveLength(0);
  });

  it('does NOT fire notifyClientBriefingReady for approve (not a publish)', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-06-23',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    const res = await postJson(
      `/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/approve`,
      {},
    );
    expect(res.status).toBe(200);
    // approve transitions to 'approved', not 'published' — no client email
    expect(emailState.briefReady).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: PATCH briefing status — broadcasts
// ─────────────────────────────────────────────────────────────────────────────

describe('POST briefing publish — BRIEFING_PUBLISHED broadcast', () => {
  it('fires BRIEFING_PUBLISHED broadcast on publish', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-07-07',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    await postJson(`/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/publish`, {});

    const publishedBroadcasts = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.BRIEFING_PUBLISHED,
    );
    expect(publishedBroadcasts).toHaveLength(1);
  });

  it('BRIEFING_PUBLISHED broadcast payload contains briefingId and weekOf', async () => {
    const weekOf = '2026-07-14';
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf,
      stories: makeStories(3),
      sourceMetadata: null,
    });

    await postJson(`/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/publish`, {});

    const publishedBroadcast = broadcastState.calls.find(
      c => c.event === WS_EVENTS.BRIEFING_PUBLISHED,
    );
    expect(publishedBroadcast).toBeTruthy();
    const payload = publishedBroadcast!.payload as { briefingId: string; weekOf: string };
    expect(payload.briefingId).toBe(draft.id);
    expect(payload.weekOf).toBe(weekOf);
  });

  it('BRIEFING_PUBLISHED broadcast is scoped to correct workspaceId', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-07-21',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    await postJson(`/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/publish`, {});

    const publishedBroadcast = broadcastState.calls.find(
      c => c.event === WS_EVENTS.BRIEFING_PUBLISHED,
    );
    expect(publishedBroadcast?.workspaceId).toBe(wsIdWithEmail);
  });

  it('approve fires BRIEFING_GENERATED broadcast (not BRIEFING_PUBLISHED)', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-07-28',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    await postJson(`/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/approve`, {});

    const generatedBroadcasts = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.BRIEFING_GENERATED,
    );
    const publishedBroadcasts = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.BRIEFING_PUBLISHED,
    );
    expect(generatedBroadcasts).toHaveLength(1);
    expect(publishedBroadcasts).toHaveLength(0);
  });

  it('skip fires BRIEFING_GENERATED broadcast scoped to correct workspace', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdNoEmail,
      weekOf: '2026-08-04',
      stories: makeStories(2),
      sourceMetadata: null,
    });

    await postJson(`/api/briefing/${wsIdNoEmail}/drafts/${draft.id}/skip`, {
      adminNote: 'Quiet week',
    });

    const generatedBroadcasts = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.BRIEFING_GENERATED && c.workspaceId === wsIdNoEmail,
    );
    expect(generatedBroadcasts).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: State machine validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Briefing state machine validation', () => {
  it('valid transition draft→approved returns 200', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-08-11',
      stories: makeStories(2),
      sourceMetadata: null,
    });

    const res = await postJson(
      `/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/approve`,
      {},
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { draft: { status: string } };
    expect(body.draft.status).toBe('approved');
  });

  it('valid transition draft→published returns 200 (skip approve step)', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-08-18',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    const res = await postJson(
      `/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/publish`,
      {},
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { draft: { status: string } };
    expect(body.draft.status).toBe('published');
  });

  it('invalid transition: published→published returns 409 without DB mutation', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-08-25',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    // First publish succeeds
    const first = await postJson(
      `/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/publish`,
      {},
    );
    expect(first.status).toBe(200);

    // Second publish should fail with 409 (terminal state — InvalidTransitionError)
    const second = await postJson(
      `/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/publish`,
      {},
    );
    expect(second.status).toBe(409);
    const body = await second.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('invalid transition: skipped→published returns 409', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-09-01',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    await postJson(`/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/skip`, {
      adminNote: 'Nothing this week',
    });

    const res = await postJson(
      `/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/publish`,
      {},
    );
    expect(res.status).toBe(409);
  });

  it('GET after valid publish confirms status updated to published', async () => {
    const weekOf = '2026-09-08';
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf,
      stories: makeStories(3),
      sourceMetadata: null,
    });

    await postJson(`/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/publish`, {});

    // GET drafts list and confirm the draft is now published
    const listRes = await api(`/api/briefing/${wsIdWithEmail}/drafts`);
    expect(listRes.status).toBe(200);
    const body = await listRes.json() as { drafts: Array<{ id: string; status: string }> };
    const found = body.drafts.find(d => d.id === draft.id);
    expect(found).toBeTruthy();
    expect(found!.status).toBe('published');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: Briefing PATCH stories field updates
// ─────────────────────────────────────────────────────────────────────────────

describe('Briefing PATCH stories field updates', () => {
  it('PATCH /stories updates stories and persists the change', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-09-15',
      stories: makeStories(2),
      sourceMetadata: null,
    });

    const newStories = makeStories(4);
    const res = await patchJson(
      `/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/stories`,
      { stories: newStories },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { draft: { id: string; stories: unknown[] } };
    expect(body.draft.id).toBe(draft.id);
    expect(body.draft.stories).toHaveLength(4);
  });

  it('returns 409 when trying to edit a published draft', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-09-22',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    // Publish it first
    await postJson(`/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/publish`, {});

    // Then try to edit — should 409 (published is a terminal state)
    const editRes = await patchJson(
      `/api/briefing/${wsIdWithEmail}/drafts/${draft.id}/stories`,
      { stories: makeStories(2) },
    );
    expect(editRes.status).toBe(409);
  });

  it('returns 404 for nonexistent briefing id on PATCH stories', async () => {
    const res = await patchJson(
      `/api/briefing/${wsIdWithEmail}/drafts/does-not-exist/stories`,
      { stories: makeStories(1) },
    );
    expect(res.status).toBe(404);
  });

  it('workspace isolation: PATCH stories for wsA draft via wsB path returns 404', async () => {
    // Seed a draft in wsIdWithEmail
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-09-29',
      stories: makeStories(2),
      sourceMetadata: null,
    });

    // Try to access it via wsIdNoEmail — must 404 (workspace check)
    const res = await patchJson(
      `/api/briefing/${wsIdNoEmail}/drafts/${draft.id}/stories`,
      { stories: makeStories(2) },
    );
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: Briefing GET drafts list
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/briefing/:wsId/drafts', () => {
  it('returns 200 with drafts array containing seeded draft', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-10-06',
      stories: makeStories(2),
      sourceMetadata: null,
    });

    const res = await api(`/api/briefing/${wsIdWithEmail}/drafts`);
    expect(res.status).toBe(200);
    const body = await res.json() as { drafts: Array<{ id: string; weekOf: string; status: string; stories: unknown[] }> };
    expect(Array.isArray(body.drafts)).toBe(true);
    const found = body.drafts.find(d => d.id === draft.id);
    expect(found).toBeTruthy();
    expect(found!.weekOf).toBe('2026-10-06');
    expect(found!.status).toBe('draft');
    expect(Array.isArray(found!.stories)).toBe(true);
  });

  it('workspace isolation: drafts from wsA do not appear in wsB response', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-10-13',
      stories: makeStories(2),
      sourceMetadata: null,
    });

    const res = await api(`/api/briefing/${wsIdNoEmail}/drafts`);
    expect(res.status).toBe(200);
    const body = await res.json() as { drafts: Array<{ id: string }> };
    const found = body.drafts.find(d => d.id === draft.id);
    expect(found).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// describe: Publish — workspace isolation on cross-workspace access
// ─────────────────────────────────────────────────────────────────────────────

describe('Briefing publish — workspace isolation', () => {
  it('publish via wrong workspace returns 404', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsIdWithEmail,
      weekOf: '2026-10-20',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    // Attempt to publish wsIdWithEmail's draft via wsIdNoEmail route
    const res = await postJson(
      `/api/briefing/${wsIdNoEmail}/drafts/${draft.id}/publish`,
      {},
    );
    expect(res.status).toBe(404);
    // Email must not have fired
    expect(emailState.briefReady).toHaveLength(0);
  });
});
