import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createMatrixGenerationRun,
  getPersistedMatrixGenerationRun,
  listMatrixGenerationAttempts,
  listMatrixGenerationItems,
  startMatrixGenerationAttempt,
  transitionMatrixGenerationItem,
  transitionMatrixGenerationRun,
} from '../../server/domains/content/matrix-generation/repository.js';
import {
  reconcileMatrixGenerationRunsAfterRestart,
} from '../../server/domains/content/matrix-generation/recovery.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const cleanupWorkspaceIds = new Set<string>();

afterEach(() => {
  for (const workspaceId of cleanupWorkspaceIds) deleteWorkspace(workspaceId);
  cleanupWorkspaceIds.clear();
});

describe('content matrix generation restart recovery', () => {
  it('records interrupted work as retryable failure without repeating it', () => {
    const workspaceId = createWorkspace(`Matrix recovery ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    let run = createMatrixGenerationRun({
      workspaceId,
      matrixId: 'matrix-recovery',
      templateId: 'template-recovery',
      idempotencyKey: `run-${randomUUID()}`,
      selectionFingerprint: 'a'.repeat(64),
      selections: [{
        matrixId: 'matrix-recovery',
        cellId: 'cell-recovery',
        sourceRevision: { matrixRevision: 1, templateRevision: 1, cellRevision: 1 },
        structuralFingerprint: 'b'.repeat(64),
        previewFingerprint: 'c'.repeat(64),
      }],
      createdBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    }).run;
    run = transitionMatrixGenerationRun({
      workspaceId,
      runId: run.id,
      expectedRevision: run.revision,
      nextStatus: 'running',
    });
    let item = listMatrixGenerationItems(workspaceId, run.id)[0];
    item = transitionMatrixGenerationItem({
      workspaceId,
      itemId: item.id,
      expectedRevision: item.revision,
      nextStatus: 'preflighting',
    });
    const attempt = startMatrixGenerationAttempt({
      workspaceId,
      itemId: item.id,
      expectedItemRevision: item.revision,
      stage: 'preflight',
      effectiveInputFingerprint: 'd'.repeat(64),
    });

    expect(reconcileMatrixGenerationRunsAfterRestart()).toBe(1);
    expect(listMatrixGenerationItems(workspaceId, run.id)[0]).toMatchObject({
      status: 'failed',
      error: { code: 'matrix_generation_restart_interrupted', retryable: true },
    });
    expect(listMatrixGenerationAttempts(workspaceId, attempt.item.id)[0]).toMatchObject({
      status: 'failed',
      error: { code: 'matrix_generation_restart_interrupted', retryable: true },
    });
    expect(getPersistedMatrixGenerationRun(workspaceId, run.id)?.status).toBe('failed');
    expect(reconcileMatrixGenerationRunsAfterRestart()).toBe(0);
  });

  it('demotes a ready page when restart interrupts the required set audit', () => {
    const workspaceId = createWorkspace(`Matrix set-audit recovery ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    let run = createMatrixGenerationRun({
      workspaceId,
      matrixId: 'matrix-set-recovery',
      templateId: 'template-set-recovery',
      idempotencyKey: `run-${randomUUID()}`,
      selectionFingerprint: 'e'.repeat(64),
      selections: [{
        matrixId: 'matrix-set-recovery',
        cellId: 'cell-set-recovery',
        sourceRevision: { matrixRevision: 1, templateRevision: 1, cellRevision: 1 },
        structuralFingerprint: 'f'.repeat(64),
        previewFingerprint: 'a'.repeat(64),
      }],
      createdBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    }).run;
    run = transitionMatrixGenerationRun({
      workspaceId,
      runId: run.id,
      expectedRevision: run.revision,
      nextStatus: 'running',
    });
    let item = listMatrixGenerationItems(workspaceId, run.id)[0];
    for (const nextStatus of [
      'preflighting',
      'preflighted',
      'generating_brief',
      'generating_post',
      'auditing_deterministic',
      'ready_for_human_review',
    ] as const) {
      item = transitionMatrixGenerationItem({
        workspaceId,
        itemId: item.id,
        expectedRevision: item.revision,
        nextStatus,
      });
    }

    expect(reconcileMatrixGenerationRunsAfterRestart()).toBe(1);
    expect(listMatrixGenerationItems(workspaceId, run.id)[0]).toMatchObject({
      status: 'needs_attention',
      error: { code: 'matrix_generation_set_audit_incomplete', retryable: true },
    });
    expect(getPersistedMatrixGenerationRun(workspaceId, run.id)?.status)
      .toBe('completed_with_errors');
  });
});
