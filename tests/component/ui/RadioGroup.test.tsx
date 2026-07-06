import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroup } from '../../../src/components/ui/forms/RadioGroup';
import { FormField } from '../../../src/components/ui/forms/FormField';
import { expectNoA11yViolations } from '../a11y';

const options = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C' },
];

describe('RadioGroup', () => {
  it('clicking an option selects it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RadioGroup options={options} value="a" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Option B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('arrow keys move focus and wrap (column direction, vertical arrows)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RadioGroup options={options} value="a" onChange={onChange} />);

    const first = screen.getByRole('radio', { name: 'Option A' });
    first.focus();

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Option B' }));

    // Wrap from last back to first.
    screen.getByRole('radio', { name: 'Option C' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Option A' }));

    // Wrap from first back to last with ArrowUp.
    screen.getByRole('radio', { name: 'Option A' }).focus();
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Option C' }));

    // Arrow navigation alone does not commit a selection — only Space/Enter/click do.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Space selects the focused option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RadioGroup options={options} value="a" onChange={onChange} />);

    screen.getByRole('radio', { name: 'Option B' }).focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('row direction moves focus with horizontal arrows, then Space selects', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RadioGroup options={options} value="a" onChange={onChange} direction="row" />);

    screen.getByRole('radio', { name: 'Option A' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Option B' }));
    expect(onChange).not.toHaveBeenCalled();

    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('renders inside a FormField and reflects aria-invalid when the field has an error', async () => {
    const { container } = render(
      <FormField label="Choose one" error="Required">
        <RadioGroup options={options} value="a" onChange={vi.fn()} />
      </FormField>,
    );

    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-describedby');
    await expectNoA11yViolations(container);
  });
});
