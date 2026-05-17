import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Inbox, Flag, ExternalLink, Check, Shield,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { Badge, Button, EmptyState, FormInput, FormTextarea, Icon, StatusBadge } from '../ui';
import { ApprovalBatchCard } from './ApprovalBatchCard';
import { ApprovalsTab } from './ApprovalsTab';
import { RequestsTab } from './RequestsTab';
import { ContentTab } from './ContentTab';
import { ClientCopyReview } from './ClientCopyReview';
import { SchemaReviewModal } from './SchemaReviewModal';
import { ClientActionDetailModal } from './ClientActionDetailModal';
import type { Tier } from '../ui';
import type { ClientContentRequest, ClientRequest, ApprovalBatch, ContentPlanReviewCell, ApprovalPageKeyword } from './types';
import type { SchemaSitePlan } from '../../../shared/types/schema-plan';
import { getOptional, patch, post } from '../../api/client';
import { useBetaMode } from './BetaContext';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { queryKeys } from '../../lib/queryKeys';
import type { ClientAction } from '../../../shared/types/client-actions';
import { DecisionCard } from './DecisionCard';
import { DecisionDetailModal } from './DecisionDetailModal';
import { normalizeClientAction } from '../../lib/decision-adapters';
import type { FlaggedItem } from '../../../shared/types/decision';
import { useInboxTabShell, type InboxMode } from './inbox/useInboxTabShell';
import type { InboxFilter } from './inbox/inbox-filter';
import { LegacyInboxLayout, NewInboxLayout } from './inbox/InboxTabLayouts';
export {
  INBOX_FILTER_VALUES,
  LEGACY_FILTER_MAP,
  isInboxFilter,
} from './inbox/inbox-filter';

