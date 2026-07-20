import { randomUUID } from 'node:crypto';

import type { MatrixCell } from '../../../../shared/types/content.js';
import {
  GENERATION_EVIDENCE_SOURCE_TYPES,
  GENERATION_INTERNAL_LINK_ANCHOR_MAX_LENGTH,
  GENERATION_INTERNAL_LINK_HREF_MAX_LENGTH,
  GENERATION_INTERNAL_LINK_LIMIT,
  STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES,
  type GenerationEvidenceRequirement,
  type GenerationFactualEvidenceSourceRef,
  type GenerationEvidenceValue,
} from '../../../../shared/types/generation-evidence.js';
import type {
  MatrixArtifactRevisionExpectations,
  MatrixGenerationEvidenceResolution,
  MatrixSourceRevision,
  ResolveMatrixGenerationEvidenceRequest,
  ResolveMatrixGenerationEvidenceResult,
  ResolvedMatrixStructuralTarget,
} from '../../../../shared/types/matrix-generation.js';
import { getBrief } from '../../../content-brief.js';
import { getMatrix, updateMatrixCell } from '../../../content-matrices.js';
import { getTemplate } from '../../../content-templates.js';
import { getPost } from '../../../content-posts-db.js';
import db from '../../../db/index.js';
import { parseJsonSafe } from '../../../db/json-validation.js';
import { createStmtCache } from '../../../db/stmt-cache.js';
import { z } from '../../../middleware/validate.js';
import { canonicalGenerationFingerprint } from './fingerprint.js';
import { MatrixReadServiceError, resolveMatrixStructures } from './read-service.js';
import { matrixCellSectionEvidenceRequirementId } from './requirements.js';

const evidenceValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('number'), value: z.number().finite(), unit: z.string().min(1).optional() }).strict(),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('text_list'), value: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({
    kind: z.literal('link_list'),
    value: z.array(z.object({
      href: z.string().trim().min(1).max(GENERATION_INTERNAL_LINK_HREF_MAX_LENGTH)
        .regex(/^\/(?!\/)[^\s?#]*\/?$/),
      anchorText: z.string().trim().min(1).max(GENERATION_INTERNAL_LINK_ANCHOR_MAX_LENGTH),
    }).strict()).min(1).max(GENERATION_INTERNAL_LINK_LIMIT),
  }).strict(),
  z.object({ kind: z.literal('date'), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('url'), value: z.string().url() }).strict(),
]);

const sourceRefSchema = z.object({
  sourceType: z.enum(GENERATION_EVIDENCE_SOURCE_TYPES),
  sourceId: z.string().min(1),
  sourceRevision: z.number().int().nonnegative().optional(),
  fieldPath: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  uri: z.string().url().optional(),
  capturedAt: z.string().datetime(),
}).strict();

const resolverSchema = z.object({
  actorType: z.enum(['operator', 'client', 'mcp', 'system']),
  actorId: z.string().min(1),
  actorLabel: z.string().min(1).optional(),
}).strict();

const artifactRevisionsSchema = z.object({
  brief: z.object({
    artifactType: z.literal('content_brief'),
    artifactId: z.string().min(1).nullable(),
    generationRevision: z.number().int().nonnegative(),
  }).strict(),
  post: z.object({
    artifactType: z.literal('generated_post'),
    artifactId: z.string().min(1).nullable(),
    generationRevision: z.number().int().nonnegative(),
  }).strict(),
}).strict();

interface MatrixCellEvidenceRow {
  id: string;
  workspace_id: string;
  matrix_id: string;
  cell_id: string;
  requirement_id: string;
  matrix_revision: number;
  template_revision: number;
  cell_revision: number;
  value: string;
  source_ref: string;
  resolved_by: string;
  expected_artifact_revisions: string;
  idempotency_key: string;
  created_at: string;
}

