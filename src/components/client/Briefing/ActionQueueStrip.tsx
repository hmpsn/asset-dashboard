// CLIENT-FACING
import { useNavigate } from 'react-router-dom';
import { Clipboard, Clock } from 'lucide-react';
import { clientPath } from '../../../routes';

/**
 * Phase 2.5b — stale-item escalation. The composer (T2.5b.10) computes
 * `staleCount` and `oldestDaysPending` from the raw pending data hooks
 * (approvals, content requests, replies, content-plan review cells) by
 * counting items where `Date.now() - createdAt > 7 days`. Both fields are
 * optional — when omitted (or when counts/days are zero) the strip behaves
 * exactly as in Phase 2 and no escalation pill renders.
 */
interface ActionQueueStripProps {
  workspaceId: string;
  betaMode: boolean;
  counts: {
    approvals: number;
    briefs: number;
    posts: number;
    replies: number;
    contentPlan: number;
  };
  /**
   * Total count of pending items aged > 7 days across all categories.
   * Drives the trailing "{N} urgent" escalation pill.
   */
  staleCount?: number;
  /**
   * Oldest pending item's age in whole days. Drives the "— {D}d pending"
   * suffix on the escalation pill. Only rendered when staleCount > 0.
   */
  oldestDaysPending?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_THRESHOLD_DAYS = 7;

/**
 * Helper for the composer (T2.5b.10) to compute stale counts from raw
 * createdAt timestamps. Returns:
 *   - staleCount: how many items have age > 7 days
 *   - oldestDaysPending: oldest item's age in whole days, or 0 if no items
 *
 * Pure function. No React state. Exported so the composer can centralise
 * the threshold (matches STALE_THRESHOLD_DAYS used by the strip itself).
 */
export function computeStaleness(
  createdAtTimestamps: number[],
  nowMs: number = Date.now(),
): { staleCount: number; oldestDaysPending: number } {
  if (createdAtTimestamps.length === 0) {
    return { staleCount: 0, oldestDaysPending: 0 };
  }
  const thresholdMs = STALE_THRESHOLD_DAYS * DAY_MS;
  let staleCount = 0;
  let oldestMs = nowMs;
  for (const ts of createdAtTimestamps) {
    const age = nowMs - ts;
    if (age > thresholdMs) staleCount += 1;
    if (ts < oldestMs) oldestMs = ts;
  }
  const oldestAge = nowMs - oldestMs;
  return {
    staleCount,
    oldestDaysPending: Math.floor(oldestAge / DAY_MS),
  };
}

/**
 * The `section` value MUST be a real `InboxFilter` value — see
 * `src/components/client/InboxTab.tsx` `type InboxFilter`. Briefs and posts
 * both land on the `content` filter (the Inbox doesn't separate the two);
 * replies land on `requests` (where team-note replies surface). Drift here
 * silently sends users to the default 'all' filter — covered by the
 * tab-deep-link-wiring contract test.
 */
interface Chip {
  count: number;
  label: string;
  section: 'approvals' | 'content' | 'requests' | 'content-plan';
}

/**
 * ActionQueueStrip — amber action-queue strip rendered above the magazine briefing.
 *
 * Surfaces 5 categories of pending items (approvals, briefs, posts, replies, content
 * plan pages) as clickable chips that deep-link into the Inbox sub-section. Renders
 * `null` when every count is zero so it disappears when there's nothing to act on.
 */
export function ActionQueueStrip({
  workspaceId,
  betaMode,
  counts,
  staleCount,
  oldestDaysPending,
}: ActionQueueStripProps) {
  const navigate = useNavigate();

  const chips: Chip[] = [];
  if (counts.approvals > 0) {
    chips.push({
      count: counts.approvals,
      label: counts.approvals === 1 ? 'approval' : 'approvals',
      section: 'approvals',
    });
  }
  if (counts.briefs > 0) {
    chips.push({
      count: counts.briefs,
      label: counts.briefs === 1 ? 'brief' : 'briefs',
      section: 'content',
    });
  }
  if (counts.posts > 0) {
    chips.push({
      count: counts.posts,
      label: counts.posts === 1 ? 'post' : 'posts',
      section: 'content',
    });
  }
  if (counts.replies > 0) {
    chips.push({
      count: counts.replies,
      label: counts.replies === 1 ? 'reply' : 'replies',
      section: 'requests',
    });
  }
  if (counts.contentPlan > 0) {
    chips.push({
      count: counts.contentPlan,
      label: counts.contentPlan === 1 ? 'page' : 'pages',
      section: 'content-plan',
    });
  }

  if (chips.length === 0) return null;

  // Phase 2.5b — escalation pill. Renders when ≥1 pending item is older than
  // 7 days. Brighter amber + clock icon distinguishes it from the regular
  // category chips. Clicking the pill routes to the approvals filter (the
  // most likely category to have aged items).
  const showEscalation = (staleCount ?? 0) > 0;
  const escalationLabel = showEscalation
    ? `${staleCount} urgent${oldestDaysPending && oldestDaysPending > 0 ? ` — ${oldestDaysPending}d pending` : ''}`
    : null;

  return (
    <div className="flex flex-row flex-wrap items-center gap-3 bg-amber-500/15 border border-amber-500/30 px-4 py-3 rounded-[var(--radius-xl)]">
      <Clipboard className="w-4 h-4 text-accent-warning flex-shrink-0" aria-hidden="true" />
      {chips.map((chip, idx) => (
        <button
          // index-based key because briefs/posts both target section='content'
          // — section alone is not unique once those two chips coexist.
          key={`${chip.section}-${idx}`}
          type="button"
          onClick={() => navigate(`${clientPath(workspaceId, 'inbox', betaMode)}?tab=${chip.section}`)}
          className="t-caption font-medium text-accent-warning hover:text-accent-warning transition-colors"
        >
          {chip.count} {chip.label}
        </button>
      ))}
      {showEscalation && escalationLabel && (
        <button
          type="button"
          onClick={() => navigate(`${clientPath(workspaceId, 'inbox', betaMode)}?tab=approvals`)}
          className="ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-pill)] bg-amber-500/30 border border-amber-400/50 t-caption-sm font-medium text-accent-warning hover:bg-amber-500/40 transition-colors"
          aria-label={`${staleCount} urgent items pending`}
        >
          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
          {escalationLabel}
        </button>
      )}
    </div>
  );
}
