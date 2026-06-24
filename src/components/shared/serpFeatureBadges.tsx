import type { ReactNode } from 'react';

import { Badge } from '../ui';

/**
 * Shared SERP-feature badge rendering. Extracted from ContentGapRow so the keyword
 * command-center drawer (P6 national-serp-tracking) and the Strategy content-gap row
 * render an identical, ordered badge set from one source (UI rule #9 — extract shared
 * interaction patterns once 2+ components need them). Color law: SERP features are DATA
 * → blue tone (never an action color, never purple).
 */

const SERP_DESCRIPTIVE: Record<string, string> = {
  featured_snippet: 'Featured snippet',
  people_also_ask: 'People also ask',
  video: 'Video results',
  local_pack: 'Local results',
  ai_overview: 'AI Overview',
};

const SERP_EMOJI: Record<string, string> = {
  featured_snippet: '⬜ Snippet',
  people_also_ask: '❓ PAA',
  video: '▶ Video',
  local_pack: '📍 Local',
  ai_overview: '✨ AI Overview',
};

const SERP_PLAIN: Record<string, string> = {
  featured_snippet: 'Snippet',
  people_also_ask: 'PAA',
  video: 'Video',
  local_pack: 'Local',
  ai_overview: 'AI Overview',
};

/** Render the SERP-feature badges for the active label set, preserving order. */
export function serpBadges(serpFeatures: string[] | undefined, set: 'plain' | 'descriptive' | 'emoji'): ReactNode {
  if (!Array.isArray(serpFeatures) || serpFeatures.length === 0) return null;
  if (set === 'descriptive') {
    // Strategy-tab: maps every feature key (unknown keys fall through to the raw key).
    return (
      <>
        {serpFeatures.map((feat) => (
          <Badge key={feat} label={SERP_DESCRIPTIVE[feat] ?? feat} tone="blue" variant="outline" />
        ))}
      </>
    );
  }
  // admin (plain) + briefing (emoji): fixed ordered set, only the known keys.
  const labels = set === 'emoji' ? SERP_EMOJI : SERP_PLAIN;
  const order = ['featured_snippet', 'people_also_ask', 'video', 'local_pack', 'ai_overview'];
  return (
    <div className="flex flex-wrap gap-1">
      {order.map((key) =>
        serpFeatures.includes(key) ? (
          <Badge key={key} label={labels[key]} tone="blue" variant="outline" />
        ) : null,
      )}
    </div>
  );
}
