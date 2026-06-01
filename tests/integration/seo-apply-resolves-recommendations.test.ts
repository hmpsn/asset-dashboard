/**
 * Integration test for Task 4.4 — the three deferred bulk SEO-write paths
 * (seo-pattern-apply, seo-suggestions apply, CMS-item publish) resolve the
 * recommendations covering the pages they touch, in-process via the real route
 * wiring (not a replica).
 *
 * Each path's applied identifiers are Webflow page/CMS-item IDs (the
 * page_edit_states key), but recommendation.affectedPages are SLUGS — the route
 * must resolve each id to its slug via getPageState() before calling
 * resolveRecommendationsForChange(). The test seeds page IDs that DIFFER from
 * the rec slugs and registers the id→slug mapping (mirroring the Phase-1
 * work-order test), so it FAILS against code that passes raw page IDs to the
 * slug matcher or never resolves at all.
 *
 * The Webflow API (updatePageSeo / publishCollectionItems) is mocked so no live
 * call is made.
 */
import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const webflowState = vi.hoisted(() => ({
  result: { success: true } as { success: boolean; error?: string },
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/webflow.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    updatePageSeo: vi.fn(async () => webflowState.result),
    updateCollectionItem: vi.fn(async () => ({ success: true })),
    publishCollectionItems: vi.fn(async () => ({ success: true })),
  };
});

import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { updatePageState } from '../../server/page-edit-states.js';
import { saveRecommendations, loadRecommendations } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';
import { saveSuggestion, selectVariation } from '../../server/seo-suggestions.js';

let server: http.Server | null = null;
let baseUrl = '';

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  process.env.WEBFLOW_API_TOKEN = 'test-token-seo-apply-resolve';
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeRec(wsId: string, overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: `rec_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: wsId,
    priority: 'fix_now',
    type: 'metadata',
    title: 'Fix it',
    description: 'desc',
    insight: 'why',
    impact: 'high',
    effort: 'low',
    impactScore: 70,
    source: 'audit:title',
    affectedPages: ['services'],
    trafficAtRisk: 100,
    impressionsAtRisk: 1000,
    estimatedGain: 'gain',
    actionType: 'manual',
    status: 'pending',
    assignedTo: 'team',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedRecs(wsId: string, recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: {
      fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0,
      totalImpactScore: 0, trafficAtRisk: 0,
      estimatedRecoverableClicks: 0, estimatedRecoverableImpressions: 0,
    },
  };
  saveRecommendations(set);
}

let ws: SeededFullWorkspace;

beforeAll(async () => {
  await startTestServer();
}, 25_000);

afterAll(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
});

beforeEach(() => {
  ws = seedWorkspace();
  webflowState.result = { success: true };
});

afterEach(() => {
  ws.cleanup();
});

describe('bulk SEO-write paths resolve matching recommendations', () => {
  it('seo-pattern-apply resolves recs by mapping the Webflow page ID to its slug', async () => {
    // Page ID is deliberately NOT the slug — a Webflow-style native id mapped to
    // its slug via page_edit_states.
    const PAGE_ID = 'wf-6471abc-services-aaa';
    updatePageState(ws.workspaceId, PAGE_ID, { slug: 'services', status: 'in-review' });

    seedRecs(ws.workspaceId, [
      makeRec(ws.workspaceId, { id: 'rec_hit', affectedPages: ['services'], status: 'pending' }),
      makeRec(ws.workspaceId, { id: 'rec_miss', affectedPages: ['about'], status: 'pending' }),
    ]);

    const res = await postJson(`/api/webflow/seo-pattern-apply/${ws.webflowSiteId}`, {
      workspaceId: ws.workspaceId,
      field: 'title',
      action: 'replace',
      text: 'Brand New Title',
      pages: [{ pageId: PAGE_ID, title: 'Services', slug: 'services', currentValue: 'Old' }],
    });
    expect(res.status).toBe(200);

    const stored = loadRecommendations(ws.workspaceId)!;
    expect(stored.recommendations.find(r => r.id === 'rec_hit')!.status).toBe('completed');
    expect(stored.recommendations.find(r => r.id === 'rec_miss')!.status).toBe('pending');
    // Summary recomputed so headline counts don't stay inflated.
    expect(stored.summary.fixNow).toBe(1); // only rec_miss remains active
  });

  it('seo-pattern-apply does not throw and resolves nothing when the page ID has no slug mapping', async () => {
    seedRecs(ws.workspaceId, [
      makeRec(ws.workspaceId, { id: 'rec_keep', affectedPages: ['services'], status: 'pending' }),
    ]);

    const res = await postJson(`/api/webflow/seo-pattern-apply/${ws.webflowSiteId}`, {
      workspaceId: ws.workspaceId,
      field: 'title',
      action: 'replace',
      text: 'X',
      pages: [{ pageId: 'wf-unmapped-999', title: 'Untracked', currentValue: 'Old' }],
    });
    expect(res.status).toBe(200);

    const stored = loadRecommendations(ws.workspaceId)!;
    expect(stored.recommendations.find(r => r.id === 'rec_keep')!.status).toBe('pending');
  });

  it('seo-suggestions apply resolves recs by mapping the suggestion pageId to its slug', async () => {
    const PAGE_ID = 'wf-6471abc-services-bbb';
    updatePageState(ws.workspaceId, PAGE_ID, { slug: 'services', status: 'in-review' });
    seedRecs(ws.workspaceId, [
      makeRec(ws.workspaceId, { id: 'rec_sugg', affectedPages: ['services'], status: 'pending' }),
    ]);

    // Seed a pending suggestion, then select a variation so the apply path
    // (getSelectedSuggestions → updatePageSeo) has something to apply.
    const suggestion = saveSuggestion({
      workspaceId: ws.workspaceId,
      siteId: ws.webflowSiteId,
      pageId: PAGE_ID,
      pageTitle: 'Services',
      pageSlug: 'services',
      field: 'title',
      currentValue: 'Old Services Title',
      variations: ['A Better Services Title', 'Alt 2', 'Alt 3'],
    });
    expect(selectVariation(ws.workspaceId, suggestion.id, 0)).toBe(true);

    const res = await postJson(`/api/webflow/seo-suggestions/${ws.workspaceId}/apply`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { applied: number };
    expect(body.applied).toBeGreaterThan(0);

    const stored = loadRecommendations(ws.workspaceId)!;
    expect(stored.recommendations.find(r => r.id === 'rec_sugg')!.status).toBe('completed');
  });

  it('CMS-item publish resolves recs by mapping the CMS item ID to its slug', async () => {
    const CMS_ITEM_ID = 'cms-blog-guide-xyz';
    const COLLECTION_ID = 'coll-blog-001';
    updatePageState(ws.workspaceId, CMS_ITEM_ID, { slug: 'blog/guide', status: 'fix-proposed' });
    seedRecs(ws.workspaceId, [
      makeRec(ws.workspaceId, { id: 'rec_cms', affectedPages: ['blog/guide'], status: 'pending' }),
    ]);

    const res = await postJson(`/api/webflow/collections/${COLLECTION_ID}/publish`, {
      workspaceId: ws.workspaceId,
      siteId: ws.webflowSiteId,
      itemIds: [CMS_ITEM_ID],
    });
    expect(res.status).toBe(200);

    const stored = loadRecommendations(ws.workspaceId)!;
    expect(stored.recommendations.find(r => r.id === 'rec_cms')!.status).toBe('completed');
  });
});
