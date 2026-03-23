import { useState, useEffect } from 'react';
import { MessageSquarePlus, X, Bug, Lightbulb, MessageCircle, Send, ChevronDown, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { get, post } from '../../api/client';

type FeedbackType = 'bug' | 'feature' | 'general';
type FeedbackStatus = 'new' | 'acknowledged' | 'fixed' | 'wontfix';

interface FeedbackReply {
  id: string;
  author: 'team' | 'client';
  content: string;
  createdAt: string;
}

interface FeedbackItem {
  id: string;
  workspaceId: string;
  type: FeedbackType;
  title: string;
  description: string;
  status: FeedbackStatus;
  context?: { currentTab?: string; browser?: string; screenSize?: string; url?: string; userAgent?: string };
  submittedBy?: string;
  replies: FeedbackReply[];
  createdAt: string;
  updatedAt: string;
}

const TYPE_CONFIG: Record<FeedbackType, { label: string; icon: typeof Bug; color: string; bg: string; border: string }> = {
  bug: { label: 'Bug Report', icon: Bug, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  feature: { label: 'Feature Request', icon: Lightbulb, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  general: { label: 'General Feedback', icon: MessageCircle, color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
};

const STATUS_CONFIG: Record<FeedbackStatus, { label: string; color: string; bg: string }> = {
  new: { label: 'Submitted', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  acknowledged: { label: 'Acknowledged', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  fixed: { label: 'Resolved', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  wontfix: { label: 'Noted', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
};

interface Props {
  workspaceId: string;
  currentTab: string;
  submittedBy?: string;
  chatExpanded?: boolean;
}

export function FeedbackWidget({ workspaceId, currentTab, submittedBy, chatExpanded }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'form' | 'list'>('form');
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  // Form state
  const [type, setType] = useState<FeedbackType>('general');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadFeedback = async () => {
    try {
      const data = await get<FeedbackItem[]>(`/api/public/feedback/${workspaceId}`);
      setItems(data);
    } catch (err) { console.error('FeedbackWidget operation failed:', err); }
  };

  useEffect(() => {
    if (open && view === 'list') loadFeedback();
  }, [open, view]); // loadFeedback reads workspaceId from closure — stable across renders

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const context = {
        currentTab,
        browser: navigator.userAgent.split(' ').pop() || navigator.userAgent.slice(0, 50),
        screenSize: `${window.innerWidth}x${window.innerHeight}`,
        url: window.location.href,
        userAgent: navigator.userAgent,
      };
      await post(`/api/public/feedback/${workspaceId}`, { type, title: title.trim(), description: description.trim(), context, submittedBy });
      setSubmitted(true);
      setTitle('');
      setDescription('');
      setTimeout(() => { setSubmitted(false); setView('list'); loadFeedback(); }, 1500);
    } catch { setSubmitError('Failed to submit feedback. Please try again.'); }
    finally { setSubmitting(false); }
  };

  const handleReply = async (itemId: string) => {
    if (!replyText.trim()) return;
    try {
      await post(`/api/public/feedback/${workspaceId}/${itemId}/reply`, { content: replyText.trim() });
      setReplyText('');
      setReplyingTo(null);
      loadFeedback();
    } catch { setSubmitError('Failed to send reply. Please try again.'); }
  };

  const unreadCount = items.filter(i => i.replies.some(r => r.author === 'team') && i.status !== 'fixed' && i.status !== 'wontfix').length;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`fixed bottom-6 left-6 flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-zinc-800/90 hover:bg-zinc-700/90 border border-zinc-700/50 text-zinc-300 hover:text-zinc-100 text-xs font-medium shadow-lg transition-all z-40 backdrop-blur-sm ${chatExpanded ? 'sm:flex hidden' : ''}`}
      >
        <MessageSquarePlus className="w-3.5 h-3.5" />
        Feedback
        {unreadCount > 0 && (
          <span className="w-4 h-4 rounded-full bg-teal-500 text-[9px] font-bold text-white flex items-center justify-center">{unreadCount}</span>
        )}
      </button>
    );
  }

  return (
    <div className={`fixed bottom-6 left-6 w-[360px] max-h-[520px] bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl shadow-black/40 overflow-hidden z-40 flex flex-col ${chatExpanded ? 'sm:flex hidden' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquarePlus className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-medium text-zinc-200">Beta Feedback</span>
          <span className="text-[10px] text-teal-400/70 bg-teal-500/10 px-1.5 py-0.5 rounded border border-teal-500/20">beta</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView(view === 'form' ? 'list' : 'form')}
            className={`text-xs px-2 py-1 rounded transition-colors ${view === 'list' ? 'text-teal-400 bg-teal-500/10' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            {view === 'form' ? `History${items.length > 0 ? ` (${items.length})` : ''}` : '+ New'}
          </button>
          <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view === 'form' ? (
          submitted ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              </div>
              <p className="text-sm font-medium text-zinc-200">Thank you!</p>
              <p className="text-xs text-zinc-500 mt-1">Your feedback has been submitted.</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {/* Type selector */}
              <div className="grid grid-cols-3 gap-2">
                {(Object.entries(TYPE_CONFIG) as [FeedbackType, typeof TYPE_CONFIG['bug']][]).map(([key, cfg]) => {
                  const Icon = cfg.icon;
                  return (
                    <button
                      key={key}
                      onClick={() => setType(key)}
                      className={`flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-xl border text-[11px] font-medium transition-all ${
                        type === key
                          ? `${cfg.bg} ${cfg.border} ${cfg.color}`
                          : 'bg-zinc-800/50 border-zinc-800 text-zinc-500 hover:text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {cfg.label.split(' ')[0]}
                    </button>
                  );
                })}
              </div>

              {/* Title */}
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={type === 'bug' ? 'What went wrong?' : type === 'feature' ? 'What would you like?' : 'Quick summary'}
                              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
                            />

              {/* Description */}
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={type === 'bug' ? 'Steps to reproduce, what you expected, what happened...' : type === 'feature' ? 'Describe the feature and how it would help you...' : 'Tell us what you think...'}
                rows={4}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors resize-none"
              />

              {/* Auto-context badge */}
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                Context auto-attached: current tab, browser, screen size
              </div>

              {/* Error */}
              {submitError && (
                <p className="text-[11px] text-red-400">{submitError}</p>
              )}
              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={submitting || !title.trim() || !description.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {submitting ? 'Submitting...' : 'Submit Feedback'}
              </button>
            </div>
          )
        ) : (
          /* History list */
          <div className="p-3 space-y-2">
            {items.length === 0 && (
              <div className="py-8 text-center">
                <MessageSquarePlus className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
                <p className="text-xs text-zinc-500">No feedback submitted yet.</p>
                <button onClick={() => setView('form')} className="text-xs text-teal-400 hover:text-teal-300 mt-2 transition-colors">
                  Submit your first feedback
                </button>
              </div>
            )}
            {items.map(item => {
              const cfg = TYPE_CONFIG[item.type];
              const Icon = cfg.icon;
              const statusCfg = STATUS_CONFIG[item.status];
              const isExpanded = expandedId === item.id;
              const hasTeamReply = item.replies.some(r => r.author === 'team');

              return (
                <div key={item.id} className="bg-zinc-800/50 rounded-xl border border-zinc-800 overflow-hidden">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-zinc-800/80 transition-colors"
                  >
                    <div className={`w-6 h-6 rounded-lg ${cfg.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <Icon className={`w-3 h-3 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-zinc-200 truncate">{item.title}</span>
                        {hasTeamReply && <span className="w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${statusCfg.bg} ${statusCfg.color} font-medium`}>{statusCfg.label}</span>
                        <span className="text-[9px] text-zinc-600">{new Date(item.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <ChevronDown className={`w-3.5 h-3.5 text-zinc-600 flex-shrink-0 mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-zinc-800">
                      <p className="text-[11px] text-zinc-400 mt-2 leading-relaxed">{item.description}</p>

                      {/* Replies */}
                      {item.replies.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {item.replies.map(reply => (
                            <div key={reply.id} className={`rounded-lg px-2.5 py-2 ${reply.author === 'team' ? 'bg-teal-500/5 border border-teal-500/10' : 'bg-zinc-800/80 border border-zinc-700/50'}`}>
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className={`text-[9px] font-medium ${reply.author === 'team' ? 'text-teal-400' : 'text-zinc-400'}`}>
                                  {reply.author === 'team' ? 'Team' : 'You'}
                                </span>
                                <span className="text-[9px] text-zinc-600">{new Date(reply.createdAt).toLocaleDateString()}</span>
                              </div>
                              <p className="text-[11px] text-zinc-300 leading-relaxed">{reply.content}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Reply input */}
                      {item.status !== 'fixed' && item.status !== 'wontfix' && (
                        replyingTo === item.id ? (
                          <div className="mt-2 flex gap-1.5">
                            <input
                              type="text"
                              value={replyText}
                              onChange={e => setReplyText(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleReply(item.id)}
                              placeholder="Add a reply..."
                              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500"
                              autoFocus
                            />
                            <button onClick={() => handleReply(item.id)} disabled={!replyText.trim()} className="px-2 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 rounded-lg transition-colors">
                              <Send className="w-3 h-3 text-white" />
                            </button>
                            <button onClick={() => { setReplyingTo(null); setReplyText(''); }} className="px-2 py-1.5 text-zinc-500 hover:text-zinc-300">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setReplyingTo(item.id)}
                            className="mt-2 text-[10px] text-teal-400 hover:text-teal-300 transition-colors"
                          >
                            Reply
                          </button>
                        )
                      )}

                      {/* Context info */}
                      {item.context?.currentTab && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <Clock className="w-2.5 h-2.5 text-zinc-600" />
                          <span className="text-[9px] text-zinc-600">Submitted from: {item.context.currentTab} tab</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
