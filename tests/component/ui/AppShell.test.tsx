import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AppShell } from '../../../src/components/ui/layout/AppShell';
import { expectNoA11yViolations } from '../a11y';

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

  it('sizes the sidebar from --shell-sidebar-rail when focus mode is true', () => {
    const { container } = render(
      <AppShell sidebar={<nav>Nav</nav>} focusMode onFocusModeChange={() => undefined}>
        <div>Content</div>
      </AppShell>,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateColumns).toContain('var(--shell-sidebar-rail)');
  });

  it('calls onFocusModeChange(false) once when Escape exits focus mode', () => {
    const onFocusModeChange = vi.fn();
    render(
      <AppShell sidebar={<nav>Nav</nav>} focusMode onFocusModeChange={onFocusModeChange}>
        <div>Content</div>
      </AppShell>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onFocusModeChange).toHaveBeenCalledTimes(1);
    expect(onFocusModeChange).toHaveBeenCalledWith(false);
  });

  it('does not exit focus mode when Escape starts inside an input', () => {
    const onFocusModeChange = vi.fn();
    render(
      <AppShell sidebar={<nav>Nav</nav>} focusMode onFocusModeChange={onFocusModeChange}>
        <label htmlFor="rewrite-title">Title</label>
        <input id="rewrite-title" />
      </AppShell>,
    );

    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Escape' });

    expect(onFocusModeChange).not.toHaveBeenCalled();
  });

  it('keeps the default full-sidebar layout when focus mode is omitted', () => {
    const { container } = render(
      <AppShell sidebar={<nav>Nav</nav>}>
        <div>Content</div>
      </AppShell>,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateColumns).toContain('var(--shell-sidebar)');
    expect(grid.style.gridTemplateColumns).not.toContain('var(--shell-sidebar-rail)');
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

  it('has no accessibility violations', async () => {
    const { container } = render(
      <AppShell sidebar={<nav>Sidebar content</nav>} topbar={<div>Topbar content</div>}>
        <div>Page content</div>
      </AppShell>,
    );
    await expectNoA11yViolations(container);
  }, 15_000);

  it('has no accessibility violations in focus mode', async () => {
    const { container } = render(
      <AppShell sidebar={<nav>Sidebar content</nav>} topbar={<div>Topbar content</div>} focusMode onFocusModeChange={() => undefined}>
        <div>Page content</div>
      </AppShell>,
    );
    await expectNoA11yViolations(container);
  }, 15_000);
});
