/**
 * SEO Decision Engine P2 — effort-priors threading.
 *
 * Proves that generateRecommendations() threads the workspace's MEASURED median
 * time-to-implement (getEffortPriorDays) into the OV scorer's effortDays, instead
 * of the hardcoded per-branch DEFAULT_EFFORT_DAYS, for the matching action type.
 *
 * Harness: the diagnostic-store mock (mirrors recommendations-diagnostic.test.ts)
 * injects ONE completed diagnostic P1 action → generateRecommendations emits a
 * `technical` rec (source `diagnostic:…`), whose action type is `audit_fix_applied`
 * (recommendationOutcomeActionType('technical', …)). Branch is `diagnostic`
 * (DEFAULT_EFFORT_DAYS = 2). Seeding a measured 12-day audit_fix_applied prior must
 * raise effortDays 2 → 12, which LOWERS roiPerEffortDay (numerator / effortDays).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  broadcast: vi.fn(),
  setBroadcast: vi.fn(),
}));

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: (_wsId: string, _type?: string) => [],
}));

vi.mock('../../server/diagnostic-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/diagnostic-store.js')>();
  return {
    ...actual,
    listDiagnosticReports: () => [{
      id: 'report_effort_prior',
      workspaceId: 'ws_test',
      insightId: null,
      anomalyType: 'traffic_drop',
      affectedPages: ['/services/plumbing'],
      status: 'completed',
      diagnosticContext: {} as import('../../shared/types/diagnostics.js').DiagnosticContext,
      rootCauses: [],
      remediationActions: [
        {
          priority: 'P1' as const,
          title: 'Fix broken internal links',
          description: 'Three pages have broken internal links reducing crawl efficiency.',
          effort: 'low' as const,
          impact: 'high' as const,
          owner: 'dev' as const,
          pageUrls: ['/services/plumbing'],
        },
      ],
      adminReport: '',
      clientSummary: '',
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }],
  };
});

import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { generateRecommendations, saveRecommendations } from '../../server/recommendations.js';
import { recordAction } from '../../server/outcome-tracking.js';
import { runEmvCalibration, getEffortPriorDays, MIN_EFFORT_SAMPLES } from '../../server/outcome-emv-calibration.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

let wsId = '';
let cleanup: () => void = () => {};

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Save a set of completed recs whose createdAt anchors the effort measurement. */
function seedCompletedRecs(recs: Array<{ id: string; createdAtDaysAgo: number }>): void {
  const now = new Date().toISOString();
  const recommendations: Recommendation[] = recs.map(r => ({
    id: r.id, // tracked_actions.source_id joins to this rec id (effort start = createdAt)
    workspaceId: wsId,
    priority: 'fix_soon',
    type: 'technical',
    title: `seed ${r.id}`,
    description: '',
    insight: '',
    impact: 'medium',
    effort: 'medium',
    impactScore: 50,
    source: `audit:${r.id}`,
    affectedPages: [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: 'gain',
    actionType: 'manual',
    status: 'completed',
    assignedTo: 'client',
    createdAt: daysAgoIso(r.createdAtDaysAgo),
    updatedAt: now,
  }));
  const set: RecommendationSet = {
    workspaceId: wsId,
    generatedAt: now,
    recommendations,
    summary: { fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0, topRecommendationId: null },
  };
  saveRecommendations(set);
}

function diagRoi(set: RecommendationSet): number {
  const diag = set.recommendations.find(r => r.source?.startsWith('diagnostic:'));
  expect(diag, 'diagnostic rec must be generated').toBeDefined();
  expect(diag?.opportunity, 'diagnostic rec must carry an OV score').toBeDefined();
  return diag!.opportunity!.roiPerEffortDay;
}

describe('generateRecommendations — effort priors threading (P2)', () => {
  beforeAll(() => {
    const s = seedWorkspace({});
    wsId = s.workspaceId;
    cleanup = s.cleanup;
  });

  afterAll(() => cleanup());

  it('a measured effort prior overrides the per-branch DEFAULT_EFFORT_DAYS in the OV score', async () => {
    expect(MIN_EFFORT_SAMPLES).toBeLessThanOrEqual(3); // we seed 3 samples

    // Run 1 — no prior: the diagnostic rec uses DEFAULT_EFFORT_DAYS.diagnostic (2).
    const before = await generateRecommendations(wsId);
    const roiDefault = diagRoi(before);
    expect(roiDefault, 'diagnostic rec should carry non-zero ROI').toBeGreaterThan(0);

    // Seed a MEASURED 12-day audit_fix_applied prior: 3 completed live recs created
    // 12 days ago, each with a platform_executed action recorded ~now (effort ≈ 12d).
    seedCompletedRecs([
      { id: 'ep1', createdAtDaysAgo: 12 },
      { id: 'ep2', createdAtDaysAgo: 12 },
      { id: 'ep3', createdAtDaysAgo: 12 },
    ]);
    for (const id of ['ep1', 'ep2', 'ep3']) {
      recordAction({ // recordAction-ok: wsId created in beforeAll
        workspaceId: wsId,
        actionType: 'audit_fix_applied',
        sourceType: 'recommendation',
        sourceId: id,
        pageUrl: null,
        targetKeyword: null,
        baselineSnapshot: { captured_at: new Date().toISOString() },
        sourceFlag: 'live',
        baselineConfidence: 'exact',
        attribution: 'platform_executed',
        predictedEmv: null,
      });
    }
    runEmvCalibration(wsId);

    const priors = getEffortPriorDays(wsId);
    expect(priors.audit_fix_applied, 'measured prior must be populated').toBeGreaterThan(11);
    expect(priors.audit_fix_applied!).toBeLessThan(13);

    // Run 2 — with the 12-day prior: effortDays 2 → 12, so roiPerEffortDay drops.
    const after = await generateRecommendations(wsId);
    const roiWithPrior = diagRoi(after);

    expect(roiWithPrior).toBeLessThan(roiDefault);
  });
});
