import type { ApprovalItem } from '../../../shared/types/approvals.js';
import type { ContentMatrix, MatrixCell } from '../../../shared/types/content.js';
import { addActivity } from '../../activity-log.js';
import { createBatch } from '../../approvals.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { getMatrix, updateMatrixCell } from '../../content-matrices.js';
import { getTemplate } from '../../content-templates.js';
import { mirrorApprovalBatchToDeliverable } from '../../domains/inbox/approval-batch-dual-write.js';
import { createLogger } from '../../logger.js';
import { getWorkspace } from '../../workspaces.js';
import { WS_EVENTS } from '../../ws-events.js';
import { InvalidTransitionError, MATRIX_CELL_TRANSITIONS, validateTransition } from '../../state-machines.js';

const log = createLogger('content-plan-review-mutations');

const CLIENT_VISIBLE_CELL_STATUSES = new Set(['review', 'flagged', 'approved', 'published']);
const APPROVABLE_CELL_STATUSES = new Set(['planned', 'keyword_validated', 'brief_generated']);

export class ContentPlanReviewMutationError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ContentPlanReviewMutationError';
    this.status = status;
  }
}

interface SendTemplateForReviewResult {
  batch: ReturnType<typeof createBatch>;
}

interface SendSamplesForReviewResult {
  batch: ReturnType<typeof createBatch>;
  cellsSent: number;
}

interface BatchApproveMatrixCellsResult {
  approvedCount: number;
  totalCells: number;
}

function notifyContentPlanUpdated(workspaceId: string, payload: Record<string, unknown>) {
  broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, { domain: 'content-plan', ...payload });
}

function getMatrixOrThrow(workspaceId: string, matrixId: string): ContentMatrix {
  const matrix = getMatrix(workspaceId, matrixId);
  if (!matrix) throw new ContentPlanReviewMutationError(404, 'Matrix not found');
  return matrix;
}

function getWorkspaceOrThrow(workspaceId: string) {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new ContentPlanReviewMutationError(404, 'Workspace not found');
  return workspace;
}

function buildTemplateDescription(workspaceId: string, matrix: ContentMatrix): string {
  const template = getTemplate(workspaceId, matrix.templateId);
  if (!template) throw new ContentPlanReviewMutationError(404, 'Template not found');

  const sectionSummary = (template.sections || [])
    .map((section, index) => `${index + 1}. ${section.headingTemplate} (${section.wordCountTarget || '~500'} words)`)
    .join('\n');

  return [
    `Page Type: ${template.pageType}`,
    `URL Pattern: ${template.urlPattern || 'N/A'}`,
    `Keyword Pattern: ${template.keywordPattern || 'N/A'}`,
    `Variables: ${(template.variables || []).map(v => v.name).join(', ') || 'None'}`,
    `\nSections:\n${sectionSummary}`,
    template.toneAndStyle ? `\nTone & Style: ${template.toneAndStyle}` : '',
  ].filter(Boolean).join('\n');
}

function buildSampleApprovalItems(selectedCells: MatrixCell[]): Omit<ApprovalItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>[] {
  return selectedCells.map((cell) => ({
    pageId: cell.id,
    pageTitle: cell.targetKeyword,
    pageSlug: cell.plannedUrl || cell.id,
    field: 'content_plan_sample',
    currentValue: '',
    proposedValue: [
      `Keyword: ${cell.targetKeyword}`,
      `Planned URL: ${cell.plannedUrl || 'TBD'}`,
      cell.variableValues ? `Variables: ${Object.entries(cell.variableValues).map(([key, value]) => `${key}=${value}`).join(', ')}` : '',
      cell.keywordValidation ? `Volume: ${cell.keywordValidation.volume}, KD: ${cell.keywordValidation.difficulty}` : '',
    ].filter(Boolean).join('\n'),
  }));
}

export function sendTemplateForReview(workspaceId: string, matrixId: string): SendTemplateForReviewResult {
  const matrix = getMatrixOrThrow(workspaceId, matrixId);
  const workspace = getWorkspaceOrThrow(workspaceId);
  const template = getTemplate(workspaceId, matrix.templateId);
  if (!template) throw new ContentPlanReviewMutationError(404, 'Template not found');

  const batch = createBatch(
    workspaceId,
    workspace.webflowSiteId || '',
    `Content Plan: ${matrix.name} — Template Review`,
    [{
      pageId: matrix.id,
      pageTitle: `Template: ${template.name}`,
      pageSlug: `content-plan-template-${matrix.id}`,
      field: 'content_plan_template',
      currentValue: '',
      proposedValue: buildTemplateDescription(workspaceId, matrix),
    }],
  );

  mirrorApprovalBatchToDeliverable(workspaceId, batch, {
    type: 'content_plan_template',
    source: 'content-plan-template-review',
  });

  broadcastToWorkspace(workspaceId, WS_EVENTS.APPROVAL_UPDATE, { batchId: batch.id, action: 'created' });
  addActivity(
    workspaceId,
    'content_updated',
    `Sent content plan template "${template.name}" for client review`,
    `Matrix: ${matrix.name}`,
    { matrixId: matrix.id, templateId: template.id, batchId: batch.id, action: 'template_review_sent' },
  );
  notifyContentPlanUpdated(workspaceId, {
    matrixId: matrix.id,
    templateId: template.id,
    batchId: batch.id,
    action: 'template_review_sent',
  });
  log.info({ workspaceId, matrixId: matrix.id, batchId: batch.id }, 'Template sent for client review');

  return { batch };
}

