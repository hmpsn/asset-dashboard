import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AppShell } from '../../../src/components/ui/layout/AppShell';

afterEach(() => {
  cleanup();
});

describe('AppShell', () => {
  it('renders the sidebar, topbar, and children slots', () => {
    render(
      <AppShell sidebar={<nav>Sidebar content</nav>} topbar={<div>Topbar content</div>}>
        <div>Page content</div>
      </AppShell>,
    );
    expect(screen.getByText('Sidebar content')).toBeInTheDocument();
    expect(screen.getByText('Topbar content')).toBeInTheDocument();
    expect(screen.getByText('Page content')).toBeInTheDocument();
  });

  it('sizes the sidebar from --shell-sidebar when rail is false', () => {
    const { container } = render(
      <AppShell sidebar={<nav>Nav</nav>}>
        <div>Content</div>
      </AppShell>,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateColumns).toContain('var(--shell-sidebar)');
    expect(grid.style.gridTemplateColumns).not.toContain('var(--shell-sidebar-rail)');
  });

  it('sizes the sidebar from --shell-sidebar-rail when rail is true', () => {
    const { container } = render(
      <AppShell sidebar={<nav>Nav</nav>} rail>
        <div>Content</div>
      </AppShell>,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateColumns).toContain('var(--shell-sidebar-rail)');
  });

  it('renders a skip-to-content link targeting the scrollable content region', () => {
    render(
      <AppShell sidebar={<nav>Nav</nav>}>
        <div>Content</div>
      </AppShell>,
    );
    const skipLink = screen.getByText('Skip to content');
    expect(skipLink).toBeInTheDocument();
    const href = skipLink.getAttribute('href');
    expect(href).toBeTruthy();
    const targetId = href!.replace('#', '');
    const target = document.getElementById(targetId);
    expect(target).not.toBeNull();
    expect(target).toHaveAttribute('tabIndex', '-1');
  });
});
