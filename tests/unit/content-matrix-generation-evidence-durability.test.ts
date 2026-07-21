import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  MatrixGenerationEvidenceResolution,
  ResolvedMatrixStructuralTarget,
} from '../../shared/types/matrix-generation.js';
import db from '../../server/db/index.js';
import {
  buildMatrixCellEvidenceRequirements,
  MatrixGenerationEvidenceError,
  readFrozenMatrixCellEvidence,
} from '../../server/domains/content/matrix-generation/evidence.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const cleanupWorkspaceIds = new Set<string>();

afterEach(() => {
  for (const workspaceId of cleanupWorkspaceIds) deleteWorkspace(workspaceId);
  cleanupWorkspaceIds.clear();
});

function workspace(label: string): string {
  const workspaceId = createWorkspace(`${label} ${randomUUID()}`).id;
  cleanupWorkspaceIds.add(workspaceId);
  return workspaceId;
}

function resolution(input: {
  id: string;
  workspaceId: string;
  requirementId: string;
  templateRevision?: number;
  value?: MatrixGenerationEvidenceResolution['value'];
}): MatrixGenerationEvidenceResolution {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    matrixId: 'matrix-1',
    cellId: 'cell-1',
    requirementId: input.requirementId,
    value: input.value ?? { kind: 'boolean', value: true },
    sourceRef: {
      sourceType: 'operator_attestation',
      sourceId: `source-${input.id}`,
      capturedAt: '2026-07-19T12:00:00.000Z',
    },
    resolvedBy: { actorType: 'operator', actorId: 'operator-1' },
    expectedSourceRevision: {
      matrixRevision: 1,
      templateRevision: input.templateRevision ?? 1,
      cellRevision: 1,
    },
    expectedArtifactRevisions: {
      brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 },
      post: { artifactType: 'generated_post', artifactId: null, generationRevision: 0 },
    },
    resolvedAt: '2026-07-19T12:00:00.000Z',
  };
}

function target(templateRevision: number): ResolvedMatrixStructuralTarget {
  return {
    cellId: 'cell-1',
    pageType: 'location',
    sourceRevision: { matrixRevision: 9, templateRevision, cellRevision: 9 },
    blockManifest: {
      blocks: [
        {
          id: 'template:proof',
          source: 'template',
          sourceSectionId: 'proof',
          generationRole: 'proof',
          order: 1,
          heading: { level: 2, renderedText: 'Why this works', locked: false },
          guidance: 'Use only verified proof.',
          optional: true,
          aeoContract: { modes: [], required: false },
          ctaContract: { role: 'none', required: false },
        },
        {
          id: 'system:conclusion',
          source: 'system',
          generationRole: 'conclusion',
          order: 2,
          heading: { level: 2, renderedText: null, locked: false },
          guidance: 'Close with the verified action.',
          aeoContract: { modes: [], required: false },
          ctaContract: { role: 'primary', required: true },
        },
      ],
    },
  } as unknown as ResolvedMatrixStructuralTarget;
}

