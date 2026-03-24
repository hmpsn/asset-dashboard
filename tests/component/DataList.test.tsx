import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataList } from '../../src/components/ui/DataList';

const sampleItems = [
  { label: '/about', value: 95 },
  { label: '/contact', value: 82, sub: '3 issues' },
  { label: '/blog/hello-world', value: 78, valueColor: 'text-amber-400' },
];

describe('DataList', () => {
  it('renders all item labels', () => {
    render(<DataList items={sampleItems} />);
    expect(screen.getByText('/about')).toBeInTheDocument();
    expect(screen.getByText('/contact')).toBeInTheDocument();
    expect(screen.getByText('/blog/hello-world')).toBeInTheDocument();
  });

  it('renders all item values', () => {
    render(<DataList items={sampleItems} />);
    expect(screen.getByText('95')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('78')).toBeInTheDocument();
  });

  it('renders sub text when present', () => {
    render(<DataList items={sampleItems} />);
    expect(screen.getByText('3 issues')).toBeInTheDocument();
  });

  it('shows rank numbers by default', () => {
    render(<DataList items={sampleItems} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('hides rank numbers when ranked is false', () => {
    render(<DataList items={sampleItems} ranked={false} />);
    // Should not have rank number elements
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.queryByText('2')).toBeNull();
    expect(screen.queryByText('3')).toBeNull();
  });

  it('renders "No data available" when items array is empty', () => {
    render(<DataList items={[]} />);
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('renders extra content when provided', () => {
    const items = [{ label: 'Page', value: 90, extra: <span data-testid="extra-el">!</span> }];
    render(<DataList items={items} />);
    expect(screen.getByTestId('extra-el')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<DataList items={[]} className="my-list" />);
    expect(container.firstElementChild!.className).toContain('my-list');
  });
});
