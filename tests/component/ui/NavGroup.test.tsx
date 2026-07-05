import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavGroup } from '../../../src/components/ui/layout/NavGroup';

describe('NavGroup', () => {
  it('renders a collapsible header with aria-expanded tied to collapsed', () => {
    render(
      <NavGroup label="MONITORING" collapsed>
        <button>Search & Traffic</button>
      </NavGroup>,
    );

    const header = screen.getByRole('button', { name: 'MONITORING' });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('region', { hidden: true })).toBeInTheDocument();
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
});