function insertEvidenceRow(input: {
  resolution: MatrixGenerationEvidenceResolution;
  isCurrent: 0 | 1;
  supersedesId: string | null;
  supersededAt: string | null;
}): void {
  const item = input.resolution;
  db.prepare(`
    INSERT INTO content_matrix_cell_evidence (
      id, workspace_id, matrix_id, cell_id, requirement_id,
      matrix_revision, template_revision, cell_revision,
      value, source_ref, resolved_by, expected_artifact_revisions,
      idempotency_key, supersedes_id, is_current, created_at, superseded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.id,
    item.workspaceId,
    item.matrixId,
    item.cellId,
    item.requirementId,
    item.expectedSourceRevision.matrixRevision,
    item.expectedSourceRevision.templateRevision,
    item.expectedSourceRevision.cellRevision,
    JSON.stringify(item.value),
    JSON.stringify(item.sourceRef),
    JSON.stringify(item.resolvedBy),
    JSON.stringify(item.expectedArtifactRevisions),
    `idempotency-${item.id}`,
    input.supersedesId,
    input.isCurrent,
    item.resolvedAt,
    input.supersededAt,
  );
}

describe('matrix generation evidence durability', () => {
  it('treats artifact revisions as write-time CAS while retaining template authority for sections', () => {
    const workspaceId = workspace('Matrix evidence authority');
    const generalEvidence = [
      resolution({
        id: 'evidence-service-availability',
        workspaceId,
        requirementId: 'matrix-cell:cell-1:service-availability',
        templateRevision: 1,
      }),
      resolution({
        id: 'evidence-service-details',
        workspaceId,
        requirementId: 'matrix-cell:cell-1:service-details',
        templateRevision: 1,
        value: { kind: 'text', value: 'Verified details about the service.' },
      }),
      resolution({
        id: 'evidence-location-relevance',
        workspaceId,
        requirementId: 'matrix-cell:cell-1:location-relevance',
        templateRevision: 1,
        value: { kind: 'text', value: 'Verified relevance to this location.' },
      }),
      resolution({
        id: 'evidence-cta-details',
        workspaceId,
        requirementId: 'matrix-cell:cell-1:cta-details',
        templateRevision: 1,
        value: { kind: 'url', value: 'https://example.com/contact' },
      }),
    ];
    const sectionEvidence = resolution({
      id: 'evidence-proof',
      workspaceId,
      requirementId: 'matrix-cell:cell-1:section:proof',
      templateRevision: 1,
      value: { kind: 'text', value: 'A verified proof point.' },
    });

    const sameTemplate = buildMatrixCellEvidenceRequirements(
      target(1),
      [...generalEvidence, sectionEvidence],
    );
    for (const item of generalEvidence) {
      expect(sameTemplate.find(requirement => requirement.id === item.requirementId)?.status)
        .toBe('verified');
    }
    expect(sameTemplate.find(item => item.id === sectionEvidence.requirementId)?.status)
      .toBe('verified');

    // Matrix/cell and linked artifact state may advance after a generated
    // artifact is adopted. General factual evidence remains authoritative.
    const changedTemplate = buildMatrixCellEvidenceRequirements(
      target(2),
      [...generalEvidence, sectionEvidence],
    );
    for (const item of generalEvidence) {
      expect(changedTemplate.find(requirement => requirement.id === item.requirementId)?.status)
        .toBe('verified');
    }
    expect(changedTemplate.find(item => item.id === sectionEvidence.requirementId)?.status)
      .toBe('missing');
  });

  it('reads exact current or superseded rows and fails closed across every scope boundary', () => {
    const workspaceId = workspace('Frozen matrix evidence');
    const otherWorkspaceId = workspace('Other frozen matrix evidence');
    const requirementId = 'matrix-cell:cell-1:service-availability';
    const oldResolution = resolution({
      id: 'evidence-old',
      workspaceId,
      requirementId,
    });
    const currentResolution = resolution({
      id: 'evidence-current',
      workspaceId,
      requirementId,
      value: { kind: 'text', value: 'The service remains available.' },
    });
    insertEvidenceRow({
      resolution: oldResolution,
      isCurrent: 0,
      supersedesId: null,
      supersededAt: '2026-07-19T13:00:00.000Z',
    });
    insertEvidenceRow({
      resolution: currentResolution,
      isCurrent: 1,
      supersedesId: oldResolution.id,
      supersededAt: null,
    });

    expect(readFrozenMatrixCellEvidence({
      workspaceId,
      matrixId: 'matrix-1',
      cellId: 'cell-1',
      evidenceResolutionIds: [oldResolution.id, currentResolution.id],
    })).toEqual([
      expect.objectContaining({
        resolution: expect.objectContaining({ id: oldResolution.id }),
        status: 'superseded',
        supersedesId: null,
        supersededAt: '2026-07-19T13:00:00.000Z',
      }),
      expect.objectContaining({
        resolution: expect.objectContaining({ id: currentResolution.id }),
        status: 'current',
        supersedesId: oldResolution.id,
        supersededAt: null,
      }),
    ]);

    for (const scope of [
      { workspaceId: otherWorkspaceId, matrixId: 'matrix-1', cellId: 'cell-1' },
      { workspaceId, matrixId: 'matrix-other', cellId: 'cell-1' },
      { workspaceId, matrixId: 'matrix-1', cellId: 'cell-other' },
    ]) {
      expect(() => readFrozenMatrixCellEvidence({
        ...scope,
        evidenceResolutionIds: [oldResolution.id],
      })).toThrow(expect.objectContaining<Partial<MatrixGenerationEvidenceError>>({
        code: 'not_found',
      }));
    }
  });
});
