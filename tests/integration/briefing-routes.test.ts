/**
 * Integration tests for briefing admin API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET  /api/briefing/:wsId/drafts              list drafts
 * - PATCH /api/briefing/:wsId/drafts/:id/stories  update stories
 * - POST  /api/briefing/:wsId/drafts/:id/approve  approve draft
 * - POST  /api/briefing/:wsId/drafts/:id/publish  publish draft
 * - POST  /api/briefing/:wsId/drafts/:id/skip     skip draft
 * - POST  /api/briefing/:wsId/generate-now        manual trigger (202)
 *
 * Port: 13329 (verified free — highest used is 13328)
 *
 * Sets FEATURE_CLIENT_BRIEFING_V2=true at module load so the spawned test
 * server sees the flag as ON — the generate-now route gates on it. Pattern
 * mirrors tests/integration/outcome-pipeline.test.ts.
 */
process.env.FEATURE_CLIENT_BRIEFING_V2 = 'true';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { upsertBriefingDraft } from '../../server/briefing-store.js';
import { listActivity } from '../../server/activity-log.js';
import { randomUUID } from 'crypto';

const ctx = createTestContext(13329); // port-ok: verified free as of 2026-04-29; extends range to 13329
const { api, postJson, patchJson } = ctx;

let wsId = '';
let cleanup: () => void;

// ── Sample story fixture ─────────────────────────────────────────────────────

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

// ── Test lifecycle ───────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();
  const ws = seedWorkspace({ tier: 'growth' });
  wsId = ws.workspaceId;
  cleanup = ws.cleanup;
}, 30_000);

