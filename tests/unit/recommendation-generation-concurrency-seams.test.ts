import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  approveRecommendation,
  sendRecommendation,
  strikeRecommendation,
} from '../../server/recommendation-lifecycle.js';
import { finalizeRecommendations } from '../../server/domains/recommendations/finalization.js';
import { commitRecommendationCandidatesWithRetry } from '../../server/domains/recommendations/generation-service.js';
import { recommendationOutcomeActionType } from '../../server/domains/recommendations/outcome-action-type.js';
import { mintManualRecommendation } from '../../server/domains/recommendations/route-mutations.js';
import { dismissRecommendation } from '../../server/domains/recommendations/status-service.js';
import {
  commitGeneratedRecommendationSet,
  loadRecommendationGenerationSnapshot,
  loadRecommendationSet,
  RecommendationGenerationRevisionConflictError,
  saveRecommendationSet,
} from '../../server/domains/recommendations/storage.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const cleanup: string[] = [];
afterEach(() => {
  for (const workspaceId of cleanup.splice(0)) deleteWorkspace(workspaceId);
});

function recommendation(workspaceId: string, overrides: Partial<Recommendation> = {}): Recommendation {
  const now = '2026-07-13T00:00:00.000Z';
  return {
    id: 'rec-concurrency-seam', workspaceId, priority: 'fix_soon', type: 'metadata',
    title: 'Improve metadata', description: 'Description', insight: 'Insight', impact: 'medium',
    effort: 'low', impactScore: 50, source: 'audit:title', affectedPages: ['/'], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'More qualified traffic', actionType: 'manual', status: 'pending',
    clientStatus: 'system', lifecycle: 'active', createdAt: now, updatedAt: now, ...overrides,
  };
}

function recommendationSet(workspaceId: string, recs: Recommendation[]): RecommendationSet {
  return {
    workspaceId, generatedAt: '2026-07-13T00:00:00.000Z', recommendations: recs,
    summary: { fixNow: 0, fixSoon: recs.length, fixLater: 0, ongoing: 0, totalImpactScore: 50, trafficAtRisk: 0, topRecommendationId: recs[0]?.id ?? null },
  };
}

function runConcurrentMutation(
  initialRec: Recommendation,
  mutate: (workspaceId: string) => void,
): { set: RecommendationSet; providerCollection: ReturnType<typeof vi.fn> } {
  const workspaceId = initialRec.workspaceId;
  saveRecommendationSet(recommendationSet(workspaceId, [initialRec]));
  const initialRevision = loadRecommendationGenerationSnapshot(workspaceId).revision;
  const providerCollection = vi.fn(() => [recommendation(workspaceId)]);
  const candidates = providerCollection();

  mutate(workspaceId);
  expect(loadRecommendationGenerationSnapshot(workspaceId).revision).toBe(initialRevision + 1);

  const result = commitRecommendationCandidatesWithRetry(
    workspaceId,
    initialRevision,
    candidates,
    (existing, freshCandidates) => finalizeRecommendations(freshCandidates, {
      workspaceId,
      workspaceName: 'Concurrency seam',
      now: '2026-07-13T00:00:02.000Z',
      assignedTo: 'client',
      existing,
      failedCategories: new Set(),
      inFlightContentKeywords: new Set(),
      slugToPageId: new Map(),
      effectiveBusinessPriorities: [],
      outcomeLearnings: null,
      intelligence: null,
      strategySignals: [],
      actionTypeForRecommendation: recommendationOutcomeActionType,
    }),
  );
  expect(providerCollection).toHaveBeenCalledOnce();
  expect(loadRecommendationGenerationSnapshot(workspaceId).revision).toBe(initialRevision + 2);
  return { set: result.set, providerCollection };
}

function workspaceWithRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const workspaceId = createWorkspace(`rec concurrency ${Date.now()} ${cleanup.length}`).id;
  cleanup.push(workspaceId);
  return recommendation(workspaceId, overrides);
}

describe('recommendation generation real mutation seams', () => {
  it('preserves a concurrent operator send', () => {
    const initial = workspaceWithRec();
    const { set } = runConcurrentMutation(initial, workspaceId => {
      expect(sendRecommendation(workspaceId, initial.id)?.clientStatus).toBe('sent');
    });
    expect(set.recommendations[0]).toMatchObject({ id: initial.id, clientStatus: 'sent' });
  });

  it('preserves a concurrent dismissal', () => {
    const initial = workspaceWithRec();
    const { set } = runConcurrentMutation(initial, workspaceId => {
      expect(dismissRecommendation(workspaceId, initial.id)).toBe(true);
    });
    expect(set.recommendations[0]).toMatchObject({ id: initial.id, status: 'dismissed' });
  });

  it('preserves a concurrent strike', () => {
    const initial = workspaceWithRec();
    const { set } = runConcurrentMutation(initial, workspaceId => {
      expect(strikeRecommendation(workspaceId, initial.id)?.lifecycle).toBe('struck');
    });
    expect(set.recommendations[0]).toMatchObject({ id: initial.id, lifecycle: 'struck' });
  });

  it('preserves a concurrent operator mint', () => {
    const initial = workspaceWithRec();
    const { set } = runConcurrentMutation(initial, workspaceId => {
      mintManualRecommendation(workspaceId, {
        type: 'strategy',
        title: 'Operator-owned opportunity',
        insight: 'The operator identified a missing priority.',
      });
    });
    expect(set.recommendations.some(rec => rec.source.startsWith('manual:') && rec.title === 'Operator-owned opportunity')).toBe(true);
  });

  it('preserves a concurrent client approval', () => {
    const initial = workspaceWithRec({ clientStatus: 'sent' });
    const { set } = runConcurrentMutation(initial, workspaceId => {
      expect(approveRecommendation(workspaceId, initial.id)?.clientStatus).toBe('approved');
    });
    expect(set.recommendations[0]).toMatchObject({ id: initial.id, clientStatus: 'approved' });
  });

  it('fails safely after two real concurrent decisions without recollecting candidates', () => {
    const initial = workspaceWithRec();
    saveRecommendationSet(recommendationSet(initial.workspaceId, [initial]));
    const initialRevision = loadRecommendationGenerationSnapshot(initial.workspaceId).revision;
    const providerCollection = vi.fn(() => [recommendation(initial.workspaceId)]);
    const candidates = providerCollection();
    let commitAttempt = 0;

    expect(() => commitRecommendationCandidatesWithRetry(
      initial.workspaceId,
      initialRevision,
      candidates,
      (_existing, freshCandidates) => ({
        set: recommendationSet(initial.workspaceId, freshCandidates),
        autoResolved: 0,
        autoResolvedPageStateIds: [],
      }),
      null,
      {
        loadSnapshot: loadRecommendationGenerationSnapshot,
        commit: (workspaceId, revision, finalize, provenance) => {
          commitAttempt += 1;
          if (commitAttempt === 1) sendRecommendation(workspaceId, initial.id);
          else approveRecommendation(workspaceId, initial.id);
          return commitGeneratedRecommendationSet(workspaceId, revision, finalize, provenance);
        },
      },
    )).toThrow(RecommendationGenerationRevisionConflictError);

    expect(commitAttempt).toBe(2);
    expect(providerCollection).toHaveBeenCalledOnce();
    expect(loadRecommendationGenerationSnapshot(initial.workspaceId).revision).toBe(initialRevision + 2);
    expect(loadRecommendationSet(initial.workspaceId)?.recommendations[0]).toMatchObject({ clientStatus: 'approved' });
  });
});
