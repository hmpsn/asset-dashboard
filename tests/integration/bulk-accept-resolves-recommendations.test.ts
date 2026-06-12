/**
 * Integration test for FIX C — the bulk-accept-fixes background job
 * (server/webflow-seo-bulk-accept-fixes-job.ts) resolves the AUDIT
 * recommendations covering the pages it fixed, in-process via the real job
 * wiring (not a replica).
 *
 * The job applies AUDIT fixes, so after applied>0 it must call
 * resolveRecommendationsForChange({ affectedPages, source: 'audit' }) using the
 * slug it already holds (fix.publishedPath || fix.pageSlug — NOT getPageState,
 * which this job never populates with a slug). The source:'audit' filter means a
 * keyword/decay rec on the SAME page must be left untouched.
 *
 * Runs the real exported runSeoBulkAcceptFixesJob() in-process so the webflow
 * mock applies (createEphemeralTestContext spawns a SEPARATE server process where module
 * mocks would not take effect). updatePageSeo is mocked to succeed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../server/webflow.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...original,
    updatePageSeo: vi.fn().mockResolvedValue({ success: true }),
  };
});

import { setBroadcast } from '../../server/broadcast.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { createJob } from '../../server/jobs.js';
import { runSeoBulkAcceptFixesJob } from '../../server/webflow-seo-bulk-accept-fixes-job.js';
import { saveRecommendations, loadRecommendations } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';
import type { SeoBulkAcceptFix } from '../../server/schemas/seo-bulk-jobs.js';

beforeAll(() => {
  // No Express server in this process — install a no-op broadcast so the job's
  // broadcasts + resolveRecommendationsForChange() don't throw.
  setBroadcast(() => {}, () => {});
});

let ws: SeededFullWorkspace;

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

async function runJob(wsId: string, fixes: SeoBulkAcceptFix[]): Promise<void> {
  const job = createJob('seo-bulk-accept-fixes', { workspaceId: wsId, total: fixes.length });
  const controller = new AbortController();
  await runSeoBulkAcceptFixesJob({
    jobId: job.id,
    workspaceId: wsId,
    fixes,
    token: 'test-token',
    signal: controller.signal,
  });
}

beforeEach(() => {
  ws = seedWorkspace();
});

afterEach(() => {
  ws.cleanup();
});

describe('bulk-accept-fixes resolves AUDIT recommendations for the fixed pages', () => {
  it('resolves the audit rec on the fixed page but leaves a keyword rec on the same page untouched', async () => {
    // Two recs on the SAME slug — one audit, one keyword. Only the audit rec must
    // resolve, proving the source:'audit' filter is honored.
    seedRecs(ws.workspaceId, [
      makeRec(ws.workspaceId, { id: 'rec_audit', source: 'audit:title', affectedPages: ['services'], status: 'pending' }),
      makeRec(ws.workspaceId, { id: 'rec_keyword', source: 'keyword:gap', affectedPages: ['services'], status: 'pending' }),
      makeRec(ws.workspaceId, { id: 'rec_other', source: 'audit:title', affectedPages: ['about'], status: 'pending' }),
    ]);

    await runJob(ws.workspaceId, [
      {
        pageId: 'wf-native-id-services-001', // NOT the slug — slug comes from publishedPath
        check: 'title',
        suggestedFix: 'A Much Better Services Title',
        publishedPath: '/services',
        pageSlug: 'services',
        pageName: 'Services',
      },
    ]);

    const stored = loadRecommendations(ws.workspaceId)!;
    // Audit rec on the fixed page → resolved.
    expect(stored.recommendations.find(r => r.id === 'rec_audit')!.status).toBe('completed');
    // Keyword rec on the SAME page → untouched (source:'audit' filter).
    expect(stored.recommendations.find(r => r.id === 'rec_keyword')!.status).toBe('pending');
    // Audit rec on a DIFFERENT page → untouched.
    expect(stored.recommendations.find(r => r.id === 'rec_other')!.status).toBe('pending');
  });

  it('does not throw and resolves nothing when no audit rec matches the fixed page', async () => {
    seedRecs(ws.workspaceId, [
      makeRec(ws.workspaceId, { id: 'rec_keep', source: 'audit:title', affectedPages: ['contact'], status: 'pending' }),
    ]);

    await expect(runJob(ws.workspaceId, [
      { pageId: 'wf-native-id-services-002', check: 'title', suggestedFix: 'New Title', publishedPath: '/services', pageSlug: 'services', pageName: 'Services' },
    ])).resolves.not.toThrow();

    const stored = loadRecommendations(ws.workspaceId)!;
    expect(stored.recommendations.find(r => r.id === 'rec_keep')!.status).toBe('pending');
  });
});
