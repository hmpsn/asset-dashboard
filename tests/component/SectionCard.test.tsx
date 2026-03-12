import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionCard } from '../../src/components/ui/SectionCard';

describe('SectionCard', () => {
  it('renders children', () => {
    render(<SectionCard><p>Content</p></SectionCard>);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(<SectionCard title="My Section"><p>Body</p></SectionCard>);
    expect(screen.getByText('My Section')).toBeInTheDocument();
  });

  it('does not render header when no title or action', () => {
    const { container } = render(<SectionCard><p>No header</p></SectionCard>);
    // Header has border-b class — should not exist
    expect(container.querySelector('.border-b')).toBeNull();
  });

  it('renders header when action is provided even without title', () => {
    render(<SectionCard action={<button>Click</button>}><p>Body</p></SectionCard>);
    expect(screen.getByRole('button', { name: 'Click' })).toBeInTheDocument();
  });

  it('renders titleIcon when provided', () => {
    render(<SectionCard title="Test" titleIcon={<span data-testid="icon">IC</span>}><p>Body</p></SectionCard>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders titleExtra when provided', () => {
    render(<SectionCard title="Test" titleExtra={<span>Extra</span>}><p>Body</p></SectionCard>);
    expect(screen.getByText('Extra')).toBeInTheDocument();
  });

  it('applies padding to content by default', () => {
    const { container } = render(<SectionCard><p>Padded</p></SectionCard>);
    // The content wrapper div should have p-4
    const contentDiv = container.querySelector('.p-4');
    expect(contentDiv).not.toBeNull();
  });

  it('removes padding when noPadding is true', () => {
    const { container } = render(<SectionCard noPadding><p>No pad</p></SectionCard>);
    const contentDiv = container.querySelector('.p-4');
    expect(contentDiv).toBeNull();
  });

  it('applies custom className', () => {
    const { container } = render(<SectionCard className="w-full"><p>C</p></SectionCard>);
    expect(container.firstElementChild!.className).toContain('w-full');
  });
});
