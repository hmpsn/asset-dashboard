import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../../src/components/ui/StatusBadge';

describe('StatusBadge', () => {
  it('returns null for clean status', () => {
    const { container } = render(<StatusBadge status="clean" />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null for null status', () => {
    const { container } = render(<StatusBadge status={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null for undefined status', () => {
    const { container } = render(<StatusBadge status={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders label for issue-detected status', () => {
    render(<StatusBadge status="issue-detected" />);
    expect(screen.getByText('Issue Detected')).toBeInTheDocument();
  });

  it('renders label for fix-proposed status', () => {
    render(<StatusBadge status="fix-proposed" />);
    expect(screen.getByText('Fix Proposed')).toBeInTheDocument();
  });

  it('renders label for in-review status', () => {
    render(<StatusBadge status="in-review" />);
    expect(screen.getByText('In Review')).toBeInTheDocument();
  });

  it('renders label for approved status', () => {
    render(<StatusBadge status="approved" />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('renders label for rejected status', () => {
    render(<StatusBadge status="rejected" />);
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });

  it('renders label for live status', () => {
    render(<StatusBadge status="live" />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('renders dot instead of label when showLabel is false', () => {
    const { container } = render(<StatusBadge status="approved" showLabel={false} />);
    expect(screen.queryByText('Approved')).toBeNull();
    expect(container.querySelector('span span')).not.toBeNull(); // dot span
  });

  it('uses smaller text for sm size', () => {
    const { container } = render(<StatusBadge status="approved" size="sm" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('text-[11px]');
  });

  it('uses larger text for md size', () => {
    const { container } = render(<StatusBadge status="approved" size="md" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('text-xs');
  });
});
