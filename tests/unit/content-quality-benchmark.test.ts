import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  benchmarkCaseSchema,
  buildBenchmarkReport,
  evaluateCandidateHtml,
  parseBenchmarkCli,
  runBenchmarkCli,
} from '../../scripts/content-quality-benchmark.js';

const SECRET_REFERENCE = '<h2>Private approved client copy</h2><p>A precise, verified promise.</p>';
const SECRET_MODEL = 'private-model-identity';
const SECRET_PROVIDER = 'private-provider-identity';

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function candidate(anonymousLabel: string, options: {
  html?: string;
  cost?: number;
  durationMs?: number;
  promptTokens?: number;
} = {}) {
  return {
    anonymousLabel,
    html: options.html ?? '<h2>Useful answer</h2><p>Clear, grounded copy for the reader.</p>',
    provenance: {
      operation: 'content-matrix-item-generate',
      provider: SECRET_PROVIDER,
      model: SECRET_MODEL,
      inputFingerprint: 'b'.repeat(64),
      durationMs: options.durationMs ?? 1_000,
      promptTokens: options.promptTokens ?? 1_000,
      completionTokens: 500,
      estimatedCostUsd: options.cost ?? 1,
    },
  };
}

function benchmarkCase(index: number, candidateB: Parameters<typeof candidate>[1] = {}) {
  return {
    schemaVersion: 1,
    caseId: `case_${String(index).padStart(3, '0')}`,
    pageType: (['service', 'location', 'landing'] as const)[(index - 1) % 3],
    generationRoleCoverage: ['proof', 'faq', 'cta'],
    verticalSensitivity: 'provenance_sensitive',
    searchIntent: 'transactional',
    primaryQueryClass: 'local_service_transactional',
    reference: {
      kind: 'matrix_approved_post',
      contentSha256: digest(SECRET_REFERENCE),
      approvalKind: 'human_approved',
      approvedAt: '2026-07-19T12:00:00.000Z',
      sourceRevision: 3,
    },
    referenceHtml: SECRET_REFERENCE,
    candidateVariants: [
      candidate('candidate_a', { cost: 2, promptTokens: 2_000 }),
      candidate('candidate_b', { cost: 1.5, promptTokens: 1_800, ...candidateB }),
    ],
  };
}

function humanRating(anonymousLabel: string, factualDiscipline: 'pass' | 'needs_review' | 'fail' = 'pass') {
  return {
    anonymousLabel,
    ratings: {
      brand_fidelity: anonymousLabel === 'candidate_b' ? 5 : 3,
      intent_satisfaction: anonymousLabel === 'candidate_b' ? 5 : 3,
      specificity: 4,
      naturalness: 4,
      conversion_clarity: 4,
      structural_variety: 4,
    },
    factualDiscipline,
    note: 'Private reviewer note that must not escape.',
  };
}

function comparison(caseCount = 6) {
  const cases = Array.from({ length: caseCount }, (_, index) => benchmarkCase(index + 1));
  const ratings = cases.map(testCase => ({
    caseId: testCase.caseId,
    preferredCandidate: 'candidate_b',
    humanRatings: [humanRating('candidate_a'), humanRating('candidate_b')],
  }));
  return {
    cases: { schemaVersion: 1, cases },
    ratings: { schemaVersion: 1, rubricVersion: 'v1', cases: ratings },
  };
}

