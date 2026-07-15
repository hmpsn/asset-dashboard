import { afterEach, describe, expect, it } from 'vitest';

import {
  commitGeneratedRecommendationSet,
  loadRecommendationGenerationSnapshot,
  loadRecommendationSet,
  RecommendationGenerationRevisionConflictError,
  replaceRecommendationItems,
  saveRecommendationSet,
} from '../../server/domains/recommendations/storage.js';
import { updateRecommendationStatus } from '../../server/domains/recommendations/status-service.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';
import type { GenerationProvenance } from '../../shared/types/ai-execution.js';

const cleanup: string[] = [];
afterEach(() => {
  for (const workspaceId of cleanup.splice(0)) deleteWorkspace(workspaceId);
});

function recommendation(workspaceId: string, overrides: Partial<Recommendation> = {}): Recommendation {
  const now = '2026-07-13T00:00:00.000Z';
  return {
    id: 'rec-storage-revision', workspaceId, priority: 'fix_soon', type: 'metadata',
    title: 'Improve metadata', description: 'Description', insight: 'Insight', impact: 'medium',
    effort: 'low', impactScore: 50, source: 'audit:title', affectedPages: ['/'], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'More qualified traffic', actionType: 'manual', status: 'pending',
    createdAt: now, updatedAt: now, ...overrides,
  };
}

function recommendationSet(workspaceId: string, recs: Recommendation[]): RecommendationSet {
  return {
    workspaceId, generatedAt: '2026-07-13T00:00:00.000Z', recommendations: recs,
    summary: {
      fixNow: 0, fixSoon: recs.length, fixLater: 0, ongoing: 0,
      totalImpactScore: recs.reduce((sum, rec) => sum + rec.impactScore, 0),
      trafficAtRisk: 0, topRecommendationId: recs[0]?.id ?? null,
    },
  };
}

const provenance: GenerationProvenance = {
  runId: 'rec-run-1',
  operation: 'recommendation-generation',
  provider: 'deterministic',
  model: 'recommendation-engine-v1',
  inputFingerprint: 'effective-input-sha256',
  evidenceCapturedAt: '2026-07-13T00:00:00.000Z',
  startedAt: '2026-07-13T00:00:00.000Z',
  completedAt: '2026-07-13T00:00:01.000Z',
};

