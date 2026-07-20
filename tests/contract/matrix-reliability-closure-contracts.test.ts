import { describe, expect, it } from 'vitest';
import {
  MATRIX_GENERATION_CENSUS_FAILURE_CODES,
  MATRIX_GENERATION_CENSUS_FAILURE_STAGES,
  MATRIX_GENERATION_EVIDENCE_VALUE_READ_LIMIT,
  MATRIX_GENERATION_PRECONDITION_REASONS,
  type MatrixGenerationPreviewResult,
} from '../../shared/types/matrix-generation.js';
import type { GenerationEvidenceRequirement } from '../../shared/types/generation-evidence.js';

describe('matrix reliability closure shared contracts', () => {
  it('pins exhaustive stable precondition reasons', () => {
    expect(MATRIX_GENERATION_PRECONDITION_REASONS).toEqual([
      'feature_disabled',
      'invalid_selection',
      'invalid_budget',
      'template_upgrade_required',
      'generation_preconditions_unresolved',
      'source_revision_changed',
      'preview_fingerprint_stale',
      'invalid_cursor',
      'retry_conflict',
      'artifact_revision_changed',
      'checkpoint_changed',
      'active_job_conflict',
    ]);
  });

  it('keeps diagnostics safe, bounded, and explicit about completeness', () => {
    expect(MATRIX_GENERATION_CENSUS_FAILURE_STAGES).toEqual([
      'webflow_pages',
      'base_url',
      'sitemap',
    ]);
    expect(MATRIX_GENERATION_CENSUS_FAILURE_CODES).toEqual([
      'provider_error',
      'incomplete',
      'invalid_response',
      'limit_exceeded',
    ]);
    expect(MATRIX_GENERATION_EVIDENCE_VALUE_READ_LIMIT).toBe(10);

    const result = {
      matrixId: 'matrix-1',
      templateId: 'template-1',
      cellId: 'cell-1',
      sourceRevision: { matrixRevision: 1, templateRevision: 2, cellRevision: 3 },
      status: 'blocked',
      omittedOptionalSections: [],
      evidenceRequirements: [],
      blockingRequirementIds: [],
      expectedArtifactRevisions: {
        brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 },
        post: { artifactType: 'generated_post', artifactId: null, generationRevision: 0 },
      },
      diagnostics: {
        requirementsComplete: false,
        sourceLimitIssues: [],
        sourceLimitIssuesTruncated: false,
        censusFailures: [{ stage: 'sitemap', code: 'provider_error', httpStatus: 503 }],
      },
    } satisfies MatrixGenerationPreviewResult;
    expect(result.diagnostics.requirementsComplete).toBe(false);
  });

  it('distinguishes evidence-resolvable and human-only requirements', () => {
    const common = {
      id: 'requirement-1',
      fieldPath: 'artifact.replacement_authorization',
      claim: 'Replacement is authorized.',
      reason: 'Published work requires explicit human authorization.',
      requirementStage: 'preflight' as const,
      claimKind: 'factual' as const,
      status: 'missing' as const,
      sourceRefs: [] as [],
    };
    const evidence = {
      ...common,
      resolvable: true,
      resolutionAuthority: 'evidence_submission',
    } satisfies GenerationEvidenceRequirement;
    const humanOnly = {
      ...common,
      resolvable: false,
      resolutionAuthority: 'human_authorization',
    } satisfies GenerationEvidenceRequirement;
    expect(evidence.resolvable).toBe(true);
    expect(humanOnly.resolutionAuthority).toBe('human_authorization');
  });
});
