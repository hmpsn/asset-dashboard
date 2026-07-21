import type {
  BriefPageType,
  TemplateSectionGenerationRole,
} from './content.js';
import type {
  GenerationAuditCheckResult,
  GenerationAuditVerdict,
} from './generation-evidence.js';

export const CONTENT_QUALITY_BENCHMARK_SCHEMA_VERSION = 1 as const;

export const CONTENT_QUALITY_BENCHMARK_REFERENCE_KINDS = [
  'matrix_approved_post',
  'approved_copy_sections',
  'operator_curated_page',
] as const;
export type ContentQualityBenchmarkReferenceKind =
  (typeof CONTENT_QUALITY_BENCHMARK_REFERENCE_KINDS)[number];

export const CONTENT_QUALITY_BENCHMARK_VERTICAL_SENSITIVITIES = [
  'standard',
  'provenance_sensitive',
] as const;
export type ContentQualityBenchmarkVerticalSensitivity =
  (typeof CONTENT_QUALITY_BENCHMARK_VERTICAL_SENSITIVITIES)[number];

export const CONTENT_QUALITY_BENCHMARK_HUMAN_DIMENSIONS = [
  'brand_fidelity',
  'intent_satisfaction',
  'specificity',
  'naturalness',
  'conversion_clarity',
  'structural_variety',
] as const;
export type ContentQualityBenchmarkHumanDimension =
  (typeof CONTENT_QUALITY_BENCHMARK_HUMAN_DIMENSIONS)[number];

export const CONTENT_QUALITY_BENCHMARK_FACTUAL_VERDICTS = [
  'pass',
  'needs_review',
  'fail',
] as const;
export type ContentQualityBenchmarkFactualVerdict =
  (typeof CONTENT_QUALITY_BENCHMARK_FACTUAL_VERDICTS)[number];

export const CONTENT_QUALITY_BENCHMARK_CHECK_STATUSES = [
  'pass',
  'review',
  'fail',
] as const;
export type ContentQualityBenchmarkCheckStatus =
  (typeof CONTENT_QUALITY_BENCHMARK_CHECK_STATUSES)[number];

/** Private reference identity. Raw content remains in ignored local artifacts. */
export interface ContentQualityBenchmarkReference {
  kind: ContentQualityBenchmarkReferenceKind;
  contentSha256: string;
  approvalKind: 'human_approved' | 'operator_attested';
  approvedAt: string;
  sourceRevision?: number;
}

export interface ContentQualityBenchmarkCandidateProvenance {
  operation: string;
  provider?: string;
  model: string;
  inputFingerprint: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
}

export interface ContentQualityBenchmarkCandidate {
  /** Opaque blinded label such as `candidate_a`; never expose model identity to raters. */
  anonymousLabel: string;
  html: string;
  provenance: ContentQualityBenchmarkCandidateProvenance;
  /** Sanitized result from the canonical matrix audit when this is an exact matrix candidate. */
  runtimeAudit?: {
    authorityFingerprint: string;
    verdict: GenerationAuditVerdict;
    deterministicChecks: Array<{
      id: string;
      result: GenerationAuditCheckResult;
    }>;
  };
}

/**
 * Local-only benchmark case. Files containing this shape must live under the
 * gitignored `artifacts/content-quality-benchmark/` directory.
 */
export interface ContentQualityBenchmarkCase {
  schemaVersion: typeof CONTENT_QUALITY_BENCHMARK_SCHEMA_VERSION;
  caseId: string;
  pageType: BriefPageType;
  generationRoleCoverage: TemplateSectionGenerationRole[];
  verticalSensitivity: ContentQualityBenchmarkVerticalSensitivity;
  searchIntent: string;
  /** Non-identifying category such as `local_service_transactional`. */
  primaryQueryClass: string;
  reference: ContentQualityBenchmarkReference;
  referenceHtml: string;
  candidateVariants: ContentQualityBenchmarkCandidate[];
}

export interface ContentQualityBenchmarkDeterministicCheck {
  id: string;
  status: ContentQualityBenchmarkCheckStatus;
  message: string;
}

export type ContentQualityBenchmarkDimensionRatings = Record<
  ContentQualityBenchmarkHumanDimension,
  1 | 2 | 3 | 4 | 5
>;

export interface ContentQualityBenchmarkHumanRating {
  anonymousLabel: string;
  ratings: ContentQualityBenchmarkDimensionRatings;
  factualDiscipline: ContentQualityBenchmarkFactualVerdict;
  editMinutes?: number;
  /** Normalized 0–1 edit distance from the approved reference. */
  editDistanceRatio?: number;
  note?: string;
}

export interface ContentQualityBenchmarkCaseResult {
  caseId: string;
  pageType: BriefPageType;
  referenceContentSha256: string;
  deterministicChecks: Record<string, ContentQualityBenchmarkDeterministicCheck[]>;
  humanRatings: ContentQualityBenchmarkHumanRating[];
  preferredCandidate?: string;
}

export interface ContentQualityBenchmarkCandidateAggregate {
  anonymousLabel: string;
  caseCount: number;
  /** Already a percentage from 0–100. Do not multiply by 100. */
  preferenceRate: number;
  meanRatings: Record<ContentQualityBenchmarkHumanDimension, number>;
  factualNeedsReview: number;
  factualFailures: number;
  deterministicFailures: number;
  meanEstimatedCostUsd: number;
  meanDurationMs: number;
  meanPromptTokens: number;
  meanCompletionTokens: number;
}

/** Safe-to-commit aggregate: contains no raw copy, prompts, evidence, or client identity. */
export interface ContentQualityBenchmarkAggregateReport {
  schemaVersion: typeof CONTENT_QUALITY_BENCHMARK_SCHEMA_VERSION;
  rubricVersion: string;
  generatedAt: string;
  caseCount: number;
  /** Already a percentage from 0–100. Do not multiply by 100. */
  ratingCoverage: number;
  recommendation: 'candidate' | 'baseline' | 'no_recommendation';
  recommendationReason: string;
  candidates: ContentQualityBenchmarkCandidateAggregate[];
  cases: Array<{
    caseId: string;
    pageType: BriefPageType;
    referenceContentSha256: string;
    ratedCandidateCount: number;
    deterministicFailureCount: number;
    factualNeedsReviewCount: number;
    factualFailureCount: number;
  }>;
}
