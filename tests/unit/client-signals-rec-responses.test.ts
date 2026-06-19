import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { saveRecommendations } from '../../server/recommendations.js';
import { assembleClientSignals } from '../../server/intelligence/client-signals-slice.js';
import db from '../../server/db/index.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

describe('assembleClientSignals — recResponses', () => {
  let wsId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seeded = seedWorkspace();
    wsId = seeded.workspaceId;
    cleanup = seeded.cleanup;
    const at = new Date().toISOString();
    // updatedAt is REQUIRED by recommendationSchema (read-boundary validation drops recs without
    // it) — verified against server/schemas/workspace-schemas.ts.
    // FIX 4: respondedAt is now updatedAt (the single-writer bumps it on every clientStatus
    // mutation), NOT sentAt. Seed each rec with a sentAt EARLIER than its updatedAt so a stale
    // sentAt sort can never coincide with the correct updatedAt sort. Give distinct updatedAt
    // values so recentResponses ordering is provable: 'a' is the most-recently-updated.
    const sentAt = new Date(Date.parse(at) - 10 * 24 * 60 * 60 * 1000).toISOString();
    const upd = (minsAgo: number) => new Date(Date.parse(at) - minsAgo * 60_000).toISOString();
    const mk = (id: string, clientStatus: Recommendation['clientStatus'], updatedAt: string): Recommendation => ({
      id, workspaceId: wsId, type: 'content_refresh', title: `Rec ${id}`, description: 'd', insight: 'i',
      impact: 'medium', effort: 'medium', impactScore: 50, priority: 'fix_soon', actionType: 'manual',
      trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: '', affectedPages: [], source: 'test',
      clientStatus, sentAt, status: 'pending', createdAt: at, updatedAt,
    } as unknown as Recommendation);
    // updatedAt order is DELIBERATELY the reverse of array order: 'd' is the most-recently
    // updated, 'a' the least. A sentAt-based sort (all sentAt equal) would preserve array order
    // and lead with 'a' — so leading with 'd' proves the sort uses updatedAt, not sentAt.
    saveRecommendations({ workspaceId: wsId, generatedAt: at, recommendations: [
      mk('a', 'approved', upd(4)), mk('b', 'approved', upd(3)), mk('c', 'declined', upd(2)),
      mk('d', 'discussing', upd(1)), mk('e', 'sent', upd(5)),
    ], summary: {
      fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0,
      totalOpportunityValue: 0, actionableOpportunityValue: 0, topRecommendationId: null,
    } });
  });

  afterAll(() => {
    db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
    cleanup();
  });

  it('counts approved/declined/discussing and lists recent responses', async () => {
    const slice = await assembleClientSignals(wsId);
    expect(slice.recResponses).toMatchObject({ approved: 2, declined: 1, discussing: 1 });
    expect(slice.recResponses!.recentResponses.length).toBe(4); // approved+declined+discussing, not 'sent'
    expect(slice.recResponses!.recentResponses[0]).toHaveProperty('clientStatus');
  });

  it('respondedAt reflects updatedAt (not sentAt) and orders recentResponses by it', async () => {
    const slice = await assembleClientSignals(wsId);
    const recent = slice.recResponses!.recentResponses;
    // 'd' has the most-recent updatedAt (array order is the reverse) → it must lead, proving the
    // sort uses updatedAt. Under the old sentAt sort (all sentAt equal) 'a' would lead instead.
    expect(recent[0].title).toBe('Rec d');
    // respondedAt is descending by updatedAt.
    for (let i = 1; i < recent.length; i++) {
      expect(Date.parse(recent[i - 1].respondedAt)).toBeGreaterThanOrEqual(Date.parse(recent[i].respondedAt));
    }
  });
});
