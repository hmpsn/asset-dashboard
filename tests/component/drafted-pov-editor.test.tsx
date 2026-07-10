// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, cleanup, within } from '@testing-library/react';
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

  it('keeps the full editable composition as the default presentation', () => {
    render(<DraftedPovEditor pov={POV} onEdit={vi.fn()} onRegenerate={vi.fn()} />);

    expect(screen.getByText('Situation')).toBeInTheDocument();
    expect(screen.getByText("The one move I'd bring")).toBeInTheDocument();
    expect(screen.getByText('Wins worth saying')).toBeInTheDocument();
    expect(screen.getByText("What I'd flag")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit POV' })).not.toBeInTheDocument();
  });

  it('renders the Engine summary as two unlabeled truthful paragraphs with one Edit action', () => {
    const onOpenEditor = vi.fn();
    render(
      <DraftedPovEditor
        pov={POV}
        onEdit={vi.fn()}
        presentation="engine-summary"
        stagedCount={3}
        onOpenEditor={onOpenEditor}
      />,
    );

    const summary = screen.getByTestId('drafted-pov-summary');
    expect(summary.querySelectorAll('p')).toHaveLength(2);
    expect(within(summary).getByText(POV.situation)).toBeInTheDocument();
    expect(within(summary).getByText(POV.leadSentence)).toBeInTheDocument();
    expect(within(summary).queryByText('Situation')).not.toBeInTheDocument();
    expect(within(summary).queryByText('Wins worth saying')).not.toBeInTheDocument();
    expect(within(summary).queryByText(POV.wins[0])).not.toBeInTheDocument();
    expect(within(summary).queryByText(POV.flags[0])).not.toBeInTheDocument();
    expect(within(summary).getByText('Draft auto-generated from your 3 staged moves · edited by you before send')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit POV' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Edit POV' }));
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
  });

  it('removes a cut lead sentence from the Engine summary while retaining the situation', () => {
    render(
      <DraftedPovEditor
        pov={POV}
        onEdit={vi.fn()}
        presentation="engine-summary"
        stagedCount={1}
        struckRecIds={['r1']}
        onOpenEditor={vi.fn()}
      />,
    );

    expect(screen.getByText(POV.situation)).toBeInTheDocument();
    expect(screen.queryByText(POV.leadSentence)).not.toBeInTheDocument();
    expect(screen.getByTestId('drafted-pov-summary').querySelectorAll('p')).toHaveLength(1);
    expect(screen.getByText('Draft auto-generated from your 1 staged move · edited by you before send')).toBeInTheDocument();
  });

  it('offers a truthful Generate state when the Engine summary has no POV', () => {
    const onRegenerate = vi.fn();
    render(
      <DraftedPovEditor
        pov={null}
        onEdit={vi.fn()}
        presentation="engine-summary"
        stagedCount={0}
        onOpenEditor={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    );

    expect(screen.getByText('No point of view drafted yet')).toBeInTheDocument();
    expect(screen.getByText('Generate a point of view from the current strategy and staged moves.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit POV' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
