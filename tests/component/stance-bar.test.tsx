/**
 * Component tests for StanceBar — the proportional segmented allocation bar
 * shown in "The Issue" admin cockpit (Phase 1 Lane A).
 *
 * Verifies:
 * - Four directly labeled prototype allocation groups
 * - Cut/parked trailing note rendered when either > 0
 * - Stable 34px bar height and percentages
 * - Renders all four groups when counts are zero
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
  it('rolls six recommendation archetypes into four directly labeled prototype allocations', () => {
    const recs = [
      makeRec({ type: 'content', lifecycle: 'active' }),
      makeRec({ type: 'strategy', lifecycle: 'active' }),
      makeRec({ type: 'content_refresh', lifecycle: 'active' }),
      makeRec({ type: 'cannibalization', lifecycle: 'active' }),
      makeRec({ type: 'technical', lifecycle: 'active' }),
      makeRec({ type: 'local_visibility', lifecycle: 'active' }),
    ];
    const { container } = render(<StanceBar recs={recs} />);

    const bar = screen.getByTestId('stance-allocation-bar');
    expect(bar).toHaveClass('sm:h-[34px]');
    expect(container.querySelectorAll('[data-stance-group]')).toHaveLength(4);
    expect(screen.getByText('Win demand 33%')).toBeInTheDocument();
    expect(screen.getByText('Protect 33%')).toBeInTheDocument();
    expect(screen.getByText('Technical 17%')).toBeInTheDocument();
    expect(screen.getByText('Local 17%')).toBeInTheDocument();
  });

  it('accepts a precomputed stance while retaining the four-group presentation', () => {
    const recs = [
      makeRec({ type: 'content', lifecycle: 'active' }),
      makeRec({ type: 'cannibalization', lifecycle: 'active' }),
      makeRec({ type: 'local_visibility', lifecycle: 'active' }),
    ];
    const stance = deriveStance(recs);
    const { container } = render(<StanceBar stance={stance} />);
    expect(container.querySelectorAll('[data-stance-group]')).toHaveLength(4);
    expect(screen.getByText('Win demand 33%')).toBeInTheDocument();
    expect(screen.getByText('Protect 33%')).toBeInTheDocument();
    expect(screen.getByText('Local 33%')).toBeInTheDocument();
  });

  it('uses move counts as the visual proportions and gives zero-count groups no bar width', () => {
    const { container } = render(<StanceBar recs={[
      makeRec({ type: 'content', lifecycle: 'active' }),
      makeRec({ type: 'strategy', lifecycle: 'active' }),
      makeRec({ type: 'technical', lifecycle: 'active' }),
    ]} />);

    const demand = container.querySelector<HTMLElement>('[data-stance-group="demand"]');
    const technical = container.querySelector<HTMLElement>('[data-stance-group="technical"]');
    const local = container.querySelector<HTMLElement>('[data-stance-group="local"]');
    expect(demand).toHaveStyle({ flexBasis: '0%', flexGrow: '2' });
    expect(technical).toHaveStyle({ flexBasis: '0%', flexGrow: '1' });
    expect(local).toHaveStyle({ flexBasis: '0%', flexGrow: '0' });
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

  it('renders gracefully when all counts are zero (empty recs)', () => {
    const { container } = render(<StanceBar recs={[]} />);
    expect(container.querySelectorAll('[data-stance-group]')).toHaveLength(4);
    expect(screen.getByText('Win demand 0%')).toBeInTheDocument();
    expect(screen.getByText('Protect 0%')).toBeInTheDocument();
    expect(screen.getByText('Technical 0%')).toBeInTheDocument();
    expect(screen.getByText('Local 0%')).toBeInTheDocument();
  });
});
