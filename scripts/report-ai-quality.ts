#!/usr/bin/env tsx

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  AI_QUALITY_PIPELINE_IDS,
  type AiQualityFixture,
  type AiQualityFixtureResult,
  type AiQualityPipelineId,
  type AiQualityPipelineScore,
  type AiQualityReport,
} from '../shared/types/ai-reliability.js';
import {
  AI_QUALITY_FIXTURES,
  findAiQualityFixtureGaps,
  getPipelineTitleMap,
} from './ai-reliability-registry.js';
import { aiEvidenceMatchesAssertion } from './ai-evidence-matching.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUALITY_WARNING_SCORE = 90;

function readLower(relativePath: string): string | null {
  const absolutePath = path.resolve(ROOT, relativePath);
  if (!existsSync(absolutePath)) return null;
  return readFileSync(absolutePath, 'utf8').toLowerCase();
}

function evaluateFixture(fixture: AiQualityFixture): AiQualityFixtureResult {
  const missingFiles: string[] = [];
  const sourceParts: string[] = [];

  for (const file of fixture.evidenceFiles) {
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

  for (const assertion of fixture.assertions) {
    const passed = aiEvidenceMatchesAssertion(merged, assertion);
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

  const assertionCount = Math.max(fixture.assertions.length, 1);
  const score = Math.round((passedAssertions / assertionCount) * 100);
  const passed = missingFiles.length === 0 && reasons.length === 0;

  return {
    fixtureId: fixture.id,
    pipelineId: fixture.pipelineId,
    dimension: fixture.dimension,
    severity: fixture.severity,
    passed,
    score: passed ? 100 : score,
    reasons,
    evidenceFiles: [...fixture.evidenceFiles],
  };
}

function buildQualityPipelineScores(
  results: AiQualityFixtureResult[],
  expectedPipelineIds: readonly AiQualityPipelineId[],
): AiQualityPipelineScore[] {
  const titleMap = getPipelineTitleMap();
  const byPipeline = new Map<AiQualityPipelineId, AiQualityFixtureResult[]>();

  for (const result of results) {
    const bucket = byPipeline.get(result.pipelineId) ?? [];
    bucket.push(result);
    byPipeline.set(result.pipelineId, bucket);
  }

  return expectedPipelineIds.map(pipelineId => {
    const pipelineResults = byPipeline.get(pipelineId) ?? [];
    const total = pipelineResults.length;
    const passed = pipelineResults.filter(result => result.passed).length;
    const score = total === 0
      ? 0
      : Math.round(pipelineResults.reduce((sum, result) => sum + result.score, 0) / total);
    const dimensions = [...new Set(pipelineResults.map(result => result.dimension))].sort();

    return {
      pipelineId,
      title: titleMap[pipelineId] ?? pipelineId,
      score,
      passed,
      total,
      dimensions,
      failingFixtureIds: pipelineResults.filter(result => !result.passed).map(result => result.fixtureId),
    };
  });
}

function hasMissingEvidence(result: AiQualityFixtureResult): boolean {
  return result.reasons.some(reason => reason.startsWith('Missing evidence files:'));
}

export function buildAiQualityReport(
  fixtures: AiQualityFixture[] = AI_QUALITY_FIXTURES,
  expectedPipelineIds: readonly AiQualityPipelineId[] = AI_QUALITY_PIPELINE_IDS,
): AiQualityReport {
  const registryGaps = findAiQualityFixtureGaps(fixtures, expectedPipelineIds);
  const fixtureResults = fixtures.map(evaluateFixture);
  const pipelineScores = buildQualityPipelineScores(fixtureResults, expectedPipelineIds);
  const overallScore = pipelineScores.length === 0
    ? 0
    : Math.round(pipelineScores.reduce((sum, score) => sum + score.score, 0) / pipelineScores.length);

  const hardFailures = [
    ...registryGaps,
    ...fixtureResults
      .filter(result => hasMissingEvidence(result))
      .map(result => `${result.fixtureId}: ${result.reasons.join(' | ') || 'missing evidence'}`),
    ...fixtureResults
      .filter(result => result.severity === 'hard' && !result.passed && !hasMissingEvidence(result))
      .map(result => `${result.fixtureId}: ${result.reasons.join(' | ') || 'failed'}`),
  ];

  const warnings: string[] = [];
  for (const result of fixtureResults) {
    if (result.severity === 'soft' && !result.passed && !hasMissingEvidence(result)) {
      warnings.push(`${result.fixtureId}: ${result.reasons.join(' | ') || 'soft fixture failed'}`);
    }
  }
  for (const score of pipelineScores) {
    if (score.score < QUALITY_WARNING_SCORE) {
      warnings.push(`${score.pipelineId} quality score ${score.score} is below advisory threshold ${QUALITY_WARNING_SCORE}`);
    }
  }

  return {
    generatedBy: 'scripts/report-ai-quality.ts',
    advisoryOnly: true,
    generatedAt: new Date().toISOString(),
    fixtures: [...fixtures],
    fixtureResults,
    pipelineScores,
    overallScore,
    hardFailures,
    warnings,
  };
}

export function formatAiQualityMarkdown(report: AiQualityReport = buildAiQualityReport()): string {
  const lines: string[] = [
    '# AI Quality Fixture Report',
    '',
    '_Deterministic source/evidence report. `--soft-gate` fails only on hard failures; warnings are non-blocking._',
    '',
    `Generated at: ${report.generatedAt}`,
    `Current overall score: ${report.overallScore}`,
    `Advisory warning threshold: ${QUALITY_WARNING_SCORE}`,
    '',
    '| Pipeline | Score | Pass Count | Dimensions | Failing Fixtures |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const pipeline of report.pipelineScores) {
    lines.push(
      `| \`${pipeline.pipelineId}\` | ${pipeline.score} | ${pipeline.passed}/${pipeline.total} | ${pipeline.dimensions.join(', ') || 'none'} | ${pipeline.failingFixtureIds.join(', ') || 'none'} |`,
    );
  }

  lines.push('', '## Fixture Results', '', '| Fixture | Dimension | Severity | Status | Score |', '| --- | --- | --- | --- | --- |');
  for (const result of report.fixtureResults) {
    lines.push(
      `| \`${result.fixtureId}\` | \`${result.dimension}\` | \`${result.severity}\` | ${result.passed ? 'pass' : 'fail'} | ${result.score} |`,
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

  return `${lines.join('\n')}\n`;
}

function runCli(): void {
  const args = new Set(process.argv.slice(2));
  const report = buildAiQualityReport();
  const json = args.has('--json');
  const softGate = args.has('--soft-gate');

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatAiQualityMarkdown(report));
  }

  if (!softGate) return;
  if (report.hardFailures.length > 0) {
    console.error(`[ai-quality] hard failures: ${report.hardFailures.length}`);
    process.exit(1);
  }

  if (report.warnings.length > 0) {
    console.warn(`[ai-quality] warnings: ${report.warnings.length}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
