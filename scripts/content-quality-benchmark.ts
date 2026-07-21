#!/usr/bin/env tsx

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import * as cheerio from 'cheerio';
import { z } from 'zod';

import {
  countExternalResources,
  countWords,
  extractInlineScripts,
  extractLinks,
} from '../server/seo-audit-html.js';
import {
  BRIEF_PAGE_TYPES,
  TEMPLATE_SECTION_GENERATION_ROLES,
} from '../shared/types/content.js';
import {
  CONTENT_QUALITY_BENCHMARK_FACTUAL_VERDICTS,
  CONTENT_QUALITY_BENCHMARK_HUMAN_DIMENSIONS,
  CONTENT_QUALITY_BENCHMARK_REFERENCE_KINDS,
  CONTENT_QUALITY_BENCHMARK_SCHEMA_VERSION,
  CONTENT_QUALITY_BENCHMARK_VERTICAL_SENSITIVITIES,
  type ContentQualityBenchmarkAggregateReport,
  type ContentQualityBenchmarkCandidate,
  type ContentQualityBenchmarkCandidateAggregate,
  type ContentQualityBenchmarkCase,
  type ContentQualityBenchmarkDeterministicCheck,
  type ContentQualityBenchmarkHumanRating,
} from '../shared/types/content-quality-benchmark.js';

const DEFAULT_OUTPUT = 'artifacts/content-quality-benchmark/report.json';
const BLINDED_LABEL = /^candidate_[a-z0-9]{1,4}$/;
const SAFE_CASE_ID = /^case_[0-9]{3}$/;
const FORBIDDEN_FLAGS = new Set([
  '--approve', '--db-sync', '--generate', '--generation', '--persist', '--publish',
  '--retry', '--save', '--send', '--send-to-client', '--start-generation', '--sync-staging',
]);

const finiteNonnegative = z.number().finite().nonnegative();
const blindedLabelSchema = z.string().regex(
  BLINDED_LABEL,
  'Candidate labels must be opaque values such as candidate_a.',
);
const safeCaseIdSchema = z.string()
  .regex(SAFE_CASE_ID, 'Use an opaque case ID from case_001 through case_999.');
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 digest.');
const referenceSchema = z.object({
  kind: z.enum(CONTENT_QUALITY_BENCHMARK_REFERENCE_KINDS),
  contentSha256: sha256Schema,
  approvalKind: z.enum(['human_approved', 'operator_attested']),
  approvedAt: z.string().datetime(),
  sourceRevision: z.number().int().nonnegative().optional(),
}).strict();
const provenanceSchema = z.object({
  operation: z.string().trim().min(1).max(100),
  provider: z.string().trim().min(1).max(100).optional(),
  model: z.string().trim().min(1).max(100),
  inputFingerprint: sha256Schema,
  durationMs: finiteNonnegative,
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  estimatedCostUsd: finiteNonnegative,
}).strict();
const candidateSchema = z.object({
  anonymousLabel: blindedLabelSchema,
  html: z.string(),
  provenance: provenanceSchema,
  runtimeAudit: z.object({
    authorityFingerprint: sha256Schema,
    verdict: z.enum(['ready_for_human_review', 'needs_attention', 'blocked_missing_evidence']),
    deterministicChecks: z.array(z.object({
      id: z.string().trim().min(1).max(100),
      result: z.enum(['passed', 'failed', 'needs_human_review', 'not_applicable']),
    }).strict()),
  }).strict().optional(),
}).strict();

