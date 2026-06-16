import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClientKeywordFeedback } from '../../../src/components/strategy/ClientKeywordFeedback';
import type { AdminKeywordFeedbackListRow } from '../../../shared/types/keyword-feedback';

const makeRow = (keyword: string, status: AdminKeywordFeedbackListRow['status'], reason?: string): AdminKeywordFeedbackListRow => ({
  keyword,
  status,
  reason: reason ?? null,
  source: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  declined_by: null,
});

const requestedRow = makeRow('best dentist', 'requested');
const declinedRow = makeRow('cheap dentist', 'declined', 'Too price-sensitive');
const approvedRow = makeRow('dentist near me', 'approved');

describe('ClientKeywordFeedback', () => {
  it('renders the requested section when rows contain a requested keyword', () => {
    render(
      <ClientKeywordFeedback
        rows={[requestedRow]}
        requested={[requestedRow]}
        declined={[]}
        approved={[]}
        addPending={false}
        addError={null}
        onAdd={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );
    expect(screen.getByText('Requested by client')).toBeInTheDocument();
    expect(screen.getByText('best dentist')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add to Strategy/i })).toBeInTheDocument();
  });

  it('renders the declined section when rows contain a declined keyword', () => {
    render(
      <ClientKeywordFeedback
        rows={[declinedRow]}
        requested={[]}
        declined={[declinedRow]}
        approved={[]}
        addPending={false}
        addError={null}
        onAdd={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );
    expect(screen.getByText('cheap dentist')).toBeInTheDocument();
    expect(screen.getByText('Too price-sensitive')).toBeInTheDocument();
  });

  it('renders both sections together', () => {
    render(
      <ClientKeywordFeedback
        rows={[requestedRow, declinedRow]}
        requested={[requestedRow]}
        declined={[declinedRow]}
        approved={[]}
        addPending={false}
        addError={null}
        onAdd={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );
    expect(screen.getByText('Requested by client')).toBeInTheDocument();
    expect(screen.getByText('Declined by client')).toBeInTheDocument();
    expect(screen.getByText('best dentist')).toBeInTheDocument();
    expect(screen.getByText('cheap dentist')).toBeInTheDocument();
  });

  it('calls onAdd with the keyword when "Add to Strategy" is clicked', () => {
    const onAdd = vi.fn();
    render(
      <ClientKeywordFeedback
        rows={[requestedRow]}
        requested={[requestedRow]}
        declined={[]}
        approved={[]}
        addPending={false}
        addError={null}
        onAdd={onAdd}
        onDismissError={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add to Strategy/i }));
    expect(onAdd).toHaveBeenCalledWith('best dentist');
  });

  it('renders the empty-state copy when rows is empty', () => {
    render(
      <ClientKeywordFeedback
        rows={[]}
        requested={[]}
        declined={[]}
        approved={[]}
        addPending={false}
        addError={null}
        onAdd={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );
    expect(screen.getByText(/No client feedback submitted yet/i)).toBeInTheDocument();
  });

  it('slices the declined list to 12 and shows the overflow message', () => {
    const manyDeclined = Array.from({ length: 15 }, (_, i) => makeRow(`kw-${i}`, 'declined'));
    render(
      <ClientKeywordFeedback
        rows={manyDeclined}
        requested={[]}
        declined={manyDeclined}
        approved={[]}
        addPending={false}
        addError={null}
        onAdd={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );
    // Only 12 declined rows should be rendered (kw-0 through kw-11)
    expect(screen.getByText('kw-0')).toBeInTheDocument();
    expect(screen.getByText('kw-11')).toBeInTheDocument();
    expect(screen.queryByText('kw-12')).not.toBeInTheDocument();
    // The overflow message
    expect(screen.getByText(/Showing latest 12 declines \(15 total\)/i)).toBeInTheDocument();
  });

  it('renders the addError InlineBanner when addError is set', () => {
    const onDismissError = vi.fn();
    render(
      <ClientKeywordFeedback
        rows={[requestedRow]}
        requested={[requestedRow]}
        declined={[]}
        approved={[]}
        addPending={false}
        addError="Failed to add keyword"
        onAdd={vi.fn()}
        onDismissError={onDismissError}
      />,
    );
    expect(screen.getByText('Failed to add keyword')).toBeInTheDocument();
  });

  it('shows the counts in the title extra', () => {
    render(
      <ClientKeywordFeedback
        rows={[requestedRow, declinedRow, approvedRow]}
        requested={[requestedRow]}
        declined={[declinedRow]}
        approved={[approvedRow]}
        addPending={false}
        addError={null}
        onAdd={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 declined · 1 requested · 1 approved/i)).toBeInTheDocument();
  });

  it('with showRequested=false: suppresses requested block + Add button, still renders declined log', () => {
    render(
      <ClientKeywordFeedback
        rows={[requestedRow, declinedRow]}
        requested={[requestedRow]}
        declined={[declinedRow]}
        approved={[]}
        addPending={false}
        addError={null}
        onAdd={vi.fn()}
        onDismissError={vi.fn()}
        showRequested={false}
      />,
    );
    // Requested block must be absent
    expect(screen.queryByText('Requested by client')).not.toBeInTheDocument();
    expect(screen.queryByText('best dentist')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add to Strategy/i })).not.toBeInTheDocument();
    // Declined log must still render
    expect(screen.getByText('cheap dentist')).toBeInTheDocument();
    expect(screen.getByText('Too price-sensitive')).toBeInTheDocument();
  });
});
