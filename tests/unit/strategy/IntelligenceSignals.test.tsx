import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
});
