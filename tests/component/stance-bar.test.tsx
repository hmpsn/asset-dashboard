/**
 * Component tests for StanceBar — the proportional segmented allocation bar
 * shown in "The Issue" admin cockpit (Phase 1 Lane A).
 *
 * Verifies:
 * - One segment per archetype that has a count > 0
 * - Cut/parked trailing note rendered when either > 0
 * - Legend labels present for populated archetypes
 * - Renders with no errors when all archetypes are zero
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Recommendation } from '../../shared/types/recommendations';
import { StanceBar } from '../../src/components/strategy/issue/StanceBar';
import { deriveStance } from '../../src/lib/recStance';

function makeRec(overrides: Partial<Recommendation>): Recommendation {
  return {
    id: `r-${Math.random()}`,
    workspaceId: 'ws1',
    priority: 'fix_now',
    type: 'content',
    title: 'Test rec',
    description: 'desc',
    insight: 'insight',
    impact: 'high',
    effort: 'medium',
    impactScore: 80,
    source: 'test',
    affectedPages: [],
    trafficAtRisk: 0,
    impressionsAtRisk: 0,
    estimatedGain: 'some',
    actionType: 'manual',
    status: 'pending',
    lifecycle: 'active',
    clientStatus: 'system',
    ...overrides,
  } as Recommendation;
}

describe('StanceBar', () => {
  it('renders one segment per archetype with count > 0 (via recs prop)', () => {
    const recs = [
      makeRec({ type: 'content', lifecycle: 'active' }),
      makeRec({ type: 'content_refresh', lifecycle: 'active' }),
      makeRec({ type: 'technical', lifecycle: 'active' }),
    ];
    const { container } = render(<StanceBar recs={recs} />);
    // 3 archetypes have >0 active recs: authority_bet, refresh_reclaim, technical
    const segments = container.querySelectorAll('[data-archetype]');
    expect(segments.length).toBe(3);
  });

  it('renders one segment per archetype with count > 0 (via stance prop)', () => {
    const recs = [
      makeRec({ type: 'content', lifecycle: 'active' }),
      makeRec({ type: 'cannibalization', lifecycle: 'active' }),
      makeRec({ type: 'local_visibility', lifecycle: 'active' }),
    ];
    const stance = deriveStance(recs);
    const { container } = render(<StanceBar stance={stance} />);
    const segments = container.querySelectorAll('[data-archetype]');
    expect(segments.length).toBe(3);
  });

  it('shows cut/parked trailing note when either > 0', () => {
    const recs = [
      makeRec({ type: 'content', lifecycle: 'active' }),
      makeRec({ type: 'schema', lifecycle: 'struck' }),
      makeRec({ type: 'content_refresh', lifecycle: 'throttled' }),
    ];
    render(<StanceBar recs={recs} />);
    expect(screen.getByTestId('stance-bar-cutparked')).toBeInTheDocument();
  });

  it('does not render cut/parked note when both are zero', () => {
    const recs = [
      makeRec({ type: 'content', lifecycle: 'active' }),
    ];
    render(<StanceBar recs={recs} />);
    expect(screen.queryByTestId('stance-bar-cutparked')).toBeNull();
  });

  it('renders legend labels for populated archetypes', () => {
    const recs = [
      makeRec({ type: 'content', lifecycle: 'active' }),   // authority_bet
      makeRec({ type: 'technical', lifecycle: 'active' }), // technical
    ];
    render(<StanceBar recs={recs} />);
    expect(screen.getByText('New authority bets')).toBeInTheDocument();
    expect(screen.getByText('Technical fixes')).toBeInTheDocument();
  });

  it('renders gracefully when all counts are zero (empty recs)', () => {
    const { container } = render(<StanceBar recs={[]} />);
    // No segments
    const segments = container.querySelectorAll('[data-archetype]');
    expect(segments.length).toBe(0);
    // Should still render container without throwing
    expect(container.firstChild).not.toBeNull();
  });
});
