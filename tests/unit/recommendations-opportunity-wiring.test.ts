/**
 * PR3 (Spine A) — Opportunity Value wiring.
 *
 * Proves the no-op boundary and the single cutover surface:
 *   1. Flag OFF (default): every rec carries an attached `opportunity`
 *      (modelVersion 'ov-1'), and impactScore is the LEGACY value (the OV value
 *      is shadow-only, NOT applied to impactScore).
 *   2. Flag ON (DB override for the test workspace): impactScore === opportunity.value
 *      for every rec that has an attached opportunity.
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
import { setFlagOverride } from '../../server/feature-flags.js';

describe('generateRecommendations — Opportunity Value wiring (PR3)', () => {
  let wsId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const s = seedWorkspace({});
    wsId = s.workspaceId;
    cleanup = s.cleanup;
  });

  afterAll(() => {
    setFlagOverride('opportunity-value-scorer', null); // revert to default (off)
    cleanup();
  });

  beforeEach(() => {
    // Ensure each test starts from a known flag state.
    setFlagOverride('opportunity-value-scorer', null);
  });

  it('flag OFF: every rec has an attached opportunity (modelVersion ov-1) AND impactScore stays the legacy value', async () => {
    setFlagOverride('opportunity-value-scorer', false);
    const set = await generateRecommendations(wsId);

    expect(set.recommendations.length).toBeGreaterThan(0);

    for (const rec of set.recommendations) {
      // Auto-resolved/legacy carry-over recs may legitimately lack an opportunity;
      // every freshly-produced (pending) rec must have one attached.
      if (rec.status !== 'pending') continue;
      expect(rec.opportunity, `rec ${rec.source} should have opportunity attached`).toBeTruthy();
      expect(rec.opportunity!.modelVersion).toBe('ov-1');
      expect(typeof rec.opportunity!.value).toBe('number');

      // No-op boundary: with the flag OFF, impactScore is the LEGACY value (the OV
      // value is computed + attached in shadow only).
      if (rec.source.startsWith('insight:ctr_opportunity:')) {
        // PR3-review fix: the CTR rec now consumes its grounded estimatedClickGap,
        // so its OV value is > 0 (previously impressions-only collapsed it to 0).
        expect(rec.opportunity!.value).toBeGreaterThan(0);
        expect(rec.impactScore).toBeGreaterThan(0); // legacy score, flag still off
      }
    }
  });

  it('flag ON: impactScore === opportunity.value for every rec with an attached opportunity', async () => {
    setFlagOverride('opportunity-value-scorer', true);
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

  it('flag flip changes the CTR rec impactScore from legacy to OV value', async () => {
    setFlagOverride('opportunity-value-scorer', false);
    const offSet = await generateRecommendations(wsId);
    const offCtr = offSet.recommendations.find(r => r.source.startsWith('insight:ctr_opportunity:'));
    expect(offCtr).toBeDefined();
    const legacyScore = offCtr!.impactScore;
    const ovValue = offCtr!.opportunity!.value;

    setFlagOverride('opportunity-value-scorer', true);
    const onSet = await generateRecommendations(wsId);
    const onCtr = onSet.recommendations.find(r => r.source.startsWith('insight:ctr_opportunity:'));
    expect(onCtr).toBeDefined();

    expect(onCtr!.impactScore).toBe(ovValue);
    // Sanity: the flag actually moved the score (legacy ≠ OV for this rec).
    expect(legacyScore).not.toBe(ovValue);
  });
});
