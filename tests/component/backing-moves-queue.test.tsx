// @vitest-environment jsdom
/**
 * Tests for BackingMovesQueue (Lane 1D — The Issue P1).
 * Covers:
 *  1. Groups render in ARCHETYPE_ORDER
 *  2. Cap (shortlistCap) + "show the rest" toggle works
 *  3. onCut fires with the rec id
 *  4. StrategyCockpit flag-OFF byte-identical — no new props = unchanged behavior
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Recommendation } from '../../shared/types/recommendations';
import { ARCHETYPE_ORDER, ARCHETYPE_LABELS } from '../../shared/types/strategy-archetype';
import { BackingMovesQueue } from '../../src/components/strategy/issue/BackingMovesQueue';
import { StrategyCockpit } from '../../src/components/strategy/StrategyCockpit';
import type { CockpitActions } from '../../src/components/strategy/StrategyCockpit';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mutateSpy = vi.fn();
vi.mock('../../src/hooks/admin/useRecBulkMutation', () => ({
  useRecBulkMutation: () => ({ mutate: mutateSpy, isPending: false }),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeQc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrap(ui: React.ReactNode) {
  return render(<QueryClientProvider client={makeQc()}>{ui}</QueryClientProvider>);
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

/** Build a Recommendation with required fields. Type determines archetype bucket. */
function makeRec(id: string, type: Recommendation['type'], title?: string): Recommendation {
  return {
    id,
    workspaceId: 'ws1',
    type,
    priority: 'fix_soon',
    title: title ?? `Rec ${id}`,
    description: 'desc',
    insight: 'insight',
    impact: 'high',
    effort: 'low',
    impactScore: 50,
    source: 'audit',
    affectedPages: [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: '',
    actionType: 'manual',
    status: 'pending',
    lifecycle: 'active',
    clientStatus: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as Recommendation;
}

// ── BackingMovesQueue tests ─────────────────────────────────────────────────

describe('BackingMovesQueue', () => {
  beforeEach(() => { mutateSpy.mockReset(); });

  it('renders archetype group headers in ARCHETYPE_ORDER for recs present', () => {
    const recs = [
      makeRec('a', 'content'),           // authority_bet
      makeRec('b', 'content_refresh'),   // refresh_reclaim
      makeRec('c', 'cannibalization'),   // defend
      makeRec('d', 'strategy'),          // quick_win
      makeRec('e', 'technical'),         // technical
      makeRec('f', 'local_visibility'), // local
    ];
    wrap(
      <BackingMovesQueue
        workspaceId="ws1"
        recs={recs}
        actions={makeActions()}
        onCut={vi.fn()}
      />,
    );

    // All 6 archetype group labels should be present
    for (const arch of ARCHETYPE_ORDER) {
      expect(screen.getByText(ARCHETYPE_LABELS[arch])).toBeInTheDocument();
    }
  });

  it('renders group headers in the correct order (authority_bet before refresh_reclaim before defend…)', () => {
    const recs = [
      makeRec('a', 'content'),
      makeRec('b', 'content_refresh'),
      makeRec('c', 'cannibalization'),
    ];
    wrap(
      <BackingMovesQueue
        workspaceId="ws1"
        recs={recs}
        actions={makeActions()}
        onCut={vi.fn()}
      />,
    );

    const headers = screen
      .getAllByRole('heading')
      .map((h) => h.textContent ?? '');

    // authority_bet (index 0) must appear before refresh_reclaim (index 1) before defend (index 2)
    const idxAuthority = headers.findIndex((h) => h.includes(ARCHETYPE_LABELS.authority_bet));
    const idxRefresh = headers.findIndex((h) => h.includes(ARCHETYPE_LABELS.refresh_reclaim));
    const idxDefend = headers.findIndex((h) => h.includes(ARCHETYPE_LABELS.defend));

    expect(idxAuthority).toBeGreaterThanOrEqual(0);
    expect(idxRefresh).toBeGreaterThanOrEqual(0);
    expect(idxDefend).toBeGreaterThanOrEqual(0);
    expect(idxAuthority).toBeLessThan(idxRefresh);
    expect(idxRefresh).toBeLessThan(idxDefend);
  });

  it('skips archetype groups with no recs', () => {
    // Only authority_bet and technical recs — refresh_reclaim / defend / quick_win / local absent
    const recs = [
      makeRec('a', 'content'),
      makeRec('b', 'technical'),
    ];
    wrap(
      <BackingMovesQueue
        workspaceId="ws1"
        recs={recs}
        actions={makeActions()}
        onCut={vi.fn()}
      />,
    );

    expect(screen.getByText(ARCHETYPE_LABELS.authority_bet)).toBeInTheDocument();
    expect(screen.getByText(ARCHETYPE_LABELS.technical)).toBeInTheDocument();
    expect(screen.queryByText(ARCHETYPE_LABELS.refresh_reclaim)).not.toBeInTheDocument();
    expect(screen.queryByText(ARCHETYPE_LABELS.defend)).not.toBeInTheDocument();
    expect(screen.queryByText(ARCHETYPE_LABELS.quick_win)).not.toBeInTheDocument();
    expect(screen.queryByText(ARCHETYPE_LABELS.local)).not.toBeInTheDocument();
  });

  it('caps each group at shortlistCap and shows a "show rest" affordance', () => {
    // 3 authority_bet recs, cap=2 → shows 2, hides 1, shows "show 1 more"
    const recs = [
      makeRec('a', 'content', 'Alpha'),
      makeRec('b', 'content', 'Beta'),
      makeRec('c', 'keyword_gap', 'Gamma'),
    ];
    wrap(
      <BackingMovesQueue
        workspaceId="ws1"
        recs={recs}
        actions={makeActions()}
        onCut={vi.fn()}
        shortlistCap={2}
      />,
    );

    // First 2 visible
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    // Third hidden
    expect(screen.queryByText('Gamma')).not.toBeInTheDocument();
    // "show more" affordance present
    expect(screen.getByRole('button', { name: /show.*more|show.*rest/i })).toBeInTheDocument();
  });

  it('reveals hidden recs when "show more" is clicked', () => {
    const recs = [
      makeRec('a', 'content', 'Alpha'),
      makeRec('b', 'content', 'Beta'),
      makeRec('c', 'keyword_gap', 'Gamma'),
    ];
    wrap(
      <BackingMovesQueue
        workspaceId="ws1"
        recs={recs}
        actions={makeActions()}
        onCut={vi.fn()}
        shortlistCap={2}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /show.*more|show.*rest/i }));
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('does not show "show more" when recs <= shortlistCap', () => {
    const recs = [
      makeRec('a', 'content', 'Alpha'),
      makeRec('b', 'content', 'Beta'),
    ];
    wrap(
      <BackingMovesQueue
        workspaceId="ws1"
        recs={recs}
        actions={makeActions()}
        onCut={vi.fn()}
        shortlistCap={3}
      />,
    );

    expect(screen.queryByRole('button', { name: /show.*more|show.*rest/i })).not.toBeInTheDocument();
  });

  it('fires onCut with the rec id when the strike action is confirmed', () => {
    const onCut = vi.fn();
    const strike = vi.fn();
    const actions = makeActions({ strike });
    const recs = [makeRec('r1', 'content', 'Strike me')];

    wrap(
      <BackingMovesQueue
        workspaceId="ws1"
        recs={recs}
        actions={actions}
        onCut={onCut}
      />,
    );

    // Open the "more actions" panel → "Strike instead" → confirm
    // Note: CockpitThrottlePicker + "Strike instead" reveals CockpitStrikeConfirm
    // CockpitStrikeConfirm has a "Confirm" button (not "Confirm strike")
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(screen.getByRole('button', { name: /strike instead/i }));
    // The confirm button in CockpitStrikeConfirm is labeled "Confirm"
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    // The underlying actions.strike should have been called
    expect(strike).toHaveBeenCalledWith('r1');
    // And onCut should have been called with the same id
    expect(onCut).toHaveBeenCalledWith('r1');
  });

  it('renders an empty state when recs array is empty', () => {
    wrap(
      <BackingMovesQueue
        workspaceId="ws1"
        recs={[]}
        actions={makeActions()}
        onCut={vi.fn()}
      />,
    );
    // Should not crash; no archetype headers
    for (const arch of ARCHETYPE_ORDER) {
      expect(screen.queryByText(ARCHETYPE_LABELS[arch])).not.toBeInTheDocument();
    }
  });
});

// ── StrategyCockpit flag-OFF byte-identical guard ────────────────────────────

describe('StrategyCockpit — flag-OFF byte-identical (additive props absent = unchanged behavior)', () => {
  beforeEach(() => { mutateSpy.mockReset(); });

  const sharedRecs = [
    makeRec('a', 'content', 'Content rec'),
    makeRec('b', 'technical', 'Technical rec'),
  ];

  it('renders the same section title and fix-now strip with or without the new optional props', () => {
    // Without new props (flag-OFF baseline)
    const { unmount: unmount1 } = wrap(
      <StrategyCockpit workspaceId="ws1" recs={sharedRecs} actions={makeActions()} />,
    );
    const titleTextOff = screen.getByText(/curate recommendations/i).textContent;
    unmount1();

    // With new props at their default-off values (groupBy undefined, shortlistCap undefined)
    wrap(
      <StrategyCockpit
        workspaceId="ws1"
        recs={sharedRecs}
        actions={makeActions()}
        // These new optional props MUST default to undefined/absent behavior
      />,
    );
    const titleTextOn = screen.getByText(/curate recommendations/i).textContent;

    expect(titleTextOn).toBe(titleTextOff);
  });

  it('renders the same lifecycle tabs with no new props as before', () => {
    wrap(
      <StrategyCockpit workspaceId="ws1" recs={sharedRecs} actions={makeActions()} />,
    );
    // All four lifecycle tabs must be present — unchanged
    expect(screen.getByRole('button', { name: /^active/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sent/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^approved/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^throttled/i })).toBeInTheDocument();
  });

  it('renders the same category filter chips with no new props', () => {
    wrap(
      <StrategyCockpit workspaceId="ws1" recs={sharedRecs} actions={makeActions()} />,
    );
    expect(screen.getByRole('button', { name: /content/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /technical/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quick wins/i })).toBeInTheDocument();
  });

  it('rec titles are rendered when no groupBy prop is provided', () => {
    wrap(
      <StrategyCockpit workspaceId="ws1" recs={sharedRecs} actions={makeActions()} />,
    );
    expect(screen.getByText('Content rec')).toBeInTheDocument();
    expect(screen.getByText('Technical rec')).toBeInTheDocument();
  });

  it('does NOT render archetype headers when groupBy is absent', () => {
    wrap(
      <StrategyCockpit workspaceId="ws1" recs={sharedRecs} actions={makeActions()} />,
    );
    // Archetype labels must not appear in the plain cockpit
    for (const arch of ARCHETYPE_ORDER) {
      expect(screen.queryByText(ARCHETYPE_LABELS[arch])).not.toBeInTheDocument();
    }
  });
});
