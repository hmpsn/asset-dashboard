import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkQueueRow } from '../../../src/components/ui/co';
import { expectNoA11yViolations } from '../a11y';

describe('WorkQueueRow', () => {
  it('renders a queue row with client, impact, provenance, and action', async () => {
    const onAction = vi.fn();
    const { container } = render(
      <WorkQueueRow
        item={{
          stream: 'money',
          id: 'money-1',
          title: 'Pitch implant landing page',
          meta: 'High-intent demand',
          impact: '$2.4k/mo',
          direction: 'positive',
          clientId: 'ws-1',
          sourceType: 'content_request',
        }}
        clientName="Bay Street Dental"
        clientInitials="B"
        provenance="estimate"
        onAction={onAction}
      />,
    );

    expect(screen.getByText('Pitch implant landing page')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Propose/ }));
    expect(onAction).toHaveBeenCalledOnce();
    await expectNoA11yViolations(container);
  });
});
