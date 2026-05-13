import { describe, expect, it } from 'vitest';
import {
  CANONICAL_BOUNDED_CONTEXTS,
  PLATFORM_DOMAIN_SMOKE_MATRIX,
  buildPlatformDomainSmokeReport,
  findDomainSmokeMatrixGaps,
  formatPlatformDomainSmokeReportAsMarkdown,
  type CoverageGroup,
} from '../../scripts/platform-domain-smoke-matrix.js';

const REQUIRED_COVERAGE_GROUPS: CoverageGroup[] = ['route', 'read-path'];

describe('platform domain smoke matrix', () => {
  it('includes exactly one smoke entry for every canonical bounded context', () => {
    const actualContexts = PLATFORM_DOMAIN_SMOKE_MATRIX.map(entry => entry.contextId).sort();
    const expectedContexts = [...CANONICAL_BOUNDED_CONTEXTS].sort();

    expect(actualContexts).toEqual(expectedContexts);
    expect(new Set(actualContexts).size).toBe(CANONICAL_BOUNDED_CONTEXTS.length);
  });

  it('names the required confidence surfaces for every context', () => {
    for (const entry of PLATFORM_DOMAIN_SMOKE_MATRIX) {
      expect(entry.contextName, `${entry.contextId} names a human context`).not.toHaveLength(0);
      expect(entry.corePath, `${entry.contextId} names a core path`).not.toHaveLength(0);
      expect(entry.readPath, `${entry.contextId} names a read path`).not.toHaveLength(0);
      expect(entry.writePath, `${entry.contextId} names a write path or explicit non-applicable path`).not.toHaveLength(0);
      expect(entry.cacheOrRealtime, `${entry.contextId} names cache/realtime dependency`).not.toHaveLength(0);
      expect(entry.testCommand, `${entry.contextId} names a test command`).toMatch(/^npx vitest run /);
      expect(entry.knownGap, `${entry.contextId} names a known gap`).not.toHaveLength(0);

      for (const requiredGroup of REQUIRED_COVERAGE_GROUPS) {
        expect(entry.coverageGroups, `${entry.contextId} includes ${requiredGroup}`).toContain(requiredGroup);
      }
    }
  });

  it('emits stable advisory output without failing on known product gaps', () => {
    const report = buildPlatformDomainSmokeReport();
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json) as typeof report;

    expect(parsed.generatedBy).toBe('scripts/platform-domain-smoke-matrix.ts');
    expect(parsed.contextsExpected).toEqual(CANONICAL_BOUNDED_CONTEXTS);
    expect(parsed.entries.map(entry => entry.contextId)).toEqual([...CANONICAL_BOUNDED_CONTEXTS].sort());
    expect(parsed.entries.every(entry => entry.knownGap.length > 0)).toBe(true);
    expect(parsed.gaps).toEqual([]);
  });

  it('reports structural matrix gaps as advisory data', () => {
    const incomplete = PLATFORM_DOMAIN_SMOKE_MATRIX.filter(entry => entry.contextId !== 'schema');
    const gaps = findDomainSmokeMatrixGaps(incomplete);

    expect(gaps).toContainEqual({
      contextId: 'schema',
      issue: 'Missing smoke entry',
    });
  });

  it('formats markdown for human review', () => {
    const markdown = formatPlatformDomainSmokeReportAsMarkdown();

    expect(markdown).toContain('# Platform Domain Smoke Matrix');
    expect(markdown).toContain('Structural gaps: 0');
    expect(markdown).toContain('`client-portal`');
    expect(markdown).toContain('Known gap');
  });
});
