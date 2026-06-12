/**
 * PR7 · Spine B — event-driven re-ranking proof.
 *
 *   1. computeOpportunityValue is byte-identical with timingBoost 0 vs the OFF path
 *      (no timingBoost) — proving the scorer math is unchanged (timing multiplier 1).
 *   2. With a fresh active event on a target page, attached opportunity values rise.
 *   3. generateRecommendations does NOT write opportunity_events rows.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  broadcast: vi.fn(),
  setBroadcast: vi.fn(),
}));

// Inject a single grounded CTR opportunity on a known page so generateRecommendations
// produces a deterministic rec whose page we can target with an event.
vi.mock('../../server/analytics-insights-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/analytics-insights-store.js')>();
  return {
    ...actual,
    getInsights: (wsId: string, type?: string) => {
      if (type === 'ctr_opportunity') {
        return [{
          id: 'ins_noop_1',
          workspaceId: wsId,
          pageId: '/services/hvac',
          insightType: 'ctr_opportunity',
          severity: 'warning' as const,
          computedAt: new Date().toISOString(),
          data: {
            query: 'hvac services',
            pageUrl: '/services/hvac',
            position: 6.0,
            actualCtr: 0.9,
            expectedCtr: 5.0,
            ctrRatio: 0.18,
            impressions: 3000,
            estimatedClickGap: 120,
          },
        }];
      }
      return [];
    },
  };
});

import db from '../../server/db/index.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { generateRecommendations } from '../../server/recommendations.js';
import { computeOpportunityValue } from '../../server/scoring/opportunity-value.js';
import { insertOpportunityEvent } from '../../server/opportunity-events.js';

let ws: ReturnType<typeof seedWorkspace>;

beforeAll(() => {
  ws = seedWorkspace();
});

afterAll(() => {
  db.prepare("DELETE FROM opportunity_events WHERE workspace_id = ?").run(ws.workspaceId);
  db.prepare("DELETE FROM recommendation_sets WHERE workspace_id = ?").run(ws.workspaceId);
  ws.cleanup();
});

beforeEach(() => {
  db.prepare("DELETE FROM opportunity_events WHERE workspace_id = ?").run(ws.workspaceId);
});

describe('computeOpportunityValue — timingBoost 0 is identity', () => {
  it('produces a byte-identical score with timingBoost:0 vs the OFF path (omitted)', () => {
    const base = {
      branch: 'ranking_opp' as const,
      volume: 1000,
      currentPosition: 6,
      difficulty: 30,
      authorityStrength: 50,
    };
    const off = computeOpportunityValue(base);
    const zero = computeOpportunityValue({ ...base, timingBoost: 0 });
    expect(JSON.stringify(zero)).toBe(JSON.stringify(off));
  });
});

describe('generateRecommendations — event-driven re-ranking', () => {
  it('raises attached opportunity values when active events exist', async () => {
    const set1 = await generateRecommendations(ws.workspaceId);
    const opp1 = set1.recommendations
      .filter(r => r.affectedPages.includes('services/hvac'))
      .map(r => r.opportunity?.value ?? 0);
    expect(opp1.length).toBeGreaterThan(0);

    insertOpportunityEvent({
      workspaceId: ws.workspaceId,
      type: 'competitor',
      pagePath: 'services/hvac',
      boost: 1.5,
      halfLifeDays: 7,
    });

    const set2 = await generateRecommendations(ws.workspaceId);
    const opp2 = set2.recommendations
      .filter(r => r.affectedPages.includes('services/hvac'))
      .map(r => r.opportunity?.value ?? 0);
    expect(opp2).toHaveLength(opp1.length);
    expect(Math.max(...opp2)).toBeGreaterThan(Math.max(...opp1));
  });

  it('does NOT write opportunity_events rows during generation', async () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM opportunity_events WHERE workspace_id = ?').get(ws.workspaceId) as { n: number };
    await generateRecommendations(ws.workspaceId);
    const after = db.prepare('SELECT COUNT(*) AS n FROM opportunity_events WHERE workspace_id = ?').get(ws.workspaceId) as { n: number };
    expect(after.n).toBe(before.n);
  });
});
