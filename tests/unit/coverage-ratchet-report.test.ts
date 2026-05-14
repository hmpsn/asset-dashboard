import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  COVERAGE_RATCHET_FLOORS,
  buildCoverageRatchetReport,
  formatCoverageRatchetReportAsMarkdown,
  readCoverageSummaryPercentages,
} from '../../scripts/report-coverage-ratchet.js';

function writeSummaryFile(targetPath: string, payload: unknown): void {
  writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8');
}

describe('coverage ratchet report', () => {
  const tempPaths: string[] = [];

  afterEach(() => {
    for (const dir of tempPaths) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempPaths.length = 0;
  });

  it('reads metric percentages from a coverage summary file', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'coverage-ratchet-'));
    tempPaths.push(tempDir);
    const summaryPath = path.join(tempDir, 'coverage-summary.json');

    writeSummaryFile(summaryPath, {
      total: {
        lines: { pct: 45.12 },
        statements: { pct: 43.21 },
        branches: { pct: 31.5 },
        functions: { pct: 29.7 },
      },
    });

    expect(readCoverageSummaryPercentages(summaryPath)).toEqual({
      lines: 45.12,
      statements: 43.21,
      branches: 31.5,
      functions: 29.7,
    });
  });

  it('builds a passing report when current metrics meet floors', () => {
    const current = {
      lines: COVERAGE_RATCHET_FLOORS.lines + 1,
      statements: COVERAGE_RATCHET_FLOORS.statements + 1,
      branches: COVERAGE_RATCHET_FLOORS.branches + 1,
      functions: COVERAGE_RATCHET_FLOORS.functions + 1,
    };

    const report = buildCoverageRatchetReport(current, 'coverage/coverage-summary.json');

    expect(report.pass).toBe(true);
    expect(report.failingMetrics).toEqual([]);
    expect(report.advisoryDomainSignals).toBe(true);
    expect(report.domainSignalResults).toHaveLength(12);
    expect(report.domainSignalResults.filter(result => result.status === 'pass')).toHaveLength(report.domainSignalResults.length);
  });

  it('fails when any enforced floor regresses', () => {
    const current = {
      lines: COVERAGE_RATCHET_FLOORS.lines - 0.5,
      statements: COVERAGE_RATCHET_FLOORS.statements + 1,
      branches: COVERAGE_RATCHET_FLOORS.branches + 1,
      functions: COVERAGE_RATCHET_FLOORS.functions + 1,
    };

    const report = buildCoverageRatchetReport(current, 'coverage/coverage-summary.json');

    expect(report.pass).toBe(false);
    expect(report.failingMetrics).toEqual(['lines']);
  });

  it('formats markdown for operator review', () => {
    const report = buildCoverageRatchetReport(
      {
        lines: COVERAGE_RATCHET_FLOORS.lines + 0.1,
        statements: COVERAGE_RATCHET_FLOORS.statements + 0.1,
        branches: COVERAGE_RATCHET_FLOORS.branches + 0.1,
        functions: COVERAGE_RATCHET_FLOORS.functions + 0.1,
      },
      'coverage/coverage-summary.json',
    );
    const markdown = formatCoverageRatchetReportAsMarkdown(report);

    expect(markdown).toContain('# Coverage Ratchet Report');
    expect(markdown).toContain('Result: PASS');
    expect(markdown).toContain('Domain Signal Guardrails (Advisory)');
    expect(markdown).toContain('Failing metrics: 0');
  });

  it('throws a clear error when summary file is missing', () => {
    expect(() => readCoverageSummaryPercentages('/tmp/does-not-exist-coverage-summary.json')).toThrow(
      /Coverage summary not found/,
    );
  });
});
