import { afterEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  createMatrixGenerationRun,
  getMatrixGenerationRun,
  getPersistedMatrixGenerationRun,
  listMatrixGenerationItems,
  MatrixGenerationPersistenceContractError,
  MatrixGenerationRunIdempotencyConflictError,
} from '../../server/domains/content/matrix-generation/repository.js';
import {
  computeBlockManifestFingerprint,
  computeStructuralTargetFingerprint,
} from '../../server/domains/content/matrix-generation/fingerprint.js';
import { getMatrixGeneration } from '../../server/domains/content/matrix-generation/batch-service.js';
import { MatrixGenerationEvidenceError } from '../../server/domains/content/matrix-generation/evidence.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  MATRIX_GENERATION_SOURCE_LIMITS,
  matrixGenerationSerializedBytes,
  type CreateMatrixGenerationRunRequest,
  type MatrixGenerationItem,
  type PersistedMatrixGenerationRun,
} from '../../shared/types/matrix-generation.js';

const cleanup: string[] = [];

type StoredStructuralTarget = NonNullable<MatrixGenerationItem['structuralTarget']>;
type StoredPreviewTarget = NonNullable<MatrixGenerationItem['previewTarget']>;

afterEach(() => {
  for (const workspaceId of cleanup.splice(0)) {
    db.prepare('DELETE FROM content_matrix_generation_items WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM content_matrix_generation_runs WHERE workspace_id = ?').run(workspaceId);
    deleteWorkspace(workspaceId);
  }
});

function requestFor(workspaceId: string): CreateMatrixGenerationRunRequest {
  const matrixId = 'matrix-source-deleted-later';
  const templateId = 'template-source-deleted-later';
  const cellId = 'cell-1';
  const sourceRevision = { matrixRevision: 3, templateRevision: 4, cellRevision: 5 };
  const structuralTarget = structuralTargetFixture({
    workspaceId,
    matrixId,
    templateId,
    cellId,
    sourceRevision,
  });
  return {
    workspaceId,
    matrixId,
    templateId,
    idempotencyKey: 'matrix-run-idempotency-1',
    selectionFingerprint: 'selection-fingerprint-1',
    selections: [{
      matrixId,
      cellId,
      sourceRevision,
      structuralFingerprint: structuralTarget.structuralFingerprint,
      previewFingerprint: 'preview-fingerprint-1',
    }],
    createdBy: {
      actorType: 'mcp',
      actorId: 'workspace-key-1',
      actorLabel: 'Automation key',
    },
    mcpExecutionContext: {
      requestId: 'request-1',
      toolName: 'start_content_matrix_generation',
      targetWorkspaceId: workspaceId,
      caller: {
        kind: 'workspace_key',
        scope: workspaceId,
        workspaceId,
        keyId: 'workspace-key-1',
        keyLabel: 'Automation key',
      },
    },
  };
}

interface StructuralTargetFixtureIdentity {
  workspaceId: string;
  matrixId: string;
  templateId: string;
  cellId: string;
  sourceRevision: MatrixGenerationItem['sourceRevision'];
}

function structuralTargetFixture(
  identity: StructuralTargetFixtureIdentity,
): StoredStructuralTarget {
  const blockManifestCore: Omit<StoredStructuralTarget['blockManifest'], 'fingerprint'> = {
    generationContractVersion: 1,
    blocks: [
      {
        id: 'system:introduction',
        source: 'system',
        generationRole: 'introduction',
        order: 0,
        heading: { level: null, renderedText: null, locked: true },
        guidance: 'Open directly.',
        aeoContract: { modes: ['answer_first'], required: true },
        ctaContract: { role: 'none', required: false },
      },
      {
        id: 'template:body',
        source: 'template',
        sourceSectionId: 'body',
        generationRole: 'body',
        order: 1,
        heading: { level: 2, renderedText: 'Dental care in Austin', locked: true },
        guidance: 'Explain the service using grounded evidence.',
        wordCountTarget: 300,
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'none', required: false },
      },
      {
        id: 'system:conclusion',
        source: 'system',
        generationRole: 'conclusion',
        order: 2,
        heading: { level: 2, renderedText: null, locked: false },
        guidance: 'Close with a grounded next step.',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'primary', required: true },
      },
    ],
    totalWordCountTarget: 300,
  };
  const blockManifest: StoredStructuralTarget['blockManifest'] = {
    ...blockManifestCore,
    fingerprint: computeBlockManifestFingerprint(blockManifestCore),
  };
  const targetCore: Omit<StoredStructuralTarget, 'structuralFingerprint'> = {
    ...identity,
    variableValues: { city: 'Austin' },
    slugSubstitutions: { city: 'austin' },
    proseSubstitutions: { city: 'Austin' },
    targetKeyword: {
      value: 'Austin dentist',
      source: 'target',
      evidenceRefs: [],
    },
    plannedUrl: '/dentist/austin',
    title: 'Austin Dentist',
    metaDescription: 'Find an Austin dentist.',
    renderedHeadings: ['Dental care in Austin'],
    pageType: 'service',
    schemaTypes: [],
    blockManifest,
    generationContractVersion: 1,
    structuralRequirements: [],
    structuralBlockingRequirementIds: [],
  };
  return {
    ...targetCore,
    structuralFingerprint: computeStructuralTargetFingerprint(targetCore),
  };
}

