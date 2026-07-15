import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProvenanceChip } from '../../../src/components/ui/co';
import { expectNoA11yViolations } from '../a11y';

describe('ProvenanceChip', () => {
  it('renders the basis label accessibly', async () => {
    const { container } = render(<ProvenanceChip basis="measured" />);
    expect(screen.getByText('measured')).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
