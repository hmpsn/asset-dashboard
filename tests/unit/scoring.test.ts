/**
 * Unit tests for shared/scoring.ts — shared SEO page scoring logic.
 */
import { describe, it, expect } from 'vitest';
import { computePageScore, CRITICAL_CHECKS, MODERATE_CHECKS } from '../../shared/scoring';

describe('computePageScore', () => {
  it('returns 100 with no issues', () => {
    expect(computePageScore([])).toBe(100);
  });

  it('deducts 15 for a critical error', () => {
    const issues = [{ check: 'title', severity: 'error' }];
    expect(computePageScore(issues)).toBe(85);
  });

  it('deducts 10 for a non-critical error', () => {
    // 'img-alt' is in MODERATE_CHECKS, not CRITICAL_CHECKS
    const issues = [{ check: 'img-alt', severity: 'error' }];
    expect(computePageScore(issues)).toBe(90);
  });

  it('deducts 5 for a critical warning', () => {
    const issues = [{ check: 'title', severity: 'warning' }];
    expect(computePageScore(issues)).toBe(95);
  });

  it('deducts 3 for a moderate warning', () => {
    // 'content-length' is in MODERATE_CHECKS
    const issues = [{ check: 'content-length', severity: 'warning' }];
    expect(computePageScore(issues)).toBe(97);
  });

  it('deducts 2 for a minor warning', () => {
    // A check that is neither critical nor moderate
    const issues = [{ check: 'some-minor-check', severity: 'warning' }];
    expect(computePageScore(issues)).toBe(98);
  });

  it('info severity has no score impact', () => {
    const issues = [{ check: 'title', severity: 'info' }];
    expect(computePageScore(issues)).toBe(100);
  });

  it('clamps to 0 on many errors', () => {
    const issues = Array.from({ length: 20 }, () => ({ check: 'title', severity: 'error' }));
    expect(computePageScore(issues)).toBe(0);
  });

  it('exports CRITICAL_CHECKS as a Set containing "title"', () => {
    expect(CRITICAL_CHECKS).toBeInstanceOf(Set);
    expect(CRITICAL_CHECKS.has('title')).toBe(true);
  });

  it('exports MODERATE_CHECKS as a Set containing "content-length"', () => {
    expect(MODERATE_CHECKS).toBeInstanceOf(Set);
    expect(MODERATE_CHECKS.has('content-length')).toBe(true);
  });
});
