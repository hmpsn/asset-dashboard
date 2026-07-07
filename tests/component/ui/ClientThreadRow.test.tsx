import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClientThreadRow } from '../../../src/components/ui/co';
import { expectNoA11yViolations } from '../a11y';

describe('ClientThreadRow', () => {
  it('renders a client thread row and optional promote action', async () => {
    const onPromote = vi.fn();
    const { container } = render(
      <ClientThreadRow
        author="Jordan"
        kind="request"
        message="Can we prioritize the services page?"
        when="1h ago"
        initials="J"
        onPromote={onPromote}
      />,
    );

    expect(screen.getByText('Can we prioritize the services page?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Promote to signal/ }));
    expect(onPromote).toHaveBeenCalledOnce();
    await expectNoA11yViolations(container);
  });
});
