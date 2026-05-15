#!/usr/bin/env tsx

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  type AiCriticalPipelineId,
  type AiPipelineScore,
  type AiReliabilityReport,
  type AiReliabilityScenario,
  type AiScenarioResult,
} from '../shared/types/ai-reliability.js';
import {
  AI_CRITICAL_PIPELINE_TRACES,
  AI_RELIABILITY_BASELINE_OVERALL_SCORE,
  AI_RELIABILITY_SCENARIOS,
  AI_RELIABILITY_THRESHOLDS,
  findAiReliabilityRegistryGaps,
  getPipelineTitleMap,
} from './ai-reliability-registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readLower(relativePath: string): string | null {
  const absolutePath = path.resolve(ROOT, relativePath);
  if (!existsSync(absolutePath)) return null;
  return readFileSync(absolutePath, 'utf8').toLowerCase();
}

function evaluateScenario(scenario: AiReliabilityScenario): AiScenarioResult {
  const missingFiles: string[] = [];
  const sourceParts: string[] = [];

  for (const file of scenario.evidenceFiles) {
    const text = readLower(file);
    if (text === null) {
      missingFiles.push(file);
      continue;
    }
    sourceParts.push(text);
  }

  const reasons: string[] = [];
  if (missingFiles.length > 0) {
    reasons.push(`Missing evidence files: ${missingFiles.join(', ')}`);
  }

  const merged = sourceParts.join('\n');
  let passedAssertions = 0;

  for (const assertion of scenario.assertions) {
    const allOfOk = (assertion.allOf ?? []).every(token => merged.includes(token.toLowerCase()));
    const anyOf = assertion.anyOf ?? [];
    const anyOfOk = anyOf.length === 0 || anyOf.some(token => merged.includes(token.toLowerCase()));
    const noneOfOk = (assertion.noneOf ?? []).every(token => !merged.includes(token.toLowerCase()));
    const passed = allOfOk && anyOfOk && noneOfOk;
    if (passed) {
      passedAssertions += 1;
      continue;
    }

    reasons.push(
      [
        assertion.allOf?.length ? `allOf:[${assertion.allOf.join(', ')}]` : null,
        assertion.anyOf?.length ? `anyOf:[${assertion.anyOf.join(', ')}]` : null,
        assertion.noneOf?.length ? `noneOf:[${assertion.noneOf.join(', ')}]` : null,
      ].filter(Boolean).join(' '),
    );
  }

  const assertionCount = Math.max(scenario.assertions.length, 1);
  const score = Math.round((passedAssertions / assertionCount) * 100);
  const passed = missingFiles.length === 0 && reasons.length === 0;

  return {
    scenarioId: scenario.id,
    pipelineId: scenario.pipelineId,
    failureClass: scenario.failureClass,
    severity: scenario.severity,
    passed,
    score: passed ? 100 : score,
    reasons,
    evidenceFiles: [...scenario.evidenceFiles],
  };
}

function buildPipelineScores(results: AiScenarioResult[]): AiPipelineScore[] {
  const titleMap = getPipelineTitleMap();
  const byPipeline = new Map<AiCriticalPipelineId, AiScenarioResult[]>();

  for (const result of results) {
    const bucket = byPipeline.get(result.pipelineId) ?? [];
    bucket.push(result);
    byPipeline.set(result.pipelineId, bucket);
  }

  const scores: AiPipelineScore[] = [];
  for (const trace of AI_CRITICAL_PIPELINE_TRACES) {
    const pipelineResults = byPipeline.get(trace.id) ?? [];
    const total = pipelineResults.length;
    const passed = pipelineResults.filter(result => result.passed).length;
    const score = total === 0
      ? 0
      : Math.round(pipelineResults.reduce((sum, result) => sum + result.score, 0) / total);

    scores.push({
      pipelineId: trace.id,
      title: titleMap[trace.id] ?? trace.title,
      score,
      passed,
      total,
      failingScenarioIds: pipelineResults.filter(result => !result.passed).map(result => result.scenarioId),
    });
  }

  return scores;
}

function rankedOptimizationBacklog(results: AiScenarioResult[]): AiReliabilityReport['optimizationBacklog'] {
  const failedByPipeline = new Map<AiCriticalPipelineId, string[]>();
  for (const result of results) {
    if (result.passed) continue;
    const bucket = failedByPipeline.get(result.pipelineId) ?? [];
    bucket.push(result.scenarioId);
    failedByPipeline.set(result.pipelineId, bucket);
  }

  return AI_CRITICAL_PIPELINE_TRACES.map((trace, index) => ({
    id: `opt-ai-${String(index + 1).padStart(3, '0')}`,
    priority: (() => {
      const failures = failedByPipeline.get(trace.id)?.length ?? 0;
      if (failures >= 2) return 'P0';
      if (failures === 1) return 'P1';
      return 'P2';
    })(),
    pipelineId: trace.id,
    recommendation: `Tighten ${trace.title.toLowerCase()} reliability contracts across parsing, provider failure handling, and side-effect hygiene.`,
    evidenceScenarioIds: failedByPipeline.get(trace.id) ?? [],
  }));
}

