/**
 * ApprovalPanel — Approval workflow UI for SEO editor.
 * Extracted from SeoEditor.tsx approval button section.
 */
import { Check, Send } from 'lucide-react';
import { Button } from '../ui';

export interface ApprovalPanelProps {
  approvalSelected: Set<string>;
  sendingApproval: boolean;
  approvalSent: boolean;
  onSendApproval: () => void;
}

export function ApprovalPanel({
  approvalSelected, sendingApproval, approvalSent, onSendApproval,
}: ApprovalPanelProps) {
  return (
    <Button
      onClick={onSendApproval}
      disabled={sendingApproval || approvalSelected.size === 0}
      loading={sendingApproval}
      icon={approvalSent ? Check : Send}
      size="sm"
      variant={approvalSent ? 'secondary' : 'primary'}
      className={approvalSent ? 'rounded-[var(--radius-lg)] border-0 bg-emerald-600 hover:bg-emerald-500 text-white' : 'rounded-[var(--radius-lg)]'}
    >
      {approvalSent ? 'Sent!' : sendingApproval ? 'Sending...' : `Send to Client (${approvalSelected.size})`}
    </Button>
  );
}
