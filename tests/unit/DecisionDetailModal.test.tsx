import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DecisionDetailModal } from '../../src/components/client/DecisionDetailModal';
import type { NormalizedDecision } from '../../shared/types/decision';
import type { ApprovalBatch } from '../../shared/types/approvals';
import type { ClientAction } from '../../shared/types/client-actions';

const mockDecision: NormalizedDecision = {
  id: 'ab-1',
  source: 'approval_batch',
  sourceId: 'ab-1',
  title: 'SEO Editor — 3 pages',
  summary: '3 changes ready for approval',
  priority: undefined,
  itemCount: 3,
  isSingleAction: false,
  badge: 'SEO Editor',
  createdAt: '2026-05-01T00:00:00Z',
};

const mockBatch: ApprovalBatch = {
  id: 'ab-1',
  workspaceId: 'ws-1',
  siteId: 'site-1',
  name: 'SEO Editor — 3 pages',
  items: [
    { id: 'i1', pageId: 'p1', pageTitle: 'Home', pageSlug: '/', field: 'seoTitle',
      currentValue: 'Old Title', proposedValue: 'New Title', status: 'pending',
      createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' },
    { id: 'i2', pageId: 'p2', pageTitle: 'About', pageSlug: '/about', field: 'seoDescription',
      currentValue: 'Old desc', proposedValue: 'New desc', status: 'pending',
      createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' },
    { id: 'i3', pageId: 'p3', pageTitle: 'Services', pageSlug: '/services', field: 'seoTitle',
      currentValue: 'Old svc', proposedValue: 'New svc', status: 'pending',
      createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' },
  ],
  status: 'pending',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

const internalLinkDecision: NormalizedDecision = {
  id: 'ca-1',
  source: 'client_action',
  sourceId: 'ca-1',
  title: 'Internal links',
  summary: 'Review links',
  priority: 'medium',
  itemCount: 1,
  isSingleAction: false,
  badge: 'Internal Links',
  createdAt: '2026-05-01T00:00:00Z',
};

const internalLinkAction: ClientAction = {
  id: 'ca-1',
  workspaceId: 'ws-1',
  sourceType: 'internal_link',
  sourceId: 'internal-links:test',
  title: 'Internal links',
  summary: 'Review links',
  payload: {
    suggestions: [
      {
        anchorText: 'Learn more',
        targetUrl: '/services',
        sourcePageUrl: '/about',
        sourcePageTitle: 'About Us',
      },
    ],
  },
  status: 'pending',
  priority: 'medium',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

function renderModal(onApprove = vi.fn().mockResolvedValue(undefined), onDismiss = vi.fn()) {
  return render(
    <DecisionDetailModal
      decision={mockDecision}
      originalData={{ type: 'approval_batch', batch: mockBatch }}
      onApprove={onApprove}
      onDismiss={onDismiss}
    />,
  );
}

function renderInternalLinkModal() {
  return render(
    <DecisionDetailModal
      decision={internalLinkDecision}
      originalData={{ type: 'client_action', action: internalLinkAction }}
      onApprove={vi.fn().mockResolvedValue(undefined)}
      onDismiss={vi.fn()}
    />,
  );
}

describe('DecisionDetailModal', () => {
  it('renders dialog with title', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('SEO Editor — 3 pages')).toBeInTheDocument();
  });

  it('renders all batch items', () => {
    renderModal();
    expect(screen.getByText(/Home/)).toBeInTheDocument();
    expect(screen.getByText(/About/)).toBeInTheDocument();
    expect(screen.getByText(/Services/)).toBeInTheDocument();
  });

  it('renders "Looks good — implement 3 →" CTA when no items flagged', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /looks good — implement 3/i })).toBeInTheDocument();
  });

  it('calls onDismiss when close button clicked', () => {
    const onDismiss = vi.fn();
    renderModal(undefined, onDismiss);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when "Save for later" clicked', () => {
    const onDismiss = vi.fn();
    renderModal(undefined, onDismiss);
    fireEvent.click(screen.getByText('Save for later'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('updates CTA label after flagging one item', async () => {
    renderModal();
    // Click the Flag button on the first item row
    const flagButtons = screen.getAllByRole('button', { name: /^flag$/i });
    fireEvent.click(flagButtons[0]);
    // Submit the flag
    fireEvent.click(screen.getByRole('button', { name: /flag it/i }));
    // CTA should now say "implement 2 of 3"
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /implement 2 of 3/i })).toBeInTheDocument();
    });
  });

  it('calls onApprove with empty flaggedItems when no flags', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderModal(onApprove);
    fireEvent.click(screen.getByRole('button', { name: /looks good/i }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith([]));
  });

  it('renders internal link target/source titles separately from URLs', () => {
    renderInternalLinkModal();

    const rows = screen.getAllByRole('row');
    const firstDataRow = rows[1];
    const cells = within(firstDataRow).getAllByRole('cell');

    expect(cells[1].textContent).toBe('—');
    expect(cells[2].textContent).toContain('/services');
    expect(cells[3].textContent).toBe('About Us');
    expect(cells[4].textContent).toBe('/about');
  });
});
