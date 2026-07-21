import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createMatrixGenerationRun,
  getPersistedMatrixGenerationRun,
  listMatrixGenerationAttempts,
  listMatrixGenerationItems,
  saveMatrixGenerationSetAuditReport,
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
  it('records the explicit interruption error for every attemptless nonterminal item path', () => {
    const workspaceId = createWorkspace(`Matrix exhaustive recovery ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    const statusPaths = [
      [] as const,
      ['preflighting'] as const,
      ['preflighting', 'preflighted'] as const,
      ['preflighting', 'preflighted', 'generating_brief'] as const,
      ['preflighting', 'preflighted', 'generating_brief', 'generating_post'] as const,
      ['preflighting', 'preflighted', 'generating_brief', 'generating_post', 'auditing_deterministic'] as const,
      ['preflighting', 'preflighted', 'generating_brief', 'generating_post', 'auditing_deterministic', 'auditing_model'] as const,
      ['preflighting', 'preflighted', 'generating_brief', 'generating_post', 'auditing_deterministic', 'revising'] as const,
    ];
    let run = createMatrixGenerationRun({
      workspaceId,
      matrixId: 'matrix-exhaustive-recovery',
      templateId: 'template-exhaustive-recovery',
      idempotencyKey: `run-${randomUUID()}`,
      selectionFingerprint: '9'.repeat(64),
      selections: statusPaths.map((_, index) => ({
        matrixId: 'matrix-exhaustive-recovery',
        cellId: `cell-exhaustive-${index}`,
        sourceRevision: { matrixRevision: 1, templateRevision: 1, cellRevision: 1 },
        structuralFingerprint: index.toString(16).repeat(64),
        previewFingerprint: ((index + 8) % 16).toString(16).repeat(64),
      })),
      createdBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    }).run;
    run = transitionMatrixGenerationRun({
      workspaceId,
      runId: run.id,
      expectedRevision: run.revision,
      nextStatus: 'running',
    });
    const items = listMatrixGenerationItems(workspaceId, run.id);
    for (const [index, path] of statusPaths.entries()) {
      let item = items[index];
      for (const nextStatus of path) {
        item = transitionMatrixGenerationItem({
          workspaceId,
          itemId: item.id,
          expectedRevision: item.revision,
          nextStatus,
        });
      }
    }

    expect(reconcileMatrixGenerationRunsAfterRestart()).toBe(1);
    expect(listMatrixGenerationItems(workspaceId, run.id)).toEqual(statusPaths.map(() => (
      expect.objectContaining({
        status: 'failed',
        error: expect.objectContaining({
          code: 'matrix_generation_restart_interrupted',
          retryable: true,
        }),
      })
    )));
    expect(getPersistedMatrixGenerationRun(workspaceId, run.id)?.status).toBe('failed');
  });

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

  it('preserves a ready single page because cross-page set audit is not required', () => {
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
    expect(listMatrixGenerationItems(workspaceId, run.id)[0]?.status)
      .toBe('ready_for_human_review');
    expect(getPersistedMatrixGenerationRun(workspaceId, run.id)?.status).toBe('completed');
  });

  it('demotes ready pages when restart interrupts a required multi-page set audit', () => {
    const workspaceId = createWorkspace(`Matrix set-audit recovery ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    let run = createMatrixGenerationRun({
      workspaceId,
      matrixId: 'matrix-set-recovery',
      templateId: 'template-set-recovery',
      idempotencyKey: `run-${randomUUID()}`,
      selectionFingerprint: 'e'.repeat(64),
      selections: [
        {
          matrixId: 'matrix-set-recovery',
          cellId: 'cell-set-recovery-one',
          sourceRevision: { matrixRevision: 1, templateRevision: 1, cellRevision: 1 },
          structuralFingerprint: 'f'.repeat(64),
          previewFingerprint: 'a'.repeat(64),
        },
        {
          matrixId: 'matrix-set-recovery',
          cellId: 'cell-set-recovery-two',
          sourceRevision: { matrixRevision: 1, templateRevision: 1, cellRevision: 1 },
          structuralFingerprint: 'b'.repeat(64),
          previewFingerprint: 'c'.repeat(64),
        },
      ],
      createdBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    }).run;
    run = transitionMatrixGenerationRun({
      workspaceId,
      runId: run.id,
      expectedRevision: run.revision,
      nextStatus: 'running',
    });
    for (let item of listMatrixGenerationItems(workspaceId, run.id)) {
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
    }

    expect(reconcileMatrixGenerationRunsAfterRestart()).toBe(1);
    expect(listMatrixGenerationItems(workspaceId, run.id)).toEqual([
      expect.objectContaining({
        status: 'needs_attention',
        error: expect.objectContaining({
          code: 'matrix_generation_set_audit_incomplete',
          retryable: true,
        }),
      }),
      expect.objectContaining({
        status: 'needs_attention',
        error: expect.objectContaining({
          code: 'matrix_generation_set_audit_incomplete',
          retryable: true,
        }),
      }),
    ]);
    expect(getPersistedMatrixGenerationRun(workspaceId, run.id)?.status)
      .toBe('completed_with_errors');
  });

  it('preserves an audited page while a failed peer is retried to restore the set census', () => {
    const workspaceId = createWorkspace(`Matrix partial recovery ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    let run = createMatrixGenerationRun({
      workspaceId,
      matrixId: 'matrix-partial-recovery',
      templateId: 'template-partial-recovery',
      idempotencyKey: `run-${randomUUID()}`,
      selectionFingerprint: '1'.repeat(64),
      selections: [
        {
          matrixId: 'matrix-partial-recovery',
          cellId: 'cell-ready',
          sourceRevision: { matrixRevision: 1, templateRevision: 1, cellRevision: 1 },
          structuralFingerprint: '2'.repeat(64),
          previewFingerprint: '3'.repeat(64),
        },
        {
          matrixId: 'matrix-partial-recovery',
          cellId: 'cell-failed',
          sourceRevision: { matrixRevision: 1, templateRevision: 1, cellRevision: 1 },
          structuralFingerprint: '4'.repeat(64),
          previewFingerprint: '5'.repeat(64),
        },
      ],
      createdBy: { actorType: 'operator', actorId: 'operator-1' },
      mcpExecutionContext: null,
    }).run;
    run = transitionMatrixGenerationRun({
      workspaceId,
      runId: run.id,
      expectedRevision: run.revision,
      nextStatus: 'running',
    });
    let [readyItem, failedItem] = listMatrixGenerationItems(workspaceId, run.id);
    for (const nextStatus of [
      'preflighting',
      'preflighted',
      'generating_brief',
      'generating_post',
      'auditing_deterministic',
      'ready_for_human_review',
    ] as const) {
      readyItem = transitionMatrixGenerationItem({
        workspaceId,
        itemId: readyItem.id,
        expectedRevision: readyItem.revision,
        nextStatus,
      });
    }
    failedItem = transitionMatrixGenerationItem({
      workspaceId,
      itemId: failedItem.id,
      expectedRevision: failedItem.revision,
      nextStatus: 'failed',
    });
    saveMatrixGenerationSetAuditReport({
      workspaceId,
      runId: run.id,
      expectedRunRevision: run.revision,
      report: {
        verdict: 'needs_attention',
        findings: [{
          id: 'partial-census',
          source: 'deterministic',
          kind: 'provenance',
          code: 'incomplete_candidate_census',
          severity: 'error',
          message: 'One selected page has not reached set review.',
          affectedItemIds: [readyItem.id],
          affectedTargetIds: [`${readyItem.id}:template:body`],
          requiresHumanReview: false,
        }],
        passCount: 1,
        modelProvenance: null,
        auditedAt: new Date().toISOString(),
      },
    });

    expect(reconcileMatrixGenerationRunsAfterRestart()).toBe(1);
    expect(listMatrixGenerationItems(workspaceId, run.id)).toEqual([
      expect.objectContaining({ id: readyItem.id, status: 'ready_for_human_review' }),
      expect.objectContaining({ id: failedItem.id, status: 'failed' }),
    ]);
    expect(getPersistedMatrixGenerationRun(workspaceId, run.id)?.status)
      .toBe('completed_with_errors');
  });

  it('completes a recovered run when every page and its human-only set review are ready', () => {
    const workspaceId = createWorkspace(`Matrix ready recovery ${randomUUID()}`).id;
    cleanupWorkspaceIds.add(workspaceId);
    let run = createMatrixGenerationRun({
      workspaceId,
      matrixId: 'matrix-ready-recovery',
      templateId: 'template-ready-recovery',
      idempotencyKey: `run-${randomUUID()}`,
      selectionFingerprint: 'b'.repeat(64),
      selections: [{
        matrixId: 'matrix-ready-recovery',
        cellId: 'cell-ready-recovery',
        sourceRevision: { matrixRevision: 1, templateRevision: 1, cellRevision: 1 },
        structuralFingerprint: 'c'.repeat(64),
        previewFingerprint: 'd'.repeat(64),
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
    saveMatrixGenerationSetAuditReport({
      workspaceId,
      runId: run.id,
      expectedRunRevision: run.revision,
      report: {
        verdict: 'passed',
        findings: [{
          id: 'human-only-set-warning',
          source: 'model',
          kind: 'provenance',
          code: 'human_confirmation',
          severity: 'warning',
          message: 'A human should confirm this implication during review.',
          affectedItemIds: [item.id],
          affectedTargetIds: [`${item.id}:template:body`],
          requiresHumanReview: true,
        }],
        passCount: 1,
        modelProvenance: null,
        auditedAt: new Date().toISOString(),
      },
    });

    expect(reconcileMatrixGenerationRunsAfterRestart()).toBe(1);
    expect(listMatrixGenerationItems(workspaceId, run.id)[0]?.status)
      .toBe('ready_for_human_review');
    expect(getPersistedMatrixGenerationRun(workspaceId, run.id)?.status).toBe('completed');
  });
});
