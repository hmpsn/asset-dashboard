import { describe, expect, it } from 'vitest';

import {
  CANONICAL_BOUNDED_CONTEXTS,
} from '../../scripts/platform-domain-smoke-matrix.js';
import {
  CRITICAL_DOMAIN_COVERAGE_BASELINE,
  CURRENT_GLOBAL_COVERAGE,
  buildCriticalDomainCoverageReport,
  findCriticalDomainCoverageGaps,
  formatCriticalDomainCoverageReportAsMarkdown,
} from '../../scripts/report-critical-domain-coverage.js';

describe('critical domain coverage report', () => {
  it('includes exactly one baseline entry for every canonical bounded context', () => {
    const actualContexts = CRITICAL_DOMAIN_COVERAGE_BASELINE.map(entry => entry.contextId).sort();
    const expectedContexts = [...CANONICAL_BOUNDED_CONTEXTS].sort();

    expect(actualContexts).toEqual(expectedContexts);
    expect(new Set(actualContexts).size).toBe(CANONICAL_BOUNDED_CONTEXTS.length);
  });

  it('emits stable advisory JSON with the current global coverage baseline', () => {
    const report = buildCriticalDomainCoverageReport();
    const parsed = JSON.parse(JSON.stringify(report, null, 2)) as typeof report;

    expect(parsed.generatedBy).toBe('scripts/report-critical-domain-coverage.ts');
    expect(parsed.advisoryOnly).toBe(true);
    expect(parsed.contextsExpected).toEqual(CANONICAL_BOUNDED_CONTEXTS);
    expect(parsed.entries.map(entry => entry.contextId)).toEqual([...CANONICAL_BOUNDED_CONTEXTS].sort());
    expect(parsed.currentGlobalCoverage).toEqual({
      measuredAt: '2026-05-13',
      lines: 32.31,
      statements: 30.66,
      branches: 24.64,
      functions: 24.3,
    });
    expect(parsed.currentGlobalCoverage).toEqual(CURRENT_GLOBAL_COVERAGE);
  });

  it('reports missing groups as advisory gaps without implying command failure', () => {
    const incomplete = CRITICAL_DOMAIN_COVERAGE_BASELINE.filter(entry => entry.contextId !== 'schema');
    const gaps = findCriticalDomainCoverageGaps(incomplete);

    expect(gaps).toContainEqual({
      contextId: 'schema',
      issue: 'Missing coverage baseline entry',
    });
    expect(buildCriticalDomainCoverageReport(incomplete).advisoryOnly).toBe(true);
  });

  it('requires each entry to name surfaces, tests, gaps, targets, and next slices', () => {
    const report = buildCriticalDomainCoverageReport();

    expect(report.gaps).toEqual([]);
    for (const entry of report.entries) {
      expect(entry.criticalSurfaces.length, `${entry.contextId} critical surfaces`).toBeGreaterThan(0);
      expect(entry.existingTestSignals.length, `${entry.contextId} existing tests`).toBeGreaterThan(0);
      expect(entry.knownGaps.length, `${entry.contextId} known gaps`).toBeGreaterThan(0);
      expect(entry.targetCoveragePosture, `${entry.contextId} target posture`).not.toHaveLength(0);
      expect(entry.recommendedNextTestSlices.length, `${entry.contextId} next slices`).toBeGreaterThan(0);
    }
  });

  it('formats markdown for human review', () => {
    const markdown = formatCriticalDomainCoverageReportAsMarkdown();

    expect(markdown).toContain('# Critical Domain Coverage Baseline');
    expect(markdown).toContain('32.31% lines');
    expect(markdown).toContain('24.30% functions');
    expect(markdown).toContain('Structural gaps: 0');
    expect(markdown).toContain('`client-portal`');
  });
});
