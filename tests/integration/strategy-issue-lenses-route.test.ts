/**
 * Integration test for the admin issue-lenses route (The Issue, Phase 5 four-jobs lenses).
 *
 *   GET /api/workspaces/:workspaceId/issue-lenses → IssueLensesResponse
 *
 * The route is an ADMIN read-projection of the already-curated Issue rec set. These cases assert:
 *   - 200 + the projection shape ({ workspaceId, keywordTargets, contentWorkOrders });
 *   - the curated-set filter excludes a struck rec;
 *   - a content rec linked (by recommendationId) to an in_progress content_topic_request reports
 *     stage 'in_progress' (the request join through the live read path).
 *
 * In-process server pattern (http.createServer(createApp()) on port 0, APP_PASSWORD unset), mirror
 * of workspace-overview-issue-doorbell.test.ts. requireWorkspaceAccess passes through for HMAC
 * (no JWT user) when APP_PASSWORD is unset, so the unauthenticated fetch reaches the handler.
 */
import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations, computeRecommendationSummary } from '../../server/recommendations.js';
import db from '../../server/db/index.js';
import type { Recommendation, RecType } from '../../shared/types/recommendations.js';
import type { IssueLensesResponse } from '../../shared/types/strategy-issue-lenses.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';

function makeRec(overrides: Partial<Recommendation>): Recommendation {
  const now = new Date().toISOString();
  return {
    id: `rec_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: wsId,
    priority: 'fix_soon',
    type: 'keyword_gap' as RecType,
    title: 'Move',
    description: 'd',
    insight: 'i',
    impact: 'medium',
    effort: 'low',
    impactScore: 50,
    source: 'keyword_gap:kw',
    affectedPages: [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: 'g',
    actionType: 'manual',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedRecs(recs: Recommendation[]): void {
  saveRecommendations({
    workspaceId: wsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  });
}

function seedRequest(opts: {
  id: string;
  recommendationId: string;
  status: string;
  briefId?: string | null;
  postId?: string | null;
}): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO content_topic_requests
      (id, workspace_id, topic, target_keyword, intent, priority, rationale, status,
       brief_id, post_id, recommendation_id, comments, requested_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.id, wsId, 'Topic', 'kw', 'informational', 'medium', 'because', opts.status,
    opts.briefId ?? null, opts.postId ?? null, opts.recommendationId, '[]', now, now,
  );
}

async function fetchLenses(): Promise<{ status: number; body: IssueLensesResponse }> {
  const res = await fetch(`${baseUrl}/api/workspaces/${wsId}/issue-lenses`);
  const body = await res.json() as IssueLensesResponse;
  return { status: res.status, body };
}

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js'); // dynamic-import-ok
  server = http.createServer(createApp());
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  wsId = createWorkspace('Issue Lenses Route WS').id;
}, 60_000);

afterEach(() => {
  db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsId);
});

afterAll(async () => {
  deleteWorkspace(wsId);
  if (server) await new Promise<void>((resolve, reject) => server!.close(err => (err ? reject(err) : resolve())));
});

describe('GET /api/workspaces/:workspaceId/issue-lenses', () => {
  it('returns 200 + the projection shape { workspaceId, keywordTargets, contentWorkOrders }', async () => {
    seedRecs([
      makeRec({ id: 'kg-1', type: 'keyword_gap', clientStatus: 'curated', source: 'keyword_gap:roof repair', targetKeyword: 'roof repair' }),
      makeRec({ id: 'wo-1', type: 'content', clientStatus: 'sent', source: 'strategy:content-gap', title: 'Write A', targetKeyword: 'a' }),
    ]);
    const { status, body } = await fetchLenses();
    expect(status).toBe(200);
    expect(body.workspaceId).toBe(wsId);
    expect(Array.isArray(body.keywordTargets)).toBe(true);
    expect(Array.isArray(body.contentWorkOrders)).toBe(true);
    expect(body.keywordTargets.map(r => r.recId)).toContain('kg-1');
    expect(body.contentWorkOrders.map(r => r.recId)).toContain('wo-1');
  });

  it('excludes a struck rec from the projection', async () => {
    seedRecs([
      makeRec({ id: 'kg-keep', type: 'keyword_gap', clientStatus: 'curated', source: 'keyword_gap:keep', targetKeyword: 'keep' }),
      makeRec({ id: 'kg-struck', type: 'keyword_gap', lifecycle: 'struck', source: 'keyword_gap:struck', targetKeyword: 'struck' }),
    ]);
    const { status, body } = await fetchLenses();
    expect(status).toBe(200);
    const ids = body.keywordTargets.map(r => r.recId);
    expect(ids).toContain('kg-keep');
    expect(ids).not.toContain('kg-struck');
  });

  it('excludes a declined rec from the projection (through HTTP)', async () => {
    seedRecs([
      makeRec({ id: 'kg-keep2', type: 'keyword_gap', clientStatus: 'curated', source: 'keyword_gap:keep2', targetKeyword: 'keep2' }),
      makeRec({ id: 'kg-declined', type: 'keyword_gap', clientStatus: 'declined', source: 'keyword_gap:declined', targetKeyword: 'declined' }),
    ]);
    const { status, body } = await fetchLenses();
    expect(status).toBe(200);
    const ids = body.keywordTargets.map(r => r.recId);
    expect(ids).toContain('kg-keep2');
    expect(ids).not.toContain('kg-declined');
  });

  it('a content rec linked to an in_progress request shows stage + serializes hasBrief/hasPost', async () => {
    seedRecs([
      makeRec({ id: 'wo-ip', type: 'content', clientStatus: 'curated', source: 'strategy:content-gap', title: 'In progress', targetKeyword: 'ip' }),
    ]);
    // brief_id set, post_id absent → exercises both serialized booleans through the HTTP read.
    seedRequest({ id: 'creq-ip', recommendationId: 'wo-ip', status: 'in_progress', briefId: 'brief-ip' });

    const { status, body } = await fetchLenses();
    expect(status).toBe(200);
    const row = body.contentWorkOrders.find(r => r.recId === 'wo-ip');
    expect(row).toBeDefined();
    expect(row!.requestId).toBe('creq-ip');
    expect(row!.stage).toBe('in_progress');
    expect(row!.hasBrief).toBe(true);
    expect(row!.hasPost).toBe(false);
  });
});
