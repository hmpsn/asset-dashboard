#!/usr/bin/env tsx

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CANONICAL_BOUNDED_CONTEXTS,
  buildPlatformDomainSmokeReport,
} from './platform-domain-smoke-matrix.js';
import {
  CURRENT_GLOBAL_COVERAGE,
  buildCriticalDomainCoverageReport,
  type CoverageMetric,
} from './report-critical-domain-coverage.js';

export type CoverageRatchetFloor = Record<CoverageMetric, number>;

export const COVERAGE_RATCHET_FLOORS: CoverageRatchetFloor = {
  lines: 30.0,
  statements: 28.5,
  branches: 22.5,
  functions: 22.0,
};

type CoverageSummaryNode = {
  total?: number;
  covered?: number;
  skipped?: number;
  pct?: number;
};

type CoverageSummaryFile = {
  total?: Partial<Record<CoverageMetric, CoverageSummaryNode>>;
};

export type CoverageRatchetMetricResult = {
  metric: CoverageMetric;
  current: number;
  floor: number;
  baseline: number;
  deltaFromFloor: number;
  deltaFromBaseline: number;
  status: 'pass' | 'fail';
};

export type CoverageRatchetDomainSignalResult = {
  contextId: string;
  hasCoverageBaselineEntry: boolean;
  hasSmokeMatrixEntry: boolean;
  hasExistingSignals: boolean;
  hasSmokeCommand: boolean;
  status: 'pass' | 'fail';
};

export type CoverageRatchetReport = {
  generatedBy: 'scripts/report-coverage-ratchet.ts';
  summaryPath: string;
  floors: CoverageRatchetFloor;
  baseline: Record<CoverageMetric, number>;
  current: Record<CoverageMetric, number>;
  metricResults: CoverageRatchetMetricResult[];
  failingMetrics: CoverageMetric[];
  domainSignalResults: CoverageRatchetDomainSignalResult[];
  failingDomainSignals: string[];
  advisoryDomainSignals: true;
  pass: boolean;
};

function parseArgs(argv: string[]): { summaryPath: string; json: boolean; advisory: boolean } {
  let summaryPath = 'coverage/coverage-summary.json';
  let json = false;
  let advisory = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--advisory') {
      advisory = true;
      continue;
    }
    if (arg === '--summary') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --summary');
      }
      summaryPath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { summaryPath, json, advisory };
}

function assertNodeHasPct(metric: CoverageMetric, node: CoverageSummaryNode | undefined): number {
  if (!node || typeof node.pct !== 'number' || Number.isNaN(node.pct)) {
    throw new Error(`Invalid coverage summary: missing total.${metric}.pct`);
  }
  return node.pct;
}

