import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const state = vi.hoisted(() => ({
  signals: { data: undefined as unknown, isLoading: false },
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock('../../../src/hooks/admin/useIntelligenceSignals', () => ({
  useIntelligenceSignals: () => state.signals,
}));
vi.mock('../../../src/hooks/admin/useRecomputeSignals', () => ({
  useRecomputeSignals: () => ({ mutate: state.mutate, isPending: state.isPending }),
}));

import { IntelligenceSignals } from '../../../src/components/strategy/IntelligenceSignals';

const sig = (over = {}) => ({ insightId: 'i1', type: 'momentum', keyword: 'crm software', detail: 'Gaining', ...over });

describe('IntelligenceSignals — freshness caption + Recompute (Phase 5b)', () => {
  beforeEach(() => {
    state.mutate.mockReset();
    state.isPending = false;
    state.signals = { data: { signals: [sig()], computedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }, isLoading: false };
  });

  it('renders a "Computed X ago" caption from computedAt', () => {
    render(<IntelligenceSignals workspaceId="ws1" />);
    expect(screen.getByText(/Computed .*hours? ago/)).toBeInTheDocument();
  });

  it('renders a "Recompute now" button that fires the mutation', () => {
    render(<IntelligenceSignals workspaceId="ws1" />);
    const btn = screen.getByRole('button', { name: /recompute now/i });
    fireEvent.click(btn);
    expect(state.mutate).toHaveBeenCalledTimes(1);
  });

  it('omits the caption when computedAt is absent, but still shows Recompute', () => {
    state.signals = { data: { signals: [sig()] }, isLoading: false };
    render(<IntelligenceSignals workspaceId="ws1" />);
    expect(screen.queryByText(/Computed .* ago/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /recompute now/i })).toBeInTheDocument();
  });

  it('shows the Recompute action even in the empty-signals state', () => {
    state.signals = { data: { signals: [], computedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() }, isLoading: false };
    render(<IntelligenceSignals workspaceId="ws1" />);
    expect(screen.getByText(/No intelligence signals yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /recompute now/i })).toBeInTheDocument();
  });

  it('uses divider rows and compact icon chips for the Engine spine without dropping controls', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.signals = {
      data: {
        signals: [
          sig({ insightId: 'i1', keyword: 'implant demand' }),
          sig({ insightId: 'i2', type: 'misalignment', keyword: 'cosmetic mismatch' }),
          sig({ insightId: 'i3', type: 'content_gap', keyword: 'denture gap' }),
          sig({ insightId: 'i4', keyword: 'local growth' }),
          sig({ insightId: 'i1', type: 'content_gap', keyword: 'hidden growth' }),
        ],
        computedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      },
      isLoading: false,
    };

    render(
      <IntelligenceSignals
        workspaceId="ws1"
        presentation="engine-spine"
        initialLimit={4}
      />,
    );

    const compactList = screen.getByTestId('intelligence-signals-list');
    expect(compactList).toHaveClass(
      'divide-y',
      'divide-[var(--brand-border)]',
      'px-4',
    );
    expect(compactList.parentElement).not.toHaveClass('p-4');
    const rows = screen.getAllByTestId('intelligence-signal-row');
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row).toHaveClass('py-2.5');
      expect(row).not.toHaveClass('rounded-[var(--radius-lg)]', 'bg-[var(--surface-3)]/30');
    }
    expect(within(rows[0]).getByText('implant demand')).toHaveClass('t-ui');
    expect(within(rows[0]).getByText('Gaining', { selector: 'p' })).toHaveClass('t-caption-sm');
    expect(screen.getAllByTestId('intelligence-signal-icon')).toHaveLength(4);
    expect(document.querySelector('.fa-bolt')).toBeInTheDocument();
    expect(rows[0].querySelector('.fa-arrow-up')).toBeInTheDocument();
    expect(within(screen.getByTestId('intelligence-signals-header-action')).getByText('5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show all 5 signals/i }));
    expect(screen.getAllByTestId('intelligence-signal-row')).toHaveLength(5);
    expect(consoleError.mock.calls.some(([message]) => (
      String(message).includes('Encountered two children with the same key')
    ))).toBe(false);
    expect(screen.getByRole('button', { name: /recompute now/i })).toBeInTheDocument();
  });

  it('retains the legacy card-row presentation when no presentation is requested', () => {
    render(<IntelligenceSignals workspaceId="ws1" />);

    expect(screen.getByTestId('intelligence-signals-list')).toHaveClass('space-y-2');
    expect(screen.getByTestId('intelligence-signal-row')).toHaveClass(
      'rounded-[var(--radius-lg)]',
      'bg-[var(--surface-3)]/30',
    );
  });
});
