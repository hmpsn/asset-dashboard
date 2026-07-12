import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandCenterVerdict } from '../../../src/components/ui/co';
import { expectNoA11yViolations } from '../a11y';

describe('CommandCenterVerdict', () => {
  it('renders verdict title, eyebrow, and description', async () => {
    const { container } = render(
      <CommandCenterVerdict
        eyebrow="Today"
        title="Acme has three things ready"
        description="Two fixes and one client-ready recommendation are waiting."
        meta="Data as of today"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Acme has three things ready' })).toHaveClass('t-h1');
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Data as of today')).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
