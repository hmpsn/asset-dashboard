/**
 * PR3 (Spine A) — Opportunity Value wiring.
 *
 * Proves the canonical cutover surface:
 *   1. Every pending rec carries an attached `opportunity` (modelVersion 'ov-1').
 *   2. impactScore === opportunity.value for every rec with an attached opportunity.
 *
 * Uses the same in-process `generateRecommendations` + injected-insight pattern
 * as recommendations-ctr-gap.test.ts so a real producer branch fires and we can
 * read the attached opportunity end-to-end.
 */

// ── Module-level mocks (hoisted by Vitest) ───────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
  broadcast: vi.fn(),
  setBroadcast: vi.fn(),
}));

vi.mock('../../server/analytics-insights-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/analytics-insights-store.js')>();
  return {
    ...actual,
    getInsights: (wsId: string, type?: string) => {
      if (type === 'ctr_opportunity') {
        return [{
          id: 'ins_ctr_wiring_1',
          workspaceId: wsId,
          pageId: '/plumbing',
          insightType: 'ctr_opportunity',
          severity: 'warning' as const,
          computedAt: new Date().toISOString(),
          data: {
            query: 'plumbing services',
            pageUrl: '/plumbing',
            position: 4.5,
            actualCtr: 1.2,
            expectedCtr: 6.0,
            ctrRatio: 0.2,
            impressions: 3200,
            estimatedClickGap: 153,
          },
        }];
      }
      return [];
    },
  };
});

// ── Imports (after mock declarations) ────────────────────────────────────────
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { generateRecommendations } from '../../server/recommendations.js';

describe('generateRecommendations — Opportunity Value wiring (PR3)', () => {
  let wsId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const s = seedWorkspace({});
    wsId = s.workspaceId;
    cleanup = s.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('attaches an OV payload to every pending recommendation', async () => {
    const set = await generateRecommendations(wsId);

    expect(set.recommendations.length).toBeGreaterThan(0);

    for (const rec of set.recommendations) {
      // Auto-resolved/legacy carry-over recs may legitimately lack an opportunity;
      // every freshly-produced (pending) rec must have one attached.
      if (rec.status !== 'pending') continue;
      expect(rec.opportunity, `rec ${rec.source} should have opportunity attached`).toBeTruthy();
      expect(rec.opportunity!.modelVersion).toBe('ov-1');
      expect(typeof rec.opportunity!.value).toBe('number');
    }
  });

  it('uses opportunity.value as the canonical impactScore', async () => {
    const set = await generateRecommendations(wsId);

    expect(set.recommendations.length).toBeGreaterThan(0);

    let checked = 0;
    for (const rec of set.recommendations) {
      if (!rec.opportunity) continue;
      expect(rec.impactScore).toBe(rec.opportunity.value);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('keeps grounded CTR opportunities positive end-to-end', async () => {
    const set = await generateRecommendations(wsId);
    const ctrRec = set.recommendations.find(r => r.source.startsWith('insight:ctr_opportunity:'));
    expect(ctrRec).toBeDefined();
    expect(ctrRec!.opportunity).toBeTruthy();
    expect(ctrRec!.opportunity!.value).toBeGreaterThan(0);
    expect(ctrRec!.impactScore).toBe(ctrRec!.opportunity!.value);
  });
});
