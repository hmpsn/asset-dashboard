/**
 * Strategy "The Issue" Phase 2 — close-the-loop integration tests (Lane A, the #12c keystone).
 *
 * Exercises the REAL public read/write paths (not the admin route) for the revenue spine:
 *   - operator /send (per-row AND bulk) mints a client_deliverable type='recommendation'
 *     status='awaiting_client' + fires DELIVERABLE_SENT (half-loop #1)
 *   - client act-on → clientStatus=approved + a durable content_topic_requests row carrying
 *     recommendationId + strategyCardContext, briefId null, NOTHING generated; appears in BOTH the
 *     client + admin content-request lists (half-loop #2)
 *   - /apply on a rec-derived deliverable returns 400 (respond-only)
 *   - public GET ?clientStatus=sent returns only sent recs + client-safe fields (no admin axis leak)
 *   - greenlight attribution: exactly one TrackedAction per rec (idempotent); silent /fix also creates one
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { setWorkspaceFlagOverride } from '../../server/feature-flags.js';
import { createEphemeralTestContext } from './helpers.js';
import {
  saveRecommendations,
  loadRecommendations,
  computeRecommendationSummary,
} from '../../server/recommendations.js';
import { listDeliverables } from '../../server/client-deliverables.js';
import { listContentRequests } from '../../server/content-requests.js';
import { getActionByWorkspaceAndSource } from '../../server/outcome-tracking.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson, patchJson } = ctx;

let workspaceId = '';
let cleanupWorkspace: (() => void) | undefined;

beforeAll(async () => {
  await ctx.startServer();
  // Passwordless portal so the public act-on/GET routes pass through (autoPublicAuth covers config).
  const seeded = seedWorkspace({ clientPassword: '' });
  workspaceId = seeded.workspaceId;
  cleanupWorkspace = seeded.cleanup;
  // The Issue §7: the restricted clientStatus public projection + the ?clientStatus filter are
  // flag-gated per workspace — enable it so this loop test exercises the flag-ON read path.
  setWorkspaceFlagOverride('strategy-the-issue', workspaceId, true);
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
  cleanupWorkspace?.();
});

const now = () => new Date().toISOString();

// Seed a rec satisfying the full recommendationSchema (loadRecommendations validates each item via
// parseJsonSafeArray and silently DROPS a failing item — leaving an empty set + a misleading 404).
function seedRec(recId: string, overrides: Partial<Recommendation> = {}): void {
  const ts = now();
  const rec: Recommendation = {
    id: recId,
    workspaceId,
    priority: 'fix_now',
    type: 'content',
    title: `Rec ${recId}`,
    description: 'desc',
    insight: 'why this matters to the client',
    impact: 'high',
    effort: 'low',
    impactScore: 60,
    source: 'audit:content',
    affectedPages: ['/blog/example'],
    trafficAtRisk: 10,
    impressionsAtRisk: 500,
    estimatedGain: 'Could capture meaningful organic demand',
    actionType: 'manual',
    targetKeyword: `keyword-${recId}`,
    status: 'pending',
    clientStatus: 'curated',
    lifecycle: 'active',
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
  // Preserve any other recs already in the set (one set per workspace).
  const existing = loadRecommendations(workspaceId);
  const prior: Recommendation[] = existing
    ? existing.recommendations.filter((r) => r.id !== recId)
    : [];
  const recs = [...prior, rec];
  const set: RecommendationSet = {
    workspaceId,
    generatedAt: ts,
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  };
  saveRecommendations(set);
}

describe('operator /send mirrors a rec→deliverable (half-loop #1)', () => {
  it('per-row /send mints a client_deliverable type=recommendation status=awaiting_client', async () => {
    seedRec('rec_send_row');
    const before = listDeliverables(workspaceId).filter((d) => d.type === 'recommendation').length;

    const res = await patchJson(`/api/recommendations/${workspaceId}/rec_send_row/send`, {});
    expect(res.status).toBe(200);

    const recDeliverables = listDeliverables(workspaceId).filter((d) => d.type === 'recommendation');
    expect(recDeliverables.length).toBe(before + 1);
    const minted = recDeliverables.find((d) => d.sourceRef === 'recommendation:rec_send_row');
    expect(minted).toBeDefined();
    expect(minted!.status).toBe('awaiting_client');
    expect(minted!.kind).toBe('decision');
    // The §7 stamps: rec id + targetKeyword + strategyCardContext ride in payload.
    expect(minted!.payload.recommendationId).toBe('rec_send_row');
    expect(minted!.payload.targetKeyword).toBe('keyword-rec_send_row');
    expect(minted!.payload.strategyCardContext).toBeDefined();
    // No $/ROI leak in the client-facing payload.
    expect(JSON.stringify(minted!.payload)).not.toContain('emvPerWeek');
  });

  it('bulk /send mints a deliverable for each sent rec', async () => {
    seedRec('rec_bulk_1', { clientStatus: 'curated' });
    seedRec('rec_bulk_2', { clientStatus: 'curated' });

    const res = await postJson(`/api/recommendations/${workspaceId}/bulk`, {
      recIds: ['rec_bulk_1', 'rec_bulk_2'],
      action: 'send',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { modified: number };
    expect(body.modified).toBe(2);

    const refs = listDeliverables(workspaceId)
      .filter((d) => d.type === 'recommendation')
      .map((d) => d.sourceRef);
    expect(refs).toContain('recommendation:rec_bulk_1');
    expect(refs).toContain('recommendation:rec_bulk_2');
  });

  it('re-sending the same rec dedupes onto one deliverable (stable sourceRef)', async () => {
    seedRec('rec_dedupe', { clientStatus: 'curated' });
    await patchJson(`/api/recommendations/${workspaceId}/rec_dedupe/send`, {});
    // Reset clientStatus to curated so a second /send is a legal edge, then re-send.
    seedRec('rec_dedupe', { clientStatus: 'curated' });
    await patchJson(`/api/recommendations/${workspaceId}/rec_dedupe/send`, {});

    const minted = listDeliverables(workspaceId).filter(
      (d) => d.sourceRef === 'recommendation:rec_dedupe',
    );
    expect(minted.length).toBe(1);
  });
});

describe('client act-on → durable content request (half-loop #2)', () => {
  it('sets clientStatus=approved + creates a content request w/ recommendationId + strategyCardContext, briefId null, NOTHING generated', async () => {
    seedRec('rec_acton', { clientStatus: 'sent', sentAt: now() });

    const res = await postJson(`/api/public/recommendations/${workspaceId}/rec_acton/act-on`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recommendation: { clientStatus?: string };
      requestId: string;
    };
    expect(body.recommendation.clientStatus).toBe('approved');
    expect(typeof body.requestId).toBe('string');

    const reqs = listContentRequests(workspaceId).filter((r) => r.recommendationId === 'rec_acton');
    expect(reqs.length).toBe(1);
    const created = reqs[0];
    expect(created.recommendationId).toBe('rec_acton');
    expect(created.strategyCardContext).toBeDefined();
    expect(created.strategyCardContext?.rationale).toBe('why this matters to the client');
    expect(created.targetKeyword).toBe('keyword-rec_acton');
    expect(created.status).toBe('requested'); // queued — NOTHING generated
    expect(created.briefId).toBeUndefined(); // no brief created on act-on
    expect(created.source).toBe('client');
  });

  it('the act-on content request appears in BOTH the client and admin lists', async () => {
    seedRec('rec_acton_lists', { clientStatus: 'sent', sentAt: now() });
    const actRes = await postJson(
      `/api/public/recommendations/${workspaceId}/rec_acton_lists/act-on`,
      {},
    );
    const { requestId } = (await actRes.json()) as { requestId: string };

    // Admin list (full ContentTopicRequest, carries recommendationId).
    const adminRes = await api(`/api/content-requests/${workspaceId}`);
    expect(adminRes.status).toBe(200);
    const adminList = (await adminRes.json()) as Array<{ id: string; recommendationId?: string }>;
    const adminRow = adminList.find((r) => r.id === requestId);
    expect(adminRow).toBeDefined();
    expect(adminRow!.recommendationId).toBe('rec_acton_lists');

    // Public/client list (client view — surfaces the request).
    const clientRes = await api(`/api/public/content-requests/${workspaceId}`);
    expect(clientRes.status).toBe(200);
    const clientList = (await clientRes.json()) as Array<{ id: string }>;
    expect(clientList.some((r) => r.id === requestId)).toBe(true);
  });

  it('rejects act-on on a rec that was never sent (illegal client transition)', async () => {
    seedRec('rec_never_sent', { clientStatus: 'curated' });
    const res = await postJson(
      `/api/public/recommendations/${workspaceId}/rec_never_sent/act-on`,
      {},
    );
    expect(res.status).toBe(400);
  });

  it('404s act-on on an unknown rec', async () => {
    const res = await postJson(`/api/public/recommendations/${workspaceId}/nope/act-on`, {});
    expect(res.status).toBe(404);
  });
});

describe('/apply on a rec-derived deliverable returns 400 (respond-only)', () => {
  it('a recommendation deliverable has no legacyBatchId → 400', async () => {
    seedRec('rec_apply', { clientStatus: 'curated' });
    await patchJson(`/api/recommendations/${workspaceId}/rec_apply/send`, {});
    const minted = listDeliverables(workspaceId).find(
      (d) => d.sourceRef === 'recommendation:rec_apply',
    );
    expect(minted).toBeDefined();

    const res = await postJson(
      `/api/public/deliverables/${workspaceId}/${minted!.id}/apply`,
      {},
    );
    expect(res.status).toBe(400);
  });
});

describe('public GET ?clientStatus=sent — client-safe projection', () => {
  it('returns only sent recs and never leaks admin-axis fields', async () => {
    seedRec('rec_sent_filter', {
      clientStatus: 'sent',
      sentAt: now(),
      struckAt: undefined,
      lifecycle: 'active',
      sendChannel: 'rec',
    });
    seedRec('rec_curated_hidden', { clientStatus: 'curated' });

    const res = await api(`/api/public/recommendations/${workspaceId}?clientStatus=sent`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    // Admin-axis fields must NEVER appear.
    expect(raw).not.toContain('struckAt');
    expect(raw).not.toContain('sentAt');
    expect(raw).not.toContain('cascade');
    expect(raw).not.toContain('sendChannel');
    expect(raw).not.toContain('lifecycle');
    expect(raw).not.toContain('emvPerWeek');

    const body = JSON.parse(raw) as { recommendations: Array<{ id: string; clientStatus?: string; delivered?: boolean }> };
    const ids = body.recommendations.map((r) => r.id);
    expect(ids).toContain('rec_sent_filter');
    expect(ids).not.toContain('rec_curated_hidden'); // curated is operator-axis, not sent
    const sentRec = body.recommendations.find((r) => r.id === 'rec_sent_filter');
    // The restricted client-facing clientStatus + synthetic delivered ARE projected.
    expect(sentRec!.clientStatus).toBe('sent');
    expect(sentRec!.delivered).toBe(false);
  });

  it('an unfiltered read of a curated rec exposes NO clientStatus (byte-identical absence)', async () => {
    seedRec('rec_curated_only', { clientStatus: 'curated' });
    const res = await api(`/api/public/recommendations/${workspaceId}?clientStatus=curated`);
    const raw = await res.text();
    // 'curated' is an operator-axis value — never projected to the client.
    const body = JSON.parse(raw) as { recommendations: Array<{ id: string; clientStatus?: string }> };
    const found = body.recommendations.find((r) => r.id === 'rec_curated_only');
    expect(found).toBeDefined();
    expect(found!.clientStatus).toBeUndefined();
  });
});

describe('greenlight + silent-fix attribution (TrackedAction)', () => {
  it('act-on creates exactly one TrackedAction keyed to the rec id (idempotent)', async () => {
    seedRec('rec_attr', { clientStatus: 'sent', sentAt: now() });
    await postJson(`/api/public/recommendations/${workspaceId}/rec_attr/act-on`, {});

    const action = getActionByWorkspaceAndSource(workspaceId, 'recommendation', 'rec_attr');
    expect(action).not.toBeNull();
    expect(action!.attribution).toBe('platform_executed');
    expect(action!.targetKeyword).toBe('keyword-rec_attr');

    // A second act-on attempt (rec is already approved → 400) must not create a second action.
    await postJson(`/api/public/recommendations/${workspaceId}/rec_attr/act-on`, {});
    const all = db
      .prepare(
        "SELECT COUNT(*) AS c FROM tracked_actions WHERE workspace_id = ? AND source_type = 'recommendation' AND source_id = ?",
      )
      .get(workspaceId, 'rec_attr') as { c: number };
    expect(all.c).toBe(1);
  });

  it('silent /fix also creates a TrackedAction (platform_executed)', async () => {
    seedRec('rec_fix_attr', { clientStatus: 'system' });
    const res = await patchJson(`/api/recommendations/${workspaceId}/rec_fix_attr/fix`, {});
    expect(res.status).toBe(200);

    const action = getActionByWorkspaceAndSource(workspaceId, 'recommendation', 'rec_fix_attr');
    expect(action).not.toBeNull();
    expect(action!.attribution).toBe('platform_executed');
  });
});
