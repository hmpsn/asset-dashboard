/**
 * PR3 (Spine A) — client-leak gate.
 *
 * The Opportunity Value `emvPerWeek` (expected value/week) is admin/AI-only per
 * owner decision — the client sees the ROI badge + breakdown bars, never the raw
 * $/wk exposure. This test pins that the PUBLIC recommendations route strips
 * `emvPerWeek` from each rec's opportunity while preserving the rest of the
 * OpportunityScore (value, components, confidence, …).
 *
 * Seeds a rec WITH a full opportunity (emvPerWeek set) directly into the DB and
 * exercises the public GET endpoint — the actual client read path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet, OpportunityScore } from '../../shared/types/recommendations.js';

const ctx = createTestContext(13873); // port-ok: next free port above 13872
const { api } = ctx;

let testWsId = '';

function makeOpportunity(): OpportunityScore {
  return {
    value: 72,
    emvPerWeek: 1234.56, // the admin/AI-only field that must NOT leak to the public route
    roiPerEffortDay: 88.2,
    confidence: 0.95,
    calibration: 1.0,
    groundedSpine: 'roiScore',
    components: [
      { dimension: 'demand', rawValue: 2400, normalized: 0.48, weight: 0.22, contribution: 0.106, evidence: '2,400 monthly searches' },
    ],
    calibrationVersion: 'platform-default',
    modelVersion: 'ov-1',
  };
}

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: `rec_emv_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: testWsId,
    priority: 'fix_now',
    type: 'metadata',
    title: 'Test recommendation',
    description: 'Fix the meta description on the homepage.',
    insight: 'The homepage is missing a meta description which hurts CTR.',
    impact: 'high',
    effort: 'low',
    impactScore: 72,
    opportunity: makeOpportunity(),
    source: 'audit:meta-description',
    affectedPages: ['home'],
    trafficAtRisk: 200,
    impressionsAtRisk: 5000,
    estimatedGain: 'Fixing this could increase organic clicks by 5-15% on 1 affected page',
    actionType: 'manual',
    status: 'pending',
    assignedTo: 'client',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seed(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: testWsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: {
      fixNow: recs.length, fixSoon: 0, fixLater: 0, ongoing: 0,
      totalImpactScore: recs.reduce((s, r) => s + r.impactScore, 0),
      trafficAtRisk: recs.reduce((s, r) => s + r.trafficAtRisk, 0),
      estimatedRecoverableClicks: 24,
      estimatedRecoverableImpressions: 600,
      topRecommendationId: recs[0]?.id ?? null,
    },
  };
  saveRecommendations(set);
}

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Rec EMV Leak Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

describe('Public recommendations route — emvPerWeek leak gate', () => {
  it('strips emvPerWeek from each rec opportunity but preserves the rest of the score', async () => {
    seed([makeRec({ id: 'rec_emv_leak_001' })]);

    const res = await api(`/api/public/recommendations/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as RecommendationSet;

    const found = body.recommendations.find(r => r.id === 'rec_emv_leak_001');
    expect(found).toBeDefined();
    expect(found!.opportunity).toBeTruthy();
    // The leaky field must be absent.
    expect('emvPerWeek' in (found!.opportunity as object)).toBe(false);
    expect((found!.opportunity as Record<string, unknown>).emvPerWeek).toBeUndefined();
    // The rest of the score must survive.
    expect(found!.opportunity!.value).toBe(72);
    expect(found!.opportunity!.modelVersion).toBe('ov-1');
    expect(found!.opportunity!.components.length).toBeGreaterThan(0);
  });

  it('raw response JSON never contains the string "emvPerWeek"', async () => {
    seed([makeRec({ id: 'rec_emv_leak_002' })]);

    const res = await api(`/api/public/recommendations/${testWsId}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('emvPerWeek');
  });
});
