import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Search, BarChart3 } from 'lucide-react';
import { LensSwitcher, type LensOption } from '../../../src/components/ui/forms/LensSwitcher';
import { expectNoA11yViolations } from '../a11y';

const options: LensOption[] = [
  { value: 'overview', label: 'Overview', icon: Search, count: 4 },
  { value: 'pages', label: 'Pages', icon: BarChart3, count: 12 },
  { value: 'gaps', label: 'Gaps' },
];

describe('LensSwitcher', () => {
  it('selecting a lens fires onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LensSwitcher options={options} value="overview" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: /Pages/ }));
    expect(onChange).toHaveBeenCalledWith('pages');
  });

  it('keyboard arrow nav moves focus, and activating the focused segment fires onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LensSwitcher options={options} value="overview" onChange={onChange} />);

    const first = screen.getByRole('radio', { name: /Overview/ });
    first.focus();
    await user.keyboard('{ArrowRight}');

    const pagesSegment = screen.getByRole('radio', { name: /Pages/ });
    expect(document.activeElement).toBe(pagesSegment);
    expect(onChange).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('pages');
  });

  it('renders the leading icon and trailing count pill', () => {
    render(<LensSwitcher options={options} value="overview" onChange={vi.fn()} />);
    const overviewSegment = screen.getByRole('radio', { name: /Overview/ });
    expect(overviewSegment.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('marks the selected segment aria-checked and leaves others unchecked', () => {
    render(<LensSwitcher options={options} value="gaps" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /Gaps/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Overview/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<LensSwitcher options={options} value="overview" onChange={vi.fn()} />);
    await expectNoA11yViolations(container);
  }, 15_000);
});