export const benchmarkCaseSchema = z.object({
  schemaVersion: z.literal(CONTENT_QUALITY_BENCHMARK_SCHEMA_VERSION),
  caseId: safeCaseIdSchema,
  pageType: z.enum(BRIEF_PAGE_TYPES),
  generationRoleCoverage: z.array(z.enum(TEMPLATE_SECTION_GENERATION_ROLES)).min(1),
  verticalSensitivity: z.enum(CONTENT_QUALITY_BENCHMARK_VERTICAL_SENSITIVITIES),
  searchIntent: z.string().trim().min(1).max(80),
  primaryQueryClass: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(80),
  reference: referenceSchema,
  referenceHtml: z.string().min(1),
  candidateVariants: z.array(candidateSchema).min(2),
}).strict().superRefine((value, ctx) => {
  const labels = value.candidateVariants.map(candidate => candidate.anonymousLabel);
  if (new Set(labels).size !== labels.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['candidateVariants'], message: 'Candidate labels must be unique.' });
  }
  if (value.reference.kind === 'matrix_approved_post'
    && (value.reference.approvalKind !== 'human_approved' || value.reference.sourceRevision === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reference'],
      message: 'Matrix references require exact human approval and a source revision.',
    });
  }
  if (value.reference.kind === 'approved_copy_sections'
    && value.reference.approvalKind !== 'human_approved') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reference', 'approvalKind'],
      message: 'Approved copy sections require human approval.',
    });
  }
});

const dimensionRatingsShape = Object.fromEntries(
  CONTENT_QUALITY_BENCHMARK_HUMAN_DIMENSIONS.map(dimension => [dimension, z.number().int().min(1).max(5)]),
) as Record<(typeof CONTENT_QUALITY_BENCHMARK_HUMAN_DIMENSIONS)[number], z.ZodNumber>;
const humanRatingSchema = z.object({
  anonymousLabel: blindedLabelSchema,
  ratings: z.object(dimensionRatingsShape).strict(),
  factualDiscipline: z.enum(CONTENT_QUALITY_BENCHMARK_FACTUAL_VERDICTS),
  editMinutes: finiteNonnegative.optional(),
  editDistanceRatio: z.number().finite().min(0).max(1).optional(),
  note: z.string().max(2_000).optional(),
}).strict();
const caseRatingsSchema = z.object({
  caseId: safeCaseIdSchema,
  preferredCandidate: blindedLabelSchema.optional(),
  humanRatings: z.array(humanRatingSchema),
}).strict().superRefine((value, ctx) => {
  const labels = value.humanRatings.map(rating => rating.anonymousLabel);
  if (new Set(labels).size !== labels.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['humanRatings'], message: 'A candidate may be rated only once per case.' });
  }
});

export const benchmarkCasesFileSchema = z.object({
  schemaVersion: z.literal(CONTENT_QUALITY_BENCHMARK_SCHEMA_VERSION),
  cases: z.array(benchmarkCaseSchema).min(1),
}).strict();
export const benchmarkRatingsFileSchema = z.object({
  schemaVersion: z.literal(CONTENT_QUALITY_BENCHMARK_SCHEMA_VERSION),
  rubricVersion: z.string().regex(/^v[1-9][0-9]*$/),
  cases: z.array(caseRatingsSchema).min(1),
}).strict();

export type BenchmarkCasesFile = z.infer<typeof benchmarkCasesFileSchema>;
export type BenchmarkRatingsFile = z.infer<typeof benchmarkRatingsFileSchema>;

function check(id: string, passed: boolean, passMessage: string, failMessage: string): ContentQualityBenchmarkDeterministicCheck {
  return { id, status: passed ? 'pass' : 'fail', message: passed ? passMessage : failMessage };
}

function hasSoundTableMarkup(html: string): boolean {
  const $ = cheerio.load(html, null, false);
  return $('table').toArray().every(table => {
    const rows = $(table).find('tr');
    return rows.length > 0 && rows.toArray().every(row => $(row).children('th,td').length > 0);
  });
}

