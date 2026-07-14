import { afterEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  ContentMatrixRevisionConflictError,
  ContentMatrixRevisionRequiredError,
  ContentMatrixBulkCellWriteUnsupportedError,
  ContentMatrixSourceIntegrityError,
  createMatrix,
  deleteMatrix,
  getMatrix,
  MatrixCellRevisionConflictError,
  updateMatrix,
  updateMatrixCell,
} from '../../server/content-matrices.js';
import {
  createTemplate,
  deleteTemplate,
} from '../../server/content-templates.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  MATRIX_GENERATION_SOURCE_LIMITS,
  MatrixGenerationSchemaTypeContractError,
} from '../../shared/types/matrix-generation.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function seedMatrix(values = ['Austin', 'Dallas']) {
  const workspaceId = createWorkspace(`matrix revisions ${Date.now()} ${Math.random()}`).id;
  const template = createTemplate(workspaceId, {
    name: 'Local service template',
    pageType: 'service',
    variables: [{ name: 'city', label: 'City' }],
    sections: [],
    urlPattern: '/service/{city}',
    keywordPattern: 'dentist',
    titlePattern: 'Dentist in {city}',
    metaDescPattern: 'Book a dentist in {city}.',
    schemaTypes: ['Service', 'BreadcrumbList'],
  });
  const matrix = createMatrix(workspaceId, {
    name: 'Local services',
    templateId: template.id,
    dimensions: [{ variableName: 'city', values }],
    urlPattern: '/service/{city}',
    keywordPattern: 'dentist',
  }, { validateTemplate: true });
  cleanups.push(() => {
    deleteMatrix(workspaceId, matrix.id);
    deleteTemplate(workspaceId, template.id);
    deleteWorkspace(workspaceId);
  });
  return { workspaceId, template, matrix };
}