const stmts = createStmtCache(() => ({
  listCurrent: db.prepare(`
    SELECT *
    FROM content_matrix_cell_evidence
    WHERE workspace_id = ? AND matrix_id = ? AND cell_id = ? AND is_current = 1
    ORDER BY requirement_id, created_at, id
  `),
  findReplay: db.prepare(`
    SELECT *
    FROM content_matrix_cell_evidence
    WHERE workspace_id = ? AND matrix_id = ? AND cell_id = ? AND idempotency_key = ?
  `),
  supersedeCurrent: db.prepare(`
    UPDATE content_matrix_cell_evidence
    SET is_current = 0, superseded_at = @superseded_at
    WHERE workspace_id = @workspace_id
      AND matrix_id = @matrix_id
      AND cell_id = @cell_id
      AND requirement_id = @requirement_id
      AND is_current = 1
  `),
  insert: db.prepare(`
    INSERT INTO content_matrix_cell_evidence (
      id, workspace_id, matrix_id, cell_id, requirement_id,
      matrix_revision, template_revision, cell_revision,
      value, source_ref, resolved_by, expected_artifact_revisions,
      idempotency_key, supersedes_id, is_current, created_at, superseded_at
    ) VALUES (
      @id, @workspace_id, @matrix_id, @cell_id, @requirement_id,
      @matrix_revision, @template_revision, @cell_revision,
      @value, @source_ref, @resolved_by, @expected_artifact_revisions,
      @idempotency_key, @supersedes_id, 1, @created_at, NULL
    )
  `),
  findCurrentRequirement: db.prepare(`
    SELECT id
    FROM content_matrix_cell_evidence
    WHERE workspace_id = ? AND matrix_id = ? AND cell_id = ?
      AND requirement_id = ? AND is_current = 1
  `),
}));

export class MatrixGenerationEvidenceError extends Error {
  readonly code: 'not_found' | 'conflict' | 'precondition_failed' | 'idempotency_conflict';

  constructor(
    code: 'not_found' | 'conflict' | 'precondition_failed' | 'idempotency_conflict',
    message: string,
  ) {
    super(message);
    this.name = 'MatrixGenerationEvidenceError';
    this.code = code;
  }
}

function sourceRevisionFromRow(row: MatrixCellEvidenceRow): MatrixSourceRevision {
  return {
    matrixRevision: row.matrix_revision,
    templateRevision: row.template_revision,
    cellRevision: row.cell_revision,
  };
}

function rowToResolution(row: MatrixCellEvidenceRow): MatrixGenerationEvidenceResolution {
  const value = parseJsonSafe(row.value, evidenceValueSchema, null, {
    workspaceId: row.workspace_id,
    table: 'content_matrix_cell_evidence',
    field: 'value',
  });
  const sourceRef = parseJsonSafe(row.source_ref, sourceRefSchema, null, {
    workspaceId: row.workspace_id,
    table: 'content_matrix_cell_evidence',
    field: 'source_ref',
  });
  const resolvedBy = parseJsonSafe(row.resolved_by, resolverSchema, null, {
    workspaceId: row.workspace_id,
    table: 'content_matrix_cell_evidence',
    field: 'resolved_by',
  });
  const expectedArtifactRevisions = parseJsonSafe(
    row.expected_artifact_revisions,
    artifactRevisionsSchema,
    null,
    {
      workspaceId: row.workspace_id,
      table: 'content_matrix_cell_evidence',
      field: 'expected_artifact_revisions',
    },
  );
  if (!value || !sourceRef || !resolvedBy || !expectedArtifactRevisions) {
    throw new MatrixGenerationEvidenceError(
      'precondition_failed',
      'Stored matrix evidence does not match its typed contract',
    );
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    matrixId: row.matrix_id,
    cellId: row.cell_id,
    requirementId: row.requirement_id,
    value,
    sourceRef,
    resolvedBy,
    expectedSourceRevision: sourceRevisionFromRow(row),
    expectedArtifactRevisions,
    resolvedAt: row.created_at,
  };
}

export function listCurrentMatrixCellEvidence(
  workspaceId: string,
  matrixId: string,
  cellId: string,
): MatrixGenerationEvidenceResolution[] {
  return (stmts().listCurrent.all(workspaceId, matrixId, cellId) as MatrixCellEvidenceRow[])
    .map(rowToResolution);
}

export function matrixArtifactRevisionExpectations(
  workspaceId: string,
  cell: MatrixCell,
): MatrixArtifactRevisionExpectations {
  const brief = cell.briefId ? getBrief(workspaceId, cell.briefId) : undefined;
  const post = cell.postId ? getPost(workspaceId, cell.postId) : undefined;
  return {
    brief: {
      artifactType: 'content_brief',
      artifactId: cell.briefId ?? null,
      generationRevision: brief?.generationRevision ?? 0,
    },
    post: {
      artifactType: 'generated_post',
      artifactId: cell.postId ?? null,
      generationRevision: post?.generationRevision ?? 0,
    },
  };
}

