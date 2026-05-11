import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecisionCard } from '../../src/components/client/DecisionCard';
import type { NormalizedDecision } from '../../shared/types/decision';

const bulkDecision: NormalizedDecision = {
  id: 'ca-1',
  source: 'client_action',
  sourceId: 'ca-1',
  title: 'Update AEO answers',
  summary: '3 changes proposed',
  priority: 'high',
  itemCount: 3,
  isSingleAction: false,
  badge: 'AEO',
  createdAt: '2026-05-01T00:00:00Z',
};

const singleDecision: NormalizedDecision = {
  ...bulkDecision,
  id: 'ca-2',
  sourceId: 'ca-2',
  title: 'Refresh /services page',
  summary: 'Content showing signs of decay',
  itemCount: 1,
  isSingleAction: true,
  badge: 'Content',
  priority: undefined,
};

describe('DecisionCard — bulk mode', () => {
  it('renders title', () => {
    render(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.getByText('Update AEO answers')).toBeInTheDocument();
  });

  it('renders badge', () => {
    render(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.getByText('AEO')).toBeInTheDocument();
  });

  it('renders "Review 3 changes" CTA', () => {
    render(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /review 3 changes/i })).toBeInTheDocument();
  });

  it('calls onOpen when CTA clicked', () => {
    const onOpen = vi.fn();
    render(<DecisionCard decision={bulkDecision} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /review 3 changes/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('shows High priority badge when priority=high', () => {
    render(<DecisionCard decision={bulkDecision} onOpen={vi.fn()} />);
    expect(screen.getByText('High priority')).toBeInTheDocument();
  });

  it('does not show priority badge when priority is undefined', () => {
    render(<DecisionCard decision={{ ...bulkDecision, priority: undefined }} onOpen={vi.fn()} />);
    expect(screen.queryByText('High priority')).not.toBeInTheDocument();
  });
});

describe('DecisionCard — single-action mode', () => {
  it('renders Approve button', () => {
    render(<DecisionCard decision={singleDecision} onOpen={vi.fn()} onApprove={vi.fn()} />);
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
  });

  it('renders "Request changes" button', () => {
    render(<DecisionCard decision={singleDecision} onOpen={vi.fn()} onFlagWithNote={vi.fn()} />);
    expect(screen.getByRole('button', { name: /request changes/i })).toBeInTheDocument();
  });

  it('calls onApprove when Approve clicked', () => {
    const onApprove = vi.fn();
    render(<DecisionCard decision={singleDecision} onOpen={vi.fn()} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('shows note field after "Request changes" click', () => {
    render(<DecisionCard decision={singleDecision} onOpen={vi.fn()} onFlagWithNote={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /request changes/i }));
    expect(screen.getByPlaceholderText(/add a note/i)).toBeInTheDocument();
  });

  it('does NOT render bulk CTA in single-action mode', () => {
    render(<DecisionCard decision={singleDecision} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /review.*change/i })).not.toBeInTheDocument();
  });
});