/** Generic HTML checks only. Matrix-specific authority remains in the canonical matrix audit. */
export function evaluateCandidateHtml(candidate: ContentQualityBenchmarkCandidate): ContentQualityBenchmarkDeterministicCheck[] {
  const resources = countExternalResources(candidate.html);
  const links = extractLinks(candidate.html);
  const linksAreSafe = links.every(link => !/^\s*(?:javascript|data|vbscript):/i.test(link.href));
  const $ = cheerio.load(candidate.html, null, false);
  const headingsAreNonblank = $('h1,h2,h3,h4,h5,h6').toArray().every(heading => $(heading).text().trim().length > 0);
  const genericChecks = [
    check('nonempty-copy', countWords(candidate.html) > 0, 'The candidate contains readable copy.', 'The candidate contains no readable copy.'),
    check('nonblank-headings', headingsAreNonblank, 'Every rendered heading is nonblank.', 'At least one rendered heading is blank.'),
    check('semantic-table-shape', hasSoundTableMarkup(candidate.html), 'Every present table uses rows and header/data cells.', 'A present table lacks semantic rows or cells.'),
    check('safe-link-schemes', linksAreSafe, 'Every parsed link uses a safe scheme.', 'At least one parsed link uses an executable scheme.'),
    check(
      'no-executable-resources',
      extractInlineScripts(candidate.html) === 0 && resources.scripts === 0,
      'The candidate contains no executable script resources.',
      'The candidate contains executable script content or resources.',
    ),
  ];
  const runtimeChecks = candidate.runtimeAudit?.deterministicChecks.map(item => ({
    id: `matrix:${item.id}`,
    status: item.result === 'failed'
      ? 'fail' as const
      : item.result === 'needs_human_review'
        ? 'review' as const
        : 'pass' as const,
    message: `Canonical matrix audit result: ${item.result}.`,
  })) ?? [];
  return [...genericChecks, ...runtimeChecks];
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100;
}

function validateComparison(casesFile: BenchmarkCasesFile, ratingsFile: BenchmarkRatingsFile, baselineLabel: string): void {
  const caseIds = casesFile.cases.map(testCase => testCase.caseId);
  if (new Set(caseIds).size !== caseIds.length) throw new Error('Benchmark case IDs must be unique.');
  const ratingIds = ratingsFile.cases.map(testCase => testCase.caseId);
  if (new Set(ratingIds).size !== ratingIds.length) throw new Error('Rating case IDs must be unique.');
  const expectedLabels = casesFile.cases[0].candidateVariants.map(candidate => candidate.anonymousLabel).sort();
  if (!expectedLabels.includes(baselineLabel)) throw new Error('The baseline label is not present in the benchmark candidates.');
  for (const testCase of casesFile.cases) {
    if (sha256(testCase.referenceHtml) !== testCase.reference.contentSha256) {
      throw new Error(`Approved reference hash mismatch for ${testCase.caseId}.`);
    }
    const labels = testCase.candidateVariants.map(candidate => candidate.anonymousLabel).sort();
    if (labels.join('\0') !== expectedLabels.join('\0')) {
      throw new Error('Every benchmark case must compare the same blinded candidate labels.');
    }
  }
  for (const ratings of ratingsFile.cases) {
    const testCase = casesFile.cases.find(candidate => candidate.caseId === ratings.caseId);
    if (!testCase) throw new Error(`Ratings reference unknown case ${ratings.caseId}.`);
    const labels = new Set(testCase.candidateVariants.map(candidate => candidate.anonymousLabel));
    if (ratings.humanRatings.some(rating => !labels.has(rating.anonymousLabel))) {
      throw new Error(`Ratings reference an unknown candidate in ${ratings.caseId}.`);
    }
    if (ratings.preferredCandidate && !labels.has(ratings.preferredCandidate)) {
      throw new Error(`Preferred candidate is unknown in ${ratings.caseId}.`);
    }
  }
}

