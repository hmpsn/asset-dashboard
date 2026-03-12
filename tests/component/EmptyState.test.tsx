import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { Inbox } from 'lucide-react';

describe('EmptyState', () => {
  it('renders title text', () => {
    render(<EmptyState icon={Inbox} title="No items" />);
    expect(screen.getByText('No items')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<EmptyState icon={Inbox} title="Empty" description="Nothing to show" />);
    expect(screen.getByText('Nothing to show')).toBeInTheDocument();
  });

  it('does not render description when omitted', () => {
    const { container } = render(<EmptyState icon={Inbox} title="Empty" />);
    const paragraphs = container.querySelectorAll('p');
    // Only the title paragraph, no description paragraph
    expect(paragraphs.length).toBe(1);
  });

  it('renders action element when provided', () => {
    render(<EmptyState icon={Inbox} title="Empty" action={<button>Add Item</button>} />);
    expect(screen.getByRole('button', { name: 'Add Item' })).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<EmptyState icon={Inbox} title="Empty" className="my-custom" />);
    expect(container.firstElementChild!.className).toContain('my-custom');
  });

  it('renders the icon', () => {
    const { container } = render(<EmptyState icon={Inbox} title="Empty" />);
    // lucide-react renders an SVG
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
