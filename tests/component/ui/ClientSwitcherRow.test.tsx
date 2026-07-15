import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClientSwitcherRow } from '../../../src/components/ui/co';
import { expectNoA11yViolations } from '../a11y';

describe('ClientSwitcherRow', () => {
  it('renders a keyboard-accessible client row when selectable', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ClientSwitcherRow
        name="Acme Interiors"
        meta="acme.example"
        initials="A"
        health="ok"
        badge="3"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Acme Interiors/ }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByRole('img', { name: 'Health: ok' })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