function aggregateCandidate(
  label: string,
  cases: ContentQualityBenchmarkCase[],
  ratingsByCase: Map<string, BenchmarkRatingsFile['cases'][number]>,
  checksByCase: Map<string, Record<string, ContentQualityBenchmarkDeterministicCheck[]>>,
  preferenceDenominator: number,
): ContentQualityBenchmarkCandidateAggregate {
  const candidates = cases.map(testCase => testCase.candidateVariants.find(candidate => candidate.anonymousLabel === label)!);
  const ratings = cases.flatMap(testCase => ratingsByCase.get(testCase.caseId)?.humanRatings.filter(rating => rating.anonymousLabel === label) ?? []);
  const preferences = cases.filter(testCase => {
    const ratings = ratingsByCase.get(testCase.caseId);
    return ratings?.preferredCandidate === label
      && ratings.humanRatings.length === testCase.candidateVariants.length;
  }).length;
  const meanRatings = Object.fromEntries(CONTENT_QUALITY_BENCHMARK_HUMAN_DIMENSIONS.map(dimension => [
    dimension,
    mean(ratings.map(rating => rating.ratings[dimension])),
  ])) as ContentQualityBenchmarkCandidateAggregate['meanRatings'];
  return {
    anonymousLabel: label,
    caseCount: candidates.length,
    preferenceRate: preferenceDenominator === 0 ? 0 : Math.round((preferences / preferenceDenominator) * 10_000) / 100,
    meanRatings,
    factualFailures: ratings.filter(rating => rating.factualDiscipline === 'fail').length,
    deterministicFailures: cases.reduce((total, testCase) => total + (checksByCase.get(testCase.caseId)?.[label] ?? []).filter(item => item.status === 'fail').length, 0),
    meanEstimatedCostUsd: mean(candidates.map(candidate => candidate.provenance.estimatedCostUsd)),
    meanDurationMs: mean(candidates.map(candidate => candidate.provenance.durationMs)),
    meanPromptTokens: mean(candidates.map(candidate => candidate.provenance.promptTokens)),
    meanCompletionTokens: mean(candidates.map(candidate => candidate.provenance.completionTokens)),
  };
}

export function buildBenchmarkReport(
  untrustedCases: unknown,
  untrustedRatings: unknown,
  baselineLabel: string,
  generatedAt = new Date().toISOString(),
): ContentQualityBenchmarkAggregateReport {
  const casesFile = benchmarkCasesFileSchema.parse(untrustedCases);
  const ratingsFile = benchmarkRatingsFileSchema.parse(untrustedRatings);
  blindedLabelSchema.parse(baselineLabel);
  validateComparison(casesFile, ratingsFile, baselineLabel);
  const ratingsByCase = new Map(ratingsFile.cases.map(ratings => [ratings.caseId, ratings]));
  const checksByCase = new Map(casesFile.cases.map(testCase => [testCase.caseId, Object.fromEntries(
    testCase.candidateVariants.map(candidate => [candidate.anonymousLabel, evaluateCandidateHtml(candidate)]),
  )]));
  const completeCases = casesFile.cases.filter(testCase => {
    const ratings = ratingsByCase.get(testCase.caseId);
    return Boolean(ratings?.preferredCandidate && ratings.humanRatings.length === testCase.candidateVariants.length);
  });
  const allCasesComplete = completeCases.length === casesFile.cases.length;
  const labels = casesFile.cases[0].candidateVariants.map(candidate => candidate.anonymousLabel).sort();
  const internalAggregates = labels.map(label => aggregateCandidate(
    label, casesFile.cases, ratingsByCase, checksByCase, completeCases.length,
  ));
  const baseline = internalAggregates.find(candidate => candidate.anonymousLabel === baselineLabel)!;
  const eligible = internalAggregates.filter(candidate => candidate.anonymousLabel !== baselineLabel
    && candidate.preferenceRate >= 70
    && candidate.meanRatings.brand_fidelity >= 4
    && candidate.meanRatings.intent_satisfaction >= 4
    && candidate.factualFailures === 0
    && candidate.deterministicFailures === 0
    && candidate.meanEstimatedCostUsd <= baseline.meanEstimatedCostUsd
    && candidate.meanPromptTokens <= baseline.meanPromptTokens)
    .sort((a, b) => b.preferenceRate - a.preferenceRate
      || b.meanRatings.brand_fidelity - a.meanRatings.brand_fidelity
      || a.anonymousLabel.localeCompare(b.anonymousLabel));
  const enoughRatings = casesFile.cases.length >= 6 && allCasesComplete;
  const winner = enoughRatings ? eligible[0] : undefined;
  const baselineSafe = baseline.factualFailures === 0 && baseline.deterministicFailures === 0;
  const recommendation = !enoughRatings
    ? 'no_recommendation'
    : winner
      ? 'candidate'
      : baselineSafe
        ? 'baseline'
        : 'no_recommendation';
  const recommendationReason = !enoughRatings
    ? 'At least six cases with complete blinded ratings and a recorded preference are required.'
    : winner
      ? `${winner.anonymousLabel} meets every advisory quality, safety, cost, and prompt-token threshold.`
      : baselineSafe
        ? 'No candidate meets every advisory quality, safety, cost, and prompt-token threshold.'
        : 'Neither the baseline nor a candidate satisfies every deterministic and factual safety gate.';
  return {
    schemaVersion: CONTENT_QUALITY_BENCHMARK_SCHEMA_VERSION,
    rubricVersion: ratingsFile.rubricVersion,
    generatedAt: z.string().datetime().parse(generatedAt),
    caseCount: casesFile.cases.length,
    ratingCoverage: Math.round((ratingsFile.cases.reduce((total, ratings) => total + ratings.humanRatings.length, 0)
      / (casesFile.cases.length * labels.length)) * 10_000) / 100,
    recommendation,
    recommendationReason,
    candidates: internalAggregates,
    cases: casesFile.cases.map(testCase => {
      const ratings = ratingsByCase.get(testCase.caseId);
      const checks = checksByCase.get(testCase.caseId)!;
      return {
        caseId: testCase.caseId,
        pageType: testCase.pageType,
        referenceContentSha256: testCase.reference.contentSha256,
        ratedCandidateCount: ratings?.humanRatings.length ?? 0,
        deterministicFailureCount: Object.values(checks).flat().filter(item => item.status === 'fail').length,
        factualFailureCount: ratings?.humanRatings.filter(rating => rating.factualDiscipline === 'fail').length ?? 0,
      };
    }),
  };
}

