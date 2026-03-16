/**
 * ApprovalPanel — Approval workflow UI for SEO editor.
 * Extracted from SeoEditor.tsx approval button section.
 */
import { Loader2, Check, Send } from 'lucide-react';

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
    <button
      onClick={onSendApproval}
      disabled={sendingApproval || approvalSelected.size === 0}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        approvalSent ? 'bg-green-600 text-white' : 'bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white'
      }`}
    >
      {sendingApproval ? <Loader2 className="w-3 h-3 animate-spin" /> : approvalSent ? <Check className="w-3 h-3" /> : <Send className="w-3 h-3" />}
      {approvalSent ? 'Sent!' : sendingApproval ? 'Sending...' : `Send to Client (${approvalSelected.size})`}
    </button>
  );
}
