import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkPublishPanel } from '../../src/components/schema/BulkPublishPanel';
import type { WholeSiteSchemaGraphValidationResult } from '../../shared/types/schema-validation';

const baseProps = {
  dataCount: 2,
  unpublishedCount: 2,
  bulkPublishing: false,
  bulkProgress: null,
  sendingToClient: false,
  sentToClient: false,
  loading: false,
  onPublishAll: vi.fn(),
  onSendToClient: vi.fn(),
};

function graph(status: WholeSiteSchemaGraphValidationResult['status']): WholeSiteSchemaGraphValidationResult {
  return {
    status,
    checkedPageCount: 2,
    nodeCount: 4,
    referenceCount: 3,
    nodes: [],
    findings: status === 'errors'
      ? [{
          severity: 'error',
          type: 'Service',
          ruleId: 'schema-graph-planned-entity-missing',
          message: 'Missing planned entity.',
        }]
      : [],
  };
}

describe('BulkPublishPanel', () => {
  it('blocks bulk publish when whole-site graph validation has errors', async () => {
    const onPublishAll = vi.fn();
    render(<BulkPublishPanel {...baseProps} onPublishAll={onPublishAll} graphValidation={graph('errors')} />);

    const button = screen.getByRole('button', { name: /publish all/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/must be fixed before bulk publish/i)).toBeInTheDocument();
    await userEvent.click(button);
    expect(onPublishAll).not.toHaveBeenCalled();
  });

  it('allows bulk publish when whole-site graph validation is valid', async () => {
    const onPublishAll = vi.fn();
    render(<BulkPublishPanel {...baseProps} onPublishAll={onPublishAll} graphValidation={graph('valid')} />);

    await userEvent.click(screen.getByRole('button', { name: /publish all/i }));
    expect(onPublishAll).toHaveBeenCalledTimes(1);
  });
});
