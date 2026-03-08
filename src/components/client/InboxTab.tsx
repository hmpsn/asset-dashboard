import { useState } from 'react';
import { Inbox, ClipboardCheck, MessageSquare, FileText } from 'lucide-react';
import { ApprovalsTab } from './ApprovalsTab';
import { RequestsTab } from './RequestsTab';
import { ContentTab } from './ContentTab';
import type { Tier } from '../ui';
import type { ClientContentRequest, ClientRequest, ApprovalBatch, ClientTab } from './types';

type InboxFilter = 'all' | 'approvals' | 'requests' | 'content';

interface InboxTabProps {
  workspaceId: string;
  effectiveTier: Tier;
  // Approvals
  approvalBatches: ApprovalBatch[];
  approvalsLoading: boolean;
  pendingApprovals: number;
  setApprovalBatches: React.Dispatch<React.SetStateAction<ApprovalBatch[]>>;
  loadApprovals: (wsId: string) => Promise<void>;
  // Requests
  requests: ClientRequest[];
  requestsLoading: boolean;
  clientUser: { id: string; name: string; email: string; role: string } | null;
  loadRequests: (wsId: string) => void;
  // Content
  contentRequests: ClientContentRequest[];
  setContentRequests: React.Dispatch<React.SetStateAction<ClientContentRequest[]>>;
  briefPrice: number | null;
  fullPostPrice: number | null;
  fmtPrice: (n: number) => string;
  setPricingModal: (modal: {
    serviceType: 'brief_only' | 'full_post';
    topic: string;
    targetKeyword: string;
    intent?: string;
    priority?: string;
    rationale?: string;
    notes?: string;
    source: 'strategy' | 'client' | 'upgrade';
    upgradeReqId?: string;
    pageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
  } | null) => void;
  pricingConfirming: boolean;
  setTab: (t: ClientTab) => void;
  // Shared
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  // Which section to show initially (for deep-linking from Overview actions)
  initialFilter?: InboxFilter;
}

export function InboxTab({
  workspaceId, effectiveTier,
  approvalBatches, approvalsLoading, pendingApprovals, setApprovalBatches, loadApprovals,
  requests, requestsLoading, clientUser, loadRequests,
  contentRequests, setContentRequests, briefPrice, fullPostPrice, fmtPrice, setPricingModal, pricingConfirming, setTab,
  setToast,
  initialFilter,
}: InboxTabProps) {
  const [filter, setFilter] = useState<InboxFilter>(initialFilter || 'all');

  const pendingRequests = requests.filter(r => r.status !== 'completed' && r.status !== 'closed').length;
  const contentReviews = contentRequests.filter(r => r.status === 'client_review').length;

  const filters: { id: InboxFilter; label: string; icon: typeof Inbox; count?: number }[] = [
    { id: 'all', label: 'All', icon: Inbox },
    { id: 'approvals', label: 'SEO Changes', icon: ClipboardCheck, count: pendingApprovals || undefined },
    { id: 'requests', label: 'Requests', icon: MessageSquare, count: pendingRequests || undefined },
    { id: 'content', label: 'Content', icon: FileText, count: contentReviews || undefined },
  ];

  const showApprovals = filter === 'all' || filter === 'approvals';
  const showRequests = filter === 'all' || filter === 'requests';
  const showContent = filter === 'all' || filter === 'content';

  const hasApprovals = approvalBatches.length > 0;
  const hasRequests = requests.length > 0;
  const hasContent = contentRequests.length > 0 || effectiveTier !== 'free';

  return (
    <div className="space-y-5">
      {/* Header + filters */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Inbox className="w-5 h-5 text-teal-400" />
          <div>
            <h2 className="text-xl font-semibold text-zinc-100">Inbox</h2>
            <p className="text-sm text-zinc-500 mt-0.5">SEO changes, requests, and content — all in one place.</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {filters.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f.id
                  ? 'bg-teal-500/15 border border-teal-500/30 text-teal-300'
                  : 'bg-zinc-800/50 border border-zinc-800 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <f.icon className="w-3.5 h-3.5" />
              {f.label}
              {f.count && f.count > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-teal-500/20 text-teal-300">{f.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Approvals section */}
      {showApprovals && hasApprovals && (
        <div>
          {filter === 'all' && (
            <div className="flex items-center gap-2 mb-3">
              <ClipboardCheck className="w-4 h-4 text-teal-400" />
              <span className="text-sm font-medium text-zinc-300">SEO Changes</span>
              {pendingApprovals > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">{pendingApprovals} pending</span>}
            </div>
          )}
          <ApprovalsTab
            workspaceId={workspaceId}
            approvalBatches={approvalBatches}
            approvalsLoading={approvalsLoading}
            pendingApprovals={pendingApprovals}
            effectiveTier={effectiveTier}
            setApprovalBatches={setApprovalBatches}
            loadApprovals={loadApprovals}
            setToast={setToast}
          />
        </div>
      )}

      {/* Requests section */}
      {showRequests && (hasRequests || filter !== 'all') && (
        <div>
          {filter === 'all' && (
            <div className="flex items-center gap-2 mb-3 mt-2">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium text-zinc-300">Requests</span>
              {pendingRequests > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">{pendingRequests} active</span>}
            </div>
          )}
          <RequestsTab
            workspaceId={workspaceId}
            requests={requests}
            requestsLoading={requestsLoading}
            clientUser={clientUser}
            loadRequests={loadRequests}
            setToast={setToast}
          />
        </div>
      )}

      {/* Content section */}
      {showContent && (hasContent || filter !== 'all') && (
        <div>
          {filter === 'all' && (
            <div className="flex items-center gap-2 mb-3 mt-2">
              <FileText className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-medium text-zinc-300">Content</span>
              {contentReviews > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400">{contentReviews} to review</span>}
            </div>
          )}
          <ContentTab
            contentRequests={contentRequests}
            setContentRequests={setContentRequests}
            effectiveTier={effectiveTier}
            briefPrice={briefPrice}
            fullPostPrice={fullPostPrice}
            fmtPrice={fmtPrice}
            setPricingModal={setPricingModal}
            pricingConfirming={pricingConfirming}
            workspaceId={workspaceId}
            setTab={setTab}
            setToast={setToast}
          />
        </div>
      )}

      {/* Empty state when filtered view has nothing */}
      {filter === 'approvals' && !hasApprovals && !approvalsLoading && (
        <div className="text-center py-12">
          <ClipboardCheck className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-400">No SEO changes to review yet.</p>
          <p className="text-[11px] text-zinc-500 mt-1">Your team will send proposed changes here for your approval.</p>
        </div>
      )}
    </div>
  );
}