interface InboxTabProps {
  workspaceId: string;
  effectiveTier: Tier;
  // Approvals
  approvalBatches: ApprovalBatch[];
  clientActions?: ClientAction[];
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
  clientActions = [],
}: InboxTabProps) {
  const queryClient = useQueryClient();
  // Two-halves deep-link contract — see CLAUDE.md UI/UX rule 11
  const [searchParams] = useSearchParams();
  const betaMode = useBetaMode();

  // Schema plan summary — drives SEO Changes card + priority strip item
  const schemaPlanQuery = useQuery({
    queryKey: queryKeys.client.schemaPlan(workspaceId),
    queryFn: () => getOptional<SchemaSitePlan>(`/api/public/schema-plan/${workspaceId}`),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
  const schemaPlan = schemaPlanQuery.data ?? null;
  const schemaPlanPending = schemaPlan?.status === 'sent_to_client';

  // Derived counts
  const requestReplies = requests.filter(
    r => r.notes.length > 0 && r.notes[r.notes.length - 1].author === 'team'
      && r.status !== 'completed' && r.status !== 'closed',
  ).length;
  const contentReviews = contentRequests.filter(
    r => r.status === 'client_review' || r.status === 'post_review',
  ).length;
  const planReviewCount = contentPlanReviewCells.length;
  const pendingClientActions = clientActions.filter(a => a.status === 'pending');
  const completedClientActions = clientActions.filter(a => a.status !== 'pending');

  const hasPendingApprovals = (pendingApprovals ?? 0) > 0;
  const hasPendingSeoChanges = hasPendingApprovals || schemaPlanPending;
  const hasNeedsAction = pendingClientActions.length > 0 || requestReplies > 0 || planReviewCount > 0;
  const copyReviewCount = hasCopyEntries ? 1 : 0;

  const shell = useInboxTabShell({
    currentTabParam: searchParams.get('tab'),
    betaMode,
    initialFilter,
    hasPendingSeoChanges,
  });
  const {
    filter,
    setFilter,
    mode,
    setMode,
    schemaModalOpen,
    setSchemaModalOpen,
    detailAction,
    setDetailAction,
    detailActionSubmitting,
    setDetailActionSubmitting,
    flaggingCell,
    setFlaggingCell,
    flagComment,
    setFlagComment,
    flagSubmitting,
    setFlagSubmitting,
    changeRequestAction,
    setChangeRequestAction,
    changeRequestNote,
    setChangeRequestNote,
    seoSectionExpanded,
    setSeoSectionExpanded,
    openDecision,
    setOpenDecision,
    decisionSubmitting,
    setDecisionSubmitting,
  } = shell;

  // Feature flag: new 3-section inbox IA layout
  const newInboxIa = useFeatureFlag('new-inbox-ia');

  // Routing: approval_batches split by note presence
  const approvalsForDecisions = approvalBatches.filter(b =>
    !b.note && b.items.some(i => i.status === 'pending'),
  );
  const approvalsForConversations = approvalBatches.filter(b =>
    !!b.note && b.items.some(i => i.status === 'pending'),
  );

  // NormalizedDecision lists for the Decisions section.
  // approval_batches without a note are rendered inline via ApprovalsTab (not DecisionCard),
  // so they are excluded here and inserted separately in the Decisions section below.
  const decisionItems = [
    ...pendingClientActions.map(a => normalizeClientAction(a)),
  ];

  // Filter chip counts
  const decisionsCount = decisionItems.length + planReviewCount + approvalsForDecisions.length;
  const reviewsCount = contentReviews + copyReviewCount + (!betaMode && schemaPlanPending ? 1 : 0);
  const conversationsCount = requestReplies + approvalsForConversations.length;

  const newInboxFilterChips: { id: InboxFilter; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'decisions', label: 'Decisions', count: decisionsCount || undefined },
    ...(!betaMode ? [{ id: 'reviews' as InboxFilter, label: 'Reviews', count: reviewsCount || undefined }] : []),
    { id: 'conversations', label: 'Conversations', count: conversationsCount || undefined },
  ];

  // Filter chips (hidden in completed mode)
  const legacyFilterChips: { id: InboxFilter; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'decisions', label: 'Decisions',
      count: (pendingClientActions.length + planReviewCount + (pendingApprovals ?? 0) + (schemaPlanPending ? 1 : 0)) || undefined },
    { id: 'conversations', label: 'Conversations',
      count: requestReplies || undefined },
    ...(!betaMode ? [{ id: 'reviews' as InboxFilter, label: 'Reviews',
      count: (contentReviews + copyReviewCount) || undefined }] : []),
  ];


  const respondToClientAction = async (actionId: string, status: 'approved' | 'changes_requested', clientNote?: string) => {
    try {
      await patch(`/api/public/client-actions/${workspaceId}/${actionId}/respond`, { status, clientNote });
      queryClient.invalidateQueries({ queryKey: queryKeys.client.clientActions(workspaceId) });
      setToast({ message: status === 'approved' ? 'Approved. Your team will handle implementation.' : 'Feedback sent to your team.', type: 'success' });
      setChangeRequestAction(null);
      setChangeRequestNote('');
    } catch (err) {
      setToast({ message: 'Failed to update action. Please try again.', type: 'error' });
      throw err;
    }
  };

  const handleFlagCell = async (cell: ContentPlanReviewCell) => {
    if (!flagComment.trim()) return;
    setFlagSubmitting(true);
    try {
      await post(`/api/public/content-plan/${workspaceId}/${cell.matrixId}/cells/${cell.cellId}/flag`, { comment: flagComment.trim() });
      queryClient.invalidateQueries({ queryKey: queryKeys.client.contentPlan(workspaceId) });
      setToast({ message: 'Feedback submitted — your team will review it.', type: 'success' });
      setFlaggingCell(null);
      setFlagComment('');
    } catch (err) {
      console.error('InboxTab operation failed:', err);
      setToast({ message: 'Failed to submit feedback. Please try again.', type: 'error' });
    } finally {
      setFlagSubmitting(false);
    }
  };

  const showSection1 = mode === 'active' && (filter === 'all' || filter === 'decisions' || filter === 'conversations');
  const showSection2 = mode === 'active' && (filter === 'all' || filter === 'decisions');
  const showSection3 = mode === 'active' && !betaMode && (filter === 'all' || filter === 'reviews');

  return (
    <div className="space-y-6">
      {/* ── Page header + mode toggle ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Icon as={Inbox} size="lg" className="text-accent-brand" />
          <div>
            <h2 className="t-h2 text-[var(--brand-text-bright)]">Inbox</h2>
            <p className="t-body text-[var(--brand-text-muted)] mt-0.5">
              {betaMode ? 'SEO changes and requests — all in one place.' : 'SEO changes, requests, and content — all in one place.'}
            </p>
          </div>
        </div>
        {/* Active / Completed toggle */}
        <div className="flex items-center gap-0.5 p-1 rounded-[var(--radius-lg)] bg-[var(--surface-3)] border border-[var(--brand-border)]">
          {(['active', 'completed'] as InboxMode[]).map((m) => (
            <Button
              key={m}
              variant="ghost"
              size="sm"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`px-3.5 py-1.5 rounded-[var(--radius-md)] t-caption-sm font-medium capitalize transition-colors ${
                mode === m
                  ? 'bg-[var(--surface-1)] text-[var(--brand-text-bright)] shadow-sm'
                  : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
              }`}
            >
              {m === 'active' ? 'Active' : 'Completed'}
            </Button>
          ))}
        </div>
      </div>

      {newInboxIa ? (
        /* === NEW 3-SECTION LAYOUT (flag: new-inbox-ia) === */
        <NewInboxLayout
          mode={mode}
          filter={filter}
          setFilter={setFilter}
          filterChips={newInboxFilterChips}
        >

          {/* ── Section: Decisions ── */}
          {mode === 'active' && (filter === 'all' || filter === 'decisions') && (
            <section aria-label="Decisions" className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Decisions</h3>
                {decisionsCount > 0 && (
                  <Badge label={`${decisionsCount} pending`} tone="amber" variant="outline" shape="pill" />
                )}
              </div>

              {decisionItems.length > 0 && (
                <div className="space-y-3">
                  {decisionItems.map(decision => (
                    <DecisionCard
                      key={decision.id}
                      decision={decision}
                      onOpen={() => setOpenDecision(decision)}
                      onApprove={decision.isSingleAction
                        ? () => respondToClientAction(decision.sourceId, 'approved').catch(() => {})
                        : undefined}
                      onFlagWithNote={decision.isSingleAction
                        ? (note) => respondToClientAction(decision.sourceId, 'changes_requested', note || undefined).catch(() => {})
                        : undefined}
                    />
                  ))}
                </div>
              )}

              {/* SEO title/meta approvals — one card per batch, inline in the Decisions flow */}
              {approvalsForDecisions.map(batch => (
                <ApprovalBatchCard
                  key={batch.id}
                  batch={batch}
                  workspaceId={workspaceId}
                  effectiveTier={effectiveTier}
                  setApprovalBatches={setApprovalBatches}
                  loadApprovals={loadApprovals}
                  setToast={setToast}
                  pageMap={pageMap}
                />
              ))}

              {/* Content Plan sign-offs */}
              {planReviewCount > 0 && (
                <div className="space-y-3">
                  <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Content Plan</p>
                  {contentPlanReviewCells.map(cell => {
                    const isFlagging = flaggingCell === cell.cellId;
                    const isFlagged = cell.status === 'flagged';
                    return (
                      // pr-check-disable-next-line -- Brand signature radius intentional
                      <div key={cell.cellId} className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
                        <div className="px-5 py-4">
                          <div className="flex items-center justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="t-caption font-medium text-[var(--brand-text)]">{cell.targetKeyword}</span>
                                <Badge
                                  label={isFlagged ? 'Flagged' : 'Needs Review'}
                                  tone={isFlagged ? 'amber' : 'teal'}
                                  variant="outline"
                                />
                              </div>
                              <div className="flex items-center gap-3 t-caption-sm text-[var(--brand-text-muted)]">
                                <span>{cell.matrixName}</span>
                                {cell.plannedUrl && (
                                  <span className="flex items-center gap-0.5">
                                    <Icon as={ExternalLink} size="xs" /> {cell.plannedUrl}
                                  </span>
                                )}
                                {cell.variableValues && Object.keys(cell.variableValues).length > 0 && (
                                  <span>{Object.values(cell.variableValues).join(' × ')}</span>
                                )}
                              </div>
                            </div>
                            {!isFlagged && !isFlagging && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setFlaggingCell(cell.cellId)}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption-sm font-medium text-[var(--brand-text)] transition-colors"
                              >
                                <Icon as={Flag} size="sm" /> Request Changes
                              </Button>
                            )}
                          </div>
                          {isFlagging && (
                            <div className="mt-3 space-y-2">
                              <FormTextarea
                                value={flagComment}
                                onChange={setFlagComment}
                                placeholder="Describe what you'd like changed..."
                                rows={2}
                                className="w-full t-caption placeholder:text-[var(--brand-text-muted)]"
                              />
                              <div className="flex items-center gap-2">
                                <Button size="sm" variant="primary" disabled={flagSubmitting || !flagComment.trim()} onClick={() => handleFlagCell(cell)}>
                                  {flagSubmitting ? 'Submitting…' : 'Submit Feedback'}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setFlaggingCell(null);
                                    setFlagComment('');
                                  }}
                                  className="px-3 py-1.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                                >
                                  Cancel
                                </Button>
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
              )}

              {betaMode && schemaPlan && (
                <div className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon as={Shield} size="sm" className="text-accent-brand" />
                        <span className="t-caption-sm font-medium text-accent-brand">Schema Strategy</span>
                        {schemaPlanPending && (
                          <Badge label="Awaiting review" tone="amber" variant="outline" />
                        )}
                      </div>
                      <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">
                        {schemaPlanPending
                          ? 'Your schema strategy is ready for your review and approval.'
                          : schemaPlan.status === 'client_approved' ? 'Approved — implementation in progress.'
                          : schemaPlan.status === 'active' ? 'Active schema strategy.'
                          : 'Schema strategy on file.'}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setSchemaModalOpen(true)}>
                      Review
                    </Button>
                  </div>
                </div>
              )}

              {decisionsCount === 0 && !approvalsLoading && (
                <p className="t-caption text-[var(--brand-text-muted)] py-2">All caught up — no decisions needed right now.</p>
              )}
            </section>
          )}

          {/* ── Section: Reviews ── */}
          {mode === 'active' && !betaMode && (filter === 'all' || filter === 'reviews') && (
            <section aria-label="Reviews" className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Reviews</h3>
                {reviewsCount > 0 && (
                  <Badge label={`${reviewsCount} needs review`} tone="blue" variant="outline" shape="pill" />
                )}
              </div>

              {/* Schema plan */}
              {schemaPlan && (
                <div className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon as={Shield} size="sm" className="text-accent-brand" />
                        <span className="t-caption-sm font-medium text-accent-brand">Schema Strategy</span>
                        {schemaPlanPending && (
                          <StatusBadge status={schemaPlan.status} domain="schema" variant="outline" shape="pill" />
                        )}
                      </div>
                      <h4 className="t-ui font-medium text-[var(--brand-text-bright)]">
                        Schema strategy — {schemaPlan.pageRoles.length} page{schemaPlan.pageRoles.length !== 1 ? 's' : ''}
                      </h4>
                      <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">
                        {schemaPlanPending
                          ? 'Your schema strategy is ready for your review and approval.'
                          : schemaPlan.status === 'client_approved' ? 'Approved — implementation in progress.'
                          : schemaPlan.status === 'active' ? 'Active schema strategy.'
                          : 'Schema strategy on file.'}
                      </p>
                    </div>
                    <Button size="sm" variant={schemaPlanPending ? 'primary' : 'ghost'} onClick={() => setSchemaModalOpen(true)}>
                      Review schema plan →
                    </Button>
                  </div>
                </div>
              )}
              {/* Copy review */}
              {hasCopyEntries && (
                <div className="space-y-2">
                  <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Copy Review</p>
                  <ClientCopyReview workspaceId={workspaceId} />
                </div>
              )}

              {/* Content pipeline */}
              <div className="space-y-2">
                <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Content Pipeline</p>
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
            </section>
          )}

          {/* ── Section: Conversations ── */}
          {mode === 'active' && (filter === 'all' || filter === 'conversations') && (
            <section aria-label="Conversations" className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Conversations</h3>
                {conversationsCount > 0 && (
                  <Badge label={`${conversationsCount} active`} tone="teal" variant="outline" shape="pill" />
                )}
              </div>
              <RequestsTab
                workspaceId={workspaceId}
                requests={requests}
                requestsLoading={requestsLoading}
                clientUser={clientUser}
                loadRequests={loadRequests}
                setToast={setToast}
              />
            </section>
          )}

          {/* ── Completed mode: history log (new layout) ── */}
          {mode === 'completed' && (
            <div className="space-y-6">
              <div className="space-y-4">
                <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Completed — SEO Changes</h3>
                {approvalBatches
                  .filter(b => b.items.length > 0 && b.items.every(i => i.status === 'applied'))
                  .map(batch => (
                    <ApprovalBatchCard
                      key={batch.id}
                      batch={batch}
                      workspaceId={workspaceId}
                      effectiveTier={effectiveTier}
                      setApprovalBatches={setApprovalBatches}
                      loadApprovals={loadApprovals}
                      setToast={setToast}
                      pageMap={pageMap}
                    />
                  ))}
              </div>
              {completedClientActions.length > 0 && (
                <div className="space-y-4">
                  <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Completed — Actions</h3>
                  {completedClientActions.map(action => (
                    <div key={action.id} className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4 opacity-70">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge label={action.sourceType.replace(/_/g, ' ')} tone="zinc" variant="outline" shape="pill" className="capitalize" />
                        {action.status === 'approved' || action.status === 'changes_requested' ? (
                          <StatusBadge status={action.status} domain="client-action" variant="outline" shape="pill" />
                        ) : (
                          <Badge label="Completed" tone="zinc" variant="outline" shape="pill" />
                        )}
                      </div>
                      <h4 className="t-ui font-medium text-[var(--brand-text)]">{action.title}</h4>
                    </div>
                  ))}
                </div>
              )}
              {completedClientActions.length === 0 && approvalBatches.filter(b => b.items.length > 0 && b.items.every(i => i.status === 'applied')).length === 0 && (
                <EmptyState
                  icon={Check}
                  title="No completed items yet"
                  description="Resolved approvals, actions, and requests will appear here."
                />
              )}
            </div>
          )}
        </NewInboxLayout>
      ) : (
        /* === EXISTING LAYOUT (flag off — do not modify) === */
        <LegacyInboxLayout
          mode={mode}
          filter={filter}
          setFilter={setFilter}
          filterChips={legacyFilterChips}
        >

          {/* ── Section 1: Needs Action & Requests ── */}
          {showSection1 && (
            <section aria-label="Needs Action & Requests" className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Needs Action &amp; Requests</h3>
                {hasNeedsAction && (
                  <Badge label={`${pendingClientActions.length + requestReplies + planReviewCount} pending`} tone="amber" variant="outline" shape="pill" />
                )}
              </div>

              {/* Client Action Cards */}
              {pendingClientActions.length > 0 && (
                <div className="space-y-3">
                  <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Action Items</p>
                  {pendingClientActions.map(action => (
                    <div key={action.id} className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge label={action.sourceType.replace(/_/g, ' ')} tone="zinc" variant="outline" shape="pill" className="capitalize" />
                            {action.priority === 'high' && (
                              <span className="t-caption-sm font-medium text-accent-warning">High priority</span>
                            )}
                          </div>
                          {/* duplicate-heading-ok -- repeated dynamic action title across queue/history sections */}
                          <h4 className="t-ui font-medium text-[var(--brand-text-bright)]">{action.title}</h4>
                          <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{action.summary}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        {action.sourceType === 'content_decay' ? (
                          <>
                            <Button size="sm" variant="primary" onClick={() => respondToClientAction(action.id, 'approved').catch(() => {})}>
                              Approve
                            </Button>
                            {changeRequestAction !== action.id ? (
                              <Button size="sm" variant="ghost" onClick={() => setChangeRequestAction(action.id)}>
                                Request changes
                              </Button>
                            ) : (
                              <div className="flex items-center gap-2 flex-1">
                                <FormInput
                                  type="text"
                                  value={changeRequestNote}
                                  onChange={setChangeRequestNote}
                                  placeholder="Add a note for your team…"
                                  className="flex-1 t-caption placeholder:text-[var(--brand-text-muted)] outline-none"
                                />
                                <Button size="sm" variant="primary" disabled={!changeRequestNote.trim()} onClick={() => respondToClientAction(action.id, 'changes_requested', changeRequestNote.trim()).catch(() => {})}>
                                  Send
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setChangeRequestAction(null); setChangeRequestNote(''); }}>
                                  Cancel
                                </Button>
                              </div>
                            )}
                          </>
                        ) : (
                          // Modal wired in Task 7 — button present, modal not yet mounted
                          <Button size="sm" variant="ghost" onClick={() => setDetailAction(action)}>
                            View details →
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Content Plan sign-offs */}
              {planReviewCount > 0 && (
                <div className="space-y-3">
                  <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Content Plan</p>
                  {contentPlanReviewCells.map(cell => {
                    const isFlagging = flaggingCell === cell.cellId;
                    const isFlagged = cell.status === 'flagged';
                    return (
                      // pr-check-disable-next-line -- Brand signature radius intentional
                      <div key={cell.cellId} className="bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
                        <div className="px-5 py-4">
                          <div className="flex items-center justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="t-caption font-medium text-[var(--brand-text)]">{cell.targetKeyword}</span>
                                <Badge
                                  label={isFlagged ? 'Flagged' : 'Needs Review'}
                                  tone={isFlagged ? 'amber' : 'teal'}
                                  variant="outline"
                                />
                              </div>
                              <div className="flex items-center gap-3 t-caption-sm text-[var(--brand-text-muted)]">
                                <span>{cell.matrixName}</span>
                                {cell.plannedUrl && (
                                  <span className="flex items-center gap-0.5">
                                    <Icon as={ExternalLink} size="xs" /> {cell.plannedUrl}
                                  </span>
                                )}
                                {cell.variableValues && Object.keys(cell.variableValues).length > 0 && (
                                  <span>{Object.values(cell.variableValues).join(' × ')}</span>
                                )}
                              </div>
                            </div>
                            {!isFlagged && !isFlagging && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setFlaggingCell(cell.cellId)}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-[var(--surface-3)] hover:bg-[var(--brand-border-hover)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption-sm font-medium text-[var(--brand-text)] transition-colors"
                              >
                                <Icon as={Flag} size="sm" /> Request Changes
                              </Button>
                            )}
                          </div>
                          {isFlagging && (
                            <div className="mt-3 space-y-2">
                              <FormTextarea
                                value={flagComment}
                                onChange={setFlagComment}
                                placeholder="Describe what you'd like changed..."
                                rows={2}
                                className="w-full t-caption placeholder:text-[var(--brand-text-muted)]"
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="primary"
                                  disabled={flagSubmitting || !flagComment.trim()}
                                  onClick={() => handleFlagCell(cell)}
                                >
                                  {flagSubmitting ? 'Submitting…' : 'Submit Feedback'}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => { setFlaggingCell(null); setFlagComment(''); }}
                                  className="px-3 py-1.5 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
                                >
                                  Cancel
                                </Button>
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
              )}

              {/* Requests */}
              <div className="space-y-3">
                <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Requests</p>
                <RequestsTab
                  workspaceId={workspaceId}
                  requests={requests}
                  requestsLoading={requestsLoading}
                  clientUser={clientUser}
                  loadRequests={loadRequests}
                  setToast={setToast}
                />
              </div>
            </section>
          )}

          {/* ── Section 2: SEO Changes ── */}
          {showSection2 && (
            <section aria-label="SEO Changes" className="space-y-4">
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-2 w-full text-left"
                aria-expanded={seoSectionExpanded}
                aria-controls="seo-changes-content"
                onClick={() => setSeoSectionExpanded(e => !e)}
              >
                <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">SEO Changes</h3>
                {hasPendingSeoChanges && (
                  <Badge label={`${(pendingApprovals ?? 0) + (schemaPlanPending ? 1 : 0)} pending`} tone="teal" variant="outline" shape="pill" />
                )}
                {!hasPendingSeoChanges && (
                  <span className="t-caption text-[var(--brand-text-muted)]">Nothing pending</span>
                )}
                <span className="ml-auto">
                  {seoSectionExpanded
                    ? <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)]" />
                    : <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)]" />}
                </span>
              </Button>

              {seoSectionExpanded && (
                <div id="seo-changes-content" className="space-y-4">
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

                  {schemaPlan && (
                    <div className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Icon as={Shield} size="sm" className="text-accent-brand" />
                            <span className="t-caption-sm font-medium text-accent-brand">Schema Strategy</span>
                            {schemaPlanPending && (
                              <StatusBadge status={schemaPlan.status} domain="schema" variant="outline" shape="pill" />
                            )}
                          </div>
                          {/* duplicate-heading-ok -- mirrored schema title across feature-flagged inbox layouts */}
                          <h4 className="t-ui font-medium text-[var(--brand-text-bright)]">
                            Schema strategy — {schemaPlan.pageRoles.length} page{schemaPlan.pageRoles.length !== 1 ? 's' : ''}
                          </h4>
                          <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">
                            {schemaPlanPending
                              ? 'Your schema strategy is ready for your review and approval.'
                              : schemaPlan.status === 'client_approved' ? 'Approved — implementation in progress.'
                              : schemaPlan.status === 'active' ? 'Active schema strategy.'
                              : 'Schema strategy on file.'}
                          </p>
                        </div>
                        <Button size="sm" variant={schemaPlanPending ? 'primary' : 'ghost'} onClick={() => setSchemaModalOpen(true)}>
                          Review schema plan →
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── Section 3: Content ── */}
          {showSection3 && (
            <section aria-label="Content" className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Content</h3>
                {(contentReviews + copyReviewCount) > 0 && (
                  <Badge label={`${contentReviews + copyReviewCount} needs review`} tone="blue" variant="outline" shape="pill" />
                )}
              </div>

              {hasCopyEntries && (
                <div className="space-y-2">
                  <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Copy Review</p>
                  <ClientCopyReview workspaceId={workspaceId} />
                </div>
              )}

              <div className="space-y-2">
                <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Pipeline</p>
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
            </section>
          )}

          {/* ── Completed mode: history log ── */}
          {mode === 'completed' && (
            <div className="space-y-6">
              <div className="space-y-4">
                {/* duplicate-heading-ok -- intentionally duplicated with new inbox layout while flag migration remains live */}
                <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Completed — SEO Changes</h3>
                <ApprovalsTab
                  workspaceId={workspaceId}
                  approvalBatches={approvalBatches.filter(b => b.items.length > 0 && b.items.every(i => i.status === 'applied'))}
                  approvalsLoading={approvalsLoading}
                  pendingApprovals={0}
                  effectiveTier={effectiveTier}
                  setApprovalBatches={setApprovalBatches}
                  loadApprovals={loadApprovals}
                  setToast={setToast}
                  pageMap={pageMap}
                />
              </div>
              {completedClientActions.length > 0 && (
                <div className="space-y-4">
                  {/* duplicate-heading-ok -- intentionally duplicated with new inbox layout while flag migration remains live */}
                  <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Completed — Actions</h3>
                  {completedClientActions.map(action => (
                    <div key={action.id} className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4 opacity-70">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge label={action.sourceType.replace(/_/g, ' ')} tone="zinc" variant="outline" shape="pill" className="capitalize" />
                        {action.status === 'approved' || action.status === 'changes_requested' ? (
                          <StatusBadge status={action.status} domain="client-action" variant="outline" shape="pill" />
                        ) : (
                          <Badge label="Completed" tone="zinc" variant="outline" shape="pill" />
                        )}
                      </div>
                      {/* duplicate-heading-ok -- repeated dynamic action title across queue/history sections */}
                      <h4 className="t-ui font-medium text-[var(--brand-text)]">{action.title}</h4>
                    </div>
                  ))}
                </div>
              )}
              {completedClientActions.length === 0 && approvalBatches.filter(b => b.items.length > 0 && b.items.every(i => i.status === 'applied')).length === 0 && (
                <EmptyState
                  icon={Check}
                  title="No completed items yet"
                  description="Resolved approvals, actions, and requests will appear here."
                />
              )}
            </div>
          )}
        </LegacyInboxLayout>
      )}

      {/* Schema Review Modal */}
      {schemaModalOpen && (
        <SchemaReviewModal
          workspaceId={workspaceId}
          setToast={setToast}
          onClose={() => setSchemaModalOpen(false)}
        />
      )}
      {/* DecisionDetailModal — trust-first full-screen approval for both client_actions and approval_batches */}
      {openDecision && (() => {
        const origAction = pendingClientActions.find(a => a.id === openDecision.sourceId);
        const origBatch = approvalsForDecisions.find(b => b.id === openDecision.sourceId);
        if (!origAction && !origBatch) return null;
        const originalData = origAction
          ? { type: 'client_action' as const, action: origAction }
          : { type: 'approval_batch' as const, batch: origBatch! };
        return (
          <DecisionDetailModal
            decision={openDecision}
            originalData={originalData}
            submitting={decisionSubmitting}
            onDismiss={() => setOpenDecision(null)}
            onApprove={async (flaggedItems: FlaggedItem[]) => {
              setDecisionSubmitting(true);
              try {
                if (originalData.type === 'client_action') {
                  const note = flaggedItems.length > 0
                    ? flaggedItems.map(f => `${f.itemId}: ${f.note || 'flagged'}`).join('; ')
                    : undefined;
                  await respondToClientAction(originalData.action.id, 'approved', note);
                } else {
                  const clientNote = flaggedItems.length > 0
                    ? `Flagged items: ${flaggedItems.map(f => `${f.itemId}: ${f.note || 'flagged'}`).join('; ')}`
                    : undefined;
                  await patch(`/api/public/approvals/${workspaceId}/${originalData.batch.id}/approve`, { clientNote });
                  setApprovalBatches(prev => prev.map(b => b.id === originalData.batch.id
                    ? { ...b, items: b.items.map(item => ({ ...item, status: 'approved' as const, clientNote })) }
                    : b,
                  ));
                  queryClient.invalidateQueries({ queryKey: queryKeys.client.approvals(workspaceId) });
                  setToast({ message: 'Approved. Your team will implement the changes.', type: 'success' });
                }
                setOpenDecision(null);
              } catch {
                setToast({ message: 'Failed to submit approval. Please try again.', type: 'error' });
                throw new Error('approval failed');
              } finally {
                setDecisionSubmitting(false);
              }
            }}
          />
        );
      })()}
      {/* Tier-3 Client Action Detail Modal (old layout only) */}
      {detailAction && (
        <ClientActionDetailModal
          action={detailAction}
          submitting={detailActionSubmitting}
          onApprove={async () => {
            setDetailActionSubmitting(true);
            try {
              await respondToClientAction(detailAction.id, 'approved');
              setDetailAction(null);
            } catch {
              // error already toasted in respondToClientAction; keep modal open for retry
            } finally {
              setDetailActionSubmitting(false);
            }
          }}
          onRequestChanges={async (note) => {
            setDetailActionSubmitting(true);
            try {
              await respondToClientAction(detailAction.id, 'changes_requested', note);
              setDetailAction(null);
            } catch {
              // error already toasted; keep modal open for retry
            } finally {
              setDetailActionSubmitting(false);
            }
          }}
          onClose={() => setDetailAction(null)}
        />
      )}
    </div>
  );
}
