/**
 * Pure unit tests for content-decay logic.
 *
 * The core decay engine (analyzeContentDecay) is async and DB/HTTP-bound, so
 * we test the pure formulas and classification rules extracted from it directly.
 * These match the exact arithmetic used in server/content-decay.ts.
 */

import { describe, it, expect } from 'vitest';
import type { DecayingPage, DecayAnalysis } from '../../server/content-decay.js';

// ── Pure helper replicas (mirrors the logic in analyzeContentDecay) ──────────

/** Compute click decline % the same way the engine does. */
function calcClickDecline(currentClicks: number, previousClicks: number): number {
  return previousClicks > 0 ? ((currentClicks - previousClicks) / previousClicks) * 100 : 0;
}

/** Compute impression change % */
function calcImpressionChange(currentImpressions: number, previousImpressions: number): number {
  return previousImpressions > 0
    ? ((currentImpressions - previousImpressions) / previousImpressions) * 100
    : 0;
}

/** Classify severity the same way the engine does. */
function classifySeverity(clickDeclinePct: number): DecayingPage['severity'] {
  return clickDeclinePct <= -50 ? 'critical' : clickDeclinePct <= -30 ? 'warning' : 'watch';
}

/** Determine whether a page is "decaying enough" to flag (engine threshold: < -10%). */
function isDecaying(clickDeclinePct: number): boolean {
  return clickDeclinePct < -10;
}

/** Compute average decline across a set of decaying pages. */
function calcAvgDecline(decayingPages: Array<{ clickDeclinePct: number }>): number {
  if (decayingPages.length === 0) return 0;
  return Math.round(
    decayingPages.reduce((sum, p) => sum + p.clickDeclinePct, 0) / decayingPages.length,
  );
}

/** Running-average position (used when accumulating URL variants). */
function runningAvgPosition(
  existing: { position: number; count: number },
  newPosition: number,
): number {
  return (existing.position * existing.count + newPosition) / (existing.count + 1);
}

// ── Click-decline calculation ────────────────────────────────────────────────

describe('calcClickDecline', () => {
  it('returns 0 when previous clicks is 0 (avoids division by zero)', () => {
    expect(calcClickDecline(10, 0)).toBe(0);
  });

  it('returns 0 when clicks are identical', () => {
    expect(calcClickDecline(100, 100)).toBe(0);
  });

  it('calculates a 50% decline correctly', () => {
    expect(calcClickDecline(50, 100)).toBe(-50);
  });

  it('calculates a 100% decline (complete loss)', () => {
    expect(calcClickDecline(0, 100)).toBe(-100);
  });

  it('calculates growth as a positive number', () => {
    expect(calcClickDecline(200, 100)).toBe(100);
  });

  it('handles fractional clicks correctly', () => {
    // 75 / 100 = -25%
    expect(calcClickDecline(75, 100)).toBe(-25);
  });
});

// ── Impression-change calculation ────────────────────────────────────────────

describe('calcImpressionChange', () => {
  it('returns 0 when previous impressions is 0', () => {
    expect(calcImpressionChange(500, 0)).toBe(0);
  });

  it('calculates a 40% increase', () => {
    expect(calcImpressionChange(1400, 1000)).toBeCloseTo(40);
  });

  it('calculates a 50% decline', () => {
    expect(calcImpressionChange(500, 1000)).toBe(-50);
  });
});

// ── Severity classification ──────────────────────────────────────────────────

describe('classifySeverity', () => {
  it('returns "critical" for exactly -50%', () => {
    expect(classifySeverity(-50)).toBe('critical');
  });

  it('returns "critical" for worse than -50% (e.g. -80%)', () => {
    expect(classifySeverity(-80)).toBe('critical');
  });

  it('returns "critical" for -100%', () => {
    expect(classifySeverity(-100)).toBe('critical');
  });

  it('returns "warning" for exactly -30%', () => {
    expect(classifySeverity(-30)).toBe('warning');
  });

  it('returns "warning" for -49% (just above critical threshold)', () => {
    expect(classifySeverity(-49)).toBe('warning');
  });

  it('returns "watch" for -11% (below warning threshold)', () => {
    expect(classifySeverity(-11)).toBe('watch');
  });

  it('returns "watch" for -29% (just below warning threshold)', () => {
    expect(classifySeverity(-29)).toBe('watch');
  });
});

