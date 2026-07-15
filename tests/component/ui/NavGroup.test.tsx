import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavGroup } from '../../../src/components/ui/layout/NavGroup';
import { expectNoA11yViolations } from '../a11y';

describe('NavGroup', () => {
  it('renders a collapsible header with aria-expanded tied to collapsed', async () => {
    const { container } = render(
      <NavGroup label="MONITORING" collapsed>
        <button>Search & Traffic</button>
      </NavGroup>,
    );

    const header = screen.getByRole('button', { name: 'MONITORING' });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(header).toHaveClass('t-label');
    expect(screen.getByRole('region', { hidden: true })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('calls onToggleCollapse from the header button', async () => {
    const user = userEvent.setup();
    const onToggleCollapse = vi.fn();

    render(
      <NavGroup label="CONTENT" onToggleCollapse={onToggleCollapse}>
        <button>Pipeline</button>
      </NavGroup>,
    );

    await user.click(screen.getByRole('button', { name: 'CONTENT' }));
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });

  it('hides children when collapsed and shows them when expanded', () => {
    const { rerender } = render(
      <NavGroup label="SITE HEALTH" collapsed>
        <button>Performance</button>
      </NavGroup>,
    );

    expect(screen.getByText('Performance').closest('[hidden]')).not.toBeNull();

    rerender(
      <NavGroup label="SITE HEALTH" collapsed={false}>
        <button>Performance</button>
      </NavGroup>,
    );

    expect(screen.getByText('Performance').closest('[hidden]')).toBeNull();
  });

  it('omits the header for an empty label', () => {
    render(
      <NavGroup label="">
        <button>Home</button>
      </NavGroup>,
    );

    expect(screen.queryByRole('button', { name: '' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
  });

  it('applies the accent token to the header chrome', () => {
    render(
      <NavGroup label="STRATEGY" accent="var(--teal)">
        <button>Keyword Hub</button>
      </NavGroup>,
    );

    const header = screen.getByRole('button', { name: 'STRATEGY' });
    expect(header).toHaveStyle({ color: 'var(--nav-group-accent)' });
    expect(header.parentElement?.style.getPropertyValue('--nav-group-accent')).toBe('var(--teal)');
  });

  it('programmatically links the header to its region (aria-controls ↔ id, aria-labelledby ↔ header id)', () => {
    render(
      <NavGroup label="MONITORING">
        <button>Search & Traffic</button>
      </NavGroup>,
    );

    const header = screen.getByRole('button', { name: 'MONITORING' });
    const region = screen.getByRole('region');
    // The expand/collapse association screen readers rely on — assert the linkage, not just presence.
    expect(header).toHaveAttribute('aria-controls', region.id);
    expect(region).toHaveAttribute('aria-labelledby', header.id);
  });

  it('renders a header badge that stays visible when the group is collapsed (review PR #1478)', () => {
    const { rerender } = render(
      <NavGroup label="CONTENT" badge={3}>
        <button>Pipeline</button>
      </NavGroup>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();

    // Collapsed: the item badge is hidden with the children, but the header count must remain.
    rerender(
      <NavGroup label="CONTENT" badge={3} collapsed>
        <button>Pipeline</button>
      </NavGroup>,
    );
    const badge = screen.getByText('3');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('t-mono');
    expect(badge.closest('[hidden]')).toBeNull();
  });
});
