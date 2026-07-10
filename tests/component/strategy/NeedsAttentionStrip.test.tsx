// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { NeedsAttentionStrip } from '../../../src/components/strategy/NeedsAttentionStrip';

describe('NeedsAttentionStrip', () => {
  it('renders nothing when there are no attention items', () => {
    const { container } = render(<NeedsAttentionStrip items={[]} onAct={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one row per item with a real action button', () => {
    const onAct = vi.fn();
    render(
      <NeedsAttentionStrip
        items={[
          { recId: 'r1', title: 'Old sent rec', kind: 'stale_sent', detail: 'No response in 20 days' },
          { recId: 'r2', title: 'Replaced rec', kind: 'superseded', detail: 'A newer rec covers /pricing' },
          { recId: 'r3', title: 'New client reply', kind: 'new_reply', detail: 'Client asked a question' },
        ]}
        onAct={onAct}
      />,
    );
    expect(screen.getByText(/Needs your attention/i)).toBeInTheDocument();
    expect(screen.getByText('Old sent rec')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /review/i })[0]);
    expect(onAct).toHaveBeenCalledWith('r1', 'stale_sent');
  });

  it('reviews a discussing move without claiming to open a reply thread', () => {
    const onAct = vi.fn();
    render(
      <NeedsAttentionStrip
        items={[
          { recId: 'r3', title: 'Client discussion', kind: 'new_reply', detail: 'Client discussion is active' },
        ]}
        onAct={onAct}
      />,
    );

    const row = screen.getByText('Client discussion').closest('li');
    expect(row).not.toBeNull();
    expect(within(row!).queryByRole('button', { name: 'Open reply' })).not.toBeInTheDocument();
    fireEvent.click(within(row!).getByRole('button', { name: 'Review move' }));
    expect(onAct).toHaveBeenCalledWith('r3', 'new_reply');
  });

  it('discloses every compact Engine item with one reachable review action each', () => {
    const onAct = vi.fn();
    render(
      <NeedsAttentionStrip
        presentation="engine-spine"
        items={[
          { recId: 'r1', title: 'Old sent rec', kind: 'stale_sent', detail: 'No response in 20 days' },
          { recId: 'r2', title: 'New client reply', kind: 'new_reply', detail: 'Client asked a question' },
        ]}
        onAct={onAct}
      />,
    );

    const disclosure = screen.getByTestId('needs-attention-disclosure');
    expect(within(disclosure).getByText('Needs your attention')).toBeInTheDocument();
    expect(within(disclosure).getByText('2 moves to review')).toBeInTheDocument();
    fireEvent.click(within(disclosure).getByText('Needs your attention').closest('summary')!);
    expect(within(disclosure).getByText('Old sent rec')).toBeInTheDocument();
    expect(within(disclosure).getByText('New client reply')).toBeInTheDocument();
    expect(within(disclosure).getAllByRole('button', { name: /review/i })).toHaveLength(2);

    fireEvent.click(within(disclosure).getByRole('button', { name: 'Review move' }));
    expect(onAct).toHaveBeenCalledWith('r2', 'new_reply');
  });
});
