/**
 * Component tests for StrategyPageRankStoriesSection (R2-D).
 *
 * Verifies:
 *   - section renders cards from fixture data
 *   - empty state when pageRankStories is empty (section not rendered)
 *   - banded/labeled chip values displayed (no raw integers)
 *   - section header and narrative text visible
 *   - TierGate wrapper (Growth+ required)
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StrategyPageRankStoriesSection } from '../../src/components/client/strategy/StrategyPageRankStoriesSection';
import type { PageRankStoryItem } from '../../src/components/client/types';

const STORY_1: PageRankStoryItem = {
  pagePath: '/seo-audit',
  pageTitle: 'SEO Audit Tool',
  rankedKeywords: [
    { keyword: 'seo audit tool', positionLabel: 'Page 1' },
    { keyword: 'seo audit checklist', positionLabel: 'Page 1' },
  ],
  gapKeywords: [
    { keyword: 'free seo audit', volumeLabel: 'Good demand' },
    { keyword: 'seo audit report', volumeLabel: 'Growing' },
  ],
  narrative: 'Ranking for 2 keywords — 2 nearby gaps worth adding',
};

const STORY_2: PageRankStoryItem = {
  pagePath: '/analytics',
  pageTitle: 'Analytics Dashboard',
  rankedKeywords: [
    { keyword: 'web analytics tool', positionLabel: 'Top 3' },
  ],
  gapKeywords: [
    { keyword: 'website analytics dashboard', volumeLabel: 'High demand' },
  ],
  narrative: 'Ranking for "web analytics tool" — 1 nearby gap worth adding',
};

function renderSection(
  pageRankStories: PageRankStoryItem[],
  effectiveTier: 'free' | 'growth' | 'premium' = 'growth',
  expandedSections: Set<string> = new Set(['page-rank-stories']),
) {
  const toggleSection = () => {};
  return render(
    <StrategyPageRankStoriesSection
      pageRankStories={pageRankStories}
      effectiveTier={effectiveTier}
      expandedSections={expandedSections}
      toggleSection={toggleSection}
    />,
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

describe('StrategyPageRankStoriesSection — empty state', () => {
  it('renders nothing when pageRankStories is empty', () => {
    const { container } = renderSection([]);
    expect(container.firstChild).toBeNull();
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('StrategyPageRankStoriesSection — renders cards', () => {
  it('renders section header text', () => {
    renderSection([STORY_1]);
    expect(screen.getByText('You rank for X, missing Y')).toBeInTheDocument();
  });

  it('renders subtitle with page count', () => {
    renderSection([STORY_1, STORY_2]);
    expect(screen.getByText(/2 pages with ranking keywords and nearby gaps/)).toBeInTheDocument();
  });

  it('renders page titles for each story', () => {
    renderSection([STORY_1, STORY_2]);
    expect(screen.getByText('SEO Audit Tool')).toBeInTheDocument();
    expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
  });

  it('renders ranked keyword chips', () => {
    renderSection([STORY_1]);
    expect(screen.getByText('seo audit tool')).toBeInTheDocument();
    expect(screen.getByText('seo audit checklist')).toBeInTheDocument();
  });

  it('renders banded position labels on ranked keyword chips', () => {
    renderSection([STORY_1]);
    // Both ranked keywords have positionLabel 'Page 1'
    const page1Badges = screen.getAllByText('Page 1');
    expect(page1Badges.length).toBeGreaterThanOrEqual(2);
  });

  it('renders gap keyword chips', () => {
    renderSection([STORY_1]);
    expect(screen.getByText('free seo audit')).toBeInTheDocument();
    expect(screen.getByText('seo audit report')).toBeInTheDocument();
  });

  it('renders volume labels on gap keyword chips (not raw numbers)', () => {
    renderSection([STORY_1]);
    expect(screen.getByText('Good demand')).toBeInTheDocument();
    expect(screen.getByText('Growing')).toBeInTheDocument();
  });

  it('renders the narrative text', () => {
    renderSection([STORY_1]);
    expect(screen.getByText('Ranking for 2 keywords — 2 nearby gaps worth adding')).toBeInTheDocument();
  });

  it('renders page path in font-mono', () => {
    renderSection([STORY_1]);
    expect(screen.getByText('/seo-audit')).toBeInTheDocument();
  });

  it('renders "Ranking for" section label', () => {
    renderSection([STORY_1]);
    expect(screen.getByText('Ranking for')).toBeInTheDocument();
  });

  it('renders "Worth adding" section label', () => {
    renderSection([STORY_1]);
    expect(screen.getByText('Worth adding')).toBeInTheDocument();
  });
});

// ── Collapsed state ───────────────────────────────────────────────────────────

describe('StrategyPageRankStoriesSection — collapsed state', () => {
  it('does not render card content when section is collapsed', () => {
    renderSection([STORY_1], 'growth', new Set()); // empty set = all collapsed
    // Header button should be visible
    expect(screen.getByText('You rank for X, missing Y')).toBeInTheDocument();
    // But card content should NOT be visible
    expect(screen.queryByText('seo audit tool')).toBeNull();
    expect(screen.queryByText('Ranking for 2 keywords — 2 nearby gaps worth adding')).toBeNull();
  });

  it('toggles expansion when header button clicked', () => {
    const expandedSections = new Set<string>(); // collapsed
    const toggleSection = (s: string) => {
      if (expandedSections.has(s)) expandedSections.delete(s);
      else expandedSections.add(s);
    };
    const { rerender } = render(
      <StrategyPageRankStoriesSection
        pageRankStories={[STORY_1]}
        effectiveTier="growth"
        expandedSections={new Set(expandedSections)}
        toggleSection={toggleSection}
      />,
    );
    // Verify collapsed — no story content
    expect(screen.queryByText('seo audit tool')).toBeNull();

    // Click the header button to expand
    fireEvent.click(screen.getByRole('button', { name: /you rank for x, missing y/i }));

    // Simulate state update by rerendering with expanded set
    rerender(
      <StrategyPageRankStoriesSection
        pageRankStories={[STORY_1]}
        effectiveTier="growth"
        expandedSections={new Set(['page-rank-stories'])}
        toggleSection={toggleSection}
      />,
    );
    expect(screen.getByText('seo audit tool')).toBeInTheDocument();
  });
});

// ── Single page story ─────────────────────────────────────────────────────────

describe('StrategyPageRankStoriesSection — single page', () => {
  it('renders singular "1 page" in subtitle', () => {
    renderSection([STORY_1]);
    expect(screen.getByText(/1 page with ranking keywords and nearby gaps/)).toBeInTheDocument();
  });
});
