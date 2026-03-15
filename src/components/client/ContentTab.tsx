import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, FileText, Sparkles, Send, ChevronDown, ChevronUp,
  Check, Edit3, X, TrendingUp, Download, ExternalLink,
  BarChart3, MousePointerClick, Eye, ArrowUpRight,
} from 'lucide-react';
import { TierGate, type Tier } from '../ui';
import type { ClientContentRequest } from './types';
import { clientPath } from '../../routes';
import { useBetaMode } from './BetaContext';
import type { PricingModalState } from './StrategyTab';
import { STUDIO_NAME } from '../../constants';
import { useContentRequests } from '../../hooks/useContentRequests';

interface ContentPerfItem {
  requestId: string;
  daysSincePublish: number;
  gsc: { clicks: number; impressions: number; ctr: number; position: number } | null;
  ga4: { sessions: number; users: number } | null;
}

interface ContentTabProps {
  contentRequests: ClientContentRequest[];
  setContentRequests: React.Dispatch<React.SetStateAction<ClientContentRequest[]>>;
  effectiveTier: Tier;
  briefPrice: number | null;
  fullPostPrice: number | null;
  fmtPrice: (n: number) => string;
  setPricingModal: (modal: PricingModalState | null) => void;
  pricingConfirming: boolean;
  workspaceId: string;
  setToast: (t: { message: string; type: 'success' | 'error' } | null) => void;
}