export const MATRIX_CELL_EVIDENCE_REQUIREMENT_SUFFIXES = {
  serviceAvailability: 'service-availability',
  serviceDetails: 'service-details',
  locationRelevance: 'location-relevance',
  ctaDetails: 'cta-details',
} as const;

function requirementId(cellId: string, suffix: string): string {
  return `matrix-cell:${cellId}:${suffix}`;
}

function verifiedSourceRef(
  resolution: MatrixGenerationEvidenceResolution,
): GenerationFactualEvidenceSourceRef {
  return {
    sourceType: 'content_matrix_cell_evidence',
    sourceId: resolution.id,
    fieldPath: resolution.requirementId,
    label: 'Verified matrix-cell evidence',
    capturedAt: resolution.resolvedAt,
  };
}

export function buildMatrixCellEvidenceRequirements(
  target: ResolvedMatrixStructuralTarget,
  resolutions: readonly MatrixGenerationEvidenceResolution[],
): GenerationEvidenceRequirement[] {
  const resolutionByRequirement = new Map(
    resolutions
      .filter(resolution => (
        !resolution.requirementId.includes(':section:')
        || resolution.expectedSourceRevision.templateRevision
          === target.sourceRevision.templateRevision
      ))
      .map(resolution => [resolution.requirementId, resolution]),
  );
  const definitions: Array<{
    id: string;
    fieldPath: string;
    claim: string;
    reason: string;
    requirementStage: 'preflight' | 'ready' | 'optional_omit';
    clientSafePrompt: string;
  }> = [];

  if (target.pageType === 'service' || target.pageType === 'location') {
    definitions.push({
      id: requirementId(target.cellId, MATRIX_CELL_EVIDENCE_REQUIREMENT_SUFFIXES.serviceAvailability),
      fieldPath: 'service.availability',
      claim: 'The target service is available for this page.',
      reason: 'Service and location pages cannot imply an offering that has not been verified.',
      requirementStage: 'preflight',
      clientSafePrompt: 'Confirm that this service is available for the page target.',
    });
    definitions.push({
      id: requirementId(target.cellId, MATRIX_CELL_EVIDENCE_REQUIREMENT_SUFFIXES.serviceDetails),
      fieldPath: 'service.details',
      claim: 'The page has substantive, source-backed details about the target service.',
      reason: 'A service name and availability alone cannot support a grounded full-page explanation.',
      requirementStage: 'preflight',
      clientSafePrompt: 'Provide verified details covering what the service is, what to expect, and relevant considerations or common questions.',
    });
  }
  if (target.pageType === 'location') {
    definitions.push({
      id: requirementId(target.cellId, MATRIX_CELL_EVIDENCE_REQUIREMENT_SUFFIXES.locationRelevance),
      fieldPath: 'location.relevance',
      claim: 'The page has substantive, verified relevance to the target location.',
      reason: 'A location label alone is not evidence for a useful local page.',
      requirementStage: 'preflight',
      clientSafePrompt: 'Provide a verified local detail that makes this page specific to the target location.',
    });
  }
  if (target.blockManifest.blocks.some(block => block.ctaContract.required)) {
    definitions.push({
      id: requirementId(target.cellId, MATRIX_CELL_EVIDENCE_REQUIREMENT_SUFFIXES.ctaDetails),
      fieldPath: 'cta.details',
      claim: 'The page has a verified destination or instruction for its required CTA.',
      reason: 'A required CTA must not invent booking, pricing, contact, or offer details.',
      requirementStage: 'ready',
      clientSafePrompt: 'Provide the verified CTA destination or instruction for this page.',
    });
  }
  const optionalSections = [
    ...target.blockManifest.blocks.flatMap(block => (
      block.source === 'template' && block.optional === true
        ? [{
            sourceSectionId: block.sourceSectionId,
            generationRole: block.generationRole,
          }]
        : []
    )),
    ...(target.blockManifest.omittedOptionalSections ?? []),
  ].sort((left, right) => left.sourceSectionId.localeCompare(right.sourceSectionId));
  for (const section of optionalSections) {
    definitions.push({
      id: matrixCellSectionEvidenceRequirementId(target.cellId, section.sourceSectionId),
      fieldPath: `sections.${section.sourceSectionId}.evidence`,
      claim: `The optional ${section.generationRole} section has source-backed facts.`,
      reason: `The optional section is omitted unless evidence supports it.`,
      requirementStage: 'optional_omit',
      clientSafePrompt: `Provide verified facts for the optional ${section.generationRole} section.`,
    });
  }

  return definitions.map(definition => {
    const resolution = resolutionByRequirement.get(definition.id);
    if (!resolution) {
      return {
        ...definition,
        claimKind: 'factual' as const,
        status: 'missing' as const,
        sourceRefs: [],
      };
    }
    return {
      ...definition,
      claimKind: 'factual' as const,
      status: 'verified' as const,
      sourceRefs: [verifiedSourceRef(resolution)],
    };
  });
}

