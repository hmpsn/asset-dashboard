import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RequestedKeywordTriage } from '../../../src/components/strategy/RequestedKeywordTriage';
import type { AdminKeywordFeedbackListRow } from '../../../shared/types/keyword-feedback';

const makeRow = (keyword: string): AdminKeywordFeedbackListRow => ({
  keyword,
  status: 'requested',
  reason: null,
  source: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  declined_by: null,
});

const row1 = makeRow('best dentist');
const row2 = makeRow('dentist near me');

describe('RequestedKeywordTriage', () => {
  it('renders nothing when requested is empty', () => {
    const { container } = render(
      <RequestedKeywordTriage
        requested={[]}
        addPending={false}
        addError={null}
        onAdd={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders each requested keyword', () => {
    render(
      <RequestedKeywordTriage
        requested={[row1, row2]}
        addPending={false}
        addError={null}
        onAdd={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );
    expect(screen.getByText('best dentist')).toBeInTheDocument();
    expect(screen.getByText('dentist near me')).toBeInTheDocument();
  });

  it('calls onAdd with the keyword when "Add to Strategy" is clicked', () => {
    const onAdd = vi.fn();
    render(
      <RequestedKeywordTriage
        requested={[row1]}
        addPending={false}
        addError={null}
        onAdd={onAdd}
        onDismissError={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add to Strategy/i }));
    expect(onAdd).toHaveBeenCalledWith('best dentist');
  });

  it('renders the addError InlineBanner and calls onDismissError when dismissed', () => {
    const onDismissError = vi.fn();
    render(
      <RequestedKeywordTriage
        requested={[row1]}
        addPending={false}
        addError="Failed to add keyword"
        onAdd={vi.fn()}
        onDismissError={onDismissError}
      />,
    );
    expect(screen.getByText('Failed to add keyword')).toBeInTheDocument();
    // Dismiss button triggers onDismissError
    const dismissBtn = screen.getByRole('button', { name: /Dismiss error/i });
    fireEvent.click(dismissBtn);
    expect(onDismissError).toHaveBeenCalledOnce();
  });

  it('disables the Add button when addPending is true', () => {
    render(
      <RequestedKeywordTriage
        requested={[row1]}
        addPending={true}
        addError={null}
        onAdd={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Add to Strategy/i })).toBeDisabled();
  });

  it('shows the count in the card title extra', () => {
    render(
      <RequestedKeywordTriage
        requested={[row1, row2]}
        addPending={false}
        addError={null}
        onAdd={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );
    expect(screen.getByText('2 keywords')).toBeInTheDocument();
  });

  it('uses singular "keyword" when count is 1', () => {
    render(
      <RequestedKeywordTriage
        requested={[row1]}
        addPending={false}
        addError={null}
        onAdd={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );
    expect(screen.getByText('1 keyword')).toBeInTheDocument();
  });
});
