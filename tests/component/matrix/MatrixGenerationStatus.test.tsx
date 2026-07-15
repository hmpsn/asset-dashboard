import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MatrixGenerationStatus } from '../../../src/components/matrix/MatrixGenerationStatus';
import type {
  GetMatrixGenerationResult,
  MatrixGenerationItemRead,
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
      setAuditReport: null,
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
    render(
      <MatrixGenerationStatus
        result={result('completed_with_errors')}
        retrying={false}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('Completed with issues')).toBeInTheDocument();
    expect(screen.getByText('Missing evidence')).toBeInTheDocument();
    expect(screen.getAllByText('Failed')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Retry 1 page' }));
    expect(onRetry).toHaveBeenCalledWith([expect.objectContaining({ id: 'failed' })]);
  });

  it('shows contextual progress while the parent run is active', () => {
    render(
      <MatrixGenerationStatus
        result={result('running')}
        retrying={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText('Generating and auditing selected pages')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
  });
});
