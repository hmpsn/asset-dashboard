import {
  Loader2, Trash2, Sparkles, FileText,
  Inbox, CheckCircle2, XCircle, Clock, Zap,
  Check, ExternalLink, Link2, PenLine, Eye, Send, MessageSquare,
} from 'lucide-react';
import { BriefDetail } from './BriefDetail';
import { SectionCard, Icon } from '../ui';
import type { ContentBrief, ContentTopicRequest, PostSummary } from '../../../shared/types/content';

// Subset of PostSummary that RequestList needs. Pick keeps it in lock-step with the
// canonical type — if PostSummary changes, TypeScript catches mismatches here.
// (PostSummary import is at top of file with other imports.)
export type RequestPostSummary = Pick<PostSummary, 'id' | 'briefId' | 'status' | 'totalWordCount'>;

export interface RequestListProps {
  clientRequests: ContentTopicRequest[];
  expandedRequest: string | null;
  generatingBriefFor: string | null;
  loadingBrief: string | null;
  briefError: string | null;
  deliveringReqId: string | null;
  deliveryUrl: string;
  deliveryNotes: string;
  getBriefById: (briefId: string) => ContentBrief | undefined;
  onToggleRequestBrief: (reqId: string, briefId: string) => void;
  onGenerateBriefForRequest: (req: ContentTopicRequest) => void;
  onUpdateRequestStatus: (reqId: string, status: ContentTopicRequest['status'] | undefined, extra?: { deliveryUrl?: string; deliveryNotes?: string; briefId?: string; clientFeedback?: string; serviceType?: 'brief_only' | 'full_post' }) => void;
  onConfirmDeleteRequest: (req: ContentTopicRequest) => void;
  onSetDeliveringReqId: (reqId: string | null) => void;
  onSetDeliveryUrl: (value: string) => void;
  onSetDeliveryNotes: (value: string) => void;
  onSetBriefError: (value: string | null) => void;
  onSetExpandedRequest: (value: string | null) => void;
  onCopyAsMarkdown: (brief: ContentBrief) => void;
  onExportClientHTML: (brief: ContentBrief) => void;
  // Brief editing/regeneration (threaded from ContentBriefs)
  editingBrief: string | null;
  onSetEditingBrief: (id: string | null) => void;
  onSaveBriefField: (briefId: string, updates: Partial<ContentBrief>) => void;
  regeneratingBrief: string | null;
  onRegenerateBrief: (briefId: string, feedback: string, requestId?: string) => void;
  regeneratingOutline?: string | null;
  onRegenerateOutline?: (briefId: string, feedback?: string) => void;
  sendingToClient?: string | null;
  // Post production (full_post requests after brief approval)
  posts?: RequestPostSummary[];
  generatingPostFor?: string | null;
  /** Returns true on success, false on failure. Caller must check before advancing
   *  request status, otherwise a generation failure leaves the request stuck. */
  onGeneratePost?: (briefId: string) => Promise<boolean>;
  onOpenPost?: (postId: string) => void;
}

