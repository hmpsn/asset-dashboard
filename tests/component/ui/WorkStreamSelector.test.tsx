import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkStreamSelector, type WorkStreamOption } from '../../../src/components/ui/co';
import { expectNoA11yViolations } from '../a11y';

const options: WorkStreamOption[] = [
  { id: 'opt', label: 'Optimizations', description: 'What needs fixing?', count: 4 },
  { id: 'send', label: 'To send', description: 'Ready for clients', count: 2 },
  { id: 'money', label: 'Monetization', description: 'Revenue plays', count: 1 },
];

describe('WorkStreamSelector', () => {
  it('renders as an accessible single-select stream control', async () => {
    const onChange = vi.fn();
    const { container } = render(<WorkStreamSelector options={options} value="opt" onChange={onChange} />);

    expect(screen.getByRole('radiogroup', { name: 'Work stream' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Optimizations/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('4')).toHaveClass('t-h1');
    expect(screen.getByText('What needs fixing?')).toHaveClass('t-body');

    fireEvent.click(screen.getByRole('radio', { name: /To send/ }));
    expect(onChange).toHaveBeenCalledWith('send');

    await expectNoA11yViolations(container);
  });

  it('allows compatibility filters to leave every primary stream unselected', () => {
    render(<WorkStreamSelector options={options} value={null} onChange={vi.fn()} />);

    expect(screen.getAllByRole('radio')).toHaveLength(3);
    screen.getAllByRole('radio').forEach((radio) => {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    });
  });
});
