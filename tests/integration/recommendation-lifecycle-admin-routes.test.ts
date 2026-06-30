/**
 * Strategy v3 Phase 2 Lane A — admin lifecycle routes + rec_discussion substrate
 * + curated_recs_sent email.
 *
 * This file holds ALL Lane A integration assertions:
 *   - rec-discussion module (writer + reader, workspace/rec scoping)
 *   - curated_recs_sent email render contract
 *   - admin lifecycle routes: send / strike / unstrike / throttle / fix
 *   - admin discussion routes: GET thread + POST strategist reply
 *
 * All admin routes are admin-HMAC-gated (requireWorkspaceAccess, NOT requireAuth)
 * and mutate the SEPARATE clientStatus/lifecycle axes via the single-writer
 * (server/recommendation-lifecycle.ts) — never RecStatus.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createEphemeralTestContext } from './helpers.js';
import { addRecDiscussionEntry, listRecDiscussion } from '../../server/rec-discussion.js';
import { renderDigest } from '../../server/email-templates.js';
import type { EmailEvent } from '../../server/email-templates.js';
import { saveRecommendations, computeRecommendationSummary } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson, patchJson } = ctx;

let workspaceId = '';
let cleanupWorkspace: (() => void) | undefined;

beforeAll(async () => {
  await ctx.startServer();
  const seeded = seedWorkspace({ clientPassword: '' });
  workspaceId = seeded.workspaceId;
  cleanupWorkspace = seeded.cleanup;
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
  db.prepare('DELETE FROM rec_discussion WHERE workspace_id = ?').run(workspaceId);
  cleanupWorkspace?.();
});

// ── Seed helper: write one rec into the workspace's recommendation set ──
// NOTE: the rec object must satisfy the full recommendationSchema (server/schemas/
// workspace-schemas.ts) — loadRecommendations validates each item via parseJsonSafeArray
// and silently DROPS any item that fails (the "Schema vs stored shape" rule), which would
// leave an empty set and a misleading 404 from the lifecycle routes. So every required
// field is populated here (not just the minimal cast).
const now = () => new Date().toISOString();
function seedCuratedRec(wsId: string, recId: string, overrides: Partial<Recommendation> = {}): void {
  const ts = now();
  const rec: Recommendation = {
    id: recId,
    workspaceId: wsId,
    priority: 'fix_now',
    type: 'metadata',
    title: `Rec ${recId}`,
    description: 'desc',
    insight: 'why it matters',
    impact: 'high',
    effort: 'low',
    impactScore: 50,
    source: 'test',
    affectedPages: [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: '+10 clicks/mo',
    actionType: 'manual',
    status: 'pending',
    clientStatus: 'curated',
    lifecycle: 'active',
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
  const set: RecommendationSet = {
    workspaceId: wsId,
    generatedAt: ts,
    recommendations: [rec],
    summary: computeRecommendationSummary([rec]),
  };
  saveRecommendations(set);
}

describe('rec-discussion module', () => {
  it('appends and reads back an entry in created-at order', () => {
    const a = addRecDiscussionEntry(workspaceId, 'rec_x', 'strategist', 'First reply');
    const b = addRecDiscussionEntry(workspaceId, 'rec_x', 'client', 'A question');
    const thread = listRecDiscussion(workspaceId, 'rec_x');
    expect(thread.map(e => e.id)).toEqual([a.id, b.id]);
    expect(thread[0]).toMatchObject({ recId: 'rec_x', author: 'strategist', body: 'First reply', workspaceId });
    expect(thread[1].author).toBe('client');
  });

  it('scopes reads to the workspace + rec id', () => {
    addRecDiscussionEntry(workspaceId, 'rec_other', 'client', 'unrelated');
    expect(listRecDiscussion(workspaceId, 'rec_x')).toHaveLength(2);
    expect(listRecDiscussion(workspaceId, 'rec_other')).toHaveLength(1);
  });
});

describe('curated_recs_sent email template', () => {
  it('renders a "N recommendations ready" subject + decision CTA', () => {
    const event: EmailEvent = {
      type: 'curated_recs_sent',
      recipient: 'client@example.com',
      workspaceId,
      workspaceName: 'Acme SEO',
      dashboardUrl: 'https://app.example.com/client/ws1',
      data: { recCount: 3 },
      createdAt: new Date().toISOString(),
    };
    const { subject, html } = renderDigest('curated_recs_sent', [event]);
    expect(subject).toContain('3');
    expect(subject.toLowerCase()).toContain('decision');
    expect(html).toContain('Acme SEO');
    expect(html).toContain('https://app.example.com/client/ws1');
  });
});

describe('POST /api/recommendations/:ws/:recId/send', () => {
  it('transitions a curated rec to clientStatus=sent and stamps sentAt', async () => {
    seedCuratedRec(workspaceId, 'rec_send_1');
    const res = await patchJson(`/api/recommendations/${workspaceId}/rec_send_1/send`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as Recommendation;
    expect(body.clientStatus).toBe('sent');
    expect(typeof body.sentAt).toBe('string');
  });

  it('404s an unknown rec', async () => {
    const res = await patchJson(`/api/recommendations/${workspaceId}/nope/send`, {});
    expect(res.status).toBe(404);
  });
});

describe('strike + unstrike routes', () => {
  it('strike sets lifecycle=struck + struckAt; unstrike reverses it', async () => {
    seedCuratedRec(workspaceId, 'rec_strike_1', { clientStatus: 'system' });
    const struckRes = await patchJson(`/api/recommendations/${workspaceId}/rec_strike_1/strike`, {});
    expect(struckRes.status).toBe(200);
    const struck = await struckRes.json() as Recommendation;
    expect(struck.lifecycle).toBe('struck');
    expect(typeof struck.struckAt).toBe('string');

    const restoredRes = await patchJson(`/api/recommendations/${workspaceId}/rec_strike_1/unstrike`, {});
    expect(restoredRes.status).toBe(200);
    const restored = await restoredRes.json() as Recommendation;
    expect(restored.lifecycle).toBe('active');
  });
});

describe('throttle + fix routes', () => {
  it('throttle sets lifecycle=throttled + a future throttledUntil', async () => {
    seedCuratedRec(workspaceId, 'rec_throttle_1', { clientStatus: 'system' });
    const res = await patchJson(`/api/recommendations/${workspaceId}/rec_throttle_1/throttle`, { days: 30 });
    expect(res.status).toBe(200);
    const body = await res.json() as Recommendation;
    expect(body.lifecycle).toBe('throttled');
    expect(Date.parse(body.throttledUntil ?? '')).toBeGreaterThan(Date.now());
  });

  it('throttle rejects a non-{7,30,90} duration', async () => {
    seedCuratedRec(workspaceId, 'rec_throttle_2', { clientStatus: 'system' });
    const res = await patchJson(`/api/recommendations/${workspaceId}/rec_throttle_2/throttle`, { days: 45 });
    expect(res.status).toBe(400);
  });

  it('fix marks the rec via the completion path', async () => {
    seedCuratedRec(workspaceId, 'rec_fix_1', { clientStatus: 'system' });
    const res = await patchJson(`/api/recommendations/${workspaceId}/rec_fix_1/fix`, {});
    expect(res.status).toBe(200);
  });
});

describe('admin rec discussion routes', () => {
  it('POSTs a strategist reply and GETs the thread', async () => {
    seedCuratedRec(workspaceId, 'rec_disc_1', { clientStatus: 'sent' });
    const postRes = await postJson(`/api/recommendations/${workspaceId}/rec_disc_1/discussion`, { body: 'Here is the plan' });
    expect(postRes.status).toBe(200);
    const posted = await postRes.json() as { author: string };
    expect(posted.author).toBe('strategist');

    const getRes = await api(`/api/recommendations/${workspaceId}/rec_disc_1/discussion`);
    expect(getRes.status).toBe(200);
    const thread = await getRes.json() as Array<{ body: string }>;
    expect(thread).toHaveLength(1);
    expect(thread[0].body).toBe('Here is the plan');
  });

  it('rejects an empty body', async () => {
    const res = await postJson(`/api/recommendations/${workspaceId}/rec_disc_1/discussion`, { body: '   ' });
    expect(res.status).toBe(400);
  });
});
