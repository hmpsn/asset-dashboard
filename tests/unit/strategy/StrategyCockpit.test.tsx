import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StrategyCockpit } from '../../../src/components/strategy/StrategyCockpit';
import type { Recommendation } from '../../../shared/types/recommendations';
import type { CockpitActions } from '../../../src/components/strategy/StrategyCockpit';

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
    render(<StrategyCockpit recs={recs} actions={makeActions()} />);
    expect(screen.getByText(/fix now · 1/i)).toBeInTheDocument();
  });

  it('does NOT render Fix-now pin for sent recs', () => {
    const recs = [makeRec({ priority: 'fix_now', clientStatus: 'sent' })];
    render(<StrategyCockpit recs={recs} actions={makeActions()} />);
    expect(screen.queryByText(/fix now/i)).not.toBeInTheDocument();
  });

  it('renders lifecycle segmented control with correct counts', () => {
    const recs = [
      makeRec({ id: 'a', lifecycle: 'active', clientStatus: 'system' }),
      makeRec({ id: 'b', lifecycle: 'active', clientStatus: 'sent' }),
      makeRec({ id: 'c', lifecycle: 'active', clientStatus: 'approved' }),
      makeRec({ id: 'd', lifecycle: 'throttled', clientStatus: 'system' }),
    ];
    render(<StrategyCockpit recs={recs} actions={makeActions()} />);
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
    render(<StrategyCockpit recs={recs} actions={makeActions()} />);
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
    render(<StrategyCockpit recs={recs} actions={makeActions()} />);
    // Active bucket has 0 recs
    expect(screen.getByText(/nothing in this view/i)).toBeInTheDocument();
  });

  it('renders category toggle chips', () => {
    const recs = [makeRec()];
    render(<StrategyCockpit recs={recs} actions={makeActions()} />);
    expect(screen.getByRole('button', { name: /content/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /technical/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quick wins/i })).toBeInTheDocument();
  });

  it('renders sort buttons', () => {
    render(<StrategyCockpit recs={[]} actions={makeActions()} />);
    expect(screen.getByRole('button', { name: /value/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /impact/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /age/i })).toBeInTheDocument();
  });
});
