// @ds-rebuilt
import { AiVisibilityPanel } from '../strategy/AiVisibilityPanel';
import { PageContainer, PageHeader } from '../ui';

interface AiVisibilitySurfaceProps {
  workspaceId: string;
}

const AI_VISIBILITY_SUBTITLE = 'Track how often AI answers mention the brand, how visibility is changing, and which sources earn citations.';

/**
 * Dedicated rebuilt-shell home for the established aggregate AI visibility read.
 * The production panel remains the single capability owner, so this surface does
 * not fork its query, score, trend, source-domain, or refresh-job behavior.
 */
export function AiVisibilitySurface({ workspaceId }: AiVisibilitySurfaceProps) {
  return (
    <PageContainer as="main" width="wide">
      <PageHeader
        title="AI Visibility"
        subtitle={AI_VISIBILITY_SUBTITLE}
        className="max-w-[760px]"
      />
      <AiVisibilityPanel workspaceId={workspaceId} />
    </PageContainer>
  );
}
