import { describe, expect, it } from 'vitest';

import {
  MATRIX_GENERATION_PREVIEW_STAGES,
  MatrixGenerationPreviewStageError,
} from '../../server/domains/content/matrix-generation/preview.js';

describe('matrix preview ready-tail stage boundaries', () => {
  it('publishes the exact approved diagnostic-stage census', () => {
    expect(MATRIX_GENERATION_PREVIEW_STAGES).toEqual([
      'generation_context',
      'cell_budget',
      'evidence_range',
      'preview_fingerprint',
      'batch_budget',
      'mcp_projection',
    ]);
  });

  it('classifies every stage without retaining raw exception content', () => {
    const injectedSecret = 'sk-proj-stage-secret-must-not-escape-123456789';

    for (const stage of MATRIX_GENERATION_PREVIEW_STAGES) {
      const error = MatrixGenerationPreviewStageError.from(
        stage,
        'cell_stage_census',
        new TypeError(`unsafe ${injectedSecret}`),
      );
      expect(error).toMatchObject({
        name: 'MatrixGenerationPreviewStageError',
        code: 'internal_error',
        stage,
        cellId: 'cell_stage_census',
        classification: 'type_error',
        fieldPath: null,
        constraint: null,
      });
      expect(error.message).toBe('The matrix generation preview could not complete.');
      expect(JSON.stringify(error)).not.toContain(injectedSecret);
      expect(error.stack).not.toContain(injectedSecret);
      expect(error).not.toHaveProperty('cause');
    }
  });
});
