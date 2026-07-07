// @ds-rebuilt
import { Send } from 'lucide-react';
import { PendingApprovals } from '../PendingApprovals';
import { GroupBlock } from '../ui';

interface SeoEditorApprovalsPanelProps {
  workspaceId: string;
  refreshKey: number;
  onRetracted: () => void;
}

export function SeoEditorApprovalsPanel({
  workspaceId,
  refreshKey,
  onRetracted,
}: SeoEditorApprovalsPanelProps) {
  return (
    <GroupBlock
      title="Sent to client"
      meta="Pending SEO approval batches with reminder and retract controls."
      icon={Send}
      collapsible
      defaultOpen
    >
      <PendingApprovals
        workspaceId={workspaceId}
        nameFilter="SEO"
        refreshKey={refreshKey}
        onRetracted={onRetracted}
      />
    </GroupBlock>
  );
}