describe('recommendation generation revision storage', () => {
  it('increments exactly once for ordinary durable mutations', () => {
    const workspaceId = createWorkspace(`rec revision ${Date.now()}`).id;
    cleanup.push(workspaceId);
    saveRecommendationSet(recommendationSet(workspaceId, [recommendation(workspaceId)]));
    expect(loadRecommendationGenerationSnapshot(workspaceId).revision).toBe(1);

    updateRecommendationStatus(workspaceId, 'rec-storage-revision', 'in_progress');
    expect(loadRecommendationGenerationSnapshot(workspaceId).revision).toBe(2);

    const set = loadRecommendationSet(workspaceId)!;
    const replacement = [recommendation(workspaceId, { id: 'replacement-rec' })];
    replaceRecommendationItems(set, replacement, recommendationSet(workspaceId, replacement).summary);
    expect(loadRecommendationGenerationSnapshot(workspaceId).revision).toBe(3);
  });

  it('rejects a stale generated commit after a lifecycle mutation without replacing rows', () => {
    const workspaceId = createWorkspace(`rec stale ${Date.now()}`).id;
    cleanup.push(workspaceId);
    saveRecommendationSet(recommendationSet(workspaceId, [recommendation(workspaceId)]));
    const expectedRevision = loadRecommendationGenerationSnapshot(workspaceId).revision;
    updateRecommendationStatus(workspaceId, 'rec-storage-revision', 'in_progress');

    expect(() => commitGeneratedRecommendationSet(workspaceId, expectedRevision, current => ({
      set: recommendationSet(workspaceId, [recommendation(workspaceId, { title: 'Stale generated title' })]),
      current,
    }))).toThrow(RecommendationGenerationRevisionConflictError);
    expect(loadRecommendationSet(workspaceId)?.recommendations[0]).toMatchObject({
      title: 'Improve metadata', status: 'in_progress',
    });
    expect(loadRecommendationGenerationSnapshot(workspaceId).revision).toBe(expectedRevision + 1);
  });

  it('persists typed deterministic provenance in the generated CAS transaction', () => {
    const workspaceId = createWorkspace(`rec provenance ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const expectedRevision = loadRecommendationGenerationSnapshot(workspaceId).revision;

    commitGeneratedRecommendationSet(workspaceId, expectedRevision, () => ({
      set: recommendationSet(workspaceId, [recommendation(workspaceId)]),
    }), provenance);

    expect(loadRecommendationGenerationSnapshot(workspaceId)).toMatchObject({
      revision: 1,
      provenance,
    });
  });

  it('rejects malformed provenance and rolls back the generated artifact', () => {
    const workspaceId = createWorkspace(`rec invalid provenance ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const invalidProvenance = {
      ...provenance,
      provider: 'untrusted-provider',
    } as unknown as GenerationProvenance;

    expect(() => commitGeneratedRecommendationSet(workspaceId, 0, () => ({
      set: recommendationSet(workspaceId, [recommendation(workspaceId)]),
    }), invalidProvenance)).toThrow();
    expect(loadRecommendationGenerationSnapshot(workspaceId)).toEqual({
      revision: 0,
      set: null,
      provenance: null,
    });
  });

  it('loses the initial-row race when another writer creates the set first', () => {
    const workspaceId = createWorkspace(`rec initial race ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const expectedRevision = loadRecommendationGenerationSnapshot(workspaceId).revision;
    expect(expectedRevision).toBe(0);
    saveRecommendationSet(recommendationSet(workspaceId, [recommendation(workspaceId, { clientStatus: 'sent' })]));

    expect(() => commitGeneratedRecommendationSet(workspaceId, expectedRevision, () => ({
      set: recommendationSet(workspaceId, [recommendation(workspaceId, { title: 'Stale initial generation' })]),
    }))).toThrow(RecommendationGenerationRevisionConflictError);
    expect(loadRecommendationSet(workspaceId)?.recommendations[0]).toMatchObject({ clientStatus: 'sent' });
  });

  it('rolls back the claimed revision and nested writes when finalization fails', () => {
    const workspaceId = createWorkspace(`rec rollback ${Date.now()}`).id;
    cleanup.push(workspaceId);
    saveRecommendationSet(recommendationSet(workspaceId, [recommendation(workspaceId)]));
    const expectedRevision = loadRecommendationGenerationSnapshot(workspaceId).revision;

    expect(() => commitGeneratedRecommendationSet(workspaceId, expectedRevision, () => {
      saveRecommendationSet(recommendationSet(workspaceId, [
        recommendation(workspaceId, { title: 'Must roll back' }),
      ]));
      throw new Error('finalization failed');
    })).toThrow('finalization failed');

    expect(loadRecommendationGenerationSnapshot(workspaceId).revision).toBe(expectedRevision);
    expect(loadRecommendationSet(workspaceId)?.recommendations[0]?.title).toBe('Improve metadata');
  });

  it('scopes conflicts to one workspace while another workspace commits', () => {
    const staleWorkspaceId = createWorkspace(`rec stale isolated ${Date.now()}`).id;
    const cleanWorkspaceId = createWorkspace(`rec clean isolated ${Date.now()}`).id;
    cleanup.push(staleWorkspaceId, cleanWorkspaceId);
    saveRecommendationSet(recommendationSet(staleWorkspaceId, [recommendation(staleWorkspaceId)]));
    saveRecommendationSet(recommendationSet(cleanWorkspaceId, [recommendation(cleanWorkspaceId)]));
    const staleRevision = loadRecommendationGenerationSnapshot(staleWorkspaceId).revision;
    const cleanRevision = loadRecommendationGenerationSnapshot(cleanWorkspaceId).revision;
    updateRecommendationStatus(staleWorkspaceId, 'rec-storage-revision', 'in_progress');

    const cleanResult = commitGeneratedRecommendationSet(cleanWorkspaceId, cleanRevision, () => ({
      set: recommendationSet(cleanWorkspaceId, [recommendation(cleanWorkspaceId, { title: 'Fresh generation' })]),
    }));
    expect(cleanResult.set.recommendations[0]?.title).toBe('Fresh generation');
    expect(loadRecommendationGenerationSnapshot(cleanWorkspaceId).revision).toBe(cleanRevision + 1);

    expect(() => commitGeneratedRecommendationSet(staleWorkspaceId, staleRevision, () => ({
      set: recommendationSet(staleWorkspaceId, [recommendation(staleWorkspaceId, { title: 'Stale generation' })]),
    }))).toThrow(RecommendationGenerationRevisionConflictError);
    expect(loadRecommendationSet(staleWorkspaceId)?.recommendations[0]).toMatchObject({ status: 'in_progress' });
  });
});
