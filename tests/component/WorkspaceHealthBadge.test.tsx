/**
 * Component test: WorkspaceHealthBadge
 *
 * Catches rounding regression — the badge must display Math.round(score),
 * never the raw float. The compositeHealthScore is a weighted computation
 * that can produce decimal values (e.g. 73.5).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkspaceHealthBadge } from '../../src/components/admin/WorkspaceHealthBadge';

describe('WorkspaceHealthBadge', () => {
  it('rounds a decimal score to the nearest integer', () => {
    render(<WorkspaceHealthBadge score={73.5} />);
    // Both the SVG ring text and the span must show the rounded value
    const all = screen.getAllByText('74');
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('73.5')).toBeNull();
  });

  it('rounds down correctly', () => {
    render(<WorkspaceHealthBadge score={72.4} />);
    const all = screen.getAllByText('72');
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('72.4')).toBeNull();
  });

  it('displays an already-integer score unchanged', () => {
    render(<WorkspaceHealthBadge score={85} />);
    const all = screen.getAllByText('85');
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it('renders nothing when score is null', () => {
    const { container } = render(<WorkspaceHealthBadge score={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when score is undefined', () => {
    const { container } = render(<WorkspaceHealthBadge score={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
