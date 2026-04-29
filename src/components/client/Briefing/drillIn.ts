// CLIENT-FACING
// Shared deep-link URL renderer for `<HeroStoryCard>` and `<SecondaryStoryRow>`.
// Co-located with the components rather than in `src/lib/` because briefing is
// the only consumer of `BriefingDrillIn` today; promote when a 2nd subsystem
// adopts the same drill-in shape.

import { clientPath, type ClientTab } from '../../../routes';
import type { BriefingStory } from '../../../../shared/types/briefing';

/**
 * Build the client-side route URL a briefing story's "See the data →" button
 * navigates to. Combines `clientPath()` with the story's `drillIn.tab` and
 * `drillIn.queryParams` into a well-formed URL with correct `?` vs `&`
 * separators.
 *
 * Edge cases pinned by `tests/unit/briefing-deeplink.test.ts`:
 * - `tab` undefined or empty → no `?tab=` segment
 * - `queryParams` empty object → no query suffix
 * - both `tab` AND `queryParams` set → `?tab=X&...`
 * - betaMode flag → `/client/beta/...` prefix from `clientPath`
 *
 * `drillIn.page` is typed as `ExplorePage` (constrained subset) but
 * `clientPath` accepts the broader `ClientTab` — cast bridges the typed gap.
 */
export function renderDrillInUrl(
  story: BriefingStory,
  workspaceId: string,
  betaMode: boolean,
): string {
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
