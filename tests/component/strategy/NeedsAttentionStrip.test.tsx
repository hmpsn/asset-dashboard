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
});