function evidenceValueText(value: GenerationEvidenceValue): string {
  switch (value.kind) {
    case 'text': return value.value.trim();
    case 'number': return `${value.value}${value.unit ? ` ${value.unit}` : ''}`;
    case 'boolean': return value.value ? 'Confirmed' : 'Not confirmed';
    case 'text_list': return value.value.join('; ');
    case 'link_list': return value.value.map(link => `${link.anchorText} (${link.href})`).join('; ');
    case 'date': return value.value;
    case 'url': return value.value;
  }
}

export function renderMatrixCellEvidencePrompt(
  requirements: readonly GenerationEvidenceRequirement[],
  resolutions: readonly MatrixGenerationEvidenceResolution[],
): string {
  const resolutionByRequirement = new Map(
    resolutions.map(resolution => [resolution.requirementId, resolution]),
  );
  const lines = requirements.flatMap(requirement => {
    const resolution = resolutionByRequirement.get(requirement.id);
    if (resolution && requirement.status === 'verified') {
      return [`- ${requirement.fieldPath}: ${evidenceValueText(resolution.value)}`];
    }
    if (requirement.status === 'missing' && requirement.requirementStage === 'ready') {
      return [`- ${requirement.fieldPath}: [NEEDS CLIENT INPUT: ${requirement.clientSafePrompt ?? requirement.reason}]`];
    }
    return [];
  });
  return lines.length > 0
    ? `MATRIX PAGE FACTS (state naturally; never call them evidence, context, supplied, provided, or verified):\n${lines.join('\n')}`
    : '';
}

function currentSourceRevision(workspaceId: string, matrixId: string, cellId: string): MatrixSourceRevision {
  const matrix = getMatrix(workspaceId, matrixId);
  if (!matrix) throw new MatrixGenerationEvidenceError('not_found', 'Content matrix not found');
  const cell = matrix.cells.find(candidate => candidate.id === cellId);
  if (!cell) throw new MatrixGenerationEvidenceError('not_found', 'Content matrix cell not found');
  const template = getTemplate(workspaceId, matrix.templateId);
  if (!template) throw new MatrixGenerationEvidenceError('not_found', 'Content template not found');
  return {
    matrixRevision: matrix.revision ?? 0,
    templateRevision: template.revision ?? 0,
    cellRevision: cell.revision ?? 0,
  };
}

function assertSame<T>(actual: T, expected: T, message: string): void {
  if (canonicalGenerationFingerprint(actual) !== canonicalGenerationFingerprint(expected)) {
    throw new MatrixGenerationEvidenceError('conflict', message);
  }
}