interface CliOptions { casesPath: string; ratingsPath: string; baselineLabel: string; outputPath: string }

export function parseBenchmarkCli(argv: string[]): CliOptions {
  for (const argument of argv) {
    const flag = argument.split('=', 1)[0];
    if (FORBIDDEN_FLAGS.has(flag)) throw new Error(`Unsafe benchmark flag rejected: ${flag}`);
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const [flag, inlineValue] = argument.split('=', 2);
    if (!['--cases', '--ratings', '--baseline-label', '--output'].includes(flag)) throw new Error(`Unknown benchmark flag: ${flag}`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    values.set(flag, value);
  }
  const casesPath = values.get('--cases');
  const ratingsPath = values.get('--ratings');
  const baselineLabel = values.get('--baseline-label');
  if (!casesPath || !ratingsPath || !baselineLabel) {
    throw new Error('Usage: --cases <private.json> --ratings <private.json> --baseline-label candidate_a [--output <report.json>]');
  }
  return { casesPath, ratingsPath, baselineLabel, outputPath: values.get('--output') ?? DEFAULT_OUTPUT };
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.resolve(filePath), 'utf8')) as unknown;
}

export async function runBenchmarkCli(argv: string[]): Promise<string> {
  const options = parseBenchmarkCli(argv);
  const casesPath = path.resolve(options.casesPath);
  const ratingsPath = path.resolve(options.ratingsPath);
  const outputPath = path.resolve(options.outputPath);
  if (outputPath === casesPath || outputPath === ratingsPath) {
    throw new Error('Benchmark output must not overwrite either private input file.');
  }
  const report = buildBenchmarkReport(
    await readJson(casesPath),
    await readJson(ratingsPath),
    options.baselineLabel,
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return outputPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBenchmarkCli(process.argv.slice(2))
    .then(outputPath => console.log(`Content quality benchmark report written to ${outputPath}`))
    .catch(error => {
      console.error(error instanceof Error ? error.message : 'Content quality benchmark failed.');
      process.exitCode = 1;
    });
}