export function readCoverageSummaryPercentages(summaryPath: string): Record<CoverageMetric, number> {
  const resolvedPath = path.resolve(summaryPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Coverage summary not found at ${resolvedPath}. Run "npm run test:coverage" first.`);
  }

  const parsed = JSON.parse(readFileSync(resolvedPath, 'utf8')) as CoverageSummaryFile;
  const total = parsed.total;
  if (!total) {
    throw new Error(`Invalid coverage summary at ${resolvedPath}: missing "total" object`);
  }

  return {
    lines: assertNodeHasPct('lines', total.lines),
    statements: assertNodeHasPct('statements', total.statements),
    branches: assertNodeHasPct('branches', total.branches),
    functions: assertNodeHasPct('functions', total.functions),
  };
}

export function buildCoverageRatchetReport(
  current: Record<CoverageMetric, number>,
  summaryPath: string,
  floors: CoverageRatchetFloor = COVERAGE_RATCHET_FLOORS,
): CoverageRatchetReport {
  const baseline: Record<CoverageMetric, number> = {
    lines: CURRENT_GLOBAL_COVERAGE.lines,
    statements: CURRENT_GLOBAL_COVERAGE.statements,
    branches: CURRENT_GLOBAL_COVERAGE.branches,
    functions: CURRENT_GLOBAL_COVERAGE.functions,
  };

  const metricResults: CoverageRatchetMetricResult[] = (Object.keys(floors) as CoverageMetric[]).map(metric => {
    const floor = floors[metric];
    const currentValue = current[metric];
    const baselineValue = baseline[metric];
    const deltaFromFloor = Number((currentValue - floor).toFixed(2));
    const deltaFromBaseline = Number((currentValue - baselineValue).toFixed(2));
    return {
      metric,
      current: currentValue,
      floor,
      baseline: baselineValue,
      deltaFromFloor,
      deltaFromBaseline,
      status: currentValue >= floor ? 'pass' : 'fail',
    };
  });

  const failingMetrics = metricResults
    .filter(result => result.status === 'fail')
    .map(result => result.metric);

  const coverageReport = buildCriticalDomainCoverageReport();
  const smokeReport = buildPlatformDomainSmokeReport();

  const domainSignalResults: CoverageRatchetDomainSignalResult[] = CANONICAL_BOUNDED_CONTEXTS.map(contextId => {
    const coverageEntry = coverageReport.entries.find(entry => entry.contextId === contextId);
    const smokeEntry = smokeReport.entries.find(entry => entry.contextId === contextId);
    const result: CoverageRatchetDomainSignalResult = {
      contextId,
      hasCoverageBaselineEntry: Boolean(coverageEntry),
      hasSmokeMatrixEntry: Boolean(smokeEntry),
      hasExistingSignals: Boolean(coverageEntry && coverageEntry.existingTestSignals.length > 0),
      hasSmokeCommand: Boolean(smokeEntry && smokeEntry.testCommand.trim().length > 0),
      status: 'pass',
    };

    if (!result.hasCoverageBaselineEntry || !result.hasSmokeMatrixEntry || !result.hasExistingSignals || !result.hasSmokeCommand) {
      result.status = 'fail';
    }

    return result;
  });

  const failingDomainSignals = domainSignalResults
    .filter(result => result.status === 'fail')
    .map(result => result.contextId);

  return {
    generatedBy: 'scripts/report-coverage-ratchet.ts',
    summaryPath: path.resolve(summaryPath),
    floors: { ...floors },
    baseline,
    current,
    metricResults,
    failingMetrics,
    domainSignalResults,
    failingDomainSignals,
    advisoryDomainSignals: true,
    pass: failingMetrics.length === 0,
  };
}

export function formatCoverageRatchetReportAsMarkdown(report: CoverageRatchetReport): string {
  const lines = [
    '# Coverage Ratchet Report',
    '',
    '_Global metric floors are enforced. Domain signal gaps are advisory._',
    '',
    `Summary source: \`${report.summaryPath}\``,
    `Result: ${report.pass ? 'PASS' : 'FAIL'}`,
    '',
    '| Metric | Current | Floor | Baseline | Delta vs floor | Delta vs baseline | Status |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const result of report.metricResults) {
    lines.push(
      `| ${result.metric} | ${result.current.toFixed(2)}% | ${result.floor.toFixed(2)}% | ${result.baseline.toFixed(2)}% | ${result.deltaFromFloor.toFixed(2)} | ${result.deltaFromBaseline.toFixed(2)} | ${result.status.toUpperCase()} |`,
    );
  }

  lines.push('', `Failing metrics: ${report.failingMetrics.length}`);
  if (report.failingMetrics.length > 0) {
    lines.push(`- ${report.failingMetrics.join(', ')}`);
  }

  lines.push('', '## Domain Signal Guardrails (Advisory)', '', `Failing contexts: ${report.failingDomainSignals.length}`);
  if (report.failingDomainSignals.length > 0) {
    for (const contextId of report.failingDomainSignals) {
      lines.push(`- ${contextId}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function runCli(): void {
  const args = parseArgs(process.argv.slice(2));
  const current = readCoverageSummaryPercentages(args.summaryPath);
  const report = buildCoverageRatchetReport(current, args.summaryPath);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatCoverageRatchetReportAsMarkdown(report));
  }

  if (!report.pass && !args.advisory) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
