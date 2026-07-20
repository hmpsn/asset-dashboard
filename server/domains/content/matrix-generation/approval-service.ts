import type {
  ApproveMatrixPageForPublishReadinessRequest,
  ApproveMatrixPageForPublishReadinessResult,
  MatrixPageApprovalEvidence,
} from '../../../../shared/types/matrix-generation.js';
import { isBlockingMatrixGenerationSetAuditFinding } from '../../../../shared/types/matrix-generation.js';
import db from '../../../db/index.js';
import { getMatrix, updateMatrixCell } from '../../../content-matrices.js';
import { getPost, updatePostField } from '../../../content-posts-db.js';
import { queueSchemaPreGeneration } from '../../../schema-queue.js';
import {
  getMatrixGenerationItem,
  getPersistedMatrixGenerationRun,
  projectMatrixGenerationRun,
  recordMatrixPageApprovalEvidence,
} from './repository.js';
import { isMatrixGenerationSetAuditRequired } from './set-audit.js';

export class MatrixPageApprovalPreconditionError extends Error {
  readonly code = 'matrix_page_approval_precondition';

  constructor(message: string) {
    super(message);
    this.name = 'MatrixPageApprovalPreconditionError';
  }
}

/** Records review readiness only. This path deliberately has no publish-policy or CMS dependency. */
export function approveMatrixPageForPublishReadiness(
  request: ApproveMatrixPageForPublishReadinessRequest,
): ApproveMatrixPageForPublishReadinessResult {
  const result = db.transaction(() => {
    const run = getPersistedMatrixGenerationRun(request.workspaceId, request.runId);
    const item = getMatrixGenerationItem(request.workspaceId, request.itemId);
    if (!run || run.revision !== request.expectedRunRevision) {
      throw new MatrixPageApprovalPreconditionError('The matrix generation run changed since review');
    }
    const setAuditRequired = isMatrixGenerationSetAuditRequired(run.selections.length);
    if (
      !item
      || item.runId !== run.id
      || item.revision !== request.expectedItemRevision
      || item.status !== 'ready_for_human_review'
      || item.auditReport?.verdict !== 'ready_for_human_review'
      || item.auditReport.unresolvedRequirementIds.length !== 0
      || item.approvalEvidence !== null
      || !item.previewTarget
      || !item.postId
      || (setAuditRequired && !run.setAuditReport)
      || run.setAuditReport?.findings.some(finding => (
        isBlockingMatrixGenerationSetAuditFinding(finding)
        && finding.affectedItemIds.includes(item.id)
      )) === true
    ) {
      throw new MatrixPageApprovalPreconditionError('This page is not ready for human approval');
    }
    let post = getPost(request.workspaceId, item.postId) ?? null;
    if (!post || post.generationRevision !== request.expectedPostRevision) {
      throw new MatrixPageApprovalPreconditionError('The generated post changed since review');
    }
    if (post.status === 'draft') {
      post = updatePostField(
        request.workspaceId,
        post.id,
        { status: 'review' },
        post.generationRevision,
      );
    }
    if (!post || post.status !== 'review') {
      throw new MatrixPageApprovalPreconditionError('The generated post is not reviewable');
    }
    post = updatePostField(
      request.workspaceId,
      post.id,
      { status: 'approved' },
      post.generationRevision,
    );
    if (!post || post.status !== 'approved') {
      throw new MatrixPageApprovalPreconditionError('The generated post could not be approved');
    }
    const target = item.previewTarget;
    const matrix = getMatrix(request.workspaceId, item.matrixId);
    const cell = matrix?.cells.find(candidate => candidate.id === item.cellId);
    if (
      !matrix
      || !cell
      || cell.postId !== post.id
      || (cell.revision ?? 0) !== target.sourceRevision.cellRevision + 1
    ) {
      throw new MatrixPageApprovalPreconditionError('The matrix page changed since generation');
    }
    let currentCell = cell;
    if (currentCell.status === 'draft') {
      const reviewedMatrix = updateMatrixCell(
        request.workspaceId,
        item.matrixId,
        item.cellId,
        { status: 'review' },
        {
          expectedMatrixRevision: target.sourceRevision.matrixRevision,
          expectedTemplateRevision: target.sourceRevision.templateRevision,
          expectedCellRevision: currentCell.revision ?? 0,
          requireExpectedCellRevision: true,
          skipSchemaPreGeneration: true,
        },
      );
      currentCell = reviewedMatrix?.cells.find(candidate => candidate.id === item.cellId)
        ?? currentCell;
    }
    if (currentCell.status !== 'review') {
      throw new MatrixPageApprovalPreconditionError('The matrix page is not reviewable');
    }
    updateMatrixCell(
      request.workspaceId,
      item.matrixId,
      item.cellId,
      { status: 'approved' },
      {
        expectedMatrixRevision: target.sourceRevision.matrixRevision,
        expectedTemplateRevision: target.sourceRevision.templateRevision,
        expectedCellRevision: currentCell.revision ?? 0,
        requireExpectedCellRevision: true,
        skipSchemaPreGeneration: true,
      },
    );
    const approvalEvidence: MatrixPageApprovalEvidence = {
      runId: run.id,
      itemId: item.id,
      matrixId: item.matrixId,
      cellId: item.cellId,
      sourceRevision: item.sourceRevision,
      postId: post.id,
      postRevision: post.generationRevision,
      approvedBy: request.approvedBy,
      approvedAt: new Date().toISOString(),
    };
    const approvedItem = recordMatrixPageApprovalEvidence({
      workspaceId: request.workspaceId,
      runId: run.id,
      itemId: item.id,
      expectedItemRevision: item.revision,
      evidence: approvalEvidence,
    });
    return {
      run: projectMatrixGenerationRun(run),
      item: approvedItem,
      approvalEvidence,
    };
  }).immediate();
  void queueSchemaPreGeneration(request.workspaceId, result.item.matrixId, result.item.cellId);
  return result;
}