function assertRequirementValue(requirementIdValue: string, value: GenerationEvidenceValue): void {
  const parsed = evidenceValueSchema.safeParse(value);
  if (!parsed.success) {
    throw new MatrixGenerationEvidenceError('precondition_failed', 'Evidence value is invalid');
  }
  if (requirementIdValue.includes(':section:')) {
    const hasEvidence = (value.kind === 'text' && value.value.trim().length >= 2)
      || (value.kind === 'text_list' && value.value.some(item => item.trim().length >= 2))
      || value.kind === 'number'
      || value.kind === 'date'
      || value.kind === 'url'
      || (value.kind === 'boolean' && value.value);
    if (hasEvidence) return;
    throw new MatrixGenerationEvidenceError(
      'precondition_failed',
      'Optional section evidence must affirm or substantively describe the section facts',
    );
  }
  if (requirementIdValue.endsWith(`:${MATRIX_CELL_EVIDENCE_REQUIREMENT_SUFFIXES.serviceAvailability}`)) {
    if (value.kind === 'boolean' && value.value) return;
    if (value.kind === 'text' && value.value.trim().length >= 2) return;
    if (value.kind === 'text_list' && value.value.length > 0) return;
    throw new MatrixGenerationEvidenceError(
      'precondition_failed',
      'Service availability evidence must affirm or describe the available service',
    );
  }
  if (requirementIdValue.endsWith(`:${MATRIX_CELL_EVIDENCE_REQUIREMENT_SUFFIXES.serviceDetails}`)) {
    if (value.kind === 'text' && value.value.trim().length >= 300) return;
    if (value.kind === 'text_list'
      && value.value.length >= 3
      && value.value.every(item => item.trim().length >= 40)) return;
    throw new MatrixGenerationEvidenceError(
      'precondition_failed',
      'Service details require a substantive verified summary or at least three verified facts',
    );
  }
  if (requirementIdValue.endsWith(`:${MATRIX_CELL_EVIDENCE_REQUIREMENT_SUFFIXES.locationRelevance}`)) {
    if (value.kind === 'text' && value.value.trim().length >= 10) return;
    if (value.kind === 'text_list' && value.value.some(item => item.trim().length >= 5)) return;
    throw new MatrixGenerationEvidenceError(
      'precondition_failed',
      'Location relevance requires a substantive verified local detail',
    );
  }
  if (requirementIdValue.endsWith(`:${MATRIX_CELL_EVIDENCE_REQUIREMENT_SUFFIXES.ctaDetails}`)) {
    if (value.kind === 'text' || value.kind === 'text_list' || value.kind === 'url') return;
    throw new MatrixGenerationEvidenceError(
      'precondition_failed',
      'CTA evidence must provide a destination or instruction',
    );
  }
}

function replayFingerprint(
  resolution: MatrixGenerationEvidenceResolution,
  idempotencyKey: string,
): string {
  return canonicalGenerationFingerprint({
    workspaceId: resolution.workspaceId,
    matrixId: resolution.matrixId,
    cellId: resolution.cellId,
    requirementId: resolution.requirementId,
    value: resolution.value,
    sourceRef: resolution.sourceRef,
    resolvedBy: resolution.resolvedBy,
    expectedSourceRevision: resolution.expectedSourceRevision,
    expectedArtifactRevisions: resolution.expectedArtifactRevisions,
    idempotencyKey,
  });
}

