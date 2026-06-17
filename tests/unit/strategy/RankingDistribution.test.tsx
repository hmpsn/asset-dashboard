import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RankingDistribution } from '../../../src/components/strategy/RankingDistribution';
import type { PageKeywordMap } from '../../../src/components/strategy/types';

const makePage = (path: string, position?: number): PageKeywordMap => ({
  pagePath: path,
  pageTitle: path,
  primaryKeyword: path,
  secondaryKeywords: [],
  currentPosition: position,
});

// Use distinct counts per tier so getByText won't find duplicates
const filteredPages = [
  makePage('/a', 1), makePage('/b', 2), makePage('/c', 3), // top3 = 3
  makePage('/d', 5), makePage('/e', 6), makePage('/f', 7), makePage('/g', 8), // top10 = 4
  makePage('/h', 12), makePage('/i', 15), // top20 = 2
  makePage('/j', 22), // beyond20 = 1
  makePage('/k'), makePage('/l'), makePage('/m'), makePage('/n'), makePage('/o'), // not ranking = 5
];
const top3Pages = filteredPages.slice(0, 3);
const top10Pages = filteredPages.slice(3, 7);
const top20Pages = filteredPages.slice(7, 9);
const beyond20Pages = filteredPages.slice(9, 10);
const rankedPages = [...top3Pages, ...top10Pages, ...top20Pages, ...beyond20Pages];

const baseProps = {
  filteredPageMap: filteredPages,
  ranked: rankedPages,
  top3: top3Pages,
  top10: top10Pages,
  top20: top20Pages,
  beyond20: beyond20Pages,
  notRankingCount: 5,
  intentCounts: {},
};

describe('RankingDistribution', () => {
  it('renders "Ranking Distribution" heading', () => {
    render(<RankingDistribution {...baseProps} />);
    expect(screen.getByText('Ranking Distribution')).toBeInTheDocument();
  });

  it('shows the five tier counts', () => {
    render(<RankingDistribution {...baseProps} />);
    // Each tier has a unique count — 3, 4, 2, 1, 5 — so getByText won't find duplicates
    expect(screen.getByText('3')).toBeInTheDocument(); // top3
    expect(screen.getByText('4')).toBeInTheDocument(); // top10
    expect(screen.getByText('2')).toBeInTheDocument(); // top20
    expect(screen.getByText('5')).toBeInTheDocument(); // notRankingCount
    // Labels
    expect(screen.getByText('Top 3')).toBeInTheDocument();
    expect(screen.getByText('4–10')).toBeInTheDocument();
    expect(screen.getByText('11–20')).toBeInTheDocument();
    expect(screen.getByText('20+')).toBeInTheDocument();
    expect(screen.getByText('Not ranking')).toBeInTheDocument();
  });

  it('renders intent-mix badges when Object.keys(intentCounts).length > 1', () => {
    const props = {
      ...baseProps,
      intentCounts: { commercial: 2, informational: 3 },
    };
    render(<RankingDistribution {...props} />);
    expect(screen.getByText('Search Intent Mix')).toBeInTheDocument();
    expect(screen.getByText('informational (3)')).toBeInTheDocument();
    expect(screen.getByText('commercial (2)')).toBeInTheDocument();
  });

  it('does not render intent-mix section when intentCounts has only one key', () => {
    const props = {
      ...baseProps,
      intentCounts: { commercial: 5 },
    };
    render(<RankingDistribution {...props} />);
    expect(screen.queryByText('Search Intent Mix')).not.toBeInTheDocument();
  });

  it('renders nothing when ranked is empty', () => {
    const props = {
      ...baseProps,
      ranked: [],
    };
    const { container } = render(<RankingDistribution {...props} />);
    expect(container.firstChild).toBeNull();
  });

  it('click-to-filter (Phase 4c): the 11–20 striking-distance row deep-links to the Hub when nav is provided', () => {
    const navigate = vi.fn();
    render(<RankingDistribution {...baseProps} workspaceId="ws1" navigate={navigate} />);
    const row = screen.getByText('11–20').closest('button');
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('seo-keywords'));
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('?tab=striking_distance'));
  });

  it('legacy parity: the 11–20 row is NOT a button without workspaceId/navigate', () => {
    render(<RankingDistribution {...baseProps} />);
    expect(screen.getByText('11–20').closest('button')).toBeNull();
  });
});
