import {
  Loader2, Trash2, Sparkles, FileText,
  Inbox, CheckCircle2, XCircle, Clock, Zap,
  Copy, Download, Search, Target, MessageSquare, BarChart3,
  BookOpen, Users, TrendingUp, Check, ExternalLink, Link2, PenLine,
} from 'lucide-react';
import { SectionCard, Icon } from '../ui';
import type { PostSummary } from '../../../shared/types/content';

interface ContentBrief {
  id: string;
  workspaceId: string;
  targetKeyword: string;
  secondaryKeywords: string[];
  suggestedTitle: string;
  suggestedMetaDesc: string;
  outline: { heading: string; notes: string; wordCount?: number; keywords?: string[] }[];
  wordCountTarget: number;
  intent: string;
  audience: string;
  competitorInsights: string;
  internalLinkSuggestions: string[];
  createdAt: string;
  executiveSummary?: string;
  contentFormat?: string;
  toneAndStyle?: string;
  peopleAlsoAsk?: string[];
  topicalEntities?: string[];
  serpAnalysis?: { contentType: string; avgWordCount: number; commonElements: string[]; gaps: string[] };
  difficultyScore?: number;
  trafficPotential?: string;
  ctaRecommendations?: string[];
  eeatGuidance?: { experience: string; expertise: string; authority: string; trust: string };
  contentChecklist?: string[];
  schemaRecommendations?: { type: string; notes: string }[];
  pageType?: string;
  referenceUrls?: string[];
  realPeopleAlsoAsk?: string[];
  realTopResults?: { position: number; title: string; url: string }[];
}