function structuralTargetFor(
  workspaceId: string,
  run: PersistedMatrixGenerationRun,
  item: MatrixGenerationItem,
): StoredStructuralTarget {
  return structuralTargetFixture({
    workspaceId,
    matrixId: run.matrixId,
    templateId: run.templateId,
    cellId: item.cellId,
    sourceRevision: item.sourceRevision,
  });
}

function previewTargetFor(
  workspaceId: string,
  run: PersistedMatrixGenerationRun,
  item: MatrixGenerationItem,
  frozenEvidenceResolutionIds: string[] = [],
): StoredPreviewTarget {
  const capturedAt = '2026-07-13T00:00:00.000Z';
  return {
    ...structuralTargetFor(workspaceId, run, item),
    voiceSnapshot: {
      voiceProfileId: 'voice-profile-1',
      voiceVersion: 1,
      finalizedBy: {
        actorType: 'operator',
        actorId: 'operator-1',
        actorLabel: 'Content lead',
      },
      finalizedAt: capturedAt,
      fingerprint: 'a'.repeat(64),
      anchorEvidenceRefs: [{
        sourceType: 'client_submission',
        sourceId: 'client-submission-1',
        capturedAt,
        selectedBy: {
          actorType: 'operator',
          actorId: 'operator-1',
          actorLabel: 'Content lead',
        },
        selectedAt: capturedAt,
      }],
    },
    identitySnapshot: [],
    evidenceRequirements: [],
    evidenceCapturedAt: capturedAt,
    evidenceFreshThrough: capturedAt,
    expectedArtifactRevisions: {
      brief: {
        artifactType: 'content_brief',
        artifactId: null,
        generationRevision: 0,
      },
      post: {
        artifactType: 'generated_post',
        artifactId: null,
        generationRevision: 0,
      },
    },
    effectiveInputFingerprint: item.previewFingerprint,
    blockingRequirementIds: [],
    frozenEvidenceResolutionIds,
    estimatedPaidBudget: {
      providerCalls: 2,
      inputTokens: 1_000,
      outputTokens: 2_000,
      estimatedUsd: 0.05,
      maxConcurrency: 1,
    },
  };
}

function storeStructuralTarget(
  workspaceId: string,
  itemId: string,
  target: unknown,
): void {
  db.prepare(`
    UPDATE content_matrix_generation_items
    SET structural_target = ?
    WHERE id = ? AND workspace_id = ?
  `).run(JSON.stringify(target), itemId, workspaceId);
}

function storePreviewTarget(
  workspaceId: string,
  itemId: string,
  target: unknown,
): void {
  db.prepare(`
    UPDATE content_matrix_generation_items
    SET preview_target = ?
    WHERE id = ? AND workspace_id = ?
  `).run(JSON.stringify(target), itemId, workspaceId);
}