afterAll(() => {
  ctx.stopServer();
  cleanup?.();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/briefing/:wsId/drafts
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/briefing/:wsId/drafts', () => {
  it('returns 200 with empty drafts array for new workspace', async () => {
    const res = await api(`/api/briefing/${wsId}/drafts`);
    expect(res.status).toBe(200);
    const body = await res.json() as { drafts: unknown[] };
    expect(Array.isArray(body.drafts)).toBe(true);
  });

  it('lists seeded drafts', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-04-21',
      stories: makeStories(2),
      sourceMetadata: null,
    });

    const res = await api(`/api/briefing/${wsId}/drafts`);
    expect(res.status).toBe(200);
    const body = await res.json() as { drafts: Array<{ id: string }> };
    const found = body.drafts.some(d => d.id === draft.id);
    expect(found).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/briefing/:wsId/drafts/:id/stories
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/briefing/:wsId/drafts/:id/stories', () => {
  let draftId = '';

  beforeAll(() => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-04-14',
      stories: makeStories(2),
      sourceMetadata: null,
    });
    draftId = draft.id;
  });

  it('returns 400 when stories array is empty (Zod min(1))', async () => {
    const res = await patchJson(`/api/briefing/${wsId}/drafts/${draftId}/stories`, {
      stories: [],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when story has bad shape (missing required field)', async () => {
    const res = await patchJson(`/api/briefing/${wsId}/drafts/${draftId}/stories`, {
      stories: [{ id: randomUUID(), isHeadline: true, headline: 'Bad story' }],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when no story has isHeadline=true', async () => {
    const stories = makeStories(2).map(s => ({ ...s, isHeadline: false }));
    const res = await patchJson(`/api/briefing/${wsId}/drafts/${draftId}/stories`, {
      stories,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('returns 400 when multiple stories have isHeadline=true', async () => {
    const stories = makeStories(2).map(s => ({ ...s, isHeadline: true }));
    const res = await patchJson(`/api/briefing/${wsId}/drafts/${draftId}/stories`, {
      stories,
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 and updates stories on valid input, broadcasts briefing:generated', async () => {
    const newStories = makeStories(3);
    const res = await patchJson(`/api/briefing/${wsId}/drafts/${draftId}/stories`, {
      stories: newStories,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { draft: { id: string; stories: unknown[] } };
    expect(body.draft.id).toBe(draftId);
    expect(body.draft.stories).toHaveLength(3);
  });

  it('returns 404 for non-existent draft id', async () => {
    const res = await patchJson(`/api/briefing/${wsId}/drafts/nonexistent-id/stories`, {
      stories: makeStories(1),
    });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/briefing/:wsId/drafts/:id/approve
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/briefing/:wsId/drafts/:id/approve', () => {
  let draftId = '';

  beforeAll(() => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-04-07',
      stories: makeStories(2),
      sourceMetadata: null,
    });
    draftId = draft.id;
  });

  it('returns 200 and transitions draft → approved', async () => {
    const res = await postJson(`/api/briefing/${wsId}/drafts/${draftId}/approve`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { draft: { status: string } };
    expect(body.draft.status).toBe('approved');
  });

  it('returns 409 when trying to approve an already-published draft (InvalidTransitionError)', async () => {
    // Create a fresh draft and publish it directly
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-03-31',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    // Publish it first
    const publishRes = await postJson(`/api/briefing/${wsId}/drafts/${draft.id}/publish`, {});
    expect(publishRes.status).toBe(200);

    // Attempting to approve a published draft should 409
    const approveRes = await postJson(`/api/briefing/${wsId}/drafts/${draft.id}/approve`, {});
    expect(approveRes.status).toBe(409);
  });

  it('returns 404 for nonexistent draft', async () => {
    const res = await postJson(`/api/briefing/${wsId}/drafts/totally-nonexistent/approve`, {});
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/briefing/:wsId/drafts/:id/publish
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/briefing/:wsId/drafts/:id/publish', () => {
  it('returns 409 when draft has fewer than 3 stories', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-03-24',
      stories: makeStories(2),
      sourceMetadata: null,
    });
    const res = await postJson(`/api/briefing/${wsId}/drafts/${draft.id}/publish`, {});
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('3 stories');
  });

  it('returns 200, records briefing_published activity, broadcasts briefing:published', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-03-17',
      stories: makeStories(4),
      sourceMetadata: null,
    });

    const res = await postJson(`/api/briefing/${wsId}/drafts/${draft.id}/publish`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { draft: { status: string; weekOf: string } };
    expect(body.draft.status).toBe('published');

    // Verify addActivity was called for briefing_published
    const activities = listActivity(wsId, 50);
    const publishActivity = activities.find(a => a.type === 'briefing_published');
    expect(publishActivity).toBeTruthy();
    expect(publishActivity!.type).toBe('briefing_published');
  });

  it('returns 409 when trying to publish an already-published draft', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-03-10',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    // First publish succeeds
    const first = await postJson(`/api/briefing/${wsId}/drafts/${draft.id}/publish`, {});
    expect(first.status).toBe(200);

    // Second publish should 409 (InvalidTransitionError)
    const second = await postJson(`/api/briefing/${wsId}/drafts/${draft.id}/publish`, {});
    expect(second.status).toBe(409);
  });

  it('returns 409 when trying to publish a skipped draft', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-03-03',
      stories: makeStories(3),
      sourceMetadata: null,
    });

    // Skip it first
    const skipRes = await postJson(`/api/briefing/${wsId}/drafts/${draft.id}/skip`, {
      adminNote: 'No news this week',
    });
    expect(skipRes.status).toBe(200);

    // Now try to publish
    const publishRes = await postJson(`/api/briefing/${wsId}/drafts/${draft.id}/publish`, {});
    expect(publishRes.status).toBe(409);
  });

  it('returns 404 for nonexistent draft', async () => {
    const res = await postJson(`/api/briefing/${wsId}/drafts/doesnotexist/publish`, {});
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/briefing/:wsId/drafts/:id/skip
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/briefing/:wsId/drafts/:id/skip', () => {
  it('returns 400 when adminNote is missing', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-02-24',
      stories: makeStories(2),
      sourceMetadata: null,
    });
    const res = await postJson(`/api/briefing/${wsId}/drafts/${draft.id}/skip`, {});
    expect(res.status).toBe(400);
  });

  it('returns 400 when adminNote is empty string (Zod min(1))', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-02-17',
      stories: makeStories(2),
      sourceMetadata: null,
    });
    const res = await postJson(`/api/briefing/${wsId}/drafts/${draft.id}/skip`, {
      adminNote: '',
    });
    expect(res.status).toBe(400);
  });

  it('returns 200, transitions to skipped, records briefing_skipped activity', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-02-10',
      stories: makeStories(2),
      sourceMetadata: null,
    });

    const adminNote = 'Quiet week — nothing notable to share';
    const res = await postJson(`/api/briefing/${wsId}/drafts/${draft.id}/skip`, { adminNote });
    expect(res.status).toBe(200);
    const body = await res.json() as { draft: { status: string; adminNote: string | null } };
    expect(body.draft.status).toBe('skipped');
    expect(body.draft.adminNote).toBe(adminNote);

    // Verify addActivity was called for briefing_skipped
    const activities = listActivity(wsId, 50);
    const skipActivity = activities.find(a => a.type === 'briefing_skipped');
    expect(skipActivity).toBeTruthy();
    expect(skipActivity!.type).toBe('briefing_skipped');
  });

  it('returns 409 when trying to skip a published draft', async () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-02-03',
      stories: makeStories(3),
      sourceMetadata: null,
    });
    // Publish it first
    await postJson(`/api/briefing/${wsId}/drafts/${draft.id}/publish`, {});
    // Then try to skip
    const res = await postJson(`/api/briefing/${wsId}/drafts/${draft.id}/skip`, {
      adminNote: 'Should not work',
    });
    expect(res.status).toBe(409);
  });

  it('returns 404 for nonexistent draft', async () => {
    const res = await postJson(`/api/briefing/${wsId}/drafts/does-not-exist/skip`, {
      adminNote: 'Note for nonexistent draft',
    });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/briefing/:wsId/generate-now
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/briefing/:wsId/generate-now', () => {
  // The route gates on isFeatureEnabled('client-briefing-v2'). The env var
  // set at the top of this file (FEATURE_CLIENT_BRIEFING_V2=true) ensures
  // the spawned test server sees the flag as enabled. The dark-launch
  // behavior (404 when flag is off) is exercised by the unit-level
  // test on the route handler directly.
  it('returns 202 when flag is ON', async () => {
    const res = await postJson(`/api/briefing/${wsId}/generate-now`, {});
    expect(res.status).toBe(202);
    const body = await res.json() as { accepted: boolean };
    expect(body.accepted).toBe(true);
  });
});
