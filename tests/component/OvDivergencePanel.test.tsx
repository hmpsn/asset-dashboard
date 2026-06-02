import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OvDivergencePanel } from '../../src/components/admin/OvDivergencePanel';
import type { OvDivergence } from '../../server/ov-divergence';
import type { OvDivergenceListResponse } from '../../src/api/ovDivergence';

// ── Hook mock ────────────────────────────────────────────────────────────────
type HookResult = {
  data?: OvDivergenceListResponse;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

let hookResult: HookResult;
const refetch = vi.fn();

vi.mock('../../src/hooks/admin/useOvDivergence', () => ({
  useOvDivergence: () => hookResult,
}));

// ── Fixtures ───────────────────────────────────────────────────────────────
function makeRow(overrides: Partial<OvDivergence>): OvDivergence {
  return {
    id: 'row-default',
    workspaceId: 'ws-1',
    legacyTopRecId: 'rec-a',
    ovTopRecId: 'rec-a',
    agree: true,
    ovTopConfidence: 0.8,
    ovTopGroundedSpine: null,
    ovTopEmv: 1200,
    invariantHeld: true,
    legacyTop3: [
      { id: 'rec-a', title: 'Legacy pick A', source: 'seo', impactScore: 90 },
      { id: 'rec-b', title: 'Rec B', source: 'seo', impactScore: 70 },
    ],
    ovTop3: [
      { id: 'rec-a', title: 'OV pick A', source: 'seo', impactScore: 88 },
      { id: 'rec-b', title: 'Rec B', source: 'seo', impactScore: 60 },
    ],
    perRecDelta: [
      { id: 'rec-a', legacy: 90, ov: 88 },
      { id: 'rec-b', legacy: 70, ov: 60 },
    ],
    computedAt: '2026-06-01T12:00:00.000Z',
    ...overrides,
  };
}

/**
 * A representative mix:
 *  - 3 agree rows
 *  - 2 disagree rows (one of which has invariantHeld === false)
 *  - 1 disagree row where ovTopRecId === null (OV produced no pick)
 * → total 6, agree 3 → 50% agree rate; 1 invariant-broken; 1 OV-null.
 */
function mixedRows(): OvDivergence[] {
  return [
    makeRow({ id: 'agree-1', agree: true }),
    makeRow({ id: 'agree-2', agree: true }),
    makeRow({ id: 'agree-3', agree: true }),
    makeRow({
      id: 'disagree-clean',
      agree: false,
      legacyTopRecId: 'rec-a',
      ovTopRecId: 'rec-b',
      invariantHeld: true,
      ovTopConfidence: 0.95,
      ovTopGroundedSpine: 'pricing-spine',
      ovTopEmv: 5000,
      legacyTop3: [{ id: 'rec-a', title: 'Legacy chose A', source: 'seo', impactScore: 80 }],
      ovTop3: [{ id: 'rec-b', title: 'OV chose B', source: 'seo', impactScore: 95 }],
      perRecDelta: [
        { id: 'rec-a', legacy: 80, ov: 50 },
        { id: 'rec-b', legacy: 60, ov: 95 },
      ],
    }),
    makeRow({
      id: 'disagree-invariant-broken',
      agree: false,
      legacyTopRecId: 'rec-a',
      ovTopRecId: 'rec-c',
      invariantHeld: false,
      legacyTop3: [{ id: 'rec-a', title: 'Legacy chose A', source: 'seo', impactScore: 80 }],
      ovTop3: [{ id: 'rec-c', title: 'OV chose C', source: 'seo', impactScore: 70 }],
    }),
    makeRow({
      id: 'disagree-ov-null',
      agree: false,
      legacyTopRecId: 'rec-a',
      ovTopRecId: null,
      ovTopConfidence: null,
      ovTopEmv: null,
      ovTopGroundedSpine: null,
      legacyTop3: [{ id: 'rec-a', title: 'Legacy chose A', source: 'seo', impactScore: 80 }],
      ovTop3: [],
    }),
  ];
}

function makeResponse(rows: OvDivergence[]): OvDivergenceListResponse {
  return { workspaceId: 'ws-1', rows, count: rows.length };
}

beforeEach(() => {
  vi.clearAllMocks();
  hookResult = { data: undefined, isLoading: false, isError: false, refetch };
});

// ── Tests ────────────────────────────────────────────────────────────────────
describe('OvDivergencePanel', () => {
  it('renders the agree-rate headline, red-flag counts and disagreement list', () => {
    hookResult = { data: makeResponse(mixedRows()), isLoading: false, isError: false, refetch };
    render(<OvDivergencePanel workspaceId="ws-1" defaultCollapsed={false} />);

    // Agree-rate headline: 3 of 6 = 50%
    expect(
      screen.getByText(/OV agrees with legacy in 3 of 6 recent generations \(50%\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('3 / 6')).toBeInTheDocument();

    // Red-flag counts: 1 invariant-broken, 1 OV-null (both via stat bar + sentence)
    expect(screen.getByText(/1 invariant-broken \(red flag\)/i)).toBeInTheDocument();
    expect(screen.getByText(/1 with no OV pick \(red flag\)/i)).toBeInTheDocument();

    // Disagreement list — 3 disagreements (clean, invariant-broken, ov-null)
    expect(screen.getByText(/Disagreements \(3\)/i)).toBeInTheDocument();
    expect(screen.getByText('OV chose B')).toBeInTheDocument();
    expect(screen.getByText('OV chose C')).toBeInTheDocument();
    // OV-null row shows the "OV no pick" red flag
    expect(screen.getAllByText('OV no pick').length).toBeGreaterThan(0);

    // invariant indicators present for held + broken rows
    expect(screen.getAllByText('invariant held').length).toBeGreaterThan(0);
    expect(screen.getByText('invariant broken')).toBeInTheDocument();
  });

  it('expands a disagreement row to reveal top-3 columns and per-rec deltas', () => {
    hookResult = { data: makeResponse(mixedRows()), isLoading: false, isError: false, refetch };
    render(<OvDivergencePanel workspaceId="ws-1" defaultCollapsed={false} />);

    // The clean disagreement row's expandable trigger.
    const trigger = screen.getByText('OV chose B').closest('button');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);

    expect(screen.getByText('Legacy top 3')).toBeInTheDocument();
    expect(screen.getByText('OV top 3')).toBeInTheDocument();
    expect(screen.getByText(/Per-rec score: legacy → OV/i)).toBeInTheDocument();
    // perRecDelta legacy → OV rendering for rec-b (60 → 95)
    expect(screen.getByText('60 → 95')).toBeInTheDocument();
  });

  it('shows a friendly message when there are no disagreements', () => {
    const allAgree = [
      makeRow({ id: 'a1', agree: true }),
      makeRow({ id: 'a2', agree: true }),
    ];
    hookResult = { data: makeResponse(allAgree), isLoading: false, isError: false, refetch };
    render(<OvDivergencePanel workspaceId="ws-1" defaultCollapsed={false} />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText(/Disagreements \(0\)/i)).toBeInTheDocument();
    expect(
      screen.getByText(/OV agreed with legacy on every recent generation/i),
    ).toBeInTheDocument();
  });

  it('renders the loading state', () => {
    hookResult = { data: undefined, isLoading: true, isError: false, refetch };
    render(<OvDivergencePanel workspaceId="ws-1" defaultCollapsed={false} />);
    expect(screen.getByText(/Loading OV divergence shadow log/i)).toBeInTheDocument();
  });

  it('renders the error state with a retry action', () => {
    hookResult = { data: undefined, isLoading: false, isError: true, refetch };
    render(<OvDivergencePanel workspaceId="ws-1" defaultCollapsed={false} />);

    expect(screen.getByText(/Couldn't load OV divergence/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state when no rows have been recorded', () => {
    hookResult = { data: makeResponse([]), isLoading: false, isError: false, refetch };
    render(<OvDivergencePanel workspaceId="ws-1" defaultCollapsed={false} />);
    expect(screen.getByText(/No divergence recorded yet/i)).toBeInTheDocument();
  });

  it('is collapsed by default and toggles open via the Show control', () => {
    hookResult = { data: makeResponse(mixedRows()), isLoading: false, isError: false, refetch };
    render(<OvDivergencePanel workspaceId="ws-1" />);

    // Collapsed: headline sentence not shown, summary copy is.
    expect(screen.queryByText(/OV agrees with legacy in/i)).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /show/i });
    fireEvent.click(toggle);
    expect(screen.getByText(/OV agrees with legacy in 3 of 6/i)).toBeInTheDocument();
  });
});

// ── Hook wiring (query key + api wrapper) ──────────────────────────────────────
describe('useOvDivergence wiring', () => {
  it('uses the admin.ovDivergence query key and calls the api wrapper with limit 50', async () => {
    vi.resetModules();
    vi.doUnmock('../../src/hooks/admin/useOvDivergence');

    const listSpy = vi.fn().mockResolvedValue(makeResponse([]));
    vi.doMock('../../src/api/ovDivergence', () => ({
      ovDivergenceApi: { list: listSpy },
    }));

    const { renderHook, waitFor } = await import('@testing-library/react');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { createElement } = await import('react');
    const { useOvDivergence } = await import('../../src/hooks/admin/useOvDivergence');
    const { queryKeys } = await import('../../src/lib/queryKeys');

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useOvDivergence('ws-9'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // api wrapper called with workspaceId + limit 50
    expect(listSpy).toHaveBeenCalledWith('ws-9', 50, expect.anything());

    // the cached entry is keyed by the centralized admin.ovDivergence key
    const expectedKey = queryKeys.admin.ovDivergence('ws-9');
    expect(expectedKey).toEqual(['admin-ov-divergence', 'ws-9']);
    const cached = client.getQueryData(expectedKey);
    expect(cached).toEqual(makeResponse([]));
  });
});
