import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Inbox, ClipboardCheck, MessageSquare, FileText, PenLine,
  Flag, ExternalLink, Check, Shield, Layers,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { Button, EmptyState, Icon } from '../ui';
import { ApprovalsTab } from './ApprovalsTab';
import { RequestsTab } from './RequestsTab';
import { ContentTab } from './ContentTab';
import { ClientCopyReview } from './ClientCopyReview';
import { SchemaReviewModal } from './SchemaReviewModal';
import { PriorityStrip } from './PriorityStrip';
import type { PriorityItem } from './PriorityStrip';
import type { Tier } from '../ui';
import type { ClientContentRequest, ClientRequest, ApprovalBatch, ContentPlanReviewCell, ApprovalPageKeyword } from './types';
import type { SchemaSitePlan } from '../../../shared/types/schema-plan';
import { getOptional, patch, post } from '../../api/client';
import { useBetaMode } from './BetaContext';
import { queryKeys } from '../../lib/queryKeys';
import type { ClientAction } from '../../../shared/types/client-actions';

export type InboxFilter = 'all' | 'needs-action' | 'seo-changes' | 'content';
/**
 * Controls the Active/Completed mode toggle in the inbox page header.
 * The 'completed' branch is implemented in Task 3 (core InboxTab restructure).
 */
export type InboxMode = 'active' | 'completed';

export const INBOX_FILTER_VALUES: readonly InboxFilter[] =
  ['all', 'needs-action', 'seo-changes', 'content'] as const;

/**
 * Maps legacy ?tab= deep-link values to their new canonical InboxFilter equivalents.
 * Allows backward-compat during the Phase 2B migration window when ActionQueueStrip
 * chip section values are updated. Also handles the 'completed' mode value which
 * was previously a filter chip but is now the Active/Completed mode toggle.
 */
export const LEGACY_FILTER_MAP: Record<string, InboxFilter> = {
  approvals: 'seo-changes',
  requests: 'needs-action',
  copy: 'content',
  'content-plan': 'needs-action',
  completed: 'all',   // completed is now a mode toggle, not a filter chip
};