interface ContentTopicRequest {
  id: string;
  workspaceId: string;
  topic: string;
  targetKeyword: string;
  intent: string;
  priority: string;
  rationale: string;
  status: 'requested' | 'brief_generated' | 'client_review' | 'approved' | 'changes_requested' | 'in_progress' | 'delivered' | 'published' | 'declined';
  briefId?: string;
  clientNote?: string;
  internalNote?: string;
  declineReason?: string;
  clientFeedback?: string;
  source?: 'strategy' | 'client';
  serviceType?: 'brief_only' | 'full_post';
  upgradedAt?: string;
  deliveryUrl?: string;
  deliveryNotes?: string;
  targetPageId?: string;
  targetPageSlug?: string;
  comments?: { id: string; author: 'client' | 'team'; content: string; createdAt: string }[];
  requestedAt: string;
  updatedAt: string;
}

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
  onUpdateRequestStatus: (reqId: string, status: ContentTopicRequest['status'], extra?: { deliveryUrl?: string; deliveryNotes?: string }) => void;
  onConfirmDeleteRequest: (req: ContentTopicRequest) => void;
  onSetDeliveringReqId: (reqId: string | null) => void;
  onSetDeliveryUrl: (value: string) => void;
  onSetDeliveryNotes: (value: string) => void;
  onSetBriefError: (value: string | null) => void;
  onSetExpandedRequest: (value: string | null) => void;
  onCopyAsMarkdown: (brief: ContentBrief) => void;
  onExportClientHTML: (brief: ContentBrief) => void;
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
            delivered: { icon: CheckCircle2, color: 'text-emerald-400', label: 'Delivered' },
            published: { icon: CheckCircle2, color: 'text-teal-400', label: 'Published' },
            declined: { icon: XCircle, color: 'text-zinc-500', label: 'Declined' },
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
                        <button onClick={() => onToggleRequestBrief(req.id, req.briefId!)} disabled={loadingBrief === req.id} className={`flex items-center gap-1 px-2 py-1 rounded border t-caption-sm transition-colors ${expandedRequest === req.id ? 'bg-blue-600/30 border-blue-500/40 text-blue-200' : 'bg-blue-600/20 border-blue-500/30 text-blue-300 hover:bg-blue-600/30'}`}>
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
                      {req.status === 'approved' && (req.serviceType || 'brief_only') === 'full_post' && req.briefId && (() => {
                        const existingPost = posts.find(p => p.briefId === req.briefId);
                        if (existingPost) {
                          return (
                            <button
                              onClick={() => onOpenPost?.(existingPost.id)}
                              className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors"
                              title="Open post in editor"
                            >
                              <Icon as={PenLine} size="sm" /> Open Post
                            </button>
                          );
                        }
                        const isGeneratingPost = generatingPostFor === req.briefId;
                        return (
                          <button
                            onClick={async () => {
                              if (!req.briefId || !onGeneratePost) return;
                              // Only advance status to in_progress if generation actually succeeded.
                              // Otherwise a transient failure would leave the request stuck:
                              // approved → in_progress with no post and no UI to recover.
                              const ok = await onGeneratePost(req.briefId);
                              if (ok) onUpdateRequestStatus(req.id, 'in_progress');
                            }}
                            disabled={isGeneratingPost || !onGeneratePost}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-gradient-to-r from-teal-600/30 to-emerald-600/30 border border-teal-500/40 t-caption-sm text-teal-200 font-medium hover:from-teal-600/50 hover:to-emerald-600/50 transition-all disabled:opacity-50"
                          >
                            <Icon as={isGeneratingPost ? Loader2 : PenLine} size="sm" className={isGeneratingPost ? 'animate-spin' : ''} />
                            {isGeneratingPost ? 'Generating…' : 'Generate Post'}
                          </button>
                        );
                      })()}
                      {req.status === 'approved' && (req.serviceType || 'brief_only') === 'brief_only' && !req.upgradedAt && deliveringReqId !== req.id && (
                        <button onClick={() => { onSetDeliveringReqId(req.id); onSetDeliveryUrl(req.deliveryUrl || ''); onSetDeliveryNotes(req.deliveryNotes || ''); }} className="px-2 py-1 rounded bg-green-600/20 border border-green-500/30 t-caption-sm text-green-300 hover:bg-green-600/30 transition-colors flex items-center gap-1"><Icon as={Link2} size="sm" /> Deliver Brief</button>
                      )}
                      {req.status === 'changes_requested' && (
                        <button onClick={() => onUpdateRequestStatus(req.id, 'client_review')} className="px-2 py-1 rounded bg-cyan-600/20 border border-cyan-500/30 t-caption-sm text-cyan-300 hover:bg-cyan-600/30 transition-colors">Resubmit to Client</button>
                      )}
                      {req.status === 'in_progress' && req.briefId && (() => {
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
                      {req.status === 'in_progress' && deliveringReqId !== req.id && (
                        <button onClick={() => { onSetDeliveringReqId(req.id); onSetDeliveryUrl(req.deliveryUrl || ''); onSetDeliveryNotes(req.deliveryNotes || ''); }} className="px-2 py-1 rounded bg-emerald-600/20 border border-emerald-500/30 t-caption-sm text-emerald-300 hover:bg-emerald-600/30 transition-colors flex items-center gap-1"><Icon as={Link2} size="sm" /> Deliver Content</button>
                      )}
                    </div>
                  </div>
                </div>
                {/* Delivery form */}
                {(req.status === 'in_progress' || (req.status === 'approved' && (req.serviceType || 'brief_only') === 'brief_only' && !req.upgradedAt)) && deliveringReqId === req.id && (
                  <div className="mt-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-1.5 mb-1"><Icon as={Link2} size="md" className="text-emerald-400" /><span className="t-micro text-emerald-400 font-medium">Attach Deliverable</span></div>
                    <input type="url" value={deliveryUrl} onChange={e => onSetDeliveryUrl(e.target.value)} placeholder="Google Doc link, Dropbox URL, or any content URL..." className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-lg text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:border-emerald-500/50 focus:outline-none" />
                    <textarea value={deliveryNotes} onChange={e => onSetDeliveryNotes(e.target.value)} placeholder="Delivery notes (optional) — e.g. revision notes, word count, etc." className="w-full px-3 py-1.5 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-lg text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:border-emerald-500/50 focus:outline-none resize-y" rows={2} />
                    <div className="flex items-center gap-2">
                      <button onClick={async () => { await onUpdateRequestStatus(req.id, 'delivered', { deliveryUrl: deliveryUrl.trim() || undefined, deliveryNotes: deliveryNotes.trim() || undefined }); onSetDeliveringReqId(null); onSetDeliveryUrl(''); onSetDeliveryNotes(''); }} className="px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 t-caption-sm font-medium text-emerald-300 hover:bg-emerald-600/30 transition-colors flex items-center gap-1"><Icon as={Check} size="sm" /> Mark Delivered</button>
                      <button onClick={() => { onSetDeliveringReqId(null); onSetDeliveryUrl(''); onSetDeliveryNotes(''); }} className="px-3 py-1.5 rounded-lg t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">Cancel</button>
                    </div>
                  </div>
                )}
                {/* Mark Published button for delivered content */}
                {req.status === 'delivered' && (
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={() => onUpdateRequestStatus(req.id, 'published')} className="px-3 py-1.5 rounded-lg bg-teal-600/20 border border-teal-500/30 t-caption-sm font-medium text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"><Icon as={CheckCircle2} size="sm" /> Mark Published</button>
                    {req.targetPageId && <span className="t-caption-sm text-[var(--brand-text-muted)]">Will mark target page as Live</span>}
                  </div>
                )}
                {/* Show delivery info */}
                {(req.status === 'delivered' || req.status === 'published') && req.deliveryUrl && (
                  <div className="mt-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2">
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
                <div className="border-t border-[var(--brand-border)] px-4 pb-4 space-y-4">
                  {/* Export buttons */}
                  <div className="pt-3 flex items-center gap-2">
                    <button onClick={() => onCopyAsMarkdown(inlineBrief)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors">
                      <Icon as={Copy} size="sm" /> Copy for AI Tool
                    </button>
                    <button onClick={() => onExportClientHTML(inlineBrief)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors">
                      <Icon as={Download} size="sm" /> Export PDF
                    </button>
                    <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(inlineBrief, null, 2)); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg t-caption-sm font-medium bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors">
                      <Icon as={Copy} size="sm" /> Copy JSON
                    </button>
                  </div>

                  {/* Executive Summary */}
                  {inlineBrief.executiveSummary && (
                    <div className="bg-teal-500/5 border border-teal-500/20 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-1.5 mb-1.5"><Icon as={BookOpen} size="md" className="text-teal-400" /><span className="t-micro text-teal-400 font-medium">Executive Summary</span></div>
                      <div className="text-xs text-[var(--brand-text-bright)] leading-relaxed">{inlineBrief.executiveSummary}</div>
                    </div>
                  )}

                  {/* Title & Meta */}
                  <div className="space-y-2">
                    <div>
                      <div className="t-micro text-[var(--brand-text-muted)] font-medium mb-1">Suggested Title</div>
                      <div className="text-xs text-teal-400 bg-[var(--surface-1)] rounded-lg px-3 py-2 border border-[var(--brand-border)]">{inlineBrief.suggestedTitle}</div>
                    </div>
                    <div>
                      <div className="t-micro text-[var(--brand-text-muted)] font-medium mb-1">Meta Description</div>
                      <div className="text-xs text-[var(--brand-text-bright)] bg-[var(--surface-1)] rounded-lg px-3 py-2 border border-[var(--brand-border)]">{inlineBrief.suggestedMetaDesc}</div>
                    </div>
                  </div>

                  {/* Key Metrics Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-[var(--surface-1)] rounded-lg px-3 py-2 border border-[var(--brand-border)]">
                      <div className="t-micro text-[var(--brand-text-muted)] font-medium mb-0.5">Word Count</div>
                      <div className="text-sm font-bold text-blue-400">{inlineBrief.wordCountTarget?.toLocaleString()}</div>
                    </div>
                    <div className="bg-[var(--surface-1)] rounded-lg px-3 py-2 border border-[var(--brand-border)]">
                      <div className="t-micro text-[var(--brand-text-muted)] font-medium mb-0.5">Intent</div>
                      <div className="text-xs text-[var(--brand-text-bright)] capitalize font-medium">{inlineBrief.intent}</div>
                    </div>
                    {inlineBrief.contentFormat && (
                      <div className="bg-[var(--surface-1)] rounded-lg px-3 py-2 border border-[var(--brand-border)]">
                        <div className="t-micro text-[var(--brand-text-muted)] font-medium mb-0.5">Format</div>
                        <div className="text-xs text-amber-400 capitalize font-medium">{inlineBrief.contentFormat}</div>
                      </div>
                    )}
                    {inlineBrief.difficultyScore != null && (
                      <div className="bg-[var(--surface-1)] rounded-lg px-3 py-2 border border-[var(--brand-border)]">
                        <div className="t-micro text-[var(--brand-text-muted)] font-medium mb-0.5">Difficulty</div>
                        <div className={`text-sm font-bold ${inlineBrief.difficultyScore <= 30 ? 'text-emerald-400' : inlineBrief.difficultyScore <= 60 ? 'text-amber-400' : 'text-red-400'}`}>{inlineBrief.difficultyScore}/100</div>
                      </div>
                    )}
                  </div>

                  {/* Traffic Potential */}
                  {inlineBrief.trafficPotential && (
                    <div className="flex items-start gap-2 bg-[var(--surface-1)] rounded-lg px-3 py-2 border border-[var(--brand-border)]">
                      <Icon as={TrendingUp} size="md" className="text-emerald-400 mt-0.5 flex-shrink-0" />
                      <div><div className="t-micro text-[var(--brand-text-muted)] font-medium mb-0.5">Traffic Potential</div><div className="text-xs text-[var(--brand-text-bright)]">{inlineBrief.trafficPotential}</div></div>
                    </div>
                  )}

                  {/* Audience & Tone */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1"><Icon as={Users} size="sm" className="text-[var(--brand-text-muted)]" /><span className="t-micro text-[var(--brand-text-muted)] font-medium">Audience</span></div>
                      <div className="text-xs text-[var(--brand-text)] bg-[var(--surface-1)] rounded-lg px-3 py-2 border border-[var(--brand-border)]">{inlineBrief.audience}</div>
                    </div>
                    {inlineBrief.toneAndStyle && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-1"><Icon as={MessageSquare} size="sm" className="text-[var(--brand-text-muted)]" /><span className="t-micro text-[var(--brand-text-muted)] font-medium">Tone & Style</span></div>
                        <div className="text-xs text-[var(--brand-text)] bg-[var(--surface-1)] rounded-lg px-3 py-2 border border-[var(--brand-border)]">{inlineBrief.toneAndStyle}</div>
                      </div>
                    )}
                  </div>

                  {/* Secondary Keywords */}
                  {inlineBrief.secondaryKeywords?.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5"><Icon as={Search} size="sm" className="text-[var(--brand-text-muted)]" /><span className="t-micro text-[var(--brand-text-muted)] font-medium">Secondary Keywords</span></div>
                      <div className="flex flex-wrap gap-1.5">
                        {inlineBrief.secondaryKeywords.map((kw, i) => (
                          <span key={i} className="t-caption-sm px-2 py-0.5 rounded-full bg-[var(--surface-3)] text-[var(--brand-text)]">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Topical Entities */}
                  {inlineBrief.topicalEntities && inlineBrief.topicalEntities.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5"><Icon as={Target} size="sm" className="text-[var(--brand-text-muted)]" /><span className="t-micro text-[var(--brand-text-muted)] font-medium">Topical Entities to Cover</span></div>
                      <div className="flex flex-wrap gap-1.5">
                        {inlineBrief.topicalEntities.map((entity, i) => (
                          <span key={i} className="t-caption-sm px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-300">{entity}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* People Also Ask */}
                  {inlineBrief.peopleAlsoAsk && inlineBrief.peopleAlsoAsk.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5"><Icon as={MessageSquare} size="sm" className="text-[var(--brand-text-muted)]" /><span className="t-micro text-[var(--brand-text-muted)] font-medium">Questions to Answer</span></div>
                      <div className="space-y-1">
                        {inlineBrief.peopleAlsoAsk.map((q, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-[var(--brand-text-bright)] bg-[var(--surface-1)] rounded-lg px-3 py-2 border border-[var(--brand-border)]">
                            <span className="text-amber-400 flex-shrink-0 font-medium">Q{i + 1}.</span> {q}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SERP Analysis */}
                  {inlineBrief.serpAnalysis && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5"><Icon as={BarChart3} size="sm" className="text-[var(--brand-text-muted)]" /><span className="t-micro text-[var(--brand-text-muted)] font-medium">SERP Analysis</span></div>
                      <div className="bg-[var(--surface-1)] rounded-lg px-3 py-3 border border-[var(--brand-border)] space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                          <div><span className="t-caption-sm text-[var(--brand-text-muted)]">Content Type:</span><span className="text-xs text-[var(--brand-text-bright)] ml-1">{inlineBrief.serpAnalysis.contentType}</span></div>
                          <div><span className="t-caption-sm text-[var(--brand-text-muted)]">Avg Word Count:</span><span className="text-xs text-[var(--brand-text-bright)] ml-1">{inlineBrief.serpAnalysis.avgWordCount.toLocaleString()}</span></div>
                        </div>
                        {inlineBrief.serpAnalysis.commonElements.length > 0 && (
                          <div><span className="t-caption-sm text-[var(--brand-text-muted)] block mb-1">Common Elements:</span><div className="flex flex-wrap gap-1">{inlineBrief.serpAnalysis.commonElements.map((el, i) => <span key={i} className="t-caption-sm px-2 py-0.5 rounded bg-[var(--surface-3)] text-[var(--brand-text)]">{el}</span>)}</div></div>
                        )}
                        {inlineBrief.serpAnalysis.gaps.length > 0 && (
                          <div><span className="t-caption-sm text-emerald-400/80 block mb-1">Opportunities (gaps in existing content):</span><div className="space-y-1">{inlineBrief.serpAnalysis.gaps.map((g, i) => <div key={i} className="t-caption-sm text-emerald-300/80 flex items-start gap-1.5"><span className="text-emerald-400 mt-0.5">→</span>{g}</div>)}</div></div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Content Outline */}
                  {inlineBrief.outline?.length > 0 && (
                    <div>
                      <div className="t-micro text-[var(--brand-text-muted)] font-medium mb-2">Content Outline</div>
                      <div className="space-y-2">
                        {inlineBrief.outline.map((section, i) => (
                          <div key={i} className="bg-[var(--surface-1)] rounded-lg px-3 py-2.5 border border-[var(--brand-border)]">
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-medium text-[var(--brand-text-bright)]">H2: {section.heading}</div>
                              {section.wordCount && <span className="t-caption-sm px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--brand-text-muted)]">{section.wordCount} words</span>}
                            </div>
                            <div className="t-caption-sm text-[var(--brand-text-muted)] mt-1 leading-relaxed">{section.notes}</div>
                            {section.keywords && section.keywords.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">{section.keywords.map((kw, j) => <span key={j} className="t-caption-sm px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400/80">{kw}</span>)}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CTA Recommendations */}
                  {inlineBrief.ctaRecommendations && inlineBrief.ctaRecommendations.length > 0 && (
                    <div>
                      <div className="t-micro text-[var(--brand-text-muted)] font-medium mb-1.5">CTA Recommendations</div>
                      <div className="space-y-1">{inlineBrief.ctaRecommendations.map((cta, i) => (
                        <div key={i} className="text-xs text-[var(--brand-text-bright)] bg-[var(--surface-1)] rounded-lg px-3 py-2 border border-[var(--brand-border)] flex items-start gap-2">
                          <span className={`t-caption-sm px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${i === 0 ? 'bg-teal-500/20 text-teal-400' : 'bg-[var(--surface-3)] text-[var(--brand-text-muted)]'}`}>{i === 0 ? 'Primary' : 'Secondary'}</span>{cta}
                        </div>
                      ))}</div>
                    </div>
                  )}

                  {/* Competitor Insights */}
                  {inlineBrief.competitorInsights && (
                    <div>
                      <div className="t-micro text-[var(--brand-text-muted)] font-medium mb-1">Competitor Insights</div>
                      <div className="text-xs text-[var(--brand-text)] bg-[var(--surface-1)] rounded-lg px-3 py-2 border border-[var(--brand-border)] leading-relaxed">{inlineBrief.competitorInsights}</div>
                    </div>
                  )}

                  {/* Internal Links */}
                  {inlineBrief.internalLinkSuggestions?.length > 0 && (
                    <div>
                      <div className="t-micro text-[var(--brand-text-muted)] font-medium mb-1">Internal Link Suggestions</div>
                      <div className="flex flex-wrap gap-1.5">
                        {inlineBrief.internalLinkSuggestions.map((link, i) => (
                          <span key={i} className="t-caption-sm px-2 py-0.5 rounded bg-[var(--surface-3)] text-blue-400">/{link}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* E-E-A-T Guidance */}
                  {inlineBrief.eeatGuidance && (
                    <div>
                      <div className="t-micro text-[var(--brand-text-muted)] font-medium mb-2">E-E-A-T Signals</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[
                          { label: 'Experience', value: inlineBrief.eeatGuidance.experience, color: 'text-blue-400' },
                          { label: 'Expertise', value: inlineBrief.eeatGuidance.expertise, color: 'text-teal-400' },
                          { label: 'Authority', value: inlineBrief.eeatGuidance.authority, color: 'text-teal-400' },
                          { label: 'Trust', value: inlineBrief.eeatGuidance.trust, color: 'text-amber-400' },
                        ].filter(e => e.value).map((e, i) => (
                          <div key={i} className="bg-[var(--surface-1)] rounded-lg px-3 py-2.5 border border-[var(--brand-border)]">
                            <div className={`t-micro ${e.color} font-medium mb-1`}>{e.label}</div>
                            <div className="t-caption-sm text-[var(--brand-text)] leading-relaxed">{e.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Content Checklist */}
                  {inlineBrief.contentChecklist && inlineBrief.contentChecklist.length > 0 && (
                    <div>
                      <div className="t-micro text-[var(--brand-text-muted)] font-medium mb-2">Content Checklist</div>
                      <div className="bg-[var(--surface-1)] rounded-lg border border-[var(--brand-border)] divide-y divide-[var(--brand-border)]/50">
                        {inlineBrief.contentChecklist.map((item, i) => (
                          <div key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                            <div className="w-4 h-4 mt-0.5 rounded border border-[var(--brand-border)] flex-shrink-0" />
                            <span className="t-caption-sm text-[var(--brand-text)] leading-relaxed">{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Schema Recommendations */}
                  {inlineBrief.schemaRecommendations && inlineBrief.schemaRecommendations.length > 0 && (
                    <div>
                      <div className="t-micro text-[var(--brand-text-muted)] font-medium mb-2">Schema Markup</div>
                      <div className="space-y-2">
                        {inlineBrief.schemaRecommendations.map((schema, i) => (
                          <div key={i} className="bg-[var(--surface-1)] rounded-lg px-4 py-3 border border-[var(--brand-border)]">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="t-caption-sm px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-medium">{schema.type}</span>
                            </div>
                            <div className="t-caption-sm text-[var(--brand-text)] leading-relaxed">{schema.notes}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
