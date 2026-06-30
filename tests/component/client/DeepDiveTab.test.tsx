/**
 * DeepDiveTab — slot-based depth tab with Analytics + Rankings sub-tabs.
 *
 * Verifies:
 *   - Default sub-tab is Analytics: shows analyticsSlot + healthSlot, hides rankingsSlot.
 *   - Clicking the Rankings sub-tab shows rankingsSlot, hides analyticsSlot.
 *   - An initial `?sub=rankings` URL opens Rankings first (deep-link receiver half).
 *   - P3 (Client IA v2): an optional `contentPlanSlot` renders as a default-collapsed
 *     "Content roadmap" <details> UNDER the Rankings sub-tab when provided, and is absent
 *     under Analytics and when the slot is omitted.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DeepDiveTab } from '../../../src/components/client/DeepDiveTab';

function renderDeepDive(initialEntry = '/', contentPlanSlot?: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <DeepDiveTab
        analyticsSlot={<div>ANALYTICS</div>}
        healthSlot={<div>HEALTH</div>}
        rankingsSlot={<div>RANKINGS</div>}
        contentPlanSlot={contentPlanSlot}
      />
    </MemoryRouter>
  );
}

describe('DeepDiveTab', () => {
  it('defaults to Analytics: shows Analytics + Health, hides Rankings', () => {
    renderDeepDive();
    expect(screen.getByText('ANALYTICS')).toBeInTheDocument();
    expect(screen.getByText('HEALTH')).toBeInTheDocument();
    expect(screen.queryByText('RANKINGS')).not.toBeInTheDocument();
  });

  it('clicking the Rankings sub-tab shows Rankings and hides Analytics + Health', () => {
    renderDeepDive();
    const rankingsTab = screen.getByRole('tab', { name: /rankings/i });
    fireEvent.click(rankingsTab);

    expect(screen.getByText('RANKINGS')).toBeInTheDocument();
    expect(screen.queryByText('ANALYTICS')).not.toBeInTheDocument();
    expect(screen.queryByText('HEALTH')).not.toBeInTheDocument();
  });

  it('clicking back to Analytics restores Analytics + Health', () => {
    renderDeepDive();
    fireEvent.click(screen.getByRole('tab', { name: /rankings/i }));
    expect(screen.getByText('RANKINGS')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /analytics/i }));
    expect(screen.getByText('ANALYTICS')).toBeInTheDocument();
    expect(screen.getByText('HEALTH')).toBeInTheDocument();
    expect(screen.queryByText('RANKINGS')).not.toBeInTheDocument();
  });

  it('?sub=rankings initial URL opens Rankings first', () => {
    renderDeepDive('/?sub=rankings');
    expect(screen.getByText('RANKINGS')).toBeInTheDocument();
    expect(screen.queryByText('ANALYTICS')).not.toBeInTheDocument();
    expect(screen.queryByText('HEALTH')).not.toBeInTheDocument();
  });

  it('ignores an unknown ?sub= value and falls back to Analytics', () => {
    renderDeepDive('/?sub=bogus');
    expect(screen.getByText('ANALYTICS')).toBeInTheDocument();
    expect(screen.getByText('HEALTH')).toBeInTheDocument();
    expect(screen.queryByText('RANKINGS')).not.toBeInTheDocument();
  });

  // ── P3: Content roadmap slot (default-collapsed, under Rankings only) ──────────
  it('renders a default-collapsed "Content roadmap" section under Rankings when contentPlanSlot is provided', () => {
    // Open on Rankings via deep-link so the contentPlanSlot's sub-tab is active.
    renderDeepDive('/?sub=rankings', <div>CONTENT_ROADMAP</div>);

    // The Rankings slot is active.
    expect(screen.getByText('RANKINGS')).toBeInTheDocument();

    // The "Content roadmap" summary/section is present...
    const summary = screen.getByText('Content roadmap');
    expect(summary).toBeInTheDocument();

    // ...and it is a <details> that is CLOSED by default (no `open` attribute).
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);

    // The slot content is mounted in the (collapsed) DOM but the section is closed.
    expect(screen.getByText('CONTENT_ROADMAP')).toBeInTheDocument();
  });

  it('does not render the "Content roadmap" section under Analytics even when contentPlanSlot is provided', () => {
    // Default sub-tab is Analytics; the content roadmap lives under Rankings only.
    renderDeepDive('/', <div>CONTENT_ROADMAP</div>);

    expect(screen.getByText('ANALYTICS')).toBeInTheDocument();
    expect(screen.queryByText('Content roadmap')).not.toBeInTheDocument();
    expect(screen.queryByText('CONTENT_ROADMAP')).not.toBeInTheDocument();
  });

  it('switching from Rankings to Analytics unmounts the "Content roadmap" section', () => {
    renderDeepDive('/?sub=rankings', <div>CONTENT_ROADMAP</div>);
    expect(screen.getByText('Content roadmap')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /analytics/i }));

    expect(screen.getByText('ANALYTICS')).toBeInTheDocument();
    expect(screen.queryByText('Content roadmap')).not.toBeInTheDocument();
    expect(screen.queryByText('CONTENT_ROADMAP')).not.toBeInTheDocument();
  });

  it('omits the "Content roadmap" section entirely when contentPlanSlot is not provided', () => {
    // No contentPlanSlot — neither sub-tab should surface a content roadmap.
    renderDeepDive('/?sub=rankings');
    expect(screen.getByText('RANKINGS')).toBeInTheDocument();
    expect(screen.queryByText('Content roadmap')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /analytics/i }));
    expect(screen.getByText('ANALYTICS')).toBeInTheDocument();
    expect(screen.queryByText('Content roadmap')).not.toBeInTheDocument();
  });
});
