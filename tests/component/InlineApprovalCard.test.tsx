/**
 * Component tests for ISSUE 1 — InlineApprovalCard (DARK; mounted only from UnifiedInbox behind the
 * `unified-inbox` flag).
 *
 * Asserts:
 *  - renders one ItemDiffRow per item (Current/Proposed substance inline, no modal);
 *  - Approve with no flags → onApprove([]);
 *  - one flagged → onApprove([{itemId,note}]) + the "implement N-1 of N" CTA label;
 *  - Request changes / Decline note paths call their handlers with the typed note;
 *  - multi-page items show per-page group sub-headers; single-page suppresses them;
 *  - field:'schema' shows the Show full/less expand toggle; non-schema does not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { InlineApprovalCard } from '../../src/components/client/inbox/InlineApprovalCard';
import type { NormalizedDecision } from '../../shared/types/decision';
import type { ClientDeliverableItem } from '../../shared/types/client-deliverable';

function makeItem(overrides: Partial<ClientDeliverableItem> = {}): ClientDeliverableItem {
  return {
    id: 'cdi_1',
    deliverableId: 'cd_1',
    status: 'awaiting_client',
    targetRef: 'page-1',
    collectionId: null,
    field: 'seoTitle',
    currentValue: 'Old title',
    proposedValue: 'New title',
    clientValue: null,
    clientNote: null,
    applyable: true,
    itemPayload: { pageTitle: 'Home', pageSlug: '/home' },
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDecision(items: ClientDeliverableItem[]): NormalizedDecision {
  return {
    id: 'cd-cd_1',
    source: 'deliverable',
    sourceId: 'cd_1',
    title: 'SEO updates for your site',
    summary: `${items.length} change${items.length !== 1 ? 's' : ''} ready for your approval`,
    priority: undefined,
    itemCount: items.length,
    kind: 'batch',
    isSingleAction: false,
    badge: 'SEO Editor',
    createdAt: new Date().toISOString(),
    sentAt: new Date().toISOString(),
    items,
    payload: {},
  };
}

const baseHandlers = () => ({
  onApprove: vi.fn(),
  onRequestChanges: vi.fn(),
  onDecline: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InlineApprovalCard', () => {
  it('renders one ItemDiffRow per item (substance inline, no modal "View" affordance)', () => {
    const items = [
      makeItem({ id: 'a', field: 'seoTitle', itemPayload: { pageTitle: 'Home', pageSlug: '/home' } }),
      makeItem({ id: 'b', field: 'seoDescription', itemPayload: { pageTitle: 'Home', pageSlug: '/home' } }),
    ];
    const h = baseHandlers();
    render(<InlineApprovalCard decision={makeDecision(items)} ageLabel="Sent 2 days ago" submitting={false} {...h} />);

    // Both items' Current/Proposed substance is rendered inline (each item shows "New title").
    expect(screen.getAllByText('New title').length).toBe(2);
    // Two ItemDiffRow labels render (combined "Home — field").
    expect(screen.getByText('Home — seoTitle')).toBeInTheDocument();
    expect(screen.getByText('Home — seoDescription')).toBeInTheDocument();
    // No "View N →" modal affordance.
    expect(screen.queryByRole('button', { name: /View/ })).not.toBeInTheDocument();
    // Age label surfaced.
    expect(screen.getByText('Sent 2 days ago')).toBeInTheDocument();
  });

  it('Approve with no flags → onApprove([]) and CTA reads "implement N of M"', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
    const h = baseHandlers();
    render(<InlineApprovalCard decision={makeDecision(items)} ageLabel={null} submitting={false} {...h} />);

    expect(screen.getByRole('button', { name: 'Looks good — implement 2 of 2 →' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Looks good — implement 2 of 2 →' }));
    expect(h.onApprove).toHaveBeenCalledWith([]);
  });

  it('one flagged → onApprove([{itemId,note}]) and CTA reads "implement N-1 of N"', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
    const h = baseHandlers();
    render(<InlineApprovalCard decision={makeDecision(items)} ageLabel={null} submitting={false} {...h} />);

    // Flag the first item. Each ItemDiffRow has a Flag button; flag the first.
    const flagButtons = screen.getAllByRole('button', { name: 'Flag' });
    fireEvent.click(flagButtons[0]);
    // Submit the flag (no note).
    fireEvent.click(screen.getByRole('button', { name: 'Flag it' }));

    // CTA now reflects the held item.
    expect(screen.getByRole('button', { name: 'implement 1 of 2 →' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'implement 1 of 2 →' }));
    expect(h.onApprove).toHaveBeenCalledWith([{ itemId: 'a', note: '' }]);
  });

  it('Request changes note path → onRequestChanges(note)', () => {
    const items = [makeItem({ id: 'a' })];
    const h = baseHandlers();
    render(<InlineApprovalCard decision={makeDecision(items)} ageLabel={null} submitting={false} {...h} />);

    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    const input = screen.getByPlaceholderText('Add a note for your team…');
    fireEvent.change(input, { target: { value: 'Please shorten the title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(h.onRequestChanges).toHaveBeenCalledWith('Please shorten the title');
  });

  it('Decline note path → onDecline(note)', () => {
    const items = [makeItem({ id: 'a' })];
    const h = baseHandlers();
    render(<InlineApprovalCard decision={makeDecision(items)} ageLabel={null} submitting={false} {...h} />);

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    const input = screen.getByPlaceholderText('Why are you declining? (optional)');
    fireEvent.change(input, { target: { value: 'Not now' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(h.onDecline).toHaveBeenCalledWith('Not now');
  });

  it('multi-page items render per-page group sub-headers', () => {
    const items = [
      makeItem({ id: 'a', field: 'seoTitle', itemPayload: { pageTitle: 'Home', pageSlug: '/home' } }),
      makeItem({ id: 'b', field: 'seoTitle', itemPayload: { pageTitle: 'About', pageSlug: '/about' } }),
    ];
    const h = baseHandlers();
    render(<InlineApprovalCard decision={makeDecision(items)} ageLabel={null} submitting={false} {...h} />);

    // The group sub-headers render the bare page label ("Home" / "About"); the per-item row labels
    // render the combined "Home — seoTitle" form, so the bare label is unique to the sub-header.
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
    expect(screen.getByText('Home — seoTitle')).toBeInTheDocument();
    expect(screen.getByText('About — seoTitle')).toBeInTheDocument();
  });

  it('single-page items suppress the group sub-header (no bare page-label header)', () => {
    const items = [
      makeItem({ id: 'a', field: 'seoTitle', itemPayload: { pageTitle: 'Home', pageSlug: '/home' } }),
      makeItem({ id: 'b', field: 'seoDescription', itemPayload: { pageTitle: 'Home', pageSlug: '/home' } }),
    ];
    const h = baseHandlers();
    render(<InlineApprovalCard decision={makeDecision(items)} ageLabel={null} submitting={false} {...h} />);

    // Single page → no group sub-header → the bare "Home" header is absent (rows are "Home — field").
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.getByText('Home — seoTitle')).toBeInTheDocument();
    expect(screen.getByText('Home — seoDescription')).toBeInTheDocument();
  });

  it("field:'schema' shows the Show full/less toggle; non-schema does not", () => {
    const schemaItems = [makeItem({ id: 'a', field: 'schema', currentValue: '{}', proposedValue: '{"@type":"Thing"}' })];
    const h = baseHandlers();
    const { unmount } = render(
      <InlineApprovalCard decision={makeDecision(schemaItems)} ageLabel={null} submitting={false} {...h} />,
    );
    expect(screen.getByRole('button', { name: 'Show full ↓' })).toBeInTheDocument();
    unmount();

    const nonSchemaItems = [makeItem({ id: 'a', field: 'seoTitle' })];
    render(<InlineApprovalCard decision={makeDecision(nonSchemaItems)} ageLabel={null} submitting={false} {...baseHandlers()} />);
    expect(screen.queryByRole('button', { name: 'Show full ↓' })).not.toBeInTheDocument();
  });

  it('expand toggle swaps Show full ↓ → Show less ↑ when clicked', () => {
    const schemaItems = [makeItem({ id: 'a', field: 'schema', proposedValue: '{"@type":"Thing"}' })];
    render(<InlineApprovalCard decision={makeDecision(schemaItems)} ageLabel={null} submitting={false} {...baseHandlers()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show full ↓' }));
    expect(screen.getByRole('button', { name: 'Show less ↑' })).toBeInTheDocument();
  });

  // Guard the page-label sub-header is wrapped in the same card chrome (smoke: title + badge present).
  it('renders the badge and title header', () => {
    const items = [makeItem({ id: 'a' })];
    render(<InlineApprovalCard decision={makeDecision(items)} ageLabel={null} submitting={false} {...baseHandlers()} />);
    const card = screen.getByText('SEO updates for your site').closest('div');
    expect(card).not.toBeNull();
    expect(within(card!).getByText('SEO Editor')).toBeInTheDocument();
  });
});