describe('content quality benchmark evaluator', () => {
  it('recommends a blinded candidate only after every advisory gate passes', () => {
    const input = comparison();
    const report = buildBenchmarkReport(
      input.cases,
      input.ratings,
      'candidate_a',
      '2026-07-20T12:00:00.000Z',
    );

    expect(report.recommendation).toBe('candidate');
    expect(report.ratingCoverage).toBe(100);
    expect(report.candidates.find(item => item.anonymousLabel === 'candidate_b')).toMatchObject({
      preferenceRate: 100,
      factualNeedsReview: 0,
      factualFailures: 0,
      deterministicFailures: 0,
      meanEstimatedCostUsd: 1.5,
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(SECRET_REFERENCE);
    expect(serialized).not.toContain(SECRET_MODEL);
    expect(serialized).not.toContain(SECRET_PROVIDER);
    expect(serialized).not.toContain('Private reviewer note');
    expect(report.candidates.find(item => item.anonymousLabel === 'candidate_b')).toMatchObject({
      meanPromptTokens: 1_800,
      meanCompletionTokens: 500,
    });
  });

  it('returns no recommendation below six completely rated cases', () => {
    const input = comparison(5);
    const report = buildBenchmarkReport(input.cases, input.ratings, 'candidate_a');
    expect(report.recommendation).toBe('no_recommendation');

    const sixCases = comparison(6);
    sixCases.ratings.cases[5].humanRatings.pop();
    const incomplete = buildBenchmarkReport(sixCases.cases, sixCases.ratings, 'candidate_a');
    expect(incomplete.recommendation).toBe('no_recommendation');
    expect(incomplete.ratingCoverage).toBeLessThan(100);

    const undiverse = comparison(6);
    undiverse.cases.cases.forEach(testCase => { testCase.pageType = 'service'; });
    expect(buildBenchmarkReport(undiverse.cases, undiverse.ratings, 'candidate_a')).toMatchObject({
      recommendation: 'no_recommendation',
      recommendationReason: expect.stringMatching(/three page types/i),
    });
  });

  it('keeps the baseline when factual or deterministic safety fails', () => {
    const input = comparison();
    input.ratings.cases[0].humanRatings[1] = humanRating('candidate_b', 'fail');
    input.cases.cases[1].candidateVariants[1].html = '<h2></h2><script>alert(1)</script>';

    const report = buildBenchmarkReport(input.cases, input.ratings, 'candidate_a');
    expect(report.recommendation).toBe('baseline');
    expect(report.candidates.find(item => item.anonymousLabel === 'candidate_b')).toMatchObject({
      factualFailures: 1,
      deterministicFailures: 3,
    });
  });

  it('treats factual uncertainty and non-ready runtime verdicts as blocking safety results', () => {
    const uncertain = comparison();
    uncertain.ratings.cases[0].humanRatings[1] = humanRating('candidate_b', 'needs_review');
    const uncertainReport = buildBenchmarkReport(uncertain.cases, uncertain.ratings, 'candidate_a');
    expect(uncertainReport.recommendation).toBe('baseline');
    expect(uncertainReport.candidates.find(item => item.anonymousLabel === 'candidate_b')).toMatchObject({
      factualNeedsReview: 1,
    });

    const runtimeBlocked = comparison();
    runtimeBlocked.cases.cases[0].candidateVariants[1].runtimeAudit = {
      authorityFingerprint: 'c'.repeat(64),
      verdict: 'needs_attention',
      deterministicChecks: [],
    };
    const runtimeReport = buildBenchmarkReport(runtimeBlocked.cases, runtimeBlocked.ratings, 'candidate_a');
    expect(runtimeReport.recommendation).toBe('baseline');
    expect(runtimeReport.cases[0].deterministicFailureCount).toBe(1);
  });

  it('uses unrounded cost and latency metrics for promotion decisions', () => {
    const costlier = comparison();
    costlier.cases.cases.forEach(testCase => {
      testCase.candidateVariants[0].provenance.estimatedCostUsd = 2.001;
      testCase.candidateVariants[1].provenance.estimatedCostUsd = 2.004;
    });
    const costReport = buildBenchmarkReport(costlier.cases, costlier.ratings, 'candidate_a');
    expect(costReport.candidates.map(item => item.meanEstimatedCostUsd)).toEqual([2, 2]);
    expect(costReport.recommendation).toBe('baseline');

    const slower = comparison();
    slower.cases.cases.forEach(testCase => {
      testCase.candidateVariants[0].provenance.durationMs = 1_000;
      testCase.candidateVariants[1].provenance.durationMs = 1_001;
    });
    expect(buildBenchmarkReport(slower.cases, slower.ratings, 'candidate_a').recommendation).toBe('baseline');
  });

  it('uses canonical HTML extraction for generic safety checks', () => {
    const checks = evaluateCandidateHtml(candidate('candidate_a', {
      html: '<h2>Heading</h2><table><tr><td>Cell</td></tr></table><a href="javascript:alert(1)">bad</a>',
    }));
    expect(checks.find(item => item.id === 'nonempty-copy')?.status).toBe('pass');
    expect(checks.find(item => item.id === 'semantic-table-shape')?.status).toBe('pass');
    expect(checks.find(item => item.id === 'safe-link-schemes')?.status).toBe('fail');
    expect(evaluateCandidateHtml(candidate('candidate_a', { html: '' }))[0]).toMatchObject({
      id: 'nonempty-copy',
      status: 'fail',
    });

    const canonical = candidate('candidate_a');
    canonical.runtimeAudit = {
      authorityFingerprint: 'c'.repeat(64),
      verdict: 'needs_attention',
      deterministicChecks: [
        { id: 'internal-paths', result: 'failed' },
        { id: 'factual-accuracy', result: 'needs_human_review' },
      ],
    };
    expect(evaluateCandidateHtml(canonical)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'matrix:verdict', status: 'fail' }),
      expect.objectContaining({ id: 'matrix:internal-paths', status: 'fail' }),
      expect.objectContaining({ id: 'matrix:factual-accuracy', status: 'review' }),
    ]));
  });

  it('does not recommend an unsafe baseline when no safe candidate qualifies', () => {
    const input = comparison();
    input.cases.cases.forEach(testCase => {
      testCase.candidateVariants[0].html = '<script>alert(1)</script>';
      testCase.candidateVariants[1].html = '<script>alert(1)</script>';
    });
    expect(buildBenchmarkReport(input.cases, input.ratings, 'candidate_a')).toMatchObject({
      recommendation: 'no_recommendation',
    });
  });

  it('fails closed for stale approval hashes, identity-shaped fields, and unblinded labels', () => {
    const input = comparison();
    input.cases.cases[0].reference.contentSha256 = 'c'.repeat(64);
    expect(() => buildBenchmarkReport(input.cases, input.ratings, 'candidate_a')).toThrow(/hash mismatch/i);

    const withWorkspaceIdentity = { ...benchmarkCase(1), workspaceId: 'ws_private' };
    expect(benchmarkCaseSchema.safeParse(withWorkspaceIdentity).success).toBe(false);
    expect(benchmarkCaseSchema.safeParse({ ...benchmarkCase(1), caseId: 'case_rinse_whitening_sarasota' }).success).toBe(false);
    const unblinded = benchmarkCase(1);
    unblinded.candidateVariants[0].anonymousLabel = 'candidate_baseline';
    expect(benchmarkCaseSchema.safeParse(unblinded).success).toBe(false);

    const unapprovedMatrixReference = benchmarkCase(1);
    unapprovedMatrixReference.reference.approvalKind = 'operator_attested';
    expect(benchmarkCaseSchema.safeParse(unapprovedMatrixReference).success).toBe(false);
    const revisionlessMatrixReference = benchmarkCase(1);
    const { sourceRevision: _omittedRevision, ...referenceWithoutRevision } = revisionlessMatrixReference.reference;
    Object.assign(revisionlessMatrixReference, { reference: referenceWithoutRevision });
    expect(benchmarkCaseSchema.safeParse(revisionlessMatrixReference).success).toBe(false);
  });

  it('rejects unsafe and unknown CLI flags', () => {
    expect(() => parseBenchmarkCli(['--sync-staging'])).toThrow(/unsafe benchmark flag/i);
    expect(() => parseBenchmarkCli(['--generate=true'])).toThrow(/unsafe benchmark flag/i);
    expect(() => parseBenchmarkCli(['--mystery', 'value'])).toThrow(/unknown benchmark flag/i);
  });

  it('reads private inputs and writes only the safe aggregate to an explicit local path', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'content-quality-benchmark-'));
    try {
      const input = comparison();
      const casesPath = path.join(directory, 'cases.json');
      const ratingsPath = path.join(directory, 'ratings.json');
      const outputPath = path.join(directory, 'report.json');
      await writeFile(casesPath, JSON.stringify(input.cases), 'utf8');
      await writeFile(ratingsPath, JSON.stringify(input.ratings), 'utf8');

      const written = await runBenchmarkCli([
        '--cases', casesPath,
        '--ratings', ratingsPath,
        '--baseline-label', 'candidate_a',
        '--output', outputPath,
      ]);
      const output = await readFile(written, 'utf8');
      expect(JSON.parse(output)).toMatchObject({ recommendation: 'candidate', caseCount: 6 });
      expect(output).not.toContain(SECRET_REFERENCE);
      expect(output).not.toContain(SECRET_MODEL);
      expect(output).not.toContain(SECRET_PROVIDER);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite either private input and preserves both files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'content-quality-benchmark-collision-'));
    try {
      const input = comparison();
      const casesPath = path.join(directory, 'cases.json');
      const ratingsPath = path.join(directory, 'ratings.json');
      const privateCases = JSON.stringify(input.cases);
      const privateRatings = JSON.stringify(input.ratings);
      await writeFile(casesPath, privateCases, 'utf8');
      await writeFile(ratingsPath, privateRatings, 'utf8');

      await expect(runBenchmarkCli([
        '--cases', casesPath,
        '--ratings', ratingsPath,
        '--baseline-label', 'candidate_a',
        '--output', casesPath,
      ])).rejects.toThrow(/must not overwrite/i);
      await expect(readFile(casesPath, 'utf8')).resolves.toBe(privateCases);
      await expect(readFile(ratingsPath, 'utf8')).resolves.toBe(privateRatings);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