describe('content matrix generation repository', () => {
  it('persists internal MCP attribution but redacts key identity from the public run', () => {
    const workspaceId = createWorkspace(`matrix repository ${Date.now()}`).id;
    cleanup.push(workspaceId);

    const created = createMatrixGenerationRun(requestFor(workspaceId));

    expect(created.existing).toBe(false);
    expect(created.run).toMatchObject({
      workspaceId,
      matrixId: 'matrix-source-deleted-later',
      templateId: 'template-source-deleted-later',
      status: 'queued',
      revision: 0,
      counts: { selected: 1, queued: 1 },
      selections: [{
        cellId: 'cell-1',
        sourceRevision: { matrixRevision: 3, templateRevision: 4, cellRevision: 5 },
        previewFingerprint: 'preview-fingerprint-1',
      }],
      mcpExecutionContext: {
        requestId: 'request-1',
        caller: { keyId: 'workspace-key-1' },
      },
      createdBy: {
        actorType: 'mcp',
        actorId: 'workspace-key-1',
        actorLabel: 'Automation key',
      },
    });
    const itemCount = db.prepare(
      'SELECT COUNT(*) AS count FROM content_matrix_generation_items WHERE run_id = ?',
    ).get(created.run.id) as { count: number };
    expect(itemCount.count).toBe(1);
    expect(getPersistedMatrixGenerationRun(workspaceId, created.run.id)).toEqual(created.run);

    const publicRun = getMatrixGenerationRun(workspaceId, created.run.id);
    expect(publicRun).toMatchObject({
      id: created.run.id,
      createdBy: { actorType: 'mcp' },
    });
    expect(publicRun?.createdBy).toEqual({ actorType: 'mcp' });
    expect(publicRun).not.toHaveProperty('mcpExecutionContext');
    expect(publicRun).not.toHaveProperty('idempotencyKey');
    expect(JSON.stringify(publicRun)).not.toContain('workspace-key-1');
    expect(JSON.stringify(publicRun)).not.toContain('Automation key');
    expect(JSON.stringify(publicRun)).not.toContain(created.run.idempotencyKey);
  });

  it('retains human review identity in the public creator projection', () => {
    const workspaceId = createWorkspace(`matrix human creator ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const request = requestFor(workspaceId);
    const created = createMatrixGenerationRun({
      ...request,
      createdBy: {
        actorType: 'operator',
        actorId: 'operator-1',
        actorLabel: 'Content lead',
      },
      mcpExecutionContext: null,
    });

    expect(getMatrixGenerationRun(workspaceId, created.run.id)?.createdBy).toEqual({
      actorType: 'operator',
      actorId: 'operator-1',
      actorLabel: 'Content lead',
    });
  });

  it('requires execution context exactly for MCP-attributed runs', () => {
    const workspaceId = createWorkspace(`matrix creator context ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const request = requestFor(workspaceId);

    expect(() => createMatrixGenerationRun({
      ...request,
      mcpExecutionContext: null,
    })).toThrow(MatrixGenerationPersistenceContractError);

    expect(() => createMatrixGenerationRun({
      ...request,
      createdBy: {
        actorType: 'operator',
        actorId: 'operator-with-mcp-context',
      },
    })).toThrowError(expect.objectContaining({
      name: 'MatrixGenerationPersistenceContractError',
      message: 'MCP execution context requires MCP creator attribution',
    }));

    for (const [index, actorType] of (['operator', 'client', 'system'] as const).entries()) {
      const created = createMatrixGenerationRun({
        ...request,
        idempotencyKey: `non-mcp-creator-${index}`,
        selectionFingerprint: `non-mcp-selection-${index}`,
        createdBy: {
          actorType,
          actorId: `${actorType}-1`,
        },
        mcpExecutionContext: null,
      });
      expect(created.run.createdBy.actorType).toBe(actorType);
    }
  });

  it('fails closed when stored creator attribution and MCP context drift apart', () => {
    const workspaceId = createWorkspace(`matrix stored creator context ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const base = requestFor(workspaceId);
    const validContext = base.mcpExecutionContext!;
    const corruptions: Array<{
      label: string;
      createdBy: unknown;
      context: unknown | null;
    }> = [
      {
        label: 'missing MCP context',
        createdBy: base.createdBy,
        context: null,
      },
      {
        label: 'wrong target workspace',
        createdBy: base.createdBy,
        context: { ...validContext, targetWorkspaceId: 'another-workspace' },
      },
      {
        label: 'wrong workspace-key identity',
        createdBy: base.createdBy,
        context: {
          ...validContext,
          caller: {
            ...validContext.caller,
            keyId: 'another-workspace-key',
          },
        },
      },
      {
        label: 'non-MCP creator with MCP context',
        createdBy: { actorType: 'operator', actorId: 'operator-1' },
        context: validContext,
      },
    ];

    for (const [index, corruption] of corruptions.entries()) {
      const created = createMatrixGenerationRun({
        ...base,
        idempotencyKey: `stored-context-${index}`,
        selectionFingerprint: `stored-context-selection-${index}`,
      });
      db.prepare(`
        UPDATE content_matrix_generation_runs
           SET created_by = ?, mcp_execution_context = ?
         WHERE id = ? AND workspace_id = ?
      `).run(
        JSON.stringify(corruption.createdBy),
        corruption.context === null ? null : JSON.stringify(corruption.context),
        created.run.id,
        workspaceId,
      );

      expect(
        () => getPersistedMatrixGenerationRun(workspaceId, created.run.id),
        corruption.label,
      ).toThrowError(expect.objectContaining({
        name: 'MatrixGenerationPersistenceContractError',
        message: expect.stringContaining('Stored matrix generation attribution is inconsistent'),
      }));
    }
  });

  it('replays the same resource-scoped idempotency key and fingerprint', () => {
    const workspaceId = createWorkspace(`matrix replay ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const request = requestFor(workspaceId);

    const first = createMatrixGenerationRun(request);
    const replay = createMatrixGenerationRun(request);

    expect(replay.existing).toBe(true);
    expect(replay.run.id).toBe(first.run.id);
    const rows = db.prepare(`
      SELECT COUNT(*) AS count FROM content_matrix_generation_runs
      WHERE workspace_id = ? AND matrix_id = ?
    `).get(workspaceId, request.matrixId) as { count: number };
    expect(rows.count).toBe(1);
  });

  it('lists items in selected order and scopes the projection by workspace and run', () => {
    const workspaceId = createWorkspace(`matrix item list ${Date.now()}`).id;
    const otherWorkspaceId = createWorkspace(`matrix item list other ${Date.now()}`).id;
    cleanup.push(workspaceId, otherWorkspaceId);
    const base = requestFor(workspaceId);
    const created = createMatrixGenerationRun({
      ...base,
      selections: [
        base.selections[0],
        {
          ...base.selections[0],
          cellId: 'cell-2',
          sourceRevision: { matrixRevision: 3, templateRevision: 4, cellRevision: 9 },
          structuralFingerprint: 'structural-fingerprint-2',
          previewFingerprint: 'preview-fingerprint-2',
        },
      ],
    });

    const items = listMatrixGenerationItems(workspaceId, created.run.id);
    expect(items.map(item => ({
      cellId: item.cellId,
      structuralFingerprint: item.structuralFingerprint,
      previewFingerprint: item.previewFingerprint,
    }))).toEqual([
      {
        cellId: 'cell-1',
        structuralFingerprint: base.selections[0].structuralFingerprint,
        previewFingerprint: 'preview-fingerprint-1',
      },
      {
        cellId: 'cell-2',
        structuralFingerprint: 'structural-fingerprint-2',
        previewFingerprint: 'preview-fingerprint-2',
      },
    ]);
    expect(listMatrixGenerationItems(otherWorkspaceId, created.run.id)).toEqual([]);
    expect(listMatrixGenerationItems(workspaceId, 'missing-run')).toEqual([]);
  });

  it('fails closed when stored item snapshots do not match their durable row identity', () => {
    const workspaceId = createWorkspace(`matrix snapshot binding ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const created = createMatrixGenerationRun(requestFor(workspaceId));
    const [item] = listMatrixGenerationItems(workspaceId, created.run.id);
    const canonicalTarget = structuralTargetFor(workspaceId, created.run, item);
    const corruptions: Array<{
      label: string;
      mutate: (target: StoredStructuralTarget) => void;
    }> = [
      {
        label: 'workspace identity',
        mutate: target => { target.workspaceId = 'another-workspace'; },
      },
      {
        label: 'matrix identity',
        mutate: target => { target.matrixId = 'another-matrix'; },
      },
      {
        label: 'template identity',
        mutate: target => { target.templateId = 'another-template'; },
      },
      {
        label: 'cell identity',
        mutate: target => { target.cellId = 'another-cell'; },
      },
      {
        label: 'source revision',
        mutate: target => { target.sourceRevision.cellRevision += 1; },
      },
      {
        label: 'shape-valid structural payload',
        mutate: target => { target.title = 'A tampered but shape-valid title'; },
      },
      {
        label: 'shape-valid block manifest payload',
        mutate: target => { target.blockManifest.blocks[1]!.guidance = 'Tampered guidance.'; },
      },
      {
        label: 'block manifest fingerprint',
        mutate: target => { target.blockManifest.fingerprint = 'another-manifest-fingerprint'; },
      },
      {
        label: 'blank schema type',
        mutate: target => { target.schemaTypes = ['Service', ' ']; },
      },
      {
        label: 'duplicate schema type',
        mutate: target => { target.schemaTypes = ['Service', 'Service']; },
      },
      {
        label: 'structural fingerprint',
        mutate: target => { target.structuralFingerprint = 'another-fingerprint'; },
      },
    ];

    for (const corruption of corruptions) {
      const target = structuredClone(canonicalTarget);
      corruption.mutate(target);
      storeStructuralTarget(workspaceId, item.id, target);
      expect(
        () => listMatrixGenerationItems(workspaceId, created.run.id),
        corruption.label,
      ).toThrow(MatrixGenerationPersistenceContractError);
    }

    storeStructuralTarget(workspaceId, item.id, canonicalTarget);
    const canonicalPreviewTarget = previewTargetFor(workspaceId, created.run, item);
    storePreviewTarget(workspaceId, item.id, canonicalPreviewTarget);
    const [hydratedCanonicalItem] = listMatrixGenerationItems(workspaceId, created.run.id);
    expect(hydratedCanonicalItem.structuralTarget?.structuralFingerprint).toBe(
      item.structuralFingerprint,
    );
    expect(hydratedCanonicalItem.previewTarget?.effectiveInputFingerprint).toBe(
      item.previewFingerprint,
    );
    const legacyPreviewTarget = structuredClone(canonicalPreviewTarget) as Omit<
      StoredPreviewTarget,
      'frozenEvidenceResolutionIds'
    > & { frozenEvidenceResolutionIds?: string[] };
    delete legacyPreviewTarget.frozenEvidenceResolutionIds;
    legacyPreviewTarget.evidenceRequirements = [{
      id: `matrix-cell:${item.cellId}:service-details`,
      fieldPath: 'service.details',
      claim: 'Verified service details are available.',
      reason: 'Service pages require grounded details.',
      requirementStage: 'preflight',
      claimKind: 'factual',
      status: 'verified',
      sourceRefs: [{
        sourceType: 'content_matrix_cell_evidence',
        sourceId: 'legacy-frozen-evidence-id',
        capturedAt: '2026-07-13T00:00:00.000Z',
      }],
      resolvable: true,
      resolutionAuthority: 'evidence_submission',
    }];
    storePreviewTarget(workspaceId, item.id, legacyPreviewTarget);
    const [hydratedLegacyItem] = listMatrixGenerationItems(workspaceId, created.run.id);
    expect(hydratedLegacyItem.previewTarget?.frozenEvidenceResolutionIds)
      .toEqual(['legacy-frozen-evidence-id']);
    expect(hydratedLegacyItem.previewTarget?.evidenceRequirements[0]).toMatchObject({
      resolvable: true,
      resolutionAuthority: 'evidence_submission',
    });
    storePreviewTarget(workspaceId, item.id, canonicalPreviewTarget);
    const previewCorruptions: Array<{
      label: string;
      mutate: (target: StoredPreviewTarget) => void;
    }> = [
      {
        label: 'preview source revision',
        mutate: target => { target.sourceRevision.templateRevision += 1; },
      },
      {
        label: 'accepted preview fingerprint',
        mutate: target => { target.effectiveInputFingerprint = 'another-preview-fingerprint'; },
      },
      {
        label: 'preview structural payload',
        mutate: target => { target.metaDescription = 'A tampered preview description.'; },
      },
    ];
    for (const corruption of previewCorruptions) {
      const target = structuredClone(canonicalPreviewTarget);
      corruption.mutate(target);
      storePreviewTarget(workspaceId, item.id, target);
      expect(
        () => listMatrixGenerationItems(workspaceId, created.run.id),
        corruption.label,
      ).toThrow(MatrixGenerationPersistenceContractError);
    }
  });

  it('recomputes a stored block manifest even when the outer target and row agree', () => {
    const workspaceId = createWorkspace(`matrix manifest fingerprint ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const created = createMatrixGenerationRun(requestFor(workspaceId));
    const [item] = listMatrixGenerationItems(workspaceId, created.run.id);
    const tamperedTarget = structuralTargetFor(workspaceId, created.run, item);
    tamperedTarget.blockManifest.blocks[1]!.guidance = 'Shape-valid forged guidance.';
    tamperedTarget.structuralFingerprint = computeStructuralTargetFingerprint(tamperedTarget);

    db.prepare(`
      UPDATE content_matrix_generation_items
         SET structural_target = ?, structural_fingerprint = ?
       WHERE id = ? AND workspace_id = ?
    `).run(
      JSON.stringify(tamperedTarget),
      tamperedTarget.structuralFingerprint,
      item.id,
      workspaceId,
    );

    expect(() => listMatrixGenerationItems(workspaceId, created.run.id)).toThrowError(
      expect.objectContaining<Partial<MatrixGenerationPersistenceContractError>>({
        message: 'Stored matrix generation item structural_target does not match its durable row identity',
      }),
    );
  });

  it('fails closed when a stored run count no longer matches its item snapshot', () => {
    const workspaceId = createWorkspace(`matrix count binding ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const created = createMatrixGenerationRun(requestFor(workspaceId));
    db.prepare(`
      UPDATE content_matrix_generation_runs
         SET selected_count = selected_count + 1
       WHERE id = ? AND workspace_id = ?
    `).run(created.run.id, workspaceId);

    expect(() => getPersistedMatrixGenerationRun(workspaceId, created.run.id)).toThrowError(
      expect.objectContaining<Partial<MatrixGenerationPersistenceContractError>>({
        message: 'Stored matrix generation selected count does not match its item snapshot',
      }),
    );
  });

  it('fails closed when a stored audit report violates the shared ready verdict contract', () => {
    const workspaceId = createWorkspace(`matrix corrupt item ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const created = createMatrixGenerationRun(requestFor(workspaceId));
    const [item] = listMatrixGenerationItems(workspaceId, created.run.id);
    db.prepare(`
      UPDATE content_matrix_generation_items
      SET audit_report = ?
      WHERE id = ? AND workspace_id = ?
    `).run(JSON.stringify({
      verdict: 'ready_for_human_review',
      deterministicChecks: [{
        id: 'deterministic-failure',
        category: 'structure',
        result: 'failed',
        message: 'Failed but falsely marked ready',
        evidenceRequirementIds: [],
      }],
      modelFindings: [],
      humanRequiredChecks: [],
      revisionCount: 0,
      unresolvedRequirementIds: [],
      auditedAt: '2026-07-13T00:00:00.000Z',
    }), item.id, workspaceId);

    expect(() => listMatrixGenerationItems(workspaceId, created.run.id)).toThrow(
      MatrixGenerationPersistenceContractError,
    );
  });

  it('fails closed instead of returning private fields embedded in an evidence reference', () => {
    const workspaceId = createWorkspace(`matrix private evidence ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const created = createMatrixGenerationRun(requestFor(workspaceId));
    const [item] = listMatrixGenerationItems(workspaceId, created.run.id);
    const capturedAt = '2026-07-13T00:00:00.000Z';
    const structuralTarget = {
      workspaceId,
      matrixId: created.run.matrixId,
      templateId: created.run.templateId,
      cellId: item.cellId,
      sourceRevision: item.sourceRevision,
      variableValues: { city: 'Austin' },
      slugSubstitutions: { city: 'austin' },
      proseSubstitutions: { city: 'Austin' },
      targetKeyword: {
        value: 'Austin dentist',
        source: 'target',
        evidenceRefs: [{
          sourceType: 'content_matrix_cell',
          sourceId: item.cellId,
          sourceRevision: item.sourceRevision.cellRevision,
          capturedAt,
          rawPrivateEvidence: 'must-never-cross-the-read-boundary',
        }],
      },
      plannedUrl: '/dentist/austin',
      title: 'Austin Dentist',
      metaDescription: 'Find an Austin dentist.',
      renderedHeadings: [],
      pageType: 'service',
      schemaTypes: [],
      blockManifest: {
        generationContractVersion: 1,
        blocks: [
          {
            id: 'system:introduction',
            source: 'system',
            generationRole: 'introduction',
            order: 0,
            heading: { level: null, renderedText: null, locked: true },
            guidance: 'Open directly.',
            aeoContract: { modes: ['answer_first'], required: true },
            ctaContract: { role: 'none', required: false },
          },
          {
            id: 'system:conclusion',
            source: 'system',
            generationRole: 'conclusion',
            order: 1,
            heading: { level: 2, renderedText: null, locked: false },
            guidance: 'Close with a grounded next step.',
            aeoContract: { modes: [], required: false },
            ctaContract: { role: 'primary', required: true },
          },
        ],
        totalWordCountTarget: 0,
        fingerprint: 'block-fingerprint',
      },
      generationContractVersion: 1,
      structuralRequirements: [],
      structuralBlockingRequirementIds: [],
      structuralFingerprint: 'structural-fingerprint',
    };
    db.prepare(`
      UPDATE content_matrix_generation_items
      SET structural_target = ?
      WHERE id = ? AND workspace_id = ?
    `).run(JSON.stringify(structuralTarget), item.id, workspaceId);

    expect(() => listMatrixGenerationItems(workspaceId, created.run.id)).toThrow(
      MatrixGenerationPersistenceContractError,
    );
  });

  it('accepts the canonical CTA fallback and rejects forged structural or preview CTA manifests', () => {
    const workspaceId = createWorkspace(`matrix CTA manifest ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const created = createMatrixGenerationRun(requestFor(workspaceId));
    const [item] = listMatrixGenerationItems(workspaceId, created.run.id);
    const canonicalTarget = structuralTargetFor(workspaceId, created.run, item);

    storeStructuralTarget(workspaceId, item.id, canonicalTarget);
    const [stored] = listMatrixGenerationItems(workspaceId, created.run.id);
    expect(stored.structuralTarget?.blockManifest.blocks.filter(block => (
      block.ctaContract.role === 'primary' && block.ctaContract.required
    ))).toHaveLength(1);

    const forgedCtaCases: Array<{
      name: string;
      mutate: (target: StoredStructuralTarget) => void;
    }> = [
      {
        name: 'missing required primary',
        mutate: target => {
          target.blockManifest.blocks.at(-1)!.ctaContract = { role: 'none', required: false };
        },
      },
      {
        name: 'multiple required primaries',
        mutate: target => {
          const templateBlock = target.blockManifest.blocks.find(block => block.source === 'template');
          if (!templateBlock) throw new Error('Expected a template block');
          templateBlock.ctaContract = { role: 'primary', required: true };
        },
      },
      {
        name: 'optional primary',
        mutate: target => {
          target.blockManifest.blocks.at(-1)!.ctaContract = { role: 'primary', required: false };
        },
      },
      {
        name: 'required none role',
        mutate: target => {
          target.blockManifest.blocks[0].ctaContract = { role: 'none', required: true };
        },
      },
    ];

    for (const forgedCase of forgedCtaCases) {
      const forgedTarget = structuredClone(canonicalTarget);
      forgedCase.mutate(forgedTarget);
      storeStructuralTarget(workspaceId, item.id, forgedTarget);
      expect(
        () => listMatrixGenerationItems(workspaceId, created.run.id),
        forgedCase.name,
      ).toThrow(MatrixGenerationPersistenceContractError);
    }

    storeStructuralTarget(workspaceId, item.id, canonicalTarget);
    const forgedPreview = previewTargetFor(workspaceId, created.run, item);
    forgedPreview.blockManifest.blocks.at(-1)!.ctaContract = { role: 'none', required: false };
    storePreviewTarget(workspaceId, item.id, forgedPreview);
    expect(() => listMatrixGenerationItems(workspaceId, created.run.id)).toThrow(
      MatrixGenerationPersistenceContractError,
    );
  });

  it('rejects forged block identity, sequence order, and wrapper placement', () => {
    const workspaceId = createWorkspace(`matrix block manifest ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const created = createMatrixGenerationRun(requestFor(workspaceId));
    const [item] = listMatrixGenerationItems(workspaceId, created.run.id);
    const canonicalTarget = structuralTargetFor(workspaceId, created.run, item);
    const forgedManifestCases: Array<{
      name: string;
      mutate: (target: StoredStructuralTarget) => void;
    }> = [
      {
        name: 'duplicate block ID',
        mutate: target => {
          const templateBlock = target.blockManifest.blocks.find(block => block.source === 'template');
          const conclusion = target.blockManifest.blocks.at(-1);
          if (!templateBlock || !conclusion) throw new Error('Expected canonical manifest blocks');
          const duplicate = structuredClone(templateBlock);
          duplicate.order = 2;
          target.blockManifest.blocks.splice(-1, 0, duplicate);
          conclusion.order = 3;
        },
      },
      {
        name: 'out-of-sequence order values',
        mutate: target => {
          target.blockManifest.blocks[1]!.order = 2;
          target.blockManifest.blocks.at(-1)!.order = 1;
        },
      },
      {
        name: 'source section identity mismatch',
        mutate: target => {
          const templateBlock = target.blockManifest.blocks.find(block => block.source === 'template');
          if (!templateBlock) throw new Error('Expected a template block');
          templateBlock.id = 'template:another-section';
        },
      },
      {
        name: 'reversed system wrappers',
        mutate: target => {
          target.blockManifest.blocks.reverse();
        },
      },
    ];

    for (const forgedCase of forgedManifestCases) {
      const forgedTarget = structuredClone(canonicalTarget);
      forgedCase.mutate(forgedTarget);
      storeStructuralTarget(workspaceId, item.id, forgedTarget);
      expect(
        () => listMatrixGenerationItems(workspaceId, created.run.id),
        forgedCase.name,
      ).toThrow(MatrixGenerationPersistenceContractError);
    }
  });

  it('conflicts when the same idempotency key is reused for another fingerprint', () => {
    const workspaceId = createWorkspace(`matrix conflict ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const request = requestFor(workspaceId);
    createMatrixGenerationRun(request);

    expect(() => createMatrixGenerationRun({
      ...request,
      selectionFingerprint: 'different-selection-fingerprint',
    })).toThrow(MatrixGenerationRunIdempotencyConflictError);
  });

  it('conflicts when a caller reuses the claimed fingerprint for another selection', () => {
    const workspaceId = createWorkspace(`matrix selection conflict ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const request = requestFor(workspaceId);
    createMatrixGenerationRun(request);

    expect(() => createMatrixGenerationRun({
      ...request,
      selections: [{
        ...request.selections[0],
        cellId: 'cell-2',
        sourceRevision: { matrixRevision: 3, templateRevision: 4, cellRevision: 9 },
      }],
    })).toThrow(MatrixGenerationRunIdempotencyConflictError);
  });

  it('rejects a run spanning matrix or template snapshots before writing', () => {
    const workspaceId = createWorkspace(`matrix mixed revisions ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const request = requestFor(workspaceId);
    const secondSelection = {
      ...request.selections[0],
      cellId: 'cell-2',
      structuralFingerprint: 'structural-fingerprint-2',
      previewFingerprint: 'preview-fingerprint-2',
    };

    for (const sourceRevision of [
      { matrixRevision: 4, templateRevision: 4, cellRevision: 9 },
      { matrixRevision: 3, templateRevision: 5, cellRevision: 9 },
    ]) {
      expect(() => createMatrixGenerationRun({
        ...request,
        selections: [
          request.selections[0],
          { ...secondSelection, sourceRevision },
        ],
      })).toThrowError(expect.objectContaining({
        name: 'MatrixGenerationPersistenceContractError',
        message: 'Every selection in a run must share the same matrix and template revisions',
      }));
    }

    const rows = db.prepare(`
      SELECT COUNT(*) AS count FROM content_matrix_generation_runs WHERE workspace_id = ?
    `).get(workspaceId) as { count: number };
    expect(rows.count).toBe(0);
  });

  it('rejects non-previewed, empty, duplicate, and cross-workspace selections before writing', () => {
    const workspaceId = createWorkspace(`matrix invalid ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const request = requestFor(workspaceId);

    const invalidRequests: CreateMatrixGenerationRunRequest[] = [
      { ...request, selections: [] as never },
      {
        ...request,
        selections: [{ ...request.selections[0], previewFingerprint: '' }],
      },
      {
        ...request,
        selections: [request.selections[0], request.selections[0]],
      },
      {
        ...request,
        selections: [{ ...request.selections[0], matrixId: 'another-matrix' }],
      },
      {
        ...request,
        selections: [{
          ...request.selections[0],
          sourceRevision: { matrixRevision: -1, templateRevision: 4, cellRevision: 5 },
        }],
      },
      {
        ...request,
        selections: [{
          ...request.selections[0],
          debug: 'must-not-affect-idempotency',
        }] as CreateMatrixGenerationRunRequest['selections'],
      },
      {
        ...request,
        mcpExecutionContext: {
          ...request.mcpExecutionContext!,
          targetWorkspaceId: 'another-workspace',
        },
      },
      {
        ...request,
        mcpExecutionContext: {
          ...request.mcpExecutionContext!,
          caller: {
            ...request.mcpExecutionContext!.caller,
            scope: 'another-workspace',
          },
        } as CreateMatrixGenerationRunRequest['mcpExecutionContext'],
      },
      {
        ...request,
        createdBy: {
          ...request.createdBy,
          bearerToken: 'must-never-be-stored',
        } as CreateMatrixGenerationRunRequest['createdBy'],
      },
      {
        ...request,
        mcpExecutionContext: {
          ...request.mcpExecutionContext!,
          rawArguments: { prompt: 'must-never-be-stored' },
        } as CreateMatrixGenerationRunRequest['mcpExecutionContext'],
      },
    ];

    for (const invalid of invalidRequests) {
      expect(() => createMatrixGenerationRun(invalid)).toThrow(
        MatrixGenerationPersistenceContractError,
      );
    }
    const rows = db.prepare(`
      SELECT COUNT(*) AS count FROM content_matrix_generation_runs WHERE workspace_id = ?
    `).get(workspaceId) as { count: number };
    expect(rows.count).toBe(0);
  });

  it('returns at most ten exact frozen evidence rows with truthful truncation metadata', () => {
    const workspaceId = createWorkspace(`matrix frozen evidence read ${Date.now()}`).id;
    cleanup.push(workspaceId);
    const created = createMatrixGenerationRun(requestFor(workspaceId));
    const item = listMatrixGenerationItems(workspaceId, created.run.id)[0];
    const evidenceIds = Array.from({ length: 12 }, (_, index) => `evidence-${index}`);
    const createdAt = '2026-07-20T12:00:00.000Z';

    for (const [index, evidenceId] of evidenceIds.entries()) {
      db.prepare(`
        INSERT INTO content_matrix_cell_evidence (
          id, workspace_id, matrix_id, cell_id, requirement_id,
          matrix_revision, template_revision, cell_revision,
          value, source_ref, resolved_by, expected_artifact_revisions,
          idempotency_key, supersedes_id, is_current, created_at, superseded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        evidenceId,
        workspaceId,
        created.run.matrixId,
        item.cellId,
        `matrix-cell:${item.cellId}:requirement-${index}`,
        item.sourceRevision.matrixRevision,
        item.sourceRevision.templateRevision,
        item.sourceRevision.cellRevision,
        JSON.stringify({ kind: 'text', value: `Verified value ${index}` }),
        JSON.stringify({
          sourceType: 'operator_attestation',
          sourceId: `source-${index}`,
          capturedAt: createdAt,
        }),
        JSON.stringify({ actorType: 'operator', actorId: 'operator-1' }),
        JSON.stringify({
          brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 },
          post: { artifactType: 'generated_post', artifactId: null, generationRevision: 0 },
        }),
        `evidence-read-${index}`,
        null,
        index === 0 ? 0 : 1,
        createdAt,
        index === 0 ? '2026-07-20T13:00:00.000Z' : null,
      );
    }
    storePreviewTarget(
      workspaceId,
      item.id,
      previewTargetFor(workspaceId, created.run, item, evidenceIds),
    );

    const withoutValues = getMatrixGeneration({ workspaceId, runId: created.run.id });
    expect(withoutValues).not.toHaveProperty('evidenceValuesSummary');
    expect(withoutValues.items.items[0]).not.toHaveProperty('evidenceValues');

    const withValues = getMatrixGeneration({
      workspaceId,
      runId: created.run.id,
      includeEvidenceValues: true,
    });
    expect(withValues.evidenceValuesSummary).toEqual({ includedCount: 10, truncated: true });
    expect(withValues.items.nextCursor).toBeTruthy();
    expect(withValues.items.items[0]?.evidenceValues).toHaveLength(10);
    expect(withValues.items.items[0]?.evidenceValues?.map(read => read.resolution.id))
      .toEqual(evidenceIds.slice(0, 10));
    expect(withValues.items.items[0]?.evidenceValues?.[0]).toMatchObject({
      status: 'superseded',
      supersededAt: '2026-07-20T13:00:00.000Z',
    });

    const remainingValues = getMatrixGeneration({
      workspaceId,
      runId: created.run.id,
      cursor: withValues.items.nextCursor!,
      includeEvidenceValues: true,
    });
    expect(remainingValues.evidenceValuesSummary).toEqual({ includedCount: 2, truncated: false });
    expect(remainingValues.items.nextCursor).toBeNull();
    expect(remainingValues.items.items).toHaveLength(1);
    expect(remainingValues.items.items[0]?.id).toBe(item.id);
    expect(remainingValues.items.items[0]?.evidenceValues?.map(read => read.resolution.id))
      .toEqual(evidenceIds.slice(10));
    expect(() => getMatrixGeneration({
      workspaceId,
      runId: created.run.id,
      cursor: withValues.items.nextCursor!,
    })).toThrow(expect.objectContaining({
      details: expect.objectContaining({ reason: 'invalid_cursor', fieldPath: 'cursor' }),
    }));
    const legacyCursorInEvidenceMode = Buffer.from(JSON.stringify({
      version: 1,
      runId: created.run.id,
      runRevision: getPersistedMatrixGenerationRun(workspaceId, created.run.id)!.revision,
      offset: 0,
    }), 'utf8').toString('base64url');
    expect(() => getMatrixGeneration({
      workspaceId,
      runId: created.run.id,
      cursor: legacyCursorInEvidenceMode,
      includeEvidenceValues: true,
    })).toThrow(expect.objectContaining({
      details: expect.objectContaining({ reason: 'invalid_cursor', fieldPath: 'cursor' }),
    }));
    const pastEndCursor = Buffer.from(JSON.stringify({
      version: 1,
      runId: created.run.id,
      runRevision: getPersistedMatrixGenerationRun(workspaceId, created.run.id)!.revision,
      offset: 1,
    }), 'utf8').toString('base64url');
    expect(() => getMatrixGeneration({
      workspaceId,
      runId: created.run.id,
      cursor: pastEndCursor,
    })).toThrow(expect.objectContaining({
      details: expect.objectContaining({ reason: 'invalid_cursor', fieldPath: 'cursor' }),
    }));

    // Each row remains inside the MCP text_list contract (100 items, 2,000
    // characters each), while ten rows cannot fit the bounded read envelope.
    const largeValidValue = JSON.stringify({
      kind: 'text_list',
      value: Array.from({ length: 100 }, (_, index) => (
        `${index}:`.padEnd(2_000, 'x').slice(0, 2_000)
      )),
    });
    db.prepare(`
      UPDATE content_matrix_cell_evidence SET value = ?
      WHERE workspace_id = ? AND matrix_id = ? AND cell_id = ?
    `).run(largeValidValue, workspaceId, created.run.matrixId, item.cellId);

    const pagedEvidenceIds: string[] = [];
    let largeValueCursor: string | undefined;
    let largeValuePages = 0;
    do {
      const page = getMatrixGeneration({
        workspaceId,
        runId: created.run.id,
        cursor: largeValueCursor,
        includeEvidenceValues: true,
      });
      expect(matrixGenerationSerializedBytes(page))
        .toBeLessThanOrEqual(MATRIX_GENERATION_SOURCE_LIMITS.read.maxResponseBytes);
      pagedEvidenceIds.push(...(
        page.items.items[0]?.evidenceValues?.map(read => read.resolution.id) ?? []
      ));
      largeValueCursor = page.items.nextCursor ?? undefined;
      largeValuePages += 1;
    } while (largeValueCursor);
    expect(largeValuePages).toBeGreaterThan(1);
    expect(pagedEvidenceIds).toEqual(evidenceIds);

    db.prepare(`
      UPDATE content_matrix_cell_evidence SET matrix_id = ? WHERE id = ? AND workspace_id = ?
    `).run('matrix-out-of-scope', evidenceIds[0], workspaceId);
    expect(() => getMatrixGeneration({
      workspaceId,
      runId: created.run.id,
      includeEvidenceValues: true,
    })).toThrow(expect.objectContaining<Partial<MatrixGenerationEvidenceError>>({
      code: 'not_found',
    }));
  });

});
