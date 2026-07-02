/**
 * Component tests for OutcomeCoverageFunnel (Reconcile R9 / Task B15).
 *
 * Focus: the "honesty note" (Fix 1) that renders ONLY when a workspace has outcome rows but none
 * have advanced past the `tracked` stage (measured === 0 && reconciled === 0 && tracked > 0). Today
 * the measurement-provenance writer is gated, so this is the production reading for every workspace;
 * the note converts a confusing permanent 100/0/0 funnel into an honest "not wired yet" signal.
 *
 * The real useOutcomeCoverage hook (useQuery) is used — backed by a QueryClient — with only the API
 * layer (outcomesApi.getCoverage) stubbed, so the component's data-driven render branches are
 * exercised for real (not via a mocked hook).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OutcomeCoverage } from '../../shared/types/outcome-tracking';

// Stub the API layer only — the hook itself (useQuery) stays real.
const getCoverage = vi.fn<(wsId: string, signal?: AbortSignal) => Promise<OutcomeCoverage | null>>();
vi.mock('../../src/api/outcomes', () => ({
  outcomesApi: {
    getCoverage: (wsId: string, signal?: AbortSignal) => getCoverage(wsId, signal),
  },
}));

import OutcomeCoverageFunnel from '../../src/components/admin/outcomes/OutcomeCoverageFunnel';

function renderFunnel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OutcomeCoverageFunnel workspaceId="ws-test" />
    </QueryClientProvider>,
  );
}

const NOTE = 'coverage-tracked-only-note';

describe('OutcomeCoverageFunnel — tracked-only honesty note', () => {
  beforeEach(() => {
    getCoverage.mockReset();
  });

  it('renders the honesty note when all outcomes are tracked-only (measured=0, reconciled=0, tracked>0)', async () => {
    getCoverage.mockResolvedValue({ tracked: 5, measured: 0, reconciled: 0 });
    renderFunnel();

    // Note appears once the query resolves.
    await waitFor(() => expect(screen.getByTestId(NOTE)).toBeInTheDocument());
    expect(screen.getByTestId(NOTE).textContent).toMatch(/tracked/i);
    expect(screen.getByTestId(NOTE).textContent).toMatch(/measurement-provenance writer is gated/i);
  });

  it('does NOT render the honesty note once at least one outcome is measured', async () => {
    getCoverage.mockResolvedValue({ tracked: 5, measured: 2, reconciled: 0 });
    renderFunnel();

    // Wait for the funnel to render (the "Reconciled" label appears in both the stat card and the
    // funnel bar, so match all), then assert the note is absent.
    await waitFor(() => expect(screen.getAllByText('Reconciled').length).toBeGreaterThan(0));
    expect(screen.queryByTestId(NOTE)).not.toBeInTheDocument();
  });

  it('does NOT render the honesty note once at least one outcome is reconciled', async () => {
    getCoverage.mockResolvedValue({ tracked: 5, measured: 2, reconciled: 1 });
    renderFunnel();

    await waitFor(() => expect(screen.getAllByText('Reconciled').length).toBeGreaterThan(0));
    expect(screen.queryByTestId(NOTE)).not.toBeInTheDocument();
  });

  it('does NOT render the honesty note for an empty workspace (renders the empty state instead)', async () => {
    getCoverage.mockResolvedValue({ tracked: 0, measured: 0, reconciled: 0 });
    renderFunnel();

    // tracked === 0 → the empty state renders, not the funnel + note.
    await waitFor(() => expect(screen.getByText('No outcomes tracked yet')).toBeInTheDocument());
    expect(screen.queryByTestId(NOTE)).not.toBeInTheDocument();
  });
});
