// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeywordGaps } from '../../../src/components/strategy/KeywordGaps';

const gaps = [
  { keyword: 'best crm software', volume: 1200, difficulty: 45, competitorPosition: 3, competitorDomain: 'rival.com' },
];
const kd = (n?: number) => (n && n < 50 ? 'text-emerald-400' : 'text-red-400');

describe('KeywordGaps — Create-brief affordance', () => {
  it('renders a Create-brief button per row and calls onCreateBrief with the keyword', () => {
    const onCreateBrief = vi.fn();
    render(<KeywordGaps keywordGaps={gaps} difficultyColor={kd} onCreateBrief={onCreateBrief} />);
    const btn = screen.getByRole('button', { name: 'Create brief' });
    fireEvent.click(btn);
    expect(onCreateBrief).toHaveBeenCalledWith('best crm software');
  });

  it('omits the Create-brief button when onCreateBrief is not provided (legacy byte-identical)', () => {
    render(<KeywordGaps keywordGaps={gaps} difficultyColor={kd} />);
    expect(screen.queryByRole('button', { name: 'Create brief' })).not.toBeInTheDocument();
    // The evidence surface itself still renders.
    expect(screen.getByText('Raw Competitor Evidence')).toBeInTheDocument();
  });
});
