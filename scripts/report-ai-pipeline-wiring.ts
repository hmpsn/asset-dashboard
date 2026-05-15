#!/usr/bin/env tsx

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  type AiPipelineWiringCheck,
  type AiPipelineWiringReport,
} from '../shared/types/ai-reliability.js';
import {
  AI_CRITICAL_PIPELINE_TRACES,
  findAiReliabilityRegistryGaps,
} from './ai-reliability-registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function safeRead(relativePath: string): string {
  const absolutePath = path.resolve(ROOT, relativePath);
  if (!existsSync(absolutePath)) return '';
  return readFileSync(absolutePath, 'utf8');
}

function lower(s: string): string {
  return s.toLowerCase();
}

function missingFiles(required: string[]): string[] {
  return required.filter(file => !existsSync(path.resolve(ROOT, file)));
}

function checkQueryKeyPresence(queryTargets: string[]): string[] {
  if (queryTargets.length === 0) return [];
  const keySource = lower(safeRead('src/lib/queryKeys.ts'));
  return queryTargets.filter(token => {
    const normalized = lower(token.trim());
    if (keySource.includes(normalized)) return false;

    // queryKeys.admin.fooBar -> look for "fooBar:" inside queryKeys.ts
    const keyName = normalized.replace(/^querykeys\.(admin|client|shared)\./, '');
    if (keyName !== normalized) {
      const fieldPattern = new RegExp(`\\b${keyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
      return !fieldPattern.test(keySource);
    }

    return true;
  });
}

function checkEventPresence(events: string[]): string[] {
  if (events.length === 0) return [];
  const wsEventsSource = lower(safeRead('server/ws-events.ts'));
  return events.filter(eventName => !wsEventsSource.includes(lower(eventName)));
}

function checkSignalPresence(requiredSignals: string[], files: string[]): string[] {
  if (requiredSignals.length === 0) return [];
  const merged = lower(files.map(file => safeRead(file)).join('\n'));

  // Descriptive labels are intentionally high-level and may not map to one exact code literal.
  const descriptiveSignals = new Set([
    'zod schema validation',
    'zod route validation',
    'state-machine guards',
    'response-shape contract tests',
  ]);

  return requiredSignals.filter(token => {
    const normalized = lower(token.trim());
    if (descriptiveSignals.has(normalized)) return false;
    return !merged.includes(normalized);
  });
}

function buildCheck(trace: typeof AI_CRITICAL_PIPELINE_TRACES[number]): AiPipelineWiringCheck {
  return {
    pipelineId: trace.id,
    routeCoverage: {
      required: [...trace.entryRoutes],
      missing: missingFiles(trace.entryRoutes),
    },
    dispatcherCoverage: {
      required: [...trace.dispatcherModules],
      missing: missingFiles(trace.dispatcherModules),
    },
    promptAssemblyCoverage: {
      required: [...trace.promptAssemblyModules],
      missing: missingFiles(trace.promptAssemblyModules),
    },
    parserSignalCoverage: {
      required: [...trace.parserOrValidationSignals],
      missing: checkSignalPresence(
        trace.parserOrValidationSignals,
        [...trace.entryRoutes, ...trace.promptAssemblyModules, ...trace.dispatcherModules],
      ),
    },
    eventCoverage: {
      required: [...trace.wsEvents],
      missing: checkEventPresence(trace.wsEvents),
    },
    queryKeyCoverage: {
      required: [...trace.queryInvalidationTargets],
      missing: checkQueryKeyPresence(trace.queryInvalidationTargets),
    },
    testSignalCoverage: {
      required: [...trace.existingTestSignals],
      missing: missingFiles(trace.existingTestSignals),
    },
  };
}

function collectGaps(checks: AiPipelineWiringCheck[]): Array<{ pipelineId: string; issue: string }> {
  const gaps: Array<{ pipelineId: string; issue: string }> = [];
  const registryGaps = findAiReliabilityRegistryGaps();
  for (const gap of registryGaps) {
    gaps.push({ pipelineId: 'registry', issue: gap });
  }

  for (const check of checks) {
    const groups: Array<keyof AiPipelineWiringCheck> = [
      'routeCoverage',
      'dispatcherCoverage',
      'promptAssemblyCoverage',
      'parserSignalCoverage',
      'eventCoverage',
      'queryKeyCoverage',
      'testSignalCoverage',
    ];

    for (const group of groups) {
      const missing = check[group].missing;
      for (const item of missing) {
        gaps.push({ pipelineId: check.pipelineId, issue: `${group} missing ${item}` });
      }
    }
  }

  return gaps;
}

export function buildAiPipelineWiringReport(): AiPipelineWiringReport {
  const checks = AI_CRITICAL_PIPELINE_TRACES.map(buildCheck);
  return {
    generatedBy: 'scripts/report-ai-pipeline-wiring.ts',
    generatedAt: new Date().toISOString(),
    advisoryOnly: true,
    tracesExpected: AI_CRITICAL_PIPELINE_TRACES.map(trace => trace.id),
    checks,
    gaps: collectGaps(checks),
  };
}

export function formatAiPipelineWiringMarkdown(
  report: AiPipelineWiringReport = buildAiPipelineWiringReport(),
): string {
  const lines: string[] = [
    '# AI Pipeline Wiring Report',
    '',
    '_Read-only advisory report. Gaps do not fail the command._',
    '',
    `Pipelines expected: ${report.tracesExpected.length}`,
    `Wiring gaps: ${report.gaps.length}`,
    '',
    '| Pipeline | Route files | Dispatch files | Prompt modules | Missing parser signals | Missing events | Missing query keys | Missing tests |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const check of report.checks) {
    lines.push(
      `| \`${check.pipelineId}\` | ${check.routeCoverage.missing.length}/${check.routeCoverage.required.length} missing | ${check.dispatcherCoverage.missing.length}/${check.dispatcherCoverage.required.length} missing | ${check.promptAssemblyCoverage.missing.length}/${check.promptAssemblyCoverage.required.length} missing | ${check.parserSignalCoverage.missing.length} | ${check.eventCoverage.missing.length} | ${check.queryKeyCoverage.missing.length} | ${check.testSignalCoverage.missing.length}/${check.testSignalCoverage.required.length} missing |`,
    );
  }

  if (report.gaps.length > 0) {
    lines.push('', '## Gaps', '');
    for (const gap of report.gaps) {
      lines.push(`- \`${gap.pipelineId}\`: ${gap.issue}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function runCli(): void {
  const report = buildAiPipelineWiringReport();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(formatAiPipelineWiringMarkdown(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
