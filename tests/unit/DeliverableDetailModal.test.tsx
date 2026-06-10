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
import type { PageRoleAssignment, CanonicalEntity } from '../../shared/types/schema-plan';

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
    expect(screen.getByText('Home — SEO Title')).toBeInTheDocument();
    expect(screen.getByText('About — Meta Description')).toBeInTheDocument();
    expect(screen.getByText('Services — SEO Title')).toBeInTheDocument();
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
      // Item 2 — onApprove now carries (flaggedItems, editedItems); no edits here → empty edit list.
      expect(onApprove).toHaveBeenCalledWith([{ itemId: 'd1', note: '' }], []);
    });
  });

  it('approve with no flags calls onApprove with an empty list', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderModal(seoDecision, onApprove);
    fireEvent.click(screen.getByRole('button', { name: /implement 3 →/i }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith([], []));
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
    // Item 5 — canonical approve CTA, now shared with the approval family (redirect itemCount=2 →
    // "implement 2 →"). The client_action family has no typed items to hold, so no "of M" subset.
    expect(screen.getByRole('button', { name: /^looks good — implement 2 →$/i })).toBeInTheDocument();
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

// A1b — schema_plan (kind:'review') carries NO typed items; its substance rides in
// payload.pageRoles (PageRoleAssignment[]) + payload.canonicalEntities (CanonicalEntity[]). Field
// names confirmed against shared/types/schema-plan.ts: PageRoleAssignment = { pagePath, pageTitle,
// role, primaryType, entityRefs, notes?, industrySubtype? }; CanonicalEntity = { type, name,
// canonicalUrl, id, description? }. The modal's schema_plan branch renders pageTitle/pagePath/
// primaryType per page-role row and type/name chips per entity.
const schemaPlanPageRoles: PageRoleAssignment[] = [
  {
    pagePath: '/',
    pageTitle: 'Acme Home',
    role: 'homepage',
    primaryType: 'Organization',
    entityRefs: ['https://example.com/#org'],
  },
  {
    pagePath: '/platform',
    pageTitle: 'Platform Overview',
    role: 'pillar',
    primaryType: 'SoftwareApplication',
    entityRefs: [],
  },
];

const schemaPlanEntities: CanonicalEntity[] = [
  {
    type: 'SoftwareApplication',
    name: 'Acme Platform',
    canonicalUrl: 'https://example.com/platform',
    id: 'https://example.com/platform/#software',
    description: 'The Acme product',
  },
  {
    type: 'Organization',
    name: 'Acme Inc',
    canonicalUrl: 'https://example.com',
    id: 'https://example.com/#org',
  },
];

const schemaPlanDecision: NormalizedDecision = {
  id: 'cd-5',
  source: 'deliverable',
  sourceId: 'cd-5',
  title: 'Schema strategy for your site',
  summary: 'Whole-site schema plan for review',
  itemCount: 2,
  kind: 'review',
  isSingleAction: false,
  badge: 'Schema',
  createdAt: '2026-05-01T00:00:00Z',
  // schema_plan carries no typed items; its substance is in payload.pageRoles + payload.canonicalEntities.
  items: [],
  payload: { family: 'approval_batch', pageRoles: schemaPlanPageRoles, canonicalEntities: schemaPlanEntities },
};

describe('DeliverableDetailModal — A1b schema_plan (payload.pageRoles + payload.canonicalEntities)', () => {
  it('renders the page-roles section: "Page roles (N)" sub-header + each page title/path/primaryType', () => {
    renderModal(schemaPlanDecision);
    // Page-roles sub-header with the count.
    expect(screen.getByText('Page roles (2)')).toBeInTheDocument();
    // Each page-role row renders pageTitle, pagePath, and primaryType.
    expect(screen.getByText('Acme Home')).toBeInTheDocument();
    expect(screen.getByText('/')).toBeInTheDocument();
    expect(screen.getByText('Platform Overview')).toBeInTheDocument();
    expect(screen.getByText('/platform')).toBeInTheDocument();
    // 'Organization' and 'SoftwareApplication' each appear as both a page-role primaryType and an
    // entity type chip, so assert at least one occurrence rather than uniqueness.
    expect(screen.getAllByText('Organization').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SoftwareApplication').length).toBeGreaterThan(0);
  });

  it('renders the entities section: "Site entities (N)" sub-header + entity name/type chips', () => {
    renderModal(schemaPlanDecision);
    expect(screen.getByText('Site entities (2)')).toBeInTheDocument();
    // Entity name + type chips.
    expect(screen.getByText('Acme Platform')).toBeInTheDocument();
    expect(screen.getByText('Acme Inc')).toBeInTheDocument();
    expect(screen.getAllByText('SoftwareApplication').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Organization').length).toBeGreaterThan(0);
  });

  it('does NOT fall through to the generic summary-only fallback (no longer reviewed blind)', () => {
    renderModal(schemaPlanDecision);
    // The else branch text must be ABSENT — the schema_plan branch handled the render.
    expect(screen.queryByText('No reviewable detail for this item.')).not.toBeInTheDocument();
    // And the SchemaPlanReview empty-state text must also be absent (we have substance).
    expect(screen.queryByText('No schema strategy detail to review.')).not.toBeInTheDocument();
  });
});

describe('DeliverableDetailModal — R3b Apply to Website footer', () => {
  it('canApply=true renders a single Apply button and NOT the approve/request/decline row', () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <DeliverableDetailModal
        decision={seoDecision}
        onApprove={vi.fn()}
        onRequestChanges={vi.fn()}
        onDecline={vi.fn()}
        onDismiss={vi.fn()}
        canApply
        onApply={onApply}
      />,
    );
    expect(screen.getByRole('button', { name: /apply to website/i })).toBeInTheDocument();
    // The approve / request-changes / decline verbs are suppressed (apply is a separate step).
    expect(screen.queryByRole('button', { name: /implement/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request changes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^decline$/i })).not.toBeInTheDocument();
  });

  it('clicking Apply fires onApply', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <DeliverableDetailModal
        decision={seoDecision}
        onApprove={vi.fn()}
        onRequestChanges={vi.fn()}
        onDecline={vi.fn()}
        onDismiss={vi.fn()}
        canApply
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /apply to website/i }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
  });

  it('applying=true shows "Applying…" and disables the button', () => {
    render(
      <DeliverableDetailModal
        decision={seoDecision}
        onApprove={vi.fn()}
        onRequestChanges={vi.fn()}
        onDecline={vi.fn()}
        onDismiss={vi.fn()}
        canApply
        applying
        onApply={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: /applying…/i });
    expect(btn).toBeDisabled();
  });

  it('canApply=false renders the normal approve row, no Apply button', () => {
    renderModal(seoDecision);
    expect(screen.queryByRole('button', { name: /apply to website/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /implement 3 →/i })).toBeInTheDocument();
  });
});

