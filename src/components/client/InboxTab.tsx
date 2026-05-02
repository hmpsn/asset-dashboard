import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox, ClipboardCheck, MessageSquare, FileText, PenLine, Layers, Flag, ExternalLink } from 'lucide-react';
import { EmptyState, Icon} from '../ui';
import { ApprovalsTab } from './ApprovalsTab';
import { RequestsTab } from './RequestsTab';
import { ContentTab } from './ContentTab';
import { ClientCopyReview } from './ClientCopyReview';
import type { Tier } from '../ui';
import type { ClientContentRequest, ClientRequest, ApprovalBatch } from './types';
import type { ContentPlanReviewCell, ApprovalPageKeyword } from '../../hooks/useClientData';
import { STUDIO_NAME } from '../../constants';
import { post } from '../../api/client';
import { useBetaMode } from './BetaContext';

type InboxFilter = 'all' | 'approvals' | 'requests' | 'copy' | 'content' | 'content-plan';

const VALID_INBOX_FILTERS: readonly InboxFilter[] =
  ['all', 'approvals', 'requests', 'copy', 'content', 'content-plan'] as const;

function isInboxFilter(value: string | null): value is InboxFilter {
  return value !== null && (VALID_INBOX_FILTERS as readonly string[]).includes(value);
}

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
  /** When true (external billing), hide price chips on request/upgrade buttons. */
  hidePrices?: boolean;
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
  hidePrices = false,
  pageMap,
}: InboxTabProps) {
  // Two-halves deep-link contract — `<ActionQueueStrip>` (Phase 2 of
  // client-briefing-v2) navigates to `?tab=<InboxFilter>` to deep-link into
  // a specific filter. Without this `useSearchParams` reader the param would
  // be silently dropped and every chip click would land on 'all'. See
  // CLAUDE.md UI/UX rule 11 ("?tab= deep-link two-halves contract").
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState<InboxFilter>(() => {
    const param = searchParams.get('tab');
    if (isInboxFilter(param)) return param;
    return initialFilter || 'all';
  });
  const [flaggingCell, setFlaggingCell] = useState<string | null>(null);
  const [flagComment, setFlagComment] = useState('');
  const [flagSubmitting, setFlagSubmitting] = useState(false);
  const betaMode = useBetaMode();

  const pendingRequests = requests.filter(r => r.status !== 'completed' && r.status !== 'closed').length;
  const contentReviews = contentRequests.filter(
    r => r.status === 'client_review' || r.status === 'post_review',
  ).length;
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
          <Icon as={Inbox} size="lg" className="text-accent-brand" />
          <div>
            <h2 className="text-xl font-semibold text-[var(--brand-text)]">Inbox</h2>
            <p className="t-body text-[var(--brand-text-muted)] mt-0.5">{betaMode ? 'SEO changes and requests — all in one place.' : 'SEO changes, requests, and content — all in one place.'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {filters.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 min-h-[44px] rounded-[var(--radius-lg)] t-caption font-medium transition-colors ${
                filter === f.id
                  ? 'bg-teal-500/15 border border-teal-500/30 text-accent-brand'
                  : 'bg-[var(--surface-3)]/50 border border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]'
              }`}
            >
              <f.icon className="w-3.5 h-3.5" />
              {f.label}
              {f.count && f.count > 0 && (
                <span className="px-1.5 py-0.5 t-caption-sm font-bold rounded-[var(--radius-pill)] bg-teal-500/20 text-accent-brand">{f.count}</span>
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
              <Icon as={ClipboardCheck} size="md" className="text-accent-brand" />
              <span className="t-body font-medium text-[var(--brand-text)]">SEO Changes</span>
              {pendingApprovals > 0 && <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-amber-500/15 text-accent-warning border border-amber-500/20">Waiting on you · {pendingApprovals}</span>}
              {pendingApprovals === 0 && approvalBatches.length > 0 && <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-emerald-500/10 text-accent-success border border-emerald-500/20">All reviewed</span>}
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
              <Icon as={MessageSquare} size="md" className="text-accent-info" />
              <span className="t-body font-medium text-[var(--brand-text)]">Requests</span>
              {(() => {
                const awaitingReply = requests.filter(r => r.notes.length > 0 && r.notes[r.notes.length - 1].author === 'team' && r.status !== 'completed' && r.status !== 'closed').length;
                if (awaitingReply > 0) return <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-amber-500/15 text-accent-warning border border-amber-500/20">Team replied · {awaitingReply}</span>;
                if (pendingRequests > 0) return <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-blue-500/10 text-accent-info border border-blue-500/20">In progress · {pendingRequests}</span>;
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
              <Icon as={PenLine} size="md" className="text-accent-brand" />
              <span className="t-body font-medium text-[var(--brand-text)]">Copy Review</span>
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
              <Icon as={Layers} size="md" className="text-accent-brand" />
              <span className="t-body font-medium text-[var(--brand-text)]">Content Plan</span>
              <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-teal-500/10 text-accent-brand border border-teal-500/20">{planReviewCount} needs review</span>
            </div>
          )}
          <div className="space-y-2">
            {contentPlanReviewCells.map(cell => {
              const isFlagging = flaggingCell === cell.cellId;
              const isFlagged = cell.status === 'flagged';
              return ( // pr-check-disable-next-line -- Brand signature radius intentional
                <div key={cell.cellId} className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
                  <div className="px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="t-caption font-medium text-[var(--brand-text)]">{cell.targetKeyword}</span>
                          <span className={`t-caption-sm px-1.5 py-0.5 rounded border ${
                            isFlagged
                              ? 'bg-amber-500/10 border-amber-500/30 text-accent-warning'
                              : 'bg-teal-500/10 border-teal-500/30 text-accent-brand'
                          }`}>
                            {isFlagged ? 'Flagged' : 'Needs Review'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 t-caption-sm text-[var(--brand-text-muted)]">
                          <span className="text-[var(--brand-text-muted)]">{cell.matrixName}</span>
                          {cell.plannedUrl && (
                            <span className="flex items-center gap-0.5 text-[var(--brand-text-muted)]">
                              <Icon as={ExternalLink} size="xs" /> {cell.plannedUrl}
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
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption-sm font-medium text-[var(--brand-text)] transition-colors"
                        >
                          <Icon as={Flag} size="sm" /> Request Changes
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
                          className="w-full px-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] placeholder-[var(--brand-text-dim)] focus:outline-none focus:border-teal-500 resize-none"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleFlagCell(cell)}
                            disabled={flagSubmitting || !flagComment.trim()}
                            className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-[var(--radius-lg)] t-caption-sm font-medium transition-colors"
                          >
                            {flagSubmitting ? 'Submitting...' : 'Submit Feedback'}
                          </button>
                          <button
                            onClick={() => { setFlaggingCell(null); setFlagComment(''); }}
                            className="px-3 py-1.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                          >Cancel</button>
                        </div>
                      </div>
                    )}
                    {isFlagged && (
                      <div className="mt-2 t-caption-sm text-accent-warning flex items-center gap-1">
                        <Icon as={Flag} size="sm" /> You've flagged this — your team is reviewing your feedback.
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
              <Icon as={FileText} size="md" className="text-accent-brand" />
              <span className="t-body font-medium text-[var(--brand-text)]">Content</span>
              {contentReviews > 0 && <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-amber-500/15 text-accent-warning border border-amber-500/20">Waiting on you · {contentReviews}</span>}
              {contentReviews === 0 && contentRequests.filter(r => r.status === 'in_progress' || r.status === 'approved').length > 0 && <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-blue-500/10 text-accent-info border border-blue-500/20">In progress</span>}
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
            hidePrices={hidePrices}
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
              className="mt-2 px-4 py-2 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 text-accent-brand t-caption font-medium hover:bg-teal-600/30 transition-colors"
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
              className="mt-2 px-4 py-2 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 text-accent-brand t-caption font-medium hover:bg-teal-600/30 transition-colors"
            >
              Submit a Request
            </button>
          }
        />
      )}
    </div>
  );
}
