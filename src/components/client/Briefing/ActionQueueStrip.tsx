// CLIENT-FACING
import { useNavigate } from 'react-router-dom';
import { Clipboard } from 'lucide-react';
import { clientPath } from '../../../routes';

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
export function ActionQueueStrip({ workspaceId, betaMode, counts }: ActionQueueStripProps) {
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

  return (
    <div className="flex flex-row flex-wrap items-center gap-3 bg-amber-500/15 border border-amber-500/30 px-4 py-3 rounded-[var(--radius-xl)]">
      <Clipboard className="w-4 h-4 text-amber-300 flex-shrink-0" aria-hidden="true" />
      {chips.map((chip, idx) => (
        <button
          // index-based key because briefs/posts both target section='content'
          // — section alone is not unique once those two chips coexist.
          key={`${chip.section}-${idx}`}
          type="button"
          onClick={() => navigate(`${clientPath(workspaceId, 'inbox', betaMode)}?tab=${chip.section}`)}
          className="t-caption font-medium text-amber-300 hover:text-amber-200 transition-colors"
        >
          {chip.count} {chip.label}
        </button>
      ))}
    </div>
  );
}
