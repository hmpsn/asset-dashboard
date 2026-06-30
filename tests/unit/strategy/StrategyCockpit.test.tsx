import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrategyCockpit } from '../../../src/components/strategy/StrategyCockpit';
import type { Recommendation } from '../../../shared/types/recommendations';
import type { CockpitActions } from '../../../src/components/strategy/StrategyCockpit';

// Top-level mock so vitest hoisting works correctly — the spy is replaced per-test in beforeEach.
const mutateSpy = vi.fn();
vi.mock('../../../src/hooks/admin/useRecBulkMutation', () => ({
  useRecBulkMutation: () => ({ mutate: mutateSpy, isPending: false }),
}));

/** The cockpit now owns a React Query bulk mutation — wrap in a fresh client (retries off). No
 *  mutation fires unless a bulk action is clicked, so the network boundary needs no mock here. */
function renderCockpit(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function makeActions(overrides: Partial<CockpitActions> = {}): CockpitActions {
  return {
    send: vi.fn(),
    strike: vi.fn(),
    unstrike: vi.fn(),
    throttle: vi.fn(),
    fix: vi.fn(),
    isPending: false,
    ...overrides,
  };
}

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'r1', workspaceId: 'ws1', type: 'content', priority: 'fix_now',
    title: 'Write the pricing post', description: 'why it matters',
    insight: 'insight text',
    impact: 'high', effort: 'low', impactScore: 80,
    source: 'audit', affectedPages: ['/pricing'],
    trafficAtRisk: 0, impressionsAtRisk: 0,
    estimatedGain: '', actionType: 'content_creation',
    status: 'pending', lifecycle: 'active', clientStatus: 'system',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Recommendation;
}

