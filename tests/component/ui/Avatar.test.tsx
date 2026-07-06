import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Avatar } from '../../../src/components/ui/Avatar';
import { expectNoA11yViolations } from '../a11y';

describe('Avatar', () => {
  it('renders initials when no src or icon is given', () => {
    render(<Avatar initials="JH" label="Josh Hampson" />);
    expect(screen.getByText('JH')).toBeInTheDocument();
  });

  it('derives initials from label when initials prop is absent', () => {
    render(<Avatar label="Josh Hampson" />);
    expect(screen.getByText('JH')).toBeInTheDocument();
  });

  it('derives a single-letter initial from a one-word label', () => {
    render(<Avatar label="Workspace" />);
    expect(screen.getByText('W')).toBeInTheDocument();
  });

  it('falls back to initials when the image fails to load', () => {
    render(<Avatar src="https://example.com/broken.png" initials="AB" label="Fallback avatar" />);
    // The <img> renders first (src takes precedence); fire an error event on it.
    const imgEl = document.querySelector('img');
    expect(imgEl).not.toBeNull();
    fireEvent.error(imgEl as HTMLImageElement);
    expect(screen.getByText('AB')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('exposes the label via aria-label when provided', () => {
    render(<Avatar initials="ZZ" label="Zen Zone" />);
    const el = screen.getByRole('img', { name: 'Zen Zone' });
    expect(el).toBeInTheDocument();
  });

  it('is aria-hidden when no label is provided', () => {
    const { container } = render(<Avatar initials="NL" />);
    const span = container.querySelector('span');
    expect(span).toHaveAttribute('aria-hidden', 'true');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Avatar initials="JH" label="Josh Hampson" />);
    await expectNoA11yViolations(container);
  }, 15_000);
});
