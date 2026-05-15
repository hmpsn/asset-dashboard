import { describe, expect, it } from 'vitest';
import { CANONICAL_BOUNDED_CONTEXTS } from '../../scripts/platform-domain-smoke-matrix.js';
import {
  PRODUCT_SURFACE_MAP,
  SURFACE_PLACEMENTS,
  buildProductSurfaceReport,
  findProductSurfaceCoverageGaps,
  findProductSurfacePolicyGaps,
  formatProductSurfaceReportAsMarkdown,
} from '../../scripts/product-surface-map.js';

describe('product surface map', () => {
  it('covers every canonical bounded context at least once', () => {
    const gaps = findProductSurfaceCoverageGaps();
    expect(gaps).toEqual([]);

    const contextIds = new Set(PRODUCT_SURFACE_MAP.map(entry => entry.boundedContextId));
    for (const expected of CANONICAL_BOUNDED_CONTEXTS) {
      expect(contextIds.has(expected), `${expected} is represented in surface map`).toBe(true);
    }
  });

  it('contains all placement categories to keep the taxonomy complete', () => {
    const placements = new Set(PRODUCT_SURFACE_MAP.map(entry => entry.placement));
    for (const placement of SURFACE_PLACEMENTS) {
      expect(placements.has(placement), `placement ${placement} exists in map`).toBe(true);
    }
  });

  it('keeps explicit human-verification queue for non-obvious cuts', () => {
    const reviewQueue = PRODUCT_SURFACE_MAP.filter(entry => entry.requiresHumanVerification);
    expect(reviewQueue.length).toBeGreaterThan(0);
    expect(reviewQueue.some(entry => entry.id === 'client-inbox-legacy-aliases')).toBe(true);
    expect(reviewQueue.some(entry => entry.id === 'prospect-tooling')).toBe(true);
    expect(reviewQueue.some(entry => entry.id === 'ai-usage-ledger')).toBe(true);
  });

  it('enforces human verification for deprecations and first-class demotions', () => {
    const policyGaps = findProductSurfacePolicyGaps();
    expect(policyGaps).toEqual([]);
  });

  it('builds stable advisory report output', () => {
    const report = buildProductSurfaceReport();

    expect(report.generatedBy).toBe('scripts/product-surface-map.ts');
    expect(report.totalCapabilities).toBe(PRODUCT_SURFACE_MAP.length);
    expect(report.coverageGaps).toEqual([]);
    expect(report.policyGaps).toEqual([]);
    expect(report.humanReviewRequired).toBeGreaterThan(0);
    expect(report.counts.recommendations['hide-behind-progressive-disclosure']).toBeGreaterThan(0);
    expect(report.counts.recommendations['deprecate-after-redirect-window']).toBeGreaterThan(0);
  });

  it('formats markdown output for review docs', () => {
    const markdown = formatProductSurfaceReportAsMarkdown();

    expect(markdown).toContain('# Product Surface Map');
    expect(markdown).toContain('## Human Verification Queue');
    expect(markdown).toContain('Coverage gaps: 0');
    expect(markdown).toContain('Policy gaps: 0');
    expect(markdown).toContain('Client Inbox (Decisions, Conversations, Reviews)');
  });
});