describe('StrategyCockpit', () => {
  it('renders the Fix-now pin for fix_now unsent recs', () => {
    const recs = [makeRec({ priority: 'fix_now', lifecycle: 'active', clientStatus: 'system' })];
    renderCockpit(<StrategyCockpit workspaceId="ws-test" recs={recs} actions={makeActions()} />);
    expect(screen.getByText(/fix now · 1/i)).toBeInTheDocument();
  });

  it('does NOT render Fix-now pin for sent recs', () => {
    const recs = [makeRec({ priority: 'fix_now', clientStatus: 'sent' })];
    renderCockpit(<StrategyCockpit workspaceId="ws-test" recs={recs} actions={makeActions()} />);
    expect(screen.queryByText(/fix now/i)).not.toBeInTheDocument();
  });

  it('renders lifecycle segmented control with correct counts', () => {
    const recs = [
      makeRec({ id: 'a', lifecycle: 'active', clientStatus: 'system' }),
      makeRec({ id: 'b', lifecycle: 'active', clientStatus: 'sent' }),
      makeRec({ id: 'c', lifecycle: 'active', clientStatus: 'approved' }),
      makeRec({ id: 'd', lifecycle: 'throttled', clientStatus: 'system' }),
    ];
    renderCockpit(<StrategyCockpit workspaceId="ws-test" recs={recs} actions={makeActions()} />);
    expect(screen.getByRole('button', { name: /active/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sent/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approved/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /throttled/i })).toBeInTheDocument();
  });

  it('switches bucket: clicking Sent shows sent recs only', () => {
    const recs = [
      makeRec({ id: 'a', title: 'Active rec', lifecycle: 'active', clientStatus: 'system', priority: 'fix_soon' }),
      makeRec({ id: 'b', title: 'Sent rec', lifecycle: 'active', clientStatus: 'sent', priority: 'fix_soon' }),
    ];
    renderCockpit(<StrategyCockpit workspaceId="ws-test" recs={recs} actions={makeActions()} />);
    // Initially shows active bucket (default)
    expect(screen.getAllByText('Active rec').length).toBeGreaterThanOrEqual(1);
    // Switch to Sent
    fireEvent.click(screen.getByRole('button', { name: /^sent/i }));
    expect(screen.getByText('Sent rec')).toBeInTheDocument();
  });

  it('shows empty state when active bucket has no recs', () => {
    const recs = [
      makeRec({ id: 'b', lifecycle: 'active', clientStatus: 'sent', priority: 'fix_soon' }),
    ];
    renderCockpit(<StrategyCockpit workspaceId="ws-test" recs={recs} actions={makeActions()} />);
    // Active bucket has 0 recs
    expect(screen.getByText(/nothing in this view/i)).toBeInTheDocument();
  });

  it('renders category toggle chips', () => {
    const recs = [makeRec()];
    renderCockpit(<StrategyCockpit workspaceId="ws-test" recs={recs} actions={makeActions()} />);
    expect(screen.getByRole('button', { name: /content/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /technical/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quick wins/i })).toBeInTheDocument();
  });

  it('renders sort buttons', () => {
    renderCockpit(<StrategyCockpit workspaceId="ws-test" recs={[]} actions={makeActions()} />);
    expect(screen.getByRole('button', { name: /value/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /impact/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /age/i })).toBeInTheDocument();
  });

  it('clears selection when lifecycle bucket changes (FIX-4 regression lock)', () => {
    // Two recs: one in active bucket (clientStatus 'system'), one in sent bucket (clientStatus 'sent').
    const recs = [
      makeRec({ id: 'a', title: 'Active rec', lifecycle: 'active', clientStatus: 'system', priority: 'fix_soon' }),
      makeRec({ id: 'b', title: 'Sent rec',   lifecycle: 'active', clientStatus: 'sent',   priority: 'fix_soon' }),
    ];
    renderCockpit(<StrategyCockpit workspaceId="ws-test" recs={recs} actions={makeActions()} />);

    // Active bucket is default — select-all lands on the active rec.
    const selectAllBtn = screen.getByRole('button', { name: /select all/i });
    fireEvent.click(selectAllBtn);
    // Bulk action bar should appear (selectedCount > 0).
    expect(screen.getByRole('toolbar', { name: /bulk actions/i })).toBeInTheDocument();

    // Now switch to the Sent bucket — selection should clear.
    fireEvent.click(screen.getByRole('button', { name: /^sent/i }));
    expect(screen.queryByRole('toolbar', { name: /bulk actions/i })).not.toBeInTheDocument();
  });

  it('clears selection when the category filter changes (FIX-4 lock, cats axis)', () => {
    // Two active-bucket content recs (fix_soon keeps them out of the non-selectable Fix-now pin).
    const recs = [
      makeRec({ id: 'a', title: 'Active one', lifecycle: 'active', clientStatus: 'system', priority: 'fix_soon', type: 'content' }),
      makeRec({ id: 'c', title: 'Active two', lifecycle: 'active', clientStatus: 'system', priority: 'fix_soon', type: 'content' }),
    ];
    renderCockpit(<StrategyCockpit workspaceId="ws-test" recs={recs} actions={makeActions()} />);

    fireEvent.click(screen.getByRole('button', { name: /select all/i }));
    expect(screen.getByRole('toolbar', { name: /bulk actions/i })).toBeInTheDocument();

    // Toggle a category chip — catsKey changes, so the [bucket, catsKey] effect must clear selection.
    fireEvent.click(screen.getByRole('button', { name: /^content/i }));
    expect(screen.queryByRole('toolbar', { name: /bulk actions/i })).not.toBeInTheDocument();
  });

  describe('confirm-strike fires mutation with resolved ids (FIX-5)', () => {
    beforeEach(() => {
      mutateSpy.mockReset();
    });

    it('calls mutate with correct payload after arm-then-confirm-strike', async () => {
      const recs = [
        makeRec({ id: 'rec-x', title: 'Rec X', lifecycle: 'active', clientStatus: 'system', priority: 'fix_soon' }),
      ];
      renderCockpit(<StrategyCockpit workspaceId="ws-test" recs={recs} actions={makeActions()} />);

      // Select the single visible rec via select-all.
      fireEvent.click(screen.getByRole('button', { name: /select all/i }));
      const toolbar = screen.getByRole('toolbar', { name: /bulk actions/i });
      expect(toolbar).toBeInTheDocument();

      // Arm the strike (first click shows "Strike N").
      fireEvent.click(screen.getByRole('button', { name: /^strike/i }));

      // Confirm the armed strike ("Confirm strike N").
      fireEvent.click(screen.getByRole('button', { name: /confirm strike/i }));

      expect(mutateSpy).toHaveBeenCalledWith({
        recIds: ['rec-x'],
        action: 'strike',
        confirmStrike: true,
      });
    });
  });
});
