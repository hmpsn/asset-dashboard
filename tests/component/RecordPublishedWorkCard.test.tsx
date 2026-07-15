import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RecordPublishedWorkCard from '../../src/components/admin/outcomes/RecordPublishedWorkCard';

const mutate = vi.fn();
vi.mock('../../src/hooks/admin/useOutcomes', () => ({
  useRecordOutcomeAction: () => ({ mutate, isPending: false, isError: false }),
}));

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

function fill(url: string, title: string) {
  fireEvent.change(screen.getByPlaceholderText(/example\.com\/blog/i), { target: { value: url } });
  fireEvent.change(screen.getByPlaceholderText(/choose a local plumber/i), { target: { value: title } });
}

describe('RecordPublishedWorkCard', () => {
  it('records agency-published work as platform_executed with a source snapshot', () => {
    render(<RecordPublishedWorkCard workspaceId="ws-1" />);
    fill('https://rinse.example/blog/whitening', 'Teeth Whitening 101');
    fireEvent.click(screen.getByRole('button', { name: /record/i }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const body = mutate.mock.calls[0][0];
    expect(body.attribution).toBe('platform_executed'); // default author = agency
    expect(body.sourceType).toBe('manual');
    expect(body.actionType).toBe('content_published');
    expect(body.pageUrl).toBe('https://rinse.example/blog/whitening');
    expect(body.sourceId).toBe('manual:rinse-example-blog-whitening');
    expect(body.source.label).toBe('Teeth Whitening 101');
    expect(body.source.snapshot.title).toBe('Teeth Whitening 101');
    expect(body.source.snapshot.type).toBe('manual');
  });

  it('records client-published work as externally_executed (never over-credited to us)', () => {
    render(<RecordPublishedWorkCard workspaceId="ws-1" />);
    fill('https://rinse.example/p', 'Their Own Post');
    // The 2nd combobox is "Who published it?" — switch it to the client option.
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'externally_executed' } });
    fireEvent.click(screen.getByRole('button', { name: /record/i }));

    const body = mutate.mock.calls[0][0];
    expect(body.attribution).toBe('externally_executed');
  });

  it('does not submit without a URL and a title', () => {
    render(<RecordPublishedWorkCard workspaceId="ws-1" />);
    // Only a URL, no title → button disabled, no mutate.
    fireEvent.change(screen.getByPlaceholderText(/example\.com\/blog/i), {
      target: { value: 'https://rinse.example/x' },
    });
    fireEvent.click(screen.getByRole('button', { name: /record/i }));
    expect(mutate).not.toHaveBeenCalled();
  });
});
