// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DraftedPovEditor } from '../../src/components/strategy/issue/DraftedPovEditor';
import type { StrategyPov } from '../../shared/types/strategy-pov';

const POV: StrategyPov = {
  situation: 'Your site is gaining ground in mid-funnel queries.',
  leadMoveRecId: 'r1',
  leadSentence: 'The one move I would bring: ship the pricing-page authority bet.',
  wins: ['Two service pages broke into the top 5.'],
  flags: ['A competitor is closing on the comparison cluster.'],
  version: 0,
  generatedAt: '2026-06-19T00:00:00.000Z',
  editedAt: null,
};

describe('DraftedPovEditor', () => {
  beforeEach(() => cleanup());

  it('renders the drafted prose (situation, lead sentence, wins, flags)', () => {
    render(<DraftedPovEditor pov={POV} onEdit={vi.fn()} />);
    expect(screen.getByText(/gaining ground in mid-funnel/)).toBeTruthy();
    expect(screen.getByText(/ship the pricing-page authority bet/)).toBeTruthy();
    expect(screen.getByText(/broke into the top 5/)).toBeTruthy();
    expect(screen.getByText(/closing on the comparison cluster/)).toBeTruthy();
  });

  it('removes the lead sentence live when its originating rec id is cut (cut→sentence contract)', () => {
    const { rerender } = render(<DraftedPovEditor pov={POV} onEdit={vi.fn()} struckRecIds={[]} />);
    expect(screen.queryByText(/ship the pricing-page authority bet/)).toBeTruthy();

    // The backing card for r1 is cut — its sentence must disappear from the rendered prose.
    rerender(<DraftedPovEditor pov={POV} onEdit={vi.fn()} struckRecIds={['r1']} />);
    expect(screen.queryByText(/ship the pricing-page authority bet/)).toBeNull();
    // Non-rec-linked prose (situation/wins/flags) is untouched.
    expect(screen.queryByText(/gaining ground in mid-funnel/)).toBeTruthy();
  });

  it('renders nothing destructive when pov is null (loading/empty)', () => {
    const { container } = render(<DraftedPovEditor pov={null} onEdit={vi.fn()} />);
    // No crash; empty-state path renders.
    expect(container).toBeTruthy();
  });
});
