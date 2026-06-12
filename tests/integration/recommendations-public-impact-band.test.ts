/**
 * CONTRACT: the PUBLIC recommendations route projects the admin/AI-only
 * `emvPerWeek` into a client-safe banded monthly impact (`impactBand`) and
 * NEVER leaks the raw weekly EMV. Pins floor / band / cap behavior at the actual
 * client read path (the companion of recommendations-public-emv-leak.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet, OpportunityScore } from '../../shared/types/recommendations.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

let testWsId = '';

function makeOpportunity(emvPerWeek: number): OpportunityScore {
  return {
    value: 60,
    emvPerWeek,
    predictedEmv: Math.round(emvPerWeek * 12),
    roiPerEffortDay: 50,
    confidence: 0.9,
    calibration: 1.0,
    groundedSpine: 'roiScore',
    components: [],
    calibrationVersion: 'platform-default',
    modelVersion: 'ov-1',
  };
}

function makeRec(id: string, emvPerWeek: number): Recommendation {
  const now = new Date().toISOString();
  return {
    id,
    workspaceId: testWsId,
    priority: 'fix_now',
    type: 'metadata',
    title: 'Impact band rec',
    description: 'Fix meta.',
    insight: 'CTR risk.',
    impact: 'high',
    effort: 'low',
    impactScore: 60,
    opportunity: makeOpportunity(emvPerWeek),
    source: 'audit:meta-description',
    affectedPages: ['home'],
    trafficAtRisk: 100,
    impressionsAtRisk: 2000,
    estimatedGain: 'Drives meaningful organic growth',
    actionType: 'manual',
    status: 'pending',
    assignedTo: 'client',
    createdAt: now,
    updatedAt: now,
  };
}

function seed(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: testWsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: {
      fixNow: recs.length, fixSoon: 0, fixLater: 0, ongoing: 0,
      totalImpactScore: 60, trafficAtRisk: 100,
      topRecommendationId: recs[0]?.id ?? null,
    },
  };
  saveRecommendations(set);
}

beforeAll(async () => {
  await ctx.startServer();
  testWsId = createWorkspace('Impact Band Test Workspace').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

async function getRec(id: string): Promise<Recommendation> {
  const res = await api(`/api/public/recommendations/${testWsId}`);
  expect(res.status).toBe(200);
  const body = await res.json() as RecommendationSet;
  const rec = body.recommendations.find(r => r.id === id);
  expect(rec, `rec ${id} missing`).toBeDefined();
  return rec!;
}

describe('Public recommendations — impactBand projection', () => {
  it('emits a banded monthly range and strips raw emvPerWeek', async () => {
    seed([makeRec('rec_band_mid', 100)]); // mid ≈ $433/mo → medium
    const rec = await getRec('rec_band_mid');
    expect(rec.impactBand).toBeDefined();
    expect(rec.impactBand!.band).toBe('medium');
    const [low, high] = rec.impactBand!.monthlyRangeUsd!;
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(high);
    // raw emv must be gone from the opportunity
    expect('emvPerWeek' in (rec.opportunity as object)).toBe(false);
  });

  it('below the display floor → no impactBand at all', async () => {
    seed([makeRec('rec_band_floor', 4)]); // mid ≈ $17/mo < $25 floor
    const rec = await getRec('rec_band_floor');
    expect(rec.impactBand).toBeUndefined();
  });

  it('huge emv → high band, capped at $2,000', async () => {
    seed([makeRec('rec_band_cap', 50_000)]);
    const rec = await getRec('rec_band_cap');
    expect(rec.impactBand!.band).toBe('high');
    const [, high] = rec.impactBand!.monthlyRangeUsd!;
    expect(high).toBe(2000);
  });

  it('raw response JSON never contains "emvPerWeek"', async () => {
    seed([makeRec('rec_band_raw', 100)]);
    const res = await api(`/api/public/recommendations/${testWsId}`);
    const raw = await res.text();
    expect(raw).not.toContain('emvPerWeek');
  });
});
