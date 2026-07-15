import { describe, expect, it } from 'vitest';
import {
  acceptContentTemplateGenerationUpgradeInputSchema,
  getContentMatrixInputSchema,
  listContentMatricesInputSchema,
  resolveContentMatrixCellsInputSchema,
} from '../../shared/types/mcp-matrix-schemas.js';

const sourceRevision = {
  matrix_revision: 1,
  template_revision: 2,
  cell_revision: 3,
};

describe('M0 MCP matrix input contracts', () => {
  it('uses one snake_case workspace field and bounded cursor paging', () => {
    expect(listContentMatricesInputSchema.parse({
      workspace_id: 'ws-1',
      limit: 100,
    })).toMatchObject({ workspace_id: 'ws-1', limit: 100 });
    expect(() => listContentMatricesInputSchema.parse({
      workspace_id: 'ws-1',
      limit: 101,
    })).toThrow();
    expect(() => getContentMatrixInputSchema.parse({
      workspace_id: 'ws-1',
      matrix_id: 'matrix-1',
      cursor: 'not a base64url cursor',
    })).toThrow();
  });

  it('requires one to 25 unique cell selections with exact source revisions', () => {
    expect(resolveContentMatrixCellsInputSchema.parse({
      workspace_id: 'ws-1',
      matrix_id: 'matrix-1',
      selections: [{ cell_id: 'cell-1', expected_source_revision: sourceRevision }],
    }).selections).toHaveLength(1);

    expect(() => resolveContentMatrixCellsInputSchema.parse({
      workspace_id: 'ws-1',
      matrix_id: 'matrix-1',
      selections: [
        { cell_id: 'cell-1', expected_source_revision: sourceRevision },
        { cell_id: 'cell-1', expected_source_revision: sourceRevision },
      ],
    })).toThrow(/unique/i);

    expect(() => resolveContentMatrixCellsInputSchema.parse({
      workspace_id: 'ws-1',
      matrix_id: 'matrix-1',
      selections: [],
    })).toThrow();
  });

  it('requires an explicit upgrade decision, exact revision, fingerprint, and idempotency key', () => {
    const base = {
      workspace_id: 'ws-1',
      template_id: 'template-1',
      expected_template_revision: 0,
      proposal_fingerprint: 'a'.repeat(64),
      idempotency_key: 'upgrade-1',
    };
    expect(acceptContentTemplateGenerationUpgradeInputSchema.parse({
      ...base,
      decision: 'reject',
    }).decision).toBe('reject');
    expect(() => acceptContentTemplateGenerationUpgradeInputSchema.parse(base)).toThrow();
    expect(() => acceptContentTemplateGenerationUpgradeInputSchema.parse({
      ...base,
      decision: 'accept',
      proposal_fingerprint: 'raw-proposal',
    })).toThrow(/SHA-256/i);
  });
});