export function ContentTab({
  contentRequests, setContentRequests, effectiveTier,
  briefPrice, fullPostPrice, fmtPrice, setPricingModal, pricingConfirming,
  workspaceId, setToast,
}: ContentTabProps) {
  const navigate = useNavigate();
  const betaMode = useBetaMode();
  // Topic form state
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [newTopicKeyword, setNewTopicKeyword] = useState('');
  const [newTopicNotes, setNewTopicNotes] = useState('');
  const [newTopicServiceType, setNewTopicServiceType] = useState<'brief_only' | 'full_post'>('brief_only');
  const [newTopicPageType] = useState<'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource'>('blog');

  // ── Content performance data for published items ──
  const [contentPerf, setContentPerf] = useState<Record<string, ContentPerfItem>>({});
  useEffect(() => {
    const hasPublished = contentRequests.some(r => r.status === 'delivered' || r.status === 'published');
    if (!hasPublished) return;
    fetch(`/api/public/content-performance/${workspaceId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.items) {
          const map: Record<string, ContentPerfItem> = {};
          for (const item of data.items) map[item.requestId] = item;
          setContentPerf(map);
        }
      })
      .catch(() => {});
  }, [workspaceId, contentRequests]);

  // ── Content-specific API functions + interaction state (extracted hook) ──
  const {
    expandedContentReq, setExpandedContentReq,
    contentComment, setContentComment,
    sendingContentComment,
    declineReqId, setDeclineReqId,
    declineReason, setDeclineReason,
    feedbackReqId, setFeedbackReqId,
    feedbackText, setFeedbackText,
    briefPreviews,
    declineTopic, approveBrief, requestChanges,
    addContentComment, loadBriefPreview,
  } = useContentRequests({ workspaceId, setContentRequests, setToast });

  return (<>
    {/* Alert banner for items needing review */}
    {(() => {
      const reviewCount = contentRequests.filter(r => r.status === 'client_review').length;
      const newComments = contentRequests.filter(r => r.comments && r.comments.length > 0 && r.comments[r.comments.length - 1].author === 'team' && r.status !== 'declined').length;
      if (reviewCount > 0 || newComments > 0) return (
        <div className="bg-gradient-to-r from-teal-600/15 to-teal-600/5 border border-teal-500/30 rounded-xl px-5 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-500/20 flex items-center justify-center flex-shrink-0">
            <FileText className="w-4 h-4 text-teal-400" />
          </div>
          <div className="flex-1">
            <div className="text-xs font-semibold text-teal-200">
              {reviewCount > 0 && <>{reviewCount} brief{reviewCount > 1 ? 's' : ''} ready for your review</>}
              {reviewCount > 0 && newComments > 0 && ' · '}
              {newComments > 0 && <>{newComments} item{newComments > 1 ? 's' : ''} with new team responses</>}
            </div>
            <div className="text-[11px] text-teal-400/60 mt-0.5">{STUDIO_NAME} has updates waiting for you below</div>
          </div>
        </div>
      );
      return null;
    })()}

    {/* Status summary cards */}
    {contentRequests.length > 0 && (() => {
      const active = contentRequests.filter(r => r.status !== 'declined');
      const awaitingReview = active.filter(r => r.status === 'client_review').length;
      const inProgress = active.filter(r => ['pending_payment', 'requested', 'brief_generated', 'changes_requested', 'approved', 'in_progress'].includes(r.status)).length;
      const delivered = active.filter(r => r.status === 'delivered').length;
      const published = active.filter(r => r.status === 'published').length;
      const stats = [
        { label: 'Needs Review', value: awaitingReview, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
        { label: 'In Progress', value: inProgress, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
        { label: 'Delivered', value: delivered, color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
        { label: 'Published', value: published, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
      ];
      return (
        <div className="grid grid-cols-4 gap-2">
          {stats.map(s => (
            <div key={s.label} className={`${s.bg} border ${s.border} rounded-lg px-3 py-2 text-center`}>
              <div className={`text-lg font-bold ${s.color} tabular-nums`}>{s.value}</div>
              <div className="text-[11px] text-zinc-500 font-medium">{s.label}</div>
            </div>
          ))}
        </div>
      );
    })()}

    <div className="flex items-center justify-between mb-1">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Content Pipeline</h2>
        <p className="text-sm text-zinc-500 mt-1">Track and manage your content requests</p>
      </div>
      <button onClick={() => setShowTopicForm(!showTopicForm)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600/20 border border-teal-500/30 text-xs text-teal-300 hover:bg-teal-600/30 transition-colors font-medium">
        <Plus className="w-3.5 h-3.5" /> Suggest a Topic
      </button>
    </div>

    {/* Topic submission form */}
    {showTopicForm && (
      <div className="bg-zinc-900 rounded-xl border border-teal-500/20 p-5 space-y-3">
        <div className="text-xs font-medium text-zinc-300">Suggest a Content Topic</div>
        <input type="text" value={newTopicName} onChange={e => setNewTopicName(e.target.value)} placeholder="Topic name (e.g. 'Benefits of sedation dentistry')" className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600" />
        <input type="text" value={newTopicKeyword} onChange={e => setNewTopicKeyword(e.target.value)} placeholder="Target keyword (e.g. 'sedation dentistry benefits')" className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600" />
        <textarea value={newTopicNotes} onChange={e => setNewTopicNotes(e.target.value)} placeholder="Any notes or context for this topic... (optional)" rows={2} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 resize-none" />
        <div>
          <div className="text-[11px] text-zinc-500 mb-1.5">What would you like?</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setNewTopicServiceType('brief_only')} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-medium transition-all ${newTopicServiceType === 'brief_only' ? 'bg-teal-600/20 border-teal-500/40 text-teal-300' : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
              <FileText className="w-3.5 h-3.5" /> Content Brief
            </button>
            <button onClick={() => setNewTopicServiceType('full_post')} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-medium transition-all ${newTopicServiceType === 'full_post' ? 'bg-teal-600/20 border-teal-500/40 text-teal-300' : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}>
              <Sparkles className="w-3.5 h-3.5" /> Full Blog Post
            </button>
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">{newTopicServiceType === 'brief_only' ? 'A detailed content strategy document for this topic' : 'Brief + professionally written article delivered ready to publish'}</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => {
            if (!newTopicName.trim() || !newTopicKeyword.trim()) return;
            setPricingModal({ serviceType: newTopicServiceType, topic: newTopicName.trim(), targetKeyword: newTopicKeyword.trim(), notes: newTopicNotes.trim() || undefined, source: 'client', pageType: newTopicPageType });
          }} disabled={!newTopicName.trim() || !newTopicKeyword.trim() || pricingConfirming} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-xs text-white font-medium hover:from-teal-500 hover:to-emerald-500 transition-colors disabled:opacity-50">
            <Send className="w-3.5 h-3.5" /> Submit Topic
          </button>
          <button onClick={() => setShowTopicForm(false)} className="px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
        </div>
      </div>
    )}

    {/* Empty state when no requests yet */}
    {contentRequests.length === 0 && (
      <div className="text-center py-16">
        <FileText className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
        <p className="text-sm font-medium text-zinc-400">Your content pipeline is empty</p>
        <p className="text-xs text-zinc-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
          Ready to grow your traffic? Browse content ideas on the <button onClick={() => navigate(clientPath(workspaceId, 'strategy', betaMode))} className="text-teal-400 hover:text-teal-300 underline underline-offset-2 transition-colors">SEO Strategy</button> tab, or click <strong className="text-zinc-400">Suggest a Topic</strong> above to kick things off.
        </p>
      </div>
    )}

    {/* Pipeline items — review-needed first */}
    <div className="space-y-3">
      {contentRequests.filter(r => r.status !== 'declined').sort((a, b) => {
        const priority = (s: string) => s === 'client_review' ? 0 : s === 'changes_requested' ? 1 : 2;
        const diff = priority(a.status) - priority(b.status);
        return diff !== 0 ? diff : b.updatedAt.localeCompare(a.updatedAt);
      }).map(req => {
        const isBriefOnly = (req.serviceType || 'brief_only') === 'brief_only' && !req.upgradedAt;
        const isPending = req.status === 'pending_payment';
        const steps = isBriefOnly
          ? ['requested', 'brief_generated', 'client_review', 'approved', 'delivered', 'published'] as const
          : ['requested', 'brief_generated', 'client_review', 'approved', 'in_progress', 'delivered', 'published'] as const;
        const stepLabels = isBriefOnly
          ? [isPending ? 'Awaiting Payment' : 'Requested', 'Brief Ready', 'Your Review', 'Approved', 'Brief Delivered', 'Published']
          : [isPending ? 'Awaiting Payment' : 'Requested', 'Brief Ready', 'Your Review', 'Approved', 'In Production', 'Delivered', 'Published'];
        // Map pending_payment and changes_requested back for timeline display
        const displayStatus = req.status === 'pending_payment' ? 'requested' : req.status === 'changes_requested' ? 'client_review' : req.status;
        const currentIdx = (steps as readonly string[]).indexOf(displayStatus);
        const isExpanded = expandedContentReq === req.id;
        const brief = req.briefId ? briefPreviews[req.briefId] : null;
        const canUpgrade = isBriefOnly && ['approved', 'delivered', 'published'].includes(req.status);

        return (
          <div key={req.id} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <button onClick={() => {
              const next = isExpanded ? null : req.id;
              setExpandedContentReq(next);
              if (next && req.briefId) loadBriefPreview(req.briefId);
            }} className="w-full px-5 py-4 text-left hover:bg-zinc-800/30 transition-colors">
              <div className="flex items-center justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-200">{req.topic}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded border font-medium ${(req.serviceType || 'brief_only') === 'full_post' ? 'bg-teal-500/10 text-teal-300 border-teal-500/20' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
                      {(req.serviceType || 'brief_only') === 'full_post' ? '✦ Full Post' : 'Brief'}
                    </span>
                    {req.pageType && req.pageType !== 'blog' && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 font-medium capitalize">{req.pageType}</span>
                    )}
                    {req.upgradedAt && <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-medium">Upgraded</span>}
                  </div>
                  <div className="text-xs text-teal-400 mt-0.5">&ldquo;{req.targetKeyword}&rdquo;</div>
                </div>
                <div className="flex items-center gap-2">
                  {req.source === 'client' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">You submitted</span>}
                  {req.status === 'pending_payment' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">Awaiting Payment</span>}
                  {req.status === 'changes_requested' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">Changes Requested</span>}
                  {req.status === 'client_review' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse">Needs Your Review</span>}
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
                </div>
              </div>
              {/* Progress timeline */}
              <div className="flex items-center gap-0.5">
                {steps.map((step, i) => {
                  const isComplete = currentIdx >= i;
                  const isCurrent = currentIdx === i;
                  return (
                    <div key={step} className="flex items-center flex-1">
                      <div className="flex flex-col items-center flex-1">
                        <div className={`w-full h-1.5 rounded-full ${isComplete ? (isCurrent ? (req.status === 'pending_payment' ? 'bg-amber-400' : req.status === 'changes_requested' ? 'bg-orange-400' : 'bg-teal-400') : 'bg-teal-500/40') : 'bg-zinc-800'}`} />
                        <span className={`text-[11px] mt-1 ${isCurrent ? (req.status === 'pending_payment' ? 'text-amber-400 font-medium' : req.status === 'changes_requested' ? 'text-orange-400 font-medium' : 'text-teal-400 font-medium') : isComplete ? 'text-zinc-500' : 'text-zinc-700'}`}>{stepLabels[i]}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="px-5 pb-5 space-y-4 border-t border-zinc-800">
                {/* Full brief */}
                {brief && (
                  <div className="mt-4 space-y-5">
                    {/* — Strategic Overview — */}
                    {brief.executiveSummary && (
                      <div className="bg-teal-500/5 border border-teal-500/20 rounded-lg px-4 py-3">
                        <div className="text-[11px] text-teal-400 font-medium uppercase tracking-wider mb-1.5">Strategic Overview</div>
                        <div className="text-xs text-zinc-300 leading-relaxed">{brief.executiveSummary}</div>
                      </div>
                    )}

                    {/* Key Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                        <div className="text-[11px] text-zinc-500 mb-0.5">Word Count</div>
                        <div className="text-sm font-bold text-teal-400">{brief.wordCountTarget?.toLocaleString()}</div>
                      </div>
                      <div className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                        <div className="text-[11px] text-zinc-500 mb-0.5">Search Intent</div>
                        <div className="text-xs text-zinc-300 capitalize font-medium">{brief.intent}</div>
                      </div>
                      {brief.contentFormat && (
                        <div className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                          <div className="text-[11px] text-zinc-500 mb-0.5">Format</div>
                          <div className="text-xs text-amber-400 capitalize font-medium">{brief.contentFormat}</div>
                        </div>
                      )}
                      {brief.difficultyScore != null && (
                        <div className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                          <div className="text-[11px] text-zinc-500 mb-0.5">Difficulty</div>
                          <div className={`text-sm font-bold ${brief.difficultyScore <= 30 ? 'text-green-400' : brief.difficultyScore <= 60 ? 'text-amber-400' : 'text-red-400'}`}>{brief.difficultyScore}/100</div>
                        </div>
                      )}
                    </div>

                    {/* Traffic Potential */}
                    {brief.trafficPotential && (
                      <div className="bg-zinc-950 rounded-lg px-4 py-2.5 border border-zinc-800 flex items-start gap-2">
                        <TrendingUp className="w-3.5 h-3.5 text-green-400 mt-0.5 flex-shrink-0" />
                        <div><div className="text-[11px] text-zinc-500 mb-0.5">Traffic Potential</div><div className="text-xs text-zinc-300">{brief.trafficPotential}</div></div>
                      </div>
                    )}

                    {/* — Content Direction — */}
                    <div className="space-y-3">
                      <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-2 after:content-[''] after:flex-1 after:h-px after:bg-zinc-800">Content Direction</div>
                      <div className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                        <div className="text-[11px] text-zinc-500 mb-1">Suggested Title</div>
                        <div className="text-sm text-teal-400 font-medium">{brief.suggestedTitle}</div>
                      </div>
                      <div className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                        <div className="text-[11px] text-zinc-500 mb-1">Meta Description</div>
                        <div className="text-xs text-zinc-300">{brief.suggestedMetaDesc}</div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {brief.audience && (
                          <div className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                            <div className="text-[11px] text-zinc-500 mb-1">Target Audience</div>
                            <div className="text-xs text-zinc-400 leading-relaxed">{brief.audience}</div>
                          </div>
                        )}
                        {brief.toneAndStyle && (
                          <div className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                            <div className="text-[11px] text-zinc-500 mb-1">Tone & Style</div>
                            <div className="text-xs text-zinc-400 leading-relaxed">{brief.toneAndStyle}</div>
                          </div>
                        )}
                      </div>
                      {brief.ctaRecommendations && brief.ctaRecommendations.length > 0 && (
                        <div>
                          <div className="text-[11px] text-zinc-500 mb-1.5">Calls to Action</div>
                          <div className="space-y-1">{brief.ctaRecommendations.map((cta: string, i: number) => (
                            <div key={i} className="text-xs text-zinc-300 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800 flex items-start gap-2">
                              <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${i === 0 ? 'bg-teal-500/20 text-teal-400' : 'bg-zinc-800 text-zinc-500'}`}>{i === 0 ? 'Primary' : 'Secondary'}</span>{cta}
                            </div>
                          ))}</div>
                        </div>
                      )}
                    </div>

                    {/* — Detailed Outline — */}
                    {brief.outline?.length > 0 && (
                      <div className="space-y-3">
                        <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-2 after:content-[''] after:flex-1 after:h-px after:bg-zinc-800">Content Outline</div>
                        <div className="space-y-2">
                          {brief.outline.map((s: { heading: string; notes: string; wordCount?: number; keywords?: string[] }, i: number) => (
                            <div key={i} className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                              <div className="flex items-center justify-between">
                                <div className="text-xs font-medium text-zinc-200">H2: {s.heading}</div>
                                {s.wordCount && <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{s.wordCount} words</span>}
                              </div>
                              <div className="text-[11px] text-zinc-500 mt-1.5 leading-relaxed">{s.notes}</div>
                              {s.keywords && s.keywords.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">{s.keywords.map((kw: string, j: number) => <span key={j} className="text-[11px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400/80">{kw}</span>)}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* — SEO Intelligence — */}
                    <div className="space-y-3">
                      <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-2 after:content-[''] after:flex-1 after:h-px after:bg-zinc-800">SEO Intelligence</div>
                      {brief.secondaryKeywords && brief.secondaryKeywords.length > 0 && (
                        <div>
                          <div className="text-[11px] text-zinc-500 mb-1.5">Keywords to Include</div>
                          <div className="flex flex-wrap gap-1.5">
                            {brief.secondaryKeywords.map((kw: string, i: number) => (
                              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{kw}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {brief.topicalEntities && brief.topicalEntities.length > 0 && (
                        <div>
                          <div className="text-[11px] text-zinc-500 mb-1.5">Topics to Reference</div>
                          <div className="flex flex-wrap gap-1.5">
                            {brief.topicalEntities.map((entity: string, i: number) => (
                              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-300">{entity}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {brief.peopleAlsoAsk && brief.peopleAlsoAsk.length > 0 && (
                        <div>
                          <div className="text-[11px] text-zinc-500 mb-1.5">Questions to Address</div>
                          <div className="space-y-1">
                            {brief.peopleAlsoAsk.map((q: string, i: number) => (
                              <div key={i} className="flex items-start gap-2 text-xs text-zinc-300 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                                <span className="text-amber-400 flex-shrink-0 font-medium">Q{i + 1}.</span> {q}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {brief.serpAnalysis?.gaps && brief.serpAnalysis.gaps.length > 0 && (
                        <div>
                          <div className="text-[11px] text-zinc-500 mb-1.5">Your Competitive Edge</div>
                          <div className="space-y-1">
                            {brief.serpAnalysis.gaps.map((g: string, i: number) => (
                              <div key={i} className="text-[11px] text-green-300/80 flex items-start gap-1.5 bg-zinc-950 rounded-lg px-3 py-2 border border-zinc-800">
                                <span className="text-green-400 mt-0.5 flex-shrink-0">→</span>{g}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {brief.internalLinkSuggestions && brief.internalLinkSuggestions.length > 0 && (
                        <div>
                          <div className="text-[11px] text-zinc-500 mb-1.5">Internal Links to Include</div>
                          <div className="flex flex-wrap gap-1.5">
                            {brief.internalLinkSuggestions.map((link: string, i: number) => (
                              <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-blue-400">/{link}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* — E-E-A-T Guidance — */}
                    {brief.eeatGuidance && (
                      <div className="space-y-3">
                        <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-2 after:content-[''] after:flex-1 after:h-px after:bg-zinc-800">E-E-A-T Signals</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {[
                            { label: 'Experience', value: brief.eeatGuidance.experience, color: 'text-blue-400' },
                            { label: 'Expertise', value: brief.eeatGuidance.expertise, color: 'text-teal-400' },
                            { label: 'Authority', value: brief.eeatGuidance.authority, color: 'text-teal-400' },
                            { label: 'Trust', value: brief.eeatGuidance.trust, color: 'text-amber-400' },
                          ].filter(e => e.value).map((e, i) => (
                            <div key={i} className="bg-zinc-950 rounded-lg px-3 py-2.5 border border-zinc-800">
                              <div className={`text-[11px] ${e.color} font-medium uppercase tracking-wider mb-1`}>{e.label}</div>
                              <div className="text-[11px] text-zinc-400 leading-relaxed">{e.value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* — Content Checklist — */}
                    {brief.contentChecklist && brief.contentChecklist.length > 0 && (
                      <div className="space-y-3">
                        <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-2 after:content-[''] after:flex-1 after:h-px after:bg-zinc-800">Content Checklist</div>
                        <div className="bg-zinc-950 rounded-lg border border-zinc-800 divide-y divide-zinc-800/50">
                          {brief.contentChecklist.map((item: string, i: number) => (
                            <div key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                              <div className="w-4 h-4 mt-0.5 rounded border border-zinc-700 flex-shrink-0" />
                              <span className="text-[11px] text-zinc-400 leading-relaxed">{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* — Schema Markup — */}
                    {brief.schemaRecommendations && brief.schemaRecommendations.length > 0 && (
                      <div className="space-y-3">
                        <div className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-2 after:content-[''] after:flex-1 after:h-px after:bg-zinc-800">Schema Markup</div>
                        <div className="space-y-2">
                          {brief.schemaRecommendations.map((schema: { type: string; notes: string }, i: number) => (
                            <div key={i} className="bg-zinc-950 rounded-lg px-4 py-3 border border-zinc-800">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[11px] px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-medium">{schema.type}</span>
                              </div>
                              <div className="text-[11px] text-zinc-400 leading-relaxed">{schema.notes}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Export */}
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={() => window.open(`/api/content-briefs/${workspaceId}/${brief.id}/export`, '_blank')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
                        <Download className="w-3 h-3" /> Download PDF
                      </button>
                    </div>
                  </div>
                )}

                {/* Action buttons for client_review */}
                {req.status === 'client_review' && (
                  effectiveTier === 'free' ? (
                    <TierGate tier={effectiveTier} required="growth" feature="Brief Review Actions" compact className="mt-1"><span /></TierGate>
                  ) : (
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={() => approveBrief(req.id)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600/20 border border-green-500/30 text-xs text-green-300 font-medium hover:bg-green-600/30 transition-colors">
                      <Check className="w-3.5 h-3.5" /> Approve Brief
                    </button>
                    <button onClick={() => { setFeedbackReqId(req.id); setFeedbackText(''); }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600/20 border border-orange-500/30 text-xs text-orange-300 font-medium hover:bg-orange-600/30 transition-colors">
                      <Edit3 className="w-3.5 h-3.5" /> Request Changes
                    </button>
                    <button onClick={() => { setDeclineReqId(req.id); setDeclineReason(''); }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-800 text-xs text-zinc-500 hover:text-red-400 transition-colors">
                      <X className="w-3.5 h-3.5" /> Decline
                    </button>
                  </div>
                  )
                )}

                {/* Delivery link */}
                {req.status === 'delivered' && req.deliveryUrl && (
                  <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
                      <ExternalLink className="w-4 h-4 text-green-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-green-300 mb-0.5">Your content is ready</div>
                      <a href={req.deliveryUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-green-400 hover:text-green-300 underline underline-offset-2 truncate block">{req.deliveryUrl}</a>
                      {req.deliveryNotes && <div className="text-[11px] text-zinc-400 mt-1">{req.deliveryNotes}</div>}
                    </div>
                  </div>
                )}

                {/* Post-publish performance snippet */}
                {(req.status === 'delivered' || req.status === 'published') && (() => {
                  const perf = contentPerf[req.id];
                  if (!perf?.gsc && !perf?.ga4) return null;
                  const gsc = perf.gsc;
                  const ga4 = perf.ga4;
                  return (
                    <div className="bg-gradient-to-r from-blue-500/5 to-teal-500/5 border border-blue-500/15 rounded-xl p-4 space-y-2">
                      <div className="flex items-center gap-2 mb-1">
                        <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
                        <span className="text-[11px] text-blue-300 font-medium uppercase tracking-wider">Content Performance</span>
                        {perf.daysSincePublish > 0 && <span className="text-[11px] text-zinc-500 ml-auto">{perf.daysSincePublish}d since publish</span>}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {gsc && <>
                          <div className="bg-zinc-950/60 rounded-lg px-3 py-2 border border-zinc-800/50">
                            <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-0.5"><MousePointerClick className="w-3 h-3" /> Clicks</div>
                            <div className="text-sm font-bold text-teal-400 tabular-nums">{gsc.clicks.toLocaleString()}</div>
                          </div>
                          <div className="bg-zinc-950/60 rounded-lg px-3 py-2 border border-zinc-800/50">
                            <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-0.5"><Eye className="w-3 h-3" /> Impressions</div>
                            <div className="text-sm font-bold text-blue-400 tabular-nums">{gsc.impressions.toLocaleString()}</div>
                          </div>
                          <div className="bg-zinc-950/60 rounded-lg px-3 py-2 border border-zinc-800/50">
                            <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-0.5"><ArrowUpRight className="w-3 h-3" /> CTR</div>
                            <div className="text-sm font-bold text-zinc-200 tabular-nums">{gsc.ctr}%</div>
                          </div>
                          <div className="bg-zinc-950/60 rounded-lg px-3 py-2 border border-zinc-800/50">
                            <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-0.5"><TrendingUp className="w-3 h-3" /> Avg Position</div>
                            <div className={`text-sm font-bold tabular-nums ${gsc.position <= 10 ? 'text-emerald-400' : gsc.position <= 20 ? 'text-amber-400' : 'text-zinc-300'}`}>{gsc.position}</div>
                          </div>
                        </>}
                        {ga4 && !gsc && <>
                          <div className="bg-zinc-950/60 rounded-lg px-3 py-2 border border-zinc-800/50">
                            <div className="text-[10px] text-zinc-500 mb-0.5">Sessions</div>
                            <div className="text-sm font-bold text-teal-400 tabular-nums">{ga4.sessions.toLocaleString()}</div>
                          </div>
                          <div className="bg-zinc-950/60 rounded-lg px-3 py-2 border border-zinc-800/50">
                            <div className="text-[10px] text-zinc-500 mb-0.5">Users</div>
                            <div className="text-sm font-bold text-blue-400 tabular-nums">{ga4.users.toLocaleString()}</div>
                          </div>
                        </>}
                      </div>
                      {gsc && gsc.clicks === 0 && gsc.impressions > 0 && (
                        <div className="text-[11px] text-zinc-500 italic">Your content is showing in search results but hasn&apos;t received clicks yet. This is normal for new content &mdash; give it time.</div>
                      )}
                      {gsc && gsc.impressions === 0 && (
                        <div className="text-[11px] text-zinc-500 italic">Google hasn&apos;t indexed this page yet. It typically takes 1&ndash;4 weeks for new content to appear in search.</div>
                      )}
                    </div>
                  );
                })()}

                {/* Upgrade CTA for brief_only items after approval */}
                {canUpgrade && (
                  <div className="bg-gradient-to-r from-teal-600/10 via-emerald-600/10 to-teal-600/10 border border-teal-500/20 rounded-xl p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500/20 to-emerald-500/20 flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-5 h-5 text-teal-400" />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-teal-200">Want the full article written?</div>
                      <div className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">Love the brief? Upgrade to a professionally written blog post delivered ready to publish.</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setPricingModal({ serviceType: 'full_post', topic: req.topic, targetKeyword: req.targetKeyword, source: 'upgrade', upgradeReqId: req.id }); }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-xs text-white font-medium hover:from-teal-500 hover:to-emerald-500 transition-all flex-shrink-0 shadow-lg shadow-teal-900/20"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Upgrade to Full Post
                      {briefPrice != null && fullPostPrice != null && <span className="text-[11px] opacity-70 ml-0.5">+{fmtPrice(Math.max(0, fullPostPrice - briefPrice))}</span>}
                    </button>
                  </div>
                )}

                {/* Feedback modal */}
                {feedbackReqId === req.id && (
                  <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-4 space-y-3">
                    <div className="text-xs text-orange-300 font-medium">What changes would you like?</div>
                    <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)} placeholder="Describe what you'd like changed..." rows={3} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 resize-none" />
                    <div className="flex items-center gap-2">
                      <button onClick={() => requestChanges(req.id)} disabled={!feedbackText.trim()} className="px-4 py-2 rounded-lg bg-orange-600 text-xs text-white font-medium hover:bg-orange-500 transition-colors disabled:opacity-50">Submit Feedback</button>
                      <button onClick={() => setFeedbackReqId(null)} className="px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                    </div>
                  </div>
                )}

                {/* Decline modal (works for both requested topics and client_review briefs) */}
                {declineReqId === req.id && (
                  <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 space-y-3">
                    <div className="text-xs text-red-300 font-medium">Why are you declining? (optional)</div>
                    <input type="text" value={declineReason} onChange={e => setDeclineReason(e.target.value)} placeholder="e.g. Not relevant to our current goals" className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600" />
                    <div className="flex items-center gap-2">
                      <button onClick={() => declineTopic(req.id)} className="px-4 py-2 rounded-lg bg-red-600/80 text-xs text-white font-medium hover:bg-red-600 transition-colors">Confirm Decline</button>
                      <button onClick={() => setDeclineReqId(null)} className="px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                    </div>
                  </div>
                )}

                {/* Decline option for requested topics (not in review) */}
                {req.status === 'requested' && declineReqId !== req.id && (
                  <button onClick={() => { setDeclineReqId(req.id); setDeclineReason(''); }} className="text-xs text-zinc-500 hover:text-red-400 transition-colors">Not interested in this topic</button>
                )}

                {/* Comments thread */}
                {req.comments && req.comments.length > 0 && (
                  <div>
                    <div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Comments</div>
                    <div className="space-y-1.5">
                      {req.comments.map(c => (
                        <div key={c.id} className={`text-xs px-3 py-2 rounded-lg ${c.author === 'client' ? 'bg-blue-500/10 border border-blue-500/15 text-blue-300 ml-6' : 'bg-zinc-800/60 border border-zinc-800 text-zinc-400 mr-6'}`}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="font-medium text-[11px]">{c.author === 'client' ? 'You' : 'Team'}</span>
                            <span className="text-[11px] text-zinc-500">{new Date(c.createdAt).toLocaleDateString()}</span>
                          </div>
                          {c.content}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add comment */}
                {!['delivered', 'published', 'declined'].includes(req.status) && (
                  <div className="flex items-center gap-2">
                    <input type="text" value={expandedContentReq === req.id ? contentComment : ''} onChange={e => setContentComment(e.target.value)} placeholder="Add a comment..." className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600" onKeyDown={e => { if (e.key === 'Enter') addContentComment(req.id); }} />
                    <button onClick={() => addContentComment(req.id)} disabled={!contentComment.trim() || sendingContentComment} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50">
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>

    {/* Declined items (collapsed) */}
    {contentRequests.filter(r => r.status === 'declined').length > 0 && (
      <details className="mt-4">
        <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 transition-colors">
          {contentRequests.filter(r => r.status === 'declined').length} declined topic{contentRequests.filter(r => r.status === 'declined').length > 1 ? 's' : ''}
        </summary>
        <div className="mt-2 space-y-2">
          {contentRequests.filter(r => r.status === 'declined').map(req => (
            <div key={req.id} className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 px-4 py-3 opacity-60">
              <div className="text-xs text-zinc-400">{req.topic}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">&ldquo;{req.targetKeyword}&rdquo;</div>
            </div>
          ))}
        </div>
      </details>
    )}
  </>);
}