export function buildAiReliabilityReport(
  scenarios: AiReliabilityScenario[] = AI_RELIABILITY_SCENARIOS,
): AiReliabilityReport {
  const registryGaps = findAiReliabilityRegistryGaps();
  const scenarioResults = scenarios.map(evaluateScenario);
  const pipelineScores = buildPipelineScores(scenarioResults);
  const overallScore = pipelineScores.length === 0
    ? 0
    : Math.round(pipelineScores.reduce((sum, score) => sum + score.score, 0) / pipelineScores.length);

  const hardFailures = [
    ...registryGaps,
    ...scenarioResults
      .filter(result => result.severity === 'hard' && !result.passed)
      .map(result => `${result.scenarioId}: ${result.reasons.join(' | ') || 'failed'}`),
  ];

  const warnings: string[] = [];
  for (const score of pipelineScores) {
    if (score.score < AI_RELIABILITY_THRESHOLDS.minDomainScore) {
      warnings.push(
        `${score.pipelineId} score ${score.score} is below domain threshold ${AI_RELIABILITY_THRESHOLDS.minDomainScore}`,
      );
    }
  }
  if (overallScore < AI_RELIABILITY_THRESHOLDS.minOverallScore) {
    warnings.push(`Overall score ${overallScore} is below threshold ${AI_RELIABILITY_THRESHOLDS.minOverallScore}`);
  }

  const drop = AI_RELIABILITY_BASELINE_OVERALL_SCORE - overallScore;
  if (drop > AI_RELIABILITY_THRESHOLDS.maxRegressionDrop) {
    warnings.push(
      `Overall score regressed ${drop} points from baseline ${AI_RELIABILITY_BASELINE_OVERALL_SCORE}`,
    );
  }

  return {
    generatedBy: 'scripts/report-ai-reliability.ts',
    advisoryOnly: true,
    generatedAt: new Date().toISOString(),
    thresholds: { ...AI_RELIABILITY_THRESHOLDS },
    baselineOverallScore: AI_RELIABILITY_BASELINE_OVERALL_SCORE,
    traces: [...AI_CRITICAL_PIPELINE_TRACES],
    scenarioResults,
    pipelineScores,
    overallScore,
    hardFailures,
    warnings,
    optimizationBacklog: rankedOptimizationBacklog(scenarioResults),
  };
}

export function formatAiReliabilityMarkdown(report: AiReliabilityReport = buildAiReliabilityReport()): string {
  const lines: string[] = [
    '# AI Reliability Harness Report',
    '',
    '_Advisory-first report. Hard failures fail `--soft-gate`; warnings are non-blocking._',
    '',
    `Generated at: ${report.generatedAt}`,
    `Baseline overall score: ${report.baselineOverallScore}`,
    `Current overall score: ${report.overallScore}`,
    `Domain threshold: ${report.thresholds.minDomainScore}`,
    `Overall threshold: ${report.thresholds.minOverallScore}`,
    `Max regression drop: ${report.thresholds.maxRegressionDrop}`,
    '',
    '| Pipeline | Score | Pass Count | Failing Scenarios |',
    '| --- | --- | --- | --- |',
  ];

  for (const pipeline of report.pipelineScores) {
    lines.push(
      `| \`${pipeline.pipelineId}\` | ${pipeline.score} | ${pipeline.passed}/${pipeline.total} | ${pipeline.failingScenarioIds.join(', ') || 'none'} |`,
    );
  }

  lines.push('', '## Scenario Results', '', '| Scenario | Class | Severity | Status | Score |', '| --- | --- | --- | --- | --- |');
  for (const result of report.scenarioResults) {
    lines.push(
      `| \`${result.scenarioId}\` | \`${result.failureClass}\` | \`${result.severity}\` | ${result.passed ? 'pass' : 'fail'} | ${result.score} |`,
    );
  }

  if (report.hardFailures.length > 0) {
    lines.push('', '## Hard Failures', '');
    for (const failure of report.hardFailures) lines.push(`- ${failure}`);
  }

  if (report.warnings.length > 0) {
    lines.push('', '## Warnings', '');
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  lines.push('', '## Ranked Optimization Backlog', '');
  for (const item of report.optimizationBacklog) {
    lines.push(
      `- [${item.priority}] \`${item.pipelineId}\` ${item.recommendation}` +
      (item.evidenceScenarioIds.length > 0 ? ` (evidence: ${item.evidenceScenarioIds.join(', ')})` : ''),
    );
  }

  return `${lines.join('\n')}\n`;
}

function runCli(): void {
  const args = new Set(process.argv.slice(2));
  const report = buildAiReliabilityReport();
  const json = args.has('--json');
  const softGate = args.has('--soft-gate');

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatAiReliabilityMarkdown(report));
  }

  if (!softGate) return;
  if (report.hardFailures.length > 0) {
    console.error(`[ai-reliability] hard failures: ${report.hardFailures.length}`);
    process.exit(1);
  }

  if (report.warnings.length > 0) {
    console.warn(`[ai-reliability] warnings: ${report.warnings.length}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
