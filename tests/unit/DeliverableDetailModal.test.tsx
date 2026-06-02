/**
 * R3a — DeliverableDetailModal unit test. Proves the deliverable → renderer mapping:
 *   - a `seo_edit` deliverable's typed items[] render Current/Proposed rows with per-item flag,
 *     and the approve CTA carries the flagged ClientDeliverableItem.id`s ("implement N of M").
 *   - a `redirect` / `internal_link` / `aeo_change` deliverable feeds its `payload.items` to the
 *     corresponding read-only renderer wrapper (whole-action approve — no per-item flag).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DeliverableDetailModal } from '../../src/components/client/DeliverableDetailModal';
import type { NormalizedDecision } from '../../shared/types/decision';
import type { ClientDeliverableItem } from '../../shared/types/client-deliverable';

function makeItem(over: Partial<ClientDeliverableItem> & { id: string }): ClientDeliverableItem {
  return {
    deliverableId: 'cd-1',
    status: 'awaiting_client',
    targetRef: null,
    collectionId: null,
    field: 'seoTitle',
    currentValue: 'Old',
    proposedValue: 'New',
    clientValue: null,
    clientNote: null,
    applyable: false,
    itemPayload: { legacyItemId: `legacy-${over.id}`, pageTitle: 'Page', pageSlug: '/page' },
    sortOrder: 0,
    createdAt: '2026-05-01T00:00:00Z',
    ...over,
  };
}

const seoDecision: NormalizedDecision = {
  id: 'cd-1',
  source: 'deliverable',
  sourceId: 'cd-1',
  title: 'SEO Editor — 3 pages',
  summary: '3 items for review',
  itemCount: 3,
  kind: 'batch',
  isSingleAction: false,
  badge: 'SEO Editor',
  createdAt: '2026-05-01T00:00:00Z',
  payload: { family: 'approval_batch', subType: 'seo_edit' },
  items: [
    makeItem({ id: 'd1', itemPayload: { legacyItemId: 'legacy-1', pageTitle: 'Home', pageSlug: '/' }, currentValue: 'Old Home', proposedValue: 'New Home' }),
    makeItem({ id: 'd2', itemPayload: { legacyItemId: 'legacy-2', pageTitle: 'About', pageSlug: '/about' }, field: 'seoDescription', currentValue: 'Old About', proposedValue: 'New About' }),
    makeItem({ id: 'd3', itemPayload: { legacyItemId: 'legacy-3', pageTitle: 'Services', pageSlug: '/svc' }, currentValue: 'Old Svc', proposedValue: 'New Svc' }),
  ],
};

const redirectDecision: NormalizedDecision = {
  id: 'cd-2',
  source: 'deliverable',
  sourceId: 'cd-2',
  title: 'Redirects',
  summary: '2 redirects for review',
  itemCount: 2,
  kind: 'batch',
  isSingleAction: false,
  badge: 'Redirects',
  createdAt: '2026-05-01T00:00:00Z',
  payload: { family: 'client_action', subType: 'redirect', items: [
    { source: '/old-a', target: '/new-a' },
    { source: '/old-b', target: '/new-b' },
  ] },
  items: [],
};

const internalLinkDecision: NormalizedDecision = {
  id: 'cd-3',
  source: 'deliverable',
  sourceId: 'cd-3',
  title: 'Internal Links',
  summary: '1 suggestion for review',
  itemCount: 1,
  kind: 'batch',
  isSingleAction: false,
  badge: 'Internal Links',
  createdAt: '2026-05-01T00:00:00Z',
  payload: { family: 'client_action', subType: 'internal_link', items: [
    { anchorText: 'Learn more', targetUrl: '/services', sourcePageUrl: '/about', sourcePageTitle: 'About Us' },
  ] },
  items: [],
};

const aeoDecision: NormalizedDecision = {
  id: 'cd-4',
  source: 'deliverable',
  sourceId: 'cd-4',
  title: 'AEO',
  summary: '1 change for review',
  itemCount: 1,
  kind: 'batch',
  isSingleAction: false,
  badge: 'AEO',
  createdAt: '2026-05-01T00:00:00Z',
  payload: { family: 'client_action', subType: 'aeo_change', items: [
    { page: 'FAQ', section: 'Q1', current: 'Old answer', proposed: 'New answer', rationale: 'clarity' },
  ] },
  items: [],
};

function renderModal(decision: NormalizedDecision, onApprove = vi.fn().mockResolvedValue(undefined)) {
  return render(
    <DeliverableDetailModal
      decision={decision}
      onApprove={onApprove}
      onRequestChanges={vi.fn().mockResolvedValue(undefined)}
      onDecline={vi.fn().mockResolvedValue(undefined)}
      onDismiss={vi.fn()}
    />,
  );
}

describe('DeliverableDetailModal — approval family (seo_edit, typed items)', () => {
  it('renders Current/Proposed rows for each item', () => {
    renderModal(seoDecision);
    // Item header labels ("PageTitle — field").
    expect(screen.getByText('Home — seoTitle')).toBeInTheDocument();
    expect(screen.getByText('About — seoDescription')).toBeInTheDocument();
    expect(screen.getByText('Services — seoTitle')).toBeInTheDocument();
    // Proposed values.
    expect(screen.getByText('New Home')).toBeInTheDocument();
    expect(screen.getByText('New About')).toBeInTheDocument();
    expect(screen.getByText('Old Home')).toBeInTheDocument();
    expect(screen.getAllByText('Current').length).toBe(3);
    expect(screen.getAllByText('Proposed').length).toBe(3);
  });

  it('CTA reads "implement 3 →" with no flags', () => {
    renderModal(seoDecision);
    expect(screen.getByRole('button', { name: /implement 3 →/i })).toBeInTheDocument();
  });

  it('flagging one item updates the CTA to "implement 2 of 3" and onApprove carries the flagged id', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderModal(seoDecision, onApprove);

    const flagButtons = screen.getAllByRole('button', { name: /^flag$/i });
    fireEvent.click(flagButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /flag it/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /implement 2 of 3/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /implement 2 of 3/i }));
    await waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith([{ itemId: 'd1', note: '' }]);
    });
  });

  it('approve with no flags calls onApprove with an empty list', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderModal(seoDecision, onApprove);
    fireEvent.click(screen.getByRole('button', { name: /implement 3 →/i }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith([]));
  });
});

describe('DeliverableDetailModal — client_action family (payload.items, read-only)', () => {
  it('redirect deliverable feeds payload.items to the RedirectRenderer (source → target)', () => {
    renderModal(redirectDecision);
    expect(screen.getByText('/old-a')).toBeInTheDocument();
    expect(screen.getByText('/new-a')).toBeInTheDocument();
    expect(screen.getByText('/old-b')).toBeInTheDocument();
    // No per-item flag UX for the client_action family.
    expect(screen.queryByRole('button', { name: /^flag$/i })).not.toBeInTheDocument();
    // Whole-action approve CTA (not "implement N").
    expect(screen.getByRole('button', { name: /^approve →$/i })).toBeInTheDocument();
  });

  it('internal_link deliverable feeds payload.items to the InternalLinkRenderer table', () => {
    renderModal(internalLinkDecision);
    const rows = screen.getAllByRole('row');
    const cells = within(rows[1]).getAllByRole('cell');
    expect(cells[0].textContent).toBe('Learn more');
    expect(cells[2].textContent).toContain('/services');
    expect(cells[3].textContent).toBe('About Us');
    expect(cells[4].textContent).toBe('/about');
  });

  it('aeo_change deliverable feeds payload.items to the AeoRenderer (current/proposed/rationale)', () => {
    renderModal(aeoDecision);
    expect(screen.getByText(/FAQ/)).toBeInTheDocument();
    expect(screen.getByText('Old answer')).toBeInTheDocument();
    expect(screen.getByText('New answer')).toBeInTheDocument();
    expect(screen.getByText(/clarity/)).toBeInTheDocument();
  });
});
