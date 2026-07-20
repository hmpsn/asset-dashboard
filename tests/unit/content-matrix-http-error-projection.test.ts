import { describe, expect, it } from 'vitest';

import { MATRIX_GENERATION_AUTHORITY_CONTEXT_TOKEN_BUDGET } from '../../server/domains/content/matrix-generation/budget.js';
import { MatrixGenerationPreviewStageError } from '../../server/domains/content/matrix-generation/preview.js';
import { MatrixReadServiceError } from '../../server/domains/content/matrix-generation/read-service.js';
import { ContentGenerationContextBudgetError } from '../../server/intelligence/generation-context-builders.js';
import { projectMatrixGenerationHttpError } from '../../server/routes/content-matrices.js';

describe('matrix generation HTTP error projection', () => {
  it('preserves a stale-authority reason as an immediately retryable conflict', () => {
    const projected = projectMatrixGenerationHttpError(new MatrixReadServiceError(
      'conflict',
      'Current generation authority no longer matches the accepted preview. Re-preview immediately.',
      {
        reason: 'source_revision_changed',
        retryable: true,
        fieldPath: 'source_revision',
        constraint: 're-preview immediately using current authority',
      },
    ));

    expect(projected).toEqual({
      status: 409,
      body: {
        error: 'Current generation authority no longer matches the accepted preview. Re-preview immediately.',
        code: 'conflict',
        retryable: true,
        details: {
          reason: 'source_revision_changed',
          retryable: true,
          fieldPath: 'source_revision',
          constraint: 're-preview immediately using current authority',
        },
      },
    });
  });

  it('projects known context limits with stage, field, cell, and stable invalid-budget reason', () => {
    const error = MatrixGenerationPreviewStageError.from(
      'generation_context',
      'cell-1',
      new ContentGenerationContextBudgetError(
        'brief',
        MATRIX_GENERATION_AUTHORITY_CONTEXT_TOKEN_BUDGET,
        MATRIX_GENERATION_AUTHORITY_CONTEXT_TOKEN_BUDGET + 1,
      ),
    );

    expect(projectMatrixGenerationHttpError(error)).toEqual({
      status: 422,
      body: {
        error: 'The matrix generation preview exceeds a safe generation limit.',
        code: 'precondition_failed',
        retryable: false,
        details: {
          reason: 'invalid_budget',
          fieldPath: 'generation_context.brief',
          constraint: `required frozen authority and target evidence must fit within the ${MATRIX_GENERATION_AUTHORITY_CONTEXT_TOKEN_BUDGET}-token matrix context budget`,
          stage: 'generation_context',
          cellId: 'cell-1',
        },
      },
    });
  });

  it('keeps unexpected stage failures generic and excludes the raw exception', () => {
    const projected = projectMatrixGenerationHttpError(
      MatrixGenerationPreviewStageError.from(
        'preview_fingerprint',
        'cell-1',
        new Error('private prompt and provider response'),
      ),
    );

    expect(projected).toEqual({
      status: 500,
      body: {
        error: 'The matrix generation preview could not complete.',
        code: 'internal_error',
        retryable: false,
      },
    });
    expect(JSON.stringify(projected)).not.toContain('private prompt');
  });
});
