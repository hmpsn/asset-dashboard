import { useState } from 'react';
import { Inbox, ClipboardCheck, MessageSquare, FileText, PenLine, Layers, Flag, ExternalLink } from 'lucide-react';
import { EmptyState } from '../ui';
import { ApprovalsTab } from './ApprovalsTab';
import { RequestsTab } from './RequestsTab';
import { ContentTab } from './ContentTab';
import { ClientCopyReview } from './ClientCopyReview';
import type { Tier } from '../ui';
import type { ClientContentRequest, ClientRequest, ApprovalBatch } from './types';
import type { ContentPlanReviewCell, ApprovalPageKeyword } from '../../hooks/useClientData';
import { useBetaMode } from './BetaContext';
import { STUDIO_NAME } from '../../constants';
import { post } from '../../api/client';

type InboxFilter = 'all' | 'approvals' | 'requests' | 'copy' | 'content' | 'content-plan';

interface InboxTabProps {
  workspaceId: string;
  effectiveTier: Tier;
  // Approvals
  approvalBatches: ApprovalBatch[];
  approvalsLoading: boolean;
  pendingApprovals: number;
  setApprovalBatches: React.Dispatch<React.SetStateAction<ApprovalBatch[]>>;
  loadApprovals: (wsId: string) => void;
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
  // Shared
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  // Content Plan review cells
  contentPlanReviewCells?: ContentPlanReviewCell[];
  // Whether there are copy pipeline entries ready for review
  hasCopyEntries?: boolean;
  // Which section to show initially (for deep-linking from Overview actions)
  initialFilter?: InboxFilter;
  // Page keyword hints for approval card targeting chips (independent of seoClientView)
  pageMap?: ApprovalPageKeyword[];
}

