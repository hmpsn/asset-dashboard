/**
 * DeepDiveTab — slot-based depth tab with Analytics + Rankings sub-tabs.
 *
 * Verifies:
 *   - Default sub-tab is Analytics: shows analyticsSlot + healthSlot, hides rankingsSlot.
 *   - Clicking the Rankings sub-tab shows rankingsSlot, hides analyticsSlot.
 *   - An initial `?sub=rankings` URL opens Rankings first (deep-link receiver half).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DeepDiveTab } from '../../../src/components/client/DeepDiveTab';

function renderDeepDive(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <DeepDiveTab
        analyticsSlot={<div>ANALYTICS</div>}
        healthSlot={<div>HEALTH</div>}
        rankingsSlot={<div>RANKINGS</div>}
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
});
