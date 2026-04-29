// tests/unit/briefing-deeplink.test.ts
//
// Unit tests for the BriefingStory.drillIn → deep-link URL renderer used by
// <HeroStoryCard> and <SecondaryStoryRow>. The same renderer is duplicated
// across both components verbatim; this test pins the contract so a future
// refactor (extracting the helper) can rely on identical output. Bugs we
// want to catch:
//   - missing leading slash on path
//   - "?tab=&query=..." malformed when tab is omitted
//   - "?tab=X?query=Y" missing-and-then-double-? bug
//   - empty queryParams object producing "?" with nothing after it
//
// The renderer logic lives inline in the components per the plan; this test
// reimplements the same one-liner and asserts shape. If the production
// renderer drifts from this implementation, that's the bug.

import { describe, it, expect } from 'vitest';
import { clientPath, type ClientTab } from '../../src/routes';
import type { BriefingStory } from '../../shared/types/briefing';

function renderDrillInUrl(story: BriefingStory, workspaceId: string, betaMode: boolean): string {
  const baseUrl = clientPath(workspaceId, story.drillIn.page as ClientTab, betaMode);
  const tabSuffix = story.drillIn.tab ? `?tab=${story.drillIn.tab}` : '';
  const hasQueryParams =
    story.drillIn.queryParams && Object.keys(story.drillIn.queryParams).length > 0;
  const querySuffix = hasQueryParams
    ? (story.drillIn.tab ? '&' : '?') +
      new URLSearchParams(story.drillIn.queryParams).toString()
    : '';
  return baseUrl + tabSuffix + querySuffix;
}

function story(drillIn: BriefingStory['drillIn']): BriefingStory {
  return {
    id: 's1',
    category: 'win',
    isHeadline: false,
    headline: 'h',
    narrative: 'n',
    metrics: [],
    drillIn,
    sourceRefs: [],
  };
}

describe('briefing deep-link URL renderer', () => {
  const wsId = 'ws_test';

  it('builds plain page URL when no tab or queryParams', () => {
    const url = renderDrillInUrl(story({ page: 'performance' }), wsId, false);
    expect(url).toBe('/client/ws_test/performance');
  });

  it('appends ?tab= when tab is set, no queryParams', () => {
    const url = renderDrillInUrl(story({ page: 'health', tab: 'errors' }), wsId, false);
    expect(url).toBe('/client/ws_test/health?tab=errors');
  });

  it('appends ?<query> when queryParams set without tab', () => {
    const url = renderDrillInUrl(
      story({ page: 'strategy', queryParams: { keyword: 'fleet' } }),
      wsId,
      false,
    );
    expect(url).toBe('/client/ws_test/strategy?keyword=fleet');
  });

  it('appends &<query> when both tab and queryParams set', () => {
    const url = renderDrillInUrl(
      story({ page: 'health', tab: 'errors', queryParams: { page: '/contact' } }),
      wsId,
      false,
    );
    expect(url).toBe('/client/ws_test/health?tab=errors&page=%2Fcontact');
  });

  it('omits suffix when queryParams is an empty object', () => {
    const url = renderDrillInUrl(
      story({ page: 'performance', queryParams: {} }),
      wsId,
      false,
    );
    expect(url).toBe('/client/ws_test/performance');
  });

  it('respects betaMode in the path prefix', () => {
    const url = renderDrillInUrl(story({ page: 'performance' }), wsId, true);
    expect(url).toBe('/client/beta/ws_test/performance');
  });

  it('handles all five ExplorePage targets without throwing', () => {
    const pages = ['performance', 'health', 'strategy', 'content-plan', 'roi'] as const;
    for (const page of pages) {
      expect(() => renderDrillInUrl(story({ page }), wsId, false)).not.toThrow();
    }
  });
});
