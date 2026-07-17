import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OutcomeDashboard from '../../src/components/admin/outcomes/OutcomeDashboard';
import RecordPublishedWorkCard from '../../src/components/admin/outcomes/RecordPublishedWorkCard';

const mutate = vi.fn();
vi.mock('../../src/hooks/admin/useOutcomes', () => ({
  useRecordOutcomeAction: () => ({ mutate, isPending: false, isError: false }),
}));

vi.mock('../../src/components/admin/outcomes/OutcomeTopWins', () => ({
  default: () => <div data-testid="outcome-wins-readback">Top wins readback</div>,
}));
vi.mock('../../src/components/admin/outcomes/OutcomeScorecard', () => ({ default: () => <div>Scorecard readback</div> }));
vi.mock('../../src/components/admin/outcomes/OutcomeActionFeed', () => ({ default: () => <div>Action readback</div> }));
vi.mock('../../src/components/admin/outcomes/OutcomeLearningsPanel', () => ({ default: () => <div>Learnings readback</div> }));
vi.mock('../../src/components/admin/outcomes/OutcomePlaybooks', () => ({ default: () => <div>Playbooks readback</div> }));
vi.mock('../../src/components/admin/outcomes/OutcomeCoverageFunnel', () => ({ default: () => <div>Coverage readback</div> }));

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

function fill(url: string, title: string) {
  fireEvent.change(screen.getByPlaceholderText(/example\.com\/blog/i), { target: { value: url } });
  fireEvent.change(screen.getByPlaceholderText(/choose a local plumber/i), { target: { value: title } });
}

describe('RecordPublishedWorkCard', () => {
  it('keeps the active outcome readback above the occasional record-work form', async () => {
    render(<OutcomeDashboard workspaceId="ws-1" />);

    const tabs = screen.getByRole('tablist');
    const readback = await screen.findByTestId('outcome-wins-readback');
    const recordForm = screen.getByRole('button', { name: 'Record' }).closest('form');

    expect(recordForm).not.toBeNull();
    expect(tabs.compareDocumentPosition(readback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(readback.compareDocumentPosition(recordForm!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

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
