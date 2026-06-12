/**
 * Unit tests for buildImpactBandsByCheck adapter (R1-A → R1-B seam).
 *
 * Covers:
 * - Audit-sourced recs are mapped using the audit check extracted from source
 * - Non-audit sources are skipped
 * - Recs without impactBand are skipped
 * - `audit:site-wide:<check>` prefix is handled
 * - Multiple recs for the same check: max band wins
 * - Tie on band level: larger upper monthlyRangeUsd wins
 * - Empty input returns empty object
 */
import { describe, it, expect } from 'vitest';
import { buildImpactBandsByCheck } from '../../src/components/client/client-dashboard/buildImpactBandsByCheck';
import type { Recommendation } from '../../shared/types/recommendations';
import type { ImpactBand } from '../../shared/types/fix-catalog';

function makeRec(
  overrides: Partial<Recommendation> & { source: string },
): Recommendation {
  return {
    id: 'rec-1',
    workspaceId: 'ws-1',
    priority: 'fix_soon',
    type: 'metadata',
    title: 'Test rec',
    description: 'desc',
    insight: 'insight',
    impact: 'medium',
    effort: 'low',
    impactScore: 50,
    source: overrides.source,
    affectedPages: ['/home'],
    trafficAtRisk: 100,
    impressionsAtRisk: 500,
    estimatedGain: 'Improve rankings',
    actionType: 'purchase',
    status: 'pending',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildImpactBandsByCheck', () => {
  it('returns empty object for empty input', () => {
    expect(buildImpactBandsByCheck([])).toEqual({});
  });

  it('returns empty object when no recs have impactBand', () => {
    const recs = [makeRec({ source: 'audit:title' })]; // no impactBand
    expect(buildImpactBandsByCheck(recs)).toEqual({});
  });

  it('maps a single audit:title rec to the title check key', () => {
    const band: ImpactBand = { band: 'medium', monthlyRangeUsd: [80, 160] };
    const recs = [makeRec({ source: 'audit:title', impactBand: band })];
    expect(buildImpactBandsByCheck(recs)).toEqual({ title: band });
  });

  it('handles audit:site-wide:<check> prefix', () => {
    const band: ImpactBand = { band: 'low', monthlyRangeUsd: [30, 50] };
    const recs = [makeRec({ source: 'audit:site-wide:canonical', impactBand: band })];
    expect(buildImpactBandsByCheck(recs)).toEqual({ canonical: band });
  });

  it('skips non-audit sources (strategy, decay, etc.)', () => {
    const band: ImpactBand = { band: 'high', monthlyRangeUsd: [500, 1000] };
    const recs = [
      makeRec({ source: 'strategy:content-gap', impactBand: band }),
      makeRec({ source: 'decay:/about', impactBand: band }),
      makeRec({ source: 'insight:ctr_opportunity:/home', impactBand: band }),
    ];
    expect(buildImpactBandsByCheck(recs)).toEqual({});
  });

  it('maps multiple distinct checks independently', () => {
    const bandTitle: ImpactBand = { band: 'medium', monthlyRangeUsd: [80, 160] };
    const bandSchema: ImpactBand = { band: 'low', monthlyRangeUsd: [25, 50] };
    const recs = [
      makeRec({ source: 'audit:title', impactBand: bandTitle }),
      makeRec({ id: 'rec-2', source: 'audit:structured-data', impactBand: bandSchema }),
    ];
    expect(buildImpactBandsByCheck(recs)).toEqual({
      title: bandTitle,
      'structured-data': bandSchema,
    });
  });

  // ── Multi-rec merge cases ───────────────────────────────────────────────────

  it('merge: higher band wins over lower band for same check', () => {
    const lowBand: ImpactBand = { band: 'low', monthlyRangeUsd: [25, 50] };
    const highBand: ImpactBand = { band: 'high', monthlyRangeUsd: [500, 800] };
    const recs = [
      makeRec({ id: 'rec-a', source: 'audit:title', impactBand: lowBand }),
      makeRec({ id: 'rec-b', source: 'audit:title', impactBand: highBand }),
    ];
    expect(buildImpactBandsByCheck(recs)).toEqual({ title: highBand });
  });

  it('merge: order-independent — lower band after higher band still gives higher', () => {
    const lowBand: ImpactBand = { band: 'low', monthlyRangeUsd: [25, 50] };
    const medBand: ImpactBand = { band: 'medium', monthlyRangeUsd: [120, 200] };
    const recs = [
      makeRec({ id: 'rec-a', source: 'audit:meta-description', impactBand: medBand }),
      makeRec({ id: 'rec-b', source: 'audit:meta-description', impactBand: lowBand }),
    ];
    expect(buildImpactBandsByCheck(recs)).toEqual({ 'meta-description': medBand });
  });

  it('merge: equal band level — larger upper monthlyRangeUsd wins', () => {
    const narrowBand: ImpactBand = { band: 'medium', monthlyRangeUsd: [100, 150] };
    const widerBand: ImpactBand = { band: 'medium', monthlyRangeUsd: [100, 200] };
    const recs = [
      makeRec({ id: 'rec-a', source: 'audit:title', impactBand: narrowBand }),
      makeRec({ id: 'rec-b', source: 'audit:title', impactBand: widerBand }),
    ];
    expect(buildImpactBandsByCheck(recs)).toEqual({ title: widerBand });
  });

  it('merge: equal band with no monthlyRangeUsd — keeps first', () => {
    const band1: ImpactBand = { band: 'low' }; // no range
    const band2: ImpactBand = { band: 'low' }; // no range
    const recs = [
      makeRec({ id: 'rec-a', source: 'audit:img-alt', impactBand: band1 }),
      makeRec({ id: 'rec-b', source: 'audit:img-alt', impactBand: band2 }),
    ];
    // Both have upper = 0, so neither dominates → first keeps
    expect(buildImpactBandsByCheck(recs)).toEqual({ 'img-alt': band1 });
  });

  it('does not include recs with missing impactBand even when source is audit:', () => {
    const band: ImpactBand = { band: 'medium', monthlyRangeUsd: [80, 160] };
    const recs = [
      makeRec({ id: 'rec-a', source: 'audit:title' }), // no impactBand
      makeRec({ id: 'rec-b', source: 'audit:title', impactBand: band }),
    ];
    expect(buildImpactBandsByCheck(recs)).toEqual({ title: band });
  });
});