export async function resolveContentMatrixEvidence(
  request: ResolveMatrixGenerationEvidenceRequest,
): Promise<ResolveMatrixGenerationEvidenceResult> {
  const replay = stmts().findReplay.get(
    request.workspaceId,
    request.matrixId,
    request.cellId,
    request.idempotencyKey,
  ) as MatrixCellEvidenceRow | undefined;
  if (replay) {
    const resolution = rowToResolution(replay);
    const expectedFingerprint = canonicalGenerationFingerprint(request);
    if (replayFingerprint(resolution, replay.idempotency_key) !== expectedFingerprint) {
      throw new MatrixGenerationEvidenceError(
        'idempotency_conflict',
        'The evidence idempotency key was already used for different inputs',
      );
    }
    return {
      resolution,
      currentSourceRevision: currentSourceRevision(
        request.workspaceId,
        request.matrixId,
        request.cellId,
      ),
      created: false,
    };
  }

  if ((STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES as readonly string[])
    .includes(request.sourceRef.sourceType)) {
    throw new MatrixGenerationEvidenceError(
      'precondition_failed',
      'Matrix and template structure cannot prove a factual requirement',
    );
  }
  if (!sourceRefSchema.safeParse(request.sourceRef).success
    || !resolverSchema.safeParse(request.resolvedBy).success
    || !artifactRevisionsSchema.safeParse(request.expectedArtifactRevisions).success) {
    throw new MatrixGenerationEvidenceError('precondition_failed', 'Evidence input is invalid');
  }
  assertRequirementValue(request.requirementId, request.value);

  let resolved;
  try {
    resolved = await resolveMatrixStructures({
      workspaceId: request.workspaceId,
      matrixId: request.matrixId,
      selections: [{
        cellId: request.cellId,
        expectedSourceRevision: request.expectedSourceRevision,
      }],
    });
  } catch (error) {
    if (error instanceof MatrixReadServiceError) {
      throw new MatrixGenerationEvidenceError(
        error.code === 'not_found' ? 'not_found' : 'conflict',
        error.message,
      );
    }
    throw error;
  }
  const structural = resolved.results[0];
  if (!structural || structural.status !== 'resolved') {
    throw new MatrixGenerationEvidenceError(
      'precondition_failed',
      'The matrix cell must pass structural preflight before resolving evidence',
    );
  }
  const knownRequirements = buildMatrixCellEvidenceRequirements(structural.target, []);
  if (!knownRequirements.some(requirement => requirement.id === request.requirementId)) {
    throw new MatrixGenerationEvidenceError(
      'precondition_failed',
      'The requirement ID does not belong to this matrix cell',
    );
  }

  return db.transaction((): ResolveMatrixGenerationEvidenceResult => {
    const lateReplay = stmts().findReplay.get(
      request.workspaceId,
      request.matrixId,
      request.cellId,
      request.idempotencyKey,
    ) as MatrixCellEvidenceRow | undefined;
    if (lateReplay) {
      const resolution = rowToResolution(lateReplay);
      if (replayFingerprint(resolution, lateReplay.idempotency_key)
        !== canonicalGenerationFingerprint(request)) {
        throw new MatrixGenerationEvidenceError(
          'idempotency_conflict',
          'The evidence idempotency key was already used for different inputs',
        );
      }
      return {
        resolution,
        currentSourceRevision: currentSourceRevision(
          request.workspaceId,
          request.matrixId,
          request.cellId,
        ),
        created: false,
      };
    }

    const matrix = getMatrix(request.workspaceId, request.matrixId);
    const cell = matrix?.cells.find(candidate => candidate.id === request.cellId);
    const template = matrix ? getTemplate(request.workspaceId, matrix.templateId) : null;
    if (!matrix || !cell || !template) {
      throw new MatrixGenerationEvidenceError('not_found', 'Matrix generation source not found');
    }
    const actualSourceRevision = {
      matrixRevision: matrix.revision ?? 0,
      templateRevision: template.revision ?? 0,
      cellRevision: cell.revision ?? 0,
    };
    assertSame(
      actualSourceRevision,
      request.expectedSourceRevision,
      'The matrix source changed; preview it again before resolving evidence',
    );
    assertSame(
      matrixArtifactRevisionExpectations(request.workspaceId, cell),
      request.expectedArtifactRevisions,
      'A linked artifact changed; preview it again before resolving evidence',
    );

    const current = stmts().findCurrentRequirement.get(
      request.workspaceId,
      request.matrixId,
      request.cellId,
      request.requirementId,
    ) as { id: string } | undefined;
    const now = new Date().toISOString();
    if (current) {
      stmts().supersedeCurrent.run({
        workspace_id: request.workspaceId,
        matrix_id: request.matrixId,
        cell_id: request.cellId,
        requirement_id: request.requirementId,
        superseded_at: now,
      });
    }
    const id = `mce_${randomUUID()}`;
    stmts().insert.run({
      id,
      workspace_id: request.workspaceId,
      matrix_id: request.matrixId,
      cell_id: request.cellId,
      requirement_id: request.requirementId,
      matrix_revision: request.expectedSourceRevision.matrixRevision,
      template_revision: request.expectedSourceRevision.templateRevision,
      cell_revision: request.expectedSourceRevision.cellRevision,
      value: JSON.stringify(request.value),
      source_ref: JSON.stringify(request.sourceRef),
      resolved_by: JSON.stringify(request.resolvedBy),
      expected_artifact_revisions: JSON.stringify(request.expectedArtifactRevisions),
      idempotency_key: request.idempotencyKey,
      supersedes_id: current?.id ?? null,
      created_at: now,
    });

    const updated = updateMatrixCell(
      request.workspaceId,
      request.matrixId,
      request.cellId,
      {},
      {
        expectedMatrixRevision: request.expectedSourceRevision.matrixRevision,
        expectedTemplateRevision: request.expectedSourceRevision.templateRevision,
        expectedCellRevision: request.expectedSourceRevision.cellRevision,
        requireExpectedCellRevision: true,
        revisionReason: 'evidence_resolution',
      },
    );
    const updatedCell = updated?.cells.find(candidate => candidate.id === request.cellId);
    if (!updated || !updatedCell) {
      throw new MatrixGenerationEvidenceError('conflict', 'The matrix cell changed during evidence resolution');
    }
    const stored = stmts().findReplay.get(
      request.workspaceId,
      request.matrixId,
      request.cellId,
      request.idempotencyKey,
    ) as MatrixCellEvidenceRow;
    return {
      resolution: rowToResolution(stored),
      currentSourceRevision: {
        matrixRevision: updated.revision ?? 0,
        templateRevision: template.revision ?? 0,
        cellRevision: updatedCell.revision ?? 0,
      },
      created: true,
    };
  }).immediate();
}
