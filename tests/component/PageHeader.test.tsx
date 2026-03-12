import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from '../../src/components/ui/PageHeader';

describe('PageHeader', () => {
  it('renders title', () => {
    render(<PageHeader title="Dashboard" />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<PageHeader title="Settings" subtitle="Manage your preferences" />);
    expect(screen.getByText('Manage your preferences')).toBeInTheDocument();
  });

  it('does not render subtitle when omitted', () => {
    const { container } = render(<PageHeader title="Settings" />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(0);
  });

  it('renders icon when provided', () => {
    render(<PageHeader title="Test" icon={<span data-testid="hdr-icon">I</span>} />);
    expect(screen.getByTestId('hdr-icon')).toBeInTheDocument();
  });

  it('renders actions when provided', () => {
    render(<PageHeader title="Test" actions={<button>Save</button>} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('does not render actions wrapper when omitted', () => {
    const { container } = render(<PageHeader title="No Actions" />);
    // Only one child div (the left side with title)
    const topLevel = container.firstElementChild!;
    expect(topLevel.children.length).toBe(1);
  });

  it('applies custom className', () => {
    const { container } = render(<PageHeader title="T" className="mb-6" />);
    expect(container.firstElementChild!.className).toContain('mb-6');
  });

  it('renders title as h2', () => {
    render(<PageHeader title="Heading" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Heading');
  });
});