describe('DeliverableDetailModal — item 3: centered resized modal shell', () => {
  it('uses the centered max-h panel (not the old full-bleed h-full shell)', () => {
    renderModal(seoDecision);
    const dialog = screen.getByRole('dialog');
    // Outer wrapper centers the panel instead of stacking it full-bleed.
    expect(dialog.className).toContain('items-center');
    expect(dialog.className).toContain('justify-center');
    expect(dialog.className).not.toContain('flex-col');
    // The panel is the centered ~75vw / ≤1200px / ~90vh card, not the old h-full / max-w-3xl shell.
    const panel = dialog.querySelector('.relative');
    expect(panel).not.toBeNull();
    expect(panel!.className).toContain('max-w-[1200px]');
    expect(panel!.className).toContain('max-h-[90vh]');
    expect(panel!.className).toContain('sm:w-[75vw]');
    expect(panel!.className).toContain('rounded-[var(--radius-xl)]');
    expect(panel!.className).not.toContain('h-full');
    expect(panel!.className).not.toContain('max-w-3xl');
  });

  it('backdrop uses the brand-overlay token (SG-3), not raw bg-black/80', () => {
    renderModal(seoDecision);
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.querySelector('.absolute.inset-0');
    expect(backdrop).not.toBeNull();
    expect(backdrop!.className).toContain('bg-[var(--brand-overlay)]');
    expect(backdrop!.className).not.toContain('bg-black/80');
  });
});