export function InboxTab({
  workspaceId, effectiveTier,
  approvalBatches, approvalsLoading, pendingApprovals, setApprovalBatches, loadApprovals,
  requests, requestsLoading, clientUser, loadRequests,
  contentRequests, setContentRequests, briefPrice, fullPostPrice, fmtPrice, setPricingModal, pricingConfirming,
  setToast,
  contentPlanReviewCells = [],
  hasCopyEntries = false,
  initialFilter,
  pageMap,
}: InboxTabProps) {
  const betaMode = useBetaMode();
  const [filter, setFilter] = useState<InboxFilter>(initialFilter || 'all');
  const [flaggingCell, setFlaggingCell] = useState<string | null>(null);
  const [flagComment, setFlagComment] = useState('');
  const [flagSubmitting, setFlagSubmitting] = useState(false);

  const pendingRequests = requests.filter(r => r.status !== 'completed' && r.status !== 'closed').length;
  const contentReviews = contentRequests.filter(r => r.status === 'client_review').length;
  const planReviewCount = contentPlanReviewCells.length;

  const filters: { id: InboxFilter; label: string; icon: typeof Inbox; count?: number }[] = [
    { id: 'all', label: 'All', icon: Inbox },
    { id: 'approvals', label: 'SEO Changes', icon: ClipboardCheck, count: pendingApprovals || undefined },
    { id: 'requests', label: 'Requests', icon: MessageSquare, count: pendingRequests || undefined },
    ...(hasCopyEntries ? [{ id: 'copy' as InboxFilter, label: 'Copy Review', icon: PenLine }] : []),
    ...(!betaMode ? [{ id: 'content' as InboxFilter, label: 'Content', icon: FileText, count: contentReviews || undefined }] : []),
    ...(planReviewCount > 0 ? [{ id: 'content-plan' as InboxFilter, label: 'Content Plan', icon: Layers, count: planReviewCount }] : []),
  ];

  const showApprovals = filter === 'all' || filter === 'approvals';
  const showRequests = filter === 'all' || filter === 'requests';
  const showCopy = filter === 'all' || filter === 'copy';
  const showContent = !betaMode && (filter === 'all' || filter === 'content');
  const showContentPlan = filter === 'all' || filter === 'content-plan';

  const handleFlagCell = async (cell: ContentPlanReviewCell) => {
    if (!flagComment.trim()) return;
    setFlagSubmitting(true);
    try {
      await post(`/api/public/content-plan/${workspaceId}/${cell.matrixId}/cells/${cell.cellId}/flag`, { comment: flagComment.trim() });
      setToast({ message: 'Feedback submitted — your team will review it.', type: 'success' });
      setFlaggingCell(null);
      setFlagComment('');
    } catch (err) {
      console.error('InboxTab operation failed:', err);
      setToast({ message: 'Failed to submit feedback. Please try again.', type: 'error' });
    }
    setFlagSubmitting(false);
  };

  const hasApprovals = approvalBatches.length > 0;
  const hasRequests = requests.length > 0;
  const hasContent = contentRequests.length > 0 || effectiveTier !== 'free';

  return (
    <div className="space-y-8">
      {/* Header + filters */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Inbox className="w-5 h-5 text-teal-400" />
          <div>
            <h2 className="text-xl font-semibold text-zinc-100">Inbox</h2>
            <p className="text-sm text-zinc-500 mt-0.5">{betaMode ? 'SEO changes and requests — all in one place.' : 'SEO changes, requests, and content — all in one place.'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {filters.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 min-h-[44px] rounded-lg text-xs font-medium transition-colors ${
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
              {pendingApprovals > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">Waiting on you · {pendingApprovals}</span>}
              {pendingApprovals === 0 && approvalBatches.length > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">All reviewed</span>}
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
            pageMap={pageMap}
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
              {(() => {
                const awaitingReply = requests.filter(r => r.notes.length > 0 && r.notes[r.notes.length - 1].author === 'team' && r.status !== 'completed' && r.status !== 'closed').length;
                if (awaitingReply > 0) return <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">Team replied · {awaitingReply}</span>;
                if (pendingRequests > 0) return <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">In progress · {pendingRequests}</span>;
                return null;
              })()}
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

      {/* Copy pipeline review section */}
      {showCopy && hasCopyEntries && (
        <div>
          {filter === 'all' && (
            <div className="flex items-center gap-2 mb-3 mt-2">
              <PenLine className="w-4 h-4 text-teal-400" />
              <span className="text-sm font-medium text-zinc-300">Copy Review</span>
            </div>
          )}
          <ClientCopyReview workspaceId={workspaceId} />
        </div>
      )}

      {/* Content Plan review section */}
      {showContentPlan && planReviewCount > 0 && (
        <div>
          {filter === 'all' && (
            <div className="flex items-center gap-2 mb-3 mt-2">
              <Layers className="w-4 h-4 text-teal-400" />
              <span className="text-sm font-medium text-zinc-300">Content Plan</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">{planReviewCount} needs review</span>
            </div>
          )}
          <div className="space-y-2">
            {contentPlanReviewCells.map(cell => {
              const isFlagging = flaggingCell === cell.cellId;
              const isFlagged = cell.status === 'flagged';
              return (
                <div key={cell.cellId} className="bg-zinc-900 border border-zinc-800 overflow-hidden" style={{ borderRadius: '10px 24px 10px 24px' }}>
                  <div className="px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-zinc-200">{cell.targetKeyword}</span>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded border ${
                            isFlagged
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                              : 'bg-teal-500/10 border-teal-500/30 text-teal-400'
                          }`}>
                            {isFlagged ? 'Flagged' : 'Needs Review'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                          <span className="text-zinc-400">{cell.matrixName}</span>
                          {cell.plannedUrl && (
                            <span className="flex items-center gap-0.5 text-zinc-500">
                              <ExternalLink className="w-2.5 h-2.5" /> {cell.plannedUrl}
                            </span>
                          )}
                          {cell.variableValues && (
                            <span>{Object.values(cell.variableValues).join(' × ')}</span>
                          )}
                        </div>
                      </div>
                      {!isFlagged && !isFlagging && (
                        <button
                          onClick={() => setFlaggingCell(cell.cellId)}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-[11px] font-medium text-zinc-300 transition-colors"
                        >
                          <Flag className="w-3 h-3" /> Request Changes
                        </button>
                      )}
                    </div>
                    {isFlagging && (
                      <div className="mt-3 space-y-2">
                        <textarea
                          value={flagComment}
                          onChange={e => setFlagComment(e.target.value)}
                          placeholder="Describe what you'd like changed..."
                          rows={2}
                          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 resize-none"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleFlagCell(cell)}
                            disabled={flagSubmitting || !flagComment.trim()}
                            className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-[11px] font-medium transition-colors"
                          >
                            {flagSubmitting ? 'Submitting...' : 'Submit Feedback'}
                          </button>
                          <button
                            onClick={() => { setFlaggingCell(null); setFlagComment(''); }}
                            className="px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                          >Cancel</button>
                        </div>
                      </div>
                    )}
                    {isFlagged && (
                      <div className="mt-2 text-[11px] text-amber-400/70 flex items-center gap-1">
                        <Flag className="w-3 h-3" /> You've flagged this — your team is reviewing your feedback.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Content section */}
      {showContent && (hasContent || filter !== 'all') && (
        <div>
          {filter === 'all' && (
            <div className="flex items-center gap-2 mb-3 mt-2">
              <FileText className="w-4 h-4 text-teal-400" />
              <span className="text-sm font-medium text-zinc-300">Content</span>
              {contentReviews > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">Waiting on you · {contentReviews}</span>}
              {contentReviews === 0 && contentRequests.filter(r => r.status === 'in_progress' || r.status === 'approved').length > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">In progress</span>}
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
            setToast={setToast}
          />
        </div>
      )}

      {/* Empty state when filtered view has nothing */}
      {filter === 'approvals' && !hasApprovals && !approvalsLoading && (
        <EmptyState
          icon={ClipboardCheck}
          title="No SEO changes to review yet."
          description={`${STUDIO_NAME} will send proposed changes here for your approval. You'll get notified when something needs your attention.`}
          action={
            <button
              onClick={() => setFilter('requests')}
              className="mt-2 px-4 py-2 rounded-lg bg-teal-600/20 border border-teal-500/30 text-teal-400 text-xs font-medium hover:bg-teal-600/30 transition-colors"
            >
              Submit a Request Instead
            </button>
          }
        />
      )}
      {filter === 'content-plan' && planReviewCount === 0 && (
        <EmptyState icon={Layers} title="No content plan items to review." description="When your team sends content for review, items will appear here." />
      )}
      {filter === 'copy' && !hasCopyEntries && (
        <EmptyState icon={PenLine} title="No copy to review." description="Drafts and revisions will appear here as your team prepares them." />
      )}
      {filter === 'all' && !hasApprovals && !hasRequests && contentRequests.length === 0 && planReviewCount === 0 && !hasCopyEntries && !approvalsLoading && !requestsLoading && (
        <EmptyState
          icon={Inbox}
          title="Your inbox is empty."
          description={betaMode ? `SEO changes and requests will appear here as ${STUDIO_NAME} works on your site.` : `SEO changes, requests, and content items will appear here as ${STUDIO_NAME} works on your site.`}
          action={
            <button
              onClick={() => setFilter('requests')}
              className="mt-2 px-4 py-2 rounded-lg bg-teal-600/20 border border-teal-500/30 text-teal-400 text-xs font-medium hover:bg-teal-600/30 transition-colors"
            >
              Submit a Request
            </button>
          }
        />
      )}
    </div>
  );
}
