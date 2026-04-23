/**
 * Integration tests for CTR opportunity recommendations.
 * Calls generateRecommendations() in-process with vi.mock to inject
 * ctr_opportunity insights, verifying the resulting recommendation shape.
 */

// ── Module-level mocks (hoisted by Vitest) ───────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

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
          id: 'ins_ctr_1',
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
      // For conversion_attribution and other types, return empty
      if (type === 'conversion_attribution') return [];
      return [];
    },
  };
});

// ── Imports (after mock declarations) ────────────────────────────────────────
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { generateRecommendations } from '../../server/recommendations.js';

describe('generateRecommendations — CTR gap', () => {
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

  it('creates a fix_now metadata rec for large CTR gaps', async () => {
    const set = await generateRecommendations(wsId);
    const ctrRec = set.recommendations.find(r => r.source?.startsWith('insight:ctr_opportunity:'));
    expect(ctrRec).toBeDefined();
    expect(ctrRec?.priority).toBe('fix_now');
    expect(ctrRec?.type).toBe('metadata');
    expect(ctrRec?.trafficAtRisk).toBe(153);
  });
});
