import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BoardColumn, BoardCard } from '../../../src/components/ui/BoardColumn';
import { expectNoA11yViolations } from '../a11y';

describe('BoardColumn', () => {
  it('renders children cards and the count pill', () => {
    render(
      <BoardColumn title="In Review" count={2}>
        <BoardCard title="Task A" />
        <BoardCard title="Task B" />
      </BoardColumn>,
    );
    expect(screen.getByText('In Review')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Task A')).toBeInTheDocument();
    expect(screen.getByText('Task B')).toBeInTheDocument();
  });

  it('shows the empty state when there are no children', () => {
    render(<BoardColumn title="Backlog" empty="Nothing queued" />);
    expect(screen.getByText('Nothing queued')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <BoardColumn title="In Review" count={2}>
        <BoardCard title="Task A" />
        <BoardCard title="Task B" />
      </BoardColumn>,
    );
    await expectNoA11yViolations(container);
  }, 15_000);
});
