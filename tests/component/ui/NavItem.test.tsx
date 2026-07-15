import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Globe } from 'lucide-react';
import { NavItem } from '../../../src/components/ui/layout/NavItem';
import { expectNoA11yViolations } from '../a11y';

describe('NavItem', () => {
  it('renders label and lucide icon through the shared Icon wrapper', async () => {
    const { container } = render(<NavItem icon={Globe} label="Site Audit" />);

    expect(screen.getByRole('button', { name: 'Site Audit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Site Audit' })).toHaveClass('t-ui');
    expect(screen.getByText('Site Audit')).toBeInTheDocument();
    expect(document.querySelector('svg')).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('keeps an accessible name in the icon-only rail (collapsed) with the label visually hidden', async () => {
    const { container } = render(<NavItem icon={Globe} label="Site Audit" collapsed title="Site Audit" />);

    // Accessible name survives (via aria-label) even though the visible label text is dropped.
    expect(screen.getByRole('button', { name: 'Site Audit' })).toBeInTheDocument();
    expect(screen.queryByText('Site Audit')).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('marks active items as the current page and renders the accent bar', () => {
    render(<NavItem icon={Globe} label="Site Audit" active accent="var(--emerald)" />);

    const item = screen.getByRole('button', { name: 'Site Audit' });
    expect(item).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('navitem-active-accent')).toBeInTheDocument();
  });

  it('sets disabled semantics and suppresses click handling', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<NavItem icon={Globe} label="Search & Traffic" disabled onClick={onClick} title="Connect a site first" />);

    const item = screen.getByRole('button', { name: 'Search & Traffic' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAttribute('title', 'Connect a site first');
    fireEvent.click(item);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders badge and mono meta slots', () => {
    render(<NavItem label="Pipeline" badge={<span>5</span>} meta="NEW" />);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('5').closest('.t-mono')).toBeInTheDocument();
    expect(screen.getByText('NEW')).toBeInTheDocument();
    expect(screen.getByText('NEW')).toHaveClass('t-mono');
  });

  it('fires onClick from keyboard activation when rendered as a button', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<NavItem label="Requests" onClick={onClick} />);

    const item = screen.getByRole('button', { name: 'Requests' });
    item.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
