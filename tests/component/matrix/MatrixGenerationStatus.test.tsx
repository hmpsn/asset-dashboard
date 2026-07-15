import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MatrixGenerationStatus } from '../../../src/components/matrix/MatrixGenerationStatus';
import type {
  GetMatrixGenerationResult,
  MatrixGenerationItemRead,
  MatrixGenerationSetAuditFinding,
} from '../../../shared/types/matrix-generation';

function item(
  id: string,
  status: MatrixGenerationItemRead['status'],
): MatrixGenerationItemRead {
  return {
    id,
    cellId: id,
    status,
    error: status === 'failed'
      ? { code: 'provider_failed', message: 'Provider failed', retryable: true }
      : null,
    setAuditFindings: [],
    approvalEvidence: null,
    auditReport: status === 'ready_for_human_review'
      ? { verdict: 'ready_for_human_review', unresolvedRequirementIds: [] }
      : null,
    postId: status === 'ready_for_human_review' ? `post-${id}` : null,
    currentArtifactRevisions: {
      brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 },
      post: {
        artifactType: 'generated_post',
        artifactId: status === 'ready_for_human_review' ? `post-${id}` : null,
        generationRevision: status === 'ready_for_human_review' ? 9 : 0,
      },
    },
  } as unknown as MatrixGenerationItemRead;
}

function result(status: GetMatrixGenerationResult['run']['status']): GetMatrixGenerationResult {
  return {
    run: {
      id: 'run-1',
      status,
      counts: {
        selected: 3,
        queued: status === 'running' ? 1 : 0,
        running: status === 'running' ? 1 : 0,
        readyForHumanReview: 1,
        needsAttention: 0,
        blocked: 1,
        conflicts: 0,
        failed: status === 'running' ? 0 : 1,
        cancelled: 0,
      },
      setAuditReport: status === 'running'
        ? null
        : { verdict: 'ready_for_human_review', findings: [] },
    },
    items: {
      items: [
        item('ready', 'ready_for_human_review'),
        item('blocked', 'blocked_missing_evidence'),
        item('failed', 'failed'),
      ],
      nextCursor: null,
    },
  } as unknown as GetMatrixGenerationResult;
}

describe('MatrixGenerationStatus', () => {
  it('shows honest per-page outcomes and retries only failed pages', () => {
    const onRetry = vi.fn();
    const onReview = vi.fn();
    const onApprove = vi.fn();
    render(
      <MatrixGenerationStatus
        result={result('completed_with_errors')}
        retrying={false}
        onRetry={onRetry}
        approvingItemId={null}
        onReview={onReview}
        onApprove={onApprove}
      />,
    );

    expect(screen.getByText('Completed with issues')).toBeInTheDocument();
    expect(screen.getByText('Missing evidence')).toBeInTheDocument();
    expect(screen.getAllByText('Failed')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Retry 1 page' }));
    expect(onRetry).toHaveBeenCalledWith([expect.objectContaining({ id: 'failed' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Review page' }));
    expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ id: 'ready' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve for export' }));
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ id: 'ready' }));
  });

  it('shows contextual progress while the parent run is active', () => {
    render(
      <MatrixGenerationStatus
        result={result('running')}
        retrying={false}
        onRetry={vi.fn()}
        approvingItemId={null}
        onReview={vi.fn()}
        onApprove={vi.fn()}
      />,
    );

    expect(screen.getByText('Generating and auditing selected pages')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
  });

  it('keeps review actions available for a human-only set warning', () => {
    const warning: MatrixGenerationSetAuditFinding = {
      id: 'human-only-warning',
      source: 'model',
      kind: 'provenance',
      code: 'human_confirmation',
      severity: 'warning',
      message: 'Confirm this implication during review.',
      affectedItemIds: ['ready'],
      affectedTargetIds: ['ready:template:body'],
      requiresHumanReview: true,
    };
    const data = result('completed');
    data.run.setAuditReport = {
      verdict: 'passed',
      findings: [warning],
      passCount: 1,
      modelProvenance: null,
      auditedAt: '2026-07-15T12:00:00.000Z',
    };
    data.items.items[0].setAuditFindings = [warning];

    render(
      <MatrixGenerationStatus
        result={data}
        retrying={false}
        onRetry={vi.fn()}
        approvingItemId={null}
        onReview={vi.fn()}
        onApprove={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Review page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve for export' })).toBeInTheDocument();
    expect(screen.getAllByText(warning.message)).toHaveLength(2);
  });
});
