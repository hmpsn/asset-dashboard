import { type Tier } from '../ui';
import { ErrorBoundary } from '../ErrorBoundary';
import { ROIDashboard } from './ROIDashboard';

interface ResultsTabProps {
  workspaceId: string;
  tier: Tier;
}

/**
 * Client IA v2 P2: the promoted "Results" surface. A thin wrapper that renders the
 * existing {@link ROIDashboard} in its evergreen (dateless, no-rolling-window) form,
 * fenced behind an ErrorBoundary so a render failure stays contained to this tab.
 */
export function ResultsTab({ workspaceId, tier }: ResultsTabProps) {
  return (
    <ErrorBoundary label="Results">
      <ROIDashboard workspaceId={workspaceId} tier={tier} evergreen />
    </ErrorBoundary>
  );
}
