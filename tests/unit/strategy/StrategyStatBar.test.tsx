import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrategyStatBar } from '../../../src/components/strategy/StrategyStatBar';
import type { PageKeywordMap } from '../../../src/components/strategy/types';

const pages = (n: number) => Array.from({ length: n }, () => ({} as PageKeywordMap));

describe('StrategyStatBar (Phase 4c compact stat bar)', () => {
  it('renders the four metrics with values via CompactStatBar', () => {
    render(
      <StrategyStatBar
        filteredPageMap={pages(15)}
        totalPageCount={20}
        totalImpressions={1000}
        totalClicks={50}
        ranked={pages(12)}
        avgPos={8.5}
      />,
    );
    expect(screen.getByText('Pages Mapped')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('5 below threshold')).toBeInTheDocument();
    expect(screen.getByText('Impressions')).toBeInTheDocument();
    expect(screen.getByText('Clicks')).toBeInTheDocument();
    expect(screen.getByText('5.0% CTR')).toBeInTheDocument();
    expect(screen.getByText('Avg Position')).toBeInTheDocument();
    expect(screen.getByText('#8.5')).toBeInTheDocument();
    expect(screen.getByText('12 ranking')).toBeInTheDocument();
  });

  it('shows a dash for avg position when nothing ranks', () => {
    render(
      <StrategyStatBar filteredPageMap={pages(5)} totalPageCount={5} totalImpressions={0} totalClicks={0} ranked={pages(0)} avgPos={0} />,
    );
    expect(screen.queryByText('#0.0')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