export function isInboxFilter(value: string | null): value is InboxFilter {
  return value !== null && (INBOX_FILTER_VALUES as readonly string[]).includes(value);
}

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
  // betaMode must be declared before useState<InboxFilter> so the init closure can reference it
  const betaMode = useBetaMode();
  const [filter, setFilter] = useState<InboxFilter>(() => {
    const param = searchParams.get('tab');
    if (isInboxFilter(param)) {
      // When betaMode is active, Content section is unavailable — coerce to default
      if (param === 'content' && betaMode) return initialFilter ?? 'needs-action';
      return param;
    }
    if (param && LEGACY_FILTER_MAP[param]) return LEGACY_FILTER_MAP[param];
    return initialFilter ?? 'needs-action';
  });
  const [mode, setMode] = useState<InboxMode>('active');
  const [schemaModalOpen, setSchemaModalOpen] = useState(false);
  const [detailAction, setDetailAction] = useState<ClientAction | null>(null);
  const [flaggingCell, setFlaggingCell] = useState<string | null>(null);
  const [flagComment, setFlagComment] = useState('');
  const [flagSubmitting, setFlagSubmitting] = useState(false);
  const [changeRequestAction, setChangeRequestAction] = useState<string | null>(null);
  const [changeRequestNote, setChangeRequestNote] = useState('');
  // SEO Changes section collapses when nothing pending in active mode
  const [seoSectionExpanded, setSeoSectionExpanded] = useState(false);

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

  // Auto-expand SEO Changes when pending items appear, but allow manual collapse
  useEffect(() => {
    if (hasPendingSeoChanges) setSeoSectionExpanded(true);
  }, [hasPendingSeoChanges]);

  // Filter chips (hidden in completed mode)
  const filterChips: { id: InboxFilter; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'needs-action', label: 'Needs Action & Requests',
      count: (pendingClientActions.length + requestReplies + planReviewCount) || undefined },
    { id: 'seo-changes', label: 'SEO Changes',
      count: ((pendingApprovals ?? 0) + (schemaPlanPending ? 1 : 0)) || undefined },
    ...(!betaMode ? [{ id: 'content' as InboxFilter, label: 'Content',
      count: (contentReviews + copyReviewCount) || undefined }] : []),
  ];

  // Priority strip items (active mode only, ordered by urgency)
  const priorityItems: PriorityItem[] = [];
  // 1. Requests with team replies (most time-sensitive)
  for (const r of requests) {
    const lastNote = r.notes[r.notes.length - 1];
    if (lastNote?.author === 'team' && r.status !== 'completed' && r.status !== 'closed') {
      priorityItems.push({
        id: `request-${r.id}`,
        icon: MessageSquare,
        title: r.title,
        section: 'needs-action',
        ctaLabel: 'Reply →',
        onCta: () => setFilter('needs-action'),
      });
    }
  }
  // 2. Pending approval batches (team blocked)
  for (const b of approvalBatches.filter(b => b.items.some(i => i.status === 'pending' || !i.status))) {
    priorityItems.push({
      id: `batch-${b.id}`,
      icon: ClipboardCheck,
      title: b.name,
      section: 'seo-changes',
      ctaLabel: 'Review →',
      onCta: () => setFilter('seo-changes'),
    });
  }
  // 3. Schema plan pending initial feedback
  if (schemaPlanPending) {
    priorityItems.push({
      id: 'schema-plan',
      icon: Shield,
      title: 'Schema strategy ready for review',
      section: 'seo-changes',
      ctaLabel: 'Review →',
      onCta: () => setSchemaModalOpen(true),
    });
  }
  // 4. Pending client action cards
  for (const a of pendingClientActions) {
    priorityItems.push({
      id: `action-${a.id}`,
      icon: Flag,
      title: a.title,
      section: 'needs-action',
      ctaLabel: 'View →',
      // Modal wired in Task 7 — scroll to section until then
      onCta: () => setFilter('needs-action'),
    });
  }
  // 5. Content at review status
  for (const c of contentRequests.filter(r => r.status === 'client_review' || r.status === 'post_review')) {
    priorityItems.push({
      id: `content-${c.id}`,
      icon: FileText,
      title: c.topic || 'Content review',
      section: 'content',
      ctaLabel: 'Review →',
      onCta: () => setFilter('content'),
    });
  }
  // 6. Content plan cells at review
  for (const cell of contentPlanReviewCells) {
    priorityItems.push({
      id: `plan-${cell.cellId}`,
      icon: Layers,
      title: cell.targetKeyword || 'Content plan cell',
      section: 'needs-action',
      ctaLabel: 'Review →',
      onCta: () => setFilter('needs-action'),
    });
  }
  // 7. Copy review awaiting approval
  if (hasCopyEntries) {
    priorityItems.push({
      id: 'copy-review',
      icon: PenLine,
      title: 'Copy sections awaiting your approval',
      section: 'content',
      ctaLabel: 'Review →',
      onCta: () => setFilter('content'),
    });
  }

  const respondToClientAction = async (actionId: string, status: 'approved' | 'changes_requested', clientNote?: string) => {
    try {
      await patch(`/api/public/client-actions/${workspaceId}/${actionId}/respond`, { status, clientNote });
      queryClient.invalidateQueries({ queryKey: queryKeys.client.clientActions(workspaceId) });
      setToast({ message: status === 'approved' ? 'Approved. Your team will handle implementation.' : 'Feedback sent to your team.', type: 'success' });
      setChangeRequestAction(null);
      setChangeRequestNote('');
    } catch {
      setToast({ message: 'Failed to update action. Please try again.', type: 'error' });
    }
  };

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
    } finally {
      setFlagSubmitting(false);
    }
  };

  const showSection1 = mode === 'active' && (filter === 'all' || filter === 'needs-action');
  const showSection2 = mode === 'active' && (filter === 'all' || filter === 'seo-changes');
  const showSection3 = mode === 'active' && !betaMode && (filter === 'all' || filter === 'content');

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
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`px-3.5 py-1.5 rounded-[var(--radius-md)] t-caption-sm font-medium capitalize transition-colors ${
                mode === m
                  ? 'bg-[var(--surface-1)] text-[var(--brand-text-bright)] shadow-sm'
                  : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
              }`}
            >
              {m === 'active' ? 'Active' : 'Completed'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filter chips (active mode only) ── */}
      {mode === 'active' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {filterChips.map(f => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-[var(--radius-pill)] t-caption-sm font-medium transition-colors ${
                filter === f.id
                  ? 'bg-teal-500/15 border border-teal-500/30 text-accent-brand'
                  : 'bg-[var(--surface-3)]/50 border border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]'
              }`}
            >
              {f.label}
              {f.count !== undefined && (
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded-[var(--radius-pill)] t-caption-sm font-semibold ${
                  filter === f.id ? 'bg-teal-500/20 text-accent-brand' : 'bg-[var(--surface-2)] text-[var(--brand-text-muted)]'
                }`}>
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Priority strip (active mode only) ── */}
      {mode === 'active' && (
        <PriorityStrip
          items={priorityItems}
          showAllCaughtUp={
            !approvalsLoading && !requestsLoading &&
            !schemaPlanQuery.isLoading &&
            priorityItems.length === 0
          }
        />
      )}

      {/* ── Section 1: Needs Action & Requests ── */}
      {showSection1 && (
        <section aria-label="Needs Action & Requests" className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Needs Action &amp; Requests</h3>
            {hasNeedsAction && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-amber-500/15 text-accent-warning border border-amber-500/30">
                {pendingClientActions.length + requestReplies + planReviewCount} pending
              </span>
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
                        <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)] capitalize">
                          {action.sourceType.replace(/_/g, ' ')}
                        </span>
                        {action.priority === 'high' && (
                          <span className="t-caption-sm font-medium text-accent-warning">High priority</span>
                        )}
                      </div>
                      <h4 className="t-ui font-medium text-[var(--brand-text-bright)]">{action.title}</h4>
                      <p className="t-caption text-[var(--brand-text-muted)] mt-0.5 line-clamp-2">{action.summary}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    {action.sourceType === 'content_decay' ? (
                      <>
                        <Button size="sm" variant="primary" onClick={() => respondToClientAction(action.id, 'approved')}>
                          Approve
                        </Button>
                        {changeRequestAction !== action.id ? (
                          <Button size="sm" variant="ghost" onClick={() => setChangeRequestAction(action.id)}>
                            Request changes
                          </Button>
                        ) : (
                          <div className="flex items-center gap-2 flex-1">
                            <input
                              type="text"
                              value={changeRequestNote}
                              onChange={e => setChangeRequestNote(e.target.value)}
                              placeholder="Add a note for your team…"
                              className="flex-1 px-3 py-1.5 rounded-[var(--radius-md)] t-caption bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] outline-none focus:border-teal-500/50"
                            />
                            <Button size="sm" variant="primary" disabled={!changeRequestNote.trim()} onClick={() => respondToClientAction(action.id, 'changes_requested', changeRequestNote.trim())}>
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
                            <span className={`t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] border ${
                              isFlagged
                                ? 'bg-amber-500/10 border-amber-500/30 text-accent-warning'
                                : 'bg-teal-500/10 border-teal-500/30 text-accent-brand'
                            }`}>
                              {isFlagged ? 'Flagged' : 'Needs Review'}
                            </span>
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
                          <button
                            type="button"
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
                            className="w-full px-3 py-2 bg-[var(--surface-3)] border border-[var(--brand-border-strong)] rounded-[var(--radius-lg)] t-caption text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 resize-none"
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
                            <button
                              type="button"
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
          <button
            type="button"
            className="flex items-center gap-2 w-full text-left"
            aria-expanded={seoSectionExpanded}
            aria-controls="seo-changes-content"
            onClick={() => setSeoSectionExpanded(e => !e)}
          >
            <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">SEO Changes</h3>
            {hasPendingSeoChanges && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-teal-500/15 text-accent-brand border border-teal-500/30">
                {(pendingApprovals ?? 0) + (schemaPlanPending ? 1 : 0)} pending
              </span>
            )}
            {!hasPendingSeoChanges && (
              <span className="t-caption text-[var(--brand-text-muted)]">Nothing pending</span>
            )}
            <span className="ml-auto">
              {seoSectionExpanded
                ? <Icon as={ChevronDown} size="md" className="text-[var(--brand-text-muted)]" />
                : <Icon as={ChevronRight} size="md" className="text-[var(--brand-text-muted)]" />}
            </span>
          </button>

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
                          <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-amber-500/15 text-accent-warning border border-amber-500/30">Ready for review</span>
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
              <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-blue-500/15 text-accent-info border border-blue-500/30">
                {contentReviews + copyReviewCount} needs review
              </span>
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
              <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Completed — Actions</h3>
              {completedClientActions.map(action => (
                <div key={action.id} className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4 opacity-70">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="t-caption-sm px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] text-[var(--brand-text-muted)] border border-[var(--brand-border)] capitalize">
                      {action.sourceType.replace(/_/g, ' ')}
                    </span>
                    <span className={`t-caption-sm px-2 py-0.5 rounded-[var(--radius-pill)] border font-medium ${
                      action.status === 'approved' ? 'bg-emerald-500/15 text-accent-success border-emerald-500/30' :
                      action.status === 'changes_requested' ? 'bg-amber-500/15 text-accent-warning border-amber-500/30' :
                      'bg-[var(--surface-3)] text-[var(--brand-text-muted)] border-[var(--brand-border)]'
                    }`}>
                      {action.status === 'approved' ? 'Approved' : action.status === 'changes_requested' ? 'Changes requested' : 'Completed'}
                    </span>
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

      {/* Modals wired in Tasks 6 & 7 — state holders keep compile green */}
      {/* Schema Review Modal */}
      {schemaModalOpen && (
        <SchemaReviewModal
          workspaceId={workspaceId}
          setToast={setToast}
          onClose={() => setSchemaModalOpen(false)}
        />
      )}
      {detailAction && null /* ClientActionDetailModal mounted in Task 7 */}
    </div>
  );
}