export function sendSamplesForReview(
  workspaceId: string,
  matrixId: string,
  cellIds: string[],
): SendSamplesForReviewResult {
  const matrix = getMatrixOrThrow(workspaceId, matrixId);
  const workspace = getWorkspaceOrThrow(workspaceId);
  const selectedCells = matrix.cells.filter((cell) => cellIds.includes(cell.id));
  if (!selectedCells.length) throw new ContentPlanReviewMutationError(400, 'No matching cells found');

  // I3: validate EVERY selected cell can move to 'review' BEFORE creating the batch or flipping
  // any status. Previously the batch was created + mirrored first, then statuses were flipped in a
  // loop — so an ineligible cell (e.g. a terminal 'published' cell) threw mid-loop, leaving some
  // cells flipped and an orphaned batch already persisted. Cells already in 'review' are no-ops
  // (the flip loop skips them) and are excluded from the eligibility check.
  for (const cell of selectedCells) {
    if (cell.status === 'review') continue;
    try {
      validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, cell.status, 'review');
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        throw new ContentPlanReviewMutationError(
          409,
          `Cell "${cell.targetKeyword}" cannot be sent for review from status "${cell.status}"`,
        );
      }
      throw err;
    }
  }

  const batch = createBatch(
    workspaceId,
    workspace.webflowSiteId || '',
    `Content Plan: ${matrix.name} — Sample Review (${selectedCells.length} pages)`,
    buildSampleApprovalItems(selectedCells),
  );

  mirrorApprovalBatchToDeliverable(workspaceId, batch, {
    type: 'content_plan_sample',
    source: 'content-plan-sample-review',
  });

  for (const cell of selectedCells) {
    if (cell.status === 'review') continue;
    updateMatrixCell(workspaceId, matrixId, cell.id, { status: 'review' });
  }

  broadcastToWorkspace(workspaceId, WS_EVENTS.APPROVAL_UPDATE, { batchId: batch.id, action: 'created' });
  addActivity(
    workspaceId,
    'content_updated',
    `Sent ${selectedCells.length} content plan sample${selectedCells.length === 1 ? '' : 's'} for client review`,
    `Matrix: ${matrix.name}`,
    { matrixId: matrix.id, batchId: batch.id, cellIds, action: 'sample_review_sent' },
  );
  notifyContentPlanUpdated(workspaceId, {
    matrixId: matrix.id,
    batchId: batch.id,
    cellIds,
    action: 'sample_review_sent',
  });
  log.info({ workspaceId, matrixId: matrix.id, batchId: batch.id, cellCount: selectedCells.length }, 'Samples sent for client review');

  return { batch, cellsSent: selectedCells.length };
}

export function batchApproveMatrixCells(
  workspaceId: string,
  matrixId: string,
): BatchApproveMatrixCellsResult {
  const matrix = getMatrixOrThrow(workspaceId, matrixId);
  const cellsToApprove = matrix.cells.filter((cell) => APPROVABLE_CELL_STATUSES.has(cell.status));

  let approvedCount = 0;
  for (const cell of cellsToApprove) {
    updateMatrixCell(workspaceId, matrixId, cell.id, { status: 'approved' });
    approvedCount++;
  }

  addActivity(
    workspaceId,
    'content_updated',
    `Approved ${approvedCount} content plan page${approvedCount === 1 ? '' : 's'}`,
    `Matrix: ${matrix.name}`,
    { matrixId: matrix.id, approvedCount, action: 'matrix_batch_approved' },
  );
  notifyContentPlanUpdated(workspaceId, {
    matrixId: matrix.id,
    approvedCount,
    action: 'matrix_batch_approved',
  });
  log.info({ workspaceId, matrixId: matrix.id, approvedCount }, 'Batch approved remaining cells');

  return { approvedCount, totalCells: matrix.cells.length };
}

export function flagMatrixCell(
  workspaceId: string,
  matrixId: string,
  cellId: string,
  comment: string,
): void {
  const matrix = getMatrixOrThrow(workspaceId, matrixId);
  const cell = matrix.cells.find((candidate) => candidate.id === cellId);
  if (!cell) throw new ContentPlanReviewMutationError(404, 'Cell not found');
  if (!CLIENT_VISIBLE_CELL_STATUSES.has(cell.status)) {
    throw new ContentPlanReviewMutationError(409, 'Cell is not available for client review');
  }

  const updated = updateMatrixCell(
    workspaceId,
    matrixId,
    cellId,
    { status: 'flagged', clientFlag: comment, clientFlaggedAt: new Date().toISOString() },
  );
  if (!updated) throw new ContentPlanReviewMutationError(404, 'Cell not found');

  addActivity(
    workspaceId,
    'content_updated',
    `Client flagged content plan page "${cell.targetKeyword}"`,
    comment,
    { matrixId: matrix.id, cellId: cell.id, action: 'matrix_cell_flagged' },
  );
  notifyContentPlanUpdated(workspaceId, {
    matrixId: matrix.id,
    cellId: cell.id,
    action: 'matrix_cell_flagged',
    status: 'flagged',
  });
  log.info({ workspaceId, matrixId, cellId }, 'Client flagged cell');
}
