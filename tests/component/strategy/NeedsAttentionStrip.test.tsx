// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});