describe('content matrix source revisions', () => {
  it('starts new matrices/cells at revision 1 and inherits template schema types', () => {
    const { matrix } = seedMatrix();

    expect(matrix.revision).toBe(1);
    expect(matrix.cells).toHaveLength(2);
    expect(matrix.cells.map(cell => cell.revision)).toEqual([1, 1]);
    expect(matrix.cells[0].expectedSchemaTypes).toEqual(['Service', 'BreadcrumbList']);
  });

  it('keeps display-only renames generation-stable and requires CAS for definition edits', () => {
    const { workspaceId, matrix } = seedMatrix();

    const renamed = updateMatrix(workspaceId, matrix.id, { name: 'Operator display name' });
    expect(renamed?.revision).toBe(matrix.revision);

    expect(() => updateMatrix(workspaceId, matrix.id, {
      urlPattern: '/dentists/{city}',
    })).toThrow(ContentMatrixRevisionRequiredError);

    const changed = updateMatrix(workspaceId, matrix.id, {
      urlPattern: '/dentists/{city}',
    }, { expectedMatrixRevision: matrix.revision });
    expect(changed?.revision).toBe(2);
    expect(changed?.cells.map(cell => cell.plannedUrl)).toEqual([
      '/dentists/austin',
      '/dentists/dallas',
    ]);

    expect(() => updateMatrix(workspaceId, matrix.id, {
      keywordPattern: '{city} dentist',
    }, { expectedMatrixRevision: matrix.revision })).toThrow(
      ContentMatrixRevisionConflictError,
    );
  });

  it('preserves researched metadata by variable tuple when keywords are duplicated', () => {
    const { workspaceId, matrix } = seedMatrix();
    const [austin, dallas] = matrix.cells;
    updateMatrixCell(workspaceId, matrix.id, austin.id, {
      recommendedKeyword: 'austin dental care',
      keywordValidation: {
        volume: 120,
        difficulty: 31,
        cpc: 4.2,
        validatedAt: '2026-07-13T00:00:00.000Z',
      },
    }, { expectedCellRevision: austin.revision });
    updateMatrixCell(workspaceId, matrix.id, dallas.id, {
      recommendedKeyword: 'dallas dental care',
    }, { expectedCellRevision: dallas.revision });
    const current = getMatrix(workspaceId, matrix.id)!;

    const changed = updateMatrix(workspaceId, matrix.id, {
      urlPattern: '/dentists/{city}',
    }, { expectedMatrixRevision: current.revision });

    const updatedAustin = changed?.cells.find(cell => cell.variableValues.city === 'Austin');
    const updatedDallas = changed?.cells.find(cell => cell.variableValues.city === 'Dallas');
    expect(updatedAustin).toMatchObject({
      id: austin.id,
      recommendedKeyword: 'austin dental care',
      keywordValidation: { volume: 120 },
      plannedUrl: '/dentists/austin',
    });
    expect(updatedDallas).toMatchObject({
      id: dallas.id,
      recommendedKeyword: 'dallas dental care',
      plannedUrl: '/dentists/dallas',
    });
  });

  it('drops target-keyword validation when the keyword pattern changes', () => {
    const { workspaceId, matrix } = seedMatrix(['Austin']);
    const [sourceCell] = matrix.cells;
    updateMatrixCell(workspaceId, matrix.id, sourceCell.id, {
      keywordValidation: {
        volume: 120,
        difficulty: 31,
        cpc: 4.2,
        validatedAt: '2026-07-13T00:00:00.000Z',
      },
      recommendedKeyword: 'austin dental care',
    }, { expectedCellRevision: sourceCell.revision });
    const current = getMatrix(workspaceId, matrix.id)!;

    const changed = updateMatrix(workspaceId, matrix.id, {
      keywordPattern: '{city} dentist',
    }, { expectedMatrixRevision: current.revision });

    expect(changed?.cells[0].targetKeyword).toBe('Austin dentist');
    expect(changed?.cells[0]).not.toHaveProperty('keywordValidation');
    expect(changed?.cells[0].recommendedKeyword).toBe('austin dental care');
  });

  it('normalizes cell schema fallbacks and rejects duplicate normalized identifiers', () => {
    const { workspaceId, matrix } = seedMatrix(['Austin']);
    const [sourceCell] = matrix.cells;
    const updated = updateMatrixCell(workspaceId, matrix.id, sourceCell.id, {
      expectedSchemaTypes: [' Service ', 'FAQPage'],
      status: 'keyword_validated',
    }, { expectedCellRevision: sourceCell.revision });
    expect(updated?.cells[0].expectedSchemaTypes).toEqual(['Service', 'FAQPage']);
    expect(updated?.cells[0].status).toBe('keyword_validated');

    expect(() => updateMatrixCell(workspaceId, matrix.id, sourceCell.id, {
      expectedSchemaTypes: ['Service', ' Service '],
    }, { expectedCellRevision: updated?.cells[0].revision })).toThrow(
      MatrixGenerationSchemaTypeContractError,
    );
  });

  it('allows an oversized legacy cell to be read, repaired, and deleted', () => {
    const { workspaceId, matrix } = seedMatrix(['Austin']);
    const [sourceCell] = matrix.cells;
    const oversizedCell = {
      ...sourceCell,
      clientFlag: 'x'.repeat(MATRIX_GENERATION_SOURCE_LIMITS.cell.maxClientFlagBytes + 1),
    };
    db.prepare(`
      UPDATE content_matrices SET cells = ? WHERE id = ? AND workspace_id = ?
    `).run(JSON.stringify([oversizedCell]), matrix.id, workspaceId);

    expect(getMatrix(workspaceId, matrix.id)?.cells[0].clientFlag).toBe(oversizedCell.clientFlag);
    const repaired = updateMatrixCell(workspaceId, matrix.id, sourceCell.id, {
      clientFlag: 'Repaired',
    }, { expectedCellRevision: sourceCell.revision });
    expect(repaired?.cells[0].clientFlag).toBe('Repaired');

    db.prepare(`
      UPDATE content_matrices SET cells = ? WHERE id = ? AND workspace_id = ?
    `).run(JSON.stringify([oversizedCell]), matrix.id, workspaceId);
    expect(deleteMatrix(workspaceId, matrix.id)).toBe(true);
  });

  it('resets lifecycle and artifact linkage when a matched cell target changes', () => {
    const { workspaceId, matrix } = seedMatrix(['Austin']);
    const [cell] = matrix.cells;
    const publishedCell = {
      ...cell,
      status: 'published' as const,
      briefId: 'brief-old-target',
      postId: 'post-old-target',
      statusHistory: [{ from: 'approved' as const, to: 'published' as const, at: '2026-07-01T00:00:00.000Z' }],
      clientFlag: 'Review the old URL',
      clientFlaggedAt: '2026-07-01T00:00:00.000Z',
      customKeyword: 'Austin dentist',
      recommendedKeyword: 'Austin dental care',
      keywordValidation: {
        volume: 120,
        difficulty: 31,
        cpc: 4.2,
        validatedAt: '2026-07-01T00:00:00.000Z',
      },
    };
    db.prepare(`
      UPDATE content_matrices
      SET cells = ?
      WHERE id = ? AND workspace_id = ?
    `).run(JSON.stringify([publishedCell]), matrix.id, workspaceId);

    const changed = updateMatrix(workspaceId, matrix.id, {
      urlPattern: '/dentists/{city}',
    }, { expectedMatrixRevision: matrix.revision });
    const regenerated = changed?.cells[0];

    expect(regenerated).toMatchObject({
      id: cell.id,
      revision: (cell.revision ?? 0) + 1,
      status: 'planned',
      plannedUrl: '/dentists/austin',
      customKeyword: 'Austin dentist',
      recommendedKeyword: 'Austin dental care',
      keywordValidation: { volume: 120 },
    });
    expect(regenerated).not.toHaveProperty('briefId');
    expect(regenerated).not.toHaveProperty('postId');
    expect(regenerated).not.toHaveProperty('statusHistory');
    expect(regenerated).not.toHaveProperty('clientFlag');
    expect(regenerated).not.toHaveProperty('clientFlaggedAt');
  });

  it('lets sibling cells commit from one source snapshot while same-cell stale writes lose', () => {
    const { workspaceId, template, matrix } = seedMatrix();
    const [first, second] = matrix.cells;
    const sharedEnvelope = {
      expectedMatrixRevision: matrix.revision,
      expectedTemplateRevision: template.revision,
    };

    const afterFirst = updateMatrixCell(workspaceId, matrix.id, first.id, {
      customKeyword: 'Austin dentist',
    }, { ...sharedEnvelope, expectedCellRevision: first.revision });
    const afterSecond = updateMatrixCell(workspaceId, matrix.id, second.id, {
      customKeyword: 'Dallas dentist',
    }, { ...sharedEnvelope, expectedCellRevision: second.revision });

    expect(afterFirst?.revision).toBe(matrix.revision);
    expect(afterSecond?.revision).toBe(matrix.revision);
    expect(afterSecond?.cells.map(cell => cell.revision)).toEqual([2, 2]);
    expect(() => updateMatrixCell(workspaceId, matrix.id, first.id, {
      customKeyword: 'Stale overwrite',
    }, { ...sharedEnvelope, expectedCellRevision: first.revision })).toThrow(
      MatrixCellRevisionConflictError,
    );
    expect(getMatrix(workspaceId, matrix.id)?.cells[0].customKeyword).toBe('Austin dentist');
  });

  it('keeps a cell revision stable when only variable-map insertion order changes', () => {
    const { workspaceId, matrix } = seedMatrix(['Austin']);
    const [cell] = matrix.cells;
    const withTwoVariables = updateMatrixCell(workspaceId, matrix.id, cell.id, {
      variableValues: { city: 'Austin', service: 'SEO' },
    }, { expectedCellRevision: cell.revision })!;
    const current = withTwoVariables.cells[0];

    const reordered = updateMatrixCell(workspaceId, matrix.id, current.id, {
      variableValues: { service: 'SEO', city: 'Austin' },
    }, { expectedCellRevision: current.revision })!;

    expect(reordered.cells[0].revision).toBe(current.revision);
    expect(getMatrix(workspaceId, matrix.id)?.cells[0].revision).toBe(current.revision);
  });

  it('rejects wholesale cell writes so lifecycle/history changes use the cell CAS path', () => {
    const { workspaceId, matrix } = seedMatrix();
    expect(() => updateMatrix(workspaceId, matrix.id, {
      cells: matrix.cells,
    } as never, { expectedMatrixRevision: matrix.revision })).toThrow(
      ContentMatrixBulkCellWriteUnsupportedError,
    );

    expect(getMatrix(workspaceId, matrix.id)?.cells).toEqual(matrix.cells);
  });

  it('refuses unrelated matrix and cell writes when a stored sibling would be dropped', () => {
    const { workspaceId, matrix } = seedMatrix(['Austin']);
    const [cell] = matrix.cells;
    const corruptedCells = JSON.stringify([
      cell,
      { id: 'corrupt-sibling', status: 'planned' },
    ]);
    db.prepare(`
      UPDATE content_matrices
      SET cells = ?
      WHERE id = ? AND workspace_id = ?
    `).run(corruptedCells, matrix.id, workspaceId);

    expect(() => updateMatrix(workspaceId, matrix.id, {
      name: 'Display-only rename',
    })).toThrow(ContentMatrixSourceIntegrityError);
    expect(() => updateMatrixCell(workspaceId, matrix.id, cell.id, {
      customKeyword: 'Safe-looking edit',
    }, { expectedCellRevision: cell.revision })).toThrow(ContentMatrixSourceIntegrityError);

    const stored = db.prepare(`
      SELECT name, cells FROM content_matrices WHERE id = ? AND workspace_id = ?
    `).get(matrix.id, workspaceId) as { name: string; cells: string };
    expect(stored.name).toBe(matrix.name);
    expect(stored.cells).toBe(corruptedCells);
  });

  it('refuses a rewrite when hydration strips data without changing the cell count', () => {
    const { workspaceId, matrix } = seedMatrix(['Austin']);
    const [cell] = matrix.cells;
    const serializedCell = JSON.stringify(cell);
    const corruptedCells = `[${serializedCell.slice(0, -1)},"__proto__":{"polluted":true}}]`;
    db.prepare(`
      UPDATE content_matrices
      SET cells = ?
      WHERE id = ? AND workspace_id = ?
    `).run(corruptedCells, matrix.id, workspaceId);

    expect(getMatrix(workspaceId, matrix.id)?.cells).toHaveLength(1);
    expect(() => updateMatrixCell(workspaceId, matrix.id, cell.id, {
      customKeyword: 'Would otherwise rewrite the cell array',
    }, { expectedCellRevision: cell.revision })).toThrow(ContentMatrixSourceIntegrityError);

    const stored = db.prepare(`
      SELECT cells FROM content_matrices WHERE id = ? AND workspace_id = ?
    `).get(matrix.id, workspaceId) as { cells: string };
    expect(stored.cells).toBe(corruptedCells);
  });

  it('reads legacy absent source revisions as zero through validated stored schemas', () => {
    const { workspaceId, template, matrix } = seedMatrix(['Austin']);
    const legacyCell = {
      id: 'legacy-cell',
      variableValues: { city: 'Legacy' },
      targetKeyword: 'legacy dentist',
      plannedUrl: '/legacy',
      status: 'planned',
    };
    db.prepare(`
      UPDATE content_matrices
      SET revision = 0, cells = ?
      WHERE id = ? AND workspace_id = ?
    `).run(JSON.stringify([legacyCell]), matrix.id, workspaceId);
    db.prepare(`
      UPDATE content_templates SET revision = 0 WHERE id = ? AND workspace_id = ?
    `).run(template.id, workspaceId);

    expect(getMatrix(workspaceId, matrix.id)).toMatchObject({
      revision: 0,
      cells: [{ id: 'legacy-cell', revision: 0 }],
    });
  });
});
