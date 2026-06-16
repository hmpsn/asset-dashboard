import { BacklinkProfile } from './BacklinkProfile';
import { CompetitiveIntel } from './CompetitiveIntel';
import type { AuthorityAndBacklinksProps } from './types';

/**
 * Reference-band-only merged "Authority & Backlinks" leaf (Phase 4). Replaces the two separate
 * Reference children (`backlink` + `competitive`) with one consolidated leaf: the backlink profile
 * above the competitive comparison. The competitive view runs in `variant="merged"`, which drops the
 * own-domain stat grid (it duplicated the backlink stats) and the embedded Keyword Gaps section
 * (deduped to the standalone CompetitorEvidence surface) and uses the corrected cache freshness label.
 *
 * Legacy (flag OFF) keeps standalone BacklinkProfile + CompetitiveIntel — this component is only
 * mounted in the bands Reference block.
 */
export function AuthorityAndBacklinks({ workspaceId, competitors, seoDataAvailable }: AuthorityAndBacklinksProps) {
  return (
    <div className="space-y-6">
      <BacklinkProfile workspaceId={workspaceId} />
      <CompetitiveIntel
        workspaceId={workspaceId}
        competitors={competitors}
        seoDataAvailable={seoDataAvailable}
        variant="merged"
      />
    </div>
  );
}