export function RequestList({
  clientRequests,
  expandedRequest,
  generatingBriefFor,
  loadingBrief,
  briefError,
  deliveringReqId,
  deliveryUrl,
  deliveryNotes,
  getBriefById,
  onToggleRequestBrief,
  onGenerateBriefForRequest,
  onUpdateRequestStatus,
  onConfirmDeleteRequest,
  onSetDeliveringReqId,
  onSetDeliveryUrl,
  onSetDeliveryNotes,
  onSetBriefError,
  onSetExpandedRequest,
  onCopyAsMarkdown,
  onExportClientHTML,
  editingBrief,
  onSetEditingBrief,
  onSaveBriefField,
  regeneratingBrief,
  onRegenerateBrief,
  regeneratingOutline,
  onRegenerateOutline,
  sendingToClient = null,
  posts = [],
  generatingPostFor = null,
  onGeneratePost,
  onOpenPost,
}: RequestListProps) {
  if (clientRequests.length === 0) return null;

  return (
    <SectionCard
      title="Client Content Requests"
      titleIcon={<Icon as={Inbox} size="md" className="text-amber-400" />}
      titleExtra={
        <span className="t-caption-sm px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
          {clientRequests.filter(r => r.status === 'requested').length} new
        </span>
      }
      className="!border-amber-500/20"
    >
      <div className="space-y-2">
        {clientRequests.map(req => {
          const statusConfig: Record<string, { icon: typeof Clock; color: string; label: string }> = {
            pending_payment: { icon: Clock, color: 'text-amber-400', label: 'Awaiting Payment' },
            requested: { icon: Clock, color: 'text-amber-400', label: 'Awaiting Review' },
            brief_generated: { icon: FileText, color: 'text-blue-400', label: 'Brief Ready' },
            client_review: { icon: Clock, color: 'text-cyan-400', label: 'Client Review' },
            approved: { icon: CheckCircle2, color: 'text-emerald-400', label: 'Approved' },
            changes_requested: { icon: Clock, color: 'text-orange-400', label: 'Changes Requested' },
            in_progress: { icon: Zap, color: 'text-teal-400', label: 'In Progress' },
            post_review: { icon: Eye, color: 'text-cyan-400', label: 'Client Review' },
            delivered: { icon: CheckCircle2, color: 'text-emerald-400', label: 'Delivered' },
            published: { icon: CheckCircle2, color: 'text-teal-400', label: 'Published' },
            declined: { icon: XCircle, color: 'text-[var(--brand-text-muted)]', label: 'Declined' },
          };
          const sc = statusConfig[req.status] || statusConfig.requested;
          const StatusIcon = sc.icon;
          const isGenerating = generatingBriefFor === req.id;
          const hasBrief = !!req.briefId;
          const inlineBrief = hasBrief && expandedRequest === req.id ? getBriefById(req.briefId!) : null;
          return (
            <div key={req.id} className="rounded-[var(--radius-lg)] bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden">
              <div className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--brand-text-bright)]">{req.topic}</span>
                      {req.source === 'client' && <span className="t-caption-sm px-1 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">Client</span>}
                      <span className={`t-caption-sm px-1 py-0.5 rounded border ${(req.serviceType || 'brief_only') === 'full_post' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)] border-[var(--brand-border)]'}`}>{(req.serviceType || 'brief_only') === 'full_post' ? 'Full Post' : 'Brief Only'}</span>
                      {req.upgradedAt && <span className="t-caption-sm px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Upgraded</span>}
                    </div>
                    <div className="t-caption-sm text-teal-400 mt-0.5">"{req.targetKeyword}"</div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="t-caption-sm text-[var(--brand-text-muted)] uppercase">{req.intent} · {req.priority}</span>
                      <span className="t-caption-sm text-[var(--brand-text-muted)]">{new Date(req.requestedAt).toLocaleDateString()}</span>
                      {req.comments && req.comments.length > 0 && <span className="flex items-center gap-0.5 t-caption-sm text-[var(--brand-text-muted)]"><Icon as={MessageSquare} size="sm" />{req.comments.length}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className={`flex items-center gap-1 t-caption-sm ${sc.color}`}><Icon as={StatusIcon} size="sm" /> {sc.label}</span>
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                      {hasBrief && req.status !== 'requested' && (
                        <button onClick={() => onToggleRequestBrief(req.id, req.briefId!)} disabled={loadingBrief === req.id} className={`flex items-center gap-1 px-2 py-1 rounded border t-caption-sm transition-colors ${expandedRequest === req.id ? 'bg-teal-600/30 border-teal-500/40 text-teal-200' : 'bg-teal-600/20 border-teal-500/30 text-teal-300 hover:bg-teal-600/30'}`}>
                          {loadingBrief === req.id ? <><Icon as={Loader2} size="sm" className="animate-spin" /> Loading...</> : expandedRequest === req.id ? 'Hide Brief' : 'View Brief'}
                        </button>
                      )}
                      {req.status === 'requested' && (
                        <>
                          <button disabled={isGenerating} onClick={() => onGenerateBriefForRequest(req)} className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50">
                            <Icon as={isGenerating ? Loader2 : Sparkles} size="sm" className={isGenerating ? 'animate-spin' : ''} />
                            {isGenerating ? 'Generating...' : 'Generate Brief'}
                          </button>
                          <button onClick={() => onUpdateRequestStatus(req.id, 'declined')} className="px-2 py-1 rounded bg-[var(--surface-3)] t-caption-sm text-[var(--brand-text-muted)] hover:text-red-400 transition-colors">Decline</button>
                        </>
                      )}
                      {req.status === 'brief_generated' && (
                        <button onClick={() => onUpdateRequestStatus(req.id, 'client_review')} className="px-2 py-1 rounded bg-cyan-600/20 border border-cyan-500/30 t-caption-sm text-cyan-300 hover:bg-cyan-600/30 transition-colors">Send to Client</button>
                      )}
                      {req.status === 'client_review' && (
                        <span className="t-caption-sm text-cyan-400/60 italic">Awaiting client feedback</span>
                      )}
                      {req.status === 'post_review' && (
                        <span className="t-caption-sm text-cyan-400/60 italic">Post sent — awaiting client approval</span>
                      )}
                      {req.briefId && (() => {
                        const existingPost = posts.find(p => p.briefId === req.briefId);
                        if (!existingPost) return null;
                        return (
                          <button
                            onClick={() => onOpenPost?.(existingPost.id)}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors"
                            title="Open post in editor"
                          >
                            <Icon as={PenLine} size="sm" /> Open Post
                          </button>
                        );
                      })()}
                      {req.status === 'approved' && (req.serviceType || 'brief_only') === 'brief_only' && !req.upgradedAt && deliveringReqId !== req.id && (
                        <button onClick={() => { onSetDeliveringReqId(req.id); onSetDeliveryUrl(req.deliveryUrl || ''); onSetDeliveryNotes(req.deliveryNotes || ''); }} className="px-2 py-1 rounded bg-emerald-600/20 border border-emerald-500/30 t-caption-sm text-emerald-300 hover:bg-emerald-600/30 transition-colors flex items-center gap-1"><Icon as={Link2} size="sm" /> Deliver Brief</button>
                      )}
                      {req.status === 'changes_requested' && (() => {
                        const existingPost = req.briefId
                          ? posts.find(p => p.briefId === req.briefId)
                          : undefined;
                        const isPostFlow = !!existingPost && req.serviceType === 'full_post';
                        if (isPostFlow) {
                          return (
                            <button
                              onClick={() => onUpdateRequestStatus(req.id, 'in_progress')}
                              className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors"
                              title="Re-queue for revision before resending to client"
                            >
                              <Icon as={Zap} size="sm" /> Re-queue for Revision
                            </button>
                          );
                        }
                        return (
                          <button
                            onClick={() => onUpdateRequestStatus(req.id, 'client_review', { clientFeedback: '' })}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-600/20 border border-cyan-500/30 t-caption-sm text-cyan-300 hover:bg-cyan-600/30 transition-colors"
                            title="Send the revised brief back to client for review"
                          >
                            <Icon as={Send} size="sm" /> Resubmit to Client
                          </button>
                        );
                      })()}
                      {req.status === 'in_progress' && req.briefId && (() => {
                        const existingPost = posts.find(p => p.briefId === req.briefId);
                        if (!existingPost) return null;
                        const canSendToClient = existingPost.status === 'review' || existingPost.status === 'approved';
                        if (!canSendToClient) return null;
                        return (
                          <button
                            onClick={() => onUpdateRequestStatus(req.id, 'post_review')}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-600/20 border border-cyan-500/30 t-caption-sm text-cyan-300 hover:bg-cyan-600/30 transition-colors"
                            title="Send post to client for review and approval"
                          >
                            <Icon as={Send} size="sm" /> Send Post to Client
                          </button>
                        );
                      })()}
                      {req.status === 'in_progress' && deliveringReqId !== req.id && (
                        <button onClick={() => { onSetDeliveringReqId(req.id); onSetDeliveryUrl(req.deliveryUrl || ''); onSetDeliveryNotes(req.deliveryNotes || ''); }} className="px-2 py-1 rounded bg-emerald-600/20 border border-emerald-500/30 t-caption-sm text-emerald-300 hover:bg-emerald-600/30 transition-colors flex items-center gap-1"><Icon as={Link2} size="sm" /> Deliver Content</button>
                      )}
                    </div>
                  </div>
                </div>
                {/* Delivery form */}
                {(req.status === 'in_progress' || (req.status === 'approved' && (req.serviceType || 'brief_only') === 'brief_only' && !req.upgradedAt)) && deliveringReqId === req.id && (
                  <div className="mt-2 bg-emerald-500/5 border border-emerald-500/20 rounded-[var(--radius-lg)] p-3 space-y-2">
                    <div className="flex items-center gap-1.5 mb-1"><Icon as={Link2} size="md" className="text-emerald-400" /><span className="t-caption-sm uppercase tracking-wider text-emerald-400 font-medium">Attach Deliverable</span></div>
                    <input type="url" value={deliveryUrl} onChange={e => onSetDeliveryUrl(e.target.value)} placeholder="Google Doc link, Dropbox URL, or any content URL..." className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:border-emerald-500/50 focus:outline-none" />
                    <textarea value={deliveryNotes} onChange={e => onSetDeliveryNotes(e.target.value)} placeholder="Delivery notes (optional) — e.g. revision notes, word count, etc." className="w-full px-3 py-1.5 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:border-emerald-500/50 focus:outline-none resize-y" rows={2} />
                    <div className="flex items-center gap-2">
                      <button onClick={async () => { await onUpdateRequestStatus(req.id, 'delivered', { deliveryUrl: deliveryUrl.trim() || undefined, deliveryNotes: deliveryNotes.trim() || undefined }); onSetDeliveringReqId(null); onSetDeliveryUrl(''); onSetDeliveryNotes(''); }} className="px-3 py-1.5 rounded-[var(--radius-lg)] bg-emerald-600/20 border border-emerald-500/30 t-caption-sm font-medium text-emerald-300 hover:bg-emerald-600/30 transition-colors flex items-center gap-1"><Icon as={Check} size="sm" /> Mark Delivered</button>
                      <button onClick={() => { onSetDeliveringReqId(null); onSetDeliveryUrl(''); onSetDeliveryNotes(''); }} className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">Cancel</button>
                    </div>
                  </div>
                )}
                {/* Mark Published button for delivered content */}
                {req.status === 'delivered' && (
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={() => onUpdateRequestStatus(req.id, 'published')} className="px-3 py-1.5 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm font-medium text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"><Icon as={CheckCircle2} size="sm" /> Mark Published</button>
                    {req.targetPageId && <span className="t-caption-sm text-[var(--brand-text-muted)]">Will mark target page as Live</span>}
                  </div>
                )}
                {/* Show delivery info */}
                {(req.status === 'delivered' || req.status === 'published') && req.deliveryUrl && (
                  <div className="mt-2 bg-emerald-500/5 border border-emerald-500/20 rounded-[var(--radius-lg)] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Icon as={ExternalLink} size="sm" className="text-emerald-400 flex-shrink-0" />
                      <a href={req.deliveryUrl} target="_blank" rel="noopener noreferrer" className="t-caption-sm text-emerald-400 hover:text-emerald-300 underline underline-offset-2 truncate">{req.deliveryUrl}</a>
                    </div>
                    {req.deliveryNotes && <div className="t-caption-sm text-[var(--brand-text)] mt-1">{req.deliveryNotes}</div>}
                  </div>
                )}
                {req.status === 'changes_requested' && req.clientFeedback && (
                  <div className="mt-2 t-caption-sm text-orange-300/80 bg-orange-500/10 px-2.5 py-1.5 rounded border border-orange-500/20"><span className="text-orange-400 font-medium">Client feedback:</span> {req.clientFeedback}</div>
                )}
                {req.status === 'declined' && req.declineReason && (
                  <div className="mt-2 t-caption-sm text-[var(--brand-text-muted)] bg-[var(--surface-3)]/50 px-2.5 py-1.5 rounded border border-[var(--brand-border)]"><span className="text-[var(--brand-text)] font-medium">Reason:</span> {req.declineReason}</div>
                )}
                <div className="flex items-center justify-end mt-1.5">
                  <button onClick={(e) => { e.stopPropagation(); onConfirmDeleteRequest(req); }} className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)] hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-500/10">
                    <Icon as={Trash2} size="sm" /> Delete Request
                  </button>
                </div>
              </div>
              {/* Brief error message */}
              {expandedRequest === req.id && !inlineBrief && briefError && (
                <div className="border-t border-red-500/20 px-3 py-3 bg-red-950/20">
                  <div className="flex items-center gap-2 t-caption-sm text-red-400">
                    <Icon as={XCircle} size="md" className="flex-shrink-0" />
                    <span>{briefError}</span>
                  </div>
                  <button onClick={() => { onGenerateBriefForRequest(req); onSetBriefError(null); onSetExpandedRequest(null); }} className="mt-2 flex items-center gap-1 px-2 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors">
                    <Icon as={Sparkles} size="sm" /> Regenerate Brief
                  </button>
                </div>
              )}
              {/* Full inline brief detail */}
              {inlineBrief && (
                <BriefDetail
                  brief={inlineBrief}
                  editingBrief={editingBrief}
                  generatingPostFor={generatingPostFor}
                  regeneratingBrief={regeneratingBrief}
                  sendingToClient={sendingToClient ?? null}
                  onSaveBriefField={onSaveBriefField}
                  onSetEditingBrief={onSetEditingBrief}
                  onGeneratePost={async (briefId) => {
                    if (!onGeneratePost) return;
                    const ok = await onGeneratePost(briefId);
                    if (!ok) return;
                    if ((req.serviceType || 'brief_only') === 'brief_only') {
                      await onUpdateRequestStatus(req.id, req.status, { serviceType: 'full_post' });
                    }
                    // Only advance to in_progress for statuses that allow this transition
                    const canAdvance = ['requested', 'brief_generated', 'client_review', 'changes_requested', 'approved'].includes(req.status);
                    if (canAdvance) onUpdateRequestStatus(req.id, 'in_progress');
                  }}
                  onRegenerate={(briefId, feedback) => onRegenerateBrief(briefId, feedback, req.id)}
                  onRegenerateOutline={onRegenerateOutline}
                  regeneratingOutline={regeneratingOutline}
                  onCopyAsMarkdown={onCopyAsMarkdown}
                  onExportClientHTML={onExportClientHTML}
                  onSendToClient={() => {}}
                  onConfirmDelete={() => {}}
                  hideActions={['sendToClient', 'delete']}
                  defaultFeedback={req.status === 'changes_requested' ? req.clientFeedback : undefined}
                  autoShowRegenerate={req.status === 'changes_requested' && !!req.clientFeedback}
                />
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
