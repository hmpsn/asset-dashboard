// @ds-rebuilt
import { ErrorBoundary } from '../ErrorBoundary';
import { WorkOrderPanel } from '../admin/WorkOrderPanel';

interface CockpitWorkOrderDrawerProps {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
}

export function CockpitWorkOrderDrawer({ open, workspaceId, onClose }: CockpitWorkOrderDrawerProps) {
  if (!open) return null;
  return (
    <ErrorBoundary label="Work Orders">
      <WorkOrderPanel workspaceId={workspaceId} onDismiss={onClose} />
    </ErrorBoundary>
  );
}
