import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrategyStatGrid } from '../../../src/components/strategy/StrategyStatGrid';
import type { PageKeywordMap } from '../../../src/components/strategy/types';

const makePages = (overrides: Partial<PageKeywordMap>[] = []): PageKeywordMap[] =>
  overrides.map((o, i) => ({
    pagePath: `/page-${i}`,
    pageTitle: `Page ${i}`,
    primaryKeyword: `keyword-${i}`,
    secondaryKeywords: [],
    ...o,
  }));

describe('StrategyStatGrid', () => {
  it('renders the four StatCards with their labels', () => {
    const filteredPageMap = makePages([{}, {}]);
    const ranked = makePages([{ currentPosition: 3 }, { currentPosition: 7 }]);

    render(
      <StrategyStatGrid
        filteredPageMap={filteredPageMap}
        totalPageCount={3}
        totalImpressions={1000}
        totalClicks={50}
        ranked={ranked}
        avgPos={5.0}
      />
    );

    expect(screen.getByText('Pages Mapped')).toBeInTheDocument();
    expect(screen.getByText('Impressions')).toBeInTheDocument();
    expect(screen.getByText('Clicks')).toBeInTheDocument();
    expect(screen.getByText('Avg Position')).toBeInTheDocument();
  });

  it('renders Pages Mapped value from filteredPageMap.length', () => {
    const filteredPageMap = makePages([{}, {}, {}]);
    render(
      <StrategyStatGrid
        filteredPageMap={filteredPageMap}
        totalPageCount={5}
        totalImpressions={0}
        totalClicks={0}
        ranked={[]}
        avgPos={0}
      />
    );
    // filteredPageMap.length = 3
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows below-threshold sub when filteredPageMap.length < totalPageCount', () => {
    const filteredPageMap = makePages([{}]);
    render(
      <StrategyStatGrid
        filteredPageMap={filteredPageMap}
        totalPageCount={4}
        totalImpressions={0}
        totalClicks={0}
        ranked={[]}
        avgPos={0}
      />
    );
    expect(screen.getByText('3 below threshold')).toBeInTheDocument();
  });

  it('renders formatted Impressions and Clicks values', () => {
    const filteredPageMap = makePages([{}]);
    render(
      <StrategyStatGrid
        filteredPageMap={filteredPageMap}
        totalPageCount={1}
        totalImpressions={2500}
        totalClicks={125}
        ranked={[]}
        avgPos={0}
      />
    );
    expect(screen.getByText('2,500')).toBeInTheDocument();
    expect(screen.getByText('125')).toBeInTheDocument();
  });

  it('renders Avg Position with hash prefix when ranked pages exist', () => {
    const filteredPageMap = makePages([{}]);
    const ranked = makePages([{ currentPosition: 4 }]);
    render(
      <StrategyStatGrid
        filteredPageMap={filteredPageMap}
        totalPageCount={1}
        totalImpressions={100}
        totalClicks={10}
        ranked={ranked}
        avgPos={4.0}
      />
    );
    expect(screen.getByText('#4.0')).toBeInTheDocument();
    expect(screen.getByText('1 pages ranking')).toBeInTheDocument();
  });

  it('renders em-dash for Avg Position when no ranked pages', () => {
    const filteredPageMap = makePages([{}]);
    render(
      <StrategyStatGrid
        filteredPageMap={filteredPageMap}
        totalPageCount={1}
        totalImpressions={0}
        totalClicks={0}
        ranked={[]}
        avgPos={0}
      />
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('0 pages ranking')).toBeInTheDocument();
  });

  it('shows CTR sub when impressions > 0', () => {
    const filteredPageMap = makePages([{}]);
    render(
      <StrategyStatGrid
        filteredPageMap={filteredPageMap}
        totalPageCount={1}
        totalImpressions={1000}
        totalClicks={50}
        ranked={[]}
        avgPos={0}
      />
    );
    expect(screen.getByText('5.0% CTR')).toBeInTheDocument();
  });
});
