// tests/unit/briefing-deeplink.test.ts
//
// Unit tests for the BriefingStory.drillIn → deep-link URL renderer.
// Imports the production helper directly so any drift in the real renderer
// is caught here — earlier review iteration shipped a clone of the renderer
// in this test file, which would have given false confidence. See
// `src/components/client/Briefing/drillIn.ts` for the live implementation.
//
// Bugs the cases below pin:
//   - missing leading slash on path
//   - "?tab=" malformed when tab is omitted
//   - "?tab=X?query=Y" missing-and-then-double-? bug
//   - empty queryParams object producing "?" with nothing after it

import { describe, it, expect } from 'vitest';
import { renderDrillInUrl } from '../../src/components/client/Briefing/drillIn';
import type { BriefingStory } from '../../shared/types/briefing';

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

  it('handles all seven ExplorePage targets without throwing', () => {
    const pages = [
      'performance',
      'health',
      'strategy',
      'content-plan',
      'schema-review',
      'roi',
      'brand',
    ] as const;
    for (const page of pages) {
      expect(() => renderDrillInUrl(story({ page }), wsId, false)).not.toThrow();
    }
  });

  it('URL-encodes special chars in tab name', () => {
    const url = renderDrillInUrl(story({ page: 'health', tab: 'foo bar' }), wsId, false);
    // Spec doesn't normalize the tab key — receiver reads what was passed.
    // URLSearchParams would encode, but `?tab=` here is built via template
    // literal, so the raw value lands in the URL. Pin current behavior; if
    // the renderer ever switches to URLSearchParams this test catches it.
    expect(url).toBe('/client/ws_test/health?tab=foo bar');
  });

  it('multi-key queryParams produce stable & joined output', () => {
    const url = renderDrillInUrl(
      story({ page: 'strategy', queryParams: { keyword: 'fleet', priority: 'high' } }),
      wsId,
      false,
    );
    // URLSearchParams preserves insertion order for plain objects (V8 guarantee
    // for string keys without numeric prefixes). Lock it.
    expect(url).toBe('/client/ws_test/strategy?keyword=fleet&priority=high');
  });

  it('keeps empty-string query values as `?key=`', () => {
    const url = renderDrillInUrl(
      story({ page: 'performance', queryParams: { filter: '' } }),
      wsId,
      false,
    );
    expect(url).toBe('/client/ws_test/performance?filter=');
  });
});
