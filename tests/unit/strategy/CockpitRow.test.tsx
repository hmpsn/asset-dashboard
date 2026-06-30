import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CockpitRow } from '../../../src/components/strategy/CockpitRow';
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

describe('CockpitRow', () => {
  it('renders the rec title', () => {
    render(<CockpitRow rec={makeRec()} actions={makeActions()} />);
    expect(screen.getByText('Write the pricing post')).toBeInTheDocument();
  });

  it('shows Send + Fix + Park actions in idle state', () => {
    render(<CockpitRow rec={makeRec()} actions={makeActions()} />);
    expect(screen.getByRole('button', { name: /send to client/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^fix$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^park$/i })).toBeInTheDocument();
  });

  it('opens send panel when Send is clicked; Enter key fires send', () => {
    const actions = makeActions();
    render(<CockpitRow rec={makeRec()} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));
    // Send panel is open — textarea present
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
    // Enter triggers onSend
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(actions.send).toHaveBeenCalledWith('r1', undefined);
  });

  it('Esc on send panel cancels without firing send', () => {
    const actions = makeActions();
    render(<CockpitRow rec={makeRec()} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));
    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(actions.send).not.toHaveBeenCalled();
    // Back to idle: Send button visible again
    expect(screen.getByRole('button', { name: /send to client/i })).toBeInTheDocument();
  });

  it('shows throttle picker when Park is clicked', () => {
    render(<CockpitRow rec={makeRec()} actions={makeActions()} />);
    fireEvent.click(screen.getByRole('button', { name: /^park$/i }));
    expect(screen.getByText('7 days')).toBeInTheDocument();
    expect(screen.getByText('30 days')).toBeInTheDocument();
    expect(screen.getByText('90 days')).toBeInTheDocument();
  });

  it('fires throttle action with correct days', () => {
    const actions = makeActions();
    render(<CockpitRow rec={makeRec()} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: /^park$/i }));
    fireEvent.click(screen.getByRole('button', { name: /30 days/i }));
    expect(actions.throttle).toHaveBeenCalledWith('r1', 30);
  });

  it('shows strike confirm when "Strike instead" is clicked; requires second confirm', () => {
    const actions = makeActions();
    render(<CockpitRow rec={makeRec()} actions={actions} />);
    // Open throttle picker
    fireEvent.click(screen.getByRole('button', { name: /^park$/i }));
    // Click "Strike instead"
    fireEvent.click(screen.getByText(/strike instead/i));
    // Strike confirm panel shown — Confirm button present
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    // strike has NOT fired yet (arm-then-confirm)
    expect(actions.strike).not.toHaveBeenCalled();
    // Now confirm
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(actions.strike).toHaveBeenCalledWith('r1');
  });

  it('struck row shows Undo button (not Send/Fix/Park), is muted (opacity-60)', () => {
    const actions = makeActions();
    const { container } = render(
      <CockpitRow rec={makeRec({ lifecycle: 'struck' })} actions={actions} />,
    );
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send to client/i })).not.toBeInTheDocument();
    // muted class
    expect(container.firstChild).toHaveClass('opacity-60');
  });

  it('Undo calls unstrike', () => {
    const actions = makeActions();
    render(<CockpitRow rec={makeRec({ lifecycle: 'struck' })} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(actions.unstrike).toHaveBeenCalledWith('r1');
  });

  it('Fix calls fix action', () => {
    const actions = makeActions();
    render(<CockpitRow rec={makeRec()} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: /^fix$/i }));
    expect(actions.fix).toHaveBeenCalledWith('r1');
  });

  it('struck row does NOT use purple classes (Brand Law M4)', () => {
    const { container } = render(
      <CockpitRow rec={makeRec({ lifecycle: 'struck' })} actions={makeActions()} />,
    );
    expect(container.innerHTML).not.toMatch(/purple-|violet-/);
  });

  it('renders no selection checkbox when onToggleSelect is absent', () => {
    render(<CockpitRow rec={makeRec()} actions={makeActions()} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('renders a selection checkbox that toggles when onToggleSelect is provided', () => {
    const onToggleSelect = vi.fn();
    render(<CockpitRow rec={makeRec()} actions={makeActions()} selected={false} onToggleSelect={onToggleSelect} />);
    const checkbox = screen.getByRole('checkbox', { name: /select: write the pricing post/i });
    expect(checkbox).toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledWith('r1');
  });
});
