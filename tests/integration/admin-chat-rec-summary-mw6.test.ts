/**
 * PR6 (Spine D) — MW6: admin recSummary surfaces impactScore + emvPerWeek + isTopRecommendation.
 *
 * The admin advisor prompt must reason about the same ranked #1 the client sees,
 * with grounded impactScore and the admin/AI-only emvPerWeek. This test seeds a
 * workspace + recommendations (one carrying a full opportunity) and asserts the
 * assembled admin context's "AI RECOMMENDATIONS" section JSON carries the MW6 fields.
 *
 * This is the ADMIN path — emvPerWeek is allowed here (owner decision).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations } from '../../server/recommendations.js';
import { assembleAdminContext } from '../../server/admin-chat-context.js';
import type { Recommendation, RecommendationSet, OpportunityScore } from '../../shared/types/recommendations.js';

let testWsId = '';

function makeOpportunity(): OpportunityScore {
  return {
    value: 82,
    emvPerWeek: 1450,
    predictedEmv: 17400,
    roiPerEffortDay: 33,
    confidence: 0.95,
    calibration: 1.0,
    groundedSpine: 'roiScore',
    components: [
      { dimension: 'demand', rawValue: 2400, normalized: 0.8, weight: 0.25, contribution: 0.2, evidence: '2,400 monthly searches' },
    ],
    calibrationVersion: 'platform-default',
    modelVersion: 'ov-1',
  };
}

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: `rec_mw6_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: testWsId,
    priority: 'fix_now',
    type: 'metadata',
    title: 'Fix homepage meta description',
    description: 'Add a meta description to the homepage.',
    insight: 'Missing meta hurts CTR.',
    impact: 'high',
    effort: 'low',
    impactScore: 82,
    source: 'audit:meta-description',
    affectedPages: ['home'],
    trafficAtRisk: 200,
    impressionsAtRisk: 5000,
    estimatedGain: '5-15%',
    actionType: 'manual',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seed(topRec: Recommendation, others: Recommendation[]): void {
  const recs = [topRec, ...others];
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
      topRecommendationId: topRec.id,
    },
  };
  saveRecommendations(set);
}

beforeAll(() => {
  const ws = createWorkspace('Admin Rec Summary MW6 Test');
  testWsId = ws.id;
});

afterAll(() => {
  deleteWorkspace(testWsId);
});

describe('admin-chat-context — MW6 recSummary fields', () => {
  it('includes impactScore, emvPerWeek, and isTopRecommendation in the AI RECOMMENDATIONS section', async () => {
    const top = makeRec({ id: 'rec_mw6_top', impactScore: 82, opportunity: makeOpportunity() });
    const second = makeRec({ id: 'rec_mw6_second', title: 'Add FAQ schema', impactScore: 40 });
    seed(top, [second]);

    const ctx = await assembleAdminContext(testWsId, 'What are the top SEO recommendations and audit fixes?');
    const recSection = ctx.sections.find(s => s.startsWith('AI RECOMMENDATIONS'));
    expect(recSection).toBeDefined();

    // The section is "AI RECOMMENDATIONS ...:\n<JSON>"
    const json = recSection!.slice(recSection!.indexOf('\n') + 1);
    const parsed = JSON.parse(json) as Array<{
      title: string; impactScore: number; emvPerWeek?: number; isTopRecommendation: boolean;
    }>;

    const topEntry = parsed.find(r => r.title === 'Fix homepage meta description');
    expect(topEntry).toBeDefined();
    expect(topEntry!.impactScore).toBe(82);
    expect(topEntry!.emvPerWeek).toBe(1450); // admin/AI-only — allowed on the admin path
    expect(topEntry!.isTopRecommendation).toBe(true);

    const secondEntry = parsed.find(r => r.title === 'Add FAQ schema');
    expect(secondEntry).toBeDefined();
    expect(secondEntry!.isTopRecommendation).toBe(false);
    // Second rec has no opportunity → emvPerWeek is undefined (omitted), not a leak.
    expect(secondEntry!.emvPerWeek).toBeUndefined();
  });
});
