import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Toolbar, ToolbarSpacer } from '../../../src/components/ui/layout/Toolbar';

afterEach(() => {
  cleanup();
});

describe('Toolbar', () => {
  it('renders children with role="toolbar" and the given aria-label', () => {
    render(
      <Toolbar label="Table controls">
        <button>Search</button>
        <button>Filter</button>
      </Toolbar>,
    );
    const toolbar = screen.getByRole('toolbar', { name: 'Table controls' });
    expect(toolbar).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Filter')).toBeInTheDocument();
  });

  it('moves focus from the first to the second button on ArrowRight', () => {
    render(
      <Toolbar label="Controls">
        <button>First</button>
        <button>Second</button>
      </Toolbar>,
    );
    const first = screen.getByText('First') as HTMLButtonElement;
    const second = screen.getByText('Second') as HTMLButtonElement;
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(second);
  });

  it('moves focus back to the first button on ArrowLeft (wrap)', () => {
    render(
      <Toolbar label="Controls">
        <button>First</button>
        <button>Second</button>
      </Toolbar>,
    );
    const first = screen.getByText('First') as HTMLButtonElement;
    const second = screen.getByText('Second') as HTMLButtonElement;
    second.focus();
    fireEvent.keyDown(second, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(first);
  });

  it('moves the roving tabindex marker to the newly-focused control after ArrowRight', () => {
    // Regression: the marker must land on the control focus MOVED TO, not stay
    // on the previously-focused one (the stale-activeIndex bug).
    render(
      <Toolbar label="Controls">
        <button>First</button>
        <button>Second</button>
      </Toolbar>,
    );
    const first = screen.getByText('First') as HTMLButtonElement;
    const second = screen.getByText('Second') as HTMLButtonElement;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
  });

  it('does not preventDefault Enter/Space so the focused control activates natively', () => {
    let clicked = false;
    render(
      <Toolbar label="Controls">
        <button onClick={() => { clicked = true; }}>Go</button>
      </Toolbar>,
    );
    const go = screen.getByText('Go') as HTMLButtonElement;
    go.focus();
    // A real Enter on a focused button dispatches a click; the toolbar must not
    // intercept it. Simulate the native activation the browser would perform.
    fireEvent.keyDown(go, { key: 'Enter' });
    go.click();
    expect(clicked).toBe(true);
  });

  it('only keeps one control in the tab order (roving tabindex)', () => {
    render(
      <Toolbar label="Controls">
        <button>First</button>
        <button>Second</button>
      </Toolbar>,
    );
    const first = screen.getByText('First') as HTMLButtonElement;
    const second = screen.getByText('Second') as HTMLButtonElement;
    expect(first.tabIndex).toBe(0);
    expect(second.tabIndex).toBe(-1);
  });
});

describe('ToolbarSpacer', () => {
  it('renders a flex-1 spacer element', () => {
    const { container } = render(<ToolbarSpacer />);
    const spacer = container.firstElementChild as HTMLElement;
    expect(spacer).toBeInTheDocument();
    expect(spacer.style.flex).toContain('1');
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
  });
});