// ── Decay threshold gate ─────────────────────────────────────────────────────

describe('isDecaying', () => {
  it('flags pages with exactly -11% decline', () => {
    expect(isDecaying(-11)).toBe(true);
  });

  it('does NOT flag pages with -10% decline (threshold is exclusive)', () => {
    // Engine check: if (clickDecline >= -10) continue — i.e. not decaying
    expect(isDecaying(-10)).toBe(false);
  });

  it('does NOT flag pages with 0% change', () => {
    expect(isDecaying(0)).toBe(false);
  });

  it('does NOT flag growing pages', () => {
    expect(isDecaying(25)).toBe(false);
  });

  it('flags pages at -100%', () => {
    expect(isDecaying(-100)).toBe(true);
  });
});

// ── Average decline calculation ──────────────────────────────────────────────

describe('calcAvgDecline', () => {
  it('returns 0 for empty array', () => {
    expect(calcAvgDecline([])).toBe(0);
  });

  it('returns the single value when there is only one page', () => {
    expect(calcAvgDecline([{ clickDeclinePct: -40 }])).toBe(-40);
  });

  it('rounds the average to the nearest integer', () => {
    // (-30 + -31) / 2 = -30.5
    // Math.round(-30.5) = -30 in JS (rounds toward +Infinity for .5 values)
    expect(calcAvgDecline([{ clickDeclinePct: -30 }, { clickDeclinePct: -31 }])).toBe(-30);
  });

  it('computes correctly across three pages', () => {
    // (-60 + -30 + -15) / 3 = -35
    expect(
      calcAvgDecline([
        { clickDeclinePct: -60 },
        { clickDeclinePct: -30 },
        { clickDeclinePct: -15 },
      ]),
    ).toBe(-35);
  });
});

// ── Running-average position ─────────────────────────────────────────────────

describe('runningAvgPosition', () => {
  it('computes average of two identical positions', () => {
    const result = runningAvgPosition({ position: 5.0, count: 1 }, 5.0);
    expect(result).toBe(5.0);
  });

  it('computes average of two different positions', () => {
    // (3.0 * 1 + 7.0) / 2 = 5.0
    const result = runningAvgPosition({ position: 3.0, count: 1 }, 7.0);
    expect(result).toBe(5.0);
  });

  it('handles count > 1 correctly (weighted average)', () => {
    // (4.0 * 3 + 4.0) / 4 = 4.0
    const result = runningAvgPosition({ position: 4.0, count: 3 }, 4.0);
    expect(result).toBe(4.0);
  });

  it('incorporates a worse (higher) position correctly', () => {
    // (2.0 * 2 + 8.0) / 3 = 4.0
    const result = runningAvgPosition({ position: 2.0, count: 2 }, 8.0);
    expect(result).toBeCloseTo(4.0);
  });
});

// ── DecayAnalysis shape integrity ────────────────────────────────────────────

describe('DecayAnalysis shape', () => {
  it('can construct a valid DecayAnalysis object', () => {
    const analysis: DecayAnalysis = {
      workspaceId: 'ws-1',
      analyzedAt: new Date().toISOString(),
      totalPages: 5,
      decayingPages: [],
      summary: {
        critical: 0,
        warning: 0,
        watch: 0,
        totalDecaying: 0,
        avgDeclinePct: 0,
      },
    };
    expect(analysis.workspaceId).toBe('ws-1');
    expect(analysis.summary.totalDecaying).toBe(0);
  });

  it('summary counts are consistent with decayingPages array', () => {
    const pages: DecayingPage[] = [
      {
        page: '/blog/seo-tips',
        currentClicks: 10,
        previousClicks: 100,
        clickDeclinePct: -90,
        currentImpressions: 500,
        previousImpressions: 1000,
        impressionChangePct: -50,
        currentPosition: 8.0,
        previousPosition: 3.5,
        positionChange: 4.5,
        severity: 'critical',
      },
    ];

    const critical = pages.filter(p => p.severity === 'critical').length;
    const warning = pages.filter(p => p.severity === 'warning').length;
    const watch = pages.filter(p => p.severity === 'watch').length;

    expect(critical).toBe(1);
    expect(warning).toBe(0);
    expect(watch).toBe(0);
    expect(critical + warning + watch).toBe(pages.length);
  });
});
