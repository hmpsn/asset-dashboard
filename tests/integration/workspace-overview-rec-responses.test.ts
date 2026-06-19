/**
 * Integration test for the admin workspace-overview recResponses block (Strategy v3 P3, S.11/S.12).
 *
 * Uses the in-process server pattern (http.createServer(createApp()) on port 0, APP_PASSWORD
 * unset so admin routes pass the HMAC gate) — the same pattern as admin-recommendations-surface.
 * createEphemeralTestContext is not needed for a single in-process admin GET.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations } from '../../server/recommendations.js';
import db from '../../server/db/index.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';

const mk = (id: string, clientStatus: Recommendation['clientStatus'], at: string): Recommendation => ({
  id, workspaceId: wsId, type: 'content_refresh', title: id, description: 'd', insight: 'i',
  impact: 'low', effort: 'low', impactScore: 10, priority: 'fix_later', actionType: 'manual',
  trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: '', affectedPages: [], source: 't',
  clientStatus, status: 'pending', createdAt: at, updatedAt: at,
} as unknown as Recommendation);

beforeAll(async () => {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  server = http.createServer(createApp());
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  const ws = createWorkspace('Overview RecResponses WS');
  wsId = ws.id;
  const at = new Date().toISOString();
  saveRecommendations({
    workspaceId: wsId, generatedAt: at,
    recommendations: [mk('a', 'approved', at), mk('b', 'discussing', at)],
    summary: {
      fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0,
      totalOpportunityValue: 0, actionableOpportunityValue: 0, topRecommendationId: null,
    },
  });
}, 60_000);

afterAll(async () => {
  db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
  deleteWorkspace(wsId);
  if (server) await new Promise<void>((resolve, reject) => server!.close(err => (err ? reject(err) : resolve())));
});

describe('GET /api/workspace-overview — recResponses', () => {
  it('includes recResponses counts on the workspace row', async () => {
    const res = await fetch(`${baseUrl}/api/workspace-overview`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string; recResponses?: { approved: number; declined: number; discussing: number } }>;
    const row = body.find(w => w.id === wsId);
    expect(row?.recResponses).toMatchObject({ approved: 1, declined: 0, discussing: 1 });
  });
});
