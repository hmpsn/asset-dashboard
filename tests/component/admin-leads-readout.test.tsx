/**
 * Lane B (B2) — AdminLeadsReadout component (the operator's captured-leads view, PII visible).
 *
 * Self-contained, props-only. Renders leadName/leadEmail/formName rows; a BLUE count badge shows
 * `total` (the unbounded count — may exceed leads.length when paginated, proving header N = total,
 * not page length, per the rate-display-shares-source rule). Loading → contextual message; empty →
 * EmptyState + CTA. Color: no purple/violet/indigo; the count badge is data → blue (Law 2).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdminLeadsReadout } from '../../src/components/strategy/issue/AdminLeadsReadout';
import type { NamedLeadView } from '../../shared/types/the-issue';

const LEADS: NamedLeadView[] = [
  { id: 'l1', formName: 'Contact form', leadName: 'Ada Lovelace', leadEmail: 'ada@analytical.test', outcomeType: 'form_fill', submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
  { id: 'l2', formName: 'Demo request', leadName: null, leadEmail: 'grace@navy.test', outcomeType: 'booking', submittedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() },
];

describe('AdminLeadsReadout (B2)', () => {
  it('renders leadName/leadEmail/formName for each lead', () => {
    render(<AdminLeadsReadout leads={LEADS} total={2} />);
    expect(screen.getByText('Captured leads')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@analytical.test')).toBeInTheDocument();
    expect(screen.getByText('grace@navy.test')).toBeInTheDocument();
    expect(screen.getAllByText(/Contact form|Demo request/).length).toBeGreaterThanOrEqual(2);
  });

  it('shows the total count (may exceed page length) in a BLUE badge (data law)', () => {
    // total=37 but only 2 leads on this page — header N must be the unbounded total, not page length.
    render(<AdminLeadsReadout leads={LEADS} total={37} />);
    const badge = screen.getByText(/^37 captured$/i);
    expect(badge).toBeInTheDocument();
    // Data is blue, never teal — the badge must carry a blue class somewhere in its className chain.
    expect(badge.className).toMatch(/blue-/);
  });

  it('renders an em-dash when a lead has no name', () => {
    render(<AdminLeadsReadout leads={LEADS} total={2} />);
    // The second lead has leadName=null → an em-dash placeholder appears.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a contextual loading message and no rows while loading', () => {
    render(<AdminLeadsReadout leads={[]} total={0} loading />);
    expect(screen.getByText(/Loading captured leads/i)).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });

  it('shows an EmptyState with a CTA when total === 0', () => {
    const onConnect = vi.fn();
    render(<AdminLeadsReadout leads={[]} total={0} onConnectCta={onConnect} />);
    expect(screen.getByText(/No leads captured yet/i)).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: /connect a webflow form|connect webflow/i });
    fireEvent.click(cta);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('uses no purple/violet/indigo classes', () => {
    const { container } = render(<AdminLeadsReadout leads={LEADS} total={2} />);
    expect(container.innerHTML).not.toMatch(/purple-|violet|indigo/);
  });
});
