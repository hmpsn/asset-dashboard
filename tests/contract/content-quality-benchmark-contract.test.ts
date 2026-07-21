import { describe, expect, it } from 'vitest';

import {
  CONTENT_QUALITY_BENCHMARK_FACTUAL_VERDICTS,
  CONTENT_QUALITY_BENCHMARK_HUMAN_DIMENSIONS,
  CONTENT_QUALITY_BENCHMARK_REFERENCE_KINDS,
  CONTENT_QUALITY_BENCHMARK_SCHEMA_VERSION,
  CONTENT_QUALITY_BENCHMARK_VERTICAL_SENSITIVITIES,
  type ContentQualityBenchmarkAggregateReport,
  type ContentQualityBenchmarkCase,
} from '../../shared/types/content-quality-benchmark.js';

describe('content quality benchmark shared contract', () => {
  it('pins the private case schema and approved source kinds', () => {
    expect(CONTENT_QUALITY_BENCHMARK_SCHEMA_VERSION).toBe(1);
    expect(CONTENT_QUALITY_BENCHMARK_REFERENCE_KINDS).toEqual([
      'matrix_approved_post',
      'approved_copy_sections',
      'operator_curated_page',
    ]);
    expect(CONTENT_QUALITY_BENCHMARK_VERTICAL_SENSITIVITIES).toEqual([
      'standard',
      'provenance_sensitive',
    ]);
    expect(CONTENT_QUALITY_BENCHMARK_HUMAN_DIMENSIONS).toHaveLength(6);
    expect(CONTENT_QUALITY_BENCHMARK_FACTUAL_VERDICTS).toEqual([
      'pass',
      'needs_review',
      'fail',
    ]);
  });

  it('keeps raw HTML in private cases and out of aggregate reports', () => {
    const privateCase: ContentQualityBenchmarkCase = {
      schemaVersion: 1,
      caseId: 'case_service_01',
      pageType: 'service',
      generationRoleCoverage: ['proof', 'faq', 'cta'],
      verticalSensitivity: 'provenance_sensitive',
      searchIntent: 'transactional',
      primaryQueryClass: 'local_service_transactional',
      reference: {
        kind: 'matrix_approved_post',
        contentSha256: 'a'.repeat(64),
        approvalKind: 'human_approved',
        approvedAt: '2026-07-19T12:00:00.000Z',
        sourceRevision: 3,
      },
      referenceHtml: '<h2>Approved proof</h2>',
      candidateVariants: [],
    };
    const aggregate: ContentQualityBenchmarkAggregateReport = {
      schemaVersion: 1,
      rubricVersion: 'v1',
      generatedAt: '2026-07-20T12:00:00.000Z',
      caseCount: 1,
      ratingCoverage: 0,
      recommendation: 'no_recommendation',
      recommendationReason: 'Human ratings are incomplete.',
      candidates: [],
      cases: [{
        caseId: privateCase.caseId,
        pageType: privateCase.pageType,
        referenceContentSha256: privateCase.reference.contentSha256,
        ratedCandidateCount: 0,
        deterministicFailureCount: 0,
        factualFailureCount: 0,
      }],
    };

    expect(JSON.stringify(privateCase)).toContain('Approved proof');
    expect(JSON.stringify(aggregate)).not.toContain('referenceHtml');
    expect(JSON.stringify(aggregate)).not.toContain('candidateVariants');
  });
});
